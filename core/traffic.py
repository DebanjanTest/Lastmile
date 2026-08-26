"""
Traffic & Congestion Modeling Engine
Calculates traffic flow segments (Green / Orange / Red) and speed modulation along road polylines.
"""

import math
import random
from dataclasses import dataclass
from typing import List, Dict, Any

@dataclass
class TrafficSegment:
    start_idx: int
    end_idx: int
    status: str  # "FLOWING", "MODERATE", "HEAVY_JAM"
    color: str   # "#00E676" (Green), "#FF9100" (Orange), "#FF1744" (Red)
    speed_factor: float  # 1.0, 0.55, 0.25
    delay_seconds: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "start_idx": self.start_idx,
            "end_idx": self.end_idx,
            "status": self.status,
            "color": self.color,
            "speed_factor": self.speed_factor,
            "delay_seconds": self.delay_seconds
        }

class TrafficEngine:
    STATUS_MAP = {
        "FLOWING": {"color": "#00E676", "factor": 1.0, "name": "Smooth Traffic"},
        "MODERATE": {"color": "#FF9100", "factor": 0.55, "name": "Moderate Delay"},
        "HEAVY_JAM": {"color": "#FF1744", "factor": 0.28, "name": "Heavy Congestion"}
    }

    @classmethod
    def generate_traffic_segments(cls, polyline: List[List[float]]) -> List[TrafficSegment]:
        """
        Partitions a road polyline into realistic traffic congestion sections.
        """
        if not polyline or len(polyline) < 4:
            return [TrafficSegment(0, max(1, len(polyline) - 1), "FLOWING", "#00E676", 1.0, 0)]

        total_pts = len(polyline)
        segments: List[TrafficSegment] = []
        curr_idx = 0

        while curr_idx < total_pts - 1:
            # Segment length: between 15% and 35% of total route
            chunk_len = max(2, int(total_pts * random.uniform(0.2, 0.35)))
            end_idx = min(total_pts - 1, curr_idx + chunk_len)

            # Assign traffic condition (65% flowing, 25% moderate, 10% heavy jam)
            roll = random.random()
            if roll < 0.65:
                status = "FLOWING"
            elif roll < 0.90:
                status = "MODERATE"
            else:
                status = "HEAVY_JAM"

            cfg = cls.STATUS_MAP[status]
            delay = 0 if status == "FLOWING" else (45 if status == "MODERATE" else 120)
            
            segments.append(TrafficSegment(
                start_idx=curr_idx,
                end_idx=end_idx,
                status=status,
                color=cfg["color"],
                speed_factor=cfg["factor"],
                delay_seconds=delay
            ))
            curr_idx = end_idx

        return segments

    @classmethod
    def get_current_speed_factor(cls, current_idx: int, segments: List[TrafficSegment]) -> float:
        for seg in segments:
            if seg.start_idx <= current_idx <= seg.end_idx:
                return seg.speed_factor
        return 1.0

    @classmethod
    def calculate_total_delay_minutes(cls, segments: List[TrafficSegment]) -> int:
        total_delay_sec = sum(s.delay_seconds for s in segments)
        return int(math.ceil(total_delay_sec / 60.0))
