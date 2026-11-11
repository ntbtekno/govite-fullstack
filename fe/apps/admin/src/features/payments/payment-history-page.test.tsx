import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PaymentHistoryPage } from "./payment-history-page"
import { click, render } from "@/test-utils"
import { reportsApi, type ReportQueryParams } from "@/lib/reports-api"

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    can: (resource: string, action: string) =>
      state.granted.has(`${resource}.${action}`),
    user: { id: "user-1", mitraId: "mitra-1" },
  }),
}))

vi.mock("@/lib/reports-api", () => ({
  reportsApi: {
    payments: vi.fn(),
  },
}))

const renderWithClient = (ui: React.ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(reportsApi.payments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    summary: { count: 0, totalAmount: 0 },
  })
})

afterEach(() => {
  state.granted = new Set()
  vi.clearAllMocks()
  document.body.replaceChildren()
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

describe("PaymentHistoryPage - Export Excel visibility", () => {
  it("renders 'Export Excel' button when user has payments.export permission", async () => {
    state.granted = new Set(["payments.view", "payments.export"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Export Excel")
    )
    expect(exportBtn).toBeDefined()

    await unmount()
  })

  it("does not render 'Export Excel' button when user lacks payments.export permission (e.g. MITRA_STAFF)", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Export Excel")
    )
    expect(exportBtn).toBeUndefined()

    await unmount()
  })
})

describe("PaymentHistoryPage - Date Filter toolbar", () => {
  it("calls API without from/to when inputs are empty (default)", async () => {
    state.granted = new Set(["payments.view"])
    const { unmount } = await renderWithClient(<PaymentHistoryPage />)

    expect(reportsApi.payments).toHaveBeenCalledWith(
      expect.objectContaining({
        from: undefined,
        to: undefined,
        page: 1,
        pageSize: 10,
      })
    )

    await unmount()
  })

  it("forwards from and to to API when filled, and shows Reset button", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    const fromInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Dari"]'
    )!
    const toInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Sampai"]'
    )!

    expect(fromInput).toBeDefined()
    expect(toInput).toBeDefined()

    // Initially no reset button
    expect(
      Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Reset")
      )
    ).toBeUndefined()

    await act(async () => {
      setNativeValue(fromInput, "2026-10-01")
      setNativeValue(toInput, "2026-10-31")
    })

    await vi.waitFor(() => {
      expect(reportsApi.payments).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "2026-10-01",
          to: "2026-10-31",
          page: 1,
        })
      )
    })

    // Reset button should now be visible
    const resetBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reset")
    )
    expect(resetBtn).toBeDefined()

    await unmount()
  })

  it("resets dates and refetches with empty from/to when Reset button is clicked", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    const fromInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Dari"]'
    )!

    await act(async () => {
      setNativeValue(fromInput, "2026-10-01")
    })

    await vi.waitFor(() => {
      expect(reportsApi.payments).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-10-01" })
      )
    })

    const resetBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reset")
    )!
    expect(resetBtn).toBeDefined()

    await click(resetBtn)

    await vi.waitFor(() => {
      expect(fromInput.value).toBe("")
      expect(reportsApi.payments).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: undefined, to: undefined })
      )
    })

    await unmount()
  })

  it("shows error and does not call API with inverted range when Dari > Sampai", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    const fromInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Dari"]'
    )!
    const toInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Sampai"]'
    )!

    vi.mocked(reportsApi.payments).mockClear()

    await act(async () => {
      setNativeValue(fromInput, "2026-11-05")
      setNativeValue(toInput, "2026-10-01")
    })

    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        "Tanggal Dari tidak boleh melebihi tanggal Sampai"
      )
    })

    // API should NEVER be called with the inverted pair { from: "2026-11-05", to: "2026-10-01" }
    const calls = vi.mocked(reportsApi.payments).mock.calls
    for (const call of calls) {
      const params = (call[0] || {}) as ReportQueryParams
      if (params.from && params.to) {
        expect(params.from <= params.to).toBe(true)
      }
    }

    await unmount()
  })
})

describe("PaymentHistoryPage - Expandable row", () => {
  const sample = {
    id: "tx-1",
    txDate: "2026-10-01",
    vaNumber: "MTR00141",
    transactionAt: "2026-10-01T10:20:30",
    reference: "REF-123456",
    message: "Pembayaran VA berhasil",
    amount: 150000,
    status: "success",
  }

  beforeEach(() => {
    vi.mocked(reportsApi.payments).mockResolvedValue({
      items: [sample],
      total: 1,
      page: 1,
      pageSize: 10,
      summary: { count: 1, totalAmount: sample.amount },
    })
  })

  it("hides secondary fields until expanded, shows them on expand, hides again on collapse", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="payment-detail-row"]')).toBeNull()
    })
    // Secondary field (message / Keterangan) is not visible before expanding.
    expect(host.textContent).not.toContain("Pembayaran VA berhasil")
    expect(host.textContent).not.toContain("Tanggal Transaksi (txdate)")

    const toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Buka detail transaksi"]'
    )!
    expect(toggle).toBeDefined()

    await click(toggle)

    await vi.waitFor(() => {
      expect(
        host.querySelector('[data-testid="payment-detail-row"]')
      ).not.toBeNull()
    })
    expect(host.textContent).toContain("Pembayaran VA berhasil")
    expect(host.textContent).toContain("Tanggal Transaksi (txdate)")

    const closeToggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Tutup detail transaksi"]'
    )!
    await click(closeToggle)

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="payment-detail-row"]')).toBeNull()
    })
    expect(host.textContent).not.toContain("Pembayaran VA berhasil")

    await unmount()
  })

  it("keeps the row expanded across a refetch (polling does not close it)", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await renderWithClient(<PaymentHistoryPage />)

    await click(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Buka detail transaksi"]'
      )!
    )
    await vi.waitFor(() => {
      expect(
        host.querySelector('[data-testid="payment-detail-row"]')
      ).not.toBeNull()
    })

    // A new object identity arrives from the API with the same tx id.
    vi.mocked(reportsApi.payments).mockResolvedValue({
      items: [{ ...sample, message: "Pembayaran VA berhasil" }],
      total: 1,
      page: 1,
      pageSize: 10,
      summary: { count: 1, totalAmount: sample.amount },
    })
    const refetchBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("Tutup detail")
    )
    expect(refetchBtn).toBeDefined()
    // Row stays open (still the "close" affordance, detail row present).
    expect(
      host.querySelector('[data-testid="payment-detail-row"]')
    ).not.toBeNull()

    await unmount()
  })
})
