import { Skeleton } from "@app/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/table"

export function PaymentHistorySkeleton({
  withTestId = true,
}: {
  withTestId?: boolean
} = {}) {
  return (
    <div
      {...(withTestId ? { "data-testid": "page-skeleton" } : {})}
      data-variant="payment-skeleton"
      className="grid w-full gap-4 animate-in fade-in duration-200"
    >
      {/* Header bar: PageHeader style
          - Left: Title + Description
          - Right: pill LIVE + clock text + Button size="sm" variant="outline" */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Summary strip: Jumlah transaksi + Total nominal */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Jumlah transaksi:</span>
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex items-center gap-1.5">
          <span>Total nominal:</span>
          <Skeleton className="h-4 w-28" />
        </div>
      </div>

      {/* Toolbar: search input (w-full sm:w-64) + Dari label & date + Sampai label & date */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Skeleton className="h-9 w-full sm:w-64 rounded-md" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Dari</span>
            <Skeleton className="h-9 w-36 rounded-md" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Sampai</span>
            <Skeleton className="h-9 w-36 rounded-md" />
          </div>
        </div>
      </div>

      {/* Table matching exact Payment History columns and classes:
          TableHeader:
          - Tanggal Transaksi
          - No VA
          - Referensi
          - Keterangan (dominant width)
          - text-right: Nominal (right aligned)
          - Status (right aligned next to edge)
          Rows: 10 rows matching PAGE_SIZE = 10 */}
      <div className="overflow-x-auto rounded-xl border bg-card">
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
            {Array.from({ length: 10 }).map((_, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Skeleton className="h-4 w-36" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="w-full">
                  <Skeleton className="h-4 w-4/5" />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Skeleton className="ml-auto h-4 w-24" />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination: right-aligned group matching Pagination component */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
    </div>
  )
}
