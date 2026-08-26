// ==============================================================================
// LastMile Guard - 5-Inch Navigation HUD & Real-Time Test Rig Client
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

        // High-contrast Dark Matter road map tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(mapInstance);

        // Rider Navigation Puck
        const riderIcon = L.divIcon({
            className: 'rider-puck-container',
            html: `<div id="riderPuck" style="width:36px;height:36px;background:#1A73E8;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 16px #1A73E8;display:flex;align-items:center;justify-content:center;transform:rotate(45deg);"><svg width="20" height="20" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFF"/></svg></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        riderMarker = L.marker([initialLat, initialLng], { icon: riderIcon }).addTo(mapInstance);

        // Destination Pin
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

    // 1. Hardware & Earnings Telemetry
    if (data.health) {
        const tempEl = document.getElementById("tempBadge");
        if (tempEl) tempEl.textContent = `⚡ ${data.health.cpu_temp_c}°C`;
        const voltEl = document.getElementById("voltBadge");
        if (voltEl) voltEl.textContent = `🔋 ${data.health.voltage_status === 'OK' ? '5.1V' : data.health.voltage_status}`;
    }
    if (data.earnings_today_inr !== undefined) {
        const earnEl = document.getElementById("earningsBadge");
        if (earnEl) earnEl.textContent = `💰 ₹${Math.round(data.earnings_today_inr)}`;
    }

    // 2. GPS Telemetry & Kinematics
    if (data.gps) {
        const gps = data.gps;
        const gpsEl = document.getElementById("gpsBadge");
        if (gpsEl) gpsEl.textContent = gps.is_fixed ? `🛰️ ${gps.satellites} SATS` : `🛰️ ACQUIRING...`;
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

    // 3. Navigation Turn Card & Traffic Polyline
    if (data.navigation) {
        const nav = data.navigation;
        const distEl = document.getElementById("turnDistNum");
        if (distEl) distEl.textContent = nav.distance_to_turn_m;
        const roadEl = document.getElementById("turnRoadName");
        if (roadEl) roadEl.textContent = nav.road_name;
        const prevEl = document.getElementById("turnNextPreview");
        if (prevEl) prevEl.textContent = `Then: ${nav.next_instruction}`;

        // Traffic condition badge
        const trafficBadge = document.getElementById("trafficConditionBadge");
        if (trafficBadge) {
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
        }

        // Update SVG icon
        const pathData = SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT;
        const turnPathEl = document.getElementById("turnPath");
        if (turnPathEl) turnPathEl.setAttribute("d", pathData);

        // Update Bottom Trip Summary
        const timeEl = document.getElementById("tripTimeVal");
        if (timeEl) timeEl.textContent = `${nav.eta_minutes} min`;
        const tDistEl = document.getElementById("tripDistVal");
        if (tDistEl) tDistEl.textContent = `${nav.remaining_total_dist_km} km`;
        const dNameEl = document.getElementById("destName");
        if (dNameEl) dNameEl.textContent = nav.destination_name;

        // Traffic delay indicator text
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

function updateOrderWorkflowUI(order) {
    const offerModal = document.getElementById("orderOfferModal");
    const stageBanner = document.getElementById("orderStageBanner");
    const stageBadge = document.getElementById("stageBadge");
    const stageTitle = document.getElementById("stageTitle");
    const stageActions = document.getElementById("stageActions");
    const destHeader = document.getElementById("destHeaderLabel");

    if (!order) {
        if (offerModal) offerModal.style.display = "none";
        if (stageBanner) stageBanner.style.display = "none";
        if (destHeader) destHeader.textContent = "TARGET DESTINATION:";
        return;
    }

    if (order.state === "OFFERED") {
        if (offerModal) offerModal.style.display = "flex";
        if (stageBanner) stageBanner.style.display = "none";
        
        const tagEl = document.getElementById("offerPlatformTag");
        if (tagEl) {
            tagEl.textContent = `${order.platform.toUpperCase()} NEW ORDER`;
            tagEl.style.backgroundColor = order.platform === "zomato" ? "#E23744" : "#FC8019";
        }
        const payEl = document.getElementById("offerPayout");
        if (payEl) payEl.textContent = `₹${order.payout_inr.toFixed(2)}`;
        const rNameEl = document.getElementById("offerRestName");
        if (rNameEl) rNameEl.textContent = order.restaurant_name;
        const rAddrEl = document.getElementById("offerRestAddr");
        if (rAddrEl) rAddrEl.textContent = order.restaurant_address;
        const cNameEl = document.getElementById("offerCustName");
        if (cNameEl) cNameEl.textContent = order.customer_name;
        const cAddrEl = document.getElementById("offerCustAddr");
        if (cAddrEl) cAddrEl.textContent = order.customer_address;
        const itemsEl = document.getElementById("offerItems");
        if (itemsEl) itemsEl.textContent = `📦 ${order.items}`;
    } else if (order.state === "NAV_TO_RESTAURANT") {
        if (offerModal) offerModal.style.display = "none";
        if (stageBanner) stageBanner.style.display = "flex";
        if (stageBadge) {
            stageBadge.textContent = "🛵 STEP 1: EN ROUTE TO RESTAURANT";
            stageBadge.style.color = "#FF9100";
        }
        if (stageTitle) stageTitle.textContent = `${order.restaurant_name} (Pickup #${order.order_id})`;
        if (stageActions) {
            stageActions.innerHTML = `<button class="stage-action-btn" onclick="confirmPickup()" style="background:#00B0FF;">🍴 Food Picked Up [K]</button>`;
        }
        if (destHeader) destHeader.textContent = "RESTAURANT PICKUP:";
    } else if (order.state === "NAV_TO_CUSTOMER") {
        if (offerModal) offerModal.style.display = "none";
        if (stageBanner) stageBanner.style.display = "flex";
        if (stageBadge) {
            stageBadge.textContent = "📦 STEP 2: EN ROUTE TO CUSTOMER";
            stageBadge.style.color = "#00E676";
        }
        if (stageTitle) stageTitle.textContent = `${order.customer_name} - ${order.customer_address}`;
        if (stageActions) {
            stageActions.innerHTML = `<button class="stage-action-btn" onclick="completeDelivery()" style="background:#7C4DFF;">✅ Complete Delivery [U]</button>`;
        }
        if (destHeader) destHeader.textContent = "CUSTOMER DROP:";
    } else {
        if (offerModal) offerModal.style.display = "none";
        if (stageBanner) stageBanner.style.display = "none";
        if (destHeader) destHeader.textContent = "TARGET DESTINATION:";
    }
}

function showDeliveredCelebration(payoutText = "+₹85.00 Credited to Rider Wallet") {
    const toast = document.getElementById("deliveredToast");
    if (!toast) return;
    const txt = document.getElementById("toastPayoutText");
    if (txt) txt.textContent = payoutText;
    toast.style.display = "flex";
    playAudioChime(1200, 0.25);
    setTimeout(() => {
        toast.style.display = "none";
    }, 4000);
}

// Dispatches command via WebSocket and HTTP REST with immediate state update
async function sendCommand(cmdObj) {
    playAudioChime(800, 0.08);
    console.log("[TEST RIG ACTION]", cmdObj);
    
    // 1. Try WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
    
    // 2. Immediate REST Endpoint Call
    try {
        const act = cmdObj.action;
        let url = null;
        if (act === "offer_order") url = `/api/orders/offer?platform=${cmdObj.platform || 'swiggy'}`;
        else if (act === "accept_order") url = '/api/orders/accept';
        else if (act === "confirm_pickup") url = '/api/orders/pickup';
        else if (act === "complete_delivery") url = '/api/orders/deliver';
        else if (act === "decline_order") url = '/api/orders/decline';
        else if (act === "trigger_sos") url = '/api/test/sos';
        else if (act === "trigger_tilt") url = '/api/test/tilt';

        if (url) {
            const res = await fetch(url, { method: 'POST' });
            const jsonRes = await res.json();
            if (jsonRes && jsonRes.snapshot) {
                updateHUD(jsonRes.snapshot);
            }
            if (act === "complete_delivery") {
                showDeliveredCelebration();
            }
        }
    } catch (err) {
        console.warn("[REST DISPATCH]", err);
    }
}

// Public action bindings
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

function openDestinationModal() {
    const el = document.getElementById("destModal");
    if (el) el.style.display = "flex";
}

function closeDestinationModal() {
    const el = document.getElementById("destModal");
    if (el) el.style.display = "none";
}

function selectPreset(name, lat, lng) {
    sendCommand({ action: "import_destination", name: name, lat: lat, lng: lng });
    closeDestinationModal();
}

function applyCustomDestination() {
    const nameEl = document.getElementById("customName");
    const latEl = document.getElementById("customLat");
    const lngEl = document.getElementById("customLng");
    const name = (nameEl && nameEl.value.trim()) || "Custom Drop Point";
    const lat = parseFloat(latEl ? latEl.value : "0");
    const lng = parseFloat(lngEl ? lngEl.value : "0");
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        sendCommand({ action: "import_destination", name: name, lat: lat, lng: lng });
        closeDestinationModal();
    } else {
        alert("Please enter valid coordinates.");
    }
}

// Global Keyboard Shortcuts
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
