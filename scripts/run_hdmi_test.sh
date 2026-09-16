#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Raspberry Pi 5 HDMI Monitor Kiosk Launcher
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "====================================================="
echo "   Launching LastMile Guard on Raspberry Pi 5 HDMI   "
echo "====================================================="

# Activate virtual environment if present
if [ -d "$DIR/.venv" ]; then
    source "$DIR/.venv/bin/activate"
fi

# Launch backend engine
python3 main.py &
SERVER_PID=$!

echo "[HDMI LAUNCHER] Backend started (PID: $SERVER_PID). Waiting 2s for UI to bind..."
sleep 2

# Check for Chromium to launch fullscreen kiosk mode on HDMI display
if command -v chromium-browser &> /dev/null; then
    chromium-browser --kiosk --incognito --disable-pinch --overscroll-history-navigation=0 http://localhost:8000 &
elif command -v chromium &> /dev/null; then
    chromium --kiosk --incognito --disable-pinch --overscroll-history-navigation=0 http://localhost:8000 &
else
    echo "[NOTICE] Chromium not found. You can view the HUD from any browser at http://localhost:8000 or http://$(hostname -I | awk '{print $1}'):8000"
fi

# Wait for backend process
wait $SERVER_PID
