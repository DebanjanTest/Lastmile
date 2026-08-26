"""
Mock Hardware Drivers for Windows Simulation & Testing
Integrates KinematicVehicleSimulator for genuine, physics-based vehicle motion and traffic jam effects.
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

        # Initial fallback route
        init_route = [
            [self.origin_lat, self.origin_lng],
            [self.origin_lat + 0.0040, self.origin_lng + 0.0030],
            [self.origin_lat + 0.0080, self.origin_lng + 0.0075],
            [self.origin_lat + 0.0130, self.origin_lng + 0.0120],
            [self.origin_lat + 0.0180, self.origin_lng + 0.0190]
        ]
        self.kinematics.load_polyline(init_route)

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
                    altitude_m=12.0 + math.sin(time.time()) * 1.5,
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
        frame_count = 0
        while self.running:
            time.sleep(0.1)
            now = time.time()
            frame = self._generate_synthetic_frame(frame_count, now)
            frame_count += 1

            with self._lock:
                self._frame_buffer.append((now, frame))
                cutoff = now - self.buffer_seconds
                while self._frame_buffer and self._frame_buffer[0][0] < cutoff:
                    self._frame_buffer.pop(0)

    def _generate_synthetic_frame(self, frame_num: int, timestamp: float):
        if cv2 is None or np is None:
            return None
        img = np.zeros((360, 640, 3), dtype=np.uint8)
        img[:] = (25, 25, 30)

        # Draw road horizon lines
        cv2.line(img, (0, 240), (640, 240), (60, 60, 70), 2)
        cv2.line(img, (200, 240), (50, 360), (120, 120, 120), 3)
        cv2.line(img, (440, 240), (590, 360), (120, 120, 120), 3)

        # Moving center dashed line
        offset = int((frame_num * 10) % 60)
        for y in range(240 + offset, 360, 40):
            cv2.line(img, (320, y), (320, min(360, y + 20)), (0, 215, 255), 3)

        time_str = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(img, f"LASTMILE GUARD - WITNESS DASHCAM [SIM]", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 180), 1)
        cv2.putText(img, f"REC (RAM-BUF) | {time_str} | 38.5 KM/H", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
        cv2.putText(img, f"RAM DISK: /run/shm/ OK | BUF: {len(self._frame_buffer)} frames", (20, 340), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (150, 150, 150), 1)
        return img

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        with self._lock:
            if not self._frame_buffer or cv2 is None:
                return None
            latest_frame = self._frame_buffer[-1][1]
            if latest_frame is None:
                return None
            _, buf = cv2.imencode('.jpg', latest_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            return buf.tobytes()

    def lock_incident(self, reason: str, metadata: Dict[str, Any]) -> str:
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"incident_{reason.lower().replace(' ', '_')}_{timestamp_str}.mp4"
        filepath = self.storage_dir / filename

        with self._lock:
            frames_to_save = [f[1] for f in self._frame_buffer if f[1] is not None]

        if cv2 and frames_to_save:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(str(filepath), fourcc, 10.0, (640, 360))
            for frame in frames_to_save:
                annotated = frame.copy()
                cv2.putText(annotated, f"INCIDENT LOCKED: {reason.upper()}", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                out.write(annotated)
            out.release()

        meta_path = filepath.with_suffix(".json")
        import json
        meta_path.write_text(json.dumps({
            "incident_reason": reason,
            "timestamp": datetime.now().isoformat(),
            "telemetry": metadata,
            "locked_frames_count": len(frames_to_save),
            "file_path": str(filepath)
        }, indent=2))
        return str(filepath)

class MockSensors(BaseSensors):
    def __init__(self):
        self.brightness = 85
        self.on_sos_callback: Optional[Callable[[], None]] = None
        self.on_tilt_callback: Optional[Callable[[], None]] = None

    def start(self, on_sos: Callable[[], None], on_tilt: Callable[[], None]) -> None:
        self.on_sos_callback = on_sos
        self.on_tilt_callback = on_tilt

    def stop(self) -> None:
        pass

    def trigger_sos(self) -> None:
        if self.on_sos_callback:
            self.on_sos_callback()

    def trigger_tilt(self) -> None:
        if self.on_tilt_callback:
            self.on_tilt_callback()

    def get_brightness(self) -> int:
        return self.brightness

    def set_brightness(self, level: int) -> None:
        self.brightness = max(10, min(100, level))
