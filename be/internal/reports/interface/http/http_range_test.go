package http_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"govite/internal/reports/application"
	"govite/internal/reports/domain"
)

// rangeRepo records the from/to window it was queried with, so a test can
// prove the endpoint translated the requested calendar range into the
// repository bounds (from inclusive, to exclusive = requested `to` + 1 day).
type rangeRepo struct {
	counts  map[string]int64
	gotFrom time.Time
	gotTo   time.Time
	gotKode string
	calls   int
}

func (r *rangeRepo) Billing(context.Context, domain.Filter) ([]domain.BillingRow, domain.Summary, error) {
	return nil, domain.Summary{}, nil
}

func (r *rangeRepo) Payments(context.Context, domain.Filter) ([]domain.PaymentRow, domain.Summary, error) {
	return nil, domain.Summary{}, nil
}

func (r *rangeRepo) MonthlyTransactionCounts(_ context.Context, f domain.Filter, from, to time.Time) (map[string]int64, error) {
	r.gotKode = f.MitraKode
	r.gotFrom = from
	r.gotTo = to
	r.calls++
	return r.counts, nil
}

func decodeMonthly(t *testing.T, data map[string]json.RawMessage) struct {
	Unavailable bool  `json:"unavailable"`
	Total       int64 `json:"total"`
	Days        []struct {
		Date  string `json:"date"`
		Count int64  `json:"count"`
	} `json:"days"`
} {
	t.Helper()
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
	return monthly
}

// (a) A custom range returns exactly the days in that inclusive range, with
// empty days present as zero and a total that is the sum of the range only.
func TestDashboardCustomRangeReturnsOnlyRangeDaysWithZeros(t *testing.T) {
	repo := &rangeRepo{counts: map[string]int64{
		"2026-11-02": 4,
		"2026-11-05": 6,
		// Outside the requested range: must be ignored.
		"2026-11-01": 9,
		"2026-11-08": 7,
	}}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, data, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	monthly := decodeMonthly(t, data)

	// 4 calendar days: 2,3,4,5.
	if len(monthly.Days) != 4 {
		t.Fatalf("want 4 day buckets for 2026-11-02..2026-11-05, got %d", len(monthly.Days))
	}
	wantDates := []string{"2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"}
	wantCounts := []int64{4, 0, 0, 6}
	for i, d := range monthly.Days {
		if d.Date != wantDates[i] {
			t.Fatalf("day %d: want date %s, got %s", i, wantDates[i], d.Date)
		}
		if d.Count != wantCounts[i] {
			t.Fatalf("day %d (%s): want count %d, got %d", i, d.Date, wantCounts[i], d.Count)
		}
	}
	// Total is only the days inside the range (4 + 6), never the ignored ones.
	if monthly.Total != 10 {
		t.Fatalf("want total 10, got %d", monthly.Total)
	}
	// The repository window is inclusive-from / exclusive-to.
	if got := repo.gotFrom.Format("2006-01-02"); got != "2026-11-02" {
		t.Fatalf("repo from must be 2026-11-02, got %s", got)
	}
	if got := repo.gotTo.Format("2006-01-02"); got != "2026-11-06" {
		t.Fatalf("repo to must be exclusive 2026-11-06, got %s", got)
	}
}

// (b) The custom range still pins the mitra code from the authenticated
// principal; a client-supplied mitra is never read.
func TestDashboardCustomRangeScopesToPrincipalMitra(t *testing.T) {
	repo := &rangeRepo{counts: nil}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, _, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05&id_mitra=999")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if repo.gotKode != "010" {
		t.Fatalf("custom range must scope to the principal mitra kode 010, got %q", repo.gotKode)
	}
}

// (c) Only one bound supplied: the other side follows the running month edge.
// A missing `from` starts at the 1st; a missing `to` ends at the last day.
func TestDashboardOneSidedRangeFollowsRunningMonthEdges(t *testing.T) {
	now := time.Now().In(makassarForTest())
	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, makassarForTest())
	lastOfMonth := firstOfMonth.AddDate(0, 1, -1)

	t.Run("from only keeps the first day of the running month", func(t *testing.T) {
		repo := &rangeRepo{counts: nil}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		status, data, _ := get(t, app, "/dashboard/summary?to=2026-11-05")
		if status != 200 {
			t.Fatalf("want 200, got %d", status)
		}
		// The running month's first day is used as the missing lower bound, so
		// the repo window starts there and ends the day after `to`.
		_ = data
		wantFromMonth := time.Now().In(makassarForTest()).Month()
		if repo.gotFrom.Month() != wantFromMonth || repo.gotFrom.Day() != 1 {
			t.Fatalf("missing from must default to the 1st of the running month, got %s", repo.gotFrom.Format("2006-01-02"))
		}
		if got := repo.gotTo.Format("2006-01-02"); got != "2026-11-06" {
			t.Fatalf("to must stay exclusive 2026-11-06, got %s", got)
		}
	})

	t.Run("to only keeps the last day of the running month", func(t *testing.T) {
		repo := &rangeRepo{counts: nil}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		status, _, _ := get(t, app, "/dashboard/summary?from=2026-11-02")
		if status != 200 {
			t.Fatalf("want 200, got %d", status)
		}
		if got := repo.gotFrom.Format("2006-01-02"); got != "2026-11-02" {
			t.Fatalf("from must stay 2026-11-02, got %s", got)
		}
		// The missing `to` defaults to the running month's last day, and the
		// exclusive bound is one day later.
		wantLast := lastOfMonth.AddDate(0, 0, 1)
		if !repo.gotTo.Equal(wantLast) {
			t.Fatalf("missing to must default to the running month's last day, got %s", repo.gotTo.Format("2006-01-02"))
		}
	})
}

func makassarForTest() *time.Location {
	return time.FixedZone("WITA", 8*60*60)
}

// (d) A malformed date is a 400 VALIDATION_ERROR, and the repo is never called.
func TestDashboardBrokenDateFormatIsBadRequest(t *testing.T) {
	for _, path := range []string{
		"/dashboard/summary?from=2026-13-99",
		"/dashboard/summary?to=05-11-2026",
		"/dashboard/summary?from=2026-11-02&to=nope",
	} {
		repo := &rangeRepo{}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		status, _, code := get(t, app, path)
		if status != 400 || code != "VALIDATION_ERROR" {
			t.Fatalf("%s: want 400 VALIDATION_ERROR, got %d %s", path, status, code)
		}
		if repo.calls != 0 {
			t.Fatalf("%s: repo must not be called on a validation error, got %d calls", path, repo.calls)
		}
	}
}

// (e) from > to is a 400 VALIDATION_ERROR and the repo is never called.
func TestDashboardFromAfterToIsBadRequest(t *testing.T) {
	repo := &rangeRepo{}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, _, code := get(t, app, "/dashboard/summary?from=2026-11-10&to=2026-11-02")
	if status != 400 || code != "VALIDATION_ERROR" {
		t.Fatalf("want 400 VALIDATION_ERROR, got %d %s", status, code)
	}
	if repo.calls != 0 {
		t.Fatalf("repo must not be called when from > to, got %d calls", repo.calls)
	}
}

// (f) A 93-day range is a 400 VALIDATION_ERROR; 92 days is accepted.
func TestDashboardRangeOver92DaysIsBadRequest(t *testing.T) {
	t.Run("93 days rejected", func(t *testing.T) {
		repo := &rangeRepo{}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		// 2026-09-01..2026-12-02 inclusive = 93 days.
		status, _, code := get(t, app, "/dashboard/summary?from=2026-09-01&to=2026-12-02")
		if status != 400 || code != "VALIDATION_ERROR" {
			t.Fatalf("93-day range: want 400 VALIDATION_ERROR, got %d %s", status, code)
		}
		if repo.calls != 0 {
			t.Fatalf("repo must not be called on an over-long range, got %d calls", repo.calls)
		}
	})

	t.Run("92 days accepted", func(t *testing.T) {
		repo := &rangeRepo{}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		// 2026-09-01..2026-12-01 inclusive = 92 days.
		status, data, _ := get(t, app, "/dashboard/summary?from=2026-09-01&to=2026-12-01")
		if status != 200 {
			t.Fatalf("92-day range must be accepted, got %d", status)
		}
		if len(decodeMonthly(t, data).Days) != 92 {
			t.Fatalf("want 92 day buckets, got %d", len(decodeMonthly(t, data).Days))
		}
	})
}

// (g) Without any parameter the response is identical to the old behaviour:
// the whole running month, every day filled, zeros for empty days.
func TestDashboardNoParamsMatchesRunningMonthBehaviour(t *testing.T) {
	repo := &rangeRepo{counts: map[string]int64{"2026-11-01": 2, "2026-11-15": 3}}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, data, _ := get(t, app, "/dashboard/summary")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	monthly := decodeMonthly(t, data)

	now := time.Now().In(makassarForTest())
	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, makassarForTest())
	daysInMonth := firstOfMonth.AddDate(0, 1, -1).Day()
	if len(monthly.Days) != daysInMonth {
		t.Fatalf("want %d day buckets for the running month, got %d", daysInMonth, len(monthly.Days))
	}
	// The repo window is the whole running month.
	if repo.gotFrom.Month() != firstOfMonth.Month() || repo.gotFrom.Day() != 1 {
		t.Fatalf("default repo from must be the 1st of the running month, got %s", repo.gotFrom.Format("2006-01-02"))
	}
	wantTo := firstOfMonth.AddDate(0, 1, 0)
	if !repo.gotTo.Equal(wantTo) {
		t.Fatalf("default repo to must be the 1st of next month, got %s", repo.gotTo.Format("2006-01-02"))
	}
	if monthly.Total != 5 {
		t.Fatalf("want total 5, got %d", monthly.Total)
	}
	if monthly.Days[0].Count != 2 || monthly.Days[14].Count != 3 || monthly.Days[1].Count != 0 {
		t.Fatalf("unexpected per-day counts: %+v", monthly.Days)
	}
}
