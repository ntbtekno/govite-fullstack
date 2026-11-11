import { AlertCircleIcon, CalendarIcon, RefreshCwIcon, CheckIcon } from "lucide-react"
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
import type { MonthlyTransactions } from "@/lib/dashboard-api"

const amountFmt = new Intl.NumberFormat("id-ID")

function dayLabel(date: string): string {
  // date is YYYY-MM-DD from the API; render the day number only.
  const parts = date.split("-")
  return parts.length === 3 ? String(Number(parts[2])) : date
}

function formatRangeLabel(from: string, to: string): string {
  const fromDate = new Date(from + "T00:00:00")
  const toDate = new Date(to + "T00:00:00")
  // Check for invalid dates
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
  draftFrom?: string
  draftTo?: string
  appliedFrom?: string
  appliedTo?: string
  defaultFrom?: string
  defaultTo?: string
  isDraftInvalid?: boolean
  hasCustomRange?: boolean
  onDraftFromChange?: (value: string) => void
  onDraftToChange?: (value: string) => void
  onApply?: () => void
  onReset?: () => void
}

export function TransaksiBulanIniCard({
  monthly,
  draftFrom = "",
  draftTo = "",
  appliedFrom,
  appliedTo,
  defaultFrom,
  defaultTo,
  isDraftInvalid = false,
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

  const max = monthly.days.reduce((m, d) => Math.max(m, d.count), 0)
  // Every bar keeps a visible minimum so empty days still show a stub.
  const heightPct = (count: number) => (max > 0 ? (count / max) * 100 : 0)

  const isDefault = isDefaultRange(appliedFrom, appliedTo, defaultFrom, defaultTo)
  const rangeLabel = appliedFrom && appliedTo ? formatRangeLabel(appliedFrom, appliedTo) : ""
  const cardTitle = isDefault ? "Transaksi Bulan Ini" : `Transaksi ${rangeLabel}`

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
              onChange={(e) => onDraftFromChange?.(e.target.value)}
              className="w-36 text-xs"
              disabled={monthly.unavailable}
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
              onChange={(e) => onDraftToChange?.(e.target.value)}
              className="w-36 text-xs"
              disabled={monthly.unavailable}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onApply}
            disabled={isDraftInvalid}
            className="gap-1.5"
            data-testid="dashboard-apply-btn"
          >
            <CheckIcon className="size-3.5" />
            Terapkan
          </Button>
        </div>
        {isDraftInvalid && (
          <p role="alert" className="text-xs font-medium text-destructive">
            Tanggal Dari tidak boleh melebihi tanggal Sampai
          </p>
        )}
        <CardTitle className="text-2xl">
          {amountFmt.format(monthly.total)} transaksi
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          data-testid="transaksi-chart"
          className="flex h-40 items-end gap-[3px]"
        >
          {monthly.days.map((d) => (
            <div
              key={d.date}
              data-testid="transaksi-bar"
              title={`${d.date} — ${amountFmt.format(d.count)} transaksi`}
              aria-label={`${d.date} — ${amountFmt.format(d.count)} transaksi`}
              className="flex-1 rounded-t bg-primary/70"
              style={{
                height: d.count > 0 ? `${heightPct(d.count)}%` : "2px",
              }}
            />
          ))}
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
      </CardContent>
    </Card>
  )
}
