"""
LastMile Guard Core Engine
Coordinates HAL, Navigation, Traffic, Dashcam, and the Multi-App Order Feed & 2-Phase Routing System.
Keeps rider completely stationary at a specific location until an active delivery is accepted.
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
from core.order_feed import OrderFeedManager, DeliveryOffer

class LastMileEngine:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.hal: HALContainer = create_hal(config)
        
        maps_cfg = config.get("maps", {})
        origin_name = maps_cfg.get("default_origin", {}).get("name", "Dispatch Origin")
        google_api_key = maps_cfg.get("google_maps_api_key", "")

        self.navigation = NavigationEngine(
            origin_name=origin_name,
            google_api_key=google_api_key
        )
        
        # Multi-App Order Feed & 2-Phase Routing Manager
        self.feed = OrderFeedManager(on_route_change=self.import_destination)

        # Seed initial pool of notifications
        self.feed.refresh_order_pool(self.navigation.current_lat, self.navigation.current_lng)

        # Rider starts stationary at origin location
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(False)

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

    # Order Feed Actions
    def refresh_orders(self) -> List[DeliveryOffer]:
        return self.feed.refresh_order_pool(self.navigation.current_lat, self.navigation.current_lng)

    def select_and_accept_order(self, order_id: str) -> Optional[DeliveryOffer]:
        order = self.feed.select_and_accept_order(order_id)
        # Enable vehicle motion along the route to the restaurant
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(True)
        return order

    def reach_store(self) -> Optional[DeliveryOffer]:
        order = self.feed.advance_to_at_store()
        # Halt motion while at restaurant
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(False)
        return order

    def pickup_order_and_route_to_customer(self) -> Optional[DeliveryOffer]:
        order = self.feed.confirm_pickup_and_route_to_customer()
        # Enable vehicle motion along the route to customer drop-off
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(True)
        return order

    def reach_customer(self) -> Optional[DeliveryOffer]:
        order = self.feed.advance_to_at_customer()
        # Halt motion at customer doorstep
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(False)
        return order

    def complete_delivery(self) -> Dict[str, Any]:
        res = self.feed.complete_delivery()
        # Clear navigation route & park rider stably
        self.navigation.clear_route()
        if hasattr(self.hal.gps, "set_motion_enabled"):
            self.hal.gps.set_motion_enabled(False)
        return res

    def dismiss_offer(self, order_id: str) -> None:
        self.feed.dismiss_offer(order_id)

    def get_latest_telemetry_snapshot(self) -> Dict[str, Any]:
        gps_fix = self.hal.gps.get_latest_fix()
        maneuver = self.navigation.update_location(gps_fix)
        health = self.sentinel.check_health()
        brightness = self.hal.sensors.get_brightness()
        feed_snap = self.feed.get_snapshot(self.navigation.current_lat, self.navigation.current_lng)

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
            "feed": feed_snap,
            "order_phase": feed_snap["order_phase"],
            "active_offers": feed_snap["active_offers"],
            "selected_order": feed_snap["selected_order"],
            "earnings_today_inr": feed_snap["earnings_today_inr"],
            "orders_completed_count": feed_snap["orders_completed_count"],
            "daily_target": feed_snap["daily_target"],
            "dashcam": {
                "is_recording": self.dashcam.is_recording,
                "last_locked_file": self.dashcam.last_locked_file
            }
        }

    async def broadcast_snapshot(self) -> None:
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
            await asyncio.sleep(0.2)
