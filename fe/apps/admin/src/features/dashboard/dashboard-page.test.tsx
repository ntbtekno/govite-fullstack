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

    // The mitra transaction card renders only after the summary query resolves;
    // wait for it so the assertions below are not flaky on query timing.
    await waitForElement('[data-testid="transaksi-bulan-ini-card"]')

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

const setNativeValue = (element: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set
  const prototype = Object.getPrototypeOf(element)
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    prototype,
    "value"
  )?.set

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value)
  } else if (valueSetter) {
    valueSetter.call(element, value)
  } else {
    element.value = value
  }
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

// Polls the DOM up to ~1s for `cond` to become true, flushing React Query
// between attempts so an in-flight refetch has time to resolve and render.
async function waitForCondition(cond: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    await flush(10)
    if (cond()) return
  }
  throw new Error(`timed out waiting for: ${label}`)
}

// Waits for a selector to exist in the DOM before returning it.
async function waitForElement(selector: string): Promise<Element> {
  await waitForCondition(
    () => document.querySelector(selector) !== null,
    `element ${selector} to render`
  )
  return document.querySelector(selector)!
}

function mitraUser() {
  state.user = {
    id: "u1",
    email: "mitra@app.local",
    fullName: "Mitra User",
    roleName: "Mitra Admin",
    permissions: [],
    mitraId: "mitra-1",
  }
}

function summaryFor(from: string, _to: string, days: number) {
  // Build an inclusive day list from `from` for `days` days (YYYY-MM-DD).
  const start = new Date(from + "T00:00:00Z")
  const out: { date: string; count: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
    out.push({ date: d.toISOString().split("T")[0], count: 0 })
  }
  return {
    lastLogin: null,
    monthlyTransactions: { unavailable: false, total: 0, days: out },
  }
}

describe("DashboardPage date range draft/apply", () => {
  it("does not call the API while the user types the date inputs", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { unmount } = await renderWithClient(<DashboardPage />)

    // Wait for the first summary to resolve and the card inputs to mount.
    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement

    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length

    await act(async () => {
      setNativeValue(fromInput, "2026-11-05")
    })
    await act(async () => {
      setNativeValue(toInput, "2026-11-10")
    })
    await flush()

    // Editing the draft must NOT trigger a refetch.
    expect(vi.mocked(dashboardApi.summary).mock.calls.length).toBe(callsBefore)

    await unmount()
  })

  it("applies the draft with a single refetch carrying the chosen from/to", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { unmount } = await renderWithClient(<DashboardPage />)

    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => {
      setNativeValue(fromInput, "2026-11-05")
    })
    await act(async () => {
      setNativeValue(toInput, "2026-11-10")
    })
    await flush()

    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length
    const applyButton = (await waitForElement(
      '[data-testid="dashboard-apply-btn"]'
    )) as HTMLButtonElement
    await act(async () => {
      applyButton.click()
    })
    await flush()

    // React Query starts a new fetch when the applied range changes; poll until
    // the refetch lands with the chosen bounds.
    await waitForCondition(
      () => vi.mocked(dashboardApi.summary).mock.calls.length === callsBefore + 1,
      "single refetch after Apply"
    )

    const calls = vi.mocked(dashboardApi.summary).mock.calls
    expect(calls[calls.length - 1][0]).toEqual({
      from: "2026-11-05",
      to: "2026-11-10",
    })

    await unmount()
  })

  it("blocks a reversed draft on Apply: shows a message, no API call, chart unchanged", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { host, unmount } = await renderWithClient(<DashboardPage />)

    const barsBefore = (await waitForElement(
      '[data-testid="transaksi-bar"]'
    ))
      ? host.querySelectorAll('[data-testid="transaksi-bar"]').length
      : 0

    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => {
      setNativeValue(fromInput, "2026-11-20")
    })
    await act(async () => {
      setNativeValue(toInput, "2026-11-05")
    })
    await flush()

    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length
    const applyButton = (await waitForElement(
      '[data-testid="dashboard-apply-btn"]'
    )) as HTMLButtonElement
    // The Apply button is disabled for a reversed draft; a programmatic click
    // must not reach the handler either.
    await act(async () => {
      applyButton.click()
    })
    await flush()

    expect(
      host.textContent
    ).toContain("Tanggal Dari tidak boleh melebihi tanggal Sampai")
    expect(vi.mocked(dashboardApi.summary).mock.calls.length).toBe(callsBefore)
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(
      barsBefore
    )

    await unmount()
  })

  it("renders one bar per day of the applied range and resets to the running month", async () => {
    mitraUser()
    // Answer every call from the requested bounds: the default running month
    // yields 30 bars, the applied 2026-11-05..2026-11-10 range yields 6.
    vi.mocked(dashboardApi.summary).mockImplementation(async (params) => {
      if (params?.from === "2026-11-05" && params?.to === "2026-11-10") {
        return summaryFor("2026-11-05", "2026-11-10", 6)
      }
      return summaryFor("2026-11-01", "2026-11-30", 30)
    })
    const { host, unmount } = await renderWithClient(<DashboardPage />)

    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => {
      setNativeValue(fromInput, "2026-11-05")
    })
    await act(async () => {
      setNativeValue(toInput, "2026-11-10")
    })
    await flush()

    const applyButton = (await waitForElement(
      '[data-testid="dashboard-apply-btn"]'
    )) as HTMLButtonElement
    await act(async () => {
      applyButton.click()
    })
    await flush()

    await waitForCondition(
      () => host.querySelectorAll('[data-testid="transaksi-bar"]').length === 6,
      "six bars after applying the range"
    )

    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(6)

    // "Bulan ini" restores both the draft and the applied range to the running
    // month, triggering one more refetch with the default bounds.
    const resetButton = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Bulan ini")
    ) as HTMLButtonElement
    expect(resetButton).toBeDefined()
    await act(async () => {
      resetButton.click()
    })
    await flush()

    await waitForCondition(
      () => {
        const calls = vi.mocked(dashboardApi.summary).mock.calls
        const last = calls[calls.length - 1]
        return Boolean(last?.[0]?.from && last?.[0]?.to)
      },
      "reset refetch with default bounds"
    )

    const calls = vi.mocked(dashboardApi.summary).mock.calls
    const lastFrom = calls[calls.length - 1][0]?.from
    const lastTo = calls[calls.length - 1][0]?.to
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    expect(lastFrom).toBe(`${now.getFullYear()}-${mm}-01`)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    expect(lastTo).toBe(`${now.getFullYear()}-${mm}-${String(lastDay).padStart(2, "0")}`)

    await unmount()
  })
})
