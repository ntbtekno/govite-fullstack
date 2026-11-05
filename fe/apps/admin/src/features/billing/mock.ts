// Mock billing data for the sample Billing Tagihan page. Shaped like the
// future API response; the page reads from here until the endpoint exists.
// NOTE: replace this module's generator with the real API call later.

export type BillingStatus = "unpaid" | "paid" | "expired" | "cancelled"

export interface BillingRow {
  id: string
  vaNumber: string
  payerName: string
  description: string
  amount: number
  createdAt: string
  dueAt: string
  status: BillingStatus
}

export const BILLING_STATUSES: BillingStatus[] = [
  "unpaid",
  "paid",
  "expired",
  "cancelled",
]

const PAYERS = [
  "Budi Santoso",
  "Siti Aminah",
  "Agus Pratama",
  "Dewi Lestari",
  "Rizki Ramadhan",
  "Putri Handayani",
  "Andi Wijaya",
  "Nur Aisyah",
  "Fajar Nugroho",
  "Maya Sari",
  "Hendra Gunawan",
  "Rina Marlina",
  "Yusuf Maulana",
  "Lina Kartika",
  "Bayu Saputra",
  "Intan Permata",
]

const DESCRIPTIONS = [
  "Tagihan SPP",
  "Iuran Bulanan",
  "Pembayaran Semester",
  "Tagihan Air",
  "Biaya Registrasi",
  "Tagihan Listrik",
  "Iuran Koperasi",
  "Biaya Administrasi",
]

/** mulberry32: small deterministic PRNG so the fixture is stable across runs. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rand: () => number, list: T[]): T =>
  list[Math.floor(rand() * list.length)]

const digits = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(rand() * 10)).join("")

/** Builds one deterministic row; `offset` lets the realtime sim add a fresh one. */
export function makeBillingRow(
  index: number,
  now: Date = new Date(),
  offset = 0
): BillingRow {
  const rand = prng(index * 7919 + 17 + offset * 104729)
  const createdAt = new Date(
    now.getTime() -
      (index % 30) * 24 * 60 * 60 * 1000 -
      Math.floor(rand() * 20) * 60 * 60 * 1000
  )
  const dueAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    id: `bill-${index + offset}`,
    vaNumber: `8808${digits(rand, 12)}`,
    payerName: pick(rand, PAYERS),
    description: pick(rand, DESCRIPTIONS),
    amount: (Math.floor(rand() * 1000) + 10) * 5000,
    createdAt: createdAt.toISOString(),
    dueAt: dueAt.toISOString(),
    status: pick(rand, BILLING_STATUSES),
  }
}

/** ~60 deterministic billing rows spread over the last 30 days. */
export function generateBilling(
  count = 60,
  seed = 20260101,
  now: Date = new Date()
): BillingRow[] {
  return Array.from({ length: count }, (_, i) =>
    makeBillingRow(i + seed, now)
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
