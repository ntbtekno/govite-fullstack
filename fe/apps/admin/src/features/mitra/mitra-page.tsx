import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@app/ui/components/badge"
import { Button } from "@app/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/dialog"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/table"
import type { MitraResponse } from "@app/contracts"
import { Pagination, TableState } from "@/components/list-controls"
import { useDebounced } from "@/lib/use-debounced"
import { PageHeader } from "@/components/page"
import { RequirePermission } from "@/features/auth/require-permission"
import { mitraApi } from "@/features/mitra/api"

export function MitraPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<MitraResponse | null>(null)

  const mitra = useQuery({
    queryKey: ["mitra", { page, limit, search: debouncedSearch }],
    queryFn: () =>
      mitraApi.list({
        page,
        limit,
        search: debouncedSearch || undefined,
      }),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["mitra"] })

  const create = useMutation({
    mutationFn: mitraApi.create,
    onSuccess: async () => {
      toast.success("Mitra created")
      await invalidate()
      setCreateOpen(false)
    },
  })

  const update = useMutation({
    mutationFn: ({ id, nama }: { id: string; nama: string }) =>
      mitraApi.update(id, { nama }),
    onSuccess: async () => {
      toast.success("Mitra updated")
      await invalidate()
      setEditing(null)
    },
  })

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      mitraApi.setActive(id, isActive),
    onSuccess: async (row) => {
      toast.success(row.isActive ? "Mitra activated" : "Mitra deactivated")
      await invalidate()
    },
  })

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    create.mutate({
      kodeMitra: String(form.get("kodeMitra")),
      nama: String(form.get("nama")),
    })
  }

  function onEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editing) return
    const form = new FormData(e.currentTarget)
    update.mutate({ id: editing.id, nama: String(form.get("nama")) })
  }

  const totalPages = mitra.data?.meta.totalPages ?? 1

  return (
    <RequirePermission resource="mitra" action="view">
      <PageHeader
        title="Mitra"
        description="Tenant list. Deactivating a mitra signs its users out."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>Add mitra</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New mitra</DialogTitle>
              </DialogHeader>
              <form id="create-mitra" onSubmit={onCreate} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="kodeMitra">Kode mitra</Label>
                  <Input
                    id="kodeMitra"
                    name="kodeMitra"
                    placeholder="MTR-001"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nama">Nama</Label>
                  <Input id="nama" name="nama" required />
                </div>
              </form>
              <DialogFooter>
                <Button
                  type="submit"
                  form="create-mitra"
                  disabled={create.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Input
        placeholder="Search mitra…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
        className="max-w-xs"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kode</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState
            colSpan={4}
            loading={mitra.isPending}
            empty={mitra.data?.data.length === 0}
            error={mitra.error}
            emptyText="No mitra found."
          />
          {mitra.data?.data.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.kodeMitra}</TableCell>
              <TableCell>{row.nama}</TableCell>
              <TableCell>
                <Badge variant={row.isActive ? "default" : "secondary"}>
                  {row.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(row)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({ id: row.id, isActive: !row.isActive })
                  }
                >
                  {row.isActive ? "Deactivate" : "Activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={mitra.data?.meta.total}
        onPageChange={setPage}
        pageSize={limit}
        onPageSizeChange={(size) => {
          setLimit(size)
          setPage(1)
        }}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit mitra</DialogTitle>
          </DialogHeader>
          {editing && (
            <form id="edit-mitra" onSubmit={onEdit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-kode">Kode mitra</Label>
                <Input
                  id="edit-kode"
                  value={editing.kodeMitra}
                  readOnly
                  disabled
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-nama">Nama</Label>
                <Input
                  id="edit-nama"
                  name="nama"
                  defaultValue={editing.nama}
                  required
                />
              </div>
            </form>
          )}
          <DialogFooter>
            <Button
              type="submit"
              form="edit-mitra"
              disabled={update.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RequirePermission>
  )
}
