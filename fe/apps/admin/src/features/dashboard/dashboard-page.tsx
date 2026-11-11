import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/card"
import { PageHeader } from "@/components/page"
import { DashboardAnnouncements } from "@/features/announcements/dashboard-announcements"
import { useAuth } from "@/lib/auth-context"
import { dashboardApi } from "@/lib/dashboard-api"
import { LoginTerakhirCard } from "./login-terakhir-card"
import { TransaksiBulanIniCard } from "./transaksi-bulan-ini-card"

export function DashboardPage() {
  const { user } = useAuth()
  const isMitra = Boolean(user?.mitraId)

  // Loaded once when the page opens; the dashboard cards never poll.
  const summary = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => dashboardApi.summary(),
    refetchInterval: false,
    retry: 1,
  })

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user?.fullName ?? user?.email}.`}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Role</CardDescription>
            <CardTitle>{user?.roleName}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Permissions</CardDescription>
            <CardTitle>{user?.permissions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Email</CardDescription>
            <CardTitle className="truncate text-base">{user?.email}</CardTitle>
          </CardHeader>
          <CardContent />
        </Card>
        <LoginTerakhirCard lastLogin={summary.data?.lastLogin ?? null} />
        {isMitra && summary.data?.monthlyTransactions ? (
          <TransaksiBulanIniCard monthly={summary.data.monthlyTransactions} />
        ) : null}
        <DashboardAnnouncements />
      </div>
    </>
  )
}
