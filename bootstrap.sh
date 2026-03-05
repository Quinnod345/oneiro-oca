#!/usr/bin/env bash
# OCA bootstrap: install dependencies, initialize DB, run migrations, build sensory binary.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

echo "[bootstrap] checking prerequisites..."
require_cmd node
require_cmd npm
require_cmd psql
require_cmd createdb
require_cmd swift

DB_URL="${DATABASE_URL:-postgres://localhost/oneiro}"
DB_NAME_FROM_URL="${DB_URL##*/}"
DB_NAME="${DB_NAME_FROM_URL%%\?*}"

echo "[bootstrap] installing npm dependencies..."
npm install

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
  echo "[bootstrap] created .env from .env.example"
fi

echo "[bootstrap] ensuring database exists (${DB_NAME})..."
createdb "$DB_NAME" 2>/dev/null || true

echo "[bootstrap] enabling pgvector extension..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "[bootstrap] running migrations..."
for f in migrations/*.sql; do
  echo "  -> $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "[bootstrap] building Swift sensory binary..."
(
  cd sensory/swift
  swift build
)

if [ ! -f "sensory/swift/.build/debug/oneiro-sensory" ]; then
  echo "[bootstrap] failed: expected sensory/swift/.build/debug/oneiro-sensory"
  exit 1
fi

echo
echo "[bootstrap] complete."
echo "Next steps:"
echo "  1) Edit .env and add ANTHROPIC_API_KEY + OPENAI_API_KEY"
echo "  2) Start OCA: npm start"
