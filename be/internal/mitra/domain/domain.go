package domain

import (
	"context"
	"time"

	"govite/internal/kernel"
)

var (
	ErrNotFound       = kernel.E(kernel.NotFound, "MITRA_NOT_FOUND", "Mitra tidak ditemukan")
	ErrKodeMitraTaken = kernel.E(kernel.Conflict, "KODE_MITRA_TAKEN", "Kode mitra sudah digunakan")
)

type Mitra struct {
	ID        string    `json:"id"`
	KodeMitra string    `json:"kodeMitra"`
	Nama      string    `json:"nama"`
	IsActive  bool      `json:"isActive"`
	CreatedAt time.Time `json:"createdAt"`
}

type Filter struct {
	Search *string
}

type Changes struct {
	KodeMitra *string
	Nama      *string
	IsActive  *bool
}

type Repository interface {
	Get(ctx context.Context, id string) (Mitra, error)
	List(ctx context.Context, f Filter, limit, offset int32) ([]Mitra, error)
	Count(ctx context.Context, f Filter) (int64, error)
	Create(ctx context.Context, id, kode, nama string, isActive bool) error
	Update(ctx context.Context, id string, c Changes) error
	SetActive(ctx context.Context, id string, active bool) error
	// RevokeSessions revokes every refresh family of the mitra's users, so a
	// deactivated mitra's tokens stop working immediately.
	RevokeSessions(ctx context.Context, mitraID string) error
}
