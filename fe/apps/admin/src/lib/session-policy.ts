// Local session policy state: whether the user chose "Ingat saya" and when the
// session first started. Neither value is a credential — no token, cookie, or
// user data is stored here, only a boolean and a timestamp used to pick the
// idle window and to enforce the absolute session cap in the browser.
const REMEMBER_KEY = "govite:remember"
const STARTED_KEY = "govite:session-started-at"

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function rememberMe(): boolean {
  try {
    return localStore()?.getItem(REMEMBER_KEY) === "true"
  } catch {
    return false
  }
}

/**
 * Records the login choice and the first-login time. A remembered session keeps
 * its start time in localStorage so the absolute cap survives a browser restart;
 * a non-remembered session is scoped to the tab (sessionStorage).
 */
export function startSession(remember: boolean, now: number = Date.now()): void {
  try {
    localStore()?.setItem(REMEMBER_KEY, remember ? "true" : "false")
    const store = remember ? localStore() : sessionStore()
    store?.setItem(STARTED_KEY, String(now))
  } catch {
    // Private mode / storage disabled: the cap falls back to per-page defaults.
  }
}

/** First-login timestamp in ms, or null when unknown. */
export function sessionStartedAt(): number | null {
  try {
    const raw =
      localStore()?.getItem(STARTED_KEY) ??
      sessionStore()?.getItem(STARTED_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function clearSessionPolicy(): void {
  try {
    localStore()?.removeItem(REMEMBER_KEY)
    localStore()?.removeItem(STARTED_KEY)
    sessionStore()?.removeItem(STARTED_KEY)
  } catch {
    // ignore
  }
}
