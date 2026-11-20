import { useState } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@app/ui/components/button"
import { PageHeader } from "@/components/page"
import { RequirePermission } from "@/features/auth/require-permission"
import { takeCredentialDelivery } from "./credential-vault"

export function CredentialDeliveryPage() {
  const { mitraId } = useParams({ from: "/admin/administration/mitra_/$mitraId_/credentials" })
  const [credential] = useState(takeCredentialDelivery)
  const copy = (value: string) => navigator.clipboard.writeText(value)
  const download = () => {
    if (!credential?.privateKeyPem) return
    const url = URL.createObjectURL(new Blob([credential.privateKeyPem], { type: "application/x-pem-file" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${credential.clientId}-private.pem`
    a.click()
    URL.revokeObjectURL(url)
  }
  return <RequirePermission resource="mitra" action="manage">
    <PageHeader title="One-time credentials" description={`Mitra ${mitraId}`} />
    {!credential ? <div role="alert" className="rounded-lg border p-6"><h2 className="font-semibold">Credentials already delivered</h2><p className="text-sm text-muted-foreground">These credentials cannot be shown again. Use Rotate Secret to issue a new secret.</p></div> :
      <div className="space-y-5 rounded-lg border p-6">
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">These credentials are shown once. Save them now; refreshing or reopening this page will not show them again.</div>
        {[['Partner ID', credential.partnerId], ['Client ID', credential.clientId], ['Partner Service ID', credential.partnerServiceId], ['VA Prefix', credential.vaPrefix], ['Gateway base URL', credential.gatewayBaseUrl]].map(([label, value]) => <p key={label}><span className="text-muted-foreground">{label}:</span> {value}</p>)}
        <div className="grid gap-2"><label>HMAC secret</label><pre className="overflow-auto rounded bg-muted p-3">{credential.clientSecret}</pre><Button type="button" variant="outline" onClick={() => copy(credential.clientSecret)}>Copy secret</Button></div>
        {credential.privateKeyPem && <div className="grid gap-2"><label>RSA private key</label><pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">{credential.privateKeyPem}</pre><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => copy(credential.privateKeyPem)}>Copy private key</Button><Button type="button" onClick={download}>Download .pem</Button></div></div>}
      </div>}
  </RequirePermission>
}
