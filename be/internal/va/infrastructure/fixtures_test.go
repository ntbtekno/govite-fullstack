package infrastructure

// test-only fixtures. The HMAC secret and the RSA private key below are
// generated for these tests alone; they are NOT portal credentials and must
// never be reused anywhere real. The portal's own partnerId/clientId/HMAC
// secret/RSA key are not available to this repository.
//
// The key is a fixed 2048-bit RSA PEM so the token signature is deterministic
// across runs.

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

// testHMACSecret is a throwaway HMAC key used only by these tests.
const testHMACSecret = "test-only-hmac-secret-not-a-credential-0123456789"

// testPrivateKeyPEM returns a PEM-encoded RSA private key. newTestKey generates
// a fresh one; testKeyPEM is cached for tests that only need a stable key.
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

// writeTempSecret writes content to a temp file and returns its path.
func writeTempSecret(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp secret: %v", err)
	}
	return path
}

// testConfig builds a Config wired to a test-only per-mitra bundle.
func testConfig(t *testing.T, baseURL string, key *rsa.PrivateKey) Config {
	t.Helper()
	dir := t.TempDir()
	mitraDir := filepath.Join(dir, "010")
	if err := os.Mkdir(mitraDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mitraDir, "partner.json"), []byte(`{"partnerId":"578","clientId":"010"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mitraDir, "hmac.secret"), []byte(testHMACSecret), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mitraDir, "private.pem"), []byte(pemFor(key)), 0o600); err != nil {
		t.Fatal(err)
	}
	return Config{
		BaseURL: baseURL, SecretsDir: dir, ChannelID: "02030", Origin: "",
	}
}
