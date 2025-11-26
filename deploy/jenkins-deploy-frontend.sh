#!/usr/bin/env bash
set -euo pipefail

# Deploys the frontend (Vite + Cloudflare Worker) to Cloudflare via Wrangler.
#
# Requirements:
# - CLOUDFLARE_API_TOKEN must be available in the environment (Jenkins credential or global env)
# - Jenkins should provide the application secrets listed in NOTES.md as env vars:
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
#   STRIPE_PUBLISHABLE_KEY, DATABASE_URL, XATA_API_KEY, XATA_DATABASE_URL
#
# This script:
# - installs frontend deps
# - sets worker secrets in Cloudflare (idempotent overwrite)
# - builds the frontend bundle
# - deploys worker + assets using wrangler.jsonc

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set. Configure it in Jenkins (recommended) or global env."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"

cd "${FRONTEND_DIR}"

echo "=== Frontend: npm ci ==="
npm ci --no-audit --no-fund

# Build-time (Vite) vars
export VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-${GOOGLE_CLIENT_ID:-}}"
export VITE_STRIPE_PUBLISHABLE_KEY="${VITE_STRIPE_PUBLISHABLE_KEY:-${STRIPE_PUBLISHABLE_KEY:-}}"

echo "=== Frontend: syncing Cloudflare Worker secrets ==="
put_secret() {
  local key="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "WARN: skipping secret ${key} (empty)"
    return 0
  fi
  # Wrangler reads CLOUDFLARE_API_TOKEN from environment.
  printf '%s' "$value" | npx --yes wrangler secret put "$key" --config wrangler.jsonc
}

put_secret "GOOGLE_CLIENT_ID" "${GOOGLE_CLIENT_ID:-}"
put_secret "GOOGLE_CLIENT_SECRET" "${GOOGLE_CLIENT_SECRET:-}"
put_secret "JWT_SECRET" "${JWT_SECRET:-}"
put_secret "STRIPE_SECRET_KEY" "${STRIPE_SECRET_KEY:-}"
put_secret "STRIPE_WEBHOOK_SECRET" "${STRIPE_WEBHOOK_SECRET:-}"
put_secret "DATABASE_URL" "${DATABASE_URL:-}"
put_secret "XATA_API_KEY" "${XATA_API_KEY:-}"
put_secret "XATA_DATABASE_URL" "${XATA_DATABASE_URL:-}"

echo "=== Frontend: build ==="
rm -rf dist
npm run build

echo "=== Frontend: deploy (wrangler) ==="
# Force ensures assets re-upload even if Wrangler believes nothing changed (helps recover from a bad/empty asset upload state).
npx --yes wrangler deploy --config wrangler.jsonc --force

echo "=== Frontend deploy complete ==="


