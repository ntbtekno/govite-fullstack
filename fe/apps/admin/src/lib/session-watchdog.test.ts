import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionWatchdog } from "./session-watchdog"
import * as refreshModule from "./refresh-session"

function makeJwt(expSec: number): string {
  const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  const payload = Buffer.from(
    JSON.stringify({ sub: "user-1", exp: expSec })
  ).toString("base64url")
  return `${header}.${payload}.sig`
}

describe("SessionWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("schedules a timer exactly according to token exp claim", () => {
    const onSessionRefreshed = vi.fn()
    const onSessionExpired = vi.fn()
    const watchdog = new SessionWatchdog({
      onSessionRefreshed,
      onSessionExpired,
    })

    const nowSec = 1700000000
    vi.setSystemTime(nowSec * 1000)

    const token = makeJwt(nowSec + 300) // expires in 300 seconds
    watchdog.schedule(token)

    expect(watchdog.hasActiveTimer()).toBe(true)
    expect(watchdog.getExpTimestampMs()).toBe((nowSec + 300) * 1000)

    watchdog.destroy()
  })

  it("triggers refreshSession when timer fires; on success reschedules with new token", async () => {
    const onSessionRefreshed = vi.fn()
    const onSessionExpired = vi.fn()
    const watchdog = new SessionWatchdog({
      onSessionRefreshed,
      onSessionExpired,
    })

    const nowSec = 1700000000
    vi.setSystemTime(nowSec * 1000)

    const token1 = makeJwt(nowSec + 10)
    const token2 = makeJwt(nowSec + 10 + 300)

    const refreshSpy = vi
      .spyOn(refreshModule, "refreshSession")
      .mockResolvedValue({
        kind: "success",
        session: {
          accessToken: token2,
          user: {
            id: "u1",
            email: "a@b.c",
            roleId: "r1",
            roleName: "Mitra",
            fullName: "User One",
            avatarUrl: null,
            emailVerified: true,
            permissions: [],
          },
        },
      })

    watchdog.schedule(token1)

    // Advance 10 seconds: timer fires
    await vi.advanceTimersByTimeAsync(10 * 1000)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(onSessionRefreshed).toHaveBeenCalledTimes(1)
    expect(onSessionExpired).not.toHaveBeenCalled()

    // Rescheduled with token2 (exp is nowSec + 310)
    expect(watchdog.hasActiveTimer()).toBe(true)
    expect(watchdog.getExpTimestampMs()).toBe((nowSec + 310) * 1000)

    watchdog.destroy()
  })

  it("triggers onSessionExpired exactly once when refreshSession fails", async () => {
    const onSessionRefreshed = vi.fn()
    const onSessionExpired = vi.fn()
    const watchdog = new SessionWatchdog({
      onSessionRefreshed,
      onSessionExpired,
    })

    const nowSec = 1700000000
    vi.setSystemTime(nowSec * 1000)

    const token = makeJwt(nowSec + 15)
    vi.spyOn(refreshModule, "refreshSession").mockResolvedValue({
      kind: "expired",
      message: "Session expired",
    })

    watchdog.schedule(token)

    await vi.advanceTimersByTimeAsync(15 * 1000)

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(watchdog.hasActiveTimer()).toBe(false)

    watchdog.destroy()
  })

  it("stop() cancels timer and clears state (manual logout)", () => {
    const watchdog = new SessionWatchdog()
    const token = makeJwt(Math.floor(Date.now() / 1000) + 100)

    watchdog.schedule(token)
    expect(watchdog.hasActiveTimer()).toBe(true)

    watchdog.stop()
    expect(watchdog.hasActiveTimer()).toBe(false)
    expect(watchdog.getExpTimestampMs()).toBeNull()

    watchdog.destroy()
  })

  it("does not allow duplicate timers when scheduled repeatedly", () => {
    const watchdog = new SessionWatchdog()
    const token1 = makeJwt(Math.floor(Date.now() / 1000) + 100)
    const token2 = makeJwt(Math.floor(Date.now() / 1000) + 200)

    watchdog.schedule(token1)
    watchdog.schedule(token2)

    expect(watchdog.hasActiveTimer()).toBe(true)
    expect(watchdog.getExpTimestampMs()).toBe(
      (Math.floor(Date.now() / 1000) + 200) * 1000
    )

    watchdog.destroy()
  })

  it("handles transient error (429) without calling onSessionExpired and schedules retry", async () => {
    const onSessionRefreshed = vi.fn()
    const onSessionExpired = vi.fn()
    const onTransientError = vi.fn()
    const watchdog = new SessionWatchdog({
      onSessionRefreshed,
      onSessionExpired,
      onTransientError,
    })

    const nowSec = 1700000000
    vi.setSystemTime(nowSec * 1000)

    const token1 = makeJwt(nowSec + 10)
    const token2 = makeJwt(nowSec + 10 + 300)

    let callCount = 0
    const refreshSpy = vi
      .spyOn(refreshModule, "refreshSession")
      .mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // First call: transient error (429)
          return { kind: "transient", retryAfterMs: 30_000, message: "Rate limited" }
        }
        // Second call: success
        return {
          kind: "success",
          session: {
            accessToken: token2,
            user: {
              id: "u1",
              email: "a@b.c",
              roleId: "r1",
              roleName: "Mitra",
              fullName: "User One",
              avatarUrl: null,
              emailVerified: true,
              permissions: [],
            },
          },
        }
      })

    watchdog.schedule(token1)

    // Advance 10 seconds: timer fires
    await vi.advanceTimersByTimeAsync(10 * 1000)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(onTransientError).toHaveBeenCalledTimes(1)
    expect(onTransientError).toHaveBeenCalledWith(30_000, "Rate limited")

    // Advance by retryAfterMs (30s): retry fires
    await vi.advanceTimersByTimeAsync(30_000)

    expect(refreshSpy).toHaveBeenCalledTimes(2)
    expect(onSessionRefreshed).toHaveBeenCalledTimes(1)
    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(onTransientError).toHaveBeenCalledTimes(1) // still only 1

    // Rescheduled with token2
    expect(watchdog.hasActiveTimer()).toBe(true)
    expect(watchdog.getExpTimestampMs()).toBe((nowSec + 310) * 1000)

    watchdog.destroy()
  })

  it("transient then expired ends in expired path exactly once", async () => {
    const onSessionRefreshed = vi.fn()
    const onSessionExpired = vi.fn()
    const onTransientError = vi.fn()
    const watchdog = new SessionWatchdog({
      onSessionRefreshed,
      onSessionExpired,
      onTransientError,
    })

    const nowSec = 1700000000
    vi.setSystemTime(nowSec * 1000)

    const token = makeJwt(nowSec + 15)

    let callCount = 0
    vi.spyOn(refreshModule, "refreshSession").mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return { kind: "transient", retryAfterMs: 30_000, message: "Rate limited" }
      }
      // Second call: expired (401)
      return { kind: "expired", message: "Session expired" }
    })

    watchdog.schedule(token)

    await vi.advanceTimersByTimeAsync(15 * 1000)

    expect(onTransientError).toHaveBeenCalledTimes(1)

    // Advance by retryAfterMs
    await vi.advanceTimersByTimeAsync(30_000)

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    expect(onSessionExpired).toHaveBeenCalledWith("Session expired")
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(watchdog.hasActiveTimer()).toBe(false)

    watchdog.destroy()
  })
})
