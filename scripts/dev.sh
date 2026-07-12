#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_port() {
  local port="$1"
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "$port"
}

API_PORT="$(find_port 8000)"
WEB_PORT="$(find_port 3000)"

cleanup() {
  kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT/services/api"
  API_ARGS=(comic_studio.main:app --host 127.0.0.1 --port "$API_PORT")
  if [[ "${AI_COMIC_API_RELOAD:-0}" == "1" ]]; then
    API_ARGS+=(--reload)
  fi
  uv run uvicorn "${API_ARGS[@]}"
) &
API_PID=$!

(
  cd "$ROOT"
  AI_COMIC_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" \
    npm run dev --workspace @comic-studio/web -- --hostname 127.0.0.1 --port "$WEB_PORT"
) &
WEB_PID=$!

echo "AI Comic Studio: http://127.0.0.1:$WEB_PORT"
echo "API docs:        http://127.0.0.1:$API_PORT/docs"
wait "$API_PID" "$WEB_PID"
