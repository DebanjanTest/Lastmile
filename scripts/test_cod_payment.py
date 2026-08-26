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

print("=== TESTING COD ORDER WITH PAYMENT QR & DAILY INCOME ===")
# 1. Accept Swiggy Order (COD: Rs.360.00)
accept_res = post_json('http://localhost:8000/api/feed/accept', {'order_id': 'ORD-SWG-94'})
print("1. Accepted Swiggy COD Order:", accept_res.get('status'))

# 2. Reach Store
post_json('http://localhost:8000/api/feed/reach-store')
print("2. Reached Store")

# 3. Pick up food
post_json('http://localhost:8000/api/feed/pickup')
print("3. Picked Up (To Customer)")

# 4. Complete Delivery
deliv_res = post_json('http://localhost:8000/api/feed/deliver')
result = deliv_res.get('result', {})
print("\n=== DELIVERY COMPLETION MODAL PAYLOAD ===")
print("Success:", result.get('success'))
print("Rider Payout Credited:", result.get('payout'))
print("Payout Breakdown:", result.get('payout_breakdown'))
print("Customer Payment Mode:", result.get('payment', {}).get('payment_mode'))
print("Is Payment Pending:", result.get('payment', {}).get('is_pending'))
print("Exact Amount To Collect:", result.get('payment', {}).get('amount_to_collect'))
print("UPI Payment Link:", result.get('payment', {}).get('upi_payment_link'))
print("Daily Income Status:", result.get('daily_income'))
