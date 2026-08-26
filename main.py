"""
LastMile Guard - Main Application Entrypoint
Run with Python on Windows or Raspberry Pi 5.
"""

import json
import uvicorn
from pathlib import Path
from core.engine import LastMileEngine
from ui.server import create_app

def load_config() -> dict:
    config_file = Path(__file__).parent / "config.json"
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except Exception as e:
            print(f"[CONFIG WARNING] Could not parse config.json: {e}")
    return {}

def main():
    print("=====================================================")
    print("   LASTMILE GUARD - AUTOMOTIVE NAVIGATION & HUD      ")
    print("   Ponytail Lean Architecture | Pi 5 & Windows Ready  ")
    print("=====================================================")

    config = load_config()
    engine = LastMileEngine(config)
    app = create_app(engine)

    host = config.get("server", {}).get("host", "0.0.0.0")
    port = config.get("server", {}).get("port", 8000)

    print(f"\n[SERVER] Launching LastMile Guard HUD at http://{host}:{port}")
    print(f"[SERVER] Access locally from browser or HDMI screen at http://localhost:{port}\n")

    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    main()
