import type { ReactNode } from "react"
import {
  BellRingIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import { usePublicSettings } from "@/lib/public-settings"

const features = [
  {
    icon: UsersIcon,
    title: "Monitoring Transaksi Real-Time",
    description:
      "Setiap pembayaran yang masuk ke Virtual Account mitra langsung terlihat, lengkap dengan status dan detail transaksinya.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Laporan Cepat & Siap Unduh",
    description:
      "Rekap transaksi dan laporan pembayaran tersedia dalam hitungan klik, siap dipakai untuk kebutuhan pembukuan dan pelaporan Anda.",
  },
  {
    icon: ScrollTextIcon,
    title: "Akses Aman Berbasis Peran",
    description:
      "Setiap pengguna hanya melihat data sesuai kewenangannya — aman untuk tim Anda, terkendali untuk mitra.",
  },
  {
    icon: BellRingIcon,
    title: "Jejak Audit Transparan",
    description:
      "Seluruh aktivitas tercatat dan mudah ditelusuri, mendukung transparansi serta kebutuhan pemeriksaan.",
  },
]

function Brand() {
  return (
    <div className="flex items-center gap-[10px]">
      <img
        src="/images/logo-bank-ntb-syariah.webp"
        alt="Bank NTB Syariah"
        className="h-[42px] w-auto object-contain"
      />
      <div className="flex flex-col">
        <span className="text-sm font-semibold tracking-tight text-slate-900">
          Portal Management Virtual Account
        </span>
        <span className="text-xs text-slate-500">
          by Bank NTB Syariah
        </span>
      </div>
    </div>
  )
}

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  const settings = usePublicSettings()
  const loginNotice = settings.data?.loginNotice
  const supportEmail = settings.data?.supportEmail

  return (
    <div className="grid h-screen max-h-screen overflow-hidden lg:grid-cols-2">
      <aside className="relative hidden h-full max-h-screen flex-col justify-between overflow-hidden border-r border-slate-200/80 bg-slate-50/60 p-6 lg:flex lg:p-8">
        <div className="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden">
          <img
            src="/images/logo-bank-ntb-syariah-bg.webp"
            alt=""
            className="h-full w-full object-contain p-12 opacity-60"
          />
        </div>
        <div className="relative">
          <Brand />
        </div>
        <div className="relative my-auto flex flex-col gap-5 py-4">
          <div className="space-y-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-balance text-slate-900 lg:text-3xl">
              Satu Portal untuk Mengelola Semua Virtual Account Anda.
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-600">
              Portal khusus mitra Bank NTB Syariah untuk memantau transaksi
              Virtual Account secara real-time dan mendapatkan laporan
              pembayaran dengan cepat, aman, dan akurat — tanpa perlu rekap
              manual.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {features.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs">
                  <feature.icon className="size-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {feature.title}
                  </p>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {feature.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex flex-col gap-2 pt-3 border-t border-slate-200/80">
          <div className="inline-flex w-fit items-center gap-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-xs">
            <img
              src="/images/ojk.webp"
              alt="Otoritas Jasa Keuangan"
              className="h-[36px] w-auto object-contain"
            />
            <img
              src="/images/lps.svg"
              alt="Lembaga Penjamin Simpanan"
              className="h-[36px] w-auto object-contain"
            />
          </div>
          <p className="text-xs font-bold text-slate-900">
            Perizinan dan Pengawasan
          </p>
          <p className="text-[11px] leading-relaxed text-slate-600">
            PT. Bank NTB Syariah berizin dan diawasi oleh Otoritas Jasa Keuangan
            (OJK) dan Bank Indonesia (BI), serta merupakan peserta penjaminan
            Lembaga Penjamin Simpanan (LPS). Maksimum nilai simpanan yang
            dijamin LPS per nasabah per Bank adalah Rp. 2 miliar.
          </p>
        </div>
      </aside>

      <main className="flex h-full max-h-screen flex-col justify-between overflow-y-auto p-6 sm:p-8 lg:p-10">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="w-full max-w-sm space-y-5 mx-auto my-auto py-4">
          <div className="space-y-1.5 text-center sm:text-left">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {loginNotice && (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              {loginNotice}
            </p>
          )}
          {children}
          {supportEmail && (
            <p className="text-center text-xs text-muted-foreground">
              Need help? Contact{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="underline-offset-4 hover:text-primary hover:underline"
              >
                {supportEmail}
              </a>
              .
            </p>
          )}
          {footer}
        </div>
        <div className="mt-auto pt-4 text-center text-xs text-muted-foreground">
          <p>Portal Management Virtual Account v2.0</p>
          <p>© 2026 Bank NTB Syariah. All rights reserved.</p>
        </div>
      </main>
    </div>
  )
}
