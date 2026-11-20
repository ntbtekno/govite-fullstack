#!/usr/bin/env bash
# Browser e2e: builds the API and admin, seeds a throwaway user into the test
# database, starts the API, then runs Playwright against the admin preview.
# Needs: docker compose up -d postgres_test   (from the repo root)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${E2E_API_PORT:-3010}"
export SUPER_ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:-e2e@app.local}"
export SUPER_ADMIN_PASSWORD="${SUPER_ADMIN_PASSWORD:-E2eSecret123!}"
# Non-production test hooks: a pinned captcha code and a throwaway mitra so the
# browser can sign in to both login forms.
export E2E_CAPTCHA_CODE="${E2E_CAPTCHA_CODE:-ABCDE}"
export E2E_MITRA_KODE="${E2E_MITRA_KODE:-010}"
export E2E_MITRA_USERNAME="${E2E_MITRA_USERNAME:-e2e-mitra}"
export E2E_MITRA_PASSWORD="${E2E_MITRA_PASSWORD:-E2eMitra123!}"
export API_PROXY_TARGET="http://localhost:$port"

cd "$root/be"
export DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:5436/app_test?sslmode=disable}"
# External reporting DB is absent in standard e2e; ensure empty DSN so reports endpoints
# answer 503 as expected by the unavailable state tests.
export REPORTS_MYSQL_DSN="${REPORTS_MYSQL_DSN:-}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(printf 's%.0s' {1..32})}"
export REFRESH_TOKEN_PEPPER="${REFRESH_TOKEN_PEPPER:-$(printf 'p%.0s' {1..16})}"
export PORTAL_SECRETS_ENCRYPTION_KEY="${PORTAL_SECRETS_ENCRYPTION_KEY:-e2e-encryption-key-do-not-use-in-production-32}"
export WEB_URL="http://localhost:4173" LOG_LEVEL=silent APP_PORT="$port"
export THROTTLE_LIMIT=100000 LOGIN_THROTTLE_LIMIT=100000 CAPTCHA_THROTTLE_LIMIT=100000
export SNAP_BASE_URL="http://127.0.0.1:18080" SNAP_CHANNEL_ID=02030
export SNAP_ADMIN_USERNAME="e2e-admin" SNAP_ADMIN_PASSWORD="e2e-admin-password"
go run "$root/scripts/fake-snap.go" >/dev/null 2>&1 & snap=$!
go build -o bin/api ./cmd/api
./bin/api migrate >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM mitra WHERE nama IN ('E2E Provisioned Mitra', 'E2E Portal Mitra')" >/dev/null
./bin/api seed >/dev/null

./bin/api & api=$!
trap 'kill $api $snap 2>/dev/null || true' EXIT
for _ in $(seq 30); do curl -sf "http://localhost:$port/api/v1/health" >/dev/null && break; sleep 1; done

cd "$root/fe"
pnpm --filter admin exec vite build >/dev/null
# Start Vite preview server for the admin app
pnpm --filter admin exec vite preview --port 4173 --host 127.0.0.1 >/dev/null &
preview=$!
trap 'kill $api $snap $preview 2>/dev/null || true' EXIT
# Wait for preview server to be ready
for _ in $(seq 30); do curl -sf "http://127.0.0.1:4173" >/dev/null && break; sleep 1; done

pnpm --filter e2e exec playwright test "$@"
