import { describe, expect, it } from "vitest"
import { buildReportQueryString } from "@/lib/reports-api"
import {
  fetchAllBillingRows,
  getBillingExportFilename,
  getDefaultBillingDateRange,
  MAX_EXPORT_ROWS,
} from "./export"
import type { BillingReportItem, ReportsListResponse } from "@/lib/reports-api"

function makeItem(idx: number): BillingReportItem {
  return {
    vaNumber: `8808${String(idx).padStart(12, "0")}`,
    payerName: `Nasabah ${idx}`,
    description: `Tagihan ${idx}`,
    amount: idx * 10000,
    createdAt: "2026-11-01T10:00:00Z",
    dueAt: "2026-11-08T10:00:00Z",
    status: "active",
    email: `n${idx}@test.local`,
    phone: "0812345678",
    billingType: "open",
    productId: "prod-1",
  }
}

describe("Reports API - buildReportQueryString", () => {
  it("forwards q, from, to, page, pageSize correctly", () => {
    const qs = buildReportQueryString({
      q: "budi",
      from: "2026-10-01",
      to: "2026-10-31",
      page: 2,
      pageSize: 50,
    })
    expect(qs).toBe("?q=budi&from=2026-10-01&to=2026-10-31&page=2&pageSize=50")
  })

  it("omits empty or undefined params", () => {
    expect(buildReportQueryString({})).toBe("")
    expect(buildReportQueryString({ q: "   " })).toBe("")
    expect(buildReportQueryString({ page: 1 })).toBe("?page=1")
  })
})

describe("Billing export - fetchAllBillingRows", () => {
  it("fetches single page when total <= pageSize", async () => {
    const mockFetcher = async (): Promise<ReportsListResponse<BillingReportItem>> => ({
      items: [makeItem(1), makeItem(2)],
      total: 2,
      page: 1,
      pageSize: 100,
      summary: { count: 2, totalAmount: 30000 },
    })

    const rows = await fetchAllBillingRows(
      { from: "2026-10-01", to: "2026-10-31" },
      mockFetcher
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].vaNumber).toBe("8808000000000001")
  })

  it("pages through and stops exactly at total", async () => {
    const calls: number[] = []
    const mockFetcher = async (p: { page?: number }): Promise<ReportsListResponse<BillingReportItem>> => {
      const page = p.page ?? 1
      calls.push(page)
      if (page === 1) {
        return {
          items: Array.from({ length: 100 }, (_, i) => makeItem(i + 1)),
          total: 250,
          page: 1,
          pageSize: 100,
          summary: { count: 250, totalAmount: 1000000 },
        }
      }
      if (page === 2) {
        return {
          items: Array.from({ length: 100 }, (_, i) => makeItem(i + 101)),
          total: 250,
          page: 2,
          pageSize: 100,
          summary: { count: 250, totalAmount: 1000000 },
        }
      }
      return {
        items: Array.from({ length: 50 }, (_, i) => makeItem(i + 201)),
        total: 250,
        page: 3,
        pageSize: 100,
        summary: { count: 250, totalAmount: 1000000 },
      }
    }

    const rows = await fetchAllBillingRows(
      { from: "2026-10-01", to: "2026-10-31" },
      mockFetcher
    )
    expect(calls).toEqual([1, 2, 3])
    expect(rows).toHaveLength(250)
    expect(rows[0].vaNumber).toBe("8808000000000001")
    expect(rows[249].vaNumber).toBe("8808000000000250")
  })

  it("throws error when total exceeds MAX_EXPORT_ROWS", async () => {
    const mockFetcher = async (): Promise<ReportsListResponse<BillingReportItem>> => ({
      items: [],
      total: MAX_EXPORT_ROWS + 1,
      page: 1,
      pageSize: 100,
      summary: { count: MAX_EXPORT_ROWS + 1, totalAmount: 0 },
    })

    await expect(
      fetchAllBillingRows({ from: "2026-10-01", to: "2026-10-31" }, mockFetcher)
    ).rejects.toThrow(/melebihi batas maksimum/)
  })
})

describe("Billing export - helpers", () => {
  it("builds file name matching billing-tagihan-<yyyymmdd>-<yyyymmdd>.xlsx", () => {
    const filename = getBillingExportFilename("2026-10-06", "2026-11-05")
    expect(filename).toBe("billing-tagihan-20261006-20261105.xlsx")
  })

  it("produces 30 days default range", () => {
    const fixedNow = new Date("2026-11-05T12:00:00Z")
    const { startDate, endDate } = getDefaultBillingDateRange(fixedNow)
    expect(endDate).toBe("2026-11-05")
    expect(startDate).toBe("2026-10-06")
  })
})
