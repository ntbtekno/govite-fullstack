// Package domain holds credentials, sessions, one-time tokens and 2FA:
// entities, errors and the ports the auth use cases need.
package domain

import (
	"context"
	"time"

	"govite/internal/kernel"
)

var (
	ErrInvalidCredentials = kernel.E(kernel.Unauthenticated, "INVALID_CREDENTIALS", "Email or password is incorrect")
	ErrInvalidRefresh     = kernel.E(kernel.Unauthenticated, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired")
	ErrReuseDetected      = kernel.E(kernel.Unauthenticated, "REFRESH_TOKEN_REUSE_DETECTED", "Refresh token reuse detected; session revoked")
	ErrMissingRefresh     = kernel.E(kernel.Unauthenticated, "MISSING_REFRESH_TOKEN", "No refresh token cookie present")
	ErrSessionUser        = kernel.E(kernel.Unauthenticated, "SESSION_USER_NOT_FOUND", "The signed-in user no longer exists or is inactive")
	ErrUnauthorized       = kernel.E(kernel.Unauthenticated, "UNAUTHORIZED", "Unauthorized")
	ErrInvalidToken       = kernel.E(kernel.Invalid, "INVALID_TOKEN", "Token is invalid or expired")
	ErrInvalidTOTP        = kernel.E(kernel.Unauthenticated, "INVALID_TWO_FACTOR_CODE", "Invalid two-factor code")
	ErrTOTPEnabled        = kernel.E(kernel.Conflict, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already enabled")
	ErrTOTPNotEnabled     = kernel.E(kernel.Conflict, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled")
	ErrTOTPRequired       = kernel.E(kernel.Forbidden, "TWO_FACTOR_REQUIRED", "Your role requires two-factor authentication")
	ErrSessionNotFound    = kernel.E(kernel.NotFound, "SESSION_NOT_FOUND", "Session not found")
	// ErrInvalidCaptcha is returned when a captcha is wrong, expired or already
	// used. Login responses must render the same generic message as a bad
	// password, so the caller never learns which check failed.
	ErrInvalidCaptcha = kernel.E(kernel.Unauthenticated, "INVALID_CAPTCHA", "Email/username atau password salah, atau captcha tidak valid.")
	// ErrCaptchaExpired is internal only; the login response stays generic.
	ErrCaptchaExpired = kernel.E(kernel.Unauthenticated, "CAPTCHA_EXPIRED", "Captcha is invalid or expired")
)

// Captcha is a generated challenge: the id the client sends back and the
// PNG data URL shown in the form. The plaintext code never leaves the
// server; only its hash is stored.
type Captcha struct {
	ID        string
	Image     string
	ExpiresIn int
}

// ErrLoginInvalid is the generic login/mitra failure message. Never
// distinguish between invalid email, username, password, or mitra.
var ErrLoginInvalid = kernel.E(kernel.Unauthenticated, "INVALID_CREDENTIALS", "Email/username atau password salah, atau captcha tidak valid.")

// One-time token purposes and channels.
const (
	PurposeTwoFactor     = "two_factor"
	PurposePasswordReset = "password_reset"
	PurposeInvite        = "invite"
	PurposeEmailVerify   = "email_verify"
	ChannelWeb           = "web"
	ChannelMobile        = "mobile"
)

type User struct {
	ID              string
	Email           string
	FullName        *string
	RoleID          string
	RoleName        string
	PasswordHash    *string
	AvatarKey       *string
	IsActive        bool
	EmailVerifiedAt *time.Time
	Username        *string
	MitraID         *string
	MitraKode       *string
}

type MitraInfo struct {
	ID        string
	KodeMitra string
	IsActive  bool
}

// CanAuthenticate: active and has accepted the invite (has a password).
func (u User) CanAuthenticate() bool { return u.IsActive && u.PasswordHash != nil }

type Client struct{ UserAgent, IP string }

// Session is a fresh login: access token plus the opaque refresh token.
type Session struct {
	AccessToken  string
	ExpiresIn    int
	RefreshToken string
	User         User
	BackupCodes  []string
	// Remember is whether the client chose "Ingat saya"; the handler uses it to
	// pick a persistent vs session cookie.
	Remember bool
}

// Challenge is returned instead of a session when 2FA is required.
type Challenge struct {
	ChallengeToken string `json:"challengeToken"`
	SetupRequired  bool   `json:"setupRequired"`
	ManualKey      string `json:"manualKey,omitempty"`
	OtpauthURL     string `json:"otpauthUrl,omitempty"`
}

type RefreshToken struct {
	ID, FamilyID, UserID string
	ExpiresAt            time.Time
	// FamilyCreatedAt is the first login of this family; the absolute session
	// cap is measured from it, not from the latest rotation.
	FamilyCreatedAt time.Time
	// Remember is whether the login chose "Ingat saya": it fixes the refresh
	// token lifetime across rotations.
	Remember          bool
	UsedAt, RevokedAt *time.Time
}

type Family struct {
	ID, UserID string
	RevokedAt  *time.Time
}

type SessionInfo struct {
	ID         string    `json:"id"`
	UserAgent  *string   `json:"userAgent"`
	IPAddress  *string   `json:"ipAddress"`
	CreatedAt  time.Time `json:"createdAt"`
	LastUsedAt time.Time `json:"lastUsedAt"`
	Current    bool      `json:"current"`
}

type OneTimeToken struct {
	ID, UserID, TokenHash string
}

type TwoFactor struct {
	SecretEncrypted string
	EnabledAt       *time.Time
}

func (t TwoFactor) Enabled() bool { return t.EnabledAt != nil }

// Repository persists everything auth owns. Missing rows are kernel.ErrNotFound.
type Repository interface {
	UserByEmail(ctx context.Context, email string) (User, error)
	UserByID(ctx context.Context, id string) (User, error)
	UserByUsername(ctx context.Context, username string) (User, error)
	UserByUsernameAndMitra(ctx context.Context, username, mitraID string) (User, error)
	// UserByLoginAndMitra matches the identifier against username OR email
	// inside one mitra. A username can never contain '@', so the two never
	// collide.
	UserByLoginAndMitra(ctx context.Context, login, mitraID string) (User, error)
	MitraByKode(ctx context.Context, kode string) (MitraInfo, error)
	// UserWithRole also fills RoleName.
	UserWithRole(ctx context.Context, id string) (User, error)
	RoleRequiresTwoFactor(ctx context.Context, roleID string) (bool, error)
	TouchLastLogin(ctx context.Context, id string) error
	SetPassword(ctx context.Context, userID, hash string) error
	AcceptInvite(ctx context.Context, userID, fullName, hash string) error
	MarkEmailVerified(ctx context.Context, userID string) error

	TwoFactor(ctx context.Context, userID string) (TwoFactor, error)
	SetTwoFactorSecret(ctx context.Context, userID, encrypted string) error
	EnableTwoFactor(ctx context.Context, userID string) error
	DeleteTwoFactor(ctx context.Context, userID string) error
	ReplaceBackupCodes(ctx context.Context, userID string, hashes []string) error
	UseBackupCode(ctx context.Context, userID, hash string) (bool, error)
	CountBackupCodes(ctx context.Context, userID string) (int64, error)

	CreateFamily(ctx context.Context, id, userID string, userAgent, ip *string, remember bool) error
	AddRefreshToken(ctx context.Context, familyID, hash string, expires time.Time) error
	FindRefreshToken(ctx context.Context, hash string) (RefreshToken, error)
	// MarkRefreshTokenUsed is compare-and-set: false when already used.
	MarkRefreshTokenUsed(ctx context.Context, id, replacedBy string) (bool, error)
	Family(ctx context.Context, id string) (Family, error)
	Sessions(ctx context.Context, userID string) ([]SessionInfo, error)
	RevokeFamily(ctx context.Context, id string) error
	RevokeUserFamilies(ctx context.Context, userID string) error
	RevokeOtherFamilies(ctx context.Context, userID, keepID string) error

	// IssueToken invalidates older tokens of the same purpose and channel.
	IssueToken(ctx context.Context, userID, purpose, channel, hash string, expires time.Time) error
	FindToken(ctx context.Context, purpose, hash string) (OneTimeToken, error)
	LatestOTP(ctx context.Context, userID, purpose string, maxAttempts int) (OneTimeToken, error)
	BumpAttempts(ctx context.Context, id string) error
	// UseToken is compare-and-set: false when already used.
	UseToken(ctx context.Context, id string) (bool, error)
}

// Crypto is the secrets port: hashing, peppered HMAC, AES-GCM, JWTs, randomness.
type Crypto interface {
	HashPassword(plain string) (string, error)
	VerifyPassword(hash, plain string) bool
	// BurnPassword spends the same time as a real verify (unknown users).
	BurnPassword(plain string)
	HMAC(v string) string
	SHA256(v string) string
	Encrypt(plain string) string
	Decrypt(enc string) (string, error)
	SignAccess(userID, roleID, mitraID, sessionID string) (token string, expiresIn int, err error)
	ParseAccess(token string) (kernel.Principal, error)
	Token(bytes int) string
	Digits(n int) string
}

// OTP is TOTP enrolment and verification.
type OTP interface {
	Generate(account string) (secret string, err error)
	URL(account, secret string) string
	Validate(code, secret string) bool
}

// CaptchaStore keeps captcha hashes until they expire. Redis backs it when
// configured, otherwise an in-memory store is used. Values are hashes, never
// the plaintext code.
type CaptchaStore interface {
	// Put stores hash under id for ttl. It replaces any previous value.
	Put(ctx context.Context, id, hash string, ttl time.Duration) error
	// Take returns the stored hash and deletes it in one step (single use).
	// Missing or expired ids return kernel.ErrNotFound.
	Take(ctx context.Context, id string) (hash string, err error)
}

// CaptchaImage renders the challenge code as a PNG data URL.
type CaptchaImage interface {
	// Render returns "data:image/png;base64,..." for code.
	Render(code string) (string, error)
}

// Mailer sends the auth emails; copy and layout live in the adapter.
type Mailer interface {
	PasswordResetCode(ctx context.Context, to, code string, ttl time.Duration) error
	PasswordResetLink(ctx context.Context, to, link string, ttl time.Duration) error
	Invite(ctx context.Context, to, link string, ttl time.Duration) error
	VerifyEmail(ctx context.Context, to, link string, ttl time.Duration) error
}
