import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.engine import LastMileEngine
import json

engine = LastMileEngine({"simulation": {"force_simulation": True}})
snap = engine.get_latest_telemetry_snapshot()
print("=== TELEMETRY SNAPSHOT ===")
print("Order phase:", snap.get("order_phase"))
print("Active offers count:", len(snap.get("active_offers", [])))
print("Active offers:", json.dumps(snap.get("active_offers", []), indent=2))
print("GPS speed:", snap.get("gps", {}).get("speed_kmh"))
print("GPS coords:", snap.get("gps", {}).get("latitude"), snap.get("gps", {}).get("longitude"))
