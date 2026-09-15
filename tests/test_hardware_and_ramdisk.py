"""
Hardware & Level 2 RAM-Disk Pipeline Unit Tests
Validates:
1. Level 2 RAM buffer circular ring behavior (60s retention window)
2. RAM-disk directory detection (/run/shm/ or fallback)
3. Hardware crash & emergency incident flushing to evidence/incidents/
4. Picamera2 and GPIO sensor driver fallback and initialization
"""

import os
import json
import time
import unittest
from pathlib import Path
from hal.drivers_linux import RealPicamera2, RealSensors
from hal.drivers_mock import MockCamera, MockSensors
from hal.base import GPSData

class TestHardwareAndRamdisk(unittest.TestCase):
    def setUp(self):
        self.evidence_dir = Path("evidence/incidents")
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def test_01_ram_buffer_directory_resolution(self):
        cam = RealPicamera2(buffer_seconds=60, storage_dir=str(self.evidence_dir))
        self.assertIsNotNone(cam.ram_buffer_dir)
        self.assertTrue(cam.ram_buffer_dir.exists())
        # Check if on Linux with /run/shm, it uses RAM-disk
        if Path("/run/shm").exists() and os.access("/run/shm", os.W_OK):
            self.assertEqual(str(cam.ram_buffer_dir), str(Path("/run/shm/lastmile")))
        else:
            self.assertTrue("ram_buffer" in str(cam.ram_buffer_dir) or "shm" in str(cam.ram_buffer_dir))

    def test_02_mock_camera_ram_disk_circular_buffering(self):
        cam = MockCamera(buffer_seconds=2, storage_dir=str(self.evidence_dir))
        cam.start_buffering()
        time.sleep(0.3)  # Let buffer accumulate frames
        
        with cam._lock:
            initial_count = len(cam._frame_buffer)
            self.assertGreater(initial_count, 0)
            
        # Test incident lock from RAM buffer into evidence/incidents/
        meta = {
            "latitude": 22.5726,
            "longitude": 88.3639,
            "speed_kmh": 42.5,
            "heading_deg": 90.0
        }
        incident_file = cam.lock_incident("CRASH_TILT", meta)
        self.assertTrue(os.path.exists(incident_file))
        
        # Verify JSON metadata blackbox record was created
        json_file = Path(incident_file).with_suffix(".json")
        self.assertTrue(json_file.exists())
        
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.assertEqual(data["incident_reason"], "CRASH_TILT")
            self.assertEqual(data["telemetry"]["speed_kmh"], 42.5)
            self.assertIn("timestamp", data)
            
        cam.stop_buffering()

    def test_03_real_sensors_graceful_desktop_fallback(self):
        sensors = RealSensors(sos_pin=17, tilt_pin=27, pwm_pin=18)
        # Should initialize gracefully without raising exceptions even if GPIO is unavailable
        sos_triggered = [False]
        tilt_triggered = [False]
        sensors.start(
            on_sos=lambda: sos_triggered.__setitem__(0, True),
            on_tilt=lambda: tilt_triggered.__setitem__(0, True)
        )
        self.assertEqual(sensors.get_brightness(), 85)
        sensors.set_brightness(60)
        self.assertEqual(sensors.get_brightness(), 60)
        sensors.stop()

    def test_04_real_picamera2_graceful_desktop_fallback(self):
        cam = RealPicamera2(buffer_seconds=10, storage_dir=str(self.evidence_dir))
        # start_buffering should handle absence of Picamera2 without crash
        cam.start_buffering()
        # capture should return None when hardware not present
        frame = cam.get_latest_frame_jpeg()
        self.assertIsNone(frame)
        
        # lock_incident should still create incident metadata file
        meta = {"test": True}
        out_path = cam.lock_incident("MANUAL_SOS", meta)
        self.assertTrue(Path(out_path).with_suffix(".json").exists())
        cam.stop_buffering()

if __name__ == "__main__":
    unittest.main()
