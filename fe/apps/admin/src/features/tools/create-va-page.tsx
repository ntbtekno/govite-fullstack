import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Badge } from "@app/ui/components/badge"
import { Button } from "@app/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/card"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/select"
import { PageHeader } from "@/components/page"
import { ApiError } from "@/lib/api-client"
import { useAuth } from "@/lib/auth-context"
import { vaApi, type CreateVARequest } from "./api"

function decimalAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".")
  return `${whole}.${fraction.padEnd(2, "0")}`
}

export function CreateVAPage() {
  const canCreate = useAuth().can("va", "create")
  const [trxType, setTrxType] = useState<"F" | "P">("F")
  const create = useMutation({ mutationFn: vaApi.create })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canCreate) return

    const form = new FormData(event.currentTarget)
    const phone = String(form.get("phone") ?? "").trim()
    const body: CreateVARequest = {
      customerNo: String(form.get("customerNo")).trim(),
      trxId: String(form.get("trxId")).trim(),
      virtualAccountName: String(form.get("virtualAccountName")).trim(),
      amount: decimalAmount(String(form.get("amount")).trim()),
      trxType,
      expiredDate: new Date(String(form.get("expiredDate"))).toISOString(),
      description: String(form.get("description")).trim(),
      ...(phone ? { phone } : {}),
    }
    create.mutate(body)
  }

  const error =
    create.error instanceof ApiError
      ? `${create.error.messageInd ?? create.error.message}${create.error.code ? ` (${create.error.code})` : ""}`
      : create.error instanceof Error
        ? create.error.message
        : null

  return (
    <div className="grid max-w-4xl gap-4">
      <PageHeader title="Create VA" description="Buat Virtual Account baru." />

      {!canCreate && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Anda memiliki akses lihat saja. Permission va.create diperlukan untuk
          membuat Virtual Account.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Data Virtual Account</CardTitle>
          <CardDescription>
            Nominal dikirim dalam format dua angka desimal. Tanggal kedaluwarsa
            mengikuti zona waktu perangkat Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="customerNo">Nomor pelanggan</Label>
                <Input
                  id="customerNo"
                  name="customerNo"
                  inputMode="numeric"
                  pattern="[0-9]{1,14}"
                  maxLength={14}
                  placeholder="20261023000001"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trxId">ID transaksi</Label>
                <Input
                  id="trxId"
                  name="trxId"
                  maxLength={19}
                  placeholder="INV-2026-000001"
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="virtualAccountName">Nama pemilik VA</Label>
              <Input
                id="virtualAccountName"
                name="virtualAccountName"
                maxLength={30}
                placeholder="Budi Santoso"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="amount">Nominal</Label>
                <Input
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                  placeholder="150000.00"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trxType">Tipe transaksi</Label>
                <Select
                  value={trxType}
                  onValueChange={(value) => setTrxType(value as "F" | "P")}
                >
                  <SelectTrigger id="trxType" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">F - Full</SelectItem>
                    <SelectItem value="P">P - Partial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expiredDate">Kedaluwarsa</Label>
                <Input
                  id="expiredDate"
                  name="expiredDate"
                  type="datetime-local"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="description">Deskripsi</Label>
                <Input
                  id="description"
                  name="description"
                  maxLength={60}
                  placeholder="Tagihan SPP"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Nomor telepon (opsional)</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="+6281234567890"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-fit"
              disabled={!canCreate || create.isPending}
            >
              {create.isPending ? "Membuat VA..." : "Buat VA"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {create.data && (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>Virtual Account berhasil dibuat</CardTitle>
            <CardDescription>
              Simpan nomor berikut untuk proses pembayaran.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg font-semibold">
              {create.data.virtualAccountNo}
            </span>
            <Badge>{create.data.status}</Badge>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
