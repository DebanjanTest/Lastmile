// ==============================================================================
// LastMile Guard - React 18 Multi-App Delivery HUD & 2-Phase Routing System
// ==============================================================================

const { useState, useEffect, useRef } = React;

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

let audioCtx = null;
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

// Leaflet Map & Blue Polyline Bridge
let mapInstance = null;
let riderMarker = null;
let destMarker = null;
let blueGlowPolyline = null;
let blueCorePolyline = null;
let trafficOverlays = [];

function initLeafletMap(initialLat = 22.5643, initialLng = 88.3693) {
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

        destMarker = L.marker([22.5855, 88.4168], { icon: destIcon }).addTo(mapInstance);
    } catch (e) {
        console.warn("[MAP INIT]", e);
    }
}

function renderGoogleMapsBlueRoute(polyline, trafficSegments) {
    if (!mapInstance || !polyline || polyline.length < 2) return;

    // Clear old route lines
    if (blueGlowPolyline) mapInstance.removeLayer(blueGlowPolyline);
    if (blueCorePolyline) mapInstance.removeLayer(blueCorePolyline);
    trafficOverlays.forEach(p => mapInstance.removeLayer(p));
    trafficOverlays = [];

    // 1. Google Maps Outer Blue Glow Boundary
    blueGlowPolyline = L.polyline(polyline, {
        color: '#0D47A1',
        weight: 12,
        opacity: 0.5,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(mapInstance);

    // 2. Google Maps Authentic Core Blue Line (#1A73E8)
    blueCorePolyline = L.polyline(polyline, {
        color: '#1A73E8',
        weight: 7,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(mapInstance);

    // 3. Traffic Congestion Overlays (Orange / Red)
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
}

// ==============================================================================
// REACT 18 MAIN HUD APPLICATION COMPONENT
// ==============================================================================
function HUDApp() {
    const [telemetry, setTelemetry] = useState(null);
    const [celebration, setCelebration] = useState(null);
    const [dashcamOpen, setDashcamOpen] = useState(false);
    const wsRef = useRef(null);

    // 1. WebSocket & Initial HTTP Fetch
    useEffect(() => {
        // Initial Fetch for instantaneous mount
        fetch('/api/telemetry')
            .then(res => res.json())
            .then(data => {
                setTelemetry(data);
                if (data.gps) initLeafletMap(data.gps.latitude, data.gps.longitude);
            })
            .catch(() => {});

        // Setup WebSocket
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

        function connectWs() {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    setTelemetry(data);
                } catch (e) {}
            };

            ws.onclose = () => {
                setTimeout(connectWs, 1500);
            };
        }

        connectWs();

        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    // 2. Synchronize Leaflet map with Telemetry Updates
    useEffect(() => {
        if (!telemetry) return;

        const gps = telemetry.gps;
        if (gps) {
            if (!mapInstance) {
                initLeafletMap(gps.latitude, gps.longitude);
            } else if (riderMarker) {
                riderMarker.setLatLng([gps.latitude, gps.longitude]);
                mapInstance.panTo([gps.latitude, gps.longitude], { animate: true, duration: 0.25 });
                
                const puckEl = document.getElementById("riderPuck");
                if (puckEl) puckEl.style.transform = `rotate(${gps.heading_deg}deg)`;
            }
        }

        // Render Google Maps Blue Polyline Route
        if (telemetry.navigation && telemetry.navigation.route_polyline) {
            renderGoogleMapsBlueRoute(telemetry.navigation.route_polyline, telemetry.navigation.traffic_segments);
            if (destMarker && telemetry.navigation.destination_coords) {
                destMarker.setLatLng([telemetry.navigation.destination_coords.lat, telemetry.navigation.destination_coords.lng]);
            }
        }
    }, [telemetry]);

    // 3. Dispatch action method (Dual WS + HTTP REST)
    const dispatchAction = async (action, payload = {}) => {
        playAudioChime(850, 0.08);
        
        // 1. WS
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action, ...payload }));
        }

        // 2. HTTP REST endpoint
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

            if (url) {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: body ? { 'Content-Type': 'application/json' } : {},
                    body: body
                });
                const jsonRes = await res.json();
                if (jsonRes && jsonRes.snapshot) {
                    setTelemetry(jsonRes.snapshot);
                }
                if (action === "complete_delivery" && jsonRes && jsonRes.result && jsonRes.result.success) {
                    setCelebration({ payout: jsonRes.result.payout });
                    playAudioChime(1200, 0.3);
                    setTimeout(() => setCelebration(null), 4000);
                }
            }
        } catch (e) {
            console.warn("[ACTION ERROR]", e);
        }
    };

    // 4. Expose dispatcher globally for test bench buttons and hotkeys
    useEffect(() => {
        window.hudDispatcher = {
            refreshOrders: () => dispatchAction("refresh_orders"),
            acceptTopOrder: () => dispatchAction("accept_order", { order_id: "" }),
            acceptOrder: (id) => dispatchAction("accept_order", { order_id: id }),
            reachStore: () => dispatchAction("reach_store"),
            confirmPickup: () => dispatchAction("pickup_order"),
            reachCustomer: () => dispatchAction("reach_customer"),
            completeDelivery: () => dispatchAction("complete_delivery"),
            dismissOffer: (id) => dispatchAction("dismiss_offer", { order_id: id }),
            triggerSos: () => dispatchAction("trigger_sos"),
            triggerTilt: () => dispatchAction("trigger_tilt"),
            toggleDashcam: () => setDashcamOpen(prev => !prev)
        };

        const handleKeyDown = (e) => {
            const k = e.key.toUpperCase();
            if (k === "O") window.hudDispatcher.refreshOrders();
            else if (k === "A") window.hudDispatcher.acceptTopOrder();
            else if (k === "R") window.hudDispatcher.reachStore();
            else if (k === "K") window.hudDispatcher.confirmPickup();
            else if (k === "C") window.hudDispatcher.reachCustomer();
            else if (k === "U") window.hudDispatcher.completeDelivery();
            else if (k === "S") window.hudDispatcher.triggerSos();
            else if (k === "T") window.hudDispatcher.triggerTilt();
            else if (k === "D") window.hudDispatcher.toggleDashcam();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const nav = telemetry?.navigation || {};
    const feed = telemetry?.feed || {};
    const orderPhase = telemetry?.order_phase || "IDLE";
    const selectedOrder = telemetry?.selected_order;
    const activeOffers = telemetry?.active_offers || [];
    const speedKmh = Math.round(telemetry?.gps?.speed_kmh || 0);

    const isInTransit = orderPhase === "ROUTE_TO_STORE" || orderPhase === "ROUTE_TO_CUSTOMER";

    return (
        <div className="react-hud-overlay">
            {/* TOP-LEFT: GOOGLE MAPS GREEN TURN CARD */}
            {isInTransit && (
                <div className="gmaps-turn-card" style={{ display: 'flex' }}>
                    <div className="turn-icon-box">
                        <svg className="turn-svg" viewBox="0 0 100 100">
                            <path d={SVG_ICONS[nav.maneuver_type] || SVG_ICONS.STRAIGHT} fill="#FFFFFF" />
                        </svg>
                    </div>
                    <div className="turn-text-content">
                        <div className="turn-dist-row">
                            <span className="turn-dist-num">{nav.distance_to_turn_m || 0}</span>
                            <span className="turn-dist-unit">m</span>
                            <span className="traffic-condition-badge" style={{ backgroundColor: nav.current_traffic_color || '#00E676' }}>
                                {nav.current_traffic_status === 'HEAVY_JAM' ? '🔴 Heavy Jam' : (nav.current_traffic_status === 'MODERATE' ? '🟠 Moderate' : '🟢 Flowing')}
                            </span>
                        </div>
                        <div className="turn-road-name">{nav.road_name || 'Main Road'}</div>
                        <div className="turn-next-preview">Then: {nav.next_instruction || 'Proceed'}</div>
                    </div>
                </div>
            )}

            {/* TOP-RIGHT: MULTI-APP POP-UP NOTIFICATION STACK (REACT VIRTUAL DOM) */}
            {(orderPhase === "IDLE" || orderPhase === "DELIVERED") && (
                <div className="order-notification-stack">
                    {activeOffers.length > 0 ? (
                        activeOffers.map(offer => (
                            <div key={offer.order_id} className="notification-card" style={{ borderLeftColor: offer.platform_color }}>
                                <div className="card-top-row">
                                    <span className="card-platform-badge" style={{ background: offer.platform_color }}>
                                        {offer.platform.toUpperCase()}
                                    </span>
                                    <span className="card-payout">₹{offer.payout_inr.toFixed(2)}</span>
                                </div>
                                <div className="card-store-row">
                                    <span>🏪</span>
                                    <div>
                                        <strong>{offer.store_name}</strong>
                                        <small style={{ display: 'block', color: '#94A3B8', fontSize: '10px' }}>{offer.items_summary}</small>
                                    </div>
                                    <span className="card-dist-pill">{offer.store_dist_km} km to store</span>
                                </div>
                                <div className="card-drop-row">
                                    <span>🏠</span>
                                    <span>{offer.customer_address} ({offer.drop_dist_km} km drop)</span>
                                </div>
                                <div className="card-actions-row">
                                    <span className="total-dist-tag">📍 {offer.total_dist_km} km total</span>
                                    <div className="card-buttons">
                                        <button className="btn-card-dismiss" onClick={() => dispatchAction("dismiss_offer", { order_id: offer.order_id })}>
                                            ✕ Dismiss
                                        </button>
                                        <button className="btn-card-accept" onClick={() => dispatchAction("accept_order", { order_id: offer.order_id })}>
                                            ✅ Opt In
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="notification-card" style={{ borderLeftColor: '#38BDF8', background: 'rgba(15,23,42,0.95)' }}>
                            <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '14px' }}>🛰️</span> Scanning for incoming delivery gigs...
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* FLOATING SPEEDOMETER BUBBLE */}
            <div className="gmaps-speed-bubble">
                <span className="speed-num">{speedKmh}</span>
                <span className="speed-label">km/h</span>
            </div>

            {/* ACTIVE 2-PHASE ROUTE BANNER */}
            {selectedOrder && (orderPhase === "ROUTE_TO_STORE" || orderPhase === "AT_STORE" || orderPhase === "ROUTE_TO_CUSTOMER") && (
                <div className="active-route-banner" style={{ display: 'flex' }}>
                    <div className="route-phase-info">
                        {orderPhase === "ROUTE_TO_STORE" && (
                            <>
                                <span className="route-phase-badge" style={{ color: '#FC8019' }}>📍 PHASE 1: BLUE ROUTE TO STORE</span>
                                <h4 className="route-target-title">{selectedOrder.store_name}</h4>
                                <small className="route-target-sub">{selectedOrder.store_address} • {selectedOrder.store_dist_km} km travel distance</small>
                            </>
                        )}
                        {orderPhase === "AT_STORE" && (
                            <>
                                <span className="route-phase-badge" style={{ color: '#00B0FF' }}>🏪 AT STORE: COLLECTING ORDER</span>
                                <h4 className="route-target-title">Token #{selectedOrder.order_id} • {selectedOrder.items_summary}</h4>
                                <small className="route-target-sub">Package ready at {selectedOrder.store_name}</small>
                            </>
                        )}
                        {orderPhase === "ROUTE_TO_CUSTOMER" && (
                            <>
                                <span className="route-phase-badge" style={{ color: '#00E676' }}>📦 PHASE 2: BLUE ROUTE TO DROP-OFF</span>
                                <h4 className="route-target-title">{selectedOrder.customer_name} • {selectedOrder.customer_address}</h4>
                                <small className="route-target-sub">{selectedOrder.customer_instructions} • {selectedOrder.drop_dist_km} km drop distance</small>
                            </>
                        )}
                    </div>
                    <div className="route-actions">
                        {orderPhase === "ROUTE_TO_STORE" && (
                            <button className="route-action-btn" style={{ background: '#F59E0B' }} onClick={() => dispatchAction("reach_store")}>
                                🏪 REACHED STORE [R]
                            </button>
                        )}
                        {orderPhase === "AT_STORE" && (
                            <button className="route-action-btn" style={{ background: '#00B0FF' }} onClick={() => dispatchAction("pickup_order")}>
                                🍴 FOOD PICKED UP [K]
                            </button>
                        )}
                        {orderPhase === "ROUTE_TO_CUSTOMER" && (
                            <button className="route-action-btn" style={{ background: '#7C4DFF', color: '#FFF' }} onClick={() => dispatchAction("complete_delivery")}>
                                ✅ COMPLETE DELIVERY [U]
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* CELEBRATION TOAST */}
            {celebration && (
                <div className="order-delivered-toast" style={{ display: 'flex' }}>
                    <span className="toast-icon">🎉</span>
                    <div className="toast-text">
                        <strong>Order Successfully Delivered!</strong>
                        <small>+₹{celebration.payout.toFixed(2)} Credited to Rider Wallet</small>
                    </div>
                </div>
            )}

            {/* DASHCAM PIP */}
            {dashcamOpen && (
                <div className="gmaps-dashcam-pip" style={{ display: 'block' }}>
                    <div className="dashcam-pip-bar">
                        <span>WITNESS DASHCAM [LIVE]</span>
                        <button className="pip-close" onClick={() => setDashcamOpen(false)}>✕</button>
                    </div>
                    <img src="/api/camera/stream" alt="Dashcam Stream" />
                </div>
            )}

            {/* BOTTOM GOOGLE MAPS TRIP BAR */}
            <div className="gmaps-bottom-card">
                <div className="trip-time-box">
                    <div className="trip-time-row">
                        <span className="trip-time-val">{nav.eta_minutes || 0} min</span>
                        <span className="traffic-delay-text" style={{ color: nav.traffic_delay_minutes > 0 ? '#FF1744' : '#00E676' }}>
                            {nav.traffic_delay_minutes > 0 ? `+${nav.traffic_delay_minutes} min delay` : 'Fastest route'}
                        </span>
                    </div>
                    <div className="trip-sub-row">
                        <span className="trip-dist-val">{nav.remaining_total_dist_km || 0} km</span>
                        <span className="trip-dot">•</span>
                        <span className="trip-eta-val">
                            {new Date(Date.now() + (nav.eta_minutes || 0) * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                </div>

                <div className="destination-preview-box">
                    <span className="dest-label">
                        {orderPhase === "ROUTE_TO_STORE" ? "PHASE 1 (SHOP PICKUP):" : (orderPhase === "ROUTE_TO_CUSTOMER" ? "PHASE 2 (DROP-OFF):" : "ACTIVE DESTINATION:")}
                    </span>
                    <span className="dest-name">{nav.destination_name || 'Scanning for orders nearby...'}</span>
                </div>

                <div className="trip-actions">
                    <button className="btn-import-dest" onClick={() => dispatchAction("refresh_orders")}>🔄 Refresh</button>
                    <button className="btn-end-route" onClick={() => dispatchAction("trigger_sos")}>🚨 SOS</button>
                </div>
            </div>

            {/* EMERGENCY OVERLAY */}
            {telemetry?.is_emergency && (
                <div className="emergency-overlay" style={{ display: 'flex' }}>
                    <div className="emergency-card">
                        <div className="emergency-icon">🚨</div>
                        <div className="emergency-title">{telemetry.emergency_reason || 'EMERGENCY SOS ACTIVE'}</div>
                        <div className="emergency-sub">Video Evidence Locked to /evidence/incidents/</div>
                        <div className="emergency-gps">GPS: {telemetry.gps?.latitude?.toFixed(6)}, {telemetry.gps?.longitude?.toFixed(6)} | Speed: {telemetry.gps?.speed_kmh} km/h</div>
                        <button className="btn-reset" onClick={() => dispatchAction("reset_emergency")}>DISMISS & RESUME NAVIGATION</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Mount React 18 Application Root
const rootElement = document.getElementById('reactHudRoot');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<HUDApp />);
}
