// Package application holds the admin user use cases.
package application

import (
	"context"
	"regexp"
	"strings"

	"govite/internal/kernel"
	"govite/internal/users/domain"
)

type Service struct {
	Repo  domain.Repository
	Creds domain.Credentials
	Tx    kernel.Tx
	Audit kernel.Auditor
}

func actor(ctx context.Context) string { return kernel.PrincipalFrom(ctx).ID }

// mitraRoles are the only role names a mitra caller may assign to a user.
var mitraRoles = map[string]bool{"mitra_admin": true, "mitra_staff": true}

// isMitraRole reports whether roleID names a mitra-managed role (MITRA_ADMIN or
// MITRA_STAFF). Such a user must be bound to a mitra to ever log in.
func (s *Service) isMitraRole(ctx context.Context, roleID string) (bool, error) {
	name, err := s.Repo.RoleName(ctx, roleID)
	if err != nil {
		return false, err
	}
	return mitraRoles[strings.ToLower(name)], nil
}

// usernameRe allows lower-case letters, digits, dot, underscore and hyphen.
// A leading @ is impossible, so a username can never be confused with an email
// at login.
var usernameRe = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

// validateUsername normalises and checks a username. An empty value is allowed
// only when the user has no mitra (required is enforced by the caller).
func validateUsername(username string) (string, error) {
	u := strings.TrimSpace(username)
	if !usernameRe.MatchString(u) {
		return "", domain.ErrInvalidUsername
	}
	return u, nil
}

// applyScopeFilter constrains f to the caller's scope. A mitra scope forces
// mitra_id and ignores any mitra_id the request tried to filter by.
func applyScopeFilter(f *domain.Filter, sc domain.Scope) {
	if mitraID, ok := sc.MitraFilter(); ok {
		f.MitraID = &mitraID
	}
}

// visible reports whether the caller may see target. A mitra caller only sees
// users of its own mitra; everyone else (all/self) is allowed here and further
// constrained per-record by the caller.
func visible(target domain.User, sc domain.Scope) bool {
	if mitraID, ok := sc.MitraFilter(); ok {
		return target.MitraID != nil && *target.MitraID == mitraID
	}
	return true
}

// denyCrossMitra records a refused cross-mitra access. The handler still
// returns 404 so the caller cannot enumerate users, but the attempt is kept in
// the audit log with the actor and the mitra it tried to reach.
func (s *Service) denyCrossMitra(ctx context.Context, action, targetID string, target domain.User, sc domain.Scope) {
	if s.Audit == nil {
		return
	}
	s.Audit.Record(ctx, action, "user", targetID, nil, map[string]any{
		"outcome":     "cross_mitra_denied",
		"actorMitra":  sc.MitraID,
		"targetMitra": target.MitraID,
	})
}

func (s *Service) Get(ctx context.Context, sc domain.Scope, id string) (domain.User, error) {
	u, err := s.Repo.Get(ctx, id)
	if err != nil {
		return u, err
	}
	if !visible(u, sc) {
		// 404, not 403: a mitra cannot enumerate other mitra's users.
		s.denyCrossMitra(ctx, "user.get_cross_mitra", id, u, sc)
		return domain.User{}, domain.ErrNotFound
	}
	return u, nil
}

func (s *Service) List(ctx context.Context, sc domain.Scope, f domain.Filter, limit, offset int32) ([]domain.User, int64, error) {
	applyScopeFilter(&f, sc)
	total, err := s.Repo.Count(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.Repo.List(ctx, f, limit, offset)
	return rows, total, err
}

// checkRoleAssignable refuses a role a mitra caller may not use (for example
// Super Admin). A Superadmin (all/self scope without mitra) may assign any.
func (s *Service) checkRoleAssignable(ctx context.Context, sc domain.Scope, roleID string) error {
	if _, ok := sc.MitraFilter(); !ok {
		return nil
	}
	name, err := s.Repo.RoleName(ctx, roleID)
	if err != nil {
		return err
	}
	if !mitraRoles[strings.ToLower(name)] {
		return domain.ErrRoleNotAllowed
	}
	return nil
}

type CreateInput struct {
	Email    string  `json:"email" validate:"required,email"`
	FullName string  `json:"fullName" validate:"required,min=1,max=100"`
	RoleID   string  `json:"roleId" validate:"required,uuid"`
	Password string  `json:"password" validate:"omitempty,password"`
	MitraID  *string `json:"mitraId" validate:"omitempty,uuid"`
	Username string  `json:"username"`
}

// Create adds a user. Without a password the user is invited by email. A mitra
// caller always creates into its own mitra; any mitraId in the request is
// ignored. A username is required for a user that ends up in a mitra.
func (s *Service) Create(ctx context.Context, sc domain.Scope, in CreateInput) (domain.User, error) {
	if ok, err := s.Repo.RoleExists(ctx, in.RoleID); err != nil || !ok {
		return domain.User{}, domain.ErrInvalidRole
	}
	if err := s.checkRoleAssignable(ctx, sc, in.RoleID); err != nil {
		return domain.User{}, err
	}
	mitraID := in.MitraID
	if own, ok := sc.MitraFilter(); ok {
		mitraID = &own
	}
	// A mitra role without a mitra can never log in; refuse it up front.
	// Non-mitra roles (e.g. Super Admin) are still allowed without a mitra.
	if mitraRole, err := s.isMitraRole(ctx, in.RoleID); err != nil {
		return domain.User{}, err
	} else if mitraRole && mitraID == nil {
		return domain.User{}, domain.ErrMitraRequired
	}
	raw := strings.TrimSpace(in.Username)
	if raw == "" {
		if mitraID != nil {
			return domain.User{}, domain.ErrUsernameRequired
		}
	} else {
		u, err := validateUsername(raw)
		if err != nil {
			return domain.User{}, err
		}
		taken, err := s.Repo.UsernameTaken(ctx, u)
		if err != nil {
			return domain.User{}, err
		}
		if taken {
			return domain.User{}, domain.ErrUsernameTaken
		}
		raw = u
	}
	var username *string
	if raw != "" {
		username = &raw
	}
	var hash *string
	if in.Password != "" {
		h, err := s.Creds.HashPassword(in.Password)
		if err != nil {
			return domain.User{}, err
		}
		hash = &h
	}
	id := kernel.NewID()
	err := s.Repo.Create(ctx, domain.NewUser{ID: id, Email: strings.ToLower(strings.TrimSpace(in.Email)), FullName: strings.TrimSpace(in.FullName), RoleID: in.RoleID, PasswordHash: hash, MitraID: mitraID, Username: username})
	if err != nil {
		return domain.User{}, err
	}
	u, err := s.Repo.Get(ctx, id)
	if err == nil && hash == nil {
		err = s.Creds.SendInvite(ctx, u.ID, u.Email)
	}
	return u, err
}

// Update changes fields; a role change, deactivation or mitra move signs the
// user out in the same transaction.
func (s *Service) Update(ctx context.Context, sc domain.Scope, id string, c domain.Changes) (domain.User, error) {
	cur, err := s.Repo.Get(ctx, id)
	if err != nil {
		return cur, err
	}
	if !visible(cur, sc) {
		s.denyCrossMitra(ctx, "user.update_cross_mitra", id, cur, sc)
		return cur, domain.ErrNotFound
	}
	// A mitra caller may neither reassign mitra_id nor pick a role outside the
	// mitra set. A Superadmin may move a user between mitras.
	if _, ok := sc.MitraFilter(); ok {
		c.MitraID = nil
	}
	revoke, err := cur.CheckUpdate(actor(ctx), c)
	if err != nil {
		return cur, err
	}
	if c.RoleID != nil {
		if ok, err := s.Repo.RoleExists(ctx, *c.RoleID); err != nil || !ok {
			return cur, domain.ErrInvalidRole
		}
		if err := s.checkRoleAssignable(ctx, sc, *c.RoleID); err != nil {
			return cur, err
		}
	}
	// Effective role and mitra after the patch: a mitra role must keep a mitra,
	// so changing a user into (or within) a mitra role with no mitra is refused.
	effRoleID := cur.RoleID
	if c.RoleID != nil {
		effRoleID = *c.RoleID
	}
	effMitra := cur.MitraID
	if c.MitraID != nil {
		effMitra = c.MitraID
	}
	if mitraRole, err := s.isMitraRole(ctx, effRoleID); err != nil {
		return cur, err
	} else if mitraRole && effMitra == nil {
		return cur, domain.ErrMitraRequired
	}
	if c.Username != nil {
		u, err := validateUsername(*c.Username)
		if err != nil {
			return cur, err
		}
		if cur.Username == nil || *cur.Username != u {
			taken, err := s.Repo.UsernameTaken(ctx, u)
			if err != nil {
				return cur, err
			}
			if taken {
				return cur, domain.ErrUsernameTaken
			}
		}
		c.Username = &u
	} else if cur.Username == nil {
		// A user that will live in a mitra must carry a username to log in.
		targetMitra := cur.MitraID
		if c.MitraID != nil {
			targetMitra = c.MitraID
		}
		if targetMitra != nil {
			return cur, domain.ErrUsernameRequired
		}
	}
	err = s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.Update(ctx, id, c); err != nil {
			return err
		}
		if revoke {
			return s.Repo.RevokeSessions(ctx, id)
		}
		return nil
	})
	if err != nil {
		return cur, err
	}
	return s.Repo.Get(ctx, id)
}

// Remove permanently deletes the user. confirmUsername must equal the target's
// username (or email when the username is NULL); anything else is refused with
// ErrDeleteConfirmationMismatch and the user is left untouched. The delete, the
// session revoke and the audit snapshot happen in one transaction; the audit
// row keeps the target's username and email because the user row is gone after.
func (s *Service) Remove(ctx context.Context, sc domain.Scope, id, confirmUsername string) (domain.User, error) {
	cur, err := s.Repo.Get(ctx, id)
	if err != nil {
		return cur, err
	}
	if !visible(cur, sc) {
		s.denyCrossMitra(ctx, "user.delete_cross_mitra", id, cur, sc)
		return cur, domain.ErrNotFound
	}
	if actor(ctx) == id {
		return cur, domain.ErrModifySelf
	}
	// The typed word must match the target's username, or its email when the
	// user has no username.
	want := cur.Email
	if cur.Username != nil {
		want = *cur.Username
	}
	if confirmUsername != want {
		return cur, domain.ErrDeleteConfirmationMismatch
	}
	if err := s.hardDelete(ctx, cur); err != nil {
		return cur, err
	}
	return cur, nil
}

// removeBulk is the bulk delete entry point: it applies the same scope and
// self checks as Remove, then hard-deletes. The typed confirmation gate is a
// per-row UI safeguard and does not apply to the bulk action.
func (s *Service) removeBulk(ctx context.Context, sc domain.Scope, id string) (domain.User, error) {
	cur, err := s.Repo.Get(ctx, id)
	if err != nil {
		return cur, err
	}
	if !visible(cur, sc) {
		s.denyCrossMitra(ctx, "user.delete_cross_mitra", id, cur, sc)
		return cur, domain.ErrNotFound
	}
	if actor(ctx) == id {
		return cur, domain.ErrModifySelf
	}
	if err := s.hardDelete(ctx, cur); err != nil {
		return cur, err
	}
	return cur, nil
}

// hardDelete removes cur for good in one transaction: revoke sessions, drop the
// user's announcements (RESTRICT), write the audit snapshot (the row is about
// to vanish), then delete the row. Shared by the single delete and the bulk
// delete; the typed confirmation is enforced by Remove before calling this.
func (s *Service) hardDelete(ctx context.Context, cur domain.User) error {
	return s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.RevokeSessions(ctx, cur.ID); err != nil {
			return err
		}
		if err := s.Repo.DeleteAnnouncementsByAuthor(ctx, cur.ID); err != nil {
			return err
		}
		if s.Audit != nil {
			s.Audit.Record(ctx, "user.delete", "user", cur.ID, nil, map[string]any{
				"username": cur.Username,
				"email":    cur.Email,
				"fullName": cur.FullName,
				"mitraId":  cur.MitraID,
				"roleId":   cur.RoleID,
				"hard":     true,
			})
		}
		return s.Repo.HardDelete(ctx, cur.ID)
	})
}

func (s *Service) Restore(ctx context.Context, sc domain.Scope, id string) (domain.User, error) {
	cur, err := s.Repo.Get(ctx, id)
	if err != nil {
		return cur, err
	}
	if !visible(cur, sc) {
		s.denyCrossMitra(ctx, "user.restore_cross_mitra", id, cur, sc)
		return cur, domain.ErrNotFound
	}
	if cur.DeletedAt == nil {
		return cur, domain.ErrNotDeleted
	}
	if err := s.Repo.SetDeleted(ctx, id, nil); err != nil {
		return cur, err
	}
	return s.Repo.Get(ctx, id)
}

func (s *Service) Reinvite(ctx context.Context, sc domain.Scope, id string) error {
	u, err := s.Repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if !visible(u, sc) {
		s.denyCrossMitra(ctx, "user.invite_cross_mitra", id, u, sc)
		return domain.ErrNotFound
	}
	if u.DeletedAt != nil {
		return domain.ErrDeleted
	}
	if !u.Invited {
		return domain.ErrAlreadyActive
	}
	return s.Creds.SendInvite(ctx, u.ID, u.Email)
}

func (s *Service) ResetPassword(ctx context.Context, sc domain.Scope, id, password string) error {
	u, err := s.Repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if !visible(u, sc) {
		s.denyCrossMitra(ctx, "user.reset_password_cross_mitra", id, u, sc)
		return domain.ErrNotFound
	}
	hash, err := s.Creds.HashPassword(password)
	if err != nil {
		return err
	}
	return s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.SetPassword(ctx, id, hash); err != nil {
			return err
		}
		return s.Repo.RevokeSessions(ctx, id)
	})
}

type BulkFailure struct {
	ID      string `json:"id"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Bulk applies action to each distinct id. Domain errors are collected per
// id; anything else aborts.
func (s *Service) Bulk(ctx context.Context, sc domain.Scope, ids []string, action string) (succeeded []string, failed []BulkFailure, err error) {
	succeeded, failed = []string{}, []BulkFailure{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		var err error
		switch action {
		case "delete":
			_, err = s.removeBulk(ctx, sc, id)
		case "restore":
			_, err = s.Restore(ctx, sc, id)
		default:
			active := action == "activate"
			_, err = s.Update(ctx, sc, id, domain.Changes{IsActive: &active})
		}
		var de *kernel.Error
		switch {
		case err == nil:
			succeeded = append(succeeded, id)
		case asKernel(err, &de):
			failed = append(failed, BulkFailure{id, de.Code, de.Message})
		default:
			return nil, nil, err
		}
	}
	return succeeded, failed, nil
}
