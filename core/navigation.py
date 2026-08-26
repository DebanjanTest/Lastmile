"""
Turn-by-Turn Navigation & Road Plan Engine
Leverages real system location and dynamic OSRM / Google Maps road routing.
"""

import math
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from hal.base import GPSData
from hal.geolocation import get_system_location
from core.router import fetch_road_route, RoutePoint

@dataclass
class Maneuver:
    instruction: str
    road_name: str
    next_instruction: str
    maneuver_type: str
    distance_to_turn_m: float
    remaining_total_dist_km: float
    eta_minutes: int
    bearing_deg: float
    destination_name: str
    destination_coords: Dict[str, float]
    route_polyline: List[List[float]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "instruction": self.instruction,
            "road_name": self.road_name,
            "next_instruction": self.next_instruction,
            "maneuver_type": self.maneuver_type,
            "distance_to_turn_m": round(self.distance_to_turn_m, 0),
            "remaining_total_dist_km": round(self.remaining_total_dist_km, 1),
            "eta_minutes": self.eta_minutes,
            "bearing_deg": round(self.bearing_deg, 1),
            "destination_name": self.destination_name,
            "destination_coords": self.destination_coords,
            "route_polyline": self.route_polyline
        }

class NavigationEngine:
    def __init__(self, origin_name: str = "Dispatch Origin", destination_name: str = "Delivery Destination", google_api_key: str = ""):
        self.google_api_key = google_api_key
        self.destination_name = destination_name
        
        # 1. Detect physical starting location
        sys_loc = get_system_location()
        self.origin_name = f"{sys_loc.get('city', 'Current Location')} Station"
        self.current_lat = sys_loc["lat"]
        self.current_lng = sys_loc["lng"]
        
        # Target destination (~3 km away from current location by default)
        self.dest_lat = self.current_lat + 0.0160
        self.dest_lng = self.current_lng + 0.0180
        self.destination_coords = {"lat": self.dest_lat, "lng": self.dest_lng}

        # 2. Fetch real road network routing
        self.route_steps, self.route_polyline = fetch_road_route(
            start_lat=self.current_lat,
            start_lng=self.current_lng,
            dest_lat=self.dest_lat,
            dest_lng=self.dest_lng,
            dest_name=self.destination_name,
            google_api_key=self.google_api_key
        )
        
        self._current_step_idx = 0

    def import_destination(self, dest_name: str, dest_lat: float, dest_lng: float) -> None:
        """Dynamically imports a new destination and fetches real road directions."""
        self.destination_name = dest_name
        self.dest_lat = dest_lat
        self.dest_lng = dest_lng
        self.destination_coords = {"lat": dest_lat, "lng": dest_lng}

        self.route_steps, self.route_polyline = fetch_road_route(
            start_lat=self.current_lat,
            start_lng=self.current_lng,
            dest_lat=dest_lat,
            dest_lng=dest_lng,
            dest_name=dest_name,
            google_api_key=self.google_api_key
        )
        self._current_step_idx = 0
        print(f"[NAVIGATION] New destination route generated: {dest_name} ({len(self.route_steps)} steps)")

    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def update_location(self, gps: GPSData) -> Maneuver:
        if gps.is_fixed:
            self.current_lat = gps.latitude
            self.current_lng = gps.longitude

        if not self.route_steps:
            return Maneuver(
                instruction="Proceed to route",
                road_name="Main Road",
                next_instruction="Drive forward",
                maneuver_type="STRAIGHT",
                distance_to_turn_m=0.0,
                remaining_total_dist_km=0.0,
                eta_minutes=0,
                bearing_deg=gps.heading_deg,
                destination_name=self.destination_name,
                destination_coords=self.destination_coords,
                route_polyline=self.route_polyline
            )

        step = self.route_steps[self._current_step_idx]
        dist_to_step = self._haversine_distance(self.current_lat, self.current_lng, step.lat, step.lng)

        # Advance to next waypoint if within 35m
        if dist_to_step < 35 and self._current_step_idx < len(self.route_steps) - 1:
            self._current_step_idx += 1
            step = self.route_steps[self._current_step_idx]
            dist_to_step = self._haversine_distance(self.current_lat, self.current_lng, step.lat, step.lng)

        next_step_idx = min(self._current_step_idx + 1, len(self.route_steps) - 1)
        next_instruction = self.route_steps[next_step_idx].instruction if next_step_idx != self._current_step_idx else "Destination ahead"

        remaining_m = dist_to_step
        for i in range(self._current_step_idx + 1, len(self.route_steps)):
            remaining_m += self.route_steps[i].dist_m

        speed_ms = max(gps.speed_kmh * (1000.0 / 3600.0), 6.0)
        eta_minutes = int(math.ceil(remaining_m / speed_ms / 60.0))

        return Maneuver(
            instruction=step.instruction,
            road_name=step.road_name,
            next_instruction=next_instruction,
            maneuver_type=step.maneuver_type,
            distance_to_turn_m=dist_to_step,
            remaining_total_dist_km=remaining_m / 1000.0,
            eta_minutes=eta_minutes,
            bearing_deg=gps.heading_deg,
            destination_name=self.destination_name,
            destination_coords=self.destination_coords,
            route_polyline=self.route_polyline
        )
