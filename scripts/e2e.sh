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
export WEB_URL="http://localhost:4173" LOG_LEVEL=silent APP_PORT="$port"
export THROTTLE_LIMIT=100000 LOGIN_THROTTLE_LIMIT=100000 CAPTCHA_THROTTLE_LIMIT=100000
snap_secrets="$(mktemp -d)"
mkdir -m 700 "$snap_secrets/010"
printf '%s' '{"partnerId":"e2e-partner","clientId":"e2e-client"}' > "$snap_secrets/010/partner.json"
printf '%s' 'e2e-only-hmac-secret' > "$snap_secrets/010/hmac.secret"
openssl genrsa -out "$snap_secrets/010/private.pem" 2048 >/dev/null 2>&1
chmod 600 "$snap_secrets/010/partner.json" "$snap_secrets/010/hmac.secret" "$snap_secrets/010/private.pem"
export SNAP_BASE_URL="http://127.0.0.1:18080" SNAP_SECRETS_DIR="$snap_secrets" SNAP_CHANNEL_ID=02030
export SNAP_ADMIN_USERNAME="e2e-admin" SNAP_ADMIN_PASSWORD="e2e-admin-password"
go run "$root/scripts/fake-snap.go" >/dev/null 2>&1 & snap=$!
go build -o bin/api ./cmd/api
./bin/api migrate >/dev/null
./bin/api seed >/dev/null

./bin/api & api=$!
trap 'kill $api $snap 2>/dev/null || true; rm -rf "$snap_secrets"' EXIT
for _ in $(seq 30); do curl -sf "http://localhost:$port/api/v1/health" >/dev/null && break; sleep 1; done

cd "$root/fe"
pnpm --filter admin exec vite build >/dev/null
pnpm --filter e2e exec playwright test "$@"
