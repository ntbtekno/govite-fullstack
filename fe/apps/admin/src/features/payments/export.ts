// Export logic for History Payment.
// NOTE: In Phase B, rows are sourced from mock data and filtered client-side.
// In later stages, this will call the backend export endpoint.

import ExcelJS from "exceljs"
import { saveDownload } from "@/lib/download"
import type { PaymentRow, PaymentStatus } from "./mock"

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  success: "Berhasil",
  pending: "Menunggu",
  failed: "Gagal",
}

export function toLocalDateString(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function getDefaultPaymentDateRange(now = new Date()) {
  const endDate = toLocalDateString(now)
  const startDate = toLocalDateString(
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  )
  return { startDate, endDate }
}

export function getPaymentExportFilename(
  startDate: string,
  endDate: string
): string {
  const startTag = startDate.replace(/-/g, "")
  const endTag = endDate.replace(/-/g, "")
  return `history-payment-${startTag}-${endTag}.xlsx`
}

/** Pure function to filter payment rows by calendar date range (inclusive, based on transactionAt). */
export function filterByRange(
  rows: PaymentRow[],
  startDate: string,
  endDate: string
): PaymentRow[] {
  if (endDate < startDate) return []
  return rows.filter((r) => {
    const rowDate = toLocalDateString(r.transactionAt)
    return rowDate >= startDate && rowDate <= endDate
  })
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})

/** Generates and downloads the Payment Excel file using exceljs. */
export async function downloadPaymentExcel(
  rows: PaymentRow[],
  startDate: string,
  endDate: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Portal Management Virtual Account"
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet("History Payment")

  // Headers: No, Waktu Transaksi, No VA, Nama Pembayar, Nominal, Channel, Referensi, Status
  worksheet.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Waktu Transaksi", key: "transactionAt", width: 22 },
    { header: "No VA", key: "vaNumber", width: 22 },
    { header: "Nama Pembayar", key: "payerName", width: 24 },
    { header: "Nominal", key: "amount", width: 18 },
    { header: "Channel", key: "channel", width: 16 },
    { header: "Referensi", key: "reference", width: 20 },
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
      transactionAt: dateFmt.format(new Date(r.transactionAt)),
      vaNumber: r.vaNumber,
      payerName: r.payerName,
      amount: r.amount,
      channel: r.channel,
      reference: r.reference,
      status: paymentStatusLabel[r.status] ?? r.status,
    })
    row.getCell("amount").numFmt = "#,##0"
  })

  const totalRow = worksheet.addRow({
    no: "",
    transactionAt: "",
    vaNumber: "",
    payerName: "Total",
    amount: totalAmount,
    channel: "",
    reference: "",
    status: "",
  })
  totalRow.font = { name: "Arial", size: 10, bold: true }
  totalRow.getCell("amount").numFmt = "#,##0"

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const filename = getPaymentExportFilename(startDate, endDate)
  saveDownload(blob, filename)
}
