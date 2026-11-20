-- +goose Up
ALTER TABLE "mitra"
    ADD COLUMN "connection_type" TEXT NOT NULL DEFAULT 'PORTAL_ONLY'
        CHECK (connection_type IN ('PORTAL_ONLY', 'HOST_TO_HOST')),
    ADD COLUMN "credentials_delivered" BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE "mitra"
    DROP COLUMN IF EXISTS "credentials_delivered",
    DROP COLUMN IF EXISTS "connection_type";
