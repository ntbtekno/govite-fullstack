import { useState } from "react"
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

// Default to current month in Asia/Makassar (UTC+8)
function getCurrentMonthBounds() {
  const now = new Date()
  // Convert to Asia/Makassar (UTC+8)
  const makassarOffset = 8 * 60 * 60 * 1000
  const localNow = new Date(now.getTime() + makassarOffset)
  const firstDay = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1))
  const lastDay = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() + 1, 0))
  const toLocalDateString = (d: Date) => d.toISOString().split("T")[0]
  return { from: toLocalDateString(firstDay), to: toLocalDateString(lastDay) }
}

export function DashboardPage() {
  const { user } = useAuth()
  const isMitra = Boolean(user?.mitraId)

  const defaultBounds = getCurrentMonthBounds()

  // Applied range - used for API query and card display
  const [appliedFrom, setAppliedFrom] = useState(defaultBounds.from)
  const [appliedTo, setAppliedTo] = useState(defaultBounds.to)

  // Draft range - edited by user, only applied on "Terapkan" click
  const [draftFrom, setDraftFrom] = useState(defaultBounds.from)
  const [draftTo, setDraftTo] = useState(defaultBounds.to)

  const isDraftInvalid = Boolean(draftFrom && draftTo && draftFrom > draftTo)

  const handleApply = () => {
    if (isDraftInvalid) return
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
  }

  const handleReset = () => {
    setDraftFrom(defaultBounds.from)
    setDraftTo(defaultBounds.to)
    setAppliedFrom(defaultBounds.from)
    setAppliedTo(defaultBounds.to)
  }

  const hasCustomRange = appliedFrom !== defaultBounds.from || appliedTo !== defaultBounds.to

  // Loaded once when the page opens; the dashboard cards never poll.
  const summary = useQuery({
    queryKey: ["dashboard", "summary", { from: appliedFrom, to: appliedTo }],
    queryFn: () => dashboardApi.summary({ from: appliedFrom, to: appliedTo }),
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
          <TransaksiBulanIniCard
            monthly={summary.data.monthlyTransactions}
            draftFrom={draftFrom}
            draftTo={draftTo}
            appliedFrom={appliedFrom}
            appliedTo={appliedTo}
            defaultFrom={defaultBounds.from}
            defaultTo={defaultBounds.to}
            isDraftInvalid={isDraftInvalid}
            hasCustomRange={hasCustomRange}
            onDraftFromChange={setDraftFrom}
            onDraftToChange={setDraftTo}
            onApply={handleApply}
            onReset={handleReset}
          />
        ) : null}
        <DashboardAnnouncements />
      </div>
    </>
  )
}
