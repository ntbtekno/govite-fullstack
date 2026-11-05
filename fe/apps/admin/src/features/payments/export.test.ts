import { describe, expect, it } from "vitest"
import {
  fetchAllPaymentRows,
  getPaymentExportFilename,
  getDefaultPaymentDateRange,
  MAX_EXPORT_ROWS,
} from "./export"
import type { PaymentReportItem, ReportsListResponse } from "@/lib/reports-api"

function makeItem(idx: number): PaymentReportItem {
  return {
    id: `pay-${idx}`,
    txDate: "2026-11-01",
    vaNumber: `8808${String(idx).padStart(12, "0")}`,
    transactionAt: "2026-11-01T10:00:00Z",
    reference: `REF${idx}`,
    message: "Pembayaran berhasil",
    amount: idx * 25000,
    status: "success",
  }
}

describe("Payment export - fetchAllPaymentRows", () => {
  it("fetches single page when total <= pageSize", async () => {
    const mockFetcher = async (): Promise<ReportsListResponse<PaymentReportItem>> => ({
      items: [makeItem(1), makeItem(2)],
      total: 2,
      page: 1,
      pageSize: 100,
      summary: { count: 2, totalAmount: 75000 },
    })

    const rows = await fetchAllPaymentRows(
      { from: "2026-10-01", to: "2026-10-31" },
      mockFetcher
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe("pay-1")
  })

  it("pages through and stops exactly at total", async () => {
    const calls: number[] = []
    const mockFetcher = async (p: { page?: number }): Promise<ReportsListResponse<PaymentReportItem>> => {
      const page = p.page ?? 1
      calls.push(page)
      if (page === 1) {
        return {
          items: Array.from({ length: 100 }, (_, i) => makeItem(i + 1)),
          total: 210,
          page: 1,
          pageSize: 100,
          summary: { count: 210, totalAmount: 2000000 },
        }
      }
      if (page === 2) {
        return {
          items: Array.from({ length: 100 }, (_, i) => makeItem(i + 101)),
          total: 210,
          page: 2,
          pageSize: 100,
          summary: { count: 210, totalAmount: 2000000 },
        }
      }
      return {
        items: Array.from({ length: 10 }, (_, i) => makeItem(i + 201)),
        total: 210,
        page: 3,
        pageSize: 100,
        summary: { count: 210, totalAmount: 2000000 },
      }
    }

    const rows = await fetchAllPaymentRows(
      { from: "2026-10-01", to: "2026-10-31" },
      mockFetcher
    )
    expect(calls).toEqual([1, 2, 3])
    expect(rows).toHaveLength(210)
    expect(rows[0].id).toBe("pay-1")
    expect(rows[209].id).toBe("pay-210")
  })

  it("throws error when total exceeds MAX_EXPORT_ROWS", async () => {
    const mockFetcher = async (): Promise<ReportsListResponse<PaymentReportItem>> => ({
      items: [],
      total: MAX_EXPORT_ROWS + 1,
      page: 1,
      pageSize: 100,
      summary: { count: MAX_EXPORT_ROWS + 1, totalAmount: 0 },
    })

    await expect(
      fetchAllPaymentRows({ from: "2026-10-01", to: "2026-10-31" }, mockFetcher)
    ).rejects.toThrow(/melebihi batas maksimum/)
  })
})

describe("Payment export - helpers", () => {
  it("builds file name matching history-payment-<yyyymmdd>-<yyyymmdd>.xlsx", () => {
    const filename = getPaymentExportFilename("2026-10-06", "2026-11-05")
    expect(filename).toBe("history-payment-20261006-20261105.xlsx")
  })

  it("produces 30 days default range", () => {
    const fixedNow = new Date("2026-11-05T12:00:00Z")
    const { startDate, endDate } = getDefaultPaymentDateRange(fixedNow)
    expect(endDate).toBe("2026-11-05")
    expect(startDate).toBe("2026-10-06")
  })
})
