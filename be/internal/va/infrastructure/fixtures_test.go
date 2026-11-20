package infrastructure

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	vadomain "govite/internal/va/domain"
)

const testHMACSecret = "test-only-hmac-secret-not-a-credential-0123456789"

func newTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	return key
}

func pemFor(key *rsa.PrivateKey) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
}

func testConfig(t *testing.T, baseURL string, key *rsa.PrivateKey) Config {
	t.Helper()
	return Config{
		BaseURL:   baseURL,
		ChannelID: "02030",
		Loader: func(_ context.Context, kode string) (string, string, string, string, error) {
			if kode == "010" {
				return "578", "010", testHMACSecret, pemFor(key), nil
			}
			if kode == "011" {
				return "579", "011", testHMACSecret + "-011", pemFor(key), nil
			}
			return "", "", "", "", vadomain.ErrCredentialsUnavailable
		},
	}
}
