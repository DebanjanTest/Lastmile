#!/usr/bin/env bash
# ==============================================================================
# LastMile Guard - Ubuntu / Raspberry Pi OS One-Liner Setup & Service Installer
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "====================================================="
echo "   Setting up LastMile Guard on Raspberry Pi 5       "
echo "====================================================="

# 1. Install System Dependencies
echo "[SETUP] Updating package lists and installing native packages..."
sudo apt update
sudo apt install -y python3 python3-pip python3-venv python3-serial \
    python3-pynmea2 chromium-browser libgl1-mesa-glx || true

# 2. Virtual Environment Setup
echo "[SETUP] Creating Python virtual environment..."
python3 -m venv "$DIR/.venv" --system-site-packages
source "$DIR/.venv/bin/activate"

# 3. Install Python Dependencies
echo "[SETUP] Installing Python requirements..."
pip install --upgrade pip
pip install -r requirements.txt

# 4. Make scripts executable
chmod +x "$DIR/scripts/"*.sh

echo "====================================================="
echo "   Setup Complete!                                   "
echo "   To start HDMI Test: ./scripts/run_hdmi_test.sh     "
echo "   To run backend:     python3 main.py               "
echo "====================================================="
