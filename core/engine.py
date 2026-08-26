"""
LastMile Guard Core Engine
Coordinates HAL, Navigation, Dashcam, Safety Alerts, and UI Telemetry Streams.
"""

import asyncio
import json
from typing import Dict, Any, Optional, Set
from datetime import datetime

from hal.factory import create_hal, HALContainer
from core.navigation import NavigationEngine, Maneuver
from core.dashcam import DashcamManager
from core.delivery_parser import DeliveryParser, DeliveryAlert
from core.system_health import SystemHealthSentinel

class LastMileEngine:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.hal: HALContainer = create_hal(config)
        self.navigation = NavigationEngine()
        self.dashcam = DashcamManager(self.hal.camera)
        self.sentinel = SystemHealthSentinel(
            self.hal.health,
            thermal_warn_c=config.get("system_monitor", {}).get("thermal_warning_celsius", 70.0),
            thermal_crit_c=config.get("system_monitor", {}).get("thermal_critical_celsius", 80.0)
        )
        
        self.active_alert: Optional[DeliveryAlert] = None
        self.is_emergency: bool = False
        self.emergency_reason: str = ""
        self.connected_clients: Set[Any] = set()
        self._running = False

    async def start(self) -> None:
        """Starts all background services and registers sensor interrupts."""
        self._running = True
        
        # Start hardware subsystems
        self.hal.gps.start()
        self.dashcam.start()
        self.hal.sensors.start(
            on_sos=self.on_sos_triggered,
            on_tilt=self.on_tilt_triggered
        )
        
        print("[ENGINE] LastMile Guard Core Engine Started Successfully.")
        asyncio.create_task(self._telemetry_broadcast_loop())

    async def stop(self) -> None:
        self._running = False
        self.hal.gps.stop()
        self.dashcam.stop()
        self.hal.sensors.stop()
        print("[ENGINE] LastMile Guard Engine Stopped.")

    def on_sos_triggered(self) -> None:
        """Callback when physical SOS button is pressed or triggered via UI."""
        print("[SAFETY] SOS BUTTON PRESSED! Initiating emergency protocol...")
        gps_fix = self.hal.gps.get_latest_fix()
        self.is_emergency = True
        self.emergency_reason = "MANUAL SOS BUTTON"
        self.dashcam.trigger_incident_lock("MANUAL_SOS_ALERT", gps_fix)

    def on_tilt_triggered(self) -> None:
        """Callback when physical Tilt/Crash sensor detects vehicle fall."""
        print("[SAFETY] VEHICLE TILT / CRASH DETECTED! Initiating emergency protocol...")
        gps_fix = self.hal.gps.get_latest_fix()
        self.is_emergency = True
        self.emergency_reason = "CRASH / TILT DETECTED (>45 deg)"
        self.dashcam.trigger_incident_lock("VEHICLE_CRASH_TILT", gps_fix)

    def reset_emergency(self) -> None:
        self.is_emergency = False
        self.emergency_reason = ""
        print("[SAFETY] Emergency state cleared by rider.")

    def post_delivery_alert(self, title: str, body: str, package_name: str = "") -> DeliveryAlert:
        alert = DeliveryParser.parse_notification(title, body, package_name)
        self.active_alert = alert
        return alert

    def clear_active_alert(self) -> None:
        self.active_alert = None

    def get_latest_telemetry_snapshot(self) -> Dict[str, Any]:
        gps_fix = self.hal.gps.get_latest_fix()
        maneuver = self.navigation.update_location(gps_fix)
        health = self.sentinel.check_health()
        brightness = self.hal.sensors.get_brightness()

        return {
            "timestamp": datetime.now().isoformat(),
            "is_simulated": self.hal.is_simulated,
            "gps": gps_fix.to_dict(),
            "navigation": maneuver.to_dict(),
            "health": health,
            "brightness": brightness,
            "is_emergency": self.is_emergency,
            "emergency_reason": self.emergency_reason,
            "active_alert": self.active_alert.to_dict() if self.active_alert else None,
            "dashcam": {
                "is_recording": self.dashcam.is_recording,
                "last_locked_file": self.dashcam.last_locked_file
            }
        }

    async def _telemetry_broadcast_loop(self) -> None:
        """Publishes high-frequency telemetry packets to all connected UI clients."""
        while self._running:
            try:
                snapshot = self.get_latest_telemetry_snapshot()
                json_data = json.dumps(snapshot)
                
                # Broadcast to active WebSockets
                stale_clients = []
                for ws in self.connected_clients:
                    try:
                        await ws.send_text(json_data)
                    except Exception:
                        stale_clients.append(ws)
                for stale in stale_clients:
                    self.connected_clients.discard(stale)
            except Exception as e:
                print(f"[ENGINE ERROR] Telemetry loop: {e}")
            await asyncio.sleep(0.2)  # 5 updates per second (super smooth & lightweight)
