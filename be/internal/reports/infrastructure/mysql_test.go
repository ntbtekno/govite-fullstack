package infrastructure

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"testing"
	"time"

	"govite/internal/reports/domain"
)

type monthlyCountsDriver struct{}

func (monthlyCountsDriver) Open(string) (driver.Conn, error) {
	return monthlyCountsConn{}, nil
}

type monthlyCountsConn struct{}

func (monthlyCountsConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (monthlyCountsConn) Close() error                        { return nil }
func (monthlyCountsConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (monthlyCountsConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &monthlyCountsRows{done: false}, nil
}

type monthlyCountsRows struct{ done bool }

func (monthlyCountsRows) Columns() []string { return []string{"d", "count"} }
func (monthlyCountsRows) Close() error      { return nil }

func (r *monthlyCountsRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	// This is the exact value go-sql-driver/mysql exposes for DATE(...) when
	// parseTime=true: a time.Time, not a YYYY-MM-DD string.
	dest[0] = time.Date(2026, 7, 6, 0, 0, 0, 0, time.FixedZone("WITA", 8*60*60))
	dest[1] = []byte("7")
	return nil
}

// TestMonthlyTransactionCountsNormalizesParseTimeDateKey proves the complete
// rows.Scan -> map-key path. The fake driver returns time.Time for the grouped
// DATE column, reproducing parseTime=true; the repository must expose the
// YYYY-MM-DD key consumed by application.monthly.
func TestMonthlyTransactionCountsNormalizesParseTimeDateKey(t *testing.T) {
	const driverName = "govite-monthly-counts-regression"
	sql.Register(driverName, monthlyCountsDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("open fake mysql: %v", err)
	}
	defer db.Close()

	repo := Repository{DB: db}
	got, err := repo.MonthlyTransactionCounts(
		context.Background(),
		domain.Filter{MitraKode: "010"},
		time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("MonthlyTransactionCounts: %v", err)
	}

	if got["2026-07-06"] != 7 {
		t.Fatalf("want normalized key 2026-07-06 with count 7, got %#v", got)
	}
	if _, ok := got["2026-07-06T00:00:00+08:00"]; ok {
		t.Fatalf("RFC3339 key must not escape the repository boundary: %#v", got)
	}
}
