import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { LoginForm } from "@/features/auth/components/login-form"
import { settledStatus } from "@/lib/auth-context"

const isInternalPath = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//")

export const Route = createFileRoute("/login-mitra")({
  validateSearch: (search): { redirect?: string } =>
    isInternalPath(search.redirect) ? { redirect: search.redirect } : {},
  beforeLoad: async ({ context }) => {
    if ((await settledStatus(context.auth)) === "authenticated") {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: LoginMitraPage,
})

function LoginMitraPage() {
  const { redirect: redirectTo } = Route.useSearch()
  return (
    <AuthLayout
      title="Masuk sebagai Mitra"
      description="Masukkan kode mitra, username, dan password Anda."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Superadmin?{" "}
          <a className="underline" href="/login">
            Masuk di sini
          </a>
        </p>
      }
    >
      <LoginForm variant="mitra" redirectTo={redirectTo} />
    </AuthLayout>
  )
}
