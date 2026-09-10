# GDJS Extension Test Harness

A lightweight, real-engine runtime & WebGL renderer testing environment for GDevelop 3D extensions.

---

## 🎯 Purpose & Why Mocks Fall Short

Traditional unit tests mock Three.js or stub GDJS data structures. While helpful for basic arithmetic, mocks cannot reproduce real-engine bugs, such as:
1. **Shared WebGL Context:** PIXI 7.4.2 and Three.js r160 sharing a single WebGL2 rendering context, where Three's cached GL state gets dirtied across engine render loops.
2. **Object Lifecycle & Custom Sizing:** GDevelop instantiates 3D objects with default bounding boxes (e.g. $100 \times 100 \times 100$) and applies custom instance sizing *afterwards* (`customSize: true`), which breaks extensions that sample size only during `onCreated`.
3. **Y-Inversion & Camera Projections:** GDevelop applies `scale.y = -1` to the scene 3D root and transforms layer cameras with custom perspective angles.
4. **Depth Attachment & Composers:** Complex post-processing effects and underwater masks require real framebuffer attachments and depth textures.

`gdjs-harness` extracts only the minimal GDJS runtime files needed to boot an authentic 3D scene directly from your installed GDevelop application.

---

## 📁 Architecture

```
gdjs-harness/
├── setup.mjs               # Discovers local GDevelop install & copies minimal runtime files (76 files)
├── serve.js                # Static HTTP server on port 8140 serving harness and /ext/ repo folders
├── project.js              # Real gdjs.projectData schema definition with 3D layers & objects
├── index.html              # Harness dashboard with scenario picker, canvas, and live diagnostic panel
├── test-headless.mjs       # Headless Chrome/CDP runner for single scenario verification
├── test-all-scenarios.mjs  # Automated test runner testing all 7 scenarios against the real engine
└── scenarios/
    ├── ocean.js            # OceanFFT3D (Tessendorf GPU FFT spectrum, whitecaps, GL context sharing)
    ├── gerstner.js          # WaterBody3D (Gerstner octaves, Beer-Lambert optics, underwater FX)
    ├── buoyancy.js         # Buoyancy3D (4-probe floating boat hull tracking surface height & pitch/roll)
    ├── sph.js              # PourableLiquid3D (SPH fluid droplets, pouring flow, container fill tracking)
    ├── lighting.js         # AdvancedLighting3D (Clustered lighting, volumetric fog, light probe grid)
    ├── postfx.js           # CinematicPostFX3D (Depth buffer attachments, Bokeh DoF, Bloom pyramid)
    └── material.js         # Material3D (BRDF shaders, sheen, iridescence, anisotropy, wetness)
```

---

## 🚀 Quick Start

### 1. Setup Runtime Files
Extracts the minimum runtime files from your GDevelop installation into `gdjs-harness/runtime/`:
```bash
node gdjs-harness/setup.mjs
```

### 2. Interactive Browser Testing
Start the static server:
```bash
node gdjs-harness/serve.js
```
Open **[http://localhost:8140](http://localhost:8140)** in your browser.
- Switch scenarios dynamically using the top dropdown
- Toggle wireframe mode
- Pause/resume engine loop
- View real-time diagnostics and shader compilation outputs in the left panel

### 3. Automated Headless Test Suite
Run the full headless suite via Chrome DevTools Protocol:
```bash
node gdjs-harness/test-all-scenarios.mjs
```

---

## 🛠️ Adding a New Scenario

1. Create a new JavaScript file in `gdjs-harness/scenarios/<your_scenario>.js`:
```javascript
(function () {
  var H = window.__harness;
  var scene = H.scene;
  var layer = scene.getLayer('');

  H.h2('My Extension Test');

  // Setup your object or behavior
  var obj = scene.getObjects('Ocean')[0];
  // ... configure extension ...

  // Run assertions and log to harness panel
  setTimeout(function () {
    H.log('Status: OK', 'ok');
    H.h2('DONE');
  }, 1500);
})();
```
2. Add `<option value="your_scenario">` to `index.html` and add `'your_scenario'` to `test-all-scenarios.mjs`.
