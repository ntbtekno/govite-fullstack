import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircleIcon } from "lucide-react"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import { Button } from "@app/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/table"
import { Pagination, TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useAuth } from "@/lib/auth-context"
import { useDebounced } from "@/lib/use-debounced"
import { ApiError } from "@/lib/api-client"
import { reportsApi, type PaymentReportItem } from "@/lib/reports-api"
import { formatTransactionAt } from "./export"
import { PaymentExportDialog } from "./payment-export-dialog"

export type PaymentRow = PaymentReportItem

const PAGE_SIZE = 10
const REFETCH_INTERVAL = 20000

const amountFmt = new Intl.NumberFormat("id-ID")
const clockFmt = new Intl.DateTimeFormat("id-ID", { timeStyle: "medium" })

const rupiah = (n: number) => `Rp ${amountFmt.format(n)}`

export function PaymentHistoryPage() {
  const { can } = useAuth()
  const canExport = can("payments", "export")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, 300)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [page, setPage] = useState(1)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const isInvalidDateRange = Boolean(fromDate && toDate && fromDate > toDate)

  // Only pass dates to API when valid
  const effectiveFrom = isInvalidDateRange ? undefined : fromDate || undefined
  const effectiveTo = isInvalidDateRange ? undefined : toDate || undefined

  const [tabVisible, setTabVisible] = useState(!document.hidden)
  useEffect(() => {
    const handleVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  const query = useQuery({
    queryKey: [
      "reports",
      "payments",
      {
        q: debouncedSearch,
        from: effectiveFrom,
        to: effectiveTo,
        page,
        pageSize: PAGE_SIZE,
      },
    ],
    queryFn: async () => {
      const res = await reportsApi.payments({
        q: debouncedSearch || undefined,
        from: effectiveFrom,
        to: effectiveTo,
        page,
        pageSize: PAGE_SIZE,
      })
      setUpdatedAt(new Date())
      return res
    },
    refetchInterval: tabVisible ? REFETCH_INTERVAL : false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 503) return false
      return failureCount < 2
    },
  })

  const is503 =
    query.error instanceof ApiError &&
    (query.error.status === 503 || query.error.code === "REPORTS_UNAVAILABLE")

  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = query.data?.items ?? []
  const summary = query.data?.summary ?? { count: total, totalAmount: 0 }

  const hasDateFilter = Boolean(fromDate || toDate)

  const handleResetDates = () => {
    setFromDate("")
    setToDate("")
    setPage(1)
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title="History Payment"
        description="Riwayat transaksi Virtual Account mitra."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-600" />
                LIVE
              </span>
              {updatedAt && <span>diperbarui {clockFmt.format(updatedAt)}</span>}
            </div>
            {canExport && !is503 && (
              <PaymentExportDialog currentQ={debouncedSearch} />
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          Jumlah transaksi:{" "}
          <strong className="text-foreground">
            {is503 ? "-" : summary.count.toLocaleString("id-ID")}
          </strong>
        </span>
        <span>
          Total nominal:{" "}
          <strong className="text-foreground">
            {is503 ? "-" : rupiah(summary.totalAmount)}
          </strong>
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Cari VA, nama, atau referensi"
            aria-label="Cari transaksi"
            className="w-full sm:w-64"
            disabled={is503}
          />

          <div className="flex items-center gap-1.5">
            <Label
              htmlFor="payments-filter-from"
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              Dari
            </Label>
            <Input
              id="payments-filter-from"
              type="date"
              aria-label="Dari"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setPage(1)
              }}
              className="w-36 text-xs"
              disabled={is503}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Label
              htmlFor="payments-filter-to"
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              Sampai
            </Label>
            <Input
              id="payments-filter-to"
              type="date"
              aria-label="Sampai"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setPage(1)
              }}
              className="w-36 text-xs"
              disabled={is503}
            />
          </div>

          {hasDateFilter && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetDates}
              disabled={is503}
            >
              Reset
            </Button>
          )}
        </div>

        {isInvalidDateRange && (
          <p
            role="alert"
            className="text-xs font-medium text-destructive"
          >
            Tanggal Dari tidak boleh melebihi tanggal Sampai
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal Transaksi</TableHead>
              <TableHead>No VA</TableHead>
              <TableHead>Referensi</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {is503 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircleIcon className="size-6 text-amber-500" />
                    <p className="font-medium text-foreground">
                      Sumber data laporan belum tersedia.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Database laporan belum dikonfigurasi pada server ini.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : query.isError ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <p className="text-sm text-destructive">
                      {query.error.message || "Gagal memuat data"}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => query.refetch()}
                    >
                      Coba lagi
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <>
                <TableState
                  colSpan={6}
                  loading={query.isPending}
                  empty={items.length === 0}
                  emptyText="Tidak ada data"
                />
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {formatTransactionAt(r.transactionAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.vaNumber}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.reference || "-"}
                    </TableCell>
                    <TableCell>{r.message || "-"}</TableCell>
                    <TableCell className="text-right">
                      {rupiah(r.amount)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                        Berhasil
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {!is503 && !query.isError && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
