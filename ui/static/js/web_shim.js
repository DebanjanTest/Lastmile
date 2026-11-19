// ponytail: autonomous browser fallback when running standalone on Vercel or web without backend
(function() {
    if (window.__TAURI__ || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        // If native Tauri or running locally with Python server, don't interfere
        return;
    }

    const testOffers = [
        {
            order_id: "ORD-9021",
            platform: "zomato",
            platform_color: "#E23744",
            store_name: "Arsalan Biryani - Park Circus",
            store_address: "139 Park Circus Connector, Kolkata",
            store_lat: 22.5435,
            store_lng: 88.3685,
            customer_name: "Rahul Sen",
            customer_address: "Flat 4B, Silver Oak, Ballygunge Circular Rd",
            customer_lat: 22.5280,
            customer_lng: 88.3650,
            items_summary: "2x Mutton Biryani, 1x Firni",
            customer_instructions: "Call from gate, don't ring bell",
            pickup_distance_km: 1.2,
            drop_distance_km: 3.4,
            payout_inr: 85.00,
            order_amount_inr: 640.00,
            payment_mode: "COD"
        },
        {
            order_id: "ORD-8812",
            platform: "swiggy",
            platform_color: "#FC8019",
            store_name: "Kewpies Kitchen - Elgin",
            store_address: "2 Elgin Lane, Elgin Rd, Kolkata",
            store_lat: 22.5385,
            store_lng: 88.3510,
            customer_name: "Pooja Banerjee",
            customer_address: "12/1 Gariahat Road, Kolkata",
            customer_lat: 22.5190,
            customer_lng: 88.3690,
            items_summary: "1x Bengali Thali, 1x Kosha Mangsho",
            customer_instructions: "Leave with security if not reachable",
            pickup_distance_km: 2.1,
            drop_distance_km: 4.8,
            payout_inr: 110.00,
            order_amount_inr: 920.00,
            payment_mode: "PREPAID"
        },
        {
            order_id: "ORD-7634",
            platform: "zepto",
            platform_color: "#7C4DFF",
            store_name: "Zepto Dark Store - Rashbehari",
            store_address: "Hub 4, Rashbehari Ave, Kolkata",
            store_lat: 22.5180,
            store_lng: 88.3580,
            customer_name: "Ankit Sharma",
            customer_address: "P-45 Lake Terrace, Southern Ave",
            customer_lat: 22.5110,
            customer_lng: 88.3595,
            items_summary: "Grocery bag • 5 items",
            customer_instructions: "Deliver to 2nd floor, lift available",
            pickup_distance_km: 0.8,
            drop_distance_km: 1.6,
            payout_inr: 65.00,
            order_amount_inr: 380.00,
            payment_mode: "COD"
        },
        {
            order_id: "ORD-5541",
            platform: "blinkit",
            platform_color: "#F7D046",
            store_name: "Blinkit Micro-Fulfillment 09",
            store_address: "Industrial Estate, Topsia Rd, Kolkata",
            store_lat: 22.5400,
            store_lng: 88.3900,
            customer_name: "Ria Mukherjee",
            customer_address: "Tower 2, Urbana Complex, Anandapur",
            customer_lat: 22.5200,
            customer_lng: 88.4050,
            items_summary: "Quick essentials • 8 items",
            customer_instructions: "Gate security will verify OTP",
            pickup_distance_km: 1.5,
            drop_distance_km: 5.2,
            payout_inr: 135.00,
            order_amount_inr: 1250.00,
            payment_mode: "PREPAID"
        }
    ];

    let state = {
        phase: "IDLE",
        selected_order: null,
        active_offers: [...testOffers],
        earnings: 570.26,
        target: 800,
        speed: 36.5,
        lat: 22.5520,
        lng: 88.3610,
        heading: 48.0
    };

    // Synthetic GPS track loop around Kolkata central corridor
    setInterval(() => {
        state.speed = 32 + Math.sin(Date.now() / 2500) * 8;
        state.lat += 0.00004 * Math.cos(state.heading * Math.PI / 180);
        state.lng += 0.00004 * Math.sin(state.heading * Math.PI / 180);
        // keep within central Kolkata bounds
        if (state.lat > 22.585) state.lat = 22.535;
        if (state.lng > 88.385) state.lng = 88.345;
    }, 200);

    function computeRouteLine(fromLat, fromLng, toLat, toLng) {
        if (!toLat || !toLng) return [];
        return [
            [fromLat, fromLng],
            [fromLat + (toLat - fromLat) * 0.35 + 0.0008, fromLng + (toLng - fromLng) * 0.35 - 0.0005],
            [fromLat + (toLat - fromLat) * 0.70 - 0.0005, fromLng + (toLng - fromLng) * 0.70 + 0.0008],
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
            let destLat = null;
            let destLng = null;
            let navInstruction = "Searching for nearby gigs...";

            if (state.selected_order) {
                if (state.phase === "ROUTE_TO_STORE" || state.phase === "ROUTETOSTORE") {
                    destLat = state.selected_order.store_lat;
                    destLng = state.selected_order.store_lng;
                    activePolyline = computeRouteLine(state.lat, state.lng, destLat, destLng);
                    navInstruction = `Head to ${state.selected_order.store_name} (Pickup)`;
                } else if (state.phase === "AT_STORE" || state.phase === "ATSTORE") {
                    navInstruction = `Collect package at ${state.selected_order.store_name}`;
                } else if (state.phase === "ROUTE_TO_CUSTOMER" || state.phase === "ROUTETOCUSTOMER") {
                    destLat = state.selected_order.customer_lat;
                    destLng = state.selected_order.customer_lng;
                    activePolyline = computeRouteLine(state.lat, state.lng, destLat, destLng);
                    navInstruction = `Deliver to ${state.selected_order.customer_name}`;
                } else if (state.phase === "AT_CUSTOMER" || state.phase === "ATCUSTOMER") {
                    navInstruction = `Verify OTP with ${state.selected_order.customer_name}`;
                }
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
                    distance_m: 450,
                    duration_s: 60,
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

        // 4. Feed actions
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
            if (finished) state.earnings += (finished.payout_inr || 80);
            state.phase = "DELIVERED";
            state.selected_order = null;
            setTimeout(() => {
                state.phase = "IDLE";
                if (state.active_offers.length === 0) state.active_offers = [...testOffers];
            }, 3000);
            return new Response(JSON.stringify({ success: true, result: { delivered: true } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/dismiss")) {
            let body = {};
            try { body = JSON.parse(opts.body); } catch(e) {}
            state.active_offers = state.active_offers.filter(o => o.order_id !== body.order_id);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (u.includes("/api/feed/refresh")) {
            state.active_offers = [...testOffers];
            return new Response(JSON.stringify({ snapshot: { active_offers: state.active_offers } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // Fallback to real network call for CDN maps/tiles/fonts
        return origFetch.apply(this, arguments);
    };
})();
