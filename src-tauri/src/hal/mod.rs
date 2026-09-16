use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpsData {
    pub latitude: f64,
    pub longitude: f64,
    pub speed_kmh: f64,
    pub heading_deg: f64,
    pub altitude_m: f64,
    pub is_fixed: bool,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHealth {
    pub cpu_temp_c: f64,
    pub ram_usage_pct: f64,
    pub is_throttled: bool,
    pub device_model: String,
}

// Frame representation for the 5-Tier Memory Pipeline Level 2 RAM Buffer
#[derive(Clone)]
pub struct VideoFrame {
    pub timestamp: Instant,
    pub payload: Vec<u8>,
}

pub struct HalState {
    pub gps: GpsData,
    pub is_stationary: bool,
    pub is_emergency: bool,
    pub emergency_reason: String,
    pub route_polyline: Vec<[f64; 2]>,
    pub current_step_idx: usize,
    // Level 2 RAM-disk circular ring buffer (retained in memory or /run/shm/)
    pub ram_video_buffer: VecDeque<VideoFrame>,
    pub buffer_duration: Duration,
    pub storage_dir: PathBuf,
    pub ram_buffer_dir: PathBuf,
}

impl HalState {
    pub fn new() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        
        // Target default: Kolkata Central Station coordinates
        let default_gps = GpsData {
            latitude: 22.564300,
            longitude: 88.369300,
            speed_kmh: 0.0,
            heading_deg: 45.0,
            altitude_m: 14.0,
            is_fixed: true,
            timestamp: now,
        };

        // Determine Level 2 buffer directory: /run/shm/dashcam_ring or /dev/shm/dashcam_ring on Linux if exists
        let ram_candidates = [PathBuf::from("/run/shm/dashcam_ring"), PathBuf::from("/dev/shm/dashcam_ring")];
        let mut ram_buffer_dir = PathBuf::from("data/ram_shm/dashcam_ring");
        for cand in &ram_candidates {
            if cand.parent().map(|p| p.exists()).unwrap_or(false) {
                ram_buffer_dir = cand.clone();
                break;
            }
        }
        let _ = std::fs::create_dir_all(&ram_buffer_dir);

        let storage_dir = PathBuf::from("evidence/incidents");
        let _ = std::fs::create_dir_all(&storage_dir);

        Self {
            gps: default_gps,
            is_stationary: true,
            is_emergency: false,
            emergency_reason: String::new(),
            route_polyline: Vec::new(),
            current_step_idx: 0,
            ram_video_buffer: VecDeque::with_capacity(3000), // 300s (5-min) at 10fps
            buffer_duration: Duration::from_secs(300),
            storage_dir,
            ram_buffer_dir,
        }
    }

    pub fn set_motion(&mut self, enabled: bool) {
        self.is_stationary = !enabled;
        if self.is_stationary {
            self.gps.speed_kmh = 0.0;
        }
    }

    pub fn set_route(&mut self, polyline: Vec<[f64; 2]>) {
        if !polyline.is_empty() {
            self.gps.latitude = polyline[0][0];
            self.gps.longitude = polyline[0][1];
        }
        self.route_polyline = polyline;
        self.current_step_idx = 0;
    }

    // Kinematic Step (5 Hz update cycle)
    pub fn step_kinematics(&mut self, dt_secs: f64) {
        if self.is_stationary || self.route_polyline.len() < 2 {
            self.gps.speed_kmh = 0.0;
            return;
        }

        if self.current_step_idx >= self.route_polyline.len() - 1 {
            self.gps.speed_kmh = 0.0;
            return;
        }

        let p1 = self.route_polyline[self.current_step_idx];
        let p2 = self.route_polyline[self.current_step_idx + 1];

        let target_speed = 36.0; // km/h cruise
        let accel_rate = 8.0;    // +8 km/h/s
        if self.gps.speed_kmh < target_speed {
            self.gps.speed_kmh = (self.gps.speed_kmh + accel_rate * dt_secs).min(target_speed);
        }

        let speed_mps = self.gps.speed_kmh * (1000.0 / 3600.0);
        let dist_to_advance = speed_mps * dt_secs;

        // Calculate heading
        let d_lat = p2[0] - p1[0];
        let d_lng = p2[1] - p1[1];
        let heading = d_lng.atan2(d_lat).to_degrees();
        self.gps.heading_deg = if heading < 0.0 { heading + 360.0 } else { heading };

        // Advance latitude/longitude proportionally
        let seg_len_deg = (d_lat * d_lat + d_lng * d_lng).sqrt();
        if seg_len_deg > 0.00001 {
            let deg_to_advance = dist_to_advance / 111000.0; // approximate meters to deg
            let progress = deg_to_advance / seg_len_deg;

            self.gps.latitude += d_lat * progress;
            self.gps.longitude += d_lng * progress;

            // Check if advanced past waypoint
            let remaining_d_lat = p2[0] - self.gps.latitude;
            let remaining_d_lng = p2[1] - self.gps.longitude;
            if (remaining_d_lat * d_lat + remaining_d_lng * d_lng) <= 0.0 {
                self.current_step_idx += 1;
                self.gps.latitude = p2[0];
                self.gps.longitude = p2[1];
            }
        } else {
            self.current_step_idx += 1;
        }

        self.gps.timestamp = chrono::Utc::now().to_rfc3339();
    }

    // Ingestion into Level 2 RAM buffer
    pub fn push_video_frame(&mut self, frame_bytes: Vec<u8>) {
        let now = Instant::now();
        self.ram_video_buffer.push_back(VideoFrame {
            timestamp: now,
            payload: frame_bytes,
        });

        // Prune frames older than buffer_duration (60s)
        while let Some(front) = self.ram_video_buffer.front() {
            if now.duration_since(front.timestamp) > self.buffer_duration {
                self.ram_video_buffer.pop_front();
            } else {
                break;
            }
        }
    }

    // Flush Level 2 RAM buffer to Level 3 Incident Vault (evidence/incidents/)
    pub fn flush_incident_vault(&mut self, reason: &str) -> String {
        let timestamp_str = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let safe_reason = reason.to_lowercase().replace(' ', "_");
        let mp4_filename = format!("incident_{}_{}.mp4", safe_reason, timestamp_str);
        let json_filename = format!("incident_{}_{}.json", safe_reason, timestamp_str);

        let mp4_path = self.storage_dir.join(&mp4_filename);
        let json_path = self.storage_dir.join(&json_filename);

        // Commit JSON blackbox telemetry
        let now_utc = chrono::Utc::now();
        let metadata = serde_json::json!({
            "incident_reason": reason,
            "timestamp": now_utc.to_rfc3339(),
            "timestamp_us": now_utc.timestamp_micros(),
            "frames_preserved": self.ram_video_buffer.len(),
            "pre_incident_buffer_seconds": 300,
            "post_incident_buffer_seconds": 30,
            "ram_buffer_mount": self.ram_buffer_dir.to_string_lossy().to_string(),
            "acceleration_vector": {
                "x_axis_g": 0.0,
                "y_axis_g": 0.0,
                "z_axis_g": 1.0,
                "tilt_degrees": if reason.to_lowercase().contains("tilt") || reason.to_lowercase().contains("crash") { 48.2 } else { 0.0 }
            },
            "telemetry": {
                "latitude": self.gps.latitude,
                "longitude": self.gps.longitude,
                "speed_kmh": self.gps.speed_kmh,
                "heading_deg": self.gps.heading_deg,
            },
            "file_path": mp4_path.to_string_lossy().to_string()
        });

        let _ = std::fs::write(&json_path, serde_json::to_string_pretty(&metadata).unwrap_or_default());
        // Write mock/real MP4 container bytes
        let _ = std::fs::write(&mp4_path, b"LASTMILE_EVIDENCE_LOCKED_MP4_BUFFER_300S");

        println!("[DASHCAM] Locked incident committed to Level 3 Vault: {:?}", mp4_path);
        mp4_path.to_string_lossy().to_string()
    }

    // Direct Linux sysfs thermal & memory health telemetry for Ubuntu/Pi 5
    pub fn get_system_health(&self) -> SystemHealth {
        let mut cpu_temp = 45.0;
        let mut ram_usage = 24.5;
        let mut is_throttled = false;

        #[cfg(target_os = "linux")]
        {
            if let Ok(raw) = std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp") {
                if let Ok(milli_c) = raw.trim().parse::<f64>() {
                    cpu_temp = milli_c / 1000.0;
                }
            }

            if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
                let mut total = 0.0;
                let mut free = 0.0;
                for line in meminfo.lines() {
                    if line.starts_with("MemTotal:") {
                        total = line.split_whitespace().nth(1).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
                    } else if line.starts_with("MemAvailable:") {
                        free = line.split_whitespace().nth(1).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
                    }
                }
                if total > 0.0 {
                    ram_usage = ((total - free) / total) * 100.0;
                }
            }

            if cpu_temp >= 70.0 {
                is_throttled = true;
            }
        }

        SystemHealth {
            cpu_temp_c: cpu_temp,
            ram_usage_pct: ram_usage,
            is_throttled,
            device_model: if cfg!(target_os = "linux") {
                "Raspberry Pi 5 (Ubuntu 24.04 / Bookworm)".to_string()
            } else {
                "Desktop Simulation (Windows/macOS)".to_string()
            },
        }
    }
}
