import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/card"
import type { LastLogin } from "@/lib/dashboard-api"
import { deviceLabel } from "./device-label"

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatWhen(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : dateFmt.format(d)
}

export function LoginTerakhirCard({ lastLogin }: { lastLogin: LastLogin | null }) {
  return (
    <Card data-testid="login-terakhir-card">
      <CardHeader>
        <CardDescription>Login Terakhir</CardDescription>
        <CardTitle className="text-base">
          {lastLogin ? formatWhen(lastLogin.at) : "Belum ada catatan login"}
        </CardTitle>
      </CardHeader>
      {lastLogin ? (
        <CardContent className="grid gap-1 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">IP</span>
            <span className="font-mono">{lastLogin.ip || "-"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Perangkat</span>
            <span data-testid="login-perangkat">{deviceLabel(lastLogin.userAgent)}</span>
          </div>
        </CardContent>
      ) : (
        <CardContent className="text-sm text-muted-foreground">
          Catatan login akan tampil setelah Anda masuk untuk pertama kalinya.
        </CardContent>
      )}
    </Card>
  )
}
