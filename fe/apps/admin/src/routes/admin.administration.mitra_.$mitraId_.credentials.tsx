import { createFileRoute, redirect } from "@tanstack/react-router"
import { CredentialDeliveryPage } from "@/features/mitra/credential-delivery-page"
import { canUser, settledAuth } from "@/lib/auth-context"

export const Route = createFileRoute("/admin/administration/mitra_/$mitraId_/credentials")({
  beforeLoad: async ({ context }) => {
    const auth = await settledAuth(context.auth)
    if (auth.user?.mitraId || !canUser(auth.user, "mitra", "manage")) throw redirect({ to: "/admin/dashboard" })
  },
  component: CredentialDeliveryPage,
})
