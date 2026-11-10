import { Skeleton } from "@app/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/table"

export function BillingSkeleton({
  withTestId = true,
}: {
  withTestId?: boolean
} = {}) {
  return (
    <div
      {...(withTestId ? { "data-testid": "page-skeleton" } : {})}
      data-variant="billing-skeleton"
      className="grid w-full gap-4 animate-in fade-in duration-200"
    >
      {/* Header bar: PageHeader style
          - Left: h1 text-2xl font-semibold + p text-sm text-muted-foreground
          - Right: pill LIVE (rounded-full px-2.5 py-1) + clock text + Button size="sm" variant="outline" */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Summary strip: Jumlah tagihan + Total nominal (text-sm text-muted-foreground) */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Jumlah tagihan:</span>
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex items-center gap-1.5">
          <span>Total nominal:</span>
          <Skeleton className="h-4 w-28" />
        </div>
      </div>

      {/* Toolbar: Input max-w-xs with exactly size of Input */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-xs rounded-md" />
      </div>

      {/* Table matching exact Billing columns and classes:
          TableHeader:
          - No VA
          - Nama
          - Deskripsi
          - text-right: Nominal
          - Tanggal Dibuat
          - Jatuh Tempo
          - Status
          Rows: 10 rows matching PAGE_SIZE = 10 */}
      <div className="overflow-x-auto rounded-xl border bg-card">
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
            {Array.from({ length: 10 }).map((_, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-mono text-xs">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-40" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-4 w-24" />
                </TableCell>
                <TableCell className="text-xs">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="text-xs">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-5 w-14 rounded-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination: right-aligned group matching Pagination component:
          <span text-sm text-muted-foreground>...</span>
          <Button variant="outline" size="sm">Previous</Button>
          <Button variant="outline" size="sm">Next</Button> */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
    </div>
  )
}
