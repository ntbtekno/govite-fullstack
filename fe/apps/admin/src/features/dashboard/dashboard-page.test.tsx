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
        totalAmount: 400_000,
        coverage: null,
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
    // Both headline totals render from the summary data.
    expect(host.textContent).toContain("Total transaksi: 4")
    expect(host.textContent).toContain("Total nominal: Rp 400.000")
    // The Role / Email / Permissions stat cards are gone.
    expect(host.textContent).not.toContain("Permissions")
    expect(
      host.querySelectorAll('[data-slot="card"]').length
    ).toBeLessThanOrEqual(3)

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
    monthlyTransactions: {
      unavailable: false,
      total: 0,
      totalAmount: 0,
      coverage: null,
      days: out,
    },
  }
}

describe("DashboardPage date range draft/apply", () => {
  it("does not call the API while the user types the date inputs", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { unmount } = await renderWithClient(<DashboardPage />)

    // Wait for the chart card to mount and its query to resolve (bars appear).
    await waitForElement('[data-testid="transaksi-bar"]')

    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length

    await act(async () => {
      setNativeValue((await waitForElement("#dashboard-filter-from")) as HTMLInputElement, "2026-11-05")
    })
    await act(async () => {
      setNativeValue((await waitForElement("#dashboard-filter-to")) as HTMLInputElement, "2026-11-10")
    })
    await flush()

    // Editing the draft must NOT trigger a refetch.
    expect(vi.mocked(dashboardApi.summary).mock.calls.length).toBe(callsBefore)

    await unmount()
  })

  it("applies the draft with a single chart refetch carrying the chosen from/to", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { unmount } = await renderWithClient(<DashboardPage />)

    // Wait for initial chart load (bars appear)
    await waitForElement('[data-testid="transaksi-bar"]')

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

    // React Query starts a new fetch for the chart card only; poll until
    // the refetch lands with the chosen bounds.
    await waitForCondition(
      () => vi.mocked(dashboardApi.summary).mock.calls.length === callsBefore + 1,
      "single chart refetch after Apply"
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

    // Wait for initial chart load
    await waitForElement('[data-testid="transaksi-bar"]')

    const barsBefore = host.querySelectorAll('[data-testid="transaksi-bar"]').length

    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => {
      setNativeValue(fromInput, "2026-11-05")
    })
    await act(async () => {
      setNativeValue(toInput, "2026-11-02")
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

  it("renders one bar per day of the applied range and resets to 1st..today", async () => {
    mitraUser()

    // Initial mock: return 30 days for all calls (page + chart initial)
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))

    const { host, unmount } = await renderWithClient(<DashboardPage />)

    // Wait for initial chart load (bars appear)
    await waitForElement('[data-testid="transaksi-bar"]')

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

    // Override mock for the NEXT call (the refetch after apply) to return 6 days
    vi.mocked(dashboardApi.summary).mockResolvedValueOnce(summaryFor("2026-11-05", "2026-11-10", 6))

    await act(async () => {
      applyButton.click()
    })
    await flush()

    // Restore default mock for subsequent calls (reset)
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-12", 12))

    await waitForCondition(
      () => host.querySelectorAll('[data-testid="transaksi-bar"]').length === 6,
      "six bars after applying the range"
    )

    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(6)

    // "Bulan ini" restores both the draft and the applied range to 1st..today,
    // triggering one more refetch with the default bounds.
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
        return Boolean(last?.[0]?.from && last?.[0]?.to && last[0].from.endsWith("-01"))
      },
      "reset refetch with default bounds"
    )

    const calls = vi.mocked(dashboardApi.summary).mock.calls
    const lastFrom = calls[calls.length - 1][0]?.from
    const lastTo = calls[calls.length - 1][0]?.to
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    expect(lastFrom).toBe(`${now.getFullYear()}-${mm}-01`)
    const today = `${now.getFullYear()}-${mm}-${String(now.getDate()).padStart(2, "0")}`
    expect(lastTo).toBe(today)

    await unmount()
  })

  it("blocks a future Sampai on Apply: message shown, no API call", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { host, unmount } = await renderWithClient(<DashboardPage />)

    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    // A date far in the future, guaranteed beyond today.
    await act(async () => {
      setNativeValue(toInput, "2999-12-31")
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

    expect(host.textContent).toContain("Tanggal Sampai tidak boleh melebihi hari ini")
    expect(vi.mocked(dashboardApi.summary).mock.calls.length).toBe(callsBefore)

    await unmount()
  })

  it("sets the max attribute of both inputs to today", async () => {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockResolvedValue(summaryFor("2026-11-01", "2026-11-30", 30))
    const { unmount } = await renderWithClient(<DashboardPage />)

    const fromInput = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const toInput = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

    expect(fromInput.getAttribute("max")).toBe(today)
    expect(toInput.getAttribute("max")).toBe(today)

    await unmount()
  })
})

describe("DashboardPage scoped chart refresh UX", () => {
  const login = {
    at: "2026-11-10T08:30:00Z",
    ip: "10.9.8.7",
    userAgent: "Chrome/120",
  }

  function setup() {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockImplementation(async (params) =>
      params
        ? summaryFor("2026-11-01", "2026-11-12", 12)
        : { lastLogin: login, monthlyTransactions: null },
    )
  }

  it("Terapkan memicu tepat satu fetch grafik tanpa fetch Login Terakhir", async () => {
    setup()
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await waitForElement('[data-testid="transaksi-bar"]')
    const before = vi.mocked(dashboardApi.summary).mock.calls.length
    const from = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const to = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => setNativeValue(from, "2026-11-05"))
    await act(async () => setNativeValue(to, "2026-11-10"))
    await act(async () => (await waitForElement('[data-testid="dashboard-apply-btn"]') as HTMLButtonElement).click())
    await waitForCondition(() => vi.mocked(dashboardApi.summary).mock.calls.length === before + 1, "chart fetch")
    expect(vi.mocked(dashboardApi.summary).mock.calls.at(-1)?.[0]).toEqual({ from: "2026-11-05", to: "2026-11-10" })
    expect(vi.mocked(dashboardApi.summary).mock.calls.filter(([p]) => !p)).toHaveLength(1)
    expect(host.textContent).toContain("10.9.8.7")
    await unmount()
  })

  it("menampilkan loader di kartu grafik selama refetch lalu menghilangkannya", async () => {
    setup()
    let release!: (value: ReturnType<typeof summaryFor>) => void
    const pending = new Promise<ReturnType<typeof summaryFor>>((resolve) => { release = resolve })
    vi.mocked(dashboardApi.summary).mockImplementation(async (params) => {
      if (!params) return { lastLogin: login, monthlyTransactions: null }
      if (params.from === "2026-11-05") return pending
      return summaryFor("2026-11-01", "2026-11-12", 12)
    })
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await waitForElement('[data-testid="transaksi-bar"]')
    await act(async () => setNativeValue((await waitForElement("#dashboard-filter-from")) as HTMLInputElement, "2026-11-05"))
    await act(async () => setNativeValue((await waitForElement("#dashboard-filter-to")) as HTMLInputElement, "2026-11-10"))
    await act(async () => (await waitForElement('[data-testid="dashboard-apply-btn"]') as HTMLButtonElement).click())
    await flush()
    await waitForElement('[data-testid="dashboard-chart-loader"]')
    expect(host.querySelector('[data-testid="dashboard-chart-loader"]')).not.toBeNull()
    release(summaryFor("2026-11-05", "2026-11-10", 6))
    await waitForCondition(() => host.querySelector('[data-testid="dashboard-chart-loader"]') === null, "loader selesai")
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]')).toHaveLength(6)
    await unmount()
  })

  it("mempertahankan isi kartu Login Terakhir selama refetch grafik", async () => {
    setup()
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await waitForElement('[data-testid="transaksi-bar"]')
    const loginBefore = host.querySelector('[data-testid="login-terakhir-card"]')?.textContent
    await act(async () => setNativeValue((await waitForElement("#dashboard-filter-from")) as HTMLInputElement, "2026-11-05"))
    await act(async () => setNativeValue((await waitForElement("#dashboard-filter-to")) as HTMLInputElement, "2026-11-10"))
    await act(async () => (await waitForElement('[data-testid="dashboard-apply-btn"]') as HTMLButtonElement).click())
    await flush()
    expect(host.querySelector('[data-testid="login-terakhir-card"]')?.textContent).toBe(loginBefore)
    await unmount()
  })

  it("menggunakan default terapan tanggal 1 sampai hari ini", async () => {
    setup()
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    const from = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const to = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    expect(from.value).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`)
    expect(to.value).toBe(today)
    expect(host.textContent).toContain("Transaksi Bulan Ini")
    await unmount()
  })

  it("Bulan ini mengembalikan draft dan rentang terapan ke default", async () => {
    setup()
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await waitForElement('[data-testid="transaksi-bar"]')
    const from = (await waitForElement("#dashboard-filter-from")) as HTMLInputElement
    const to = (await waitForElement("#dashboard-filter-to")) as HTMLInputElement
    await act(async () => setNativeValue(from, "2026-11-05"))
    await act(async () => setNativeValue(to, "2026-11-10"))
    await act(async () => (await waitForElement('[data-testid="dashboard-apply-btn"]') as HTMLButtonElement).click())
    await flush()
    // Wait for the apply refetch to settle so the reset button is re-enabled.
    const findReset = () =>
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Bulan ini")) as HTMLButtonElement | undefined
    await waitForCondition(() => {
      const btn = findReset()
      return Boolean(btn && !btn.disabled)
    }, "reset button enabled")
    const reset = findReset()
    expect(reset).toBeDefined()
    await act(async () => reset?.click())
    await flush()
    await waitForCondition(() => from.value.endsWith("-01"), "reset date")
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    expect(from.value).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`)
    expect(to.value).toBe(today)
    await unmount()
  })
})

describe("DashboardPage 1-month range limit", () => {
  // Past ranges so the `max=today` guard never interferes.
  const RANGE_31_FROM = "2026-06-01"
  const RANGE_31_TO = "2026-07-02" // to - from = 31 days, exactly the boundary
  const RANGE_32_FROM = "2026-06-01"
  const RANGE_32_TO = "2026-07-03" // to - from = 32 days, one over the boundary

  function setup() {
    mitraUser()
    vi.mocked(dashboardApi.summary).mockImplementation(async (params) =>
      params
        ? summaryFor(params.from ?? "2026-06-01", params.to ?? "2026-06-30", 10)
        : { lastLogin: null, monthlyTransactions: null },
    )
  }

  async function typeRange(from: string, to: string) {
    await waitForElement('[data-testid="transaksi-bar"]')
    await act(async () =>
      setNativeValue((await waitForElement("#dashboard-filter-from")) as HTMLInputElement, from)
    )
    await act(async () =>
      setNativeValue((await waitForElement("#dashboard-filter-to")) as HTMLInputElement, to)
    )
    await flush()
  }

  it("31-day range keeps Terapkan enabled and sends exactly one fetch", async () => {
    setup()
    const { unmount } = await renderWithClient(<DashboardPage />)
    await typeRange(RANGE_31_FROM, RANGE_31_TO)
    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length

    const apply = (await waitForElement('[data-testid="dashboard-apply-btn"]')) as HTMLButtonElement
    expect(apply.disabled).toBe(false)

    await act(async () => apply.click())
    await flush()

    await waitForCondition(
      () => vi.mocked(dashboardApi.summary).mock.calls.length === callsBefore + 1,
      "single fetch for a 31-day range"
    )
    expect(vi.mocked(dashboardApi.summary).mock.calls.at(-1)?.[0]).toEqual({
      from: RANGE_31_FROM,
      to: RANGE_31_TO,
    })
    await unmount()
  })

  it("32-day range disables Terapkan, shows the 1-month message, and makes zero API calls", async () => {
    setup()
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await typeRange(RANGE_32_FROM, RANGE_32_TO)

    const callsBefore = vi.mocked(dashboardApi.summary).mock.calls.length
    const apply = (await waitForElement('[data-testid="dashboard-apply-btn"]')) as HTMLButtonElement
    expect(apply.disabled).toBe(true)

    await act(async () => apply.click())
    await flush()

    // The message is visible and names the 1-month limit.
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("maksimal 1 bulan")
    expect(alert?.textContent).toContain("31 hari")
    // No request was made for the over-long range.
    expect(vi.mocked(dashboardApi.summary).mock.calls.length).toBe(callsBefore)
    await unmount()
  })

  it("a backend 400 shows the message and keeps the previous chart", async () => {
    const { ApiError } = await import("@/lib/api-client")
    mitraUser()
    // First load succeeds with 4 bars; the in-limits apply is still rejected by
    // the backend with a 400 VALIDATION_ERROR (defense in depth: the server may
    // enforce a different bound than the client).
    vi.mocked(dashboardApi.summary).mockImplementation(async (params) => {
      if (!params) return { lastLogin: null, monthlyTransactions: null }
      if (params.from === "2026-06-05" && params.to === "2026-06-20") {
        throw new ApiError(400, "VALIDATION_ERROR", "range: cannot exceed 31 days")
      }
      return summaryFor("2026-06-01", "2026-06-20", 4)
    })
    const { host, unmount } = await renderWithClient(<DashboardPage />)
    await waitForElement('[data-testid="transaksi-bar"]')
    const barsBefore = host.querySelectorAll('[data-testid="transaksi-bar"]').length
    expect(barsBefore).toBe(4)

    // A range the client considers valid (15 days) but the backend rejects.
    await act(async () =>
      setNativeValue((await waitForElement("#dashboard-filter-from")) as HTMLInputElement, "2026-06-05")
    )
    await act(async () =>
      setNativeValue((await waitForElement("#dashboard-filter-to")) as HTMLInputElement, "2026-06-20")
    )
    await flush()
    const apply = (await waitForElement('[data-testid="dashboard-apply-btn"]')) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    await act(async () => apply.click())
    // React Query retries once with a delay; wait real time for the error state.
    await new Promise((r) => setTimeout(r, 1500))
    await flush()

    // The inline server-error message appears with the 1-month copy.
    await waitForCondition(
      () => host.querySelector('[data-testid="dashboard-server-error"]') !== null,
      "server error message"
    )
    expect(host.querySelector('[data-testid="dashboard-server-error"]')?.textContent).toContain("maksimal 1 bulan")
    // The previously rendered bars are untouched.
    expect(host.querySelectorAll('[data-testid="transaksi-bar"]').length).toBe(barsBefore)
    await unmount()
  })
})
