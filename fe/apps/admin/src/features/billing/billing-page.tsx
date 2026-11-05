import { useEffect, useRef, useState } from "react"
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
import { Pagination } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useAuth } from "@/lib/auth-context"
import { BillingExportDialog } from "./billing-export-dialog"
import {
  BILLING_STATUSES,
  generateBilling,
  makeBillingRow,
  type BillingRow,
  type BillingStatus,
} from "./mock"

const PAGE_SIZE = 10
const ANY = "all" as const

const statusLabel: Record<BillingStatus, string> = {
  unpaid: "Belum Dibayar",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
}

const statusTone: Record<BillingStatus, string> = {
  unpaid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  expired: "bg-slate-200 text-slate-700",
  cancelled: "bg-rose-100 text-rose-800",
}

const amountFmt = new Intl.NumberFormat("id-ID")
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})
const clockFmt = new Intl.DateTimeFormat("id-ID", { timeStyle: "medium" })

const rupiah = (n: number) => `Rp ${amountFmt.format(n)}`
const when = (iso: string) => dateFmt.format(new Date(iso))

export function BillingPage() {
  const { can } = useAuth()
  const canExport = can("billing", "export")
  const [rows, setRows] = useState<BillingRow[]>(() => generateBilling())
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<BillingStatus | typeof ANY>(ANY)
  const [page, setPage] = useState(1)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const highlightTimer = useRef<number | undefined>(undefined)

  // Mock realtime source: one new row every 20s while the tab is visible. This
  // timer/list is replaced by the API (or a websocket) in a later stage.
  useEffect(() => {
    let timer: number | undefined
    let offset = 0
    const start = () => {
      if (timer !== undefined) return
      timer = window.setInterval(() => {
        offset += 1
        const row: BillingRow = {
          ...makeBillingRow(900000 + offset, new Date(), offset),
          status: "unpaid",
        }
        setRows((prev) => [row, ...prev])
        setUpdatedAt(new Date())
        setHighlightId(row.id)
        window.clearTimeout(highlightTimer.current)
        highlightTimer.current = window.setTimeout(
          () => setHighlightId((current) => (current === row.id ? null : current)),
          2000
        )
      }, 20000)
    }
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      window.clearTimeout(highlightTimer.current)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const query = search.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (status !== ANY && r.status !== status) return false
    if (!query) return true
    return (
      r.vaNumber.toLowerCase().includes(query) ||
      r.payerName.toLowerCase().includes(query) ||
      r.description.toLowerCase().includes(query)
    )
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )
  const totalAmount = filtered.reduce((sum, r) => sum + r.amount, 0)
  const today = new Date().toDateString()
  const todayCount = rows.filter(
    (r) => new Date(r.createdAt).toDateString() === today
  ).length

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Billing Tagihan"
        description="Tagihan Virtual Account mitra."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-600" />
                LIVE
              </span>
              {updatedAt && <span>diperbarui {clockFmt.format(updatedAt)}</span>}
            </div>
            {canExport && <BillingExportDialog filteredRows={filtered} />}
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          Tagihan hari ini:{" "}
          <strong className="text-foreground">{todayCount}</strong>
        </span>
        <span>
          Jumlah tagihan:{" "}
          <strong className="text-foreground">{filtered.length}</strong>
        </span>
        <span>
          Total nominal:{" "}
          <strong className="text-foreground">{rupiah(totalAmount)}</strong>
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
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={status === ANY ? "default" : "outline"}
            onClick={() => {
              setStatus(ANY)
              setPage(1)
            }}
          >
            Semua
          </Button>
          {BILLING_STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => {
                setStatus(s)
                setPage(1)
              }}
            >
              {statusLabel[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>VA Number</TableHead>
              <TableHead>Pembayar</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Tidak ada tagihan.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow
                  key={r.id}
                  className={
                    r.id === highlightId ? "bg-amber-50 transition-colors" : ""
                  }
                >
                  <TableCell className="font-mono text-xs">{r.vaNumber}</TableCell>
                  <TableCell>{r.payerName}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-right">{rupiah(r.amount)}</TableCell>
                  <TableCell className="text-xs">{when(r.createdAt)}</TableCell>
                  <TableCell className="text-xs">{when(r.dueAt)}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[r.status]}`}
                    >
                      {statusLabel[r.status]}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        total={filtered.length}
        onPageChange={setPage}
      />
    </div>
  )
}
