import { AlertCircleIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/card"
import type { MonthlyTransactions } from "@/lib/dashboard-api"

const amountFmt = new Intl.NumberFormat("id-ID")

function dayLabel(date: string): string {
  // date is YYYY-MM-DD from the API; render the day number only.
  const parts = date.split("-")
  return parts.length === 3 ? String(Number(parts[2])) : date
}

export function TransaksiBulanIniCard({
  monthly,
}: {
  monthly: MonthlyTransactions
}) {
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

  return (
    <Card data-testid="transaksi-bulan-ini-card" className="md:col-span-3">
      <CardHeader>
        <CardDescription>Transaksi Bulan Ini</CardDescription>
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
        {max === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada transaksi bulan ini.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
