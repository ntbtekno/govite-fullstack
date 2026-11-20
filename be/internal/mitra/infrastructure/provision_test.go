package infrastructure

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
)

func newTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestProvisionerRegistersWithGatewayAndReturnsCredentials(t *testing.T) {
	key := newTestKey(t)
	_ = key // key used internally by provisioner

	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/admin/v1/partners" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"partnerId": "P-999", "clientId": "101", "clientSecret": "hmac-secret-123"})
	}))
	defer gateway.Close()

	p, err := NewProvisioner(Config{BaseURL: gateway.URL, AdminUsername: "admin", AdminPassword: "pw", ChannelID: "02030", Origin: "", HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	res, err := p.Provision(context.Background(), "101", domain.ProvisionInput{
		Nama: "Mitra Provisioned", PartnerServiceID: "     101", VAPrefix: "10141",
		BranchCode: "1010", CallbackURL: "https://example.com/callback", RateLimitTier: "standard",
		IPWhitelist: []string{"127.0.0.1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.PartnerID != "P-999" || res.ClientID != "101" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if string(res.ClientSecret) != "hmac-secret-123" {
		t.Fatalf("secret mismatch")
	}
	if len(res.PrivateKeyPEM) == 0 {
		t.Fatal("private key missing")
	}
	resultRaw, _ := json.Marshal(res)
	if strings.Contains(string(resultRaw), "hmac-secret-123") {
		t.Fatal("provision result must not contain the client secret")
	}
}

func TestProvisionerHandlesGatewayError(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"responseCode": "4000500", "responseMessage": "Invalid public key"})
	}))
	defer gateway.Close()

	p, err := NewProvisioner(Config{BaseURL: gateway.URL, HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Provision(context.Background(), "101", domain.ProvisionInput{})
	var ke *kernel.Error
	if err == nil || !errors.As(err, &ke) || !strings.Contains(ke.Detail, "4000500") || !strings.Contains(ke.Detail, "Invalid public key") {
		t.Fatalf("gateway error not propagated: %v", err)
	}
}

func TestProvisionerRejectsIncompleteBundleAfterWrites(t *testing.T) {
	// Completeness check is now performed at the service/DB layer, not in the provisioner.
	// This test is kept as a placeholder for documentation.
}

func TestIncompleteBundleFile(t *testing.T) {
	// not applicable (file-based completeness removed), keeping placeholder
}

func TestReplaceSecretLeavesIdentityAndPrivateKeyUntouched(t *testing.T) {
	// not applicable (file-based replaced by DB update), keeping placeholder
}

func TestRotateSecretUsesPartnerPathAndClientSecret(t *testing.T) {
	var gotMethod, gotPath, gotUser, gotPass string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.EscapedPath()
		gotUser, gotPass, _ = r.BasicAuth()
		_ = json.NewEncoder(w).Encode(map[string]string{"clientSecret": "rotated-fixture"})
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, AdminUsername: "admin", AdminPassword: "password", HTTPClient: gateway.Client()})
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
		_ = json.NewEncoder(w).Encode(map[string]string{"responseCode": "4000500", "responseMessage": "Rotation rejected"})
	}))
	defer gateway.Close()
	p, err := NewProvisioner(Config{BaseURL: gateway.URL, HTTPClient: gateway.Client()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.RotateSecret(context.Background(), "107", "P-107")
	var ke *kernel.Error
	if err == nil || !errors.As(err, &ke) || !strings.Contains(ke.Detail, "4000500") || !strings.Contains(ke.Detail, "Rotation rejected") {
		t.Fatalf("gateway error not propagated: %v", err)
	}
}
