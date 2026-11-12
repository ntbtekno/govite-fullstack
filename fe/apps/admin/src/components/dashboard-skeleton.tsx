import {
  Card,
  CardContent,
  CardHeader,
} from "@app/ui/components/card"
import { Skeleton } from "@app/ui/components/skeleton"

export function DashboardSkeleton({
  withTestId = true,
  isMitra = true,
}: {
  withTestId?: boolean
  isMitra?: boolean
} = {}) {
  return (
    <div
      {...(withTestId ? { "data-testid": "page-skeleton" } : {})}
      data-variant="dashboard-skeleton"
      className="grid w-full gap-4 animate-in fade-in duration-200"
    >
      {/* PageHeader matching DashboardPage:
          h1 "Dashboard" + description welcome back */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-1 h-4 w-60" />
        </div>
      </div>

      {isMitra ? (
        <>
          {/* Grid matching Dashboard: Login Terakhir (left, 1/3) + Chart (right, 2/3) */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Left column: Login Terakhir (narrower) */}
            <div className="md:col-span-1">
              <Card>
                <CardHeader>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-1 h-6 w-40" />
                </CardHeader>
                <CardContent className="grid gap-1 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Right column: Chart (wider) */}
            <div className="md:col-span-2">
              <Card>
                <CardHeader className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-8 w-20 rounded-md" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-8 w-36" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-8 w-36" />
                    </div>
                    <Skeleton className="h-8 w-24 rounded-md" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-7 w-48" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex h-40 items-end gap-[3px]">
                    {Array.from({ length: 30 }).map((_, i) => (
                      <Skeleton key={i} className="flex-1 rounded-t" style={{ height: `${((i * 37) % 80) + 10}%` }} />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <Skeleton className="h-3 w-8" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                  <Skeleton className="mt-3 h-4 w-32" />
                </CardContent>
              </Card>
            </div>
          </div>
          {/* Announcements below (full width) */}
          <Card className="md:col-span-3">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <span className="text-base font-semibold">Announcements</span>
                <p className="text-sm text-muted-foreground">
                  Recent updates and notices.
                </p>
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Non-mitra: Login Terakhir + Announcements */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1 h-6 w-40" />
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </CardContent>
            </Card>
            <Card className="md:col-span-3">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-base font-semibold">Announcements</span>
                  <p className="text-sm text-muted-foreground">
                    Recent updates and notices.
                  </p>
                </div>
                <Skeleton className="h-8 w-20 rounded-md" />
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-14 rounded-full" />
                      </div>
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3.5 w-3/4" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}