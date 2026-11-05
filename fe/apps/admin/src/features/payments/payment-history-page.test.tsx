import { afterEach, describe, expect, it, vi } from "vitest"
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

afterEach(() => {
  state.granted = new Set()
  document.body.replaceChildren()
})

describe("PaymentHistoryPage - Export Excel visibility", () => {
  it("renders 'Export Excel' button when user has payments.export permission", async () => {
    state.granted = new Set(["payments.view", "payments.export"])
    const { host, unmount } = await render(<PaymentHistoryPage />)

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Export Excel")
    )
    expect(exportBtn).toBeDefined()

    await unmount()
  })

  it("does not render 'Export Excel' button when user lacks payments.export permission (e.g. MITRA_STAFF)", async () => {
    state.granted = new Set(["payments.view"])
    const { host, unmount } = await render(<PaymentHistoryPage />)

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Export Excel")
    )
    expect(exportBtn).toBeUndefined()

    await unmount()
  })
})
