#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="${AI_COMIC_E2E_RUNTIME_ROOT:-$ROOT/.runtime/e2e-real}"
API_PORT="${AI_COMIC_E2E_API_PORT:-8100}"
WEB_PORT="${AI_COMIC_E2E_WEB_PORT:-3100}"
PROVIDER_CHANNELS="${AI_COMIC_E2E_PROVIDER_CHANNELS_PATH:-$ROOT/data/provider-channels.json}"
PYTHON="${AI_COMIC_E2E_PYTHON:-}"
REUSE_RUNTIME="${AI_COMIC_E2E_REUSE_RUNTIME:-0}"
RESULT_PATH="${AI_COMIC_E2E_RESULT_PATH:-$RUNTIME_ROOT/result.json}"
API_LOG="$RUNTIME_ROOT/api.log"
WEB_LOG="$RUNTIME_ROOT/web.log"

if [[ -z "${AI_COMIC_E2E_PROVIDER_CHANNELS_PATH:-}" && ! -f "$PROVIDER_CHANNELS" ]]; then
  GIT_COMMON_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
  PROVIDER_CHANNELS="$(dirname "$GIT_COMMON_DIR")/data/provider-channels.json"
fi

if [[ ! -f "$PROVIDER_CHANNELS" ]]; then
  echo "Real-model E2E requires provider channels at: $PROVIDER_CHANNELS" >&2
  exit 1
fi
if [[ -z "$PYTHON" ]]; then
  for candidate in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12 python3; do
    if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import sqlite3, sys; assert sys.version_info >= (3, 12)' >/dev/null 2>&1; then
      PYTHON="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$PYTHON" ]] \
  || ! "$PYTHON" -c 'import sqlite3, sys; assert sys.version_info >= (3, 12)' >/dev/null 2>&1; then
  echo "Real-model E2E requires Python >=3.12 with sqlite3 support" >&2
  exit 1
fi
if lsof -iTCP:"$API_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Real-model E2E API port $API_PORT is already in use" >&2
  exit 1
fi
if lsof -iTCP:"$WEB_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Real-model E2E Web port $WEB_PORT is already in use" >&2
  exit 1
fi

if [[ "$REUSE_RUNTIME" != "1" ]]; then
  rm -rf "$RUNTIME_ROOT"
fi
mkdir -p "$RUNTIME_ROOT/data"

cleanup() {
  kill "${WEB_PID:-}" "${API_PID:-}" 2>/dev/null || true
  wait "${WEB_PID:-}" "${API_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT/services/api"
  AI_COMIC_DATABASE_URL="sqlite:///$RUNTIME_ROOT/studio.db" \
  AI_COMIC_DATA_ROOT="$RUNTIME_ROOT/data" \
  AI_COMIC_PROVIDER_CHANNELS_PATH="$PROVIDER_CHANNELS" \
  uv run --python "$PYTHON" uvicorn comic_studio.main:app --host 127.0.0.1 --port "$API_PORT"
) >"$API_LOG" 2>&1 &
API_PID=$!

for _ in {1..90}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:$API_PORT/api/projects" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Real-model E2E API exited during startup" >&2
    tail -80 "$API_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
curl -fsS --max-time 2 "http://127.0.0.1:$API_PORT/api/projects" >/dev/null

(
  cd "$ROOT/apps/web"
  AI_COMIC_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" \
    npm run dev -- --hostname 127.0.0.1 --port "$WEB_PORT"
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

for _ in {1..90}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:$WEB_PORT" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Real-model E2E Web exited during startup" >&2
    tail -80 "$WEB_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
curl -fsS --max-time 2 "http://127.0.0.1:$WEB_PORT" >/dev/null

echo "Real-model E2E Web: http://127.0.0.1:$WEB_PORT"
echo "Real-model E2E API: http://127.0.0.1:$API_PORT"
echo "Runtime artifacts: $RUNTIME_ROOT"

cd "$ROOT/apps/web"
AI_COMIC_E2E_REAL_MODELS=1 \
AI_COMIC_E2E_API_URL="http://127.0.0.1:$API_PORT" \
AI_COMIC_E2E_RESULT_PATH="$RESULT_PATH" \
E2E_PORT="$WEB_PORT" \
  npx playwright test e2e/real-theme-to-video.spec.ts \
    --project=desktop \
    --workers=1 \
    --reporter=line
