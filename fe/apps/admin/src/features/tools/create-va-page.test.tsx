import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, submit } from "@/test-utils"
import { ApiError } from "@/lib/api-client"
import { vaApi } from "./api"
import { CreateVAPage } from "./create-va-page"

const state = vi.hoisted(() => ({ granted: new Set<string>() }))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    can: (resource: string, action: string) =>
      state.granted.has(`${resource}.${action}`),
  }),
}))

vi.mock("./api", () => ({ vaApi: { create: vi.fn() } }))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateVAPage />
    </QueryClientProvider>
  )
}

function fill(form: HTMLFormElement) {
  const values: Record<string, string> = {
    customerNo: "20261023000001",
    trxId: "INV-2026-000001",
    virtualAccountName: "Budi Santoso",
    amount: "150000",
    expiredDate: "2026-12-31T23:59",
    description: "Tagihan SPP",
    phone: "+6281234567890",
  }
  for (const [name, value] of Object.entries(values)) {
    ;(form.elements.namedItem(name) as HTMLInputElement).value = value
  }
}

afterEach(() => {
  state.granted = new Set()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe("CreateVAPage", () => {
  it("mengirim kontrak portal dan menampilkan nomor VA beserta status", async () => {
    state.granted = new Set(["va.create"])
    vi.mocked(vaApi.create).mockResolvedValue({
      virtualAccountNo: "0104120261023000001",
      status: "ACTIVE",
    })
    const { host, unmount } = await renderPage()
    const form = host.querySelector("form")!
    fill(form)

    await submit(form)
    await vi.waitFor(() => expect(vaApi.create).toHaveBeenCalledOnce())

    expect(vi.mocked(vaApi.create).mock.calls[0]?.[0]).toEqual({
      customerNo: "20261023000001",
      trxId: "INV-2026-000001",
      virtualAccountName: "Budi Santoso",
      amount: "150000.00",
      trxType: "F",
      expiredDate: new Date("2026-12-31T23:59").toISOString(),
      description: "Tagihan SPP",
      phone: "+6281234567890",
    })
    await vi.waitFor(() => {
      expect(host.textContent).toContain("0104120261023000001")
      expect(host.textContent).toContain("ACTIVE")
    })
    await unmount()
  })

  it("menonaktifkan submit untuk pengguna view-only", async () => {
    state.granted = new Set(["va.view"])
    const { host, unmount } = await renderPage()
    const button = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    )!

    expect(button.disabled).toBe(true)
    expect(host.textContent).toContain("akses lihat saja")
    await submit(host.querySelector("form")!)
    expect(vaApi.create).not.toHaveBeenCalled()
    await unmount()
  })

  it("menampilkan messageInd dan code dari envelope portal", async () => {
    state.granted = new Set(["va.create"])
    vi.mocked(vaApi.create).mockRejectedValue(
      new ApiError(
        409,
        "VA_ALREADY_ACTIVE",
        "Virtual Account is active",
        "VA untuk trxId ini masih aktif"
      )
    )
    const { host, unmount } = await renderPage()
    const form = host.querySelector("form")!
    fill(form)

    await submit(form)
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        "VA untuk trxId ini masih aktif (VA_ALREADY_ACTIVE)"
      )
    )
    await unmount()
  })
})
