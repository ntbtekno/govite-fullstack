package infrastructure

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"govite/internal/kernel"
	"govite/internal/platform/postgres"
	"govite/internal/platform/postgres/store"
	"govite/internal/va/domain"
)

type Repository struct{ DB *postgres.DB }

func (r Repository) MitraKode(ctx context.Context, mitraID string) (string, error) {
	m, err := r.DB.Q(ctx).GetMitraByID(ctx, mitraID)
	if err != nil {
		return "", postgres.Err(err)
	}
	return m.KodeMitra, nil
}

func (r Repository) Insert(ctx context.Context, v domain.Request) error {
	var amount pgtype.Numeric
	if err := amount.Scan(v.Amount); err != nil {
		return err
	}
	err := r.DB.Q(ctx).CreateVARequest(ctx, store.CreateVARequestParams{
		ID: v.ID, MitraID: v.MitraID, CustomerNo: v.CustomerNo, TrxID: v.TrxID,
		VirtualAccountName: v.VirtualAccountName, RequestedVa: v.RequestedVA,
		ExternalID: v.ExternalID, Amount: amount, Currency: v.Currency, VaType: v.TrxType,
		ExpiredAt: v.ExpiredAt, Description: kernel.Ptr(v.Description), Phone: kernel.Ptr(v.Phone),
		GatewayStatus: v.GatewayStatus, AttemptedAt: v.AttemptedAt,
	})
	if postgres.IsUnique(err, "mitra_id_trx_id") {
		return domain.ErrTrxIDTaken
	}
	return err
}

func (r Repository) SaveResult(ctx context.Context, id, responseVA, responseCode, responseMessage, status, reference string, attemptedAt time.Time) error {
	return r.DB.Q(ctx).UpdateVARequestResult(ctx, store.UpdateVARequestResultParams{
		ID: id, ResponseVa: kernel.Ptr(responseVA), ResponseCode: kernel.Ptr(responseCode),
		ResponseMessage: kernel.Ptr(responseMessage), GatewayStatus: status,
		GatewayReference: kernel.Ptr(reference), AttemptedAt: attemptedAt,
	})
}
