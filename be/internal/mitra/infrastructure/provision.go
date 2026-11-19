// Package infrastructure implements the mitra Provisioner: it generates the
// mitra's RSA-2048 keypair server-side only, registers the mitra with the
// gateway, and writes its credential bundle under SNAP_SECRETS_DIR/<kode>/.
// The HMAC secret and private key are written to disk and never returned,
// logged, or sent over anything but the gateway's admin endpoint.
package infrastructure

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"govite/internal/mitra/domain"
)

const (
	partnersPath = "/admin/v1/partners"
	// regTimeout caps how long partner registration waits on the gateway.
	regTimeout = 30 * time.Second

	bundleDirPerm  = 0o700
	secretFilePerm = 0o600
)

// Config holds everything a Provisioner needs. All values come from the
// environment config; nothing is hardcoded.
type Config struct {
	BaseURL       string
	AdminUsername string
	AdminPassword string
	SecretsDir    string
	ChannelID     string
	Origin        string
	// HTTPClient overrides the default client (tests inject httptest's).
	HTTPClient  *http.Client
	AtomicWrite func(string, []byte) error
}

// Provisioner registers mitra partners with the gateway and writes credential
// bundles. The zero value is not usable; use NewProvisioner.
type Provisioner struct {
	baseURL     string
	adminUser   string
	adminPass   string
	secretsDir  string
	channelID   string
	origin      string
	http        *http.Client
	atomicWrite func(string, []byte) error
}

// NewProvisioner builds a provisioner. An empty base URL means the gateway is
// not configured; callers must treat Provision as unavailable.
func NewProvisioner(cfg Config) (*Provisioner, error) {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &Provisioner{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"), adminUser: cfg.AdminUsername,
		adminPass: cfg.AdminPassword, secretsDir: cfg.SecretsDir,
		channelID: cfg.ChannelID, origin: cfg.Origin, http: httpClient, atomicWrite: cfg.AtomicWrite,
	}, nil
}

// Provision registers kode with the gateway and writes its bundle. It returns
// domain.ErrSNAPNotConfigured when no base URL is set and
// domain.ErrBundleExists when <dir>/<kode> already exists.
func (p *Provisioner) Provision(ctx context.Context, kode string, in domain.ProvisionInput) (domain.ProvisionResult, error) {
	if p.baseURL == "" {
		return domain.ProvisionResult{}, domain.ErrSNAPNotConfigured
	}
	if kode == "" || filepath.Base(kode) != kode {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("kode mitra tidak valid")
	}
	if p.secretsDir == "" {
		return domain.ProvisionResult{}, domain.ErrSNAPNotConfigured
	}

	dir := filepath.Join(p.secretsDir, kode)
	if _, err := os.Stat(dir); err == nil {
		return domain.ProvisionResult{}, domain.ErrBundleExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("bundle dir: " + err.Error())
	}

	privateKey, publicKeyPEM, err := generateKeypair()
	if err != nil {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("generate keypair: " + err.Error())
	}

	partnerID, clientID, secret, err := p.registerPartner(ctx, kode, in, publicKeyPEM)
	if err != nil {
		return domain.ProvisionResult{}, err
	}

	if err := os.MkdirAll(dir, bundleDirPerm); err != nil {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("bundle dir: " + err.Error())
	}
	if err := os.Chmod(dir, bundleDirPerm); err != nil {
		_ = os.RemoveAll(dir)
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("bundle dir perm: " + err.Error())
	}
	partner := map[string]any{
		"partnerId":        partnerID,
		"clientId":         clientID,
		"partnerServiceId": in.PartnerServiceID,
		"vaPrefix":         in.VAPrefix,
	}
	partnerRaw, err := json.MarshalIndent(partner, "", "  ")
	if err != nil {
		return domain.ProvisionResult{}, &domain.ProvisionError{PartnerID: partnerID, Detail: "marshal partner.json: " + err.Error(), Cause: domain.ErrProvisionFailed}
	}
	write := p.atomicWrite
	if write == nil {
		write = writeAtomic
	}
	if err := write(filepath.Join(dir, "partner.json"), append(partnerRaw, '\n')); err != nil {
		return domain.ProvisionResult{}, &domain.ProvisionError{PartnerID: partnerID, Detail: "write partner.json: " + err.Error(), Cause: domain.ErrProvisionFailed}
	}
	if err := write(filepath.Join(dir, "hmac.secret"), secret); err != nil {
		return domain.ProvisionResult{}, &domain.ProvisionError{PartnerID: partnerID, Detail: "write hmac.secret: " + err.Error(), Cause: domain.ErrProvisionFailed}
	}
	privatePEM, err := encodePrivateKey(privateKey)
	if err != nil {
		return domain.ProvisionResult{}, &domain.ProvisionError{PartnerID: partnerID, Detail: "encode private key: " + err.Error(), Cause: domain.ErrProvisionFailed}
	}
	if err := write(filepath.Join(dir, "private.pem"), privatePEM); err != nil {
		return domain.ProvisionResult{}, &domain.ProvisionError{PartnerID: partnerID, Detail: "write private.pem: " + err.Error(), Cause: domain.ErrProvisionFailed}
	}
	if missing := incompleteBundleFile(dir); missing != "" {
		return domain.ProvisionResult{}, &domain.ProvisionError{
			PartnerID: partnerID,
			Detail:    fmt.Sprintf("bundle incomplete: %s missing or empty (partnerId %s)", missing, partnerID),
			Cause:     domain.ErrProvisionFailed,
		}
	}
	return domain.ProvisionResult{PartnerID: partnerID, ClientID: clientID}, nil
}

// incompleteBundleFile checks only metadata and size. It deliberately never
// reads bundle contents, especially hmac.secret or private.pem.
func incompleteBundleFile(dir string) string {
	for _, name := range []string{"partner.json", "hmac.secret", "private.pem"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.Size() == 0 {
			return name
		}
	}
	return ""
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".bundle-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(secretFilePerm); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func generateKeypair() (*rsa.PrivateKey, []byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, nil, err
	}
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	return key, publicPEM, nil
}

func encodePrivateKey(key *rsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

// registerPartner calls POST /admin/v1/partners with HTTP Basic auth and
// returns the gateway-assigned partnerId, the clientId, and the HMAC secret
// shown once at registration.
func (p *Provisioner) registerPartner(ctx context.Context, kode string, in domain.ProvisionInput, publicKeyPEM []byte) (string, string, []byte, error) {
	reqCtx, cancel := context.WithTimeout(ctx, regTimeout)
	defer cancel()

	body := map[string]any{
		"name":          in.Nama,
		"clientId":      kode,
		"rsaPublicKey":  string(publicKeyPEM),
		"callbackUrl":   in.CallbackURL,
		"rateLimitTier": in.RateLimitTier,
		"ipWhitelist":   strings.Join(in.IPWhitelist, ","),
		"branchCode":    in.BranchCode,
		"vaPrefix":      in.VAPrefix,
	}
	bodyRaw, err := json.Marshal(body)
	if err != nil {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("marshal register body: " + err.Error())
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, p.baseURL+partnersPath, bytes.NewReader(bodyRaw))
	if err != nil {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("build request: " + err.Error())
	}
	req.SetBasicAuth(p.adminUser, p.adminPass)
	req.Header.Set("Content-Type", "application/json")

	res, err := p.http.Do(req)
	if err != nil {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("register: " + err.Error())
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("read register response: " + err.Error())
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var gatewayErr struct {
			ResponseCode    string `json:"responseCode"`
			ResponseMessage string `json:"responseMessage"`
		}
		if json.Unmarshal(raw, &gatewayErr) == nil && (gatewayErr.ResponseCode != "" || gatewayErr.ResponseMessage != "") {
			slog.ErrorContext(reqCtx, "gateway partner registration rejected", "status", res.StatusCode, "responseCode", gatewayErr.ResponseCode, "responseMessage", gatewayErr.ResponseMessage)
			return "", "", nil, domain.ErrProvisionFailed.WithDetail(fmt.Sprintf("gateway responded %d (%s: %s)", res.StatusCode, gatewayErr.ResponseCode, gatewayErr.ResponseMessage))
		}
		return "", "", nil, domain.ErrProvisionFailed.WithDetail(fmt.Sprintf("gateway responded %d", res.StatusCode))
	}

	var reg struct {
		PartnerID    string `json:"partnerId"`
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := json.Unmarshal(raw, &reg); err != nil {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("parse register response: " + err.Error())
	}
	if reg.PartnerID == "" || reg.ClientID == "" || reg.ClientSecret == "" {
		return "", "", nil, domain.ErrProvisionFailed.WithDetail("gateway response missing partnerId/clientId/clientSecret")
	}
	return reg.PartnerID, reg.ClientID, []byte(reg.ClientSecret), nil
}
