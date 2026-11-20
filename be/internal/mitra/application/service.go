package application

import (
	"context"
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
	"govite/internal/platform/crypto"
)

var mitraKodeRe = regexp.MustCompile(`^[0-9]{3}$`)

type Service struct {
	Repo      domain.Repository
	Tx        kernel.Tx
	Prov      domain.Provisioner
	Encryptor *crypto.SecretBox
}

// List returns mitra rows with the total count.
func (s *Service) List(ctx context.Context, f domain.Filter, limit, offset int32) ([]domain.Mitra, int64, error) {
	rows, err := s.Repo.List(ctx, f, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.Repo.Count(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// Get returns a single mitra. Bundle completeness is derived from the
// encrypted credential columns in the database, never from files.
func (s *Service) Get(ctx context.Context, id string) (domain.Mitra, error) {
	mitra, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	hasID := mitra.ProvisionPartnerID != nil
	hasHMAC := mitra.HMACSecretEncrypted != nil && *mitra.HMACSecretEncrypted != ""
	hasPriv := mitra.PrivateKeyEncrypted != nil && *mitra.PrivateKeyEncrypted != ""
	mitra.HasIdentity = hasID
	mitra.HasHmacSecret = hasHMAC
	mitra.HasPrivateKey = hasPriv
	mitra.BundleCompleteness = &domain.BundleCompleteness{
		PartnerJSON: hasID,
		HMACSecret:  hasHMAC,
		PrivatePEM:  hasPriv,
	}
	return mitra, nil
}

// CreateInput is the superadmin's request to create one mitra. Every field is
// validated here before any key generation or gateway call.
type CreateInput struct {
	KodeMitra        string   `json:"kodeMitra" validate:"required"`
	Nama             string   `json:"nama" validate:"required,min=1,max=200"`
	PartnerServiceID string   `json:"partnerServiceId" validate:"required,len=8"`
	VAPrefix         string   `json:"vaPrefix" validate:"required"`
	BranchCode       string   `json:"branchCode" validate:"required"`
	CallbackUrl      *string  `json:"callbackUrl" validate:"omitempty,url"`
	RateLimitTier    string   `json:"rateLimitTier" validate:"required,oneof=standard"`
	IPWhitelist      []string `json:"ipWhitelist" validate:"omitempty,dive,ip"`
	ConnectionType   string   `json:"connectionType" validate:"required,oneof=PORTAL_ONLY HOST_TO_HOST"`
}

type CredentialDelivery struct {
	PartnerID        string `json:"partnerId"`
	ClientID         string `json:"clientId"`
	PartnerServiceID string `json:"partnerServiceId"`
	VAPrefix         string `json:"vaPrefix"`
	GatewayBaseURL   string `json:"gatewayBaseUrl"`
	ClientSecret     string `json:"clientSecret"`
	PrivateKeyPEM    string `json:"privateKeyPem"`
}

type CreateResult struct {
	Mitra       domain.Mitra        `json:"mitra"`
	Credentials *CredentialDelivery `json:"credentials,omitempty"`
}

func (s *Service) Create(ctx context.Context, in CreateInput) (CreateResult, error) {
	if err := validateCreate(in); err != nil {
		return CreateResult{}, err
	}
	if _, err := s.Repo.GetByKode(ctx, in.KodeMitra); err == nil {
		return CreateResult{}, domain.ErrKodeMitraTaken
	} else if !errors.Is(err, domain.ErrNotFound) {
		return CreateResult{}, err
	}

	var provision domain.ProvisionResult
	if s.Prov != nil {
		var err error
		provision, err = s.Prov.Provision(ctx, in.KodeMitra, domain.ProvisionInput{
			Nama:             in.Nama,
			PartnerServiceID: in.PartnerServiceID,
			VAPrefix:         in.VAPrefix,
			BranchCode:       in.BranchCode,
			CallbackURL:      callbackUrlValue(in.CallbackUrl),
			RateLimitTier:    in.RateLimitTier,
			IPWhitelist:      ipWhitelistOrEmpty(in.IPWhitelist),
		})
		if err != nil {
			if pe, ok := err.(*domain.ProvisionError); ok && pe.PartnerID != "" {
				if m, repairErr := s.recordNeedsRepair(ctx, in, pe.PartnerID, pe.Detail); repairErr == nil {
					return CreateResult{Mitra: m}, &domain.NeedsRepairError{Mitra: m, Cause: err}
				}
			}
			return CreateResult{}, err
		}
	}

	// Encrypt the credential material before persisting. Encryption failures
	// are treated as persistence failures: the gateway partner must not be
	// re-registered.
	var hmacEnc, privEnc string
	if provision.ClientSecret != nil {
		sealed, err := crypto.EncryptWithSecretBox(s.Encryptor, string(provision.ClientSecret))
		if err != nil {
			detail := "encrypt hmac.secret: " + err.Error()
			if m, repairErr := s.recordNeedsRepair(ctx, in, provision.PartnerID, detail); repairErr == nil {
				return CreateResult{Mitra: m}, &domain.NeedsRepairError{Mitra: m, Cause: err}
			}
			return CreateResult{}, err
		}
		hmacEnc = sealed
	}
	if provision.PrivateKeyPEM != nil {
		sealed, err := crypto.EncryptWithSecretBox(s.Encryptor, string(provision.PrivateKeyPEM))
		if err != nil {
			detail := "encrypt private.pem: " + err.Error()
			if m, repairErr := s.recordNeedsRepair(ctx, in, provision.PartnerID, detail); repairErr == nil {
				return CreateResult{Mitra: m}, &domain.NeedsRepairError{Mitra: m, Cause: err}
			}
			return CreateResult{}, err
		}
		privEnc = sealed
	}

	id := kernel.NewID()
	if err := s.Tx.Do(ctx, func(ctx context.Context) error {
		var partnerID *string
		if provision.PartnerID != "" {
			partnerID = &provision.PartnerID
		}
		return s.Repo.Create(ctx, id, in.KodeMitra, in.Nama, true, in.PartnerServiceID, in.VAPrefix, "", "READY", partnerID, nil, in.ConnectionType, in.ConnectionType == domain.ConnectionHostToHost, &hmacEnc, &privEnc)
	}); err != nil {
		if provision.PartnerID != "" {
			if m, repairErr := s.recordNeedsRepair(ctx, in, provision.PartnerID, err.Error()); repairErr == nil {
				return CreateResult{Mitra: m}, &domain.NeedsRepairError{Mitra: m, Cause: err}
			}
		}
		return CreateResult{}, err
	}
	mitra, err := s.Repo.Get(ctx, id)
	if err != nil {
		return CreateResult{}, err
	}
	result := CreateResult{Mitra: mitra}
	if in.ConnectionType == domain.ConnectionHostToHost && provision.ClientSecret != nil {
		// One-time delivery: decrypt from DB columns and return once.
		partnerID, clientID, secret, privateKeyPEM, err := s.GetCredentials(ctx, in.KodeMitra)
		if err != nil {
			return CreateResult{}, err
		}
		result.Credentials = &CredentialDelivery{
			PartnerID:        partnerID,
			ClientID:         clientID,
			PartnerServiceID: in.PartnerServiceID,
			VAPrefix:         in.VAPrefix,
			GatewayBaseURL:   provision.GatewayBaseURL,
			ClientSecret:     secret,
			PrivateKeyPEM:    privateKeyPEM,
		}
	}
	// Mark credentials as delivered so refresh/reopen cannot re-show them.
	if in.ConnectionType == domain.ConnectionHostToHost && provision.ClientSecret != nil {
		if err := s.Repo.MarkReady(ctx, id, true); err != nil {
			return CreateResult{}, err
		}
	}
	return result, nil
}

// GetCredentials returns decrypted credentials for one mitra kode, used by the
// VA signing client as a credential loader. It never returns plaintext
// secrets to the frontend; it is only consumed by backend signing code.
func (s *Service) GetCredentials(ctx context.Context, kode string) (partnerID, clientID, secret, privateKeyPEM string, err error) {
	mitra, err := s.Repo.GetByKode(ctx, kode)
	if err != nil {
		return "", "", "", "", err
	}
	hmacEnc, privEnc, err := s.Repo.GetEncryptedCredentials(ctx, mitra.ID)
	if err != nil {
		return "", "", "", "", err
	}
	secret, err = crypto.DecryptWithSecretBox(s.Encryptor, hmacEnc)
	if err != nil {
		return "", "", "", "", err
	}
	privateKeyPEM, err = crypto.DecryptWithSecretBox(s.Encryptor, privEnc)
	if err != nil {
		return "", "", "", "", err
	}
	if mitra.ProvisionPartnerID != nil {
		partnerID = *mitra.ProvisionPartnerID
	}
	return partnerID, mitra.KodeMitra, secret, privateKeyPEM, nil
}

func (s *Service) recordNeedsRepair(ctx context.Context, in CreateInput, partnerID, detail string) (domain.Mitra, error) {
	existing, err := s.Repo.GetByKode(ctx, in.KodeMitra)
	if err == nil {
		if err := s.Tx.Do(ctx, func(ctx context.Context) error { return s.Repo.MarkNeedsRepair(ctx, existing.ID, partnerID, detail) }); err != nil {
			return domain.Mitra{}, err
		}
		return s.Repo.Get(ctx, existing.ID)
	}
	id := kernel.NewID()
	if err := s.Tx.Do(ctx, func(ctx context.Context) error {
		pid, msg := partnerID, detail
		return s.Repo.Create(ctx, id, in.KodeMitra, in.Nama, true, in.PartnerServiceID, in.VAPrefix, "", domain.ProvisionStatusNeedsRepair, &pid, &msg, in.ConnectionType, false, nil, nil)
	}); err != nil {
		return domain.Mitra{}, err
	}
	return s.Repo.Get(ctx, id)
}

func validateCreate(in CreateInput) error {
	if in.KodeMitra == "" || !mitraKodeRe.MatchString(in.KodeMitra) {
		return validation("kodeMitra: harus 3 digit angka")
	}
	if strings.TrimSpace(in.Nama) == "" {
		return validation("nama: wajib diisi")
	}
	wantPSID := strings.Repeat(" ", 8-len(in.KodeMitra)) + in.KodeMitra
	if in.PartnerServiceID != wantPSID {
		return validation("partnerServiceId: harus kode mitra left-pad spasi ke 8 karakter, mis. \"     010\"")
	}
	if in.VAPrefix != in.KodeMitra+"41" {
		return validation("vaPrefix: harus kode mitra diikuti literal \"41\", mis. \"01041\"")
	}
	if strings.TrimSpace(in.BranchCode) == "" {
		return validation("branchCode: wajib diisi")
	}
	if in.CallbackUrl == nil || *in.CallbackUrl == "" {
		return validation("callbackUrl: wajib URL HTTPS yang valid")
	}
	u, err := url.Parse(*in.CallbackUrl)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return validation("callbackUrl: wajib URL HTTPS yang valid")
	}
	if in.RateLimitTier != "standard" {
		return validation("rateLimitTier: harus standard")
	}
	if in.ConnectionType != domain.ConnectionPortalOnly && in.ConnectionType != domain.ConnectionHostToHost {
		return validation("connectionType: harus PORTAL_ONLY atau HOST_TO_HOST")
	}
	for _, ip := range in.IPWhitelist {
		if net.ParseIP(ip) == nil {
			if _, _, err := net.ParseCIDR(ip); err != nil {
				return validation("ipWhitelist: harus berisi alamat IP atau CIDR yang valid")
			}
		}
	}
	return nil
}

func callbackUrlValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func ipWhitelistOrEmpty(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

type UpdateInput struct {
	KodeMitra      *string `json:"kodeMitra" validate:"omitempty,min=1,max=50"`
	Nama           *string `json:"nama" validate:"omitempty,min=1,max=200"`
	IsActive       *bool   `json:"isActive"`
	ConnectionType *string `json:"connectionType" validate:"omitempty,oneof=PORTAL_ONLY HOST_TO_HOST"`
}

func (s *Service) Update(ctx context.Context, id string, in UpdateInput) (domain.Mitra, error) {
	before, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	c := domain.Changes{KodeMitra: in.KodeMitra, Nama: in.Nama, IsActive: in.IsActive, ConnectionType: in.ConnectionType}
	deactivating := in.IsActive != nil && !*in.IsActive && before.IsActive
	err = s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.Update(ctx, id, c); err != nil {
			return err
		}
		if deactivating {
			return s.Repo.RevokeSessions(ctx, id)
		}
		return nil
	})
	if err != nil {
		return domain.Mitra{}, err
	}
	after, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	return after, nil
}

type RotateResult struct {
	Mitra       domain.Mitra        `json:"mitra"`
	Credentials *CredentialDelivery `json:"credentials,omitempty"`
}

func (s *Service) RotateSecret(ctx context.Context, id string) (RotateResult, error) {
	mitra, err := s.Repo.Get(ctx, id)
	if err != nil {
		return RotateResult{}, err
	}
	if s.Prov == nil || mitra.ProvisionPartnerID == nil {
		// Rotation requires a partnerId (gateway-assigned). Without it there is
		// nothing to rotate against.
		return RotateResult{}, domain.ErrSNAPNotConfigured
	}
	rotated, err := s.Prov.RotateSecret(ctx, mitra.KodeMitra, *mitra.ProvisionPartnerID)
	if err != nil {
		if !errors.Is(err, domain.ErrRotateContractMissing) {
			_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, err.Error())
		}
		return RotateResult{}, err
	}
	// Encrypt the new secret before persisting. On failure, mark NEEDS_REPAIR
	// and do not retry blindly: the gateway has already invalidated the old
	// secret.
	sealed, err := crypto.EncryptWithSecretBox(s.Encryptor, string(rotated.ClientSecret))
	if err != nil {
		detail := "encrypt rotated hmac.secret: " + err.Error()
		_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, detail)
		return RotateResult{}, domain.ErrProvisionFailed.WithDetail(detail)
	}
	// Keep the existing encrypted private key; rotation changes only the HMAC
	// secret. Read it back so the DB row stays consistent.
	_, privEnc, err := s.Repo.GetEncryptedCredentials(ctx, id)
	if err != nil {
		_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, err.Error())
		return RotateResult{}, err
	}
	if err := s.Repo.SaveEncryptedCredentials(ctx, id, sealed, privEnc); err != nil {
		_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, err.Error())
		return RotateResult{}, err
	}
	// Determine delivery eligibility and provision status.
	delivered := mitra.ConnectionType == domain.ConnectionHostToHost
	hasPrivateKey := privEnc != "" && privEnc != "null"
	if delivered && !hasPrivateKey {
		// HOST_TO_HOST without a private key cannot complete rotation: the new
		// secret is saved but the mitra still cannot request tokens.
		if err := s.Repo.MarkNeedsKeypair(ctx, id, *mitra.ProvisionPartnerID, "rsa private key missing in DB"); err != nil {
			_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, "persist rotated credential state: "+err.Error())
			return RotateResult{}, err
		}
		mitra, err = s.Repo.Get(ctx, id)
		if err != nil {
			return RotateResult{}, err
		}
		return RotateResult{Mitra: mitra}, nil
	}
	if err := s.Repo.MarkReady(ctx, id, delivered); err != nil {
		_ = s.Repo.MarkNeedsRepair(ctx, id, *mitra.ProvisionPartnerID, "persist rotated credential state: "+err.Error())
		return RotateResult{}, err
	}
	mitra, err = s.Repo.Get(ctx, id)
	if err != nil {
		return RotateResult{}, err
	}
	result := RotateResult{Mitra: mitra}
	if delivered {
		// One-time delivery: new HMAC secret only. RSA key is unchanged and is
		// not re-shown. Load the private key from DB only for type-change
		// scenarios where it has never been delivered.
		var privateKey string
		if !mitra.CredentialsDelivered && hasPrivateKey {
			privateKey, err = crypto.DecryptWithSecretBox(s.Encryptor, privEnc)
			if err != nil {
				return RotateResult{}, domain.ErrProvisionFailed.WithDetail("decrypt private.pem for first H2H delivery: " + err.Error())
			}
		}
		result.Credentials = &CredentialDelivery{
			PartnerID:        *mitra.ProvisionPartnerID,
			ClientID:         mitra.KodeMitra,
			PartnerServiceID: mitra.PartnerServiceID,
			VAPrefix:         mitra.VAPrefix,
			ClientSecret:     string(rotated.ClientSecret),
			PrivateKeyPEM:    privateKey,
		}
	}
	return result, nil
}

type ActiveInput struct {
	IsActive bool `json:"isActive"`
}

func (s *Service) SetActive(ctx context.Context, id string, in ActiveInput) (domain.Mitra, error) {
	before, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	deactivating := !in.IsActive && before.IsActive
	err = s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.SetActive(ctx, id, in.IsActive); err != nil {
			return err
		}
		if deactivating {
			return s.Repo.RevokeSessions(ctx, id)
		}
		return nil
	})
	if err != nil {
		return domain.Mitra{}, err
	}
	after, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	return after, nil
}

func validation(detail string) error {
	return kernel.E(kernel.Invalid, "VALIDATION_ERROR", "Request validation failed").WithDetail(detail)
}
