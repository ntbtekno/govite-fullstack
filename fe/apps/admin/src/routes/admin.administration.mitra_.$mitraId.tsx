import { createFileRoute, redirect } from "@tanstack/react-router"
import { MitraDetailPage } from "@/features/mitra/mitra-detail-page"
import { canUser, settledAuth } from "@/lib/auth-context"

export const Route = createFileRoute("/admin/administration/mitra_/$mitraId")({
  beforeLoad: async ({ context }) => {
    const auth = await settledAuth(context.auth)
    if (auth.user?.mitraId || !canUser(auth.user, "mitra", "manage")) throw redirect({ to: "/admin/dashboard" })
  },
  component: MitraDetailPage,
})
