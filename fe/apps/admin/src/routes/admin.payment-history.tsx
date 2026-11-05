import { createFileRoute, redirect } from "@tanstack/react-router"
import { PaymentHistoryPage } from "@/features/payments/payment-history-page"

export const Route = createFileRoute("/admin/payment-history")({
  // Mitra-only report page: a mitra session plus payments.view, else the
  // dashboard (the parent /admin route already requires authentication).
  beforeLoad: ({ context }) => {
    if (!context.auth.user?.mitraId || !context.auth.can("payments", "view")) {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: PaymentHistoryPage,
})
