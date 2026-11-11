import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DashboardPage } from "./dashboard-page"
import { render } from "@/test-utils"
import { dashboardApi } from "@/lib/dashboard-api"

const state = vi.hoisted(() => ({ user: null as unknown }))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: state.user }),
}))

vi.mock("@/features/announcements/dashboard-announcements", () => ({
  DashboardAnnouncements: () => null,
}))

vi.mock("@/lib/dashboard-api", () => ({
  dashboardApi: { summary: vi.fn() },
}))

const renderWithClient = (ui: React.ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe("DashboardPage dashboard cards", () => {
  it("renders both cards for a mitra session", async () => {
    state.user = {
      id: "u1",
      email: "mitra@app.local",
      fullName: "Mitra User",
      roleName: "Mitra Admin",
      permissions: [],
      mitraId: "mitra-1",
    }
    vi.mocked(dashboardApi.summary).mockResolvedValue({
      lastLogin: {
        at: "2026-11-10T08:30:00Z",
        ip: "10.1.2.3",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0 Safari/537.36",
      },
      monthlyTransactions: {
        unavailable: false,
        total: 4,
        days: [
          { date: "2026-11-01", count: 1 },
          { date: "2026-11-02", count: 3 },
        ],
      },
    })

    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await flush()

    expect(
      host.querySelector('[data-testid="login-terakhir-card"]')
    ).not.toBeNull()
    expect(
      host.querySelector('[data-testid="transaksi-bulan-ini-card"]')
    ).not.toBeNull()
    expect(host.textContent).toContain("10.1.2.3")
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(2)

    await unmount()
  })

  it("hides the transaction card for a non-mitra session", async () => {
    state.user = {
      id: "u2",
      email: "admin@app.local",
      fullName: "Super Admin",
      roleName: "Super Admin",
      permissions: [],
      mitraId: null,
    }
    vi.mocked(dashboardApi.summary).mockResolvedValue({
      lastLogin: {
        at: "2026-11-10T08:30:00Z",
        ip: "10.1.2.3",
        userAgent: "Chrome/120",
      },
      monthlyTransactions: null,
    })

    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await flush()

    expect(
      host.querySelector('[data-testid="login-terakhir-card"]')
    ).not.toBeNull()
    expect(
      host.querySelector('[data-testid="transaksi-bulan-ini-card"]')
    ).toBeNull()

    await unmount()
  })
})
