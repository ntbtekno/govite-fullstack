-- +goose Up
ALTER TABLE "mitra"
    ADD COLUMN "hmac_secret_encrypted" TEXT,
    ADD COLUMN "private_key_encrypted" TEXT;

-- +goose Down
ALTER TABLE "mitra"
    DROP COLUMN IF EXISTS "hmac_secret_encrypted",
    DROP COLUMN IF EXISTS "private_key_encrypted";
