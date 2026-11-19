// ponytail: autonomous browser fallback when running standalone on Vercel or web without backend
(function() {
    if (window.__TAURI__ || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        // If native Tauri or running locally with Python server, don't interfere
        return;
    }

    // Default fallback rider coords (Central Kolkata) if geolocation permission is pending or denied
    let state = {
        phase: "IDLE",
        selected_order: null,
        active_offers: [],
        earnings: 570.26,
        target: 800,
        speed: 0,
        lat: 22.5520,
        lng: 88.3610,
        heading: 48.0,
        geo_initialized: false
    };

    // Helper: generate realistic demo trial orders relative to the rider's actual coordinates
    function generateTrialOffers(riderLat, riderLng) {
        const platforms = [
            { name: "Zomato", color: "#E23744", icon: "zomato", storePrefix: "Bawarchi / Biryani Hub" },
            { name: "Swiggy", color: "#FC8019", icon: "swiggy", storePrefix: "Kolkata Kitchen & Cafe" },
            { name: "Zepto", color: "#7C4DFF", icon: "zepto", storePrefix: "Zepto Dark Store Express" },
            { name: "Blinkit", color: "#F7D046", icon: "blinkit", storePrefix: "Blinkit 10-Min Hub" }
        ];

        // Store offsets (~400m to 1.2km) and Customer drop offsets (~1.2km to 3.5km)
        const offsets = [
            { sLat: 0.0045, sLng: 0.0035, cLat: -0.0080, cLng: 0.0070, sDist: 0.9, dDist: 2.1, pay: 85, ord: 540, mode: "COD", items: "2x Chicken Biryani • 1x Thums Up", cust: "Rahul Sen", addr: "Flat 4B, Silver Oak Residency" },
            { sLat: -0.0050, sLng: 0.0040, cLat: -0.0120, cLng: -0.0060, sDist: 1.4, dDist: 3.2, pay: 110, ord: 890, mode: "PREPAID", items: "1x Special Paneer Thali • 2x Garlic Naan", cust: "Pooja Banerjee", addr: "12/1 Lake View Apartment" },
            { sLat: 0.0030, sLng: -0.0045, cLat: 0.0085, cLng: -0.0090, sDist: 0.7, dDist: 1.6, pay: 65, ord: 320, mode: "COD", items: "Grocery Essentials • 4 items", cust: "Ankit Sharma", addr: "Block C, Metro Enclave" },
            { sLat: -0.0040, sLng: -0.0030, cLat: 0.0060, cLng: 0.0080, sDist: 1.1, dDist: 2.8, pay: 95, ord: 760, mode: "PREPAID", items: "1x Cold Coffee • 1x Grilled Sandwich", cust: "Ria Mukherjee", addr: "Tower 2, Urbana Heights" }
        ];

        return platforms.map((p, idx) => {
            const o = offsets[idx];
            return {
                order_id: `ORD-${p.name.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
                platform: p.name.toLowerCase(),
                platform_color: p.color,
                store_name: `${p.storePrefix} #${idx + 101}`,
                store_address: `Store Point ${idx + 1}, Sector ${idx + 2}`,
                store_lat: +(riderLat + o.sLat).toFixed(6),
                store_lng: +(riderLng + o.sLng).toFixed(6),
                customer_name: o.cust,
                customer_address: o.addr,
                customer_lat: +(riderLat + o.cLat).toFixed(6),
                customer_lng: +(riderLng + o.cLng).toFixed(6),
                items_summary: o.items,
                customer_instructions: "Call on arrival, leave with security if unreachable",
                pickup_distance_km: o.sDist,
                drop_distance_km: o.dDist,
                store_dist_km: o.sDist,
                drop_dist_km: o.dDist,
                total_dist_km: +(o.sDist + o.dDist).toFixed(1),
                payout_inr: o.pay,
                order_amount_inr: o.ord,
                payment_mode: o.mode,
                delivery_otp: String(Math.floor(1000 + Math.random() * 9000))
            };
        });
    }

    // Native browser Geolocation API: fetch rider's true physical position
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.lat = pos.coords.latitude;
                state.lng = pos.coords.longitude;
                state.geo_initialized = true;
                state.active_offers = generateTrialOffers(state.lat, state.lng);
                console.log(`[GEO] Acquired user exact location: ${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`);
            },
            (err) => {
                console.warn("[GEO] Permission denied or unavailable, using fallback center:", err.message);
                state.active_offers = generateTrialOffers(state.lat, state.lng);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );

        // Continuous watch if moving
        navigator.geolocation.watchPosition(
            (pos) => {
                if (state.phase === "IDLE" || !state.selected_order) {
                    state.lat = pos.coords.latitude;
                    state.lng = pos.coords.longitude;
                    state.speed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
                    if (pos.coords.heading != null && !isNaN(pos.coords.heading)) {
                        state.heading = pos.coords.heading;
                    }
                }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    } else {
        state.active_offers = generateTrialOffers(state.lat, state.lng);
    }

    // Smooth delivery simulation when an active order is in progress
    setInterval(() => {
        if (!state.selected_order) {
            state.speed = 0;
            return;
        }

        // Active transit: simulate vehicle heading towards the target step
        let targetLat = state.selected_order.store_lat;
        let targetLng = state.selected_order.store_lng;

        if (state.phase === "ROUTE_TO_CUSTOMER" || state.phase === "ROUTETOCUSTOMER") {
            targetLat = state.selected_order.customer_lat;
            targetLng = state.selected_order.customer_lng;
        } else if (state.phase === "AT_STORE" || state.phase === "ATSTORE" || state.phase === "AT_CUSTOMER" || state.phase === "ATCUSTOMER") {
            // Stationary at stop
            state.speed = 0;
            return;
        }

        const dLat = targetLat - state.lat;
        const dLng = targetLng - state.lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (dist > 0.0003) {
            state.speed = 34 + Math.sin(Date.now() / 2000) * 4;
            const step = 0.000045; // Smooth progression
            state.lat += (dLat / dist) * step;
            state.lng += (dLng / dist) * step;
            state.heading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
        } else {
            state.speed = 0;
        }
    }, 250);

    function computeRouteLine(fromLat, fromLng, toLat, toLng) {
        if (!toLat || !toLng) return [];
        return [
            [fromLat, fromLng],
            [fromLat + (toLat - fromLat) * 0.35 + 0.0005, fromLng + (toLng - fromLng) * 0.35 - 0.0004],
            [fromLat + (toLat - fromLat) * 0.70 - 0.0004, fromLng + (toLng - fromLng) * 0.70 + 0.0005],
            [toLat, toLng]
        ];
    }

    const origFetch = window.fetch;
    window.fetch = async function(url, opts = {}) {
        const u = typeof url === "string" ? url : (url.url || "");
        const m = (opts.method || "GET").toUpperCase();

        // 1. Telemetry
        if (u.includes("/api/telemetry")) {
            let activePolyline = [];
            let navInstruction = "Scanning for nearby gigs...";

            if (state.selected_order) {
                if (state.phase === "ROUTE_TO_STORE" || state.phase === "ROUTETOSTORE") {
                    const destLat = state.selected_order.store_lat;
                    const destLng = state.selected_order.store_lng;
                    activePolyline = computeRouteLine(state.lat, state.lng, destLat, destLng);
                    navInstruction = `Step 1: Head to ${state.selected_order.store_name} (Pickup)`;
                } else if (state.phase === "AT_STORE" || state.phase === "ATSTORE") {
                    navInstruction = `Step 2: Collect & verify package at ${state.selected_order.store_name}`;
                } else if (state.phase === "ROUTE_TO_CUSTOMER" || state.phase === "ROUTETOCUSTOMER") {
                    const destLat = state.selected_order.customer_lat;
                    const destLng = state.selected_order.customer_lng;
                    activePolyline = computeRouteLine(state.lat, state.lng, destLat, destLng);
                    navInstruction = `Step 3: Head to ${state.selected_order.customer_name} (Drop-off)`;
                } else if (state.phase === "AT_CUSTOMER" || state.phase === "ATCUSTOMER") {
                    navInstruction = `Step 4: Verify 4-digit OTP handover with customer`;
                }
            }

            if (state.active_offers.length === 0 && !state.selected_order) {
                state.active_offers = generateTrialOffers(state.lat, state.lng);
            }

            return new Response(JSON.stringify({
                timestamp: Date.now() / 1000,
                gps: {
                    latitude: state.lat,
                    longitude: state.lng,
                    speed_kmh: state.speed,
                    heading: state.heading,
                    altitude_m: 9.0,
                    accuracy_m: 2.5
                },
                navigation: {
                    instruction: navInstruction,
                    maneuver: "straight",
                    distance_m: state.selected_order ? 450 : 0,
                    duration_s: state.selected_order ? 60 : 0,
                    route_polyline: activePolyline,
                    traffic_segments: []
                },
                order_phase: state.phase,
                selected_order: state.selected_order,
                active_offers: state.active_offers,
                earnings_today_inr: state.earnings,
                daily_target: state.target,
                is_emergency: false,
                emergency_reason: null
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // 2. Rider profile
        if (u.includes("/api/rider/profile")) {
            return new Response(JSON.stringify({
                name: "Debanjan Mondal",
                vehicle_no: "WB 02 AB 4591",
                phone: "+91 98765 43210",
                daily_target_inr: state.target,
                daily_target_orders: 14
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // 3. Auth config
        if (u.includes("/api/auth/config")) {
            return new Response(JSON.stringify(window.FIREBASE_CONFIG || {}), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // 4. Feed actions: Step-by-Step Delivery Lifecycle (Zomato / Swiggy flow)
        if (u.includes("/api/feed/accept")) {
            let body = {};
            try { body = JSON.parse(opts.body); } catch(e) {}
            const ord = state.active_offers.find(o => o.order_id === body.order_id) || state.active_offers[0];
            state.selected_order = ord;
            state.phase = "ROUTE_TO_STORE";
            state.active_offers = state.active_offers.filter(o => o.order_id !== ord.order_id);
            return new Response(JSON.stringify({ success: true, order: ord }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/reach-store")) {
            state.phase = "AT_STORE";
            return new Response(JSON.stringify({ success: true, order: state.selected_order }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/pickup")) {
            state.phase = "ROUTE_TO_CUSTOMER";
            return new Response(JSON.stringify({ success: true, order: state.selected_order }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/reach-customer")) {
            state.phase = "AT_CUSTOMER";
            return new Response(JSON.stringify({ success: true, order: state.selected_order }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/deliver")) {
            const finished = state.selected_order;
            if (finished) state.earnings += (finished.payout_inr || 85);
            state.phase = "DELIVERED";
            state.selected_order = null;
            setTimeout(() => {
                state.phase = "IDLE";
                if (state.active_offers.length === 0) {
                    state.active_offers = generateTrialOffers(state.lat, state.lng);
                }
            }, 3000);
            return new Response(JSON.stringify({ success: true, result: { delivered: true } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/infiltrate")) {
            const newOrd = generateTrialOffers(state.lat, state.lng)[0];
            newOrd.order_id = `ORD-LIVE-${Math.floor(1000 + Math.random() * 9000)}`;
            state.active_offers.unshift(newOrd);
            return new Response(JSON.stringify({ success: true, order: newOrd }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/dismiss")) {
            let body = {};
            try { body = JSON.parse(opts.body); } catch(e) {}
            state.active_offers = state.active_offers.filter(o => o.order_id !== body.order_id);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/refresh")) {
            state.active_offers = generateTrialOffers(state.lat, state.lng);
            return new Response(JSON.stringify({ snapshot: { active_offers: state.active_offers } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/payment/verify-instant")) {
            return new Response(JSON.stringify({ status: "SUCCESS" }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // Fallback to real network call for CDN maps/tiles/fonts
        return origFetch.apply(this, arguments);
    };
})();
