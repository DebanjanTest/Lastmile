# Boot

## Overview
Raspberry Pi 5 bootloader, firmware, and display configuration installer for LastMile Guard. It configures `/boot/firmware` (or `/boot`) with display timings, GPU overlays, and kernel command lines for the 800x480 WVGA touchscreen, resolving black screen signal drops and supplying USB drive power.

## Interface
- `[apply_boot_config.sh:main]`
- `[apply_boot_config.sh:BOOT_DIR]`

## Invariants
- `[apply_boot_config.sh:set -e]` Halts immediately on unhandled command failure.
- `[apply_boot_config.sh:EUID]` Requires root / superuser privileges (`$EUID -eq 0`) to write to `/boot/firmware` or `/boot`.
- Backs up existing `config.txt` and `cmdline.txt` with timestamped `.bak_YYYYMMDD_HHMMSS` before installation.

## Side Effects
- Copies `config.txt` and `cmdline.txt` into `/boot/firmware` (or `/boot`).
- Synchronizes `/boot/firmware/current/cmdline.txt` when Ubuntu piboot-try scheme is present.
- Creates backup files on the boot partition filesystem.

## Verification
- Run: `python3 -m unittest discover tests/`
