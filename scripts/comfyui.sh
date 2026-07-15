#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFY_ROOT="${COMFYUI_ROOT:-$ROOT/.runtime/ComfyUI}"
PYTHON="${COMFYUI_PYTHON:-$COMFY_ROOT/.venv/bin/python}"
HOST="${COMFYUI_HOST:-127.0.0.1}"
PORT="${COMFYUI_PORT:-7898}"
WEB_ORIGIN="${AI_COMIC_WEB_ORIGIN:-http://comfyui.localhost:3000}"
PID_FILE="$ROOT/.runtime/comfyui.pid"
LOG_FILE="$ROOT/.runtime/comfyui.log"

listener_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1
}

owned_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null)"
  grep -F -- "$PYTHON" <<<"$command" >/dev/null
  grep -F -- "main.py --listen $HOST --port $PORT" <<<"$command" >/dev/null
  printf '%s\n' "$pid"
}

require_runtime() {
  if [[ ! -f "$COMFY_ROOT/main.py" || ! -x "$PYTHON" ]]; then
    echo "ComfyUI runtime is not installed at $COMFY_ROOT" >&2
    exit 1
  fi
}

status() {
  local pid
  if pid="$(owned_pid)"; then
    echo "ComfyUI is running: pid=$pid url=http://$HOST:$PORT/"
    return 0
  fi
  if pid="$(listener_pid)"; then
    echo "Port $PORT is occupied by another process: pid=$pid" >&2
    return 2
  fi
  echo "ComfyUI is stopped"
  return 1
}

start() {
  require_runtime
  mkdir -p "$ROOT/.runtime"
  if status >/dev/null 2>&1; then
    status
    return 0
  fi
  local occupied
  if occupied="$(listener_pid)"; then
    echo "Cannot start ComfyUI: port $PORT is occupied by pid $occupied" >&2
    ps -p "$occupied" -o command= >&2 || true
    exit 2
  fi
  (
    cd "$COMFY_ROOT"
    nohup "$PYTHON" main.py \
      --listen "$HOST" \
      --port "$PORT" \
      --disable-auto-launch \
      --enable-cors-header "$WEB_ORIGIN" \
      >"$LOG_FILE" 2>&1 &
    echo "$!" >"$PID_FILE"
  )
  local pid
  pid="$(cat "$PID_FILE")"
  for _ in {1..60}; do
    if curl -fsS --max-time 1 "http://$HOST:$PORT/system_stats" >/dev/null 2>&1; then
      echo "ComfyUI started: pid=$pid url=http://$HOST:$PORT/"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "ComfyUI exited during startup. See $LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
  done
  echo "ComfyUI startup timed out. See $LOG_FILE" >&2
  exit 1
}

stop() {
  local pid
  if ! pid="$(owned_pid)"; then
    rm -f "$PID_FILE"
    echo "No project-owned ComfyUI process is running"
    return 0
  fi
  kill "$pid"
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "ComfyUI stopped"
      return 0
    fi
    sleep .25
  done
  echo "ComfyUI did not stop cleanly: pid=$pid" >&2
  exit 1
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  run)
    require_runtime
    cd "$COMFY_ROOT"
    exec "$PYTHON" main.py --listen "$HOST" --port "$PORT" --disable-auto-launch --enable-cors-header "$WEB_ORIGIN"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|run}" >&2
    exit 64
    ;;
esac
