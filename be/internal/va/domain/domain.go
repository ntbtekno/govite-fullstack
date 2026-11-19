// Package domain holds the Create VA vocabulary: the gateway port, the request
// and response shapes, and the typed gateway errors. It is framework-free and
// may only import kernel (see be/ARCHITECTURE.md).
package domain

import (
	"context"
	"errors"
	"time"

	"govite/internal/kernel"
)

// Portal-facing typed errors. The responseCode from the gateway is kept in
// Detail so a caller (and the audit log) sees exactly what the bank answered.
//
// Mapping follows the spec, Bagian 5.3: the portal decides from responseCode,
// never from the human message.
var (
	// ErrFormatInvalid is 4002701: a field is malformed. Fix the row; never retry.
	ErrFormatInvalid = kernel.E(kernel.Invalid, "VA_FORMAT_INVALID", "Gateway menolak format field")
	// ErrMandatoryMissing is 4002702: a required field is missing, expiredDate
	// is in the past, or CBS refused the business rule. Fix data or mark the
	// item as a business failure; the gateway message is kept.
	ErrMandatoryMissing = kernel.E(kernel.Invalid, "VA_MANDATORY_INVALID", "Field wajib hilang atau ditolak CBS")
	// ErrPartnerTokenMismatch is 4012700: the access token belongs to another
	// partner (usually X-PARTNER-ID filled with clientId). Fetch a new token.
	ErrPartnerTokenMismatch = kernel.E(kernel.Unauthenticated, "VA_PARTNER_TOKEN_MISMATCH", "Token tidak cocok dengan partner")
	// ErrBusinessSignature is 4012701: the business signature is invalid or the
	// token is no longer valid. Check the signature, the clock and token age.
	ErrBusinessSignature = kernel.E(kernel.Unauthenticated, "VA_SIGNATURE_INVALID", "Signature bisnis tidak sah atau token tidak valid")
	// ErrAlreadyPaid is 4092700: a VA for this trxId is already PAID. Treat the
	// bill as settled; do not recreate and do not change data.
	ErrAlreadyPaid = kernel.E(kernel.Conflict, "VA_ALREADY_PAID", "VA untuk trxId ini sudah dibayar")
	// ErrAlreadyActive is 4092701: a VA for this trxId is still ACTIVE. The VA
	// already exists; fetch it via inquiry, do not create a duplicate.
	ErrAlreadyActive = kernel.E(kernel.Conflict, "VA_ALREADY_ACTIVE", "VA untuk trxId ini masih aktif")
	// ErrServer is 5002700: gateway or CBS failure. No trxId change; follow the
	// retry rules (same trxId, new X-EXTERNAL-ID).
	ErrServer = kernel.E(kernel.Unavailable, "VA_GATEWAY_ERROR", "Gateway atau CBS gagal memproses")
	// ErrUnexpectedCode is any responseCode the portal does not model. Treated
	// as retryable by the caller, never as success.
	ErrUnexpectedCode = kernel.E(kernel.Unavailable, "VA_UNEXPECTED_CODE", "Gateway menjawab kode yang tidak dikenal")
	// ErrTokenRequest is a token endpoint failure the portal cannot classify
	// further (non-2007300 without a modelled code).
	ErrTokenRequest = kernel.E(kernel.Unauthenticated, "VA_TOKEN_REQUEST_FAILED", "Permintaan token ke gateway gagal")
	// ErrTokenSignatureRejected marks 4017300: the RSA signature on the token
	// request was rejected. This is a configuration/key problem, NOT a
	// transient error, so the client must not loop on it.
	ErrTokenSignatureRejected = kernel.E(kernel.Unauthenticated, "VA_TOKEN_SIGNATURE_REJECTED", "Signature RSA token ditolak gateway")
	// ErrNotConfigured is returned when the feature is off (SNAP_BASE_URL empty).
	ErrNotConfigured = kernel.E(kernel.Unavailable, "VA_NOT_CONFIGURED", "Gateway SNAP belum dikonfigurasi")
	// ErrCredentialsUnavailable is scoped to one mitra. A missing or malformed
	// bundle must not prevent other mitra or the process itself from operating.
	ErrCredentialsUnavailable = kernel.E(kernel.Unavailable, "VA_CREDENTIALS_UNAVAILABLE", "Kredensial SNAP mitra tidak tersedia")
	ErrMitraRequired          = kernel.E(kernel.Forbidden, "VA_MITRA_REQUIRED", "Pembuatan VA hanya tersedia untuk pengguna mitra")
	ErrTrxIDTaken             = kernel.E(kernel.Conflict, "VA_TRX_ID_TAKEN", "trxId sudah digunakan oleh mitra")
)

// Code returns the gateway error code carried by err, or "" when err is not a
// portal error. The typed errors above gain a Detail from the gateway message
// (a WithDetail copy), so identity comparison would fail; compare by code
// instead, which is what the portal and the audit trail actually key on.
func Code(err error) string {
	var ke *kernel.Error
	if errors.As(err, &ke) {
		return ke.Code
	}
	return ""
}

// RetryableError wraps a transient failure and carries how long the caller
// should wait before the next attempt (from Retry-After on a 429, or zero when
// the gateway gave no hint). Is reports whether err is one.
type RetryableError struct {
	Cause   error
	RetryIn time.Duration
}

func (e *RetryableError) Error() string             { return e.Cause.Error() }
func (e *RetryableError) Unwrap() error             { return e.Cause }
func (e *RetryableError) RetryAfter() time.Duration { return e.RetryIn }

// RateLimited builds a retryable error for a 429, honouring Retry-After when
// the gateway sent it.
func RateLimited(retryIn time.Duration) *RetryableError {
	return &RetryableError{Cause: ErrRateLimited, RetryIn: retryIn}
}

// ErrRateLimited is 429: too many requests. Always wrapped in RetryableError
// so the caller can throttle instead of failing the item outright.
var ErrRateLimited = kernel.E(kernel.Unavailable, "VA_RATE_LIMITED", "Batas laju gateway terlampaui")

// CreateRequest is one VA to create. It is the portal's business input; the
// client turns it into the exact gateway body (fill left-pad, minify, sign).
type CreateRequest struct {
	// MitraKode selects the caller-owned credential bundle. It is resolved from
	// the authenticated principal, never accepted from portal input.
	MitraKode string
	// PartnerServiceID is per mitra: the caller derives it from the mitra kode.
	PartnerServiceID   string
	ExternalID         string
	CustomerNo         string
	VirtualAccountName string
	TrxID              string
	// Amount is a decimal string with two fraction digits, e.g. "150000.00".
	Amount   string
	Currency string
	// TrxType is "F" (full) or "P" (partial).
	TrxType string
	// ExpiredDate must be in the future; ISO 8601 with offset.
	ExpiredDate time.Time
	Description string
	Phone       string
}

type InquiryRequest struct {
	MitraKode        string
	PartnerServiceID string
	CustomerNo       string
	TrxID            string
}

// CreateResult is the validated success shape. Success is 2002700 with status
// ACTIVE only; VirtualAccountNo is the official number from the response.
type CreateResult struct {
	ResponseCode     string
	ResponseMessage  string
	VirtualAccountNo string
	CustomerNo       string
	TrxID            string
	ReferenceNo      string
	Status           string
	Raw              []byte
}

type Request struct {
	ID, MitraID, CustomerNo, TrxID, VirtualAccountName string
	RequestedVA, ExternalID, Amount, Currency, TrxType string
	ExpiredAt                                          time.Time
	Description, Phone                                 string
	GatewayStatus                                      string
	AttemptedAt                                        time.Time
}

type PortalResult struct {
	ID               string `json:"id"`
	TrxID            string `json:"trxId"`
	CustomerNo       string `json:"customerNo"`
	VirtualAccountNo string `json:"virtualAccountNo"`
	Status           string `json:"status"`
	ReferenceNo      string `json:"referenceNo,omitempty"`
}

type Repository interface {
	MitraKode(ctx context.Context, mitraID string) (string, error)
	Insert(ctx context.Context, request Request) error
	SaveResult(ctx context.Context, id, responseVA, responseCode, responseMessage, status, reference string, attemptedAt time.Time) error
}

// Gateway is the port application uses. The infrastructure package implements
// it against the SNAP HTTP API; tests implement it as a fake.
type Gateway interface {
	// CreateVA creates one VA. The request is signed and sent as-is; a non
	// 2002700/ACTIVE answer becomes a typed error (see the package errors).
	CreateVA(ctx context.Context, req CreateRequest) (CreateResult, error)
	InquiryVA(ctx context.Context, req InquiryRequest) (CreateResult, error)
	// Enabled reports whether the gateway is configured.
	Enabled() bool
}
