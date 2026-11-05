import { afterEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "./app-sidebar"
import { render } from "@/test-utils"
import { SidebarProvider } from "@app/ui/components/sidebar"
import { TooltipProvider } from "@app/ui/components/tooltip"

const state = vi.hoisted(() => ({
  user: null as { id: string; mitraId: string | null } | null,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    can: () => true,
    user: state.user,
  }),
}))

vi.mock("@/lib/public-settings", () => ({
  usePublicSettings: () => ({ data: { appName: "Rekanara", logoUrl: null } }),
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
  document.body.replaceChildren()
})

describe("AppSidebar Users menu", () => {
  it("points a mitra user to its own detail page", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: "33333333-3333-4333-8333-333333333333",
    }
    await renderSidebar()

    expect(usersLink()?.getAttribute("data-to")).toBe(
      "/admin/administration/users/22222222-2222-4222-8222-222222222222"
    )
  })

  it("keeps Superadmin (no mitra) pointed at the user list", async () => {
    state.user = {
      id: "22222222-2222-4222-8222-222222222222",
      mitraId: null,
    }
    await renderSidebar()

    expect(usersLink()?.getAttribute("data-to")).toBe(
      "/admin/administration/users"
    )
  })
})
