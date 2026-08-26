"""
LastMile Guard - Test Suite
Verifies HAL, Navigation state machine, Dashcam circular buffering, and Delivery parsing.
"""

import unittest
from datetime import datetime, timezone
from pathlib import Path
import shutil

from hal.base import GPSData
from hal.drivers_mock import MockGPS, MockCamera, MockSensors
from hal.factory import create_hal
from core.navigation import NavigationEngine
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
        self.assertGreater(fix.speed_kmh, 0.0)

    def test_navigation_engine(self):
        nav = NavigationEngine()
        # Location 150m before first turn
        gps = GPSData(
            latitude=22.5710,
            longitude=88.3620,
            speed_kmh=40.0,
            heading_deg=90.0,
            altitude_m=10.0,
            timestamp=datetime.now(timezone.utc),
            is_fixed=True
        )
        maneuver = nav.update_location(gps)
        self.assertIn("Central Ave", maneuver.instruction)
        self.assertGreaterEqual(maneuver.eta_minutes, 0)
        self.assertGreater(maneuver.distance_to_turn_m, 0)

    def test_delivery_parser(self):
        zomato = DeliveryParser.parse_notification(
            raw_title="Zomato Partner",
            raw_body="Pickup Order #9812 from Burger King",
            package_name="com.application.zomato"
        )
        self.assertEqual(zomato.source, "zomato")
        self.assertEqual(zomato.pickup_or_drop, "PICKUP")
        self.assertEqual(zomato.order_id, "9812")

        swiggy = DeliveryParser.parse_notification(
            raw_title="Swiggy Delivery",
            raw_body="Deliver to Salt Lake Sector 3",
            package_name="in.swiggy.delivery"
        )
        self.assertEqual(swiggy.source, "swiggy")
        self.assertEqual(swiggy.pickup_or_drop, "DROP")

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
        self.assertTrue(any("High CPU Temp" in w for w in report["warnings"]))
        self.assertTrue(any("Low Input Voltage" in w for w in report["warnings"]))

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
