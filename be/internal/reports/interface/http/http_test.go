package http_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

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
