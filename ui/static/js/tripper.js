// ==============================================================================
// LastMile Guard - Zomato & Swiggy Delivery Partner 5.0" Client
// ==============================================================================

let ws = null;
let audioCtx = null;
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let trafficPolylines = [];
let hotspotCircles = [];
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

    // 1. Shift Duty & Rider Statistics
    if (data.partner) {
        updateDutyAndPartnerState(data.partner);
    }

    // 2. GPS Telemetry & Kinematics
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

    // 3. Navigation Turn Card & Traffic Polyline
    if (data.navigation) {
        const nav = data.navigation;
        const turnCard = document.getElementById("turnCard");
        const order = data.order;

        // Only show turn card during active transit (EN_ROUTE_PICKUP or EN_ROUTE_CUSTOMER)
        if (order && (order.state === "EN_ROUTE_PICKUP" || order.state === "EN_ROUTE_CUSTOMER")) {
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

    // 4. Emergency SOS Overlay
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

function updateDutyAndPartnerState(partner) {
    const shiftState = partner.shift_state;
    const stats = partner.stats;
    const order = partner.current_order;

    // 1. Duty status pill in header
    const dutyPill = document.getElementById("dutyPill");
    const dutyText = document.getElementById("dutyText");
    const searchingOverlay = document.getElementById("searchingOverlay");

    if (shiftState === "OFF_DUTY") {
        dutyText.textContent = "OFF-DUTY • PAUSED";
        dutyPill.querySelector(".duty-dot").className = "duty-dot dot-offline";
        if (searchingOverlay) searchingOverlay.style.display = "none";
    } else if (shiftState === "ONLINE_SEARCHING") {
        dutyText.textContent = "ONLINE • SEARCHING GIGS";
        dutyPill.querySelector(".duty-dot").className = "duty-dot dot-online";
        if (searchingOverlay) searchingOverlay.style.display = "flex";
    } else if (shiftState === "ON_ORDER") {
        dutyText.textContent = `ON ORDER • #${order ? order.order_id : ''}`;
        dutyPill.querySelector(".duty-dot").className = "duty-dot dot-order";
        if (searchingOverlay) searchingOverlay.style.display = "none";
    }

    // 2. Stats pill in header
    if (stats) {
        const earnEl = document.getElementById("earningsBadge");
        if (earnEl) earnEl.textContent = `💰 ₹${Math.round(stats.earnings_today_inr)}`;
        const msEl = document.getElementById("milestoneBadge");
        if (msEl) msEl.textContent = `🎯 ${stats.orders_completed_today}/${stats.daily_target_orders} Orders`;
    }

    // 3. Hotspot surge visualization
    if (partner.hotspots && mapInstance && hotspotCircles.length === 0) {
        partner.hotspots.forEach(h => {
            const circle = L.circle([h.lat, h.lng], {
                color: h.color,
                fillColor: h.color,
                fillOpacity: 0.15,
                radius: 1200
            }).addTo(mapInstance);
            hotspotCircles.push(circle);
        });
    }

    // 4. Modal Screen Switcher according to authentic delivery state
    renderDeliveryPartnerModals(order);
}

function renderDeliveryPartnerModals(order) {
    const offerModal = document.getElementById("orderOfferModal");
    const storeChecklist = document.getElementById("storeChecklistModal");
    const customerOtp = document.getElementById("customerOtpModal");
    const transitStrip = document.getElementById("transitStageBanner");
    const destHeader = document.getElementById("destHeaderLabel");

    // Hide all initially
    if (offerModal) offerModal.style.display = "none";
    if (storeChecklist) storeChecklist.style.display = "none";
    if (customerOtp) customerOtp.style.display = "none";
    if (transitStrip) transitStrip.style.display = "none";

    if (!order) {
        if (destHeader) destHeader.textContent = "TARGET DESTINATION:";
        return;
    }

    const state = order.state;

    // STAGE 1: Incoming Order Offer
    if (state === "OFFERED") {
        if (offerModal) offerModal.style.display = "flex";
        playAudioChime(950, 0.18);

        const platformTag = document.getElementById("offerPlatformTag");
        if (platformTag) {
            platformTag.textContent = `${order.platform.toUpperCase()} PARTNER`;
            platformTag.style.backgroundColor = order.platform === "zomato" ? "#E23744" : "#FC8019";
        }
        document.getElementById("offerPayout").textContent = `₹${order.earnings.total_payout.toFixed(2)}`;
        document.getElementById("offerRestName").textContent = order.restaurant_name;
        document.getElementById("offerRestAddr").textContent = order.restaurant_address;
        document.getElementById("offerPrepPill").textContent = `⏳ Food Ready in ~${order.prep_time_minutes} mins`;
        document.getElementById("offerCustName").textContent = order.customer_name;
        document.getElementById("offerCustAddr").textContent = order.customer_address;
        
        const itemsStr = order.items.map(i => `${i.quantity}x ${i.name}`).join(", ");
        document.getElementById("offerItems").textContent = `📦 ${itemsStr}`;
        document.getElementById("orderTimerChip").textContent = `⏱️ ${order.offer_remaining_seconds || 30}s`;

        // Breakdown pills
        const b = order.earnings;
        document.getElementById("payoutBreakdown").innerHTML = `
            <span class="breakdown-tag">Base: ₹${b.base_pay}</span>
            <span class="breakdown-tag">Distance: ₹${b.distance_pay}</span>
            <span class="breakdown-tag highlight-surge">Surge: ₹${b.surge_pay}</span>
            <span class="breakdown-tag highlight-tip">Tip: ₹${b.tips}</span>
        `;
    }

    // STAGE 2: En Route to Restaurant
    else if (state === "EN_ROUTE_PICKUP") {
        if (transitStrip) transitStrip.style.display = "flex";
        document.getElementById("transitBadge").textContent = "🛵 STEP 1: EN ROUTE TO RESTAURANT";
        document.getElementById("transitBadge").style.color = "#FC8019";
        document.getElementById("transitTitle").textContent = order.restaurant_name;
        document.getElementById("transitActions").innerHTML = `
            <button class="transit-action-btn" onclick="reachStore()" style="background:#F59E0B;">📍 REACHED STORE [R]</button>
        `;
        if (destHeader) destHeader.textContent = "STORE PICKUP:";
    }

    // STAGE 3: At Restaurant (Checklist & Prep)
    else if (state === "AT_RESTAURANT") {
        if (storeChecklist) storeChecklist.style.display = "flex";
        document.getElementById("chkRestName").textContent = order.restaurant_name;
        document.getElementById("chkOrderId").textContent = `MATCH ID: #${order.order_id}`;
        
        const listEl = document.getElementById("chkItemsList");
        listEl.innerHTML = order.items.map((item, idx) => `
            <div class="chk-item-row">
                <div class="chk-item-left">
                    <span class="${item.is_veg ? 'veg-tag' : 'nonveg-tag'}"></span>
                    <span>${item.quantity}x ${item.name}</span>
                </div>
                <input type="checkbox" checked style="width:18px;height:18px;accent-color:#00B0FF;">
            </div>
        `).join("");
    }

    // STAGE 4: En Route to Customer Doorstep
    else if (state === "EN_ROUTE_CUSTOMER") {
        if (transitStrip) transitStrip.style.display = "flex";
        document.getElementById("transitBadge").textContent = "📦 STEP 2: EN ROUTE TO CUSTOMER";
        document.getElementById("transitBadge").style.color = "#00E676";
        document.getElementById("transitTitle").textContent = `${order.customer_name} • ${order.customer_address}`;
        document.getElementById("transitActions").innerHTML = `
            <button class="transit-action-btn" onclick="reachCustomer()" style="background:#38BDF8;">📍 REACHED CUSTOMER [C]</button>
        `;
        if (destHeader) destHeader.textContent = "CUSTOMER DROP:";
    }

    // STAGE 5: At Customer Doorstep (OTP Verification)
    else if (state === "AT_CUSTOMER") {
        if (customerOtp) customerOtp.style.display = "flex";
        document.getElementById("otpCustName").textContent = order.customer_name;
        document.getElementById("otpInstrText").textContent = order.customer_instructions;
        
        const payCard = document.getElementById("otpPaymentCard");
        if (order.payment_mode === "COD") {
            payCard.innerHTML = `<span class="pay-icon">💵</span><span>CASH ON DELIVERY • COLLECT ₹${order.cod_amount.toFixed(2)} CASH / UPI</span>`;
            payCard.style.backgroundColor = "rgba(226, 55, 68, 0.15)";
            payCard.style.borderColor = "rgba(226, 55, 68, 0.4)";
            payCard.style.color = "#FF6B6B";
        } else {
            payCard.innerHTML = `<span class="pay-icon">🟢</span><span>PREPAID ORDER • DO NOT COLLECT CASH</span>`;
            payCard.style.backgroundColor = "rgba(0, 230, 118, 0.12)";
            payCard.style.borderColor = "rgba(0, 230, 118, 0.3)";
            payCard.style.color = "#00E676";
        }

        // Fill OTP hints
        const otpStr = order.delivery_otp || "4829";
        document.getElementById("otp1").value = otpStr[0] || "4";
        document.getElementById("otp2").value = otpStr[1] || "8";
        document.getElementById("otp3").value = otpStr[2] || "2";
        document.getElementById("otp4").value = otpStr[3] || "9";
        document.getElementById("otpHint").textContent = `Customer Phone: ${order.customer_phone} • OTP: ${otpStr}`;
    }
}

function showDeliveryCelebration(payout, milestoneProg) {
    const overlay = document.getElementById("deliverySuccessOverlay");
    if (!overlay) return;
    document.getElementById("earnedAmountText").textContent = `+₹${payout.toFixed(2)}`;
    document.getElementById("milestoneProgText").textContent = `${milestoneProg.orders_completed_today}/${milestoneProg.daily_target_orders} Completed`;
    document.getElementById("milestoneBarFill").style.width = `${milestoneProg.target_progress_pct}%`;
    
    overlay.style.display = "flex";
    playAudioChime(1200, 0.3);
    setTimeout(() => {
        overlay.style.display = "none";
    }, 3500);
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

// Dispatches command via WebSocket and HTTP REST with immediate state update
async function sendCommand(cmdObj) {
    playAudioChime(850, 0.08);
    console.log("[PARTNER ACTION]", cmdObj);
    
    // 1. Try WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmdObj));
    }
    
    // 2. Immediate REST Endpoint Call
    try {
        const act = cmdObj.action;
        let url = null;
        let body = null;

        if (act === "toggle_duty") url = '/api/duty/toggle';
        else if (act === "offer_order") url = `/api/orders/offer?platform=${cmdObj.platform || 'swiggy'}`;
        else if (act === "accept_order") url = '/api/orders/accept';
        else if (act === "reach_store") url = '/api/orders/reach-store';
        else if (act === "confirm_pickup") url = '/api/orders/pickup';
        else if (act === "reach_customer") url = '/api/orders/reach-customer';
        else if (act === "complete_delivery") {
            url = '/api/orders/deliver';
            body = JSON.stringify({ otp: cmdObj.otp || "4829" });
        }
        else if (act === "reject_order" || act === "decline_order") url = '/api/orders/reject';
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
                showDeliveryCelebration(jsonRes.result.payout, jsonRes.result.stats);
            }
        }
    } catch (err) {
        console.warn("[REST DISPATCH]", err);
    }
}

// Public action bindings
function toggleDuty() { sendCommand({ action: "toggle_duty" }); }
function offerMockOrder(platform = "swiggy") { sendCommand({ action: "offer_order", platform: platform }); }
function acceptOrder() { sendCommand({ action: "accept_order" }); }
function reachStore() { sendCommand({ action: "reach_store" }); }
function confirmPickup() { sendCommand({ action: "confirm_pickup" }); }
function reachCustomer() { sendCommand({ action: "reach_customer" }); }
function verifyOtpAndDeliver() {
    const o1 = document.getElementById("otp1")?.value || "4";
    const o2 = document.getElementById("otp2")?.value || "8";
    const o3 = document.getElementById("otp3")?.value || "2";
    const o4 = document.getElementById("otp4")?.value || "9";
    const entered = `${o1}${o2}${o3}${o4}`;
    sendCommand({ action: "complete_delivery", otp: entered });
}
function rejectOrder() { sendCommand({ action: "reject_order" }); }
function triggerSos() { sendCommand({ action: "trigger_sos" }); }
function triggerTilt() { sendCommand({ action: "trigger_tilt" }); }
function resetEmergency() { sendCommand({ action: "reset_emergency" }); }
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
    if (key === "G") toggleDuty();
    else if (key === "Z") offerMockOrder("zomato");
    else if (key === "O") offerMockOrder("swiggy");
    else if (key === "A") acceptOrder();
    else if (key === "R") reachStore();
    else if (key === "K") confirmPickup();
    else if (key === "C") reachCustomer();
    else if (key === "U") verifyOtpAndDeliver();
    else if (key === "S") triggerSos();
    else if (key === "T") triggerTilt();
    else if (key === "D") toggleDashcam();
    else if (key === "P") openDestinationModal();
    else if (key === "ESCAPE") {
        resetEmergency();
        closeDestinationModal();
        rejectOrder();
    }
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
    initMap(22.572645, 88.363892);
    initWebSocket();
});
