import { describe, expect, it } from "vitest"
import { CreateMitraRequestSchema } from "./admin"

const base = {
  kodeMitra: "999",
  nama: "Test mitra",
  partnerServiceId: "     999",
  vaPrefix: "99941",
  branchCode: "001",
  rateLimitTier: "standard",
  ipWhitelist: [],
}

describe("CreateMitraRequestSchema callbackUrl", () => {
  it("requires an HTTPS callback URL", () => {
    expect(CreateMitraRequestSchema.safeParse(base).success).toBe(false)
    expect(CreateMitraRequestSchema.safeParse({ ...base, callbackUrl: "http://example.com/callback" }).success).toBe(false)
    expect(CreateMitraRequestSchema.safeParse({ ...base, callbackUrl: "https://example.com/callback" }).success).toBe(true)
  })
})
