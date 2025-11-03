#!/usr/bin/env bash
set -euo pipefail

# migrate_all.sh
# Wrapper script for database migrations
# Called by Jenkins - delegates to deploy/dbtool-migrate.sh

echo "=== Running Database Migrations ==="

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if XATA_DATABASE_URL is set
if [[ -z "${XATA_DATABASE_URL:-}" ]]; then
  echo "WARNING: XATA_DATABASE_URL is not set, skipping migrations"
  echo "To run migrations, set XATA_DATABASE_URL environment variable in Jenkins"
  exit 0
fi

# Run the migration script
bash "$PROJECT_ROOT/deploy/dbtool-migrate.sh"

echo "=== Migrations Complete ==="
