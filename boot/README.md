# Raspberry Pi 5 Boot & Firmware Configuration

This directory contains verified bootloader and kernel parameters for running **LastMile Guard** on Ubuntu 24.04 LTS / Debian Bookworm on the Raspberry Pi 5.

## Problem Resolved
- **Black Screen / No Display:** Ubuntu Desktop previously forced `video=HDMI-A-1:800x480M@60D` in `cmdline.txt` and loaded an SPI touchscreen overlay (`ads7846`), causing standard HDMI monitors to reject the video signal and drop into standby once the Linux DRM/KMS graphics driver (`vc4-kms-v3d`) took over.
- **500GB USB Drive Power:** Configures `usb_max_current_enable=1` in `config.txt` to supply full USB current to external mechanical HDDs.
- **Boot Visibility:** Removed `quiet splash` so kernel and systemd initialization logs stream directly to the display for rapid diagnosis.

## Files
- `config.txt`: Configures hardware interfaces (I2C, SPI, UART, Audio), enables maximum USB current on Pi 5, loads `vc4-kms-v3d` graphics driver with `display_auto_detect=1`, and keeps SPI touch overlays disabled by default.
- `cmdline.txt`: Standard Linux kernel command line with auto EDID resolution negotiation, fast `zstd` zswap, and visible console output (`console=tty1`).
- `apply_boot_config.sh`: Automated installer script to safely back up existing configs and copy these into `/boot/firmware` (or `/boot`).

## Deployment on Raspberry Pi
From the project root:
```bash
sudo chmod +x boot/apply_boot_config.sh
sudo ./boot/apply_boot_config.sh
sudo reboot
```
