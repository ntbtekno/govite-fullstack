import { TooltipProvider } from "@app/ui/components/tooltip"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@app/ui/components/sidebar"
import { Skeleton } from "@app/ui/components/skeleton"
import { PageSkeleton } from "./page-skeleton"

export function AdminLayoutSkeleton() {
  return (
    <div data-testid="page-skeleton" className="min-h-svh bg-background">
      <TooltipProvider>
        <SidebarProvider>
          {/* Mock layout sidebar frame with pulses */}
          <Sidebar>
            <SidebarHeader className="p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-lg" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </SidebarHeader>
            <SidebarSeparator />
            <SidebarContent className="space-y-3 p-3">
              <Skeleton className="h-3 w-20" />
              <SidebarMenu>
                {Array.from({ length: 5 }).map((_, i) => (
                  <SidebarMenuItem key={i} className="py-1">
                    <div className="flex items-center gap-3 px-2 py-1.5">
                      <Skeleton className="size-4 rounded" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarContent>
            <SidebarFooter className="p-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>

          <SidebarInset>
            {/* Header frame */}
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-4 w-40" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="size-8 rounded-md" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            </header>

            {/* Content body with the page-level skeleton */}
            <div className="flex flex-1 flex-col gap-4 p-4 pt-4">
              <PageSkeleton withTestId={false} />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
