use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderPhase {
    Idle,
    RouteToStore,
    AtStore,
    RouteToCustomer,
    AtCustomer,
    Delivered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryOffer {
    pub order_id: String,
    pub platform: String,
    pub platform_color: String,
    pub store_name: String,
    pub store_address: String,
    pub store_lat: f64,
    pub store_lng: f64,
    pub store_dist_km: f64,
    pub customer_name: String,
    pub customer_address: String,
    pub customer_lat: f64,
    pub customer_lng: f64,
    pub drop_dist_km: f64,
    pub total_dist_km: f64,
    pub payout_inr: f64,
    pub items_summary: String,
    pub customer_instructions: String,
    pub payment_mode: String,       // "PREPAID" | "COD"
    pub order_amount_inr: f64,
    pub cod_amount: f64,
    pub is_payment_pending: bool,
    pub delivery_otp: String,
    pub prep_time_minutes: i32,
}

pub struct OrderManager {
    pub current_phase: OrderPhase,
    pub active_offers: Vec<DeliveryOffer>,
    pub selected_order: Option<DeliveryOffer>,
}

impl OrderManager {
    pub fn new() -> Self {
        let mut mgr = Self {
            current_phase: OrderPhase::Idle,
            active_offers: Vec::new(),
            selected_order: None,
        };
        mgr.seed_kolkata_offers();
        mgr
    }

    pub fn seed_kolkata_offers(&mut self) {
        // Kolkata locations: Park Street, Salt Lake Sector V, New Town, Baranagar
        self.active_offers = vec![
            DeliveryOffer {
                order_id: "ORD-SWG-94".to_string(),
                platform: "swiggy".to_string(),
                platform_color: "#FC8019".to_string(),
                store_name: "Wow! Momo Express".to_string(),
                store_address: "Central Avenue Quick Hub, Kolkata".to_string(),
                store_lat: 22.5698,
                store_lng: 88.3648,
                store_dist_km: 0.8,
                customer_name: "Ananya Sen".to_string(),
                customer_address: "New Town Action Area 1, Tower 3".to_string(),
                customer_lat: 22.5835,
                customer_lng: 88.4550,
                drop_dist_km: 3.0,
                total_dist_km: 3.8,
                payout_inr: 85.26,
                items_summary: "2x Darjeeling Steamed Momos, 1x Pan-Fried, 2x Thums Up".to_string(),
                customer_instructions: "Hand over to security at Gate 2".to_string(),
                payment_mode: "COD".to_string(),
                order_amount_inr: 360.0,
                cod_amount: 360.0,
                is_payment_pending: true,
                delivery_otp: "4829".to_string(),
                prep_time_minutes: 3,
            },
            DeliveryOffer {
                order_id: "ORD-ZOM-81".to_string(),
                platform: "zomato".to_string(),
                platform_color: "#E23744".to_string(),
                store_name: "Arsalan Mughlai Restaurant".to_string(),
                store_address: "Park Circus 7-Point, Kolkata".to_string(),
                store_lat: 22.5440,
                store_lng: 88.3685,
                store_dist_km: 1.4,
                customer_name: "Debanjan Mondal".to_string(),
                customer_address: "Salt Lake Sector V, Block EP, Flat 4B".to_string(),
                customer_lat: 22.5735,
                customer_lng: 88.4330,
                drop_dist_km: 3.2,
                total_dist_km: 4.6,
                payout_inr: 78.99,
                items_summary: "2x Special Mutton Biryani, 1x Firni Pot, 1x Extra Raita".to_string(),
                customer_instructions: "Leave at door (Baby sleeping)".to_string(),
                payment_mode: "PREPAID".to_string(),
                order_amount_inr: 580.0,
                cod_amount: 0.0,
                is_payment_pending: false,
                delivery_otp: "7193".to_string(),
                prep_time_minutes: 4,
            },
            DeliveryOffer {
                order_id: "ORD-ZEP-12".to_string(),
                platform: "zepto".to_string(),
                platform_color: "#7C4DFF".to_string(),
                store_name: "Zepto 10-Min Dark Store #104".to_string(),
                store_address: "Kankurgachi Logistics Depot".to_string(),
                store_lat: 22.5775,
                store_lng: 88.3880,
                store_dist_km: 0.9,
                customer_name: "Rahul Banerjee".to_string(),
                customer_address: "Baranagar Netaji Road, House 12".to_string(),
                customer_lat: 22.6450,
                customer_lng: 88.3720,
                drop_dist_km: 2.1,
                total_dist_km: 3.0,
                payout_inr: 65.14,
                items_summary: "2x Amul Taaza Milk (1L), 1x Brown Bread, 1x Butter".to_string(),
                customer_instructions: "Call when you reach gate".to_string(),
                payment_mode: "PREPAID".to_string(),
                order_amount_inr: 245.0,
                cod_amount: 0.0,
                is_payment_pending: false,
                delivery_otp: "2054".to_string(),
                prep_time_minutes: 2,
            },
            DeliveryOffer {
                order_id: "ORD-AMZ-55".to_string(),
                platform: "amazon".to_string(),
                platform_color: "#FF9900".to_string(),
                store_name: "Amazon Fresh Fulfillment Depot".to_string(),
                store_address: "EM Bypass Logistics Complex".to_string(),
                store_lat: 22.5310,
                store_lng: 88.3970,
                store_dist_km: 1.4,
                customer_name: "Sourav Karmakar".to_string(),
                customer_address: "Chinar Park Near City Centre 2".to_string(),
                customer_lat: 22.6280,
                customer_lng: 88.4410,
                drop_dist_km: 3.7,
                total_dist_km: 5.1,
                payout_inr: 112.75,
                items_summary: "3x Fresh Grocery Package Bins".to_string(),
                customer_instructions: "Place on veranda table (Beware of dog)".to_string(),
                payment_mode: "COD".to_string(),
                order_amount_inr: 890.0,
                cod_amount: 890.0,
                is_payment_pending: true,
                delivery_otp: "9831".to_string(),
                prep_time_minutes: 2,
            }
        ];
    }

    pub fn accept_order(&mut self, order_id: &str) -> Option<DeliveryOffer> {
        if let Some(pos) = self.active_offers.iter().position(|o| o.order_id == order_id) {
            let order = self.active_offers.remove(pos);
            self.selected_order = Some(order.clone());
            self.current_phase = OrderPhase::RouteToStore;
            Some(order)
        } else if !self.active_offers.is_empty() {
            let order = self.active_offers.remove(0);
            self.selected_order = Some(order.clone());
            self.current_phase = OrderPhase::RouteToStore;
            Some(order)
        } else {
            None
        }
    }

    pub fn reach_store(&mut self) -> Option<DeliveryOffer> {
        if self.selected_order.is_some() {
            self.current_phase = OrderPhase::AtStore;
            self.selected_order.clone()
        } else {
            None
        }
    }

    pub fn pickup_order(&mut self) -> Option<DeliveryOffer> {
        if self.selected_order.is_some() {
            self.current_phase = OrderPhase::RouteToCustomer;
            self.selected_order.clone()
        } else {
            None
        }
    }

    pub fn reach_customer(&mut self) -> Option<DeliveryOffer> {
        if self.selected_order.is_some() {
            self.current_phase = OrderPhase::AtCustomer;
            self.selected_order.clone()
        } else {
            None
        }
    }

    pub fn complete_delivery(&mut self) -> Option<DeliveryOffer> {
        if let Some(order) = self.selected_order.take() {
            self.current_phase = OrderPhase::Delivered;
            // Re-seed 4 fresh delivery gigs
            self.seed_kolkata_offers();
            Some(order)
        } else {
            None
        }
    }

    pub fn dismiss_offer(&mut self, order_id: &str) {
        self.active_offers.retain(|o| o.order_id != order_id);
        if self.active_offers.is_empty() {
            self.seed_kolkata_offers();
        }
    }
}
