-- name: CreateMitra :exec
INSERT INTO "mitra" (id, kode_mitra, nama, is_active) VALUES ($1, $2, $3, $4);

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
  is_active = COALESCE(sqlc.narg(is_active), is_active)
WHERE id = sqlc.arg(id);

-- name: SetMitraActive :exec
UPDATE "mitra" SET is_active = $2 WHERE id = $1;
