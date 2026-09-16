"""
Turn-by-Turn Navigation & Road Plan Engine
Leverages real system location, OSRM/Google road routing, and live traffic segment modeling.
When idle, route is empty until a delivery gig is accepted.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple
from hal.base import GPSData
from hal.geolocation import get_system_location
from core.router import fetch_road_route, RoutePoint
from core.traffic import TrafficEngine, TrafficSegment

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
    destination_coords: Optional[Dict[str, float]]
    route_polyline: List[List[float]] = field(default_factory=list)
    traffic_segments: List[Dict[str, Any]] = field(default_factory=list)
    traffic_delay_minutes: int = 0
    current_traffic_status: str = "FLOWING"
    current_traffic_color: str = "#00E676"

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
            "route_polyline": self.route_polyline,
            "traffic_segments": self.traffic_segments,
            "traffic_delay_minutes": self.traffic_delay_minutes,
            "current_traffic_status": self.current_traffic_status,
            "current_traffic_color": self.current_traffic_color
        }

class NavigationEngine:
    def __init__(self, origin_name: str = "Dispatch Origin", destination_name: str = "", google_api_key: str = ""):
        self.google_api_key = google_api_key
        
        # 1. Detect physical starting location
        sys_loc = get_system_location()
        self.origin_name = f"{sys_loc.get('city', 'Current Location')} Station"
        self.current_lat = sys_loc["lat"]
        self.current_lng = sys_loc["lng"]
        
        # When idle on boot, no route exists until an order is accepted
        self.destination_name = destination_name or "Scanning for orders nearby..."
        self.dest_lat: Optional[float] = None
        self.dest_lng: Optional[float] = None
        self.destination_coords: Optional[Dict[str, float]] = None

        self.route_steps: List[RoutePoint] = []
        self.route_polyline: List[List[float]] = []
        self.traffic_segments: List[TrafficSegment] = []
        self.traffic_delay_min: int = 0
        self._current_step_idx = 0
        
        # Route cache: Prevents API spamming when stationary or re-verifying
        self._route_cache: Dict[str, Tuple[List[RoutePoint], List[List[float]], List[TrafficSegment], int]] = {}
        self._last_recalc_time = 0.0

    def import_destination(self, dest_name: str, dest_lat: float, dest_lng: float, force: bool = False) -> None:
        self.destination_name = dest_name
        self.dest_lat = dest_lat
        self.dest_lng = dest_lng
        self.destination_coords = {"lat": dest_lat, "lng": dest_lng}

        cache_key = f"{round(self.current_lat, 3)}_{round(self.current_lng, 3)}_{round(dest_lat, 3)}_{round(dest_lng, 3)}"
        
        if not force and cache_key in self._route_cache:
            self.route_steps, self.route_polyline, self.traffic_segments, self.traffic_delay_min = self._route_cache[cache_key]
            self._current_step_idx = 0
            print(f"[NAVIGATION] Reusing cached route for {dest_name} ({len(self.route_polyline)} pts)")
            return

        self.route_steps, self.route_polyline = fetch_road_route(
            start_lat=self.current_lat,
            start_lng=self.current_lng,
            dest_lat=dest_lat,
            dest_lng=dest_lng,
            dest_name=dest_name,
            google_api_key=self.google_api_key
        )
        
        # Recalculate traffic for new route
        self.traffic_segments = TrafficEngine.generate_traffic_segments(self.route_polyline)
        self.traffic_delay_min = TrafficEngine.calculate_total_delay_minutes(self.traffic_segments)
        self._current_step_idx = 0
        
        # Store in cache
        self._route_cache[cache_key] = (self.route_steps, self.route_polyline, self.traffic_segments, self.traffic_delay_min)
        print(f"[NAVIGATION] New destination route generated: {dest_name} ({len(self.route_steps)} steps, {len(self.route_polyline)} pts, +{self.traffic_delay_min} min traffic delay)")

    def clear_route(self) -> None:
        self.destination_name = "Scanning for orders nearby..."
        self.dest_lat = None
        self.dest_lng = None
        self.destination_coords = None
        self.route_steps = []
        self.route_polyline = []
        self.traffic_segments = []
        self.traffic_delay_min = 0
        self._current_step_idx = 0

    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def _point_to_segment_dist_m(self, p_lat: float, p_lng: float, a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
        """Perpendicular distance from GPS fix to road segment in meters."""
        mid_lat = math.radians((a_lat + b_lat) / 2.0)
        m_per_lat = 111139.0
        m_per_lng = 111139.0 * math.cos(mid_lat)

        ax, ay = a_lng * m_per_lng, a_lat * m_per_lat
        bx, by = b_lng * m_per_lng, b_lat * m_per_lat
        px, py = p_lng * m_per_lng, p_lat * m_per_lat

        dx = bx - ax
        dy = by - ay
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq < 1e-4:
            return math.hypot(px - ax, py - ay)

        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
        proj_x = ax + t * dx
        proj_y = ay + t * dy
        return math.hypot(px - proj_x, py - proj_y)

    def get_current_traffic_speed_factor(self) -> float:
        if not self.traffic_segments:
            return 1.0
        return TrafficEngine.get_current_speed_factor(self._current_step_idx, self.traffic_segments)

    def update_location(self, gps: GPSData) -> Maneuver:
        if gps.is_fixed:
            self.current_lat = gps.latitude
            self.current_lng = gps.longitude

        if not self.route_steps:
            return Maneuver(
                instruction="Standing By",
                road_name="Stationary at Dispatch Base",
                next_instruction="Select an incoming delivery offer above",
                maneuver_type="STRAIGHT",
                distance_to_turn_m=0.0,
                remaining_total_dist_km=0.0,
                eta_minutes=0,
                bearing_deg=gps.heading_deg,
                destination_name=self.destination_name,
                destination_coords=self.destination_coords,
                route_polyline=[],
                traffic_segments=[],
                traffic_delay_minutes=0,
                current_traffic_status="FLOWING",
                current_traffic_color="#00E676"
            )

        step = self.route_steps[self._current_step_idx]
        dist_to_step = self._haversine_distance(self.current_lat, self.current_lng, step.lat, step.lng)

        # Check off-route deviation (> 50 meters from active polyline)
        now = time.time()
        if len(self.route_polyline) >= 2 and self.dest_lat is not None and (now - self._last_recalc_time) > 5.0:
            min_dist_to_route = float('inf')
            window_start = max(0, self._current_step_idx - 1)
            window_end = min(len(self.route_polyline) - 1, self._current_step_idx + 10)
            for i in range(window_start, window_end):
                p1 = self.route_polyline[i]
                p2 = self.route_polyline[i + 1]
                d = self._point_to_segment_dist_m(self.current_lat, self.current_lng, p1[0], p1[1], p2[0], p2[1])
                if d < min_dist_to_route:
                    min_dist_to_route = d

            if min_dist_to_route > 50.0 and min_dist_to_route != float('inf'):
                print(f"[NAVIGATION] Off-route deviation detected ({min_dist_to_route:.1f}m > 50m). Recalculating path to {self.destination_name}...")
                self._last_recalc_time = now
                self.import_destination(self.destination_name, self.dest_lat, self.dest_lng, force=True)
                if self.route_steps:
                    step = self.route_steps[0]
                    dist_to_step = self._haversine_distance(self.current_lat, self.current_lng, step.lat, step.lng)

        # Advance to next waypoint if within 30m
        if dist_to_step < 30 and self._current_step_idx < len(self.route_steps) - 1:
            self._current_step_idx += 1
            step = self.route_steps[self._current_step_idx]
            dist_to_step = self._haversine_distance(self.current_lat, self.current_lng, step.lat, step.lng)

        next_step_idx = min(self._current_step_idx + 1, len(self.route_steps) - 1)
        next_instruction = self.route_steps[next_step_idx].instruction if next_step_idx != self._current_step_idx else "Destination ahead"

        remaining_m = dist_to_step
        for i in range(self._current_step_idx + 1, len(self.route_steps)):
            remaining_m += self.route_steps[i].dist_m

        speed_ms = max(gps.speed_kmh * (1000.0 / 3600.0), 5.0)
        base_eta_min = int(math.ceil(remaining_m / speed_ms / 60.0))
        total_eta_min = base_eta_min + self.traffic_delay_min

        # Determine current segment status
        current_status = "FLOWING"
        current_color = "#00E676"
        for seg in self.traffic_segments:
            if seg.start_idx <= self._current_step_idx <= seg.end_idx:
                current_status = seg.status
                current_color = seg.color
                break

        return Maneuver(
            instruction=step.instruction,
            road_name=step.road_name,
            next_instruction=next_instruction,
            maneuver_type=step.maneuver_type,
            distance_to_turn_m=dist_to_step,
            remaining_total_dist_km=remaining_m / 1000.0,
            eta_minutes=total_eta_min,
            bearing_deg=gps.heading_deg,
            destination_name=self.destination_name,
            destination_coords=self.destination_coords,
            route_polyline=self.route_polyline,
            traffic_segments=[s.to_dict() for s in self.traffic_segments],
            traffic_delay_minutes=self.traffic_delay_min,
            current_traffic_status=current_status,
            current_traffic_color=current_color
        )
