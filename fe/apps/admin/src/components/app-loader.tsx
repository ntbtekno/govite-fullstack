import { type FC } from "react"

export const AppLoader: FC = () => {
  return (
    <div
      data-testid="app-loader"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
    >
      <img
        src="/images/logo-bank-ntb-syariah.webp"
        alt="Bank NTB Syariah"
        className="h-16 w-auto"
      />
      <p className="mt-4 text-sm text-muted-foreground">
        Rekan NTB
      </p>
      <div className="mt-6 w-64" aria-hidden="true">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="app-loader-bar absolute inset-y-0 w-1/3" />
        </div>
      </div>
    </div>
  )
}