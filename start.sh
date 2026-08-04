#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT=3848
URL="http://127.0.0.1:${PORT}/"
PID_FILE=".dock.pid"
LOG_FILE=".dock.log"

usage() {
  echo "Usage: ./start.sh [foreground|background|stop|status]"
  echo "  foreground  — run in the current terminal (default)"
  echo "  background  — background process + open browser"
  echo "  stop        — stop the background process"
  echo "  status      — check whether the server is running"
}

is_running() {
  curl -s -o /dev/null "$URL" 2>/dev/null
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  return 1
}

start_foreground() {
  NODE=$(find_node) || { echo "Node.js not found. Install from https://nodejs.org"; exit 1; }
  echo "Dock → $URL"
  exec "$NODE" server.js
}

start_background() {
  NODE=$(find_node) || { echo "Node.js not found."; exit 1; }
  if is_running; then
    echo "Server already running"
  else
    echo "Starting in background…"
    nohup "$NODE" server.js >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    sleep 1
  fi
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  else
    echo "Open $URL in your browser"
  fi
}

stop_background() {
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill "$PID" 2>/dev/null; then
      echo "Stopped PID $PID"
    fi
    rm -f "$PID_FILE"
  fi
  echo "Done"
}

MODE="${1:-foreground}"

case "$MODE" in
  foreground|"") start_foreground ;;
  background|bg) start_background ;;
  stop) stop_background ;;
  status)
    if is_running; then echo "Running: $URL"; else echo "Not running"; fi
    ;;
  -h|--help|help) usage ;;
  *) echo "Unknown mode: $MODE"; usage; exit 1 ;;
esac
