"""
System Location Provider (Cross-Platform for Windows & Linux / Raspberry Pi 5)
Detects current physical location via Network/IP Geolocation and caches coordinates for offline use.
"""

import json
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional

CACHE_FILE = Path("data/system_location_cache.json")

def get_system_location(default_lat: float = 22.572645, default_lng: float = 88.363892, default_city: str = "Kolkata") -> Dict[str, Any]:
    """
    Detects the current physical location of the machine.
    1. Attempts online IP/Network Geolocation.
    2. Falls back to cached location from previous online run.
    3. Falls back to default configured coordinates.
    """
    # 1. Try Network Geolocation APIs
    geo_endpoints = [
        ("http://ip-api.com/json/", lambda d: {"lat": float(d["lat"]), "lng": float(d["lon"]), "city": d.get("city", default_city), "region": d.get("regionName", "")}),
        ("https://ipapi.co/json/", lambda d: {"lat": float(d["latitude"]), "lng": float(d["longitude"]), "city": d.get("city", default_city), "region": d.get("region", "")})
    ]

    for url, parser in geo_endpoints:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LastMileGuard/1.1"})
            with urllib.request.urlopen(req, timeout=2.5) as response:
                if response.status == 200:
                    raw_data = json.loads(response.read().decode('utf-8'))
                    parsed = parser(raw_data)
                    parsed["source"] = "SYSTEM_NETWORK_GEOLOCATION"
                    
                    # Cache successful lookup
                    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
                    CACHE_FILE.write_text(json.dumps(parsed, indent=2))
                    print(f"[GEOLOCATION] System location detected: {parsed.get('city')} ({parsed['lat']}, {parsed['lng']})")
                    return parsed
        except Exception:
            continue

    # 2. Fallback to cache if available
    if CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text())
            cached["source"] = "CACHED_SYSTEM_LOCATION"
            print(f"[GEOLOCATION] Using cached location: {cached.get('city')} ({cached['lat']}, {cached['lng']})")
            return cached
        except Exception:
            pass

    # 3. Default fallback
    print(f"[GEOLOCATION] Using default location: {default_city} ({default_lat}, {default_lng})")
    return {
        "lat": default_lat,
        "lng": default_lng,
        "city": default_city,
        "region": "",
        "source": "DEFAULT_CONFIG"
    }
