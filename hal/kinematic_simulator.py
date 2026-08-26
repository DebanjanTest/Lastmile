"""
Realistic Vehicle Kinematics & Physics Simulator
Simulates genuine two-wheeler movement: turn deceleration, traffic jam crawling, and road polyline tracking.
"""

import time
import math
from typing import List, Tuple, Dict, Any, Optional

class KinematicVehicleSimulator:
    def __init__(self, target_cruise_speed_kmh: float = 40.0):
        self.target_cruise_speed_kmh = target_cruise_speed_kmh
        self.current_speed_kmh = 0.0
        self.current_lat = 22.5726
        self.current_lng = 88.3639
        self.current_heading_deg = 45.0
        
        # Polyline tracking state
        self.polyline: List[List[float]] = []
        self.current_segment_idx = 0
        self.segment_progress = 0.0  # 0.0 to 1.0 along current polyline segment
        
        self.last_update_time = time.time()
        self.is_stopped = False

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

        if not self.polyline or len(self.polyline) < 2:
            return self.current_lat, self.current_lng, self.current_speed_kmh, self.current_heading_deg

        idx = self.current_segment_idx
        next_idx = min(idx + 1, len(self.polyline) - 1)
        
        p1 = self.polyline[idx]
        p2 = self.polyline[next_idx]

        # Calculate segment distance in meters
        seg_distance_m = self._haversine(p1[0], p1[1], p2[0], p2[1])
        if seg_distance_m < 0.5:
            # Segment too small, skip to next
            self._advance_segment()
            return self.current_lat, self.current_lng, self.current_speed_kmh, self.current_heading_deg

        # Determine target speed considering traffic & approaching turns
        desired_speed_kmh = self.target_cruise_speed_kmh * traffic_speed_factor

        # Approaching sharp turn deceleration
        is_approaching_turn = (self.current_segment_idx < len(self.polyline) - 2) and (self.segment_progress > 0.7)
        if is_approaching_turn:
            desired_speed_kmh = min(desired_speed_kmh, 16.0)  # Slow to 16 km/h for turn

        # Realistic acceleration/braking physics
        if self.current_speed_kmh < desired_speed_kmh:
            accel_rate = 8.0  # +8 km/h per second
            self.current_speed_kmh = min(desired_speed_kmh, self.current_speed_kmh + accel_rate * dt)
        else:
            braking_rate = 14.0  # -14 km/h per second
            self.current_speed_kmh = max(desired_speed_kmh, self.current_speed_kmh - braking_rate * dt)

        # In heavy traffic jam (< 15 km/h), add realistic city stop-and-go micro-variations
        if traffic_speed_factor < 0.4:
            jitter = math.sin(now * 3.0) * 3.0
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
        self.segment_progress = 0.0
        if self.current_segment_idx < len(self.polyline) - 2:
            self.current_segment_idx += 1
        else:
            # Loop route for continuous testing simulation
            self.current_segment_idx = 0

    def _haversine(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000.0
        p1 = math.radians(lat1)
        p2 = math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _calculate_bearing(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        dl = math.radians(lon2 - lon1)
        y = math.sin(dl) * math.cos(math.radians(lat2))
        x = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) -
             math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dl))
        return (math.degrees(math.atan2(y, x)) + 360) % 360
