import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/page"
import { DashboardAnnouncements } from "@/features/announcements/dashboard-announcements"
import { useAuth } from "@/lib/auth-context"
import { dashboardApi, type MonthlyTransactions } from "@/lib/dashboard-api"
import { ApiError } from "@/lib/api-client"
import { LoginTerakhirCard } from "./login-terakhir-card"
import { DashboardSection } from "./dashboard-section"

const MAX_RANGE_DAYS = 31

export const RANGE_LIMIT_MESSAGE =
  "Rentang tanggal maksimal 1 bulan (31 hari). Silakan pilih tanggal mulai dan tanggal sampai dalam 1 bulan."

// Difference in whole days between two YYYY-MM-DD strings, or null when either
// is missing/unparsable.
function rangeSpanDays(from: string, to: string): number | null {
  if (!from || !to) return null
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000))
}

// Default to current month in Asia/Makassar (UTC+8)
function getCurrentMonthBounds() {
  const now = new Date()
  // Convert to Asia/Makassar (UTC+8)
  const makassarOffset = 8 * 60 * 60 * 1000
  const localNow = new Date(now.getTime() + makassarOffset)
  const firstDay = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1))
  const today = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()))
  const toLocalDateString = (d: Date) => d.toISOString().split("T")[0]
  return {
    from: toLocalDateString(firstDay),
    to: toLocalDateString(today),
    today: toLocalDateString(today),
  }
}

export function DashboardPage() {
  const { user } = useAuth()
  const isMitra = Boolean(user?.mitraId)

  const defaultBounds = getCurrentMonthBounds()
  const maxDate = defaultBounds.today

  // Applied range - used for API query and card display
  const [appliedFrom, setAppliedFrom] = useState(defaultBounds.from)
  const [appliedTo, setAppliedTo] = useState(defaultBounds.to)

  // Draft range - edited by user, only applied on "Terapkan" click
  const [draftFrom, setDraftFrom] = useState(defaultBounds.from)
  const [draftTo, setDraftTo] = useState(defaultBounds.to)

  const spanDays = rangeSpanDays(draftFrom, draftTo)
  const isRangeTooLong = spanDays !== null && spanDays > MAX_RANGE_DAYS

  const isDraftInvalid = Boolean(
    (draftFrom && draftTo && draftFrom > draftTo) ||
      (draftFrom && maxDate && draftFrom > maxDate) ||
      (draftTo && maxDate && draftTo > maxDate) ||
      isRangeTooLong
  )

  const invalidMessage =
    draftFrom && maxDate && draftFrom > maxDate
      ? "Tanggal Dari tidak boleh melebihi hari ini"
      : draftTo && maxDate && draftTo > maxDate
        ? "Tanggal Sampai tidak boleh melebihi hari ini"
        : draftFrom && draftTo && draftFrom > draftTo
          ? "Tanggal Dari tidak boleh melebihi tanggal Sampai"
          : RANGE_LIMIT_MESSAGE

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

  // Query 1: lastLogin (no params, loaded once, never refetches)
  const lastLoginQuery = useQuery({
    queryKey: ["dashboard", "lastLogin"],
    queryFn: () => dashboardApi.summary().then((r) => r.lastLogin),
    refetchInterval: false,
    retry: 1,
  })

  // Query 2: monthlyTransactions (with date params, refetches when applied range changes)
  const monthlyQuery = useQuery({
    queryKey: ["dashboard", "monthly", { from: appliedFrom, to: appliedTo }],
    queryFn: () => dashboardApi.summary({ from: appliedFrom, to: appliedTo }).then((r) => r.monthlyTransactions),
    refetchInterval: false,
    retry: 1,
    enabled: Boolean(appliedFrom && appliedTo),
    placeholderData: (previous) => previous,
  })

  // Remember the last successful chart payload so a rejected apply (e.g. a
  // backend 400 VALIDATION_ERROR) leaves the previous chart visible instead of
  // clearing it; the error is surfaced inline on the card.
  const [lastMonthly, setLastMonthly] = useState<MonthlyTransactions | null>(monthlyQuery.data ?? null)
  if (monthlyQuery.data && monthlyQuery.data !== lastMonthly) {
    setLastMonthly(monthlyQuery.data)
  }
  const monthly = monthlyQuery.data ?? lastMonthly

  // A backend rejection (400 VALIDATION_ERROR) leaves the previous chart in
  // place and surfaces the reason inline on the card.
  const serverErrorMessage =
    monthlyQuery.error instanceof ApiError
      ? (monthlyQuery.error.messageInd ??
        (monthlyQuery.error.status === 400 ? RANGE_LIMIT_MESSAGE : monthlyQuery.error.message))
      : monthlyQuery.error
        ? "Gagal memuat grafik. Silakan coba lagi."
        : null

  // Track last successful fetch time for "Terakhir diperbarui" display
  const [lastSync, setLastSync] = useState<string | null>(null)
  const hasCompletedInitialFetch = useRef(false)
  useEffect(() => {
    if (monthlyQuery.data) {
      // The initial dashboard load establishes the baseline. Subsequent
      // successful payloads are the user-requested refreshes whose time we
      // expose; this also avoids rendering a timestamp before the first
      // refetch has happened.
      if (!hasCompletedInitialFetch.current) {
        hasCompletedInitialFetch.current = true
        return
      }
      const now = new Date()
      const makassarOffset = 8 * 60 * 60 * 1000
      const makassarTime = new Date(now.getTime() + makassarOffset)
      const timeStr = makassarTime.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Makassar",
      })
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync on successful fetch
      setLastSync(timeStr)
    }
  }, [monthlyQuery.data])

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user?.fullName ?? user?.email}.`}
      />
      {isMitra ? (
        <DashboardSection
          lastLogin={lastLoginQuery.data ?? null}
          monthly={monthly}
          isLoading={monthlyQuery.isLoading && !lastMonthly}
          isRefetching={monthlyQuery.isFetching && !monthlyQuery.isLoading}
          lastSync={lastSync}
          draftFrom={draftFrom}
          draftTo={draftTo}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          defaultFrom={defaultBounds.from}
          defaultTo={defaultBounds.to}
          maxDate={maxDate}
          isDraftInvalid={isDraftInvalid}
          invalidMessage={invalidMessage}
          serverErrorMessage={serverErrorMessage}
          hasCustomRange={hasCustomRange}
          onDraftFromChange={setDraftFrom}
          onDraftToChange={setDraftTo}
          onApply={handleApply}
          onReset={handleReset}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <LoginTerakhirCard lastLogin={lastLoginQuery.data ?? null} />
            <DashboardAnnouncements />
          </div>
        </>
      )}
    </>
  )
}
