"""
Realistic Vehicle Kinematics & Physics Simulator
Simulates genuine two-wheeler movement: turn deceleration, traffic jam crawling, and road polyline tracking.
Rider remains completely stationary until an active delivery is accepted.
"""

import time
import math
from typing import List, Tuple, Dict, Any, Optional

class KinematicVehicleSimulator:
    def __init__(self, target_cruise_speed_kmh: float = 40.0):
        self.target_cruise_speed_kmh = target_cruise_speed_kmh
        self.current_speed_kmh = 0.0
        self.current_lat = 22.5643
        self.current_lng = 88.3693
        self.current_heading_deg = 45.0
        
        # Polyline tracking state
        self.polyline: List[List[float]] = []
        self.current_segment_idx = 0
        self.segment_progress = 0.0  # 0.0 to 1.0 along current polyline segment
        
        self.last_update_time = time.time()
        # Rider is stationary until an order is accepted
        self.is_stationary: bool = True

    def set_motion_enabled(self, enabled: bool) -> None:
        """Enables or pauses vehicle motion."""
        self.is_stationary = not enabled
        if self.is_stationary:
            self.current_speed_kmh = 0.0

    def set_position(self, lat: float, lng: float, heading: float = 45.0) -> None:
        self.current_lat = lat
        self.current_lng = lng
        self.current_heading_deg = heading

    def load_polyline(self, polyline: List[List[float]]) -> None:
        if polyline and len(polyline) >= 2:
            self.polyline = polyline
            self.current_segment_idx = 0
            self.segment_progress = 0.0
            self.current_lat = polyline[0][0]
            self.current_lng = polyline[0][1]
            print(f"[KINEMATICS] Loaded route with {len(polyline)} road coordinates.")

    def step(self, traffic_speed_factor: float = 1.0) -> Tuple[float, float, float, float]:
        """
        Advances vehicle physics by one simulation tick.
        Returns (latitude, longitude, speed_kmh, heading_deg).
        """
        now = time.time()
        dt = min(0.5, max(0.05, now - self.last_update_time))
        self.last_update_time = now

        # If rider is stationary / parked, speed is 0 and position does not change
        if self.is_stationary:
            self.current_speed_kmh = 0.0
            return self.current_lat, self.current_lng, 0.0, self.current_heading_deg

        if not self.polyline or len(self.polyline) < 2:
            self.current_speed_kmh = 0.0
            return self.current_lat, self.current_lng, 0.0, self.current_heading_deg

        idx = self.current_segment_idx
        next_idx = min(idx + 1, len(self.polyline) - 1)
        
        p1 = self.polyline[idx]
        p2 = self.polyline[next_idx]

        # Calculate segment distance in meters
        seg_distance_m = self._haversine(p1[0], p1[1], p2[0], p2[1])
        if seg_distance_m < 0.5:
            # Segment too small, advance to next
            self._advance_segment()
            return self.current_lat, self.current_lng, self.current_speed_kmh, self.current_heading_deg

        # Determine target speed considering traffic & approaching turns
        desired_speed_kmh = self.target_cruise_speed_kmh * traffic_speed_factor

        # Approaching sharp turn deceleration
        is_approaching_turn = (self.current_segment_idx < len(self.polyline) - 2) and (self.segment_progress > 0.7)
        if is_approaching_turn:
            desired_speed_kmh = min(desired_speed_kmh, 16.0)

        # Realistic acceleration/braking physics
        if self.current_speed_kmh < desired_speed_kmh:
            accel_rate = 8.0  # +8 km/h per second
            self.current_speed_kmh = min(desired_speed_kmh, self.current_speed_kmh + accel_rate * dt)
        else:
            braking_rate = 14.0  # -14 km/h per second
            self.current_speed_kmh = max(desired_speed_kmh, self.current_speed_kmh - braking_rate * dt)

        # In heavy traffic jam (< 15 km/h), add micro stop-and-go variations
        if traffic_speed_factor < 0.4:
            jitter = math.sin(now * 3.0) * 2.5
            actual_speed_kmh = max(6.0, self.current_speed_kmh + jitter)
        else:
            actual_speed_kmh = self.current_speed_kmh

        # Compute distance traveled in this tick
        speed_ms = actual_speed_kmh * (1000.0 / 3600.0)
        dist_traveled_m = speed_ms * dt

        # Advance along segment
        progress_delta = dist_traveled_m / max(seg_distance_m, 1.0)
        self.segment_progress += progress_delta

        if self.segment_progress >= 1.0:
            self._advance_segment()

        # Interpolate coordinates
        t = min(1.0, max(0.0, self.segment_progress))
        self.current_lat = p1[0] + (p2[0] - p1[0]) * t
        self.current_lng = p1[1] + (p2[1] - p1[1]) * t
        self.current_heading_deg = self._calculate_bearing(p1[0], p1[1], p2[0], p2[1])

        return self.current_lat, self.current_lng, actual_speed_kmh, self.current_heading_deg

    def _advance_segment(self) -> None:
        if self.current_segment_idx < len(self.polyline) - 2:
            self.current_segment_idx += 1
            self.segment_progress = 0.0
        else:
            # Reached destination, stop moving
            self.segment_progress = 1.0
            self.current_speed_kmh = 0.0
            self.is_stationary = True

    def _haversine(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
        return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _calculate_bearing(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dlam = math.radians(lon2 - lon1)
        x = math.sin(dlam) * math.cos(phi2)
        y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
        bearing = math.degrees(math.atan2(x, y))
        return (bearing + 360.0) % 360.0
