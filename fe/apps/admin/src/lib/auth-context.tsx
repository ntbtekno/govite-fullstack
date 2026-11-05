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
import type { LoginResponse, MeResponse, Scope } from "@app/contracts"
import * as authApi from "./auth-api"
import { queryClient } from "./query-client"
import { refreshSession, type Session } from "./refresh-session"
import { setOnSessionExpired } from "./authed-request"
import { rememberAuthKind } from "./session-kind"
import { SessionWatchdog } from "./session-watchdog"
import { getAccessToken, setAccessToken } from "./token-store"

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
    captcha: string
  ) => Promise<LoginResponse>
  loginMitra: (
    mitraKode: string,
    username: string,
    password: string,
    captchaId: string,
    captcha: string
  ) => Promise<LoginResponse>
  verifyTwoFactor: (
    challengeToken: string,
    code: string
  ) => Promise<LoginResponse>
  verifyTwoFactorBackup: (
    challengeToken: string,
    backupCode: string
  ) => Promise<LoginResponse>
  logout: () => Promise<void>
  // Reloads /auth/me into state (after profile or photo changes); never throws.
  refreshUser: () => Promise<void>
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

  const handleExpired = useCallback(() => {
    watchdog.stop()
    setAccessToken(null)
    queryClient.clear()
    setState({ status: "anonymous", user: null })
  }, [watchdog])

  useEffect(() => {
    watchdog.setCallbacks({
      onSessionRefreshed: (session: Session) => {
        setAccessToken(session.accessToken)
        rememberAuthKind(session.user.mitraId)
        setState({ status: "authenticated", user: session.user })
      },
      onSessionExpired: handleExpired,
    })
    return () => watchdog.destroy()
  }, [watchdog, handleExpired])

  useEffect(() => {
    let cancelled = false
    refreshSession().then((session) => {
      if (session) {
        setAccessToken(session.accessToken)
        rememberAuthKind(session.user.mitraId)
        watchdog.schedule(session.accessToken)
        if (!cancelled)
          setState({ status: "authenticated", user: session.user })
        boot.settle({ status: "authenticated", user: session.user })
      } else {
        if (!cancelled) setState({ status: "anonymous", user: null })
        boot.settle({ status: "anonymous", user: null })
      }
    })
    return () => {
      cancelled = true
    }
  }, [boot, watchdog])

  useEffect(() => {
    setOnSessionExpired(handleExpired)
    return () => setOnSessionExpired(null)
  }, [handleExpired])

  const finishLogin = useCallback(async (result: LoginResponse) => {
    if (result.requiresTwoFactor) return result
    setAccessToken(result.accessToken)
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
      captcha: string
    ) =>
      finishLogin(await authApi.login({ login, password, captchaId, captcha })),
    [finishLogin]
  )

  const loginMitra = useCallback(
    async (
      mitraKode: string,
      username: string,
      password: string,
      captchaId: string,
      captcha: string
    ) =>
      finishLogin(
        await authApi.loginMitra({
          mitraKode,
          username,
          password,
          captchaId,
          captcha,
        })
      ),
    [finishLogin]
  )

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string) =>
      finishLogin(await authApi.verifyTwoFactor({ challengeToken, code })),
    [finishLogin]
  )

  const verifyTwoFactorBackup = useCallback(
    async (challengeToken: string, backupCode: string) =>
      finishLogin(
        await authApi.verifyTwoFactorBackup({ challengeToken, backupCode })
      ),
    [finishLogin]
  )

  const logout = useCallback(async () => {
    watchdog.stop()
    await authApi.logout().catch(() => undefined)
    setAccessToken(null)
    flushSync(() => setState({ status: "anonymous", user: null }))
    // Clear only after the state flip has unmounted the admin pages: clearing
    // under mounted queries makes them refetch with no token (401 + refresh).
    queryClient.clear()
  }, [watchdog])

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
