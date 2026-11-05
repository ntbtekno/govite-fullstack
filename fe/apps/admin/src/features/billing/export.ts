// Export logic for Billing Tagihan via Reports API (Tahap C2).

import ExcelJS from "exceljs"
import { saveDownload } from "@/lib/download"
import {
  reportsApi,
  type BillingReportItem,
  type ReportQueryParams,
  type ReportsListResponse,
} from "@/lib/reports-api"

export const MAX_EXPORT_ROWS = 10000
export const EXPORT_PAGE_SIZE = 100

export function toLocalDateString(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function getDefaultBillingDateRange(now = new Date()) {
  const endDate = toLocalDateString(now)
  const startDate = toLocalDateString(
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  )
  return { startDate, endDate }
}

export function getBillingExportFilename(
  startDate: string,
  endDate: string
): string {
  const startTag = startDate.replace(/-/g, "")
  const endTag = endDate.replace(/-/g, "")
  return `billing-tagihan-${startTag}-${endTag}.xlsx`
}

/**
 * Fetches all matching billing rows by paging through the API until reaching
 * the total count or hitting MAX_EXPORT_ROWS.
 */
export async function fetchAllBillingRows(
  params: { q?: string; from: string; to: string },
  fetcher: (
    p: ReportQueryParams
  ) => Promise<ReportsListResponse<BillingReportItem>> = reportsApi.billing
): Promise<BillingReportItem[]> {
  const firstPage = await fetcher({
    q: params.q,
    from: params.from,
    to: params.to,
    page: 1,
    pageSize: EXPORT_PAGE_SIZE,
  })

  if (firstPage.total > MAX_EXPORT_ROWS) {
    throw new Error(
      `Jumlah data (${firstPage.total.toLocaleString("id-ID")}) melebihi batas maksimum ekspor (${MAX_EXPORT_ROWS.toLocaleString("id-ID")} baris). Mohon persempit rentang tanggal.`
    )
  }

  const allItems: BillingReportItem[] = [...firstPage.items]
  const total = firstPage.total

  let currentPage = 2
  while (allItems.length < total) {
    const next = await fetcher({
      q: params.q,
      from: params.from,
      to: params.to,
      page: currentPage,
      pageSize: EXPORT_PAGE_SIZE,
    })
    if (next.items.length === 0) break
    allItems.push(...next.items)
    currentPage++
  }

  return allItems
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatDateTime(val: string): string {
  if (!val) return "-"
  const d = new Date(val)
  return isNaN(d.getTime()) ? val : dateFmt.format(d)
}

/** Generates and downloads the Billing Excel file using exceljs. */
export async function downloadBillingExcel(
  rows: BillingReportItem[],
  startDate: string,
  endDate: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Portal Management Virtual Account"
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet("Billing Tagihan")

  worksheet.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "No VA", key: "vaNumber", width: 22 },
    { header: "Nama", key: "payerName", width: 24 },
    { header: "Deskripsi", key: "description", width: 26 },
    { header: "Nominal", key: "amount", width: 18 },
    { header: "Tanggal Dibuat", key: "createdAt", width: 22 },
    { header: "Jatuh Tempo", key: "dueAt", width: 22 },
    { header: "Status", key: "status", width: 16 },
  ]

  const headerRow = worksheet.getRow(1)
  headerRow.font = {
    name: "Arial",
    size: 10,
    bold: true,
    color: { argb: "FFFFFFFF" },
  }
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0184BA" },
  }
  headerRow.alignment = { vertical: "middle", horizontal: "left" }
  headerRow.height = 24

  let totalAmount = 0
  rows.forEach((r, idx) => {
    totalAmount += r.amount
    const row = worksheet.addRow({
      no: idx + 1,
      vaNumber: r.vaNumber,
      payerName: r.payerName,
      description: r.description,
      amount: r.amount,
      createdAt: formatDateTime(r.createdAt),
      dueAt: formatDateTime(r.dueAt),
      status: "Aktif",
    })
    row.getCell("amount").numFmt = "#,##0"
  })

  const totalRow = worksheet.addRow({
    no: "",
    vaNumber: "",
    payerName: "",
    description: "Total",
    amount: totalAmount,
    createdAt: "",
    dueAt: "",
    status: "",
  })
  totalRow.font = { name: "Arial", size: 10, bold: true }
  totalRow.getCell("amount").numFmt = "#,##0"

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const filename = getBillingExportFilename(startDate, endDate)
  saveDownload(blob, filename)
}
