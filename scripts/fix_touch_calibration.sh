#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Fix Touchscreen Calibration & Inversion (Wayland + X11)
# Ponytail Lean Architecture: Direct udev libinput matrix configuration
# ==============================================================================

set -e

MODE="${1:-180}"

case "$MODE" in
    180|inverted|both)
        MATRIX="-1 0 1 0 -1 1"
        DESC="180° Inverted (Flips both X and Y axes)"
        X11_CAL="3951 140 3998 261"
        SWAP="0"
        ;;
    invert-y|flip-v)
        MATRIX="1 0 0 0 -1 1"
        DESC="Invert Y axis only (Vertical flip)"
        X11_CAL="140 3951 3998 261"
        SWAP="0"
        ;;
    invert-x|flip-h)
        MATRIX="-1 0 1 0 1 0"
        DESC="Invert X axis only (Horizontal flip)"
        X11_CAL="3951 140 261 3998"
        SWAP="0"
        ;;
    swap|xy)
        MATRIX="0 1 0 1 0 0"
        DESC="Swap X and Y axes"
        X11_CAL="140 3951 261 3998"
        SWAP="1"
        ;;
    0|normal|reset)
        MATRIX="1 0 0 0 1 0"
        DESC="Normal / Identity (Reset to default)"
        X11_CAL="140 3951 261 3998"
        SWAP="0"
        ;;
    *)
        echo "Unknown mode: $MODE"
        echo "Usage: sudo ./fix_touch_calibration.sh [180 | invert-y | invert-x | swap | reset]"
        exit 1
        ;;
esac

echo "====================================================="
echo "   Configuring ADS7846 Touchscreen Calibration       "
echo "   Mode: $DESC                                       "
echo "   Libinput Matrix: $MATRIX                          "
echo "====================================================="

# 1. Wayland / Libinput configuration via udev rule
UDEV_RULE="/etc/udev/rules.d/99-ads7846-calibration.rules"
cat << EOF | sudo tee "$UDEV_RULE" > /dev/null
# ADS7846 Touchscreen calibration for libinput (Wayland & X11)
ACTION=="add|change", KERNEL=="event[0-9]*", ATTRS{name}=="ADS7846 Touchscreen", ENV{LIBINPUT_CALIBRATION_MATRIX}="$MATRIX"
EOF

# 2. Standard X11 fallback configuration
sudo mkdir -p /etc/X11/xorg.conf.d/
cat << EOF | sudo tee /etc/X11/xorg.conf.d/99-calibration.conf > /dev/null
Section "InputClass"
    Identifier "calibration"
    MatchProduct "ADS7846 Touchscreen"
    Option "Calibration" "$X11_CAL"
    Option "SwapAxes" "$SWAP"
EndSection
EOF

# 3. Reload udev rules and trigger input devices
sudo udevadm control --reload-rules
sudo udevadm trigger -s input

echo ""
echo "[✓] Touchscreen calibration applied successfully!"
echo "[✓] libinput matrix set to: $MATRIX"
echo "[✓] Test by touching the screen. To test raw events, run: python3 scripts/test_touch.py"
