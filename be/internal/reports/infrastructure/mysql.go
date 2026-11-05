package infrastructure

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"govite/internal/kernel"
	"govite/internal/platform/postgres"
	"govite/internal/reports/domain"
)

// queryTimeout bounds every read against the external MySQL database.
const queryTimeout = 5 * time.Second

// Open returns nil when the DSN is empty (the feature is optional). It does not
// dial: database/sql connects lazily, so an unreachable database never blocks
// boot. The pool is deliberately small: this is a read-only reporting sidecar.
func Open(dsn string) (*sql.DB, error) {
	if dsn == "" {
		return nil, nil
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

// NewRepository returns nil when the database is not configured, so the
// service answers 503 without a typed-nil interface.
func NewRepository(db *sql.DB) domain.Repository {
	if db == nil {
		return nil
	}
	return Repository{DB: db}
}

// Repository reads the reporting tables. Every statement is a SELECT.
type Repository struct {
	DB *sql.DB
}

func (r Repository) Billing(ctx context.Context, f domain.Filter) ([]domain.BillingRow, domain.Summary, error) {
	rows, err := r.listBilling(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	summary, err := r.billingSummary(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	return rows, summary, nil
}

func (r Repository) listBilling(ctx context.Context, f domain.Filter) ([]domain.BillingRow, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query, args := BuildBillingList(f)
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.BillingRow, 0)
	for rows.Next() {
		v, err := scanStrings(rows, 12)
		if err != nil {
			return nil, err
		}
		amount, err := parseAmount(v[9])
		if err != nil {
			return nil, err
		}
		out = append(out, domain.BillingRow{
			VaNumber:    v[0],
			ProductID:   v[2],
			PayerName:   v[3],
			BillingType: v[4],
			Email:       v[5],
			Phone:       v[6],
			DueAt:       v[7],
			Description: v[8],
			Amount:      amount,
			CreatedAt:   v[10],
			Status:      v[11],
		})
	}
	return out, rows.Err()
}

func (r Repository) billingSummary(ctx context.Context, f domain.Filter) (domain.Summary, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query, args := BuildBillingStats(f)
	return r.summary(ctx, query, args)
}

func (r Repository) Payments(ctx context.Context, f domain.Filter) ([]domain.PaymentRow, domain.Summary, error) {
	rows, err := r.listPayments(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	summary, err := r.paymentSummary(ctx, f)
	if err != nil {
		return nil, domain.Summary{}, err
	}
	return rows, summary, nil
}

func (r Repository) listPayments(ctx context.Context, f domain.Filter) ([]domain.PaymentRow, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query, args := BuildPaymentList(f)
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.PaymentRow, 0)
	for rows.Next() {
		v, err := scanStrings(rows, 7)
		if err != nil {
			return nil, err
		}
		amount, err := parseAmount(v[6])
		if err != nil {
			return nil, err
		}
		out = append(out, domain.PaymentRow{
			ID:            v[0],
			TxDate:        v[1],
			VaNumber:      v[2],
			TransactionAt: v[3],
			Reference:     v[4],
			Message:       v[5],
			Amount:        amount,
			// t_transaksi only stores settled payments.
			Status: "success",
		})
	}
	return out, rows.Err()
}

func (r Repository) paymentSummary(ctx context.Context, f domain.Filter) (domain.Summary, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query, args := BuildPaymentStats(f)
	return r.summary(ctx, query, args)
}

func (r Repository) summary(ctx context.Context, query string, args []any) (domain.Summary, error) {
	var count int64
	var total float64
	if err := r.DB.QueryRowContext(ctx, query, args...).Scan(&count, &total); err != nil {
		return domain.Summary{}, err
	}
	return domain.Summary{Count: count, TotalAmount: total}, nil
}

// scanStrings scans a row into n nullable strings. The reporting columns mix
// DATETIME and numeric types, so everything is read as text and parsed later.
func scanStrings(rows *sql.Rows, n int) ([]string, error) {
	vals := make([]sql.NullString, n)
	ptrs := make([]any, n)
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	out := make([]string, n)
	for i, v := range vals {
		if v.Valid {
			out[i] = v.String
		}
	}
	return out, nil
}

func parseAmount(s string) (float64, error) {
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

// MitraResolver reads the mitra kode from the primary Postgres database.
type MitraResolver struct {
	DB *postgres.DB
}

func (r MitraResolver) Kode(ctx context.Context, mitraID string) (string, error) {
	m, err := r.DB.Q(ctx).GetMitraByID(ctx, mitraID)
	if err != nil {
		if postgres.Err(err) == kernel.ErrNotFound {
			return "", domain.ErrMitraOnly
		}
		return "", err
	}
	return m.KodeMitra, nil
}
