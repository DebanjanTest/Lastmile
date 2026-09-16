use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutePoint {
    pub lat: f64,
    pub lng: f64,
    pub instruction: String,
    pub road_name: String,
    pub maneuver_type: String,
    pub dist_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficSegment {
    pub start_idx: usize,
    pub end_idx: usize,
    pub status: String,
    pub color: String,
    pub speed_factor: f64,
    pub delay_min: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationData {
    pub instruction: String,
    pub road_name: String,
    pub remaining_total_dist_km: f64,
    pub eta_minutes: u32,
    pub destination_name: String,
    pub destination_coords: Option<[f64; 2]>,
    pub route_polyline: Vec<[f64; 2]>,
    pub traffic_segments: Vec<TrafficSegment>,
    pub traffic_delay_minutes: u32,
    pub current_traffic_status: String,
    pub current_traffic_color: String,
}

pub struct RouterEngine {
    cache: Mutex<HashMap<String, (Vec<RoutePoint>, Vec<[f64; 2]>, Vec<TrafficSegment>, u32)>>,
}

impl RouterEngine {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Fetch shortest/fastest route from start to destination with route caching & traffic simulation
    pub async fn get_route(
        &self,
        start_lat: f64,
        start_lng: f64,
        dest_lat: f64,
        dest_lng: f64,
        dest_name: &str,
        force: bool,
    ) -> (Vec<RoutePoint>, Vec<[f64; 2]>, Vec<TrafficSegment>, u32) {
        let cache_key = format!(
            "{:.3}_{:.3}_{:.3}_{:.3}",
            start_lat, start_lng, dest_lat, dest_lng
        );

        if !force {
            if let Ok(c) = self.cache.lock() {
                if let Some(cached) = c.get(&cache_key) {
                    println!("[ROUTER] Reusing cached route for {} ({} pts)", dest_name, cached.1.len());
                    return cached.clone();
                }
            }
        }

        // Try querying OSRM over HTTP via reqwest
        let mut polyline: Vec<[f64; 2]> = Vec::new();
        let mut steps: Vec<RoutePoint> = Vec::new();

        let osrm_url = format!(
            "http://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson&steps=true",
            start_lng, start_lat, dest_lng, dest_lat
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(2500))
            .user_agent("LastMileGuard/2.2")
            .build();

        if let Ok(client) = client {
            if let Ok(resp) = client.get(&osrm_url).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if json["code"] == "Ok" && json["routes"].is_array() {
                        if let Some(route) = json["routes"].as_array().and_then(|r| r.first()) {
                            if let Some(coords) = route["geometry"]["coordinates"].as_array() {
                                for pt in coords {
                                    if let (Some(lon), Some(lat)) = (pt[0].as_f64(), pt[1].as_f64()) {
                                        polyline.push([lat, lon]);
                                    }
                                }
                            }
                            if let Some(legs) = route["legs"].as_array().and_then(|l| l.first()) {
                                if let Some(stps) = legs["steps"].as_array() {
                                    for s in stps {
                                        let name = s["name"].as_str().unwrap_or("Road").to_string();
                                        let dist = s["distance"].as_f64().unwrap_or(150.0);
                                        let m_type = s["maneuver"]["type"].as_str().unwrap_or("turn").to_string();
                                        let lat = s["maneuver"]["location"][1].as_f64().unwrap_or(dest_lat);
                                        let lng = s["maneuver"]["location"][0].as_f64().unwrap_or(dest_lng);
                                        steps.push(RoutePoint {
                                            lat,
                                            lng,
                                            instruction: format!("{} onto {}", m_type.replace('_', " "), name),
                                            road_name: name,
                                            maneuver_type: m_type,
                                            dist_m: dist,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Offline high-fidelity geometric fallback if OSRM is offline or timed out
        if polyline.is_empty() {
            println!("[ROUTER] Using offline high-fidelity geometric interpolation for {}", dest_name);
            let num_points = 8;
            for i in 0..=num_points {
                let frac = i as f64 / num_points as f64;
                // Add slight organic curve
                let curve = (frac * std::f64::consts::PI).sin() * 0.0025;
                let lat = start_lat + (dest_lat - start_lat) * frac + curve * 0.4;
                let lng = start_lng + (dest_lng - start_lng) * frac + curve;
                polyline.push([lat, lng]);
            }
            steps.push(RoutePoint {
                lat: start_lat,
                lng: start_lng,
                instruction: format!("Depart towards {}", dest_name),
                road_name: "Starting Corridor".to_string(),
                maneuver_type: "DEPART".to_string(),
                dist_m: 200.0,
            });
            steps.push(RoutePoint {
                lat: dest_lat,
                lng: dest_lng,
                instruction: format!("Arrive at {}", dest_name),
                road_name: dest_name.to_string(),
                maneuver_type: "DESTINATION".to_string(),
                dist_m: 0.0,
            });
        }

        // Generate traffic congestion segments
        let count = polyline.len();
        let mid1 = count / 3;
        let mid2 = (count * 2) / 3;

        let traffic_segments = vec![
            TrafficSegment {
                start_idx: 0,
                end_idx: mid1,
                status: "FLOWING".to_string(),
                color: "#00E676".to_string(),
                speed_factor: 1.0,
                delay_min: 0,
            },
            TrafficSegment {
                start_idx: mid1,
                end_idx: mid2,
                status: "MODERATE".to_string(),
                color: "#F59E0B".to_string(),
                speed_factor: 0.65,
                delay_min: 2,
            },
            TrafficSegment {
                start_idx: mid2,
                end_idx: count.saturating_sub(1),
                status: "FLOWING".to_string(),
                color: "#00E676".to_string(),
                speed_factor: 1.0,
                delay_min: 0,
            },
        ];

        let total_delay = 2; // 2 min traffic delay

        let result = (steps, polyline, traffic_segments, total_delay);
        if let Ok(mut c) = self.cache.lock() {
            c.insert(cache_key, result.clone());
        }

        result
    }

    /// Check perpendicular deviation of rider GPS from active route polyline (in meters)
    pub fn calculate_deviation_m(&self, lat: f64, lng: f64, polyline: &[[f64; 2]]) -> f64 {
        if polyline.len() < 2 {
            return 0.0;
        }

        let mut min_dist = f64::MAX;
        let mid_lat = lat.to_radians();
        let m_per_lat = 111139.0;
        let m_per_lng = 111139.0 * mid_lat.cos();

        let px = lng * m_per_lng;
        let py = lat * m_per_lat;

        for w in polyline.windows(2) {
            let p1 = w[0];
            let p2 = w[1];

            let ax = p1[1] * m_per_lng;
            let ay = p1[0] * m_per_lat;
            let bx = p2[1] * m_per_lng;
            let by = p2[0] * m_per_lat;

            let dx = bx - ax;
            let dy = by - ay;
            let len_sq = dx * dx + dy * dy;

            let d = if len_sq < 0.0001 {
                ((px - ax).powi(2) + (py - ay).powi(2)).sqrt()
            } else {
                let t = (0.0f64).max((1.0f64).min(((px - ax) * dx + (py - ay) * dy) / len_sq));
                let proj_x = ax + t * dx;
                let proj_y = ay + t * dy;
                ((px - proj_x).powi(2) + (py - proj_y).powi(2)).sqrt()
            };

            if d < min_dist {
                min_dist = d;
            }
        }

        min_dist
    }
}
