import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PermissionsPage } from "./permissions-page"
import { render } from "@/test-utils"
import { permissionsApi, type PermissionCatalog } from "@/features/roles/api"

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    can: (resource: string, action: string) =>
      state.granted.has(`${resource}.${action}`),
    user: { id: "user-1" },
  }),
}))

vi.mock("@/features/roles/api", () => ({
  permissionsApi: {
    catalog: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  state.granted = new Set()
  document.body.replaceChildren()
})

const catalog: PermissionCatalog = {
  permissions: [
    { resource: "billing", action: "view" },
    { resource: "billing", action: "export" },
    { resource: "payments", action: "view" },
    { resource: "payments", action: "export" },
    { resource: "users", action: "manage" },
    { resource: "users", action: "view" },
    { resource: "roles", action: "manage" },
    { resource: "roles", action: "view" },
    { resource: "audit", action: "view" },
    { resource: "settings", action: "manage" },
    { resource: "settings", action: "view" },
  ],
  resources: [],
  actions: [],
  scopes: [],
}

describe("PermissionsPage", () => {
  it("renders Katalog grouped per kategori dengan hitungan yang benar", async () => {
    state.granted = new Set(["permissions.view"])
    vi.mocked(permissionsApi.catalog).mockResolvedValue(catalog)
    const { host, unmount } = await renderWithClient(<PermissionsPage />)

    await vi.waitFor(() => expect(host.textContent).toContain("Report"))
    expect(host.textContent).toContain("Administration")
    expect(host.textContent).toContain("Lainnya")

    expect(host.textContent).toContain("billing.view")
    expect(host.textContent).toContain("users.manage")
    expect(host.textContent).toContain("roles.view")
    expect(host.textContent).toContain("settings.view")

    await unmount()
  })

  it("menyaring baris berdasarkan kata kunci dan menyembunyikan grup kosong", async () => {
    state.granted = new Set(["permissions.view"])
    vi.mocked(permissionsApi.catalog).mockResolvedValue(catalog)
    const { host, unmount } = await renderWithClient(<PermissionsPage />)

    await vi.waitFor(() => expect(host.textContent).toContain("users.manage"))

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Cari permission"]'
    )!
    expect(input).toBeDefined()

    await act(async () => {
      setNativeValue(input, "billing")
    })

    // Hanya baris billing yang tersisa; grup Report masih terlihat, Administration dan Lainnya tersembunyi.
    await vi.waitFor(() => {
      expect(host.textContent).toContain("billing.view")
      expect(host.textContent).toContain("billing.export")
      expect(host.textContent).not.toContain("users.manage")
      expect(host.textContent).not.toContain("payments.view")
      expect(host.textContent).not.toContain("settings.view")
      expect(host.textContent).not.toContain("Administration")
      expect(host.textContent).not.toContain("Lainnya")
    })

    // Kembalikan pencarian -> tampilan penuh.
    await act(async () => {
      setNativeValue(input, "")
    })
    await vi.waitFor(() => expect(host.textContent).toContain("Administration"))
    expect(host.textContent).toContain("users.manage")

    await unmount()
  })
})
