// Package application holds the admin user use cases.
package application

import (
	"context"
	"strings"
	"time"

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
}

// Create adds a user. Without a password the user is invited by email. A mitra
// caller always creates into its own mitra; any mitraId in the request is
// ignored.
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
	var hash *string
	if in.Password != "" {
		h, err := s.Creds.HashPassword(in.Password)
		if err != nil {
			return domain.User{}, err
		}
		hash = &h
	}
	id := kernel.NewID()
	err := s.Repo.Create(ctx, domain.NewUser{ID: id, Email: strings.ToLower(strings.TrimSpace(in.Email)), FullName: strings.TrimSpace(in.FullName), RoleID: in.RoleID, PasswordHash: hash, MitraID: mitraID})
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

// Remove soft-deletes and signs out atomically; deleting twice is a no-op.
func (s *Service) Remove(ctx context.Context, sc domain.Scope, id string) (domain.User, error) {
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
	if cur.DeletedAt != nil {
		return cur, nil
	}
	now := time.Now()
	err = s.Tx.Do(ctx, func(ctx context.Context) error {
		if err := s.Repo.SetDeleted(ctx, id, &now); err != nil {
			return err
		}
		return s.Repo.RevokeSessions(ctx, id)
	})
	if err != nil {
		return cur, err
	}
	return s.Repo.Get(ctx, id)
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
			_, err = s.Remove(ctx, sc, id)
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
