"""
FastAPI UI Bridge & Telemetry Server
Serves the 5-inch Tripper Webview interface and streams real-time WebSocket telemetry.
"""

import json
import asyncio
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.engine import LastMileEngine

def create_app(engine: LastMileEngine) -> FastAPI:
    app = FastAPI(title="LastMile Guard Tripper UI", version="1.0.0")

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
        return templates.TemplateResponse("index.html", {
            "request": request,
            "app_name": engine.config.get("app_name", "LastMile Guard"),
            "version": engine.config.get("version", "1.0.0")
        })

    @app.websocket("/ws/telemetry")
    async def websocket_telemetry_endpoint(websocket: WebSocket):
        await websocket.accept()
        engine.connected_clients.add(websocket)
        try:
            # Send initial snapshot immediately
            snapshot = engine.get_latest_telemetry_snapshot()
            await websocket.send_text(json.dumps(snapshot))
            while True:
                # Keep alive and receive client commands (e.g., hotkeys)
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
                    elif action == "mock_order":
                        source = cmd_data.get("source", "swiggy")
                        if source == "zomato":
                            engine.post_delivery_alert(
                                title="Zomato Rider Alert",
                                body="Pickup Order #892 from Mainland China (Salt Lake)",
                                package_name="com.application.zomato"
                            )
                        elif source == "call":
                            engine.post_delivery_alert(
                                title="Customer Incoming Call",
                                body="Call from +91 98301 XXXXX (Sector V Drop)",
                                package_name="com.android.dialer"
                            )
                        else:
                            engine.post_delivery_alert(
                                title="Swiggy Delivery Partner",
                                body="Pickup Order #4092 from Wow! Momo (Central Ave)",
                                package_name="in.swiggy.delivery"
                            )
                    elif action == "clear_alert":
                        engine.clear_active_alert()
                    elif action == "set_brightness":
                        level = int(cmd_data.get("level", 85))
                        engine.hal.sensors.set_brightness(level)
                except Exception as e:
                    print(f"[WS COMMAND ERROR] {e}")
        except WebSocketDisconnect:
            engine.connected_clients.discard(websocket)

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

    @app.post("/api/test/order")
    async def api_trigger_mock_order(platform: str = "swiggy"):
        if platform == "zomato":
            engine.post_delivery_alert("Zomato Rider Alert", "Pickup Order #892 from Mainland China", "com.application.zomato")
        else:
            engine.post_delivery_alert("Swiggy Delivery Partner", "Pickup Order #4092 from Wow! Momo", "in.swiggy.delivery")
        return {"status": f"Mock {platform} order posted"}

    return app
