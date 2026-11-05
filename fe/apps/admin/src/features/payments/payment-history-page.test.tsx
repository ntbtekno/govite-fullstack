import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PaymentHistoryPage } from "./payment-history-page"
import { render } from "@/test-utils"

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
    payments: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      summary: { count: 0, totalAmount: 0 },
    }),
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

afterEach(() => {
  state.granted = new Set()
  document.body.replaceChildren()
})

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
