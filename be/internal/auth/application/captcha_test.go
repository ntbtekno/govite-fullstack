package application

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"govite/internal/auth/domain"
	"govite/internal/auth/infrastructure"
	"govite/internal/platform/crypto"
)

// testImage encodes the code so the test can solve it without OCR.
type testImage struct{}

func (testImage) Render(code string) (string, error) {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(code)), nil
}

func solve(t *testing.T, img string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(img, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func newCaptcha(store domain.CaptchaStore) *Captcha {
	return &Captcha{
		Store:  store,
		Image:  testImage{},
		Crypto: infrastructure.Crypto{Keys: crypto.NewKeys(strings.Repeat("s", 32), strings.Repeat("p", 16))},
	}
}

func TestCaptchaIssueAndVerify(t *testing.T) {
	ctx := context.Background()
	c := newCaptcha(infrastructure.NewCaptchaMemory())

	cap, err := c.Issue(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cap.ID == "" || cap.ExpiresIn != 120 || !strings.HasPrefix(cap.Image, "data:image/png;base64,") {
		t.Fatalf("bad captcha: %+v", cap)
	}
	code := solve(t, cap.Image)
	if len(code) != 5 {
		t.Fatalf("code length %d", len(code))
	}

	// Case-insensitive, whitespace-trimmed answer passes.
	if err := c.Verify(ctx, cap.ID, " "+strings.ToLower(code)+" "); err != nil {
		t.Fatalf("case-insensitive verify: %v", err)
	}
	// Single use: the same id fails the second time.
	if err := c.Verify(ctx, cap.ID, code); err != domain.ErrInvalidCaptcha {
		t.Fatalf("reuse should fail, got %v", err)
	}
}

func TestCaptchaWrongAndMissing(t *testing.T) {
	ctx := context.Background()
	c := newCaptcha(infrastructure.NewCaptchaMemory())

	if err := c.Verify(ctx, "", "ABCDE"); err != domain.ErrInvalidCaptcha {
		t.Fatalf("missing id: %v", err)
	}
	cap, _ := c.Issue(ctx)
	if err := c.Verify(ctx, cap.ID, "ZZZZZ"); err != domain.ErrInvalidCaptcha {
		t.Fatalf("wrong answer: %v", err)
	}
}

func TestCaptchaExpired(t *testing.T) {
	ctx := context.Background()
	store := infrastructure.NewCaptchaMemory()
	c := newCaptcha(store)

	// Store a challenge with zero TTL so it is already expired.
	if err := store.Put(ctx, "expired-id", c.Crypto.HMAC("ABCDE"), -time.Second); err != nil {
		t.Fatal(err)
	}
	if err := c.Verify(ctx, "expired-id", "ABCDE"); err != domain.ErrInvalidCaptcha {
		t.Fatalf("expired should fail, got %v", err)
	}
}

// TestCaptchaCodeAlphabet guards the character set: every rune comes from the
// documented alphabet, and the truly ambiguous 0/O/1/I never appear.
func TestCaptchaCodeAlphabet(t *testing.T) {
	for range 200 {
		code, err := randomCode(captchaLength)
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != captchaLength {
			t.Fatalf("length %d", len(code))
		}
		for _, r := range code {
			if !strings.ContainsRune(captchaAlphabet, r) {
				t.Fatalf("code contains %q outside alphabet", r)
			}
			if strings.ContainsRune("0O1I", r) {
				t.Fatalf("confusable character %q in code", r)
			}
		}
	}
}
