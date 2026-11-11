package application_test

import (
	"context"
	"testing"

	"govite/internal/kernel"
	rbac "govite/internal/rbac/domain"
	"govite/internal/roles/application"
	rolesdomain "govite/internal/roles/domain"
)

type mockRepo struct {
	roles map[string]rolesdomain.Role
}

func (m *mockRepo) Get(ctx context.Context, id string) (rolesdomain.Role, error) {
	r, ok := m.roles[id]
	if !ok {
		return rolesdomain.Role{}, kernel.E(kernel.NotFound, "ROLE_NOT_FOUND", "Role not found")
	}
	return r, nil
}

func (m *mockRepo) List(ctx context.Context, search *string, limit, offset int32) ([]rolesdomain.Role, int64, error) {
	return nil, 0, nil
}

func (m *mockRepo) Create(ctx context.Context, id, name string, description *string, requireTwoFactor bool) error {
	return nil
}

func (m *mockRepo) Update(ctx context.Context, id string, c rolesdomain.Changes) error {
	return nil
}

func (m *mockRepo) Delete(ctx context.Context, id string) error {
	return nil
}

func (m *mockRepo) OtherHolders(ctx context.Context, roleID, resource, action string) (int64, error) {
	return 1, nil // Always has other holders
}

func (m *mockRepo) SetPermissions(ctx context.Context, roleID string, gs []rbac.Grant) error {
	r := m.roles[roleID]
	r.Permissions = gs
	m.roles[roleID] = r
	return nil
}

type mockCache struct{}

func (m *mockCache) Invalidate(ctx context.Context, roleID string) {}

type mockTx struct{}

func (m *mockTx) Do(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

type mockAudit struct{}

func (m *mockAudit) Record(ctx context.Context, action, entityType, id string, before, after any) {}

func TestSetPermissions(t *testing.T) {
	repo := &mockRepo{
		roles: map[string]rolesdomain.Role{
			"019a0000-0000-7000-8000-000000000001": {ID: "019a0000-0000-7000-8000-000000000001", Name: "Super Admin", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "manage", Scope: "all"}}},
			"019a0000-0000-7000-8000-000000000002": {ID: "019a0000-0000-7000-8000-000000000002", Name: "MITRA_ADMIN", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "view", Scope: "mitra"}}},
			"019a0000-0000-7000-8000-000000000003": {ID: "019a0000-0000-7000-8000-000000000003", Name: "MITRA_STAFF", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "view", Scope: "mitra"}}},
			"custom-role":                          {ID: "custom-role", Name: "Custom Role", IsSystem: false, Permissions: []rbac.Grant{{Resource: "audit", Action: "view", Scope: "all"}}},
		},
	}

	svc := &application.Service{
		Repo:  repo,
		Cache: &mockCache{},
		Tx:    &mockTx{},
		Audit: &mockAudit{},
	}

	cases := []struct {
		name       string
		roleID     string
		grants     []rbac.Grant
		wantErr    bool
		errCode    string
		checkPerms func(t *testing.T, r rolesdomain.Role)
	}{
		{
			name:    "Super Admin rejected with SYSTEM_ROLE_IMMUTABLE",
			roleID:  "019a0000-0000-7000-8000-000000000001",
			grants:  []rbac.Grant{{Resource: "users", Action: "view", Scope: "all"}},
			wantErr: true,
			errCode: "SYSTEM_ROLE_IMMUTABLE",
		},
		{
			name:    "MITRA_ADMIN permissions accepted and saved",
			roleID:  "019a0000-0000-7000-8000-000000000002",
			grants:  []rbac.Grant{{Resource: "users", Action: "manage", Scope: "mitra"}, {Resource: "users", Action: "view", Scope: "mitra"}},
			wantErr: false,
			checkPerms: func(t *testing.T, r rolesdomain.Role) {
				if len(r.Permissions) != 2 {
					t.Fatalf("expected 2 permissions, got %d", len(r.Permissions))
				}
				foundManage := false
				foundView := false
				for _, p := range r.Permissions {
					if p.Resource == "users" && p.Action == "manage" && p.Scope == "mitra" {
						foundManage = true
					}
					if p.Resource == "users" && p.Action == "view" && p.Scope == "mitra" {
						foundView = true
					}
				}
				if !foundManage || !foundView {
					t.Fatalf("permissions not saved correctly: %v", r.Permissions)
				}
			},
		},
		{
			name:    "MITRA_STAFF permissions accepted and saved",
			roleID:  "019a0000-0000-7000-8000-000000000003",
			grants:  []rbac.Grant{{Resource: "users", Action: "view", Scope: "mitra"}, {Resource: "audit", Action: "view", Scope: "all"}},
			wantErr: false,
			checkPerms: func(t *testing.T, r rolesdomain.Role) {
				if len(r.Permissions) != 2 {
					t.Fatalf("expected 2 permissions, got %d", len(r.Permissions))
				}
			},
		},
		{
			name:    "custom non-system role permissions accepted and saved",
			roleID:  "custom-role",
			grants:  []rbac.Grant{{Resource: "settings", Action: "manage", Scope: "all"}},
			wantErr: false,
			checkPerms: func(t *testing.T, r rolesdomain.Role) {
				if len(r.Permissions) != 1 || r.Permissions[0].Resource != "settings" {
					t.Fatalf("permissions not saved correctly: %v", r.Permissions)
				}
			},
		},
		{
			name:    "invalid permission rejected",
			roleID:  "custom-role",
			grants:  []rbac.Grant{{Resource: "nope", Action: "view", Scope: "all"}},
			wantErr: true,
			errCode: "VALIDATION_ERROR",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Reset repo for each test
			repo.roles = map[string]rolesdomain.Role{
				"019a0000-0000-7000-8000-000000000001": {ID: "019a0000-0000-7000-8000-000000000001", Name: "Super Admin", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "manage", Scope: "all"}}},
				"019a0000-0000-7000-8000-000000000002": {ID: "019a0000-0000-7000-8000-000000000002", Name: "MITRA_ADMIN", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "view", Scope: "mitra"}}},
				"019a0000-0000-7000-8000-000000000003": {ID: "019a0000-0000-7000-8000-000000000003", Name: "MITRA_STAFF", IsSystem: true, Permissions: []rbac.Grant{{Resource: "users", Action: "view", Scope: "mitra"}}},
				"custom-role":                          {ID: "custom-role", Name: "Custom Role", IsSystem: false, Permissions: []rbac.Grant{{Resource: "audit", Action: "view", Scope: "all"}}},
			}

			r, err := svc.SetPermissions(context.Background(), tc.roleID, tc.grants, nil)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tc.errCode != "" {
					// Check error code via type assertion
					ke, ok := err.(*kernel.Error)
					if !ok || ke.Code != tc.errCode {
						t.Fatalf("expected error code %s, got %v", tc.errCode, err)
					}
				}
			} else {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				if tc.checkPerms != nil {
					tc.checkPerms(t, r)
				}
			}
		})
	}
}
