package policy

import "testing"

func TestCatalogContainsVAPermissions(t *testing.T) {
	for _, p := range []Permission{{Resource: "va", Action: "view"}, {Resource: "va", Action: "create"}} {
		found := false
		for _, existing := range Permissions {
			if existing.Resource == p.Resource && existing.Action == p.Action {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("permission %s not in catalog", p.Key())
		}
	}

	hasResource := false
	for _, r := range Resources {
		if r == "va" {
			hasResource = true
			break
		}
	}
	if !hasResource {
		t.Error("resource 'va' not in Resources")
	}
}

func TestMitraToolsPermissions(t *testing.T) {
	expected := []Permission{{Resource: "va", Action: "view"}, {Resource: "va", Action: "create"}}
	if len(MitraToolsPermissions) != len(expected) {
		t.Fatalf("MitraToolsPermissions has %d items, want %d", len(MitraToolsPermissions), len(expected))
	}
	for i, p := range MitraToolsPermissions {
		if p.Resource != expected[i].Resource || p.Action != expected[i].Action {
			t.Errorf("MitraToolsPermissions[%d] = %s, want %s", i, p.Key(), expected[i].Key())
		}
	}
}

func TestSuperAdminPermissionsExcludesVA(t *testing.T) {
	for _, p := range SuperAdminPermissions() {
		if p.Resource == "va" {
			t.Errorf("SuperAdminPermissions should not include %s", p.Key())
		}
	}
}
