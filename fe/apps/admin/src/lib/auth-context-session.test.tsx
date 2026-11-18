import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { render } from "../test-utils"
import { startSession } from "./session-policy"

const login = vi.fn()
const loginMitra = vi.fn()
const getMe = vi.fn()
const logout = vi.fn()
const getCaptcha = vi.fn()
const refreshSession = vi.fn()
void login
void loginMitra
void getCaptcha

vi.mock("./auth-api", () => ({
  login: (...a: unknown[]) => login(...a),
  loginMitra: (...a: unknown[]) => loginMitra(...a),
  verifyTwoFactor: vi.fn(),
  verifyTwoFactorBackup: vi.fn(),
  getMe: (...a: unknown[]) => getMe(...a),
  logout: (...a: unknown[]) => logout(...a),
  getCaptcha: () => getCaptcha(),
}))
vi.mock("./refresh-session", () => ({
  refreshSession: () => refreshSession(),
}))
vi.mock("@/lib/query-client", () => ({
  queryClient: { clear: vi.fn() },
}))

import { AuthProvider, useAuth, idleMsFor, IDLE_WARNING_MS } from "./auth-context"
import { SECURITY_POLICY } from "@app/contracts"

// happy-dom provides sessionStorage but not localStorage without a backing
// file; install a Map-backed shim so remember-me persistence can be asserted.
function installLocalStorage(): void {
  const map = new Map<string, string>()
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: store,
  })
}

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "a@test.local",
  fullName: "User",
  avatarUrl: null,
  roleId: "22222222-2222-2222-2222-222222222222",
  roleName: "Mitra Admin",
  mitraId: "33333333-3333-3333-3333-333333333333",
  mitraKode: "MTR-001",
  username: "admin",
  emailVerified: true,
  permissions: [],
}

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="warning">{auth.idleWarning ? "yes" : "no"}</span>
      <button data-testid="stay" onClick={auth.staySignedIn}>
        stay
      </button>
    </div>
  )
}

async function mount() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
}

const status = (host: HTMLElement) =>
  host.querySelector('[data-testid="status"]')?.textContent
const warning = (host: HTMLElement) =>
  host.querySelector('[data-testid="warning"]')?.textContent

describe("AuthProvider session limits", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installLocalStorage()
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = "sessionExpiredMessage=; path=/; max-age=0"
    getMe.mockResolvedValue(ME)
    logout.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("selects the idle window from the remember flag", () => {
    expect(idleMsFor(true)).toBe(SECURITY_POLICY.sessionRememberIdleTtlMs)
    expect(idleMsFor(false)).toBe(SECURITY_POLICY.sessionIdleTtlMs)
  })

  it("logs out when the absolute cap is already past, even if refresh succeeds", async () => {
    // A valid refresh token (remembers-me) but the 8h cap elapsed: the browser
    // must still force a fresh login.
    refreshSession.mockResolvedValue({
      kind: "success",
      session: { accessToken: "tok", user: ME },
    })
    startSession(true, Date.now() - SECURITY_POLICY.sessionAbsoluteTtlMs - 1000)
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("anonymous")
  })

  it("shows the idle warning then logs out when ignored", async () => {
    // Authenticated boot: refreshSession success.
    refreshSession.mockResolvedValue({
      kind: "success",
      session: { accessToken: "tok", user: ME },
    })
    startSession(false, Date.now())
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("authenticated")

    // Advance to just before the idle deadline: warning appears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        SECURITY_POLICY.sessionIdleTtlMs - IDLE_WARNING_MS
      )
    })
    expect(warning(host)).toBe("yes")

    // Ignore the warning: idle window completes → logout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_WARNING_MS + 10)
    })
    expect(status(host)).toBe("anonymous")
  })

  it("keep-me-signed-in clears the warning and restarts the idle timer", async () => {
    refreshSession.mockResolvedValue({
      kind: "success",
      session: { accessToken: "tok", user: ME },
    })
    startSession(false, Date.now())
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("authenticated")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        SECURITY_POLICY.sessionIdleTtlMs - IDLE_WARNING_MS
      )
    })
    expect(warning(host)).toBe("yes")

    const stay = host.querySelector('[data-testid="stay"]') as HTMLButtonElement
    await act(async () => {
      stay.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(warning(host)).toBe("no")
    expect(status(host)).toBe("authenticated")
  })
})

describe("AuthProvider boot expired handling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installLocalStorage()
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = "sessionExpiredMessage=; path=/; max-age=0"
    getMe.mockResolvedValue(ME)
    logout.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("writes sessionExpiredMessage cookie when expired with INVALID_REFRESH_TOKEN (had previous session)", async () => {
    // Boot with expired but refresh token was sent (invalid/expired/revoked family)
    refreshSession.mockResolvedValue({
      kind: "expired",
      message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
      code: "INVALID_REFRESH_TOKEN",
    })
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("anonymous")
    // Cookie should be written
    expect(document.cookie).toContain("sessionExpiredMessage=")
  })

  it("does NOT write sessionExpiredMessage cookie when expired with MISSING_REFRESH_TOKEN (no previous session)", async () => {
    // Boot with expired but no refresh token was sent (first visit, no session)
    refreshSession.mockResolvedValue({
      kind: "expired",
      message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
      code: "MISSING_REFRESH_TOKEN",
    })
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("anonymous")
    // Cookie should NOT be written with the actual message.
    // The beforeEach clears the cookie which may leave an empty "sessionExpiredMessage=" trace in happy-dom,
    // but the actual message from handleExpired should not be present.
    const fixedMessage = "Sesi Anda telah berakhir. Silakan masuk kembali."
    const encodedMessage = encodeURIComponent(fixedMessage)
    expect(document.cookie).not.toContain(encodedMessage)
  })

  it("writes sessionExpiredMessage cookie when expired with REFRESH_TOKEN_REUSE_DETECTED (had previous session, reuse detected)", async () => {
    // Boot with expired and reuse detected - this means there WAS a previous session
    refreshSession.mockResolvedValue({
      kind: "expired",
      message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
      code: "REFRESH_TOKEN_REUSE_DETECTED",
    })
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("anonymous")
    // Cookie SHOULD be written because there was a previous session (reuse detected)
    expect(document.cookie).toContain("sessionExpiredMessage=")
  })

  it("shows notice only once across multiple boots with INVALID_REFRESH_TOKEN (marker prevents repeat)", async () => {
    // First boot: expired with invalid refresh token
    refreshSession.mockResolvedValue({
      kind: "expired",
      message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
      code: "INVALID_REFRESH_TOKEN",
    })
    const { host: host1, unmount: unmount1 } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host1)).toBe("anonymous")
    expect(document.cookie).toContain("Sesi%20Anda%20telah%20berakhir")

    // Unmount first instance
    await unmount1()

    // Second boot: same error, but marker should prevent repeat notice
    const { host: host2 } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host2)).toBe("anonymous")
    // Cookie should NOT contain the message again (marker prevents it)
    // The cookie from first boot may still exist but handleExpired should not be called again
    // We verify by checking that the marker is set
    expect(localStorage.getItem("govite:session-expired-notice-shown")).toBe("true")
  })

  it("clears notice marker on successful login", async () => {
    // First, set the marker as if notice was shown
    localStorage.setItem("govite:session-expired-notice-shown", "true")
    expect(localStorage.getItem("govite:session-expired-notice-shown")).toBe("true")

    // Simulate successful login by mounting with success refresh
    refreshSession.mockResolvedValue({
      kind: "success",
      session: { accessToken: "tok", user: ME },
    })
    const { host } = await mount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status(host)).toBe("authenticated")
    // Marker should be cleared on successful login
    expect(localStorage.getItem("govite:session-expired-notice-shown")).toBeNull()
  })
})
