// Package infrastructure implements the mitra Provisioner: it generates the
// mitra's RSA-2048 keypair server-side only, registers the mitra with the
// gateway, and returns the credentials in memory. Credential persistence is
// handled by the service layer, which encrypts and stores them in the
// database. No credential files are read or written at runtime.
package infrastructure

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"govite/internal/mitra/domain"
)

const (
	partnersPath = "/admin/v1/partners"
	// regTimeout caps how long partner registration waits on the gateway.
	regTimeout = 30 * time.Second
)

// Config holds everything a Provisioner needs. All values come from the
// environment config; nothing is hardcoded.
type Config struct {
	BaseURL       string
	AdminUsername string
	AdminPassword string
	ChannelID     string
	Origin        string
	// HTTPClient overrides the default client (tests inject httptest's).
	HTTPClient *http.Client
}

// Provisioner registers mitra partners with the gateway and returns the
// credentials in memory. The zero value is not usable; use NewProvisioner.
type Provisioner struct {
	baseURL   string
	adminUser string
	adminPass string
	channelID string
	origin    string
	http      *http.Client
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
		adminPass: cfg.AdminPassword, channelID: cfg.ChannelID, origin: cfg.Origin, http: httpClient,
	}, nil
}

// Provision registers kode with the gateway and returns the credentials in
// memory. It returns domain.ErrSNAPNotConfigured when no base URL is set.
func (p *Provisioner) Provision(ctx context.Context, kode string, in domain.ProvisionInput) (domain.ProvisionResult, error) {
	if p.baseURL == "" {
		return domain.ProvisionResult{}, domain.ErrSNAPNotConfigured
	}
	if kode == "" || filepathBase(kode) != kode {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("kode mitra tidak valid")
	}

	privateKey, publicKeyPEM, err := generateKeypair()
	if err != nil {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("generate keypair: " + err.Error())
	}

	partnerID, clientID, secret, err := p.registerPartner(ctx, kode, in, publicKeyPEM)
	if err != nil {
		return domain.ProvisionResult{}, err
	}

	privateKeyPEM, err := encodePrivateKey(privateKey)
	if err != nil {
		return domain.ProvisionResult{}, domain.ErrProvisionFailed.WithDetail("encode private key: " + err.Error())
	}

	return domain.ProvisionResult{
		PartnerID:      partnerID,
		ClientID:       clientID,
		GatewayBaseURL: p.baseURL,
		ClientSecret:   secret,
		PrivateKeyPEM:  privateKeyPEM,
	}, nil
}

// RotateSecret calls the gateway's confirmed admin rotation endpoint. The
// response exposes clientSecret once; the caller immediately encrypts and
// stores it in the database and never logs or returns the value from this
// layer.
func (p *Provisioner) RotateSecret(ctx context.Context, _ string, partnerID string) (domain.RotateResult, error) {
	if p.baseURL == "" {
		return domain.RotateResult{}, domain.ErrSNAPNotConfigured
	}
	if partnerID == "" {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("rotate: partnerId kosong")
	}
	reqCtx, cancel := context.WithTimeout(ctx, regTimeout)
	defer cancel()
	path := "/admin/v1/partners/" + url.PathEscape(partnerID) + "/rotate-secret"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, p.baseURL+path, nil)
	if err != nil {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("build rotate request: " + err.Error())
	}
	req.SetBasicAuth(p.adminUser, p.adminPass)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.http.Do(req)
	if err != nil {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("rotate: " + err.Error())
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("read rotate response: " + err.Error())
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var gatewayErr struct {
			ResponseCode    string `json:"responseCode"`
			ResponseMessage string `json:"responseMessage"`
		}
		if json.Unmarshal(raw, &gatewayErr) == nil && (gatewayErr.ResponseCode != "" || gatewayErr.ResponseMessage != "") {
			slog.ErrorContext(reqCtx, "gateway partner secret rotation rejected", "status", res.StatusCode, "responseCode", gatewayErr.ResponseCode, "responseMessage", gatewayErr.ResponseMessage)
			return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail(fmt.Sprintf("gateway rotate responded %d (%s: %s)", res.StatusCode, gatewayErr.ResponseCode, gatewayErr.ResponseMessage))
		}
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail(fmt.Sprintf("gateway rotate responded %d", res.StatusCode))
	}
	var response struct {
		ClientSecret string `json:"clientSecret"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("parse rotate response: " + err.Error())
	}
	if response.ClientSecret == "" {
		return domain.RotateResult{}, domain.ErrProvisionFailed.WithDetail("gateway rotate response missing clientSecret")
	}
	return domain.RotateResult{ClientSecret: []byte(response.ClientSecret)}, nil
}

func filepathBase(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[i+1:]
		}
	}
	return p
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
