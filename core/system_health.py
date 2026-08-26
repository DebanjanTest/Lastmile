"""
System Health & Hardware Sentinel
Monitors Raspberry Pi 5 thermal parameters, voltage, and SD card health.
"""

from typing import Dict, Any, List
from hal.base import BaseSystemHealth, SystemHealthData

class SystemHealthSentinel:
    def __init__(self, health_provider: BaseSystemHealth, thermal_warn_c: float = 70.0, thermal_crit_c: float = 80.0):
        self.health_provider = health_provider
        self.thermal_warn_c = thermal_warn_c
        self.thermal_crit_c = thermal_crit_c

    def check_health(self) -> Dict[str, Any]:
        data = self.health_provider.get_health()
        warnings: List[str] = []

        if data.cpu_temp_c >= self.thermal_crit_c:
            warnings.append(f"CRITICAL: CPU Overheating ({data.cpu_temp_c}°C) - Reduce Load")
        elif data.cpu_temp_c >= self.thermal_warn_c:
            warnings.append(f"WARNING: High CPU Temp ({data.cpu_temp_c}°C)")

        if data.voltage_status == "UNDER_VOLTAGE":
            warnings.append("WARNING: Low Input Voltage Detected - Check Battery Backup")
        elif data.is_throttled:
            warnings.append("NOTICE: CPU Frequency Throttled")

        result = data.to_dict()
        result["warnings"] = warnings
        result["is_healthy"] = len(warnings) == 0
        return result
