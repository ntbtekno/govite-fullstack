import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@app/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/dialog"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import { reportsApi } from "@/lib/reports-api"
import {
  downloadBillingExcel,
  fetchAllBillingRows,
  getDefaultBillingDateRange,
  MAX_EXPORT_ROWS,
} from "./export"

export function BillingExportDialog({ currentQ }: { currentQ?: string }) {
  const [open, setOpen] = useState(false)
  const defaultRange = getDefaultBillingDateRange()
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [isExporting, setIsExporting] = useState(false)

  const isInvalidRange = endDate < startDate

  // Query live total for page 1 based on currently selected dates & search query
  const countQuery = useQuery({
    queryKey: [
      "reports",
      "billing",
      "export-count",
      { q: currentQ, from: startDate, to: endDate },
    ],
    queryFn: () =>
      reportsApi.billing({
        q: currentQ || undefined,
        from: startDate,
        to: endDate,
        page: 1,
        pageSize: 1,
      }),
    enabled: open && !isInvalidRange,
  })

  const exportTotal = countQuery.data?.total ?? 0
  const hasNoData =
    !isInvalidRange && !countQuery.isPending && !countQuery.isError && exportTotal === 0
  const isOverLimit = exportTotal > MAX_EXPORT_ROWS

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      const fresh = getDefaultBillingDateRange()
      setStartDate(fresh.startDate)
      setEndDate(fresh.endDate)
    }
    setOpen(nextOpen)
  }

  const handleDownload = async () => {
    if (isInvalidRange || hasNoData || isOverLimit || isExporting) return
    try {
      setIsExporting(true)
      const allRows = await fetchAllBillingRows({
        q: currentQ || undefined,
        from: startDate,
        to: endDate,
      })
      await downloadBillingExcel(allRows, startDate, endDate)
      setOpen(false)
    } catch (err) {
      toast.error("Export Gagal", {
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <DownloadIcon className="mr-1.5 size-4" />
          Export Excel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Excel Billing Tagihan</DialogTitle>
          <DialogDescription>
            Pilih rentang tanggal (berdasarkan tanggal VA dibuat).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="billing-start-date">Tanggal Mulai</Label>
            <Input
              id="billing-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="billing-end-date">Tanggal Selesai</Label>
            <Input
              id="billing-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <p>
              Keterangan: Filter tanggal di atas dihitung{" "}
              <strong>berdasarkan tanggal VA dibuat</strong>.
            </p>
            <p className="mt-1">
              Jumlah baris yang akan diekspor:{" "}
              <strong className="text-foreground">
                {isInvalidRange
                  ? 0
                  : countQuery.isPending
                    ? "Menghitung..."
                    : countQuery.isError
                      ? "-"
                      : exportTotal.toLocaleString("id-ID")}
              </strong>{" "}
              baris
            </p>
          </div>

          {isInvalidRange && (
            <p className="text-xs font-medium text-destructive">
              Tanggal selesai tidak boleh lebih awal dari tanggal mulai.
            </p>
          )}

          {hasNoData && (
            <p className="text-xs font-medium text-destructive">
              Tidak ada data pada range ini
            </p>
          )}

          {isOverLimit && (
            <p className="text-xs font-medium text-destructive">
              Jumlah data ({exportTotal.toLocaleString("id-ID")}) melebihi batas
              maksimum ekspor ({MAX_EXPORT_ROWS.toLocaleString("id-ID")} baris).
              Mohon persempit rentang tanggal.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button">
              Batal
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={
              isInvalidRange ||
              hasNoData ||
              isOverLimit ||
              countQuery.isPending ||
              isExporting
            }
            onClick={handleDownload}
          >
            {isExporting ? "Mengunduh..." : "Unduh Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
