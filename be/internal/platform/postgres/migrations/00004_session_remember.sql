-- +goose Up
-- remember: whether this login chose "Ingat saya". It decides the refresh
-- token lifetime (7d vs one idle window) and is kept per family so rotations
-- and the absolute session cap measure the same session.
ALTER TABLE "refresh_token_family" ADD COLUMN "remember" BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE "refresh_token_family" DROP COLUMN "remember";
