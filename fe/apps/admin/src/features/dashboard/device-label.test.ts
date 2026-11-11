import { describe, expect, it } from "vitest"
import { deviceLabel } from "./device-label"

describe("deviceLabel", () => {
  it("labels Chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    expect(deviceLabel(ua)).toBe("Chrome · macOS")
  })

  it("labels Firefox on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
    expect(deviceLabel(ua)).toBe("Firefox · Windows")
  })

  it("labels Safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    expect(deviceLabel(ua)).toBe("Safari · iOS")
  })

  it("labels Edge on Windows (before the Chrome token)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    expect(deviceLabel(ua)).toBe("Edge · Windows")
  })

  it("labels Chrome on Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    expect(deviceLabel(ua)).toBe("Chrome · Android")
  })

  it("falls back to a trimmed raw user agent when unrecognised", () => {
    const ua =
      "SomeCustomAgent/1.0 (Unknown platform; totally unrecognised string)"
    expect(deviceLabel(ua)).toBe("SomeCustomAgent/1.0 (Unknown platform; t…")
  })

  it("handles empty and missing values", () => {
    expect(deviceLabel("")).toBe("-")
    expect(deviceLabel(null)).toBe("-")
    expect(deviceLabel(undefined)).toBe("-")
  })
})
