# Contributing to LastMile Guard

Thank you for your interest in contributing to LastMile Guard. This document outlines the engineering protocols, architecture standards, and submission guidelines required for all contributions.

---

## 1. Core Engineering Principles

LastMile Guard operates as an automotive-grade embedded safety system deployed directly onto light vehicles and two-wheelers. Code submitted to this repository must respect physical hardware constraints, thermal limits, and driver cognitive load.

### Ponytail Lean Architecture
1. **YAGNI (You Aren't Gonna Need It):** No speculative abstractions, microservices, containerization daemons, or unnecessary dependencies on the Raspberry Pi target.
2. **Zero DOM Thrashing:** UI updates must mutate discrete text/SVG nodes directly or utilize `requestAnimationFrame` interpolation. Never re-render whole panels with `innerHTML` in active telemetry loops.
3. **No-Emoji Design Standard:** All UI components, status badges, and cartography HUD elements must utilize crisp inline SVGs, vector paths, or high-contrast alphanumeric typography. Emojis are strictly forbidden across HUD interfaces and commit logs.
4. **Hardware Safety Guarantee:** Dashcam rolling buffers must reside in volatile memory (`/run/shm/` tmpfs) to guarantee zero flash memory wear on physical MicroSD/eMMC cards. Physical writes occur exclusively during locked collision or panic events.

---

## 2. Design System & Palette Specification

All display elements are calibrated for 5.0-inch 800x480 WVGA sunlight-readable capacitive touchscreens.

### Night Vision Theme (Default Automotive)
* **Background Deep (OLED):** `#070B14`
* **Card Surface / Navy:** `#0B132B`
* **Surface Elevated:** `#111A30`
* **Border Subdued:** `rgba(255, 255, 255, 0.08)`
* **Accent Primary:** `#0284C7` (Sky Blue)
* **Accent Telemetry / Active:** `#38BDF8` (Cyan)
* **Status Success / Handover:** `#00E676` (Mint Green)
* **Status Hazard / Congestion:** `#EF4444` (Crimson Red)

### Day Vision Theme (Anti-Glare Sunlight)
* **Background High-Contrast:** `#E2E8F0`
* **Surface Clean:** `#FFFFFF`
* **Border Subdued:** `#94A3B8`
* **Primary Text:** `#0F172A`

---

## 3. Development & Testing Workflow

### Prerequisites
* **Rust:** Stable toolchain (`rustup default stable`)
* **Python:** Python 3.10+ (for simulation server & test harness)
* **Tauri Dependencies (Ubuntu/Debian):**
  ```bash
  sudo apt update
  sudo apt install -y build-essential curl wget file libxdo-dev libssl-dev \
      libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
  ```

### Running the Test Suite
All PRs must maintain a 100% test pass rate across the full suite before submission:
```bash
python -m unittest discover -s tests -p "test_*.py"
```

### Checking the Rust / Tauri Backend
```bash
cd src-tauri
cargo check --workspace
cargo test --workspace
```

---

## 4. Submitting Pull Requests

1. **Branch Naming:**
   * `feat/<feature-name>` (e.g., `feat/dynamic-geodesic-routing`)
   * `fix/<bug-name>` (e.g., `fix/recenter-viewport-offset`)
   * `perf/<optimization>` (e.g., `perf/ramdisk-circular-buffer`)
   * `docs/<topic>` (e.g., `docs/gpio-hardware-pinout`)

2. **Commit Convention:**
   Follow conventional commits without emojis:
   * `feat(router): integrate osrm polyline decoder with geodesic fallback`
   * `fix(cartography): calibrate dynamic projection offset for bottom dock`
   * `test(auth): add automated firebase token verification unit test`

3. **PR Verification Checklist:**
   - [ ] All 24 unit tests pass cleanly (`Ran 24 tests ... OK`).
   - [ ] No regression on 5Hz telemetry broadcast timing or 60 FPS lerp smoothness.
   - [ ] Touch gestures decouple cleanly from auto-follow tracking.
   - [ ] No hardcoded API secrets or private tokens committed.
   - [ ] Code formatted with `rustfmt` (Rust) and standard PEP 8 (Python).

---

## 5. Security Vulnerability Disclosures

If you identify a potential security issue (such as token leak in telemetry, escrow bypass in COD verification, or arbitrary command execution in GPIO listeners), please do not open a public issue. Report findings directly to the maintainers via security advisories or email.
