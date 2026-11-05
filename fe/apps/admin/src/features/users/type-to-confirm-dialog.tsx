import { useState, type ReactNode } from "react"
import { Button } from "@app/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/dialog"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"

/**
 * Permanent-action dialog that requires the admin to type the expected word
 * exactly. The confirm button stays disabled until the typed value matches, and
 * Cancel never calls onConfirm.
 */
export function TypeToConfirmDialog({
  trigger,
  title,
  description,
  confirmWord,
  confirmLabel = "Hapus",
  onConfirm,
  pending = false,
}: {
  trigger: ReactNode
  title: string
  description: ReactNode
  /** The exact text the admin must type to enable the confirm button. */
  confirmWord: string
  confirmLabel?: string
  onConfirm: () => void
  pending?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")

  // Clear the input whenever the dialog opens or closes, so a reopen starts
  // fresh (no effect, so no cascading render).
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    setTyped("")
  }

  const matches = typed === confirmWord

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="confirm-word">
            Type <span className="font-mono font-semibold">{confirmWord}</span>{" "}
            to confirm
          </Label>
          <Input
            id="confirm-word"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmWord}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
