/**
 * Extracts the expiry (in seconds since epoch) from a standard JWT access token.
 * Does NOT verify the signature (the backend verifies on every request).
 * Returns null if the token cannot be parsed or lacks an `exp` number.
 */
export function getJwtExp(token: string | null | undefined): number | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const base64Url = parts[1]
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
    // Support browser atob and standard base64 padding
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    )
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("binary")
    const payload = JSON.parse(json) as { exp?: unknown }
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}
