import { z } from "zod"
import { PasswordSchema as password } from "./security"

export const LoginRequestSchema = z.object({
  login: z.string().trim().min(1),
  password,
  captchaId: z.string().min(1),
  captcha: z.string().min(1).max(16),
  rememberMe: z.boolean().optional(),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const LoginMitraRequestSchema = z.object({
  mitraKode: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password,
  captchaId: z.string().min(1),
  captcha: z.string().min(1).max(16),
  rememberMe: z.boolean().optional(),
})
export type LoginMitraRequest = z.infer<typeof LoginMitraRequestSchema>

/** Captcha challenge returned by GET /auth/captcha. The image is a PNG data
 * URL; the plaintext code never leaves the server. */
export const CaptchaSchema = z.object({
  captchaId: z.string().min(1),
  image: z.string().startsWith("data:image/png;base64,"),
  expiresIn: z.number().int().positive(),
})
export type Captcha = z.infer<typeof CaptchaSchema>

export const LoginResponseSchema = z.discriminatedUnion("requiresTwoFactor", [
  z.object({
    requiresTwoFactor: z.literal(true),
    challengeToken: z.string(),
    setupRequired: z.boolean(),
    manualKey: z.string().optional(),
    otpauthUrl: z.string().optional(),
  }),
  z.object({
    requiresTwoFactor: z.literal(false).default(false),
    accessToken: z.string(),
    accessTokenExpiresInSeconds: z.number(),
    user: z.object({
      id: z.uuid(),
      email: z.email(),
      roleId: z.uuid(),
      mitraId: z.uuid().nullable().optional(),
      mitraKode: z.string().nullable().optional(),
      username: z.string().nullable().optional(),
    }),
    refreshToken: z.string().optional(),
    // Only present right after first-time 2FA setup; shown once.
    backupCodes: z.array(z.string()).optional(),
  }),
])
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const TwoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().regex(/^\d{6}$/),
  rememberMe: z.boolean().optional(),
})
export type TwoFactorVerifyRequest = z.infer<
  typeof TwoFactorVerifyRequestSchema
>

export const TwoFactorBackupRequestSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  backupCode: z.string().trim().min(1).max(32),
  rememberMe: z.boolean().optional(),
})
export type TwoFactorBackupRequest = z.infer<
  typeof TwoFactorBackupRequestSchema
>

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresInSeconds: z.number(),
  refreshToken: z.string().optional(),
})
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>

export const ForgotPasswordRequestSchema = z.object({
  email: z.email(),
  channel: z.enum(["web", "mobile"]).default("web"),
})
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>

export const ResetPasswordRequestSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("web"),
    token: z.string().min(32).max(256),
    newPassword: password,
  }),
  z.object({
    channel: z.literal("mobile"),
    email: z.email(),
    otp: z.string().regex(/^\d{6}$/),
    newPassword: password,
  }),
])
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>

export const AcceptInviteRequestSchema = z.object({
  token: z.string().min(32).max(256),
  fullName: z.string().trim().min(1).max(100),
  password,
})
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>

export const VerifyEmailRequestSchema = z.object({
  token: z.string().min(32).max(256),
})
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>
