import { createFileRoute, redirect } from "@tanstack/react-router"
import { UserDetailPage } from "@/features/users/user-detail-page"
import { settledAuth } from "@/lib/auth-context"

export const Route = createFileRoute("/admin/administration/users_/$userId")({
  // A mitra session may not open any user detail page (including its own): the
  // Account page already holds its own data. Await the boot probe so a hard
  // refresh is judged on the settled session, like the report guards.
  beforeLoad: async ({ context }) => {
    const settled = await settledAuth(context.auth)
    if (settled.user?.mitraId) {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: UserDetailPage,
})
