import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearSessionPolicy,
  rememberMe,
  sessionStartedAt,
  startSession,
} from "./session-policy"

// happy-dom does not provide localStorage unless a backing file is given, so
// install a Map-backed shim for these tests (the app's own accessor is safe
// either way; this only makes the assertions possible).
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

describe("session-policy", () => {
  beforeEach(() => {
    installLocalStorage()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    clearSessionPolicy()
  })

  it("defaults to not remembered with no stored start time", () => {
    expect(rememberMe()).toBe(false)
    expect(sessionStartedAt()).toBeNull()
  })

  it("startSession(false) keeps the start time tab-scoped", () => {
    startSession(false, 1_700_000_000_000)
    expect(rememberMe()).toBe(false)
    expect(sessionStartedAt()).toBe(1_700_000_000_000)
    // Not remembered: nothing persists in localStorage and the session store
    // is dropped when the browser closes.
    expect(window.localStorage.getItem("govite:remember")).toBe("false")
    expect(window.sessionStorage.getItem("govite:session-started-at")).toBe(
      "1700000000000"
    )
  })

  it("startSession(true) persists the start time for the absolute cap", () => {
    startSession(true, 1_700_000_000_000)
    expect(rememberMe()).toBe(true)
    expect(sessionStartedAt()).toBe(1_700_000_000_000)
    expect(window.localStorage.getItem("govite:session-started-at")).toBe(
      "1700000000000"
    )
  })

  it("clearSessionPolicy wipes both stores", () => {
    startSession(true, 1_700_000_000_000)
    clearSessionPolicy()
    expect(rememberMe()).toBe(false)
    expect(sessionStartedAt()).toBeNull()
  })
})
