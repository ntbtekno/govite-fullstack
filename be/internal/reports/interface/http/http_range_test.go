package http_test

import (
	"context"
	"encoding/json"
	"strings"
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

	amount     float64
	gotMinDate string
	gotMaxDate string
	hasCover   bool
	coverCalls int
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

func (r *rangeRepo) MonthlyTransactionTotal(_ context.Context, f domain.Filter, from, to time.Time) (float64, error) {
	r.gotKode = f.MitraKode
	r.gotFrom = from
	r.gotTo = to
	return r.amount, nil
}

func (r *rangeRepo) MonthlyTransactionCoverage(_ context.Context, f domain.Filter) (string, string, bool, error) {
	r.gotKode = f.MitraKode
	r.coverCalls++
	return r.gotMinDate, r.gotMaxDate, r.hasCover, nil
}

func decodeMonthly(t *testing.T, data map[string]json.RawMessage) struct {
	Unavailable bool    `json:"unavailable"`
	Total       int64   `json:"total"`
	TotalAmount float64 `json:"totalAmount"`
	Coverage    *struct {
		MinDate  string `json:"minDate"`
		LastDate string `json:"lastDate"`
	} `json:"coverage"`
	Days []struct {
		Date  string `json:"date"`
		Count int64  `json:"count"`
	} `json:"days"`
} {
	t.Helper()
	var monthly struct {
		Unavailable bool    `json:"unavailable"`
		Total       int64   `json:"total"`
		TotalAmount float64 `json:"totalAmount"`
		Coverage    *struct {
			MinDate  string `json:"minDate"`
			LastDate string `json:"lastDate"`
		} `json:"coverage"`
		Days []struct {
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
// A missing `from` starts at the 1st; a missing `to` ends at today.
func TestDashboardOneSidedRangeFollowsRunningMonthEdges(t *testing.T) {

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

	t.Run("to only keeps today (not end of month)", func(t *testing.T) {
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
		// The missing `to` defaults to today (in test timezone), and the
		// exclusive bound is one day later.
		wantToday := time.Now().In(makassarForTest())
		wantToday = time.Date(wantToday.Year(), wantToday.Month(), wantToday.Day(), 0, 0, 0, 0, makassarForTest())
		wantTo := wantToday.AddDate(0, 0, 1)
		if !repo.gotTo.Equal(wantTo) {
			t.Fatalf("missing to must default to today, got %s", repo.gotTo.Format("2006-01-02"))
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

// (f) The range is limited to 1 month: a 32-day difference (to - from) is a
// 400 VALIDATION_ERROR; a 31-day difference is accepted.
func TestDashboardRangeOver31DaysIsBadRequest(t *testing.T) {
	t.Run("32 days rejected", func(t *testing.T) {
		repo := &rangeRepo{}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		// 2026-07-01..2026-08-02 is a 32-day difference.
		status, _, code := get(t, app, "/dashboard/summary?from=2026-07-01&to=2026-08-02")
		if status != 400 || code != "VALIDATION_ERROR" {
			t.Fatalf("32-day range: want 400 VALIDATION_ERROR, got %d %s", status, code)
		}
		if repo.calls != 0 {
			t.Fatalf("repo must not be called on an over-long range, got %d calls", repo.calls)
		}
	})

	t.Run("31 days accepted", func(t *testing.T) {
		repo := &rangeRepo{}
		svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
		app := newMeApp(t, svc, mitraPrincipal())

		// 2026-07-01..2026-08-01 is a 31-day difference.
		status, data, _ := get(t, app, "/dashboard/summary?from=2026-07-01&to=2026-08-01")
		if status != 200 {
			t.Fatalf("31-day range must be accepted, got %d", status)
		}
		if len(decodeMonthly(t, data).Days) != 32 {
			t.Fatalf("want 32 day buckets, got %d", len(decodeMonthly(t, data).Days))
		}
	})
}

// (g) Without any parameter the default range is 1st of month to today.
func TestDashboardNoParamsDefaultsToFirstToToday(t *testing.T) {
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
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, makassarForTest())
	daysInRange := int(today.Sub(firstOfMonth).Hours()/24) + 1
	if len(monthly.Days) != daysInRange {
		t.Fatalf("want %d day buckets for 1st..today, got %d", daysInRange, len(monthly.Days))
	}
	// The repo window is 1st..today.
	if repo.gotFrom.Month() != firstOfMonth.Month() || repo.gotFrom.Day() != 1 {
		t.Fatalf("default repo from must be the 1st of the running month, got %s", repo.gotFrom.Format("2006-01-02"))
	}
	wantTo := today.AddDate(0, 0, 1)
	if !repo.gotTo.Equal(wantTo) {
		t.Fatalf("default repo to must be tomorrow (exclusive), got %s", repo.gotTo.Format("2006-01-02"))
	}
	// Total only counts days in the range (1st..today).
	// Test data has counts on 2026-11-01 (2) and 2026-11-15 (3).
	// Since today is 2026-11-12, only 2026-11-01 is in range.
	wantTotal := int64(2)
	if monthly.Total != wantTotal {
		t.Fatalf("want total %d (only 2026-11-01 in range), got %d", wantTotal, monthly.Total)
	}
}

// (h) totalAmount is SUM(txamt) over the applied range: the custom range wins
// over anything outside it. Coverage always spans the whole mitra dataset.
func TestDashboardCustomRangeReturnsTotalAmountAndCoverage(t *testing.T) {
	repo := &rangeRepo{
		counts:     map[string]int64{"2026-11-02": 4, "2026-11-05": 6},
		amount:     1525000,
		gotMinDate: "2025-06-20",
		gotMaxDate: "2026-08-12",
		hasCover:   true,
	}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, data, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	monthly := decodeMonthly(t, data)

	if monthly.TotalAmount != 1525000 {
		t.Fatalf("want totalAmount 1525000, got %v", monthly.TotalAmount)
	}
	if monthly.Coverage == nil {
		t.Fatalf("coverage must be present")
	}
	if monthly.Coverage.MinDate != "2025-06-20" || monthly.Coverage.LastDate != "2026-08-12" {
		t.Fatalf("unexpected coverage: %+v", monthly.Coverage)
	}
	// Coverage is read once and its query carries no date bound (all data).
	if repo.coverCalls != 1 {
		t.Fatalf("coverage must be read exactly once, got %d", repo.coverCalls)
	}
}

// (i) An empty range yields total 0 and totalAmount 0, with coverage still
// reported from the whole dataset.
func TestDashboardEmptyRangeYieldsZeroTotals(t *testing.T) {
	repo := &rangeRepo{
		counts:     nil,
		amount:     0,
		gotMinDate: "2025-06-20",
		gotMaxDate: "2026-08-12",
		hasCover:   true,
	}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, data, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	monthly := decodeMonthly(t, data)
	if monthly.Total != 0 || monthly.TotalAmount != 0 {
		t.Fatalf("want zero totals on an empty range, got total=%d amount=%v", monthly.Total, monthly.TotalAmount)
	}
	if monthly.Coverage == nil || monthly.Coverage.MinDate != "2025-06-20" {
		t.Fatalf("coverage must still be reported on an empty range, got %+v", monthly.Coverage)
	}
}

// (j) The mitra scope applies to SUM exactly as it does to COUNT: the amount
// query is scoped to the principal's kode, never a client-supplied mitra.
func TestDashboardTotalAmountScopesToPrincipalMitra(t *testing.T) {
	repo := &rangeRepo{counts: nil, amount: 999, hasCover: false}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, _, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05&id_mitra=999")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if repo.gotKode != "010" {
		t.Fatalf("sum must scope to the principal mitra kode 010, got %q", repo.gotKode)
	}
}

// (k) No stored rows: coverage is null (ok=false) rather than a zero date.
func TestDashboardCoverageNullWhenMitraHasNoRows(t *testing.T) {
	repo := &rangeRepo{counts: nil, amount: 0, hasCover: false}
	svc := &application.Service{Repo: repo, Mitra: fakeMitra{}, LastLogin: fakeLastLogin{row: nil}}
	app := newMeApp(t, svc, mitraPrincipal())

	status, data, _ := get(t, app, "/dashboard/summary?from=2026-11-02&to=2026-11-05")
	if status != 200 {
		t.Fatalf("want 200, got %d", status)
	}
	if got := string(data["monthlyTransactions"]); !strings.Contains(got, `"coverage":null`) {
		t.Fatalf("coverage must be null when the mitra has no rows, got %s", got)
	}
}
