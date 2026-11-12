import { afterEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "./app-sidebar"
import { render } from "@/test-utils"
import { SidebarProvider } from "@app/ui/components/sidebar"
import { TooltipProvider } from "@app/ui/components/tooltip"

const state = vi.hoisted(() => ({
  user: null as { id: string; mitraId: string | null } | null,
  granted: new Set<string>(),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    can: (resource: string, action: string) =>
      state.granted.has(`${resource}.${action}`),
    user: state.user,
  }),
}))

vi.mock("@/lib/public-settings", () => ({
  usePublicSettings: () => ({
    data: {
      appName: "Rekan NTB",
      tagline: "Bank NTB Syariah",
      logoUrl: "/images/logo-bank-ntb-syariah.webp",
    },
  }),
}))

vi.mock("@/features/shell/nav-user", () => ({ NavUser: () => null }))

// Capture the destination each sidebar link points at.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
  }: {
    to: string
    children: React.ReactNode
  }) => <a data-to={to}>{children}</a>,
}))

const usersLink = () =>
  Array.from(document.querySelectorAll("a")).find((a) =>
    a.textContent?.includes("Users")
  )

const reportLink = (title: string) =>
  Array.from(document.querySelectorAll("a")).find((a) =>
    a.textContent?.includes(title)
  )

const renderSidebar = () =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>
  )

afterEach(() => {
  state.user = null
  state.granted = new Set()
  document.body.replaceChildren()
})

describe("AppSidebar Users menu", () => {
  it("hides the Users item for a mitra user (own data lives on Account)", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set(["users.view"])
    await renderSidebar()

    expect(usersLink()).toBeUndefined()
  })

  it("keeps Superadmin (no mitra) pointed at the user list", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: null,
    }
    state.granted = new Set(["users.view"])
    await renderSidebar()

    expect(usersLink()?.getAttribute("data-to")).toBe(
      "/admin/administration/users"
    )
  })
})

describe("AppSidebar Laporan group", () => {
  it("is hidden for a Superadmin even with both report permissions", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: null,
    }
    state.granted = new Set(["billing.view", "payments.view"])
    await renderSidebar()

    expect(reportLink("Billing Tagihan")).toBeUndefined()
    expect(reportLink("History Payment")).toBeUndefined()
    expect(document.body.textContent).not.toContain("Laporan")
  })

  it("shows both items for a mitra with both view permissions", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set(["billing.view", "payments.view"])
    await renderSidebar()

    expect(document.body.textContent).toContain("Laporan")
    expect(reportLink("Billing Tagihan")?.getAttribute("data-to")).toBe(
      "/admin/billing"
    )
    expect(reportLink("History Payment")?.getAttribute("data-to")).toBe(
      "/admin/payment-history"
    )
  })

  it("shows only Billing for a mitra with billing.view only", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set(["billing.view"])
    await renderSidebar()

    expect(reportLink("Billing Tagihan")).toBeDefined()
    expect(reportLink("History Payment")).toBeUndefined()
  })

  it("hides the whole group for a mitra without either view permission", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set()
    await renderSidebar()

    expect(reportLink("Billing Tagihan")).toBeUndefined()
    expect(reportLink("History Payment")).toBeUndefined()
    expect(document.body.textContent).not.toContain("Laporan")
  })
})

describe("AppSidebar Tools group", () => {
  it("is hidden for a Superadmin even with va permissions", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: null,
    }
    state.granted = new Set(["va.view", "va.create"])
    await renderSidebar()

    expect(reportLink("Create VA")).toBeUndefined()
    expect(document.body.textContent).not.toContain("Tools")
  })

  it("shows Create VA for a mitra with va.view", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set(["va.view"])
    await renderSidebar()

    expect(document.body.textContent).toContain("Tools")
    expect(reportLink("Create VA")?.getAttribute("data-to")).toBe(
      "/admin/tools/create-va"
    )
  })

  it("hides Create VA for a mitra without va permission", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    state.granted = new Set()
    await renderSidebar()

    expect(reportLink("Create VA")).toBeUndefined()
    expect(document.body.textContent).not.toContain("Tools")
  })
})

describe("AppSidebar brand", () => {
  it("shows the correct app name and tagline with logo", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111", mitraId: null }
    state.granted = new Set(["users.view"])
    await renderSidebar()

    expect(document.body.textContent).toContain("Rekan NTB")
    expect(document.body.textContent).toContain("Bank NTB Syariah")
    const logo = document.querySelector("img[alt='Bank NTB Syariah']")
    expect(logo).not.toBeNull()
    expect(logo?.getAttribute("src")).toBe("/images/logo-bank-ntb-syariah.webp")
  })
})
