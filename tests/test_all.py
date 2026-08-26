"""
LastMile Guard - Test Suite
Verifies HAL, Kinematics, Traffic Engine, and Zomato/Swiggy Delivery Partner Engine.
"""

import unittest
from datetime import datetime, timezone
from pathlib import Path
import shutil

from hal.base import GPSData
from hal.drivers_mock import MockGPS, MockCamera, MockSensors
from hal.factory import create_hal
from hal.geolocation import get_system_location
from hal.kinematic_simulator import KinematicVehicleSimulator
from core.navigation import NavigationEngine
from core.traffic import TrafficEngine
from core.delivery_models import PartnerOrder, OrderItem, EarningBreakdown, RiderDailyStats
from core.delivery_engine import DeliveryPartnerEngine
from core.delivery_parser import DeliveryParser
from core.dashcam import DashcamManager
from core.system_health import SystemHealthSentinel

class TestLastMileGuard(unittest.TestCase):

    def setUp(self):
        self.config = {
            "simulation": {"force_simulation": True},
            "dashcam": {"buffer_seconds": 5, "storage_path": "tests_temp_evidence"},
            "system_monitor": {"thermal_warning_celsius": 70.0, "thermal_critical_celsius": 80.0}
        }
        self.temp_dir = Path("tests_temp_evidence")
        self.temp_dir.mkdir(exist_ok=True)

    def tearDown(self):
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_hal_factory_mock(self):
        hal = create_hal(self.config)
        self.assertTrue(hal.is_simulated)
        fix = hal.gps.get_latest_fix()
        self.assertIsInstance(fix, GPSData)
        self.assertTrue(fix.is_fixed)

    def test_kinematic_physics_movement(self):
        kin = KinematicVehicleSimulator(target_cruise_speed_kmh=40.0)
        route = [[22.5700, 88.3600], [22.5710, 88.3610], [22.5720, 88.3620]]
        kin.load_polyline(route)
        
        lat, lng, speed, heading = kin.step(traffic_speed_factor=1.0)
        self.assertGreaterEqual(speed, 0.0)
        self.assertGreater(heading, 0.0)

    def test_traffic_engine(self):
        polyline = [[22.5700 + i*0.001, 88.3600 + i*0.001] for i in range(10)]
        segments = TrafficEngine.generate_traffic_segments(polyline)
        self.assertGreater(len(segments), 0)
        self.assertIn(segments[0].status, ["FLOWING", "MODERATE", "HEAVY_JAM"])

    def test_delivery_partner_full_lifecycle(self):
        routes_history = []
        def mock_route_change(name, lat, lng):
            routes_history.append((name, lat, lng))

        engine = DeliveryPartnerEngine(on_route_change=mock_route_change)
        
        # 1. Shift duty
        self.assertEqual(engine.shift_state, "ONLINE_SEARCHING")
        engine.toggle_shift_duty()
        self.assertEqual(engine.shift_state, "OFF_DUTY")
        engine.toggle_shift_duty()
        self.assertEqual(engine.shift_state, "ONLINE_SEARCHING")

        # 2. Offer Zomato gig
        order = engine.offer_order(platform="zomato")
        self.assertEqual(order.state, "OFFERED")
        self.assertEqual(order.platform, "zomato")
        self.assertGreater(order.earnings.total_payout, 50.0)
        self.assertGreater(len(order.items), 0)
        self.assertEqual(len(order.delivery_otp), 4)

        # 3. Accept gig -> Routes to store
        accepted = engine.accept_order()
        self.assertEqual(accepted.state, "EN_ROUTE_PICKUP")
        self.assertEqual(len(routes_history), 1)
        self.assertIn("Pickup", routes_history[0][0])

        # 4. Reach store & verify items
        at_store = engine.reach_restaurant()
        self.assertEqual(at_store.state, "AT_RESTAURANT")
        engine.verify_order_items()
        self.assertTrue(all(i.is_verified for i in engine.current_order.items))

        # 5. Confirm pickup -> Routes to customer
        picked = engine.confirm_pickup()
        self.assertEqual(picked.state, "EN_ROUTE_CUSTOMER")
        self.assertEqual(len(routes_history), 2)
        self.assertIn("Drop", routes_history[1][0])

        # 6. Reach customer & verify 4-digit OTP
        at_cust = engine.reach_customer()
        self.assertEqual(at_cust.state, "AT_CUSTOMER")
        
        # Test wrong OTP
        bad_res = engine.verify_otp_and_complete_delivery(entered_otp="0000")
        self.assertFalse(bad_res["success"])

        # Test correct OTP
        good_res = engine.verify_otp_and_complete_delivery(entered_otp=order.delivery_otp)
        self.assertTrue(good_res["success"])
        self.assertGreater(engine.stats.earnings_today_inr, 485.0)
        self.assertEqual(engine.stats.orders_completed_today, 7)
        self.assertEqual(engine.shift_state, "ONLINE_SEARCHING")

    def test_delivery_parser(self):
        zomato = DeliveryParser.parse_notification(
            raw_title="Zomato Partner",
            raw_body="Pickup Order #9812 from Burger King",
            package_name="com.application.zomato"
        )
        self.assertEqual(zomato.source, "zomato")

    def test_system_health(self):
        class MockHealth:
            def get_health(self):
                from hal.base import SystemHealthData
                return SystemHealthData(
                    cpu_temp_c=75.5,
                    is_throttled=True,
                    voltage_status="UNDER_VOLTAGE",
                    ram_usage_pct=40.0,
                    cpu_usage_pct=25.0,
                    device_model="Raspberry Pi 5",
                    uptime_seconds=3600
                )

        sentinel = SystemHealthSentinel(MockHealth(), thermal_warn_c=70.0, thermal_crit_c=80.0)
        report = sentinel.check_health()
        self.assertFalse(report["is_healthy"])

    def test_dashcam_incident_lock(self):
        camera = MockCamera(buffer_seconds=5, storage_dir=str(self.temp_dir))
        dashcam = DashcamManager(camera)
        dashcam.start()

        gps = GPSData(
            latitude=22.572645,
            longitude=88.363892,
            speed_kmh=42.0,
            heading_deg=45.0,
            altitude_m=12.0,
            timestamp=datetime.now(timezone.utc),
            is_fixed=True
        )
        locked_file = dashcam.trigger_incident_lock("TEST_COLLISION", gps)
        self.assertTrue(Path(locked_file).exists() or Path(locked_file).with_suffix(".json").exists())
        dashcam.stop()

if __name__ == "__main__":
    unittest.main()
