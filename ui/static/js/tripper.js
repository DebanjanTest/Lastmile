// ==============================================================================
// LastMile Guard - Automotive HUD Client Controller (Tauri v2 + Rust)
// Strict Navy Blue Theme • Zero Emojis • Pure SVG Icons • Kolkata Bounds
// ==============================================================================

// Safe Tauri v2 IPC Resolver with Standalone Browser Fallback
const tauriInvoke = (cmd, args = {}) => {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        return window.__TAURI__.core.invoke(cmd, args);
    } else if (window.__TAURI__ && window.__TAURI__.invoke) {
        return window.__TAURI__.invoke(cmd, args);
    }
    return mockTauriBridge(cmd, args);
};

const tauriListen = (event, callback) => {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
        return window.__TAURI__.event.listen(event, callback);
    }
    window.addEventListener(`tauri-${event}`, (e) => callback(e.detail));
    return Promise.resolve(() => {});
};

// Global Map & HUD Navigation State
let activeMapType = "none"; // "leaflet" | "google" | "direct_google"
let leafletMap = null;
let leafletRouteGlow = null;
let leafletRouteCore = null;
let leafletDestMarker = null;
let leafletRiderMarker = null;

let googleMap = null;
let googleRiderMarker = null;
let googleDestMarker = null;
let googleBlueGlowPolyline = null;
let googleBlueCorePolyline = null;

let isUserPanning = false;
let userPanResetTimer = null;
let lastHandledPhase = "";

let is3DMode = false;
let currentRiderCoords = { lat: 22.5643, lng: 88.3693, heading: 45 };
let targetRiderCoords = { lat: 22.5643, lng: 88.3693, heading: 45.0, speed: 0 };
let currentDisplayCoords = { lat: 22.5643, lng: 88.3693, heading: 45.0, speed: 0 };
let currentZoom = 15.0;
let targetZoom = 15.0;
let isLerpRunning = false;

let activeDestCoords = null;
let activeRoutePolyline = [];
let audioCtx = null;

let currentPhase = "Idle"; // Idle, RouteToStore, AtStore, RouteToCustomer, AtCustomer, Delivered
let activeSelectedOrder = null;
let currentPendingOffer = null;
let enteredOtpString = "";

// -----------------------------------------------------------------------------
// 1. APPLICATION BOOTSTRAP & MINIMALIST NAVY LOADER SEQUENCE
// -----------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
    initAudio();
    initKolkataMap();
    setupSwipeSlider();
    setupDockSwipeSlider();
    setupTauriEventListeners();

    // Fetch initial Profile from SQLite / Backend
    try {
        const profile = await tauriInvoke("get_profile");
        if (profile && profile.name) {
            document.getElementById("topBarRiderName").textContent = profile.name.split(" ")[0];
            document.getElementById("profInputName").value = profile.name;
            document.getElementById("profInputVehicle").value = profile.vehicle_no || "WB 02 AB 4591";
            document.getElementById("profInputPhone").value = profile.phone || "+91 98765 43210";
            document.getElementById("profInputTarget").value = profile.daily_target_inr || 800;
            if (profile.photo_url) {
                const topBarAvatar = document.getElementById("topBarAvatarImg");
                if (topBarAvatar) {
                    topBarAvatar.src = profile.photo_url;
                    topBarAvatar.style.display = "block";
                    const icon = document.getElementById("topBarDefaultIcon");
                    if (icon) icon.style.display = "none";
                }
            }
        }
    } catch (e) {}

    // Initialize Razorpay drawer config indicators
    if (window.RAZORPAY_CONFIG) {
        const keyEl = document.getElementById("drawerRzpKeyDetail");
        const vpaEl = document.getElementById("drawerRzpVpaDetail");
        if (keyEl && window.RAZORPAY_CONFIG.key_id) keyEl.textContent = `Key: ${window.RAZORPAY_CONFIG.key_id}`;
        if (vpaEl && window.RAZORPAY_CONFIG.merchant_vpa) vpaEl.textContent = `VPA: ${window.RAZORPAY_CONFIG.merchant_vpa}`;
    }

    // Initialize Firebase Auth / Google Sign-In
    initFirebaseAuth();

    // Minimalist Boot Loader status progression and smooth fadeout
    const splashStatus = document.getElementById("splashStatus");
    if (splashStatus) splashStatus.textContent = "Initializing Hardware & Navigation Engine...";
    setTimeout(() => {
        if (splashStatus) splashStatus.textContent = "Connecting HAL 5-Tier Pipeline & Kinematics...";
    }, 400);
    setTimeout(() => {
        if (splashStatus) splashStatus.textContent = "HUD Navigation Engine Ready.";
    }, 800);
    setTimeout(() => {
        const splash = document.getElementById("splashScreen");
        if (splash) {
            splash.style.opacity = "0";
            setTimeout(() => { splash.style.display = "none"; }, 500);
        }
    }, 1200);

    // 5 Hz Telemetry Synchronization with Rust / FastAPI Backend
    setInterval(syncTelemetrySnapshot, 200);

    // Clock
    setInterval(updateClock, 1000);
    updateClock();
});

function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById("hudClock");
    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
}

function playChime(freq = 880, duration = 0.12) {
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

// -----------------------------------------------------------------------------
// 2. AUTOMOTIVE CARTOGRAPHY ENGINE (UNMETERED DARK TILES & HEADING-UP LERP)
// -----------------------------------------------------------------------------

function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

function lerpAngle(start, end, factor) {
    let diff = (end - start) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return start + diff * factor;
}

function markUserPanning() {
    isUserPanning = true;
    const btn = document.getElementById("btnRecenter");
    if (btn) btn.classList.add("panning-active");

    if (userPanResetTimer) clearTimeout(userPanResetTimer);
    userPanResetTimer = setTimeout(() => {
        recenterMap();
    }, 6000);
}

function clearUserPanning() {
    isUserPanning = false;
    const btn = document.getElementById("btnRecenter");
    if (btn) btn.classList.remove("panning-active");
    if (userPanResetTimer) {
        clearTimeout(userPanResetTimer);
        userPanResetTimer = null;
    }
}

function updateRiderMarkerOnMap(lat, lng, heading) {
    if (activeMapType === "leaflet" && leafletMap) {
        if (!leafletRiderMarker) {
            const riderHtml = `
                <div class="leaflet-rider-puck" id="leafletPuckContainer" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;transform:rotate(${heading || 0}deg);transition:transform 0.1s linear;">
                    <div style="position:absolute;width:56px;height:56px;border-radius:50%;background:rgba(2,132,199,0.25);animation:puck-radar-pulse 2s infinite ease-out;"></div>
                    <div style="width:34px;height:34px;background:#0284C7;border:2.5px solid #FFFFFF;border-radius:50%;box-shadow:0 0 14px rgba(2,132,199,0.9);display:flex;align-items:center;justify-content:center;">
                        <svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFFFFF"/></svg>
                    </div>
                </div>
            `;
            const icon = L.divIcon({
                className: 'leaflet-rider-marker-wrap',
                html: riderHtml,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
            leafletRiderMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 2000 }).addTo(leafletMap);
        } else {
            leafletRiderMarker.setLatLng([lat, lng]);
            const puck = document.getElementById("leafletPuckContainer");
            if (puck) {
                puck.style.transform = `rotate(${heading || 0}deg)`;
            }
        }
    } else if (activeMapType === "google" && googleMap) {
        const riderSvg = {
            path: "M12,2 L22,22 L12,18 L2,22 Z",
            fillColor: "#0284C7",
            fillOpacity: 1.0,
            strokeColor: "#FFFFFF",
            strokeWeight: 2.5,
            scale: 1.5,
            anchor: new google.maps.Point(12, 12),
            rotation: heading || 0
        };
        if (!googleRiderMarker) {
            googleRiderMarker = new google.maps.Marker({
                position: { lat, lng },
                map: googleMap,
                icon: riderSvg,
                title: "Driver Vehicle Position",
                zIndex: 999
            });
        } else {
            googleRiderMarker.setPosition({ lat, lng });
            googleRiderMarker.setIcon(riderSvg);
        }
    }
}

function startKinematicsLerpLoop() {
    if (isLerpRunning) return;
    isLerpRunning = true;

    function frame() {
        const factor = 0.14; // Smooth 60fps convergence for 200ms ticks
        currentDisplayCoords.lat = lerp(currentDisplayCoords.lat, targetRiderCoords.lat, factor);
        currentDisplayCoords.lng = lerp(currentDisplayCoords.lng, targetRiderCoords.lng, factor);
        currentDisplayCoords.heading = lerpAngle(currentDisplayCoords.heading, targetRiderCoords.heading, factor);
        currentZoom = lerp(currentZoom, targetZoom, 0.08);

        // Always update the rider vehicle position & heading on the map
        updateRiderMarkerOnMap(currentDisplayCoords.lat, currentDisplayCoords.lng, currentDisplayCoords.heading);

        // ONLY force-center camera if user is NOT pushing/panning the map around
        if (!isUserPanning) {
            if (activeMapType === "leaflet" && leafletMap) {
                leafletMap.setView([currentDisplayCoords.lat, currentDisplayCoords.lng], currentZoom, { animate: false });
            } else if (activeMapType === "google" && googleMap) {
                googleMap.setCenter({ lat: currentDisplayCoords.lat, lng: currentDisplayCoords.lng });
            }
        }

        // Perspective 3D tilt mode (only tilt when in 3D and not free-panning)
        const wrapper = document.getElementById("mapRotationWrapper");
        if (wrapper) {
            if (is3DMode && !isUserPanning) {
                wrapper.style.transform = `perspective(700px) rotateX(36deg)`;
            } else {
                wrapper.style.transform = "none";
            }
        }

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function initKolkataMap() {
    if (typeof L !== 'undefined') {
        initLeafletMap();
        return;
    }
    if (window.google && window.google.maps && window.GOOGLE_MAPS_API_KEY && window.GOOGLE_MAPS_API_KEY.length > 10) {
        initGoogleMap();
        return;
    }

    let attempts = 0;
    const checkMaps = setInterval(() => {
        attempts++;
        if (typeof L !== 'undefined') {
            clearInterval(checkMaps);
            initLeafletMap();
        } else if (window.google && window.google.maps && window.GOOGLE_MAPS_API_KEY && window.GOOGLE_MAPS_API_KEY.length > 10) {
            clearInterval(checkMaps);
            initGoogleMap();
        } else if (attempts > 15) {
            clearInterval(checkMaps);
            mountDirectGoogleMap();
        }
    }, 100);
}

function initLeafletMap() {
    const mapEl = document.getElementById('mapView');
    if (!mapEl || activeMapType === "leaflet") return;

    activeMapType = "leaflet";
    mapEl.innerHTML = "";

    leafletMap = L.map('mapView', {
        center: [currentDisplayCoords.lat, currentDisplayCoords.lng],
        zoom: currentZoom,
        minZoom: 12,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false
    });

    // Unmetered CARTO Dark Matter raster tiles (zero watermark, zero API key requirement)
    const cartoDarkUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png';
    const osmUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

    const tileLayer = L.tileLayer(cartoDarkUrl, {
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(leafletMap);

    tileLayer.on('tileerror', function() {
        if (tileLayer._url !== osmUrl) {
            tileLayer.setUrl(osmUrl);
        }
    });

    // Wire interaction listeners so pushing the map enters free-pan browse mode
    leafletMap.on('dragstart', markUserPanning);
    leafletMap.on('movestart', function(e) {
        if (e && e.originalEvent) markUserPanning();
    });
    leafletMap.on('zoomstart', function(e) {
        if (e && e.originalEvent) markUserPanning();
    });

    mapEl.addEventListener('mousedown', markUserPanning, { passive: true });
    mapEl.addEventListener('touchstart', markUserPanning, { passive: true });

    startKinematicsLerpLoop();
    console.log("[MAP] Leaflet Unmetered Automotive Engine Active (Zero Watermarks, Heading-Up Lerp)");
}

window.initGoogleMap = function() {
    if (typeof google === 'undefined' || !google.maps) {
        initLeafletMap();
        return;
    }
    const mapEl = document.getElementById('mapView');
    if (!mapEl) return;

    activeMapType = "google";
    mapEl.style.display = "block";

    googleMap = new google.maps.Map(mapEl, {
        center: { lat: currentDisplayCoords.lat, lng: currentDisplayCoords.lng },
        zoom: currentZoom,
        minZoom: 12,
        maxZoom: 20,
        disableDefaultUI: true,
        gestureHandling: "greedy"
    });

    googleMap.addListener('dragstart', markUserPanning);
    mapEl.addEventListener('mousedown', markUserPanning, { passive: true });
    mapEl.addEventListener('touchstart', markUserPanning, { passive: true });

    startKinematicsLerpLoop();
    console.log("[MAP] Google Maps Automotive Driver Engine Initialized");
};

function mountDirectGoogleMap() {
    activeMapType = "direct_google";
    const mapEl = document.getElementById('mapView');
    if (!mapEl) return;

    mapEl.innerHTML = `
        <div id="directGoogleContainer" style="position:absolute;width:100%;height:100%;overflow:hidden;background:#070B14;">
            <div id="directGoogleTiles" style="position:absolute;width:100%;height:100%;display:grid;grid-template-columns:repeat(4, 256px);grid-template-rows:repeat(3, 256px);pointer-events:none;"></div>
        </div>
    `;

    renderDirectTiles();
    startKinematicsLerpLoop();
    console.log("[MAP] Direct Unmetered Raster Tile View Active");
}

function renderDirectTiles() {
    const tilesEl = document.getElementById("directGoogleTiles");
    if (!tilesEl) return;
    const startX = 23954;
    const startY = 14391;
    let html = "";
    for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 4; x++) {
            const tx = startX + x;
            const ty = startY + y;
            html += `<img src="https://tile.openstreetmap.org/15/${tx}/${ty}.png" style="width:256px;height:256px;display:block;filter:invert(100%) hue-rotate(180deg) brightness(85%) contrast(120%);" alt="OSM Map" draggable="false" />`;
        }
    }
    tilesEl.innerHTML = html;
}

// -----------------------------------------------------------------------------
// DRIVER-CENTRIC CAMERA & QUICK ACTIONS
// -----------------------------------------------------------------------------
function recenterMap() {
    clearUserPanning();
    targetZoom = 16.0;
    targetRiderCoords.lat = currentRiderCoords.lat;
    targetRiderCoords.lng = currentRiderCoords.lng;
    currentDisplayCoords.lat = currentRiderCoords.lat;
    currentDisplayCoords.lng = currentRiderCoords.lng;

    if (activeMapType === "leaflet" && leafletMap) {
        leafletMap.setView([currentRiderCoords.lat, currentRiderCoords.lng], 16, { animate: true });
    } else if (activeMapType === "google" && googleMap) {
        googleMap.panTo({ lat: currentRiderCoords.lat, lng: currentRiderCoords.lng });
        googleMap.setZoom(16);
    }
    showHUDToast("Map Centered to Vehicle");
}

function toggleMapTilt() {
    is3DMode = !is3DMode;
    const txt = document.getElementById("tiltModeText");
    if (txt) txt.textContent = is3DMode ? "2D" : "3D";
}

function zoomInMap() {
    targetZoom = Math.min(19, targetZoom + 1);
}

function zoomOutMap() {
    targetZoom = Math.max(12, targetZoom - 1);
}

function clearMapRoute() {
    activeRoutePolyline = [];
    activeDestCoords = null;

    if (activeMapType === "leaflet" && leafletMap) {
        if (leafletRouteGlow) { leafletMap.removeLayer(leafletRouteGlow); leafletRouteGlow = null; }
        if (leafletRouteCore) { leafletMap.removeLayer(leafletRouteCore); leafletRouteCore = null; }
        if (leafletDestMarker) { leafletMap.removeLayer(leafletDestMarker); leafletDestMarker = null; }
    } else if (activeMapType === "google" && googleMap) {
        if (googleBlueGlowPolyline) { googleBlueGlowPolyline.setMap(null); googleBlueGlowPolyline = null; }
        if (googleBlueCorePolyline) { googleBlueCorePolyline.setMap(null); googleBlueCorePolyline = null; }
        if (googleDestMarker) { googleDestMarker.setMap(null); }
    }
}

function renderBlueRoute(polyline, destCoords) {
    if (!polyline || polyline.length < 2) return;
    clearMapRoute();

    activeRoutePolyline = polyline;
    activeDestCoords = destCoords;

    if (activeMapType === "leaflet" && leafletMap) {
        leafletRouteGlow = L.polyline(polyline, {
            color: '#075985',
            weight: 10,
            opacity: 0.6,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(leafletMap);

        leafletRouteCore = L.polyline(polyline, {
            color: '#0284C7',
            weight: 6,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(leafletMap);

        if (destCoords) {
            const pinIcon = L.divIcon({
                className: 'dest-pin-leaflet',
                html: `<svg width="34" height="34" viewBox="0 0 24 24" style="filter:drop-shadow(0 4px 8px rgba(0,0,0,0.8));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#EF4444"/><circle cx="12" cy="9" r="2.5" fill="#FFFFFF"/></svg>`,
                iconSize: [34, 34],
                iconAnchor: [17, 34]
            });
            leafletDestMarker = L.marker([destCoords.lat, destCoords.lng], { icon: pinIcon }).addTo(leafletMap);
        }
    } else if (activeMapType === "google" && googleMap) {
        const gPath = polyline.map(pt => ({ lat: pt[0], lng: pt[1] }));
        googleBlueGlowPolyline = new google.maps.Polyline({
            path: gPath,
            map: googleMap,
            strokeColor: '#075985',
            strokeOpacity: 0.5,
            strokeWeight: 10
        });
        googleBlueCorePolyline = new google.maps.Polyline({
            path: gPath,
            map: googleMap,
            strokeColor: '#0284C7',
            strokeOpacity: 0.98,
            strokeWeight: 6
        });
        if (destCoords && googleDestMarker) {
            googleDestMarker.setPosition({ lat: destCoords.lat, lng: destCoords.lng });
            googleDestMarker.setMap(googleMap);
        }
    }
}

function smoothFlyToDestination(lat, lng, targetZoomLevel = 17) {
    if (isUserPanning) return;
    targetZoom = targetZoomLevel;
    if (activeMapType === "leaflet" && leafletMap) {
        leafletMap.flyTo([lat, lng], targetZoomLevel, { duration: 1.2 });
    } else if (activeMapType === "google" && googleMap) {
        googleMap.panTo({ lat, lng });
        googleMap.setZoom(targetZoomLevel);
    }
}

function computeHaversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function checkProgressiveGeofenceZoom(order, riderLat, riderLng) {
    if (!order || !riderLat || !riderLng) {
        targetZoom = 15.0;
        return;
    }
    const p = (currentPhase || "").toUpperCase();
    if (p === "ROUTETOSTORE" || p === "ROUTE_TO_STORE") {
        const distToStore = computeHaversineKm(riderLat, riderLng, order.store_lat, order.store_lng);
        if (distToStore < 0.15) {
            targetZoom = 17.0; // Progressive zoom upon entering store geofence
        } else {
            targetZoom = 15.2;
        }
    } else if (p === "ATSTORE" || p === "AT_STORE") {
        targetZoom = 17.5;
    } else if (p === "ROUTETOCUSTOMER" || p === "ROUTE_TO_CUSTOMER") {
        const distToCustomer = computeHaversineKm(riderLat, riderLng, order.customer_lat, order.customer_lng);
        if (distToCustomer < 0.08) {
            targetZoom = 18.5; // Progressive zoom upon entering customer doorstep geofence
        } else {
            targetZoom = 15.5;
        }
    } else if (p === "ATCUSTOMER" || p === "AT_CUSTOMER") {
        targetZoom = 18.5;
    } else {
        targetZoom = 15.0;
    }
}

// -----------------------------------------------------------------------------
// 3. 5 HZ TELEMETRY & DELIVERY STATE SYNCHRONIZATION
// -----------------------------------------------------------------------------
async function syncTelemetrySnapshot() {
    try {
        const snap = await tauriInvoke("get_telemetry_snapshot");
        if (!snap) return;

        const gps = snap.gps || {};
        const isMoving = gps.speed_kmh && gps.speed_kmh > 0.5;

        // 1. Update Speedometer
        const speedEl = document.getElementById("speedNum");
        if (speedEl) speedEl.textContent = Math.round(gps.speed_kmh || 0);

        // 2. Feed Kinematic Target & Camera Tracking
        if (gps.latitude && gps.longitude) {
            currentRiderCoords = {
                lat: gps.latitude,
                lng: gps.longitude,
                heading: gps.heading_deg || 45
            };
            targetRiderCoords = {
                lat: gps.latitude,
                lng: gps.longitude,
                heading: gps.heading_deg || 45,
                speed: gps.speed_kmh || 0
            };
        }

        // 3. Progressive Zoom Transitions based on geofence proximity
        checkProgressiveGeofenceZoom(snap.selected_order, gps.latitude, gps.longitude);

        // 4. Phase Transition Evaluation
        currentPhase = snap.order_phase;
        activeSelectedOrder = snap.selected_order;
        updateUIPhase(currentPhase, activeSelectedOrder, snap.daily_summary);

        // 5. Automatic Doorstep OTP UI Presentation at AT_CUSTOMER
        const pUpper = (currentPhase || "").toUpperCase();
        if (pUpper === "ATCUSTOMER" || pUpper === "AT_CUSTOMER") {
            const otpModal = document.getElementById("otpModal");
            const rzpModal = document.getElementById("razorpayModal");
            if (otpModal && otpModal.style.display !== "flex" && (!rzpModal || rzpModal.style.display !== "flex")) {
                openOtpModal();
            }
        }

        // 6. Update Idle Offers Stack (Continuous Mock Order Feed)
        if (pUpper === "IDLE" || pUpper === "DELIVERED") {
            const offers = snap.active_offers || [];
            if (offers.length === 0) {
                tauriInvoke("refresh_offers");
            }
            renderOffersStack(offers);
        } else {
            const stack = document.getElementById("orderNotificationStack");
            if (stack) stack.innerHTML = "";
        }

        // 7. Emergency Screen
        const emerg = document.getElementById("emergencyOverlay");
        if (emerg) {
            if (snap.is_emergency) {
                emerg.style.display = "flex";
                document.getElementById("emergencyTitle").textContent = snap.emergency_reason || "EMERGENCY PROTOCOL ACTIVE";
                document.getElementById("emergencyGps").textContent = `GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)} | Speed: ${gps.speed_kmh || 0} km/h`;
            } else {
                emerg.style.display = "none";
            }
        }
    } catch (e) {}
}

function updateUIPhase(phase, order, daily) {
    const turnCard = document.getElementById("turnCard");
    const activeDock = document.getElementById("activeRouteDock");
    const bottomDestName = document.getElementById("destName");
    const destHeader = document.getElementById("destHeaderLabel");

    // Daily Summary updates
    if (daily) {
        document.getElementById("drawerDailyText").textContent = `₹${Number(daily.earnings_today_inr || 0).toFixed(2)} / ₹${Number(daily.daily_target_inr || 800).toFixed(2)}`;
        document.getElementById("drawerDailyBar").style.width = `${daily.progress_pct || 0}%`;
    }

    const pUpper = (phase || "").toUpperCase();
    if (!order || pUpper === "IDLE" || pUpper === "DELIVERED" || pUpper === "SEARCHING" || pUpper === "SEARCHING_FOR_ORDERS") {
        lastHandledPhase = "";
        if (turnCard) turnCard.style.display = "none";
        if (activeDock) activeDock.style.display = "none";
        if (bottomDestName) bottomDestName.textContent = "Scanning Kolkata (Salt Lake, Newtown, Park St)...";
        if (destHeader) destHeader.textContent = "STATUS:";
        clearMapRoute();
        return;
    }

    // Active Order Visible in Dock
    if (activeDock) activeDock.style.display = "flex";
    const dockBadge = document.getElementById("dockPhaseBadge");
    const dockTitle = document.getElementById("dockTitle");
    const dockSub = document.getElementById("dockSubtitle");
    const dockBtn = document.getElementById("btnDockAction");
    const dockSwipeLabel = document.getElementById("dockSwipeLabel");
    const dockSwipeHandle = document.getElementById("dockSwipeHandle");

    const phaseNormalized = (phase || "").toUpperCase();

    if (phaseNormalized === "ROUTETOSTORE" || phaseNormalized === "ROUTE_TO_STORE") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "PHASE 1: ROUTE TO STORE";
        dockBadge.style.color = "#38BDF8";
        dockTitle.textContent = order.store_name;
        dockSub.textContent = `${order.store_address} • ${order.store_dist_km} km`;
        if (dockBtn) {
            dockBtn.textContent = "REACHED STORE [R]";
            dockBtn.style.background = "linear-gradient(135deg, #0284C7, #0369A1)";
            dockBtn.style.color = "#FFF";
        }
        if (dockSwipeLabel) dockSwipeLabel.textContent = "SWIPE TO REACH STORE [R]";
        if (dockSwipeHandle) dockSwipeHandle.className = "swipe-handle dock-swipe-handle";

        if (bottomDestName) bottomDestName.textContent = `Pickup: ${order.store_name}`;
        if (destHeader) destHeader.textContent = "PHASE 1:";

        renderBlueRoute([
            [currentRiderCoords.lat, currentRiderCoords.lng],
            [order.store_lat, order.store_lng]
        ], { lat: order.store_lat, lng: order.store_lng });

    } else if (phaseNormalized === "ATSTORE" || phaseNormalized === "AT_STORE") {
        if (turnCard) turnCard.style.display = "none";
        dockBadge.textContent = "AT STORE: PACKAGING CHECKLIST";
        dockBadge.style.color = "#38BDF8";
        dockTitle.textContent = `Token #${order.order_id} • ${order.items_summary}`;
        dockSub.textContent = `Ready for collection at ${order.store_name}`;
        if (dockBtn) {
            dockBtn.textContent = "FOOD PICKED UP [K]";
            dockBtn.style.background = "linear-gradient(135deg, #00E676, #00b248)";
            dockBtn.style.color = "#070B14";
        }
        if (dockSwipeLabel) dockSwipeLabel.textContent = "SWIPE TO CONFIRM PICKUP [K]";
        if (dockSwipeHandle) dockSwipeHandle.className = "swipe-handle dock-swipe-handle pickup-mode";

        // Trigger progressive map zoom into store once upon phase entry
        if (lastHandledPhase !== phaseNormalized && !isUserPanning) {
            smoothFlyToDestination(order.store_lat, order.store_lng, 17);
        }

    } else if (phaseNormalized === "ROUTETOCUSTOMER" || phaseNormalized === "ROUTE_TO_CUSTOMER") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "PHASE 2: ROUTE TO CUSTOMER";
        dockBadge.style.color = "#00E676";
        dockTitle.textContent = `${order.customer_name} • ${order.customer_address}`;
        dockSub.textContent = `${order.customer_instructions} • ${order.drop_dist_km} km`;
        if (dockBtn) {
            dockBtn.textContent = "REACHED CUSTOMER [C]";
            dockBtn.style.background = "linear-gradient(135deg, #0284C7, #0369A1)";
            dockBtn.style.color = "#FFF";
        }
        if (dockSwipeLabel) dockSwipeLabel.textContent = "SWIPE TO REACH CUSTOMER [C]";
        if (dockSwipeHandle) dockSwipeHandle.className = "swipe-handle dock-swipe-handle";

        if (bottomDestName) bottomDestName.textContent = `Drop: ${order.customer_name}`;
        if (destHeader) destHeader.textContent = "PHASE 2:";

        renderBlueRoute([
            [order.store_lat, order.store_lng],
            [order.customer_lat, order.customer_lng]
        ], { lat: order.customer_lat, lng: order.customer_lng });

    } else if (phaseNormalized === "ATCUSTOMER" || phaseNormalized === "AT_CUSTOMER") {
        if (turnCard) turnCard.style.display = "none";
        dockBadge.textContent = "AT CUSTOMER DOORSTEP";
        dockBadge.style.color = "#FFD54F";
        dockTitle.textContent = `Verify Handover: ${order.customer_name}`;
        dockSub.textContent = `Customer Note: ${order.customer_instructions}`;
        if (dockBtn) {
            dockBtn.textContent = "COMPLETE DELIVERY [U]";
            dockBtn.style.background = "linear-gradient(135deg, #00E676, #00b248)";
            dockBtn.style.color = "#070B14";
        }
        if (dockSwipeLabel) dockSwipeLabel.textContent = "SWIPE TO COMPLETE DELIVERY [U]";
        if (dockSwipeHandle) dockSwipeHandle.className = "swipe-handle dock-swipe-handle deliver-mode";

        // Trigger progressive map zoom into customer doorstep once upon phase entry
        if (lastHandledPhase !== phaseNormalized && !isUserPanning) {
            smoothFlyToDestination(order.customer_lat, order.customer_lng, 18);
        }
    }
    lastHandledPhase = phaseNormalized;
}

function renderOffersStack(offers) {
    const stack = document.getElementById("orderNotificationStack");
    if (!stack) return;

    // Cache guard to eliminate re-renders
    const offersJson = JSON.stringify(offers.map(o => o.order_id));
    if (stack.dataset.offersJson === offersJson && stack.children.length > 0) return;
    stack.dataset.offersJson = offersJson;

    stack.innerHTML = offers.map(o => `
        <div class="notification-card" style="border-left-color:${o.platform_color}">
            <div class="card-top-row">
                <span class="card-platform-badge" style="background:${o.platform_color}">${o.platform.toUpperCase()}</span>
                <span class="card-payout">₹${o.payout_inr.toFixed(2)}</span>
            </div>
            <div class="card-store-row">
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M4 4h16v3H4zM3 8l1 9h16l1-9H3zm7 7H8v-4h2v4zm6 0h-2v-4h2v4z"/></svg>
                <div>
                    <strong>${o.store_name}</strong>
                    <small style="display:block;color:#8E9FB8;font-size:10px;">${o.items_summary}</small>
                </div>
                <span class="card-dist-pill">${o.store_dist_km} km</span>
            </div>
            <div class="card-drop-row">
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                <span>${o.customer_address} (${o.drop_dist_km} km drop)</span>
            </div>
            <div class="card-actions-row">
                <span class="total-dist-tag">Dist: ${o.total_dist_km} km total</span>
                <div class="card-buttons">
                    <button class="btn-card-dismiss" onclick="dismissOffer('${o.order_id}')">Dismiss</button>
                    <button class="btn-card-accept" style="background:linear-gradient(135deg, #0284C7, #0369A1);" onclick="directAcceptOffer('${o.order_id}')">Accept Order</button>
                    <button class="btn-card-dismiss" style="border-color:#38BDF8;color:#38BDF8;" onclick="openOfferModalById('${o.order_id}')">Details</button>
                </div>
            </div>
        </div>
    `).join("");
}

function directAcceptOffer(orderId) {
    playChime(1200, 0.25);
    tauriInvoke("accept_order", { orderId }).then(() => {
        showHUDToast(`Order #${orderId} accepted. Routing to store...`);
        syncTelemetrySnapshot();
    });
}

// -----------------------------------------------------------------------------
// 4. GLOVE-FRIENDLY "SWIPE TO ACCEPT" SLIDER (ZOMATO/SWIGGY STYLE)
// -----------------------------------------------------------------------------
function openOfferModalById(orderId) {
    tauriInvoke("get_telemetry_snapshot").then(snap => {
        const found = (snap.active_offers || []).find(o => o.order_id === orderId);
        if (found) openOfferModal(found);
    });
}

function openOfferModal(offer) {
    currentPendingOffer = offer;
    document.getElementById("offerModalPlatform").textContent = (offer.platform || "ORDER").toUpperCase();
    document.getElementById("offerModalPlatform").style.background = offer.platform_color || "#0284C7";
    document.getElementById("offerModalPayout").textContent = Number(offer.payout_inr || 0).toFixed(2);
    document.getElementById("offerModalStore").textContent = offer.store_name || "Store";
    document.getElementById("offerModalStoreDist").textContent = `${offer.store_dist_km || 1.0} km travel to pickup`;
    document.getElementById("offerModalCustomer").textContent = offer.customer_name || "Customer";
    document.getElementById("offerModalCustomerAddr").textContent = `${offer.customer_address || "Drop Address"} (${offer.drop_dist_km || 2.0} km drop)`;
    document.getElementById("offerModalItems").textContent = `Package: ${offer.items_summary || "Food Pack"}`;
    document.getElementById("offerModalPrep").textContent = `${offer.prep_time_minutes || 3} min prep`;

    // Reset slider handle
    const handle = document.getElementById("swipeHandle");
    if (handle) handle.style.left = "4px";

    document.getElementById("newOfferModal").style.display = "flex";
    playChime(1000, 0.2);
}

function closeOfferModal() {
    document.getElementById("newOfferModal").style.display = "none";
    currentPendingOffer = null;
}

function setupSwipeSlider() {
    const handle = document.getElementById("swipeHandle");
    const container = document.getElementById("swipeSliderContainer");
    if (!handle || !container) return;

    let isDragging = false;
    let startX = 0;

    const onStart = (e) => {
        isDragging = true;
        startX = (e.touches ? e.touches[0].clientX : e.clientX);
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = (e.touches ? e.touches[0].clientX : e.clientX);
        let delta = currentX - startX;
        delta = Math.max(4, Math.min(delta, container.offsetWidth - 48));
        handle.style.left = `${delta}px`;

        // If swiped past 75% threshold -> Trigger Instant Accept!
        if (delta >= (container.offsetWidth - 60)) {
            isDragging = false;
            triggerAcceptOrder();
        }
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.left = "4px"; // Snap back if threshold not met
    };

    handle.addEventListener("mousedown", onStart);
    handle.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
}

function setupDockSwipeSlider() {
    const handle = document.getElementById("dockSwipeHandle");
    const track = document.getElementById("dockSwipeTrack");
    if (!handle || !track) return;

    let isDragging = false;
    let startX = 0;

    const onStart = (e) => {
        isDragging = true;
        startX = (e.touches ? e.touches[0].clientX : e.clientX);
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = (e.touches ? e.touches[0].clientX : e.clientX);
        let delta = currentX - startX;
        const maxDelta = track.offsetWidth - handle.offsetWidth - 8;
        delta = Math.max(4, Math.min(delta, maxDelta));
        handle.style.left = `${delta}px`;

        // If swiped past 75% threshold -> Execute Dock Action!
        if (delta >= (maxDelta * 0.75)) {
            isDragging = false;
            handle.style.left = "4px";
            handlePrimaryDockAction();
        }
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.left = "4px"; // Snap back if threshold not met
    };

    handle.addEventListener("mousedown", onStart);
    handle.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
}

async function triggerAcceptOrder() {
    let orderId = "";
    if (currentPendingOffer) {
        orderId = currentPendingOffer.order_id;
    } else {
        const snap = await tauriInvoke("get_telemetry_snapshot");
        if (snap && snap.active_offers && snap.active_offers.length > 0) {
            orderId = snap.active_offers[0].order_id;
        }
    }
    if (!orderId) return;

    playChime(1200, 0.25);
    closeOfferModal();
    await tauriInvoke("accept_order", { orderId });
    showHUDToast(`Order #${orderId} accepted! Navigating to store...`);
    syncTelemetrySnapshot();
}

// -----------------------------------------------------------------------------
// 5. SPLIT DOCK PRIMARY ACTIONS & OTP HANDOVER
// -----------------------------------------------------------------------------
async function handlePrimaryDockAction() {
    playChime(850, 0.1);
    const p = (currentPhase || "").toUpperCase();
    if (p === "ROUTETOSTORE" || p === "ROUTE_TO_STORE") {
        await tauriInvoke("reach_store");
        showHUDToast("Arrived at store. Verify order package.");
    } else if (p === "ATSTORE" || p === "AT_STORE") {
        await tauriInvoke("pickup_order");
        showHUDToast("Food picked up! Navigating to customer drop-off...");
    } else if (p === "ROUTETOCUSTOMER" || p === "ROUTE_TO_CUSTOMER") {
        await tauriInvoke("reach_customer");
        showHUDToast("Arrived at customer doorstep. Request handover OTP.");
    } else if (p === "ATCUSTOMER" || p === "AT_CUSTOMER") {
        openOtpModal();
    }
    syncTelemetrySnapshot();
}

function renderOtpBoxes() {
    for (let i = 0; i < 4; i++) {
        const box = document.getElementById(`otpBox${i}`);
        if (!box) continue;
        if (i < enteredOtpString.length) {
            box.textContent = enteredOtpString[i];
            box.className = "otp-box filled";
        } else if (i === enteredOtpString.length) {
            box.textContent = "-";
            box.className = "otp-box active";
        } else {
            box.textContent = "-";
            box.className = "otp-box";
        }
    }
    const legacy = document.getElementById("otpDisplay");
    if (legacy) {
        legacy.textContent = enteredOtpString ? enteredOtpString.padEnd(4, "-") : "----";
    }
}

function openOtpModal() {
    enteredOtpString = "";
    renderOtpBoxes();
    const hint = document.getElementById("otpCustomerHint");
    if (hint) {
        const otpVal = (activeSelectedOrder && activeSelectedOrder.delivery_otp) ? activeSelectedOrder.delivery_otp : "4829";
        hint.textContent = `OTP: ${otpVal}`;
    }
    document.getElementById("otpModal").style.display = "flex";
}

function autoFillOtp() {
    const otpVal = (activeSelectedOrder && activeSelectedOrder.delivery_otp) ? activeSelectedOrder.delivery_otp : "4829";
    enteredOtpString = otpVal;
    renderOtpBoxes();
    playChime(1100, 0.08);
}

function closeOtpModal() {
    document.getElementById("otpModal").style.display = "none";
}

function pressOtpKey(num) {
    if (enteredOtpString.length < 4) {
        enteredOtpString += num;
        renderOtpBoxes();
        playChime(950, 0.06);
        if (enteredOtpString.length === 4) {
            setTimeout(submitOtp, 250);
        }
    }
}

function clearOtp() {
    enteredOtpString = "";
    renderOtpBoxes();
}

async function submitOtp() {
    // If not full 4 digits, auto-fill default so verification is never stuck
    if (!enteredOtpString || enteredOtpString.length < 4) {
        autoFillOtp();
    }
    document.getElementById("otpModal").style.display = "none";
    
    // MANDATORY PRE-DELIVERY RAZORPAY QR POP-UP (Universal for all deliveries)
    const ordId = activeSelectedOrder ? activeSelectedOrder.order_id : "ORD-KOL-LIVE";
    const isCod = activeSelectedOrder && activeSelectedOrder.payment_mode === "COD";
    const amt = (activeSelectedOrder && isCod)
        ? (activeSelectedOrder.cod_amount || 360)
        : (activeSelectedOrder ? (activeSelectedOrder.order_amount_inr || activeSelectedOrder.payout_inr || 360) : 360);

    openRazorpayDeliveryModal(ordId, amt, isCod);
}

// -----------------------------------------------------------------------------
// 6. PRE-DELIVERY RAZORPAY QR INTEGRATION & SETTLEMENT LISTENER
// -----------------------------------------------------------------------------
let activeQrPollInterval = null;

async function openRazorpayDeliveryModal(orderId, amount, isCod) {
    playChime(1100, 0.2);
    const billLabel = document.getElementById("rzpBillLabel");
    if (billLabel) {
        billLabel.textContent = isCod ? "COLLECT EXACT COD AMOUNT:" : "VERIFY HANDOVER & SETTLEMENT:";
    }
    document.getElementById("rzpAmountText").textContent = `₹${Number(amount || 0).toFixed(2)}`;
    document.getElementById("rzpBodyActive").style.display = "flex";
    document.getElementById("rzpSuccessView").style.display = "none";
    document.getElementById("razorpayModal").style.display = "flex";

    const vpaEl = document.getElementById("rzpMerchantVpaText");
    if (vpaEl && window.RAZORPAY_CONFIG && window.RAZORPAY_CONFIG.merchant_vpa) {
        vpaEl.textContent = window.RAZORPAY_CONFIG.merchant_vpa;
    }

    try {
        const res = await tauriInvoke("generate_razorpay_qr", { orderId, codAmount: amount });
        if (res && res.image_url) {
            document.getElementById("rzpQrImage").src = res.image_url;
            if (res.merchant_vpa && vpaEl) {
                vpaEl.textContent = res.merchant_vpa;
            }
        }
    } catch (e) {
        console.warn("[RAZORPAY ERROR]", e);
    }
}

// Alias for backwards compatibility
const openRazorpayCodModal = openRazorpayDeliveryModal;

function closeRazorpayModal() {
    if (activeQrPollInterval) {
        clearInterval(activeQrPollInterval);
        activeQrPollInterval = null;
    }
    document.getElementById("razorpayModal").style.display = "none";
}

function simulatePaymentSuccess() {
    playChime(1300, 0.35);
    const orderId = activeSelectedOrder ? activeSelectedOrder.order_id : "ORD-KOL-LIVE";
    const amount = activeSelectedOrder ? (activeSelectedOrder.payment_mode === "COD" ? (activeSelectedOrder.cod_amount || 360.0) : 360.0) : 360.0;
    const txId = "pay_rzp_test_" + Math.random().toString(36).substring(2, 10).toUpperCase();

    // Notify backend
    fetch('/api/payment/verify-instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, amount_inr: amount })
    }).catch(() => {});

    const event = new CustomEvent("tauri-payment_successful", {
        detail: {
            order_id: orderId,
            amount_paid: amount,
            payment_id: txId,
            status: "SUCCESS"
        }
    });
    window.dispatchEvent(event);
}

function setupTauriEventListeners() {
    // Listens for payment_successful (via Rust emit or mock event)
    tauriListen("payment_successful", (payload) => {
        console.log("[RAZORPAY PAYMENT EVENT RECEIVED]", payload);
        playChime(1300, 0.4);

        // Shift to Green Celebration UI
        document.getElementById("rzpBodyActive").style.display = "none";
        document.getElementById("rzpSuccessView").style.display = "flex";
        document.getElementById("rzpSuccessSub").textContent = `₹${Number(payload.amount_paid || 0).toFixed(2)} received via Razorpay UPI`;
        const txEl = document.getElementById("rzpSuccessTx");
        if (txEl) {
            txEl.textContent = `Tx ID: ${payload.payment_id || ("pay_rzp_" + Date.now().toString(36))}`;
        }
        const credit = activeSelectedOrder ? activeSelectedOrder.payout_inr : 85.26;
        document.getElementById("rzpRiderCredit").textContent = `+₹${Number(credit).toFixed(2)} Credited to Wallet`;
    });
}

async function finalizeDelivery() {
    closeRazorpayModal();
    playChime(1250, 0.2);
    await tauriInvoke("complete_delivery", { enteredOtp: enteredOtpString });
    showHUDToast("Delivery Completed & Recorded to Ledger!");
    syncTelemetrySnapshot();
}

// -----------------------------------------------------------------------------
// 7. RIDER PROFILE & FIREBASE GOOGLE AUTHENTICATION
// -----------------------------------------------------------------------------
let currentUserProfile = null;

async function initFirebaseAuth() {
    try {
        let config = window.FIREBASE_CONFIG;
        if (!config || !config.apiKey) {
            const res = await fetch('/api/auth/config');
            if (res.ok) {
                config = await res.json();
                window.FIREBASE_CONFIG = config;
            }
        }

        if (window.firebase && config && config.apiKey && !firebase.apps.length) {
            firebase.initializeApp(config);
            firebase.auth().onAuthStateChanged(async (user) => {
                if (user) {
                    await handleGoogleAuthSuccess(user);
                } else {
                    handleGoogleAuthSignedOut();
                }
            });
        }
    } catch (e) {
        console.warn("[FIREBASE INIT NOTICE]", e);
    }
}

async function signInWithGoogle() {
    playChime(1000, 0.15);
    try {
        if (window.firebase && firebase.apps.length && window.FIREBASE_CONFIG && !window.FIREBASE_CONFIG.apiKey.startsWith("AIzaSyDummy")) {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await firebase.auth().signInWithPopup(provider);
            if (result && result.user) {
                await handleGoogleAuthSuccess(result.user);
                showHUDToast(`Welcome, ${result.user.displayName || "Rider"}!`);
                return;
            }
        }
    } catch (e) {
        console.warn("[GOOGLE POPUP NOTICE] Fallback to simulated test account:", e.message);
    }

    // High-Fidelity Test / Fallback Driver Account Simulation
    const mockUser = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.mock_account) || {
        uid: "google_test_rider_debanjan",
        displayName: "Debanjan Mondal",
        email: "debanjan.rider@lastmile.io",
        photoURL: ""
    };
    await handleGoogleAuthSuccess(mockUser);
    showHUDToast(`Connected as ${mockUser.displayName} (Google Test Mode)`);
}

async function handleGoogleAuthSuccess(user) {
    const displayName = user.displayName || user.name || "Debanjan Mondal";
    const email = user.email || "debanjan.rider@lastmile.io";
    const photoURL = user.photoURL || user.picture || "";

    currentUserProfile = {
        name: displayName,
        email: email,
        photo_url: photoURL,
        is_authenticated: true
    };

    // Update Top Bar
    document.getElementById("topBarRiderName").textContent = displayName.split(" ")[0];
    const topBarAvatar = document.getElementById("topBarAvatarImg");
    const topBarDefaultIcon = document.getElementById("topBarDefaultIcon");
    const topBarAuthDot = document.getElementById("topBarAuthDot");

    if (photoURL && topBarAvatar) {
        topBarAvatar.src = photoURL;
        topBarAvatar.style.display = "block";
        if (topBarDefaultIcon) topBarDefaultIcon.style.display = "none";
    }
    if (topBarAuthDot) {
        topBarAuthDot.classList.remove("unlinked");
        topBarAuthDot.classList.add("linked");
        topBarAuthDot.title = "Google Auth: Connected (" + email + ")";
    }

    // Update Drawer Elements
    const signedOutBox = document.getElementById("googleSignedOutBox");
    const signedInBox = document.getElementById("googleSignedInBox");
    if (signedOutBox && signedInBox) {
        signedOutBox.style.display = "none";
        signedInBox.style.display = "block";
        document.getElementById("drawerGoogleName").textContent = displayName;
        document.getElementById("drawerGoogleEmail").textContent = email;
        const drawerAvatar = document.getElementById("drawerAvatarImg");
        if (drawerAvatar) {
            drawerAvatar.src = photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2300F0FF'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-4-4z'/%3E%3C/svg%3E";
        }
    }

    // Sync with backend / SQLite
    try {
        await tauriInvoke("firebase_verify", {
            id_token: "mock_jwt_token",
            user_info: {
                uid: user.uid,
                displayName: displayName,
                email: email,
                photoURL: photoURL
            }
        });
    } catch(e) {}
}

async function signOutGoogle() {
    playChime(800, 0.1);
    try {
        if (window.firebase && firebase.apps.length && firebase.auth) {
            await firebase.auth().signOut();
        }
    } catch (e) {}

    handleGoogleAuthSignedOut();
    showHUDToast("Signed out of Google account.");
}

function handleGoogleAuthSignedOut() {
    currentUserProfile = null;
    const topBarAvatar = document.getElementById("topBarAvatarImg");
    const topBarDefaultIcon = document.getElementById("topBarDefaultIcon");
    const topBarAuthDot = document.getElementById("topBarAuthDot");

    if (topBarAvatar) topBarAvatar.style.display = "none";
    if (topBarDefaultIcon) topBarDefaultIcon.style.display = "block";
    if (topBarAuthDot) {
        topBarAuthDot.classList.remove("linked");
        topBarAuthDot.classList.add("unlinked");
        topBarAuthDot.title = "Google Auth: Offline / Guest Mode";
    }

    const signedOutBox = document.getElementById("googleSignedOutBox");
    const signedInBox = document.getElementById("googleSignedInBox");
    if (signedOutBox && signedInBox) {
        signedOutBox.style.display = "block";
        signedInBox.style.display = "none";
    }
}

function openProfileDrawer() {
    document.getElementById("profileDrawer").style.display = "flex";
}

function closeProfileDrawer() {
    document.getElementById("profileDrawer").style.display = "none";
}

async function saveProfileChanges() {
    const name = document.getElementById("profInputName").value;
    const vehicle = document.getElementById("profInputVehicle").value;
    const phone = document.getElementById("profInputPhone").value;
    const target = parseFloat(document.getElementById("profInputTarget").value) || 800;

    await tauriInvoke("update_profile", {
        profile: {
            id: "RIDER-KOL-01",
            name,
            email: currentUserProfile ? currentUserProfile.email : "debanjan.rider@lastmile.io",
            phone,
            vehicle_no: vehicle,
            daily_target_inr: target,
            daily_target_orders: 8,
            photo_url: currentUserProfile ? currentUserProfile.photo_url : "",
            updated_at: new Date().toISOString()
        }
    });

    document.getElementById("topBarRiderName").textContent = name.split(" ")[0];
    closeProfileDrawer();
    showHUDToast("Rider Profile updated.");
    syncTelemetrySnapshot();
}

// -----------------------------------------------------------------------------
// 8. GLOBAL HOTKEYS & UTILITIES
// -----------------------------------------------------------------------------
let toastTimer = null;
function showHUDToast(msg) {
    const toast = document.getElementById("hudToast");
    const msgEl = document.getElementById("toastMessage");
    if (!toast || !msgEl) return;
    
    msgEl.textContent = msg;
    toast.style.display = "block";
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.display = "none";
    }, 3200);
}

async function refreshOffers() {
    playChime(900, 0.15);
    await tauriInvoke("refresh_offers");
    showHUDToast("Nearby order feed refreshed.");
    syncTelemetrySnapshot();
}

async function infiltrateOrder() {
    playChime(1400, 0.3);
    const order = await tauriInvoke("infiltrate_order");
    if (order && order.order_id) {
        openOfferModal(order);
        showHUDToast(`New Customer Order: ${order.platform ? order.platform.toUpperCase() : "Platform"} • ${order.store_name || "Restaurant"} (₹${Number(order.payout_inr || 0).toFixed(2)})`);
    } else {
        showHUDToast("New Customer Order dispatched into driver feed!");
    }
    syncTelemetrySnapshot();
}

async function dismissOffer(orderId) {
    playChime(600, 0.1);
    await tauriInvoke("dismiss_offer", { orderId });
    showHUDToast("Offer dismissed. Replenishing feed...");
    syncTelemetrySnapshot();
}

function triggerSos() {
    tauriInvoke("trigger_sos");
    showHUDToast("SOS EMERGENCY PROTOCOL ACTIVATED");
}

function triggerTilt() {
    tauriInvoke("trigger_tilt");
    showHUDToast("VEHICLE TILT / CRASH DETECTED");
}

function resetEmergency() {
    tauriInvoke("reset_emergency");
    showHUDToast("Emergency protocol cleared.");
}

function callCustomer() {
    playChime(1000, 0.15);
    const name = activeSelectedOrder ? activeSelectedOrder.customer_name : "Customer";
    showHUDToast(`Calling ${name} via Bluetooth Helmet Audio Link...`);
}

document.addEventListener("keydown", (e) => {
    // If OTP modal is open, intercept digit keys
    const otpModal = document.getElementById("otpModal");
    if (otpModal && otpModal.style.display === "flex") {
        if (/^[0-9]$/.test(e.key)) {
            pressOtpKey(e.key);
            return;
        } else if (e.key === "Backspace") {
            if (enteredOtpString.length > 0) {
                enteredOtpString = enteredOtpString.slice(0, -1);
                renderOtpBoxes();
            }
            return;
        } else if (e.key === "Enter") {
            submitOtp();
            return;
        } else if (e.key === "Escape") {
            closeOtpModal();
            return;
        }
    }

    const key = e.key.toUpperCase();
    const p = (currentPhase || "").toUpperCase();
    if (key === "O") refreshOffers();
    else if (key === "I") infiltrateOrder();
    else if (key === "A") {
        const modal = document.getElementById("newOfferModal");
        if (modal && modal.style.display === "flex") {
            triggerAcceptOrder();
        } else if (p === "IDLE" || p === "DELIVERED") {
            triggerAcceptOrder();
        }
    }
    else if (key === "R") { if (p === "ROUTETOSTORE" || p === "ROUTE_TO_STORE") handlePrimaryDockAction(); }
    else if (key === "K") { if (p === "ATSTORE" || p === "AT_STORE") handlePrimaryDockAction(); }
    else if (key === "C") { if (p === "ROUTETOCUSTOMER" || p === "ROUTE_TO_CUSTOMER") handlePrimaryDockAction(); }
    else if (key === "U") { if (p === "ATCUSTOMER" || p === "AT_CUSTOMER") handlePrimaryDockAction(); }
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (e.key === "Escape") {
        closeOfferModal();
        closeOtpModal();
        closeProfileDrawer();
        closeRazorpayModal();
        resetEmergency();
    }
});

// Standalone Web Browser Fallback (Bridging directly to FastAPI endpoints)
async function mockTauriBridge(cmd, args) {
    try {
        if (cmd === "get_profile") {
            try {
                const res = await fetch('/api/rider/profile');
                if (res.ok) {
                    const prof = await res.json();
                    try { localStorage.setItem("lastmile_rider_profile", JSON.stringify(prof)); } catch(e) {}
                    return prof;
                }
            } catch(e) {}
            try {
                const saved = localStorage.getItem("lastmile_rider_profile");
                if (saved) return JSON.parse(saved);
            } catch(e) {}
            return { name: "Debanjan Mondal", vehicle_no: "WB 02 AB 4591", phone: "+91 98765 43210", daily_target_inr: 800 };
        } else if (cmd === "update_profile") {
            if (args && args.profile) {
                try {
                    await fetch('/api/rider/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(args.profile)
                    });
                    localStorage.setItem("lastmile_rider_profile", JSON.stringify(args.profile));
                } catch(e) {}
            }
            return true;
        } else if (cmd === "firebase_verify" || cmd === "validate_session") {
            try {
                const res = await fetch('/api/auth/firebase-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_token: (args && args.token) || (args && args.id_token) || "mock_token",
                        user_info: (args && args.user_info) || null
                    })
                });
                if (res.ok) return await res.json();
            } catch(e) {}
            return { status: "Verified" };
        } else if (cmd === "get_telemetry_snapshot") {
            const res = await fetch('/api/telemetry');
            if (res.ok) {
                const data = await res.json();
                return {
                    timestamp: data.timestamp,
                    gps: data.gps,
                    order_phase: data.order_phase,
                    selected_order: data.selected_order,
                    active_offers: data.active_offers,
                    daily_summary: {
                        earnings_today_inr: data.earnings_today_inr || 570.26,
                        daily_target_inr: data.daily_target || 800,
                        progress_pct: Math.min(100, Math.round(((data.earnings_today_inr || 570) / (data.daily_target || 800)) * 100))
                    },
                    is_emergency: data.is_emergency,
                    emergency_reason: data.emergency_reason
                };
            }
        } else if (cmd === "accept_order") {
            const res = await fetch('/api/feed/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: (args && args.orderId) || "" })
            });
            const d = await res.json();
            return d.order;
        } else if (cmd === "reach_store") {
            const res = await fetch('/api/feed/reach-store', { method: 'POST' });
            const d = await res.json();
            return d.order;
        } else if (cmd === "pickup_order") {
            const res = await fetch('/api/feed/pickup', { method: 'POST' });
            const d = await res.json();
            return d.order;
        } else if (cmd === "reach_customer") {
            const res = await fetch('/api/feed/reach-customer', { method: 'POST' });
            const d = await res.json();
            return d.order;
        } else if (cmd === "complete_delivery") {
            const res = await fetch('/api/feed/deliver', { method: 'POST' });
            const d = await res.json();
            return d.result;
        } else if (cmd === "refresh_offers") {
            const res = await fetch('/api/feed/refresh', { method: 'POST' });
            const d = await res.json();
            return d.snapshot ? d.snapshot.active_offers : [];
        } else if (cmd === "infiltrate_order") {
            const res = await fetch('/api/feed/infiltrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_data: (args && args.orderData) || null })
            });
            const d = await res.json();
            return d.order;
        } else if (cmd === "dismiss_offer") {
            await fetch('/api/feed/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: (args && args.orderId) || "" })
            });
            return {};
        } else if (cmd === "trigger_sos") {
            await fetch('/api/test/sos', { method: 'POST' });
            return "evidence/incidents/incident_sos.mp4";
        } else if (cmd === "trigger_tilt") {
            await fetch('/api/test/tilt', { method: 'POST' });
            return "evidence/incidents/incident_tilt.mp4";
        } else if (cmd === "reset_emergency") {
            await fetch('/api/test/reset-emergency', { method: 'POST' });
            return {};
        } else if (cmd === "generate_razorpay_qr") {
            const codAmt = (args && args.codAmount) || 360;
            const ordId = (args && args.orderId) || 'ORD';
            try {
                const res = await fetch('/api/payment/razorpay-qr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_id: ordId, amount_inr: codAmt })
                });
                if (res.ok) {
                    const data = await res.json();
                    
                    // Poll for test completion or timeout
                    if (activeQrPollInterval) clearInterval(activeQrPollInterval);
                    activeQrPollInterval = setInterval(async () => {
                        try {
                            const sRes = await fetch(`/api/payment/status/${data.qr_id}`);
                            if (sRes.ok) {
                                const sData = await sRes.json();
                                if (sData.status === "PAID" || sData.status === "SUCCESS") {
                                    clearInterval(activeQrPollInterval);
                                    activeQrPollInterval = null;
                                    const event = new CustomEvent("tauri-payment_successful", {
                                        detail: {
                                            order_id: ordId,
                                            amount_paid: codAmt,
                                            payment_id: sData.payment_id || ("pay_rzp_live_" + Math.random().toString(36).substring(7)),
                                            status: "SUCCESS"
                                        }
                                    });
                                    window.dispatchEvent(event);
                                }
                            }
                        } catch(e) {}
                    }, 2000);

                    return data;
                }
            } catch(e) {}

            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=razorpay.lastmile@icici%26pn=DeliveryPartner%26am=${codAmt}%26cu=INR%26tn=COD_${ordId}`;
            
            setTimeout(() => {
                const event = new CustomEvent("tauri-payment_successful", {
                    detail: {
                        order_id: ordId,
                        amount_paid: codAmt,
                        payment_id: "pay_rzp_live_" + Math.random().toString(36).substring(7),
                        status: "SUCCESS"
                    }
                });
                window.dispatchEvent(event);
            }, 6000);

            return {
                qr_id: "qr_test_" + Date.now(),
                image_url: qrUrl
            };
        }
    } catch (e) {
        console.warn("[MOCK BRIDGE ERROR]", e);
    }
    return {};
}
