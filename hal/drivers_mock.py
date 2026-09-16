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
    def __init__(self, buffer_seconds: int = 300, storage_dir: str = "evidence/incidents"):
        self.buffer_seconds = buffer_seconds
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        # Allocate volatile ring buffer in Linux tmpfs (/run/shm) if available
        self.ram_disk_dir = Path("/run/shm/dashcam_ring") if Path("/run/shm").exists() else (
            Path("/dev/shm/dashcam_ring") if Path("/dev/shm").exists() else Path("evidence/ram_shm/dashcam_ring")
        )
        try:
            self.ram_disk_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
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
        cv2.putText(img, "REC [BUFFERING 300s RAM /run/shm]", (15, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 180, 255), 1)
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
        now_ts = time.time()
        with open(meta_file, 'w') as f:
            json.dump({
                "reason": reason,
                "incident_reason": reason,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "timestamp_us": int(now_ts * 1_000_000),
                "frame_count": len(frames_to_save),
                "frames_preserved": len(frames_to_save),
                "pre_incident_buffer_seconds": self.buffer_seconds,
                "post_incident_buffer_seconds": 30,
                "ram_buffer_mount": str(self.ram_disk_dir),
                "acceleration_vector": metadata.get("acceleration_vector", {
                    "x_axis_g": 0.0,
                    "y_axis_g": 0.0,
                    "z_axis_g": 1.0,
                    "tilt_degrees": 48.2 if "tilt" in reason.lower() or "crash" in reason.lower() else 0.0
                }),
                "metadata": metadata,
                "telemetry": metadata
            }, f, indent=2)
            
        written_video = False
        if cv2 is not None and frames_to_save:
            try:
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                sample = frames_to_save[0][1]
                if isinstance(sample, np.ndarray):
                    h, w = sample.shape[:2]
                    writer = cv2.VideoWriter(str(dest_file), fourcc, 10.0, (w, h))
                    for _, frame_img in frames_to_save:
                        if isinstance(frame_img, np.ndarray):
                            writer.write(frame_img)
                    writer.release()
                    if dest_file.exists() and dest_file.stat().st_size > 0:
                        written_video = True
            except Exception as e:
                pass

        if not written_video:
            with open(dest_file, 'wb') as f:
                f.write(b"MOCK_LOCKED_MP4_EVIDENCE_BUFFER_300S_PRE_ROLL")
            
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
