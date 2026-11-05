import { describe, expect, it } from "vitest"
import {
  filterByRange,
  getPaymentExportFilename,
  getDefaultPaymentDateRange,
} from "./export"
import type { PaymentRow } from "./mock"

function makeRow(id: string, date: string, amount = 100000): PaymentRow {
  return {
    id,
    transactionAt: `${date}T10:00:00.000Z`,
    vaNumber: "8808123456789012",
    payerName: "Nasabah Test",
    amount,
    channel: "BNI VA",
    status: "success",
    reference: "REF1234567890",
  }
}

describe("Payment export - filterByRange", () => {
  const rows: PaymentRow[] = [
    makeRow("p1", "2026-10-01"),
    makeRow("p2", "2026-10-15"),
    makeRow("p3", "2026-10-31"),
    makeRow("p4", "2026-11-01"),
    makeRow("p5", "2026-11-05"),
  ]

  it("termasuk batas inklusif di kedua ujung rentang tanggal", () => {
    const result = filterByRange(rows, "2026-10-15", "2026-11-01")
    expect(result.map((r) => r.id)).toEqual(["p2", "p3", "p4"])
  })

  it("menolak baris di luar rentang tanggal", () => {
    const result = filterByRange(rows, "2026-10-10", "2026-10-20")
    expect(result.map((r) => r.id)).toEqual(["p2"])
    expect(result.some((r) => r.id === "p1" || r.id === "p3")).toBe(false)
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

describe("Payment export - getPaymentExportFilename", () => {
  it("membangun nama file sesuai pola history-payment-<yyyymmdd>-<yyyymmdd>.xlsx", () => {
    const filename = getPaymentExportFilename("2026-10-06", "2026-11-05")
    expect(filename).toBe("history-payment-20261006-20261105.xlsx")
  })

  it("membuat rentang tanggal default 30 hari terakhir", () => {
    const fixedNow = new Date("2026-11-05T12:00:00Z")
    const { startDate, endDate } = getDefaultPaymentDateRange(fixedNow)
    expect(endDate).toBe("2026-11-05")
    expect(startDate).toBe("2026-10-06")
  })
})
