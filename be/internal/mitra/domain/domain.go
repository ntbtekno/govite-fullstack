package domain

import (
	"context"
	"time"

	"govite/internal/kernel"
)

const ProvisionStatusNeedsRepair = "NEEDS_REPAIR"

var (
	ErrNotFound          = kernel.E(kernel.NotFound, "MITRA_NOT_FOUND", "Mitra tidak ditemukan")
	ErrKodeMitraTaken    = kernel.E(kernel.Conflict, "KODE_MITRA_TAKEN", "Kode mitra sudah digunakan")
	ErrBundleExists      = kernel.E(kernel.Conflict, "BUNDLE_EXISTS", "Bundle mitra sudah ada")
	ErrSNAPNotConfigured = kernel.E(kernel.Unavailable, "SNAP_NOT_CONFIGURED", "SNAP gateway belum dikonfigurasi")
	ErrProvisionFailed   = kernel.E(kernel.Unavailable, "PROVISION_FAILED", "Gagal menyediakan kredensial mitra")
)

type Mitra struct {
	ID                 string    `json:"id"`
	KodeMitra          string    `json:"kodeMitra"`
	Nama               string    `json:"nama"`
	IsActive           bool      `json:"isActive"`
	CreatedAt          time.Time `json:"createdAt"`
	PartnerServiceID   string    `json:"partnerServiceId"`
	VAPrefix           string    `json:"vaPrefix"`
	BundlePath         string    `json:"bundlePath"`
	ProvisionStatus    string    `json:"provisionStatus"`
	ProvisionPartnerID *string   `json:"provisionPartnerId,omitempty"`
	ProvisionError     *string   `json:"provisionError,omitempty"`
}

type Filter struct{ Search *string }
type Changes struct {
	KodeMitra *string
	Nama      *string
	IsActive  *bool
}

type ProvisionInput struct {
	Nama             string
	PartnerServiceID string
	VAPrefix         string
	BranchCode       string
	CallbackURL      string
	RateLimitTier    string
	IPWhitelist      []string
}
type ProvisionResult struct {
	PartnerID string
	ClientID  string
}

// NeedsRepairError means gateway registration succeeded but portal persistence
// or bundle writing failed. The partner must not be registered again.
type NeedsRepairError struct {
	Mitra Mitra
	Cause error
}

func (e *NeedsRepairError) Error() string { return e.Cause.Error() }
func (e *NeedsRepairError) Unwrap() error { return e.Cause }

// ProvisionError carries the gateway partnerId after registration. It is safe
// to persist: it never contains HMAC/private-key material.
type ProvisionError struct {
	PartnerID string
	Detail    string
	Cause     error
}

func (e *ProvisionError) Error() string { return e.Detail }
func (e *ProvisionError) Unwrap() error { return e.Cause }

type Repository interface {
	Get(context.Context, string) (Mitra, error)
	List(context.Context, Filter, int32, int32) ([]Mitra, error)
	Count(context.Context, Filter) (int64, error)
	Create(context.Context, string, string, string, bool, string, string, string, string, *string, *string) error
	MarkNeedsRepair(context.Context, string, string, string) error
	GetByKode(context.Context, string) (Mitra, error)
	Update(context.Context, string, Changes) error
	SetActive(context.Context, string, bool) error
	RevokeSessions(context.Context, string) error
}

type Provisioner interface {
	Provision(context.Context, string, ProvisionInput) (ProvisionResult, error)
}
