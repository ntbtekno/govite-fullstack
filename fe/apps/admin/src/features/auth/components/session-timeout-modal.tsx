import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@app/ui/components/alert-dialog"
import { IDLE_WARNING_MS } from "@/lib/auth-context"

/** Counts down from `seconds`, mounted fresh each time the dialog opens. */
function Countdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds)
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return <>{remaining}</>
}

/**
 * Counts down to the idle logout and offers "Tetap masuk" to cancel it. Any
 * activity elsewhere also cancels the warning (the idle timer resets), which
 * unmounts this dialog via the `open` prop from the auth context.
 */
export function SessionTimeoutModal({
  open,
  onStaySignedIn,
  seconds = Math.round(IDLE_WARNING_MS / 1000),
}: {
  open: boolean
  onStaySignedIn: () => void
  seconds?: number
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent data-testid="session-timeout-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Sesi akan berakhir</AlertDialogTitle>
          <AlertDialogDescription>
            Sesi akan berakhir dalam <Countdown seconds={seconds} /> detik
            karena tidak ada aktivitas. Klik "Tetap masuk" untuk melanjutkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            data-testid="stay-signed-in"
            onClick={onStaySignedIn}
          >
            Tetap masuk
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
