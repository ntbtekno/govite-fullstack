import { authedRequest } from "@/lib/authed-request"

/** The caller's most recent successful login. */
export interface LastLogin {
  at: string
  ip: string
  userAgent: string
}

/** One calendar day of the running month. */
export interface DailyPoint {
  date: string
  count: number
}

/**
 * The mitra monthly transaction summary. `unavailable` mirrors the report
 * pages' 503 REPORTS_UNAVAILABLE: the reports database is not configured.
 */
export interface MonthlyTransactions {
  unavailable: boolean
  total: number
  days: DailyPoint[]
}

export interface DashboardSummary {
  lastLogin: LastLogin | null
  monthlyTransactions: MonthlyTransactions | null
}

export const dashboardApi = {
  summary: (): Promise<DashboardSummary> =>
    authedRequest<DashboardSummary>("/dashboard/summary"),
}
