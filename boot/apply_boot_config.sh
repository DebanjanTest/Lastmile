#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Raspberry Pi 5 Bootloader & Display Configuration Installer
# Targets: Ubuntu Server / Desktop on Raspberry Pi (/boot/firmware)
# ==============================================================================

set -e

BOOT_DIR="/boot/firmware"
if [ ! -d "$BOOT_DIR" ]; then
    BOOT_DIR="/boot"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

echo "====================================================="
echo "   Applying LastMile Guard Raspberry Pi 5 Boot Fix   "
echo "   Target Boot Partition: $BOOT_DIR                  "
echo "====================================================="

if [ "$EUID" -ne 0 ]; then
    echo "This script requires superuser privileges to write to $BOOT_DIR."
    echo "Please run with sudo:"
    echo "  sudo bash $0"
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup existing files
if [ -f "$BOOT_DIR/config.txt" ]; then
    cp "$BOOT_DIR/config.txt" "$BOOT_DIR/config.txt.bak_$TIMESTAMP"
    echo "[BACKUP] Created $BOOT_DIR/config.txt.bak_$TIMESTAMP"
fi
if [ -f "$BOOT_DIR/cmdline.txt" ]; then
    cp "$BOOT_DIR/cmdline.txt" "$BOOT_DIR/cmdline.txt.bak_$TIMESTAMP"
    echo "[BACKUP] Created $BOOT_DIR/cmdline.txt.bak_$TIMESTAMP"
fi

# Install updated configuration files
cp "$SCRIPT_DIR/config.txt" "$BOOT_DIR/config.txt"
cp "$SCRIPT_DIR/cmdline.txt" "$BOOT_DIR/cmdline.txt"

# If current/cmdline.txt exists (Ubuntu piboot-try scheme), update it too
if [ -f "$BOOT_DIR/current/cmdline.txt" ]; then
    cp "$SCRIPT_DIR/cmdline.txt" "$BOOT_DIR/current/cmdline.txt"
    echo "[OK] Synchronized $BOOT_DIR/current/cmdline.txt"
fi

echo "[OK] Installed updated config.txt and cmdline.txt to $BOOT_DIR"
echo "[INFO] Display EDID auto-detection enabled and 500GB HDD USB current boost configured."
echo "Please reboot your Raspberry Pi for changes to take effect:"
echo "  sudo reboot"
