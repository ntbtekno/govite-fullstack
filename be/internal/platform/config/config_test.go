package config

import (
	"strings"
	"testing"
	"time"
)

func TestProductionRejectsExamplePlaceholders(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_ACCESS_SECRET", "change-me-32-bytes-minimum-secret-value")
	t.Setenv("REFRESH_TOKEN_PEPPER", "change-me-refresh-pepper")

	t.Setenv("APP_ENV", "development")
	if _, err := Load(); err != nil {
		t.Fatalf("development must accept the example values: %v", err)
	}
	t.Setenv("APP_ENV", "production")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "JWT_ACCESS_SECRET still has") || !strings.Contains(err.Error(), "REFRESH_TOKEN_PEPPER still has") {
		t.Fatalf("production must reject placeholders, got %v", err)
	}
}

// TestTokenTTLDefaults verifies that when ACCESS_TOKEN_TTL and REFRESH_TOKEN_TTL
// are not set, the defaults (15m / 7d) are used.
func TestTokenTTLDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_ACCESS_SECRET", "a-very-long-secret-that-is-at-least-32-bytes")
	t.Setenv("REFRESH_TOKEN_PEPPER", "a-pepper-16-bytes-min")
	// Ensure TTL env vars are not set
	t.Setenv("ACCESS_TOKEN_TTL", "")
	t.Setenv("REFRESH_TOKEN_TTL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}
	if cfg.AccessTokenTTL != 15*time.Minute {
		t.Errorf("AccessTokenTTL = %v, want 15m", cfg.AccessTokenTTL)
	}
	if cfg.RefreshTokenTTL != 7*24*time.Hour {
		t.Errorf("RefreshTokenTTL = %v, want 168h", cfg.RefreshTokenTTL)
	}
}

// TestTokenTTLValid verifies that valid duration strings are parsed correctly.
func TestTokenTTLValid(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_ACCESS_SECRET", "a-very-long-secret-that-is-at-least-32-bytes")
	t.Setenv("REFRESH_TOKEN_PEPPER", "a-pepper-16-bytes-min")
	t.Setenv("ACCESS_TOKEN_TTL", "60s")
	t.Setenv("REFRESH_TOKEN_TTL", "150s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}
	if cfg.AccessTokenTTL != 60*time.Second {
		t.Errorf("AccessTokenTTL = %v, want 60s", cfg.AccessTokenTTL)
	}
	if cfg.RefreshTokenTTL != 150*time.Second {
		t.Errorf("RefreshTokenTTL = %v, want 150s", cfg.RefreshTokenTTL)
	}
}

// TestTokenTTLInvalid verifies that invalid duration strings fall back to defaults
// and log a warning (we can't easily test the log, but we verify the default is used).
func TestTokenTTLInvalid(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_ACCESS_SECRET", "a-very-long-secret-that-is-at-least-32-bytes")
	t.Setenv("REFRESH_TOKEN_PEPPER", "a-pepper-16-bytes-min")
	t.Setenv("ACCESS_TOKEN_TTL", "not-a-duration")
	t.Setenv("REFRESH_TOKEN_TTL", "also-invalid")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() should not fail on invalid TTL, got %v", err)
	}
	if cfg.AccessTokenTTL != 15*time.Minute {
		t.Errorf("AccessTokenTTL = %v, want default 15m", cfg.AccessTokenTTL)
	}
	if cfg.RefreshTokenTTL != 7*24*time.Hour {
		t.Errorf("RefreshTokenTTL = %v, want default 168h", cfg.RefreshTokenTTL)
	}
}

// TestE2EHooksDisabledInProduction proves the fixed captcha code and the
// throwaway mitra seed are inert in production even when their env vars are
// set: no captcha backdoor, no e2e login shortcut on a live server.
func TestE2EHooksDisabledInProduction(t *testing.T) {
	c := Config{
		Env:              "production",
		E2ECaptchaCode:   "ABCDE",
		E2EMitraKode:     "MTR-E2E",
		E2EMitraUsername: "e2e-mitra",
		E2EMitraPassword: "E2eMitra123!",
	}
	if got := c.E2ECaptchaOverride(); got != "" {
		t.Fatalf("production must ignore E2E_CAPTCHA_CODE, got %q", got)
	}
	if _, _, _, ok := c.E2EMitraSeed(); ok {
		t.Fatal("production must ignore E2E_MITRA_* seed")
	}

	// Outside production both hooks are active, so the e2e browser can log in.
	c.Env = "development"
	if got := c.E2ECaptchaOverride(); got != "ABCDE" {
		t.Fatalf("dev must honour E2E_CAPTCHA_CODE, got %q", got)
	}
	if kode, username, password, ok := c.E2EMitraSeed(); !ok || kode != "MTR-E2E" || username != "e2e-mitra" || password != "E2eMitra123!" {
		t.Fatalf("dev must honour E2E_MITRA_*, got ok=%v kode=%q user=%q", ok, kode, username)
	}

	// A partial seed is never applied, even outside production.
	c.E2EMitraPassword = ""
	if _, _, _, ok := c.E2EMitraSeed(); ok {
		t.Fatal("partial E2E_MITRA_* must not seed")
	}
}
