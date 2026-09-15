#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Raspberry Pi 5 Tauri v2 & Rust Native Setup Installer
# Installs WebKit2GTK, Rust toolchain, SQLite, compiles HUD, and sets up touch
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$PROJECT_DIR"

echo "====================================================================="
echo "  LASTMILE GUARD • TAURI v2 + RUST NATIVE SETUP (RASPBERRY PI 5)     "
echo "====================================================================="
echo "Target directory: $PROJECT_DIR"
echo ""

# 1. System packages for Tauri v2 & WebKit on Debian Bookworm / Ubuntu
echo "[1/5] Installing Tauri v2 Linux dependencies (WebKit2GTK, SQLite, xinput)..."
sudo apt-get update -y
sudo apt-get install -y \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsqlite3-dev \
    xinput \
    xdotool

# 2. Install Rust Toolchain if not present
echo "[2/5] Verifying Rust toolchain..."
if ! command -v cargo >/dev/null 2>&1; then
    echo "[SETUP] Installing official Rust toolchain via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "[OK] Rust $(rustc --version) detected."
fi

# 3. Setup Hardware Touch Calibration
echo "[3/5] Setting up Touchscreen Inverted Axis Calibration..."
chmod +x "$PROJECT_DIR/scripts/setup_touch_calibration.sh"
sudo "$PROJECT_DIR/scripts/setup_touch_calibration.sh" --install-service || true

# 4. Build Tauri Release Binary
echo "[4/5] Compiling High-Performance Native Rust Binary..."
cd "$PROJECT_DIR/src-tauri"
cargo build --release

# 5. Create Desktop Launcher Shortcut
echo "[5/5] Creating Desktop Launcher..."
DESKTOP_DIR="$HOME/Desktop"
DESKTOP_FILE="$DESKTOP_DIR/LastMile_Tauri_HUD.desktop"

if [ -d "$DESKTOP_DIR" ]; then
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=2.0
Type=Application
Name=LastMile Guard HUD (Tauri)
GenericName=Automotive Delivery HUD
Comment=5.0" WVGA Multi-App Delivery HUD (Tauri v2 + Rust)
Exec=$PROJECT_DIR/src-tauri/target/release/lastmile-guard
Path=$PROJECT_DIR
Icon=applications-multimedia
Terminal=false
StartupNotify=true
Categories=Utility;Navigation;
EOF
    chmod +x "$DESKTOP_FILE"
    echo "[OK] Created Desktop Launcher: $DESKTOP_FILE"
fi

echo ""
echo "====================================================================="
echo "   🎉 TAURI v2 + RUST MIGRATION & SETUP COMPLETE!                    "
echo "====================================================================="
echo "Run the application using:"
echo "  👉 Desktop: Double-click 'LastMile Guard HUD (Tauri)' on your screen"
echo "  👉 Terminal: $PROJECT_DIR/src-tauri/target/release/lastmile-guard"
echo "====================================================================="
