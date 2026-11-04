-- name: ListUsers :many
SELECT sqlc.embed(u), r.name AS role_name
FROM "user" u JOIN role r ON r.id = u.role_id
WHERE (sqlc.narg(role_id)::text IS NULL OR u.role_id = sqlc.narg(role_id))
  AND (sqlc.narg(is_active)::bool IS NULL OR u.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(mitra_id)::text IS NULL OR u.mitra_id = sqlc.narg(mitra_id))
  AND (CASE WHEN sqlc.arg(deleted)::bool THEN u.deleted_at IS NOT NULL ELSE u.deleted_at IS NULL END)
  AND (sqlc.narg(search)::text IS NULL
       OR u.email ILIKE '%' || sqlc.narg(search) || '%'
       OR u.full_name ILIKE '%' || sqlc.narg(search) || '%')
ORDER BY
  CASE WHEN sqlc.arg(sort)::text = 'email' AND sqlc.arg(dir)::text = 'asc' THEN u.email END ASC,
  CASE WHEN sqlc.arg(sort) = 'email' AND sqlc.arg(dir) = 'desc' THEN u.email END DESC,
  CASE WHEN sqlc.arg(sort) = 'fullName' AND sqlc.arg(dir) = 'asc' THEN u.full_name END ASC NULLS LAST,
  CASE WHEN sqlc.arg(sort) = 'fullName' AND sqlc.arg(dir) = 'desc' THEN u.full_name END DESC NULLS LAST,
  CASE WHEN sqlc.arg(sort) = 'lastLoginAt' AND sqlc.arg(dir) = 'asc' THEN u.last_login_at END ASC NULLS LAST,
  CASE WHEN sqlc.arg(sort) = 'lastLoginAt' AND sqlc.arg(dir) = 'desc' THEN u.last_login_at END DESC NULLS LAST,
  CASE WHEN sqlc.arg(sort) = 'createdAt' AND sqlc.arg(dir) = 'asc' THEN u.created_at END ASC,
  CASE WHEN sqlc.arg(sort) = 'createdAt' AND sqlc.arg(dir) = 'desc' THEN u.created_at END DESC,
  CASE WHEN sqlc.arg(dir) = 'asc' THEN u.id END ASC,
  u.id DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: CountUsers :one
SELECT count(*) FROM "user" u
WHERE (sqlc.narg(role_id)::text IS NULL OR u.role_id = sqlc.narg(role_id))
  AND (sqlc.narg(is_active)::bool IS NULL OR u.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(mitra_id)::text IS NULL OR u.mitra_id = sqlc.narg(mitra_id))
  AND (CASE WHEN sqlc.arg(deleted)::bool THEN u.deleted_at IS NOT NULL ELSE u.deleted_at IS NULL END)
  AND (sqlc.narg(search)::text IS NULL
       OR u.email ILIKE '%' || sqlc.narg(search) || '%'
       OR u.full_name ILIKE '%' || sqlc.narg(search) || '%');

-- name: GetUser :one
SELECT sqlc.embed(u), r.name AS role_name, m.kode_mitra
FROM "user" u JOIN role r ON r.id = u.role_id LEFT JOIN mitra m ON m.id = u.mitra_id WHERE u.id = $1;

-- name: CreateUser :exec
INSERT INTO "user" (id, email, full_name, role_id, password_hash, mitra_id) VALUES ($1, $2, $3, $4, $5, sqlc.narg(mitra_id));

-- name: UpdateUser :exec
UPDATE "user" SET
  full_name = COALESCE(sqlc.narg(full_name), full_name),
  role_id = COALESCE(sqlc.narg(role_id), role_id),
  is_active = COALESCE(sqlc.narg(is_active), is_active),
  mitra_id = CASE WHEN sqlc.arg(set_mitra)::bool THEN sqlc.narg(mitra_id) ELSE mitra_id END
WHERE id = sqlc.arg(id);

-- name: SetUserDeleted :exec
UPDATE "user" SET deleted_at = sqlc.narg(deleted_at), is_active = sqlc.narg(deleted_at)::timestamptz IS NULL
WHERE id = sqlc.arg(id);

-- name: ExistingEmails :many
SELECT email FROM "user" WHERE email = ANY(@emails::text[]);

-- name: UpdateProfile :exec
UPDATE "user" SET full_name = $2 WHERE id = $1;

-- name: SetPushEnabled :exec
UPDATE "user" SET notification_push_enabled = $2 WHERE id = $1;
