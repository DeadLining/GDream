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
COMFYUI_PORT="$(find_port "${AI_COMIC_COMFYUI_PORT:-7898}")"
COMFYUI_ROOT="${COMFYUI_ROOT:-$ROOT/.runtime/ComfyUI}"
COMFYUI_PYTHON="${COMFYUI_PYTHON:-$COMFYUI_ROOT/.venv/bin/python}"
COMFYUI_LOG="$ROOT/.runtime/comfyui.log"
COMFYUI_PUBLIC_URL="http://comfyui.localhost:$WEB_PORT"

if [[ ! -f "$COMFYUI_ROOT/main.py" || ! -x "$COMFYUI_PYTHON" ]]; then
  echo "ComfyUI runtime is not installed at $COMFYUI_ROOT" >&2
  echo "See docs/comfyui-local.md" >&2
  exit 1
fi

cleanup() {
  kill "${WEB_PID:-}" "${API_PID:-}" "${COMFYUI_PID:-}" 2>/dev/null || true
  wait "${WEB_PID:-}" "${API_PID:-}" "${COMFYUI_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$ROOT/.runtime"
(
  cd "$COMFYUI_ROOT"
  exec "$COMFYUI_PYTHON" main.py \
    --listen 127.0.0.1 \
    --port "$COMFYUI_PORT" \
    --disable-auto-launch \
    --enable-cors-header "$COMFYUI_PUBLIC_URL"
) >"$COMFYUI_LOG" 2>&1 &
COMFYUI_PID=$!

for _ in {1..60}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:$COMFYUI_PORT/system_stats" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$COMFYUI_PID" 2>/dev/null; then
    echo "ComfyUI exited during startup. See $COMFYUI_LOG" >&2
    tail -40 "$COMFYUI_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

if ! curl -fsS --max-time 2 "http://127.0.0.1:$COMFYUI_PORT/system_stats" >/dev/null 2>&1; then
  echo "ComfyUI startup timed out. See $COMFYUI_LOG" >&2
  exit 1
fi

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
    AI_COMIC_COMFYUI_PROXY_TARGET="http://127.0.0.1:$COMFYUI_PORT" \
    NEXT_PUBLIC_COMFYUI_URL="$COMFYUI_PUBLIC_URL" \
    npm run dev --workspace @comic-studio/web -- --hostname 127.0.0.1 --port "$WEB_PORT"
) &
WEB_PID=$!

echo "AI Comic Studio: http://127.0.0.1:$WEB_PORT"
echo "Embedded ComfyUI: $COMFYUI_PUBLIC_URL"
echo "API docs:        http://127.0.0.1:$API_PORT/docs"
wait "$API_PID" "$WEB_PID" "$COMFYUI_PID"
