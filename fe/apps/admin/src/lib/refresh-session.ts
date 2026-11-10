import type { MeResponse } from "@app/contracts"
import { getMe, refreshAccessToken } from "./auth-api"
import { ApiError } from "./api-client"

export interface Session {
  accessToken: string
  user: MeResponse
}

export type RefreshResult =
  | { kind: "success"; session: Session }
  | { kind: "expired"; message: string }
  | { kind: "transient"; retryAfterMs: number; message: string }

let inFlight: Promise<RefreshResult> | null = null

export function refreshSession(): Promise<RefreshResult> {
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

function isTransientError(status: number): boolean {
  return status === 429 || status >= 500
}

function calculateRetryAfter(status: number, attempt: number): number {
  if (status === 429) {
    // First retry after ~30s, then ~60s
    return attempt === 1 ? 30_000 : 60_000
  }
  // 5xx: exponential backoff starting at 30s
  return Math.min(30_000 * Math.pow(2, attempt - 1), 120_000)
}

async function performRefresh(attempt = 1): Promise<RefreshResult> {
  try {
    const { accessToken } = await refreshAccessToken()
    const user = await getMe(accessToken)
    return { kind: "success", session: { accessToken, user } }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        return {
          kind: "expired",
          message: err.messageInd ?? "Sesi Anda telah berakhir. Silakan masuk kembali.",
        }
      }
      if (isTransientError(err.status)) {
        const retryAfterMs = calculateRetryAfter(err.status, attempt)
        // Retry once for transient errors
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, retryAfterMs))
          return performRefresh(attempt + 1)
        }
        return {
          kind: "transient",
          retryAfterMs,
          message: err.messageInd ?? "Terjadi kesalahan sementara. Mencoba lagi...",
        }
      }
    }
    // Network or other errors: treat as transient, retry once
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 30_000))
      return performRefresh(attempt + 1)
    }
    return {
      kind: "transient",
      retryAfterMs: 60_000,
      message: "Terjadi kesalahan jaringan. Mencoba lagi...",
    }
  }
}
