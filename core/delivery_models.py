"""
Zomato & Swiggy Delivery Partner Data Models
Defines complete schemas for Shift Duty, Order Offers, Earning Breakdowns, Item Checklists, and Delivery OTPs.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import time

@dataclass
class EarningBreakdown:
    base_pay: float = 35.0
    distance_pay: float = 24.0   # e.g., ₹8/km beyond base
    surge_pay: float = 15.0      # Peak hour surge
    rain_bonus: float = 0.0      # Weather bonus
    wait_time_pay: float = 0.0   # ₹1/min restaurant waiting
    tips: float = 10.0           # Customer tip

    @property
    def total_payout(self) -> float:
        return round(self.base_pay + self.distance_pay + self.surge_pay + self.rain_bonus + self.wait_time_pay + self.tips, 2)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "base_pay": self.base_pay,
            "distance_pay": self.distance_pay,
            "surge_pay": self.surge_pay,
            "rain_bonus": self.rain_bonus,
            "wait_time_pay": self.wait_time_pay,
            "tips": self.tips,
            "total_payout": self.total_payout
        }

@dataclass
class OrderItem:
    name: str
    quantity: int
    is_veg: bool
    is_verified: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "quantity": self.quantity,
            "is_veg": self.is_veg,
            "is_verified": self.is_verified
        }

@dataclass
class PartnerOrder:
    order_id: str
    platform: str                    # "zomato", "swiggy", "zepto", "amazon_flex"
    restaurant_name: str
    restaurant_address: str
    restaurant_lat: float
    restaurant_lng: float
    customer_name: str
    customer_address: str
    customer_lat: float
    customer_lng: float
    customer_phone: str
    customer_instructions: str       # "Leave with guard", "Don't ring bell (Baby sleeping)"
    payment_mode: str                # "PREPAID", "COD" (Cash on Delivery)
    cod_amount: float                # If COD, amount to collect
    delivery_otp: str                # 4-digit OTP for secure completion
    prep_time_minutes: int           # Store food prep time
    items: List[OrderItem] = field(default_factory=list)
    earnings: EarningBreakdown = field(default_factory=EarningBreakdown)
    created_at: float = field(default_factory=time.time)
    
    # State: "OFFERED", "EN_ROUTE_PICKUP", "AT_RESTAURANT", "EN_ROUTE_CUSTOMER", "AT_CUSTOMER", "DELIVERED", "REJECTED"
    state: str = "OFFERED"
    offer_expiry_seconds: int = 30
    offer_started_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        elapsed = time.time() - self.offer_started_at
        remaining_offer_sec = max(0, int(self.offer_expiry_seconds - elapsed))
        return {
            "order_id": self.order_id,
            "platform": self.platform,
            "restaurant_name": self.restaurant_name,
            "restaurant_address": self.restaurant_address,
            "restaurant_coords": {"lat": self.restaurant_lat, "lng": self.restaurant_lng},
            "customer_name": self.customer_name,
            "customer_address": self.customer_address,
            "customer_coords": {"lat": self.customer_lat, "lng": self.customer_lng},
            "customer_phone": self.customer_phone,
            "customer_instructions": self.customer_instructions,
            "payment_mode": self.payment_mode,
            "cod_amount": self.cod_amount,
            "delivery_otp": self.delivery_otp,
            "prep_time_minutes": self.prep_time_minutes,
            "items": [item.to_dict() for item in self.items],
            "earnings": self.earnings.to_dict(),
            "state": self.state,
            "offer_remaining_seconds": remaining_offer_sec
        }

@dataclass
class RiderDailyStats:
    earnings_today_inr: float = 485.0
    orders_completed_today: int = 6
    distance_driven_km: float = 24.8
    online_time_minutes: int = 210
    daily_target_orders: int = 8
    target_bonus_inr: float = 150.0
    rating: float = 4.92
    acceptance_rate_pct: int = 96

    def to_dict(self) -> Dict[str, Any]:
        return {
            "earnings_today_inr": round(self.earnings_today_inr, 2),
            "orders_completed_today": self.orders_completed_today,
            "distance_driven_km": round(self.distance_driven_km, 1),
            "online_time_minutes": self.online_time_minutes,
            "daily_target_orders": self.daily_target_orders,
            "target_bonus_inr": self.target_bonus_inr,
            "rating": self.rating,
            "acceptance_rate_pct": self.acceptance_rate_pct,
            "target_progress_pct": min(100, int((self.orders_completed_today / max(1, self.daily_target_orders)) * 100))
        }
