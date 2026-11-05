import { authedRequest } from "@/lib/authed-request"

export interface ReportSummary {
  count: number
  totalAmount: number
}

export interface ReportsListResponse<TItem> {
  items: TItem[]
  total: number
  page: number
  pageSize: number
  summary: ReportSummary
}

export interface BillingReportItem {
  vaNumber: string
  payerName: string
  description: string
  amount: number
  createdAt: string
  dueAt: string
  status: string
  email: string
  phone: string
  billingType: string
  productId: string
}

export interface PaymentReportItem {
  id: string
  txDate: string
  vaNumber: string
  transactionAt: string
  reference: string
  message: string
  amount: number
  status: string
}

export interface ReportQueryParams {
  q?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export function buildReportQueryString(params: ReportQueryParams = {}): string {
  const sp = new URLSearchParams()
  if (params.q && params.q.trim()) {
    sp.set("q", params.q.trim())
  }
  if (params.from) {
    sp.set("from", params.from)
  }
  if (params.to) {
    sp.set("to", params.to)
  }
  if (params.page !== undefined && params.page > 0) {
    sp.set("page", String(params.page))
  }
  if (params.pageSize !== undefined && params.pageSize > 0) {
    sp.set("pageSize", String(params.pageSize))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ""
}

export const reportsApi = {
  billing: (params: ReportQueryParams = {}): Promise<ReportsListResponse<BillingReportItem>> =>
    authedRequest<ReportsListResponse<BillingReportItem>>(
      `/reports/billing${buildReportQueryString(params)}`
    ),

  payments: (params: ReportQueryParams = {}): Promise<ReportsListResponse<PaymentReportItem>> =>
    authedRequest<ReportsListResponse<PaymentReportItem>>(
      `/reports/payments${buildReportQueryString(params)}`
    ),
}
