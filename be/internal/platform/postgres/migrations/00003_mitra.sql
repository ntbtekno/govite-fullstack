-- +goose Up
CREATE TABLE "mitra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kode_mitra" TEXT NOT NULL UNIQUE,
    "nama" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "user" ADD COLUMN "username" TEXT;
ALTER TABLE "user" ADD COLUMN "mitra_id" TEXT REFERENCES "mitra"("id");

CREATE UNIQUE INDEX "user_username_idx" ON "user"("username");
CREATE INDEX "user_mitra_id_idx" ON "user"("mitra_id");

-- +goose Down
DROP INDEX IF EXISTS "user_mitra_id_idx";
DROP INDEX IF EXISTS "user_username_idx";
ALTER TABLE "user" DROP COLUMN "mitra_id";
ALTER TABLE "user" DROP COLUMN "username";
DROP TABLE IF EXISTS "mitra";
