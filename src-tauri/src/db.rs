use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RiderProfile {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub vehicle_no: String,
    pub daily_target_inr: f64,
    pub daily_target_orders: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompletedOrderRecord {
    pub order_id: String,
    pub platform: String,
    pub store_name: String,
    pub customer_name: String,
    pub payout_inr: f64,
    pub payment_mode: String,
    pub order_amount_inr: f64,
    pub status: String,
    pub completed_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailySummary {
    pub earnings_today_inr: f64,
    pub orders_completed_count: i64,
    pub daily_target_inr: f64,
    pub daily_target_orders: i64,
    pub progress_pct: i64,
}

pub fn init_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    if let Some(parent) = path.as_ref().parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;

    // Execute SQLite pragma for maximum performance on embedded storage
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;"
    )?;

    // Schema: Rider Profile
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rider_profile (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            vehicle_no TEXT NOT NULL,
            daily_target_inr REAL NOT NULL,
            daily_target_orders INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Schema: Order Ledger
    conn.execute(
        "CREATE TABLE IF NOT EXISTS order_ledger (
            order_id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            store_name TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            payout_inr REAL NOT NULL,
            payment_mode TEXT NOT NULL,
            order_amount_inr REAL NOT NULL,
            status TEXT NOT NULL,
            completed_at TEXT NOT NULL
        )",
        [],
    )?;

    // Seed default Rider Profile if table is empty
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM rider_profile", [], |r| r.get(0))?;
    if count == 0 {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rider_profile (id, name, email, phone, vehicle_no, daily_target_inr, daily_target_orders, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "RIDER-KOL-01",
                "Debanjan Mondal",
                "debanjan.rider@lastmile.io",
                "+91 98765 43210",
                "WB 02 AB 4591",
                800.0,
                8,
                now
            ],
        )?;
    }

    Ok(conn)
}

pub fn get_rider_profile(conn: &Connection) -> Result<RiderProfile> {
    conn.query_row(
        "SELECT id, name, email, phone, vehicle_no, daily_target_inr, daily_target_orders, updated_at 
         FROM rider_profile LIMIT 1",
        [],
        |row| {
            Ok(RiderProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                phone: row.get(3)?,
                vehicle_no: row.get(4)?,
                daily_target_inr: row.get(5)?,
                daily_target_orders: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
}

pub fn update_rider_profile(conn: &Connection, p: &RiderProfile) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE rider_profile 
         SET name = ?1, email = ?2, phone = ?3, vehicle_no = ?4, daily_target_inr = ?5, daily_target_orders = ?6, updated_at = ?7
         WHERE id = ?8",
        params![
            p.name,
            p.email,
            p.phone,
            p.vehicle_no,
            p.daily_target_inr,
            p.daily_target_orders,
            now,
            p.id
        ],
    )?;
    Ok(())
}

pub fn record_completed_order(conn: &Connection, order: &CompletedOrderRecord) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO order_ledger 
         (order_id, platform, store_name, customer_name, payout_inr, payment_mode, order_amount_inr, status, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            order.order_id,
            order.platform,
            order.store_name,
            order.customer_name,
            order.payout_inr,
            order.payment_mode,
            order.order_amount_inr,
            order.status,
            order.completed_at
        ],
    )?;
    Ok(())
}

pub fn get_daily_summary(conn: &Connection) -> Result<DailySummary> {
    let profile = get_rider_profile(conn)?;
    
    // Sum total payout from completed orders
    let total_earnings: f64 = conn.query_row(
        "SELECT COALESCE(SUM(payout_inr), 0.0) FROM order_ledger WHERE status = 'DELIVERED'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);

    let total_orders: i64 = conn.query_row(
        "SELECT COUNT(*) FROM order_ledger WHERE status = 'DELIVERED'",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    let progress_pct = if profile.daily_target_inr > 0.0 {
        ((total_earnings / profile.daily_target_inr) * 100.0).min(100.0) as i64
    } else {
        0
    };

    Ok(DailySummary {
        earnings_today_inr: (total_earnings * 100.0).round() / 100.0,
        orders_completed_count: total_orders,
        daily_target_inr: profile.daily_target_inr,
        daily_target_orders: profile.daily_target_orders,
        progress_pct,
    })
}
