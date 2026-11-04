// Captcha issues and verifies the login captcha: a server-rendered image the
// client sends back by id. Codes are hashed at rest, valid for two minutes and
// single use. Verification runs before any password check.
package application

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"govite/internal/auth/domain"
	"govite/internal/kernel"
	"govite/internal/policy"
)

// captchaAlphabet drops easily-confused characters (0/O/1/I/L).
const captchaAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const captchaLength = 5

// Captcha issues a new challenge and verifies answers.
type Captcha struct {
	Store  domain.CaptchaStore
	Image  domain.CaptchaImage
	Crypto domain.Crypto
	// Code overrides the random generator. Nil uses the secure default; tests
	// and the non-production e2e hook set it to a fixed code so a headless
	// browser can log in.
	Code func() (string, error)
}

// Issue returns a captcha id, its PNG data URL and the TTL in seconds.
// The plaintext code is never returned or logged.
func (c *Captcha) Issue(ctx context.Context) (domain.Captcha, error) {
	gen := c.Code
	if gen == nil {
		gen = func() (string, error) { return randomCode(captchaLength) }
	}
	code, err := gen()
	if err != nil {
		return domain.Captcha{}, err
	}
	id := kernel.NewID()
	ttl := policy.Security.CaptchaTTL
	if err := c.Store.Put(ctx, id, c.Crypto.HMAC(strings.ToUpper(code)), ttl); err != nil {
		return domain.Captcha{}, err
	}
	image, err := c.Image.Render(code)
	if err != nil {
		return domain.Captcha{}, err
	}
	return domain.Captcha{ID: id, Image: image, ExpiresIn: int(ttl.Seconds())}, nil
}

// Verify spends the captcha: the stored hash is removed in the same step, so a
// code cannot be replayed. Wrong, missing, expired and used ids all collapse to
// ErrInvalidCaptcha; a comparison mismatch is also ErrInvalidCaptcha.
func (c *Captcha) Verify(ctx context.Context, id, answer string) error {
	if id == "" || answer == "" {
		return domain.ErrInvalidCaptcha
	}
	hash, err := c.Store.Take(ctx, id)
	if errors.Is(err, kernel.ErrNotFound) {
		return domain.ErrInvalidCaptcha
	}
	if err != nil {
		return err
	}
	// Constant-time compare via the ciphers' HMAC: hash the answer the same way
	// and compare strings. HMAC output is fixed length, so plain == is fine here
	// and does not leak the code length.
	if c.Crypto.HMAC(strings.ToUpper(strings.TrimSpace(answer))) != hash {
		return domain.ErrInvalidCaptcha
	}
	return nil
}

// randomCode picks n characters from captchaAlphabet using crypto/rand.
func randomCode(n int) (string, error) {
	max := big.NewInt(int64(len(captchaAlphabet)))
	var b strings.Builder
	b.Grow(n)
	for range n {
		i, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("captcha code: %w", err)
		}
		b.WriteByte(captchaAlphabet[i.Int64()])
	}
	return b.String(), nil
}
