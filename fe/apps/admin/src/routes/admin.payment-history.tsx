import { createFileRoute, redirect } from "@tanstack/react-router"
import { PaymentHistoryPage } from "@/features/payments/payment-history-page"
import { canUser, settledAuth } from "@/lib/auth-context"
import { PaymentHistorySkeleton } from "@/components/payment-history-skeleton"

export const Route = createFileRoute("/admin/payment-history")({
  pendingMs: 150,
  pendingComponent: PaymentHistorySkeleton,
  // Mitra-only report page: a mitra session plus payments.view, else the
  // dashboard. Await the boot probe: on a hard refresh the router context still
  // holds the pre-refresh (loading, user=null) snapshot while the parent
  // /admin guard is resolving, so user/permissions must come from the settled
  // result rather than context.auth.
  beforeLoad: async ({ context }) => {
    const settled = await settledAuth(context.auth)
    if (!settled.user?.mitraId || !canUser(settled.user, "payments", "view")) {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: PaymentHistoryPage,
})
