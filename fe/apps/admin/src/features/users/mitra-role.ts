// Mitra-managed role names: a user in either must be bound to a mitra.
const MITRA_ROLE_NAMES = new Set(["mitra_admin", "mitra_staff"])

export function isMitraRoleName(name: string | null | undefined): boolean {
  return !!name && MITRA_ROLE_NAMES.has(name.trim().toLowerCase())
}
