"""
Multi-App Order Dispatch & Feed Manager
Pre-populates stable rich mock orders from Zomato, Swiggy, Zepto, and Amazon Fresh
with exact restaurant coordinates, drop-off coordinates, items, payment QR codes, and income tracker.
"""

import time
import math
import random
import uuid
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable

@dataclass
class DeliveryOffer:
    order_id: str
    platform: str                    # "zomato", "swiggy", "zepto", "amazon"
    platform_color: str              # "#E23744" (Zomato), "#FC8019" (Swiggy), "#7C4DFF" (Zepto), "#FF9900" (Amazon)
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
    payment_mode: str                # "PREPAID", "COD"
    order_amount_inr: float          # Customer bill amount
    cod_amount: float                # Amount to collect if COD
    delivery_otp: str
    prep_time_minutes: int = 4
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        is_pending = (self.payment_mode == "COD" and self.cod_amount > 0)
        return {
            "order_id": self.order_id,
            "platform": self.platform,
            "platform_color": self.platform_color,
            "store_name": self.store_name,
            "store_address": self.store_address,
            "store_coords": {"lat": self.store_lat, "lng": self.store_lng},
            "store_dist_km": round(self.store_dist_km, 1),
            "customer_name": self.customer_name,
            "customer_address": self.customer_address,
            "customer_coords": {"lat": self.customer_lat, "lng": self.customer_lng},
            "drop_dist_km": round(self.drop_dist_km, 1),
            "total_dist_km": round(self.total_dist_km, 1),
            "payout_inr": round(self.payout_inr, 2),
            "items_summary": self.items_summary,
            "customer_instructions": self.customer_instructions,
            "payment_mode": self.payment_mode,
            "order_amount_inr": round(self.order_amount_inr, 2),
            "cod_amount": round(self.cod_amount, 2),
            "is_payment_pending": is_pending,
            "amount_to_collect": round(self.cod_amount if is_pending else 0.0, 2),
            "upi_payment_link": f"upi://pay?pa=lastmile.merchant@icici&pn={self.platform.upper()}_Delivery&am={self.cod_amount:.2f}&cu=INR&tn=Bill_{self.order_id}" if is_pending else "",
            "delivery_otp": self.delivery_otp,
            "prep_time_minutes": self.prep_time_minutes
        }

class OrderFeedManager:
    RICH_ORDER_PRESETS = [
        {
            "id_tag": "ORD-ZOM-81",
            "platform": "zomato",
            "color": "#E23744",
            "store_name": "Arsalan Mughlai Restaurant",
            "store_addr": "Park Circus 7-Point, Kolkata",
            "store_offset": (0.0082, 0.0065),
            "cust_name": "Debanjan Mondal",
            "cust_addr": "Salt Lake Sector V, Block EP, Flat 4B",
            "cust_offset": (0.0175, 0.0165),
            "items": "2x Special Mutton Biryani, 1x Firni Pot, 1x Extra Raita",
            "instr": "🚪 Leave at door & do not ring bell (Baby sleeping)",
            "payout_base": 42.0,
            "prep_mins": 4,
            "payment": "PREPAID",
            "order_amt": 580.0,
            "cod": 0.0
        },
        {
            "id_tag": "ORD-SWG-94",
            "platform": "swiggy",
            "color": "#FC8019",
            "store_name": "Wow! Momo Express",
            "store_addr": "Central Avenue Quick Hub, Kolkata",
            "store_offset": (0.0055, -0.0045),
            "cust_name": "Ananya Sen",
            "cust_addr": "New Town Action Area 1, Tower 3",
            "cust_offset": (0.0192, 0.0210),
            "items": "2x Darjeeling Steamed Momos, 1x Chicken Pan-Fried, 2x Thums Up",
            "instr": "👮 Hand over to building security guard at Gate 2",
            "payout_base": 38.0,
            "prep_mins": 3,
            "payment": "COD",
            "order_amt": 360.0,
            "cod": 360.0
        },
        {
            "id_tag": "ORD-ZEP-12",
            "platform": "zepto",
            "color": "#7C4DFF",
            "store_name": "Zepto 10-Min Dark Store #104",
            "store_addr": "Kankurgachi Logistics Depot",
            "store_offset": (0.0040, 0.0080),
            "cust_name": "Rahul Banerjee",
            "cust_addr": "Lake Town Block B, House 12",
            "cust_offset": (0.0110, 0.0125),
            "items": "2x Amul Taaza Milk (1L), 1x Brown Bread, 1x Amul Butter 500g",
            "instr": "📞 Please call once you arrive near the gate",
            "payout_base": 32.0,
            "prep_mins": 2,
            "payment": "PREPAID",
            "order_amt": 245.0,
            "cod": 0.0
        },
        {
            "id_tag": "ORD-AMZ-55",
            "platform": "amazon",
            "color": "#FF9900",
            "store_name": "Amazon Fresh Fulfillment Depot",
            "store_addr": "EM Bypass Logistics Complex",
            "store_offset": (0.0095, -0.0085),
            "cust_name": "Sourav Karmakar",
            "cust_addr": "Chinar Park Near City Centre 2",
            "cust_offset": (0.0230, 0.0240),
            "items": "3x Fresh Grocery Package Bins",
            "instr": "🐕 Beware of pet dog; place package on veranda table",
            "payout_base": 55.0,
            "prep_mins": 2,
            "payment": "COD",
            "order_amt": 890.0,
            "cod": 890.0
        }
    ]

    def __init__(self, on_route_change: Callable[[str, float, float], None]):
        self.on_route_change = on_route_change
        self.active_offers: List[DeliveryOffer] = []
        self.selected_order: Optional[DeliveryOffer] = None
        # Order phase: "IDLE", "ROUTE_TO_STORE", "AT_STORE", "ROUTE_TO_CUSTOMER", "AT_CUSTOMER", "DELIVERED"
        self.order_phase: str = "IDLE"
        self.earnings_today_inr: float = 485.0
        self.orders_completed_count: int = 6
        self.daily_target: int = 8
        self.daily_target_inr: float = 800.0
        self._last_rider_lat = 22.5643
        self._last_rider_lng = 88.3693

    def _haversine_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def build_offer_from_preset(self, preset: Dict[str, Any], rider_lat: float, rider_lng: float) -> DeliveryOffer:
        self._last_rider_lat = rider_lat
        self._last_rider_lng = rider_lng
        store_lat = rider_lat + preset["store_offset"][0]
        store_lng = rider_lng + preset["store_offset"][1]
        store_dist_km = max(0.6, self._haversine_km(rider_lat, rider_lng, store_lat, store_lng))

        cust_lat = rider_lat + preset["cust_offset"][0]
        cust_lng = rider_lng + preset["cust_offset"][1]
        drop_dist_km = max(1.2, self._haversine_km(store_lat, store_lng, cust_lat, cust_lng))

        total_dist_km = store_dist_km + drop_dist_km
        payout = preset["payout_base"] + (total_dist_km * 8.5) + 15.0

        return DeliveryOffer(
            order_id=preset.get("id_tag", str(uuid.uuid4())[:6].upper()),
            platform=preset["platform"],
            platform_color=preset["color"],
            store_name=preset["store_name"],
            store_address=preset["store_addr"],
            store_lat=store_lat,
            store_lng=store_lng,
            store_dist_km=store_dist_km,
            customer_name=preset["cust_name"],
            customer_address=preset["cust_addr"],
            customer_lat=cust_lat,
            customer_lng=cust_lng,
            drop_dist_km=drop_dist_km,
            total_dist_km=total_dist_km,
            payout_inr=payout,
            items_summary=preset["items"],
            customer_instructions=preset["instr"],
            payment_mode=preset["payment"],
            order_amount_inr=preset.get("order_amt", 350.0),
            cod_amount=preset["cod"],
            delivery_otp="4829",
            prep_time_minutes=preset["prep_mins"],
            created_at=time.time()
        )

    def refresh_order_pool(self, rider_lat: float, rider_lng: float) -> List[DeliveryOffer]:
        """Pre-populates stable, rich mock orders."""
        self.active_offers = [self.build_offer_from_preset(p, rider_lat, rider_lng) for p in self.RICH_ORDER_PRESETS]
        print(f"[FEED] Refreshed order pool with {len(self.active_offers)} stable delivery gigs.")
        return self.active_offers

    def select_and_accept_order(self, order_id: str) -> Optional[DeliveryOffer]:
        """Rider selects an order. Immediately transitions to Phase 1: Route to Restaurant."""
        chosen = None
        for offer in self.active_offers:
            if offer.order_id == order_id:
                chosen = offer
                break
        
        if not chosen and self.active_offers:
            chosen = self.active_offers[0]

        if not chosen:
            return None

        self.selected_order = chosen
        self.active_offers = []  # Clear pending offers
        self.order_phase = "ROUTE_TO_STORE"
        print(f"[ACCEPT] Rider opted into {chosen.order_id} ({chosen.platform.upper()})! Phase 1: Marking Blue Route to Shop: {chosen.store_name}")
        
        # Route to Shop First (Phase 1)
        self.on_route_change(
            f"Pickup: {chosen.store_name}",
            chosen.store_lat,
            chosen.store_lng
        )
        return chosen

    def advance_to_at_store(self) -> Optional[DeliveryOffer]:
        if not self.selected_order:
            return None
        self.order_phase = "AT_STORE"
        print(f"[STORE] Rider arrived at {self.selected_order.store_name}. Verifying items & collecting package.")
        return self.selected_order

    def confirm_pickup_and_route_to_customer(self) -> Optional[DeliveryOffer]:
        """Phase 2: Food picked up. Immediately transitions to Phase 2: Route to Drop-off Location."""
        if not self.selected_order:
            return None
        
        self.order_phase = "ROUTE_TO_CUSTOMER"
        print(f"[PICKUP] Package collected from {self.selected_order.store_name}! Phase 2: Marking Blue Route to Drop-off: {self.selected_order.customer_name}")
        
        # Route to Customer Drop-Off (Phase 2)
        self.on_route_change(
            f"Drop: {self.selected_order.customer_name}",
            self.selected_order.customer_lat,
            self.selected_order.customer_lng
        )
        return self.selected_order

    def advance_to_at_customer(self) -> Optional[DeliveryOffer]:
        if not self.selected_order:
            return None
        self.order_phase = "AT_CUSTOMER"
        print(f"[CUSTOMER] Rider reached customer doorstep: {self.selected_order.customer_name}. Awaiting OTP handover.")
        return self.selected_order

    def complete_delivery(self) -> Dict[str, Any]:
        if not self.selected_order:
            return {"success": False, "error": "No active order"}

        payout = self.selected_order.payout_inr
        self.earnings_today_inr += payout
        self.orders_completed_count += 1

        completed = self.selected_order
        is_pending = (completed.payment_mode == "COD" and completed.cod_amount > 0)
        collect_amt = completed.cod_amount if is_pending else 0.0

        self.selected_order = None
        self.order_phase = "DELIVERED"
        
        # Immediately re-seed 4 fresh mock offers for next trip
        self.refresh_order_pool(self._last_rider_lat, self._last_rider_lng)

        print(f"[DELIVERED] Order #{completed.order_id} DELIVERED! +Rs.{payout:.2f} Credited. Wallet: Rs.{self.earnings_today_inr:.2f} | Customer Collect: Rs.{collect_amt:.2f}")
        return {
            "success": True,
            "order": completed.to_dict(),
            "payout": round(payout, 2),
            "payout_breakdown": {
                "base_pay": round(payout * 0.52, 2),
                "distance_pay": round(completed.total_dist_km * 8.5, 2),
                "surge_bonus": 15.0
            },
            "payment": {
                "payment_mode": completed.payment_mode,
                "order_amount_inr": round(completed.order_amount_inr, 2),
                "is_pending": is_pending,
                "amount_to_collect": round(collect_amt, 2),
                "upi_payment_link": f"upi://pay?pa=lastmile.merchant@icici&pn={completed.platform.upper()}_Delivery&am={collect_amt:.2f}&cu=INR&tn=Bill_{completed.order_id}" if is_pending else ""
            },
            "daily_income": {
                "earnings_today_inr": round(self.earnings_today_inr, 2),
                "orders_completed_count": self.orders_completed_count,
                "daily_target": self.daily_target,
                "daily_target_inr": self.daily_target_inr,
                "progress_pct": min(100, int((self.earnings_today_inr / self.daily_target_inr) * 100))
            }
        }

    def dismiss_offer(self, order_id: str) -> None:
        self.active_offers = [o for o in self.active_offers if o.order_id != order_id]
        if not self.active_offers:
            self.refresh_order_pool(self._last_rider_lat, self._last_rider_lng)

    def get_snapshot(self, rider_lat: float, rider_lng: float) -> Dict[str, Any]:
        self._last_rider_lat = rider_lat
        self._last_rider_lng = rider_lng

        # Auto-seed mock orders if idle/delivered and empty
        if self.order_phase in ("IDLE", "DELIVERED") and not self.active_offers:
            self.refresh_order_pool(rider_lat, rider_lng)

        return {
            "order_phase": self.order_phase,
            "active_offers": [o.to_dict() for o in self.active_offers],
            "selected_order": self.selected_order.to_dict() if self.selected_order else None,
            "earnings_today_inr": round(self.earnings_today_inr, 2),
            "orders_completed_count": self.orders_completed_count,
            "daily_target": self.daily_target,
            "daily_target_inr": self.daily_target_inr
        }
