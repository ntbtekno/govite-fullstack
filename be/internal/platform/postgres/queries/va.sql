-- name: CreateVARequest :exec
INSERT INTO va_requests (
  id, mitra_id, customer_no, trx_id, virtual_account_name, requested_va,
  external_id, amount, currency, va_type, expired_at, description, phone,
  gateway_status, attempted_at
) VALUES (
  sqlc.arg(id), sqlc.arg(mitra_id), sqlc.arg(customer_no), sqlc.arg(trx_id),
  sqlc.arg(virtual_account_name), sqlc.arg(requested_va), sqlc.arg(external_id),
  CAST(sqlc.arg(amount) AS numeric), sqlc.arg(currency), sqlc.arg(va_type),
  sqlc.arg(expired_at), sqlc.narg(description), sqlc.narg(phone),
  sqlc.arg(gateway_status), sqlc.arg(attempted_at)
);

-- name: UpdateVARequestResult :exec
UPDATE va_requests SET response_va = $2, response_code = $3, response_message = $4,
  gateway_status = $5, gateway_reference = $6, attempted_at = $7,
  updated_at = CURRENT_TIMESTAMP
WHERE id = $1;
