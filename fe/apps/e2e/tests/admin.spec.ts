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

  // The sidebar user button shows the role under the name.
  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto("/admin/dashboard")
  await expect(page).toHaveURL(/\/login/)

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

  // Users is visible (users.view); Superadmin-only pages are not.
  await expect(
    page.getByRole("link", { name: "Users" })
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Roles" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Mitra" })).toHaveCount(0)

  expect(problems).toEqual([])
})

// A mitra user only sees itself, so the Users menu must open that user's own
// detail page (id from the auth context), never the user list.
test("mitra Users menu opens its own detail page", async ({ page }) => {
  const problems = watch(page)
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await page.getByRole("link", { name: "Users" }).click()

  // The detail route for the signed-in user, not the list.
  await expect(page).toHaveURL(
    /\/admin\/administration\/users\/[0-9a-f-]{36}$/
  )
  await expect(page.getByText("User detail")).toBeVisible()
  await expect(page.getByLabel("Username")).toHaveValue(mitraUsername)
  // The list's heading and "Add user" action are absent on the detail page.
  await expect(
    page.getByRole("heading", { level: 1, name: "Users" })
  ).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add user" })).toHaveCount(0)

  expect(problems).toEqual([])
})

// The Superadmin keeps the user list: its Users menu must not be redirected to
// a detail page.
test("Superadmin Users menu keeps the user list", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)

  await page.getByRole("link", { name: "Users" }).click()

  await expect(page).toHaveURL(/\/admin\/administration\/users$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Users" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Add user" })).toBeVisible()

  expect(problems).toEqual([])
})
