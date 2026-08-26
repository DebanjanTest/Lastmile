import urllib.request
import json

try:
    res = urllib.request.urlopen('http://localhost:8000/')
    print('HTML Response Code:', res.status)

    tel_res = urllib.request.urlopen('http://localhost:8000/api/telemetry')
    data = json.loads(tel_res.read().decode())
    print('Telemetry Order Phase:', data.get('order_phase'))
    print('Active Offers Count:', len(data.get('active_offers', [])))
    for o in data.get('active_offers', []):
        print(f" - [{o['platform'].upper()}] {o['store_name']} (Rs.{o['payout_inr']}) -> {o['customer_name']}")
    print('Rider Speed:', data.get('gps', {}).get('speed_kmh'))
    print('Rider Coords:', data.get('gps', {}).get('latitude'), data.get('gps', {}).get('longitude'))
except Exception as e:
    print('Verification Error:', e)
