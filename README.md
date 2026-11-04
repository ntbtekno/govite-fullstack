# govite-fullstack

Reusable fullstack starter: Go API + Vite/React admin. Each side runs on its own.

```
be/   Go 1.26, Fiber v2, pgx + sqlc, goose migrations
fe/   pnpm workspace: apps/admin (Vite SPA), packages/ui (shadcn), packages/contracts (zod)
```

## Features

- Auth: JWT access token + rotating refresh cookie (reuse revokes the session), forgot/reset password (web link or mobile OTP), invites, email verification, session list/revoke, mobile clients via `X-Client: mobile`.
- RBAC: roles, permission catalog, `self|team|all` scopes, role-required TOTP 2FA with backup codes.
- Users: list/sort/filter, bulk actions, soft delete/restore, CSV/XLSX export, CSV import with preview.
- Audit log with filters and CSV export. App settings and public branding. Health, Prometheus-style metrics and system status.
- Notifications: in-app + optional FCM push, device registration and push opt-outs.
- Announcements: drafts, pinning, image upload and one-time notification on publish.
- Optional MinIO/S3-compatible storage: avatars, branding, announcement images, private signed attachments.
- Verified, idempotent Midtrans webhooks; API key management; daily cleanup with a Postgres advisory lock; optional Sentry.

## Setup

```bash
docker compose up -d postgres redis mailpit minio     # postgres :5434, redis :6380, mailpit :8025, MinIO console :9101
cd be && cp .env.example .env && make migrate seed
cd fe && pnpm install && cp apps/admin/.env.example apps/admin/.env
```

## Development

```bash
cd be && make dev     # or: make run          → http://localhost:3000/api/v1
cd fe && pnpm dev     # admin                 → http://localhost:5173
```

Vite proxies `/api` to `:3000`, so the browser sees one origin (no CORS, refresh cookie just works).
The app's front door is `/login-mitra` (root `/` redirects there); the Superadmin sign-in stays at `/login`.
Sign in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `be/.env` (the example values are public: change them before exposing the app).
Super Admin starts without required 2FA; turn it on per role in Roles (the next login shows a QR code). Re-running `make seed` keeps that choice.
Outside production, Swagger UI is at `/api/docs`; raw OpenAPI is at `/api/docs-json` and `/api/docs-yaml`.

## Mitra (tenant) setup

This fork adds mitra tenants. A mitra user is bound to exactly one mitra;
Superadmins have `mitra_id = NULL` and can see every mitra.

### Seed the first Superadmin and Mitra Admin

1. In `be/.env`, set `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` and
   `SUPER_ADMIN_USERNAME` (the Superadmin can sign in with the username OR the
   email). The seed is idempotent.
2. Run `cd be && make migrate seed`. This creates the Superadmin plus the system
   roles `MITRA_ADMIN` (manage users, scope `mitra`) and `MITRA_STAFF` (view
   users, scope `mitra`). It does not create any mitra or mitra user on its own.
3. Sign in as the Superadmin at `/login`.

For the throwaway mitra the browser e2e needs, `scripts/e2e.sh` sets
`E2E_MITRA_KODE` / `E2E_MITRA_USERNAME` / `E2E_MITRA_PASSWORD`; `make seed`
creates that mitra + Mitra Admin only outside production (they are ignored,
with the pinned `E2E_CAPTCHA_CODE`, when `APP_ENV=production`).

### Create the first mitra and its admin

1. Sign in as Superadmin and open **Mitra** in the sidebar, or call the API:
   `POST /api/v1/mitra` with `{ "kodeMitra": "MTR-001", "nama": "Mitra Satu" }`.
   `kodeMitra` is the code a mitra types at `/login-mitra`; keep it
   unguessable, it is still checked together with username + password.
2. Still as Superadmin, open **Users** and add a user with the role
   `MITRA_ADMIN`, choosing the new mitra in the Mitra field.
3. The Mitra Admin signs in at `/login-mitra` with the mitra code, its
   username and password. It only ever sees users of its own mitra; moving a
   user to another mitra signs that user out (their refresh session is
   revoked).


## Verification

```bash
cd be && make lint test
docker compose up -d postgres_test && make test-e2e
cd fe && pnpm lint && pnpm typecheck && pnpm test && pnpm build
scripts/e2e.sh                                                # browser e2e (Playwright), needs postgres_test
API_BASE_URL=http://localhost:3000/api/v1 scripts/smoke.sh   # SUPER_ADMIN_* must not require 2FA
```

## Adding a frontend (e.g. SEO landing)

```bash
cd fe && pnpm create astro@latest apps/landing
```

Add `"@app/ui": "workspace:*"` (and `@astrojs/react` for React islands), import `@app/ui/globals.css`.
`packages/ui` already scans `apps/*/src/**/*.astro` for Tailwind classes.

## Production checklist

- `APP_ENV=production`, strong `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `SUPER_ADMIN_PASSWORD`.
- Serve web and API on one origin behind HTTPS (refresh cookie is `Secure`, path `/api/v1/auth`). If they must be on separate origins, set `CORS_ORIGIN` and `VITE_API_BASE_URL`.
- Behind a reverse proxy set `TRUST_PROXY=true` so rate limits see the client IP.
- Set `REDIS_URL` when running more than one API instance (shared rate limits, permission cache).
- Run `api migrate` before serving traffic; `api seed` after changing the permission catalog.
- Replace every placeholder from `.env.example` (`JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `SUPER_ADMIN_PASSWORD`, MinIO keys). With `APP_ENV=production` the API refuses to boot while the JWT secret or pepper still contains `change-me`.
- The e2e hooks `E2E_CAPTCHA_CODE` and `E2E_MITRA_*` are inert in production: the pinned captcha and the throwaway mitra seed never apply, so no login shortcut ships.
- Turn on required 2FA for the Super Admin role after the first sign-in.
- Optional production stack: `docker-compose.prod.yml` serves the SPA and proxies `/api` to the API.

## License

MIT, see [LICENSE](LICENSE).
