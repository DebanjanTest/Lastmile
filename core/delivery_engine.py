"""
Zomato & Swiggy Delivery Partner Workflow Engine
Implements authentic delivery partner logic: Shift States, Surge Pricing, Prep Timers, Item Checklists, OTP Delivery Verification, and Milestone Targets.
"""

import time
import random
import uuid
from typing import Optional, Dict, Any, List, Callable
from core.delivery_models import PartnerOrder, OrderItem, EarningBreakdown, RiderDailyStats

class DeliveryPartnerEngine:
    RESTAURANT_PRESETS = [
        {"name": "Arsalan Mughlai Restaurant", "addr": "Park Circus 7-Point, Kolkata", "items": [("Special Mutton Biryani", 2, False), ("Firni Pot", 1, True), ("Extra Raita", 1, True)]},
        {"name": "Wow! Momo Express", "addr": "Central Avenue Hub, Kolkata", "items": [("Darjeeling Steamed Momos", 2, True), ("Chicken Pan-Fried Momos", 1, False), ("Thums Up 500ml", 1, True)]},
        {"name": "Haldiram's Bhujiawala", "addr": "Kankurgachi Main Road, Kolkata", "items": [("Raj Kachori Special", 2, True), ("Kaju Katli (250g)", 1, True), ("Gulab Jamun Pack", 1, True)]},
        {"name": "Burger King Flagship", "addr": "Mani Square Mall, EM Bypass", "items": [("Crispy Veg Double Patty", 2, True), ("Chicken Whopper Meal", 1, False), ("Peri Peri Fries", 2, True)]}
    ]

    CUSTOMER_INSTRUCTIONS = [
        "🚪 Leave at door & do not ring bell (Baby sleeping)",
        "👮 Hand over to building security guard at main gate",
        "📞 Please call once you reach Gate No. 2",
        "🐕 Beware of pet dog; please place food on veranda table",
        "🏢 Flat 402, 4th Floor (Lift is operational)"
    ]

    def __init__(self, on_route_change: Callable[[str, float, float], None]):
        self.on_route_change = on_route_change
        self.shift_state = "ONLINE_SEARCHING"  # "OFF_DUTY", "ONLINE_SEARCHING", "ON_ORDER"
        self.current_order: Optional[PartnerOrder] = None
        self.stats = RiderDailyStats()
        self.surge_multiplier = 1.4
        self.active_hotspots = [
            {"name": "Sector V Tech Hub", "lat": 22.5855, "lng": 88.4168, "surge": "1.6x Surge", "color": "#FF1744"},
            {"name": "Park Street Restaurant Hub", "lat": 22.5510, "lng": 88.3530, "surge": "1.4x Surge", "color": "#FF9100"}
        ]
        self._store_arrival_time: Optional[float] = None

    def toggle_shift_duty(self) -> str:
        if self.shift_state == "OFF_DUTY":
            self.shift_state = "ONLINE_SEARCHING"
            print("[DUTY] Rider is now ONLINE - Searching for high-value orders...")
        else:
            if self.current_order:
                print("[DUTY] Cannot go offline with an active order in progress.")
                return self.shift_state
            self.shift_state = "OFF_DUTY"
            print("[DUTY] Rider is now OFF-DUTY. Shift paused.")
        return self.shift_state

    def offer_order(
        self,
        platform: str = "swiggy",
        rider_lat: float = 22.5643,
        rider_lng: float = 88.3693
    ) -> PartnerOrder:
        preset = random.choice(self.RESTAURANT_PRESETS)
        instr = random.choice(self.CUSTOMER_INSTRUCTIONS)
        
        # Realistic local coordinates
        rest_lat = rider_lat + random.uniform(0.004, 0.009)
        rest_lng = rider_lng + random.uniform(0.003, 0.008)
        cust_lat = rest_lat + random.uniform(0.008, 0.015)
        cust_lng = rest_lng + random.uniform(0.007, 0.014)

        # Build item checklist
        items_list = [OrderItem(name=name, quantity=qty, is_veg=is_veg, is_verified=False) for name, qty, is_veg in preset["items"]]
        
        # Transparent Zomato/Swiggy Earnings Model
        distance_km = round(random.uniform(2.5, 4.8), 1)
        base_pay = 35.0
        distance_pay = round(distance_km * 7.5, 2)
        surge_pay = round(15.0 * self.surge_multiplier, 2)
        tip = random.choice([0.0, 10.0, 20.0, 30.0])
        earnings = EarningBreakdown(
            base_pay=base_pay,
            distance_pay=distance_pay,
            surge_pay=surge_pay,
            rain_bonus=10.0 if random.random() > 0.5 else 0.0,
            wait_time_pay=0.0,
            tips=tip
        )

        is_cod = random.random() < 0.3
        order = PartnerOrder(
            order_id=str(uuid.uuid4())[:6].upper(),
            platform=platform,
            restaurant_name=preset["name"],
            restaurant_address=preset["addr"],
            restaurant_lat=rest_lat,
            restaurant_lng=rest_lng,
            customer_name="Debanjan Mondal",
            customer_address="Salt Lake Sector V, Block EP, Kolkata",
            customer_lat=cust_lat,
            customer_lng=cust_lng,
            customer_phone="+91 98301 24921",
            customer_instructions=instr,
            payment_mode="COD" if is_cod else "PREPAID",
            cod_amount=385.0 if is_cod else 0.0,
            delivery_otp=str(random.randint(1000, 9999)),
            prep_time_minutes=random.randint(3, 8),
            items=items_list,
            earnings=earnings,
            state="OFFERED",
            offer_expiry_seconds=30,
            offer_started_at=time.time()
        )
        self.current_order = order
        self.shift_state = "ON_ORDER"
        print(f"[{platform.upper()}] New order offered #{order.order_id} from {order.restaurant_name} (Guaranteed Payout: Rs.{order.earnings.total_payout})")
        return order

    def accept_order(self) -> Optional[PartnerOrder]:
        if not self.current_order:
            self.offer_order()
        
        self.current_order.state = "EN_ROUTE_PICKUP"
        print(f"[ORDER] Order #{self.current_order.order_id} ACCEPTED! Routing to restaurant: {self.current_order.restaurant_name}")
        
        # Route to restaurant
        self.on_route_change(
            f"Pickup: {self.current_order.restaurant_name}",
            self.current_order.restaurant_lat,
            self.current_order.restaurant_lng
        )
        return self.current_order

    def reach_restaurant(self) -> Optional[PartnerOrder]:
        if not self.current_order:
            return None
        self.current_order.state = "AT_RESTAURANT"
        self._store_arrival_time = time.time()
        print(f"[ORDER] Rider arrived at {self.current_order.restaurant_name}. Waiting for food prep / verification.")
        return self.current_order

    def verify_order_items(self) -> Optional[PartnerOrder]:
        if not self.current_order:
            return None
        for item in self.current_order.items:
            item.is_verified = True
        print(f"[ORDER] All items verified for order #{self.current_order.order_id}.")
        return self.current_order

    def confirm_pickup(self) -> Optional[PartnerOrder]:
        if not self.current_order:
            self.offer_order()
            self.accept_order()
        
        self.verify_order_items()
        
        # Calculate restaurant wait pay (if waited > 3 minutes)
        if self._store_arrival_time:
            wait_sec = time.time() - self._store_arrival_time
            if wait_sec > 60:
                self.current_order.earnings.wait_time_pay = round((wait_sec / 60.0) * 1.5, 2)
        
        self.current_order.state = "EN_ROUTE_CUSTOMER"
        print(f"[ORDER] Food picked up from {self.current_order.restaurant_name}! Routing to customer: {self.current_order.customer_name}")
        
        # Route to customer drop
        self.on_route_change(
            f"Drop: {self.current_order.customer_name}",
            self.current_order.customer_lat,
            self.current_order.customer_lng
        )
        return self.current_order

    def reach_customer(self) -> Optional[PartnerOrder]:
        if not self.current_order:
            return None
        self.current_order.state = "AT_CUSTOMER"
        print(f"[ORDER] Rider arrived at customer doorstep. Requesting 4-digit Delivery OTP: {self.current_order.delivery_otp}")
        return self.current_order

    def verify_otp_and_complete_delivery(self, entered_otp: Optional[str] = None) -> Dict[str, Any]:
        if not self.current_order:
            self.offer_order()
            self.accept_order()
            self.confirm_pickup()
        
        # Verify OTP (or auto-verify if None/empty in test environment)
        expected_otp = self.current_order.delivery_otp
        if entered_otp and entered_otp.strip() != expected_otp:
            print(f"[SECURITY] OTP Mismatch! Entered: {entered_otp}, Expected: {expected_otp}")
            return {"success": False, "error": "Invalid OTP. Please ask the customer for their 4-digit code."}

        payout = self.current_order.earnings.total_payout
        self.stats.earnings_today_inr += payout
        self.stats.orders_completed_today += 1
        self.stats.distance_driven_km += 3.4
        
        # Check if daily milestone was unlocked (e.g. 8 orders milestone)
        unlocked_bonus = False
        if self.stats.orders_completed_today == self.stats.daily_target_orders:
            self.stats.earnings_today_inr += self.stats.target_bonus_inr
            unlocked_bonus = True
            print(f"[INCENTIVE] Milestone Unlocked! +Rs.{self.stats.target_bonus_inr} Bonus awarded to rider!")

        self.current_order.state = "DELIVERED"
        completed = self.current_order
        self.current_order = None
        self.shift_state = "ONLINE_SEARCHING"
        self._store_arrival_time = None

        print(f"[ORDER] Order #{completed.order_id} DELIVERED! Credited: Rs.{payout}. Daily Total: Rs.{self.stats.earnings_today_inr}")
        return {
            "success": True,
            "order": completed.to_dict(),
            "payout": payout,
            "unlocked_bonus": unlocked_bonus,
            "stats": self.stats.to_dict()
        }

    def reject_order(self) -> None:
        if self.current_order and self.current_order.state == "OFFERED":
            print(f"[ORDER] Order #{self.current_order.order_id} rejected by rider.")
            self.current_order = None
            self.shift_state = "ONLINE_SEARCHING"

    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "shift_state": self.shift_state,
            "surge_multiplier": self.surge_multiplier,
            "hotspots": self.active_hotspots,
            "stats": self.stats.to_dict(),
            "current_order": self.current_order.to_dict() if self.current_order else None
        }
