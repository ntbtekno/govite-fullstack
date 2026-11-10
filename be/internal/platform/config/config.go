package config

import (
	"fmt"
	"log/slog"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Env         string
	Port        int
	WebURL      string
	CORSOrigins []string
	DatabaseURL string
	RedisURL    string
	// ReportsMySQLDSN points at the external read-only reporting database.
	// Empty disables the /reports endpoints (503).
	ReportsMySQLDSN      string
	JWTSecret            string
	RefreshPepper        string
	AccessTokenTTL       time.Duration
	RefreshTokenTTL      time.Duration
	SMTPHost             string
	SMTPPort             int
	SMTPUsername         string
	SMTPPassword         string
	SMTPFrom             string
	ThrottleLimit        int
	LoginThrottleLimit   int
	CaptchaThrottleLimit int
	// E2ECaptchaCode, when set outside production, pins the captcha code so a
	// headless browser test can log in. Ignored in production.
	E2ECaptchaCode string
	// E2E mitra seed: a throwaway mitra + admin for the browser e2e. Only used
	// when E2EMitraKode/Username/Password are all set outside production.
	E2EMitraKode               string
	E2EMitraUsername           string
	E2EMitraPassword           string
	LogLevel                   string
	SuperAdminEmail            string
	SuperAdminPassword         string
	SuperAdminUsername         string
	TrustProxy                 bool
	MinioEndpoint              string
	MinioAccessKey             string
	MinioSecretKey             string
	MinioBucket                string
	MinioUseSSL                bool
	MinioPublicEndpoint        string
	StoragePublicURL           string
	FirebaseServiceAccountPath string
	MidtransServerKey          string
	MidtransProduction         bool
	WebhookThrottleLimit       int
	SentryDSN                  string
	SentryEnvironment          string
}

func (c Config) Production() bool { return c.Env == "production" }

// E2ECaptchaOverride returns the pinned captcha code only outside production.
// In production it is always empty, so a stray E2E_CAPTCHA_CODE in the
// environment can never weaken the captcha on a live server.
func (c Config) E2ECaptchaOverride() string {
	if c.Production() {
		return ""
	}
	return c.E2ECaptchaCode
}

// E2EMitraSeed reports whether the throwaway e2e mitra/admin should be seeded,
// and its three values, or ok=false. It is always disabled in production so the
// seed can never create a backdoor account on a live server.
func (c Config) E2EMitraSeed() (kode, username, password string, ok bool) {
	if c.Production() || c.E2EMitraKode == "" || c.E2EMitraUsername == "" || c.E2EMitraPassword == "" {
		return "", "", "", false
	}
	return c.E2EMitraKode, c.E2EMitraUsername, c.E2EMitraPassword, true
}

// Load reads .env (if present) then the environment. Fails fast on bad config.
func Load() (Config, error) {
	_ = godotenv.Load()
	var errs []string
	str := func(key, def string) string {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
		return def
	}
	num := func(key string, def int) int {
		v := str(key, "")
		if v == "" {
			return def
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			errs = append(errs, key+" must be a number")
		}
		return n
	}
	required := func(key string) string {
		v := str(key, "")
		if v == "" {
			errs = append(errs, key+" is required")
		}
		return v
	}
	duration := func(key string, def time.Duration) time.Duration {
		v := str(key, "")
		if v == "" {
			return def
		}
		d, err := time.ParseDuration(v)
		if err != nil {
			// Invalid duration: log warning via slog (if available) and use default.
			// We don't add to errs because invalid TTL must not prevent server boot.
			slog.Warn("invalid token TTL, using default", "key", key, "value", v, "default", def, "err", err)
			return def
		}
		return d
	}

	c := Config{
		Env:                        str("APP_ENV", "development"),
		Port:                       num("APP_PORT", 3000),
		WebURL:                     strings.TrimRight(str("WEB_URL", "http://localhost:5173"), "/"),
		DatabaseURL:                required("DATABASE_URL"),
		RedisURL:                   str("REDIS_URL", ""),
		ReportsMySQLDSN:            str("REPORTS_MYSQL_DSN", ""),
		JWTSecret:                  required("JWT_ACCESS_SECRET"),
		RefreshPepper:              required("REFRESH_TOKEN_PEPPER"),
		AccessTokenTTL:             duration("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL:            duration("REFRESH_TOKEN_TTL", 7*24*time.Hour),
		SMTPHost:                   str("SMTP_HOST", ""),
		SMTPPort:                   num("SMTP_PORT", 1025),
		SMTPUsername:               str("SMTP_USERNAME", ""),
		SMTPPassword:               str("SMTP_PASSWORD", ""),
		SMTPFrom:                   str("SMTP_FROM", "noreply@app.local"),
		ThrottleLimit:              num("THROTTLE_LIMIT", 100),
		LoginThrottleLimit:         num("LOGIN_THROTTLE_LIMIT", 10),
		CaptchaThrottleLimit:       num("CAPTCHA_THROTTLE_LIMIT", 30),
		E2ECaptchaCode:             str("E2E_CAPTCHA_CODE", ""),
		E2EMitraKode:               str("E2E_MITRA_KODE", ""),
		E2EMitraUsername:           str("E2E_MITRA_USERNAME", ""),
		E2EMitraPassword:           str("E2E_MITRA_PASSWORD", ""),
		LogLevel:                   str("LOG_LEVEL", "info"),
		SuperAdminEmail:            strings.ToLower(str("SUPER_ADMIN_EMAIL", "")),
		SuperAdminPassword:         str("SUPER_ADMIN_PASSWORD", ""),
		SuperAdminUsername:         str("SUPER_ADMIN_USERNAME", ""),
		TrustProxy:                 str("TRUST_PROXY", "false") == "true",
		MinioEndpoint:              str("MINIO_ENDPOINT", ""),
		MinioAccessKey:             str("MINIO_ACCESS_KEY", ""),
		MinioSecretKey:             str("MINIO_SECRET_KEY", ""),
		MinioBucket:                str("MINIO_BUCKET", "app"),
		MinioUseSSL:                str("MINIO_USE_SSL", "false") == "true",
		MinioPublicEndpoint:        strings.TrimRight(str("MINIO_PUBLIC_ENDPOINT", ""), "/"),
		StoragePublicURL:           strings.TrimRight(str("STORAGE_PUBLIC_URL", ""), "/"),
		FirebaseServiceAccountPath: str("FIREBASE_SERVICE_ACCOUNT_PATH", ""),
		MidtransServerKey:          str("MIDTRANS_SERVER_KEY", ""),
		MidtransProduction:         str("MIDTRANS_IS_PRODUCTION", "false") == "true",
		WebhookThrottleLimit:       num("WEBHOOK_THROTTLE_LIMIT", 300),
		SentryDSN:                  str("SENTRY_DSN", ""),
		SentryEnvironment:          str("SENTRY_ENVIRONMENT", ""),
	}
	for _, o := range strings.Split(str("CORS_ORIGIN", ""), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	if len(c.JWTSecret) > 0 && len(c.JWTSecret) < 32 {
		errs = append(errs, "JWT_ACCESS_SECRET must be at least 32 chars")
	}
	if len(c.RefreshPepper) > 0 && len(c.RefreshPepper) < 16 {
		errs = append(errs, "REFRESH_TOKEN_PEPPER must be at least 16 chars")
	}
	// The repo is public, so the placeholders in .env.example are known to
	// everyone: a production boot with them would let anyone forge tokens.
	if c.Production() {
		for key, v := range map[string]string{"JWT_ACCESS_SECRET": c.JWTSecret, "REFRESH_TOKEN_PEPPER": c.RefreshPepper} {
			if strings.Contains(strings.ToLower(v), "change-me") {
				errs = append(errs, key+" still has the .env.example placeholder")
			}
		}
	}
	if _, err := mail.ParseAddress(c.SMTPFrom); err != nil {
		errs = append(errs, "SMTP_FROM must be an email")
	}
	if len(errs) > 0 {
		return c, fmt.Errorf("invalid config: %s", strings.Join(errs, "; "))
	}
	return c, nil
}
