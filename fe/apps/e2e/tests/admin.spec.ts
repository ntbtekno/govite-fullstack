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

// Halaman Permission menampilkan katalog yang dikelompokkan per kategori dan
// bisa dicari. Diakses sebagai Superadmin (memiliki permissions.view).
test("Permission menampilkan katalog tergrup per kategori dan bisa dicari", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  await page.getByRole("link", { name: "Permissions" }).click()
  await expect(page).toHaveURL(/\/admin\/administration\/permissions$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Permissions" })
  ).toBeVisible()

  // Header grup kategori terlihat (Report berisi billing/payments, dsb.).
  await expect(page.getByText("Report")).toBeVisible()
  // Permission kunci dari grup Administration terlihat sebelum dicari.
  await expect(page.getByText("users.manage")).toBeVisible()
  await expect(page.getByText("roles.manage")).toBeVisible()

  // Pencarian satu kata kunci menyisakan hanya permission yang cocok.
  await page.getByLabel("Cari permission").fill("billing")
  await expect(page.getByText("billing.view")).toBeVisible()
  await expect(page.getByText("billing.export")).toBeVisible()
  // Grup yang tidak memiliki cocok disembunyikan (kunci grup Administration hilang).
  await expect(page.getByText("users.manage")).toHaveCount(0)
  await expect(page.getByText("roles.manage")).toHaveCount(0)
  await expect(page.getByText("payments.view")).toHaveCount(0)

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

// Proves the History Payment table never scrolls horizontally at 1280px: the
// secondary columns moved into a per-row expand, and the primary columns fit
// the container width. Mock data is injected so the assertion does not depend
// on the reports database being configured.
test("History Payment has no horizontal scroll at 1280px and expands a row", async ({
  page,
}) => {
  const problems = watch(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  // Long values in the primary columns are the realistic overflow risk.
  const longVa = "MTR0014123456789012345678901234567890"
  const longRef = "REF-20260101-ABCDEFGHIJKLMNOPQRSTUVWXYZ-000001"
  const mockItems = Array.from({ length: 3 }, (_, i) => ({
    id: `tx-${i + 1}`,
    txDate: "2026-01-01",
    vaNumber: longVa,
    transactionAt: "2026-01-01T08:15:30",
    reference: `${longRef}-${i + 1}`,
    message: "Pembayaran VA berhasil dengan keterangan panjang sekali",
    amount: 125000 + i,
    status: "success",
  }))
  await page.route("**/api/v1/reports/payments**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          items: mockItems,
          total: mockItems.length,
          page: 1,
          pageSize: 10,
          summary: { count: mockItems.length, totalAmount: 375003 },
        },
      }),
    })
  })

  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await page.getByRole("link", { name: "History Payment" }).click()
  await expect(page).toHaveURL(/\/admin\/payment-history$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "History Payment" })
  ).toBeVisible()

  // Wait for the mocked rows to render.
  await expect(page.getByText(longVa).first()).toBeVisible()

  // The table wrapper must not scroll horizontally.
  const wrapper = page.getByTestId("payment-table-wrapper")
  const metrics = await wrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.overflowX).not.toBe("scroll")
  expect(metrics.overflowX).not.toBe("auto")

  // The whole page must not gain a horizontal scrollbar either.
  const pageMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth)

  // Secondary fields are hidden before expanding.
  await expect(
    page.getByText("Pembayaran VA berhasil dengan keterangan panjang sekali")
  ).toHaveCount(0)

  // Expanding one row reveals its secondary field in a full-width detail row.
  await page.getByRole("button", { name: "Buka detail transaksi" }).first().click()
  await expect(page.getByTestId("payment-detail-row")).toBeVisible()
  await expect(
    page.getByText("Pembayaran VA berhasil dengan keterangan panjang sekali")
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
  // Wait for login form to be visible (ensures React has mounted)
  await expect(page.getByLabel("Kode Mitra")).toBeVisible()
  // Session expired message should be visible on login-mitra page
  await expect(page.getByText("Sesi Anda telah berakhir. Silakan masuk kembali.")).toBeVisible()

  expect(problems).toEqual([])
})

test("expired Superadmin session lands on /login", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)

  await page.context().clearCookies()
  await page.reload()
  await expect(page).toHaveURL(/\/login(\?.*)?$/)
  // Wait for login form to be visible (ensures React has mounted)
  await expect(page.getByLabel("Username atau Email")).toBeVisible()
  // Session expired message should be visible on login page
  await expect(page.getByText("Sesi Anda telah berakhir. Silakan masuk kembali.")).toBeVisible()

  expect(problems).toEqual([])
})

// Manual logout should NOT show session expired message
test("manual logout does not show session expired message", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)

  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login(\?|$)/)
  // No session expired message on manual logout
  await expect(page.getByText("Sesi Anda telah berakhir. Silakan masuk kembali.")).not.toBeVisible()

  expect(problems).toEqual([])
})

// Sign in on /login, optionally ticking "Ingat saya".
async function signInWithRemember(page: Page, remember: boolean) {
  await page.goto("/login")
  await page.getByLabel("Username atau Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  if (remember) {
    await page.getByLabel("Ingat saya").check()
  }
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)
}

// The idle window (15m without remember) warns at 14m and "Tetap masuk"
// cancels it and restarts the countdown.
test("idle warning appears and Tetap masuk cancels the logout", async ({
  page,
}) => {
  await page.clock.install()
  await signInWithRemember(page, false)

  // 14 minutes idle: one minute before the 15-minute logout.
  await page.clock.fastForward("14:00")
  await expect(page.getByTestId("session-timeout-modal")).toBeVisible()
  await expect(page.getByText(/Sesi akan berakhir dalam \d+ detik/)).toBeVisible()

  await page.getByTestId("stay-signed-in").click()
  await expect(page.getByTestId("session-timeout-modal")).toHaveCount(0)

  // The countdown restarted: 14 more minutes still keep the session alive.
  await page.clock.fastForward("14:00")
  await expect(page).toHaveURL(/\/admin\/dashboard/)
  await expect(page.getByTestId("session-timeout-modal")).toBeVisible()
})

// An ignored warning logs out to the login page with the expired message.
test("ignored idle warning logs out to the login page", async ({ page }) => {
  await page.clock.install()
  await signInWithRemember(page, false)

  await page.clock.fastForward("14:00")
  await expect(page.getByTestId("session-timeout-modal")).toBeVisible()

  // Do not act: the last idle minute elapses and the session ends.
  await page.clock.fastForward("01:05")
  await expect(page).toHaveURL(/\/login(\?|$)/)
  await expect(
    page.getByText("Sesi Anda telah berakhir. Silakan masuk kembali.")
  ).toBeVisible()
})

// "Ingat saya" decides cookie persistence: a persistent 7-day cookie vs a
// session cookie the browser drops on close.
test("remember-me picks a persistent cookie; default is a session cookie", async ({
  page,
  context,
}) => {
  await signInWithRemember(page, true)
  let cookie = (await context.cookies()).find(
    (c) => c.name === "refresh_token"
  )
  expect(cookie).toBeTruthy()
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000)
  await page.getByRole("button", { name: /Super Admin/ }).click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login(\?|$)/)

  await signInWithRemember(page, false)
  cookie = (await context.cookies()).find((c) => c.name === "refresh_token")
  expect(cookie).toBeTruthy()
  // -1 is a session cookie: dropped when the browser (context) closes.
  expect(cookie!.expires).toBe(-1)
})

// A remembered session survives a browser restart; a session without "Ingat
// saya" does not. A real browser keeps only persistent cookies across a
// restart, so we copy exactly those into a fresh context to model it.
test("remember-me session survives a browser restart; default does not", async ({
  browser,
}) => {
  // With "Ingat saya": the refresh cookie is persistent, so it survives.
  const remembered = await browser.newContext()
  const rPage = await remembered.newPage()
  await signInWithRemember(rPage, true)
  const persistentCookies = (await remembered.cookies()).filter(
    (c) => c.expires > 0
  )
  await remembered.close()

  const restartedRemembered = await browser.newContext()
  await restartedRemembered.addCookies(persistentCookies)
  const rrPage = await restartedRemembered.newPage()
  await rrPage.goto("/admin/dashboard")
  await expect(rrPage).toHaveURL(/\/admin\/dashboard/)
  await restartedRemembered.close()

  // Without "Ingat saya": the refresh cookie is session-scoped, so a real
  // browser drops it on close; only persistent cookies carry over.
  const ephemeral = await browser.newContext()
  const ePage = await ephemeral.newPage()
  await signInWithRemember(ePage, false)
  const carriedOver = (await ephemeral.cookies()).filter((c) => c.expires > 0)
  await ephemeral.close()

  const restarted = await browser.newContext()
  await restarted.addCookies(carriedOver)
  const rPage2 = await restarted.newPage()
  await rPage2.goto("/admin/dashboard")
  await expect(rPage2).toHaveURL(/\/login(\?|$)/)
  await restarted.close()
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

// Role detail MITRA_STAFF: enable one permission, save, reload -> still selected
test("MITRA_STAFF role detail: enable permission, save, reload persists", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  // Go to Roles page
  await page.getByRole("link", { name: "Roles" }).click()
  await expect(page).toHaveURL(/\/admin\/administration\/roles$/)
  await expect(page.getByRole("heading", { level: 1, name: "Roles" })).toBeVisible()

  // Find MITRA_STAFF row and click View
  const mitraStaffRow = page.getByRole("row", { name: /MITRA_STAFF/i })
  await expect(mitraStaffRow).toBeVisible()
  await mitraStaffRow.getByRole("link", { name: "View" }).click()

  // Wait for role detail page
  await expect(page).toHaveURL(/\/admin\/administration\/roles\/[^/]+$/)
  await expect(page.getByRole("heading", { level: 1, name: "MITRA_STAFF" })).toBeVisible()

  // Pick a stable permission. The seeded database may already contain the
  // grant, so toggle rather than assuming an unchecked baseline.
  const candidates = ["Lihat Audit Log", "Kelola Pengguna", "Kelola Pengaturan"]
  let targetCheckbox = page.getByLabel(candidates[0])
  for (const label of candidates) {
    const checkbox = page.getByLabel(label)
    await expect(checkbox).toBeEnabled()
    targetCheckbox = checkbox
    break
  }

  const desiredChecked = !(await targetCheckbox.isChecked())
  await targetCheckbox.setChecked(desiredChecked)
  await expect(targetCheckbox).toBeChecked({ checked: desiredChecked })

  // Click Save permissions
  await page.getByRole("button", { name: "Save permissions" }).click()

  // Wait for toast success
  await expect(page.getByText("Permissions saved")).toBeVisible({ timeout: 5000 })

  // Reload the page
  await page.reload()

  // Wait for page to load
  await expect(page.getByRole("heading", { level: 1, name: "MITRA_STAFF" })).toBeVisible()

  // Verify the changed permission persisted
  await expect(targetCheckbox).toBeChecked({ checked: desiredChecked })

  expect(problems).toEqual([])
})

// Role detail Super Admin: permission editor stays disabled
test("Super Admin role detail: permission editor stays disabled", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)

  // Go to Roles page
  await page.getByRole("link", { name: "Roles" }).click()
  await expect(page).toHaveURL(/\/admin\/administration\/roles$/)
  await expect(page.getByRole("heading", { level: 1, name: "Roles" })).toBeVisible()

  // Find Super Admin row and click View
  const superAdminRow = page.getByRole("row", { name: /Super Admin/i })
  await expect(superAdminRow).toBeVisible()
  await superAdminRow.getByRole("link", { name: "View" }).click()

  // Wait for role detail page
  await expect(page).toHaveURL(/\/admin\/administration\/roles\/[^/]+$/)
  await expect(page.getByRole("heading", { level: 1, name: "Super Admin" })).toBeVisible()

  // All permission checkboxes should be disabled
  const checkboxes = page.getByRole("checkbox", { name: /view|manage|edit|create|delete|export/i })
  const count = await checkboxes.count()
  for (let i = 0; i < count; i++) {
    const checkbox = checkboxes.nth(i)
    await expect(checkbox).toBeDisabled()
  }

  // Save permissions button should be disabled
  await expect(page.getByRole("button", { name: "Save permissions" })).toBeDisabled()

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

/** Signs in at /login-mitra as the seeded mitra user. */
async function signInMitra(page: Page) {
  await page.goto("/login-mitra")
  await page.getByLabel("Kode Mitra").fill(mitraKode)
  await page.getByLabel("Username atau Email").fill(mitraUsername)
  await page.getByLabel("Password").fill(mitraPassword)
  await page.getByRole("textbox", { name: "Captcha" }).fill(captcha)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)
}

// The mitra dashboard shows both new cards. The Login Terakhir card is filled
// from the real session login (the refresh-token family records the client IP),
// and the Transaksi Bulan Ini card renders one bar per day of the default range
// (1st of month to today) from a mocked summary.
test("mitra dashboard shows Login Terakhir with IP and Transaksi Bulan Ini bars", async ({
  page,
}) => {
  const problems = watch(page)

  const now = new Date()
  const today = now.getDate()
  const monthlyDays = Array.from({ length: today }, (_, i) => ({
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    count: i % 4,
  }))
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          lastLogin: {
            at: "2026-11-10T08:30:00Z",
            ip: "203.0.113.7",
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          monthlyTransactions: {
            unavailable: false,
            total: monthlyDays.reduce((s, d) => s + d.count, 0),
            totalAmount: 1234567,
            coverage: { minDate: "2025-06-20", lastDate: "2026-08-12" },
            days: monthlyDays,
          },
        },
      }),
    })
  })

  await signInMitra(page)

  const loginCard = page.getByTestId("login-terakhir-card")
  await expect(loginCard).toBeVisible()
  await expect(loginCard).toContainText("203.0.113.7")
  await expect(page.getByTestId("login-perangkat")).toContainText("Chrome")

  const chartCard = page.getByTestId("transaksi-bulan-ini-card")
  await expect(chartCard).toBeVisible()
  await expect(page.getByTestId("transaksi-chart")).toBeVisible()
  // One bar per day of the default range (1st to today).
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(today)

  expect(problems).toEqual([])
})

// A Superadmin session never renders the mitra-only transaction chart card.
test("Superadmin dashboard shows no transaction chart card", async ({ page }) => {
  const problems = watch(page)
  await signIn(page)

  await expect(page.getByTestId("login-terakhir-card")).toBeVisible()
  await expect(page.getByTestId("transaksi-bulan-ini-card")).toHaveCount(0)

  expect(problems).toEqual([])
})

// Proves the dashboard date range is draft/apply: editing the inputs does not
// refetch, clicking "Terapkan" refetches once with the chosen from/to, and the
// bars and headline total follow the applied range.
test("mitra dashboard date range applies on demand and changes bars and total", async ({
  page,
}) => {
  const problems = watch(page)

  // Serve the summary from the requested bounds so the chart mirrors the query.
  const summaryFor = (from: string, to: string) => {
    const start = new Date(from + "T00:00:00Z")
    const end = new Date(to + "T00:00:00Z")
    const days: { date: string; count: number }[] = []
    for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
      days.push({ date: new Date(t).toISOString().split("T")[0], count: 1 })
    }
    return {
      lastLogin: null,
      monthlyTransactions: {
        unavailable: false,
        total: days.length,
        totalAmount: days.length * 1000,
        coverage: null,
        days,
      },
    }
  }

  const today = new Date().getDate()
  const defaultFrom = `2026-11-01`
  const defaultTo = `2026-11-${String(today).padStart(2, "0")}`

  const summaryRequests: string[] = []
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    const url = new URL(route.request().url())
    summaryRequests.push(`${url.searchParams.get("from") ?? ""}..${url.searchParams.get("to") ?? ""}`)
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    const body = from && to ? summaryFor(from, to) : summaryFor(defaultFrom, defaultTo)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: body }),
    })
  })

  await signInMitra(page)

  const chartCard = page.getByTestId("transaksi-bulan-ini-card")
  await expect(chartCard).toBeVisible()
  // Default range is 1st to today.
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(today)

  const callsBefore = summaryRequests.length

  // Type a 5-day range (2026-11-05..2026-11-09).
  await page.getByLabel("Dari").fill("2026-11-05")
  await page.getByLabel("Sampai").fill("2026-11-09")

  // Editing draft inputs must not refetch.
  expect(summaryRequests.length).toBe(callsBefore)

  // Apply: exactly one refetch carrying the chosen bounds.
  await page.getByTestId("dashboard-apply-btn").click()
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(5)
  expect(summaryRequests[summaryRequests.length - 1]).toBe("2026-11-05..2026-11-09")

  // The headline total follows the applied range (5 days, count 1 each).
  await expect(chartCard).toContainText("Total transaksi: 5")

  // "Bulan ini" restores the default range (1st to today).
  await page.getByRole("button", { name: "Bulan ini" }).click()
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(today)

  expect(problems).toEqual([])
})

// The dashboard headline shows both totals and a stored-data coverage line, and
// a range reaching past today is rejected without hitting the API.
test("mitra dashboard shows both totals and coverage, and rejects a future date", async ({
  page,
}) => {
  const problems = watch(page)

  const now = new Date()
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const monthlyDays = Array.from({ length: days }, (_, i) => ({
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    count: 1,
  }))
  const summaryRequests: string[] = []
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    const url = new URL(route.request().url())
    summaryRequests.push(`${url.searchParams.get("from") ?? ""}..${url.searchParams.get("to") ?? ""}`)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          lastLogin: null,
          monthlyTransactions: {
            unavailable: false,
            total: monthlyDays.length,
            totalAmount: 2500000,
            coverage: { minDate: "2025-06-20", lastDate: "2026-08-12" },
            days: monthlyDays,
          },
        },
      }),
    })
  })

  await signInMitra(page)

  const chartCard = page.getByTestId("transaksi-bulan-ini-card")
  await expect(chartCard).toBeVisible()

  // Both headline totals render.
  await expect(chartCard).toContainText(`Total transaksi: ${monthlyDays.length}`)
  await expect(chartCard).toContainText("Total nominal: Rp 2.500.000")

  // The stored-data coverage line renders below the chart.
  await expect(page.getByTestId("dashboard-coverage")).toContainText("Data tersimpan:")

  const callsBefore = summaryRequests.length

  // A Sampai beyond today is rejected: the apply button is disabled, the
  // message shows, and the API is never called.
  await page.getByLabel("Sampai").fill("2999-12-31")
  await expect(page.getByTestId("dashboard-apply-btn")).toBeDisabled()
  await expect(
    page.getByText("Tanggal Sampai tidak boleh melebihi hari ini")
  ).toBeVisible()
  expect(summaryRequests.length).toBe(callsBefore)

  expect(problems).toEqual([])
})

test("mitra dashboard limits refresh to chart, shows loader, and defaults Sampai to today", async ({
  page,
}) => {
  const problems = watch(page)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const today = String(now.getUTCDate()).padStart(2, "0")
  const defaultFrom = `${year}-${month}-01`
  const defaultTo = `${year}-${month}-${today}`
  const summaryFor = (from: string, to: string, count = 1) => {
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    const days = []
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      days.push({ date: new Date(t).toISOString().slice(0, 10), count })
    }
    return {
      unavailable: false,
      total: days.length * count,
      totalAmount: days.length * count * 1000,
      coverage: null,
      days,
    }
  }
  const loginText = "10.20.30.40"
  const requests: string[] = []
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    const url = new URL(route.request().url())
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    requests.push(`${from ?? ""}..${to ?? ""}`)
    if (!from && !to) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { lastLogin: { at: "2026-11-10T08:30:00Z", ip: loginText, userAgent: "Chrome/120" }, monthlyTransactions: null } }) })
      return
    }
    if (from === "2026-11-05") await new Promise((resolve) => setTimeout(resolve, 500))
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { lastLogin: null, monthlyTransactions: summaryFor(from!, to!) } }) })
  })

  await signInMitra(page)
  const loginCard = page.getByTestId("login-terakhir-card")
  await expect(loginCard).toContainText(loginText)
  await expect(page.getByLabel("Sampai")).toHaveValue(defaultTo)
  const callsBefore = requests.length
  await page.getByLabel("Dari").fill("2026-11-05")
  await page.getByLabel("Sampai").fill("2026-11-09")
  await page.getByTestId("dashboard-apply-btn").click()
  await expect(page.getByTestId("dashboard-chart-loader")).toBeVisible()
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(5)
  await expect(page.getByTestId("transaksi-bulan-ini-card")).toContainText("Total transaksi: 5")
  await expect(loginCard).toContainText(loginText)
  expect(requests.length).toBe(callsBefore + 1)
  expect(problems).toEqual([])
})

// The dashboard range is limited to 1 month: a longer draft disables "Terapkan"
// with an inline message and never hits the summary endpoint, while a range
// within 1 month applies normally and changes the chart.
test("mitra dashboard rejects a range longer than 1 month without requesting", async ({
  page,
}) => {
  const problems = watch(page)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const today = String(now.getUTCDate()).padStart(2, "0")
  const defaultFrom = `${year}-${month}-01`
  const defaultTo = `${year}-${month}-${today}`
  const summaryFor = (from: string, to: string, count = 1) => {
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    const days = []
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      days.push({ date: new Date(t).toISOString().slice(0, 10), count })
    }
    return {
      unavailable: false,
      total: days.length * count,
      totalAmount: days.length * count * 1000,
      coverage: null,
      days,
    }
  }
  const requests: string[] = []
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    const url = new URL(route.request().url())
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    requests.push(`${from ?? ""}..${to ?? ""}`)
    const monthly = from && to ? summaryFor(from, to) : summaryFor(defaultFrom, defaultTo)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { lastLogin: null, monthlyTransactions: monthly } }),
    })
  })

  await signInMitra(page)

  const chartCard = page.getByTestId("transaksi-bulan-ini-card")
  await expect(chartCard).toBeVisible()
  const barsBefore = await page.getByTestId("transaksi-bar").count()
  const requestsBefore = requests.length

  // A draft spanning more than 1 month (2026-06-01..2026-07-03 = 32 days):
  // Terapkan is disabled, the 1-month message shows, and no request is made.
  await page.getByLabel("Dari").fill("2026-06-01")
  await page.getByLabel("Sampai").fill("2026-07-03")
  await expect(page.getByTestId("dashboard-apply-btn")).toBeDisabled()
  await expect(page.getByText(/maksimal 1 bulan/)).toBeVisible()
  expect(requests.length).toBe(requestsBefore)
  // The previous chart is untouched.
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(barsBefore)

  // A draft within 1 month (2026-06-01..2026-07-02 = 31 days) applies normally.
  await page.getByLabel("Sampai").fill("2026-07-02")
  await expect(page.getByTestId("dashboard-apply-btn")).toBeEnabled()
  await page.getByTestId("dashboard-apply-btn").click()
  await expect(page.getByTestId("transaksi-bar")).toHaveCount(32)
  expect(requests[requests.length - 1]).toBe("2026-06-01..2026-07-02")

  expect(problems).toEqual([])
})

// Refetch on "Terapkan" keeps bars visible, shows "Memperbarui..." indicator,
// and updates "Terakhir diperbarui" timestamp.
test("mitra dashboard refetch on Terapkan keeps bars visible and shows updating indicator", async ({
  page,
}) => {
  const problems = watch(page)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const today = String(now.getUTCDate()).padStart(2, "0")
  const defaultFrom = `${year}-${month}-01`
  const defaultTo = `${year}-${month}-${today}`
  const summaryFor = (from: string, to: string, count = 1) => {
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    const days = []
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      days.push({ date: new Date(t).toISOString().slice(0, 10), count })
    }
    return {
      unavailable: false,
      total: days.length * count,
      totalAmount: days.length * count * 1000,
      coverage: null,
      days,
    }
  }
  let requestCount = 0
  await page.route("**/api/v1/dashboard/summary**", async (route) => {
    const url = new URL(route.request().url())
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    requestCount++
    const monthly = from && to ? summaryFor(from, to) : summaryFor(defaultFrom, defaultTo)
    // Keep the refetch pending long enough to assert the stale-data/update UI.
    if (from === "2026-06-01" && to === "2026-06-15") {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { lastLogin: null, monthlyTransactions: monthly } }),
    })
  })

  await signInMitra(page)

  const loginCard = page.getByTestId("login-terakhir-card")
  await expect(loginCard).toBeVisible()
  const chartCard = page.getByTestId("transaksi-bulan-ini-card")
  await expect(chartCard).toBeVisible()
  const barsBefore = await page.getByTestId("transaksi-bar").count()
  expect(barsBefore).toBeGreaterThan(0)

  // Verify side-by-side layout on desktop viewport
  const loginBox = await loginCard.boundingBox()
  const chartBox = await chartCard.boundingBox()
  expect(loginBox).not.toBeNull()
  expect(chartBox).not.toBeNull()
  if (loginBox && chartBox) {
    // Login card should be to the left of chart card
    expect(loginBox.x + loginBox.width).toBeLessThanOrEqual(chartBox.x + 20) // allow small gap
  }

  // Record initial last-sync (should be null/empty initially)
  expect(await page.getByText(/Terakhir diperbarui:/).count()).toBe(0) // initially empty

  // Change date range and click Terapkan
  await page.getByLabel("Dari").fill("2026-06-01")
  await page.getByLabel("Sampai").fill("2026-06-15")
  await page.getByTestId("dashboard-apply-btn").click()

  // During refetch: bars should remain visible, "Memperbarui..." indicator appears
  await expect(page.getByTestId("transaksi-bar").first()).toBeVisible()
  await expect(page.getByText("Memperbarui…")).toBeVisible({ timeout: 5000 })

  // Wait for refetch to complete
  await expect(page.getByText("Memperbarui…")).toBeHidden({ timeout: 10000 })

  // After refetch: bars still visible, last-sync updated
  await expect(page.getByTestId("transaksi-bar").first()).toBeVisible()
  const barsAfter = await page.getByTestId("transaksi-bar").count()
  expect(barsAfter).toBeGreaterThan(0)

  // Last-sync timestamp should now be visible
  await expect(page.locator('text=/Terakhir diperbarui:/')).toBeVisible()
  const lastSyncAfter = await page.locator('text=/Terakhir diperbarui:/').textContent()
  // Intl Indonesian locale uses dot separators (HH.MM.SS) in Chromium.
  expect(lastSyncAfter).toMatch(/Terakhir diperbarui: \d{2}[.:]\d{2}[.:]\d{2}/)

  expect(problems).toEqual([])
})

// Mitra admin (MITRA_ADMIN) sees the Tools group and can open Create VA;
// the page is blank: only the "Create VA" header, no form/API.
test("mitra admin opens Create VA from Tools group (blank page, header only)", async ({
  page,
}) => {
  const problems = watch(page)
  await signInMitra(page)

  // Tools group visible for mitra session holding va.view.
  await expect(page.getByRole("link", { name: "Create VA" })).toBeVisible()
  await page.getByRole("link", { name: "Create VA" }).click()
  await expect(page).toHaveURL(/\/admin\/tools\/create-va/)

  // Blank page: only the header, no form/API-driven content.
  await expect(page.getByRole("heading", { name: "Create VA" })).toBeVisible()
  await expect(page.locator("form")).toHaveCount(0)
  await expect(page.locator("input")).toHaveCount(0)

  expect(problems).toEqual([])
})

// Superadmin has no default va.view grant. A direct visit is therefore guarded
// and returns to the dashboard, matching the report-route behavior.
test("user without va.view is redirected from Create VA to dashboard", async ({
  page,
}) => {
  const problems = watch(page)
  await signIn(page)
  await page.goto("/admin/tools/create-va")
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await expect(page.getByRole("heading", { name: "Create VA" })).toHaveCount(0)
  expect(problems).toEqual([])
})
