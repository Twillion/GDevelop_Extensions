# WGLEXE_Packager: Architecture & Implementation Blueprint

A high-performance C++ Chromium Host runtime, packager tool, and companion GDevelop extension designed to eliminate Electron bottlenecks, unlock hardware-level WebGL/WebGPU flags, enable zero-copy multi-threading (`SharedArrayBuffer`), and bridge C++ native compute workers to GDevelop games.

---

## 1. High-Level Architecture

```
                               ┌──────────────────────────────────────────────┐
                               │             GDevelop 5 Project               │
                               │  (HTML5 Export: index.html, assets, gd.js)   │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │           WGLEXE Packager CLI Tool           │
                               │     (packager.py / wglexe.config.json)       │
                               └──────────────────────┬───────────────────────┘
                                                      │ Generates
                                                      ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Packaged Windows Executable (.exe)                                    │
│                                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                       C++ Win32 Host Process                                     │  │
│  │                                                                                                  │  │
│  │  • GPU Flag Injector (ANGLE D3D11/Vulkan, WebGL Drafts, Zero-Copy, V-Sync / Uncapped FPS)        │  │
│  │  • Virtual Local Server (COOP: same-origin, COEP: require-corp -> SharedArrayBuffer unlocked)    │  │
│  │  • Native C++ Worker Pool (SIMD Math, Physics, Raycasting, Pathfinding via Fast C++ Threads)     │  │
│  │  • Win32 Window Manager (Frameless, Borderless Fullscreen, High-DPI scaling)                     │  │
│  └──────────────────────────────────┬───────────────────────────────────────────┬───────────────────┘  │
│                                     │ IPC / Shared Memory                       │ WebView Host         │
│                                     ▼                                           ▼                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               Chromium Engine (Blink / V8 / WebGL 2)                             │  │
│  │                                                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                                 GDevelop Game Runtime (JS)                                 │  │  │
│  │  │                                                                                            │  │  │
│  │  │   ┌─────────────────────────────────────────────────────────────────────────────────────┐  │  │  │
│  │  │   │                        WGLEXEOffloader Extension (GDevelop)                         │  │  │  │
│  │  │   │  • Web Worker Pool Manager (Background JS Threads)                                  │  │  │  │
│  │  │   │  • SharedArrayBuffer / Atomics Memory Manager                                       │  │  │  │
│  │  │   │  • WebGL Multi-Draw (`WEBGL_multi_draw`, `gl_DrawID`) Optimizer                     │  │  │  │
│  │  │   │  • Native C++ Bridge Connector (`window.__WGLEXE__` with Browser Fallback)          │  │  │  │
│  │  │   └─────────────────────────────────────────────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
WGLEXE_Packager/
├── ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md
├── wglexe.config.json                  # Default project packaging configuration
│
├── runtime_cpp/                        # C++ High-Performance Host Application
│   ├── CMakeLists.txt                  # Modern CMake build configuration (MSVC x64)
│   ├── packages.config                 # NuGet packages (Microsoft.Web.WebView2 / dependencies)
│   ├── include/
│   │   ├── GpuConfig.h                 # Chromium command-line switches & GPU flags injector
│   │   ├── VirtualServer.h             # Embedded HTTP/Custom scheme server with COOP/COEP
│   │   ├── NativeBridge.h              # C++ Native Worker thread pool and IPC / Shared Memory
│   │   ├── WindowManager.h             # Win32 window creation, DPI, fullscreen & event loops
│   │   └── ResourceHelper.h            # In-memory asset unpacking or embedded resource reader
│   ├── src/
│   │   ├── main.cpp                    # WinMain entry point & application lifecycle
│   │   ├── GpuConfig.cpp               # Flag builders (--enable-webgl-draft-extensions etc.)
│   │   ├── VirtualServer.cpp           # Custom scheme / embedded stream handler
│   │   ├── NativeBridge.cpp            # C++ async task runner & PostSharedBufferToScript
│   │   └── WindowManager.cpp           # Win32 WndProc & display controller
│   └── res/
│       ├── app.ico                     # Default application icon
│       ├── app.rc                      # Windows resource definition
│       └── resource.h
│
├── packager_cli/                       # CLI Automation & Packaging Script
│   ├── packager.py                     # Python CLI packager (bundles game + runtime)
│   ├── requirements.txt                # Python dependencies (if any)
│   └── templates/                      # Pre-built runtime templates or build trigger
│
└── gdevelop_extension/                 # GDevelop 5 Extension files
    ├── extension.json                  # Extension metadata, actions, conditions, expressions
    ├── WGLEXEOffloader.js              # Core JS runtime script injected into GDevelop
    └── workers/
        └── generic_compute_worker.js   # Background worker script template for math & logic
```

---

## 3. Component Specifications

### 3.1 C++ Runtime Engine (`runtime_cpp`)

#### A. GPU Configuration (`GpuConfig.h / .cpp`)
Injects low-level switches into Chromium before the browser context initializes:
```cpp
// Target Flags to Inject:
// 1. WebGL & Shader Features
"--enable-webgl-draft-extensions"               // Unlocks base_vertex_base_instance & draft extensions
"--enable-parallel-shader-compile"              // Multi-threaded shader compile in background driver
// 2. Hardware Acceleration & Backend
"--use-angle=d3d11"                             // Forces fast Direct3D 11 backend (or vulkan)
"--enable-gpu-rasterization"                    // Direct GPU rasterizer
"--enable-zero-copy"                            // Eliminates CPU-to-GPU memory copies
"--ignore-gpu-blocklist"                        // Prevents driver-level software fallbacks
// 3. Multi-Threading & Concurrency
"--enable-features=SharedArrayBuffer,Vulkan"    // Enables SAB without browser restrictions
// 4. Frame Pacing & Display
"--disable-frame-rate-limit"                    // Optional: Uncaps 60 FPS cap for high-Hz monitors
"--disable-gpu-vsync"                           // Optional: Low-latency esports pacing
```

#### B. Virtual Server & Cross-Origin Isolation (`VirtualServer.h / .cpp`)
* Standard local `file://` protocols block `SharedArrayBuffer` and Web Workers.
* The C++ Host uses a custom virtual scheme (e.g., `https://wglexe.game/` or `app://game/`) or an embedded lightweight local streamer.
* Injects mandatory security headers into every response:
  * `Cross-Origin-Opener-Policy: same-origin`
  * `Cross-Origin-Embedder-Policy: require-corp`
  * `Access-Control-Allow-Origin: *`

#### C. Native C++ Bridge (`NativeBridge.h / .cpp`)
* Exposes `window.__WGLEXE__` to GDevelop’s JavaScript environment.
* Supports **Bidirectional Message Passing** and **Shared Memory**:
  * `window.__WGLEXE__.callNative(taskName, payloadData)` -> Runs in native C++ worker thread pool with SIMD (AVX2), returns Promise.
  * `window.__WGLEXE__.postSharedBuffer(buffer)` -> Zero-copy memory buffer between C++ and JS.
  * `window.__WGLEXE__.isNativeRuntime` -> Returns `true` (enables fallback detection in GDevelop).

---

### 3.2 Packaging Configuration (`wglexe.config.json`)

```json
{
  "appName": "MyGDevelopGame",
  "version": "1.0.0",
  "executableName": "MyGame.exe",
  "icon": "res/app.ico",
  "window": {
    "title": "My GDevelop Game",
    "width": 1280,
    "height": 720,
    "resizable": true,
    "fullscreen": false,
    "borderless": false,
    "framerateLimit": 0
  },
  "gpu": {
    "angleBackend": "d3d11",
    "enableDraftExtensions": true,
    "enableZeroCopy": true,
    "ignoreGpuBlocklist": true,
    "disableVsync": false
  },
  "security": {
    "enableSharedArrayBuffer": true,
    "enableNativeBridge": true
  }
}
```

---

### 3.3 Packager CLI (`packager_cli/packager.py`)

Workflow of the CLI script:
1. **Input:** Path to exported GDevelop HTML5 folder (`--source <dir>`).
2. **Config:** Reads `wglexe.config.json` (or CLI flags for override).
3. **Asset Packaging:** Compresses/embeds game assets into the C++ runtime bundle or creates an encrypted/packaged game data archive (`game.dat`).
4. **Compilation / Finalization:** Uses CMake/MSVC (or pre-compiled binary template patching) to output the standalone distribution directory or single `.exe`.

---

### 3.4 GDevelop Extension (`WGLEXEOffloader`)

#### Actions & Expressions to Expose in GDevelop Editor:

| Category | Item Name | Type | Description |
| :--- | :--- | :--- | :--- |
| **Runtime Detection** | `IsWGLEXERuntime()` | Condition | Checks if game is running in the high-performance C++ packager |
| **Worker Offloading** | `DispatchWorkerTask(taskName, jsonArgs, resultVar)` | Action | Dispatches heavy compute to a background JS Web Worker |
| **Native C++ Compute** | `CallNativeTask(taskName, jsonArgs, resultVar)` | Action | Calls native C++ worker thread with fallback to JS worker |
| **Multi-Draw Helpers** | `IsMultiDrawSupported()` | Condition | Checks if `WEBGL_multi_draw` extension is active |
| **Performance Control**| `SetMaxFPS(fps)` | Action | Dynamically adjusts the target framerate limit |

#### JS Architecture (`WGLEXEOffloader.js`):
```javascript
gdjs._wglexe = {
    isNative: typeof window.__WGLEXE__ !== 'undefined',
    workerPool: [],
    initWorkers(count = 4) { /* Spawns Web Workers with COOP/COEP support */ },
    dispatch(task, data) {
        if (this.isNative && window.__WGLEXE__.hasNativeTask(task)) {
            return window.__WGLEXE__.callNative(task, data);
        }
        return this.dispatchToWebWorker(task, data);
    }
};
```

---

## 4. Step-by-Step Implementation Guide (For Claude / Developer)

### Step 1: Initialize CMake & C++ Host Project
1. Create `runtime_cpp/CMakeLists.txt` configured for Visual Studio 2022 / MSVC (`/std:c++20`).
2. Integrate `Microsoft.Web.WebView2` NuGet / C++ package.
3. Implement `main.cpp` creating a Win32 window with high-DPI awareness (`SetProcessDpiAwarenessContext`).

### Step 2: Implement GPU Switch Injector
1. Implement `GpuConfig.cpp` to parse `wglexe.config.json` and generate the `AdditionalBrowserArguments` wide-string for WebView2/Chromium environment options.
2. Verify flags: `--enable-webgl-draft-extensions`, `--use-angle=d3d11`, `--enable-features=SharedArrayBuffer`.

### Step 3: Implement Virtual Streamer & Cross-Origin Isolation
1. Implement `VirtualServer.cpp` utilizing `ICoreWebView2::AddWebResourceRequestedFilter` to intercept requests to `https://wglexe.game/*`.
2. Map requests to local disk files in the game folder and append `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers.

### Step 4: Implement Native C++ Worker Bridge
1. Set up a C++ `std::thread` pool for background SIMD / computation tasks.
2. Expose `window.chrome.webview.postMessage` / `window.__WGLEXE__` bindings.

### Step 5: Build the Python Packager CLI
1. Write `packager_cli/packager.py` with `argparse` (`--input`, `--output`, `--config`).
2. Automate copying runtime binaries, icon compilation, and configuration embedding.

### Step 6: Create the GDevelop Extension JSON
1. Create `gdevelop_extension/extension.json` declaring actions, conditions, and properties.
2. Implement `WGLEXEOffloader.js` with the worker pool and bridge fallback logic.
