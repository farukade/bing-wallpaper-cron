#!/usr/bin/env bash
# Starts bing-wallpaper-cron in a detached (background) state, then exits.
# Add this script to macOS Login Items (System Settings → General → Login Items & Extensions)
# or run it manually. Safe to keep alongside the LaunchAgent (setup.js).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node)"
LOG_FILE="$APP_DIR/autostart.log"

if [[ -z "$NODE_BIN" ]]; then
  echo "❌ Node.js not found. Install Node.js first." >&2
  exit 1
fi

# Avoid starting a second instance if one is already running
if pgrep -f "$APP_DIR/index.js" >/dev/null 2>&1; then
  echo "ℹ️  bing-wallpaper is already running (PID $(pgrep -f "$APP_DIR/index.js" | head -1))."
  exit 0
fi

nohup "$NODE_BIN" "$APP_DIR/index.js" >> "$LOG_FILE" 2>&1 &
disown

echo "✅ Started bing-wallpaper in detached mode."
echo "   Log: $LOG_FILE"
