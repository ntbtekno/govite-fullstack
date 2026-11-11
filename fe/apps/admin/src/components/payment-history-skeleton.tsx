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
          - (chevron, w-10)
          - Tanggal Transaksi (w-44)
          - No VA / Referensi
          - ID Transaksi
          - text-right: Nominal (w-32)
          - Status (w-24)
          Rows: 10 rows matching PAGE_SIZE = 10 */}
      <div className="w-full min-w-0 rounded-xl border bg-card [&_[data-slot=table-container]]:overflow-x-visible [&_[data-slot=table]]:table-fixed">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" aria-hidden />
              <TableHead className="w-44">Tanggal Transaksi</TableHead>
              <TableHead>No VA / Referensi</TableHead>
              <TableHead>ID Transaksi</TableHead>
              <TableHead className="w-32 text-right">Nominal</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 10 }).map((_, idx) => (
              <TableRow key={idx}>
                <TableCell className="w-10">
                  <Skeleton className="size-4 rounded-sm" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-36" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
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
