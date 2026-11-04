# Rencana Adaptasi govite-fullstack: Mitra + Captcha

> Status: DIPUTUSKAN 29 Okt 2026 — base project = fork `rekanara/govite-fullstack`,
> bukan lagi ZKOSS. Paket ZKOSS lama di `~/workspace/zkoss-rbac-kilocode/`
> TIDAK dipakai lagi, jangan dicampur ke fork ini.
>
> File ini disalin ke fork sebagai `docs/adaptasi-mitra-captcha.md`.
> Kilo Code WAJIB membaca dulu `AGENTS.md` dan `be/ARCHITECTURE.md` bawaan
> repo, baru file ini. Kalau ada konflik, aturan keamanan di file ini
> menang untuk fitur mitra & captcha, aturan arsitektur repo tetap berlaku
> untuk sisanya (jangan edit file generated, jangan edit store sqlc manual).

## 0. Yang sudah ada di govite (jangan dibuat ulang)

- Backend: Go 1.26, Fiber v2, pgx + sqlc, migrasi goose, JWT access
  (15 menit) + refresh cookie berotasi, argon2id, throttle login terpisah.
- RBAC: katalog permission di `be/internal/policy/policy.go` saja
  (`resource.action`, scope `self|team|all`), route dijaga `rbac.Guarded`
  yang panic kalau permission tidak dikenal. Setelah ubah policy:
  `make gen` (ke `fe/packages/contracts/src/generated.ts`) + `make seed`.
- User saat ini: satu `role_id` per user, login `email + password`,
  seed Super Admin lewat `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`.
- Frontend: Vite/React, TanStack Router file routes, `apps/admin`,
  form login di `features/auth/components/login-form.tsx`,
  konteks auth di `lib/auth-context.tsx` / `lib/auth-api.ts`.

## 1. Yang TIDAK ada di govite (ini pekerjaan adaptasinya)

1. Tidak ada tabel mitra, tidak ada kolom `mitra_id` / `username` di user.
2. Tidak ada captcha di backend maupun frontend.
3. JWT (`SignAccess`) dan `kernel.Principal` hanya membawa `userID`,
   `roleID`, `sessionID` — tidak membawa mitra. Jadi guard sekarang
   tidak bisa membedakan "semua user" vs "user satu mitra".
4. Scope `team` ada, tapi provider hierarki tim-nya nil — scope `team`
   saat ini error `TEAM_SCOPE_UNAVAILABLE`. Jangan pakai scope `team`
   untuk mitra; pakai scope baru `mitra` (bagian 3).
5. List user (`ListUsers` / `CountUsers` di `queries/users.sql`) tidak
   punya filter mitra sama sekali. Ini bug isolasi kalau langsung
   diberi akses ke Mitra Admin tanpa perbaikan.

## 2. Keputusan desain (dikunci — jangan diubah diam-diam)

### 2.1 Mitra = tenant, bukan role

- Satu user mitra terikat ke SATU mitra. Satu mitra punya banyak user.
- Superadmin: `mitra_id = NULL`, bisa melihat semua mitra.
- `kode_mitra` adalah kode yang diketik saat login mitra, contoh
  `MTR-001`, unik, tidak boleh ditebak dari urutan saja untuk
  login (tetap divalidasi bersama username + password).
- `username` unik secara GLOBAL (bukan hanya per mitra). Alasannya:
  login Superadmin menerima username ATAU email — kalau username
  boleh sama di mitra berbeda, login Superadmin jadi ambigu.
  Username mitra tetap harus cocok dengan `kode_mitra`-nya saat
  login mitra, jadi username global tidak menghilangkan isolasi.

### 2.2 Dua jalur login (tetap seperti spek awal)

| Jalur | Route frontend | Endpoint | Input |
|---|---|---|---|
| Superadmin | `/login` (sudah ada, dimodifikasi) | `POST /api/v1/auth/login` (dimodifikasi) | `login` (username ATAU email) + `password` + `captchaId` + `captcha` |
| Mitra | `/login-mitra` (baru) | `POST /api/v1/auth/login-mitra` (baru) | `mitraKode` + `username` + `password` + `captchaId` + `captcha` |

- Setelah login: Superadmin -> `/admin/dashboard`, Mitra -> dashboard
  mitra (route admin yang sama boleh dipakai, tapi menu & data
  difilter; lihat Milestone 4). Jangan buat aplikasi frontend kedua.
- Pesan gagal login SELALU generik: `Email/username atau password
  salah, atau captcha tidak valid.` Jangan membedakan "mitra tidak
  ada", "username tidak ada", atau "password salah".
- Captcha dicek SEBELUM cek password, dan sekali pakai. Captcha
  yang salah/kedaluwarsa/sudah dipakai = login gagal, dan frontend
  wajib memuat captcha baru (bukan memakai ulang gambar lama).

### 2.3 Scope baru: `mitra`

Tambahkan `"mitra"` ke `policy.Scopes` (menjadi
`self | team | mitra | all`), dan tambahkan ke `rbac/domain.Scope`:

```go
// Scope yang dikembalikan Guard.Resolve:
type Scope struct {
    Kind string // "self" | "team" | "mitra" | "all"
    UserID string
    MitraID string // terisi kalau Kind == "mitra"
    SubordinateUserIDs []string // hanya untuk "team", seperti sekarang
}
```

Aturan pertahanan berlapis (defense in depth) di `Guard.Resolve`:

- Kalau principal punya `mitra_id`, grant scope `all` DITURUNKAN
  menjadi `mitra` (mitranya sendiri). Ini mencegah role mitra yang
  salah konfigurasi (scope `all`) bisa melihat semua mitra.
- Kalau principal punya `mitra_id`, grant scope `team` juga
  diturunkan menjadi `mitra` (provider team memang nil).
- Kalau principal Superadmin (`mitra_id` kosong), `all` tetap `all`.
- Handler WAJIB memakai scope ini sebagai filter query, bukan
  memakai `mitraId` dari query param / body request. Filter dari
  request yang dikirim user harus DIABAIKAN untuk user mitra.

### 2.4 Captcha: buatan sendiri, tanpa Google, tanpa layanan luar

- Endpoint publik: `GET /api/v1/auth/captcha`
  -> `{ captchaId, image: "data:image/png;base64,...", expiresIn: 120 }`.
- Gambar: 5 karakter dari `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (buang `0/O/1/I/L`), dengan noise garis/titik. Validasi
  case-insensitive, berlaku 2 menit, sekali pakai.
- Penyimpanan: simpan HANYA hash kode (bukan plaintext) + expiry,
  di Redis kalau `REDIS_URL` terisi, kalau tidak pakai in-memory
  store dengan mutex + cleanup berkala — mengikuti pola repo ini
  yang sudah memperlakukan Redis sebagai opsional.
- Library gambar: Kilo Code harus verifikasi dulu library kecil
  yang masih terawat untuk generate PNG di Go (kandidat umum:
  `dchest/captcha` dengan custom store). Kalau library itu tidak
  terawat / API-nya tidak cocok, fallback: implementasi PNG
  dengan stdlib `image/png` + font bitmap. JANGAN pakai Google
  reCAPTCHA, JANGAN kirim kode captcha ke client lewat JSON
  selain gambarnya, JANGAN simpan kode captcha di database user.
- Throttle terpisah: endpoint captcha dibatasi sendiri
  (misal 30/menit/IP), terpisah dari `LOGIN_THROTTLE_LIMIT`,
  supaya bot tidak bisa menguras captcha tanpa batas.
- Captcha WAJIB di kedua jalur login, selalu — bukan hanya
  setelah N kali gagal. Throttle login yang sudah ada tetap jalan.

### 2.5 Role mitra (seed)

| Role | Scope | Permission awal |
|---|---|---|
| Super Admin (sudah ada, system) | `all` | Semua permission, seperti sekarang |
| `MITRA_ADMIN` (baru, system) | `mitra` | `users.manage` (scope mitra), `users.view` (scope mitra, lihat 2.6) |
| `MITRA_STAFF` (baru, system) | `mitra` | `users.view` (scope mitra) saja |

- Role mitra dibuat oleh seed (seperti Super Admin), BUKAN oleh
  user lewat UI di tahap ini. Mitra Admin TIDAK BOLEH membuat role
  baru dan TIDAK BOLEH mengubah role user menjadi Super Admin
  atau role system lainnya.
- Kalau user mitra pindah mitra atau `mitra_id`-nya diubah,
  cabut semua refresh family user itu (pakai mekanisme revoke
  yang sudah ada), karena JWT lama masih membawa `mitra_id` lama
  sampai access token-nya kedaluwarsa (15 menit).

### 2.6 Permission baru yang dibutuhkan

Tambahkan ke `policy.Permissions` (lalu `make gen` + `make seed`):

```text
mitra.manage   # CRUD mitra, Superadmin saja
mitra.view     # Melihat daftar/detail mitra, Superadmin saja (tahap ini)
users.view     # Melihat daftar user (read-only). Dipakai MITRA_STAFF.
               # Route GET /users diubah guard-nya dari users.manage
               # menjadi users.view, supaya staff bisa baca tanpa bisa
               # create/update/delete (route POST/PUT/DELETE tetap
               # users.manage).
```

Catatan: penambahan `users.view` akan membuat test lama yang
memakai seed `users.manage` untuk GET /users perlu diperbarui —
itu memang bagian dari Milestone 4, bukan alasan membatalkan
permission ini. Alternatif yang ditolak: memberi MITRA_STAFF
`users.manage` — itu memberi hak tulis padahal maunya read-only.

## 3. Skema database (migrasi baru, jangan edit 00001/00002)

File: `be/internal/platform/postgres/migrations/00003_mitra.sql`
(draft lengkap di `db/00003_mitra.sql` di paket ini).
Isi ringkasnya:

```sql
-- +goose Up
CREATE TABLE "mitra" (
    "id" TEXT NOT NULL PRIMARY KEY,          -- UUIDv7, kernel.NewID()
    "kode_mitra" TEXT NOT NULL UNIQUE,       -- MTR-001
    "nama" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "user" ADD COLUMN "username" TEXT;
ALTER TABLE "user" ADD COLUMN "mitra_id" TEXT REFERENCES "mitra"("id");
CREATE UNIQUE INDEX "user_username_idx" ON "user"("username");
CREATE INDEX "user_mitra_id_idx" ON "user"("mitra_id");
-- +goose Down: kebalikan dari Up, urutan terbalik.
```

Catatan migrasi:

- `username` dibuat nullable dulu di migrasi, karena user lama
  belum punya username. Setelah migrasi, seed/update mengisi
  username Superadmin dari env baru `SUPER_ADMIN_USERNAME`
  (wajib diisi sebelum seed di environment baru; di environment
  lama, isi manual satu kali lalu jadikan NOT NULL di migrasi
  berikutnya kalau mau — jangan memaksakan NOT NULL di 00003
  kalau data lama belum terisi, migrasi akan gagal).
- Unique index di Postgres mengizinkan banyak NULL, jadi user lama
  yang username-nya masih NULL tidak akan bentrok satu sama lain.
- Jangan menambah kolom password/captcha ke tabel ini. Captcha
  tidak disimpan di Postgres (lihat 2.4).
- Setelah ubah query SQL: jalankan `sqlc generate`, JANGAN edit
  file di `internal/platform/postgres/store` manual (aturan repo).

Query sqlc baru yang wajib ada:

```text
queries/mitra.sql:  CreateMitra, GetMitraByID, GetMitraByKode,
                    ListMitra, UpdateMitra, SetMitraActive
queries/auth.sql:   GetUserByUsername, GetUserByUsernameAndMitra
queries/users.sql:  ListUsers + CountUsers ditambah filter
                    (mitra_id IS NULL OR u.mitra_id = $mitra_id)
                    — parameter mitra_id berasal dari Scope, bukan
                    dari query param.
                    GetUser, UpdateUser, bulk/delete: cek mitra
                    di service, bukan hanya di query.
```

## 4. Perubahan API (kontrak)

Semua response tetap memakai envelope repo `{data, meta?, error?, status}`
dan kode error `kernel.E`. Jangan mengubah envelope.

### 4.1 Captcha

```http
GET /api/v1/auth/captcha
-> 200 { "data": { "captchaId": "uuid", "image": "data:image/png;base64,...", "expiresIn": 120 } }
```

Error baru (tambahkan ke `auth/domain`, jangan pakai pesan mentah):

```text
INVALID_CAPTCHA  (401, pesan generik login gagal — jangan dibedakan
                  dari INVALID_CREDENTIALS di response login)
CAPTCHA_EXPIRED  (dipakai internal saja; response login tetap generik)
```

### 4.2 Login Superadmin (diubah, breaking change yang disengaja)

```http
POST /api/v1/auth/login
Body: { "login": "superadmin-username ATAU email", "password": "...",
        "captchaId": "...", "captcha": "AB123" }
```

- Lookup: kalau `login` mengandung `@`, cari by email (normalisasi
  lowercase + trim, seperti `normEmail` sekarang); kalau tidak,
  cari by username.
- Urutan: validasi captcha -> cari user -> cek `CanAuthenticate()`
  -> cek password (argon2id, seperti sekarang) -> cek 2FA role
  -> issue session. Gagal di langkah mana pun = pesan generik.
- Response session ditambah: `user.mitraId` (null untuk Superadmin),
  `user.mitraKode` (null), `user.username`.

### 4.3 Login Mitra (baru)

```http
POST /api/v1/auth/login-mitra
Body: { "mitraKode": "MTR-001", "username": "admin-mitra",
        "password": "...", "captchaId": "...", "captcha": "AB123" }
```

- Urutan: validasi captcha -> cari mitra by kode + `is_active`
  -> cari user by username -> cek `user.mitra_id == mitra.id`
  dan `CanAuthenticate()` -> cek password -> cek 2FA -> session.
- Gagal di langkah mana pun = pesan generik yang sama dengan 4.2.
  Jangan memberi tahu apakah mitra/username/password yang salah.
- Response sama dengan 4.2, tapi `mitraId` dan `mitraKode` terisi.

### 4.4 JWT & Principal

- `kernel.Principal` ditambah field `MitraID string`.
- `crypto.Claims` ditambah `mitra_id`, `SignAccess` menerima
  mitraID (cari semua pemanggil `SignAccess` — saat ini hanya
  `issueSession` — dan perbarui). `ParseAccess` mengisi
  `Principal.MitraID` dari claim.
- `GET /api/v1/auth/me` mengembalikan `mitraId`, `mitraKode`,
  `username` di samping field yang sudah ada. Frontend memakai
  ini untuk redirect dan menyembunyikan menu (backend tetap
  sumber kebenaran, bukan frontend).

### 4.5 Endpoint mitra (baru, Superadmin saja)

```http
GET    /api/v1/mitra            # guard: mitra.view
POST   /api/v1/mitra            # guard: mitra.manage, body: kode_mitra, nama
GET    /api/v1/mitra/:id        # guard: mitra.view
PUT    /api/v1/mitra/:id        # guard: mitra.manage
PATCH  /api/v1/mitra/:id/active # guard: mitra.manage, body: is_active
```

- Menonaktifkan mitra (`is_active=false`) harus langsung
  memblokir login mitra itu (cek di 4.3) dan mencabut refresh
  family semua user mitra itu. Jangan hanya menyembunyikan
  mitra dari list.
- Membuat Mitra Admin: Superadmin membuat mitra dulu, lalu
  membuat user dengan `mitra_id` mitra itu + role MITRA_ADMIN
  lewat endpoint user yang sudah ada (dengan validasi 4.6).
  Jangan buat endpoint khusus "buat mitra + admin sekaligus"
  di tahap ini — dua langkah yang eksplisit lebih mudah diaudit.

### 4.6 Validasi user untuk caller mitra (di service, bukan di handler saja)

Untuk setiap operasi user (get, update, bulk, delete/restore,
export, import, reset password user lain):

1. Ambil target user dari DB.
2. Kalau caller punya `mitra_id` dan `target.mitra_id != caller.mitra_id`
   -> kembalikan 404 (bukan 403, supaya tidak bisa dipakai
   enumerasi user mitra lain).
3. Kalau caller mitra dan operasi mengubah `role_id` -> tolak
   kalau target role adalah role system Super Admin atau role
   yang permission-nya di luar daftar yang diizinkan untuk mitra
   (hanya MITRA_ADMIN / MITRA_STAFF).
4. Kalau caller mitra dan operasi membuat user -> paksa
   `mitra_id = caller.mitra_id`, abaikan `mitra_id` dari body.
   Kalau caller Superadmin -> `mitra_id` dari body harus
   merujuk ke mitra yang ada dan aktif, atau null (untuk user
   global — tapi di tahap ini user global baru hanya Superadmin;
   jangan buat user global lain tanpa persetujuan user).
5. Semua operasi di atas tetap dicatat audit (`kernel.Auditor.Record`
   seperti pola repo sekarang).

## 5. Perubahan frontend (admin app)

- `lib/auth-api.ts` / `lib/auth-context.tsx`: `login()` diubah
  signature-nya menjadi `login(login, password, captchaId, captcha)`,
  ditambah `loginMitra(mitraKode, username, password, captchaId, captcha)`.
  State auth menyimpan `mitraId`, `mitraKode`, `username`.
- Komponen baru `features/auth/components/captcha-field.tsx`:
  memuat `GET /auth/captcha`, menampilkan gambar, tombol refresh,
  dan reload otomatis setiap kali login gagal (captcha lama sudah
  hangus karena sekali pakai). Jangan cache gambar captcha di
  browser (endpoint harus `Cache-Control: no-store`).
- `features/auth/components/login-form.tsx` diubah menjadi
  komponen bersama dengan prop `variant: "admin" | "mitra"`:
  variant mitra menampilkan field `mitraKode` + `username`,
  variant admin menampilkan field `login` (username/email).
  Logika 2FA yang sudah ada (challenge, backup code) dipakai
  ulang untuk kedua variant — jangan duplikasi komponen 2FA.
- Route baru `routes/login-mitra.tsx` (file route TanStack, lalu
  jalankan build admin sekali supaya `routeTree.gen.ts` ter-generate
  ulang — jangan edit file generated manual).
- Redirect setelah login: baca `/auth/me`; kalau `mitraId` terisi
  dan user mencoba membuka route administrasi Superadmin
  (settings, roles, audit, webhooks, apiKeys, mitra) -> redirect
  ke dashboard mitra / tampilkan halaman tidak diizinkan.
  Ini HANYA UX — backend tetap menolak request-nya dengan 403/404.
- Halaman mitra (Superadmin saja): `routes/admin.administration.mitra.tsx`
  + fitur `features/mitra/` (list, create, edit, nonaktifkan).
  Sembunyikan menu ini dari user mitra.
- Halaman user yang sudah ada: tambahkan kolom/filter mitra
  (hanya terlihat untuk Superadmin), dan saat Mitra Admin membuat
  user, field mitra terkunci ke mitranya (tidak bisa dipilih).

## 6. Milestone untuk Kilo Code (SATU milestone per perintah)

Urutan ini disengaja: fondasi dulu, baru login, baru isolasi.
Jangan melompati urutan.

### Milestone 0 — Baseline (wajib lolos sebelum mengubah apa pun)

- Fork repo, clone, `docker compose up -d postgres` (cukup
  Postgres dulu; Redis/Mailpit/MinIO boleh menyusul, dan
  biarkan MinIO/FCM/Midtrans kosong/nonaktif).
- `cd be && cp .env.example .env && make migrate seed`
- `cd be && make lint test`, `cd fe && pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- Login Superadmin bawaan berhasil. Kalau baseline ini gagal,
  BERHENTI dan laporkan — jangan menumpuk perubahan di atas
  baseline yang rusak.

### Milestone 1 — Data mitra + seed role

- Migrasi 00003 (bagian 3), query sqlc mitra + auth, `sqlc generate`.
- Policy: tambah `mitra.manage`, `mitra.view`, `users.view`,
  tambah scope `mitra`. Jalankan `make gen` + `make seed`.
- Seed role MITRA_ADMIN & MITRA_STAFF (system, seperti Super Admin).
- Endpoint CRUD mitra (4.5) + test backend.
- DoD: `make migrate` di DB kosong berhasil, seed tidak error,
  `GET /mitra` ditolak tanpa token dan ditolak untuk role
  non-Superadmin (403).

### Milestone 2 — Principal, JWT, dan login mitra

- `kernel.Principal.MitraID`, claim JWT `mitra_id`, `SignAccess`
  + `ParseAccess`, `/auth/me` mengembalikan mitra + username.
- Kolom `username` terisi untuk Superadmin (env
  `SUPER_ADMIN_USERNAME`), login Superadmin menerima
  username ATAU email (4.2), endpoint `login-mitra` (4.3).
- Login mitra dengan `mitraKode` salah saja = gagal generik.
  Login mitra yang mitranya nonaktif = gagal generik.
- DoD: kedua login berhasil dengan kredensial benar, gagal
  dengan pesan generik untuk setiap kombinasi salah, dan
  token yang diterbitkan membawa `mitra_id` yang benar
  (cek lewat `/auth/me`).

### Milestone 3 — Captcha

- Service + store captcha (Redis / in-memory), endpoint
  `GET /auth/captcha`, validasi di kedua endpoint login
  SEBELUM cek password, sekali pakai, 2 menit.
- Komponen captcha frontend + integrasi ke kedua form login
  (reload otomatis saat gagal).
- DoD: login tanpa captcha ditolak, login dengan captcha
  kedaluwarsa ditolak, login dengan captcha yang sama dua kali
  ditolak pada percobaan kedua, login dengan captcha benar
  berhasil. Tidak ada kode captcha yang muncul di response
  JSON selain gambar, tidak ada di log.

**Status 3 Nov 2026 — SELESAI (backend + frontend).**

- Backend: `auth/domain` (port `CaptchaStore`, `CaptchaImage`,
  `ErrInvalidCaptcha`), `auth/application/captcha.go` (Issue
  pakai 5 karakter `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`,
  `Verify` sekali pakai), `auth/infrastructure/captcha.go`
  (Redis `GETDEL` + fallback in-memory bermutex) dan
  `captcha_image.go` (PNG stdlib + font bitmap, tanpa
  dependensi luar). Verifikasi captcha dipanggil SEBELUM cek
  password di `Login` dan `LoginMitra`. Endpoint publik
  `GET /api/v1/auth/captcha` dengan `Cache-Control: no-store`
  dan throttle terpisah (`CAPTCHA_THROTTLE_LIMIT`, default 30/
  menit/IP). Kode captcha hanya dikirim sebagai gambar; yang
  disimpan di store HANYA hash (HMAC) + expiry; tidak ada log
  kode.
- Frontend: `features/auth/components/captcha-field.tsx`
  (memuat `GET /auth/captcha`, tombol refresh, reload otomatis
  setiap login gagal), diintegrasikan ke `login-form.tsx` yang
  kini mendukung `variant: "admin" | "mitra"`.
- Bukti: `be make lint test` dan `make test-e2e` (Postgres 17
  sementara di port 5436) lolos; test `TestCaptchaLogin`
  (tanpa captcha 400, salah → `INVALID_CAPTCHA`, sekali pakai
  gagal pada percobaan kedua, captcha benar 201),
  `TestCaptchaExpired`, `TestCaptchaLoginMitra` lolos.
  `fe pnpm lint && typecheck && test && build` lolos.
- Catatan: `TestOpenAPICoversRuntimeRoutes` menuntut route
  mitra Milestone 1 didokumentasikan; 5 route mitra +
  `login-mitra` + `captcha` ditambahkan ke
  `internal/platform/docs/openapi.json`. Daftar TRUNCATE test
  e2e ditambah `mitra`.

### Milestone 4 — Isolasi mitra di fitur user

- Scope `mitra` di `Guard.Resolve` (aturan 2.3), filter
  `mitra_id` di List/Count/Get/Create/Update/Bulk/Export/Import
  user, validasi role 4.6, cabut session saat `mitra_id` berubah
  atau mitra dinonaktifkan.
- Frontend: route `/login-mitra`, redirect & menu berdasarkan
  `/auth/me`, halaman mitra untuk Superadmin, kolom mitra
  di halaman user.
- DoD (ini yang paling penting, harus dibuktikan dengan test,
  bukan diklaim): user Mitra A yang memanggil `GET /users`
  hanya melihat user Mitra A; `GET /users/<id-mitra-B>`
  mengembalikan 404; `POST /users` dari Mitra A tidak bisa
  membuat user Mitra B meski body-nya diutak-atik; Mitra Admin
  tidak bisa mengubah role user menjadi Super Admin.

**Status 3 Nov 2026 — SELESAI (backend + frontend).**

- RBAC: `Guard.Resolve` kini menerima `MitraID` principal;
  grant `all`/`team` DITURUNKAN menjadi scope `mitra` untuk
  caller bermitra (defense in depth 2.3).
- Users: `List/Count/Get/Create/Update/Bulk/Export/Import`
  difilter oleh scope (mitra_id). `GET /users` dijaga
  `users.view`, mutasi tetap `users.manage`. Target lintas
  mitra = 404. `POST/PATCH /users` dari mitra memaksa
  `mitra_id = caller` (body diabaikan). Role di luar
  MITRA_ADMIN/MITRA_STAFF ditolak `ROLE_NOT_ALLOWED`.
- Mitra dinonaktifkan (`PATCH /mitra/:id/active` atau
  `is_active=false`) mencabut semua refresh family user
  mitra itu dalam satu transaksi.
- Frontend: form Superadmin mengirim field `login` (utang M2
  ditutup), route `/login-mitra` (variant mitra), menu
  berdasarkan permission `/auth/me`, halaman
  `/admin/administration/mitra` (list/create/edit/nonaktifkan)
  untuk Superadmin, kolom Mitra di halaman user (Superadmin),
  halaman user read-only untuk MITRA_STAFF (`users.view`).
- Bukti: `TestMitraUserIsolation`, `TestMitraDeactivationRevokesSessions`
  (backend e2e) lolos; `be make lint test` + `make test-e2e`
  (race) lolos; `fe pnpm lint && typecheck && test && build`
  lolos. Browser e2e `scripts/e2e.sh` (Playwright) 3/3 lolos:
  login Superadmin lewat `/login` berhasil, login mitra lewat
  `/login-mitra` berhasil, setiap halaman render, menu
  Superadmin tersembunyi untuk mitra.
- Catatan: e2e browser memakai hook non-produksi
  `E2E_CAPTCHA_CODE` (kode captcha tetap) dan seed mitra
  `E2E_MITRA_*`; keduanya ditolak/diabaikan di produksi, agar
  captcha tidak dilonggarkan di runtime normal.

### Milestone 5 — Audit, hardening, dan dokumentasi

- Audit login (sukses/gagal, termasuk gagal captcha — tanpa
  mencatat password atau kode captcha), audit perubahan mitra
  dan perubahan `mitra_id` user, audit percobaan akses lintas
  mitra (404 di 4.6 tetap dicatat sebagai percobaan).
- Perbarui OpenAPI (`internal/platform/docs/openapi.json`) dan
  pastikan test `TestOpenAPICoversRuntimeRoutes` lolos.
  Perbarui `scripts/smoke.sh` / e2e kalau perlu untuk dua login.
- Perbarui README fork: cara seed Superadmin + Mitra Admin
  pertama, cara membuat mitra pertama, dan production checklist
  (ganti `SUPER_ADMIN_PASSWORD` & secret, aktifkan 2FA Super
  Admin setelah login pertama, seperti checklist repo asli).
- Jalankan SELURUH verifikasi repo: `be: make lint test`,
  `make test-e2e` (butuh `postgres_test`), `fe: pnpm lint &&
  pnpm typecheck && pnpm test && pnpm build`, `scripts/e2e.sh`.
- DoD akhir = semua checklist Milestone 0–4 masih lolos +
  seluruh verifikasi di atas lolos.

## 7. Aturan yang TIDAK BOLEH dilanggar Kilo Code

1. Jangan mengubah envelope response, kecuali menambahkan field
   baru yang sudah direncanakan di bagian 4.
2. Jangan menyimpan password plaintext, hash captcha plaintext
   yang bisa dibaca, atau kode captcha di log/database.
3. Jangan menonaktifkan throttle login / 2FA yang sudah ada
   dengan alasan "memudahkan testing". Testing pakai user
   dan throttle yang benar.
4. Jangan mengaktifkan MinIO, FCM, atau Midtrans hanya karena
   kodenya sudah ada — biarkan nonaktif (env kosong) untuk
   adaptasi ini, supaya permukaan serangan tetap kecil.
5. Jangan membuat halaman registrasi publik dan jangan membuat
   endpoint "buat mitra + admin" sekali jalan tanpa audit.
6. Setiap milestone ditutup dengan: perintah verifikasi yang
   dijalankan + hasilnya, dan update file ini / `docs/` di fork
   tentang apa yang sudah selesai dan apa yang belum.
   Jangan mengklaim milestone selesai kalau test-nya belum jalan.

## 8. Pertanyaan yang masih terbuka (jawab sebelum Milestone 4)

1. Apakah Mitra Staff boleh melihat daftar user mitranya
   (rencana ini: YA, lewat `users.view`), atau staff tidak boleh
   membuka halaman user sama sekali? Kalau jawabannya tidak,
   hapus `users.view` dari MITRA_STAFF dan sembunyikan menunya.
2. Apakah satu user boleh pindah mitra di kemudian hari?
   (Rencana ini: boleh, tapi session-nya dicabut dan dicatat audit.)
3. Apakah login Mitra harus tetap bisa pakai email sebagai
   pengganti username? (Rencana ini: TIDAK — login mitra pakai
   username, supaya konsisten dengan spek awal. Login Superadmin
   saja yang menerima username ATAU email.)
