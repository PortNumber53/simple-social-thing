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

# Run migrations using Go migrate tool
if [[ -f "db/migrate.go" ]]; then
  echo "Using Go migrate tool..."
  go run db/migrate.go -direction=up
else
  echo "ERROR: Migration tool not found at db/migrate.go"
  exit 1
fi

echo "Database migrations completed successfully"
