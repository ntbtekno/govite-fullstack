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
 * The bounds of the mitra's stored transaction data (not the applied range).
 * `null` when the mitra has no stored rows or the reports DB is absent.
 */
export interface DataCoverage {
  minDate: string
  lastDate: string
}

/**
 * The mitra monthly transaction summary. `unavailable` mirrors the report
 * pages' 503 REPORTS_UNAVAILABLE: the reports database is not configured.
 */
export interface MonthlyTransactions {
  unavailable: boolean
  total: number
  totalAmount: number
  coverage: DataCoverage | null
  days: DailyPoint[]
}

export interface DashboardSummary {
  lastLogin: LastLogin | null
  monthlyTransactions: MonthlyTransactions | null
}

export const dashboardApi = {
  summary: (params?: { from?: string; to?: string }): Promise<DashboardSummary> => {
    const search = new URLSearchParams()
    if (params?.from) search.set("from", params.from)
    if (params?.to) search.set("to", params.to)
    const qs = search.toString()
    return authedRequest<DashboardSummary>(`/dashboard/summary${qs ? `?${qs}` : ""}`)
  },
}
