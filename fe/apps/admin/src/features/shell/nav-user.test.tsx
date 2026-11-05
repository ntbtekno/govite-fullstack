import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { click, render } from "@/test-utils"

const state = vi.hoisted(() => ({
  user: null as {
    fullName?: string | null
    email?: string
    roleName?: string
    avatarUrl?: string | null
    mitraId: string | null
  } | null,
  navigate: vi.fn(),
  logout: vi.fn(async () => {}),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: state.user,
    logout: state.logout,
  }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => state.navigate,
}))

vi.mock("@app/ui/components/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  useSidebar: () => ({ isMobile: false }),
}))

// A passthrough dropdown: content is always rendered so the real item is
// clickable without a pointer/keyboard dance through Radix.
vi.mock("@app/ui/components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock("@app/ui/components/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

import { NavUser } from "./nav-user"

const logoutItem = () =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Log out")
  )

afterEach(() => {
  state.user = null
  state.navigate.mockReset()
  state.logout.mockReset()
  document.body.replaceChildren()
})

describe("NavUser logout destination", () => {
  it("navigates a mitra session to /login-mitra", async () => {
    state.user = { fullName: "Mitra User", email: "m@test.local", roleName: "Mitra", mitraId: "33333333-3333-4333-8333-333333333333" }
    const { unmount } = await render(<NavUser />)

    await click(logoutItem()!)

    expect(state.logout).toHaveBeenCalled()
    expect(state.navigate).toHaveBeenCalledWith({ to: "/login-mitra" })
    await unmount()
  })

  it("navigates a Superadmin session to /login", async () => {
    state.user = { fullName: "Super Admin", email: "s@test.local", roleName: "Super Admin", mitraId: null }
    const { unmount } = await render(<NavUser />)

    await click(logoutItem()!)

    expect(state.logout).toHaveBeenCalled()
    expect(state.navigate).toHaveBeenCalledWith({ to: "/login" })
    await unmount()
  })

  it("reads mitraId before logout clears the session", async () => {
    state.user = { fullName: "Mitra User", email: "m@test.local", roleName: "Mitra", mitraId: "33333333-3333-4333-8333-333333333333" }
    // Simulate logout wiping the state: the destination must already be decided.
    state.logout.mockImplementation(async () => {
      state.user = null
    })
    const { unmount } = await render(<NavUser />)

    await click(logoutItem()!)

    expect(state.navigate).toHaveBeenCalledWith({ to: "/login-mitra" })
    await unmount()
  })
})
