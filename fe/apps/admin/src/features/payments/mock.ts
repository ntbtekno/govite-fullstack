// Mock payment history for the sample History Payment page. Shaped like the
// future API response; the page reads from here until the endpoint exists.
// NOTE: replace this module's generator with the real API call later.

export type PaymentStatus = "success" | "pending" | "failed"

export interface PaymentRow {
  id: string
  transactionAt: string
  vaNumber: string
  payerName: string
  amount: number
  channel: string
  status: PaymentStatus
  reference: string
}

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "success",
  "pending",
  "failed",
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

const CHANNELS = [
  "BNI VA",
  "BRI VA",
  "Mandiri VA",
  "BSI VA",
  "BTN VA",
  "Permata VA",
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
export function makePaymentRow(
  index: number,
  now: Date = new Date(),
  offset = 0
): PaymentRow {
  const rand = prng(index * 6271 + 29 + offset * 1299709)
  const transactionAt = new Date(
    now.getTime() -
      (index % 30) * 24 * 60 * 60 * 1000 -
      Math.floor(rand() * 24) * 60 * 60 * 1000
  )
  return {
    id: `pay-${index + offset}`,
    transactionAt: transactionAt.toISOString(),
    vaNumber: `8808${digits(rand, 12)}`,
    payerName: pick(rand, PAYERS),
    amount: (Math.floor(rand() * 1000) + 10) * 5000,
    channel: pick(rand, CHANNELS),
    status: pick(rand, PAYMENT_STATUSES),
    reference: `REF${digits(rand, 10)}`,
  }
}

/** ~80 deterministic payment rows spread over the last 30 days. */
export function generatePayments(
  count = 80,
  seed = 20260202,
  now: Date = new Date()
): PaymentRow[] {
  return Array.from({ length: count }, (_, i) =>
    makePaymentRow(i + seed, now)
  ).sort((a, b) => b.transactionAt.localeCompare(a.transactionAt))
}
