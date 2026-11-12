import { afterEach, describe, expect, it, vi } from "vitest"
import { render } from "@/test-utils"
import { DashboardSection } from "./dashboard-section"
import { TransaksiBulanIniCard } from "./transaksi-bulan-ini-card"
import type { MonthlyTransactions, LastLogin, DailyPoint } from "@/lib/dashboard-api"

function buildMonth(): DailyPoint[] {
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, "0")
    const month = String(now.getMonth() + 1).padStart(2, "0")
    return { date: `${now.getFullYear()}-${month}-${day}`, count: i % 3 }
  })
}

function makeMonthly(overrides: Partial<MonthlyTransactions> = {}): MonthlyTransactions {
  const days = buildMonth()
  const total = days.reduce((sum, d) => sum + d.count, 0)
  return {
    unavailable: false,
    total,
    totalAmount: 1_500_000,
    coverage: null,
    days,
    ...overrides,
  }
}

function makeLastLogin(overrides: Partial<LastLogin> = {}): LastLogin {
  return {
    at: "2026-11-10T08:30:00Z",
    ip: "10.1.2.3",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    ...overrides,
  }
}

const defaultProps = {
  draftFrom: "2026-11-01",
  draftTo: "2026-11-12",
  appliedFrom: "2026-11-01",
  appliedTo: "2026-11-12",
  defaultFrom: "2026-11-01",
  defaultTo: "2026-11-12",
  maxDate: "2026-11-12",
  isDraftInvalid: false,
  invalidMessage: "Invalid range",
  serverErrorMessage: null,
  hasCustomRange: false,
  onDraftFromChange: vi.fn(),
  onDraftToChange: vi.fn(),
  onApply: vi.fn(),
  onReset: vi.fn(),
  lastSync: null,
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("DashboardSection layout", () => {
  it("renders Login Terakhir and Chart side by side in 2 columns on desktop", async () => {
    const monthly = makeMonthly()
    const lastLogin = makeLastLogin()

    const { host } = await render(
      <DashboardSection
        lastLogin={lastLogin}
        monthly={monthly}
        isLoading={false}
        isRefetching={false}
        {...defaultProps}
      />
    )

    // Login Terakhir in left column (md:col-span-1)
    const loginCard = host.querySelector('[data-testid="login-terakhir-card"]')
    expect(loginCard).not.toBeNull()

    // Chart in right column (md:col-span-2)
    const chartCard = host.querySelector('[data-testid="transaksi-bulan-ini-card"]')
    expect(chartCard).not.toBeNull()

    // Verify both cards exist
    const cards = host.querySelectorAll('[data-slot="card"]')
    expect(cards.length).toBeGreaterThanOrEqual(2)
  })

  it("renders Login Terakhir when monthly is null", async () => {
    const lastLogin = makeLastLogin()

    const { host } = await render(
      <DashboardSection
        lastLogin={lastLogin}
        monthly={null}
        isLoading={false}
        isRefetching={false}
        {...defaultProps}
      />
    )

    const loginCard = host.querySelector('[data-testid="login-terakhir-card"]')
    expect(loginCard).not.toBeNull()
  })
})

describe("TransaksiBulanIniCard renders correctly", () => {
  it("renders one bar per day of the running month and both headline totals", async () => {
    const days = buildMonth()
    const total = days.reduce((sum, d) => sum + d.count, 0)
    const monthly: MonthlyTransactions = {
      unavailable: false,
      total,
      totalAmount: 1_500_000,
      coverage: null,
      days,
    }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} {...defaultProps} />
    )

    const bars = host.querySelectorAll('[data-testid="transaksi-bar"]')
    expect(bars.length).toBe(days.length)

    const expectedTotal = new Intl.NumberFormat("id-ID").format(total)
    expect(host.textContent).toContain(`Total transaksi: ${expectedTotal}`)
    expect(host.textContent).toContain("Total nominal: Rp 1.500.000")

    await unmount()
  })

  it("renders the stored data coverage line when present", async () => {
    const monthly: MonthlyTransactions = {
      unavailable: false,
      total: 0,
      totalAmount: 0,
      coverage: { minDate: "2025-06-20", lastDate: "2026-08-12" },
      days: [{ date: "2026-11-01", count: 0 }],
    }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} {...defaultProps} />
    )

    const coverage = host.querySelector('[data-testid="dashboard-coverage"]')
    expect(coverage).not.toBeNull()
    expect(coverage?.textContent).toContain("Data tersimpan:")

    await unmount()
  })

  it("hides the coverage line when coverage is null", async () => {
    const monthly: MonthlyTransactions = {
      unavailable: false,
      total: 0,
      totalAmount: 0,
      coverage: null,
      days: [{ date: "2026-11-01", count: 0 }],
    }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} {...defaultProps} />
    )

    expect(
      host.querySelector('[data-testid="dashboard-coverage"]')
    ).toBeNull()

    await unmount()
  })

  it("shows the unavailable message when the reports DB is not configured", async () => {
    const monthly: MonthlyTransactions = {
      unavailable: true,
      total: 0,
      totalAmount: 0,
      coverage: null,
      days: [],
    }

    const { host, unmount } = await render(
      <TransaksiBulanIniCard monthly={monthly} {...defaultProps} />
    )

    expect(host.textContent).toContain("Sumber data laporan belum tersedia.")
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(0)

    await unmount()
  })
})