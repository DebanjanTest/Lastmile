#!/usr/bin/env python3
"""
LastMile Guard - Display Rotation Utility for Raspberry Pi (GNOME / Wayland)
Ponytail Lean Architecture: Standard library & native D-Bus. No sudo required.
Usage:
    python3 rotate_screen.py [0|90|180|270]
"""

import sys
from gi.repository import Gio, GLib

TRANSFORMS = {
    "0": 0, "normal": 0,
    "90": 1, "left": 1,
    "180": 2, "inverted": 2, "upside_down": 2,
    "270": 3, "right": 3
}

def rotate(target: str = "180"):
    transform = TRANSFORMS.get(target.lower(), 2)
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    proxy = Gio.DBusProxy.new_sync(
        bus, Gio.DBusProxyFlags.NONE, None,
        "org.gnome.Mutter.DisplayConfig",
        "/org/gnome/Mutter/DisplayConfig",
        "org.gnome.Mutter.DisplayConfig",
        None
    )

    state = proxy.call_sync("GetCurrentState", None, Gio.DBusCallFlags.NONE, -1, None)
    serial, monitors, logical_monitors, props = state.unpack()

    connector = "HDMI-1"
    mode_id = None
    for mon in monitors:
        spec, modes, mon_props = mon
        if spec[0] == connector:
            for m in modes:
                if m[6].get("is-current", False):
                    mode_id = m[0]
                    break

    if not mode_id and monitors:
        connector = monitors[0][0][0]
        mode_id = monitors[0][1][0][0]

    # method 2 = persistent (saves to ~/.config/monitors.xml)
    new_monitors = [(0, 0, 1.0, transform, True, [(connector, mode_id, {})])]
    proxy.call_sync(
        "ApplyMonitorsConfig",
        GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (serial, 2, new_monitors, {})),
        Gio.DBusCallFlags.NONE,
        -1,
        None
    )
    print(f"[DISPLAY] Successfully rotated display ({connector}) to {target} (transform={transform}).")

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "180"
    rotate(arg)
