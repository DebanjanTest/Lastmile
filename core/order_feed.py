"""
Multi-App Order Dispatch & Feed Manager
Generates realistic incoming delivery notifications from Zomato, Swiggy, Zepto, and Amazon Flex
calculated dynamically from the rider's current static/live GPS location.
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
    cod_amount: float
    delivery_otp: str
    created_at: float = field(default_factory=time.time)
    expiry_seconds: int = 45

    def to_dict(self) -> Dict[str, Any]:
        remaining = max(0, int(self.expiry_seconds - (time.time() - self.created_at)))
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
            "cod_amount": self.cod_amount,
            "delivery_otp": self.delivery_otp,
            "remaining_seconds": remaining
        }

class OrderFeedManager:
    STORE_TEMPLATES = [
        {"platform": "zomato", "color": "#E23744", "name": "Arsalan Mughlai Restaurant", "addr": "Park Circus 7-Point", "items": "2x Special Mutton Biryani, 1x Firni", "payout_base": 40.0},
        {"platform": "swiggy", "color": "#FC8019", "name": "Wow! Momo Express", "addr": "Central Avenue Hub", "items": "2x Steam Momo Platter, 1x Thums Up", "payout_base": 35.0},
        {"platform": "zepto", "color": "#7C4DFF", "name": "Zepto Dark Store #104", "addr": "Kankurgachi Quick Hub", "items": "1x Fresh Milk, 2x Bread, 1x Butter", "payout_base": 30.0},
        {"platform": "swiggy", "color": "#FC8019", "name": "Haldiram's Sweets & Snacks", "addr": "VIP Road Food Plaza", "items": "1x Kaju Katli (500g), 2x Raj Kachori", "payout_base": 42.0},
        {"platform": "zomato", "color": "#E23744", "name": "Burger King Flagship", "addr": "Mani Square Mall", "items": "2x Crispy Veg Burgers, 2x Fries, 2x Coke", "payout_base": 38.0},
        {"platform": "amazon", "color": "#FF9900", "name": "Amazon Fresh Fulfillment", "addr": "Sector V Logistics Depot", "items": "3x Grocery Package Bins", "payout_base": 45.0}
    ]

    CUSTOMER_NAMES = ["Debanjan M.", "Ananya S.", "Rahul B.", "Priyanka G.", "Sourav K.", "Tanushree D."]
    AREAS = ["Salt Lake Sector V, Block EP", "New Town Action Area 1", "Lake Town Block B", "Kestopur Main Road", "Park Street Area", "Chinar Park Near City Centre 2"]
    INSTRUCTIONS = [
        "🚪 Leave at door & do not ring bell (Baby sleeping)",
        "👮 Hand over to security guard at main gate",
        "📞 Please call once you reach the building",
        "🐕 Beware of pet dog; place package on table",
        "🏢 Flat 402, 4th Floor (Lift is operational)"
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

    def _haversine_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def generate_random_offer(self, rider_lat: float, rider_lng: float) -> DeliveryOffer:
        tmpl = random.choice(self.STORE_TEMPLATES)
        
        # Store is placed 0.8km to 2.2km from rider
        s_angle = random.uniform(0, 2 * math.pi)
        s_dist_deg = random.uniform(0.007, 0.016)
        store_lat = rider_lat + s_dist_deg * math.cos(s_angle)
        store_lng = rider_lng + s_dist_deg * math.sin(s_angle)
        store_dist_km = max(0.8, self._haversine_km(rider_lat, rider_lng, store_lat, store_lng))

        # Customer is placed 1.5km to 3.5km from store
        c_angle = random.uniform(0, 2 * math.pi)
        c_dist_deg = random.uniform(0.012, 0.024)
        cust_lat = store_lat + c_dist_deg * math.cos(c_angle)
        cust_lng = store_lng + c_dist_deg * math.sin(c_angle)
        drop_dist_km = max(1.5, self._haversine_km(store_lat, store_lng, cust_lat, cust_lng))

        total_dist_km = store_dist_km + drop_dist_km
        
        # Indian Delivery Rate Card: Base + (Distance * 8.5/km) + Surge
        surge = random.choice([10.0, 15.0, 20.0, 25.0])
        payout = tmpl["payout_base"] + (total_dist_km * 8.5) + surge

        is_cod = random.random() < 0.25
        offer = DeliveryOffer(
            order_id=str(uuid.uuid4())[:6].upper(),
            platform=tmpl["platform"],
            platform_color=tmpl["color"],
            store_name=tmpl["name"],
            store_address=tmpl["addr"],
            store_lat=store_lat,
            store_lng=store_lng,
            store_dist_km=store_dist_km,
            customer_name=random.choice(self.CUSTOMER_NAMES),
            customer_address=random.choice(self.AREAS),
            customer_lat=cust_lat,
            customer_lng=cust_lng,
            drop_dist_km=drop_dist_km,
            total_dist_km=total_dist_km,
            payout_inr=payout,
            items_summary=tmpl["items"],
            customer_instructions=random.choice(self.INSTRUCTIONS),
            payment_mode="COD" if is_cod else "PREPAID",
            cod_amount=round(random.uniform(250.0, 520.0), 2) if is_cod else 0.0,
            delivery_otp=str(random.randint(1000, 9999)),
            created_at=time.time(),
            expiry_seconds=45
        )
        return offer

    def refresh_order_pool(self, rider_lat: float, rider_lng: float) -> List[DeliveryOffer]:
        """Generates 3 fresh incoming order offers from competing delivery platforms."""
        self.active_offers = [
            self.generate_random_offer(rider_lat, rider_lng),
            self.generate_random_offer(rider_lat, rider_lng),
            self.generate_random_offer(rider_lat, rider_lng)
        ]
        print(f"[FEED] Refreshed order pool: {len(self.active_offers)} gigs available near ({rider_lat:.4f}, {rider_lng:.4f})")
        return self.active_offers

    def select_and_accept_order(self, order_id: str) -> Optional[DeliveryOffer]:
        """Rider selects which order to opt for. Immediately switches to Phase 1 (Route to Shop)."""
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
        self.active_offers = []  # Clear other offers
        self.order_phase = "ROUTE_TO_STORE"
        print(f"[ACCEPT] Rider selected order #{chosen.order_id} ({chosen.platform.upper()})! Phase 1: Marking route to shop: {chosen.store_name}")
        
        # Mark Phase 1 Route: To the Shop/Store
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
        print(f"[STORE] Rider reached {self.selected_order.store_name}. Verifying items...")
        return self.selected_order

    def confirm_pickup_and_route_to_customer(self) -> Optional[DeliveryOffer]:
        """Phase 2: Food is picked up from shop. Marks route to Customer Delivery Location."""
        if not self.selected_order:
            return None
        
        self.order_phase = "ROUTE_TO_CUSTOMER"
        print(f"[PICKUP] Food picked up from {self.selected_order.store_name}! Phase 2: Marking route to customer: {self.selected_order.customer_name}")
        
        # Mark Phase 2 Route: To the Customer Drop Location
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
        print(f"[CUSTOMER] Rider reached customer doorstep: {self.selected_order.customer_name}. Awaiting OTP.")
        return self.selected_order

    def complete_delivery(self) -> Dict[str, Any]:
        """Completes delivery, credits wallet, and generates fresh offers."""
        if not self.selected_order:
            return {"success": False, "error": "No active order"}

        payout = self.selected_order.payout_inr
        self.earnings_today_inr += payout
        self.orders_completed_count += 1

        completed = self.selected_order
        self.selected_order = None
        self.order_phase = "DELIVERED"
        print(f"[DELIVERED] Order #{completed.order_id} delivered! Earned: Rs.{payout:.2f}. Wallet: Rs.{self.earnings_today_inr:.2f}")
        return {
            "success": True,
            "order": completed.to_dict(),
            "payout": payout,
            "earnings_today_inr": self.earnings_today_inr,
            "orders_completed_count": self.orders_completed_count
        }

    def dismiss_offer(self, order_id: str) -> None:
        self.active_offers = [o for o in self.active_offers if o.order_id != order_id]

    def get_snapshot(self, rider_lat: float, rider_lng: float) -> Dict[str, Any]:
        # Purge expired offers
        now = time.time()
        self.active_offers = [o for o in self.active_offers if (now - o.created_at) < o.expiry_seconds]
        
        # If idle and no offers, auto-generate a fresh pool
        if self.order_phase in ("IDLE", "DELIVERED") and not self.active_offers:
            self.refresh_order_pool(rider_lat, rider_lng)

        return {
            "order_phase": self.order_phase,
            "active_offers": [o.to_dict() for o in self.active_offers],
            "selected_order": self.selected_order.to_dict() if self.selected_order else None,
            "earnings_today_inr": round(self.earnings_today_inr, 2),
            "orders_completed_count": self.orders_completed_count,
            "daily_target": self.daily_target
        }
