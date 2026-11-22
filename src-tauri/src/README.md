# Tauri Rust Core Engine

## Overview
Core Rust subsystem powering the desktop/embedded Tauri application. Manages high-frequency vehicle telemetry (5 Hz), two-phase delivery routing with project-osrm.org, SQLite persistence for rider earnings and order history, Firebase JWT authentication, Razorpay dynamic UPI QR generation with payment listeners, and collision/SOS emergency triggers.

## Interface
- `[main.rs:AppState]`
- `[main.rs:TelemetrySnapshot]`
- `[main.rs:accept_order]`
- `[main.rs:reach_store]`
- `[main.rs:pickup_order]`
- `[main.rs:reach_customer]`
- `[main.rs:complete_delivery]`
- `[main.rs:dismiss_offer]`
- `[main.rs:refresh_offers]`
- `[main.rs:generate_razorpay_qr]`
- `[main.rs:validate_session]`
- `[main.rs:get_profile]`
- `[main.rs:update_profile]`
- `[main.rs:trigger_sos]`
- `[main.rs:trigger_tilt]`
- `[main.rs:reset_emergency]`
- `[main.rs:inject_mock_offer]`
- `[main.rs:infiltrate_order]`
- `[main.rs:inject_mock_event]`
- `[main.rs:get_system_health]`
- `[router.rs:RouterEngine]`
- `[router.rs:RouterEngine::get_route]`
- `[router.rs:RouterEngine::calculate_deviation_m]`
- `[db.rs:init_db]`
- `[db.rs:get_rider_profile]`
- `[db.rs:update_rider_profile]`
- `[db.rs:record_completed_order]`
- `[db.rs:get_daily_summary]`
- `[razorpay.rs:request_razorpay_qr]`
- `[razorpay.rs:spawn_payment_listener]`
- `[auth.rs:validate_firebase_jwt]`
- `[order.rs:OrderManager]`
- `[mock_engine.rs:MockEngine]`
- Subdirectories:
  - [Hardware Abstraction Layer](./hal/README.md)

## Invariants
- `[main.rs:complete_delivery]` Delivery completion enforces OTP verification; returns error if entered OTP does not match `delivery_otp`.
- `[router.rs:calculate_deviation_m]` Returns 0.0 deviation when polyline length < 2.
- `[router.rs:get_route]` Generates 9 geodesic straight-line fallback points if OSRM returns fewer than 2 points.
- `[db.rs:init_db]` Guarantees at least 1 rider profile exists, seeding default profile `RIDER-KOL-01` if empty.
- `[db.rs:get_daily_summary]` Daily earnings target progress percentage is clamped to maximum 100%.
- `[auth.rs:validate_firebase_jwt]` Rejects empty authorization tokens immediately.
- `[order.rs:dismiss_offer]` Maintains a minimum threshold of 4 active offers by triggering seed backfill.

## Side Effects
- `[main.rs:main]` Initializes SQLite database, spawns 5 Hz Tokio telemetry worker thread, and starts autonomous mock engine loop.
- `[main.rs:trigger_sos] / [main.rs:trigger_tilt]` Flushes incident RAM video frame buffer to disk in `evidence/incidents`.
- `[router.rs:get_route]` Initiates network HTTPS/HTTP requests to project-osrm.org with mutex-cached responses.
- `[razorpay.rs:request_razorpay_qr]` Sends HTTP POST requests to `api.razorpay.com/v1/payments/qr_codes` and spawns Tokio polling listener.
- `[db.rs]` Performs disk I/O to SQLite database tables `rider_profile` and `order_ledger`.

## Verification
- Run: `python3 -m unittest discover tests/`
