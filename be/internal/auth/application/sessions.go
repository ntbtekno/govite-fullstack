// Package application holds the auth use cases: sessions (login, refresh
// rotation, logout), one-time tokens, two-factor and self-service security.
package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"govite/internal/auth/domain"
	"govite/internal/kernel"
	"govite/internal/policy"
)

type Service struct {
	Repo    domain.Repository
	Crypto  domain.Crypto
	OTP     domain.OTP
	Mail    domain.Mailer
	Captcha *Captcha
	Tx      kernel.Tx
	Audit   kernel.Auditor
	WebURL  string
}

func notFound(err error) bool { return errors.Is(err, kernel.ErrNotFound) }

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

// Authenticate turns a bearer access token into the caller.
func (s *Service) Authenticate(token string) (kernel.Principal, error) {
	p, err := s.Crypto.ParseAccess(token)
	if err != nil {
		return p, domain.ErrUnauthorized
	}
	return p, nil
}

func (s *Service) HashPassword(plain string) (string, error) { return s.Crypto.HashPassword(plain) }

// loginAudit records a login attempt. It never carries the password or the
// captcha answer: only which principal/login was tried and the outcome, so an
// operator can spot failures without any secret ending up in the log.
func (s *Service) loginAudit(ctx context.Context, action, login, mitraKode, outcome, userID string) {
	if s.Audit == nil {
		return
	}
	detail := map[string]any{"outcome": outcome, "login": login}
	if mitraKode != "" {
		detail["mitraKode"] = mitraKode
	}
	s.Audit.Record(ctx, action, "session", userID, nil, detail)
}

// Login verifies the captcha and password; returns a session or a 2FA
// challenge. login may be an email (contains @) or a username. The captcha is
// checked first, so a wrong code fails before any credential lookup.
func (s *Service) Login(ctx context.Context, login, password, captchaID, captcha string, cl domain.Client) (*domain.Session, *domain.Challenge, error) {
	if err := s.Captcha.Verify(ctx, captchaID, captcha); err != nil {
		s.loginAudit(ctx, "auth.login.failure", login, "", "invalid_captcha", "")
		return nil, nil, err
	}
	var u domain.User
	var err error
	if norm, ok := isEmail(login); ok {
		u, err = s.Repo.UserByEmail(ctx, norm)
	} else {
		u, err = s.Repo.UserByUsername(ctx, login)
	}
	if notFound(err) || (err == nil && !u.CanAuthenticate()) {
		s.Crypto.BurnPassword(password)
		s.loginAudit(ctx, "auth.login.failure", login, "", "invalid_credentials", "")
		return nil, nil, domain.ErrInvalidCredentials
	}
	if err != nil {
		return nil, nil, err
	}
	if !s.Crypto.VerifyPassword(*u.PasswordHash, password) {
		s.loginAudit(ctx, "auth.login.failure", login, "", "invalid_credentials", u.ID)
		return nil, nil, domain.ErrInvalidCredentials
	}
	required, err := s.Repo.RoleRequiresTwoFactor(ctx, u.RoleID)
	if err != nil {
		return nil, nil, err
	}
	tf, err := s.Repo.TwoFactor(ctx, u.ID)
	if err != nil && !notFound(err) {
		return nil, nil, err
	}
	if required || (err == nil && tf.Enabled()) {
		s.loginAudit(ctx, "auth.login.two_factor_challenge", login, "", "challenge", u.ID)
		ch, err := s.challenge(ctx, u)
		return nil, ch, err
	}
	sess, err := s.issueSession(ctx, u, cl)
	if err != nil {
		return nil, nil, err
	}
	s.loginAudit(ctx, "auth.login.success", login, "", "success", u.ID)
	return sess, nil, nil
}

func isEmail(login string) (string, bool) {
	if strings.Contains(login, "@") {
		return normEmail(login), true
	}
	return "", false
}

// LoginMitra verifies captcha, mitraKode, the identifier (username OR email)
// and password. The captcha is checked first; the returned error is always
// generic — the caller must never distinguish between wrong captcha, mitra,
// identifier, or password.
func (s *Service) LoginMitra(ctx context.Context, mitraKode, username, password, captchaID, captcha string, cl domain.Client) (*domain.Session, *domain.Challenge, error) {
	if err := s.Captcha.Verify(ctx, captchaID, captcha); err != nil {
		s.loginAudit(ctx, "auth.login_mitra.failure", username, mitraKode, "invalid_captcha", "")
		return nil, nil, err
	}
	m, err := s.Repo.MitraByKode(ctx, mitraKode)
	if notFound(err) || (err == nil && !m.IsActive) {
		s.Crypto.BurnPassword(password)
		s.loginAudit(ctx, "auth.login_mitra.failure", username, mitraKode, "invalid_credentials", "")
		return nil, nil, domain.ErrLoginInvalid
	}
	if err != nil {
		return nil, nil, err
	}
	u, err := s.Repo.UserByLoginAndMitra(ctx, username, m.ID)
	if notFound(err) || (err == nil && !u.CanAuthenticate()) {
		s.Crypto.BurnPassword(password)
		s.loginAudit(ctx, "auth.login_mitra.failure", username, mitraKode, "invalid_credentials", "")
		return nil, nil, domain.ErrLoginInvalid
	}
	if err != nil {
		return nil, nil, err
	}
	if !s.Crypto.VerifyPassword(*u.PasswordHash, password) {
		s.loginAudit(ctx, "auth.login_mitra.failure", username, mitraKode, "invalid_credentials", u.ID)
		return nil, nil, domain.ErrLoginInvalid
	}
	required, err := s.Repo.RoleRequiresTwoFactor(ctx, u.RoleID)
	if err != nil {
		return nil, nil, err
	}
	tf, err := s.Repo.TwoFactor(ctx, u.ID)
	if err != nil && !notFound(err) {
		return nil, nil, err
	}
	if required || (err == nil && tf.Enabled()) {
		s.loginAudit(ctx, "auth.login_mitra.two_factor_challenge", username, mitraKode, "challenge", u.ID)
		ch, err := s.challenge(ctx, u)
		return nil, ch, err
	}
	sess, err := s.issueSession(ctx, u, cl)
	if err != nil {
		return nil, nil, err
	}
	s.loginAudit(ctx, "auth.login_mitra.success", username, mitraKode, "success", u.ID)
	return sess, nil, nil
}

func (s *Service) issueSession(ctx context.Context, u domain.User, cl domain.Client) (*domain.Session, error) {
	familyID := kernel.NewID()
	refresh := s.Crypto.Token(48)
	err := s.Tx.Do(ctx, func(ctx context.Context) error {
		ua := cl.UserAgent
		if len(ua) > 512 {
			ua = ua[:512]
		}
		if err := s.Repo.CreateFamily(ctx, familyID, u.ID, kernel.Ptr(ua), kernel.Ptr(cl.IP)); err != nil {
			return err
		}
		if err := s.Repo.AddRefreshToken(ctx, familyID, s.Crypto.HMAC(refresh), time.Now().Add(policy.Security.RefreshTokenTTL)); err != nil {
			return err
		}
		return s.Repo.TouchLastLogin(ctx, u.ID)
	})
	if err != nil {
		return nil, err
	}
	access, exp, err := s.Crypto.SignAccess(u.ID, u.RoleID, deptr(u.MitraID), familyID)
	return &domain.Session{AccessToken: access, ExpiresIn: exp, RefreshToken: refresh, User: u}, err
}

// deptr returns "" for a nil pointer, else the dereferenced value.
func deptr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Refresh rotates the refresh token in one transaction. Replaying a used
// token revokes its whole family; the revocation commits before the error.
func (s *Service) Refresh(ctx context.Context, token string) (*domain.Session, error) {
	next := s.Crypto.Token(48)
	nextHash := s.Crypto.HMAC(next)
	var (
		rec       domain.RefreshToken
		u         domain.User
		domainErr error
	)
	err := s.Tx.Do(ctx, func(ctx context.Context) error {
		var err error
		rec, err = s.Repo.FindRefreshToken(ctx, s.Crypto.HMAC(token))
		if notFound(err) {
			return domain.ErrInvalidRefresh
		}
		if err != nil {
			return err
		}
		revoke := func(e error) error {
			if err := s.Repo.RevokeFamily(ctx, rec.FamilyID); err != nil {
				return err
			}
			domainErr = e
			return nil
		}
		if rec.UsedAt != nil {
			return revoke(domain.ErrReuseDetected)
		}
		if rec.ExpiresAt.Before(time.Now()) || rec.RevokedAt != nil {
			return domain.ErrInvalidRefresh
		}
		if u, err = s.Repo.UserByID(ctx, rec.UserID); err != nil {
			return domain.ErrInvalidRefresh
		}
		if !u.IsActive {
			return revoke(domain.ErrInvalidRefresh)
		}
		ok, err := s.Repo.MarkRefreshTokenUsed(ctx, rec.ID, nextHash)
		if err != nil {
			return err
		}
		if !ok {
			return revoke(domain.ErrReuseDetected)
		}
		return s.Repo.AddRefreshToken(ctx, rec.FamilyID, nextHash, time.Now().Add(policy.Security.RefreshTokenTTL))
	})
	if err != nil {
		return nil, err
	}
	if domainErr != nil {
		return nil, domainErr
	}
	access, exp, err := s.Crypto.SignAccess(u.ID, u.RoleID, deptr(u.MitraID), rec.FamilyID)
	return &domain.Session{AccessToken: access, ExpiresIn: exp, RefreshToken: next, User: u}, err
}

// Logout revokes the token's family. Unknown tokens are ignored (idempotent).
func (s *Service) Logout(ctx context.Context, token string) error {
	rec, err := s.Repo.FindRefreshToken(ctx, s.Crypto.HMAC(token))
	if notFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.Repo.RevokeFamily(ctx, rec.FamilyID)
}

// Me is the signed-in user, refused once inactive or password-less.
func (s *Service) Me(ctx context.Context) (domain.User, error) {
	u, err := s.Repo.UserWithRole(ctx, kernel.PrincipalFrom(ctx).ID)
	if err != nil || !u.CanAuthenticate() {
		return u, domain.ErrSessionUser
	}
	return u, nil
}

// CheckPassword returns ErrInvalidCredentials unless password matches.
func (s *Service) CheckPassword(ctx context.Context, userID, password string) (domain.User, error) {
	u, err := s.Repo.UserByID(ctx, userID)
	if err != nil {
		return u, err
	}
	if u.PasswordHash == nil || !s.Crypto.VerifyPassword(*u.PasswordHash, password) {
		return u, domain.ErrInvalidCredentials
	}
	return u, nil
}
