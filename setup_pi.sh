#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - 1-Click Installer & Setup for Raspberry Pi 5
# Sets up dependencies, virtualenv, hardware access, and Desktop 1-Click Launcher
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$PROJECT_DIR"

echo "====================================================================="
echo "   LASTMILE GUARD • RASPBERRY PI 5 ONE-CLICK SETUP INSTALLER         "
echo "====================================================================="
echo ""
echo "Target directory: $PROJECT_DIR"
echo ""

# 1. Update and install essential Raspberry Pi OS packages
echo "[1/5] Installing system packages & hardware dependencies..."
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        python3-serial \
        python3-gpiozero \
        python3-rpi.gpio \
        chromium-browser \
        curl \
        v4l-utils
else
    echo "[SKIP] Non-Debian system detected. Assuming package manager dependencies are satisfied."
fi

# 2. Setup Virtual Environment (with --system-site-packages for Picamera2 & GPIO)
echo "[2/5] Configuring Python Virtual Environment with hardware bindings..."
if [ ! -d "$PROJECT_DIR/venv" ]; then
    python3 -m venv --system-site-packages "$PROJECT_DIR/venv"
fi

"$PROJECT_DIR/venv/bin/python3" -m pip install --upgrade pip
"$PROJECT_DIR/venv/bin/python3" -m pip install -r "$PROJECT_DIR/requirements.txt"

# 3. Ensure executable permissions on all scripts
echo "[3/5] Granting executable permissions..."
chmod +x "$PROJECT_DIR/run.sh" || true
chmod +x "$PROJECT_DIR/setup_pi.sh" || true

# 4. Create Desktop 1-Click Launcher Shortcut
echo "[4/5] Creating Desktop 1-Click Launcher Shortcut..."
DESKTOP_DIR="$HOME/Desktop"
DESKTOP_FILE="$DESKTOP_DIR/LastMile_HUD.desktop"

if [ -d "$DESKTOP_DIR" ]; then
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=LastMile Guard HUD
GenericName=Automotive Delivery HUD
Comment=5.0" Multi-App Delivery HUD & 2-Phase Routing
Exec=$PROJECT_DIR/run.sh
Icon=applications-multimedia
Path=$PROJECT_DIR
Terminal=true
StartupNotify=true
Categories=Utility;Navigation;
EOF
    chmod +x "$DESKTOP_FILE"
    echo "[OK] Created Desktop shortcut: $DESKTOP_FILE"
fi

# 5. Summary
echo ""
echo "====================================================================="
echo "   🎉 INSTALLATION COMPLETE! RASPBERRY PI 5 IS READY TO LAUNCH       "
echo "====================================================================="
echo ""
echo "You can now launch the application in 2 ways:"
echo ""
echo "  👉 Option 1 (Double-Click): Double-click the 'LastMile Guard HUD' icon on your Desktop"
echo "  👉 Option 2 (Terminal):     cd $PROJECT_DIR && ./run.sh"
echo ""
echo "====================================================================="
echo ""

# Prompt to launch immediately
read -p "Would you like to start the HUD right now? [Y/n]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    exec "$PROJECT_DIR/run.sh"
fi
