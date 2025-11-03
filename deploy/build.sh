#!/usr/bin/env bash
set -euo pipefail

# build.sh
# Builds the Go backend binary for the current architecture
# Used by Jenkins build pipeline

echo "=== Building Simple Social Thing Backend ==="

# Detect architecture if not set
if [[ -z "${GOARCH:-}" ]]; then
  GOARCH=$(go env GOARCH)
  echo "GOARCH not set, detected: $GOARCH"
fi

# Set build variables
export GOOS=linux
export CGO_ENABLED=0
export GO111MODULE=on

echo "Building for $GOOS/$GOARCH"

# Change to backend directory
cd "$(dirname "$0")/../backend"

# Build binary
OUTPUT="simple-social-thing-${GOOS}-${GOARCH}"
go build -ldflags="-s -w" -o "$OUTPUT" ./cmd/api

echo "Build complete: backend/$OUTPUT"
ls -lh "$OUTPUT"
