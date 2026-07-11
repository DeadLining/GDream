#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT/services/api"
  uv run uvicorn comic_studio.main:app --host 127.0.0.1 --port 8000 --reload
) &
API_PID=$!

(
  cd "$ROOT"
  npm run dev --workspace @comic-studio/web -- --hostname 127.0.0.1 --port 3000
) &
WEB_PID=$!

echo "AI Comic Studio: http://127.0.0.1:3000"
echo "API docs:        http://127.0.0.1:8000/docs"
wait "$API_PID" "$WEB_PID"
