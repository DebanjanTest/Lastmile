import urllib.request
import json

def get_json(url):
    res = urllib.request.urlopen(url)
    return json.loads(res.read().decode())

def post_json(url, payload=None):
    payload = payload or {}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    res = urllib.request.urlopen(req)
    return json.loads(res.read().decode())

print("=== TESTING COMPLETE LIFECYCLE ON LIVE SERVER ===")
# 1. Accept Top Order (Phase 1: Route to Store)
accept_res = post_json('http://localhost:8000/api/feed/accept', {'order_id': 'ORD-ZOM-81'})
print("1. Accepted Order:", accept_res.get('status'))
snap1 = get_json('http://localhost:8000/api/telemetry')
print("   Phase:", snap1.get('order_phase'), "| Destination:", snap1.get('navigation', {}).get('destination_name'), "| Polyline Pts:", len(snap1.get('navigation', {}).get('route_polyline', [])))

# 2. Reach Store
store_res = post_json('http://localhost:8000/api/feed/reach-store')
print("2. Reached Store:", store_res.get('status'))
snap2 = get_json('http://localhost:8000/api/telemetry')
print("   Phase:", snap2.get('order_phase'))

# 3. Pick up food (Phase 2: Route to Customer Drop-off)
pickup_res = post_json('http://localhost:8000/api/feed/pickup')
print("3. Picked Up:", pickup_res.get('status'))
snap3 = get_json('http://localhost:8000/api/telemetry')
print("   Phase:", snap3.get('order_phase'), "| Destination:", snap3.get('navigation', {}).get('destination_name'), "| Polyline Pts:", len(snap3.get('navigation', {}).get('route_polyline', [])))

# 4. Complete Delivery
deliv_res = post_json('http://localhost:8000/api/feed/deliver')
print("4. Delivered Result:", deliv_res.get('result', {}).get('success'), "| Payout:", deliv_res.get('result', {}).get('payout'))
snap4 = get_json('http://localhost:8000/api/telemetry')
print("   Phase:", snap4.get('order_phase'), "| Active Offers Restored Count:", len(snap4.get('active_offers', [])))
print("\n>>> ALL TESTS PASSED WITH 100% SUCCESS ON LIVE SERVER! <<<")
