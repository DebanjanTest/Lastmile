#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod db;
mod hal;
mod mock_engine;
mod order;
mod razorpay;
mod router;

use auth::{validate_firebase_jwt, SessionClaims};
use db::{get_daily_summary, get_rider_profile, init_db, record_completed_order, update_rider_profile, CompletedOrderRecord, DailySummary, RiderProfile};
use hal::{GpsData, HalState};
use mock_engine::{MockEngine, MockEvent};
use order::{DeliveryOffer, OrderManager, OrderPhase};
use razorpay::{request_razorpay_qr, spawn_payment_listener, RazorpayQrResponse};
use router::{NavigationData, RouterEngine, TrafficSegment};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub hal: Arc<Mutex<HalState>>,
    pub orders: Arc<Mutex<OrderManager>>,
    pub router: Arc<RouterEngine>,
}

#[derive(Serialize, Deserialize)]
pub struct TelemetrySnapshot {
    pub timestamp: String,
    pub gps: GpsData,
    pub order_phase: OrderPhase,
    pub active_offers: Vec<DeliveryOffer>,
    pub selected_order: Option<DeliveryOffer>,
    pub daily_summary: DailySummary,
    pub is_emergency: bool,
    pub emergency_reason: String,
    pub navigation: Option<NavigationData>,
}

// -----------------------------------------------------------------------------
// TAURI COMMANDS
// -----------------------------------------------------------------------------

#[tauri::command]
fn get_telemetry_snapshot(state: State<AppState>) -> Result<TelemetrySnapshot, String> {
    let hal = state.hal.lock().map_err(|e| e.to_string())?;
    let orders = state.orders.lock().map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let daily_summary = get_daily_summary(&db).map_err(|e| e.to_string())?;

    let navigation = if let Some(ref order) = orders.selected_order {
        let (dest_name, dest_coords) = match orders.current_phase {
            OrderPhase::RouteToStore | OrderPhase::AtStore => {
                (order.store_name.clone(), Some([order.store_lat, order.store_lng]))
            }
            OrderPhase::RouteToCustomer | OrderPhase::AtCustomer => {
                (order.customer_name.clone(), Some([order.customer_lat, order.customer_lng]))
            }
            _ => ("Stationary".to_string(), None),
        };

        let remaining_km = if hal.route_polyline.len() > hal.current_step_idx {
            let mut rem_deg = 0.0;
            for w in hal.route_polyline[hal.current_step_idx..].windows(2) {
                let dlat = w[1][0] - w[0][0];
                let dlng = w[1][1] - w[0][1];
                rem_deg += (dlat * dlat + dlng * dlng).sqrt();
            }
            rem_deg * 111.0
        } else {
            0.0
        };

        let speed = hal.gps.speed_kmh.max(35.0);
        let base_eta = ((remaining_km / speed) * 60.0).ceil() as u32;
        let traffic_delay = 2; // +2 min
        let total_eta = base_eta + traffic_delay;

        Some(NavigationData {
            instruction: match orders.current_phase {
                OrderPhase::RouteToStore => format!("Navigate to {}", order.store_name),
                OrderPhase::AtStore => format!("Package ready at {}", order.store_name),
                OrderPhase::RouteToCustomer => format!("Deliver to {}", order.customer_name),
                OrderPhase::AtCustomer => format!("Doorstep: {}", order.customer_name),
                _ => "Standing by".to_string(),
            },
            road_name: order.store_address.clone(),
            remaining_total_dist_km: remaining_km,
            eta_minutes: total_eta,
            destination_name: dest_name,
            destination_coords: dest_coords,
            route_polyline: hal.route_polyline.clone(),
            traffic_segments: vec![
                TrafficSegment {
                    start_idx: 0,
                    end_idx: hal.route_polyline.len() / 2,
                    status: "FLOWING".to_string(),
                    color: "#00E676".to_string(),
                    speed_factor: 1.0,
                    delay_min: 0,
                },
                TrafficSegment {
                    start_idx: hal.route_polyline.len() / 2,
                    end_idx: hal.route_polyline.len(),
                    status: "MODERATE".to_string(),
                    color: "#F59E0B".to_string(),
                    speed_factor: 0.7,
                    delay_min: 2,
                },
            ],
            traffic_delay_minutes: traffic_delay,
            current_traffic_status: "MODERATE".to_string(),
            current_traffic_color: "#F59E0B".to_string(),
        })
    } else {
        None
    };

    Ok(TelemetrySnapshot {
        timestamp: chrono::Utc::now().to_rfc3339(),
        gps: hal.gps.clone(),
        order_phase: orders.current_phase.clone(),
        active_offers: orders.active_offers.clone(),
        selected_order: orders.selected_order.clone(),
        daily_summary,
        is_emergency: hal.is_emergency,
        emergency_reason: hal.emergency_reason.clone(),
        navigation,
    })
}

#[tauri::command]
async fn accept_order(order_id: String, state: State<'_, AppState>) -> Result<Option<DeliveryOffer>, String> {
    let order_opt = {
        let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
        orders.accept_order(&order_id)
    };

    if let Some(order) = order_opt {
        let (rider_lat, rider_lng) = {
            let hal = state.hal.lock().map_err(|e| e.to_string())?;
            (hal.gps.latitude, hal.gps.longitude)
        };

        // Calculate dynamic road route from Rider GPS to Store
        let (_steps, polyline, _traffic, _delay) = state.router.get_route(
            rider_lat, rider_lng, order.store_lat, order.store_lng, &order.store_name, false
        ).await;

        {
            let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
            hal.set_route(polyline);
            hal.set_motion(true);
        }
        println!("[ORDER] Accepted {}. Phase 1: Dynamic Blue route to store", order.order_id);
        Ok(Some(order))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn reach_store(state: State<AppState>) -> Result<Option<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;

    if let Some(order) = orders.reach_store() {
        hal.set_motion(false); // Halt while collecting package
        println!("[ORDER] Arrived at store {}", order.store_name);
        Ok(Some(order))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn pickup_order(state: State<'_, AppState>) -> Result<Option<DeliveryOffer>, String> {
    let order_opt = {
        let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
        orders.pickup_order()
    };

    if let Some(order) = order_opt {
        // Immediately clear previous store route and compute store to customer route
        let (_steps, polyline, _traffic, _delay) = state.router.get_route(
            order.store_lat, order.store_lng, order.customer_lat, order.customer_lng, &order.customer_name, false
        ).await;

        {
            let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
            hal.set_route(polyline);
            hal.set_motion(true);
        }
        println!("[ORDER] Food picked up! Phase 2: Dynamic Green route to customer {}", order.customer_name);
        Ok(Some(order))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn reach_customer(state: State<AppState>) -> Result<Option<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;

    if let Some(order) = orders.reach_customer() {
        hal.set_motion(false); // Halt at customer doorstep for OTP
        Ok(Some(order))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn complete_delivery(entered_otp: String, state: State<AppState>) -> Result<Option<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(ref current_order) = orders.selected_order {
        // Validate OTP if provided
        if !entered_otp.is_empty() && entered_otp != current_order.delivery_otp {
            return Err("Invalid Delivery OTP. Please verify with customer.".to_string());
        }

        let order_record = CompletedOrderRecord {
            order_id: current_order.order_id.clone(),
            platform: current_order.platform.clone(),
            store_name: current_order.store_name.clone(),
            customer_name: current_order.customer_name.clone(),
            payout_inr: current_order.payout_inr,
            payment_mode: current_order.payment_mode.clone(),
            order_amount_inr: current_order.order_amount_inr,
            status: "DELIVERED".to_string(),
            completed_at: chrono::Utc::now().to_rfc3339(),
        };

        let _ = record_completed_order(&db, &order_record);
    }

    if let Some(order) = orders.complete_delivery() {
        hal.set_motion(false);
        hal.route_polyline.clear();
        println!("[ORDER] Order #{} Delivered and recorded to SQLite ledger!", order.order_id);
        Ok(Some(order))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn dismiss_offer(order_id: String, state: State<AppState>) -> Result<(), String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    orders.dismiss_offer(&order_id);
    Ok(())
}

#[tauri::command]
fn refresh_offers(state: State<AppState>) -> Result<Vec<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    orders.seed_kolkata_offers();
    Ok(orders.active_offers.clone())
}

#[tauri::command]
async fn generate_razorpay_qr(
    order_id: String,
    cod_amount: f64,
    app_handle: AppHandle,
) -> Result<RazorpayQrResponse, String> {
    let response = request_razorpay_qr(order_id.clone(), cod_amount).await?;
    // Spawn background task polling for customer payment
    spawn_payment_listener(app_handle, response.qr_id.clone(), order_id, cod_amount);
    Ok(response)
}

#[tauri::command]
fn validate_session(token: String) -> Result<SessionClaims, String> {
    validate_firebase_jwt(&token)
}

#[tauri::command]
fn get_profile(state: State<AppState>) -> Result<RiderProfile, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    get_rider_profile(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_profile(profile: RiderProfile, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    update_rider_profile(&db, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
fn trigger_sos(state: State<AppState>) -> Result<String, String> {
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
    hal.is_emergency = true;
    hal.emergency_reason = "MANUAL SOS ACTIVATED".to_string();
    let locked_path = hal.flush_incident_vault("MANUAL_SOS");
    Ok(locked_path)
}

#[tauri::command]
fn trigger_tilt(state: State<AppState>) -> Result<String, String> {
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
    hal.is_emergency = true;
    hal.emergency_reason = "VEHICLE CRASH / TILT > 45°".to_string();
    let locked_path = hal.flush_incident_vault("CRASH_TILT");
    Ok(locked_path)
}

#[tauri::command]
fn reset_emergency(state: State<AppState>) -> Result<(), String> {
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;
    hal.is_emergency = false;
    hal.emergency_reason.clear();
    Ok(())
}

#[tauri::command]
fn inject_mock_offer(seed: usize, state: State<AppState>, app: AppHandle) -> Result<DeliveryOffer, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let offer = MockEngine::generate_synthetic_offer(seed);
    orders.active_offers.insert(0, offer.clone());
    let _ = app.emit("mock_delivery_offer", &offer);
    Ok(offer)
}

#[tauri::command]
fn infiltrate_order(state: State<AppState>, app: AppHandle) -> Result<DeliveryOffer, String> {
    let seed = rand::random::<usize>() % 10000;
    inject_mock_offer(seed, state, app)
}

#[tauri::command]
fn inject_mock_event(event_type: String, title: String, description: String, app: AppHandle) -> Result<MockEvent, String> {
    let mock_type = match event_type.as_str() {
        "CustomerTip" => mock_engine::MockEventType::CustomerTip,
        "OrderCancelled" => mock_engine::MockEventType::OrderCancelled,
        "SpeedSurge" => mock_engine::MockEventType::SpeedSurge,
        "RainAlert" => mock_engine::MockEventType::RainAlert,
        _ => mock_engine::MockEventType::CustomerMessage,
    };
    let event = MockEvent {
        id: format!("EVT-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
        event_type: mock_type,
        title,
        description,
        timestamp: chrono::Utc::now().to_rfc3339(),
        metadata: serde_json::json!({"source": "mock_injection_engine"}),
    };
    let _ = app.emit("mock_customer_event", &event);
    Ok(event)
}

#[tauri::command]
fn get_system_health(state: State<AppState>) -> Result<hal::SystemHealth, String> {
    let hal = state.hal.lock().map_err(|e| e.to_string())?;
    Ok(hal.get_system_health())
}

// -----------------------------------------------------------------------------
// APPLICATION BOOTSTRAP
// -----------------------------------------------------------------------------

fn main() {
    // 1. Initialize SQLite database in data/lastmile.db
    let db_conn = init_db("data/lastmile.db").expect("Failed to initialize SQLite database");

    let hal_state = Arc::new(Mutex::new(HalState::new()));
    let order_manager = Arc::new(Mutex::new(OrderManager::new()));
    let router_engine = Arc::new(RouterEngine::new());

    // 2. Spawn 5 Hz Kinematics & RAM Dashcam Worker Loop
    let hal_worker = Arc::clone(&hal_state);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200)); // 5 Hz
        loop {
            interval.tick().await;
            if let Ok(mut hal) = hal_worker.lock() {
                hal.step_kinematics(0.2);
                // Ingest synthetic frame to Level 2 RAM buffer
                hal.push_video_frame(b"FRAME_RAW_H264".to_vec());
            }
        }
    });

    // 3. Build and Run Tauri v2 Application
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db_conn),
            hal: Arc::clone(&hal_state),
            orders: Arc::clone(&order_manager),
            router: Arc::clone(&router_engine),
        })
        .setup(|app| {
            MockEngine::spawn_autonomous_engine(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_telemetry_snapshot,
            get_system_health,
            accept_order,
            reach_store,
            pickup_order,
            reach_customer,
            complete_delivery,
            dismiss_offer,
            refresh_offers,
            generate_razorpay_qr,
            validate_session,
            get_profile,
            update_profile,
            trigger_sos,
            trigger_tilt,
            reset_emergency,
            infiltrate_order,
            inject_mock_offer,
            inject_mock_event
        ])
        .run(tauri::generate_context!())
        .expect("Error while running LastMile Guard Tauri application");
}
