// Categorized catalog for permission checkboxes in role management. Labels are
// display-only; the grant save/load path still uses resource.action keys.

export const PERMISSION_CATEGORIES = [
  "report",
  "tools",
  "administration",
  "other",
] as const

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
  report: "Report",
  tools: "Tools",
  administration: "Administration",
  other: "Lainnya",
}

export interface PermissionCatalogEntry {
  label: string
  category: PermissionCategory
}

export const PERMISSION_CATALOG: Record<string, PermissionCatalogEntry> = {
  "billing.view": { label: "Lihat Billing Tagihan", category: "report" },
  "billing.export": { label: "Export Billing Tagihan", category: "report" },
  "payments.view": { label: "Lihat History Payment", category: "report" },
  "payments.export": { label: "Export History Payment", category: "report" },

  "users.manage": { label: "Kelola Pengguna", category: "administration" },
  "users.view": { label: "Lihat Pengguna", category: "administration" },
  "roles.manage": { label: "Kelola Role", category: "administration" },
  "permissions.view": { label: "Lihat Permission", category: "administration" },
  "audit.view": { label: "Lihat Audit Log", category: "administration" },
  "settings.manage": { label: "Kelola Pengaturan", category: "administration" },
  "announcements.view": {
    label: "Lihat Pengumuman",
    category: "administration",
  },
  "announcements.manage": {
    label: "Kelola Pengumuman",
    category: "administration",
  },
  "webhooks.manage": { label: "Kelola Webhooks", category: "administration" },
  "apiKeys.manage": { label: "Kelola API Key", category: "administration" },
  "mitra.manage": { label: "Kelola Mitra", category: "administration" },
  "mitra.view": { label: "Lihat Mitra", category: "administration" },

  "va.view": { label: "Buat VA", category: "tools" },
  "va.create": { label: "Buat VA", category: "tools" },
}

/** Label + category for a `resource.action` key; unknown keys fall back to the
 *  "Lainnya" bucket so nothing silently disappears from the editor. */
export function permissionCatalogEntry(key: string): PermissionCatalogEntry {
  return PERMISSION_CATALOG[key] ?? { label: key, category: "other" }
}

export function permissionCategory(key: string): PermissionCategory {
  return permissionCatalogEntry(key).category
}
