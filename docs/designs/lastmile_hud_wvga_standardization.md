# LastMile HUD WVGA Standardization & Cockpit Ergonomics

* **Author:** DebanjanTest
* **Date:** 2026-11-22
* **Status:** Approved

## 1. The Problem

LastMile Guard operates across two deployment environments: physical Raspberry Pi 5 touch displays (7-inch/5-inch DSI/HDMI) and desktop developer/demonstration monitors. Currently, two layout defects impair usability:

1. **Inconsistent Viewport Geometry**: On Raspberry Pi 5 DSI hardware, the screen is bound to an 800×480 WVGA native panel. On desktop preview displays, the webview stretches fluidly across arbitrary aspect ratios (16:9, 16:10), distorting touch geometry, metric hierarchy, and card bounds.
2. **Right-Edge Overlay Collisions**: The floating map toolset (Recenter, 3D, Dashcam PIP, Zoom +/–) and the incoming order card stack both anchor to `right: 12px`. The circular map buttons visually collide with and block card payout amounts, customer addresses, and action buttons. Furthermore, the driver's bottom status strip contains development testing controls (`+ + Customer Order [I]` and `Refresh [O]`) that crowd real-time trip telemetry and suffer from duplicate symbol syntax.

## 2. Overview

This design formalizes an exact 800×480 WVGA reference frame across both native Tauri and web environments. On desktop displays exceeding 800×480, the viewport is centered within a dark letterbox canvas using proportional CSS scale transforms while compensating Leaflet pointer coordinates to eliminate click/drag drift. Additionally, the layout separates right-edge controls into a dedicated 52px thumb gutter by translating the incoming order stack leftward (`right: 64px`), enforces single-line button heights with `white-space: nowrap`, and migrates debug injection controls into the collapsible driver profile drawer.

## 3. Goals & Non-Goals

### Goals
- Standardize canonical window and viewport boundaries to 800×480 WVGA across `src-tauri/tauri.conf.json` and web layouts.
- Centrally scale the 800×480 HUD frame on desktop monitors using dynamic CSS scaling (`transform: scale(S)`) with letterboxing.
- Preserve 1:1 Leaflet map touch and click coordinate accuracy under arbitrary desktop zoom scales.
- Eliminate visual clipping by creating a dedicated 52px right-thumb gutter (`right: 12px` to `64px`) for glove map controls.
- Normalize order action buttons (`Dismiss`, `Accept Order`, `Details`) to uniform `34px` flex height with `white-space: nowrap` and `text-overflow: ellipsis`.
- Relocate debug controls (`+ Customer Order`, `Refresh`) from the driver status bar to the profile drawer while retaining `I` and `O` hotkeys.

### Non-Goals
- Altering Linux kernel display timings or DRM modes in `boot/cmdline.txt`.
- Refactoring backend FastAPI endpoints, WebSocket schemas, or Python vehicle kinematics.
- Introducing external CSS libraries or third-party layout engines.

## 4. Technical Plan

### 4.1 Architecture & Viewport Topology

```
+-----------------------------------------------------------------------------------------+
| Desktop Fullscreen Canvas (1920x1080 or Laptop 16:10) [Dark Neutral Backdrop #030712]   |
|                                                                                         |
|       +--------------------------- 800x480 WVGA COCKPIT ---------------------------+    |
|       | [Turn Guidance]               [Leaflet Vector Map]          [Order Stack]  |    |
|       |                                                                            |    |
|       | [Speedometer]                (t: scaled by S)               (right: 64px)  |    |
|       |                                                             [Glove Gutter] |    |
|       | [Dock Slider]                                               (right: 12px)  |    |
|       | [Clean Telemetry Status Strip (ETA, Delay, Distance, Dest)] [Recenter, 3D] |    |
|       +----------------------------------------------------------------------------+    |
|                                                                                         |
|  CSS Transform Matrix: S = min(window.innerWidth / 800, window.innerHeight / 480)       |
|  Leaflet Mouse Normalization: clientPoint / S -> true canvas coordinates               |
+-----------------------------------------------------------------------------------------+
```

### 4.2 Detailed Component Modifications

#### 1. Tauri Configuration (`src-tauri/tauri.conf.json`)
- Maintain canonical window defaults at `width: 800`, `height: 480`, with `minWidth: 800` and `minHeight: 480`.
- Enable `resizable: true` to permit presentation window expansion and full-screen demonstration mode (`fullscreen: false` initial).

#### 2. Root Viewport & Scaling Mechanics (`ui/static/css/tripper.css`)
- **Container Structure**: Introduce a wrapper `#hudCanvasContainer` that fills the browser window (`100vw × 100vh`) with flex centering and a deep black background (`#000` / `#050811`).
- **Aspect-Locked Cockpit**:
  - Lock `.hud-viewport` to fixed `width: 800px; height: 480px; position: relative; overflow: hidden; will-change: transform; backface-visibility: hidden;`.
  - Apply dynamic `--hud-scale` CSS variable centered via `transform: scale(var(--hud-scale, 1)); transform-origin: center center;`.
  - On screens where viewport matches 800×480 (Raspberry Pi native): renders at true 1:1 scale.
  - On sub-WVGA or oversized displays: scales proportionally without clipping.
- **Dedicated 52px Right Glove Gutter**:
  - Keep `.driver-map-controls` at `right: 12px; width: 44px; z-index: 45;`.
  - Shift `.incoming-order-stack` and `.order-notification-stack` to `right: 64px; width: 260px; max-width: calc(100% - 150px); z-index: 40; max-height: calc(100% - 110px);`.
  - Width locked to 260px ($x \in [476\text{px}, 736\text{px}]$), ensuring safe visual clearance ($>160\text{px}$) from left-hand turn guidance and speedometer cards ($x \le 312\text{px}$).
  - Guarantees a continuous 52px vertical strip on the far right where map controls never overlap order cards, ensuring safe right-thumb access while riding.
- **Button Row Normalization**:
  - Normalize `.card-actions-row .card-buttons` with `display: flex; gap: 8px; align-items: center;`.
  - Set buttons (`.btn-card-dismiss`, `.btn-card-accept`, `.btn-card-details`) to `height: 34px; white-space: nowrap; flex: 1 1 auto; text-overflow: ellipsis; overflow: hidden;`.
- **Status Bar Layout**:
  - Remove debug elements from `.bottom-status-strip`.
  - Dedicate space entirely to `.strip-left` (ETA, distance, delay) and `.strip-center` (turn and destination), maintaining clean glanceability.

#### 3. Leaflet Coordinate Compensation & Dynamic Scaling (`ui/static/js/tripper.js`)
- **Resize Handler**:
  - Measure window dimensions and calculate `currentHudScale = Math.min(window.innerWidth / 800, window.innerHeight / 480)`.
  - Wrap updates in `requestAnimationFrame` to prevent layout thrashing during live window resizing.
  - Write `currentHudScale` to `--hud-scale` CSS variable on `document.documentElement`.
- **Leaflet Event Normalization**:
  - Standard Leaflet `map.mouseEventToContainerPoint(e)` calculates offsets against post-transform container bounding rects, creating severe translation drift under letterboxed scaling if divided naively.
  - Override `mouseEventToContainerPoint` to directly subtract post-transform `rect` from client coordinates and divide both by `currentHudScale`, supporting mouse and touch pointers:
    ```javascript
    let currentHudScale = 1.0;
    L.Map.prototype.mouseEventToContainerPoint = function(e) {
        const rect = this._container.getBoundingClientRect();
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
        if (currentHudScale !== 1.0) {
            return L.point((clientX - rect.left) / currentHudScale, (clientY - rect.top) / currentHudScale);
        }
        return L.point(clientX - rect.left, clientY - rect.top);
    };
    ```
  - This ensures clicking, dragging, and touch taps on the map point to the exact road coordinates without pixel drift across all letterboxed aspect ratios.
- **Drawer Debug Controls & Hotkeys**:
  - Relocate `#btnSimOrder` and `#btnRefreshFeed` into `#profileDrawer`.
  - Label `#btnSimOrder` clearly as `+ Customer Order [I]` (eliminating duplicate `+`).
  - Retain `window.addEventListener('keydown')` handlers for `KeyI` and `KeyO` so test shortcuts work globally even when the drawer is closed.

#### 4. HTML Chassis Adjustments (`ui/templates/index.html` & `ui/index.html`)
- Designate `ui/templates/index.html` as the canonical production template served by FastAPI, and synchronize `ui/index.html` as the local static preview shim.
- Wrap `.hud-viewport` in `<div class="hud-canvas-container" id="hudCanvasContainer">`.
- Move `#btnSimOrder` and `#btnRefreshFeed` from `.bottom-status-strip` into `#profileDrawer .drawer-content`.

## 5. Alternatives Considered

### 5.1 Decouple Map Canvas from Viewport Hierarchy
- **Proposal**: Render the Leaflet map in a full-viewport container underneath and overlay an 800×480 HUD frame on top.
- **Decision**: *Rejected by author*. This breaks stacking contexts, z-index layering, dark mode vignette masks, and night-vision CSS filters that apply to the cockpit container. Normalizing container point coordinates in `tripper.js` resolves pointer drift in under 10 lines of code without altering DOM structure.

### 5.2 Relocate Map Controls to Left Edge
- **Proposal**: Move `.driver-map-controls` to `left: 12px` adjacent to the turn guidance card.
- **Decision**: *Rejected by author*. Right-hand thumb reach on standard handlebar grips requires right-perimeter placement for rapid touch. Relocating map controls leftward crowds the speedometer and turn guidance card, introducing driver distraction. Shifting order cards leftward (`right: 64px`) preserves thumb ergonomics while eliminating visual occlusion.

### 5.3 Fully Responsive Fluid Grid (100vw × 100vh)
- **Proposal**: Permit the HUD to stretch horizontally and vertically to fill arbitrary desktop monitors.
- **Decision**: *Rejected by author*. Automotive HUD layouts are engineered for glanceability at fixed physical touch distances. Fluid stretching dilutes relative visual hierarchy and changes critical touch target hit-boxes (designed for 44px glove targets) unpredictably across screen sizes. A centered, aspect-locked 800×480 canvas preserves true hardware fidelity.

## 6. Detailed Implementation Plan

### 6.1 Touchpoints & File Manifest

| Target File | Action | Purpose & Rationale |
| :--- | :--- | :--- |
| `src-tauri/tauri.conf.json` | Modify | Lock window base resolution to 800×480; enable `resizable: true` so desktop window can scale freely while the webview remains aspect-locked. |
| `ui/static/css/tripper.css` | Modify | Define `#hudCanvasContainer` full-screen flex wrapper; lock `.hud-viewport` to 800×480 with CSS transform scale; update `.incoming-order-stack` to `right: 64px`; normalize order button heights and white-space; clean `.bottom-status-strip`. |
| `ui/static/js/tripper.js` | Modify | Attach dynamic scale calculator on window resize (`--hud-scale`); monkey-patch `L.Map.prototype.mouseEventToContainerPoint` to normalize coordinates by scale factor; wire keyboard events (`I` / `O`) to drawer buttons. |
| `ui/templates/index.html` | Modify | Wrap `.hud-viewport` inside `.hud-canvas-container`; move `#btnSimOrder` and `#btnRefreshFeed` into `#profileDrawer`; correct label to `+ Customer Order [I]`. |
| `ui/index.html` | Modify | Synchronize direct static HTML layout with template changes for browser mock and Tauri preview parity. |

### 6.2 Step-by-Step Execution Sequence

1. **Step 1: Update Tauri Window Properties (`src-tauri/tauri.conf.json`)**
   - Update `app.windows[0].resizable` to `true`.
   - Remove `"maxWidth": 800` and `"maxHeight": 480` so desktop demonstration windows can expand.
   - Maintain `width: 800`, `height: 480`, `minWidth: 800`, `minHeight: 480` as canonical base boundaries.
2. **Step 2: Update Viewport Styling & Dedicated Gutter (`ui/static/css/tripper.css`)**
   - Add `.hud-canvas-container`: `width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: #030712; overflow: hidden;`.
   - Update `.hud-viewport`: apply `transform: scale(var(--hud-scale, 1)); transform-origin: center center; flex-shrink: 0; will-change: transform; backface-visibility: hidden;`.
   - Remove the existing `@media (max-width: 800px), (max-height: 480px) { .hud-viewport { width: 100vw; height: 100vh; } }` override to prevent double-scaling distortion.
   - Update `.incoming-order-stack` and `.order-notification-stack`: change `right: 12px;` to `right: 64px; width: 260px; max-width: calc(100% - 150px);`.
   - Add `.card-buttons button`: `height: 34px; white-space: nowrap; text-overflow: ellipsis; flex: 1 1 auto;`.
   - Clean `.bottom-status-strip`: remove `.btn-strip-infiltrate` and `.btn-strip-refresh` margin and padding overrides.
   - Add drawer utility button styles inside `.profile-drawer` for `#btnSimOrder` and `#btnRefreshFeed`.
3. **Step 3: Implement Dynamic Scale & Leaflet Pointer Normalization (`ui/static/js/tripper.js`)**
   - Add `initViewportScaling()` function that listens to `window.resize` wrapped in `requestAnimationFrame`.
   - Compute `currentHudScale = Math.min(window.innerWidth / 800, window.innerHeight / 480)` without lower clamps and set `--hud-scale` on `document.documentElement`.
   - Patch `L.Map.prototype.mouseEventToContainerPoint` to normalize `clientX/Y - rect.left/top` by `currentHudScale` for mouse and touch points.
   - Verify keyboard listeners for `KeyI` (simulate order) and `KeyO` (refresh feed) dispatch correctly.
4. **Step 4: HTML Chassis Restructuring (`ui/templates/index.html` and `ui/index.html`)**
   - Wrap `.hud-viewport` inside `<div class="hud-canvas-container" id="hudCanvasContainer">`.
   - Move `.btn-strip-infiltrate` and `.btn-strip-refresh` from `.bottom-status-strip` into `#profileDrawer .drawer-content` inside a dedicated `.drawer-dev-tools` container, assigning `id="btnSimOrder"` and `id="btnRefreshFeed"`.
   - Clean up duplicate `+` icon on `#btnSimOrder` text (`+ Customer Order [I]`).
   - Synchronize `ui/index.html` with canonical `ui/templates/index.html`.
5. **Step 5: Regression & Verification Testing**
   - Execute test suite (`python3 -m unittest discover tests/`) to verify all 24 unit/integration tests pass without regression.
   - Verify live layout in Chrome headless and browser at `http://localhost:8000/`.
