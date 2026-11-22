# UI Subsystem

## Overview
FastAPI web server and interactive 800x480 WVGA frontend for LastMile Guard. Exposes REST endpoints and high-speed WebSocket telemetry streams to render the real-time driver navigation interface, order management cards, Razorpay payment flows, and hardware health metrics.

## Interface
- `[server.py:DB_PATH]`
- `[server.py:init_sqlite_db]`
- `[server.py:active_payments]`
- `[server.py:create_app]`
- `[server.py:DestinationImportRequest]`
- `[server.py:AcceptOrderRequest]`
- `[server.py:DismissOrderRequest]`
- `[server.py:InfiltrateOrderRequest]`
- `[server.py:RazorpayQrRequest]`
- `[server.py:FirebaseVerifyRequest]`
- `[server.py:RiderProfileModel]`
- Subdirectories:
  - [static](./static/README.md)
  - [templates](./templates/README.md)

## Invariants
- `[server.py:RiderProfileModel]` Default daily target INR initialized to 800.0 with 8 completed orders for rider ID `RIDER-KOL-01`.
- `[server.py]` Startup event initializes the SQLite database schema and starts the core engine before accepting connections.

## Side Effects
- `[server.py]` Creates parent database directories and initializes SQLite tables `rider_profile` and `completed_orders`.
- `[server.py]` Maintains active WebSocket connections and broadcasts telemetry states to connected browser clients.
- `[server.py]` Mutates payment state and order history records in SQLite upon delivery completion or online verification.

## Verification
- Run: `python3 -m unittest discover tests/`
