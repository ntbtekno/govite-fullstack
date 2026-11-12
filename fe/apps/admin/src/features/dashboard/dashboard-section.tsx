import {
  Card,
  CardContent,
  CardHeader,
} from "@app/ui/components/card"
import { Skeleton } from "@app/ui/components/skeleton"
import { LoginTerakhirCard } from "./login-terakhir-card"
import { TransaksiBulanIniCard } from "./transaksi-bulan-ini-card"
import type { MonthlyTransactions, LastLogin } from "@/lib/dashboard-api"

interface DashboardSectionProps {
  lastLogin: LastLogin | null
  monthly: MonthlyTransactions | null
  isLoading: boolean
  isRefetching: boolean
  lastSync: string | null
  draftFrom: string
  draftTo: string
  appliedFrom: string
  appliedTo: string
  defaultFrom: string
  defaultTo: string
  maxDate: string
  isDraftInvalid: boolean
  invalidMessage: string
  serverErrorMessage: string | null
  hasCustomRange: boolean
  onDraftFromChange: (value: string) => void
  onDraftToChange: (value: string) => void
  onApply: () => void
  onReset: () => void
}

export function DashboardSection({
  lastLogin,
  monthly,
  isLoading,
  isRefetching,
  lastSync,
  draftFrom,
  draftTo,
  appliedFrom,
  appliedTo,
  defaultFrom,
  defaultTo,
  maxDate,
  isDraftInvalid,
  invalidMessage,
  serverErrorMessage,
  hasCustomRange,
  onDraftFromChange,
  onDraftToChange,
  onApply,
  onReset,
}: DashboardSectionProps) {
  if (!monthly) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <LoginTerakhirCard lastLogin={lastLogin} />
        <TransaksiBulanIniCardSkeleton />
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Left column: Login Terakhir (narrower) */}
      <div className="md:col-span-1">
        <LoginTerakhirCard lastLogin={lastLogin} />
      </div>
      {/* Right column: Chart (wider) */}
      <div className="md:col-span-2">
        <TransaksiBulanIniCard
          monthly={monthly}
          isLoading={isLoading}
          isRefetching={isRefetching}
          lastSync={lastSync}
          draftFrom={draftFrom}
          draftTo={draftTo}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          defaultFrom={defaultFrom}
          defaultTo={defaultTo}
          maxDate={maxDate}
          isDraftInvalid={isDraftInvalid}
          invalidMessage={invalidMessage}
          serverErrorMessage={serverErrorMessage}
          hasCustomRange={hasCustomRange}
          onDraftFromChange={onDraftFromChange}
          onDraftToChange={onDraftToChange}
          onApply={onApply}
          onReset={onReset}
        />
      </div>
    </div>
  )
}

function TransaksiBulanIniCardSkeleton() {
  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-8 w-36" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-8 w-36" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-7 w-48" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-[3px]">
          {Array.from({ length: 30 }).map((_, i) => (
            <Skeleton key={i} className="flex-1 rounded-t" style={{ height: `${((i * 37) % 80) + 10}%` }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-8" />
        </div>
        <Skeleton className="mt-3 h-4 w-32" />
      </CardContent>
    </Card>
  )
}