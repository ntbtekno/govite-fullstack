import { getJwtExp } from "./jwt"
import { refreshSession, type Session } from "./refresh-session"

export interface WatchdogCallbacks {
  onSessionRefreshed: (session: Session) => void
  onSessionExpired: () => void
}

/**
 * Manages an automatic refresh timer based on the access token's `exp` claim.
 *
 * Behavior:
 * - When scheduled with an access token, it calculates delay = (exp * 1000) - Date.now().
 * - When expired or due: calls refreshSession() once.
 * - If refreshSession succeeds -> onSessionRefreshed(newSession) and reschedule with new token.
 * - If refreshSession fails -> onSessionExpired() (clears state, triggers redirect).
 * - Always clears previous timer on reschedule and on stop().
 * - On visibilitychange (tab becomes visible): recalculates remaining time; if already
 *   expired/passed, triggers immediate check.
 */
export class SessionWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null
  private expTimestampMs: number | null = null
  private isRefreshing = false
  private callbacks: WatchdogCallbacks | null = null
  private boundVisibilityHandler: (() => void) | null = null

  constructor(callbacks?: WatchdogCallbacks) {
    if (callbacks) {
      this.callbacks = callbacks
    }
    if (typeof document !== "undefined") {
      this.boundVisibilityHandler = () => this.handleVisibilityChange()
      document.addEventListener("visibilitychange", this.boundVisibilityHandler)
    }
  }

  setCallbacks(callbacks: WatchdogCallbacks) {
    this.callbacks = callbacks
  }

  schedule(accessToken: string | null | undefined): void {
    this.clearTimer()
    this.expTimestampMs = null

    if (!accessToken) return

    const expSec = getJwtExp(accessToken)
    if (!expSec) return

    this.expTimestampMs = expSec * 1000
    this.armTimer()
  }

  stop(): void {
    this.clearTimer()
    this.expTimestampMs = null
  }

  destroy(): void {
    this.stop()
    if (typeof document !== "undefined" && this.boundVisibilityHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.boundVisibilityHandler
      )
      this.boundVisibilityHandler = null
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private armTimer(): void {
    if (!this.expTimestampMs) return

    const now = Date.now()
    const remainingMs = this.expTimestampMs - now

    // If already past expiry or due immediately, trigger check now
    if (remainingMs <= 0) {
      void this.triggerRefresh()
      return
    }

    // Schedule timer right at the expiry boundary
    this.timer = setTimeout(() => {
      void this.triggerRefresh()
    }, remainingMs)
  }

  private handleVisibilityChange(): void {
    if (typeof document === "undefined" || document.hidden) return
    if (!this.expTimestampMs || this.isRefreshing) return

    const now = Date.now()
    if (now >= this.expTimestampMs) {
      // Overdue while tab was backgrounded: check immediately
      void this.triggerRefresh()
    } else {
      // Re-arm timer to guarantee accurate timing after browser throttle
      this.clearTimer()
      this.armTimer()
    }
  }

  async triggerRefresh(): Promise<void> {
    if (this.isRefreshing) return
    this.isRefreshing = true
    this.clearTimer()

    try {
      const nextSession = await refreshSession()
      if (nextSession) {
        this.callbacks?.onSessionRefreshed(nextSession)
        this.schedule(nextSession.accessToken)
      } else {
        this.stop()
        this.callbacks?.onSessionExpired()
      }
    } catch {
      this.stop()
      this.callbacks?.onSessionExpired()
    } finally {
      this.isRefreshing = false
    }
  }

  // Inspection helpers for tests
  getExpTimestampMs(): number | null {
    return this.expTimestampMs
  }

  hasActiveTimer(): boolean {
    return this.timer !== null
  }
}
