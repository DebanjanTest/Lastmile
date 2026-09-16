"""
HAL Factory & Smart Auto-Detection
Seamlessly instantiates Real or Mock drivers based on OS and connected hardware.
"""

import os
import sys
import platform
from pathlib import Path
from typing import Tuple
from hal.base import BaseGPS, BaseCamera, BaseSensors, BaseSystemHealth
from hal.internal_pi import Pi5InternalHealth
from hal.drivers_mock import MockGPS, MockCamera, MockSensors
from hal.drivers_linux import RealGPS, RealPicamera2, RealUSBCamera, RealSensors

class HALContainer:
    def __init__(self, gps: BaseGPS, camera: BaseCamera, sensors: BaseSensors, health: BaseSystemHealth, is_simulated: bool):
        self.gps = gps
        self.camera = camera
        self.sensors = sensors
        self.health = health
        self.is_simulated = is_simulated

def _detect_camera(config: dict, use_real_hardware: bool) -> BaseCamera:
    buffer_seconds = config.get("dashcam", {}).get("buffer_seconds", 60)
    storage_dir = config.get("dashcam", {}).get("storage_path", "evidence/incidents")

    if use_real_hardware:
        # 1. Probe CSI camera via Picamera2
        try:
            from picamera2 import Picamera2
            cam_test = Picamera2()
            cam_test.close()
            print("[HAL] Physical CSI camera detected via Picamera2. Starting RealPicamera2...")
            return RealPicamera2(buffer_seconds=buffer_seconds, storage_dir=storage_dir)
        except Exception:
            pass

        # 2. Probe USB / V4L2 webcam via OpenCV
        try:
            import cv2
            for idx in [0, 1, 2]:
                cap = cv2.VideoCapture(idx)
                if cap.isOpened():
                    ret, frame = cap.read()
                    cap.release()
                    if ret and frame is not None:
                        print(f"[HAL] Physical USB webcam detected on /dev/video{idx}. Starting RealUSBCamera...")
                        return RealUSBCamera(device_index=idx, buffer_seconds=buffer_seconds, storage_dir=storage_dir)
        except Exception:
            pass

    # 3. Fallback: High-fidelity MockCamera with zero-wear RAM circular buffer
    print("[HAL] Using MockCamera (Zero-wear RAM circular buffer in /run/shm + synthetic HUD stream)...")
    return MockCamera(buffer_seconds=buffer_seconds, storage_dir=storage_dir)

def create_hal(config: dict) -> HALContainer:
    is_linux = platform.system() == "Linux"
    force_sim = config.get("simulation", {}).get("force_simulation", False)
    use_real_hardware = is_linux and not force_sim
    
    # Internal Pi 5 health monitor is always real on Linux, simulated on Windows
    health = Pi5InternalHealth()

    # 1. Camera: Auto-detect CSI (Picamera2), USB Webcam (V4L2), or MockCamera
    camera = _detect_camera(config, use_real_hardware)

    # 2. GPS: Auto-detect real UART GPS if enabled and accessible, else MockGPS with route kinematics
    gps_port = Path(config.get("hardware", {}).get("gps_port_linux", "/dev/ttyAMA0"))
    use_real_gps = config.get("hardware", {}).get("use_real_gps", False)
    
    if use_real_hardware and use_real_gps and gps_port.exists() and os.access(gps_port, os.R_OK):
        print(f"[HAL] Physical GPS UART readable on {gps_port}. Starting RealGPS...")
        gps = RealGPS(port=str(gps_port), baudrate=config.get("hardware", {}).get("gps_baudrate", 9600))
    else:
        mode_str = "Pi 5 SoC Kinematics" if is_linux else "Desktop Simulation"
        print(f"[HAL] Using MockGPS ({mode_str} route polyline tracking)...")
        gps = MockGPS(speed_kmh=config.get("navigation", {}).get("speed_kmh", 38.5))

    # 3. Sensors: Real GPIO buttons on Linux, MockSensors in pure simulation
    if use_real_hardware:
        sensors = RealSensors(
            sos_pin=config.get("hardware", {}).get("sos_gpio_pin", 17),
            tilt_pin=config.get("hardware", {}).get("tilt_gpio_pin", 27),
            pwm_pin=config.get("hardware", {}).get("brightness_pwm_pin", 18)
        )
    else:
        sensors = MockSensors()

    is_simulated = force_sim or (isinstance(gps, MockGPS) and isinstance(camera, MockCamera))
    return HALContainer(gps, camera, sensors, health, is_simulated=is_simulated)
