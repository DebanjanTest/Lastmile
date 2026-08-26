// ==============================================================================
// LastMile Guard - Multi-App Delivery Notification HUD & 2-Phase Routing Client
// ==============================================================================

let ws = null;
let audioCtx = null;
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let trafficPolylines = [];
let isMapInitialized = false;

// Maneuver SVG Icons (Google Maps Navigation Style)
const SVG_ICONS = {
    STRAIGHT: "M50 15 L75 45 L58 45 L58 85 L42 85 L42 45 L25 45 Z",
    TURN_RIGHT: "M25 80 L25 55 Q25 35 45 35 L60 35 L60 20 L85 45 L60 70 L60 55 L45 55 Q38 55 38 65 L38 80 Z",
    TURN_LEFT: "M75 80 L75 55 Q75 35 55 35 L40 35 L40 20 L15 45 L40 70 L40 55 L55 55 Q62 55 62 65 L62 80 Z",
    SLIGHT_RIGHT: "M30 80 L30 55 Q30 40 45 30 L65 18 L60 8 L88 22 L75 48 L68 38 L50 48 Q42 54 42 65 L42 80 Z",
    SLIGHT_LEFT: "M70 80 L70 55 Q70 40 55 30 L35 18 L40 8 L12 22 L25 48 L32 38 L50 48 Q58 54 58 65 L58 80 Z",
    ROUNDABOUT: "M50 20 A30 30 0 1 1 49.9 20 M50 10 L65 25 L50 40 Z",
    DESTINATION: "M35 15 L35 85 M35 15 L75 35 L35 55 Z",
    UTURN: "M30 80 L30 45 Q30 20 50 20 Q70 20 70 45 L70 80 L80 80 L60 95 L40 80 L52 80 L52 45 Q52 35 50 35 Q48 35 48 45 L48 80 Z"
};

function playAudioChime(freq = 880, duration = 0.12) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
}

function initMap(initialLat = 22.5726, initialLng = 88.3639) {
    if (isMapInitialized || typeof L === 'undefined') return;

    try {
        const mapEl = document.getElementById('mapView');
        if (!mapEl) return;

        mapInstance = L.map('mapView', {
            center: [initialLat, initialLng],
            zoom: 16,
            zoomControl: false,
            attributionControl: false
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(mapInstance);

        const riderIcon = L.divIcon({
            className: 'rider-puck-container',
            html: `<div id="riderPuck" style="width:36px;height:36px;background:#1A73E8;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 16px #1A73E8;display:flex;align-items:center;justify-content:center;transform:rotate(45deg);"><svg width="20" height="20" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFF"/></svg></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        riderMarker = L.marker([initialLat, initialLng], { icon: riderIcon }).addTo(mapInstance);

        const destIcon = L.divIcon({
            className: 'dest-pin-container',
            html: `<div id="destPinIcon" style="font-size:30px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));">🏁</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 28]
        });

        destMarker = L.marker([22.5855, 88.4168], { icon: destIcon }).addTo(mapInstance);
        isMapInitialized = true;
    } catch (e) {
        console.warn("[MAP INIT]", e);
    }
}

function initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
    
    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("[HUD WS] Connected to LastMile Engine.");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                updateHUD(data);
            } catch (err) {
                console.error("[HUD ERROR] Failed to parse telemetry:", err);
            }
        };

        ws.onclose = () => {
            setTimeout(initWebSocket, 1500);
        };
    } catch (e) {
        console.error("[WS CONNECT ERROR]", e);
    }
}

function updateHUD(data) {
    if (!data) return;

    // 1. GPS Telemetry & Vehicle Puck
    if (data.gps) {
        const gps = data.gps;
        const spdEl = document.getElementById("speedNum");
        if (spdEl) spdEl.textContent = Math.round(gps.speed_kmh);

        if (!isMapInitialized) {
            initMap(gps.latitude, gps.longitude);
        }

        if (mapInstance && riderMarker) {
            riderMarker.setLatLng([gps.latitude, gps.longitude]);
            mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.25 });
            
            const puckEl = document.getElementById("riderPuck");
            if (puckEl) {
                puckEl.style.transform = `rotate(${gps.heading_deg}deg)`;
            }
        }
    }

    // 2. Navigation Turn Card & Traffic Polyline (Shown during active phases)
    if (data.navigation) {
        const nav = data.navigation;
        const turnCard = document.getElementById("turnCard");
        const orderPhase = data.order_phase;

        if (orderPhase && orderPhase !== "IDLE" && orderPhase !== "DELIVERED") {
            if (turnCard) turnCard.style.display = "flex";
            const distEl = document.getElementById("turnDistNum");
            if (distEl) distEl.textContent = nav.distance_to_turn_m;
            const roadEl = document.getElementById("turnRoadName");
            if (roadEl) roadEl.textContent = nav.road_name;
            const prevEl = document.getElementById("turnNextPreview");
            if (prevEl) prevEl.textContent = `Then: ${nav.next_instruction}`;

            const trafficBadge = document.getElementById("trafficConditionBadge");
            if (trafficBadge) {
                if (nav.current_traffic_status === "HEAVY_JAM") {
                    trafficBadge.textContent = "🔴 Heavy Jam";
                    trafficBadge.style.backgroundColor = "#FF1744";
                } else if (nav.current_traffic_status === "MODERATE") {
                    trafficBadge.textContent = "🟠 Moderate";
                    trafficBadge.style.backgroundColor = "#FF9100";
                } else {
                    trafficBadge.textContent = "🟢 Flowing";
                    trafficBadge.style.backgroundColor = "#00E676";
                }
            }

            const pathData = SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT;
            const turnPathEl = document.getElementById("turnPath");
            if (turnPathEl) turnPathEl.setAttribute("d", pathData);
        } else {
            if (turnCard) turnCard.style.display = "none";
        }

        // Bottom Trip Summary
        const timeEl = document.getElementById("tripTimeVal");
        if (timeEl) timeEl.textContent = `${nav.eta_minutes} min`;
        const tDistEl = document.getElementById("tripDistVal");
        if (tDistEl) tDistEl.textContent = `${nav.remaining_total_dist_km} km`;
        const dNameEl = document.getElementById("destName");
        if (dNameEl) dNameEl.textContent = nav.destination_name;

        const delayEl = document.getElementById("trafficDelayText");
        if (delayEl) {
            if (nav.traffic_delay_minutes > 0) {
                delayEl.textContent = `+${nav.traffic_delay_minutes} min delay`;
                delayEl.style.color = "#FF1744";
            } else {
                delayEl.textContent = "Fastest route";
                delayEl.style.color = "#00E676";
            }
        }

        const arrival = new Date(Date.now() + nav.eta_minutes * 60000);
        const etaEl = document.getElementById("tripEtaVal");
        if (etaEl) etaEl.textContent = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (mapInstance && nav.route_polyline && nav.traffic_segments) {
            renderTrafficPolyline(nav.route_polyline, nav.traffic_segments);
        }

        if (destMarker && nav.destination_coords) {
            destMarker.setLatLng([nav.destination_coords.lat, nav.destination_coords.lng]);
        }
    }

    // 3. Top-Right Multi-App Pop-up Notification Stack
    renderNotificationStack(data.active_offers, data.order_phase);

    // 4. Active 2-Phase Routing Banner & Transitions
    renderActiveRouteBanner(data.selected_order, data.order_phase);

    // 5. Emergency SOS Overlay
    const emerg = document.getElementById("emergencyOverlay");
    if (emerg) {
        if (data.is_emergency) {
            emerg.style.display = "flex";
            const titleEl = document.getElementById("emergencyTitle");
            if (titleEl) titleEl.textContent = data.emergency_reason || "EMERGENCY SOS ACTIVE";
            const gpsEl = document.getElementById("emergencyGps");
            if (gpsEl && data.gps) {
                gpsEl.textContent = `GPS: ${data.gps.latitude.toFixed(6)}, ${data.gps.longitude.toFixed(6)} | Speed: ${data.gps.speed_kmh} km/h`;
            }
        } else {
            emerg.style.display = "none";
        }
    }
}

function renderNotificationStack(offers, orderPhase) {
    const stackEl = document.getElementById("orderNotificationStack");
    if (!stackEl) return;

    // Only display incoming notifications when Idle or Delivered (not during active transit)
    if (orderPhase && orderPhase !== "IDLE" && orderPhase !== "DELIVERED") {
        stackEl.innerHTML = "";
        return;
    }

    if (!offers || offers.length === 0) {
        stackEl.innerHTML = `
            <div class="notification-card" style="border-left-color:#38BDF8;background:rgba(15,23,42,0.9);">
                <div style="font-size:11px;font-weight:800;color:#38BDF8;display:flex;align-items:center;gap:6px;">
                    <span style="font-size:14px;">🛰️</span> Scanning for incoming orders...
                </div>
            </div>
        `;
        return;
    }

    stackEl.innerHTML = offers.map(offer => `
        <div class="notification-card" style="border-left-color: ${offer.platform_color}">
            <div class="card-top-row">
                <span class="card-platform-badge" style="background: ${offer.platform_color}">
                    ${offer.platform.toUpperCase()}
                </span>
                <span class="card-payout">₹${offer.payout_inr.toFixed(2)}</span>
            </div>

            <div class="card-store-row">
                <span>🏪</span>
                <div>
                    <strong>${offer.store_name}</strong>
                    <small style="display:block;color:#94A3B8;font-size:10px;">${offer.items_summary}</small>
                </div>
                <span class="card-dist-pill">${offer.store_dist_km} km away</span>
            </div>

            <div class="card-drop-row">
                <span>🏠</span>
                <span>${offer.customer_address} (${offer.drop_dist_km} km drop)</span>
            </div>

            <div class="card-actions-row">
                <span class="total-dist-tag">📍 ${offer.total_dist_km} km total</span>
                <div class="card-buttons">
                    <button class="btn-card-dismiss" onclick="dismissOffer('${offer.order_id}')">✕ Dismiss</button>
                    <button class="btn-card-accept" onclick="acceptSpecificOrder('${offer.order_id}')">✅ Opt In</button>
                </div>
            </div>
        </div>
    `).join("");
}

function renderActiveRouteBanner(order, orderPhase) {
    const banner = document.getElementById("activeRouteBanner");
    const badge = document.getElementById("routePhaseBadge");
    const title = document.getElementById("routeTargetTitle");
    const sub = document.getElementById("routeTargetSub");
    const actions = document.getElementById("routeActions");
    const destHeader = document.getElementById("destHeaderLabel");

    if (!order || orderPhase === "IDLE" || orderPhase === "DELIVERED") {
        if (banner) banner.style.display = "none";
        if (destHeader) destHeader.textContent = "TARGET DESTINATION:";
        return;
    }

    if (banner) banner.style.display = "flex";

    // PHASE 1: Route to Shop
    if (orderPhase === "ROUTE_TO_STORE") {
        badge.textContent = "📍 PHASE 1: ROUTE TO STORE";
        badge.style.color = "#FC8019";
        title.textContent = order.store_name;
        sub.textContent = `${order.store_address} (${order.store_dist_km} km travel distance from current location)`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="reachStore()" style="background:#F59E0B;">🏪 REACHED STORE [R]</button>
        `;
        if (destHeader) destHeader.textContent = "SHOP PICKUP:";
    }
    // PHASE 1.5: At Shop
    else if (orderPhase === "AT_STORE") {
        badge.textContent = "🏪 AT SHOP: PACKING & PREP";
        badge.style.color = "#00B0FF";
        title.textContent = `Pick up: ${order.items_summary}`;
        sub.textContent = `Match Order Token #${order.order_id} at ${order.store_name}`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="confirmPickup()" style="background:#00B0FF;">🍴 FOOD PICKED UP [K]</button>
        `;
        if (destHeader) destHeader.textContent = "SHOP PICKUP:";
    }
    // PHASE 2: Route to Customer
    else if (orderPhase === "ROUTE_TO_CUSTOMER") {
        badge.textContent = "📦 PHASE 2: ROUTE TO CUSTOMER";
        badge.style.color = "#00E676";
        title.textContent = `${order.customer_name} • ${order.customer_address}`;
        sub.textContent = `${order.customer_instructions} (${order.drop_dist_km} km drop distance)`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="completeDelivery()" style="background:#7C4DFF;color:#FFF;">✅ COMPLETE DELIVERY [U]</button>
        `;
        if (destHeader) destHeader.textContent = "CUSTOMER DROP:";
    }
}

function showDeliveryCelebration(payout = 85.0) {
    const toast = document.getElementById("deliveredToast");
    if (!toast) return;
    document.getElementById("toastPayoutText").textContent = `+₹${payout.toFixed(2)} Credited to Rider Wallet`;
    toast.style.display = "flex";
    playAudioChime(1200, 0.3);
    setTimeout(() => {
        toast.style.display = "none";
    }, 4000);
}

function renderTrafficPolyline(polyline, trafficSegments) {
    if (!mapInstance) return;
    trafficPolylines.forEach(p => {
        try { mapInstance.removeLayer(p); } catch (e) {}
    });
    trafficPolylines = [];

    if (!trafficSegments || trafficSegments.length === 0) {
        const poly = L.polyline(polyline, { color: '#1A73E8', weight: 7, opacity: 0.9 }).addTo(mapInstance);
        trafficPolylines.push(poly);
        return;
    }

    trafficSegments.forEach(seg => {
        const pts = polyline.slice(seg.start_idx, seg.end_idx + 1);
        if (pts.length >= 2) {
            const line = L.polyline(pts, {
                color: seg.color,
                weight: 7,
                opacity: 0.92,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(mapInstance);
            trafficPolylines.push(line);
        }
    });
}

// Dispatches commands via WebSocket and HTTP REST with immediate state update
async function sendCommand(cmdObj) {
    playAudioChime(850, 0.08);
    console.log("[FEED ACTION]", cmdObj);
    
    // 1. Try WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
    
    // 2. Immediate REST Endpoint Call
    try {
        const act = cmdObj.action;
        let url = null;
        let body = null;

        if (act === "refresh_orders") url = '/api/feed/refresh';
        else if (act === "accept_order") {
            url = '/api/feed/accept';
            body = JSON.stringify({ order_id: cmdObj.order_id || "" });
        }
        else if (act === "reach_store") url = '/api/feed/reach-store';
        else if (act === "pickup_order") url = '/api/feed/pickup';
        else if (act === "reach_customer") url = '/api/feed/reach-customer';
        else if (act === "complete_delivery") url = '/api/feed/deliver';
        else if (act === "dismiss_offer") {
            url = '/api/feed/dismiss';
            body = JSON.stringify({ order_id: cmdObj.order_id || "" });
        }
        else if (act === "trigger_sos") url = '/api/test/sos';
        else if (act === "trigger_tilt") url = '/api/test/tilt';

        if (url) {
            const res = await fetch(url, {
                method: 'POST',
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body
            });
            const jsonRes = await res.json();
            if (jsonRes && jsonRes.snapshot) {
                updateHUD(jsonRes.snapshot);
            }
            if (act === "complete_delivery" && jsonRes && jsonRes.result && jsonRes.result.success) {
                showDeliveryCelebration(jsonRes.result.payout);
            }
        }
    } catch (err) {
        console.warn("[REST DISPATCH]", err);
    }
}

// Public action bindings
function refreshOrders() {
    sendCommand({ action: "refresh_orders" });
}

function acceptSpecificOrder(orderId) {
    sendCommand({ action: "accept_order", order_id: orderId });
}

function acceptTopOrder() {
    sendCommand({ action: "accept_order", order_id: "" });
}

function dismissOffer(orderId) {
    sendCommand({ action: "dismiss_offer", order_id: orderId });
}

function reachStore() {
    sendCommand({ action: "reach_store" });
}

function confirmPickup() {
    sendCommand({ action: "pickup_order" });
}

function reachCustomer() {
    sendCommand({ action: "reach_customer" });
}

function completeDelivery() {
    sendCommand({ action: "complete_delivery" });
}

function triggerSos() {
    sendCommand({ action: "trigger_sos" });
}

function triggerTilt() {
    sendCommand({ action: "trigger_tilt" });
}

function resetEmergency() {
    sendCommand({ action: "reset_emergency" });
}

function toggleDashcam() {
    const pip = document.getElementById("dashcamPip");
    if (pip) pip.style.display = pip.style.display === "none" ? "block" : "none";
}

// Global Keyboard Shortcuts
document.addEventListener("keydown", (e) => {
    const key = e.key.toUpperCase();
    if (key === "O") refreshOrders();
    else if (key === "A") acceptTopOrder();
    else if (key === "R") reachStore();
    else if (key === "K") confirmPickup();
    else if (key === "C") reachCustomer();
    else if (key === "U") completeDelivery();
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (key === "D") toggleDashcam();
    else if (key === "ESCAPE") resetEmergency();
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    initMap(22.572645, 88.363892);
    initWebSocket();
});
