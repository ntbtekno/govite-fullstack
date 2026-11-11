import { describe, expect, it } from "vitest"

const SUPER_ADMIN_ROLE_ID = "019a0000-0000-7000-8000-000000000001"
const MITRA_ADMIN_ROLE_ID = "019a0000-0000-7000-8000-000000000002"
const MITRA_STAFF_ROLE_ID = "019a0000-0000-7000-8000-000000000003"

function canEditPermissions(role: { id: string; isSystem: boolean }): boolean {
  const isSuperAdmin = role.id === SUPER_ADMIN_ROLE_ID
  const isMitraSystemRole = role.id === MITRA_ADMIN_ROLE_ID || role.id === MITRA_STAFF_ROLE_ID
  return !isSuperAdmin && (!role.isSystem || isMitraSystemRole)
}

describe("permission editor - canEditPermissions", () => {
  it("Super Admin: cannot edit permissions", () => {
    const role = { id: SUPER_ADMIN_ROLE_ID, isSystem: true }
    expect(canEditPermissions(role)).toBe(false)
  })

  it("MITRA_ADMIN: can edit permissions", () => {
    const role = { id: MITRA_ADMIN_ROLE_ID, isSystem: true }
    expect(canEditPermissions(role)).toBe(true)
  })

  it("MITRA_STAFF: can edit permissions", () => {
    const role = { id: MITRA_STAFF_ROLE_ID, isSystem: true }
    expect(canEditPermissions(role)).toBe(true)
  })

  it("custom non-system role: can edit permissions", () => {
    const role = { id: "custom-role-123", isSystem: false }
    expect(canEditPermissions(role)).toBe(true)
  })

  it("system role that is not Super Admin or Mitra: cannot edit permissions", () => {
    const role = { id: "custom-sys-1", isSystem: true }
    expect(canEditPermissions(role)).toBe(false)
  })
})
