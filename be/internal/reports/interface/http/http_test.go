package http_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"govite/internal/kernel"
	"govite/internal/platform/httpx"
	rbacapp "govite/internal/rbac/application"
	rbacdomain "govite/internal/rbac/domain"
	rbachttp "govite/internal/rbac/interface/http"
	"govite/internal/reports/application"
	"govite/internal/reports/domain"
	reportshttp "govite/internal/reports/interface/http"
)

type fakeGrants struct{ grants []rbacdomain.Grant }

func (f fakeGrants) Grants(context.Context, string) ([]rbacdomain.Grant, error) {
	return f.grants, nil
}

type fakeMitra struct{}

func (fakeMitra) Kode(context.Context, string) (string, error) { return "010", nil }

type fakeRepo struct {
	got     domain.Filter
	billing []domain.BillingRow
	summary domain.Summary
}

func (f *fakeRepo) Billing(_ context.Context, flt domain.Filter) ([]domain.BillingRow, domain.Summary, error) {
	f.got = flt
	return f.billing, f.summary, nil
}

func (f *fakeRepo) Payments(context.Context, domain.Filter) ([]domain.PaymentRow, domain.Summary, error) {
	return nil, domain.Summary{}, nil
}

func (f *fakeRepo) MonthlyTransactionCounts(context.Context, domain.Filter, time.Time, time.Time) (map[string]int64, error) {
	return nil, nil
}

func newApp(t *testing.T, grants []rbacdomain.Grant, svc *application.Service, p kernel.Principal) *fiber.App {
	t.Helper()
	app := fiber.New(fiber.Config{Immutable: true, ErrorHandler: httpx.ErrorHandler})
	app.Use(func(c *fiber.Ctx) error {
		httpx.SetPrincipal(c, p)
		return c.Next()
	})
	router := rbachttp.Router{
		Router: app,
		Guard:  rbachttp.Guard{Service: &rbacapp.Service{Repository: fakeGrants{grants: grants}}},
	}
	reportshttp.Handler{Svc: svc}.Routes(router)
	return app
}

func get(t *testing.T, app *fiber.App, path string) (int, map[string]json.RawMessage, string) {
	t.Helper()
	res, err := app.Test(httptest.NewRequest("GET", path, nil))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	var body struct {
		Data  map[string]json.RawMessage `json:"data"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	code := ""
	if body.Error != nil {
		code = body.Error.Code
	}
	return res.StatusCode, body.Data, code
}

func granted(resource, action, scope string) []rbacdomain.Grant {
	return []rbacdomain.Grant{{Resource: resource, Action: action, Scope: scope}}
}

func mitraPrincipal() kernel.Principal {
	return kernel.Principal{ID: "user-1", RoleID: "role-1", MitraID: "mitra-1"}
}

func TestBillingWithoutPermissionIsForbidden(t *testing.T) {
	svc := &application.Service{Repo: &fakeRepo{}, Mitra: fakeMitra{}}
	app := newApp(t, nil, svc, mitraPrincipal())

	status, _, code := get(t, app, "/reports/billing")

	if status != 403 || code != "PERMISSION_NOT_GRANTED" {
		t.Fatalf("want 403 PERMISSION_NOT_GRANTED, got %d %s", status, code)
	}
}

func TestSuperadminWithoutMitraIsForbidden(t *testing.T) {
	svc := &application.Service{Repo: &fakeRepo{}, Mitra: fakeMitra{}}
	p := kernel.Principal{ID: "user-1", RoleID: "role-1"} // no mitra
	app := newApp(t, granted("billing", "view", "all"), svc, p)

	status, _, code := get(t, app, "/reports/billing")

	if status != 403 || code != "MITRA_REQUIRED" {
		t.Fatalf("want 403 MITRA_REQUIRED, got %d %s", status, code)
	}
}

func TestEmptyDSNIsUnavailable(t *testing.T) {
	svc := &application.Service{Repo: nil, Mitra: fakeMitra{}} // DSN not configured
	app := newApp(t, granted("billing", "view", "mitra"), svc, mitraPrincipal())

	status, _, code := get(t, app, "/reports/billing")

	if status != 503 || code != "REPORTS_UNAVAILABLE" {
		t.Fatalf("want 503 REPORTS_UNAVAILABLE, got %d %s", status, code)
	}
}

func TestInvalidDateFormatIsBadRequest(t *testing.T) {
	svc := &application.Service{Repo: &fakeRepo{}, Mitra: fakeMitra{}}
	grants := granted("billing", "view", "mitra")

	for _, path := range []string{
		"/reports/billing?from=2026-13-99",
		"/reports/billing?to=05-11-2026",
	} {
		app := newApp(t, grants, svc, mitraPrincipal())
		status, _, code := get(t, app, path)
		if status != 400 || code != "VALIDATION_ERROR" {
			t.Fatalf("%s: want 400 VALIDATION_ERROR, got %d %s", path, status, code)
		}
	}
}

func TestBillingUsesResolvedMitraAndClampsPageSize(t *testing.T) {
	repo := &fakeRepo{billing: []domain.BillingRow{{VaNumber: "8808"}}, summary: domain.Summary{Count: 1, TotalAmount: 5000}}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}}
	app := newApp(t, granted("billing", "view", "mitra"), svc, mitraPrincipal())

	// The client's id_mitra must be ignored; the principal's mitra wins.
	status, data, _ := get(t, app, "/reports/billing?id_mitra=999&pageSize=500&page=2")

	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if repo.got.MitraKode != "010" {
		t.Fatalf("filter mitra must come from the principal, got %q", repo.got.MitraKode)
	}
	if repo.got.Limit != 100 {
		t.Fatalf("pageSize must clamp to 100, got %d", repo.got.Limit)
	}
	if repo.got.Offset != 100 {
		t.Fatalf("offset must follow the page, got %d", repo.got.Offset)
	}
	if _, ok := data["items"]; !ok {
		t.Fatalf("response must carry items: %v", data)
	}
	if _, ok := data["summary"]; !ok {
		t.Fatalf("response must carry summary: %v", data)
	}
}

func newMeApp(t *testing.T, svc *application.Service, p kernel.Principal) *fiber.App {
	t.Helper()
	app := fiber.New(fiber.Config{Immutable: true, ErrorHandler: httpx.ErrorHandler})
	app.Use(func(c *fiber.Ctx) error {
		httpx.SetPrincipal(c, p)
		return c.Next()
	})
	reportshttp.Handler{Svc: svc}.MeRoutes(app)
	return app
}

// fakeLastLogin returns a fixed login, or kernel.ErrNotFound when row is nil.
type fakeLastLogin struct{ row *domain.LastLogin }

func (f fakeLastLogin) LastLogin(context.Context, string) (domain.LastLogin, error) {
	if f.row == nil {
		return domain.LastLogin{}, kernel.ErrNotFound
	}
	return *f.row, nil
}

// recordingLastLogin records the user id it was asked for and returns the row
// stored for that user, so a test can prove the caller's own record is used.
type recordingLastLogin struct {
	got    string
	byUser map[string]domain.LastLogin
}

func (r *recordingLastLogin) LastLogin(_ context.Context, userID string) (domain.LastLogin, error) {
	r.got = userID
	if row, ok := r.byUser[userID]; ok {
		return row, nil
	}
	return domain.LastLogin{}, kernel.ErrNotFound
}

// The lastLogin lookup must be scoped to the caller's own principal id: the
// reader is asked for exactly that user, and the row returned is that user's
// most recent successful login - never another user's.
func TestDashboardLastLoginBelongsToTheCaller(t *testing.T) {
	callerLogin := domain.LastLogin{
		At:        time.Date(2026, 11, 10, 8, 30, 0, 0, time.UTC),
		IP:        "10.0.0.1",
		UserAgent: "caller-agent",
	}
	otherLogin := domain.LastLogin{
		At:        time.Date(2026, 11, 10, 9, 45, 0, 0, time.UTC),
		IP:        "10.0.0.2",
		UserAgent: "other-agent",
	}
	reader := &recordingLastLogin{byUser: map[string]domain.LastLogin{
		"u1": callerLogin,
		"u2": otherLogin,
	}}
	svc := &application.Service{
		Repo:      &countableRepo{},
		Mitra:     fakeMitra{},
		LastLogin: reader,
	}
	p := kernel.Principal{ID: "u1", RoleID: "r1", MitraID: "mitra-1"}
	app := newMeApp(t, svc, p)

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if reader.got != "u1" {
		t.Fatalf("lastLogin must be read for the caller's id %q, got %q", "u1", reader.got)
	}
	var last struct {
		IP string `json:"ip"`
	}
	if err := json.Unmarshal(data["lastLogin"], &last); err != nil {
		t.Fatalf("decode lastLogin: %v", err)
	}
	if last.IP != "10.0.0.1" {
		t.Fatalf("lastLogin must be the caller's own row, got ip %q", last.IP)
	}
}

// A caller with no successful login on record (only failures, which never
// create a session row) gets null, not another user's login.
func TestDashboardLastLoginNullWhenCallerHasNoRecord(t *testing.T) {
	reader := &recordingLastLogin{byUser: map[string]domain.LastLogin{
		"other": {At: time.Now(), IP: "10.0.0.9", UserAgent: "other"},
	}}
	svc := &application.Service{Repo: &countableRepo{}, Mitra: fakeMitra{}, LastLogin: reader}
	p := kernel.Principal{ID: "u1", RoleID: "r1", MitraID: "mitra-1"}
	app := newMeApp(t, svc, p)

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if reader.got != "u1" {
		t.Fatalf("reader must be asked for the caller, got %q", reader.got)
	}
	if string(data["lastLogin"]) != "null" {
		t.Fatalf("lastLogin must be null when the caller has no record, got %s", data["lastLogin"])
	}
}

// countableRepo records the calls and returns a fixed per-day count map.
type countableRepo struct {
	fakeRepo
	counts   map[string]int64
	gotKode  string
	dayCalls int
}

func (r *countableRepo) MonthlyTransactionCounts(_ context.Context, f domain.Filter, _, _ time.Time) (map[string]int64, error) {
	r.gotKode = f.MitraKode
	r.dayCalls++
	return r.counts, nil
}

func TestDashboardLastLoginOnlyForNonMitra(t *testing.T) {
	when := time.Date(2026, 11, 10, 8, 30, 0, 0, time.UTC)
	svc := &application.Service{
		Repo:      &countableRepo{},
		Mitra:     fakeMitra{},
		LastLogin: fakeLastLogin{row: &domain.LastLogin{At: when, IP: "10.1.2.3", UserAgent: "Chrome/120"}},
	}
	p := kernel.Principal{ID: "u1", RoleID: "r1"} // no mitra
	app := newMeApp(t, svc, p)

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if string(data["lastLogin"]) == "null" {
		t.Fatalf("lastLogin must be present, got %s", data["lastLogin"])
	}
	if string(data["monthlyTransactions"]) != "null" {
		t.Fatalf("non-mitra must get null monthly, got %s", data["monthlyTransactions"])
	}
}

func TestDashboardMonthlyScopesToPrincipalMitraAndFillsEveryDay(t *testing.T) {
	repo := &countableRepo{counts: map[string]int64{"2026-11-01": 2, "2026-11-15": 3}}
	svc := &application.Service{
		Repo:      repo,
		Mitra:     fakeMitra{}, // resolves kode "010"
		LastLogin: fakeLastLogin{row: nil},
	}
	p := kernel.Principal{ID: "u1", RoleID: "r1", MitraID: "mitra-1"}
	app := newMeApp(t, svc, p)

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if repo.gotKode != "010" {
		t.Fatalf("monthly must scope to the principal mitra, got %q", repo.gotKode)
	}
	var monthly struct {
		Unavailable bool  `json:"unavailable"`
		Total       int64 `json:"total"`
		Days        []struct {
			Date  string `json:"date"`
			Count int64  `json:"count"`
		} `json:"days"`
	}
	if err := json.Unmarshal(data["monthlyTransactions"], &monthly); err != nil {
		t.Fatalf("decode monthly: %v", err)
	}
	// November has 30 days; every day must appear, empty days as zero.
	if len(monthly.Days) != 30 {
		t.Fatalf("want 30 day buckets, got %d", len(monthly.Days))
	}
	if monthly.Total != 5 {
		t.Fatalf("want total 5, got %d", monthly.Total)
	}
	if monthly.Days[0].Count != 2 || monthly.Days[14].Count != 3 || monthly.Days[1].Count != 0 {
		t.Fatalf("unexpected per-day counts: %+v", monthly.Days)
	}
	// lastLogin null when the reader reports no row.
	if string(data["lastLogin"]) != "null" {
		t.Fatalf("lastLogin must be null, got %s", data["lastLogin"])
	}
}

func TestDashboardEmptyDSNKeepsLastLoginAndMarksMonthlyUnavailable(t *testing.T) {
	when := time.Date(2026, 11, 10, 8, 30, 0, 0, time.UTC)
	svc := &application.Service{
		Repo:      nil, // REPORTS_MYSQL_DSN unset
		Mitra:     fakeMitra{},
		LastLogin: fakeLastLogin{row: &domain.LastLogin{At: when, IP: "10.1.2.3", UserAgent: "Firefox/121"}},
	}
	p := kernel.Principal{ID: "u1", RoleID: "r1", MitraID: "mitra-1"}
	app := newMeApp(t, svc, p)

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200 (not 503): got %d", status)
	}
	if string(data["lastLogin"]) == "null" {
		t.Fatalf("lastLogin must survive an unconfigured reports DB, got %s", data["lastLogin"])
	}
	var monthly struct {
		Unavailable bool `json:"unavailable"`
	}
	if err := json.Unmarshal(data["monthlyTransactions"], &monthly); err != nil {
		t.Fatalf("decode monthly: %v", err)
	}
	if !monthly.Unavailable {
		t.Fatalf("monthly must be unavailable when the DSN is empty")
	}
}
