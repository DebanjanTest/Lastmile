"""
FastAPI UI Bridge & Telemetry Server
Serves Google Maps Navigation HUD, multi-stop Order Lifecycle, and Traffic Streams.
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

def create_app(engine: LastMileEngine) -> FastAPI:
    app = FastAPI(title="LastMile Guard Google Maps Navigation HUD", version="1.2.0")

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
                "version": engine.config.get("version", "1.2.0"),
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
                    if action == "trigger_sos":
                        engine.on_sos_triggered()
                    elif action == "trigger_tilt":
                        engine.on_tilt_triggered()
                    elif action == "reset_emergency":
                        engine.reset_emergency()
                    elif action == "offer_order":
                        platform = cmd_data.get("platform", "swiggy")
                        engine.offer_mock_order(platform)
                    elif action == "accept_order":
                        engine.accept_current_order()
                    elif action == "confirm_pickup":
                        engine.confirm_food_pickup()
                    elif action == "complete_delivery":
                        engine.complete_current_delivery()
                    elif action == "decline_order":
                        engine.orders.decline_order()
                    elif action == "mock_order":
                        source = cmd_data.get("source", "swiggy")
                        engine.offer_mock_order(source)
                    elif action == "clear_alert":
                        engine.clear_active_alert()
                    elif action == "set_brightness":
                        level = int(cmd_data.get("level", 85))
                        engine.hal.sensors.set_brightness(level)
                    elif action == "import_destination":
                        name = cmd_data.get("name", "New Destination")
                        lat = float(cmd_data.get("lat", 22.5855))
                        lng = float(cmd_data.get("lng", 88.4168))
                        engine.import_destination(name, lat, lng)
                    
                    # Immediately broadcast updated telemetry to all clients
                    updated_snapshot = engine.get_latest_telemetry_snapshot()
                    await websocket.send_text(json.dumps(updated_snapshot))
                except Exception as e:
                    print(f"[WS COMMAND ERROR] {e}")
        except WebSocketDisconnect:
            engine.connected_clients.discard(websocket)

    @app.post("/api/orders/offer")
    async def api_offer_order(platform: str = "swiggy"):
        order = engine.offer_mock_order(platform)
        return {"status": "Order offered", "order": order.to_dict()}

    @app.post("/api/orders/accept")
    async def api_accept_order():
        order = engine.accept_current_order()
        return {"status": "Order accepted", "order": order.to_dict() if order else None}

    @app.post("/api/orders/pickup")
    async def api_confirm_pickup():
        order = engine.confirm_food_pickup()
        return {"status": "Food picked up", "order": order.to_dict() if order else None}

    @app.post("/api/orders/deliver")
    async def api_complete_delivery():
        order = engine.complete_current_delivery()
        return {"status": "Delivered", "earnings": engine.orders.earnings_today_inr}

    @app.post("/api/navigation/destination")
    async def api_import_destination(req: DestinationImportRequest):
        engine.import_destination(req.name, req.lat, req.lng)
        return {"status": "Destination updated", "name": req.name, "coords": [req.lat, req.lng]}

    @app.get("/api/camera/frame.jpg")
    async def get_camera_frame():
        frame_bytes = engine.dashcam.get_live_frame_jpeg()
        if frame_bytes:
            return Response(content=frame_bytes, media_type="image/jpeg")
        return Response(status_code=404, content=b"No camera frame")

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
        return {"status": "SOS triggered"}

    @app.post("/api/test/tilt")
    async def api_trigger_tilt():
        engine.on_tilt_triggered()
        return {"status": "Tilt crash triggered"}

    return app
