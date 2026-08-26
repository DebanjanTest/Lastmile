"""
LastMile Guard - Test Suite
Verifies HAL, Kinematics, Traffic Engine, Multi-App Order Feed & 2-Phase Routing.
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
from core.order_feed import OrderFeedManager, DeliveryOffer
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

    def test_order_feed_and_2phase_routing(self):
        routes_history = []
        def mock_route_change(name, lat, lng):
            routes_history.append((name, lat, lng))

        feed = OrderFeedManager(on_route_change=mock_route_change)
        rider_lat, rider_lng = 22.5643, 88.3693
        
        # 1. Refresh & generate competing offers
        offers = feed.refresh_order_pool(rider_lat, rider_lng)
        self.assertEqual(len(offers), 3)
        self.assertGreater(offers[0].payout_inr, 40.0)
        self.assertGreater(offers[0].total_dist_km, 1.0)

        # 2. Select & Opt In -> Phase 1: Route to Store
        chosen_id = offers[0].order_id
        accepted = feed.select_and_accept_order(chosen_id)
        self.assertEqual(feed.order_phase, "ROUTE_TO_STORE")
        self.assertEqual(accepted.order_id, chosen_id)
        self.assertEqual(len(routes_history), 1)
        self.assertIn("Pickup", routes_history[0][0])

        # 3. Arrive at store
        at_store = feed.advance_to_at_store()
        self.assertEqual(feed.order_phase, "AT_STORE")

        # 4. Pick up food -> Phase 2: Route to Customer
        picked = feed.confirm_pickup_and_route_to_customer()
        self.assertEqual(feed.order_phase, "ROUTE_TO_CUSTOMER")
        self.assertEqual(len(routes_history), 2)
        self.assertIn("Drop", routes_history[1][0])

        # 5. Arrive at customer & complete delivery
        feed.advance_to_at_customer()
        res = feed.complete_delivery()
        self.assertTrue(res["success"])
        self.assertEqual(feed.order_phase, "DELIVERED")
        self.assertGreater(feed.earnings_today_inr, 485.0)

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
