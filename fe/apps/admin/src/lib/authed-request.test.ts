import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as authedRequestModule from "./authed-request"
import { refreshSession } from "./refresh-session"
import { ApiError } from "./api-client"

const apiRequest = vi.hoisted(() => vi.fn())

vi.mock("./token-store", () => ({
  getAccessToken: vi.fn(() => "old-token"),
  setAccessToken: vi.fn(),
}))

vi.mock("./refresh-session", () => ({
  refreshSession: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}))

vi.mock("./api-client", async () => {
  const actual = await vi.importActual<typeof import("./api-client")>("./api-client")
  return {
    ...actual,
    apiRequest,
  }
})

describe("authedRequest / withRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    authedRequestModule.setOnSessionExpired(null)
  })

  it("calls onSessionExpired and rethrows when refresh returns expired (401)", async () => {
    const onSessionExpired = vi.fn()
    authedRequestModule.setOnSessionExpired(onSessionExpired)

    const originalError = new ApiError(401, "INVALID_CREDENTIALS", "Unauthorized", "Belum terautentikasi")
    apiRequest.mockRejectedValueOnce(originalError)

    vi.mocked(refreshSession).mockResolvedValue({
      kind: "expired",
      message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
    })

    await expect(authedRequestModule.authedRequest("/test")).rejects.toThrow(originalError)

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it("does NOT call onSessionExpired and does NOT call refreshSession for transient 429", async () => {
    const onSessionExpired = vi.fn()
    authedRequestModule.setOnSessionExpired(onSessionExpired)

    const originalError = new ApiError(429, "TOO_MANY_REQUESTS", "Too Many Requests", "Terlalu banyak permintaan")
    apiRequest.mockRejectedValueOnce(originalError)

    // withRefresh should NOT call refreshSession for non-401 errors
    await expect(authedRequestModule.authedRequest("/test")).rejects.toThrow(originalError)

    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it("does NOT call onSessionExpired and does NOT call refreshSession for transient 5xx", async () => {
    const onSessionExpired = vi.fn()
    authedRequestModule.setOnSessionExpired(onSessionExpired)

    const originalError = new ApiError(503, "SERVICE_UNAVAILABLE", "Service Unavailable", "Layanan tidak tersedia")
    apiRequest.mockRejectedValueOnce(originalError)

    await expect(authedRequestModule.authedRequest("/test")).rejects.toThrow(originalError)

    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it("does NOT call onSessionExpired and does NOT call refreshSession for network error", async () => {
    const onSessionExpired = vi.fn()
    authedRequestModule.setOnSessionExpired(onSessionExpired)

    const originalError = new TypeError("Network error")
    apiRequest.mockRejectedValueOnce(originalError)

    await expect(authedRequestModule.authedRequest("/test")).rejects.toThrow(originalError)

    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })
})