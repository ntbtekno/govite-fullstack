import { Skeleton } from "@app/ui/components/skeleton"

export function PageSkeleton({ withTestId = true }: { withTestId?: boolean } = {}) {
  return (
    <div
      {...(withTestId ? { "data-testid": "page-skeleton" } : {})}
      className="grid w-full gap-4 animate-in fade-in duration-200"
    >
      {/* Title & Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-4 w-72 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      {/* Summary metric chips / row */}
      <div className="flex flex-wrap items-center gap-4 py-1">
        <Skeleton className="h-5 w-36 rounded-md" />
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-5 w-32 rounded-md" />
      </div>

      {/* Filter / Search controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl border bg-card">
        {/* Table header */}
        <div className="flex items-center gap-4 border-b bg-muted/40 p-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="ml-auto h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>

        {/* Table rows */}
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="flex items-center gap-4 p-3.5 transition-colors"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="ml-auto h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>
    </div>
  )
}
