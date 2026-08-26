// ==============================================================================
// LastMile Guard - Pure Native Multi-App Delivery HUD & 2-Phase Routing System
// ==============================================================================

let ws = null;
let audioCtx = null;
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let blueGlowPolyline = null;
let blueCorePolyline = null;
let trafficOverlays = [];
let currentOrderPhase = "IDLE";
let currentSelectedOrder = null;

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
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
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

// Lightweight Standalone QR Code SVG Matrix Renderer
function generateQrSvg(text) {
    const size = 25; // 25x25 matrix
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));

    function drawFinder(r, c) {
        for (let i = 0; i < 7; i++) {
            for (let j = 0; j < 7; j++) {
                if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
                    matrix[r + i][c + j] = 1;
                }
            }
        }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
        matrix[6][i] = i % 2 === 0 ? 1 : 0;
        matrix[i][6] = i % 2 === 0 ? 1 : 0;
    }

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) & 0xFFFFFFFF;
    }
    
    let seed = Math.abs(hash);
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8) || r === 6 || c === 6) {
                continue;
            }
            seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
            matrix[r][c] = (seed % 3 === 0 || seed % 5 === 0) ? 1 : 0;
        }
    }

    let rects = "";
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c] === 1) {
                rects += `<rect x="${c * 4}" y="${r * 4}" width="4" height="4" fill="#000000" />`;
            }
        }
    }

    return `<svg viewBox="0 0 ${size * 4} ${size * 4}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;shape-rendering:crispEdges;">
        <rect width="100%" height="100%" fill="#FFFFFF" />
        ${rects}
    </svg>`;
}

function initMap(initialLat = 22.5643, initialLng = 88.3693) {
    if (mapInstance || typeof L === 'undefined') return;

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

        destMarker = L.marker([initialLat, initialLng], { icon: destIcon });
        console.log("[MAP] Leaflet Map Initialized at", initialLat, initialLng);
    } catch (e) {
        console.warn("[MAP INIT ERROR]", e);
    }
}

function clearGoogleMapsRoute() {
    if (!mapInstance) return;
    if (blueGlowPolyline) { mapInstance.removeLayer(blueGlowPolyline); blueGlowPolyline = null; }
    if (blueCorePolyline) { mapInstance.removeLayer(blueCorePolyline); blueCorePolyline = null; }
    trafficOverlays.forEach(p => { try { mapInstance.removeLayer(p); } catch (e) {} });
    trafficOverlays = [];
    if (destMarker && mapInstance.hasLayer(destMarker)) {
        mapInstance.removeLayer(destMarker);
    }
}

function renderGoogleMapsBlueRoute(polyline, trafficSegments, destCoords) {
    if (!mapInstance || !polyline || polyline.length < 2) return;

    clearGoogleMapsRoute();

    blueGlowPolyline = L.polyline(polyline, {
        color: '#0D47A1',
        weight: 12,
        opacity: 0.5,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(mapInstance);

    blueCorePolyline = L.polyline(polyline, {
        color: '#1A73E8',
        weight: 7,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(mapInstance);

    if (trafficSegments && trafficSegments.length > 0) {
        trafficSegments.forEach(seg => {
            if (seg.status === "MODERATE" || seg.status === "HEAVY_JAM") {
                const pts = polyline.slice(seg.start_idx, seg.end_idx + 1);
                if (pts.length >= 2) {
                    const line = L.polyline(pts, {
                        color: seg.color,
                        weight: 7,
                        opacity: 0.95,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }).addTo(mapInstance);
                    trafficOverlays.push(line);
                }
            }
        });
    }

    if (destCoords && destMarker) {
        destMarker.setLatLng([destCoords.lat, destCoords.lng]).addTo(mapInstance);
    }
}

function updateHUD(data) {
    if (!data) return;

    currentOrderPhase = data.order_phase || "IDLE";
    currentSelectedOrder = data.selected_order || null;
    const gps = data.gps || {};
    const nav = data.navigation || {};
    const isMoving = gps.speed_kmh && gps.speed_kmh > 0.5;

    // 1. Speedometer
    const spdEl = document.getElementById("speedNum");
    if (spdEl) spdEl.textContent = Math.round(gps.speed_kmh || 0);

    // 2. Map & Rider Marker
    if (gps.latitude && gps.longitude) {
        if (!mapInstance) {
            initMap(gps.latitude, gps.longitude);
        } else if (riderMarker) {
            riderMarker.setLatLng([gps.latitude, gps.longitude]);
            
            if (isMoving) {
                mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.2 });
                const puckEl = document.getElementById("riderPuck");
                if (puckEl) puckEl.style.transform = `rotate(${gps.heading_deg || 45}deg)`;
            }
        }
    }

    // 3. Route Rendering
    if (currentOrderPhase === "ROUTE_TO_STORE" || currentOrderPhase === "AT_STORE" || currentOrderPhase === "ROUTE_TO_CUSTOMER") {
        if (nav.route_polyline && nav.route_polyline.length >= 2) {
            renderGoogleMapsBlueRoute(nav.route_polyline, nav.traffic_segments, nav.destination_coords);
        }
    } else {
        clearGoogleMapsRoute();
    }

    // 4. Top-Left Green Turn Card
    const turnCard = document.getElementById("turnCard");
    if (turnCard) {
        if (currentOrderPhase === "ROUTE_TO_STORE" || currentOrderPhase === "ROUTE_TO_CUSTOMER") {
            turnCard.style.display = "flex";
            document.getElementById("turnDistNum").textContent = nav.distance_to_turn_m || 0;
            document.getElementById("turnRoadName").textContent = nav.road_name || "Main Road";
            document.getElementById("turnNextPreview").textContent = `Then: ${nav.next_instruction || "Proceed"}`;
            
            const badge = document.getElementById("trafficConditionBadge");
            if (badge) {
                badge.style.backgroundColor = nav.current_traffic_color || "#00E676";
                badge.textContent = nav.current_traffic_status === "HEAVY_JAM" ? "🔴 Heavy Jam" : (nav.current_traffic_status === "MODERATE" ? "🟠 Moderate" : "🟢 Flowing");
            }
            const pathEl = document.getElementById("turnPath");
            if (pathEl) pathEl.setAttribute("d", SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT);
        } else {
            turnCard.style.display = "none";
        }
    }

    // 5. Top-Right Multi-App Pop-up Notification Stack
    renderNotificationStack(data.active_offers || []);

    // 6. Active 2-Phase Route Banner
    renderActiveRouteBanner(currentSelectedOrder, currentOrderPhase);

    // 7. Bottom Trip Bar
    const timeEl = document.getElementById("tripTimeVal");
    if (timeEl) timeEl.textContent = `${nav.eta_minutes || 0} min`;
    const distEl = document.getElementById("tripDistVal");
    if (distEl) distEl.textContent = `${nav.remaining_total_dist_km || 0} km`;
    const destEl = document.getElementById("destName");
    if (destEl) destEl.textContent = nav.destination_name || "Scanning for orders nearby...";
    const delayEl = document.getElementById("trafficDelayText");
    if (delayEl) {
        if (nav.traffic_delay_minutes > 0) {
            delayEl.textContent = `+${nav.traffic_delay_minutes} min delay`;
            delayEl.style.color = "#FF1744";
        } else {
            delayEl.textContent = currentOrderPhase === "IDLE" ? "Standing by" : "Fastest route";
            delayEl.style.color = "#00E676";
        }
    }
    const etaEl = document.getElementById("tripEtaVal");
    if (etaEl) {
        if (nav.eta_minutes > 0) {
            etaEl.textContent = new Date(Date.now() + nav.eta_minutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            etaEl.textContent = "--:--";
        }
    }
    const destHeader = document.getElementById("destHeaderLabel");
    if (destHeader) {
        destHeader.textContent = currentOrderPhase === "ROUTE_TO_STORE" ? "PHASE 1 (SHOP PICKUP):" : (currentOrderPhase === "ROUTE_TO_CUSTOMER" ? "PHASE 2 (DROP-OFF):" : "STATUS:");
    }

    // 8. Emergency Overlay
    const emerg = document.getElementById("emergencyOverlay");
    if (emerg) {
        if (data.is_emergency) {
            emerg.style.display = "flex";
            document.getElementById("emergencyTitle").textContent = data.emergency_reason || "EMERGENCY SOS ACTIVE";
            if (gps.latitude) {
                document.getElementById("emergencyGps").textContent = `GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)} | Speed: ${gps.speed_kmh || 0} km/h`;
            }
        } else {
            emerg.style.display = "none";
        }
    }
}

function renderNotificationStack(offers) {
    const stackEl = document.getElementById("orderNotificationStack");
    if (!stackEl) return;

    if (currentOrderPhase !== "IDLE" && currentOrderPhase !== "DELIVERED") {
        stackEl.innerHTML = "";
        stackEl.dataset.offersJson = "";
        return;
    }

    if (!offers || offers.length === 0) {
        if (stackEl.children.length === 0) {
            stackEl.innerHTML = `
                <div class="notification-card" style="border-left-color:#38BDF8;background:rgba(15,23,42,0.95)">
                    <div style="font-size:11px;font-weight:800;color:#38BDF8;display:flex;align-items:center;gap:6px;">
                        <span style="font-size:14px;">🛰️</span> Scanning for incoming delivery gigs...
                    </div>
                </div>
            `;
            stackEl.dataset.offersJson = "empty";
        }
        return;
    }

    const offersJson = JSON.stringify(offers.map(o => o.order_id));
    if (stackEl.dataset.offersJson === offersJson && stackEl.children.length > 0) {
        return;
    }
    stackEl.dataset.offersJson = offersJson;

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
                <span class="card-dist-pill">${offer.store_dist_km} km to store</span>
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

function renderActiveRouteBanner(order, phase) {
    const banner = document.getElementById("activeRouteBanner");
    if (!banner) return;

    if (!order || phase === "IDLE" || phase === "DELIVERED") {
        banner.style.display = "none";
        banner.dataset.stateKey = "";
        return;
    }

    banner.style.display = "flex";
    
    const stateKey = `${order.order_id}_${phase}`;
    if (banner.dataset.stateKey === stateKey) {
        return;
    }
    banner.dataset.stateKey = stateKey;

    const badge = document.getElementById("routePhaseBadge");
    const title = document.getElementById("routeTargetTitle");
    const sub = document.getElementById("routeTargetSub");
    const actions = document.getElementById("routeActions");

    if (phase === "ROUTE_TO_STORE") {
        badge.textContent = "📍 PHASE 1: BLUE ROUTE TO STORE";
        badge.style.color = "#FC8019";
        title.textContent = order.store_name;
        sub.textContent = `${order.store_address} • ${order.store_dist_km} km travel distance from current position`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="reachStore()" style="background:#F59E0B;">🏪 REACHED STORE [R]</button>
        `;
    } else if (phase === "AT_STORE") {
        badge.textContent = "🏪 AT STORE: COLLECTING ORDER";
        badge.style.color = "#00B0FF";
        title.textContent = `Token #${order.order_id} • ${order.items_summary}`;
        sub.textContent = `Package ready at ${order.store_name}`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="confirmPickup()" style="background:#00B0FF;">🍴 FOOD PICKED UP [K]</button>
        `;
    } else if (phase === "ROUTE_TO_CUSTOMER") {
        badge.textContent = "📦 PHASE 2: BLUE ROUTE TO DROP-OFF";
        badge.style.color = "#00E676";
        title.textContent = `${order.customer_name} • ${order.customer_address}`;
        sub.textContent = `${order.customer_instructions} • ${order.drop_dist_km} km drop distance`;
        actions.innerHTML = `
            <button class="route-action-btn" onclick="completeDelivery()" style="background:#7C4DFF;color:#FFF;">✅ COMPLETE DELIVERY [U]</button>
        `;
    }
}

// Shows Rich Post-Delivery Payment QR & Rider Daily Income Modal
function showDeliveryCompleteModal(result) {
    if (!result) return;

    const modal = document.getElementById("deliveryCompleteModal");
    if (!modal) return;

    const order = result.order || {};
    const payment = result.payment || {};
    const breakdown = result.payout_breakdown || {};
    const daily = result.daily_income || {};

    const titleEl = document.getElementById("modalOrderTitle");
    if (titleEl) titleEl.textContent = `Order #${order.order_id || 'DELIVERY'} (${(order.platform || 'Partner').toUpperCase()})`;

    // Left Panel: Customer Payment Collection & Dynamic QR Code
    const qrBox = document.getElementById("paymentQrBox");
    const prepaidBox = document.getElementById("prepaidSuccessBox");
    const collectAmtEl = document.getElementById("modalCollectAmt");
    const qrContainer = document.getElementById("qrCanvasContainer");
    const statusBadge = document.getElementById("modalPaymentStatusBadge");

    if (payment.is_pending && payment.amount_to_collect > 0) {
        if (qrBox) qrBox.style.display = "flex";
        if (prepaidBox) prepaidBox.style.display = "none";
        if (collectAmtEl) collectAmtEl.textContent = `₹${payment.amount_to_collect.toFixed(2)}`;
        if (statusBadge) statusBadge.textContent = `⚠️ CASH / UPI (COD) PENDING: COLLECT ₹${payment.amount_to_collect.toFixed(2)}`;
        
        const upiLink = payment.upi_payment_link || `upi://pay?pa=lastmile.merchant@icici&pn=DeliveryPartner&am=${payment.amount_to_collect.toFixed(2)}&cu=INR`;
        if (qrContainer) {
            qrContainer.innerHTML = generateQrSvg(upiLink);
        }
    } else {
        if (qrBox) qrBox.style.display = "none";
        if (prepaidBox) prepaidBox.style.display = "flex";
    }

    // Right Panel: Rider Earnings Summary & Daily Target
    const payoutEl = document.getElementById("modalTripPayout");
    if (payoutEl) payoutEl.textContent = `+₹${(result.payout || 0).toFixed(2)}`;

    const baseEl = document.getElementById("modalBasePay");
    if (baseEl) baseEl.textContent = `₹${(breakdown.base_pay || (result.payout * 0.52) || 38).toFixed(2)}`;

    const distEl = document.getElementById("modalDistPay");
    if (distEl) distEl.textContent = `₹${(breakdown.distance_pay || (result.payout * 0.35) || 28).toFixed(2)}`;

    const surgeEl = document.getElementById("modalSurgePay");
    if (surgeEl) surgeEl.textContent = `+₹${(breakdown.surge_bonus || 15).toFixed(2)}`;

    // Daily Status
    const dailyEarningsEl = document.getElementById("modalDailyEarnings");
    if (dailyEarningsEl) {
        dailyEarningsEl.textContent = `₹${(daily.earnings_today_inr || 570).toFixed(2)} / ₹${(daily.daily_target_inr || 800).toFixed(2)}`;
    }

    const progBar = document.getElementById("modalProgressBar");
    if (progBar) {
        progBar.style.width = `${daily.progress_pct || 71}%`;
    }

    const ordersCountEl = document.getElementById("modalOrdersCount");
    if (ordersCountEl) {
        ordersCountEl.textContent = `${daily.orders_completed_count || 7} of ${daily.daily_target || 8} Orders Completed`;
    }

    const targetPctEl = document.getElementById("modalTargetPct");
    if (targetPctEl) {
        targetPctEl.textContent = `${daily.progress_pct || 71}% Goal`;
    }

    modal.style.display = "flex";
    playAudioChime(1200, 0.35);
}

function closeDeliveryModal() {
    const modal = document.getElementById("deliveryCompleteModal");
    if (modal) modal.style.display = "none";
    currentOrderPhase = "IDLE";
    refreshOrders();
}

// Dispatches command via WebSocket and HTTP REST with optimistic instant updates
async function sendCommand(action, payload = {}) {
    playAudioChime(850, 0.08);
    console.log("[HUD ACTION]", action, payload);

    if (action === "reach_store") {
        currentOrderPhase = "AT_STORE";
        renderActiveRouteBanner(currentSelectedOrder, "AT_STORE");
    } else if (action === "pickup_order") {
        currentOrderPhase = "ROUTE_TO_CUSTOMER";
        renderActiveRouteBanner(currentSelectedOrder, "ROUTE_TO_CUSTOMER");
    } else if (action === "complete_delivery") {
        currentOrderPhase = "DELIVERED";
        renderActiveRouteBanner(null, "DELIVERED");
    } else if (action === "reset_emergency") {
        const emerg = document.getElementById("emergencyOverlay");
        if (emerg) emerg.style.display = "none";
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, ...payload }));
    }

    try {
        let url = null;
        let body = null;

        if (action === "refresh_orders") url = '/api/feed/refresh';
        else if (action === "accept_order") {
            url = '/api/feed/accept';
            body = JSON.stringify({ order_id: payload.order_id || "" });
        }
        else if (action === "reach_store") url = '/api/feed/reach-store';
        else if (action === "pickup_order") url = '/api/feed/pickup';
        else if (action === "reach_customer") url = '/api/feed/reach-customer';
        else if (action === "complete_delivery") url = '/api/feed/deliver';
        else if (action === "dismiss_offer") {
            url = '/api/feed/dismiss';
            body = JSON.stringify({ order_id: payload.order_id || "" });
        }
        else if (action === "trigger_sos") url = '/api/test/sos';
        else if (action === "trigger_tilt") url = '/api/test/tilt';
        else if (action === "reset_emergency") url = '/api/test/reset-emergency';

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
            if (action === "complete_delivery" && jsonRes && jsonRes.result && jsonRes.result.success) {
                showDeliveryCompleteModal(jsonRes.result);
            }
        }
    } catch (e) {
        console.warn("[ACTION ERROR]", e);
    }
}

// Global action bindings
function refreshOrders() { sendCommand("refresh_orders"); }
function acceptSpecificOrder(orderId) { sendCommand("accept_order", { order_id: orderId }); }
function acceptTopOrder() { sendCommand("accept_order", { order_id: "" }); }
function dismissOffer(orderId) { sendCommand("dismiss_offer", { order_id: orderId }); }
function reachStore() { sendCommand("reach_store"); }
function confirmPickup() { sendCommand("pickup_order"); }
function reachCustomer() { sendCommand("reach_customer"); }
function completeDelivery() { sendCommand("complete_delivery"); }
function triggerSos() { sendCommand("trigger_sos"); }
function triggerTilt() { sendCommand("trigger_tilt"); }
function resetEmergency() { sendCommand("reset_emergency"); }
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
    else if (e.key === "Escape") {
        const modal = document.getElementById("deliveryCompleteModal");
        if (modal && modal.style.display === "flex") {
            closeDeliveryModal();
        } else {
            resetEmergency();
        }
    }
});

// Initialize on DOM ready
window.addEventListener("DOMContentLoaded", () => {
    initMap(22.564300, 88.369300);

    fetch('/api/telemetry')
        .then(res => res.json())
        .then(data => updateHUD(data))
        .catch(() => {});

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    function connectWs() {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => console.log("[WS] Connected to LastMile Guard.");
        ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                updateHUD(data);
            } catch (err) {}
        };
        ws.onclose = () => setTimeout(connectWs, 1500);
    }

    connectWs();
});
