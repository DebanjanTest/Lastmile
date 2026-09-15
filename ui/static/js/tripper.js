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
let googleMap = null;
let googleRiderMarker = null;
let googleDestMarker = null;
let googleBlueGlowPolyline = null;
let googleBlueCorePolyline = null;
let is3DMode = false;
let currentRiderCoords = { lat: 22.5726, lng: 88.3639, heading: 45 };
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
    setupTauriEventListeners();

    // Fetch initial Profile from SQLite / Backend
    try {
        const profile = await tauriInvoke("get_profile");
        if (profile && profile.name) {
            document.getElementById("topBarRiderName").textContent = profile.name.split(" ")[0];
            document.getElementById("profInputName").value = profile.name;
            document.getElementById("profInputVehicle").value = profile.vehicle_no;
            document.getElementById("profInputPhone").value = profile.phone;
            document.getElementById("profInputTarget").value = profile.daily_target_inr;
        }
    } catch (e) {}

    // Simulated session validation
    try {
        await tauriInvoke("validate_session", { token: "mock_firebase_jwt_kolkata" });
    } catch (e) {}

    // Dismiss Minimalist Boot Loader after 1.2s with smooth fade
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
// 2. AUTOMOTIVE CARTOGRAPHY ENGINE (NATIVE GOOGLE MAPS PRIMARY & DRIVER HUD)
// -----------------------------------------------------------------------------
const GOOGLE_MAPS_DRIVER_NAVY_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#070B14" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#070B14" }, { weight: 3 }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#F8FAFC" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#38BDF8" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#111A30" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1E293B" }, { weight: 1 }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#94A3B8" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
    { featureType: "road.arterial", elementType: "geometry.stroke", stylers: [{ color: "#38BDF8" }, { weight: 1.5 }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#0284C7" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#38BDF8" }, { weight: 2 }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#FFFFFF" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A1329" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#0284C7" }] }
];

let activeMapType = "none"; // "google" | "canvas"
let nativeCanvas = null;
let nativeCtx = null;

window.initGoogleMap = function() {
    if (typeof google === 'undefined' || !google.maps) {
        initNativeNavCanvas();
        return;
    }
    const mapEl = document.getElementById('mapView');
    if (!mapEl) return;

    activeMapType = "google";
    const canvasEl = document.getElementById("nativeNavCanvas");
    if (canvasEl) canvasEl.style.display = "none";

    const kolkataCenter = { lat: 22.5726, lng: 88.3639 };

    googleMap = new google.maps.Map(mapEl, {
        center: kolkataCenter,
        zoom: 16,
        minZoom: 12,
        maxZoom: 20,
        styles: GOOGLE_MAPS_DRIVER_NAVY_STYLE,
        disableDefaultUI: true,
        gestureHandling: "greedy",
        tilt: is3DMode ? 45 : 0,
        restriction: {
            latLngBounds: {
                north: 22.7200,
                south: 22.4200,
                west: 88.2200,
                east: 88.5200
            },
            strictBounds: true
        }
    });

    // Custom High-Legibility Driver Rider Puck (Oversized 44px Glowing Cyan Arrow)
    const riderSvg = {
        path: "M12,2 L22,22 L12,18 L2,22 Z",
        fillColor: "#38BDF8",
        fillOpacity: 1.0,
        strokeColor: "#FFFFFF",
        strokeWeight: 2.5,
        scale: 1.6,
        anchor: new google.maps.Point(12, 12),
        rotation: currentRiderCoords.heading || 45
    };

    googleRiderMarker = new google.maps.Marker({
        position: kolkataCenter,
        map: googleMap,
        icon: riderSvg,
        title: "Driver Vehicle Marker",
        zIndex: 999
    });

    // Custom Driver Destination Pin
    const pinSvg = {
        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
        fillColor: "#EF4444",
        fillOpacity: 1.0,
        strokeColor: "#FFFFFF",
        strokeWeight: 2,
        scale: 1.6,
        anchor: new google.maps.Point(12, 24)
    };

    googleDestMarker = new google.maps.Marker({
        position: kolkataCenter,
        map: null,
        icon: pinSvg,
        title: "Destination Waypoint",
        zIndex: 990
    });

    console.log("[MAP] Google Maps Automotive Driver Engine Initialized");
};

window.onGoogleMapsLoadError = function() {
    console.warn("[MAP] Google Maps script failed or key not configured. Falling back to Native Driver HUD Canvas.");
    initNativeNavCanvas();
};

function initKolkataMap() {
    if (window.google && window.google.maps) {
        initGoogleMap();
    } else {
        initNativeNavCanvas();
    }
}

// -----------------------------------------------------------------------------
// NATIVE DRIVER HUD CANVAS (OFFLINE / ZERO-WATERMARK AUTOMOTIVE VECTOR GRID)
// -----------------------------------------------------------------------------
function initNativeNavCanvas() {
    activeMapType = "canvas";
    nativeCanvas = document.getElementById("nativeNavCanvas");
    if (!nativeCanvas) return;
    nativeCanvas.style.display = "block";
    nativeCanvas.width = 800;
    nativeCanvas.height = 480;
    nativeCtx = nativeCanvas.getContext("2d");
    renderNativeNavCanvas();
    console.log("[MAP] Native Driver HUD Canvas Initialized (Zero Watermark / Full Offline)");
}

function renderNativeNavCanvas() {
    if (activeMapType !== "canvas" || !nativeCtx) return;
    const ctx = nativeCtx;
    const w = 800;
    const h = 480;

    // Deep Navy Base
    ctx.fillStyle = "#070B14";
    ctx.fillRect(0, 0, w, h);

    // Automotive Grid Lines
    ctx.strokeStyle = "rgba(11, 19, 43, 0.8)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Radial Radar Ring
    const cx = w / 2;
    const cy = h / 2 + 30; // 60% lower-third forward visibility
    ctx.strokeStyle = "rgba(2, 132, 199, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 80, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 160, 0, Math.PI * 2); ctx.stroke();

    // Active Route Polyline Vector
    if (activeRoutePolyline && activeRoutePolyline.length >= 2) {
        ctx.strokeStyle = "#075985";
        ctx.lineWidth = 12;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        activeRoutePolyline.forEach((pt, i) => {
            const px = cx + (pt[1] - currentRiderCoords.lng) * 4500;
            const py = cy - (pt[0] - currentRiderCoords.lat) * 4500;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.stroke();

        ctx.strokeStyle = "#0284C7";
        ctx.lineWidth = 6;
        ctx.stroke();
    }

    // Destination Pin
    if (activeDestCoords) {
        const dx = cx + (activeDestCoords.lng - currentRiderCoords.lng) * 4500;
        const dy = cy - (activeDestCoords.lat - currentRiderCoords.lat) * 4500;
        ctx.fillStyle = "#EF4444";
        ctx.beginPath();
        ctx.arc(dx, dy, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#FFF";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Driver Vehicle Arrow Puck (Center, Rotating)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((currentRiderCoords.heading || 0) * Math.PI) / 180);

    // Glowing Halo
    ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();

    // Cyan Directional Triangle
    ctx.fillStyle = "#38BDF8";
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(12, 14);
    ctx.lineTo(0, 8);
    ctx.lineTo(-12, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

// -----------------------------------------------------------------------------
// DRIVER-CENTRIC CAMERA & QUICK ACTIONS
// -----------------------------------------------------------------------------
function recenterMap() {
    if (activeMapType === "google" && googleMap && googleRiderMarker) {
        const pos = { lat: currentRiderCoords.lat, lng: currentRiderCoords.lng };
        googleMap.panTo(pos);
        googleMap.setZoom(16);
    } else {
        renderNativeNavCanvas();
    }
}

function toggleMapTilt() {
    is3DMode = !is3DMode;
    const txt = document.getElementById("tiltModeText");
    if (txt) txt.textContent = is3DMode ? "2D" : "3D";

    if (activeMapType === "google" && googleMap) {
        googleMap.setTilt(is3DMode ? 45 : 0);
        if (is3DMode && currentRiderCoords.heading) {
            googleMap.setHeading(currentRiderCoords.heading);
        }
    }
}

function zoomInMap() {
    if (activeMapType === "google" && googleMap) {
        googleMap.setZoom(googleMap.getZoom() + 1);
    }
}

function zoomOutMap() {
    if (activeMapType === "google" && googleMap) {
        googleMap.setZoom(googleMap.getZoom() - 1);
    }
}

function clearMapRoute() {
    activeRoutePolyline = [];
    activeDestCoords = null;

    if (activeMapType === "google" && googleMap) {
        if (googleBlueGlowPolyline) { googleBlueGlowPolyline.setMap(null); googleBlueGlowPolyline = null; }
        if (googleBlueCorePolyline) { googleBlueCorePolyline.setMap(null); googleBlueCorePolyline = null; }
        if (googleDestMarker) { googleDestMarker.setMap(null); }
    } else {
        renderNativeNavCanvas();
    }
}

function renderBlueRoute(polyline, destCoords) {
    if (!polyline || polyline.length < 2) return;
    clearMapRoute();

    activeRoutePolyline = polyline;
    activeDestCoords = destCoords;

    if (activeMapType === "google" && googleMap) {
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
    } else {
        renderNativeNavCanvas();
    }
}

function smoothFlyToDestination(lat, lng, targetZoom = 17) {
    if (activeMapType === "google" && googleMap) {
        googleMap.panTo({ lat, lng });
        googleMap.setZoom(targetZoom);
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

        // 2. Update Map Position & Driver Forward Camera Tracking
        if (gps.latitude && gps.longitude) {
            currentRiderCoords = {
                lat: gps.latitude,
                lng: gps.longitude,
                heading: gps.heading_deg || 45
            };

            if (activeMapType === "google" && googleMap && googleRiderMarker) {
                const newPos = { lat: gps.latitude, lng: gps.longitude };
                googleRiderMarker.setPosition(newPos);
                if (isMoving) {
                    googleMap.panTo(newPos);
                    if (is3DMode) {
                        googleMap.setHeading(gps.heading_deg || 0);
                    }
                }
            } else if (activeMapType === "canvas") {
                renderNativeNavCanvas();
            }
        }

        // 3. Phase Transition Evaluation
        currentPhase = snap.order_phase;
        activeSelectedOrder = snap.selected_order;
        updateUIPhase(currentPhase, activeSelectedOrder, snap.daily_summary);

        // 4. Update Idle Offers Stack
        if (currentPhase === "Idle" || currentPhase === "Delivered" || currentPhase === "IDLE") {
            renderOffersStack(snap.active_offers || []);
        } else {
            const stack = document.getElementById("orderNotificationStack");
            if (stack) stack.innerHTML = "";
        }

        // 5. Emergency Screen
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
        document.getElementById("drawerDailyText").textContent = `₹${daily.earnings_today_inr.toFixed(2)} / ₹${daily.daily_target_inr.toFixed(2)}`;
        document.getElementById("drawerDailyBar").style.width = `${daily.progress_pct}%`;
    }

    if (!order || phase === "Idle" || phase === "Delivered" || phase === "IDLE") {
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

    const phaseNormalized = (phase || "").toUpperCase();

    if (phaseNormalized === "ROUTETOSTORE" || phaseNormalized === "ROUTE_TO_STORE") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "PHASE 1: ROUTE TO STORE";
        dockBadge.style.color = "#38BDF8";
        dockTitle.textContent = order.store_name;
        dockSub.textContent = `${order.store_address} • ${order.store_dist_km} km`;
        dockBtn.textContent = "REACHED STORE [R]";
        dockBtn.style.background = "linear-gradient(135deg, #0284C7, #0369A1)";
        dockBtn.style.color = "#FFF";

        if (bottomDestName) bottomDestName.textContent = `Pickup: ${order.store_name}`;
        if (destHeader) destHeader.textContent = "PHASE 1:";

        renderBlueRoute([
            [riderMarker.getLatLng().lat, riderMarker.getLatLng().lng],
            [order.store_lat, order.store_lng]
        ], { lat: order.store_lat, lng: order.store_lng });

    } else if (phaseNormalized === "ATSTORE" || phaseNormalized === "AT_STORE") {
        if (turnCard) turnCard.style.display = "none";
        dockBadge.textContent = "AT STORE: PACKAGING CHECKLIST";
        dockBadge.style.color = "#38BDF8";
        dockTitle.textContent = `Token #${order.order_id} • ${order.items_summary}`;
        dockSub.textContent = `Ready for collection at ${order.store_name}`;
        dockBtn.textContent = "FOOD PICKED UP [K]";
        dockBtn.style.background = "linear-gradient(135deg, #00E676, #00b248)";
        dockBtn.style.color = "#070B14";

        // Trigger progressive map zoom into store
        smoothFlyToDestination(order.store_lat, order.store_lng, 17);

    } else if (phaseNormalized === "ROUTETOCUSTOMER" || phaseNormalized === "ROUTE_TO_CUSTOMER") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "PHASE 2: ROUTE TO CUSTOMER";
        dockBadge.style.color = "#00E676";
        dockTitle.textContent = `${order.customer_name} • ${order.customer_address}`;
        dockSub.textContent = `${order.customer_instructions} • ${order.drop_dist_km} km`;
        dockBtn.textContent = "REACHED CUSTOMER [C]";
        dockBtn.style.background = "linear-gradient(135deg, #0284C7, #0369A1)";
        dockBtn.style.color = "#FFF";

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
        dockBtn.textContent = "COMPLETE DELIVERY [U]";
        dockBtn.style.background = "linear-gradient(135deg, #00E676, #00b248)";
        dockBtn.style.color = "#070B14";

        // Trigger progressive map zoom into customer doorstep
        smoothFlyToDestination(order.customer_lat, order.customer_lng, 18);
    }
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
                    <button class="btn-card-accept" onclick="openOfferModalById('${o.order_id}')">View & Accept</button>
                </div>
            </div>
        </div>
    `).join("");
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
    document.getElementById("offerModalPlatform").textContent = offer.platform.toUpperCase();
    document.getElementById("offerModalPlatform").style.background = offer.platform_color;
    document.getElementById("offerModalPayout").textContent = offer.payout_inr.toFixed(2);
    document.getElementById("offerModalStore").textContent = offer.store_name;
    document.getElementById("offerModalStoreDist").textContent = `${offer.store_dist_km} km travel to pickup`;
    document.getElementById("offerModalCustomer").textContent = offer.customer_name;
    document.getElementById("offerModalCustomerAddr").textContent = `${offer.customer_address} (${offer.drop_dist_km} km drop)`;
    document.getElementById("offerModalItems").textContent = `Package: ${offer.items_summary}`;
    document.getElementById("offerModalPrep").textContent = `${offer.prep_time_minutes} min prep`;

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

        // If swiped past 80% threshold -> Trigger Instant Accept!
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

async function triggerAcceptOrder() {
    if (!currentPendingOffer) return;
    playChime(1200, 0.25);
    const orderId = currentPendingOffer.order_id;
    closeOfferModal();
    await tauriInvoke("accept_order", { orderId });
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
    } else if (p === "ATSTORE" || p === "AT_STORE") {
        await tauriInvoke("pickup_order");
    } else if (p === "ROUTETOCUSTOMER" || p === "ROUTE_TO_CUSTOMER") {
        await tauriInvoke("reach_customer");
    } else if (p === "ATCUSTOMER" || p === "AT_CUSTOMER") {
        // Open OTP Handover Screen
        openOtpModal();
    }
    syncTelemetrySnapshot();
}

function openOtpModal() {
    enteredOtpString = "";
    document.getElementById("otpDisplay").textContent = "----";
    document.getElementById("otpModal").style.display = "flex";
}

function pressOtpKey(num) {
    if (enteredOtpString.length < 4) {
        enteredOtpString += num;
        document.getElementById("otpDisplay").textContent = enteredOtpString.padEnd(4, "-");
        playChime(950, 0.06);
    }
}

function clearOtp() {
    enteredOtpString = "";
    document.getElementById("otpDisplay").textContent = "----";
}

async function submitOtp() {
    document.getElementById("otpModal").style.display = "none";
    
    // Check if order is Cash on Delivery (COD)
    if (activeSelectedOrder && activeSelectedOrder.payment_mode === "COD" && activeSelectedOrder.cod_amount > 0) {
        openRazorpayCodModal(activeSelectedOrder.order_id, activeSelectedOrder.cod_amount);
    } else {
        // Prepaid order -> Complete immediately
        await tauriInvoke("complete_delivery", { enteredOtp: enteredOtpString });
        syncTelemetrySnapshot();
    }
}

// -----------------------------------------------------------------------------
// 6. RAZORPAY COD INTEGRATION & PAYMENT LISTENER
// -----------------------------------------------------------------------------
async function openRazorpayCodModal(orderId, codAmount) {
    document.getElementById("rzpAmountText").textContent = `₹${codAmount.toFixed(2)}`;
    document.getElementById("rzpBodyActive").style.display = "flex";
    document.getElementById("rzpSuccessView").style.display = "none";
    document.getElementById("razorpayModal").style.display = "flex";

    try {
        const res = await tauriInvoke("generate_razorpay_qr", { orderId, codAmount });
        if (res && res.image_url) {
            document.getElementById("rzpQrImage").src = res.image_url;
        }
    } catch (e) {
        console.warn("[RAZORPAY ERROR]", e);
    }
}

function closeRazorpayModal() {
    document.getElementById("razorpayModal").style.display = "none";
}

function setupTauriEventListeners() {
    // Listens for Rust background task emitting "payment_successful"
    tauriListen("payment_successful", (payload) => {
        console.log("[RAZORPAY PAYMENT EVENT RECEIVED]", payload);
        playChime(1300, 0.4);

        // Shift to Green Celebration UI
        document.getElementById("rzpBodyActive").style.display = "none";
        document.getElementById("rzpSuccessView").style.display = "flex";
        document.getElementById("rzpSuccessSub").textContent = `₹${payload.amount_paid.toFixed(2)} received via Razorpay UPI`;
        document.getElementById("rzpRiderCredit").textContent = `+₹${(activeSelectedOrder ? activeSelectedOrder.payout_inr : 85.26).toFixed(2)} Credited to Wallet`;
    });
}

async function finalizeDelivery() {
    closeRazorpayModal();
    await tauriInvoke("complete_delivery", { enteredOtp: enteredOtpString });
    syncTelemetrySnapshot();
}

// -----------------------------------------------------------------------------
// 7. RIDER PROFILE DRAWER (FIREBASE AUTH & SQLITE)
// -----------------------------------------------------------------------------
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
            email: "debanjan.rider@lastmile.io",
            phone,
            vehicle_no: vehicle,
            daily_target_inr: target,
            daily_target_orders: 8,
            updated_at: new Date().toISOString()
        }
    });

    document.getElementById("topBarRiderName").textContent = name.split(" ")[0];
    closeProfileDrawer();
    syncTelemetrySnapshot();
}

// -----------------------------------------------------------------------------
// 8. GLOBAL HOTKEYS & UTILITIES
// -----------------------------------------------------------------------------
function refreshOffers() { tauriInvoke("refresh_offers"); }
function dismissOffer(orderId) { tauriInvoke("dismiss_offer", { orderId }); }
function triggerSos() { tauriInvoke("trigger_sos"); }
function triggerTilt() { tauriInvoke("trigger_tilt"); }
function resetEmergency() { tauriInvoke("reset_emergency"); }
function callCustomer() {
    alert("Calling Customer via Bluetooth Hands-Free Helmet Audio Link...");
}

document.addEventListener("keydown", (e) => {
    const key = e.key.toUpperCase();
    const p = (currentPhase || "").toUpperCase();
    if (key === "O") refreshOffers();
    else if (key === "R") { if (p === "ROUTETOSTORE" || p === "ROUTE_TO_STORE") handlePrimaryDockAction(); }
    else if (key === "K") { if (p === "ATSTORE" || p === "AT_STORE") handlePrimaryDockAction(); }
    else if (key === "C") { if (p === "ROUTETOCUSTOMER" || p === "ROUTE_TO_CUSTOMER") handlePrimaryDockAction(); }
    else if (key === "U") { if (p === "ATCUSTOMER" || p === "AT_CUSTOMER") handlePrimaryDockAction(); }
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (e.key === "Escape") {
        closeOfferModal();
        closeProfileDrawer();
        closeRazorpayModal();
        resetEmergency();
    }
});

// Standalone Web Browser Fallback (Bridging directly to FastAPI endpoints)
async function mockTauriBridge(cmd, args) {
    try {
        if (cmd === "get_profile") {
            return { name: "Debanjan Mondal", vehicle_no: "WB 02 AB 4591", phone: "+91 98765 43210", daily_target_inr: 800 };
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
                body: JSON.stringify({ order_id: args.orderId || "" })
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
        } else if (cmd === "dismiss_offer") {
            await fetch('/api/feed/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: args.orderId || "" })
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
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=razorpay.lastmile@icici%26pn=DeliveryPartner%26am=${args.codAmount || 360}%26cu=INR%26tn=COD_${args.orderId || 'ORD'}`;
            
            setTimeout(() => {
                const event = new CustomEvent("tauri-payment_successful", {
                    detail: {
                        order_id: args.orderId,
                        amount_paid: args.codAmount || 360.0,
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
