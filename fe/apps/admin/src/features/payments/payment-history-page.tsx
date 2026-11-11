import { Fragment, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircleIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
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

function isPollingStopError(status: number): boolean {
  return status === 429 || status === 503
}

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

  // Track if polling was stopped due to 429/503; user can re-enable by manual refresh
  const [pollingStopped, setPollingStopped] = useState(false)

  // Expanded rows are keyed by transaction id (txid) so the 20s realtime poll
  // never collapses a row the user opened. After each fetch, ids whose
  // transaction left the page are dropped (see queryFn below).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

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
      // Forget expanded rows whose transaction is no longer on this page, so
      // the set does not grow unbounded across pagination and polling.
      setExpandedIds((prev) => {
        if (prev.size === 0) return prev
        const visible = new Set(res.items.map((r) => r.id))
        const next = new Set([...prev].filter((id) => visible.has(id)))
        return next.size === prev.size ? prev : next
      })
      return res
    },
    refetchInterval: tabVisible && !pollingStopped ? REFETCH_INTERVAL : false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && isPollingStopError(error.status)) {
        // Stop polling on 429 or 503
        setPollingStopped(true)
        return false
      }
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

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

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
              {pollingStopped ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
                    <span className="size-1.5 rounded-full bg-amber-600" />
                    POLLING DIBERHENTIKAN
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPollingStopped(false)
                      query.refetch()
                    }}
                  >
                    Aktifkan polling
                  </Button>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-600" />
                    LIVE
                  </span>
                  {updatedAt && <span>diperbarui {clockFmt.format(updatedAt)}</span>}
                </>
              )}
            </div>
            {canExport && !is503 && !pollingStopped && (
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

      <div
        className="w-full min-w-0 rounded-xl border [&_[data-slot=table-container]]:overflow-x-visible [&_[data-slot=table]]:table-fixed [&_[data-slot=table-cell]]:whitespace-normal! [&_[data-slot=table-head]]:whitespace-normal!"
        data-testid="payment-table-wrapper"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" aria-label="Perluas" />
              <TableHead className="w-44">Tanggal Transaksi</TableHead>
              <TableHead>No VA / Referensi</TableHead>
              <TableHead>ID Transaksi</TableHead>
              <TableHead className="w-32 text-right">Nominal</TableHead>
              <TableHead className="w-24">Status</TableHead>
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
                {items.map((r) => {
                  const expanded = expandedIds.has(r.id)
                  const detailFields: { label: string; value: string }[] = [
                    { label: "Keterangan", value: r.message || "-" },
                    { label: "Tanggal Transaksi (txdate)", value: r.txDate || "-" },
                    { label: "ID", value: r.id },
                  ]
                  return (
                    <Fragment key={r.id}>
                      <TableRow data-state={expanded ? "selected" : undefined}>
                        <TableCell className="w-10 align-top">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(r.id)}
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? "Tutup detail transaksi"
                                : "Buka detail transaksi"
                            }
                            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {expanded ? (
                              <ChevronDownIcon className="size-4" />
                            ) : (
                              <ChevronRightIcon className="size-4" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs align-top">
                          {formatTransactionAt(r.transactionAt)}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all align-top">
                          {r.vaNumber}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all align-top">
                          {r.reference || "-"}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          {rupiah(r.amount)}
                        </TableCell>
                        <TableCell className="align-top">
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                            Berhasil
                          </span>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow
                          data-testid="payment-detail-row"
                          className="border-0 bg-muted/30 hover:bg-muted/30"
                        >
                          <TableCell colSpan={6} className="p-0">
                            <dl className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-2">
                              {detailFields.map((f) => (
                                <div
                                  key={f.label}
                                  className="flex gap-2 text-xs"
                                >
                                  <dt className="w-48 shrink-0 text-muted-foreground">
                                    {f.label}
                                  </dt>
                                  <dd className="min-w-0 break-all font-mono text-foreground">
                                    {f.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
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
