"""
LastMile Guard Core Engine
Coordinates HAL, Navigation, Traffic, Dashcam, Order Lifecycle, and UI Telemetry Streams.
Thread-safe and concurrency-safe broadcasting.
"""

import asyncio
import json
from typing import Dict, Any, Optional, Set, List
from datetime import datetime

from hal.factory import create_hal, HALContainer
from core.navigation import NavigationEngine, Maneuver
from core.dashcam import DashcamManager
from core.delivery_parser import DeliveryParser, DeliveryAlert
from core.system_health import SystemHealthSentinel
from core.order_manager import OrderManager, DeliveryOrder

class LastMileEngine:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.hal: HALContainer = create_hal(config)
        
        maps_cfg = config.get("maps", {})
        origin_name = maps_cfg.get("default_origin", {}).get("name", "Dispatch Origin")
        destination_name = maps_cfg.get("default_destination", {}).get("name", "Delivery Destination")
        google_api_key = maps_cfg.get("google_maps_api_key", "")

        self.navigation = NavigationEngine(
            origin_name=origin_name,
            destination_name=destination_name,
            google_api_key=google_api_key
        )
        
        # Order Lifecycle Manager
        self.orders = OrderManager(on_route_change=self.import_destination)

        # Sync kinematics waypoints
        if hasattr(self.hal.gps, "set_route_waypoints") and self.navigation.route_polyline:
            self.hal.gps.set_route_waypoints(self.navigation.route_polyline)

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
        self._lock = asyncio.Lock()
        self._running = False

    async def start(self) -> None:
        self._running = True
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
        print("[SAFETY] SOS BUTTON PRESSED! Initiating emergency protocol...")
        gps_fix = self.hal.gps.get_latest_fix()
        self.is_emergency = True
        self.emergency_reason = "MANUAL SOS BUTTON"
        self.dashcam.trigger_incident_lock("MANUAL_SOS_ALERT", gps_fix)

    def on_tilt_triggered(self) -> None:
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

    def import_destination(self, name: str, lat: float, lng: float) -> None:
        self.navigation.import_destination(name, lat, lng)
        if hasattr(self.hal.gps, "set_route_waypoints") and self.navigation.route_polyline:
            self.hal.gps.set_route_waypoints(self.navigation.route_polyline)

    # Order Lifecycle Callbacks
    def offer_mock_order(self, platform: str = "swiggy") -> DeliveryOrder:
        loc = self.navigation.current_lat, self.navigation.current_lng
        # Offset restaurant ~1.2km and customer ~3.2km away in current city
        rest_lat = loc[0] + 0.0070
        rest_lng = loc[1] + 0.0065
        cust_lat = loc[0] + 0.0160
        cust_lng = loc[1] + 0.0180
        
        rest_name = "Wow! Momo Express" if platform == "swiggy" else "Mainland China Delights"
        cust_name = "Debanjan M. (Sector V)"
        
        order = self.orders.offer_order(
            platform=platform,
            restaurant_name=rest_name,
            rest_lat=rest_lat,
            rest_lng=rest_lng,
            rest_addr="Central Ave Food Plaza",
            customer_name=cust_name,
            cust_lat=cust_lat,
            cust_lng=cust_lng,
            cust_addr="Salt Lake Sector V, Block EP",
            payout_inr=85.0,
            items="2x Momo Platters, 1x Cold Drink"
        )
        return order

    def accept_current_order(self) -> Optional[DeliveryOrder]:
        return self.orders.accept_order()

    def confirm_food_pickup(self) -> Optional[DeliveryOrder]:
        return self.orders.confirm_pickup()

    def complete_current_delivery(self) -> Optional[DeliveryOrder]:
        return self.orders.complete_delivery()

    def get_latest_telemetry_snapshot(self) -> Dict[str, Any]:
        gps_fix = self.hal.gps.get_latest_fix()
        maneuver = self.navigation.update_location(gps_fix)
        health = self.sentinel.check_health()
        brightness = self.hal.sensors.get_brightness()

        # Modulate speed according to traffic condition
        if hasattr(self.hal.gps, "set_traffic_factor"):
            factor = self.navigation.get_current_traffic_speed_factor()
            self.hal.gps.set_traffic_factor(factor)

        return {
            "timestamp": datetime.now().isoformat(),
            "is_simulated": self.hal.is_simulated,
            "maps_config": {
                "google_maps_api_key": self.config.get("maps", {}).get("google_maps_api_key", ""),
                "provider": self.config.get("maps", {}).get("provider", "auto")
            },
            "gps": gps_fix.to_dict(),
            "navigation": maneuver.to_dict(),
            "health": health,
            "brightness": brightness,
            "is_emergency": self.is_emergency,
            "emergency_reason": self.emergency_reason,
            "active_alert": self.active_alert.to_dict() if self.active_alert else None,
            "order": self.orders.current_order.to_dict() if self.orders.current_order else None,
            "earnings_today_inr": self.orders.earnings_today_inr,
            "dashcam": {
                "is_recording": self.dashcam.is_recording,
                "last_locked_file": self.dashcam.last_locked_file
            }
        }

    async def broadcast_snapshot(self) -> None:
        """Thread-safe snapshot broadcast to all connected WebSockets."""
        async with self._lock:
            if not self.connected_clients:
                return
            try:
                snapshot = self.get_latest_telemetry_snapshot()
                json_data = json.dumps(snapshot)
                stale_clients = []
                for ws in list(self.connected_clients):
                    try:
                        await ws.send_text(json_data)
                    except Exception:
                        stale_clients.append(ws)
                for stale in stale_clients:
                    self.connected_clients.discard(stale)
            except Exception as e:
                print(f"[ENGINE BROADCAST ERROR] {e}")

    async def _telemetry_broadcast_loop(self) -> None:
        while self._running:
            await self.broadcast_snapshot()
            await asyncio.sleep(0.25)  # Smooth 4 Hz update rate
