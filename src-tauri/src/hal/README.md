# Hardware Abstraction Layer (Rust)

## Overview
Rust native hardware abstraction layer for the Tauri runtime. Manages GPS telemetry state, kinematic vehicle simulation along road polylines, 5-minute rolling circular RAM dashcam frame buffer, incident video export, and Linux CPU/thermal health metrics.

## Interface
- `[mod.rs:GpsData]`
- `[mod.rs:SystemHealth]`
- `[mod.rs:VideoFrame]`
- `[mod.rs:HalState]`
- `[mod.rs:HalState::new]`
- `[mod.rs:HalState::set_motion]`
- `[mod.rs:HalState::set_route]`
- `[mod.rs:HalState::step_kinematics]`
- `[mod.rs:HalState::push_video_frame]`
- `[mod.rs:HalState::flush_incident_vault]`
- `[mod.rs:HalState::get_system_health]`

## Invariants
- `[mod.rs:HalState::new]` Default GPS coordinates set to Kolkata Central Station (`lat: 22.564300, lon: 88.369300, speed: 0.0, heading: 45.0, alt: 14.0, is_fixed: true`).
- `[mod.rs:HalState::new]` RAM video buffer initialized with capacity 3,000 frames and buffer duration 300 seconds (5 minutes).
- `[mod.rs:HalState::set_motion]` Setting `is_stationary = true` resets `gps.speed_kmh` to 0.0.
- `[mod.rs:HalState::set_route]` Resets `current_step_idx` to 0 and initializes coordinates to `polyline[0]`.
- `[mod.rs:HalState::step_kinematics]` Resets `gps.speed_kmh` to 0.0 when stationary or when remaining route points < 2; clamps speed at target 36.0 km/h.
- `[mod.rs:HalState::push_video_frame]` Prunes frames from RAM video buffer whose age exceeds buffer duration.
- `[mod.rs:HalState::get_system_health]` Sets `is_throttled = true` when Linux CPU temperature >= 70.0 °C.

## Side Effects
- `[mod.rs:HalState::new]` Creates `ram_buffer_dir` and `evidence/incidents` directories via `std::fs::create_dir_all`.
- `[mod.rs:HalState::flush_incident_vault]` Writes JSON incident metadata file and MP4 buffer to disk in `evidence/incidents`.
- `[mod.rs:HalState::get_system_health]` Reads Linux `/sys/class/thermal/thermal_zone0/temp` and `/proc/meminfo`.

## Verification
- Run: `python3 -m unittest discover tests/`
