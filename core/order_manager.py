"""
Order Lifecycle & Multi-Stop Delivery Manager
Handles Order Offer -> Acceptance -> Navigation to Restaurant -> Food Pickup -> Navigation to Customer.
"""

import time
from dataclasses import dataclass
from typing import Optional, Dict, Any, Callable

@dataclass
class DeliveryOrder:
    order_id: str
    platform: str            # "swiggy", "zomato", "zepto", "amazon"
    restaurant_name: str
    restaurant_lat: float
    restaurant_lng: float
    restaurant_address: str
    customer_name: str
    customer_lat: float
    customer_lng: float
    customer_address: str
    payout_inr: float
    items: str
    created_at: float
    state: str               # "OFFERED", "NAV_TO_RESTAURANT", "AT_RESTAURANT", "NAV_TO_CUSTOMER", "DELIVERED"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "order_id": self.order_id,
            "platform": self.platform,
            "restaurant_name": self.restaurant_name,
            "restaurant_coords": {"lat": self.restaurant_lat, "lng": self.restaurant_lng},
            "restaurant_address": self.restaurant_address,
            "customer_name": self.customer_name,
            "customer_coords": {"lat": self.customer_lat, "lng": self.customer_lng},
            "customer_address": self.customer_address,
            "payout_inr": self.payout_inr,
            "items": self.items,
            "state": self.state
        }

class OrderManager:
    def __init__(self, on_route_change: Callable[[str, float, float], None]):
        self.current_order: Optional[DeliveryOrder] = None
        self.on_route_change = on_route_change
        self.earnings_today_inr = 450.0

    def offer_order(
        self,
        platform: str = "swiggy",
        restaurant_name: str = "Wow! Momo Express",
        rest_lat: float = 22.5745,
        rest_lng: float = 22.3685,
        rest_addr: str = "Central Avenue, Kolkata",
        customer_name: str = "Debanjan M.",
        cust_lat: float = 22.5855,
        cust_lng: float = 88.4168,
        cust_addr: str = "Sector V, Block EP & GP, Salt Lake",
        payout_inr: float = 75.0,
        items: str = "2x Darjeeling Steam Momos, 1x Thums Up"
    ) -> DeliveryOrder:
        import uuid
        order = DeliveryOrder(
            order_id=str(uuid.uuid4())[:6].upper(),
            platform=platform,
            restaurant_name=restaurant_name,
            restaurant_lat=rest_lat,
            restaurant_lng=rest_lng,
            restaurant_address=rest_addr,
            customer_name=customer_name,
            customer_lat=cust_lat,
            customer_lng=cust_lng,
            customer_address=cust_addr,
            payout_inr=payout_inr,
            items=items,
            created_at=time.time(),
            state="OFFERED"
        )
        self.current_order = order
        print(f"[ORDER] New order offered #{order.order_id} from {order.restaurant_name} (Payout: Rs.{order.payout_inr})")
        return order

    def accept_order(self) -> Optional[DeliveryOrder]:
        if not self.current_order or self.current_order.state != "OFFERED":
            return None
        
        self.current_order.state = "NAV_TO_RESTAURANT"
        print(f"[ORDER] Order #{self.current_order.order_id} ACCEPTED! Routing to restaurant: {self.current_order.restaurant_name}")
        
        # Switch navigation to Restaurant Destination
        self.on_route_change(
            f"Pickup: {self.current_order.restaurant_name}",
            self.current_order.restaurant_lat,
            self.current_order.restaurant_lng
        )
        return self.current_order

    def confirm_pickup(self) -> Optional[DeliveryOrder]:
        if not self.current_order:
            return None
        
        self.current_order.state = "NAV_TO_CUSTOMER"
        print(f"[ORDER] Food picked up from restaurant! Routing to customer: {self.current_order.customer_name}")
        
        # Switch navigation to Customer Drop Destination
        self.on_route_change(
            f"Drop: {self.current_order.customer_name}",
            self.current_order.customer_lat,
            self.current_order.customer_lng
        )
        return self.current_order

    def complete_delivery(self) -> Optional[DeliveryOrder]:
        if not self.current_order:
            return None
        
        self.earnings_today_inr += self.current_order.payout_inr
        self.current_order.state = "DELIVERED"
        print(f"[ORDER] Order #{self.current_order.order_id} successfully delivered! Total earnings: Rs.{self.earnings_today_inr}")
        
        completed = self.current_order
        self.current_order = None
        return completed

    def decline_order(self) -> None:
        if self.current_order and self.current_order.state == "OFFERED":
            print(f"[ORDER] Order #{self.current_order.order_id} declined by rider.")
            self.current_order = None
