import unittest
from core.order_feed import OrderFeedManager, DeliveryOffer

class TestOrderInfiltration(unittest.TestCase):
    def setUp(self):
        self.route_changes = []
        def on_route(name, lat, lng):
            self.route_changes.append((name, lat, lng))

        self.feed = OrderFeedManager(on_route_change=on_route)

    def test_default_pool_seeding(self):
        offers = self.feed.refresh_order_pool(22.5643, 88.3693)
        self.assertGreaterEqual(len(offers), 4)
        platforms = {o.platform for o in offers}
        self.assertTrue("zomato" in platforms or "swiggy" in platforms)

    def test_infiltrate_dynamic_order(self):
        self.feed.refresh_order_pool(22.5643, 88.3693)
        initial_count = len(self.feed.active_offers)
        
        infiltrated = self.feed.infiltrate_order(rider_lat=22.5643, rider_lng=88.3693)
        self.assertIsInstance(infiltrated, DeliveryOffer)
        self.assertEqual(len(self.feed.active_offers), initial_count + 1)
        # Should be at top of stack
        self.assertEqual(self.feed.active_offers[0].order_id, infiltrated.order_id)

    def test_infiltrate_custom_order_payload(self):
        custom_data = {
            "order_id": "ORD-TEST-INFILTRATE",
            "platform": "blinkit",
            "platform_color": "#F7D046",
            "store_name": "Blinkit Micro-Depot #9",
            "store_address": "Rajarhat Expressway Hub",
            "store_lat": 22.6100,
            "store_lng": 88.4400,
            "customer_name": "Test Customer",
            "customer_address": "Action Area 2, New Town",
            "customer_lat": 22.6200,
            "customer_lng": 88.4600,
            "payout_inr": 92.50,
            "items_summary": "1x Organic Honey, 2x Green Tea",
            "customer_instructions": "Leave on doorstep",
            "payment_mode": "COD",
            "order_amount_inr": 480.0,
            "cod_amount": 480.0,
            "delivery_otp": "3391"
        }
        offer = self.feed.infiltrate_order(order_data=custom_data, rider_lat=22.5643, rider_lng=88.3693)
        self.assertEqual(offer.order_id, "ORD-TEST-INFILTRATE")
        self.assertEqual(offer.platform, "blinkit")
        self.assertEqual(offer.payout_inr, 92.50)
        self.assertEqual(offer.cod_amount, 480.0)
        self.assertEqual(offer.delivery_otp, "3391")
        self.assertEqual(self.feed.active_offers[0].order_id, "ORD-TEST-INFILTRATE")

    def test_systematic_order_lifecycle(self):
        # 1. Infiltrate
        infiltrated = self.feed.infiltrate_order(rider_lat=22.5643, rider_lng=88.3693)
        order_id = infiltrated.order_id

        # 2. Accept
        accepted = self.feed.select_and_accept_order(order_id)
        self.assertIsNotNone(accepted)
        self.assertEqual(accepted.order_id, order_id)
        self.assertEqual(self.feed.order_phase, "ROUTE_TO_STORE")
        self.assertEqual(len(self.route_changes), 1)
        self.assertTrue("Pickup:" in self.route_changes[-1][0])

        # 3. Arrive at Store
        at_store = self.feed.advance_to_at_store()
        self.assertEqual(self.feed.order_phase, "AT_STORE")

        # 4. Pickup and route to customer
        to_cust = self.feed.confirm_pickup_and_route_to_customer()
        self.assertEqual(self.feed.order_phase, "ROUTE_TO_CUSTOMER")
        self.assertEqual(len(self.route_changes), 2)
        self.assertTrue("Drop:" in self.route_changes[-1][0])

        # 5. Arrive at customer
        at_cust = self.feed.advance_to_at_customer()
        self.assertEqual(self.feed.order_phase, "AT_CUSTOMER")

        # 6. Complete delivery
        initial_earnings = self.feed.earnings_today_inr
        result = self.feed.complete_delivery()
        self.assertTrue(result["success"])
        self.assertEqual(self.feed.order_phase, "DELIVERED")
        self.assertGreater(self.feed.earnings_today_inr, initial_earnings)
        self.assertGreaterEqual(len(self.feed.active_offers), 4)

if __name__ == "__main__":
    unittest.main()
