package application

import (
	"context"

	"govite/internal/kernel"
	"govite/internal/reports/domain"
)

// Service resolves the caller's mitra and delegates to the reporting
// repository. Repo is nil when REPORTS_MYSQL_DSN is unset.
type Service struct {
	Repo  domain.Repository
	Mitra domain.MitraResolver
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
