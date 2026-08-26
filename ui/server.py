"""
FastAPI UI Bridge & Telemetry Server
Serves Google Maps Navigation HUD, Multi-App Delivery Notification Feed & 2-Phase Routing System.
"""

import json
import asyncio
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from core.engine import LastMileEngine

class DestinationImportRequest(BaseModel):
    name: str
    lat: float
    lng: float

class AcceptOrderRequest(BaseModel):
    order_id: str

class DismissOrderRequest(BaseModel):
    order_id: str

def create_app(engine: LastMileEngine) -> FastAPI:
    app = FastAPI(title="LastMile Guard - Multi-App Delivery Feed HUD", version="2.1.0")

    base_dir = Path(__file__).parent
    static_dir = base_dir / "static"
    templates_dir = base_dir / "templates"

    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    templates = Jinja2Templates(directory=str(templates_dir))

    @app.on_event("startup")
    async def startup_event():
        await engine.start()

    @app.on_event("shutdown")
    async def shutdown_event():
        await engine.stop()

    @app.get("/", response_class=HTMLResponse)
    async def get_tripper_ui(request: Request):
        return templates.TemplateResponse(
            request=request,
            name="index.html",
            context={
                "app_name": engine.config.get("app_name", "LastMile Guard"),
                "version": "2.1.0",
                "google_maps_api_key": engine.config.get("maps", {}).get("google_maps_api_key", "")
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
        await engine.broadcast_snapshot()
        return {"result": res, "snapshot": engine.get_latest_telemetry_snapshot()}

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

    return app
