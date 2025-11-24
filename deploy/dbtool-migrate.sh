#!/usr/bin/env bash
set -euo pipefail

# dbtool-migrate.sh
# Runs database migrations using dbtool
# Expects DATABASE_URL to be set in environment

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "Running database migrations..."

# Change to backend directory where migrations are located
cd "$(dirname "$0")/../backend"

# Run migrations using Go migrate tool.
# IMPORTANT: In CI matrix builds, GOOS/GOARCH may be set for cross-compilation.
# `go run` respects those vars, which can cause "exec format error" when trying to
# execute a non-native binary on the build host. Force native arch for migrations.
if [[ -f "db/migrate.go" ]]; then
  echo "Using Go migrate tool..."
  HOST_GOARCH="$(go env GOARCH)"
  HOST_GOOS="$(go env GOOS)"
  GOARCH="$HOST_GOARCH" GOOS="$HOST_GOOS" go run db/migrate.go -direction=up
else
  echo "ERROR: Migration tool not found at db/migrate.go"
  exit 1
fi

echo "Database migrations completed successfully"
