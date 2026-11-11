/**
 * Derives a short human label from a raw user agent string, e.g. "Chrome · macOS".
 * Falls back to a trimmed slice of the raw user agent when neither the browser
 * nor the operating system is recognised.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim()
  if (!ua) return "-"

  const browser = detectBrowser(ua)
  const os = detectOS(ua)

  if (browser && os) return `${browser} · ${os}`
  if (browser) return browser
  if (os) return os
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua
}

function detectBrowser(ua: string): string | null {
  // Order matters: Edge/Opera/Chrome all carry the "Chrome" token.
  if (/Edg\/|EdgA\/|EdgiOS\//i.test(ua)) return "Edge"
  if (/OPR\/|Opera/i.test(ua)) return "Opera"
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet"
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox"
  if (/CriOS\//i.test(ua)) return "Chrome"
  if (/Chrome\//i.test(ua)) return "Chrome"
  if (/Safari\//i.test(ua)) return "Safari"
  return null
}

function detectOS(ua: string): string | null {
  if (/Windows NT/i.test(ua)) return "Windows"
  if (/Android/i.test(ua)) return "Android"
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS"
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS"
  if (/CrOS/i.test(ua)) return "ChromeOS"
  if (/Linux/i.test(ua)) return "Linux"
  return null
}
