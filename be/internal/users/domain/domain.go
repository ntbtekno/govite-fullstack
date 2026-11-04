// Package domain is admin user management: the user record, its
// lifecycle rules and the ports the use cases need.
package domain

import (
	"context"
	"time"

	"govite/internal/kernel"
)

var (
	ErrNotFound      = kernel.E(kernel.NotFound, "USER_NOT_FOUND", "User not found")
	ErrEmailTaken    = kernel.E(kernel.Conflict, "EMAIL_TAKEN", "Email already in use")
	ErrModifySelf    = kernel.E(kernel.Forbidden, "CANNOT_MODIFY_SELF", "You cannot change your own role or deactivate yourself")
	ErrInvalidRole   = kernel.E(kernel.Invalid, "INVALID_ROLE", "Role does not exist")
	ErrAlreadyActive = kernel.E(kernel.Conflict, "USER_ALREADY_ACTIVE", "User has already accepted the invite")
	ErrDeleted       = kernel.E(kernel.Conflict, "USER_DELETED", "User is deleted; restore it first")
	ErrNotDeleted    = kernel.E(kernel.Conflict, "USER_NOT_DELETED", "User is not deleted")
	// ErrRoleNotAllowed is returned when a mitra caller tries to assign a role
	// outside the mitra-managed set (for example Super Admin).
	ErrRoleNotAllowed = kernel.E(kernel.Forbidden, "ROLE_NOT_ALLOWED", "Role is not allowed for a mitra user")
)

// Scope tells the use cases which users the caller may see or change.
// Kind is "all", "mitra" or "self"; MitraID is filled for "mitra".
type Scope struct {
	Kind    string
	UserID  string
	MitraID string
}

func (s Scope) AllowsAll() bool { return s.Kind == "all" }

// MitraFilter returns the mitra id to constrain a query/list to, and true when
// one applies. "all" and "self" return false (self is handled per-record).
func (s Scope) MitraFilter() (string, bool) {
	if s.Kind == "mitra" {
		return s.MitraID, true
	}
	return "", false
}

func ErrImport(detail string) error {
	return kernel.E(kernel.Invalid, "INVALID_IMPORT_FILE", "Import file is invalid: "+detail)
}

type User struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	FullName        *string    `json:"fullName"`
	AvatarURL       *string    `json:"avatarUrl"`
	RoleID          string     `json:"roleId"`
	RoleName        string     `json:"roleName"`
	MitraID         *string    `json:"mitraId"`
	MitraKode       *string    `json:"mitraKode"`
	IsActive        bool       `json:"isActive"`
	Invited         bool       `json:"invited"`
	EmailVerifiedAt *time.Time `json:"emailVerifiedAt"`
	DeletedAt       *time.Time `json:"deletedAt"`
	LastLoginAt     *time.Time `json:"lastLoginAt"`
	CreatedAt       time.Time  `json:"createdAt"`
}

// Status is the export label: invited, active or inactive.
func (u User) Status() string {
	switch {
	case u.Invited:
		return "invited"
	case u.IsActive:
		return "active"
	}
	return "inactive"
}

type Changes struct {
	FullName *string
	RoleID   *string
	IsActive *bool
	MitraID  *string
}

// CheckUpdate enforces the update invariants and reports whether the
// change must sign the user out (role change, deactivation, or a mitra move).
func (u User) CheckUpdate(actorID string, c Changes) (revoke bool, err error) {
	if u.DeletedAt != nil {
		return false, ErrDeleted
	}
	mitraChanged := c.MitraID != nil && !samePtr(c.MitraID, u.MitraID)
	revoke = (c.RoleID != nil && *c.RoleID != u.RoleID) || (c.IsActive != nil && !*c.IsActive) || mitraChanged
	if actorID == u.ID && revoke {
		return false, ErrModifySelf
	}
	return revoke, nil
}

func samePtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

type Filter struct {
	RoleID   *string
	IsActive *bool
	Deleted  bool
	Search   *string
	Sort     string // createdAt | email | fullName | lastLoginAt
	Order    string // asc | desc
	// MitraID, when set, limits the result to that mitra. It comes from the
	// caller's Resolved scope, never from request input.
	MitraID *string
}

type NewUser struct {
	ID, Email, FullName, RoleID string
	PasswordHash                *string
	MitraID                     *string
}

type Repository interface {
	Get(ctx context.Context, id string) (User, error)
	List(ctx context.Context, f Filter, limit, offset int32) ([]User, error)
	Count(ctx context.Context, f Filter) (int64, error)
	Create(ctx context.Context, u NewUser) error
	Update(ctx context.Context, id string, c Changes) error
	SetDeleted(ctx context.Context, id string, at *time.Time) error
	SetPassword(ctx context.Context, id, hash string) error
	RevokeSessions(ctx context.Context, id string) error
	// RevokeMitraSessions revokes every refresh family of a mitra's users.
	RevokeMitraSessions(ctx context.Context, mitraID string) error
	RoleExists(ctx context.Context, id string) (bool, error)
	// RoleName returns the role's name, or ErrInvalidRole when missing.
	RoleName(ctx context.Context, id string) (string, error)
	// RoleIDsByName maps lower-cased role names to IDs.
	RoleIDsByName(ctx context.Context) (map[string]string, error)
	ExistingEmails(ctx context.Context, emails []string) ([]string, error)
}

// Credentials is what users borrows from auth.
type Credentials interface {
	HashPassword(plain string) (string, error)
	SendInvite(ctx context.Context, userID, email string) error
}
