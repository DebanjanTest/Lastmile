#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Hardware Touchscreen Calibration Script for Raspberry Pi 5
# Automatically resolves inverted X/Y axis on 5.0" WVGA capacitive touch panels
# ==============================================================================

set -e

echo "[TOUCH] Scanning for connected input pointer devices..."

# Detect common 5.0" HDMI / DSI / USB capacitive touchscreen identifiers
TOUCH_DEVICE=""
DEVICE_CANDIDATES=(
    "WaveShare WaveShare"
    "Goodix Capacitive TouchScreen"
    "raspberrypi-ts"
    "ILITEK Multi-Touch"
    "FT5406 memory based driver"
    "ADS7846 Touchscreen"
    "wch.cn USB2IIC_CTP_CONTROL"
)

if command -v xinput >/dev/null 2>&1; then
    for DEV in "${DEVICE_CANDIDATES[@]}"; do
        if xinput list --name-only | grep -qi "$DEV"; then
            TOUCH_DEVICE="$DEV"
            break
        fi
    done

    # Fallback: find any pointer containing "touch" or "ts"
    if [ -z "$TOUCH_DEVICE" ]; then
        TOUCH_DEVICE=$(xinput list --name-only | grep -iE 'touch|ts' | head -n 1 || true)
    fi

    if [ -n "$TOUCH_DEVICE" ]; then
        echo "[TOUCH] Found Touchscreen Device: '$TOUCH_DEVICE'"
        echo "[TOUCH] Applying Inverted Coordinate Transformation Matrix (-1 0 1 0 -1 1 0 0 1)..."
        
        # Inverted matrix formula: X = 1 - X, Y = 1 - Y (180 deg hardware rotation fix)
        xinput set-prop "$TOUCH_DEVICE" 'Coordinate Transformation Matrix' -1 0 1 0 -1 1 0 0 1
        echo "[TOUCH] Calibration matrix applied successfully to '$TOUCH_DEVICE'!"
    else
        echo "[TOUCH WARNING] No physical touchscreen detected via xinput. Operating in mouse/simulated pointer mode."
    fi
else
    echo "[TOUCH NOTICE] xinput not found or running in Wayland headless environment. Bypassing X11 transformation."
fi

# Optional: Ensure system-wide persistent calibration if run with --install-persistent or --install-service
if [ "$1" == "--install-service" ] || [ "$1" == "--install-persistent" ]; then
    echo "[TOUCH] Deploying persistent udev and libinput rules..."

    # 1. Persistent udev rule for Wayland / libinput
    if [ -d "/etc/udev/rules.d" ]; then
        sudo bash -c 'cat > /etc/udev/rules.d/99-touchscreen-calibration.rules' << 'EOF'
ACTION=="add|change", KERNEL=="event*", ATTRS{name}=="*Touch*", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
ACTION=="add|change", KERNEL=="event*", ATTRS{name}=="*WaveShare*", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
ACTION=="add|change", KERNEL=="event*", ATTRS{name}=="*Goodix*", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
EOF
        sudo udevadm control --reload-rules || true
        echo "[TOUCH] Installed udev rule at /etc/udev/rules.d/99-touchscreen-calibration.rules"
    fi

    # 2. Persistent X11 configuration
    if [ -d "/etc/X11" ]; then
        sudo mkdir -p /etc/X11/xorg.conf.d/
        sudo bash -c 'cat > /etc/X11/xorg.conf.d/99-touchscreen-calibration.conf' << 'EOF'
Section "InputClass"
    Identifier "Touchscreen Inversion Calibration"
    MatchIsTouchscreen "on"
    Option "TransformationMatrix" "-1 0 1 0 -1 1 0 0 1"
EndSection
EOF
        echo "[TOUCH] Installed Xorg configuration at /etc/X11/xorg.conf.d/99-touchscreen-calibration.conf"
    fi

    # 3. Systemd oneshot service
    echo "[TOUCH] Installing boot-time systemd service..."
    SERVICE_PATH="/etc/systemd/system/touch-calibration.service"
    SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup_touch_calibration.sh"

    sudo bash -c "cat > $SERVICE_PATH" << EOF
[Unit]
Description=LastMile Guard Touchscreen Inverted Axis Calibration
After=graphical.target

[Service]
Type=oneshot
User=pi
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/pi/.Xauthority
ExecStart=/bin/bash $SCRIPT_PATH
RemainAfterExit=yes

[Install]
WantedBy=graphical.target
EOF

    sudo systemctl daemon-reload || true
    sudo systemctl enable touch-calibration.service || true
    echo "[TOUCH] Service installed and enabled at $SERVICE_PATH."
fi
