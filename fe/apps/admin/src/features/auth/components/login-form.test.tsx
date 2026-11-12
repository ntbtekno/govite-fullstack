import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LoginForm } from "./login-form"
import { click, render, submit } from "../../../test-utils"
import { ApiError } from "../../../lib/api-client"

const login = vi.fn()
const loginMitra = vi.fn()
const verifyTwoFactor = vi.fn()
const verifyTwoFactorBackup = vi.fn()
const getCaptcha = vi.fn()
const navigate = vi.fn()
const push = vi.fn()

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    login,
    loginMitra,
    verifyTwoFactor,
    verifyTwoFactorBackup,
  }),
}))
vi.mock("@/lib/auth-api", () => ({
  getCaptcha: () => getCaptcha(),
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({ history: { push } }),
}))

let captchaSeq = 0
function nextCaptcha() {
  captchaSeq += 1
  return {
    captchaId: `cap-${captchaSeq}`,
    image: "data:image/png;base64,AAAA",
    expiresIn: 120,
  }
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  captchaSeq = 0
  login.mockReset()
  loginMitra.mockReset()
  verifyTwoFactor.mockReset()
  verifyTwoFactorBackup.mockReset()
  getCaptcha.mockReset()
  navigate.mockReset()
  push.mockReset()
  sessionStorage.clear()
  document.body.replaceChildren()
})

describe("LoginForm", () => {
  it("submits credentials with a solved captcha and redirects", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockResolvedValue({ requiresTwoFactor: false })
    await render(<LoginForm redirectTo="/admin/users" />)
    ;(document.querySelector("#login") as HTMLInputElement).value =
      "a@test.local"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(document.querySelector("form")!)
    expect(login).toHaveBeenCalledWith(
      "a@test.local",
      "Password123!",
      expect.stringMatching(/^cap-\d+$/),
      "AB123",
      false
    )
    expect(push).toHaveBeenCalledWith("/admin/users")
  })

  it("passes rememberMe=true when Ingat saya is checked", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockResolvedValue({ requiresTwoFactor: false })
    await render(<LoginForm redirectTo="/admin/users" />)
    ;(document.querySelector("#login") as HTMLInputElement).value =
      "a@test.local"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    const checkbox = document.querySelector(
      "#rememberMe"
    ) as HTMLButtonElement
    expect(checkbox).not.toBeNull()
    await click(checkbox)
    await submit(document.querySelector("form")!)
    expect(login).toHaveBeenCalledWith(
      "a@test.local",
      "Password123!",
      expect.stringMatching(/^cap-\d+$/),
      "AB123",
      true
    )
  })

  it("reloads the captcha after a failed login", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockRejectedValue(new ApiError(401, "INVALID_CAPTCHA", "Invalid"))
    await render(<LoginForm />)
    ;(document.querySelector("#login") as HTMLInputElement).value = "a@test.local"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "WRONG"
    await submit(document.querySelector("form")!)
    // At least the initial load plus one reload after the failure.
    expect(getCaptcha.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(login).toHaveBeenCalledWith(
      "a@test.local",
      "Password123!",
      expect.any(String),
      "WRONG",
      false
    )
    const nextSubmit = document.querySelector("form")!
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(nextSubmit)
    const firstCall = login.mock.calls[0]
    const lastCall = login.mock.calls[login.mock.calls.length - 1]
    // The captcha id changed after the reload, and the new answer is sent.
    expect(firstCall[3]).toBe("WRONG")
    expect(lastCall[1]).toBe("Password123!")
    expect(lastCall[3]).toBe("AB123")
    expect(lastCall[2]).not.toBe(firstCall[2])
  })

  it("renders the mitra variant with kode and username fields", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    loginMitra.mockResolvedValue({ requiresTwoFactor: false })
    await render(<LoginForm variant="mitra" redirectTo="/admin/dashboard" />)
    ;(document.querySelector("#mitraKode") as HTMLInputElement).value = "MTR-001"
    ;(document.querySelector("#username") as HTMLInputElement).value = "admin"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(document.querySelector("form")!)
    expect(loginMitra).toHaveBeenCalledWith(
      "MTR-001",
      "admin",
      "Password123!",
      expect.stringMatching(/^cap-\d+$/),
      "AB123",
      false
    )
    expect(push).toHaveBeenCalledWith("/admin/dashboard")
  })

  it("submits two-factor code after password challenge", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockResolvedValue({
      requiresTwoFactor: true,
      challengeToken: "challenge",
      setupRequired: true,
      manualKey: "SECRET",
      otpauthUrl: "otpauth://totp/App:a@test.local?secret=SECRET",
    })
    verifyTwoFactor.mockResolvedValue({
      requiresTwoFactor: false,
      backupCodes: ["11111-11111", "22222-22222"],
    })
    await render(<LoginForm redirectTo="/admin/users" />)
    ;(document.querySelector("#login") as HTMLInputElement).value =
      "a@test.local"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(document.querySelector("form")!)
    expect(document.body.textContent).toContain("SECRET")
    expect(document.querySelector("svg")).not.toBeNull()
    const code = document.querySelector("#code") as HTMLInputElement
    expect(new RegExp(`^(?:${code.pattern})$`).test("123456")).toBe(true)
    code.value = "123456"
    await submit(document.querySelector("form")!)
    expect(verifyTwoFactor).toHaveBeenCalledWith("challenge", "123456", false)
    // Backup codes are shown once before the redirect happens.
    expect(push).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("11111-11111")
    const continueBtn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("continue")
    )
    expect(continueBtn).not.toBeUndefined()
    await click(continueBtn!)
    expect(push).toHaveBeenCalledWith("/admin/users")
  })

  it("logs in with a backup code when authenticator is unavailable", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockResolvedValue({
      requiresTwoFactor: true,
      challengeToken: "challenge",
      setupRequired: false,
    })
    verifyTwoFactorBackup.mockResolvedValue({ requiresTwoFactor: false })
    await render(<LoginForm redirectTo="/admin/users" />)
    ;(document.querySelector("#login") as HTMLInputElement).value =
      "a@test.local"
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(document.querySelector("form")!)
    await click(document.querySelector("button[type=button]")!)
    ;(document.querySelector("#backupCode") as HTMLInputElement).value =
      "11111-11111"
    await submit(document.querySelector("form")!)
    expect(verifyTwoFactorBackup).toHaveBeenCalledWith(
      "challenge",
      "11111-11111",
      false
    )
    expect(push).toHaveBeenCalledWith("/admin/users")
  })

  it("shows throttled error and clears password", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    login.mockRejectedValue(new ApiError(429, undefined, "Too many"))
    await render(<LoginForm />)
    const password = document.querySelector("#password") as HTMLInputElement
    ;(document.querySelector("#login") as HTMLInputElement).value =
      "a@test.local"
    password.value = "Password123!"
    ;(document.querySelector("#captcha") as HTMLInputElement).value = "AB123"
    await submit(document.querySelector("form")!)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Terlalu banyak percobaan"
    )
    expect(password.value).toBe("")
  })

  it("displays session expired message from cookie and clears it", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    document.cookie =
      "sessionExpiredMessage=Sesi%20Anda%20telah%20berakhir.%20Silakan%20masuk%20kembali.; path=/; max-age=60"
    await render(<LoginForm />)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Sesi Anda telah berakhir. Silakan masuk kembali."
    )
    // Cookie should be cleared after reading
    expect(document.cookie).not.toContain("sessionExpiredMessage")
  })

  it("does not show session expired message on manual logout", async () => {
    getCaptcha.mockImplementation(async () => nextCaptcha())
    // Simulate manual logout by NOT setting cookie
    document.cookie = "sessionExpiredMessage=; path=/; max-age=0"
    await render(<LoginForm />)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
