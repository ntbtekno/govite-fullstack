// Export logic for Billing Tagihan.
// NOTE: In Phase B, rows are sourced from mock data and filtered client-side.
// In later stages, this will call the backend export endpoint.

import ExcelJS from "exceljs"
import { saveDownload } from "@/lib/download"
import type { BillingRow, BillingStatus } from "./mock"

export const billingStatusLabel: Record<BillingStatus, string> = {
  unpaid: "Belum Dibayar",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
}

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

/** Pure function to filter billing rows by calendar date range (inclusive, based on createdAt). */
export function filterByRange(
  rows: BillingRow[],
  startDate: string,
  endDate: string
): BillingRow[] {
  if (endDate < startDate) return []
  return rows.filter((r) => {
    const rowDate = toLocalDateString(r.createdAt)
    return rowDate >= startDate && rowDate <= endDate
  })
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})

/** Generates and downloads the Billing Excel file using exceljs. */
export async function downloadBillingExcel(
  rows: BillingRow[],
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
      createdAt: dateFmt.format(new Date(r.createdAt)),
      dueAt: dateFmt.format(new Date(r.dueAt)),
      status: billingStatusLabel[r.status] ?? r.status,
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
