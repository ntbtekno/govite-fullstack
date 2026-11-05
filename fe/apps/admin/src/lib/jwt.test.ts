import { describe, expect, it } from "vitest"
import { getJwtExp } from "./jwt"

describe("getJwtExp", () => {
  it("returns null for empty or non-jwt strings", () => {
    expect(getJwtExp("")).toBeNull()
    expect(getJwtExp(null)).toBeNull()
    expect(getJwtExp(undefined)).toBeNull()
    expect(getJwtExp("invalid-token")).toBeNull()
    expect(getJwtExp("header.invalid-base64.sig")).toBeNull()
  })

  it("extracts exp from valid JWT payload", () => {
    // header: {"alg":"HS256","typ":"JWT"} -> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    // payload: {"sub":"user-1","exp":1700000000} -> eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwMDB9
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwMDB9.signature"
    expect(getJwtExp(token)).toBe(1700000000)
  })

  it("handles base64url characters (- and _) and unpadded strings", () => {
    const payload = { sub: "123", test: ">>>???", exp: 1800000500 }
    const base64Url = Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

    const token = `header.${base64Url}.signature`
    expect(getJwtExp(token)).toBe(1800000500)
  })
})
