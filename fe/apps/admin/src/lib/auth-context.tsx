import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import { SECURITY_POLICY, type LoginResponse, type MeResponse, type Scope } from "@app/contracts"
import * as authApi from "./auth-api"
import { queryClient } from "./query-client"
import { refreshSession, type Session, type RefreshResult } from "./refresh-session"
import { setOnSessionExpired } from "./authed-request"
import { rememberAuthKind } from "./session-kind"
import { IdleTimer } from "./idle-timer"
import { clearSessionPolicy, rememberMe, sessionStartedAt, startSession } from "./session-policy"
import { SessionWatchdog } from "./session-watchdog"
import { getAccessToken, setAccessToken } from "./token-store"

/** Warning shown this long before the idle logout (1 minute). */
export const IDLE_WARNING_MS = 60_000

/** Idle window for the current persistence choice (15m vs 60m). */
export function idleMsFor(remember: boolean): number {
  return remember
    ? SECURITY_POLICY.sessionRememberIdleTtlMs
    : SECURITY_POLICY.sessionIdleTtlMs
}

/** Milliseconds left until the absolute session cap, or null when unknown/past. */
function absoluteRemainingMs(now: number = Date.now()): number | null {
  const started = sessionStartedAt()
  if (started === null) return null
  return started + SECURITY_POLICY.sessionAbsoluteTtlMs - now
}

// Debug: expose boot effect result for Playwright testing
declare global {
  interface Window {
    __DEBUG_BOOT_EFFECT__: { ran: boolean; result: RefreshResult | null } | null;
  }
}

type SettledStatus = "authenticated" | "anonymous"
type AuthStatus = "loading" | SettledStatus

interface AuthState {
  status: AuthStatus
  user: MeResponse | null
}

/** Result of the boot session probe: status plus the restored user. */
export interface SettledAuth {
  status: SettledStatus
  user: MeResponse | null
}

export interface AuthContextValue extends AuthState {
  ready: Promise<SettledStatus>
  /** The same boot probe, resolved with the restored user as well. */
  readyAuth: Promise<SettledAuth>
  login: (
    login: string,
    password: string,
    captchaId: string,
    captcha: string,
    rememberMe?: boolean
  ) => Promise<LoginResponse>
  loginMitra: (
    mitraKode: string,
    username: string,
    password: string,
    captchaId: string,
    captcha: string,
    rememberMe?: boolean
  ) => Promise<LoginResponse>
  verifyTwoFactor: (
    challengeToken: string,
    code: string,
    rememberMe?: boolean
  ) => Promise<LoginResponse>
  verifyTwoFactorBackup: (
    challengeToken: string,
    backupCode: string,
    rememberMe?: boolean
  ) => Promise<LoginResponse>
  logout: () => Promise<void>
  // Reloads /auth/me into state (after profile or photo changes); never throws.
  refreshUser: () => Promise<void>
  // True while the idle warning modal is shown; "keep me signed in" resets it.
  idleWarning: boolean
  staySignedIn: () => void
  can: (resource: string, action: string) => boolean
  // Widest scope granted for the permission, or null when not granted.
  scopeOf: (resource: string, action: string) => Scope | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
  })
  const [idleWarning, setIdleWarning] = useState(false)

  const [boot] = useState<{
    status: Promise<SettledStatus>
    auth: Promise<SettledAuth>
    settle: (settled: SettledAuth) => void
  }>(() => {
    let resolveStatus!: (status: SettledStatus) => void
    let resolveAuth!: (settled: SettledAuth) => void
    const status = new Promise<SettledStatus>((res) => {
      resolveStatus = res
    })
    const auth = new Promise<SettledAuth>((res) => {
      resolveAuth = res
    })
    return {
      status,
      auth,
      settle: (settled) => {
        resolveStatus(settled.status)
        resolveAuth(settled)
      },
    }
  })

  // Automatic watchdog: fires on access token exp to refresh or expire the session
  const [watchdog] = useState(() => new SessionWatchdog())

  // Idle tracker: warns 60s before the idle logout and logs out when ignored.
  const [idleTimer] = useState(
    () => new IdleTimer(idleMsFor(rememberMe()), IDLE_WARNING_MS)
  )

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by WatchdogCallbacks interface
const handleExpired = useCallback((_message?: string) => {
    watchdog.stop()
    idleTimer.stop()
    setAccessToken(null)
    clearSessionPolicy()
    queryClient.clear()
    setState({ status: "anonymous", user: null })
    setIdleWarning(false)
    // Store expiry message in a cookie for the login page to display.
    // Use fixed Indonesian message as required, not the backend message.
    const fixedMessage = "Sesi Anda telah berakhir. Silakan masuk kembali."
    try {
      const cookieValue = `sessionExpiredMessage=${encodeURIComponent(fixedMessage)}; path=/; max-age=60; SameSite=Lax`
      document.cookie = cookieValue
    } catch {
      // ignore
    }
  }, [watchdog, idleTimer])

  useEffect(() => {
    watchdog.setCallbacks({
      onSessionRefreshed: (session: Session) => {
        setAccessToken(session.accessToken)
        rememberAuthKind(session.user.mitraId)
        setState({ status: "authenticated", user: session.user })
      },
      onSessionExpired: handleExpired,
      onTransientError: (retryAfterMs, message) => {
        // Transient error (429/5xx/network): show a toast or indicator if needed,
        // but do NOT log out. The watchdog will retry automatically.
        console.warn(`Session refresh transient error: ${message}, retry in ${retryAfterMs}ms`)
      },
    })
    return () => watchdog.destroy()
  }, [watchdog, handleExpired])

  useEffect(() => {
    let cancelled = false
    refreshSession().then((result) => {
      if (result.kind === "success") {
        const session = result.session
        setAccessToken(session.accessToken)
        rememberAuthKind(session.user.mitraId)
        watchdog.schedule(session.accessToken)
        if (!cancelled)
          setState({ status: "authenticated", user: session.user })
        boot.settle({ status: "authenticated", user: session.user })
      } else if (result.kind === "expired") {
        // Expired during boot: trigger session expired flow with message
        handleExpired()
        boot.settle({ status: "anonymous", user: null })
      } else {
        // Transient during boot: treat as anonymous, watchdog will retry
        if (!cancelled) setState({ status: "anonymous", user: null })
        boot.settle({ status: "anonymous", user: null })
      }
    })
    return () => {
      cancelled = true
    }
  }, [boot, watchdog, handleExpired])

  useEffect(() => {
    setOnSessionExpired(handleExpired)
    return () => setOnSessionExpired(null)
  }, [handleExpired])

  // Idle + absolute session limits run only while authenticated. Any activity
  // resets the idle window (and cancels the warning); the absolute cap ignores
  // activity and forces a fresh login once it is reached.
  useEffect(() => {
    if (state.status !== "authenticated") {
      // handleExpired/logout already cleared the warning; just stop the timer.
      idleTimer.stop()
      return
    }
    const expireNow = () => handleExpired()
    const remaining = absoluteRemainingMs()
    if (remaining !== null && remaining <= 0) {
      expireNow()
      return
    }
    idleTimer.setPolicy(idleMsFor(rememberMe()), IDLE_WARNING_MS)
    idleTimer.start({
      onWarning: () => setIdleWarning(true),
      onIdle: expireNow,
    })
    const absoluteTimer = setTimeout(expireNow, remaining ?? 2_147_483_647)
    return () => {
      clearTimeout(absoluteTimer)
      idleTimer.stop()
      setIdleWarning(false)
    }
  }, [state.status, idleTimer, handleExpired])

  const staySignedIn = useCallback(() => {
    setIdleWarning(false)
    idleTimer.reset()
  }, [idleTimer])

  const finishLogin = useCallback(async (result: LoginResponse, remember: boolean) => {
    if (result.requiresTwoFactor) return result
    setAccessToken(result.accessToken)
    // Records the persistence choice and first-login time before the idle
    // effect runs, so it picks the matching idle window and absolute cap.
    startSession(remember)
    watchdog.schedule(result.accessToken)
    // Drop anything cached for a previous session before the new user renders.
    queryClient.clear()
    const user = await authApi.getMe(result.accessToken)
    rememberAuthKind(user.mitraId)
    // Synchronous so the router's context is updated before a caller's
    // post-login navigate() runs - otherwise beforeLoad reads the stale
    // pre-login snapshot and bounces straight back to /login.
    flushSync(() => setState({ status: "authenticated", user }))
    return result
  }, [watchdog])

  const login = useCallback(
    async (
      login: string,
      password: string,
      captchaId: string,
      captcha: string,
      rememberMe = false
    ) =>
      finishLogin(
        await authApi.login({ login, password, captchaId, captcha, rememberMe }),
        rememberMe
      ),
    [finishLogin]
  )

  const loginMitra = useCallback(
    async (
      mitraKode: string,
      username: string,
      password: string,
      captchaId: string,
      captcha: string,
      rememberMe = false
    ) =>
      finishLogin(
        await authApi.loginMitra({
          mitraKode,
          username,
          password,
          captchaId,
          captcha,
          rememberMe,
        }),
        rememberMe
      ),
    [finishLogin]
  )

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string, rememberMe = false) =>
      finishLogin(
        await authApi.verifyTwoFactor({ challengeToken, code, rememberMe }),
        rememberMe
      ),
    [finishLogin]
  )

  const verifyTwoFactorBackup = useCallback(
    async (challengeToken: string, backupCode: string, rememberMe = false) =>
      finishLogin(
        await authApi.verifyTwoFactorBackup({
          challengeToken,
          backupCode,
          rememberMe,
        }),
        rememberMe
      ),
    [finishLogin]
  )

  const logout = useCallback(async () => {
    watchdog.stop()
    idleTimer.stop()
    setIdleWarning(false)
    await authApi.logout().catch(() => undefined)
    setAccessToken(null)
    clearSessionPolicy()
    flushSync(() => setState({ status: "anonymous", user: null }))
    // Clear any session expiry message on manual logout
    document.cookie = "sessionExpiredMessage=; path=/; max-age=0"
    // Clear only after the state flip has unmounted the admin pages: clearing
    // under mounted queries makes them refetch with no token (401 + refresh).
    queryClient.clear()
  }, [watchdog, idleTimer])

  const refreshUser = useCallback(async () => {
    const token = getAccessToken()
    if (!token) return
    try {
      const user = await authApi.getMe(token)
      setState((s) => ({ ...s, user }))
    } catch (err) {
      // A failed refetch must not turn an already-saved change into an error.
      console.warn("Could not refresh user", err)
    }
  }, [])

  const can = useCallback(
    (resource: string, action: string) =>
      state.user?.permissions.some(
        (p) => p.resource === resource && p.action === action
      ) ?? false,
    [state.user]
  )

  const scopeOf = useCallback(
    (resource: string, action: string): Scope | null =>
      (state.user?.permissions.find(
        (p) => p.resource === resource && p.action === action
      )?.scope as Scope | undefined) ?? null,
    [state.user]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      ready: boot.status,
      readyAuth: boot.auth,
      login,
      loginMitra,
      verifyTwoFactor,
      verifyTwoFactorBackup,
      logout,
      refreshUser,
      idleWarning,
      staySignedIn,
      can,
      scopeOf,
    }),
    [
      state,
      login,
      loginMitra,
      verifyTwoFactor,
      verifyTwoFactorBackup,
      logout,
      refreshUser,
      idleWarning,
      staySignedIn,
      can,
      scopeOf,
      boot.status,
      boot.auth,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function settledStatus(
  auth: Pick<AuthContextValue, "status" | "ready">
): Promise<SettledStatus> | SettledStatus {
  return auth.status === "loading" ? auth.ready : auth.status
}

/**
 * Like settledStatus, but also returns the restored user. Guards that read
 * user fields (mitraId, permissions) must use this: awaiting `ready` resolves
 * before React commits the restored state, so the router context still holds
 * the pre-refresh snapshot during a hard refresh.
 */
export function settledAuth(
  auth: Pick<AuthContextValue, "status" | "user" | "readyAuth">
): Promise<SettledAuth> | SettledAuth {
  return auth.status === "loading"
    ? auth.readyAuth
    : { status: auth.status, user: auth.user }
}

/** Permission check against a settled user (not the possibly stale context). */
export function canUser(
  user: MeResponse | null,
  resource: string,
  action: string
): boolean {
  return (
    user?.permissions.some(
      (p) => p.resource === resource && p.action === action
    ) ?? false
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
