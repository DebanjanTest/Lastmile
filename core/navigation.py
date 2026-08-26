"""
Turn-by-Turn Tripper Navigation Engine
Computes distance, bearing, maneuver icons, and ETA with zero external bloated dependencies.
"""

import math
from dataclasses import dataclass
from typing import Dict, Any, List
from datetime import datetime, timedelta
from hal.base import GPSData

@dataclass
class Maneuver:
    instruction: str
    road_name: str
    maneuver_type: str  # STRAIGHT, TURN_LEFT, TURN_RIGHT, SLIGHT_LEFT, SLIGHT_RIGHT, UTURN, ROUNDABOUT, DESTINATION
    distance_to_turn_m: float
    remaining_total_dist_km: float
    eta_minutes: int
    bearing_deg: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "instruction": self.instruction,
            "road_name": self.road_name,
            "maneuver_type": self.maneuver_type,
            "distance_to_turn_m": round(self.distance_to_turn_m, 0),
            "remaining_total_dist_km": round(self.remaining_total_dist_km, 1),
            "eta_minutes": self.eta_minutes,
            "bearing_deg": round(self.bearing_deg, 1)
        }

class NavigationEngine:
    def __init__(self):
        # Route points and instructions
        self.route_steps = [
            {"lat": 22.5726, "lon": 88.3639, "instruction": "Head northeast on Central Ave", "road": "Central Avenue", "type": "STRAIGHT", "dist_m": 250},
            {"lat": 22.5762, "lon": 88.3678, "instruction": "Turn Right onto MG Road", "road": "Mahatma Gandhi Rd", "type": "TURN_RIGHT", "dist_m": 450},
            {"lat": 22.5780, "lon": 88.3735, "instruction": "Keep left past Sealdah Flyover", "road": "Sealdah Bypass", "type": "SLIGHT_LEFT", "dist_m": 800},
            {"lat": 22.5805, "lon": 88.3840, "instruction": "Take Roundabout 2nd Exit onto EM Bypass", "road": "EM Bypass", "type": "ROUNDABOUT", "dist_m": 1200},
            {"lat": 22.5855, "lon": 88.4168, "instruction": "You have arrived at Sector V Delivery Hub", "road": "Sector V Hub", "type": "DESTINATION", "dist_m": 0}
        ]
        self._current_step_idx = 0

    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Returns distance in meters between two GPS coordinates."""
        R = 6371000.0  # Earth radius in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def update_location(self, gps: GPSData) -> Maneuver:
        if not gps.is_fixed:
            return Maneuver(
                instruction="Acquiring GPS Satellite Lock...",
                road_name="Searching...",
                maneuver_type="STRAIGHT",
                distance_to_turn_m=0.0,
                remaining_total_dist_km=0.0,
                eta_minutes=0,
                bearing_deg=gps.heading_deg
            )

        step = self.route_steps[self._current_step_idx]
        dist_to_step = self._haversine_distance(gps.latitude, gps.longitude, step["lat"], step["lon"])

        # If rider reached within 40m of turn, advance to next maneuver
        if dist_to_step < 40 and self._current_step_idx < len(self.route_steps) - 1:
            self._current_step_idx += 1
            step = self.route_steps[self._current_step_idx]
            dist_to_step = self._haversine_distance(gps.latitude, gps.longitude, step["lat"], step["lon"])

        # Calculate remaining total distance along the route
        remaining_m = dist_to_step
        for i in range(self._current_step_idx + 1, len(self.route_steps)):
            remaining_m += self.route_steps[i]["dist_m"]

        speed_ms = max(gps.speed_kmh * (1000.0 / 3600.0), 5.0)  # Min 5 m/s calculation
        eta_minutes = int(math.ceil(remaining_m / speed_ms / 60.0))

        return Maneuver(
            instruction=step["instruction"],
            road_name=step["road"],
            maneuver_type=step["type"],
            distance_to_turn_m=dist_to_step,
            remaining_total_dist_km=remaining_m / 1000.0,
            eta_minutes=eta_minutes,
            bearing_deg=gps.heading_deg
        )
