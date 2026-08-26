"""
Hardware Abstraction Layer (HAL) - Base Protocols and Data Structures
Strictly adhering to Ponytail's minimal, duck-typed architecture.
"""

from dataclasses import dataclass
from typing import Optional, Callable, Dict, Any
from datetime import datetime

@dataclass
class GPSData:
    latitude: float
    longitude: float
    speed_kmh: float
    heading_deg: float
    altitude_m: float
    timestamp: datetime
    is_fixed: bool
    satellites: int = 8

    def to_dict(self) -> Dict[str, Any]:
        return {
            "latitude": round(self.latitude, 6),
            "longitude": round(self.longitude, 6),
            "speed_kmh": round(self.speed_kmh, 1),
            "heading_deg": round(self.heading_deg, 1),
            "altitude_m": round(self.altitude_m, 1),
            "timestamp": self.timestamp.isoformat(),
            "is_fixed": self.is_fixed,
            "satellites": self.satellites
        }

@dataclass
class SystemHealthData:
    cpu_temp_c: float
    is_throttled: bool
    voltage_status: str  # 'OK', 'UNDER_VOLTAGE', 'SIMULATED'
    ram_usage_pct: float
    cpu_usage_pct: float
    device_model: str
    uptime_seconds: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cpu_temp_c": round(self.cpu_temp_c, 1),
            "is_throttled": self.is_throttled,
            "voltage_status": self.voltage_status,
            "ram_usage_pct": round(self.ram_usage_pct, 1),
            "cpu_usage_pct": round(self.cpu_usage_pct, 1),
            "device_model": self.device_model,
            "uptime_seconds": int(self.uptime_seconds)
        }

class BaseGPS:
    """Protocol for GPS receivers (Hardware or Virtual Simulator)."""
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def get_latest_fix(self) -> GPSData: ...

class BaseCamera:
    """Protocol for Dashcam / Witness video buffer."""
    def start_buffering(self) -> None: ...
    def stop_buffering(self) -> None: ...
    def lock_incident(self, reason: str, metadata: Dict[str, Any]) -> str: ...
    def get_latest_frame_jpeg(self) -> Optional[bytes]: ...

class BaseSensors:
    """Protocol for Physical / Virtual triggers (Tilt, SOS button, Brightness)."""
    def start(self, on_sos: Callable[[], None], on_tilt: Callable[[], None]) -> None: ...
    def stop(self) -> None: ...
    def get_brightness(self) -> int: ...  # 0 to 100%
    def set_brightness(self, level: int) -> None: ...

class BaseSystemHealth:
    """Protocol for Reading SoC hardware telemetry."""
    def get_health(self) -> SystemHealthData: ...
