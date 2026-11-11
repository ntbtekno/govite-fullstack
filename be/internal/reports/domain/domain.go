package domain

import (
	"context"
	"time"

	"govite/internal/kernel"
)

var (
	// ErrUnavailable is returned when REPORTS_MYSQL_DSN is unset: the feature is
	// optional and the rest of the API keeps working.
	ErrUnavailable = kernel.E(kernel.Unavailable, "REPORTS_UNAVAILABLE", "Laporan belum dikonfigurasi")
	// ErrMitraOnly is returned for a caller without a mitra (e.g. a Superadmin).
	ErrMitraOnly = kernel.E(kernel.Forbidden, "MITRA_REQUIRED", "Laporan hanya tersedia untuk pengguna mitra")
)

// Filter is the shared, already-validated query for both reports. From is an
// inclusive lower bound and To an exclusive upper bound (the day after the
// requested `to` date), so a full calendar day is included.
type Filter struct {
	MitraKode string
	Search    string
	From      *time.Time
	To        *time.Time
	Limit     int
	Offset    int
}

// Summary mirrors the list summary the frontend shows.
type Summary struct {
	Count       int64   `json:"count"`
	TotalAmount float64 `json:"totalAmount"`
}

// BillingRow is one billing_tagihan row mapped to the API item shape.
type BillingRow struct {
	VaNumber    string  `json:"vaNumber"`
	PayerName   string  `json:"payerName"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	CreatedAt   string  `json:"createdAt"`
	DueAt       string  `json:"dueAt"`
	Status      string  `json:"status"`
	Email       string  `json:"email"`
	Phone       string  `json:"phone"`
	BillingType string  `json:"billingType"`
	ProductID   string  `json:"productId"`
}

// PaymentRow is one t_transaksi row mapped to the API item shape. Status is
// always "success": the table only holds settled payments.
type PaymentRow struct {
	ID            string  `json:"id"`
	TxDate        string  `json:"txDate"`
	VaNumber      string  `json:"vaNumber"`
	TransactionAt string  `json:"transactionAt"`
	Reference     string  `json:"reference"`
	Message       string  `json:"message"`
	Amount        float64 `json:"amount"`
	Status        string  `json:"status"`
}

// LastLogin is the caller's most recent successful login: the time and the
// genuine client IP and raw user agent captured when the session was created.
// Present is false when the user has no recorded login yet.
type LastLogin struct {
	At        time.Time `json:"at"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"userAgent"`
}

// DailyPoint is one calendar day of the current month: the date (YYYY-MM-DD)
// and the transaction count for that day. Empty days are present with Count 0.
type DailyPoint struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// MonthlyTransactions is the caller mitra's transaction summary for the
// running calendar month (Asia/Makassar). Unavailable is true when the reports
// database is not configured; the other fields are then zero.
type MonthlyTransactions struct {
	Unavailable bool         `json:"unavailable"`
	Total       int64        `json:"total"`
	Days        []DailyPoint `json:"days"`
}

// Repository reads the external MySQL reporting database. It is nil when the
// report DSN is not configured.
type Repository interface {
	Billing(ctx context.Context, f Filter) ([]BillingRow, Summary, error)
	Payments(ctx context.Context, f Filter) ([]PaymentRow, Summary, error)
	// MonthlyTransactionCounts returns the per-day counts (YYYY-MM-DD, already
	// in Asia/Makassar) for the caller mitra's VA prefix and the given month.
	MonthlyTransactionCounts(ctx context.Context, f Filter, from, to time.Time) (map[string]int64, error)
}

// LastLoginReader reads the caller's last successful login from the primary
// Postgres database (refresh_token_family). ErrNotFound when there is none.
type LastLoginReader interface {
	LastLogin(ctx context.Context, userID string) (LastLogin, error)
}

// MitraResolver maps the principal's mitra_id to its kode mitra. The client
// never supplies the mitra.
type MitraResolver interface {
	Kode(ctx context.Context, mitraID string) (string, error)
}
