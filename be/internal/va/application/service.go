package application

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	"govite/internal/kernel"
	"govite/internal/va/domain"
)

type Service struct {
	Repo    domain.Repository
	Gateway domain.Gateway
	Audit   kernel.Auditor
	Now     func() time.Time
	NewID   func() string
}

func (s *Service) Create(ctx context.Context, in domain.CreateRequest) (domain.PortalResult, error) {
	p := kernel.PrincipalFrom(ctx)
	if p.MitraID == "" {
		return domain.PortalResult{}, domain.ErrMitraRequired
	}
	if s.Gateway == nil || !s.Gateway.Enabled() {
		return domain.PortalResult{}, domain.ErrNotConfigured
	}
	kode, err := s.Repo.MitraKode(ctx, p.MitraID)
	if err != nil {
		return domain.PortalResult{}, err
	}
	now, newID := time.Now, kernel.NewID
	if s.Now != nil {
		now = s.Now
	}
	if s.NewID != nil {
		newID = s.NewID
	}
	in.MitraKode, in.PartnerServiceID, in.Currency = kode, kode, "IDR"
	in.ExternalID = externalID(newID())
	id, attemptedAt := newID(), now()
	if err := s.Repo.Insert(ctx, domain.Request{
		ID: id, MitraID: p.MitraID, CustomerNo: in.CustomerNo, TrxID: in.TrxID,
		VirtualAccountName: in.VirtualAccountName, RequestedVA: strings.Repeat(" ", 19-len(in.CustomerNo)) + in.CustomerNo,
		ExternalID: in.ExternalID, Amount: in.Amount, Currency: in.Currency, TrxType: in.TrxType,
		ExpiredAt: in.ExpiredDate, Description: in.Description, Phone: in.Phone,
		GatewayStatus: "SENDING", AttemptedAt: attemptedAt,
	}); err != nil {
		return domain.PortalResult{}, err
	}

	result, createErr := s.Gateway.CreateVA(ctx, in)
	if createErr != nil && shouldInquiry(createErr) {
		result, err = s.Gateway.InquiryVA(ctx, domain.InquiryRequest{MitraKode: kode, PartnerServiceID: kode, CustomerNo: in.CustomerNo, TrxID: in.TrxID})
		if err != nil || result.Status != "ACTIVE" {
			_ = s.saveFailure(ctx, id, createErr, attemptedAt)
			return domain.PortalResult{}, createErr
		}
		createErr = nil
	}
	if createErr != nil {
		_ = s.saveFailure(ctx, id, createErr, attemptedAt)
		return domain.PortalResult{}, createErr
	}
	if err := s.Repo.SaveResult(ctx, id, result.VirtualAccountNo, result.ResponseCode, result.ResponseMessage, result.Status, result.ReferenceNo, attemptedAt); err != nil {
		return domain.PortalResult{}, err
	}
	if s.Audit != nil {
		s.Audit.Record(ctx, "va.create", "va_request", id, nil, map[string]any{"mitraId": p.MitraID, "trxId": in.TrxID, "customerNo": in.CustomerNo, "virtualAccountNo": result.VirtualAccountNo, "status": result.Status})
	}
	return domain.PortalResult{ID: id, TrxID: in.TrxID, CustomerNo: in.CustomerNo, VirtualAccountNo: result.VirtualAccountNo, Status: result.Status, ReferenceNo: result.ReferenceNo}, nil
}

func (s *Service) saveFailure(ctx context.Context, id string, err error, at time.Time) error {
	code, message := domain.Code(err), err.Error()
	var ke *kernel.Error
	if errors.As(err, &ke) && ke.Detail != "" {
		message = ke.Detail
	}
	return s.Repo.SaveResult(ctx, id, "", code, message, "FAILED", "", at)
}

func shouldInquiry(err error) bool {
	if domain.Code(err) == domain.ErrServer.Code {
		return true
	}
	var netErr net.Error
	return errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr)
}

func externalID(id string) string {
	id = strings.ReplaceAll(id, "-", "")
	if len(id) > 16 {
		return id[:16]
	}
	return id
}
