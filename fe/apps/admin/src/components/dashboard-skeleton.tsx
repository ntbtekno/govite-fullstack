import {
  Card,
  CardContent,
  CardHeader,
} from "@app/ui/components/card"
import { Skeleton } from "@app/ui/components/skeleton"

export function DashboardSkeleton({
  withTestId = true,
}: {
  withTestId?: boolean
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

      {/* Grid matching Dashboard: 3 stats cards + 1 full-width announcements card */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Card 1: Role */}
        <Card>
          <CardHeader className="space-y-1.5 pb-6">
            <span className="text-sm font-medium text-muted-foreground">Role</span>
            <Skeleton className="h-7 w-28" />
          </CardHeader>
        </Card>

        {/* Card 2: Permissions */}
        <Card>
          <CardHeader className="space-y-1.5 pb-6">
            <span className="text-sm font-medium text-muted-foreground">Permissions</span>
            <Skeleton className="h-7 w-12" />
          </CardHeader>
        </Card>

        {/* Card 3: Email */}
        <Card>
          <CardHeader className="space-y-1.5 pb-6">
            <span className="text-sm font-medium text-muted-foreground">Email</span>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent />
        </Card>

        {/* Announcements card (md:col-span-3) */}
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
    </div>
  )
}
