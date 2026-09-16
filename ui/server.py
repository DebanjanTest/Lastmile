"""
FastAPI UI Bridge & Telemetry Server
Serves Google Maps Navigation HUD, Multi-App Delivery Notification Feed & 2-Phase Routing System.
"""

import json
import asyncio
import base64
import time
import uuid
import urllib.parse
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from core.engine import LastMileEngine

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "lastmile.db"

def init_sqlite_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rider_profile (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                vehicle_no TEXT NOT NULL,
                daily_target_inr REAL NOT NULL,
                daily_target_orders INTEGER NOT NULL,
                photo_url TEXT,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS completed_orders (
                order_id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                store_name TEXT NOT NULL,
                customer_name TEXT NOT NULL,
                payout_inr REAL NOT NULL,
                payment_mode TEXT NOT NULL,
                order_amount_inr REAL NOT NULL,
                status TEXT NOT NULL,
                completed_at TEXT NOT NULL
            )
        """)
        cur = conn.cursor()
        cur.execute("SELECT id FROM rider_profile WHERE id = 'RIDER-KOL-01'")
        if not cur.fetchone():
            now = datetime.utcnow().isoformat()
            cur.execute("""
                INSERT INTO rider_profile (id, name, email, phone, vehicle_no, daily_target_inr, daily_target_orders, photo_url, updated_at)
                VALUES ('RIDER-KOL-01', 'Debanjan Mondal', 'debanjan.rider@lastmile.io', '+91 98765 43210', 'WB 02 AB 4591', 800.0, 8, '', ?)
            """, (now,))
        conn.commit()

active_payments: Dict[str, Dict[str, Any]] = {}

class DestinationImportRequest(BaseModel):
    name: str
    lat: float
    lng: float

class AcceptOrderRequest(BaseModel):
    order_id: str

class DismissOrderRequest(BaseModel):
    order_id: str

class InfiltrateOrderRequest(BaseModel):
    order_data: Optional[Dict[str, Any]] = None

class RazorpayQrRequest(BaseModel):
    order_id: str
    amount_inr: float
    notes: Optional[Dict[str, Any]] = None

class FirebaseVerifyRequest(BaseModel):
    id_token: str
    user_info: Optional[Dict[str, Any]] = None

class RiderProfileModel(BaseModel):
    id: Optional[str] = "RIDER-KOL-01"
    name: str
    email: str
    phone: str
    vehicle_no: str
    daily_target_inr: float = 800.0
    daily_target_orders: int = 8
    photo_url: Optional[str] = ""

def create_app(engine: LastMileEngine) -> FastAPI:
    app = FastAPI(title="LastMile Guard - Multi-App Delivery Feed HUD", version="2.2.0")

    base_dir = Path(__file__).parent
    static_dir = base_dir / "static"
    templates_dir = base_dir / "templates"

    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    templates = Jinja2Templates(directory=str(templates_dir))

    def get_fresh_config() -> dict:
        config_path = Path(__file__).parent.parent / "config.json"
        if config_path.exists():
            try:
                return json.loads(config_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return engine.config

    @app.middleware("http")
    async def add_auth_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
        return response

    @app.on_event("startup")
    async def startup_event():
        init_sqlite_db()
        await engine.start()

    @app.on_event("shutdown")
    async def shutdown_event():
        await engine.stop()

    @app.get("/", response_class=HTMLResponse)
    async def get_tripper_ui(request: Request):
        cfg = get_fresh_config()
        return templates.TemplateResponse(
            request=request,
            name="index.html",
            context={
                "app_name": cfg.get("app_name", "LastMile Guard"),
                "version": "2.2.0",
                "google_maps_api_key": cfg.get("maps", {}).get("google_maps_api_key", ""),
                "firebase_config": cfg.get("firebase", {}),
                "razorpay_config": cfg.get("razorpay", {})
            }
        )

    @app.websocket("/ws/telemetry")
    async def websocket_telemetry_endpoint(websocket: WebSocket):
        await websocket.accept()
        engine.connected_clients.add(websocket)
        try:
            snapshot = engine.get_latest_telemetry_snapshot()
            await websocket.send_text(json.dumps(snapshot))
            while True:
                data_text = await websocket.receive_text()
                try:
                    cmd_data = json.loads(data_text)
                    action = cmd_data.get("action")
                    
                    if action == "refresh_orders":
                        engine.refresh_orders()
                    elif action == "accept_order":
                        order_id = cmd_data.get("order_id", "")
                        engine.select_and_accept_order(order_id)
                    elif action == "reach_store":
                        engine.reach_store()
                    elif action == "pickup_order":
                        engine.pickup_order_and_route_to_customer()
                    elif action == "reach_customer":
                        engine.reach_customer()
                    elif action == "complete_delivery":
                        engine.complete_delivery()
                    elif action == "dismiss_offer":
                        order_id = cmd_data.get("order_id", "")
                        engine.dismiss_offer(order_id)
                    elif action == "trigger_sos":
                        engine.on_sos_triggered()
                    elif action == "trigger_tilt":
                        engine.on_tilt_triggered()
                    elif action == "reset_emergency":
                        engine.reset_emergency()
                    elif action == "import_destination":
                        name = cmd_data.get("name", "New Destination")
                        lat = float(cmd_data.get("lat", 22.5855))
                        lng = float(cmd_data.get("lng", 88.4168))
                        engine.import_destination(name, lat, lng)
                    
                    await engine.broadcast_snapshot()
                except Exception as e:
                    print(f"[WS COMMAND ERROR] {e}")
        except WebSocketDisconnect:
            engine.connected_clients.discard(websocket)

    @app.get("/api/telemetry")
    async def api_get_telemetry():
        return engine.get_latest_telemetry_snapshot()

    @app.post("/api/feed/refresh")
    async def api_refresh_orders():
        engine.refresh_orders()
        await engine.broadcast_snapshot()
        return {"status": "Refreshed", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/infiltrate")
    async def api_infiltrate_order(req: Optional[InfiltrateOrderRequest] = None):
        data = req.order_data if req else None
        order = engine.infiltrate_order(data)
        await engine.broadcast_snapshot()
        return {"status": "Infiltrated", "order": order.to_dict(), "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/accept")
    async def api_accept_order(req: AcceptOrderRequest):
        res = engine.select_and_accept_order(req.order_id)
        await engine.broadcast_snapshot()
        return {"status": "Accepted", "order": res.to_dict() if res else None, "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/reach-store")
    async def api_reach_store():
        res = engine.reach_store()
        await engine.broadcast_snapshot()
        return {"status": "Reached store", "order": res.to_dict() if res else None, "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/pickup")
    async def api_pickup_order():
        res = engine.pickup_order_and_route_to_customer()
        await engine.broadcast_snapshot()
        return {"status": "Picked up - routed to customer", "order": res.to_dict() if res else None, "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/reach-customer")
    async def api_reach_customer():
        res = engine.reach_customer()
        await engine.broadcast_snapshot()
        return {"status": "Reached customer", "order": res.to_dict() if res else None, "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/feed/deliver")
    async def api_complete_delivery():
        res = engine.complete_delivery()
        if res:
            try:
                order_dict = res.get("order", res) if isinstance(res, dict) else (res.to_dict() if hasattr(res, "to_dict") else {})
                order_id = order_dict.get("order_id", "")
                platform = order_dict.get("platform", "Delivery")
                store_name = order_dict.get("store_name", "")
                customer_name = order_dict.get("customer_name", "")
                payout_inr = order_dict.get("payout_inr", res.get("payout", 0.0) if isinstance(res, dict) else 0.0)
                payment_mode = order_dict.get("payment_mode", "COD")
                order_amount_inr = order_dict.get("order_amount_inr", order_dict.get("cod_amount", 0.0))

                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute("""
                        INSERT OR REPLACE INTO completed_orders (
                            order_id, platform, store_name, customer_name,
                            payout_inr, payment_mode, order_amount_inr, status, completed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?)
                    """, (
                        order_id, platform, store_name, customer_name,
                        payout_inr, payment_mode, order_amount_inr,
                        datetime.utcnow().isoformat()
                    ))
                    conn.commit()
            except Exception as e:
                print(f"[SQLITE RECORD ERROR] {e}")
        await engine.broadcast_snapshot()
        result_payload = res if isinstance(res, dict) else (res.to_dict() if res else None)
        return {"result": result_payload, "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.get("/api/auth/config")
    async def api_get_auth_config():
        cfg = get_fresh_config()
        fb_cfg = cfg.get("firebase", {})
        return {
            "apiKey": fb_cfg.get("apiKey", ""),
            "authDomain": fb_cfg.get("authDomain", ""),
            "projectId": fb_cfg.get("projectId", ""),
            "storageBucket": fb_cfg.get("storageBucket", ""),
            "messagingSenderId": fb_cfg.get("messagingSenderId", ""),
            "appId": fb_cfg.get("appId", ""),
            "measurementId": fb_cfg.get("measurementId", ""),
            "mock_account": fb_cfg.get("mock_account", {
                "uid": "google_test_rider_debanjan",
                "displayName": "Debanjan Mondal",
                "email": "debanjan.rider@lastmile.io",
                "photoURL": ""
            })
        }

    @app.post("/api/auth/firebase-verify")
    async def api_firebase_verify(req: FirebaseVerifyRequest):
        token = req.id_token
        claims = {
            "uid": "google_test_rider_debanjan",
            "email": "debanjan.rider@lastmile.io",
            "name": "Debanjan Mondal",
            "photo_url": "",
            "is_authenticated": True
        }
        if req.user_info:
            claims["uid"] = req.user_info.get("uid", claims["uid"])
            claims["email"] = req.user_info.get("email", claims["email"])
            claims["name"] = req.user_info.get("displayName", claims["name"])
            claims["photo_url"] = req.user_info.get("photoURL", "")
        elif token and "." in token:
            try:
                parts = token.split(".")
                if len(parts) >= 2:
                    payload_b64 = parts[1]
                    payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
                    decoded = json.loads(base64.urlsafe_b64decode(payload_b64.encode()))
                    claims["uid"] = decoded.get("user_id") or decoded.get("sub", claims["uid"])
                    claims["email"] = decoded.get("email", claims["email"])
                    claims["name"] = decoded.get("name", claims["name"])
                    claims["photo_url"] = decoded.get("picture", "")
            except Exception as e:
                print(f"[AUTH JWT DECODE WARN] {e}")

        try:
            with sqlite3.connect(DB_PATH) as conn:
                now = datetime.utcnow().isoformat()
                conn.execute("""
                    UPDATE rider_profile
                    SET name = ?, email = ?, photo_url = ?, updated_at = ?
                    WHERE id = 'RIDER-KOL-01'
                """, (claims["name"], claims["email"], claims["photo_url"], now))
                conn.commit()
        except Exception as e:
            print(f"[SQLITE PROFILE UPDATE ERROR] {e}")

        return {"status": "Verified", "claims": claims}

    @app.get("/api/rider/profile")
    async def api_get_rider_profile():
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT * FROM rider_profile WHERE id = 'RIDER-KOL-01'")
                row = cur.fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            print(f"[SQLITE GET PROFILE ERROR] {e}")
        return {
            "id": "RIDER-KOL-01",
            "name": "Debanjan Mondal",
            "email": "debanjan.rider@lastmile.io",
            "phone": "+91 98765 43210",
            "vehicle_no": "WB 02 AB 4591",
            "daily_target_inr": 800.0,
            "daily_target_orders": 8,
            "photo_url": "",
            "updated_at": datetime.utcnow().isoformat()
        }

    @app.post("/api/rider/profile")
    async def api_update_rider_profile(prof: RiderProfileModel):
        now = datetime.utcnow().isoformat()
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO rider_profile (
                        id, name, email, phone, vehicle_no, daily_target_inr, daily_target_orders, photo_url, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    prof.id or "RIDER-KOL-01", prof.name, prof.email, prof.phone,
                    prof.vehicle_no, prof.daily_target_inr, prof.daily_target_orders,
                    prof.photo_url or "", now
                ))
                conn.commit()
        except Exception as e:
            print(f"[SQLITE UPDATE PROFILE ERROR] {e}")
        return {"status": "Profile updated", "profile": prof.dict()}

    @app.post("/api/payment/razorpay-qr")
    async def api_generate_razorpay_qr(req: RazorpayQrRequest):
        rzp_cfg = engine.config.get("razorpay", {})
        key_id = rzp_cfg.get("key_id", "rzp_test_5WqgY9Q2Z1X3lK")
        merchant_vpa = rzp_cfg.get("merchant_vpa", "razorpay.lastmile@icici")
        merchant_name = rzp_cfg.get("merchant_name", "LastMile Guard Logistics")
        is_test = rzp_cfg.get("is_test_mode", True)
        amount = req.amount_inr
        order_id = req.order_id

        # UPI deep-link standard
        upi_uri = f"upi://pay?pa={merchant_vpa}&pn={urllib.parse.quote(merchant_name)}&am={amount:.2f}&cu=INR&tn=COD_{order_id}"
        encoded_uri = urllib.parse.quote_plus(upi_uri)
        image_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={encoded_uri}"
        qr_id = f"qr_rzp_test_{uuid.uuid4().hex[:8]}"

        active_payments[qr_id] = {
            "qr_id": qr_id,
            "order_id": order_id,
            "amount_inr": amount,
            "status": "active",
            "is_test_mode": is_test,
            "merchant_vpa": merchant_vpa,
            "created_at": time.time()
        }

        return {
            "qr_id": qr_id,
            "order_id": order_id,
            "amount_inr": amount,
            "image_url": image_url,
            "status": "active",
            "is_test_mode": is_test,
            "merchant_vpa": merchant_vpa,
            "key_id": key_id
        }

    @app.get("/api/payment/status/{qr_id}")
    async def api_payment_status(qr_id: str):
        payment = active_payments.get(qr_id)
        if not payment:
            return {"qr_id": qr_id, "status": "UNKNOWN"}
        timeout = engine.config.get("razorpay", {}).get("auto_verify_timeout_seconds", 6)
        elapsed = time.time() - payment["created_at"]
        if payment.get("is_test_mode") and elapsed >= timeout:
            payment["status"] = "PAID"
            payment["payment_id"] = f"pay_rzp_auto_{uuid.uuid4().hex[:10]}"
        return payment

    @app.post("/api/payment/verify-instant")
    async def api_verify_instant(req: Dict[str, Any]):
        qr_id = req.get("qr_id", "")
        payment = active_payments.get(qr_id)
        payment_id = f"pay_rzp_instant_{uuid.uuid4().hex[:10]}"
        if payment:
            payment["status"] = "PAID"
            payment["payment_id"] = payment_id
        return {
            "status": "SUCCESS",
            "payment_id": payment_id,
            "order_id": req.get("order_id", ""),
            "amount_paid": req.get("amount_inr", 0.0)
        }

    @app.post("/api/feed/dismiss")
    async def api_dismiss_offer(req: DismissOrderRequest):
        engine.dismiss_offer(req.order_id)
        await engine.broadcast_snapshot()
        return {"status": "Dismissed", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/navigation/destination")
    async def api_import_destination(req: DestinationImportRequest):
        engine.import_destination(req.name, req.lat, req.lng)
        await engine.broadcast_snapshot()
        return {"status": "Destination updated", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.get("/api/camera/stream")
    async def get_camera_stream():
        def _frame_generator():
            while True:
                frame_bytes = engine.dashcam.get_live_frame_jpeg()
                if frame_bytes:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                import time
                time.sleep(0.1)
        return StreamingResponse(_frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.post("/api/test/sos")
    async def api_trigger_sos():
        engine.on_sos_triggered()
        await engine.broadcast_snapshot()
        return {"status": "SOS triggered", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/test/tilt")
    async def api_trigger_tilt():
        engine.on_tilt_triggered()
        await engine.broadcast_snapshot()
        return {"status": "Tilt crash triggered", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/test/reset-emergency")
    async def api_reset_emergency():
        engine.reset_emergency()
        await engine.broadcast_snapshot()
        return {"status": "Emergency reset", "snapshot": engine.get_latest_telemetry_snapshot()}

    @app.post("/api/mock/inject-offer")
    async def api_inject_mock_offer(seed: Optional[int] = None):
        from core.mock_engine import MockDataEngine
        offer_dict = MockDataEngine.generate_synthetic_offer(seed)
        return {"status": "Injected", "offer": offer_dict}

    @app.post("/api/mock/inject-event")
    async def api_inject_mock_event(title: str = "Customer Update", description: str = "Please ring doorbell twice"):
        import time
        payload = {
            "title": title,
            "description": description,
            "timestamp": time.time()
        }
        return {"status": "Event Injected", "event": payload}

    return app
