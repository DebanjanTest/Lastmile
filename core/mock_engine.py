"""
Standalone Mock Data Injection Engine for LastMile Guard.
Generates synthetic delivery notifications, realistic Kolkata route trajectories,
and customer lifecycle events without requiring external cloud APIs.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import random
import time
from typing import Any, Dict, List, Optional


@dataclass
class MockDeliveryOffer:
    order_id: str
    platform: str
    platform_color: str
    store_name: str
    store_address: str
    store_lat: float
    store_lng: float
    store_dist_km: float
    customer_name: str
    customer_address: str
    customer_lat: float
    customer_lng: float
    drop_dist_km: float
    total_dist_km: float
    payout_inr: float
    items_summary: str
    customer_instructions: str
    payment_mode: str
    order_amount_inr: float
    cod_amount: float
    is_payment_pending: bool
    delivery_otp: str
    prep_time_minutes: int


class MockDataEngine:
    """
    Standalone Mock Data Injection Engine simulating multi-platform delivery gigs
    and real-time Kolkata road kinematic dynamics.
    """

    PLATFORMS = [
        ("swiggy", "#FC8019"),
        ("zomato", "#E23744"),
        ("zepto", "#7C4DFF"),
        ("blinkit", "#F7D046"),
    ]

    KOLKATA_STORES = [
        ("Peter Cat Restaurant", "18A Park Street, Kolkata", 22.5535, 88.3526),
        ("Arsalan Restaurant", "Marina Building, Park Circus 7-Point", 22.5440, 88.3685),
        ("Balaram Mullick Sweets", "Bhowanipore Paddapukur, Kolkata", 22.5312, 88.3498),
        ("Aminia Biryani", "Chinar Park, Rajarhat Main Road", 22.6152, 88.4312),
        ("Wow! Momo Express", "Salt Lake Sector V, Block GP", 22.5714, 88.4316),
        ("6 Ballygunge Place", "Ballygunge Circular Road, Kolkata", 22.5280, 88.3610),
    ]

    KOLKATA_CUSTOMERS = [
        ("Priyanka Roy", "Tower 4, Silver Spring, EM Bypass", 22.5492, 88.3980, "Leave at main door, ring once"),
        ("Subhashis Ghosh", "DLF New Town, Action Area 1, Flat 802", 22.5835, 88.4550, "Call when near security gate"),
        ("Sourav Mukherjee", "Salt Lake Block CF, House 21", 22.5890, 88.4110, "Hand over directly to security"),
        ("Rhea Chatterjee", "Ballygunge Place, Lane 3B", 22.5250, 88.3670, "Do not ring doorbell (baby asleep)"),
        ("Anirban Sen", "Kankurgachi VIP Enclave", 22.5780, 88.3895, "Gate passcode is 4092"),
    ]

    @classmethod
    def generate_synthetic_offer(cls, seed: Optional[int] = None) -> Dict[str, Any]:
        """Generates a synthetic delivery offer in the Kolkata delivery area."""
        s = seed if seed is not None else int(time.time())
        p_idx = s % len(cls.PLATFORMS)
        platform, color = cls.PLATFORMS[p_idx]

        store = cls.KOLKATA_STORES[s % len(cls.KOLKATA_STORES)]
        customer = cls.KOLKATA_CUSTOMERS[s % len(cls.KOLKATA_CUSTOMERS)]

        is_cod = (s % 2) == 0
        order_amount = float(250 + (s * 137) % 550)
        cod_val = order_amount if is_cod else 0.0

        store_dist = round(0.8 + ((s * 3) % 15) * 0.1, 1)
        drop_dist = round(2.1 + ((s * 7) % 35) * 0.1, 1)
        total_dist = round(store_dist + drop_dist, 1)
        payout = round(35.0 + total_dist * 12.50, 2)
        otp = f"{(1234 + s * 739) % 9000 + 1000:04d}"

        return {
            "order_id": f"ORD-MOCK-{1000 + (s % 9000):04d}",
            "platform": platform,
            "platform_color": color,
            "store_name": store[0],
            "store_address": store[1],
            "store_lat": store[2],
            "store_lng": store[3],
            "store_dist_km": store_dist,
            "customer_name": customer[0],
            "customer_address": customer[1],
            "customer_lat": customer[2],
            "customer_lng": customer[3],
            "drop_dist_km": drop_dist,
            "total_dist_km": total_dist,
            "payout_inr": payout,
            "items_summary": "Order combo items: 2x Chef Special Meal, 1x Drink, Mint Chutney",
            "customer_instructions": customer[4],
            "payment_mode": "COD" if is_cod else "PREPAID",
            "order_amount_inr": order_amount,
            "cod_amount": cod_val,
            "is_payment_pending": is_cod,
            "delivery_otp": otp,
            "prep_time_minutes": 3 + (s % 5),
        }

    @classmethod
    def generate_kinematic_waypoints(
        cls,
        start_lat: float,
        start_lng: float,
        end_lat: float,
        end_lng: float,
        steps: int = 20,
    ) -> List[List[float]]:
        """
        Interpolates road-following waypoints between start and end coordinates
        with simulated realistic street curvature.
        """
        waypoints: List[List[float]] = []
        for i in range(steps + 1):
            t = i / float(steps)
            lateral_offset = math.sin(t * math.pi) * 0.0015
            lat = round(start_lat + (end_lat - start_lat) * t + lateral_offset, 6)
            lng = round(start_lng + (end_lng - start_lng) * t - (lateral_offset * 0.5), 6)
            waypoints.append([lat, lng])
        return waypoints
