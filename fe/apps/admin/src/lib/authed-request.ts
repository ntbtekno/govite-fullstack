import {
  apiBlob,
  apiRequest,
  apiRequestPage,
  ApiError,
  type ApiRequestOptions,
  type Page,
} from "./api-client"
import { getAccessToken } from "./token-store"
import { refreshSession } from "./refresh-session"
import { toast } from "sonner"

let onSessionExpired: (() => void) | null = null

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler
}

function toastApiError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 401) return
    const title =
      err.status === 403
        ? "Access Denied"
        : err.status >= 500
          ? "Server Error"
          : "Request Failed"
    toast.error(title, { description: err.messageInd ?? err.message })
  } else if (err instanceof TypeError) {
    toast.error("Network Error", {
      description: "Could not reach the server. Check your connection.",
    })
  }
}

async function withRefresh<T>(request: (token: string | null) => Promise<T>) {
  try {
    return await request(getAccessToken())
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      toastApiError(err)
      throw err
    }
    const result = await refreshSession()
    if (result.kind === "expired") {
      onSessionExpired?.()
      throw err
    }
    // Transient (429/5xx/network) during refresh: don't logout, propagate error
    // The watchdog will handle retry with backoff
    throw err
  }
}

export function authedRequest<TResponse = void, TBody = undefined>(
  path: string,
  options: ApiRequestOptions<TResponse, TBody> = {}
): Promise<TResponse> {
  return withRefresh((accessToken) =>
    apiRequest(path, { ...options, accessToken })
  )
}

export function authedPage<TItem>(path: string): Promise<Page<TItem>> {
  return withRefresh((accessToken) =>
    apiRequestPage<TItem>(path, { accessToken })
  )
}

export function authedDownload(
  path: string
): Promise<{ blob: Blob; filename: string | null }> {
  return withRefresh((accessToken) => apiBlob(path, accessToken))
}

/** Query string from params, dropping undefined and empty values. */
export const qs = (p: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(
    Object.entries(p).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]]
    )
  ).toString()

export interface ListParams {
  page: number
  limit: number
  search?: string
}

export type SortOrder = "asc" | "desc"

/** FormData with a single file field. */
export function fileForm(file: File, field = "file"): FormData {
  const body = new FormData()
  body.append(field, file)
  return body
}
