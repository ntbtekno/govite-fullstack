import { createFileRoute, redirect } from "@tanstack/react-router"
import { CreateVAPage } from "@/features/tools/create-va-page"
import { canUser, settledAuth } from "@/lib/auth-context"

export const Route = createFileRoute("/admin/tools/create-va")({
  pendingMs: 150,
  // Mitra-only tools page: a mitra session plus va.view, else the dashboard.
  // Await the boot probe: on a hard refresh the router context still holds
  // the pre-refresh (loading, user=null) snapshot while the parent /admin
  // guard is resolving, so user/permissions must come from the settled result
  // rather than context.auth.
  beforeLoad: async ({ context }) => {
    const settled = await settledAuth(context.auth)
    if (!settled.user?.mitraId || !canUser(settled.user, "va", "view")) {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: CreateVAPage,
})
