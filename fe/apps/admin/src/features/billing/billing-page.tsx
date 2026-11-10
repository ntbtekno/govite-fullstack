import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircleIcon } from "lucide-react"
import { Input } from "@app/ui/components/input"
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
import { reportsApi, type BillingReportItem } from "@/lib/reports-api"
import { BillingExportDialog } from "./billing-export-dialog"

export type BillingRow = BillingReportItem

const PAGE_SIZE = 10
const REFETCH_INTERVAL = 20000

const amountFmt = new Intl.NumberFormat("id-ID")
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})
const clockFmt = new Intl.DateTimeFormat("id-ID", { timeStyle: "medium" })

const rupiah = (n: number) => `Rp ${amountFmt.format(n)}`
const formatDateTime = (val: string) => {
  if (!val) return "-"
  const d = new Date(val)
  return isNaN(d.getTime()) ? val : dateFmt.format(d)
}

function isPollingStopError(status: number): boolean {
  return status === 429 || status === 503
}

export function BillingPage() {
  const { can } = useAuth()
  const canExport = can("billing", "export")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, 300)
  const [page, setPage] = useState(1)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const [tabVisible, setTabVisible] = useState(!document.hidden)
  useEffect(() => {
    const handleVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  // Track if polling was stopped due to 429/503; user can re-enable by manual refresh
  const [pollingStopped, setPollingStopped] = useState(false)

  const query = useQuery({
    queryKey: [
      "reports",
      "billing",
      { q: debouncedSearch, page, pageSize: PAGE_SIZE },
    ],
    queryFn: async () => {
      const res = await reportsApi.billing({
        q: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setUpdatedAt(new Date())
      return res
    },
    refetchInterval: tabVisible && !pollingStopped ? REFETCH_INTERVAL : false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && isPollingStopError(error.status)) {
        // Stop polling on 429 or 503
        setPollingStopped(true)
        return false
      }
      // Don't retry 503 REPORTS_UNAVAILABLE immediately
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

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Billing Tagihan"
        description="Tagihan Virtual Account mitra."
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
              <BillingExportDialog currentQ={debouncedSearch} />
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          Jumlah tagihan:{" "}
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Cari VA, nama, atau keterangan"
          aria-label="Cari billing"
          className="w-full max-w-xs"
          disabled={is503}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No VA</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
              <TableHead>Tanggal Dibuat</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {is503 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
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
                <TableCell colSpan={7} className="h-32 text-center">
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
                  colSpan={7}
                  loading={query.isPending}
                  empty={items.length === 0}
                  emptyText="Tidak ada data"
                />
                {items.map((r, idx) => (
                  <TableRow key={`${r.vaNumber}-${idx}`}>
                    <TableCell className="font-mono text-xs">{r.vaNumber}</TableCell>
                    <TableCell>{r.payerName || "-"}</TableCell>
                    <TableCell>{r.description || "-"}</TableCell>
                    <TableCell className="text-right">{rupiah(r.amount)}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(r.dueAt)}</TableCell>
                    <TableCell>
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                        Aktif
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
