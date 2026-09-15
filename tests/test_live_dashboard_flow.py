"""
Comprehensive End-to-End Test Suite for Order Availability & Lifecycle Flow
Verifies:
1. Continuous order availability (minimum 4 offers at all times in IDLE/DELIVERED)
2. Dismissing an offer instantly replenishes so pool never drops below 4
3. Customer placing orders (infiltration) adds fresh gigs to the driver HUD
4. Phase transitions: Accept -> Reached Store -> Pickup -> Reached Customer -> OTP Handover -> Delivery
5. Post-delivery autonomous replenishment of fresh gigs
"""

import unittest
from core.engine import LastMileEngine
from core.order_feed import OrderFeedManager, DeliveryOffer

class TestLiveDashboardFlow(unittest.TestCase):

    def setUp(self):
        self.config = {
            "simulation": {"force_simulation": True},
            "dashcam": {"buffer_seconds": 5, "storage_path": "tests_temp_evidence"},
            "system_monitor": {"thermal_warning_celsius": 70.0, "thermal_critical_celsius": 80.0}
        }
        self.engine = LastMileEngine(self.config)

    def test_continuous_order_availability(self):
        # 1. Initial snapshot has at least 4 active offers
        snap = self.engine.get_latest_telemetry_snapshot()
        self.assertIn(snap["order_phase"], ["IDLE", "DELIVERED"])
        self.assertGreaterEqual(len(snap["active_offers"]), 4)

        # 2. Dismiss an offer -> should immediately maintain at least 4
        target_id = snap["active_offers"][0]["order_id"]
        self.engine.dismiss_offer(target_id)
        
        snap2 = self.engine.get_latest_telemetry_snapshot()
        self.assertGreaterEqual(len(snap2["active_offers"]), 4)
        active_ids = [o["order_id"] for o in snap2["active_offers"]]
        self.assertNotIn(target_id, active_ids)

    def test_customer_order_placement_flow(self):
        # Customer places a new order
        custom_payload = {
            "order_id": "ORD-LIVE-CUST-1",
            "platform": "zomato",
            "store_name": "Peter Cat Restaurant",
            "store_address": "18A Park Street, Kolkata",
            "customer_name": "Debanjan Mondal",
            "customer_address": "Salt Lake Sector V, Block EP",
            "payout_inr": 88.50,
            "items_summary": "1x Chelo Kebab Platter",
            "payment_mode": "COD",
            "cod_amount": 650.0,
            "delivery_otp": "7742"
        }
        infiltrated = self.engine.infiltrate_order(custom_payload)
        self.assertEqual(infiltrated.order_id, "ORD-LIVE-CUST-1")

        snap = self.engine.get_latest_telemetry_snapshot()
        # Top offer should be the freshly placed customer order
        self.assertEqual(snap["active_offers"][0]["order_id"], "ORD-LIVE-CUST-1")
        self.assertEqual(snap["active_offers"][0]["delivery_otp"], "7742")

        # Driver accepts the order
        accepted = self.engine.select_and_accept_order("ORD-LIVE-CUST-1")
        self.assertIsNotNone(accepted)
        self.assertEqual(accepted.order_id, "ORD-LIVE-CUST-1")
        self.assertEqual(self.engine.feed.order_phase, "ROUTE_TO_STORE")

        # Step 1: Reached Store
        self.engine.reach_store()
        self.assertEqual(self.engine.feed.order_phase, "AT_STORE")

        # Step 2: Food Picked Up -> Route to Customer
        self.engine.pickup_order_and_route_to_customer()
        self.assertEqual(self.engine.feed.order_phase, "ROUTE_TO_CUSTOMER")

        # Step 3: Reached Customer Doorstep
        self.engine.reach_customer()
        self.assertEqual(self.engine.feed.order_phase, "AT_CUSTOMER")

        # Step 4: OTP Verified & Handover Complete
        res = self.engine.complete_delivery()
        self.assertTrue(res["success"])
        self.assertEqual(self.engine.feed.order_phase, "DELIVERED")
        self.assertEqual(res["payment"]["payment_mode"], "COD")
        self.assertEqual(res["payment"]["amount_to_collect"], 650.0)

        # Step 5: Verify post-delivery availability
        post_snap = self.engine.get_latest_telemetry_snapshot()
        self.assertGreaterEqual(len(post_snap["active_offers"]), 4)

if __name__ == "__main__":
    unittest.main()
