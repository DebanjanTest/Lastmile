#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod db;
mod hal;
mod order;
mod razorpay;

use auth::{validate_firebase_jwt, SessionClaims};
use db::{get_daily_summary, get_rider_profile, init_db, record_completed_order, update_rider_profile, CompletedOrderRecord, DailySummary, RiderProfile};
use hal::{GpsData, HalState};
use order::{DeliveryOffer, OrderManager, OrderPhase};
use razorpay::{request_razorpay_qr, spawn_payment_listener, RazorpayQrResponse};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub hal: Arc<Mutex<HalState>>,
    pub orders: Arc<Mutex<OrderManager>>,
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

    Ok(TelemetrySnapshot {
        timestamp: chrono::Utc::now().to_rfc3339(),
        gps: hal.gps.clone(),
        order_phase: orders.current_phase.clone(),
        active_offers: orders.active_offers.clone(),
        selected_order: orders.selected_order.clone(),
        daily_summary,
        is_emergency: hal.is_emergency,
        emergency_reason: hal.emergency_reason.clone(),
    })
}

#[tauri::command]
fn accept_order(order_id: String, state: State<AppState>) -> Result<Option<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;

    if let Some(order) = orders.accept_order(&order_id) {
        // Build road polyline from current rider GPS to Store coordinates
        let polyline = vec![
            [hal.gps.latitude, hal.gps.longitude],
            [(hal.gps.latitude + order.store_lat) / 2.0, (hal.gps.longitude + order.store_lng) / 2.0],
            [order.store_lat, order.store_lng],
        ];
        hal.set_route(polyline);
        hal.set_motion(true);
        println!("[ORDER] Accepted {}. Phase 1: Blue route to store", order.order_id);
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
fn pickup_order(state: State<AppState>) -> Result<Option<DeliveryOffer>, String> {
    let mut orders = state.orders.lock().map_err(|e| e.to_string())?;
    let mut hal = state.hal.lock().map_err(|e| e.to_string())?;

    if let Some(order) = orders.pickup_order() {
        // Build road polyline from Store to Customer coordinates
        let polyline = vec![
            [order.store_lat, order.store_lng],
            [(order.store_lat + order.customer_lat) / 2.0, (order.store_lng + order.customer_lng) / 2.0],
            [order.customer_lat, order.customer_lng],
        ];
        hal.set_route(polyline);
        hal.set_motion(true);
        println!("[ORDER] Food picked up! Phase 2: Route to customer {}", order.customer_name);
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

// -----------------------------------------------------------------------------
// APPLICATION BOOTSTRAP
// -----------------------------------------------------------------------------

fn main() {
    // 1. Initialize SQLite database in data/lastmile.db
    let db_conn = init_db("data/lastmile.db").expect("Failed to initialize SQLite database");

    let hal_state = Arc::new(Mutex::new(HalState::new()));
    let order_manager = Arc::new(Mutex::new(OrderManager::new()));

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
        })
        .invoke_handler(tauri::generate_handler![
            get_telemetry_snapshot,
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
            reset_emergency
        ])
        .run(tauri::generate_context!())
        .expect("Error while running LastMile Guard Tauri application");
}
