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

// Repository reads the external MySQL reporting database. It is nil when the
// report DSN is not configured.
type Repository interface {
	Billing(ctx context.Context, f Filter) ([]BillingRow, Summary, error)
	Payments(ctx context.Context, f Filter) ([]PaymentRow, Summary, error)
}

// MitraResolver maps the principal's mitra_id to its kode mitra. The client
// never supplies the mitra.
type MitraResolver interface {
	Kode(ctx context.Context, mitraID string) (string, error)
}
