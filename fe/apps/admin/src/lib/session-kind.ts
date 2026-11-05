// Remembers which login a session came from so an expired session returns to
// the right form. This is NOT a credential: no token, cookie, or user data is
// stored — only "mitra" or "internal".
const KEY = "govite:last-auth-kind"

export type AuthKind = "mitra" | "internal"

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function rememberAuthKind(mitraId: string | null | undefined): void {
  try {
    storage()?.setItem(KEY, mitraId ? "mitra" : "internal")
  } catch {
    // Private mode / storage disabled: the hint is optional.
  }
}

export function lastAuthKind(): AuthKind | null {
  try {
    const value = storage()?.getItem(KEY)
    return value === "mitra" || value === "internal" ? value : null
  } catch {
    return null
  }
}

/**
 * Login target for a session that is gone. A known user decides; only when the
 * user is unknown (already cleared by expiry) fall back to the remembered kind.
 */
export function loginPathForSession(opts: {
  mitraId?: string | null
  remembered?: AuthKind | null
}): "/login-mitra" | "/login" {
  if (opts.mitraId !== undefined) {
    return opts.mitraId ? "/login-mitra" : "/login"
  }
  return opts.remembered === "mitra" ? "/login-mitra" : "/login"
}
