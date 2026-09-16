#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - 1-Click Launcher for Raspberry Pi 5 & Linux
# Automatically manages dependencies, clears ports, and opens in 5.0" Kiosk Mode
# ==============================================================================

set -e

# 1. Resolve project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$PROJECT_DIR"

echo "====================================================================="
echo "  LastMile Guard - 5.0\" Multi-App Delivery HUD Launcher (Pi 5)"
echo "====================================================================="
echo "Directory: $PROJECT_DIR"
echo ""

# 2. Kill any stale background processes on port 8000
echo "[CLEANUP] Freeing port 8000..."
if command -v fuser >/dev/null 2>&1; then
    fuser -k 8000/tcp >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
    lsof -ti :8000 | xargs -r kill -9 >/dev/null 2>&1 || true
fi
pkill -f "python3 main.py" >/dev/null 2>&1 || true
sleep 0.5

# 3. Detect / Setup Python environment
PY_BIN="python3"

if [ -f "$PROJECT_DIR/.venv/bin/python" ]; then
    PY_BIN="$PROJECT_DIR/.venv/bin/python"
    echo "[OK] Using Python venv: $PY_BIN"
elif [ -f "$PROJECT_DIR/.venv/bin/python3" ]; then
    PY_BIN="$PROJECT_DIR/.venv/bin/python3"
    echo "[OK] Using Python venv: $PY_BIN"
elif [ -f "$PROJECT_DIR/venv/bin/python3" ]; then
    PY_BIN="$PROJECT_DIR/venv/bin/python3"
    echo "[OK] Using Python venv: $PY_BIN"
elif [ -f "$PROJECT_DIR/venv/bin/python" ]; then
    PY_BIN="$PROJECT_DIR/venv/bin/python"
    echo "[OK] Using Python venv: $PY_BIN"
else
    # Check if dependencies exist in system python; if not, create venv
    if ! python3 -c "import fastapi, uvicorn, websockets" >/dev/null 2>&1; then
        echo "[SETUP] Creating Python virtual environment..."
        python3 -m venv --system-site-packages "$PROJECT_DIR/venv" || python3 -m venv "$PROJECT_DIR/venv"
        PY_BIN="$PROJECT_DIR/venv/bin/python3"
        echo "[SETUP] Installing dependencies..."
        "$PY_BIN" -m pip install --upgrade pip
        "$PY_BIN" -m pip install -r "$PROJECT_DIR/requirements.txt"
    fi
fi

# 4. Launch FastAPI Server in background
echo "[SERVER] Starting LastMile Guard backend on http://localhost:8000 ..."
"$PY_BIN" "$PROJECT_DIR/main.py" &
SERVER_PID=$!

# Ensure server terminates when this script exits
cleanup() {
    echo ""
    echo "[SHUTDOWN] Stopping LastMile Guard HUD (PID: $SERVER_PID)..."
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 5. Wait for server to become responsive
echo "[WAIT] Waiting for server startup..."
for i in {1..30}; do
    if curl -s http://localhost:8000/ >/dev/null 2>&1; then
        echo "[OK] Server is live!"
        break
    fi
    sleep 0.2
done

# 6. Launch Chromium Browser in 5.0" Kiosk / App Mode
echo "[DISPLAY] Launching Automotive 5.0\" HUD Screen..."

BROWSER_CMD=""
if command -v chromium-browser >/dev/null 2>&1; then
    BROWSER_CMD="chromium-browser"
elif command -v chromium >/dev/null 2>&1; then
    BROWSER_CMD="chromium"
elif command -v google-chrome >/dev/null 2>&1; then
    BROWSER_CMD="google-chrome"
elif command -v firefox >/dev/null 2>&1; then
    BROWSER_CMD="firefox"
fi

if [ -n "$BROWSER_CMD" ] && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
    if [ "$BROWSER_CMD" = "firefox" ]; then
        firefox --kiosk "http://localhost:8000" >/dev/null 2>&1 &
    else
        $BROWSER_CMD \
            --app="http://localhost:8000" \
            --window-size=800,480 \
            --window-position=0,0 \
            --start-fullscreen \
            --noerrdialogs \
            --disable-infobars \
            --check-for-update-interval=31536000 \
            --disable-features=TranslateUI \
            --disable-session-crashed-bubble \
            --kiosk \
            "http://localhost:8000" >/dev/null 2>&1 &
    fi
elif command -v xdg-open >/dev/null 2>&1 && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
    xdg-open "http://localhost:8000" >/dev/null 2>&1 &
else
    echo "[INFO] Running in terminal/headless mode. Open http://localhost:8000 in your browser."
fi

# 7. Keep server process in foreground
wait $SERVER_PID
