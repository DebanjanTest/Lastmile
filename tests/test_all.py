"""
LastMile Guard - Test Suite
Verifies HAL, Kinematics, Traffic Jam Engine, Order Lifecycle, and Delivery parsing.
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
from core.order_manager import OrderManager
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
        
        # Test acceleration
        lat, lng, speed, heading = kin.step(traffic_speed_factor=1.0)
        self.assertGreaterEqual(speed, 0.0)
        self.assertGreater(heading, 0.0)

        # Test traffic jam deceleration
        lat, lng, slow_speed, heading = kin.step(traffic_speed_factor=0.25)
        self.assertLessEqual(slow_speed, 40.0)

    def test_traffic_engine(self):
        polyline = [[22.5700 + i*0.001, 88.3600 + i*0.001] for i in range(10)]
        segments = TrafficEngine.generate_traffic_segments(polyline)
        self.assertGreater(len(segments), 0)
        self.assertIn(segments[0].status, ["FLOWING", "MODERATE", "HEAVY_JAM"])
        self.assertIn(segments[0].color, ["#00E676", "#FF9100", "#FF1744"])

    def test_order_lifecycle_workflow(self):
        route_destinations = []
        def mock_route_change(name, lat, lng):
            route_destinations.append((name, lat, lng))

        om = OrderManager(on_route_change=mock_route_change)
        
        # 1. Offer Order
        order = om.offer_order(platform="swiggy", payout_inr=80.0)
        self.assertEqual(order.state, "OFFERED")

        # 2. Accept Order -> Routes to Restaurant
        accepted = om.accept_order()
        self.assertEqual(accepted.state, "NAV_TO_RESTAURANT")
        self.assertEqual(len(route_destinations), 1)
        self.assertIn("Pickup", route_destinations[0][0])

        # 3. Confirm Food Pickup -> Routes to Customer
        picked = om.confirm_pickup()
        self.assertEqual(picked.state, "NAV_TO_CUSTOMER")
        self.assertEqual(len(route_destinations), 2)
        self.assertIn("Drop", route_destinations[1][0])

        # 4. Complete Delivery
        completed = om.complete_delivery()
        self.assertEqual(completed.state, "DELIVERED")
        self.assertGreaterEqual(om.earnings_today_inr, 80.0)

    def test_delivery_parser(self):
        zomato = DeliveryParser.parse_notification(
            raw_title="Zomato Partner",
            raw_body="Pickup Order #9812 from Burger King",
            package_name="com.application.zomato"
        )
        self.assertEqual(zomato.source, "zomato")
        self.assertEqual(zomato.pickup_or_drop, "PICKUP")

    def test_system_health_warnings(self):
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
