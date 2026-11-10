import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "@/features/dashboard/dashboard-page"
import { DashboardSkeleton } from "@/components/dashboard-skeleton"

export const Route = createFileRoute("/admin/dashboard")({
  pendingMs: 150,
  pendingComponent: DashboardSkeleton,
  component: DashboardPage,
})
