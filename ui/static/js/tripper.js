// ==============================================================================
// LastMile Guard - Google Maps Navigation, Traffic & Order Workflow Client
// Features multi-colored traffic polyline segments & 2-stage delivery lifecycle
// ==============================================================================

let ws = null;
let audioCtx = null;
let currentBrightness = 85;

// Map & Navigation Objects
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

function playAudioChime(freq = 880, duration = 0.15) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        // Audio policy
    }
}

function initMap(initialLat = 22.5726, initialLng = 88.3639) {
    if (isMapInitialized || typeof L === 'undefined') return;

    try {
        mapInstance = L.map('mapView', {
            center: [initialLat, initialLng],
            zoom: 16,
            zoomControl: false,
            attributionControl: false
        });

        // High-contrast Dark Matter road map tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(mapInstance);

        // Custom Rider Navigation Puck (Vehicle Chevron)
        const riderIcon = L.divIcon({
            className: 'rider-puck-container',
            html: `<div id="riderPuck" style="width:36px;height:36px;background:#1A73E8;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 16px #1A73E8;display:flex;align-items:center;justify-content:center;transform:rotate(45deg);"><svg width="20" height="20" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFF"/></svg></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        riderMarker = L.marker([initialLat, initialLng], { icon: riderIcon }).addTo(mapInstance);

        // Custom Destination Pin
        const destIcon = L.divIcon({
            className: 'dest-pin-container',
            html: `<div id="destPinIcon" style="font-size:32px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));">🏁</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 30]
        });

        destMarker = L.marker([22.5855, 88.4168], { icon: destIcon }).addTo(mapInstance);
        isMapInitialized = true;
    } catch (e) {
        console.error("[MAP ERROR]", e);
    }
}

function initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
    
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
}

function updateHUD(data) {
    // 1. Hardware & Earnings Telemetry
    if (data.health) {
        document.getElementById("tempBadge").textContent = `⚡ ${data.health.cpu_temp_c}°C`;
        const voltEl = document.getElementById("voltBadge");
        voltEl.textContent = `🔋 ${data.health.voltage_status === 'OK' ? '5.1V' : data.health.voltage_status}`;
    }
    if (data.earnings_today_inr !== undefined) {
        document.getElementById("earningsBadge").textContent = `💰 ₹${data.earnings_today_inr.toFixed(0)}`;
    }

    // 2. GPS Telemetry & Kinematics
    if (data.gps) {
        const gps = data.gps;
        document.getElementById("gpsBadge").textContent = gps.is_fixed ? `🛰️ ${gps.satellites} SATS` : `🛰️ ACQUIRING...`;
        document.getElementById("speedNum").textContent = Math.round(gps.speed_kmh);

        if (!isMapInitialized) {
            initMap(gps.latitude, gps.longitude);
        }

        if (mapInstance && riderMarker) {
            riderMarker.setLatLng([gps.latitude, gps.longitude]);
            mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.3 });
            
            const puckEl = document.getElementById("riderPuck");
            if (puckEl) {
                puckEl.style.transform = `rotate(${gps.heading_deg}deg)`;
            }
        }
    }

    // 3. Google Maps Navigation Maneuver & Multi-Colored Traffic Polyline
    if (data.navigation) {
        const nav = data.navigation;
        document.getElementById("turnDistNum").textContent = nav.distance_to_turn_m;
        document.getElementById("turnRoadName").textContent = nav.road_name;
        document.getElementById("turnNextPreview").textContent = `Then: ${nav.next_instruction}`;

        // Traffic condition badge on turn card
        const trafficBadge = document.getElementById("trafficConditionBadge");
        if (nav.current_traffic_status === "HEAVY_JAM") {
            trafficBadge.textContent = "🔴 Heavy Traffic Jam";
            trafficBadge.style.backgroundColor = "#FF1744";
        } else if (nav.current_traffic_status === "MODERATE") {
            trafficBadge.textContent = "🟠 Moderate Traffic";
            trafficBadge.style.backgroundColor = "#FF9100";
        } else {
            trafficBadge.textContent = "🟢 Normal Flow";
            trafficBadge.style.backgroundColor = "#00E676";
        }

        // Update SVG icon
        const pathData = SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT;
        document.getElementById("turnPath").setAttribute("d", pathData);

        // Update Bottom Trip Summary
        document.getElementById("tripTimeVal").textContent = `${nav.eta_minutes} min`;
        document.getElementById("tripDistVal").textContent = `${nav.remaining_total_dist_km} km`;
        document.getElementById("destName").textContent = nav.destination_name;

        // Traffic delay indicator text
        const delayEl = document.getElementById("trafficDelayText");
        if (nav.traffic_delay_minutes > 0) {
            delayEl.textContent = `+${nav.traffic_delay_minutes} min delay`;
            delayEl.style.color = "#FF1744";
        } else {
            delayEl.textContent = "Fastest route";
            delayEl.style.color = "#00E676";
        }

        const arrival = new Date(Date.now() + nav.eta_minutes * 60000);
        document.getElementById("tripEtaVal").textContent = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Multi-colored traffic polyline rendering
        if (mapInstance && nav.route_polyline && nav.traffic_segments) {
            renderTrafficPolyline(nav.route_polyline, nav.traffic_segments);
        }

        if (destMarker && nav.destination_coords) {
            destMarker.setLatLng([nav.destination_coords.lat, nav.destination_coords.lng]);
        }
    }

    // 4. Order Lifecycle & Multi-Stop Workflow UI
    updateOrderWorkflowUI(data.order);

    // 5. Emergency SOS Overlay
    const emerg = document.getElementById("emergencyOverlay");
    if (data.is_emergency) {
        emerg.style.display = "flex";
        document.getElementById("emergencyTitle").textContent = data.emergency_reason || "EMERGENCY SOS ACTIVE";
        if (data.gps) {
            document.getElementById("emergencyGps").textContent = `GPS: ${data.gps.latitude.toFixed(6)}, ${data.gps.longitude.toFixed(6)} | Speed: ${data.gps.speed_kmh} km/h`;
        }
    } else {
        emerg.style.display = "none";
    }
}

function renderTrafficPolyline(polyline, trafficSegments) {
    trafficPolylines.forEach(p => mapInstance.removeLayer(p));
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

function updateOrderWorkflowUI(order) {
    const offerModal = document.getElementById("orderOfferModal");
    const stageBanner = document.getElementById("orderStageBanner");
    const stageBadge = document.getElementById("stageBadge");
    const stageTitle = document.getElementById("stageTitle");
    const stageActions = document.getElementById("stageActions");
    const destHeader = document.getElementById("destHeaderLabel");

    if (!order) {
        offerModal.style.display = "none";
        stageBanner.style.display = "none";
        destHeader.textContent = "TARGET DESTINATION:";
        return;
    }

    if (order.state === "OFFERED") {
        offerModal.style.display = "flex";
        stageBanner.style.display = "none";
        document.getElementById("offerPlatformTag").textContent = `${order.platform.toUpperCase()} NEW ORDER`;
        document.getElementById("offerPlatformTag").style.backgroundColor = order.platform === "zomato" ? "#E23744" : "#FC8019";
        document.getElementById("offerPayout").textContent = `₹${order.payout_inr.toFixed(2)}`;
        document.getElementById("offerRestName").textContent = order.restaurant_name;
        document.getElementById("offerRestAddr").textContent = order.restaurant_address;
        document.getElementById("offerCustName").textContent = order.customer_name;
        document.getElementById("offerCustAddr").textContent = order.customer_address;
        document.getElementById("offerItems").textContent = `📦 ${order.items}`;
    } else if (order.state === "NAV_TO_RESTAURANT") {
        offerModal.style.display = "none";
        stageBanner.style.display = "flex";
        stageBadge.textContent = "🛵 STEP 1: EN ROUTE TO RESTAURANT";
        stageBadge.style.color = "#FF9100";
        stageTitle.textContent = `${order.restaurant_name} (Pickup #${order.order_id})`;
        stageActions.innerHTML = `<button class="stage-action-btn" onclick="confirmPickup()" style="background:#00B0FF;">🍴 Food Picked Up [K]</button>`;
        destHeader.textContent = "RESTAURANT PICKUP:";
    } else if (order.state === "NAV_TO_CUSTOMER") {
        offerModal.style.display = "none";
        stageBanner.style.display = "flex";
        stageBadge.textContent = "📦 STEP 2: EN ROUTE TO CUSTOMER";
        stageBadge.style.color = "#00E676";
        stageTitle.textContent = `${order.customer_name} - ${order.customer_address}`;
        stageActions.innerHTML = `<button class="stage-action-btn" onclick="completeDelivery()" style="background:#7C4DFF;">✅ Complete Delivery [U]</button>`;
        destHeader.textContent = "CUSTOMER DROP:";
    } else {
        offerModal.style.display = "none";
        stageBanner.style.display = "none";
        destHeader.textContent = "TARGET DESTINATION:";
    }
}

function sendCommand(cmdObj) {
    playAudioChime(1000, 0.08);
    console.log("[COMMAND SENT]", cmdObj);
    
    // 1. Try WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
    
    // 2. HTTP REST Fallback to guarantee instant execution
    const act = cmdObj.action;
    if (act === "offer_order") {
        fetch(`/api/orders/offer?platform=${cmdObj.platform || 'swiggy'}`, { method: 'POST' }).catch(() => {});
    } else if (act === "accept_order") {
        fetch('/api/orders/accept', { method: 'POST' }).catch(() => {});
    } else if (act === "confirm_pickup") {
        fetch('/api/orders/pickup', { method: 'POST' }).catch(() => {});
    } else if (act === "complete_delivery") {
        fetch('/api/orders/deliver', { method: 'POST' }).catch(() => {});
    } else if (act === "trigger_sos") {
        fetch('/api/test/sos', { method: 'POST' }).catch(() => {});
    } else if (act === "trigger_tilt") {
        fetch('/api/test/tilt', { method: 'POST' }).catch(() => {});
    }
}

// Order Management Commands
function offerMockOrder(platform = "swiggy") {
    sendCommand({ action: "offer_order", platform: platform });
}

function acceptOrder() {
    sendCommand({ action: "accept_order" });
}

function declineOrder() {
    sendCommand({ action: "decline_order" });
}

function confirmPickup() {
    sendCommand({ action: "confirm_pickup" });
}

function completeDelivery() {
    sendCommand({ action: "complete_delivery" });
}

// Emergency & Alert Triggers
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
    pip.style.display = pip.style.display === "none" ? "block" : "none";
}

function adjustBrightness(delta) {
    currentBrightness = Math.max(10, Math.min(100, currentBrightness + delta));
    document.getElementById("appContainer").style.filter = `brightness(${currentBrightness}%)`;
    sendCommand({ action: "set_brightness", level: currentBrightness });
}

// Destination Importing & Road Planning
function openDestinationModal() {
    document.getElementById("destModal").style.display = "flex";
}

function closeDestinationModal() {
    document.getElementById("destModal").style.display = "none";
}

function selectPreset(name, lat, lng) {
    sendCommand({ action: "import_destination", name: name, lat: lat, lng: lng });
    closeDestinationModal();
}

function applyCustomDestination() {
    const name = document.getElementById("customName").value.trim() || "Custom Drop Point";
    const lat = parseFloat(document.getElementById("customLat").value);
    const lng = parseFloat(document.getElementById("customLng").value);
    if (!isNaN(lat) && !isNaN(lng)) {
        sendCommand({ action: "import_destination", name: name, lat: lat, lng: lng });
        closeDestinationModal();
    } else {
        alert("Please enter valid Latitude and Longitude values.");
    }
}

// Global Keyboard Hotkeys
document.addEventListener("keydown", (e) => {
    const key = e.key.toUpperCase();
    if (key === "O") offerMockOrder("swiggy");
    else if (key === "A") acceptOrder();
    else if (key === "K") confirmPickup();
    else if (key === "U") completeDelivery();
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (key === "D") toggleDashcam();
    else if (key === "P") openDestinationModal();
    else if (key === "ESCAPE") {
        resetEmergency();
        closeDestinationModal();
        declineOrder();
    }
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    initMap(22.572645, 88.363892);
    initWebSocket();
});
