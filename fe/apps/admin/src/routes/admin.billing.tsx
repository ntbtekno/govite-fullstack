import { createFileRoute, redirect } from "@tanstack/react-router"
import { BillingPage } from "@/features/billing/billing-page"

export const Route = createFileRoute("/admin/billing")({
  // Mitra-only report page: a mitra session plus billing.view, else the
  // dashboard (the parent /admin route already requires authentication).
  beforeLoad: ({ context }) => {
    if (!context.auth.user?.mitraId || !context.auth.can("billing", "view")) {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: BillingPage,
})
