import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import time
from hal.drivers_mock import MockGPS
from core.engine import LastMileEngine

gps = MockGPS()
gps.start()
print("=== TESTING MOCK GPS MOTION LOCK ===")
for i in range(5):
    time.sleep(0.2)
    fix = gps.get_latest_fix()
    print(f"MockGPS Tick {i}: Lat={fix.latitude:.6f}, Lng={fix.longitude:.6f}, Speed={fix.speed_kmh} km/h")
gps.stop()

print("\n=== TESTING LASTMILE ENGINE MOTION LOCK ===")
engine = LastMileEngine({"simulation": {"force_simulation": True}})
for i in range(5):
    time.sleep(0.2)
    snap = engine.get_latest_telemetry_snapshot()
    g = snap["gps"]
    print(f"Engine Tick {i}: Phase={snap['order_phase']}, Lat={g['latitude']:.6f}, Lng={g['longitude']:.6f}, Speed={g['speed_kmh']} km/h")
