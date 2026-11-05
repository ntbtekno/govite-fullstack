import { useState } from "react"
import { DownloadIcon } from "lucide-react"
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
import {
  downloadPaymentExcel,
  filterByRange,
  getDefaultPaymentDateRange,
} from "./export"
import type { PaymentRow } from "./mock"

export function PaymentExportDialog({
  filteredRows,
}: {
  filteredRows: PaymentRow[]
}) {
  const [open, setOpen] = useState(false)
  const defaultRange = getDefaultPaymentDateRange()
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [isExporting, setIsExporting] = useState(false)

  const isInvalidRange = endDate < startDate
  const exportRows = isInvalidRange
    ? []
    : filterByRange(filteredRows, startDate, endDate)
  const hasNoData = !isInvalidRange && exportRows.length === 0

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      const fresh = getDefaultPaymentDateRange()
      setStartDate(fresh.startDate)
      setEndDate(fresh.endDate)
    }
    setOpen(nextOpen)
  }

  const handleDownload = async () => {
    if (isInvalidRange || hasNoData || isExporting) return
    try {
      setIsExporting(true)
      await downloadPaymentExcel(exportRows, startDate, endDate)
      setOpen(false)
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
          <DialogTitle>Export Excel History Payment</DialogTitle>
          <DialogDescription>
            Pilih rentang tanggal (berdasarkan tanggal transaksi).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="payment-start-date">Tanggal Mulai</Label>
            <Input
              id="payment-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="payment-end-date">Tanggal Selesai</Label>
            <Input
              id="payment-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <p>
              Keterangan: Filter tanggal di atas dihitung{" "}
              <strong>berdasarkan tanggal transaksi</strong>.
            </p>
            <p className="mt-1">
              Jumlah baris yang akan diekspor:{" "}
              <strong className="text-foreground">
                {isInvalidRange ? 0 : exportRows.length}
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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button">
              Batal
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={isInvalidRange || hasNoData || isExporting}
            onClick={handleDownload}
          >
            {isExporting ? "Mengunduh..." : "Unduh Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
