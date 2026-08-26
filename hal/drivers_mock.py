"""
Mock Hardware Drivers for Windows Simulation & Development
Generates realistic GPS route playback, synthetic Dashcam feeds, and interactive triggers.
"""

import time
import math
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List
from hal.base import BaseGPS, BaseCamera, BaseSensors, BaseSystemHealth, GPSData, SystemHealthData

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

# Realistic urban delivery route waypoints (e.g., Kolkata corridor)
SIMULATED_ROUTE = [
    {"lat": 22.572645, "lon": 88.363892, "maneuver": "Start from Kolkata Central Hub", "dist": 0.0},
    {"lat": 22.573900, "lon": 88.364500, "maneuver": "Head northeast on Central Ave", "dist": 150.0},
    {"lat": 22.576200, "lon": 88.367800, "maneuver": "In 200m Turn Right onto MG Road", "dist": 350.0},
    {"lat": 22.578000, "lon": 88.373500, "maneuver": "Continue straight past Sealdah Flyover", "dist": 600.0},
    {"lat": 22.580500, "lon": 88.384000, "maneuver": "In 300m Take Roundabout 2nd exit onto EM Bypass", "dist": 1100.0},
    {"lat": 22.585500, "lon": 88.416800, "maneuver": "Arriving at Sector V Delivery Destination", "dist": 2400.0}
]

class MockGPS(BaseGPS):
    def __init__(self, speed_kmh: float = 38.0):
        self.speed_kmh = speed_kmh
        self.running = False
        self._current_index = 0
        self._progress = 0.0  # 0.0 to 1.0 between waypoints
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        
        start = SIMULATED_ROUTE[0]
        self._latest_fix = GPSData(
            latitude=start["lat"],
            longitude=start["lon"],
            speed_kmh=self.speed_kmh,
            heading_deg=45.0,
            altitude_m=12.5,
            timestamp=datetime.now(timezone.utc),
            is_fixed=True,
            satellites=10
        )

    def start(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._update_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False

    def _calculate_heading(self, lat1, lon1, lat2, lon2) -> float:
        d_lon = math.radians(lon2 - lon1)
        y = math.sin(d_lon) * math.cos(math.radians(lat2))
        x = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) -
             math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(d_lon))
        bearing = math.degrees(math.atan2(y, x))
        return (bearing + 360) % 360

    def _update_loop(self) -> None:
        while self.running:
            time.sleep(0.5)
            with self._lock:
                idx = self._current_index
                next_idx = (idx + 1) % len(SIMULATED_ROUTE)
                
                p1 = SIMULATED_ROUTE[idx]
                p2 = SIMULATED_ROUTE[next_idx]
                
                self._progress += 0.04  # Advance smoothly
                if self._progress >= 1.0:
                    self._progress = 0.0
                    self._current_index = next_idx
                    p1 = SIMULATED_ROUTE[next_idx]
                    p2 = SIMULATED_ROUTE[(next_idx + 1) % len(SIMULATED_ROUTE)]

                # Linear interpolation
                lat = p1["lat"] + (p2["lat"] - p1["lat"]) * self._progress
                lon = p1["lon"] + (p2["lon"] - p1["lon"]) * self._progress
                heading = self._calculate_heading(p1["lat"], p1["lon"], p2["lat"], p2["lon"])
                
                # Small speed jitter (+/- 3 km/h)
                jitter = math.sin(time.time() * 2) * 3.0
                current_speed = max(10.0, self.speed_kmh + jitter)

                self._latest_fix = GPSData(
                    latitude=lat,
                    longitude=lon,
                    speed_kmh=current_speed,
                    heading_deg=heading,
                    altitude_m=12.0 + math.sin(time.time()) * 2.0,
                    timestamp=datetime.now(timezone.utc),
                    is_fixed=True,
                    satellites=10
                )

    def get_latest_fix(self) -> GPSData:
        with self._lock:
            return self._latest_fix

class MockCamera(BaseCamera):
    """Generates synthetic video frames and manages an in-memory rolling circular buffer."""
    def __init__(self, buffer_seconds: int = 60, storage_dir: str = "evidence/incidents"):
        self.buffer_seconds = buffer_seconds
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.running = False
        self._frame_buffer: List[tuple[float, Any]] = []  # (timestamp, frame)
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
            time.sleep(0.1)  # 10 fps simulation in mock mode to save CPU
            now = time.time()
            frame = self._generate_synthetic_frame(frame_count, now)
            frame_count += 1

            with self._lock:
                self._frame_buffer.append((now, frame))
                # Purge frames older than buffer_seconds
                cutoff = now - self.buffer_seconds
                while self._frame_buffer and self._frame_buffer[0][0] < cutoff:
                    self._frame_buffer.pop(0)

    def _generate_synthetic_frame(self, frame_num: int, timestamp: float):
        if cv2 is None or np is None:
            return None
        # Create dark road background
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

        # Telemetry Watermark HUD
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
        """Flushes RAM circular buffer and saves an immutable incident evidence record."""
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"incident_{reason.lower().replace(' ', '_')}_{timestamp_str}.mp4"
        filepath = self.storage_dir / filename

        with self._lock:
            frames_to_save = [f[1] for f in self._frame_buffer if f[1] is not None]

        if cv2 and frames_to_save:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(str(filepath), fourcc, 10.0, (640, 360))
            for frame in frames_to_save:
                # Add incident lock banner
                annotated = frame.copy()
                cv2.putText(annotated, f"INCIDENT LOCKED: {reason.upper()}", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                out.write(annotated)
            out.release()

        # Write accompanying metadata JSON
        meta_path = filepath.with_suffix(".json")
        meta_content = {
            "incident_reason": reason,
            "timestamp": datetime.now().isoformat(),
            "telemetry": metadata,
            "locked_frames_count": len(frames_to_save),
            "file_path": str(filepath)
        }
        import json
        meta_path.write_text(json.dumps(meta_content, indent=2))
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
