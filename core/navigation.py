"""
Turn-by-Turn Navigation & Road Plan Engine (Google Maps Navigation Style)
Provides route geometry, turn maneuvers, distance countdown, and destination importing.
"""

import math
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from datetime import datetime
from hal.base import GPSData

@dataclass
class RoutePoint:
    lat: float
    lng: float
    instruction: str
    road_name: str
    maneuver_type: str  # STRAIGHT, TURN_LEFT, TURN_RIGHT, SLIGHT_LEFT, SLIGHT_RIGHT, UTURN, ROUNDABOUT, DESTINATION
    dist_m: float

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
    def __init__(self, origin_name: str = "Kolkata Central Hub", destination_name: str = "Salt Lake Sector V Drop"):
        self.origin_name = origin_name
        self.destination_name = destination_name
        
        # Demarked Road Plan & Route Polyline
        self.route_steps: List[RoutePoint] = [
            RoutePoint(22.572645, 88.363892, "Head northeast on Central Ave", "Central Avenue", "STRAIGHT", 250),
            RoutePoint(22.573900, 88.364500, "In 150m Turn Right onto MG Road", "MG Road", "TURN_RIGHT", 350),
            RoutePoint(22.576200, 88.367800, "Continue straight towards Sealdah Flyover", "Sealdah Flyover", "STRAIGHT", 600),
            RoutePoint(22.578000, 88.373500, "In 250m Bear Left onto Beliaghata Main Rd", "Beliaghata Main Rd", "SLIGHT_LEFT", 800),
            RoutePoint(22.580500, 88.384000, "In 300m Take Roundabout 2nd exit onto EM Bypass", "EM Bypass", "ROUNDABOUT", 1100),
            RoutePoint(22.585500, 88.416800, "Arriving at Sector V Delivery Destination", "Sector V Hub", "DESTINATION", 0)
        ]
        
        self.destination_coords = {
            "lat": self.route_steps[-1].lat,
            "lng": self.route_steps[-1].lng
        }
        
        # High-resolution road polyline for Google Maps / Leaflet rendering
        self.route_polyline = [
            [p.lat, p.lng] for p in self.route_steps
        ]
        
        self._current_step_idx = 0

    def import_destination(self, dest_name: str, dest_lat: float, dest_lng: float, steps: Optional[List[Dict[str, Any]]] = None) -> None:
        """Dynamically imports a new destination and recalculates the road plan."""
        self.destination_name = dest_name
        self.destination_coords = {"lat": dest_lat, "lng": dest_lng}
        if steps:
            self.route_steps = [
                RoutePoint(
                    lat=s.get("lat", dest_lat),
                    lng=s.get("lng", dest_lng),
                    instruction=s.get("instruction", "Proceed to destination"),
                    road_name=s.get("road", "Main Road"),
                    maneuver_type=s.get("type", "STRAIGHT"),
                    dist_m=float(s.get("dist_m", 500))
                ) for s in steps
            ]
        else:
            # Generate straight-line connection if no detailed steps provided
            self.route_steps = [
                RoutePoint(22.572645, 88.363892, f"Navigate towards {dest_name}", "En Route", "STRAIGHT", 500),
                RoutePoint(dest_lat, dest_lng, f"Arrive at {dest_name}", dest_name, "DESTINATION", 0)
            ]
        self.route_polyline = [[p.lat, p.lng] for p in self.route_steps]
        self._current_step_idx = 0
        print(f"[NAVIGATION] New destination imported: {dest_name} ({dest_lat}, {dest_lng})")

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
                instruction="Acquiring GPS Satellite Signal...",
                road_name="Locating...",
                next_instruction="Drive towards indicated route",
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
        dist_to_step = self._haversine_distance(gps.latitude, gps.longitude, step.lat, step.lng)

        # Advance to next waypoint if within 35m
        if dist_to_step < 35 and self._current_step_idx < len(self.route_steps) - 1:
            self._current_step_idx += 1
            step = self.route_steps[self._current_step_idx]
            dist_to_step = self._haversine_distance(gps.latitude, gps.longitude, step.lat, step.lng)

        # Next upcoming instruction preview
        next_step_idx = min(self._current_step_idx + 1, len(self.route_steps) - 1)
        next_instruction = self.route_steps[next_step_idx].instruction if next_step_idx != self._current_step_idx else "Destination ahead"

        # Calculate remaining route distance
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
