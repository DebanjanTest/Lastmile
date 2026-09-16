#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Ubuntu 24.04 / Debian Bookworm Production Deployment Script
# Hardware Target: Raspberry Pi 5 & Ubuntu 24.04 LTS (x86_64 / aarch64)
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "====================================================="
echo "   LastMile Guard - Automotive HUD Hardened Setup     "
echo "   Target: Ubuntu 24.04 LTS / Pi OS Bookworm (Linux) "
echo "====================================================="

# 1. Update Package Lists & Native Dependencies
echo "[SETUP] Installing native C/Rust, WebKitGTK, and Hardware I/O toolchains..."
sudo apt update
sudo apt install -y \
    build-essential \
    curl \
    wget \
    git \
    pkg-config \
    libglib2.0-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libasound2-dev \
    xinput \
    v4l-utils \
    python3 \
    python3-pip \
    python3-venv \
    python3-serial \
    python3-pynmea2 \
    chromium-browser \
    libgl1-mesa-glx || true

# 2. Configure Zero-Wear Volatile RAM-Disk tmpfs Buffer
echo "[SETUP] Initializing Level 2 Volatile RAM-Disk tmpfs at /run/shm/lastmile..."
sudo mkdir -p /run/shm/lastmile /dev/shm/lastmile
sudo chmod 1777 /run/shm/lastmile /dev/shm/lastmile

# Add to fstab if not present
if ! grep -q "/run/shm/lastmile" /etc/fstab 2>/dev/null; then
    echo "tmpfs /run/shm/lastmile tmpfs defaults,noatime,nosuid,nodev,size=128M 0 0" | sudo tee -a /etc/fstab > /dev/null || true
fi

# 3. Configure Hardware Permissions (UART Serial, Video, GPIO)
echo "[SETUP] Granting unprivileged hardware access for $USER..."
sudo usermod -aG dialout,video,gpio,i2c "$USER" 2>/dev/null || true

# 4. Virtual Environment & Python Stack
echo "[SETUP] Configuring Python 3 isolated runtime..."
python3 -m venv "$DIR/.venv" --system-site-packages
source "$DIR/.venv/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

# 5. Touchscreen Axis Inversion Calibration
echo "[SETUP] Installing persistent touchscreen calibration matrix..."
chmod +x "$DIR/scripts/"*.sh
if [ -f "$DIR/scripts/setup_touch_calibration.sh" ]; then
    bash "$DIR/scripts/setup_touch_calibration.sh" --install-persistent || true
fi

# 6. Systemd Automotive HUD Service Registration
echo "[SETUP] Installing lastmile.service systemd unit..."
SERVICE_FILE="/etc/systemd/system/lastmile.service"
sudo bash -c "cat > $SERVICE_FILE" << EOF
[Unit]
Description=LastMile Guard 5.0" Automotive Delivery HUD
After=network.target graphical.target sound.target
Wants=graphical.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR
ExecStart=$DIR/scripts/run_hdmi_test.sh
Restart=always
RestartSec=2
Nice=-10
Environment=DISPLAY=:0
Environment=WAYLAND_DISPLAY=wayland-0
Environment=WEBKIT_DISABLE_COMPOSITING_MODE=0
Environment=XAUTHORITY=/home/$USER/.Xauthority
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
EOF

sudo systemctl daemon-reload || true
sudo systemctl enable lastmile.service || true

echo "====================================================="
echo "   Production Hardening Complete!                    "
echo "   - System Service:  sudo systemctl start lastmile  "
echo "   - Kiosk Launcher:  ./scripts/run_hdmi_test.sh     "
echo "   - Native Tauri:    cd src-tauri && cargo build    "
echo "====================================================="
