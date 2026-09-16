# LastMile Guard

A ruggedized, distraction-free automotive navigation HUD, witness black-box, and order delivery terminal engineered for two-wheelers and gig-economy delivery personnel (Zomato, Swiggy, Zepto, Blinkit, Amazon Flex).

Designed under **Ponytail Lean Architecture**, LastMile Guard offloads smartphone dependency from handlebars, eliminates heat-induced thermal shutdowns, prevents phone snatching, and provides physical hardware safety triggers in an integrated 5.0-inch 800x480 WVGA cockpit unit.

---

## 1. System Architecture

```
+------------------------------------------------------------------------------------+
|                               5.0" 800x480 WVGA HUD                                |
|  [Turn Guidance]     [Leaflet / CARTO Vector Map]     [Floating Recenter Button]   |
|  [Speed Cluster]     [Dynamic Route Polyline]         [Glove-Friendly Swipe Dock]  |
+------------------------------------------------------------------------------------+
                                         ^
                                         | 5Hz Telemetry / 60 FPS Lerp Loop
                                         v
+------------------------------------------------------------------------------------+
|                         TAURI v2 + RUST CORE RUNTIME                               |
|                                                                                    |
|  +------------------------+  +--------------------------+  +--------------------+  |
|  |     Kinematics HAL     |  |   OSRM / Geodesic Router |  | Offline SQL Ledger |  |
|  |  UART GPS / sysfs SoC  |  |  2-Phase Route Lifecycle |  | rusqlite / WAL DB  |  |
|  +------------------------+  +--------------------------+  +--------------------+  |
|                                                                                    |
|  +-------------------------------------------------------------------------------+  |
|  |            5-Minute RAM-Disk Circular Dashcam Engine (/run/shm/)              |  |
|  |       GPIO 27 Tilt Sensor (>45°)  |  GPIO 17 Tactile Emergency SOS Push       |  |
|  +-------------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------------+
                                         |
     +-----------------------------------+-----------------------------------+
     |                                                                       |
     v                                                                       v
[Ubuntu 24.04 / Raspberry Pi OS]                                  [Windows 11 Simulation]
Tier-1 Hardware Target: Pi 5 + DSI Screen                         Developer & UI Mock Testbed
```

### Core Technologies
* **Application Shell:** Tauri v2 with Rust (Tokio asynchronous runtime). Under 40 MB idle RAM footprint.
* **Frontend UI:** Native ES6 JavaScript, HTML5 Canvas, Leaflet Cartography. Zero heavyweight frontend frameworks, zero DOM thrashing.
* **Storage Engine:** SQLite with Write-Ahead Logging (`WAL`), storing offline order states, daily income statistics, and cryptographic accident logs.
* **Hardware Interop:** Direct Linux kernel polling via `/sys/class/thermal`, `v4l2`, `sysfs`, `gpiozero`, and `rppal`.

---

## 2. Patentable Novelty & Key Features

### 2.1 5-Minute RAM-Disk Circular Dashcam (Zero Flash Wear)
* **Volatile Ring Allocation:** Dashcam video buffers are maintained exclusively inside `/run/shm/dashcam_ring/` using Linux `tmpfs` shared RAM. At 720p 30fps H.264 (~5 Mbps), 300 seconds consumes ~190 MB RAM, completely avoiding physical MicroSD/eMMC flash write cycles during routine operation.
* **Hardware Sensor Triggers:**
  * **GPIO 27 (Tilt / Angular Sensor):** Detects vehicle roll > 45 degrees sustained for > 500 ms (accident / tip-over event).
  * **GPIO 17 (Tactile SOS Switch):** Dedicated handlebar emergency button for rider distress or road incidents.
* **Cryptographic Evidence Commitment:** Upon incident trigger, the system commits the trailing 180 seconds of pre-incident video and 120 seconds of post-incident video to persistent storage (`evidence/incidents/`). Each bundle is tagged with an immutable SHA-256 hash, GPS coordinates, speed, and timestamp.

### 2.2 Autonomous Day/Night Cartography & 60 FPS Kinematics
* **Adaptive Vision Engine:**
  * **Day Mode (06:00 - 18:00):** High-contrast daylight cartography utilizing CARTO Voyager tiles (`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`) with deep slate typography (`#0F172A`) for direct sunlight readability.
  * **Night Mode (18:00 - 06:00):** Low-glare, OLED-optimized dark basemap utilizing CARTO Dark Matter tiles (`https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png`) with deep black backgrounds (`#070B14`) to preserve night vision.
* **Kinematic Interpolation (`lerp`):** Ingests 5Hz telemetry ticks and renders smooth 60 FPS marker translation and heading rotation using shortest-arc angle calculation (`lerpAngle`).
* **Unobstructed Viewport Projection:** Uses custom Mercator projection math (`getCameraOffsetLatLng`) to project the camera center above the active route dock and bottom card. The vehicle puck remains centered in the lower-third of visible street space without sliding beneath bottom swipe sliders.
* **Floating Recenter Override:** Decouples user touch gestures from tracking. Touching or zooming the map initiates free-panning mode and reveals a floating `[ ⌖ RECENTER ]` control; tapping it immediately recenters camera to the calibrated vehicle offset.

### 2.3 Dual-Tier COD Escrow & Order Lifecycle
* **Two-Phase Routing Engine:**
  * **Phase 1 (Store Pickup):** Calculates shortest path from driver coordinates to merchant location with a high-visibility Blue polyline (`#0284C7`).
  * **Phase 2 (Customer Drop-off):** Autonomously transitions to a Green polyline (`#00E676`) upon store pickup confirmation.
* **Dynamic Razorpay QR Generation:** Automatically synthesizes UPI payment QR codes on Cash-on-Delivery (COD) orders with millisecond status polling, allowing contactless customer payments directly at the doorstep.
* **Secure OTP Handover:** Driver swipe slider requires 4-digit customer OTP validation before order closure and instant ledger wallet credit.

---

## 3. Hardware Specifications & Pinouts

### Target Hardware Bill of Materials (BOM)
* **Compute Unit:** Raspberry Pi 5 (4GB or 8GB LPDDR4X) running Raspberry Pi OS Bookworm (64-bit) or Ubuntu Server 24.04 LTS.
* **Display:** 5.0-inch 800x480 WVGA Capacitive Touch LCD (DSI ribbon interface or Micro-HDMI + USB Touch).
* **Camera Module:** Raspberry Pi Camera Module 3 (Wide FOV) or UVC H.264 USB webcam.
* **GPS Receiver:** u-blox NEO-6M / NEO-M8N connected via UART `/dev/ttyAMA0`.
* **Sensors:** SW-520D ball tilt sensor (or MPU-6050 IMU) and tactile sealed momentary push button.

### GPIO Wiring Matrix (40-Pin Header)

| Pin # | Broadcom GPIO | Hardware Function | Peripheral / Module | Connection Notes |
| :--- | :--- | :--- | :--- | :--- |
| Pin 01 | 3.3V Power | DC Power | NEO-6M GPS & IMU | 3.3V System Rail |
| Pin 02 | 5.0V Power | DC Power | 5" Touch LCD Backlight | 5V System Rail |
| Pin 06 | Ground | Electrical GND | Common Ground | Common return path |
| Pin 08 | GPIO 14 (TXD) | UART Transmit | GPS RX Pin | 9600 / 38400 Baud |
| Pin 10 | GPIO 15 (RXD) | UART Receive | GPS TX Pin | NMEA Telemetry Input |
| Pin 11 | GPIO 17 | Discrete Input | Handlebar Tactile SOS Button | Active LOW (Pull-Up enabled) |
| Pin 13 | GPIO 27 | Discrete Input | SW-520D Vehicle Tilt Sensor | Active HIGH (>45 deg tilt) |
| Pin 18 | GPIO 24 | PWM Output | LCD Backlight Dimmer | Hardware PWM backlight control |

```
       Raspberry Pi 5 Header (Partial Wiring Schematic)
                  +3.3V  [01] [02]  +5.0V ----> (Display Power)
(GPS VCC / IMU) <------- [03] [04]  +5.0V
                         [05] [06]  GND   ----> (Common Ground)
                         [07] [08]  GPIO 14 (UART TX) -> GPS RX
                         [09] [10]  GPIO 15 (UART RX) <- GPS TX
 (SOS Switch) <--------- [11] [12]  GPIO 18
 (Tilt Sensor) <-------- [13] [14]  GND
                         [15] [16]  GPIO 23
                         [17] [18]  GPIO 24 (PWM Dimming)
```

---

## 4. Setup & Installation

### Option A: Ubuntu 24.04 / Raspberry Pi OS (Tier-1 Target)

#### 1. System Dependencies & Hardware Primitives
```bash
# Update repository packages
sudo apt update && sudo apt install -y \
    build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev \
    libasound2-dev git python3 python3-pip python3-venv xinput

# Clone repository
git clone https://github.com/DebanjanTest/Lastmile.git
cd Lastmile
```

#### 2. Execute Hardware Configuration Script
```bash
# Grants dialout, video, and gpio permissions, creates RAM-disk mount points
chmod +x scripts/setup_ubuntu.sh scripts/setup_touch_calibration.sh
sudo ./scripts/setup_ubuntu.sh
```

#### 3. Touchscreen Calibration (800x480 WVGA Matrix Fix)
If touch inputs are inverted or offset on physical 5-inch panels:
```bash
# Sets Coordinate Transformation Matrix for 800x480 landscape display
./scripts/setup_touch_calibration.sh
```

#### 4. Launch Application
```bash
# Method 1: Tauri Native Binary (Recommended for Production)
cargo install tauri-cli --version "^2.0"
cargo tauri build --release
./src-tauri/target/release/lastmile-guard

# Method 2: Python Engine with Kiosk Browser
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

---

### Option B: Windows 11 (Simulation & UI Testbed)

Windows is supported as a virtual development testbed featuring synthetic GPS trajectories, mock hardware sensors, and an automated order generator:

1. **Install Prerequisites:**
   * Python 3.10+
   * Rust Toolchain (`rustup default stable`)
   * Visual Studio C++ Build Tools

2. **Run Test Harness & Simulation:**
   ```powershell
   # Clone repository
   git clone https://github.com/DebanjanTest/Lastmile.git
   cd Lastmile

   # Install dependencies
   pip install -r requirements.txt

   # Verify all 24 unit tests pass
   python -m unittest discover -s tests -p "test_*.py"

   # Launch simulation server (port 8000)
   python main.py
   ```
3. **Open HUD Viewport:**
   Navigate to `http://localhost:8000` in Google Chrome or Microsoft Edge. Press `F11` to simulate fullscreen automotive HUD mode.

---

## 5. Testing & Verification

The test suite validates kinematics interpolation, 5-minute RAM-disk preservation, order lifecycle state machines, and Razorpay signature verification:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

### Verified Test Matrix
* `test_all.py`: Core kinematics, route generation, and state transitions.
* `test_hardware_and_ramdisk.py`: `/run/shm/` zero-flash circular buffer, collision tilt triggers, and video export integrity.
* `test_live_dashboard_flow.py`: Full order lifecycle (Accept -> Reached Store -> Picked Up -> Reached Customer -> OTP -> Delivery).
* `test_order_infiltration.py`: Autonomous injection of real-time gig deliveries from Zomato, Swiggy, Zepto, and Blinkit.
* `test_razorpay_and_auth.py`: Razorpay dynamic QR generation, webhook parsing, and Firebase token verification.

---

## 6. Directory Layout

```
Lastmile/
|-- .github/workflows/         # CI/CD pipeline (Tauri build & Python test matrix)
|-- core/                      # Engine core, order state machines, dashcam logic
|   |-- dashcam.py             # 5-minute rolling circular buffer in /run/shm/
|   |-- engine.py              # Main telemetry and event coordinator
|   |-- navigation.py          # Dynamic turn-by-turn guidance engine
|   |-- order_feed.py          # Gig platform offer generator and ledger
|   |-- router.py              # OSRM road-network client with geodesic fallback
|-- data/                      # Persistent database storage (SQLite)
|-- evidence/incidents/        # Immutable locked crash and SOS recordings
|-- hal/                       # Hardware Abstraction Layer
|   |-- drivers_linux.py       # Physical GPIO, UART GPS, and Pi camera drivers
|   |-- drivers_mock.py        # Desktop simulation hardware drivers
|   |-- kinematic_simulator.py # Physics-based vehicle velocity and lerp driver
|-- scripts/                   # System automation, touch calibration, setup scripts
|-- src-tauri/                 # Tauri v2 + Rust production runtime
|   |-- Cargo.toml             # Rust package configuration and optimization flags
|   |-- src/main.rs            # Tauri application entrypoint and IPC handlers
|-- tests/                     # 24-test comprehensive validation suite
|-- ui/                        # Presentation layer
|   |-- static/css/tripper.css # Automotive high-contrast design tokens
|   |-- static/js/tripper.js   # 60 FPS lerp kinematics and Leaflet cartography
|   |-- templates/index.html   # HUD layout (800x480 WVGA chassis)
|-- config.json                # Runtime configuration, GPIO pinouts, and parameters
|-- main.py                    # Multi-platform development server entrypoint
|-- requirements.txt           # Lean Python dependencies
|-- CONTRIBUTING.md            # Open-source contribution and code standards
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
