// Package infrastructure stores users in Postgres.
package infrastructure

import (
	"context"
	"strings"
	"time"

	"govite/internal/kernel"
	"govite/internal/platform/postgres"
	"govite/internal/platform/postgres/store"
	"govite/internal/users/domain"
)

type Repository struct {
	DB *postgres.DB
	// AvatarURL turns a stored key into a public URL ("" when none).
	AvatarURL func(key string) string
}

func (r Repository) toUser(u store.User, role string) domain.User {
	var avatar *string
	if u.AvatarKey != nil {
		if v := r.AvatarURL(*u.AvatarKey); v != "" {
			avatar = &v
		}
	}
	return domain.User{ID: u.ID, Email: u.Email, FullName: u.FullName, Username: u.Username, AvatarURL: avatar, RoleID: u.RoleID, RoleName: role, MitraID: u.MitraID, IsActive: u.IsActive, Invited: u.PasswordHash == nil, EmailVerifiedAt: u.EmailVerifiedAt, DeletedAt: u.DeletedAt, LastLoginAt: u.LastLoginAt, CreatedAt: u.CreatedAt}
}

func (r Repository) Get(ctx context.Context, id string) (domain.User, error) {
	row, err := r.DB.Q(ctx).GetUser(ctx, id)
	if err != nil {
		if postgres.Err(err) == kernel.ErrNotFound {
			return domain.User{}, domain.ErrNotFound
		}
		return domain.User{}, err
	}
	u := r.toUser(row.User, row.RoleName)
	u.MitraKode = row.KodeMitra
	return u, nil
}

func (r Repository) List(ctx context.Context, f domain.Filter, limit, offset int32) ([]domain.User, error) {
	rows, err := r.DB.Q(ctx).ListUsers(ctx, store.ListUsersParams{RoleID: f.RoleID, IsActive: f.IsActive, MitraID: f.MitraID, Deleted: f.Deleted, Search: f.Search, Sort: f.Sort, Dir: f.Order, Lim: limit, Off: offset})
	if err != nil {
		return nil, err
	}
	out := make([]domain.User, len(rows))
	for i, x := range rows {
		out[i] = r.toUser(x.User, x.RoleName)
	}
	return out, nil
}

func (r Repository) Count(ctx context.Context, f domain.Filter) (int64, error) {
	return r.DB.Q(ctx).CountUsers(ctx, store.CountUsersParams{RoleID: f.RoleID, IsActive: f.IsActive, MitraID: f.MitraID, Deleted: f.Deleted, Search: f.Search})
}

func (r Repository) Create(ctx context.Context, u domain.NewUser) error {
	err := r.DB.Q(ctx).CreateUser(ctx, store.CreateUserParams{ID: u.ID, Email: u.Email, FullName: &u.FullName, RoleID: u.RoleID, PasswordHash: u.PasswordHash, MitraID: u.MitraID, Username: u.Username})
	if postgres.IsUnique(err, "email") {
		return domain.ErrEmailTaken
	}
	if postgres.IsUnique(err, "username") {
		return domain.ErrUsernameTaken
	}
	return err
}

func (r Repository) Update(ctx context.Context, id string, c domain.Changes) error {
	err := r.DB.Q(ctx).UpdateUser(ctx, store.UpdateUserParams{ID: id, FullName: c.FullName, RoleID: c.RoleID, IsActive: c.IsActive, SetMitra: c.MitraID != nil, MitraID: c.MitraID, Username: c.Username})
	if postgres.IsUnique(err, "username") {
		return domain.ErrUsernameTaken
	}
	return err
}

func (r Repository) SetDeleted(ctx context.Context, id string, at *time.Time) error {
	return r.DB.Q(ctx).SetUserDeleted(ctx, store.SetUserDeletedParams{ID: id, DeletedAt: at})
}

func (r Repository) SetPassword(ctx context.Context, id, hash string) error {
	return r.DB.Q(ctx).SetPassword(ctx, store.SetPasswordParams{ID: id, PasswordHash: &hash})
}

func (r Repository) RevokeSessions(ctx context.Context, id string) error {
	return r.DB.Q(ctx).RevokeUserFamilies(ctx, id)
}

func (r Repository) RevokeMitraSessions(ctx context.Context, mitraID string) error {
	return r.DB.Q(ctx).RevokeMitraFamilies(ctx, &mitraID)
}

func (r Repository) RoleExists(ctx context.Context, id string) (bool, error) {
	return r.DB.Q(ctx).RoleExists(ctx, id)
}

func (r Repository) RoleName(ctx context.Context, id string) (string, error) {
	role, err := r.DB.Q(ctx).GetRole(ctx, id)
	if err != nil {
		if postgres.Err(err) == kernel.ErrNotFound {
			return "", domain.ErrInvalidRole
		}
		return "", err
	}
	return role.Role.Name, nil
}

func (r Repository) RoleIDsByName(ctx context.Context) (map[string]string, error) {
	rows, err := r.DB.Q(ctx).RoleNames(ctx)
	out := make(map[string]string, len(rows))
	for _, x := range rows {
		out[strings.ToLower(x.Name)] = x.ID
	}
	return out, err
}

func (r Repository) ExistingEmails(ctx context.Context, emails []string) ([]string, error) {
	return r.DB.Q(ctx).ExistingEmails(ctx, emails)
}

func (r Repository) UsernameTaken(ctx context.Context, username string) (bool, error) {
	return r.DB.Q(ctx).UsernameExists(ctx, &username)
}
