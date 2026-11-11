package domain_test

import (
	"testing"

	rbac "govite/internal/rbac/domain"
	"govite/internal/roles/domain"
)

func TestCanSetPermissions(t *testing.T) {
	cases := []struct {
		name    string
		role    domain.Role
		wantErr bool
	}{
		{
			name:    "Super Admin cannot set permissions",
			role:    domain.Role{ID: "019a0000-0000-7000-8000-000000000001", IsSystem: true, Name: "Super Admin"},
			wantErr: true,
		},
		{
			name:    "MITRA_ADMIN can set permissions",
			role:    domain.Role{ID: "019a0000-0000-7000-8000-000000000002", IsSystem: true, Name: "MITRA_ADMIN"},
			wantErr: false,
		},
		{
			name:    "MITRA_STAFF can set permissions",
			role:    domain.Role{ID: "019a0000-0000-7000-8000-000000000003", IsSystem: true, Name: "MITRA_STAFF"},
			wantErr: false,
		},
		{
			name:    "custom system role can set permissions (only Super Admin is locked)",
			role:    domain.Role{ID: "custom-sys-1", IsSystem: true, Name: "Other System"},
			wantErr: false,
		},
		{
			name:    "non-system role can set permissions",
			role:    domain.Role{ID: "custom-role-1", IsSystem: false, Name: "Custom Role"},
			wantErr: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.role.CanSetPermissions()
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if err != domain.ErrSystem {
					t.Fatalf("expected ErrSystem, got %v", err)
				}
			} else {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
			}
		})
	}
}

func TestValidGrants(t *testing.T) {
	cases := []struct {
		name    string
		grants  []rbac.Grant
		wantErr bool
	}{
		{
			name: "valid grants",
			grants: []rbac.Grant{
				{Resource: "users", Action: "manage", Scope: "all"},
				{Resource: "users", Action: "view", Scope: "mitra"},
			},
			wantErr: false,
		},
		{
			name:    "unknown resource",
			grants:  []rbac.Grant{{Resource: "nope", Action: "view", Scope: "all"}},
			wantErr: true,
		},
		{
			name:    "unknown action",
			grants:  []rbac.Grant{{Resource: "users", Action: "nope", Scope: "all"}},
			wantErr: true,
		},
		{
			name:    "unknown scope",
			grants:  []rbac.Grant{{Resource: "users", Action: "view", Scope: "nope"}},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domain.ValidGrants(tc.grants)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
			} else {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
			}
		})
	}
}

func TestDropped(t *testing.T) {
	role := domain.Role{
		Permissions: []rbac.Grant{
			{Resource: "users", Action: "manage", Scope: "all"},
			{Resource: "users", Action: "view", Scope: "all"},
			{Resource: "roles", Action: "manage", Scope: "all"},
		},
	}

	// Drop users.manage (guarded)
	next := []rbac.Grant{
		{Resource: "users", Action: "view", Scope: "all"},
		{Resource: "roles", Action: "manage", Scope: "all"},
	}
	dropped := role.Dropped(next)
	if len(dropped) != 1 || dropped[0].Resource != "users" || dropped[0].Action != "manage" {
		t.Fatalf("expected users.manage dropped, got %v", dropped)
	}

	// Drop nothing
	next = role.Permissions
	dropped = role.Dropped(next)
	if len(dropped) != 0 {
		t.Fatalf("expected no dropped, got %v", dropped)
	}

	// Drop non-guarded (roles.manage IS guarded, so it will be dropped)
	next = []rbac.Grant{
		{Resource: "users", Action: "manage", Scope: "all"},
	}
	dropped = role.Dropped(next)
	if len(dropped) != 1 || dropped[0].Resource != "roles" || dropped[0].Action != "manage" {
		t.Fatalf("expected roles.manage dropped (guarded), got %v", dropped)
	}
}
