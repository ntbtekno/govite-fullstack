import { PageHeader } from "@/components/page"

/** Halaman Create VA (kosong): hanya menampilkan header halaman. */
export function CreateVAPage() {
  return (
    <div className="grid gap-4">
      <PageHeader title="Create VA" description="Buat Virtual Account baru." />
    </div>
  )
}
