package infrastructure

import (
	"context"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
	"govite/internal/platform/postgres"
	"govite/internal/platform/postgres/store"
)

type Repository struct {
	DB *postgres.DB
}

func (r Repository) toMitra(m store.Mitra) domain.Mitra {
	return domain.Mitra{
		ID:        m.ID,
		KodeMitra: m.KodeMitra,
		Nama:      m.Nama,
		IsActive:  m.IsActive,
		CreatedAt: m.CreatedAt,
	}
}

func (r Repository) Get(ctx context.Context, id string) (domain.Mitra, error) {
	row, err := r.DB.Q(ctx).GetMitraByID(ctx, id)
	if err != nil {
		if postgres.Err(err) == kernel.ErrNotFound {
			return domain.Mitra{}, domain.ErrNotFound
		}
		return domain.Mitra{}, err
	}
	return r.toMitra(row), nil
}

func (r Repository) List(ctx context.Context, f domain.Filter, limit, offset int32) ([]domain.Mitra, error) {
	rows, err := r.DB.Q(ctx).ListMitra(ctx, store.ListMitraParams{Search: f.Search, Lim: limit, Off: offset})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Mitra, len(rows))
	for i, x := range rows {
		out[i] = r.toMitra(x)
	}
	return out, nil
}

func (r Repository) Count(ctx context.Context, f domain.Filter) (int64, error) {
	return r.DB.Q(ctx).CountMitra(ctx, f.Search)
}

func (r Repository) Create(ctx context.Context, id, kode, nama string, isActive bool) error {
	err := r.DB.Q(ctx).CreateMitra(ctx, store.CreateMitraParams{ID: id, KodeMitra: kode, Nama: nama, IsActive: isActive})
	if postgres.IsUnique(err, "kode_mitra") {
		return domain.ErrKodeMitraTaken
	}
	return err
}

func (r Repository) Update(ctx context.Context, id string, c domain.Changes) error {
	err := r.DB.Q(ctx).UpdateMitra(ctx, store.UpdateMitraParams{ID: id, KodeMitra: c.KodeMitra, Nama: c.Nama, IsActive: c.IsActive})
	if postgres.IsUnique(err, "kode_mitra") {
		return domain.ErrKodeMitraTaken
	}
	return err
}

func (r Repository) SetActive(ctx context.Context, id string, active bool) error {
	return r.DB.Q(ctx).SetMitraActive(ctx, store.SetMitraActiveParams{ID: id, IsActive: active})
}
