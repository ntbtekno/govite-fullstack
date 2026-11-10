import { expect, test, type Page } from "@playwright/test"

// Needs a running API seeded with this user, whose role must not require 2FA
// (scripts/e2e.sh sets that up).
const email = process.env.SUPER_ADMIN_EMAIL ?? "smoke@app.local"
const password = process.env.SUPER_ADMIN_PASSWORD ?? "Smoke12345!"
// The API runs with a pinned captcha code (E2E_CAPTCHA_CODE) so a headless
// browser can sign in; production never sets it.
const captcha = process.env.E2E_CAPTCHA_CODE ?? "ABCDE"
const mitraKode = process.env.E2E_MITRA_KODE ?? "MTR-E2E"
const mitraUsername = process.env.E2E_MITRA_USERNAME ?? "e2e-mitra"
const mitraPassword = process.env.E2E_MITRA_PASSWORD ?? "E2eMitra123!"

// Every page moved into features/ during the refactor, with its heading.
const pages: [path: string, heading: string][] = [
  ["/admin/dashboard", "Dashboard"],
  ["/admin/administration/users", "Users"],
  ["/admin/administration/mitra", "Mitra"],
  ["/admin/administration/roles", "Roles"],
  ["/admin/administration/permissions", "Permissions"],
  ["/admin/administration/announcements", "Announcements"],
  ["/admin/administration/audit", "Audit log"],
  ["/admin/administration/settings", "Settings"],
  ["/admin/administration/system", "System"],
  ["/admin/administration/webhooks", "Webhooks"],
  ["/admin/administration/api-keys", "API keys"],
  ["/admin/notifications", "Notifications"],
  ["/admin/account", "Account"],
]

/** Collects console errors and failed API calls so a page that renders but
 *  breaks underneath still fails the test. */
function watch(page: Page) {
  const problems: string[] = []
  page.on("console", (m) => {
    // The browser logs every non-2xx response itself; those are judged by URL
    // in the response handler below instead.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
      problems.push(`console: ${m.text()}`)
  })
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname
    // A signed-out visit probes the session with POST /auth/refresh and gets
    // 401 by design; that is the only expected failure.
    if (path === "/api/v1/auth/refresh" && r.status() === 401) return
    // Wrong current password on change-password returns 401 INVALID_CREDENTIALS by design.
    if (path === "/api/v1/account/password" && r.status() === 401) return
    // In e2e test environment without MySQL configured, reports endpoints answer
    // 503 REPORTS_UNAVAILABLE by design.
    if (
      (path === "/api/v1/reports/billing" ||
        path === "/api/v1/reports/payments") &&
      r.status() === 503
    ) {
      return
    }
    if (path.startsWith("/api/") && r.status() >= 400)
      problems.push(`${r.status()} ${r.request().method()} ${path}`)
  })
  return problems
}

async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Username atau Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)
}

test("sign in, session survives reload, every page renders, sign out", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  // The access token lives in memory; a reload must restore the session
  // through the refresh cookie (path /api/v1/auth, same origin via proxy).
  await page.reload()
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()

  for (const [path, heading] of pages) {
    await page.goto(path)
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
      path
    ).toBeVisible()
    await expect(page.getByText("Access denied")).toHaveCount(0)
  }

  // The sidebar user button shows the role under the name. A Superadmin
  // session ends at the internal login, never the mitra one.
  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/admin/dashboard")
  await expect(page).toHaveURL(/\/login(\?|$)/)

  expect(problems).toEqual([])
})

// Creates a user with the given username and returns its email. Uses the
// Super Admin role so no mitra is required.
async function createUser(
  page: Page,
  email: string,
  username: string
): Promise<void> {
  await page.getByRole("button", { name: "Add user" }).click()
  const dialog = page.getByRole("dialog", { name: "New user" })
  await dialog.getByLabel("Full name").fill("E2E User")
  await dialog.getByLabel("Email").fill(email)
  await dialog.getByLabel("Username").fill(username)
  await dialog.getByLabel("Initial password").fill(password)
  await dialog.getByRole("combobox", { name: "Role" }).click()
  await page.getByRole("option", { name: "Super Admin" }).click()
  await dialog.getByRole("button", { name: "Create" }).click()
  await expect(dialog).toBeHidden()
}

test("create a user from the dialog", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)
  await page.goto("/admin/administration/users")

  const stamp = Date.now()
  const newEmail = `e2e-${stamp}@test.local`
  await createUser(page, newEmail, `e2e-${stamp}`)

  await page.getByPlaceholder(/search/i).fill(newEmail)
  await expect(
    page.getByRole("cell", { name: newEmail, exact: true })
  ).toBeVisible()

  expect(problems).toEqual([])
})

// Proves the permanent-delete dialog keeps the button disabled until the exact
// username is typed, and that cancelling deletes nothing.
test("delete user requires typing the username and cancel keeps the user", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)
  await page.goto("/admin/administration/users")

  const stamp = Date.now()
  const newEmail = `e2e-del-${stamp}@test.local`
  const newUsername = `e2e-del-${stamp}`
  await createUser(page, newEmail, newUsername)

  await page.getByPlaceholder(/search/i).fill(newEmail)
  const row = page.getByRole("row", { name: new RegExp(newEmail) })
  await expect(row).toBeVisible()

  await row.getByRole("button", { name: "Hapus" }).click()
  const confirm = page.getByRole("dialog")
  await expect(confirm).toBeVisible()
  // The dialog warns this is permanent and names the target.
  await expect(confirm).toContainText(newEmail)

  const deleteButton = confirm.getByRole("button", { name: "Hapus" })
  // Disabled until the typed word matches the username exactly.
  await expect(deleteButton).toBeDisabled()
  await confirm.getByLabel(/Type/).fill("wrong-username")
  await expect(deleteButton).toBeDisabled()
  await confirm.getByLabel(/Type/).fill(newUsername)
  await expect(deleteButton).toBeEnabled()

  // Cancel deletes nothing.
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(confirm).toBeHidden()
  await expect(
    page.getByRole("cell", { name: newEmail, exact: true })
  ).toBeVisible()

  expect(problems).toEqual([])
})

// Proves the app's front door is the mitra login: opening the root address
// lands on /login-mitra, while the Superadmin login stays at /login.
test("root address lands on the mitra login", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login-mitra/)
  await expect(page.getByLabel("Kode Mitra")).toBeVisible()

  // The Superadmin login page is still reachable and unchanged.
  await page.goto("/login")
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel("Username atau Email")).toBeVisible()
})

// Proves the /login-mitra route signs a mitra user in and that the mitra-only
// menus (Roles, Settings, Mitra) are hidden from them.
test("sign in as mitra via /login-mitra", async ({ page }) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // Users is hidden for a mitra session too (own data lives on Account);
  // Superadmin-only pages are not shown either.
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Roles" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Mitra" })).toHaveCount(0)

  expect(problems).toEqual([])
})

// A mitra session must end at the mitra login, not the internal one. The
// destination is read from the pre-logout auth state (the user's mitraId).
test("mitra logout returns to /login-mitra", async ({ page }) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // The seeded e2e mitra user is created by cmd/api's seedE2EMitra via
  // UpsertSuperAdmin, which stores full_name = "Super Admin" (roles.sql). So
  // NavUser renders that same label here, exactly like the Superadmin session
  // - the button name comes from the seed fixture, not a guess.
  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login-mitra$/)

  expect(problems).toEqual([])
})

// A mitra session has no Users menu at all (own data lives on the Account
// page) and cannot open any user detail URL directly.
test("mitra cannot see Users menu and is redirected from user detail", async ({
  page,
}) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // (a) the Users menu is absent for the mitra session
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0)

  // (b) a direct visit to a user detail URL (any id) redirects to the dashboard
  await page.goto(
    "/admin/administration/users/22222222-2222-4222-8222-222222222222"
  )
  await expect(page).toHaveURL(/\/admin\/dashboard$/)

  expect(problems).toEqual([])
})

// The Superadmin keeps the Users menu and can still open a user detail page.
test("Superadmin keeps Users menu and opens a user detail page", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  await page.getByRole("link", { name: "Users" }).click()
  await expect(page).toHaveURL(/\/admin\/administration\/users$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Users" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Add user" })).toBeVisible()

  // Open the first user's detail page; the Superadmin is not redirected.
  await page.getByRole("link", { name: "View" }).first().click()
  await expect(page).toHaveURL(/\/admin\/administration\/users\/[^/]+$/)
  await expect(page.getByText("User detail")).toBeVisible()

  expect(problems).toEqual([])
})

// The mitra report menus (Billing Tagihan, History Payment) are mitra-only and
// gated by billing.view / payments.view, both granted to MITRA_ADMIN by seed.
// In this e2e environment without MySQL, the endpoints answer 503 and the UI
// renders the "Sumber data laporan belum tersedia" state.
test("mitra report menus render and show unavailable state without reports DB", async ({
  page,
}) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await expect(
    page.getByRole("link", { name: "Billing Tagihan" })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "History Payment" })
  ).toBeVisible()

  // 1. Billing Tagihan opens and shows unavailable state
  await page.getByRole("link", { name: "Billing Tagihan" }).click()
  await expect(page).toHaveURL(/\/admin\/billing$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Billing Tagihan" })
  ).toBeVisible()
  await expect(
    page.getByText("Sumber data laporan belum tersedia.")
  ).toBeVisible()

  // 2. History Payment opens and shows unavailable state
  await page.getByRole("link", { name: "History Payment" }).click()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "History Payment" })
  ).toBeVisible()
  await expect(
    page.getByText("Sumber data laporan belum tersedia.")
  ).toBeVisible()

  expect(problems).toEqual([])
})

// A Superadmin never sees the mitra report group and cannot open the routes
// directly; the guard sends it back to the dashboard.
test("Superadmin has no report menus and is redirected from billing", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  await expect(page.getByRole("link", { name: "Billing Tagihan" })).toHaveCount(
    0
  )
  await expect(page.getByRole("link", { name: "History Payment" })).toHaveCount(
    0
  )

  await page.goto("/admin/billing")
  await expect(page).toHaveURL(/\/admin\/dashboard$/)

  await page.goto("/admin/payment-history")
  await expect(page).toHaveURL(/\/admin\/dashboard$/)

  expect(problems).toEqual([])
})

// A hard refresh on a mitra-only report page must stay on that page: the
// guard waits for the boot session probe before reading user/permissions.
test("mitra report pages survive a hard refresh", async ({ page }) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await page.getByRole("link", { name: "Billing Tagihan" }).click()
  await expect(page).toHaveURL(/\/admin\/billing$/)
  await page.reload()
  await expect(page).toHaveURL(/\/admin\/billing$/)

  await page.getByRole("link", { name: "History Payment" }).click()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)
  await page.reload()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)

  expect(problems).toEqual([])
})

// With the session gone, the guard must pick the login form matching the kind
// of session that expired.
test("expired mitra session lands on /login-mitra", async ({ page }) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await page.context().clearCookies()
  await page.reload()
  await expect(page).toHaveURL(/\/login-mitra(\?|$)/)

  expect(problems).toEqual([])
})

test("expired Superadmin session lands on /login", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)

  await page.context().clearCookies()
  await page.reload()
  await expect(page).toHaveURL(/\/login(\?|$)/)

  expect(problems).toEqual([])
})

// Proves pages reliably restore their real content on the same URL after reload
// even when the boot session probe is delayed.
test("pages restore real content at same URL after delayed reload", async ({
  page,
}) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // 1. Reload on /admin/billing stays on billing and restores real content
  await page.getByRole("link", { name: "Billing Tagihan" }).click()
  await expect(page).toHaveURL(/\/admin\/billing$/)

  await page.route(/\/api\/v1\/auth\/(refresh|me)/, async (route) => {
    await new Promise((r) => setTimeout(r, 1000))
    await route.continue()
  })

  await page.reload()
  await expect(page).toHaveURL(/\/admin\/billing$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Billing Tagihan" })
  ).toBeVisible()

  // 2. Reload on /admin/payment-history stays on payment history and restores real content
  await page.getByRole("link", { name: "History Payment" }).click()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)

  await page.reload()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "History Payment" })
  ).toBeVisible()

  expect(problems).toEqual([])
})

// Proves the AppLoader is shown while the boot session probe is in flight
// and disappears once the session is restored.
test("app loader shows during delayed session probe on reload", async ({
  page,
}) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // Navigate to a mitra report page
  await page.getByRole("link", { name: "Billing Tagihan" }).click()
  await expect(page).toHaveURL(/\/admin\/billing$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Billing Tagihan" })
  ).toBeVisible()

  // Intercept the session probe and hold it
  let releaseProbe: () => void
  const probeHeld = new Promise<void>((resolve) => {
    releaseProbe = resolve
  })

  await page.route(/\/api\/v1\/auth\/(refresh|me)/, async (route) => {
    await probeHeld
    await route.continue()
  })

  // Reload the page - this should show the AppLoader
  const reloadPromise = page.reload()

  // Wait for the loader to appear
  await expect(page.getByTestId("app-loader")).toBeVisible({ timeout: 5000 })

  // Release the probe and wait for reload to complete
  releaseProbe!()
  await reloadPromise

  // Verify the real content is restored at the same URL
  await expect(page).toHaveURL(/\/admin\/billing$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Billing Tagihan" })
  ).toBeVisible()

  // Verify the loader is gone
  await expect(page.getByTestId("app-loader")).toBeHidden()

  expect(problems).toEqual([])
})

// Proves the password change form shows error toast when current password is wrong.
test("password change shows error toast for wrong current password", async ({
  page,
}) => {
  const problems = watch(page)
  await page.goto("/login")
  await page.getByLabel("Username atau Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  // Navigate to Account page via user dropdown menu
  await page.getByRole("button", { name: /Super Admin/ }).click()
  // Wait for dropdown content to be visible, then click Account menuitem
  await page.getByRole("menuitem", { name: "Account" }).click()
  await expect(page).toHaveURL(/\/admin\/account$/)
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible()

  // Try to change password with wrong current password
  await page.getByLabel("Current password").fill("WrongPassword123!")
  await page.getByLabel("New password").fill("NewPassword123!")
  await page.getByRole("button", { name: "Change password" }).click()

  // Error toast should appear
  await expect(page.getByText("Password saat ini salah.")).toBeVisible({ timeout: 5000 })

  // Verify password was not changed by signing out and signing in again with old password
  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel("Username atau Email").fill(email)
  await page.getByLabel("Password").fill(password) // original password still works
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  expect(problems).toEqual([])
})
