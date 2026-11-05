import { describe, expect, it } from "vitest"
import {
  filterByRange,
  getBillingExportFilename,
  getDefaultBillingDateRange,
} from "./export"
import type { BillingRow } from "./mock"

function makeRow(id: string, date: string, amount = 100000): BillingRow {
  return {
    id,
    vaNumber: "8808123456789012",
    payerName: "Nasabah Test",
    description: "Tagihan Test",
    amount,
    createdAt: `${date}T10:00:00.000Z`,
    dueAt: `${date}T10:00:00.000Z`,
    status: "unpaid",
  }
}

describe("Billing export - filterByRange", () => {
  const rows: BillingRow[] = [
    makeRow("b1", "2026-10-01"),
    makeRow("b2", "2026-10-15"),
    makeRow("b3", "2026-10-31"),
    makeRow("b4", "2026-11-01"),
    makeRow("b5", "2026-11-05"),
  ]

  it("termasuk batas inklusif di kedua ujung rentang tanggal", () => {
    const result = filterByRange(rows, "2026-10-15", "2026-11-01")
    expect(result.map((r) => r.id)).toEqual(["b2", "b3", "b4"])
  })

  it("menolak baris di luar rentang tanggal", () => {
    const result = filterByRange(rows, "2026-10-10", "2026-10-20")
    expect(result.map((r) => r.id)).toEqual(["b2"])
    expect(result.some((r) => r.id === "b1" || r.id === "b3")).toBe(false)
  })

  it("menghasilkan array kosong bila tidak ada data dalam rentang", () => {
    const result = filterByRange(rows, "2026-09-01", "2026-09-30")
    expect(result).toHaveLength(0)
  })

  it("menghasilkan array kosong jika tanggal selesai lebih awal dari tanggal mulai", () => {
    const result = filterByRange(rows, "2026-11-05", "2026-10-01")
    expect(result).toHaveLength(0)
  })
})

describe("Billing export - getBillingExportFilename", () => {
  it("membangun nama file sesuai pola billing-tagihan-<yyyymmdd>-<yyyymmdd>.xlsx", () => {
    const filename = getBillingExportFilename("2026-10-06", "2026-11-05")
    expect(filename).toBe("billing-tagihan-20261006-20261105.xlsx")
  })

  it("membuat rentang tanggal default 30 hari terakhir", () => {
    const fixedNow = new Date("2026-11-05T12:00:00Z")
    const { startDate, endDate } = getDefaultBillingDateRange(fixedNow)
    expect(endDate).toBe("2026-11-05")
    expect(startDate).toBe("2026-10-06")
  })
})
