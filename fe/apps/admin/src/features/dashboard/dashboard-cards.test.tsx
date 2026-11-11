import { afterEach, describe, expect, it } from "vitest"
import { render } from "@/test-utils"
import { LoginTerakhirCard } from "./login-terakhir-card"
import { TransaksiBulanIniCard } from "./transaksi-bulan-ini-card"
import type { DailyPoint, MonthlyTransactions } from "@/lib/dashboard-api"

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function buildMonth(): DailyPoint[] {
  const now = new Date()
  const total = daysInMonth(now.getFullYear(), now.getMonth())
  return Array.from({ length: total }, (_, i) => {
    const day = String(i + 1).padStart(2, "0")
    const month = String(now.getMonth() + 1).padStart(2, "0")
    return { date: `${now.getFullYear()}-${month}-${day}`, count: i % 3 }
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("TransaksiBulanIniCard", () => {
  it("renders one bar per day of the running month and the correct total", async () => {
    const days = buildMonth()
    const total = days.reduce((sum, d) => sum + d.count, 0)
    const monthly: MonthlyTransactions = { unavailable: false, total, days }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} />
    )

    const bars = host.querySelectorAll('[data-testid="transaksi-bar"]')
    expect(bars.length).toBe(days.length)

    const expectedTotal = new Intl.NumberFormat("id-ID").format(total)
    expect(host.textContent).toContain(`${expectedTotal} transaksi`)

    // Each bar carries a "date — N transaksi" title/tooltip.
    expect(bars[0].getAttribute("title")).toBe(
      `${days[0].date} — ${days[0].count} transaksi`
    )

    await unmount()
  })

  it("shows the unavailable message when the reports DB is not configured", async () => {
    const monthly: MonthlyTransactions = {
      unavailable: true,
      total: 0,
      days: [],
    }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} />
    )

    expect(host.textContent).toContain("Sumber data laporan belum tersedia.")
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(0)

    await unmount()
  })
})

describe("LoginTerakhirCard", () => {
  it("renders the time, IP and derived device label", async () => {
    const lastLogin = {
      at: "2026-11-10T08:30:00Z",
      ip: "10.1.2.3",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    const { host, unmount } = await render(
      <LoginTerakhirCard lastLogin={lastLogin} />
    )

    expect(host.textContent).toContain("10.1.2.3")
    expect(
      host.querySelector('[data-testid="login-perangkat"]')?.textContent
    ).toBe("Chrome · macOS")
    // The formatted timestamp is not the raw ISO string.
    expect(host.textContent).not.toContain("2026-11-10T08:30:00Z")

    await unmount()
  })

  it("shows a sensible empty state when there is no login record", async () => {
    const { host, unmount } = await render(<LoginTerakhirCard lastLogin={null} />)

    expect(host.textContent).toContain("Belum ada catatan login")

    await unmount()
  })
})
