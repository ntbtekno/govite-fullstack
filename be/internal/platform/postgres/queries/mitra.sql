-- name: CreateMitra :exec
INSERT INTO "mitra" (id, kode_mitra, nama, is_active, partner_service_id, va_prefix, bundle_path, provision_status, provision_partner_id, provision_error, connection_type, credentials_delivered, hmac_secret_encrypted, private_key_encrypted)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, sqlc.arg(connection_type)::text, sqlc.arg(credentials_delivered)::boolean, $11, $12);

-- name: GetMitraByID :one
SELECT * FROM "mitra" WHERE id = $1;

-- name: GetMitraByKode :one
SELECT * FROM "mitra" WHERE kode_mitra = $1;

-- name: ListMitra :many
SELECT * FROM "mitra"
WHERE (sqlc.narg(search)::text IS NULL OR nama ILIKE '%' || sqlc.narg(search) || '%' OR kode_mitra ILIKE '%' || sqlc.narg(search) || '%')
ORDER BY created_at DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: CountMitra :one
SELECT count(*) FROM "mitra"
WHERE (sqlc.narg(search)::text IS NULL OR nama ILIKE '%' || sqlc.narg(search) || '%' OR kode_mitra ILIKE '%' || sqlc.narg(search) || '%');

-- name: UpdateMitra :exec
UPDATE "mitra" SET
  kode_mitra = COALESCE(sqlc.narg(kode_mitra), kode_mitra),
  nama = COALESCE(sqlc.narg(nama), nama),
  is_active = COALESCE(sqlc.narg(is_active), is_active),
  connection_type = COALESCE(sqlc.narg(connection_type), connection_type),
  credentials_delivered = CASE
    WHEN sqlc.narg(connection_type)::text = 'HOST_TO_HOST' AND connection_type = 'PORTAL_ONLY' THEN FALSE
    ELSE credentials_delivered
  END
WHERE id = sqlc.arg(id);

-- name: SetMitraActive :exec
UPDATE "mitra" SET is_active = $2 WHERE id = $1;

-- name: MarkMitraNeedsRepair :exec
UPDATE "mitra"
SET provision_status = 'NEEDS_REPAIR', provision_partner_id = $2, provision_error = $3
WHERE id = $1;

-- name: MarkMitraReady :exec
UPDATE "mitra"
SET provision_status = 'READY', provision_error = NULL, credentials_delivered = $2
WHERE id = $1;

-- name: SaveMitraEncryptedCredentials :exec
UPDATE "mitra"
SET hmac_secret_encrypted = $2, private_key_encrypted = $3
WHERE id = $1;

-- name: GetMitraEncryptedCredentials :one
SELECT hmac_secret_encrypted, private_key_encrypted FROM "mitra" WHERE id = $1;

-- name: SeedMitraCredentials :exec
UPDATE "mitra"
SET partner_service_id = $2,
    va_prefix = $3,
    provision_status = 'READY',
    provision_partner_id = $4,
    hmac_secret_encrypted = $5,
    private_key_encrypted = $6
WHERE id = $1;
