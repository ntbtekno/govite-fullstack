import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IdleTimer } from "./idle-timer"

describe("IdleTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires onWarning at (idle - warning) and onIdle at idle", () => {
    const onWarning = vi.fn()
    const onIdle = vi.fn()
    const timer = new IdleTimer(15 * 60_000, 60_000)

    timer.start({ onWarning, onIdle })

    // Just before the warning point: nothing yet.
    vi.advanceTimersByTime(15 * 60_000 - 60_000 - 1)
    expect(onWarning).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(onIdle).toHaveBeenCalledTimes(1)

    timer.destroy()
  })

  it("activity resets the idle window before it expires", () => {
    const onWarning = vi.fn()
    const onIdle = vi.fn()
    const timer = new IdleTimer(60_000, 10_000)
    timer.start({ onWarning, onIdle })

    vi.advanceTimersByTime(30_000)
    timer.reset()
    vi.advanceTimersByTime(30_000)

    // Only 30s idle since the reset: neither event yet.
    expect(onWarning).not.toHaveBeenCalled()
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20_000)
    expect(onWarning).toHaveBeenCalledTimes(1)

    timer.destroy()
  })

  it("stops firing after stop()", () => {
    const onWarning = vi.fn()
    const onIdle = vi.fn()
    const timer = new IdleTimer(60_000, 10_000)
    timer.start({ onWarning, onIdle })
    timer.stop()

    vi.advanceTimersByTime(120_000)
    expect(onWarning).not.toHaveBeenCalled()
    expect(onIdle).not.toHaveBeenCalled()
    expect(timer.isRunning()).toBe(false)
  })

  it("setPolicy re-arms with the new idle window (remember toggled)", () => {
    const onWarning = vi.fn()
    const onIdle = vi.fn()
    const timer = new IdleTimer(15 * 60_000, 60_000)
    timer.start({ onWarning, onIdle })
    timer.setPolicy(60 * 60_000, 60_000)

    vi.advanceTimersByTime(15 * 60_000)
    expect(onWarning).not.toHaveBeenCalled()

    vi.advanceTimersByTime(45 * 60_000 - 60_000)
    expect(onWarning).toHaveBeenCalledTimes(1)

    timer.destroy()
  })

  it("arms both timers after reset", () => {
    const timer = new IdleTimer(15 * 60_000, 60_000)
    timer.start()
    expect(timer.hasActiveTimers()).toBe(true)
    timer.reset()
    expect(timer.hasActiveTimers()).toBe(true)
    timer.destroy()
  })
})
