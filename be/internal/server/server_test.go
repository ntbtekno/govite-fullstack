package server_test

// End-to-end tests against a real Postgres. Skipped unless TEST_DATABASE_URL
// is set (make test-e2e sets it to the docker-compose postgres_test).

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	authdomain "govite/internal/auth/domain"
	"govite/internal/kernel"
	"govite/internal/platform/config"
	"govite/internal/platform/crypto"
	"govite/internal/platform/fcm"
	"govite/internal/platform/mail"
	"govite/internal/platform/postgres"
	"govite/internal/platform/postgres/store"
	"govite/internal/platform/storage"
	"govite/internal/policy"
	"govite/internal/server"
)

const password = "Password123!"

type env struct {
	t    *testing.T
	f    *fiber.App
	q    *store.Queries
	pool *pgxpool.Pool
	mail *mail.Memory
	push *fcm.Memory
}

func setup(t *testing.T) *env {
	return setupWith(t, nil, captchaImage{})
}

// setupWith lets a test inject the captcha store (to force expiry/expired
// entries) and image renderer. Nil store uses the real in-memory store.
func setupWith(t *testing.T, capStore authdomain.CaptchaStore, image authdomain.CaptchaImage) *env {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := postgres.Migrate(ctx, pool, "up"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE role, permission, "user", audit_log, app_setting, notification, announcement, webhook_event, api_key, attachment, fcm_device, mitra CASCADE`); err != nil {
		t.Fatal(err)
	}
	m := &mail.Memory{}
	cfg := config.Config{Env: "test", WebURL: "http://web.test", JWTSecret: strings.Repeat("s", 32), RefreshPepper: strings.Repeat("p", 16), ThrottleLimit: 100000, LoginThrottleLimit: 100000, CaptchaThrottleLimit: 100000, LogLevel: "silent", MidtransServerKey: "test-server-key"}
	push := &fcm.Memory{}
	d := server.Deps{Cfg: cfg, Pool: pool, Mail: m, Push: push, CaptchaImage: image, CaptchaStore: capStore}
	if endpoint := os.Getenv("TEST_MINIO_ENDPOINT"); endpoint != "" {
		d.Files, err = storage.New(storage.Config{Endpoint: endpoint, AccessKey: "minio", SecretKey: "minio12345", Bucket: "app-test", PublicEndpoint: "http://" + endpoint})
		if err != nil {
			t.Fatal(err)
		}
		if err := d.Files.EnsureBucket(ctx); err != nil {
			t.Fatal(err)
		}
	}
	f, _ := server.New(d)
	return &env{t, f, store.New(pool), pool, m, push}
}

// seedUser creates a role holding perms (scope all) and an active user in it.
func (e *env) seedUser(email string, perms ...policy.Permission) (userID, roleID string) {
	ctx := context.Background()
	roleID, userID = kernel.NewID(), kernel.NewID()
	must(e.t, e.q.CreateRole(ctx, store.CreateRoleParams{ID: roleID, Name: "role-" + email}))
	for _, p := range perms {
		must(e.t, e.q.InsertRolePermission(ctx, store.InsertRolePermissionParams{ID: kernel.NewID(), RoleID: roleID, Resource: p.Resource, Action: p.Action, Scope: "all"}))
	}
	hash, _ := crypto.HashPassword(password)
	name := "Test"
	must(e.t, e.q.CreateUser(ctx, store.CreateUserParams{ID: userID, Email: email, FullName: &name, RoleID: roleID, PasswordHash: &hash}))
	return userID, roleID
}

// seedMitra creates a mitra row and returns its id.
func (e *env) seedMitra(kode, nama string) string {
	e.t.Helper()
	id := kernel.NewID()
	must(e.t, e.q.CreateMitra(context.Background(), store.CreateMitraParams{ID: id, KodeMitra: kode, Nama: nama, IsActive: true}))
	return id
}

// seedMitraUser creates a role whose grants carry the given scope, a user bound
// to mitraID, and a unique username so the user can log in via /login-mitra.
func (e *env) seedMitraUser(email, username, mitraID string, scope string, perms ...policy.Permission) (userID, roleID string) {
	e.t.Helper()
	ctx := context.Background()
	roleID, userID = kernel.NewID(), kernel.NewID()
	must(e.t, e.q.CreateRole(ctx, store.CreateRoleParams{ID: roleID, Name: "role-" + email}))
	for _, p := range perms {
		must(e.t, e.q.InsertRolePermission(ctx, store.InsertRolePermissionParams{ID: kernel.NewID(), RoleID: roleID, Resource: p.Resource, Action: p.Action, Scope: scope}))
	}
	hash, _ := crypto.HashPassword(password)
	name := "Test"
	must(e.t, e.q.CreateUser(ctx, store.CreateUserParams{ID: userID, Email: email, FullName: &name, RoleID: roleID, PasswordHash: &hash, MitraID: &mitraID}))
	_, err := e.pool.Exec(ctx, `UPDATE "user" SET username = $2 WHERE id = $1`, userID, username)
	must(e.t, err)
	return userID, roleID
}

type res struct {
	Code    int
	Body    map[string]any
	Cookies []*http.Cookie
	Header  http.Header
	Raw     []byte
}

func (r res) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r res) errCode() string {
	m, _ := r.Body["error"].(map[string]any)
	s, _ := m["code"].(string)
	return s
}

// captchaImage is a test double for the renderer: it encodes the plaintext
// code into the data URL so a test can solve the challenge without OCR. Real
// production renders a PNG and never exposes the code.
type captchaImage struct{}

const testImagePrefix = "data:image/png;base64,test:"

func (captchaImage) Render(code string) (string, error) {
	return testImagePrefix + base64.StdEncoding.EncodeToString([]byte(code)), nil
}

// expiredStore stores the last hash but reports every Take as not found,
// simulating a challenge that has aged out. Put returns nil so Issue succeeds.
type expiredStore struct{}

func (expiredStore) Put(context.Context, string, string, time.Duration) error { return nil }
func (expiredStore) Take(context.Context, string) (string, error)             { return "", kernel.ErrNotFound }

// solveCaptcha fetches a challenge and returns the id plus the answer decoded
// from the test image.
func (e *env) solveCaptcha() (id, answer string) {
	e.t.Helper()
	r := e.do("GET", "/auth/captcha", nil)
	if r.Code != 200 {
		e.t.Fatalf("captcha: %d %s", r.Code, r.Raw)
	}
	d := r.data()
	if r.Header.Get("Cache-Control") != "no-store" {
		e.t.Fatalf("captcha must be no-store, got %q", r.Header.Get("Cache-Control"))
	}
	image, _ := d["image"].(string)
	if !strings.HasPrefix(image, testImagePrefix) {
		e.t.Fatalf("unexpected captcha image: %.40q", image)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(image, testImagePrefix))
	must(e.t, err)
	if len(raw) != 5 {
		e.t.Fatalf("captcha code length %d", len(raw))
	}
	return d["captchaId"].(string), string(raw)
}

// loginFields merges a freshly solved captcha into a login body.
func (e *env) loginFields(fields map[string]string) map[string]string {
	e.t.Helper()
	id, answer := e.solveCaptcha()
	body := make(map[string]string, len(fields)+2)
	maps.Copy(body, fields)
	body["captchaId"] = id
	body["captcha"] = answer
	return body
}

type opt func(*http.Request)

func bearer(tok string) opt {
	return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tok) }
}
func cookie(c *http.Cookie) opt { return func(r *http.Request) { r.AddCookie(c) } }

func (e *env) do(method, path string, body any, opts ...opt) res {
	e.t.Helper()
	var rd io.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
	case *multipart.Writer:
		e.t.Fatal("use upload")
	case []byte:
		rd = bytes.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd, ct = bytes.NewReader(raw), "application/json"
	}
	req := httptest.NewRequest(method, "/api/v1"+path, rd)
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	for _, o := range opts {
		o(req)
	}
	return e.send(req)
}

func (e *env) send(req *http.Request) res {
	e.t.Helper()
	resp, err := e.f.Test(req, 10_000)
	if err != nil {
		e.t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	r := res{Code: resp.StatusCode, Cookies: resp.Cookies(), Header: resp.Header, Raw: raw}
	_ = json.Unmarshal(raw, &r.Body)
	return r
}

func (e *env) upload(path, field, filename string, content []byte, tok string) res {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile(field, filename)
	_, _ = fw.Write(content)
	_ = w.Close()
	req := httptest.NewRequest("POST", "/api/v1"+path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+tok)
	return e.send(req)
}

func (e *env) login(email string) (token string, refresh *http.Cookie) {
	e.t.Helper()
	id, answer := e.solveCaptcha()
	r := e.do("POST", "/auth/login", map[string]string{"login": email, "password": password, "captchaId": id, "captcha": answer})
	if r.Code != 201 {
		e.t.Fatalf("login %s: %d %s", email, r.Code, r.Raw)
	}
	for _, c := range r.Cookies {
		if c.Name == "refresh_token" {
			refresh = c
		}
	}
	return r.data()["accessToken"].(string), refresh
}

// loginMitra logs in a mitra user with a solved captcha.
func (e *env) loginMitra(kode, username string) (token string, refresh *http.Cookie) {
	e.t.Helper()
	id, answer := e.solveCaptcha()
	r := e.do("POST", "/auth/login-mitra", map[string]string{"mitraKode": kode, "username": username, "password": password, "captchaId": id, "captcha": answer})
	if r.Code != 201 {
		e.t.Fatalf("login mitra %s/%s: %d %s", kode, username, r.Code, r.Raw)
	}
	for _, c := range r.Cookies {
		if c.Name == "refresh_token" {
			refresh = c
		}
	}
	return r.data()["accessToken"].(string), refresh
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func expect(t *testing.T, r res, code int, errCode ...string) {
	t.Helper()
	if r.Code != code {
		t.Fatalf("want %d got %d: %s", code, r.Code, r.Raw)
	}
	if len(errCode) > 0 && r.errCode() != errCode[0] {
		t.Fatalf("want error %s got %s: %s", errCode[0], r.errCode(), r.Raw)
	}
}

var all = policy.Permissions

func TestHealthEnvelope(t *testing.T) {
	e := setup(t)
	r := e.do("GET", "/health", nil)
	expect(t, r, 200)
	st := r.Body["status"].(map[string]any)
	if st["type"] != "SUCCESS" || st["messageInd"] != "OK" || !strings.HasSuffix(st["timeStamp"].(string), "+07:00") {
		t.Fatalf("bad status %v", st)
	}
	if r.Header.Get("X-Request-Id") == "" {
		t.Fatal("missing x-request-id")
	}
}

func TestRBAC(t *testing.T) {
	e := setup(t)
	expect(t, e.do("GET", "/users", nil), 401)
	e.seedUser("none@test.local")
	e.seedUser("admin@test.local", all...)
	none, _ := e.login("none@test.local")
	admin, _ := e.login("admin@test.local")

	r := e.do("GET", "/users", nil, bearer(none))
	expect(t, r, 403, "PERMISSION_NOT_GRANTED")
	if r.Body["status"].(map[string]any)["messageInd"] != "Permission tidak diberikan" {
		t.Fatal("messageInd")
	}

	r = e.do("GET", "/users", nil, bearer(admin))
	expect(t, r, 200)
	if n := len(r.Body["data"].([]any)); n != 2 {
		t.Fatalf("want 2 users got %d", n)
	}
	meta := r.Body["meta"].(map[string]any)
	if meta["total"].(float64) != 2 || meta["totalPages"].(float64) != 1 || meta["limit"].(float64) != 20 {
		t.Fatalf("meta %v", meta)
	}

	// self-service works without permission
	expect(t, e.do("GET", "/auth/me", nil, bearer(none)), 200)
	expect(t, e.do("GET", "/account/sessions", nil, bearer(none)), 200)
}

// TestMitraUserIsolation proves the Milestone 4 DoD: a Mitra A admin sees only
// Mitra A users, cannot read another mitra's user (404), cannot create into
// another mitra even with an injected mitra_id, and cannot appoint a Super
// Admin.
func TestMitraUserIsolation(t *testing.T) {
	e := setup(t)
	ctx := context.Background()

	mitraA := e.seedMitra("MTR-A", "Mitra A")
	mitraB := e.seedMitra("MTR-B", "Mitra B")

	// The mitra admin role, named MITRA_ADMIN so it is assignable by a mitra.
	adminRole := kernel.NewID()
	must(t, e.q.CreateRole(ctx, store.CreateRoleParams{ID: adminRole, Name: "MITRA_ADMIN"}))
	mitraPerms := []policy.Permission{{Resource: "users", Action: "manage"}, {Resource: "users", Action: "view"}}
	for _, p := range mitraPerms {
		must(t, e.q.InsertRolePermission(ctx, store.InsertRolePermissionParams{ID: kernel.NewID(), RoleID: adminRole, Resource: p.Resource, Action: p.Action, Scope: "mitra"}))
	}
	// A Super Admin role a mitra must never assign.
	superRole := kernel.NewID()
	must(t, e.q.CreateRole(ctx, store.CreateRoleParams{ID: superRole, Name: "Super Admin"}))
	must(t, e.q.InsertRolePermission(ctx, store.InsertRolePermissionParams{ID: kernel.NewID(), RoleID: superRole, Resource: "users", Action: "manage", Scope: "all"}))

	// Mitra A admin (scope mitra via role grant).
	adminAID := kernel.NewID()
	hash, _ := crypto.HashPassword(password)
	nameA := "Admin A"
	must(t, e.q.CreateUser(ctx, store.CreateUserParams{ID: adminAID, Email: "admin-a@test.local", FullName: &nameA, RoleID: adminRole, PasswordHash: &hash, MitraID: &mitraA}))
	_, err := e.pool.Exec(ctx, `UPDATE "user" SET username = 'admin-a' WHERE id = $1`, adminAID)
	must(t, err)

	// A second user in Mitra A, and a user in Mitra B.
	userA2, _ := e.seedMitraUser("a2@test.local", "a2", mitraA, "mitra", mitraPerms...)
	userB, _ := e.seedMitraUser("b1@test.local", "b1", mitraB, "mitra", mitraPerms...)

	tokA, _ := e.loginMitra("MTR-A", "admin-a")

	// 1. GET /users only returns Mitra A users (admin + a2).
	r := e.do("GET", "/users", nil, bearer(tokA))
	expect(t, r, 200)
	rows := r.Body["data"].([]any)
	if len(rows) != 2 {
		t.Fatalf("Mitra A should see 2 users, got %d: %s", len(rows), r.Raw)
	}
	for _, row := range rows {
		m := row.(map[string]any)
		if m["mitraId"] != mitraA {
			t.Fatalf("leaked user from another mitra: %v", m)
		}
	}

	// 2. GET /users/<mitra B user> is a 404, not a leak.
	expect(t, e.do("GET", "/users/"+userB, nil, bearer(tokA)), 404, "USER_NOT_FOUND")

	// 3. POST /users with Mitra B's id injected still creates into Mitra A.
	r = e.do("POST", "/users", map[string]any{"email": "sneaky@test.local", "fullName": "Sneaky", "roleId": adminRole, "mitraId": mitraB}, bearer(tokA))
	expect(t, r, 201)
	if r.data()["mitraId"] != mitraA {
		t.Fatalf("body mitraId was honoured: %s", r.Raw)
	}

	// 4. A mitra cannot appoint a Super Admin.
	expect(t, e.do("PATCH", "/users/"+userA2, map[string]any{"roleId": superRole}, bearer(tokA)), 403, "ROLE_NOT_ALLOWED")
	expect(t, e.do("POST", "/users", map[string]any{"email": "x@test.local", "fullName": "X", "roleId": superRole}, bearer(tokA)), 403, "ROLE_NOT_ALLOWED")

	// 5. A mitra cannot move a user into another mitra via PATCH.
	expect(t, e.do("PATCH", "/users/"+userA2, map[string]any{"mitraId": mitraB}, bearer(tokA)), 200)
	after := e.do("GET", "/users/"+userA2, nil, bearer(tokA))
	expect(t, after, 200)
	if after.data()["mitraId"] != mitraA {
		t.Fatalf("mitra_id was changed by a mitra caller: %s", after.Raw)
	}

	// A Superadmin still sees every mitra.
	superAdminID, _ := e.seedUser("root@test.local", all...)
	superTok, _ := e.login("root@test.local")
	r = e.do("GET", "/users", nil, bearer(superTok))
	expect(t, r, 200)
	if n := len(r.Body["data"].([]any)); n < 4 {
		t.Fatalf("superadmin should see all users, got %d", n)
	}
	_ = superAdminID
}

// TestMitraChangesAreAudited proves Milestone 5 audit for mitra changes: a
// Superadmin creating, renaming and deactivating a mitra leaves one audit row
// each (mitra.create, mitra.update, mitra.set_active).
func TestMitraChangesAreAudited(t *testing.T) {
	e := setup(t)

	e.seedUser("root@test.local", all...)
	superTok, _ := e.login("root@test.local")

	// Create.
	r := e.do("POST", "/mitra", map[string]any{"kodeMitra": "MTR-AUD", "nama": "Mitra Audit"}, bearer(superTok))
	expect(t, r, 201)
	id := r.data()["id"].(string)

	// Rename.
	expect(t, e.do("PUT", "/mitra/"+id, map[string]any{"nama": "Mitra Audit Baru"}, bearer(superTok)), 200)

	// Deactivate.
	expect(t, e.do("PATCH", "/mitra/"+id+"/active", map[string]any{"isActive": false}, bearer(superTok)), 200)

	for action, entityID := range map[string]string{
		"mitra.create":     id,
		"mitra.update":     id,
		"mitra.set_active": id,
	} {
		rows := e.do("GET", "/audit?action="+action, nil, bearer(superTok))
		expect(t, rows, 200)
		data := rows.Body["data"].([]any)
		if len(data) != 1 {
			t.Fatalf("expected 1 %s audit row, got %d: %s", action, len(data), rows.Raw)
		}
		row := data[0].(map[string]any)
		if row["entityType"] != "mitra" || row["entityId"] != entityID {
			t.Fatalf("%s audit row must target the mitra: %s", action, rows.Raw)
		}
	}
}

// its users out: their refresh token stops working immediately.
// TestLoginAuditRecordsAttemptsWithoutSecrets proves Milestone 5 audit: a
// failed and a successful login are both recorded, a wrong captcha is recorded,
// and the audit rows never contain the password or the captcha answer.
func TestLoginAuditRecordsAttemptsWithoutSecrets(t *testing.T) {
	e := setup(t)
	userID, _ := e.seedUser("u@test.local", all...)

	// A failed attempt with a wrong password (valid captcha) is recorded.
	id, answer := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": "wrong-password-xyz", "captchaId": id, "captcha": answer}), 401, "INVALID_CREDENTIALS")

	// A failed attempt with a wrong captcha is recorded too.
	id2, _ := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id2, "captcha": "ZZZZZ"}), 401, "INVALID_CAPTCHA")

	// A successful login is recorded.
	_, _ = e.login("u@test.local")

	adminTok, _ := e.login("u@test.local")

	fail := e.do("GET", "/audit?action=auth.login.failure", nil, bearer(adminTok))
	expect(t, fail, 200)
	if n := len(fail.Body["data"].([]any)); n < 2 {
		t.Fatalf("expected at least 2 login failures recorded, got %d: %s", n, fail.Raw)
	}
	ok := e.do("GET", "/audit?action=auth.login.success", nil, bearer(adminTok))
	expect(t, ok, 200)
	if n := len(ok.Body["data"].([]any)); n < 1 {
		t.Fatalf("expected a login success recorded, got %d: %s", n, ok.Raw)
	}

	// No audit row may leak the password or the captcha answer.
	for _, path := range []string{"/audit?action=auth.login.failure", "/audit?action=auth.login.success"} {
		raw := string(e.do("GET", path, nil, bearer(adminTok)).Raw)
		if strings.Contains(raw, password) || strings.Contains(raw, "wrong-password-xyz") || strings.Contains(raw, "ZZZZZ") {
			t.Fatalf("audit leaked a secret: %s", raw)
		}
	}
	_ = userID
}

// TestCrossMitraAccessIsAudited proves Milestone 5: a mitra user reaching for
// another mitra's user still gets 404, and the refusal is recorded as an audit
// entry so an operator can see the attempt.
func TestCrossMitraAccessIsAudited(t *testing.T) {
	e := setup(t)
	ctx := context.Background()

	mitraA := e.seedMitra("MTR-XA", "Mitra X A")
	mitraB := e.seedMitra("MTR-XB", "Mitra X B")

	adminRole := kernel.NewID()
	must(t, e.q.CreateRole(ctx, store.CreateRoleParams{ID: adminRole, Name: "MITRA_ADMIN"}))
	perms := []policy.Permission{{Resource: "users", Action: "manage"}, {Resource: "users", Action: "view"}}
	for _, p := range perms {
		must(t, e.q.InsertRolePermission(ctx, store.InsertRolePermissionParams{ID: kernel.NewID(), RoleID: adminRole, Resource: p.Resource, Action: p.Action, Scope: "mitra"}))
	}
	hash, _ := crypto.HashPassword(password)
	name := "Admin X"
	must(t, e.q.CreateUser(ctx, store.CreateUserParams{ID: kernel.NewID(), Email: "xadmin@test.local", FullName: &name, RoleID: adminRole, PasswordHash: &hash, MitraID: &mitraA}))
	_, err := e.pool.Exec(ctx, `UPDATE "user" SET username = 'x-admin' WHERE email = 'xadmin@test.local'`)
	must(t, err)

	userB, _ := e.seedMitraUser("xb@test.local", "xb-user", mitraB, "mitra", perms...)

	tokA, _ := e.loginMitra("MTR-XA", "x-admin")

	// The cross-mitra read is a 404 (no enumeration)...
	expect(t, e.do("GET", "/users/"+userB, nil, bearer(tokA)), 404, "USER_NOT_FOUND")

	// ...and a Superadmin sees the recorded attempt.
	e.seedUser("root@test.local", all...)
	superTok, _ := e.login("root@test.local")
	r := e.do("GET", "/audit?action=user.get_cross_mitra", nil, bearer(superTok))
	expect(t, r, 200)
	rows := r.Body["data"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 cross-mitra audit row, got %d: %s", len(rows), r.Raw)
	}
	row := rows[0].(map[string]any)
	if row["entityId"] != userB {
		t.Fatalf("audit should point at the target user: %s", r.Raw)
	}
}

// TestMitraDeactivationRevokesSessions proves that switching a mitra off signs
// its users out: their refresh token stops working immediately.
func TestMitraDeactivationRevokesSessions(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	mitraID := e.seedMitra("MTR-OFF", "Mitra Off")

	// Superadmin to call the mitra endpoint.
	e.seedUser("root@test.local", all...)
	superTok, _ := e.login("root@test.local")

	// A mitra user with an active session.
	e.seedMitraUser("m1@test.local", "m1", mitraID, "mitra", policy.Permission{Resource: "users", Action: "view"})
	_, refresh := e.loginMitra("MTR-OFF", "m1")
	if refresh == nil {
		t.Fatal("no refresh cookie")
	}

	// Deactivate the mitra, then the stored refresh token is revoked.
	expect(t, e.do("PATCH", "/mitra/"+mitraID+"/active", map[string]any{"isActive": false}, bearer(superTok)), 200)
	expect(t, e.do("POST", "/auth/refresh", nil, cookie(refresh)), 401, "INVALID_REFRESH_TOKEN")

	// And the mitra can no longer log in at all (generic failure).
	id, answer := e.solveCaptcha()
	r := e.do("POST", "/auth/login-mitra", map[string]string{"mitraKode": "MTR-OFF", "username": "m1", "password": password, "captchaId": id, "captcha": answer})
	expect(t, r, 401)
	_ = ctx
}

// TestMovingUserBetweenMitrasRevokesOldRefresh proves that when a Superadmin
// moves a user from one mitra to another, the user's existing refresh session
// is revoked: the old refresh token is rejected right after the move, so the
// stale JWT (which still carries the old mitra_id) cannot be renewed.
func TestMovingUserBetweenMitrasRevokesOldRefresh(t *testing.T) {
	e := setup(t)
	ctx := context.Background()

	mitraA := e.seedMitra("MTR-MV-A", "Mitra Move A")
	mitraB := e.seedMitra("MTR-MV-B", "Mitra Move B")

	// Superadmin to perform the move.
	e.seedUser("root@test.local", all...)
	superTok, _ := e.login("root@test.local")

	// A mitra user in Mitra A with an active session.
	userID, _ := e.seedMitraUser("mv@test.local", "mv-user", mitraA, "mitra", policy.Permission{Resource: "users", Action: "view"})
	_, refresh := e.loginMitra("MTR-MV-A", "mv-user")
	if refresh == nil {
		t.Fatal("no refresh cookie")
	}

	// Move the user to Mitra B as Superadmin.
	expect(t, e.do("PATCH", "/users/"+userID, map[string]any{"mitraId": mitraB}, bearer(superTok)), 200)
	after := e.do("GET", "/users/"+userID, nil, bearer(superTok))
	expect(t, after, 200)
	if after.data()["mitraId"] != mitraB {
		t.Fatalf("user was not moved to Mitra B: %s", after.Raw)
	}

	// The pre-move refresh token is now dead; the family was revoked.
	expect(t, e.do("POST", "/auth/refresh", nil, cookie(refresh)), 401, "INVALID_REFRESH_TOKEN")

	// The user can still log in to its new mitra.
	_, fresh := e.loginMitra("MTR-MV-B", "mv-user")
	if fresh == nil {
		t.Fatal("no refresh cookie after re-login to new mitra")
	}
	_ = ctx
}

func TestRefreshRotationAndReuse(t *testing.T) {
	e := setup(t)
	e.seedUser("u@test.local")
	_, c1 := e.login("u@test.local")
	if c1 == nil || !c1.HttpOnly || c1.Path != "/api/v1/auth" {
		t.Fatalf("bad cookie %+v", c1)
	}
	r := e.do("POST", "/auth/refresh", nil, cookie(c1))
	expect(t, r, 200)
	if r.data()["accessToken"] == "" {
		t.Fatal("no token")
	}
	var c2 *http.Cookie
	for _, c := range r.Cookies {
		if c.Name == "refresh_token" {
			c2 = c
		}
	}
	// replaying the old token revokes the family, killing the new one too
	expect(t, e.do("POST", "/auth/refresh", nil, cookie(c1)), 401, "REFRESH_TOKEN_REUSE_DETECTED")
	expect(t, e.do("POST", "/auth/refresh", nil, cookie(c2)), 401, "INVALID_REFRESH_TOKEN")
	expect(t, e.do("POST", "/auth/refresh", nil), 401, "MISSING_REFRESH_TOKEN")

	// mobile clients get the token in the body
	id, answer := e.solveCaptcha()
	body := `{"login":"u@test.local","password":"` + password + `","captchaId":"` + id + `","captcha":"` + answer + `"}`
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Client", "mobile")
	m := e.send(req)
	expect(t, m, 201)
	if m.data()["refreshToken"] == nil || len(m.Cookies) != 0 {
		t.Fatal("mobile login should return body token, no cookie")
	}
}

func TestLoginFailures(t *testing.T) {
	e := setup(t)
	e.seedUser("u@test.local")
	// Without a captcha id/answer the request is rejected by validation.
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password}), 400, "VALIDATION_ERROR")
	// Wrong password with a valid captcha is still the generic credential error.
	id, answer := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": "wrong-password", "captchaId": id, "captcha": answer}), 401, "INVALID_CREDENTIALS")
	id, answer = e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "ghost@test.local", "password": password, "captchaId": id, "captcha": answer}), 401, "INVALID_CREDENTIALS")
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "bad"}), 400, "VALIDATION_ERROR")
}

// TestCaptchaLogin proves the Milestone 3 DoD on both login endpoints:
// missing captcha rejected, expired rejected, single use enforced, correct
// captcha accepted. A wrong answer never leaks which check failed.
func TestCaptchaLogin(t *testing.T) {
	e := setup(t)
	e.seedUser("u@test.local")

	// 1. Login without any captcha is rejected.
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password}), 400, "VALIDATION_ERROR")
	expect(t, e.do("POST", "/auth/login-mitra", map[string]string{"mitraKode": "MTR-001", "username": "u", "password": password}), 400, "VALIDATION_ERROR")

	// 2. A wrong answer is the generic invalid-captcha error.
	id, _ := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id, "captcha": "ZZZZZ"}), 401, "INVALID_CAPTCHA")

	// 3. Single use: a correct captcha works once, then the same id fails.
	id, answer := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id, "captcha": answer}), 201)
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id, "captcha": answer}), 401, "INVALID_CAPTCHA")

	// 4. Case-insensitive answer still succeeds.
	id, answer = e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id, "captcha": strings.ToLower(answer)}), 201)
}

// TestCaptchaExpired proves an aged-out challenge is refused even with the
// right answer.
func TestCaptchaExpired(t *testing.T) {
	e := setupWith(t, expiredStore{}, captchaImage{})
	e.seedUser("u@test.local")

	id, answer := e.solveCaptcha()
	expect(t, e.do("POST", "/auth/login", map[string]string{"login": "u@test.local", "password": password, "captchaId": id, "captcha": answer}), 401, "INVALID_CAPTCHA")
}

// TestCaptchaLoginMitra proves the mitra login also requires a captcha and
// accepts the correct one.
func TestCaptchaLoginMitra(t *testing.T) {
	e := setup(t)
	e.seedUser("mitra-user@test.local")
	// A mitra row plus a user bound to it.
	mitraID := kernel.NewID()
	must(t, e.q.CreateMitra(context.Background(), store.CreateMitraParams{ID: mitraID, KodeMitra: "MTR-CAP", Nama: "Mitra Captcha", IsActive: true}))
	username := "capstaff"
	_, err := e.pool.Exec(context.Background(), `UPDATE "user" SET mitra_id = $1, username = $2 WHERE email = $3`, mitraID, username, "mitra-user@test.local")
	must(t, err)

	// No captcha rejected.
	expect(t, e.do("POST", "/auth/login-mitra", map[string]string{"mitraKode": "MTR-CAP", "username": username, "password": password}), 400, "VALIDATION_ERROR")

	// Correct captcha succeeds and the token carries mitra_id.
	id, answer := e.solveCaptcha()
	r := e.do("POST", "/auth/login-mitra", map[string]string{"mitraKode": "MTR-CAP", "username": username, "password": password, "captchaId": id, "captcha": answer})
	expect(t, r, 201)
	tok := r.data()["accessToken"].(string)
	me := e.do("GET", "/auth/me", nil, bearer(tok))
	expect(t, me, 200)
	if me.data()["mitraId"] != mitraID || me.data()["mitraKode"] != "MTR-CAP" {
		t.Fatalf("mitra token wrong: %s", me.Raw)
	}
}

func TestRoleRequiredTwoFactorAndBackupCodes(t *testing.T) {
	e := setup(t)
	_, roleID := e.seedUser("totp@test.local", policy.Permission{Resource: "users", Action: "manage"})
	_, err := e.pool.Exec(context.Background(), `UPDATE role SET require_two_factor = true WHERE id = $1`, roleID)
	must(t, err)

	r := e.do("POST", "/auth/login", e.loginFields(map[string]string{"login": "totp@test.local", "password": password}))
	expect(t, r, 201)
	d := r.data()
	if d["requiresTwoFactor"] != true || d["setupRequired"] != true || len(r.Cookies) != 0 {
		t.Fatalf("expected challenge: %s", r.Raw)
	}
	code, _ := totp.GenerateCode(d["manualKey"].(string), time.Now())
	r = e.do("POST", "/auth/2fa/verify", map[string]string{"challengeToken": d["challengeToken"].(string), "code": code})
	expect(t, r, 201)
	codes := r.data()["backupCodes"].([]any)
	if len(codes) != 10 || r.data()["accessToken"] == nil {
		t.Fatalf("verify: %s", r.Raw)
	}

	// second login: challenge without setup, finish with a backup code (single use)
	r = e.do("POST", "/auth/login", e.loginFields(map[string]string{"login": "totp@test.local", "password": password}))
	ch := r.data()["challengeToken"].(string)
	if r.data()["setupRequired"] != false || r.data()["manualKey"] != nil {
		t.Fatalf("no setup expected: %s", r.Raw)
	}
	r = e.do("POST", "/auth/2fa/verify-backup", map[string]string{"challengeToken": ch, "backupCode": codes[0].(string)})
	expect(t, r, 201)
	tok := r.data()["accessToken"].(string)

	r = e.do("POST", "/auth/login", e.loginFields(map[string]string{"login": "totp@test.local", "password": password}))
	expect(t, e.do("POST", "/auth/2fa/verify-backup", map[string]string{"challengeToken": r.data()["challengeToken"].(string), "backupCode": codes[0].(string)}), 401, "INVALID_TWO_FACTOR_CODE")

	st := e.do("GET", "/account/two-factor", nil, bearer(tok))
	expect(t, st, 200)
	if st.data()["required"] != true || st.data()["backupCodesRemaining"].(float64) != 9 {
		t.Fatalf("status: %s", st.Raw)
	}
	expect(t, e.do("POST", "/account/two-factor/disable", map[string]string{"currentPassword": password}, bearer(tok)), 403, "TWO_FACTOR_REQUIRED")
}

func TestInviteAndPasswordReset(t *testing.T) {
	e := setup(t)
	_, roleID := e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")

	r := e.do("POST", "/users", map[string]string{"email": "New@Test.local", "fullName": "New", "roleId": roleID}, bearer(admin))
	expect(t, r, 201)
	if r.data()["invited"] != true || r.data()["email"] != "new@test.local" {
		t.Fatalf("create: %s", r.Raw)
	}
	expect(t, e.do("POST", "/users", map[string]string{"email": "new@test.local", "fullName": "Dup", "roleId": roleID}, bearer(admin)), 409, "EMAIL_TAKEN")

	msg, _ := e.mail.Last()
	tok := tokenFrom(t, msg.Text)
	expect(t, e.do("POST", "/auth/accept-invite", map[string]string{"token": tok, "fullName": "Neo", "password": password}), 204)
	expect(t, e.do("POST", "/auth/accept-invite", map[string]string{"token": tok, "fullName": "Neo", "password": password}), 400, "INVALID_TOKEN")
	e.login("new@test.local")

	n := e.mail.Count()
	expect(t, e.do("POST", "/auth/forgot-password", map[string]string{"email": "new@test.local"}), 204)
	msg = e.nextMail(n)
	tok = tokenFrom(t, msg.Text)
	expect(t, e.do("POST", "/auth/reset-password", map[string]string{"channel": "web", "token": tok, "newPassword": "NewPassword123!"}), 204)
	expect(t, e.do("POST", "/auth/login", e.loginFields(map[string]string{"login": "new@test.local", "password": "NewPassword123!"})), 201)

	// mobile OTP
	n = e.mail.Count()
	expect(t, e.do("POST", "/auth/forgot-password", map[string]string{"email": "new@test.local", "channel": "mobile"}), 204)
	msg = e.nextMail(n)
	if len(msg.Content.Code) != 6 {
		t.Fatalf("otp mail: %+v", msg)
	}
	expect(t, e.do("POST", "/auth/reset-password", map[string]string{"channel": "mobile", "email": "new@test.local", "otp": msg.Content.Code, "newPassword": password}), 204)
	e.login("new@test.local")
}

// nextMail waits for a message beyond the first n; reset mail is sent async.
func (e *env) nextMail(n int) mail.Message {
	e.t.Helper()
	for range 100 {
		if m, ok := e.mail.Last(); ok && e.mail.Count() > n {
			return m
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.t.Fatal("no mail sent")
	return mail.Message{}
}

func tokenFrom(t *testing.T, text string) string {
	t.Helper()
	_, after, ok := strings.Cut(text, "?token=")
	if !ok {
		t.Fatalf("no token in %q", text)
	}
	tok, _, _ := strings.Cut(after, "\n")
	return strings.TrimSpace(tok)
}

func TestUserInvariantsAndAudit(t *testing.T) {
	e := setup(t)
	adminID, roleID := e.seedUser("admin@test.local", all...)
	otherID, _ := e.seedUser("other@test.local")
	admin, _ := e.login("admin@test.local")
	_, otherRefresh := e.login("other@test.local")

	f := false
	expect(t, e.do("PATCH", "/users/"+adminID, map[string]any{"isActive": &f}, bearer(admin)), 403, "CANNOT_MODIFY_SELF")
	expect(t, e.do("DELETE", "/users/"+adminID, nil, bearer(admin)), 403, "CANNOT_MODIFY_SELF")

	r := e.do("DELETE", "/users/"+otherID, nil, bearer(admin))
	expect(t, r, 200)
	if r.data()["deletedAt"] == nil || r.data()["isActive"] != false {
		t.Fatalf("delete: %s", r.Raw)
	}
	expect(t, e.do("POST", "/auth/refresh", nil, cookie(otherRefresh)), 401, "INVALID_REFRESH_TOKEN")
	if n := len(e.do("GET", "/users", nil, bearer(admin)).Body["data"].([]any)); n != 1 {
		t.Fatalf("deleted users must be hidden, got %d", n)
	}
	if n := len(e.do("GET", "/users?deleted=true", nil, bearer(admin)).Body["data"].([]any)); n != 1 {
		t.Fatalf("deleted list got %d", n)
	}
	expect(t, e.do("POST", "/users/"+otherID+"/restore", nil, bearer(admin)), 201)

	r = e.do("POST", "/users/bulk", map[string]any{"ids": []string{otherID, adminID}, "action": "deactivate"}, bearer(admin))
	expect(t, r, 200)
	if len(r.data()["succeeded"].([]any)) != 1 || len(r.data()["failed"].([]any)) != 1 {
		t.Fatalf("bulk: %s", r.Raw)
	}

	// last holder of users.manage cannot lose it
	expect(t, e.do("PUT", "/roles/"+roleID+"/permissions", map[string]any{"permissions": []any{}}, bearer(admin)), 409, "LAST_PERMISSION_HOLDER")

	r = e.do("GET", "/audit?action=user.delete", nil, bearer(admin))
	expect(t, r, 200)
	rows := r.Body["data"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["entityId"] != otherID {
		t.Fatalf("audit: %s", r.Raw)
	}
}

func TestExportImport(t *testing.T) {
	e := setup(t)
	e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")

	r := e.do("GET", "/users/export?format=csv", nil, bearer(admin))
	expect(t, r, 200)
	if !strings.Contains(string(r.Raw), "admin@test.local") || !strings.HasPrefix(r.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("csv: %s", r.Raw)
	}
	r = e.do("GET", "/users/export?format=xlsx", nil, bearer(admin))
	expect(t, r, 200)
	if !bytes.HasPrefix(r.Raw, []byte("PK")) {
		t.Fatal("xlsx is not a zip")
	}

	csv := []byte("email,fullName,role\nok@test.local,Ok,role-admin@test.local\nbad,Bad,nope\n")
	r = e.upload("/users/import/preview", "file", "u.csv", csv, admin)
	expect(t, r, 200)
	rows := r.Body["data"].([]any)
	if len(rows) != 2 || len(rows[0].(map[string]any)["errors"].([]any)) != 0 || len(rows[1].(map[string]any)["errors"].([]any)) == 0 {
		t.Fatalf("preview: %s", r.Raw)
	}
	r = e.upload("/users/import", "file", "u.csv", csv, admin)
	expect(t, r, 201)
	if r.data()["created"].(float64) != 1 {
		t.Fatalf("import: %s", r.Raw)
	}
}

func TestSettingsAndRoles(t *testing.T) {
	e := setup(t)
	e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")

	r := e.do("GET", "/settings/public", nil)
	expect(t, r, 200)
	if r.data()["appName"] != "Rekanara" {
		t.Fatalf("defaults: %s", r.Raw)
	}
	cur := e.do("GET", "/settings", nil, bearer(admin)).data()
	cur["appName"] = "Govite"
	cur["supportEmail"] = "  "
	expect(t, e.do("PUT", "/settings", cur, bearer(admin)), 200)
	if e.do("GET", "/settings/public", nil).data()["appName"] != "Govite" {
		t.Fatal("settings not saved")
	}

	r = e.do("POST", "/roles", map[string]any{"name": "Editor"}, bearer(admin))
	expect(t, r, 201)
	id := r.data()["id"].(string)
	expect(t, e.do("POST", "/roles", map[string]any{"name": "Editor"}, bearer(admin)), 409, "ROLE_NAME_TAKEN")
	r = e.do("PUT", "/roles/"+id+"/permissions", map[string]any{"permissions": []map[string]string{{"resource": "audit", "action": "view", "scope": "all"}}}, bearer(admin))
	expect(t, r, 200)
	expect(t, e.do("PUT", "/roles/"+id+"/permissions", map[string]any{"permissions": []map[string]string{{"resource": "audit", "action": "nope", "scope": "all"}}}, bearer(admin)), 400, "VALIDATION_ERROR")
	expect(t, e.do("DELETE", "/roles/"+id, nil, bearer(admin)), 200)
	expect(t, e.do("GET", "/permissions", nil, bearer(admin)), 200)
}

func TestAnnouncementsNotificationsAndAPIKeys(t *testing.T) {
	e := setup(t)
	e.seedUser("admin@test.local", all...)
	e.seedUser("reader@test.local", policy.Permission{Resource: "announcements", Action: "view"})
	admin, _ := e.login("admin@test.local")
	reader, _ := e.login("reader@test.local")

	// Draft is visible to managers but hidden from readers.
	r := e.do("POST", "/announcements", map[string]any{"title": "Draft", "content": "Not yet", "status": "draft"}, bearer(admin))
	expect(t, r, 201)
	draftID := r.data()["id"].(string)
	expect(t, e.do("GET", "/announcements/"+draftID, nil, bearer(reader)), 404, "ANNOUNCEMENT_NOT_FOUND")
	expect(t, e.do("GET", "/announcements/manage/"+draftID, nil, bearer(admin)), 200)

	// Publishing writes one notification for every active user, once.
	r = e.do("PATCH", "/announcements/"+draftID, map[string]string{"status": "published"}, bearer(admin))
	expect(t, r, 200)
	expect(t, e.do("PATCH", "/announcements/"+draftID, map[string]string{"title": "Edited"}, bearer(admin)), 200)
	inbox := e.do("GET", "/notifications", nil, bearer(reader))
	expect(t, inbox, 200)
	if len(inbox.Body["data"].([]any)) != 1 || inbox.Body["meta"].(map[string]any)["unreadCount"].(float64) != 1 {
		t.Fatalf("inbox: %s", inbox.Raw)
	}
	id := inbox.Body["data"].([]any)[0].(map[string]any)["id"].(string)
	expect(t, e.do("POST", "/notifications/"+id+"/read", nil, bearer(reader)), 201)
	expect(t, e.do("POST", "/notifications/read-all", nil, bearer(reader)), 204)

	// API key plaintext is shown once; list only carries its prefix/hash metadata.
	r = e.do("POST", "/api-keys", map[string]string{"name": "CI"}, bearer(admin))
	expect(t, r, 201)
	keyID, plain := r.data()["id"].(string), r.data()["key"].(string)
	if !strings.HasPrefix(plain, "rk_") || len(plain) < 40 {
		t.Fatalf("api key: %s", r.Raw)
	}
	r = e.do("GET", "/api-keys", nil, bearer(admin))
	expect(t, r, 200)
	if strings.Contains(string(r.Raw), plain) {
		t.Fatal("plaintext API key leaked in list")
	}
	expect(t, e.do("PATCH", "/api-keys/"+keyID, map[string]bool{"isActive": false}, bearer(admin)), 200)
	expect(t, e.do("DELETE", "/api-keys/"+keyID, nil, bearer(admin)), 204)
}

func TestMidtransWebhook(t *testing.T) {
	e := setup(t)
	e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")
	p := map[string]string{"order_id": "o1", "status_code": "200", "gross_amount": "10000.00", "transaction_status": "settlement", "transaction_id": "t1"}
	sum := sha512.Sum512([]byte(p["order_id"] + p["status_code"] + p["gross_amount"] + "test-server-key"))
	p["signature_key"] = hex.EncodeToString(sum[:])

	r := e.do("POST", "/webhooks/midtrans", p)
	expect(t, r, 200)
	if r.data()["duplicate"] != false {
		t.Fatalf("first: %s", r.Raw)
	}
	r = e.do("POST", "/webhooks/midtrans", p)
	expect(t, r, 200)
	if r.data()["duplicate"] != true {
		t.Fatalf("duplicate: %s", r.Raw)
	}
	bad := maps.Clone(p)
	bad["signature_key"] = strings.Repeat("a", 128)
	expect(t, e.do("POST", "/webhooks/midtrans", bad), 401, "INVALID_WEBHOOK_SIGNATURE")
	r = e.do("GET", "/webhooks/events", nil, bearer(admin))
	expect(t, r, 200)
	if len(r.Body["data"].([]any)) != 1 || r.Body["data"].([]any)[0].(map[string]any)["status"] != "processed" {
		t.Fatalf("events: %s", r.Raw)
	}
}

func TestStorageAvatarAttachmentsAndBranding(t *testing.T) {
	e := setup(t)
	if e.f == nil || os.Getenv("TEST_MINIO_ENDPOINT") == "" {
		t.Skip("TEST_MINIO_ENDPOINT not set")
	}
	e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0}

	r := e.upload("/account/avatar", "file", "avatar.png", png, admin)
	expect(t, r, 201)
	if !strings.Contains(r.data()["avatarUrl"].(string), "/avatars/public/") {
		t.Fatalf("avatar: %s", r.Raw)
	}
	expect(t, e.upload("/account/avatar", "file", "x.svg", []byte("<svg/>"), admin), 400, "INVALID_AVATAR")

	r = e.upload("/attachments", "file", "note.txt", []byte("private"), admin)
	expect(t, r, 201)
	attID := r.data()["id"].(string)
	if !strings.Contains(r.data()["url"].(string), "X-Amz-Signature") {
		t.Fatalf("attachment URL is not signed: %s", r.Raw)
	}
	expect(t, e.do("DELETE", "/attachments/"+attID, nil, bearer(admin)), 204)

	// Settings and announcement images use magic-byte detection and public URLs.
	r = e.upload("/settings/image", "image", "logo.png", png, admin)
	expect(t, r, 201)
	if !strings.Contains(r.data()["url"].(string), "/branding/public/") {
		t.Fatalf("branding: %s", r.Raw)
	}
	r = e.upload("/announcements/image", "image", "cover.png", png, admin)
	expect(t, r, 201)
	if !strings.Contains(r.data()["url"].(string), "/announcements/public/") {
		t.Fatalf("announcement image: %s", r.Raw)
	}
}

func TestMetricsAndCleanup(t *testing.T) {
	e := setup(t)
	e.seedUser("admin@test.local", all...)
	admin, _ := e.login("admin@test.local")

	r := e.do("GET", "/metrics", nil)
	expect(t, r, 200)
	if !strings.Contains(string(r.Raw), "go_goroutines") || !strings.Contains(r.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("metrics: %s", r.Raw)
	}
	// Expired/used token rows are removed by the manual cleanup endpoint.
	_, err := e.pool.Exec(context.Background(), `INSERT INTO user_token(id,user_id,purpose,channel,token_hash,expires_at,used_at) SELECT $1,id,'x','web',$2,now()-interval '100 days',now() FROM "user" LIMIT 1`, kernel.NewID(), crypto.RandomToken(32))
	must(t, err)
	r = e.do("POST", "/system/maintenance/cleanup", nil, bearer(admin))
	expect(t, r, 201)
	if r.data()["ran"] != true || r.data()["deleted"].(map[string]any)["userTokens"].(float64) < 1 {
		t.Fatalf("cleanup: %s", r.Raw)
	}
}

func TestOpenAPICoversRuntimeRoutes(t *testing.T) {
	e := setup(t)
	r := e.doAbsolute("GET", "/api/docs-json", nil)
	expect(t, r, 200)
	var spec struct {
		OpenAPI string                                `json:"openapi"`
		Paths   map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(r.Raw, &spec); err != nil || spec.OpenAPI != "3.0.0" {
		t.Fatalf("bad OpenAPI document: %v", err)
	}
	if y := e.doAbsolute("GET", "/api/docs-yaml", nil); y.Code != 200 || bytes.HasPrefix(y.Raw, []byte("{")) || !strings.Contains(string(y.Raw), "\nopenapi: 3.0.0\n") {
		t.Fatalf("docs-yaml is not YAML: %.80q", y.Raw)
	}

	documented := map[string]bool{}
	for path, methods := range spec.Paths {
		for method := range methods {
			switch method {
			case "get", "post", "put", "patch", "delete":
				documented[strings.ToUpper(method)+" "+path] = true
			}
		}
	}
	for _, methodRoutes := range e.f.Stack() {
		for _, route := range methodRoutes {
			if route.Method == "HEAD" || route.Path == "/" || route.Path == "/*" || route.Path == "/api/v1" || strings.HasPrefix(route.Path, "/api/docs") {
				continue
			}
			path := regexp.MustCompile(`:([A-Za-z0-9_]+)`).ReplaceAllString(route.Path, `{$1}`)
			key := route.Method + " " + path
			if !documented[key] {
				t.Errorf("runtime route missing from OpenAPI: %s", key)
			}
			delete(documented, key)
		}
	}
	for route := range documented {
		t.Errorf("OpenAPI route missing at runtime: %s", route)
	}

	ui := e.doAbsolute("GET", "/api/docs/", nil)
	for range 5 {
		if ui.Code != 307 && ui.Code != 308 {
			break
		}
		ui = e.doAbsolute("GET", ui.Header.Get("Location"), nil)
	}
	expect(t, ui, 200)
	if !bytes.Contains(ui.Raw, []byte("Govite Fullstack API")) {
		t.Fatal("Swagger UI title missing")
	}
}

func (e *env) doAbsolute(method, path string, body io.Reader) res {
	req := httptest.NewRequest(method, path, body)
	return e.send(req)
}
