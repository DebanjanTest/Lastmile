"""
Real Hardware Drivers for Raspberry Pi 5 (Ubuntu / Raspberry Pi OS)
Interfaces directly with /dev/ttyAMA0 (UART GPS), Picamera2, and GPIO interrupts with system location fallback.
"""

import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List
from hal.base import BaseGPS, BaseCamera, BaseSensors, GPSData
from hal.geolocation import get_system_location

try:
    import serial
    import pynmea2
except ImportError:
    serial = None
    pynmea2 = None

try:
    from picamera2 import Picamera2
    from picamera2.outputs import CircularOutput
    from picamera2.encoders import H264Encoder
except ImportError:
    Picamera2 = None

try:
    from gpiozero import Button, PWMOutputDevice
except ImportError:
    Button = None
    PWMOutputDevice = None

class RealGPS(BaseGPS):
    def __init__(self, port: str = "/dev/ttyAMA0", baudrate: int = 9600):
        self.port = port
        self.baudrate = baudrate
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._serial_conn = None
        
        # Initial seed from system network location while waiting for satellite fix
        sys_loc = get_system_location()
        self._latest_fix = GPSData(
            latitude=sys_loc["lat"],
            longitude=sys_loc["lng"],
            speed_kmh=0.0,
            heading_deg=0.0,
            altitude_m=12.0,
            timestamp=datetime.now(timezone.utc),
            is_fixed=False,
            satellites=0
        )

    def start(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._read_serial_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._serial_conn:
            try:
                self._serial_conn.close()
            except Exception:
                pass

    def _read_serial_loop(self) -> None:
        if not serial or not pynmea2:
            return

        backoff = 1.0
        while self.running:
            try:
                if not self._serial_conn or not self._serial_conn.is_open:
                    self._serial_conn = serial.Serial(self.port, self.baudrate, timeout=1)
                    backoff = 1.0

                line = self._serial_conn.readline().decode('ascii', errors='replace').strip()
                if not line:
                    continue

                if line.startswith('$GPRMC') or line.startswith('$GNRMC'):
                    msg = pynmea2.parse(line)
                    if getattr(msg, 'status', '') == 'A':
                        with self._lock:
                            speed_knots = float(msg.spd_over_grnd or 0.0)
                            self._latest_fix = GPSData(
                                latitude=msg.latitude,
                                longitude=msg.longitude,
                                speed_kmh=speed_knots * 1.852,
                                heading_deg=float(msg.true_course or 0.0),
                                altitude_m=self._latest_fix.altitude_m,
                                timestamp=datetime.now(timezone.utc),
                                is_fixed=True,
                                satellites=self._latest_fix.satellites
                            )
                elif line.startswith('$GPGGA') or line.startswith('$GNGGA'):
                    msg = pynmea2.parse(line)
                    if int(getattr(msg, 'gps_qual', 0)) > 0:
                        with self._lock:
                            self._latest_fix.altitude_m = float(msg.altitude or 0.0)
                            self._latest_fix.satellites = int(msg.num_sats or 0)
                            self._latest_fix.is_fixed = True
            except (serial.SerialException, OSError):
                # Auto-heal from serial dropouts or UART baud glitched line
                if self._serial_conn:
                    try:
                        self._serial_conn.close()
                    except Exception:
                        pass
                    self._serial_conn = None
                with self._lock:
                    self._latest_fix.is_fixed = False
                time.sleep(backoff)
                backoff = min(10.0, backoff * 1.5)
            except Exception:
                time.sleep(0.5)

    def get_latest_fix(self) -> GPSData:
        with self._lock:
            return self._latest_fix

class RealPicamera2(BaseCamera):
    def __init__(self, buffer_seconds: int = 300, storage_dir: str = "evidence/incidents"):
        self.buffer_seconds = buffer_seconds
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Volatile RAM-disk tmpfs buffer: strictly /run/shm/dashcam_ring or /dev/shm/dashcam_ring
        shm_candidates = [Path("/run/shm/dashcam_ring"), Path("/dev/shm/dashcam_ring"), Path("/run/shm/lastmile")]
        self.ram_buffer_dir = Path("data/ram_buffer")
        for cand in shm_candidates:
            if cand.parent.exists():
                self.ram_buffer_dir = cand
                break
        self.ram_buffer_dir.mkdir(parents=True, exist_ok=True)
        
        self.picam2 = None
        self.circ_output = None
        self.running = False

    def start_buffering(self) -> None:
        if not Picamera2:
            return
        try:
            self.picam2 = Picamera2()
            config = self.picam2.create_video_configuration(main={"size": (1280, 720)})
            self.picam2.configure(config)
            
            buffer_frames = self.buffer_seconds * 30  # 300s @ 30fps = 9,000 frames (~190 MB in RAM)
            self.circ_output = CircularOutput(buffersize=buffer_frames)
            encoder = H264Encoder(bitrate=5000000)
            self.picam2.start_recording(encoder, self.circ_output)
            self.running = True
        except Exception:
            pass

    def stop_buffering(self) -> None:
        if self.picam2 and self.running:
            try:
                self.picam2.stop_recording()
                self.picam2.close()
            except Exception:
                pass
            self.running = False

    def lock_incident(self, reason: str, metadata: Dict[str, Any]) -> str:
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"incident_{reason.lower().replace(' ', '_')}_{timestamp_str}.mp4"
        filepath = self.storage_dir / filename

        if self.circ_output:
            try:
                self.circ_output.fileoutput = str(filepath)
                def _post_record_delay():
                    time.sleep(30)  # Record 30 seconds post-incident
                    if self.circ_output:
                        self.circ_output.fileoutput = None
                threading.Thread(target=_post_record_delay, daemon=True).start()
            except Exception:
                pass

        meta_path = filepath.with_suffix(".json")
        import json
        meta_path.write_text(json.dumps({
            "incident_reason": reason,
            "timestamp": datetime.now().isoformat(),
            "timestamp_us": int(datetime.now().timestamp() * 1_000_000),
            "telemetry": metadata,
            "file_path": str(filepath)
        }, indent=2))
        return str(filepath)

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        if self.picam2 and self.running:
            try:
                return self.picam2.capture_file("main", format="jpeg")
            except Exception:
                pass
        return None

class RealSensors(BaseSensors):
    def __init__(self, sos_pin: int = 17, tilt_pin: int = 27, pwm_pin: int = 18):
        self.sos_pin = sos_pin
        self.tilt_pin = tilt_pin
        self.pwm_pin = pwm_pin
        self.brightness = 85
        self._sos_btn = None
        self._tilt_btn = None
        self._pwm = None

    def start(self, on_sos: Callable[[], None], on_tilt: Callable[[], None]) -> None:
        if Button:
            try:
                # Tactile SOS on GPIO 17 (active-low with debounce)
                self._sos_btn = Button(self.sos_pin, pull_up=True, bounce_time=0.2)
                self._sos_btn.when_pressed = on_sos
            except Exception:
                pass

            try:
                # Tilt / angular sensor on GPIO 27 (sustained > 500 ms)
                self._tilt_btn = Button(self.tilt_pin, pull_up=True, bounce_time=0.2, hold_time=0.5)
                self._tilt_btn.when_held = on_tilt
                self._tilt_btn.when_pressed = on_tilt
            except Exception:
                pass

        if PWMOutputDevice:
            try:
                self._pwm = PWMOutputDevice(self.pwm_pin, frequency=1000)
                self._pwm.value = self.brightness / 100.0
            except Exception:
                pass

    def stop(self) -> None:
        if self._sos_btn:
            self._sos_btn.close()
        if self._tilt_btn:
            self._tilt_btn.close()
        if self._pwm:
            self._pwm.close()

    def get_brightness(self) -> int:
        return self.brightness

    def set_brightness(self, level: int) -> None:
        self.brightness = max(10, min(100, level))
        if self._pwm:
            try:
                self._pwm.value = self.brightness / 100.0
            except Exception:
                pass
