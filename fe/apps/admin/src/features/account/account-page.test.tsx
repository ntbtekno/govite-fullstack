import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AccountPage } from "./account-page"
import { render, submit } from "@/test-utils"
import { ApiError } from "@/lib/api-client"

const state = vi.hoisted(() => ({
  changePassword: vi.fn(),
  sessions: vi.fn(),
  notificationPreferences: vi.fn(),
  refreshUser: vi.fn(),
  attachments: vi.fn(),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  sendVerification: vi.fn(),
  twoFactor: vi.fn(),
  beginTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  resetTwoFactor: vi.fn(),
  uploadAttachment: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  removeAttachment: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: toastMock,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "test@app.local",
      fullName: "Test User",
      emailVerified: true,
      avatarUrl: null,
      mitraId: null,
    },
    refreshUser: state.refreshUser,
  }),
}))

vi.mock("@/features/account/api", () => ({
  accountApi: {
    changePassword: state.changePassword,
    sessions: state.sessions,
    notificationPreferences: state.notificationPreferences,
    updateProfile: state.updateProfile,
    uploadAvatar: state.uploadAvatar,
    sendVerification: state.sendVerification,
    twoFactor: state.twoFactor,
    beginTwoFactorSetup: state.beginTwoFactorSetup,
    confirmTwoFactorSetup: state.confirmTwoFactorSetup,
    disableTwoFactor: state.disableTwoFactor,
    regenerateBackupCodes: state.regenerateBackupCodes,
    resetTwoFactor: state.resetTwoFactor,
    attachments: state.attachments,
    uploadAttachment: state.uploadAttachment,
    revokeSession: state.revokeSession,
    revokeOtherSessions: state.revokeOtherSessions,
    updateNotificationPreferences: state.updateNotificationPreferences,
    removeAttachment: state.removeAttachment,
  },
}))

vi.mock("@/features/account/two-factor-card", () => ({
  TwoFactorCard: () => <div data-testid="two-factor-card" />,
}))

vi.mock("@/components/page", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  ),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const renderPage = async () => {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe("AccountPage password change", () => {
  beforeEach(() => {
    state.sessions.mockResolvedValue([])
    state.notificationPreferences.mockResolvedValue({ pushEnabled: true })
    state.attachments.mockResolvedValue([])
    state.twoFactor.mockResolvedValue({ enabled: false })
    state.updateProfile.mockResolvedValue({ id: "1" })
    state.uploadAvatar.mockResolvedValue({ avatarUrl: null })
    state.sendVerification.mockResolvedValue(undefined)
    state.beginTwoFactorSetup.mockResolvedValue({})
    state.confirmTwoFactorSetup.mockResolvedValue({})
    state.disableTwoFactor.mockResolvedValue(undefined)
    state.regenerateBackupCodes.mockResolvedValue({})
    state.resetTwoFactor.mockResolvedValue(undefined)
    state.uploadAttachment.mockResolvedValue({})
    state.revokeSession.mockResolvedValue(undefined)
    state.revokeOtherSessions.mockResolvedValue(undefined)
    state.updateNotificationPreferences.mockResolvedValue({ pushEnabled: true })
    state.removeAttachment.mockResolvedValue(undefined)
  })

  it("shows error toast when current password is wrong (INVALID_CREDENTIALS)", async () => {
    state.changePassword.mockRejectedValue(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials", "Email atau password salah")
    )

    const { host } = await renderPage()

    const currentPassword = host.querySelector<HTMLInputElement>("#currentPassword")
    const newPassword = host.querySelector<HTMLInputElement>("#newPassword")

    expect(currentPassword).not.toBeNull()
    expect(newPassword).not.toBeNull()

    currentPassword!.value = "wrong-password"
    newPassword!.value = "NewPassword123!"

    await submit(host.querySelector("[data-testid=password-form]")!)

    await vi.waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Password saat ini salah.")
    })
  })

  it("shows validation error toast when new password is invalid (VALIDATION_ERROR)", async () => {
    state.changePassword.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Validation failed", "Validasi gagal", "newPassword: password=8;32")
    )

    const { host } = await renderPage()

    const currentPassword = host.querySelector<HTMLInputElement>("#currentPassword")
    const newPassword = host.querySelector<HTMLInputElement>("#newPassword")

    currentPassword!.value = "correct-password"
    newPassword!.value = "short"

    await submit(host.querySelector("[data-testid=password-form]")!)

    await vi.waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Validasi gagal", {
        description: "Validasi gagal",
      })
    })
  })

  it("shows success toast when password change succeeds", async () => {
    state.changePassword.mockResolvedValue(undefined)

    const { host } = await renderPage()

    const currentPassword = host.querySelector<HTMLInputElement>("#currentPassword")
    const newPassword = host.querySelector<HTMLInputElement>("#newPassword")

    currentPassword!.value = "correct-password"
    newPassword!.value = "NewPassword123!"

    await submit(host.querySelector("[data-testid=password-form]")!)

    await vi.waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Password changed")
    })
  })
})