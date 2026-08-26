"""
Raspberry Pi 5 Internal Hardware Telemetry Provider
Reads directly from Linux sysfs (/sys/class/thermal) and vcgencmd without bloated monitoring agents.
"""

import os
import time
import subprocess
from pathlib import Path
from hal.base import BaseSystemHealth, SystemHealthData

try:
    import psutil
except ImportError:
    psutil = None

class Pi5InternalHealth(BaseSystemHealth):
    def __init__(self):
        self._start_time = time.time()
        self._thermal_path = Path("/sys/class/thermal/thermal_zone0/temp")
        self._device_model = self._detect_model()

    def _detect_model(self) -> str:
        model_path = Path("/proc/device-tree/model")
        if model_path.exists():
            try:
                return model_path.read_text().strip("\x00\n ")
            except Exception:
                pass
        return "Raspberry Pi 5 (Linux)"

    def _read_cpu_temp(self) -> float:
        if self._thermal_path.exists():
            try:
                raw = self._thermal_path.read_text().strip()
                return float(raw) / 1000.0
            except Exception:
                pass
        # Fallback if psutil available
        if psutil and hasattr(psutil, "sensors_temperatures"):
            try:
                temps = psutil.sensors_temperatures()
                if "cpu_thermal" in temps and temps["cpu_thermal"]:
                    return temps["cpu_thermal"][0].current
            except Exception:
                pass
        return 45.0  # Simulated default

    def _check_throttling(self) -> tuple[bool, str]:
        # Pi specific check using vcgencmd
        try:
            res = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=1)
            if res.returncode == 0 and "throttled=" in res.stdout:
                code_hex = res.stdout.strip().split("=")[1]
                code = int(code_hex, 16)
                is_throttled = (code != 0)
                under_voltage = bool(code & 0x1 or code & 0x10000)
                status = "UNDER_VOLTAGE" if under_voltage else ("THROTTLED" if is_throttled else "OK")
                return is_throttled, status
        except Exception:
            pass
        return False, "OK"

    def get_health(self) -> SystemHealthData:
        cpu_temp = self._read_cpu_temp()
        is_throttled, voltage_status = self._check_throttling()
        
        cpu_usage = 0.0
        ram_usage = 0.0
        if psutil:
            try:
                cpu_usage = psutil.cpu_percent(interval=None)
                ram_usage = psutil.virtual_memory().percent
            except Exception:
                pass

        uptime = time.time() - self._start_time
        uptime_path = Path("/proc/uptime")
        if uptime_path.exists():
            try:
                uptime = float(uptime_path.read_text().split()[0])
            except Exception:
                pass

        return SystemHealthData(
            cpu_temp_c=cpu_temp,
            is_throttled=is_throttled,
            voltage_status=voltage_status,
            ram_usage_pct=ram_usage,
            cpu_usage_pct=cpu_usage,
            device_model=self._device_model,
            uptime_seconds=uptime
        )
