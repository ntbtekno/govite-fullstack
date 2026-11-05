import { describe, expect, it } from "vitest"
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_LABELS,
  permissionCatalogEntry,
  permissionCategory,
} from "./permission-catalog"

describe("permission catalog", () => {
  it("groups the report permissions under Report", () => {
    for (const key of [
      "billing.view",
      "billing.export",
      "payments.view",
      "payments.export",
    ]) {
      expect(permissionCategory(key)).toBe("report")
    }
    expect(permissionCatalogEntry("billing.view").label).toBe(
      "Lihat Billing Tagihan"
    )
    expect(permissionCatalogEntry("payments.export").label).toBe(
      "Export History Payment"
    )
  })

  it("groups the existing permissions under Administration", () => {
    expect(permissionCategory("users.view")).toBe("administration")
    expect(permissionCategory("mitra.manage")).toBe("administration")
  })

  it("falls back to Lainnya for an unknown key", () => {
    expect(permissionCategory("something.unknown")).toBe("other")
    expect(permissionCatalogEntry("something.unknown")).toEqual({
      label: "something.unknown",
      category: "other",
    })
    expect(PERMISSION_CATEGORY_LABELS.other).toBe("Lainnya")
  })

  it("exposes the fixed category display order", () => {
    expect(PERMISSION_CATEGORIES).toEqual([
      "report",
      "tools",
      "administration",
      "other",
    ])
    expect(PERMISSION_CATEGORY_LABELS.report).toBe("Report")
    expect(PERMISSION_CATEGORY_LABELS.administration).toBe("Administration")
  })
})
