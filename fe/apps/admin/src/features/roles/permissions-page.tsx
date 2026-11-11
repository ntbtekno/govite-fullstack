import { Fragment, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@app/ui/components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/table"
import { PageHeader } from "@/components/page"
import { RequirePermission } from "@/features/auth/require-permission"
import { permissionsApi, type PermissionCatalog } from "@/features/roles/api"
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_LABELS,
  permissionCatalogEntry,
  type PermissionCategory,
} from "@app/contracts"

export function PermissionsPage() {
  const { data, isPending } = useQuery<PermissionCatalog>({
    queryKey: ["permissions"],
    queryFn: permissionsApi.catalog,
  })
  const [search, setSearch] = useState("")

  const q = search.trim().toLowerCase()
  const all = data?.permissions ?? []
  const filtered = q
    ? all.filter(
        (p) =>
          `${p.resource}.${p.action}`.toLowerCase().includes(q) ||
          p.resource.toLowerCase().includes(q) ||
          p.action.toLowerCase().includes(q)
      )
    : all

  const grouped: Record<PermissionCategory, typeof all> =
    PERMISSION_CATEGORIES.reduce<Record<PermissionCategory, typeof all>>(
      (acc, category) => {
        const perms = filtered.filter(
          (p) => permissionCatalogEntry(`${p.resource}.${p.action}`).category === category
        )
        if (perms.length) acc[category] = perms
        return acc
      },
      {} as Record<PermissionCategory, typeof all>
    )

  return (
    <RequirePermission resource="permissions" action="view">
      <PageHeader
        title="Permissions"
        description="Katalog permission yang tersedia dalam sistem (read-only)."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Cari permission</span>
              <input
                type="search"
                aria-label="Cari permission"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="key, resource, atau action"
                className="rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Key</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending && (
            <TableRow>
              <TableCell colSpan={3}>Loading…</TableCell>
            </TableRow>
          )}
          {!isPending && Object.entries(grouped).length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                Tidak ada permission yang cocok.
              </TableCell>
            </TableRow>
          )}
          {!isPending &&
            PERMISSION_CATEGORIES.map((category) => {
              const perms = grouped[category]
              if (!perms || perms.length === 0) return null
              return (
                <Fragment key={category}>
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold bg-muted/50">
                      <div className="flex items-center justify-between">
                        <span>{PERMISSION_CATEGORY_LABELS[category]}</span>
                        <Badge variant="secondary">{perms.length}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                  {perms.map((p) => (
                    <TableRow key={`${p.resource}.${p.action}`}>
                      <TableCell>{p.resource}</TableCell>
                      <TableCell>{p.action}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono">
                          {p.resource}.{p.action}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              )
            })}
        </TableBody>
      </Table>
    </RequirePermission>
  )
}
