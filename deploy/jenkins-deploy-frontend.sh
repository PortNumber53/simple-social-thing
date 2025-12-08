#!/usr/bin/env bash
set -euo pipefail

# Deploys the frontend (Vite + Cloudflare Worker) to Cloudflare via Wrangler.
#
# Requirements:
# - CLOUDFLARE_API_TOKEN must be available in the environment (Jenkins credential or global env)
# - Jenkins should provide the application secrets listed in NOTES.md as env vars:
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
#   STRIPE_PUBLISHABLE_KEY, DATABASE_URL
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

require_env() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "ERROR: required env var ${key} is not set (check Jenkins credentials wiring)"
    exit 1
  fi
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"

cd "${FRONTEND_DIR}"

echo "=== Frontend: npm ci ==="
npm ci --no-audit --no-fund

# Build-time (Vite) vars
export VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-${GOOGLE_CLIENT_ID:-}}"
export VITE_STRIPE_PUBLISHABLE_KEY="${VITE_STRIPE_PUBLISHABLE_KEY:-${STRIPE_PUBLISHABLE_KEY:-}}"

echo "=== Frontend: syncing Cloudflare Worker secrets ==="
# Default to syncing secrets on deploy; set SYNC_SECRETS=false to skip.
SYNC_SECRETS="${SYNC_SECRETS:-true}"
put_secret() {
  local key="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "WARN: skipping secret ${key} (empty)"
    return 0
  fi
  printf '%s' "$value" | npx --yes wrangler secret put "$key" --config wrangler.jsonc --silent
}

# Require OAuth/provider secrets we actively use in production flows.
require_env "GOOGLE_CLIENT_ID"
require_env "GOOGLE_CLIENT_SECRET"
require_env "INSTAGRAM_APP_ID"
require_env "INSTAGRAM_APP_SECRET"
require_env "TIKTOK_CLIENT_KEY"
require_env "TIKTOK_CLIENT_SECRET"
require_env "PINTEREST_CLIENT_ID"
require_env "PINTEREST_CLIENT_SECRET"
require_env "FACEBOOK_WEBHOOK_TOKEN"
require_env "BACKEND_ORIGIN"

if [[ "${SYNC_SECRETS}" == "true" ]]; then
  echo "Syncing secrets via wrangler secret put..."
  put_secret "GOOGLE_CLIENT_ID" "${GOOGLE_CLIENT_ID:-}"
  put_secret "GOOGLE_CLIENT_SECRET" "${GOOGLE_CLIENT_SECRET:-}"
  put_secret "INSTAGRAM_APP_ID" "${INSTAGRAM_APP_ID:-}"
  put_secret "INSTAGRAM_APP_SECRET" "${INSTAGRAM_APP_SECRET:-}"
  put_secret "TIKTOK_CLIENT_KEY" "${TIKTOK_CLIENT_KEY:-}"
  put_secret "TIKTOK_CLIENT_SECRET" "${TIKTOK_CLIENT_SECRET:-}"
  put_secret "PINTEREST_CLIENT_ID" "${PINTEREST_CLIENT_ID:-}"
  put_secret "PINTEREST_CLIENT_SECRET" "${PINTEREST_CLIENT_SECRET:-}"
  put_secret "BACKEND_ORIGIN" "${BACKEND_ORIGIN:-}"
  put_secret "FACEBOOK_WEBHOOK_TOKEN" "${FACEBOOK_WEBHOOK_TOKEN:-}"
  put_secret "JWT_SECRET" "${JWT_SECRET:-}"
  put_secret "STRIPE_SECRET_KEY" "${STRIPE_SECRET_KEY:-}"
  put_secret "STRIPE_WEBHOOK_SECRET" "${STRIPE_WEBHOOK_SECRET:-}"
  put_secret "DATABASE_URL" "${DATABASE_URL:-}"
  put_secret "THREADS_OAUTH_BASE" "${THREADS_OAUTH_BASE:-}"
else
  echo "Skipping secret sync (set SYNC_SECRETS=true to update secrets and accept extra deployments)."
fi

echo "=== Frontend: build ==="
rm -rf dist
npm run build

echo "=== Frontend: deploy (wrangler) ==="
# When `@cloudflare/vite-plugin` is enabled, it can emit the client bundle under `dist/client/`.
# The assets binding must point at the directory that contains `index.html` at its root.
ASSETS_DIR="dist"
if [[ -f "dist/client/index.html" ]]; then
  ASSETS_DIR="dist/client"
fi
if [[ ! -f "${ASSETS_DIR}/index.html" ]]; then
  echo "ERROR: expected ${ASSETS_DIR}/index.html but it does not exist"
  echo "Contents of dist/:"
  ls -lah dist || true
  echo "Contents of dist/client/:"
  ls -lah dist/client || true
  exit 1
fi

npx --yes wrangler deploy --config wrangler.jsonc --assets "${ASSETS_DIR}"

echo "=== Frontend deploy complete ==="
