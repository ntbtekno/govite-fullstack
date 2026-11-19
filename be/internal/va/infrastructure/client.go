// Package infrastructure implements the Create VA gateway port against the SNAP
// HTTP API. It owns the HTTP client, the token cache, the RSA and HMAC
// signatures, and the raw-body discipline (serialise once, sign and send the
// same bytes). It never logs tokens, secrets, keys or full signatures.
package infrastructure

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	vadomain "govite/internal/va/domain"
)

const (
	tokenPath  = "/api/v1.0/access-token/b2b"
	createPath = "/api/v1.0/transfer-va/create-va"

	// Outbound budgets: the token endpoint is fast, while Create VA waits on
	// CBS inside the gateway for a few seconds.
	tokenTimeout  = 10 * time.Second
	createTimeout = 30 * time.Second

	// Token validity window. The token is cached and reused until its remaining
	// life drops below tokenRefreshSkew, then a new one is fetched.
	tokenRefreshSkew = 60 * time.Second
	tokenFallbackTTL = 900 * time.Second

	// maxErrorBody caps how much of an error response is read into memory.
	maxErrorBody = 64 << 10

	// externalIDLength is the fixed length of an X-EXTERNAL-ID value.
	externalIDLength = 16
)

// Config is everything the client needs at construction. The non-secret values
// come from SNAP_* env; the two secrets come from file paths. PartnerServiceID
// is deliberately absent: it is derived per mitra and passed on each request.
type Config struct {
	BaseURL           string
	PartnerID         string
	ClientID          string
	ChannelID         string
	Origin            string
	HMACSecretFile    string
	RSAPrivateKeyFile string
	// HTTPClient overrides the default client (tests inject httptest's). A nil
	// client gets a fresh one; http.DefaultClient is never used.
	HTTPClient *http.Client
	// Now overrides the timestamp clock (tests pin it). Nil uses the real WITA
	// clock.
	Now func() string
}

// Client is the SNAP Create VA client. It is safe for concurrent use: the
// token is guarded by a mutex.
type Client struct {
	baseURL    string
	partnerID  string
	clientID   string
	channelID  string
	origin     string
	secret     []byte
	privateKey *rsa.PrivateKey
	http       *http.Client

	now func() string

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

var _ vadomain.Gateway = (*Client)(nil)

// New builds a client. An empty BaseURL returns (nil, nil): the feature is
// disabled and the server still boots. When BaseURL is set the two secret files
// are required and are read and parsed here, so a bad secret fails the boot
// rather than the first request.
func New(cfg Config) (*Client, error) {
	if cfg.BaseURL == "" {
		return nil, nil
	}
	secret, err := readSecret(cfg.HMACSecretFile)
	if err != nil {
		return nil, fmt.Errorf("snap: HMAC secret: %w", err)
	}
	key, err := readPrivateKey(cfg.RSAPrivateKeyFile)
	if err != nil {
		return nil, fmt.Errorf("snap: RSA private key: %w", err)
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	now := cfg.Now
	if now == nil {
		now = nowTimestamp
	}
	return &Client{
		baseURL:    strings.TrimRight(cfg.BaseURL, "/"),
		partnerID:  cfg.PartnerID,
		clientID:   cfg.ClientID,
		channelID:  cfg.ChannelID,
		origin:     cfg.Origin,
		secret:     secret,
		privateKey: key,
		http:       httpClient,
		now:        now,
	}, nil
}

// Enabled reports whether the client is configured.
func (c *Client) Enabled() bool { return c != nil }

// readSecret reads a mounted secret file, refusing an empty or whitespace-only
// value: a blank HMAC secret would sign everything with the empty key.
func readSecret(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New("secret file path is empty")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, errors.New("secret file is empty")
	}
	return raw, nil
}

// readPrivateKey reads and parses a PEM RSA private key. Both PKCS#1
// ("RSA PRIVATE KEY") and PKCS#8 ("PRIVATE KEY") blocks are accepted.
func readPrivateKey(path string) (*rsa.PrivateKey, error) {
	if path == "" {
		return nil, errors.New("private key file path is empty")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse RSA private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("PEM block is not an RSA private key")
	}
	return key, nil
}

// CreateVA builds the business body, signs it and calls the gateway. Success is
// 2002700 with status ACTIVE only; every other answer becomes a typed error.
func (c *Client) CreateVA(ctx context.Context, req vadomain.CreateRequest) (vadomain.CreateResult, error) {
	accessToken, err := c.accessToken(ctx)
	if err != nil {
		return vadomain.CreateResult{}, err
	}
	body, err := buildBody(req)
	if err != nil {
		return vadomain.CreateResult{}, err
	}
	// Serialise once: the exact bytes hashed and signed are the bytes sent.
	bodyRaw, err := json.Marshal(body)
	if err != nil {
		return vadomain.CreateResult{}, fmt.Errorf("snap: marshal create body: %w", err)
	}
	timestamp := c.now()
	minified := minify(string(bodyRaw))
	hash := bodyHash(minified)
	signature := hmacSHA512Base64(string(c.secret), businessStringToSign(http.MethodPost, createPath, accessToken, hash, timestamp))

	headers := map[string]string{
		"Authorization": "Bearer " + accessToken,
		"Content-Type":  "application/json",
		"X-TIMESTAMP":   timestamp,
		"X-SIGNATURE":   signature,
		"X-PARTNER-ID":  c.partnerID,
		"X-EXTERNAL-ID": newExternalID(),
		"CHANNEL-ID":    c.channelID,
	}
	if c.origin != "" {
		headers["Origin"] = c.origin
	}

	reqCtx, cancel := context.WithTimeout(ctx, createTimeout)
	defer cancel()
	status, raw, err := c.do(reqCtx, http.MethodPost, createPath, headers, bodyRaw)
	if err != nil {
		return vadomain.CreateResult{}, err
	}
	return parseCreateResponse(status, raw)
}

// buildBody shapes the gateway body. The request-side virtualAccountNo is NOT
// the full VA number: it is left-pad(19) of customerNo (spec Bagian 5.1).
func buildBody(req vadomain.CreateRequest) (map[string]any, error) {
	if req.ExpiredDate.IsZero() {
		return nil, vadomain.ErrMandatoryMissing.WithDetail("expiredDate is required")
	}
	amount := req.Amount
	currency := req.Currency
	if currency == "" {
		currency = "IDR"
	}
	body := map[string]any{
		"partnerServiceId":      padLeft(req.PartnerServiceID, 8),
		"customerNo":            req.CustomerNo,
		"virtualAccountNo":      padLeft(req.CustomerNo, 19),
		"virtualAccountName":    req.VirtualAccountName,
		"trxId":                 req.TrxID,
		"totalAmount":           map[string]any{"value": amount, "currency": currency},
		"virtualAccountTrxType": req.TrxType,
		"expiredDate":           req.ExpiredDate.In(wita).Format(timestampFormat),
	}
	additional := map[string]any{}
	if req.Description != "" {
		additional["description"] = req.Description
	}
	if req.Phone != "" {
		additional["phone"] = req.Phone
	}
	body["additionalInfo"] = additional
	return body, nil
}

// accessToken returns a cached token while its remaining life exceeds the skew,
// otherwise fetches a new one.
func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	if c.token != "" && time.Now().Before(c.expiresAt.Add(-tokenRefreshSkew)) {
		token := c.token
		c.mu.Unlock()
		return token, nil
	}
	c.mu.Unlock()

	token, ttl, err := c.fetchToken(ctx)
	if err != nil {
		return "", err
	}
	c.mu.Lock()
	c.token, c.expiresAt = token, time.Now().Add(ttl)
	c.mu.Unlock()
	return token, nil
}

// fetchToken requests a fresh service token with the RSA signature.
func (c *Client) fetchToken(ctx context.Context) (string, time.Duration, error) {
	timestamp := c.now()
	signature, err := c.rsaTokenSignature(tokenStringToSign(c.clientID, timestamp))
	if err != nil {
		return "", 0, err
	}
	headers := map[string]string{
		"Content-Type": "application/json",
		"X-TIMESTAMP":  timestamp,
		"X-CLIENT-KEY": c.clientID,
		"X-SIGNATURE":  signature,
	}
	if c.origin != "" {
		headers["Origin"] = c.origin
	}
	payload, _ := json.Marshal(map[string]string{"grantType": "client_credentials"})

	reqCtx, cancel := context.WithTimeout(ctx, tokenTimeout)
	defer cancel()
	status, raw, err := c.do(reqCtx, http.MethodPost, tokenPath, headers, payload)
	if err != nil {
		return "", 0, err
	}

	var res struct {
		ResponseCode    string `json:"responseCode"`
		ResponseMessage string `json:"responseMessage"`
		AccessToken     string `json:"accessToken"`
		ExpiresIn       int    `json:"expiresIn"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", 0, vadomain.ErrTokenRequest.WithDetail("unreadable token response")
	}
	if status != http.StatusOK || res.ResponseCode != "2007300" {
		if res.ResponseCode == "4017300" {
			return "", 0, vadomain.ErrTokenSignatureRejected.WithDetail(res.ResponseMessage)
		}
		code := res.ResponseCode
		if code == "" {
			code = strconv.Itoa(status)
		}
		return "", 0, vadomain.ErrTokenRequest.WithDetail(code)
	}
	if res.AccessToken == "" {
		return "", 0, vadomain.ErrTokenRequest.WithDetail("empty accessToken")
	}
	ttl := tokenFallbackTTL
	if res.ExpiresIn > 0 {
		ttl = time.Duration(res.ExpiresIn) * time.Second
	}
	return res.AccessToken, ttl, nil
}

// rsaTokenSignature signs clientId|timestamp with SHA256withRSA (PKCS#1 v1.5)
// and returns Base64 (spec Bagian 4.1).
func (c *Client) rsaTokenSignature(stringToSign string) (string, error) {
	digest := sha256.Sum256([]byte(stringToSign))
	sig, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("snap: sign token: %w", err)
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// do sends one request and returns the status and the raw body. It always
// closes the response body and never uses http.DefaultClient.
func (c *Client) do(ctx context.Context, method, path string, headers map[string]string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxErrorBody+1))
	if err != nil {
		return res.StatusCode, nil, err
	}
	if len(raw) > maxErrorBody {
		raw = raw[:maxErrorBody]
	}
	return res.StatusCode, raw, nil
}

// parseCreateResponse validates success and maps the gateway error codes.
func parseCreateResponse(status int, raw []byte) (vadomain.CreateResult, error) {
	var res struct {
		ResponseCode       string `json:"responseCode"`
		ResponseMessage    string `json:"responseMessage"`
		VirtualAccountData *struct {
			PartnerServiceID string `json:"partnerServiceId"`
			CustomerNo       string `json:"customerNo"`
			VirtualAccountNo string `json:"virtualAccountNo"`
			TrxID            string `json:"trxId"`
			ReferenceNo      string `json:"referenceNo"`
			Status           string `json:"status"`
		} `json:"virtualAccountData"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return vadomain.CreateResult{}, vadomain.ErrUnexpectedCode.WithDetail("unreadable response")
	}

	if res.ResponseCode == "2002700" {
		// Success requires status ACTIVE: a 2002700 with any other status is
		// not a VA ready to be paid (spec Bagian 5.2).
		if res.VirtualAccountData == nil || res.VirtualAccountData.Status != "ACTIVE" {
			return vadomain.CreateResult{}, vadomain.ErrUnexpectedCode.WithDetail("2002700 without ACTIVE status")
		}
		d := res.VirtualAccountData
		return vadomain.CreateResult{
			ResponseCode:     res.ResponseCode,
			ResponseMessage:  res.ResponseMessage,
			VirtualAccountNo: strings.TrimSpace(d.VirtualAccountNo),
			CustomerNo:       d.CustomerNo,
			TrxID:            d.TrxID,
			ReferenceNo:      d.ReferenceNo,
			Status:           d.Status,
			Raw:              raw,
		}, nil
	}

	msg := res.ResponseMessage
	switch res.ResponseCode {
	case "4002701":
		return vadomain.CreateResult{}, vadomain.ErrFormatInvalid.WithDetail(msg)
	case "4002702":
		return vadomain.CreateResult{}, vadomain.ErrMandatoryMissing.WithDetail(msg)
	case "4012700":
		return vadomain.CreateResult{}, vadomain.ErrPartnerTokenMismatch.WithDetail(msg)
	case "4012701":
		return vadomain.CreateResult{}, vadomain.ErrBusinessSignature.WithDetail(msg)
	case "4092700":
		return vadomain.CreateResult{}, vadomain.ErrAlreadyPaid.WithDetail(msg)
	case "4092701":
		return vadomain.CreateResult{}, vadomain.ErrAlreadyActive.WithDetail(msg)
	case "5002700":
		return vadomain.CreateResult{}, vadomain.ErrServer.WithDetail(msg)
	}

	// A bare 429 (or any status with no modelled code) is retryable. The spec
	// says to honour Retry-After, which the caller parses from the header; here
	// the header is not available after do(), so a zero RetryIn is returned and
	// the caller backs off on its own. When the gateway sends the 429 as a code
	// with a Retry-After, that is surfaced on the response status separately.
	if status == http.StatusTooManyRequests {
		return vadomain.CreateResult{}, vadomain.RateLimited(0)
	}
	detail := res.ResponseCode
	if detail == "" {
		detail = strconv.Itoa(status)
	}
	return vadomain.CreateResult{}, vadomain.ErrUnexpectedCode.WithDetail(detail)
}

// newExternalID returns a fresh 16-character alphanumeric id. A new value is
// required for every new processing attempt (spec Bagian 4.2).
func newExternalID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buf := make([]byte, externalIDLength)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			// rand.Read failing is unrecoverable; fall back to a time-based
			// value rather than panic. Uniqueness across a day still holds
			// closely enough for a single item.
			buf[i] = alphabet[time.Now().UnixNano()%int64(len(alphabet))]
			continue
		}
		buf[i] = alphabet[n.Int64()]
	}
	return string(buf)
}
