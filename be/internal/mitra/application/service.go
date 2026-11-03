package application

import (
	"context"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
)

type Service struct {
	Repo  domain.Repository
	Tx    kernel.Tx
	Audit kernel.Auditor
}

func (s *Service) List(ctx context.Context, f domain.Filter, limit, offset int32) ([]domain.Mitra, int64, error) {
	rows, err := s.Repo.List(ctx, f, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.Repo.Count(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (s *Service) Get(ctx context.Context, id string) (domain.Mitra, error) {
	return s.Repo.Get(ctx, id)
}

type CreateInput struct {
	KodeMitra string `json:"kodeMitra" validate:"required,min=1,max=50"`
	Nama      string `json:"nama" validate:"required,min=1,max=200"`
}

func (s *Service) Create(ctx context.Context, in CreateInput) (domain.Mitra, error) {
	id := kernel.NewID()
	if err := s.Repo.Create(ctx, id, in.KodeMitra, in.Nama, true); err != nil {
		return domain.Mitra{}, err
	}
	return s.Repo.Get(ctx, id)
}

type UpdateInput struct {
	KodeMitra *string `json:"kodeMitra" validate:"omitempty,min=1,max=50"`
	Nama      *string `json:"nama" validate:"omitempty,min=1,max=200"`
	IsActive  *bool   `json:"isActive"`
}

func (s *Service) Update(ctx context.Context, id string, in UpdateInput) (domain.Mitra, error) {
	before, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	c := domain.Changes{KodeMitra: in.KodeMitra, Nama: in.Nama, IsActive: in.IsActive}
	if err := s.Repo.Update(ctx, id, c); err != nil {
		return domain.Mitra{}, err
	}
	after, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	s.Audit.Record(ctx, "mitra.update", "mitra", id, before, after)
	return after, nil
}

type ActiveInput struct {
	IsActive bool `json:"isActive"`
}

func (s *Service) SetActive(ctx context.Context, id string, in ActiveInput) (domain.Mitra, error) {
	before, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	if err := s.Repo.SetActive(ctx, id, in.IsActive); err != nil {
		return domain.Mitra{}, err
	}
	after, err := s.Repo.Get(ctx, id)
	if err != nil {
		return domain.Mitra{}, err
	}
	s.Audit.Record(ctx, "mitra.set_active", "mitra", id, before, after)
	return after, nil
}
