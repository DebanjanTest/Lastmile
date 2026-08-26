"""
HAL Factory & Smart Auto-Detection
Seamlessly instantiates Real or Mock drivers based on OS and connected hardware.
"""

import sys
import platform
from pathlib import Path
from typing import Tuple
from hal.base import BaseGPS, BaseCamera, BaseSensors, BaseSystemHealth
from hal.internal_pi import Pi5InternalHealth
from hal.drivers_mock import MockGPS, MockCamera, MockSensors
from hal.drivers_linux import RealGPS, RealPicamera2, RealSensors

class HALContainer:
    def __init__(self, gps: BaseGPS, camera: BaseCamera, sensors: BaseSensors, health: BaseSystemHealth, is_simulated: bool):
        self.gps = gps
        self.camera = camera
        self.sensors = sensors
        self.health = health
        self.is_simulated = is_simulated

def create_hal(config: dict) -> HALContainer:
    is_linux = platform.system() == "Linux"
    force_sim = config.get("simulation", {}).get("force_simulation", False)
    
    # Internal Pi 5 health monitor is always real on Linux, simulated on Windows
    health = Pi5InternalHealth()

    # Check if we should use real hardware
    use_real_hardware = is_linux and not force_sim
    gps_port = Path(config.get("hardware", {}).get("gps_port_linux", "/dev/ttyAMA0"))

    if use_real_hardware and gps_port.exists():
        print("[HAL] Physical GPS UART detected on /dev/ttyAMA0. Starting Real Drivers...")
        gps = RealGPS(port=str(gps_port), baudrate=config.get("hardware", {}).get("gps_baudrate", 9600))
        camera = RealPicamera2(
            buffer_seconds=config.get("dashcam", {}).get("buffer_seconds", 60),
            storage_dir=config.get("dashcam", {}).get("storage_path", "evidence/incidents")
        )
        sensors = RealSensors(
            sos_pin=config.get("hardware", {}).get("sos_gpio_pin", 17),
            tilt_pin=config.get("hardware", {}).get("tilt_gpio_pin", 27),
            pwm_pin=config.get("hardware", {}).get("brightness_pwm_pin", 18)
        )
        return HALContainer(gps, camera, sensors, health, is_simulated=False)
    else:
        # Hybrid or Pure Simulation Mode (Ideal for Pi 5 + HDMI monitor testing)
        mode_str = "Hybrid (Real Pi 5 SoC + Mock Peripherals)" if is_linux else "Windows Desktop Simulation"
        print(f"[HAL] Initializing {mode_str}...")
        gps = MockGPS(speed_kmh=config.get("navigation", {}).get("speed_kmh", 38.5))
        camera = MockCamera(
            buffer_seconds=config.get("dashcam", {}).get("buffer_seconds", 60),
            storage_dir=config.get("dashcam", {}).get("storage_path", "evidence/incidents")
        )
        sensors = MockSensors()
        return HALContainer(gps, camera, sensors, health, is_simulated=True)
