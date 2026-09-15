"""
Systematic Order Infiltration, Mocking, and Lifecycle Verification Script
Exercises multi-platform order dispatch (Zomato, Swiggy, Zepto, Blinkit),
custom order payload infiltration, 2-phase routing, OTP handover, and settlement.
"""

import sys
import time
import requests

BASE_URL = "http://localhost:8000"

def log_step(title):
    print(f"\n{'='*70}\n[STEP] {title}\n{'='*70}")

def main():
    print("Initializing Systematic Order Infiltration & Pipeline Audit...")

    # 1. Telemetry Snapshot & Health
    log_step("1. Telemetry Snapshot Verification")
    r = requests.get(f"{BASE_URL}/api/telemetry")
    assert r.status_code == 200, f"Failed telemetry get: {r.status_code}"
    telemetry = r.json()
    print(f"System Online | Initial Phase: {telemetry.get('order_phase')} | Rider Coords: {telemetry.get('gps', {}).get('lat')}, {telemetry.get('gps', {}).get('lng')}")
    print(f"Active Offers Count: {len(telemetry.get('active_offers', []))}")

    # 2. Infiltrate a Blinkit Quick-Commerce Order
    log_step("2. Infiltrating Dynamic Platform Order (Blinkit)")
    r = requests.post(f"{BASE_URL}/api/feed/infiltrate")
    assert r.status_code == 200, f"Failed infiltrate: {r.status_code}"
    infiltrated = r.json().get("order")
    print(f"Successfully Infiltrated: [{infiltrated.get('platform').upper()}] {infiltrated.get('order_id')}")
    print(f"Store: {infiltrated.get('store_name')} ({infiltrated.get('store_dist_km')} km)")
    print(f"Customer: {infiltrated.get('customer_name')} -> {infiltrated.get('customer_address')}")
    print(f"Payout: Rs.{infiltrated.get('payout_inr')} | Payment: {infiltrated.get('payment_mode')} (Collect: Rs.{infiltrated.get('amount_to_collect')})")
    print(f"OTP: {infiltrated.get('delivery_otp')}")

    # 3. Infiltrate a Custom High-Value Mock Order
    log_step("3. Infiltrating Custom High-Value COD Order")
    custom_payload = {
        "order_id": "ORD-VIP-99",
        "platform": "zomato",
        "platform_color": "#E23744",
        "store_name": "Mocambo Heritage Dining",
        "store_address": "25B Park Street, Kolkata",
        "store_lat": 22.5510,
        "store_lng": 88.3530,
        "customer_name": "Subhojit Mukherjee",
        "customer_address": "South City Towers, Tower 3, Flat 1804",
        "customer_lat": 22.5020,
        "customer_lng": 88.3620,
        "payout_inr": 145.50,
        "items_summary": "1x Beckerty Chicken, 1x Chateaubriand Steak, 2x Devilled Crab",
        "customer_instructions": "VIP Guest delivery. Ring doorbell and present bill folder.",
        "payment_mode": "COD",
        "order_amount_inr": 2150.0,
        "cod_amount": 2150.0,
        "delivery_otp": "9921"
    }
    r = requests.post(f"{BASE_URL}/api/feed/infiltrate", json={"order_data": custom_payload})
    assert r.status_code == 200
    vip_order = r.json().get("order")
    print(f"Custom VIP Order Infiltrated: {vip_order.get('order_id')} (Rs.{vip_order.get('payout_inr')})")

    # 4. Accept Infiltrated Order
    target_id = vip_order.get("order_id")
    log_step(f"4. Accepting Infiltrated Order: {target_id}")
    r = requests.post(f"{BASE_URL}/api/feed/accept", json={"order_id": target_id})
    assert r.status_code == 200
    res = r.json()
    snap = res.get("snapshot")
    assert snap.get("order_phase") == "ROUTE_TO_STORE", f"Expected ROUTE_TO_STORE, got {snap.get('order_phase')}"
    print(f"Order Accepted! Phase: {snap.get('order_phase')}")
    print(f"Destination Set To: {snap.get('navigation', {}).get('destination_name')}")
    print(f"Route Distance Remaining: {snap.get('navigation', {}).get('distance_remaining_km')} km")

    # 5. Advance to Store (Phase: AT_STORE)
    log_step("5. Reaching Pickup Restaurant")
    r = requests.post(f"{BASE_URL}/api/feed/reach-store")
    assert r.status_code == 200
    snap = r.json().get("snapshot")
    assert snap.get("order_phase") == "AT_STORE"
    print(f"Arrived at Restaurant: {snap.get('selected_order', {}).get('store_name')} | Speed: {snap.get('gps', {}).get('speed_kmh')} km/h")

    # 6. Confirm Package Pickup (Phase: ROUTE_TO_CUSTOMER)
    log_step("6. Confirming Package Pickup & Dispatching to Customer")
    r = requests.post(f"{BASE_URL}/api/feed/pickup")
    assert r.status_code == 200
    snap = r.json().get("snapshot")
    assert snap.get("order_phase") == "ROUTE_TO_CUSTOMER"
    print(f"Order Picked Up! Phase: {snap.get('order_phase')}")
    print(f"Destination Updated To Customer: {snap.get('navigation', {}).get('destination_name')}")

    # 7. Advance to Customer Doorstep (Phase: AT_CUSTOMER)
    log_step("7. Reaching Customer Doorstep")
    r = requests.post(f"{BASE_URL}/api/feed/reach-customer")
    assert r.status_code == 200
    snap = r.json().get("snapshot")
    assert snap.get("order_phase") == "AT_CUSTOMER"
    print(f"Arrived at Doorstep: {snap.get('selected_order', {}).get('customer_name')} | Ready for OTP & Settlement")

    # 8. Complete Delivery & Settlement
    log_step("8. Completing Delivery Handover & COD Settlement")
    r = requests.post(f"{BASE_URL}/api/feed/deliver")
    assert r.status_code == 200
    deliv_res = r.json().get("result")
    assert deliv_res.get("success") is True, f"Delivery failed: {deliv_res}"
    print(f"Handover Success: {deliv_res.get('success')}")
    print(f"Payout Credited: Rs.{deliv_res.get('payout')}")
    print(f"Breakdown: {deliv_res.get('payout_breakdown')}")
    print(f"Customer Payment Mode: {deliv_res.get('payment', {}).get('payment_mode')}")
    print(f"Amount To Collect: Rs.{deliv_res.get('payment', {}).get('amount_to_collect')}")
    print(f"Generated UPI QR String: {deliv_res.get('payment', {}).get('upi_payment_link')}")
    print(f"Rider Daily Earnings: Rs.{deliv_res.get('daily_income', {}).get('earnings_today_inr')} ({deliv_res.get('daily_income', {}).get('orders_completed_count')} orders)")

    # 9. Verify Auto-Replenishment of Offers
    log_step("9. Verifying Autonomous Pool Replenishment")
    r = requests.get(f"{BASE_URL}/api/telemetry")
    snap = r.json()
    assert snap.get("order_phase") == "DELIVERED"
    assert len(snap.get("active_offers", [])) >= 4, "Active offers not replenished!"
    print(f"Post-Delivery Active Offers Staged: {len(snap.get('active_offers'))}")
    for o in snap.get("active_offers")[:4]:
        print(f" - [{o.get('platform').upper()}] {o.get('store_name')} (Rs.{o.get('payout_inr')}) -> {o.get('customer_name')}")

    print("\n" + "="*70)
    print("SUCCESS: Systematic Order Infiltration, Mocking, and Lifecycle Audit Passed 100%!")
    print("="*70)

if __name__ == "__main__":
    main()
