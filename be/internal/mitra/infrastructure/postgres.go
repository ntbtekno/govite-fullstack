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
		ID:                   m.ID,
		KodeMitra:            m.KodeMitra,
		Nama:                 m.Nama,
		IsActive:             m.IsActive,
		CreatedAt:            m.CreatedAt,
		PartnerServiceID:     m.PartnerServiceID,
		VAPrefix:             m.VaPrefix,
		ProvisionStatus:      m.ProvisionStatus,
		ProvisionPartnerID:   m.ProvisionPartnerID,
		ProvisionError:       m.ProvisionError,
		ConnectionType:       m.ConnectionType,
		CredentialsDelivered: m.CredentialsDelivered,
		HMACSecretEncrypted:  m.HmacSecretEncrypted,
		PrivateKeyEncrypted:  m.PrivateKeyEncrypted,
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

func (r Repository) Create(ctx context.Context, id, kode, nama string, isActive bool, partnerServiceID, vaPrefix, bundlePath, status string, partnerID, provisionError *string, connectionType string, delivered bool, hmacSecretEncrypted, privateKeyEncrypted *string) error {
	err := r.DB.Q(ctx).CreateMitra(ctx, store.CreateMitraParams{ID: id, KodeMitra: kode, Nama: nama, IsActive: isActive, PartnerServiceID: partnerServiceID, VaPrefix: vaPrefix, BundlePath: bundlePath, ProvisionStatus: status, ProvisionPartnerID: partnerID, ProvisionError: provisionError, ConnectionType: connectionType, CredentialsDelivered: delivered, HmacSecretEncrypted: hmacSecretEncrypted, PrivateKeyEncrypted: privateKeyEncrypted})
	if postgres.IsUnique(err, "kode_mitra") {
		return domain.ErrKodeMitraTaken
	}
	return err
}

func (r Repository) MarkNeedsRepair(ctx context.Context, id, partnerID, provisionError string) error {
	return r.DB.Q(ctx).MarkMitraNeedsRepair(ctx, store.MarkMitraNeedsRepairParams{ID: id, ProvisionPartnerID: &partnerID, ProvisionError: &provisionError})
}

func (r Repository) MarkNeedsKeypair(ctx context.Context, id, partnerID, provisionError string) error {
	return r.DB.Q(ctx).MarkMitraNeedsKeypair(ctx, store.MarkMitraNeedsKeypairParams{ID: id, ProvisionPartnerID: &partnerID, ProvisionError: &provisionError})
}

func (r Repository) GetByKode(ctx context.Context, kode string) (domain.Mitra, error) {
	row, err := r.DB.Q(ctx).GetMitraByKode(ctx, kode)
	if err != nil {
		if postgres.Err(err) == kernel.ErrNotFound {
			return domain.Mitra{}, domain.ErrNotFound
		}
		return domain.Mitra{}, err
	}
	return r.toMitra(row), nil
}

func (r Repository) Update(ctx context.Context, id string, c domain.Changes) error {
	err := r.DB.Q(ctx).UpdateMitra(ctx, store.UpdateMitraParams{ID: id, KodeMitra: c.KodeMitra, Nama: c.Nama, IsActive: c.IsActive, ConnectionType: c.ConnectionType})
	if postgres.IsUnique(err, "kode_mitra") {
		return domain.ErrKodeMitraTaken
	}
	return err
}

func (r Repository) SetActive(ctx context.Context, id string, active bool) error {
	return r.DB.Q(ctx).SetMitraActive(ctx, store.SetMitraActiveParams{ID: id, IsActive: active})
}

func (r Repository) RevokeSessions(ctx context.Context, mitraID string) error {
	return r.DB.Q(ctx).RevokeMitraFamilies(ctx, &mitraID)
}

func (r Repository) MarkReady(ctx context.Context, id string, delivered bool) error {
	return r.DB.Q(ctx).MarkMitraReady(ctx, store.MarkMitraReadyParams{ID: id, CredentialsDelivered: delivered})
}

func (r Repository) SaveEncryptedCredentials(ctx context.Context, id, hmacSecretEncrypted, privateKeyEncrypted string) error {
	return r.DB.Q(ctx).SaveMitraEncryptedCredentials(ctx, store.SaveMitraEncryptedCredentialsParams{ID: id, HmacSecretEncrypted: &hmacSecretEncrypted, PrivateKeyEncrypted: &privateKeyEncrypted})
}

func (r Repository) GetEncryptedCredentials(ctx context.Context, id string) (hmacSecretEncrypted, privateKeyEncrypted string, err error) {
	row, err := r.DB.Q(ctx).GetMitraEncryptedCredentials(ctx, id)
	if err != nil {
		return "", "", err
	}
	if row.HmacSecretEncrypted != nil {
		hmacSecretEncrypted = *row.HmacSecretEncrypted
	}
	if row.PrivateKeyEncrypted != nil {
		privateKeyEncrypted = *row.PrivateKeyEncrypted
	}
	return hmacSecretEncrypted, privateKeyEncrypted, nil
}
