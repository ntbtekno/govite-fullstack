import { getJwtExp } from "./jwt"
import { refreshSession, type Session } from "./refresh-session"

export interface WatchdogCallbacks {
  onSessionRefreshed: (session: Session) => void
  onSessionExpired: (message: string) => void
  onTransientError?: (retryAfterMs: number, message: string) => void
}

/**
 * Manages an automatic refresh timer based on the access token's `exp` claim.
 *
 * Behavior:
 * - When scheduled with an access token, it calculates delay = (exp * 1000) - Date.now().
 * - When expired or due: calls refreshSession() once.
 * - If refreshSession succeeds -> onSessionRefreshed(newSession) and reschedule with new token.
 * - If refreshSession returns expired (401) -> onSessionExpired(message) (clears state, triggers redirect with message).
 * - If refreshSession returns transient (429/5xx/network) -> onTransientError(retryAfterMs, message) and reschedule retry.
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
  private pendingRetryTimer: ReturnType<typeof setTimeout> | null = null

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
    this.clearPendingRetry()
    this.expTimestampMs = null

    if (!accessToken) return

    const expSec = getJwtExp(accessToken)
    if (!expSec) return

    this.expTimestampMs = expSec * 1000
    this.armTimer()
  }

  stop(): void {
    this.clearTimer()
    this.clearPendingRetry()
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

  private clearPendingRetry(): void {
    if (this.pendingRetryTimer !== null) {
      clearTimeout(this.pendingRetryTimer)
      this.pendingRetryTimer = null
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
    this.clearPendingRetry()

    const result = await refreshSession()

    switch (result.kind) {
      case "success": {
        this.callbacks?.onSessionRefreshed(result.session)
        this.schedule(result.session.accessToken)
        break
      }
      case "expired": {
        this.stop()
        this.callbacks?.onSessionExpired(result.message)
        break
      }
      case "transient": {
        // Schedule a retry after the suggested delay
        this.callbacks?.onTransientError?.(result.retryAfterMs, result.message)
        this.pendingRetryTimer = setTimeout(() => {
          void this.triggerRefresh()
        }, result.retryAfterMs)
        break
      }
    }

    this.isRefreshing = false
  }

  // Inspection helpers for tests
  getExpTimestampMs(): number | null {
    return this.expTimestampMs
  }

  hasActiveTimer(): boolean {
    return this.timer !== null
  }
}
