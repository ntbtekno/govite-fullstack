import { describe, expect, it } from "vitest"
import { PageSkeleton } from "./page-skeleton"
import { BillingSkeleton } from "./billing-skeleton"
import { PaymentHistorySkeleton } from "./payment-history-skeleton"
import { DashboardSkeleton } from "./dashboard-skeleton"
import { render } from "@/test-utils"

describe("Skeleton components", () => {
  it("renders generic PageSkeleton with data-testid='page-skeleton'", async () => {
    const { host, unmount } = await render(<PageSkeleton />)
    const el = host.querySelector('[data-testid="page-skeleton"]')
    expect(el).not.toBeNull()
    await unmount()
  })

  it("renders BillingSkeleton with both data-testid='page-skeleton' and data-variant='billing-skeleton'", async () => {
    const { host, unmount } = await render(<BillingSkeleton />)
    const el = host.querySelector(
      '[data-testid="page-skeleton"][data-variant="billing-skeleton"]'
    )
    expect(el).not.toBeNull()

    const headers = Array.from(host.querySelectorAll("th")).map((th) =>
      th.textContent?.trim()
    )
    expect(headers).toEqual([
      "No VA",
      "Nama",
      "Deskripsi",
      "Nominal",
      "Tanggal Dibuat",
      "Jatuh Tempo",
      "Status",
    ])
    expect(headers).toHaveLength(7)
    await unmount()
  })

  it("renders PaymentHistorySkeleton with data-variant='payment-skeleton' and 6 columns", async () => {
    const { host, unmount } = await render(<PaymentHistorySkeleton />)
    const el = host.querySelector(
      '[data-testid="page-skeleton"][data-variant="payment-skeleton"]'
    )
    expect(el).not.toBeNull()

    const headers = Array.from(host.querySelectorAll("th")).map((th) =>
      th.textContent?.trim()
    )
    expect(headers).toEqual([
      "",
      "Tanggal Transaksi",
      "No VA / Referensi",
      "ID Transaksi",
      "Nominal",
      "Status",
    ])
    expect(headers).toHaveLength(6)
    await unmount()
  })

  it("renders DashboardSkeleton with data-variant='dashboard-skeleton' and 4 cards", async () => {
    const { host, unmount } = await render(<DashboardSkeleton />)
    const el = host.querySelector(
      '[data-testid="page-skeleton"][data-variant="dashboard-skeleton"]'
    )
    expect(el).not.toBeNull()

    const cards = host.querySelectorAll('[data-slot="card"]')
    expect(cards.length).toBe(4)
    await unmount()
  })

  it("never renders real data/status badge text in report skeletons", async () => {
    for (const ui of [
      <BillingSkeleton key="b" />,
      <PaymentHistorySkeleton key="p" />,
      <DashboardSkeleton key="d" />,
    ]) {
      const { host, unmount } = await render(ui)
      const text = host.textContent ?? ""
      // LIVE/Berhasil/Aktif are data/status values: they must be pulsing blocks.
      expect(text).not.toContain("LIVE")
      expect(text).not.toContain("Berhasil")
      expect(text).not.toContain("Aktif")
      // No coloured emerald badge markup either.
      expect(host.querySelector(".bg-emerald-100")).toBeNull()
      await unmount()
    }
  })
})
