use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;
use tauri::{AppHandle, Emitter};
use crate::order::DeliveryOffer;
use crate::hal::GpsData;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MockEventType {
    NewOffer,
    CustomerMessage,
    CustomerTip,
    OrderCancelled,
    SpeedSurge,
    RainAlert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockEvent {
    pub id: String,
    pub event_type: MockEventType,
    pub title: String,
    pub description: String,
    pub timestamp: String,
    pub metadata: serde_json::Value,
}

/// Standalone Mock Data Injection Engine
/// Generates synthetic delivery notifications, realistic Kolkata route trajectories,
/// and customer lifecycle events without requiring external cloud APIs.
pub struct MockEngine {
    is_running: bool,
}

impl MockEngine {
    pub fn new() -> Self {
        Self { is_running: false }
    }

    /// Generates a realistic synthetic delivery offer in Kolkata
    pub fn generate_synthetic_offer(seed_index: usize) -> DeliveryOffer {
        let platforms = [
            ("swiggy", "#FC8019"),
            ("zomato", "#E23744"),
            ("zepto", "#7C4DFF"),
            ("blinkit", "#F7D046"),
        ];
        let p_idx = seed_index % platforms.len();
        let (platform_name, platform_color) = platforms[p_idx];

        let kolkata_stores = [
            ("Peter Cat Restaurant", "18A Park Street, Kolkata", 22.5535, 88.3526),
            ("Arsalan Restaurant", "Marina Building, Park Circus 7-Point", 22.5440, 88.3685),
            ("Balaram Mullick Sweets", "Bhowanipore Paddapukur, Kolkata", 22.5312, 88.3498),
            ("Aminia Biryani", "Chinar Park, Rajarhat Main Road", 22.6152, 88.4312),
            ("Wow! Momo Express", "Salt Lake Sector V, Block GP", 22.5714, 88.4316),
            ("6 Ballygunge Place", "Ballygunge Circular Road, Kolkata", 22.5280, 88.3610),
        ];
        let s_idx = seed_index % kolkata_stores.len();
        let store = kolkata_stores[s_idx];

        let kolkata_customers = [
            ("Priyanka Roy", "Tower 4, Silver Spring, EM Bypass", 22.5492, 88.3980, "Leave at main door, ring once"),
            ("Subhashis Ghosh", "DLF New Town, Action Area 1, Flat 802", 22.5835, 88.4550, "Call when near security gate"),
            ("Sourav Mukherjee", "Salt Lake Block CF, House 21", 22.5890, 88.4110, "Hand over directly to security"),
            ("Rhea Chatterjee", "Ballygunge Place, Lane 3B", 22.5250, 88.3670, "Do not ring doorbell (baby asleep)"),
            ("Anirban Sen", "Kankurgachi VIP Enclave", 22.5780, 88.3895, "Gate passcode is 4092"),
        ];
        let c_idx = seed_index % kolkata_customers.len();
        let customer = kolkata_customers[c_idx];

        let is_cod = (seed_index % 2) == 0;
        let order_amount = 250.0 + ((seed_index * 137) % 550) as f64;
        let cod_val = if is_cod { order_amount } else { 0.0 };

        let store_dist = 0.8 + ((seed_index * 3) % 15) as f64 * 0.1;
        let drop_dist = 2.1 + ((seed_index * 7) % 35) as f64 * 0.1;
        let total_dist = store_dist + drop_dist;
        let payout = 35.0 + (total_dist * 12.50).round();
        let otp = format!("{:04}", (1234 + seed_index * 739) % 9000 + 1000);

        DeliveryOffer {
            order_id: format!("ORD-MOCK-{:04}", 1000 + seed_index),
            platform: platform_name.to_string(),
            platform_color: platform_color.to_string(),
            store_name: store.0.to_string(),
            store_address: store.1.to_string(),
            store_lat: store.2,
            store_lng: store.3,
            store_dist_km: store_dist,
            customer_name: customer.0.to_string(),
            customer_address: customer.1.to_string(),
            customer_lat: customer.2,
            customer_lng: customer.3,
            drop_dist_km: drop_dist,
            total_dist_km: total_dist,
            payout_inr: payout,
            items_summary: "Order combo items: 2x Chef Special Meal, 1x Drink, Mint Chutney".to_string(),
            customer_instructions: customer.4.to_string(),
            payment_mode: if is_cod { "COD".to_string() } else { "PREPAID".to_string() },
            order_amount_inr: order_amount,
            cod_amount: cod_val,
            is_payment_pending: is_cod,
            delivery_otp: otp,
            prep_time_minutes: 3 + (seed_index % 5) as i32,
        }
    }

    /// Computes interpolated kinematic trajectory between two GPS points
    /// with simulated road curve offsets and speed profile.
    pub fn generate_kinematic_waypoints(
        start_lat: f64,
        start_lng: f64,
        end_lat: f64,
        end_lng: f64,
        steps: usize,
    ) -> Vec<[f64; 2]> {
        let mut waypoints = Vec::with_capacity(steps);
        for i in 0..=steps {
            let t = (i as f64) / (steps as f64);
            // Slight S-curve perturbation simulating actual urban road geometry
            let lateral_offset = (t * std::f64::consts::PI).sin() * 0.0015;
            let lat = start_lat + (end_lat - start_lat) * t + lateral_offset;
            let lng = start_lng + (end_lng - start_lng) * t - (lateral_offset * 0.5);
            waypoints.push([lat, lng]);
        }
        waypoints
    }

    /// Spawns the autonomous mock event generator task in Tokio
    pub fn spawn_autonomous_engine(app_handle: AppHandle) {
        tokio::spawn(async move {
            let mut tick: usize = 0;
            println!("[MOCK ENGINE] Autonomous Mock Data Injection Engine initialized.");
            
            loop {
                sleep(Duration::from_secs(45)).await;
                tick += 1;

                // Alternate between synthetic offers and customer events
                if tick % 2 == 1 {
                    let offer = Self::generate_synthetic_offer(tick);
                    let _ = app_handle.emit("mock_delivery_offer", &offer);
                    println!("[MOCK ENGINE] Injected synthetic offer: {} ({})", offer.order_id, offer.platform);
                } else {
                    let event = MockEvent {
                        id: format!("EVT-{:04}", tick),
                        event_type: MockEventType::CustomerMessage,
                        title: "Customer Update".to_string(),
                        description: "Customer added a delivery note: 'Please ring the doorbell twice'".to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        metadata: serde_json::json!({
                            "customer": "Subhashis Ghosh",
                            "urgency": "normal"
                        }),
                    };
                    let _ = app_handle.emit("mock_customer_event", &event);
                    println!("[MOCK ENGINE] Injected customer event: {}", event.title);
                }
            }
        });
    }
}
