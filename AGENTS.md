# Ponytail Ruleset for LastMile Guard

## 1. Core Philosophy: The Decision Ladder
All development and code generation in this repository must strictly adhere to the Ponytail Decision Ladder:

1. **YAGNI (You Aren't Gonna Need It)**:
   - Do NOT introduce speculative abstractions, heavy microservices, multi-container orchestration, or complex ORM frameworks.
   - Every module must have a single, direct, well-justified purpose.

2. **Standard Library First**:
   - Prefer Python built-in standard libraries (`asyncio`, `multiprocessing`, `pathlib`, `sqlite3`, `json`, `urllib`, `sysfs` access) over external third-party packages whenever possible.
   - Minimize dependencies to prevent compilation bottlenecks on ARM64 / Raspberry Pi.

3. **Platform-Native & Lightweight Abstraction**:
   - Hardware interfaces must use clean, duck-typed Protocol classes (`BaseGPS`, `BaseCamera`, `BaseSensor`) rather than complex dependency injection frameworks.
   - The system must run flawlessly in dual mode:
     - **Simulation Mode**: On Windows or headless Pi without peripherals (synthetic GPS, test video feed, simulated order alerts).
     - **Production Mode**: On Raspberry Pi 5 with physical hardware (`/dev/ttyAMA0`, `Picamera2`, `gpiozero`, `/sys/class/pwm`).

4. **Resource Efficiency on Raspberry Pi 5**:
   - Circular dashcam buffer must reside in volatile RAM (`/run/shm/` or in-memory ring buffer) to eliminate SD card write cycles and flash burnout.
   - UI must be lightweight, high-contrast (glanceable for two-wheeler riders), and render smoothly with minimal CPU usage.

## 2. Git & Cross-Platform Conventions
- All source files and shell scripts must use **LF (Unix) line endings**.
- Paths must always be handled using Python's `pathlib.Path` or `os.path` to prevent path separator failures between Windows (`\`) and Linux (`/`).
