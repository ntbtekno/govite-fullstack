// Idle session timer. Watches user activity (mouse, keyboard, click, scroll,
// touch) and fires:
//   - onWarning when the idle window nears its end (warningBeforeMs left),
//   - onIdle when the full idle window elapses with no activity.
// Any activity resets both the idle deadline and the warning, so an ignored
// warning logs the user out while a single move cancels it.
export interface IdleTimerCallbacks {
  onWarning: () => void
  onIdle: () => void
}

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "click",
  "scroll",
  "touchstart",
  "wheel",
] as const

export class IdleTimer {
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private warnTimer: ReturnType<typeof setTimeout> | null = null
  private idleMs: number
  private warningBeforeMs: number
  private callbacks: IdleTimerCallbacks | null = null
  private running = false
  private boundActivity: (() => void) | null = null
  private lastActivity = 0

  constructor(idleMs: number, warningBeforeMs: number) {
    this.idleMs = idleMs
    this.warningBeforeMs = warningBeforeMs
  }

  /** Sets (or replaces) the idle window and optionally the callbacks. */
  setPolicy(idleMs: number, warningBeforeMs?: number): void {
    this.idleMs = idleMs
    if (warningBeforeMs !== undefined) this.warningBeforeMs = warningBeforeMs
    if (this.running) this.reset()
  }

  start(callbacks?: IdleTimerCallbacks): void {
    if (callbacks) this.callbacks = callbacks
    this.running = true
    this.lastActivity = Date.now()
    if (typeof document !== "undefined" && !this.boundActivity) {
      this.boundActivity = () => this.recordActivity()
      for (const ev of ACTIVITY_EVENTS) {
        document.addEventListener(ev, this.boundActivity, { passive: true })
      }
    }
    this.arm()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    if (typeof document !== "undefined" && this.boundActivity) {
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, this.boundActivity)
      }
      this.boundActivity = null
    }
  }

  /** Called by the caller's "Tetap masuk" button; also fires on user activity. */
  reset(): void {
    if (!this.running) return
    this.lastActivity = Date.now()
    this.clearTimers()
    this.arm()
  }

  destroy(): void {
    this.stop()
    this.callbacks = null
  }

  private recordActivity(): void {
    if (!this.running) return
    // Coalesce the high-frequency events (mousemove/scroll/wheel): one reset
    // per second is plenty to keep the session alive.
    const now = Date.now()
    if (now - this.lastActivity < 1000) return
    this.reset()
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.warnTimer !== null) {
      clearTimeout(this.warnTimer)
      this.warnTimer = null
    }
  }

  private arm(): void {
    const warnAt = this.idleMs - this.warningBeforeMs
    if (warnAt > 0) {
      this.warnTimer = setTimeout(() => this.callbacks?.onWarning(), warnAt)
    }
    this.idleTimer = setTimeout(() => this.callbacks?.onIdle(), this.idleMs)
  }

  // Inspection helpers for tests
  hasActiveTimers(): boolean {
    return this.idleTimer !== null && this.warnTimer !== null
  }

  isRunning(): boolean {
    return this.running
  }
}
