package application

import (
	"context"
	"errors"
	"net"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
)

var mitraKodeRe = regexp.MustCompile(`^[0-9]{3}$`)

type Service struct {
	Repo domain.Repository
	Tx   kernel.Tx
	Prov domain.Provisioner
	// SecretsDir is the SNAP credential root. Empty means the gateway is not
	// configured and mitra creation does not provision a bundle.
	SecretsDir string
}

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

func (s *Service) Get(ctx context.Context, id string) (domain.Mitra, error) {
	return s.Repo.Get(ctx, id)
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
}

func (s *Service) Create(ctx context.Context, in CreateInput) (domain.Mitra, error) {
	if err := validateCreate(in); err != nil {
		return domain.Mitra{}, err
	}
	if _, err := s.Repo.GetByKode(ctx, in.KodeMitra); err == nil {
		return domain.Mitra{}, domain.ErrKodeMitraTaken
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Mitra{}, err
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
					return m, &domain.NeedsRepairError{Mitra: m, Cause: err}
				}
			}
			return domain.Mitra{}, err
		}
	}

	id := kernel.NewID()
	if err := s.Tx.Do(ctx, func(ctx context.Context) error {
		var partnerID *string
		if provision.PartnerID != "" {
			partnerID = &provision.PartnerID
		}
		return s.Repo.Create(ctx, id, in.KodeMitra, in.Nama, true, in.PartnerServiceID, in.VAPrefix, filepath.Join(s.SecretsDir, in.KodeMitra), "READY", partnerID, nil)
	}); err != nil {
		if provision.PartnerID != "" {
			if m, repairErr := s.recordNeedsRepair(ctx, in, provision.PartnerID, err.Error()); repairErr == nil {
				return m, &domain.NeedsRepairError{Mitra: m, Cause: err}
			}
		}
		return domain.Mitra{}, err
	}
	return s.Repo.Get(ctx, id)
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
	path := filepath.Join(s.SecretsDir, in.KodeMitra)
	if err := s.Tx.Do(ctx, func(ctx context.Context) error {
		pid, msg := partnerID, detail
		return s.Repo.Create(ctx, id, in.KodeMitra, in.Nama, true, in.PartnerServiceID, in.VAPrefix, path, domain.ProvisionStatusNeedsRepair, &pid, &msg)
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
	if in.CallbackUrl != nil && *in.CallbackUrl != "" {
		u, err := url.Parse(*in.CallbackUrl)
		if err != nil || u.Scheme == "" {
			return validation("callbackUrl: URL tidak valid")
		}
	}
	if in.RateLimitTier != "standard" {
		return validation("rateLimitTier: harus standard")
	}
	for _, ip := range in.IPWhitelist {
		if net.ParseIP(ip) == nil {
			return validation("ipWhitelist: harus berisi alamat IP tunggal, bukan CIDR")
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
	KodeMitra *string `json:"kodeMitra" validate:"omitempty,min=1,max=50"`
	Nama      *string `json:"nama" validate:"omitempty,min=1,max=200"`
	IsActive  *bool   `json:"isActive"`
}

func (s *Service) Update(ctx context.Context, id string, in UpdateInput) (domain.Mitra, error) {
	before, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	c := domain.Changes{KodeMitra: in.KodeMitra, Nama: in.Nama, IsActive: in.IsActive}
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
