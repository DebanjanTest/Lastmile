# UI Static JavaScript

## Overview
Client-side presentation scripting and polyfill shims for the LastMile Guard Automotive HUD. Provides browser geolocation bridging, Google Maps Leaflet/Vector canvas orchestration, WebSocket telemetry synchronization, swipe gesture touch interactions, and Razorpay modal handling.

## Interface
- `[web_shim.js:window.fetch]`
- `[web_shim.js:navigator.geolocation]`
- `[tripper.js:window.initGoogleMap]`
- `[tripper.js:openRazorpayCodModal]`

## Invariants
- `[web_shim.js]` Intercepts Tauri invoke calls only when running in browser environments (`window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'`).
- `[tripper.js]` Navigation turn updates only trigger when valid route polylines contains >= 2 coordinates.
- `[tripper.js]` Driver day/night theme automatically switches based on local time window (`hour >= 6 && hour < 18` for day, otherwise night).
- `[tripper.js]` Delivery OTP verification modal requires complete 4-digit code before enabling submission.

## Side Effects
- `[web_shim.js]` Dispatches periodic HTTP polling requests and initiates browser geolocation requests via `navigator.geolocation.watchPosition`.
- `[tripper.js]` Attaches DOM touch and mouse event listeners, modifies DOM element classes, dispatches synthetic window events, and persists user preferences to `localStorage`.

## Verification
- Run: `python3 -m unittest discover tests/`
