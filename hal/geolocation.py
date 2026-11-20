"""
System Location Provider
Fast local-first geolocation with offline cache and config fallback.
"""

import json
import urllib.request
from pathlib import Path
from typing import Dict, Any

CACHE_FILE = Path("data/system_location_cache.json")

def get_system_location(default_lat: float = 22.572645, default_lng: float = 88.363892, default_city: str = "Kolkata") -> Dict[str, Any]:
    # ponytail: cache-first avoids 5s network blocking on Pi boot
    if CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text())
            if "lat" in cached and "lng" in cached:
                cached["source"] = "CACHED_SYSTEM_LOCATION"
                return cached
        except Exception:
            pass

    try:
        req = urllib.request.Request("http://ip-api.com/json/", headers={"User-Agent": "LastMileGuard/1.1"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            loc = {"lat": float(data["lat"]), "lng": float(data["lon"]), "city": data.get("city", default_city), "source": "NETWORK_GEOLOCATION"}
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(loc, indent=2))
            return loc
    except Exception:
        pass

    return {"lat": default_lat, "lng": default_lng, "city": default_city, "source": "DEFAULT_CONFIG"}
