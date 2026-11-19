package infrastructure

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	vadomain "govite/internal/va/domain"
)

// fakeGateway is an httptest server that answers the token endpoint and the
// Create VA endpoint. No live gateway is ever contacted.
type fakeGateway struct {
	*httptest.Server
	tokenCalls  atomic.Int32
	createCalls atomic.Int32

	mu             sync.Mutex
	lastCreateBody []byte
	lastCreateHdr  http.Header

	// tokenExpiresIn and tokenCode let a test drive the token response.
	tokenExpiresIn int
	tokenCode      string

	// createStatus/createResponse drive the Create VA answer.
	createStatus   int
	createResponse string
	createRetryHdr string
}

func newFakeGateway(t *testing.T) *fakeGateway {
	t.Helper()
	f := &fakeGateway{tokenExpiresIn: 900, tokenCode: "2007300", createStatus: http.StatusOK}
	f.Server = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.Server.Close)
	return f
}

func (f *fakeGateway) handle(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case tokenPath:
		f.tokenCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"responseCode":    f.tokenCode,
			"responseMessage": "Successful",
			"accessToken":     "test-access-token",
			"tokenType":       "Bearer",
			"expiresIn":       f.tokenExpiresIn,
		})
	case createPath:
		f.createCalls.Add(1)
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.lastCreateBody = body
		f.lastCreateHdr = r.Header.Clone()
		f.mu.Unlock()
		if f.createRetryHdr != "" {
			w.Header().Set("Retry-After", f.createRetryHdr)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(f.createStatus)
		_, _ = w.Write([]byte(f.createResponse))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *fakeGateway) snapshot() ([]byte, http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.lastCreateBody...), f.lastCreateHdr.Clone()
}

// newClientFor builds a client against the fake server with the test fixtures.
func newClientFor(t *testing.T, f *fakeGateway, key *rsa.PrivateKey) *Client {
	t.Helper()
	cfg := testConfig(t, f.URL, key)
	cfg.Origin = "https://portal.example.test"
	c, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

// sampleRequest is a valid Create VA request for tests.
func sampleRequest() vadomain.CreateRequest {
	return vadomain.CreateRequest{
		PartnerServiceID:   "010",
		CustomerNo:         "20261023000001",
		VirtualAccountName: "Budi Santoso",
		TrxID:              "INV-2026-000001",
		Amount:             "150000.00",
		Currency:           "IDR",
		TrxType:            "F",
		ExpiredDate:        time.Date(2026, 12, 31, 23, 59, 59, 0, wita),
		Description:        "Tagihan SPP",
		Phone:              "+6281234567890",
	}
}

const successResponse = `{"responseCode":"2002700","responseMessage":"Successful","virtualAccountData":{"partnerServiceId":"     010","customerNo":"20261023000001","virtualAccountNo":"     0104120261023000001","virtualAccountName":"Budi Santoso","trxId":"INV-2026-000001","status":"ACTIVE","referenceNo":""}}`

// TestNewDisabledWhenBaseURLEmpty proves an empty BaseURL yields a nil client
// and no error: the feature is off and the server still boots.
func TestNewDisabledWhenBaseURLEmpty(t *testing.T) {
	c, err := New(Config{BaseURL: ""})
	if err != nil || c != nil {
		t.Fatalf("New(empty) = (%v, %v), want (nil, nil)", c, err)
	}
	if c.Enabled() {
		t.Fatal("nil client must report Enabled() == false")
	}
}

// TestNewFailsOnMissingSecretFile proves a configured gateway with an
// unreadable secret file fails construction (boot fails), not the first call.
func TestNewFailsOnMissingSecretFile(t *testing.T) {
	key := newTestKey(t)
	cfg := testConfig(t, "http://127.0.0.1:8080", key)
	cfg.HMACSecretFile = "/nonexistent/path/to/secret"
	if _, err := New(cfg); err == nil {
		t.Fatal("missing HMAC secret file must fail construction")
	}

	cfg = testConfig(t, "http://127.0.0.1:8080", key)
	cfg.RSAPrivateKeyFile = "/nonexistent/path/to/key"
	if _, err := New(cfg); err == nil {
		t.Fatal("missing RSA key file must fail construction")
	}

	// Empty secret file content fails too.
	cfg = testConfig(t, "http://127.0.0.1:8080", key)
	cfg.HMACSecretFile = writeTempSecret(t, "   \n")
	if _, err := New(cfg); err == nil {
		t.Fatal("blank HMAC secret file must fail construction")
	}

	// Invalid PEM fails too.
	cfg = testConfig(t, "http://127.0.0.1:8080", key)
	cfg.RSAPrivateKeyFile = writeTempSecret(t, "not a pem")
	if _, err := New(cfg); err == nil {
		t.Fatal("invalid RSA PEM must fail construction")
	}
}

// TestTokenSignatureIsSHA256WithRSA proves the token signature verifies against
// the matching public key over clientId|timestamp (PKCS#1 v1.5 + SHA-256,
// Base64).
func TestTokenSignatureIsSHA256WithRSA(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	c := newClientFor(t, f, key)
	c.now = func() string { return "2026-11-12T16:20:00+08:00" }

	sig, err := c.rsaTokenSignature(tokenStringToSign("010", "2026-11-12T16:20:00+08:00"))
	if err != nil {
		t.Fatalf("rsaTokenSignature: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		t.Fatalf("signature is not Base64: %v", err)
	}
	digest := sha256.Sum256([]byte("010|2026-11-12T16:20:00+08:00"))
	if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], raw); err != nil {
		t.Fatalf("signature does not verify: %v", err)
	}
}

// TestCreateVASuccessAndRawBody proves a 2002700/ACTIVE response succeeds, the
// official VA number is returned trimmed, and the bytes signed are the bytes
// sent (the hash over the received body matches the X-SIGNATURE input).
func TestCreateVASuccessAndRawBody(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.createResponse = successResponse
	c := newClientFor(t, f, key)
	c.now = func() string { return "2026-11-12T16:20:00+08:00" }

	res, err := c.CreateVA(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("CreateVA: %v", err)
	}
	if res.Status != "ACTIVE" || res.VirtualAccountNo != "0104120261023000001" {
		t.Fatalf("unexpected result: %+v", res)
	}

	body, hdr := f.snapshot()
	// Reconstruct the signature from the received bytes and compare with the
	// header: this proves the client signed exactly what it sent.
	access := strings.TrimPrefix(hdr.Get("Authorization"), "Bearer ")
	wantSig := hmacSHA512Base64(testHMACSecret, businessStringToSign("POST", createPath, access, bodyHash(minify(string(body))), hdr.Get("X-TIMESTAMP")))
	if hdr.Get("X-SIGNATURE") != wantSig {
		t.Fatalf("X-SIGNATURE does not match the sent body")
	}
	if hdr.Get("X-PARTNER-ID") != "578" {
		t.Fatalf("X-PARTNER-ID = %q, want partnerId 578", hdr.Get("X-PARTNER-ID"))
	}
	if hdr.Get("CHANNEL-ID") != "02030" {
		t.Fatalf("CHANNEL-ID = %q", hdr.Get("CHANNEL-ID"))
	}
	if hdr.Get("Origin") != "https://portal.example.test" {
		t.Fatalf("Origin = %q", hdr.Get("Origin"))
	}
	if len(hdr.Get("X-EXTERNAL-ID")) != 16 {
		t.Fatalf("X-EXTERNAL-ID = %q, want 16 chars", hdr.Get("X-EXTERNAL-ID"))
	}

	// Body shape: partnerServiceId padded to 8, virtualAccountNo padded to 19.
	var got map[string]any
	_ = json.Unmarshal(body, &got)
	if got["partnerServiceId"] != "     010" {
		t.Fatalf("partnerServiceId = %q", got["partnerServiceId"])
	}
	if got["virtualAccountNo"] != "     20261023000001" {
		t.Fatalf("virtualAccountNo = %q", got["virtualAccountNo"])
	}
}

// TestCreateVAOriginOmittedWhenEmpty proves an empty Origin sends no Origin
// header.
func TestCreateVAOriginOmittedWhenEmpty(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.createResponse = successResponse
	cfg := testConfig(t, f.URL, key) // Origin left empty
	c, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := c.CreateVA(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("CreateVA: %v", err)
	}
	_, hdr := f.snapshot()
	if _, ok := hdr["Origin"]; ok {
		t.Fatalf("Origin must be omitted when empty, got %q", hdr.Get("Origin"))
	}
}

// TestTokenCacheReuseAndRefresh proves the token is reused while valid and a new
// one is fetched when its remaining life drops below the 60s skew.
func TestTokenCacheReuseAndRefresh(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.createResponse = successResponse
	f.tokenExpiresIn = 900
	c := newClientFor(t, f, key)

	if _, err := c.CreateVA(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("first CreateVA: %v", err)
	}
	if _, err := c.CreateVA(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("second CreateVA: %v", err)
	}
	if got := f.tokenCalls.Load(); got != 1 {
		t.Fatalf("token calls = %d, want 1 (token must be reused)", got)
	}

	// Force expiry: pretend the cached token is within the skew window.
	c.mu.Lock()
	c.expiresAt = time.Now().Add(30 * time.Second)
	c.mu.Unlock()
	if _, err := c.CreateVA(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("third CreateVA: %v", err)
	}
	if got := f.tokenCalls.Load(); got != 2 {
		t.Fatalf("token calls = %d, want 2 (token must refresh inside the skew)", got)
	}
}

// TestTokenSignatureRejectedIsTyped proves 4017300 maps to the typed RSA error
// and is not retried blindly (one token call).
func TestTokenSignatureRejectedIsTyped(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.tokenCode = "4017300"
	c := newClientFor(t, f, key)

	_, err := c.CreateVA(context.Background(), sampleRequest())
	if got := vadomain.Code(err); got != vadomain.ErrTokenSignatureRejected.Code {
		t.Fatalf("err code = %q, want %q (err=%v)", got, vadomain.ErrTokenSignatureRejected.Code, err)
	}
	if got := f.tokenCalls.Load(); got != 1 {
		t.Fatalf("token calls = %d, want 1 (no blind retry)", got)
	}
	if got := f.createCalls.Load(); got != 0 {
		t.Fatalf("create calls = %d, want 0", got)
	}
}

// TestCreateErrorMapping drives every modelled responseCode and asserts the
// typed error; 2002700 without ACTIVE must NOT be success.
func TestCreateErrorMapping(t *testing.T) {
	key := newTestKey(t)
	cases := []struct {
		name string
		body string
		want string // expected portal error code
	}{
		{"4002701", `{"responseCode":"4002701","responseMessage":"Format field tidak valid"}`, vadomain.ErrFormatInvalid.Code},
		{"4002702", `{"responseCode":"4002702","responseMessage":"Mandatory"}`, vadomain.ErrMandatoryMissing.Code},
		{"4012700", `{"responseCode":"4012700","responseMessage":"Token partner mismatch"}`, vadomain.ErrPartnerTokenMismatch.Code},
		{"4012701", `{"responseCode":"4012701","responseMessage":"Signature"}`, vadomain.ErrBusinessSignature.Code},
		{"4092700", `{"responseCode":"4092700","responseMessage":"Paid"}`, vadomain.ErrAlreadyPaid.Code},
		{"4092701", `{"responseCode":"4092701","responseMessage":"Active"}`, vadomain.ErrAlreadyActive.Code},
		{"5002700", `{"responseCode":"5002700","responseMessage":"Server"}`, vadomain.ErrServer.Code},
		{"unknown", `{"responseCode":"9999999","responseMessage":"?"}`, vadomain.ErrUnexpectedCode.Code},
		{"success-not-active", `{"responseCode":"2002700","responseMessage":"Successful","virtualAccountData":{"status":"PENDING"}}`, vadomain.ErrUnexpectedCode.Code},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeGateway(t)
			f.createResponse = tc.body
			c := newClientFor(t, f, key)
			_, err := c.CreateVA(context.Background(), sampleRequest())
			if got := vadomain.Code(err); got != tc.want {
				t.Fatalf("err code = %q, want %q (err=%v)", got, tc.want, err)
			}
		})
	}
}

// TestRateLimitedIsRetryable proves a 429 becomes a retryable error.
func TestRateLimitedIsRetryable(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.createStatus = http.StatusTooManyRequests
	f.createRetryHdr = "5"
	f.createResponse = `{"responseCode":"4292700","responseMessage":"Too many"}`
	c := newClientFor(t, f, key)

	_, err := c.CreateVA(context.Background(), sampleRequest())
	var re *vadomain.RetryableError
	if !errors.As(err, &re) {
		t.Fatalf("err = %v, want a RetryableError", err)
	}
	if got := vadomain.Code(err); got != vadomain.ErrRateLimited.Code {
		t.Fatalf("retryable code = %q, want %q", got, vadomain.ErrRateLimited.Code)
	}
}

// TestServerErrorIsNotRetryableByDefault proves 5002700 is typed (the caller
// decides retry policy) and does not surface as a RetryableError here.
func TestServerErrorIsNotRetryable(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	f.createResponse = `{"responseCode":"5002700","responseMessage":"Server"}`
	c := newClientFor(t, f, key)
	_, err := c.CreateVA(context.Background(), sampleRequest())
	var re *vadomain.RetryableError
	if errors.As(err, &re) {
		t.Fatalf("5002700 must not be a RetryableError, got %v", err)
	}
}

// TestPEMVariantsAccepted proves both PKCS#1 and PKCS#8 PEM are read.
func TestPEMVariantsAccepted(t *testing.T) {
	key := newTestKey(t)
	pkcs8 := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8(t, key)})
	path := writeTempSecret(t, string(pkcs8))
	if _, err := readPrivateKey(path); err != nil {
		t.Fatalf("PKCS#8 key rejected: %v", err)
	}
}

func mustPKCS8(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	b, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal PKCS8: %v", err)
	}
	return b
}

// TestBaseURLTrailingSlashTrimmed proves a base URL with a trailing slash still
// joins to the exact path.
func TestBaseURLTrailingSlashTrimmed(t *testing.T) {
	key := newTestKey(t)
	f := newFakeGateway(t)
	cfg := testConfig(t, f.URL+"/", key)
	c, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := url.Parse(c.baseURL); err != nil {
		t.Fatalf("base URL unparsable: %v", err)
	}
	if strings.HasSuffix(c.baseURL, "/") {
		t.Fatalf("base URL keeps a trailing slash: %q", c.baseURL)
	}
}
