import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"

import "@app/ui/globals.css"
import "./styles/theme.css"
import { router } from "./router.tsx"
import { queryClient } from "@/lib/query-client"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { lastAuthKind, loginPathForSession } from "@/lib/session-kind"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { AppLoader } from "@/components/app-loader.tsx"
import { SessionTimeoutModal } from "@/features/auth/components/session-timeout-modal"

function AppRouter() {
  const auth = useAuth()
  const [wasAuthenticated, setWasAuthenticated] = useState(false)
  const authenticated = auth.status === "authenticated"

  // Remember that a session existed so the redirect below can tell a fresh
  // anonymous visit apart from an expiry while on a protected page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latches the first authenticated render
    if (authenticated) setWasAuthenticated(true)
  }, [authenticated])

  // When the session ends (idle timeout, absolute cap, or a failed refresh)
  // while the user is on a protected page, send them to the matching login
  // form. The expiry message cookie is set by the auth context.
  useEffect(() => {
    if (!wasAuthenticated || auth.status !== "anonymous") return
    if (!window.location.pathname.startsWith("/admin")) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the latch before navigating
    setWasAuthenticated(false)
    void router.navigate({
      to: loginPathForSession({
        mitraId: auth.user?.mitraId,
        remembered: lastAuthKind(),
      }),
      search: { redirect: window.location.href },
    })
  }, [wasAuthenticated, auth.status, auth.user?.mitraId])

  if (auth.status === "loading") {
    return <AppLoader />
  }
  return (
    <>
      <RouterProvider router={router} context={{ auth }} />
      <SessionTimeoutModal
        open={auth.idleWarning}
        onStaySignedIn={auth.staySignedIn}
      />
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <AppRouter />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)
