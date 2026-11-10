import { afterEach, describe, expect, it, vi } from "vitest"
import { AppLoader } from "./app-loader"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { render } from "../test-utils"

function TestAppRouter() {
  const auth = useAuth()
  if (auth.status === "loading") {
    return <AppLoader />
  }
  return <div data-testid="app-content">App Content</div>
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

vi.mock("@/lib/auth-context", async () => {
  const actual = await vi.importActual("@/lib/auth-context")
  return {
    ...(actual as object),
    useAuth: () => ({
      status: "loading" as const,
      user: null,
      ready: Promise.resolve("authenticated" as const),
      readyAuth: Promise.resolve({ status: "authenticated" as const, user: null }),
      login: vi.fn(),
      loginMitra: vi.fn(),
      verifyTwoFactor: vi.fn(),
      verifyTwoFactorBackup: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
      can: vi.fn(),
      scopeOf: vi.fn(),
    }),
  }
})

describe("AppLoader", () => {
  it("renders loader with logo, text, and loading bar", async () => {
    const { host } = await render(
      <TestWrapper>
        <AppLoader />
      </TestWrapper>
    )

    const loader = host.querySelector('[data-testid="app-loader"]')
    expect(loader).not.toBeNull()

    const logo = host.querySelector('img[alt="Bank NTB Syariah"]')
    expect(logo).not.toBeNull()

    const text = host.querySelector("p")
    expect(text).not.toBeNull()
    expect(text?.textContent).toBe("Rekan NTB")

    const bar = host.querySelector(".app-loader-bar")
    expect(bar).not.toBeNull()
  })

  it("shows loader while auth is loading", async () => {
    const { host } = await render(
      <TestWrapper>
        <TestAppRouter />
      </TestWrapper>
    )

    const loader = host.querySelector('[data-testid="app-loader"]')
    expect(loader).not.toBeNull()

    const content = host.querySelector('[data-testid="app-content"]')
    expect(content).toBeNull()
  })
})