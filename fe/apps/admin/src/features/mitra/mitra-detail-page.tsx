import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { toast } from "sonner"
import { Badge } from "@app/ui/components/badge"
import { Button } from "@app/ui/components/button"
import { PageHeader } from "@/components/page"
import { RequirePermission } from "@/features/auth/require-permission"
import { mitraApi } from "./api"

export function MitraDetailPage() {
  const { mitraId } = useParams({ from: "/admin/administration/mitra_/$mitraId" })
  const queryClient = useQueryClient()
  const mitra = useQuery({ queryKey: ["mitra", mitraId], queryFn: () => mitraApi.get(mitraId) })
  const type = useMutation({
    mutationFn: (connectionType: "PORTAL_ONLY" | "HOST_TO_HOST") => mitraApi.update(mitraId, { connectionType }),
    onSuccess: async () => {
      toast.success("Connection type updated")
      await queryClient.invalidateQueries({ queryKey: ["mitra", mitraId] })
    },
  })
  const row = mitra.data
  return <RequirePermission resource="mitra" action="manage">
    <PageHeader title="Mitra detail" description="Non-secret provisioning summary." actions={<Button asChild><Link to="/admin/administration/mitra/$mitraId/rotate" params={{ mitraId }}>Rotate Secret</Link></Button>} />
    {!row ? <p>Loading mitra...</p> : <div className="grid gap-6 rounded-lg border p-6 md:grid-cols-2">
      <div className="space-y-3">
        <p><span className="text-muted-foreground">Kode:</span> {row.kodeMitra}</p>
        <p><span className="text-muted-foreground">Nama:</span> {row.nama}</p>
        <p><span className="text-muted-foreground">Partner ID:</span> {row.provisionPartnerId ?? "-"}</p>
        <p><span className="text-muted-foreground">Partner Service ID:</span> {row.partnerServiceId}</p>
        <p><span className="text-muted-foreground">VA Prefix:</span> {row.vaPrefix}</p>
        <Badge>{row.provisionStatus}</Badge>
      </div>
      <div className="space-y-3">
        <label className="grid gap-2 text-sm">Connection type
          <select value={row.connectionType} onChange={(e) => type.mutate(e.target.value as "PORTAL_ONLY" | "HOST_TO_HOST")} className="h-9 rounded-md border bg-background px-3" disabled={type.isPending}>
            <option value="PORTAL_ONLY">Portal only</option>
            <option value="HOST_TO_HOST">Host to host</option>
          </select>
        </label>
        {row.connectionType === "HOST_TO_HOST" && <p className="text-sm text-muted-foreground">Existing credentials cannot be shown again. Rotate the secret to issue a new one-time credential delivery.</p>}
      </div>
    </div>}
  </RequirePermission>
}
