import { describe, expect, it } from "vitest"
import { loginPathForSession } from "./session-kind"

describe("loginPathForSession", () => {
  it("sends a mitra session (mitraId set) to /login-mitra", () => {
    expect(loginPathForSession({ mitraId: "mitra-1" })).toBe("/login-mitra")
  })

  it("sends a non-mitra session (mitraId null) to /login", () => {
    expect(loginPathForSession({ mitraId: null })).toBe("/login")
  })

  it("uses a known user over the remembered kind", () => {
    expect(loginPathForSession({ mitraId: null, remembered: "mitra" })).toBe(
      "/login"
    )
    expect(loginPathForSession({ mitraId: "mitra-1", remembered: "internal" })).toBe(
      "/login-mitra"
    )
  })

  it("falls back to the remembered kind once the user is cleared", () => {
    expect(loginPathForSession({ remembered: "mitra" })).toBe("/login-mitra")
    expect(loginPathForSession({ remembered: "internal" })).toBe("/login")
    expect(loginPathForSession({ remembered: null })).toBe("/login")
  })
})
