// ==============================================================================
// LastMile Guard - High-Performance Tauri v2 + Rust Delivery HUD Client
// Pure Native ES6 • CartoDB Voyager • Swipe to Accept • Razorpay COD QR
// ==============================================================================

// Safe Tauri v2 IPC Resolver with Standalone Browser Fallback
const tauriInvoke = (cmd, args = {}) => {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        return window.__TAURI__.core.invoke(cmd, args);
    } else if (window.__TAURI__ && window.__TAURI__.invoke) {
        return window.__TAURI__.invoke(cmd, args);
    }
    // Browser fallback / mock execution
    return mockTauriBridge(cmd, args);
};

const tauriListen = (event, callback) => {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
        return window.__TAURI__.event.listen(event, callback);
    }
    window.addEventListener(`tauri-${event}`, (e) => callback(e.detail));
    return Promise.resolve(() => {});
};

// Global HUD State
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let blueGlowPolyline = null;
let blueCorePolyline = null;
let trafficOverlays = [];
let audioCtx = null;

let currentPhase = "Idle"; // Idle, RouteToStore, AtStore, RouteToCustomer, AtCustomer, Delivered
let activeSelectedOrder = null;
let currentPendingOffer = null;
let enteredOtpString = "";

// -----------------------------------------------------------------------------
// 1. APPLICATION BOOTSTRAP & SWIGGY/ZOMATO SPLASH SEQUENCE
// -----------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
    initAudio();
    initKolkataMap();
    setupSwipeSlider();
    setupTauriEventListeners();

    // Fetch initial Profile & Telemetry from SQLite
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

    // Simulated / real session validation
    try {
        await tauriInvoke("validate_session", { token: "mock_firebase_jwt_kolkata" });
    } catch (e) {}

    // Dismiss Splash Screen after 1.4s with smooth fade
    setTimeout(() => {
        const splash = document.getElementById("splashScreen");
        if (splash) {
            splash.style.opacity = "0";
            setTimeout(() => { splash.style.display = "none"; }, 500);
        }
    }, 1400);

    // Polling Loop: 5 Hz Telemetry Synchronization with Rust Backend
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

function playChime(freq = 880, duration = 0.15) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
}

// -----------------------------------------------------------------------------
// 2. CARTOGRAPHY & PROGRESSIVE ZOOM ANIMATIONS (KOLKATA REGION)
// -----------------------------------------------------------------------------
function initKolkataMap() {
    if (mapInstance || typeof L === 'undefined') return;

    // Kolkata bounds: Baranagar (North: 22.65), Salt Lake & New Town (East: 88.46), Park Street (South: 22.54)
    const kolkataCenter = [22.5726, 88.3639];

    mapInstance = L.map('mapView', {
        center: kolkataCenter,
        zoom: 15,
        zoomControl: false,
        attributionControl: false
    });

    // CartoDB Voyager High-Contrast Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(mapInstance);

    // Rider Icon Puck
    const riderIcon = L.divIcon({
        className: 'rider-puck-container',
        html: `<div id="riderPuck" style="width:36px;height:36px;background:#1A73E8;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 16px #1A73E8;display:flex;align-items:center;justify-content:center;transform:rotate(45deg);"><svg width="20" height="20" viewBox="0 0 24 24"><polygon points="12,2 22,22 12,18 2,22" fill="#FFF"/></svg></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    riderMarker = L.marker(kolkataCenter, { icon: riderIcon }).addTo(mapInstance);

    // Destination Pin
    const destIcon = L.divIcon({
        className: 'dest-pin-container',
        html: `<div id="destPinIcon" style="font-size:32px;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.8));">🏁</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 30]
    });

    destMarker = L.marker(kolkataCenter, { icon: destIcon });
    console.log("[MAP] Leaflet Map Initialized with Kolkata Bounds");
}

function clearMapRoute() {
    if (!mapInstance) return;
    if (blueGlowPolyline) { mapInstance.removeLayer(blueGlowPolyline); blueGlowPolyline = null; }
    if (blueCorePolyline) { mapInstance.removeLayer(blueCorePolyline); blueCorePolyline = null; }
    if (destMarker && mapInstance.hasLayer(destMarker)) { mapInstance.removeLayer(destMarker); }
}

function renderBlueRoute(polyline, destCoords) {
    if (!mapInstance || !polyline || polyline.length < 2) return;
    clearMapRoute();

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

    if (destCoords) {
        destMarker.setLatLng([destCoords.lat, destCoords.lng]).addTo(mapInstance);
    }
}

// Smooth Progressive Map-Zoom Animation (Panning and scaling slowly into destination)
function smoothFlyToDestination(lat, lng, targetZoom = 17) {
    if (!mapInstance) return;
    mapInstance.flyTo([lat, lng], targetZoom, {
        animate: true,
        duration: 1.8,
        easeLinearity: 0.25
    });
}

function recenterMap() {
    if (riderMarker && mapInstance) {
        const pos = riderMarker.getLatLng();
        mapInstance.setView(pos, 16, { animate: true });
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

        // 2. Update Map Position
        if (gps.latitude && gps.longitude && riderMarker) {
            riderMarker.setLatLng([gps.latitude, gps.longitude]);
            if (isMoving) {
                mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.2 });
                const puck = document.getElementById("riderPuck");
                if (puck) puck.style.transform = `rotate(${gps.heading_deg || 45}deg)`;
            }
        }

        // 3. Phase Transition Evaluation
        currentPhase = snap.order_phase;
        activeSelectedOrder = snap.selected_order;
        updateUIPhase(currentPhase, activeSelectedOrder, snap.daily_summary);

        // 4. Update Idle Offers Stack
        if (currentPhase === "Idle" || currentPhase === "Delivered") {
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
                document.getElementById("emergencyTitle").textContent = snap.emergency_reason || "EMERGENCY SOS ACTIVE";
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

    if (!order || phase === "Idle" || phase === "Delivered") {
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

    if (phase === "RouteToStore") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "📍 PHASE 1: ROUTE TO PICKUP";
        dockBadge.style.color = "#FC8019";
        dockTitle.textContent = order.store_name;
        dockSub.textContent = `${order.store_address} • ${order.store_dist_km} km`;
        dockBtn.textContent = "🏪 REACHED STORE [R]";
        dockBtn.style.background = "#F59E0B";

        if (bottomDestName) bottomDestName.textContent = `Shop: ${order.store_name}`;
        if (destHeader) destHeader.textContent = "PHASE 1:";

        renderBlueRoute([
            [riderMarker.getLatLng().lat, riderMarker.getLatLng().lng],
            [order.store_lat, order.store_lng]
        ], { lat: order.store_lat, lng: order.store_lng });

    } else if (phase === "AtStore") {
        if (turnCard) turnCard.style.display = "none";
        dockBadge.textContent = "🏪 AT STORE: PACKAGING CHECKLIST";
        dockBadge.style.color = "#00B0FF";
        dockTitle.textContent = `Token #${order.order_id} • ${order.items_summary}`;
        dockSub.textContent = `Ready for collection at ${order.store_name}`;
        dockBtn.textContent = "🍴 FOOD PICKED UP [K]";
        dockBtn.style.background = "#00B0FF";

        // Trigger progressive map zoom into store
        smoothFlyToDestination(order.store_lat, order.store_lng, 17);

    } else if (phase === "RouteToCustomer") {
        if (turnCard) turnCard.style.display = "flex";
        dockBadge.textContent = "📦 PHASE 2: ROUTE TO CUSTOMER";
        dockBadge.style.color = "#00E676";
        dockTitle.textContent = `${order.customer_name} • ${order.customer_address}`;
        dockSub.textContent = `${order.customer_instructions} • ${order.drop_dist_km} km`;
        dockBtn.textContent = "📦 REACHED CUSTOMER [C]";
        dockBtn.style.background = "#7C4DFF";
        dockBtn.style.color = "#FFF";

        if (bottomDestName) bottomDestName.textContent = `Customer: ${order.customer_name}`;
        if (destHeader) destHeader.textContent = "PHASE 2:";

        renderBlueRoute([
            [order.store_lat, order.store_lng],
            [order.customer_lat, order.customer_lng]
        ], { lat: order.customer_lat, lng: order.customer_lng });

    } else if (phase === "AtCustomer") {
        if (turnCard) turnCard.style.display = "none";
        dockBadge.textContent = "🚪 AT CUSTOMER DOORSTEP";
        dockBadge.style.color = "#FFD54F";
        dockTitle.textContent = `Verify Handover: ${order.customer_name}`;
        dockSub.textContent = `Customer Note: ${order.customer_instructions}`;
        dockBtn.textContent = "✅ COMPLETE DELIVERY [U]";
        dockBtn.style.background = "#00E676";
        dockBtn.style.color = "#000";

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
                <span>🏪</span>
                <div>
                    <strong>${o.store_name}</strong>
                    <small style="display:block;color:#94A3B8;font-size:10px;">${o.items_summary}</small>
                </div>
                <span class="card-dist-pill">${o.store_dist_km} km</span>
            </div>
            <div class="card-drop-row">
                <span>🏠</span>
                <span>${o.customer_address} (${o.drop_dist_km} km drop)</span>
            </div>
            <div class="card-actions-row">
                <span class="total-dist-tag">📍 ${o.total_dist_km} km total</span>
                <div class="card-buttons">
                    <button class="btn-card-dismiss" onclick="dismissOffer('${o.order_id}')">✕ Dismiss</button>
                    <button class="btn-card-accept" onclick="openOfferModalById('${o.order_id}')">✅ View & Accept</button>
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
    document.getElementById("offerModalItems").textContent = `📦 ${offer.items_summary}`;
    document.getElementById("offerModalPrep").textContent = `⚡ ${offer.prep_time_minutes} min prep`;

    // Reset slider
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
    const maxSlide = 500; // pixels

    const onStart = (e) => {
        isDragging = true;
        startX = (e.touches ? e.touches[0].clientX : e.clientX);
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = (e.touches ? e.touches[0].clientX : e.clientX);
        let delta = currentX - startX;
        delta = Math.max(4, Math.min(delta, container.offsetWidth - 56));
        handle.style.left = `${delta}px`;

        // If swiped past 80% threshold -> Trigger Instant Accept!
        if (delta >= (container.offsetWidth - 70)) {
            isDragging = false;
            triggerAcceptOrder();
        }
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.left = "4px"; // snap back
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
    if (currentPhase === "RouteToStore") {
        await tauriInvoke("reach_store");
    } else if (currentPhase === "AtStore") {
        await tauriInvoke("pickup_order");
    } else if (currentPhase === "RouteToCustomer") {
        await tauriInvoke("reach_customer");
    } else if (currentPhase === "AtCustomer") {
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
        console.log("[RAZORPAY EVENT RECEIVED]", payload);
        playChime(1300, 0.4);

        // Shift to Green Success UI
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
    if (key === "O") refreshOffers();
    else if (key === "R") { if (currentPhase === "RouteToStore") handlePrimaryDockAction(); }
    else if (key === "K") { if (currentPhase === "AtStore") handlePrimaryDockAction(); }
    else if (key === "C") { if (currentPhase === "RouteToCustomer") handlePrimaryDockAction(); }
    else if (key === "U") { if (currentPhase === "AtCustomer") handlePrimaryDockAction(); }
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (e.key === "Escape") {
        closeOfferModal();
        closeProfileDrawer();
        closeRazorpayModal();
        resetEmergency();
    }
});

// Standalone Web Browser Fallback for Testing without Rust Compiled
function mockTauriBridge(cmd, args) {
    if (cmd === "get_profile") {
        return Promise.resolve({ name: "Debanjan Mondal", vehicle_no: "WB 02 AB 4591", phone: "+91 98765 43210", daily_target_inr: 800 });
    } else if (cmd === "get_telemetry_snapshot") {
        return Promise.resolve({
            timestamp: new Date().toISOString(),
            gps: { latitude: 22.5726, longitude: 88.3639, speed_kmh: 0.0, heading_deg: 45, is_fixed: true },
            order_phase: currentPhase,
            selected_order: activeSelectedOrder,
            active_offers: [
                { order_id: "ORD-SWG-94", platform: "swiggy", platform_color: "#FC8019", store_name: "Wow! Momo Express", store_dist_km: 0.8, customer_name: "Ananya Sen", customer_address: "New Town Tower 3", drop_dist_km: 3.0, total_dist_km: 3.8, payout_inr: 85.26, items_summary: "2x Steamed Momos", customer_instructions: "Gate 2", payment_mode: "COD", cod_amount: 360, prep_time_minutes: 3, store_lat: 22.5698, store_lng: 88.3648, customer_lat: 22.5835, customer_lng: 88.4550 }
            ],
            daily_summary: { earnings_today_inr: 570.26, daily_target_inr: 800, progress_pct: 71 },
            is_emergency: false,
            emergency_reason: ""
        });
    } else if (cmd === "generate_razorpay_qr") {
        return Promise.resolve({
            qr_id: "qr_test_123",
            image_url: "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=razorpay@icici"
        });
    }
    return Promise.resolve({});
}
