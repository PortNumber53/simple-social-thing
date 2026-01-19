#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"

git config core.hooksPath "$ROOT_DIR/.githooks"

chmod +x "$ROOT_DIR/.githooks/pre-commit" "$ROOT_DIR/.githooks/pre-push" || true

echo "Git hooks enabled via core.hooksPath=$ROOT_DIR/.githooks"
echo "Hooks installed: pre-commit, pre-push"
