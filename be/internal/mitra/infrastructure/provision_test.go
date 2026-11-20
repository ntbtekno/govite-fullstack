package infrastructure

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
)

func TestProvisionerWritesBundleAndRegisters(t *testing.T) {
	secretsDir := t.TempDir()
	var received struct {
		BasicUser   string
		BasicPass   string
		Body        map[string]any
		AuthHeader  string
		ContentType string
	}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/partners" {
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		received.AuthHeader = r.Header.Get("Authorization")
		received.ContentType = r.Header.Get("Content-Type")
		u, p, ok := r.BasicAuth()
		received.BasicUser, received.BasicPass = u, p
		if !ok {
			t.Errorf("missing basic auth")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := json.Unmarshal(raw, &received.Body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"partnerId":    "P-999",
			"clientId":     received.Body["clientId"],
			"clientSecret": "hmac-secret-123",
		})
	}))
	defer gateway.Close()

	p, err := NewProvisioner(Config{
		BaseURL:       gateway.URL,
		AdminUsername: "admin",
		AdminPassword: "pw",
		SecretsDir:    secretsDir,
		ChannelID:     "02030",
		HTTPClient:    gateway.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}

	res, err := p.Provision(context.Background(), "101", domain.ProvisionInput{
		Nama:             "Mitra Satu",
		PartnerServiceID: "     101",
		VAPrefix:         "10141",
		BranchCode:       "0101",
		CallbackURL:      "https://mitra.example.com/cb",
		RateLimitTier:    "standard",
		IPWhitelist:      []string{"127.0.0.1"},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if res.PartnerID != "P-999" || res.ClientID != "101" {
		t.Fatalf("unexpected result: %+v", res)
	}
	resultRaw, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(resultRaw), "hmac-secret-123") {
		t.Fatal("provision result must not contain the client secret")
	}

	if received.BasicUser != "admin" || received.BasicPass != "pw" {
		t.Fatalf("basic auth not forwarded: %q %q", received.BasicUser, received.BasicPass)
	}
	if !strings.HasPrefix(received.AuthHeader, "Basic ") {
		t.Fatalf("missing Basic auth header: %q", received.AuthHeader)
	}
	body, ok := received.Body["rsaPublicKey"].(string)
	if !ok || !strings.HasPrefix(body, "-----BEGIN PUBLIC KEY-----") {
		t.Fatalf("rsaPublicKey missing or not PEM: %v", received.Body["rsaPublicKey"])
	}
	if received.Body["clientId"] != "101" || received.Body["vaPrefix"] != "10141" {
		t.Fatalf("unexpected body fields: %+v", received.Body)
	}
	if whitelist, _ := received.Body["ipWhitelist"].(string); whitelist != "127.0.0.1" {
		t.Fatalf("ipWhitelist not forwarded: %+v", received.Body["ipWhitelist"])
	}
	if _, ok := received.Body["ipWhitelist"].([]any); ok {
		t.Fatal("ipWhitelist must not be a JSON array")
	}

	dir := filepath.Join(secretsDir, "101")
	partnerRaw, err := os.ReadFile(filepath.Join(dir, "partner.json"))
	if err != nil {
		t.Fatalf("partner.json not written: %v", err)
	}
	var partner struct {
		PartnerID        string `json:"partnerId"`
		ClientID         string `json:"clientId"`
		PartnerServiceID string `json:"partnerServiceId"`
		VAPrefix         string `json:"vaPrefix"`
	}
	if err := json.Unmarshal(partnerRaw, &partner); err != nil {
		t.Fatalf("partner.json unreadable: %v", err)
	}
	if partner.PartnerID != "P-999" || partner.ClientID != "101" || partner.PartnerServiceID != "     101" || partner.VAPrefix != "10141" {
		t.Fatalf("partner.json content wrong: %s", partnerRaw)
	}

	secret, err := os.ReadFile(filepath.Join(dir, "hmac.secret"))
	if err != nil {
		t.Fatalf("hmac.secret not written: %v", err)
	}
	if string(secret) != "hmac-secret-123" {
		t.Fatalf("hmac.secret content wrong: %q", secret)
	}
	if mode, err := filePerm(filepath.Join(dir, "hmac.secret")); err != nil || mode&0o077 != 0 {
		t.Fatalf("hmac.secret perm %v, want 0600", mode)
	}

	privateRaw, err := os.ReadFile(filepath.Join(dir, "private.pem"))
	if err != nil {
		t.Fatalf("private.pem not written: %v", err)
	}
	block, _ := pem.Decode(privateRaw)
	if block == nil || block.Type != "PRIVATE KEY" {
		t.Fatalf("private.pem is not a PKCS#8 PEM private key")
	}
	if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err != nil {
		t.Fatalf("private.pem not parseable: %v", err)
	}
	if mode, err := filePerm(filepath.Join(dir, "private.pem")); err != nil || mode&0o077 != 0 {
		t.Fatalf("private.pem perm %v, want 0600", mode)
	}

	// The M2 loader shape (partnerId + clientId) still parses fine with the
	// extended partner.json.
	var loaderShape struct {
		PartnerID string `json:"partnerId"`
		ClientID  string `json:"clientId"`
	}
	if err := json.Unmarshal(partnerRaw, &loaderShape); err != nil {
		t.Fatalf("M2 loader shape must tolerate extended partner.json: %v", err)
	}

	// The registered public key must match the private key in the bundle.
	bodyMap, _ := received.Body["rsaPublicKey"].(string)
	pubBlock, _ := pem.Decode([]byte(bodyMap))
	pub, err := x509.ParsePKIXPublicKey(pubBlock.Bytes)
	if err != nil {
		t.Fatalf("public key parse: %v", err)
	}
	priv, _ := x509.ParsePKCS8PrivateKey(block.Bytes)
	if fmt.Sprint(pub) != fmt.Sprint(&priv.(*rsa.PrivateKey).PublicKey) {
		t.Fatal("registered public key does not match bundled private key")
	}
}

func TestProvisionerIncludesGatewayError(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"responseCode":"4000500","responseMessage":"Malformed request body"}`)
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, SecretsDir: t.TempDir(), HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Provision(context.Background(), "104", domain.ProvisionInput{CallbackURL: "https://example.com/callback"})
	var ke *kernel.Error
	if err == nil || !errors.As(err, &ke) || !strings.Contains(ke.Detail, "4000500") || !strings.Contains(ke.Detail, "Malformed request body") {
		t.Fatalf("gateway error not exposed: %v", err)
	}
}

func TestProvisionerSendsEmptyWhitelistAsString(t *testing.T) {
	var body map[string]any
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]string{"partnerId": "P", "clientId": "105", "clientSecret": "secret"})
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, SecretsDir: t.TempDir(), HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Provision(context.Background(), "105", domain.ProvisionInput{CallbackURL: "https://example.com/callback"}); err != nil {
		t.Fatal(err)
	}
	if value, ok := body["ipWhitelist"].(string); !ok || value != "" {
		t.Fatalf("ipWhitelist = %#v, want empty string", body["ipWhitelist"])
	}
}

func TestProvisionerRejectsMisconfigAndExistingBundle(t *testing.T) {
	secretsDir := t.TempDir()

	// No base URL: provisioning unavailable.
	p, err := ConfigIf(secretsDir, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Provision(context.Background(), "101", domain.ProvisionInput{}); err == nil {
		t.Fatal("expected ErrSNAPNotConfigured without base URL")
	}

	// Existing bundle dir is rejected before any gateway call.
	if err := os.MkdirAll(filepath.Join(secretsDir, "007"), 0o700); err != nil {
		t.Fatal(err)
	}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("gateway must not be called when bundle already exists")
	}))
	defer gateway.Close()
	p2, err := ConfigIf(secretsDir, gateway.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p2.Provision(context.Background(), "007", domain.ProvisionInput{}); err == nil {
		t.Fatal("expected ErrBundleExists for existing bundle dir")
	}

	// Gateway failure propagates as provisioning failure.
	gateway2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer gateway2.Close()
	p3, err := ConfigIf(secretsDir, gateway2.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p3.Provision(context.Background(), "102", domain.ProvisionInput{}); err == nil {
		t.Fatal("expected error when gateway rejects registration")
	}
}

func TestProvisionerBundleWriteFailureKeepsPartnerIDAndNoPartialBundle(t *testing.T) {
	secretsDir := t.TempDir()
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"partnerId": "P-REPAIR", "clientId": "103", "clientSecret": "one-time"})
	}))
	defer gateway.Close()

	p, err := NewProvisioner(Config{
		BaseURL: gateway.URL, SecretsDir: secretsDir, AdminUsername: "a", AdminPassword: "b",
		HTTPClient:  gateway.Client(),
		AtomicWrite: func(path string, data []byte) error { return fmt.Errorf("disk full") },
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Provision(context.Background(), "103", domain.ProvisionInput{PartnerServiceID: "     103", VAPrefix: "10341"})
	var pe *domain.ProvisionError
	if !errors.As(err, &pe) || pe.PartnerID != "P-REPAIR" || pe.Detail != "write partner.json: disk full" {
		t.Fatalf("expected repair evidence with exact error, got %T %v", err, err)
	}
	if _, statErr := os.Stat(filepath.Join(secretsDir, "103", "partner.json")); !os.IsNotExist(statErr) {
		t.Fatalf("partial bundle must not remain, stat error=%v", statErr)
	}
}

func TestIncompleteBundleFile(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"partner.json", "hmac.secret", "private.pem"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if got := incompleteBundleFile(dir); got != "" {
		t.Fatalf("complete bundle reported incomplete: %q", got)
	}
	if err := os.Truncate(filepath.Join(dir, "hmac.secret"), 0); err != nil {
		t.Fatal(err)
	}
	if got := incompleteBundleFile(dir); got != "hmac.secret" {
		t.Fatalf("empty hmac.secret reported as %q", got)
	}
}

func TestProvisionerRejectsIncompleteBundleAfterWrites(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"partnerId": "P-COMPLETE", "clientId": "106", "clientSecret": strings.Repeat("x", 8)})
	}))
	defer gateway.Close()
	dir := t.TempDir()
	p, err := NewProvisioner(Config{
		BaseURL: gateway.URL, SecretsDir: dir, HTTPClient: gateway.Client(),
		AtomicWrite: func(path string, data []byte) error {
			if filepath.Base(path) == "hmac.secret" {
				data = nil
			}
			return os.WriteFile(path, data, 0o600)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Provision(context.Background(), "106", domain.ProvisionInput{})
	var pe *domain.ProvisionError
	if !errors.As(err, &pe) || pe.PartnerID != "P-COMPLETE" || !strings.Contains(pe.Detail, "hmac.secret") {
		t.Fatalf("expected incomplete bundle error, got %T %v", err, err)
	}
}

func TestReplaceSecretLeavesIdentityAndPrivateKeyUntouched(t *testing.T) {
	dir := t.TempDir()
	bundle := filepath.Join(dir, "107")
	if err := os.Mkdir(bundle, 0o700); err != nil {
		t.Fatal(err)
	}
	partner := []byte(`{"partnerId":"P-107","clientId":"107"}`)
	privateKey := []byte("private-key-fixture")
	for name, content := range map[string][]byte{
		"partner.json": partner, "hmac.secret": []byte("old-fixture"), "private.pem": privateKey,
	} {
		if err := os.WriteFile(filepath.Join(bundle, name), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	p, err := NewProvisioner(Config{SecretsDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if err := p.ReplaceSecret("107", []byte("new-fixture")); err != nil {
		t.Fatal(err)
	}
	gotPartner, _ := os.ReadFile(filepath.Join(bundle, "partner.json"))
	gotPrivate, _ := os.ReadFile(filepath.Join(bundle, "private.pem"))
	gotSecret, _ := os.ReadFile(filepath.Join(bundle, "hmac.secret"))
	if !bytes.Equal(gotPartner, partner) || !bytes.Equal(gotPrivate, privateKey) || string(gotSecret) != "new-fixture" {
		t.Fatal("rotation changed identity/private key or failed to replace secret")
	}
	if mode, _ := filePerm(filepath.Join(bundle, "hmac.secret")); mode&0o077 != 0 {
		t.Fatalf("hmac.secret permission = %v", mode)
	}
}

func TestRotateSecretUsesPartnerPathAndClientSecret(t *testing.T) {
	var gotMethod, gotPath, gotUser, gotPass string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.EscapedPath()
		gotUser, gotPass, _ = r.BasicAuth()
		_ = json.NewEncoder(w).Encode(map[string]string{"clientSecret": "rotated-fixture"})
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, SecretsDir: t.TempDir(), AdminUsername: "admin", AdminPassword: "password", HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	result, err := p.RotateSecret(context.Background(), "107", "partner/107")
	if err != nil {
		t.Fatal(err)
	}
	if gotMethod != http.MethodPost || gotPath != "/admin/v1/partners/partner%2F107/rotate-secret" || gotUser != "admin" || gotPass != "password" {
		t.Fatalf("unexpected rotate request: %s %s %s/%s", gotMethod, gotPath, gotUser, gotPass)
	}
	if string(result.ClientSecret) != "rotated-fixture" {
		t.Fatalf("unexpected rotated secret result")
	}
}

func TestRotateSecretPropagatesGatewayError(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"responseCode":"4000500","responseMessage":"Rotation rejected"}`)
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, SecretsDir: t.TempDir(), HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.RotateSecret(context.Background(), "107", "P-107")
	var ke *kernel.Error
	if err == nil || !errors.As(err, &ke) || !strings.Contains(ke.Detail, "4000500") || !strings.Contains(ke.Detail, "Rotation rejected") {
		t.Fatalf("gateway error not propagated: %v", err)
	}
}

func filePerm(path string) (os.FileMode, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Mode().Perm(), nil
}

// ConfigIf is a test-only helper: NewProvisioner with a single base URL.
func ConfigIf(secretsDir, baseURL string) (*Provisioner, error) {
	return NewProvisioner(Config{BaseURL: baseURL, SecretsDir: secretsDir, AdminUsername: "a", AdminPassword: "b"})
}
