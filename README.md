# LastMile Guard

An automotive-grade embedded cockpit HUD, incident witness black-box, and multi-app delivery terminal engineered for two-wheelers and gig-economy delivery personnel (Zomato, Swiggy, Zepto, Blinkit, Amazon Flex).

Built strictly according to **Ponytail Lean Architecture**, LastMile Guard eliminates smartphone overheating, eliminates handlebar mounting vibration damage, prevents device theft/snatching, and provides physical hardware safety triggers within a dedicated 5.0-inch 800x480 WVGA sunlight-readable cockpit unit.

---

## 1. System Architecture & Component Topology

```
+--------------------------------------------------------------------------------------------------+
|                                    5.0" 800x480 WVGA HUD VIEWPORT                                |
|  [Turn Guidance Card]            [Leaflet / CARTO Vector Map]           [Incoming Gig Stack]     |
|  [Floating Speedometer]          [Dynamic Route Polylines]              [Profile & Cash Ledger]  |
|  [Active Route Dock]             [Floating Recenter Button]             [Glove Swipe Sliders]    |
+--------------------------------------------------------------------------------------------------+
                                                  ^
                                                  | 5Hz Telemetry Ticks / 60 FPS RAF Lerp Loop
                                                  v
+--------------------------------------------------------------------------------------------------+
|                                   TAURI v2 + RUST CORE RUNTIME                                   |
|                                                                                                  |
|  +-----------------------------+  +-------------------------------+  +------------------------+  |
|  |     Kinematics & Sensors    |  |     OSRM Road Network Engine  |  |   Offline SQLite WAL   |  |
|  |  UART NMEA GPS / sysfs SoC  |  |   Geodesic Straight Fallback  |  |   rusqlite Ledger & DB |  |
|  +-----------------------------+  +-------------------------------+  +------------------------+  |
|                                                                                                  |
|  +--------------------------------------------------------------------------------------------+  |
|  |                        5-Minute Volatile RAM-Disk Dashcam (/run/shm/)                      |  |
|  |            GPIO 27 Vehicle Tilt Sensor (>45°)  |  GPIO 17 Tactile Emergency SOS Push       |  |
|  +--------------------------------------------------------------------------------------------+  |
|                                                                                                  |
|  +--------------------------------------------------------------------------------------------+  |
|  |                        Razorpay Dual-Tier COD Escrow & Handover Engine                     |  |
|  |       Dynamic UPI QR Synthesis  |  6-Second Auto-Poll Daemon  |  OTP Validation Ledger     |  |
|  +--------------------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------------------+
                                                  |
           +--------------------------------------+--------------------------------------+
           |                                                                             |
           v                                                                             v
[Ubuntu 24.04 / Raspberry Pi OS]                                              [Windows 11 Simulation]
Tier-1 Hardware Target: Pi 5 + DSI Screen                                     Developer & UI Mock Testbed
```

---

## 2. Architectural Pillars & Core Subsystems

### 2.1 Identity & Authentication Architecture
* **Firebase Google Sign-In (OAuth 2.0):**
  * Initiated via native popup window using `firebase.auth().signInWithPopup(provider)`.
  * Configured with strict security headers (`Cross-Origin-Opener-Policy: same-origin-allow-popups`) in the backend to prevent OAuth handshake deadlocks.
  * Captures official Google User ID tokens, profile photo URLs, and primary email credentials.
* **Offline Fallback (`mock_account`):**
  * When operating offline or without network connectivity, the system exposes a dedicated `[Skip / Continue Offline]` flow.
  * Injects an authenticated offline profile (`RIDER-KOL-01`, `Debanjan Mondal`) to guarantee uninterrupted operational readiness in cell dead zones.
* **JWT Verification & Local Profile Synchronization:**
  * Client sends ID tokens to `/api/auth/firebase-verify`.
  * Verified claims are synchronized down to the local SQLite `rider_profile` table.
  * Synchronizes driver display name, avatar image, and daily target metrics to the HUD top bar without blocking the active navigation event loop.

---

### 2.2 Autonomous Order Queueing (Gig Stream)
* **Multi-Platform Offer Aggregation:**
  * Real-time gig stream ingest for Zomato (`#E23744`), Swiggy (`#FC8019`), Zepto (`#7C4DFF`), and Blinkit (`#F7D046`).
  * Ingests merchant location, pickup distance, customer doorstep address, drop distance, order total, and rider payout.
  * Automatically maintains a pool of at least 4 nearby offers during `IDLE` and `DELIVERED` phases.
* **Z-Index Layer Hierarchy (Zero Screen Collision):**
  * `#orderNotificationStack` is positioned at `z-index: 40`, `top: 48px`, and `bottom: 54px`, with `pointer-events: none` on the container and `pointer-events: auto` on individual cards.
  * Individual notification cards stack vertically along the right side of the screen, leaving the left-hand turn card (`z-index: 50`) and center navigation channel unobstructed.
  * Guaranteed separation from the bottom summary strip (`z-index: 100`), top bar (`z-index: 100`), and system modals (`z-index: 150`).
* **Glove-Friendly "Swipe-to-Action" Sliders:**
  * Replaces small touch targets with tactile physical swipe tracks (`.dock-swipe-track` and `.swipe-track`).
  * Built using pure Touch/Pointer APIs (`pointerdown`, `pointermove`, `pointerup`) with threshold calculation (70% track distance triggers action).
  * Smooth CSS spring return if release occurs below the 70% threshold.
  * Phase-adaptive color states:
    * Blue/Cyan gradient for "Swipe to Accept".
    * Mint Green gradient (`#00E676`) for "Swipe to Confirm Pickup".
    * Amber Gold gradient (`#FFB300`) for "Swipe to Complete Delivery".

---

### 2.3 Financial Ledger & Income Tracking
* **SQLite Database Engine (`data/lastmile.db`):**
  * Built with `rusqlite` (Rust) and `sqlite3` (Python) utilizing Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and synchronous normal mode (`PRAGMA synchronous = NORMAL;`) for maximum SD/eMMC durability and crash-resilience.
* **Database Schema Definitions:**
  ```sql
  -- Driver Identity & Target Metrics
  CREATE TABLE IF NOT EXISTS rider_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      vehicle_no TEXT NOT NULL,
      daily_target_inr REAL NOT NULL,
      daily_target_orders INTEGER NOT NULL,
      photo_url TEXT,
      updated_at TEXT NOT NULL
  );

  -- Immutable Completed Order Ledger
  CREATE TABLE IF NOT EXISTS completed_orders (
      order_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      store_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      payout_inr REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      order_amount_inr REAL NOT NULL,
      status TEXT NOT NULL,
      completed_at TEXT NOT NULL
  );
  ```
* **Daily Target Progress & Side Drawer:**
  * Persistent calculation of total daily earnings, completed trip counts, and percentage achieved against daily target (default: Rs. 800.00 / 8 orders).
  * Accessible on the HUD via the profile avatar tap, presenting an animated progress bar and full trip history ledger without leaving the cockpit environment.

---

### 2.4 Payment Gateway Integration: Dual-Tier COD Escrow
* **Dynamic Razorpay UPI QR Generation:**
  * When delivering Cash-on-Delivery (COD) orders, the HUD synthesizes an on-the-fly UPI payment QR code via `/api/payment/razorpay-qr` or Rust command `request_razorpay_qr`.
  * Generates direct NPCI-compliant payment strings:
    `upi://pay?pa=lastmile.merchant@icici&pn=ZOMATO_Delivery&am=540.00&cu=INR&tn=Bill_ORD-ZOM-81`
  * Rendered as high-contrast SVG matrix on a dark dialog overlay at the customer doorstep.
* **6-Second Automated Polling Daemon:**
  * Background worker checks `/api/payment/status/{qr_id}` every 2 seconds for up to 300 seconds.
  * Detects bank authorization webhooks and transitions payment state from `CREATED` to `PAID`.
* **Immediate Ledger Settlement:**
  * Handshake completes instantly when payment is confirmed: marks order paid, records settlement to SQLite `completed_orders`, and unlocks the final delivery slider.
  * In offline scenarios, the driver can verify cash receipt in person and execute instant driver confirmation.

---

### 2.5 Advanced Driver Ergonomics & Cartography
* **Two-Phase Routing State Machine:**
  * **Phase 1 (`ROUTE_TO_STORE`):** Generates route polyline from live rider GPS to restaurant coordinates. Rendered as a High-Visibility Sky Blue polyline (`#0284C7`) with soft cyan ambient glow (`#38BDF8`).
  * **Phase 2 (`ROUTE_TO_CUSTOMER`):** Automatically flushes store path upon pickup confirmation and recalculates route from store to customer doorstep. Rendered as a Mint Green polyline (`#00E676`).
* **OSRM Road Network Client with Geodesic Fallback:**
  * Queries Open Source Routing Machine (OSRM) driving profiles.
  * If road-network API times out or network is severed, the backend immediately executes a geodesic straight-line fallback from current coordinates to target coordinates, preventing black screens or frozen navigation.
* **60 FPS Kinematic Interpolation (`lerp`):**
  * Receives 5Hz telemetry ticks (200ms) from hardware GPS.
  * Renders vehicle position at 60 FPS using linear interpolation:
    `currentLat = currentLat + (targetLat - currentLat) * 0.14`
  * Renders heading orientation using shortest-arc modular angular interpolation (`lerpAngle`) to eliminate 360-degree rotation snaps.
* **Autonomous Day/Night Vision Engine:**
  * Evaluated every 60 seconds against local clock time.
  * **Day Window (06:00 to 18:00):** Switches basemap to CARTO Voyager (`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`) and activates `.theme-day` CSS variables with slate-on-white high contrast for direct sunlight readability.
  * **Night Window (18:00 to 06:00):** Switches basemap to CARTO Dark Matter (`https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png`) and activates `.theme-night` CSS variables with deep OLED navy (`#070B14`) to preserve dark adaptation.
  * Zero-flicker hot-swapping: loads new tile layer before retiring old layer with a 350ms cross-fade delay.
* **Unobstructed Viewport Projection & Camera Offset:**
  * The bottom UI cards (`.active-route-dock` and `.gmaps-bottom-card`) occupy ~140-160px of the 480px screen height.
  * Projection helper `getCameraOffsetLatLng` offsets camera center:
    `targetPoint = map.project([lat, lng], zoom)`
    `targetPoint.y += (calibratedOffset + perspectiveBonus)`
    `offsetLatLng = map.unproject(targetPoint, zoom)`
  * Keeps the rider puck locked safely in the lower-third of the *unobstructed* viewport (~210-240px from screen top), giving maximum forward route visibility without ever sliding under the swipe slider.
* **Touch Decoupling & Instant Recenter Override:**
  * Panning or zooming the map sets `isUserPanning = true`, pausing auto-follow camera and fading in `#floatingRecenterBtn`.
  * Tapping `[ ⌖ RECENTER ]` immediately resets panning state, cancels the 6-second inactivity timer, and smoothly animates camera back to the calibrated vehicle offset (`map.flyTo(offsetLatLng)`).

---

### 2.6 Hardware Safety Black-Box & Crash Vault
* **5-Minute RAM-Disk Circular Dashcam (`/run/shm/`):**
  * Video segments are stored as rolling H.264 transport chunks inside Linux shared memory (`tmpfs`).
  * Zero writes to physical MicroSD / eMMC storage during routine driving, guaranteeing zero flash wear over years of operation.
  * 300-second circular capacity (~190 MB RAM usage at 720p 30fps).
* **Hardware Triggers:**
  * **GPIO 27 (Tilt / Angular Collision Sensor):** Triggered when motorcycle lean angle exceeds 45 degrees sustained for >500 ms.
  * **GPIO 17 (Tactile SOS Emergency Switch):** Sealed handlebar push button for road rage, assault, or vehicle breakdown.
* **Cryptographic Evidence Commitment:**
  * Upon trigger event, the circular buffer extracts pre-incident footage (180 seconds) and post-incident footage (120 seconds).
  * Merges into a single MP4 evidence file committed to `/evidence/incidents/`.
  * Generates an accompanying `.json` metadata file containing vehicle speed, GPS coordinates, timestamp, and an immutable SHA-256 hash.

---

## 3. Hardware Bill of Materials (BOM) & Pinout Matrix

### 3.1 Recommended Hardware Components
* **SBC:** Raspberry Pi 5 (4GB or 8GB LPDDR4X) or Raspberry Pi 4 Model B (4GB).
* **Display:** 5.0-inch 800x480 WVGA Capacitive Touch LCD (DSI ribbon cable or Micro-HDMI + USB Touch).
* **Camera Module:** Raspberry Pi Camera Module 3 (Wide FOV) or UVC H.264 USB webcam.
* **GPS Receiver:** u-blox NEO-6M / NEO-M8N UART GPS module with ceramic patch antenna.
* **Sensors:** SW-520D ball tilt sensor (or MPU-6050 6-DOF IMU).
* **SOS Button:** Momentary waterproof push button switch (handlebar mount).
* **Power Supply:** 12V-to-5V 3A DC buck converter wired to motorcycle ignition circuit.

### 3.2 40-Pin GPIO Wiring Matrix

| Pin Number | Broadcom GPIO | Hardware Function | Peripheral Connection | Operational Mode |
| :--- | :--- | :--- | :--- | :--- |
| **Pin 01** | 3.3V DC | Power Rail | NEO-6M GPS VCC / IMU | 3.3V System Rail |
| **Pin 02** | 5.0V DC | Power Rail | 5.0" LCD Backlight Power | 5.0V System Rail |
| **Pin 06** | Ground | Electrical GND | Common Ground Plane | Ground Return |
| **Pin 08** | GPIO 14 (TXD0) | UART Transmit | GPS Module RX Pin | 9600 / 38400 Baud |
| **Pin 10** | GPIO 15 (RXD0) | UART Receive | GPS Module TX Pin | NMEA Stream Input |
| **Pin 11** | GPIO 17 | Discrete Input | Handlebar SOS Switch | Active LOW (Internal Pull-Up) |
| **Pin 13** | GPIO 27 | Discrete Input | SW-520D Tilt Sensor | Active HIGH (>45 deg tilt) |
| **Pin 18** | GPIO 24 | PWM Output | Backlight Dimmer Line | Hardware PWM Brightness |

```
                       Raspberry Pi 40-Pin Header
                               +3.3V  [01] [02]  +5.0V ----> (LCD 5V Rail)
      (NEO-6M GPS VCC) <------ +3.3V  [03] [04]  +5.0V
                                      [05] [06]  GND   ----> (Common Ground)
                                      [07] [08]  GPIO 14 (TXD) -> GPS RX
                                      [09] [10]  GPIO 15 (RXD) <- GPS TX
       (Tactile SOS Switch) <- GPIO 17 [11] [12]  GPIO 18
       (SW-520D Tilt Sensor)<- GPIO 27 [13] [14]  GND
                                      [15] [16]  GPIO 23
                                      [17] [18]  GPIO 24 (PWM Backlight)
```

---

## 4. Installation & Setup

### 4.1 Ubuntu 24.04 / Raspberry Pi OS (Tier-1 Target)

#### 1. Install System Prerequisites
```bash
sudo apt update && sudo apt install -y \
    build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev \
    libasound2-dev git python3 python3-pip python3-venv xinput
```

#### 2. Clone Repository & Setup Hardware Permissions
```bash
git clone https://github.com/DebanjanTest/Lastmile.git
cd Lastmile

chmod +x scripts/setup_ubuntu.sh scripts/setup_touch_calibration.sh
sudo ./scripts/setup_ubuntu.sh
```

#### 3. Touchscreen Calibration (800x480 Matrix Fix)
If touch events are mirrored or shifted on physical DSI/HDMI displays:
```bash
./scripts/setup_touch_calibration.sh
```

#### 4. Run Production Build (Tauri v2 + Rust)
```bash
cargo install tauri-cli --version "^2.0"
cargo tauri build --release
./src-tauri/target/release/lastmile-guard
```

#### 5. Alternative: Run Prototype Engine (Python Server)
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

---

### 4.2 Windows 11 (Simulation & Testbed Target)

1. **Install Prerequisites:**
   * Python 3.10+
   * Rust Toolchain (`rustup default stable`)
   * Visual Studio C++ Build Tools

2. **Run Simulation Server:**
   ```powershell
   git clone https://github.com/DebanjanTest/Lastmile.git
   cd Lastmile
   pip install -r requirements.txt
   python main.py
   ```

3. **Open HUD Viewport:**
   Open Google Chrome or Microsoft Edge at `http://localhost:8000`. Press `F11` to enter fullscreen 800x480 WVGA simulation mode.

---

## 5. Comprehensive Test Suite & Verification

The test harness provides 100% automated test coverage across hardware kinematics, RAM-disk buffer management, order infiltration, and Razorpay payment escrow.

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

### Verified Test Suites (24 Tests Total)
* **`tests/test_all.py`**: Vehicle physics, stationary 0 km/h lock, and navigation state transitions.
* **`tests/test_hardware_and_ramdisk.py`**: `/run/shm/` zero-flash circular buffer, 45-degree collision tilt triggers, and incident video commitment.
* **`tests/test_live_dashboard_flow.py`**: End-to-end gig lifecycle (Accept -> Reach Store -> Pickup -> Reach Customer -> OTP Handover -> Delivery Ledger).
* **`tests/test_order_infiltration.py`**: Autonomous gig stream ingest for Zomato, Swiggy, Zepto, and Blinkit with payout validation.
* **`tests/test_razorpay_and_auth.py`**: Self-contained HTTP API suite validating Firebase tokens, local SQLite profile persistence, dynamic Razorpay UPI QR synthesis, and automated settlement polling.

---

## 6. Directory Layout

```
Lastmile/
|-- .github/workflows/         # Automated GitHub Actions CI pipeline
|-- core/                      # Core vehicle & navigation engines
|   |-- dashcam.py             # 5-minute rolling circular buffer in /run/shm/
|   |-- engine.py              # Central telemetry & event coordinator
|   |-- navigation.py          # Dynamic turn guidance & ETA calculation
|   |-- order_feed.py          # Multi-app delivery stream & ledger
|   |-- router.py              # OSRM road-network client with geodesic fallback
|-- data/                      # Persistent database storage
|   `-- lastmile.db            # SQLite WAL database (rider_profile, completed_orders)
|-- evidence/incidents/        # Immutable locked crash and SOS recordings
|-- hal/                       # Hardware Abstraction Layer
|   |-- drivers_linux.py       # Linux GPIO, UART GPS, and camera drivers
|   |-- drivers_mock.py        # Windows simulation virtual drivers
|   |-- kinematic_simulator.py # Physics-based velocity and coordinate lerp
|-- scripts/                   # System configuration & calibration scripts
|   |-- setup_ubuntu.sh        # Linux RAM-disk, permissions, and service setup
|   |-- setup_touch_calibration.sh # xinput 800x480 touch transformation matrix
|-- src-tauri/                 # Tauri v2 + Rust production runtime
|   |-- Cargo.toml             # Rust package definition & optimizations
|   |-- src/main.rs            # Tauri application entrypoint & IPC commands
|   |-- src/db.rs              # rusqlite database management & WAL mode
|   |-- src/razorpay.rs        # Razorpay dynamic QR & payment polling daemon
|   |-- src/router.rs          # Native Rust OSRM client & geodesic fallback
|-- tests/                     # 24-test comprehensive verification harness
|-- ui/                        # Presentation layer & HUD chassis
|   |-- static/css/tripper.css # Automotive design system & day/night tokens
|   |-- static/js/tripper.js   # 60 FPS lerp kinematics & Leaflet cartography
|   |-- templates/index.html   # 800x480 WVGA HUD chassis layout
|-- config.json                # Hardware pins, baudrates, and API configuration
|-- main.py                    # Multi-platform development server entrypoint
|-- requirements.txt           # Lean Python dependencies
|-- CONTRIBUTING.md            # Contribution protocols & design guidelines
|-- LICENSE                    # Apache License 2.0
`-- README.md                  # Comprehensive technical documentation
```

---

## 7. License

Licensed under the **Apache License, Version 2.0** (the "License"). You may obtain a copy of the License at [LICENSE](LICENSE) or at:

```
http://www.apache.org/licenses/LICENSE-2.0
```

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
