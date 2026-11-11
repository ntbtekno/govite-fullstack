package application

import (
	"context"
	"errors"
	"time"

	"govite/internal/kernel"
	"govite/internal/reports/domain"
)

// makassar is the reporting timezone for the dashboard month window. The
// stored txdtstlmn value is treated as-is; the zone only decides which calendar
// month and which days the window covers.
var makassar = time.FixedZone("WITA", 8*60*60)

// Service resolves the caller's mitra and delegates to the reporting
// repository. Repo is nil when REPORTS_MYSQL_DSN is unset.
type Service struct {
	Repo      domain.Repository
	Mitra     domain.MitraResolver
	LastLogin domain.LastLoginReader
}

// Dashboard is the authenticated caller's dashboard summary. LastLogin is
// null when the caller has no recorded login. Monthly is nil for a caller
// without a mitra; it is present (possibly Unavailable) for a mitra caller.
type Dashboard struct {
	LastLogin *domain.LastLogin           `json:"lastLogin"`
	Monthly   *domain.MonthlyTransactions `json:"monthlyTransactions"`
}

// scoped enforces the optional feature and the mitra-only rule, then pins the
// mitra code from the authenticated principal. Any client-supplied mitra is
// never read.
func (s *Service) scoped(ctx context.Context, f domain.Filter) (domain.Filter, error) {
	if s.Repo == nil {
		return f, domain.ErrUnavailable
	}
	p := kernel.PrincipalFrom(ctx)
	if p.MitraID == "" {
		return f, domain.ErrMitraOnly
	}
	kode, err := s.Mitra.Kode(ctx, p.MitraID)
	if err != nil {
		return f, err
	}
	f.MitraKode = kode
	return f, nil
}

func (s *Service) Billing(ctx context.Context, f domain.Filter) ([]domain.BillingRow, domain.Summary, error) {
	f, err := s.scoped(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	return s.Repo.Billing(ctx, f)
}

func (s *Service) Payments(ctx context.Context, f domain.Filter) ([]domain.PaymentRow, domain.Summary, error) {
	f, err := s.scoped(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	return s.Repo.Payments(ctx, f)
}

// DashboardSummary assembles the caller's dashboard cards. lastLogin is always
// attempted; a nil LastLogin reader or a missing row yields null. The monthly
// transaction section is only built for a mitra caller: a caller without a
// mitra gets nil, and a missing reports database gets Unavailable (mirroring
// the 503 REPORTS_UNAVAILABLE the report pages show) instead of failing the
// whole response. from/to are optional calendar date bounds in Asia/Makassar;
// when both are nil the running month is used. One-sided bounds default to the
// running month edges.
func (s *Service) DashboardSummary(ctx context.Context, from, to *time.Time) (Dashboard, error) {
	out := Dashboard{}

	if s.LastLogin != nil {
		last, err := s.LastLogin.LastLogin(ctx, kernel.PrincipalFrom(ctx).ID)
		switch {
		case err == nil:
			out.LastLogin = &last
		case errors.Is(err, kernel.ErrNotFound):
			// No login recorded yet: leave null.
		default:
			return out, err
		}
	}

	out.Monthly = s.monthly(ctx, from, to)
	return out, nil
}

// monthly builds the mitra-only monthly section. It never errors: an absent
// mitra yields nil, an absent reports database yields Unavailable, and a read
// failure degrades to Unavailable as well. from/to are optional bounds; when
// both are nil the running month (Asia/Makassar) is used. One-sided bounds
// default to the running month edges.
func (s *Service) monthly(ctx context.Context, from, to *time.Time) *domain.MonthlyTransactions {
	p := kernel.PrincipalFrom(ctx)
	if p.MitraID == "" {
		return nil
	}
	if s.Repo == nil || s.Mitra == nil {
		return &domain.MonthlyTransactions{Unavailable: true, Days: []domain.DailyPoint{}}
	}
	kode, err := s.Mitra.Kode(ctx, p.MitraID)
	if err != nil {
		return &domain.MonthlyTransactions{Unavailable: true, Days: []domain.DailyPoint{}}
	}

	now := time.Now().In(makassar)
	firstOfMonth, lastOfMonth, _ := monthWindow(now)

	// Determine effective bounds
	var effFrom, effTo time.Time
	if from != nil {
		effFrom = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, makassar)
	} else {
		effFrom = firstOfMonth
	}
	if to != nil {
		effTo = time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, makassar)
	} else {
		effTo = lastOfMonth
	}

	// to is inclusive, so add one day for the exclusive upper bound in the query
	queryTo := effTo.AddDate(0, 0, 1)

	daysInRange := int(effTo.Sub(effFrom).Hours()/24) + 1

	counts, err := s.Repo.MonthlyTransactionCounts(ctx, domain.Filter{MitraKode: kode}, effFrom, queryTo)
	if err != nil {
		return &domain.MonthlyTransactions{Unavailable: true, Days: []domain.DailyPoint{}}
	}

	days := make([]domain.DailyPoint, 0, daysInRange)
	var total int64
	for d := 0; d < daysInRange; d++ {
		date := effFrom.AddDate(0, 0, d)
		key := date.Format("2006-01-02")
		n := counts[key]
		total += n
		days = append(days, domain.DailyPoint{Date: key, Count: n})
	}
	return &domain.MonthlyTransactions{Total: total, Days: days}
}

// monthWindow returns the first day, the last day and the number of days of
// the calendar month containing now.
func monthWindow(now time.Time) (first, last time.Time, days int) {
	first = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, makassar)
	last = first.AddDate(0, 1, -1)
	return first, last, last.Day()
}
