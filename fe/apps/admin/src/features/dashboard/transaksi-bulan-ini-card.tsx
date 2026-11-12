import { AlertCircleIcon, CalendarIcon, RefreshCwIcon, CheckIcon, Loader2Icon, ClockIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/card"
import { Button } from "@app/ui/components/button"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import { Skeleton } from "@app/ui/components/skeleton"
import type { MonthlyTransactions } from "@/lib/dashboard-api"

const amountFmt = new Intl.NumberFormat("id-ID")

const rupiah = (n: number) => `Rp ${amountFmt.format(n)}`

function dayLabel(date: string): string {
  const parts = date.split("-")
  return parts.length === 3 ? String(Number(parts[2])) : date
}

function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00")
  if (isNaN(d.getTime())) return date
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d)
}

function formatRangeLabel(from: string, to: string): string {
  const fromDate = new Date(from + "T00:00:00")
  const toDate = new Date(to + "T00:00:00")
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return ""
  }
  const formatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" })
  if (from === to) {
    return formatter.format(fromDate)
  }
  return `${formatter.format(fromDate)} – ${formatter.format(toDate)}`
}

function isDefaultRange(from: string | undefined, to: string | undefined, defaultFrom: string | undefined, defaultTo: string | undefined): boolean {
  if (!from || !to || !defaultFrom || !defaultTo) return true
  return from === defaultFrom && to === defaultTo
}

interface TransaksiBulanIniCardProps {
  monthly: MonthlyTransactions
  isLoading: boolean
  isRefetching: boolean
  lastSync: string | null
  draftFrom?: string
  draftTo?: string
  appliedFrom?: string
  appliedTo?: string
  defaultFrom?: string
  defaultTo?: string
  maxDate?: string
  isDraftInvalid?: boolean
  invalidMessage?: string
  serverErrorMessage?: string | null
  hasCustomRange?: boolean
  onDraftFromChange?: (value: string) => void
  onDraftToChange?: (value: string) => void
  onApply?: () => void
  onReset?: () => void
}

export function TransaksiBulanIniCard({
  monthly,
  isLoading,
  isRefetching,
  lastSync,
  draftFrom = "",
  draftTo = "",
  appliedFrom,
  appliedTo,
  defaultFrom,
  defaultTo,
  maxDate,
  isDraftInvalid = false,
  invalidMessage = "Tanggal Dari tidak boleh melebihi tanggal Sampai",
  serverErrorMessage = null,
  hasCustomRange = false,
  onDraftFromChange,
  onDraftToChange,
  onApply,
  onReset,
}: TransaksiBulanIniCardProps) {
  if (monthly.unavailable) {
    return (
      <Card data-testid="transaksi-bulan-ini-card" className="md:col-span-3">
        <CardHeader>
          <CardDescription>Transaksi Bulan Ini</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <AlertCircleIcon className="size-6 text-amber-500" />
            <p className="font-medium text-foreground">
              Sumber data laporan belum tersedia.
            </p>
            <p className="text-xs text-muted-foreground">
              Database laporan belum dikonfigurasi pada server ini.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Skeleton while initial load
  if (isLoading) {
    return (
      <Card data-testid="transaksi-bulan-ini-card" className="md:col-span-3">
        <CardHeader>
          <CardDescription>Transaksi Bulan Ini</CardDescription>
        </CardHeader>
        <CardContent>
          <div data-testid="dashboard-chart-loader" className="sr-only" aria-live="polite">Memuat grafik…</div>
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

  const max = monthly.days.reduce((m, d) => Math.max(m, d.count), 0)
  const heightPct = (count: number) => (max > 0 ? (count / max) * 100 : 0)

  const isDefault = isDefaultRange(appliedFrom, appliedTo, defaultFrom, defaultTo)
  const rangeLabel = appliedFrom && appliedTo ? formatRangeLabel(appliedFrom, appliedTo) : ""
  const cardTitle = isDefault ? "Transaksi Bulan Ini" : `Transaksi ${rangeLabel}`

  const coverage = monthly.coverage

  return (
    <Card data-testid="transaksi-bulan-ini-card" className="md:col-span-3">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardDescription className="flex items-center gap-1.5">
            <CalendarIcon className="size-4" />
            {cardTitle}
          </CardDescription>
          {hasCustomRange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="gap-1.5 text-xs"
              disabled={isRefetching}
            >
              <RefreshCwIcon className="size-3.5" />
              Bulan ini
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="dashboard-filter-from" className="text-xs text-muted-foreground whitespace-nowrap">
              Dari
            </Label>
            <Input
              id="dashboard-filter-from"
              type="date"
              aria-label="Dari"
              value={draftFrom}
              max={maxDate}
              onChange={(e) => onDraftFromChange?.(e.target.value)}
              className="w-36 text-xs"
              disabled={monthly.unavailable || isRefetching}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="dashboard-filter-to" className="text-xs text-muted-foreground whitespace-nowrap">
              Sampai
            </Label>
            <Input
              id="dashboard-filter-to"
              type="date"
              aria-label="Sampai"
              value={draftTo}
              max={maxDate}
              onChange={(e) => onDraftToChange?.(e.target.value)}
              className="w-36 text-xs"
              disabled={monthly.unavailable || isRefetching}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onApply}
            disabled={isDraftInvalid || isRefetching}
            className="gap-1.5"
            data-testid="dashboard-apply-btn"
          >
            {isRefetching ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            Terapkan
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          {isDraftInvalid && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {invalidMessage}
            </p>
          )}
          {!isDraftInvalid && serverErrorMessage && (
            <p role="alert" data-testid="dashboard-server-error" className="text-xs font-medium text-destructive">
              {serverErrorMessage}
            </p>
          )}
          {lastSync && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
              <ClockIcon className="size-3.5" />
              <span>Terakhir diperbarui: {lastSync}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <CardTitle className="text-2xl">
            Total transaksi: {amountFmt.format(monthly.total)}
          </CardTitle>
          <CardTitle className="text-2xl">
            Total nominal: {rupiah(monthly.totalAmount)}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isRefetching && (
          <div data-testid="dashboard-chart-loader" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2Icon className="size-3.5 animate-spin" /> Memuat grafik…
          </div>
        )}
        <div
          data-testid="transaksi-chart"
          className="relative flex h-40 items-end gap-[3px]"
          style={{ opacity: isRefetching ? 0.7 : 1 }}
        >
          {monthly.days.map((d) => (
            <div
              key={d.date}
              data-testid="transaksi-bar"
              title={`${d.date} — ${amountFmt.format(d.count)} transaksi`}
              aria-label={`${d.date} — ${amountFmt.format(d.count)} transaksi`}
              className="flex-1 rounded-t bg-primary/70 transition-opacity"
              style={{
                height: d.count > 0 ? `${heightPct(d.count)}%` : "2px",
              }}
            />
          ))}
          {isRefetching && (
            <div
              className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-md px-2 py-1 text-xs text-muted-foreground border"
              aria-live="polite"
            >
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>Memperbarui…</span>
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{monthly.days[0] ? dayLabel(monthly.days[0].date) : ""}</span>
          <span>
            {monthly.days.length > 0
              ? dayLabel(monthly.days[monthly.days.length - 1].date)
              : ""}
          </span>
        </div>
        {max === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada transaksi pada rentang ini.
          </p>
        )}
        {coverage && (
          <p data-testid="dashboard-coverage" className="mt-3 text-xs text-muted-foreground">
            Data tersimpan: {formatDate(coverage.minDate)} – {formatDate(coverage.lastDate)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
