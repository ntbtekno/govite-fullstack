import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Button } from "@app/ui/components/button"
import { PageHeader } from "@/components/page"
import { RequirePermission } from "@/features/auth/require-permission"
import { ApiError } from "@/lib/api-client"
import { mitraApi } from "./api"
import { storeCredentialDelivery } from "./credential-vault"

export function RotateSecretPage() {
  const { mitraId } = useParams({ from: "/admin/administration/mitra_/$mitraId_/rotate" })
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const mitra = useQuery({ queryKey: ["mitra", mitraId], queryFn: () => mitraApi.get(mitraId) })
  const rotate = useMutation({
    mutationFn: () => mitraApi.rotateSecret(mitraId),
    onSuccess: async (result) => {
      if (result.credentials) {
        storeCredentialDelivery(result.credentials)
        await navigate({ to: "/admin/administration/mitra/$mitraId/credentials", params: { mitraId } })
      }
    },
  })
  const error = rotate.error instanceof ApiError ? `${rotate.error.message} (${rotate.error.code})` : rotate.error?.message
  const row = mitra.data
  const hasPartnerId = !!row?.provisionPartnerId
  const missingKey = row && row.hasIdentity && !row.hasPrivateKey
  return <RequirePermission resource="mitra" action="manage">
    <PageHeader title="Rotate Secret" description="Issue a replacement HMAC secret for this mitra." />
    <div className="space-y-5 rounded-lg border p-6">
      <p><strong>{row?.kodeMitra}</strong> · {row?.nama}</p>
      <p>Partner ID: {row?.provisionPartnerId ?? "-"}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          ['Identity', row?.hasIdentity],
          ['HMAC secret', row?.hasHmacSecret],
          ['RSA private key', row?.hasPrivateKey],
        ] as const).map(([label, present]) => <div key={label} className="rounded border p-3 text-sm"><strong>{label}</strong><p className={present ? "text-emerald-600" : "text-destructive"}>{present ? "Stored" : "Missing"}</p></div>)}
      </div>
      {missingKey && <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><strong>Warning:</strong> rotation only replaces the HMAC secret. The RSA private key is still missing, so this mitra still cannot request tokens after rotation. Keypair recovery is required.</div>}
      <div role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">Rotation invalidates the old secret immediately. In-flight requests signed with the old secret will be rejected.</div>
      {!confirm ? <Button variant="destructive" disabled={!hasPartnerId} onClick={() => setConfirm(true)}>Rotate Secret</Button> : <div role="dialog" aria-label="Confirm secret rotation" className="space-y-3 rounded border p-4"><p>Confirm rotation? This action cannot be undone.</p><div className="flex gap-2"><Button variant="destructive" disabled={!hasPartnerId || rotate.isPending} onClick={() => rotate.mutate()}>Confirm Rotate</Button><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button></div></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </RequirePermission>
}
