-- +goose Up
CREATE TABLE "va_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mitra_id" TEXT NOT NULL REFERENCES "mitra"("id"),
    "customer_no" TEXT NOT NULL,
    "trx_id" TEXT NOT NULL,
    "virtual_account_name" TEXT NOT NULL,
    "requested_va" TEXT NOT NULL,
    "response_va" TEXT,
    "external_id" TEXT NOT NULL,
    "amount" NUMERIC(21,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "va_type" CHAR(1) NOT NULL,
    "expired_at" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "phone" TEXT,
    "response_code" TEXT,
    "response_message" TEXT,
    "gateway_status" TEXT NOT NULL,
    "gateway_reference" TEXT,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "va_requests_mitra_id_trx_id_key" UNIQUE ("mitra_id", "trx_id")
);

CREATE INDEX "va_requests_mitra_id_created_at_idx" ON "va_requests"("mitra_id", "created_at" DESC);

-- +goose Down
DROP TABLE IF EXISTS "va_requests";
