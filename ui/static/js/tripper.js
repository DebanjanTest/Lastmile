// ==============================================================================
// LastMile Guard - Google Maps Navigation HUD Client (Ponytail Engine)
// Supports Leaflet.js (zero API key) and Google Maps JavaScript API seamlessly
// ==============================================================================

let ws = null;
let audioCtx = null;
let currentBrightness = 85;

// Map & Navigation Objects
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let routePolyline = null;
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

        // Custom Rider Vehicle Navigation Puck (Glowing Blue Arrow)
        const riderIcon = L.divIcon({
            className: 'rider-puck-container',
            html: `<div id="riderPuck" style="width:36px;height:36px;background:#1A73E8;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 16px #1A73E8;display:flex;align-items:center;justify-content:center;transform:rotate(45deg);"><svg width="20" height="20" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFF"/></svg></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        riderMarker = L.marker([initialLat, initialLng], { icon: riderIcon }).addTo(mapInstance);

        // Custom Red Destination Pin
        const destIcon = L.divIcon({
            className: 'dest-pin-container',
            html: `<div style="font-size:32px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));">🏁</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 30]
        });

        destMarker = L.marker([22.5855, 88.4168], { icon: destIcon }).addTo(mapInstance);

        // Glowing Blue Navigation Polyline
        routePolyline = L.polyline([], {
            color: '#1A73E8',
            weight: 7,
            opacity: 0.9,
            lineJoin: 'round'
        }).addTo(mapInstance);

        isMapInitialized = true;
        console.log("[MAP] Road Navigation map initialized successfully.");
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
    // 1. Hardware & System Health
    if (data.health) {
        document.getElementById("tempBadge").textContent = `⚡ ${data.health.cpu_temp_c}°C`;
        const voltEl = document.getElementById("voltBadge");
        voltEl.textContent = `🔋 ${data.health.voltage_status === 'OK' ? '5.1V' : data.health.voltage_status}`;
    }

    // 2. GPS Telemetry & Speed
    if (data.gps) {
        const gps = data.gps;
        document.getElementById("gpsBadge").textContent = gps.is_fixed ? `🛰️ ${gps.satellites} SATS` : `🛰️ ACQUIRING...`;
        document.getElementById("speedNum").textContent = Math.round(gps.speed_kmh);

        if (!isMapInitialized) {
            initMap(gps.latitude, gps.longitude);
        }

        // Smoothly pan map and rotate rider puck
        if (mapInstance && riderMarker) {
            riderMarker.setLatLng([gps.latitude, gps.longitude]);
            mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.4 });
            
            const puckEl = document.getElementById("riderPuck");
            if (puckEl) {
                puckEl.style.transform = `rotate(${gps.heading_deg}deg)`;
            }
        }
    }

    // 3. Google Maps Navigation Maneuver & Polyline
    if (data.navigation) {
        const nav = data.navigation;
        document.getElementById("turnDistNum").textContent = nav.distance_to_turn_m;
        document.getElementById("turnRoadName").textContent = nav.road_name;
        document.getElementById("turnNextPreview").textContent = `Then: ${nav.next_instruction}`;

        // Update SVG icon
        const pathData = SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT;
        document.getElementById("turnPath").setAttribute("d", pathData);

        // Update Bottom Trip Summary
        document.getElementById("tripTimeVal").textContent = `${nav.eta_minutes} min`;
        document.getElementById("tripDistVal").textContent = `${nav.remaining_total_dist_km} km`;
        document.getElementById("destName").textContent = nav.destination_name;

        // Calculate arrival clock time
        const arrival = new Date(Date.now() + nav.eta_minutes * 60000);
        document.getElementById("tripEtaVal").textContent = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Update Polyline & Destination Pin on Map
        if (mapInstance && nav.route_polyline && routePolyline) {
            routePolyline.setLatLngs(nav.route_polyline);
        }
        if (destMarker && nav.destination_coords) {
            destMarker.setLatLng([nav.destination_coords.lat, nav.destination_coords.lng]);
        }
    }

    // 4. Delivery Notification Card
    const delCard = document.getElementById("deliveryCard");
    if (data.active_alert) {
        delCard.style.display = "flex";
        const tag = document.getElementById("deliveryTag");
        tag.textContent = data.active_alert.source.toUpperCase();
        tag.style.backgroundColor = data.active_alert.badge_color;
        document.getElementById("deliveryTitle").textContent = data.active_alert.title;
        document.getElementById("deliveryDesc").textContent = data.active_alert.body;
        delCard.style.borderLeftColor = data.active_alert.badge_color;
    } else {
        delCard.style.display = "none";
    }

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

function sendCommand(cmdObj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
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

function injectOrder(source) {
    sendCommand({ action: "mock_order", source: source });
}

function clearDeliveryAlert() {
    sendCommand({ action: "clear_alert" });
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

// Global Keyboard Hotkeys for Testing on Pi 5 / Windows
document.addEventListener("keydown", (e) => {
    const key = e.key.toUpperCase();
    if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (key === "O") injectOrder("swiggy");
    else if (key === "Z") injectOrder("zomato");
    else if (key === "C") injectOrder("call");
    else if (key === "D") toggleDashcam();
    else if (key === "1") adjustBrightness(10);
    else if (key === "2") adjustBrightness(-10);
    else if (key === "P") openDestinationModal();
    else if (key === "ESCAPE") {
        resetEmergency();
        closeDestinationModal();
    }
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    initMap(22.572645, 88.363892);
    initWebSocket();
});
