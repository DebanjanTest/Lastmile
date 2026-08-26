"""
Mock Hardware Drivers for Windows Simulation & Testing
Integrates KinematicVehicleSimulator for genuine, physics-based vehicle motion and traffic jam effects.
Rider remains completely stationary until an active delivery gig is accepted.
"""

import time
import math
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List
from hal.base import BaseGPS, BaseCamera, BaseSensors, BaseSystemHealth, GPSData, SystemHealthData
from hal.geolocation import get_system_location
from hal.kinematic_simulator import KinematicVehicleSimulator

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

class MockGPS(BaseGPS):
    def __init__(self, speed_kmh: float = 38.0):
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        
        # Initialize kinematic physics simulator
        self.kinematics = KinematicVehicleSimulator(target_cruise_speed_kmh=speed_kmh)
        self.traffic_speed_factor = 1.0

        # Detect physical system location
        sys_loc = get_system_location()
        self.origin_lat = sys_loc["lat"]
        self.origin_lng = sys_loc["lng"]

        # Rider starts stationary at origin location
        self.kinematics.set_position(self.origin_lat, self.origin_lng)
        self.kinematics.set_motion_enabled(False)

        self._latest_fix = GPSData(
            latitude=self.origin_lat,
            longitude=self.origin_lng,
            speed_kmh=0.0,
            heading_deg=45.0,
            altitude_m=14.0,
            timestamp=datetime.now(timezone.utc),
            is_fixed=True,
            satellites=10
        )

    def set_motion_enabled(self, enabled: bool) -> None:
        """Enables vehicle transit when on order, or halts rider when idle / at store / delivered."""
        with self._lock:
            self.kinematics.set_motion_enabled(enabled)

    def set_route_waypoints(self, waypoints: List[List[float]]) -> None:
        """Loads new road polyline into kinematics simulator."""
        with self._lock:
            self.kinematics.load_polyline(waypoints)

    def set_traffic_factor(self, factor: float) -> None:
        with self._lock:
            self.traffic_speed_factor = factor

    def start(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._update_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False

    def _update_loop(self) -> None:
        while self.running:
            time.sleep(0.2)  # High-fidelity 5 Hz physics update
            with self._lock:
                lat, lng, speed, heading = self.kinematics.step(traffic_speed_factor=self.traffic_speed_factor)
                
                self._latest_fix = GPSData(
                    latitude=lat,
                    longitude=lng,
                    speed_kmh=speed,
                    heading_deg=heading,
                    altitude_m=12.0 + math.sin(time.time()) * 0.5,
                    timestamp=datetime.now(timezone.utc),
                    is_fixed=True,
                    satellites=10
                )

    def get_latest_fix(self) -> GPSData:
        with self._lock:
            return self._latest_fix

class MockCamera(BaseCamera):
    def __init__(self, buffer_seconds: int = 60, storage_dir: str = "evidence/incidents"):
        self.buffer_seconds = buffer_seconds
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.running = False
        self._frame_buffer: List[tuple[float, Any]] = []
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None

    def start_buffering(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def stop_buffering(self) -> None:
        self.running = False

    def _capture_loop(self) -> None:
        while self.running:
            now = time.time()
            frame = self._generate_synthetic_frame(now)
            with self._lock:
                self._frame_buffer.append((now, frame))
                cutoff = now - self.buffer_seconds
                self._frame_buffer = [f for f in self._frame_buffer if f[0] >= cutoff]
            time.sleep(0.1)

    def _generate_synthetic_frame(self, timestamp: float) -> Any:
        if cv2 is None or np is None:
            return f"FRAME_DATA_{timestamp}".encode('utf-8')
        
        # 640x360 Dashcam Canvas
        img = np.zeros((360, 640, 3), dtype=np.uint8)
        img[:] = (24, 28, 36)
        
        # Road lane markings
        cv2.line(img, (0, 360), (280, 200), (60, 60, 60), 4)
        cv2.line(img, (640, 360), (360, 200), (60, 60, 60), 4)
        cv2.line(img, (320, 360), (320, 200), (0, 200, 255), 2)
        
        # OSD Telemetry HUD Stamp
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-4]
        cv2.putText(img, f"LASTMILE DASHCAM - {time_str}", (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 230, 118), 1)
        cv2.putText(img, "REC [BUFFERING 60s RAM]", (15, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 180, 255), 1)
        return img

    def get_latest_frame(self) -> Optional[Any]:
        with self._lock:
            if self._frame_buffer:
                return self._frame_buffer[-1][1]
        return None

    def lock_incident(self, reason: str, metadata: Dict[str, Any]) -> str:
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_reason = reason.lower().replace(" ", "_").replace("/", "_")
        dest_filename = f"incident_{safe_reason}_{timestamp_str}.mp4"
        dest_path = str(self.storage_dir / dest_filename)
        return self.dump_buffer_to_disk(dest_path, reason, metadata)

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        frame = self.get_latest_frame()
        if frame is None:
            return None
        if isinstance(frame, bytes):
            return frame
        if cv2 is not None:
            _, buffer = cv2.imencode('.jpg', frame)
            return buffer.tobytes()
        return None

    def dump_buffer_to_disk(self, destination_path: str, reason: str, metadata: Dict[str, Any]) -> str:
        with self._lock:
            frames_to_save = list(self._frame_buffer)
        
        dest_file = Path(destination_path)
        dest_file.parent.mkdir(parents=True, exist_ok=True)
        
        meta_file = dest_file.with_suffix('.json')
        import json
        with open(meta_file, 'w') as f:
            json.dump({
                "reason": reason,
                "timestamp": datetime.now().isoformat(),
                "frame_count": len(frames_to_save),
                "metadata": metadata
            }, f, indent=2)
            
        with open(dest_file, 'wb') as f:
            f.write(b"MOCK_LOCKED_MP4_EVIDENCE_BUFFER")
            
        return str(dest_file)

class MockSensors(BaseSensors):
    def __init__(self):
        self.brightness = 0.85
        self.is_sos_pressed = False
        self.is_tilted = False
        self._on_sos_callback: Optional[Callable[[], None]] = None
        self._on_tilt_callback: Optional[Callable[[], None]] = None

    def start(self, on_sos: Callable[[], None], on_tilt: Callable[[], None]) -> None:
        self._on_sos_callback = on_sos
        self._on_tilt_callback = on_tilt

    def stop(self) -> None:
        pass

    def get_brightness(self) -> float:
        return self.brightness

    def trigger_sos(self) -> None:
        if self._on_sos_callback:
            self._on_sos_callback()

    def trigger_tilt(self) -> None:
        if self._on_tilt_callback:
            self._on_tilt_callback()

class MockSystemHealth(BaseSystemHealth):
    def get_health(self) -> SystemHealthData:
        return SystemHealthData(
            cpu_temp_c=48.5,
            is_throttled=False,
            voltage_status="OK",
            ram_usage_pct=34.2,
            cpu_usage_pct=18.5,
            device_model="Windows x86_64 Dev Simulation",
            uptime_seconds=1200
        )
