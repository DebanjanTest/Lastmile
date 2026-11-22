# UI Templates

## Overview
HTML Jinja2 / frontend view templates for the LastMile Guard Heads-Up Display (HUD). Injects runtime API configurations (Google Maps, Firebase Authentication, Razorpay) and defines the 800x480 WVGA responsive driver cockpit layout.

## Interface
- `[index.html:google_maps_api_key]`
- `[index.html:firebase_config]`
- `[index.html:razorpay_config]`
- `[index.html:window.GOOGLE_MAPS_API_KEY]`
- `[index.html:window.FIREBASE_CONFIG]`
- `[index.html:window.RAZORPAY_CONFIG]`

## Invariants
- `[index.html]` Google Maps JavaScript SDK is conditionally included only when `google_maps_api_key` is provided and exceeds 10 characters.
- `[index.html]` Runtime global configuration objects fallback to safe defaults (`''` or `{}`) when backend context variables are omitted.

## Side Effects
- `[index.html]` Sets properties on the global `window` object: `window.GOOGLE_MAPS_API_KEY`, `window.FIREBASE_CONFIG`, and `window.RAZORPAY_CONFIG`.
- `[index.html]` Loads external CDN resources from unpkg.com, gstatic.com, and Google Maps API servers.

## Verification
- Run: `python3 -m unittest discover tests/`
