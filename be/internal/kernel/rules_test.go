package kernel_test

// Fast domain checks (no DB) for the rules most likely to regress.

import (
	"strings"
	"testing"
	"time"

	audit "govite/internal/audit/domain"
	rbac "govite/internal/rbac/domain"
	roles "govite/internal/roles/domain"
	users "govite/internal/users/domain"
)

func TestUserCheckUpdate(t *testing.T) {
	u := users.User{ID: "u1", RoleID: "r1", IsActive: true}
	off, other := false, "r2"
	cases := []struct {
		name       string
		actor      string
		c          users.Changes
		revoke     bool
		err        error
		deletedRow bool
	}{
		{"rename only", "admin", users.Changes{}, false, nil, false},
		{"role change revokes", "admin", users.Changes{RoleID: &other}, true, nil, false},
		{"deactivate revokes", "admin", users.Changes{IsActive: &off}, true, nil, false},
		{"self role change", "u1", users.Changes{RoleID: &other}, false, users.ErrModifySelf, false},
		{"deleted user", "admin", users.Changes{}, false, users.ErrDeleted, true},
	}
	for _, tc := range cases {
		row := u
		if tc.deletedRow {
			now := time.Now()
			row.DeletedAt = &now
		}
		revoke, err := row.CheckUpdate(tc.actor, tc.c)
		if revoke != tc.revoke || err != tc.err {
			t.Errorf("%s: got (%v,%v) want (%v,%v)", tc.name, revoke, err, tc.revoke, tc.err)
		}
	}
}

func TestAuditRedact(t *testing.T) {
	out := string(audit.Redact(map[string]any{"email": "a@b.c", "password": "x", "nested": []any{map[string]any{"key": "rk_secret", "ok": 1}}}))
	if strings.Contains(out, "rk_secret") || strings.Contains(out, `"password"`) || !strings.Contains(out, "a@b.c") {
		t.Fatalf("redact leaked or lost data: %s", out)
	}
}

func TestRoleRules(t *testing.T) {
	// Super Admin (system role with SuperAdminRoleID) is fully immutable
	super := roles.Role{ID: "019a0000-0000-7000-8000-000000000001", IsSystem: true, Name: "Super Admin"}
	if super.CanDelete() != roles.ErrSystem || super.CanSetPermissions() != roles.ErrSystem {
		t.Fatal("Super Admin must be immutable")
	}
	name := "Super Admin"
	if super.CanRename(&name) != nil {
		t.Fatal("same name is not a rename")
	}

	// MITRA_ADMIN (system role) can delete but CAN set permissions
	mitraAdmin := roles.Role{ID: "019a0000-0000-7000-8000-000000000002", IsSystem: true, Name: "MITRA_ADMIN"}
	if mitraAdmin.CanDelete() != roles.ErrSystem {
		t.Fatal("MITRA_ADMIN cannot be deleted")
	}
	if mitraAdmin.CanSetPermissions() != nil {
		t.Fatal("MITRA_ADMIN can set permissions")
	}

	// MITRA_STAFF (system role) can delete but CAN set permissions
	mitraStaff := roles.Role{ID: "019a0000-0000-7000-8000-000000000003", IsSystem: true, Name: "MITRA_STAFF"}
	if mitraStaff.CanDelete() != roles.ErrSystem {
		t.Fatal("MITRA_STAFF cannot be deleted")
	}
	if mitraStaff.CanSetPermissions() != nil {
		t.Fatal("MITRA_STAFF can set permissions")
	}

	// Custom system role (not Super Admin, not Mitra) - cannot delete, cannot set permissions
	otherSys := roles.Role{ID: "custom-sys-1", IsSystem: true, Name: "Other System"}
	if otherSys.CanDelete() != roles.ErrSystem {
		t.Fatal("other system role cannot be deleted")
	}
	if otherSys.CanSetPermissions() != nil {
		t.Fatal("other system role can set permissions (only Super Admin is locked)")
	}

	// Role with users cannot be deleted
	if (roles.Role{UserCount: 1}).CanDelete() != roles.ErrInUse {
		t.Fatal("role with users must not delete")
	}
	// Dropped guarded permission must be reported
	r := roles.Role{Permissions: []rbac.Grant{{Resource: "users", Action: "manage", Scope: "all"}}}
	if d := r.Dropped(nil); len(d) != 1 {
		t.Fatalf("dropping guarded users.manage must be reported, got %v", d)
	}
	// Unknown permission must be rejected
	if roles.ValidGrants([]rbac.Grant{{Resource: "nope", Action: "x", Scope: "all"}}) == nil {
		t.Fatal("unknown permission must be rejected")
	}
}
