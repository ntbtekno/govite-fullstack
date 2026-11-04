package config

import (
	"strings"
	"testing"
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
