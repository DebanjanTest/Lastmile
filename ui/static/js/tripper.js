// LastMile Guard - Real-Time Tripper HUD & Telemetry Client

let ws = null;
let audioCtx = null;
let currentBrightness = 85;

// SVG Path definitions for Tripper Maneuver Icons
const SVG_ARROWS = {
    STRAIGHT: "M50 15 L75 45 L58 45 L58 85 L42 85 L42 45 L25 45 Z",
    TURN_RIGHT: "M25 80 L25 55 Q25 35 45 35 L60 35 L60 20 L85 45 L60 70 L60 55 L45 55 Q38 55 38 65 L38 80 Z",
    TURN_LEFT: "M75 80 L75 55 Q75 35 55 35 L40 35 L40 20 L15 45 L40 70 L40 55 L55 55 Q62 55 62 65 L62 80 Z",
    SLIGHT_RIGHT: "M30 80 L30 55 Q30 40 45 30 L65 18 L60 8 L88 22 L75 48 L68 38 L50 48 Q42 54 42 65 L42 80 Z",
    SLIGHT_LEFT: "M70 80 L70 55 Q70 40 55 30 L35 18 L40 8 L12 22 L25 48 L32 38 L50 48 Q58 54 58 65 L58 80 Z",
    ROUNDABOUT: "M50 20 A30 30 0 1 1 49.9 20 M50 10 L65 25 L50 40 Z",
    DESTINATION: "M35 15 L35 85 M35 15 L75 35 L35 55 Z",
    UTURN: "M30 80 L30 45 Q30 20 50 20 Q70 20 70 45 L70 80 L80 80 L60 95 L40 80 L52 80 L52 45 Q52 35 50 35 Q48 35 48 45 L48 80 Z"
};

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
            console.error("[HUD ERROR] Failed to parse telemetry packet:", err);
        }
    };

    ws.onclose = () => {
        console.warn("[HUD WS] Disconnected. Reconnecting in 1.5s...");
        setTimeout(initWebSocket, 1500);
    };

    ws.onerror = (err) => {
        console.error("[HUD WS] Error:", err);
    };
}

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
        // Audio policy ignore
    }
}

function updateHUD(data) {
    // 1. Clock
    const now = new Date();
    document.getElementById("hudClock").textContent = now.toLocaleTimeString();

    // 2. Hardware Telemetry & Health
    if (data.health) {
        document.getElementById("tempStat").textContent = `⚡ ${data.health.cpu_temp_c}°C`;
        const voltEl = document.getElementById("voltStat");
        voltEl.textContent = `🔋 ${data.health.voltage_status}`;
        voltEl.style.color = data.health.voltage_status === "UNDER_VOLTAGE" ? "#FF1744" : "#90A4AE";
    }

    if (data.gps) {
        const gpsEl = document.getElementById("gpsStat");
        gpsEl.textContent = data.gps.is_fixed ? `🛰️ GPS: ${data.gps.satellites} SATS` : `🛰️ ACQUIRING...`;
        gpsEl.style.color = data.gps.is_fixed ? "#00E676" : "#FF9100";
    }

    document.getElementById("modeTag").textContent = data.is_simulated ? "TEST SIMULATOR" : "PI 5 HARDWARE";

    // 3. Navigation & Tripper Maneuver
    if (data.navigation) {
        const nav = data.navigation;
        document.getElementById("distToTurn").textContent = nav.distance_to_turn_m;
        document.getElementById("actionLabel").textContent = nav.maneuver_type.replace("_", " ");
        document.getElementById("roadName").textContent = nav.road_name;
        document.getElementById("remainingDist").textContent = `${nav.remaining_total_dist_km} km`;
        document.getElementById("etaVal").textContent = `ETA: ${nav.eta_minutes} min`;

        // Update SVG vector path
        const pathData = SVG_ARROWS[nav.maneuver_type] || SVG_ARROWS.STRAIGHT;
        document.getElementById("arrowPath").setAttribute("d", pathData);
    }

    // 4. Speed & Bearing
    if (data.gps) {
        document.getElementById("speedVal").textContent = data.gps.speed_kmh.toFixed(1);
        document.getElementById("bearingVal").textContent = `${getCardinalDirection(data.gps.heading_deg)} (${Math.round(data.gps.heading_deg)}°)`;
    }

    // 5. Active Delivery Alert Banner
    const banner = document.getElementById("deliveryBanner");
    const pill = document.getElementById("deliveryPill");
    const text = document.getElementById("deliveryText");
    if (data.active_alert) {
        pill.textContent = data.active_alert.source.toUpperCase();
        pill.style.backgroundColor = data.active_alert.badge_color;
        text.textContent = `${data.active_alert.title}: ${data.active_alert.body}`;
        banner.style.borderColor = data.active_alert.badge_color;
    } else {
        pill.textContent = "READY";
        pill.style.backgroundColor = "#546E7A";
        text.textContent = "Standing by for delivery notifications...";
        banner.style.borderColor = "rgba(255,255,255,0.15)";
    }

    // 6. Emergency Overlay
    const emergencyEl = document.getElementById("emergencyOverlay");
    if (data.is_emergency) {
        emergencyEl.style.display = "flex";
        document.getElementById("emergencyTitle").textContent = data.emergency_reason || "EMERGENCY ALERT";
        if (data.gps) {
            document.getElementById("emergencyGps").textContent = `GPS: ${data.gps.latitude.toFixed(6)}, ${data.gps.longitude.toFixed(6)} | Speed: ${data.gps.speed_kmh} km/h`;
        }
    } else {
        emergencyEl.style.display = "none";
    }
}

function getCardinalDirection(angle) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((angle %= 360) < 0 ? angle + 360 : angle) / 45) % 8;
    return directions[index];
}

// Interactive Test Commands
function sendCommand(cmdObj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
}

function triggerSos() {
    playAudioChime(440, 0.4);
    sendCommand({ action: "trigger_sos" });
}

function triggerTilt() {
    playAudioChime(300, 0.5);
    sendCommand({ action: "trigger_tilt" });
}

function resetEmergency() {
    sendCommand({ action: "reset_emergency" });
}

function injectOrder(source) {
    playAudioChime(1200, 0.1);
    sendCommand({ action: "mock_order", source: source });
}

function toggleDashcam() {
    const pip = document.getElementById("dashcamPip");
    pip.style.display = pip.style.display === "none" ? "block" : "none";
}

function adjustBrightness(delta) {
    currentBrightness = Math.max(10, Math.min(100, currentBrightness + delta));
    const container = document.getElementById("hudContainer");
    container.style.filter = `brightness(${currentBrightness}%)`;
    sendCommand({ action: "set_brightness", level: currentBrightness });
}

// Global Keyboard Hotkeys for HDMI Testing on Pi 5 / Windows
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
    else if (key === "ESCAPE") resetEmergency();
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    initWebSocket();
});
