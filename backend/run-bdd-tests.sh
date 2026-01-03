#!/bin/bash
# Helper script to run BDD tests with the correct DATABASE_URL

set -e  # Exit on any error

# PostgreSQL connection details for the test database
export DATABASE_URL="postgresql://postgres:IPyZ44XqFAcehHwSt6o9n65MVmdAWzENKKEXatGnoK2rmwZecu5yfuZmxDat9PW@localhost:54180/simple_social_test?sslmode=disable"

echo "==> Dropping and recreating test database schema..."
# Drop all tables to ensure clean state
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true

echo "==> Running migrations on test database..."
go run db/migrate.go -direction=up

echo "==> Running BDD tests..."
make -f Makefile.bdd bdd-test
