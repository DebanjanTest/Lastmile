"""
Witness Dashcam Manager
Orchestrates zero-wear RAM circular buffering and immutable incident lock files.
"""

from typing import Dict, Any, Optional
from hal.base import BaseCamera, GPSData

class DashcamManager:
    def __init__(self, camera: BaseCamera):
        self.camera = camera
        self.is_recording = False
        self.last_locked_file: Optional[str] = None

    def start(self) -> None:
        self.camera.start_buffering()
        self.is_recording = True

    def stop(self) -> None:
        self.camera.stop_buffering()
        self.is_recording = False

    def trigger_incident_lock(self, reason: str, gps_data: GPSData) -> str:
        """Locks and exports pre-incident and post-incident video to disk."""
        metadata = {
            "latitude": gps_data.latitude,
            "longitude": gps_data.longitude,
            "speed_kmh": gps_data.speed_kmh,
            "heading_deg": gps_data.heading_deg,
            "timestamp": gps_data.timestamp.isoformat(),
            "reason": reason
        }
        saved_file = self.camera.lock_incident(reason=reason, metadata=metadata)
        self.last_locked_file = saved_file
        print(f"[DASHCAM] Incident locked! Video evidence saved to: {saved_file}")
        return saved_file

    def get_live_frame_jpeg(self) -> Optional[bytes]:
        return self.camera.get_latest_frame_jpeg()
