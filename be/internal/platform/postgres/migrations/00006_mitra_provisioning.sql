-- +goose Up
ALTER TABLE "mitra"
    ADD COLUMN "partner_service_id" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "va_prefix" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "bundle_path" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "provision_status" TEXT NOT NULL DEFAULT 'READY',
    ADD COLUMN "provision_partner_id" TEXT,
    ADD COLUMN "provision_error" TEXT;

-- +goose Down
ALTER TABLE "mitra"
    DROP COLUMN IF EXISTS "provision_error",
    DROP COLUMN IF EXISTS "provision_partner_id",
    DROP COLUMN IF EXISTS "provision_status",
    DROP COLUMN IF EXISTS "bundle_path",
    DROP COLUMN IF EXISTS "va_prefix",
    DROP COLUMN IF EXISTS "partner_service_id";
