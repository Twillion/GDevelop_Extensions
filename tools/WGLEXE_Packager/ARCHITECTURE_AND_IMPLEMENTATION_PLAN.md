# WGLEXE_Packager — Architecture & Implementation Plan (v3, Steam target)

**Revised 2026-08-27.** v2 checked every premise against the GDevelop 5 build installed on this machine
(`%LOCALAPPDATA%\Programs\GDevelop\resources\GDJS`), its Three/Pixi bundles, and current
Microsoft/Chromium documentation. v3 folds in the confirmed distribution target — **Steam** — which
settles the biggest open question and reverses one of v2's defaults. The original document is preserved as
`ARCHITECTURE_AND_IMPLEMENTATION_PLAN.v1-original.md`.

**Goal (unchanged):** let a GDevelop game escape the limits of its default desktop export — locked GPU
settings, no `SharedArrayBuffer`, no real background threads, no native compute — and ship as a
configurable Windows executable.

**Method (changed in v2):** v1 proposed a bespoke C++ Chromium host on WebView2. GDevelop's existing
Electron export already grants *more* low-level control than WebView2 would, and the real blocker is a
single line in GDevelop's `main.js`. The plan is a tier ladder where **Tier 1, a post-export patcher, is
the product** — delivered as a **portable GUI application** that assembles the game against a bundled
Electron runtime rather than driving a build toolchain (§5.1, §5.6).

**What Steam changes (v3):**

* **Tier 3 (bespoke C++ host) is ruled out**, not merely deferred. GDevelop's Steamworks support runs on
  the `steamworks.js` **native Node addon**; no non-Electron host can run it, so shipping to Steam and
  replacing the host are mutually exclusive.
* **The default `SharedArrayBuffer` strategy flips** from cross-origin isolation to the
  `--enable-features=SharedArrayBuffer` switch. On Steam you own the binary and its command line, so the
  standards-track workaround buys nothing it costs. Details in §5.3.

* Three new hard requirements enter the build: the **Steam overlay**, the **depot layout**, and the
  **Steam Deck**. §2.

**Confirmed: there is no shipped build and no installed player base.** This removes the save-migration
hazard from §5.3 Mode B entirely and makes the origin choice free. It does **not** change the
recommendation — Mode A remains the default, for the reasons in §5.3 — but it downgrades Mode B from
"forbidden" to "a cheap spike worth running", and it makes an Electron version bump a real option (§5.4).

---

## 1. Verification results

Facts established by reading the shipped runtime, not inferred.

| v1 assumption | Verified finding | Consequence |
| :--- | :--- | :--- |
| Electron is a bottleneck that blocks GPU flags | `Runtime/Electron/main.js` **already calls** `app.commandLine.appendSwitch('disable-features', 'EnableWindowsGamingInputDataFetcher')`. Electron accepts arbitrary Chromium switches. | The "GPU flag injector" needs no new host. It is a `main.js` patch. |
| `file://` blocks SharedArrayBuffer, so we need a C++ virtual server | True cause identified: `mainWindow.loadFile('app/index.html')` loads an opaque `file://` origin. | Fixable in Electron — and on Steam, fixable more cheaply still (§5.3). |
| Native C++ compute requires a new runtime | `webPreferences: { nodeIntegration: true, contextIsolation: false }`. GDevelop's renderer has **full Node access today**. | An N-API `.node` addon is `require()`-able directly from GDevelop JavaScript events. No host rewrite. |
| A JS extension can add WebGL multi-draw | GDevelop ships **Three r160**, which already contains `BatchedMesh` and `WEBGL_multi_draw` (18 and 2 symbol hits in `three.js`). Pixi 7.4.2 contains **zero** multi-draw references. | 3D batching is a Three-level feature available now. 2D multi-draw is not achievable without forking Pixi — drop it. |
| A Win32 window manager is needed | GDevelop's built-in **AdvancedWindow** extension already does borderless, fullscreen, kiosk, always-on-top, opacity, position, focus — via `@electron/remote`. | Reimplementing it is regression, not progress. |
| Swapping the host is cost-free | Four shipped runtime files require Electron: `Extensions/AdvancedWindow/electron-advancedwindowtools.js`, `Extensions/FileSystem/filesystemtools.js`, `Extensions/Steamworks/steamworkstools.js` (loads the `steamworks.js` **native Node addon**), and `pixi-renderers/runtimegame-pixi-renderer.js` (fullscreen). | On a Steam target this is decisive — see §7. |
| WebView2 flags unlock hardware features | Microsoft's own docs: *"Apps in production shouldn't use WebView2 browser flags"*, and switches important to WebView functionality are ignored outright. The Evergreen runtime updates out from under you. | WebView2 offers *less* flag guarantee than Electron, not more. |
| A C++ host is the small option | WebView2 **Fixed Version** distribution is **>250 MB** — larger than an Electron app (~180 MB). Only Evergreen is small (~2 MB host), and it surrenders version control. | The size argument only works in the least deterministic configuration. |

**Environment baseline:** GDevelop's Electron export pins `electron@32.3.3` (**Chromium 128**) and
`electron-builder@26.4.0`. Renderer stack: Pixi 7.4.2 (2D) and Three r160 (3D). The Chromium version
matters in §5.3 — Document-Isolation-Policy needs 137.

### Two additional corrections

* **`WEBGL_multi_draw` is not a draft extension.** It is ratified and shipped. `--enable-webgl-draft-extensions`
  is not required for `BatchedMesh` and buys nothing the plan actually uses.
* **`--enable-parallel-shader-compile` could not be verified as a real Chromium switch.** The genuine lever
  is the `KHR_parallel_shader_compile` WebGL extension, enabled by default and driven from JavaScript via
  `COMPLETION_STATUS_KHR`. Use the extension; drop the flag.

---

## 2. Steam distribution constraints

These are requirements, not preferences. Each one has been the cause of a shipped-and-broken Electron game.

### 2.1 The Steam overlay does not work by default

Electron renders in a separate GPU process; the Steam overlay hooks the process that presents frames.
Out of the box the overlay simply does not appear — which also costs you Steam screenshots, the shift-tab
menu, Steam Input's on-screen keyboard, and in-game purchases.

The known workaround is a command-line switch:

```js
app.commandLine.appendSwitch('in-process-gpu');
// Some titles also need this; test both ways:
app.commandLine.appendSwitch('disable-direct-composition');
```

Two caveats the packager must carry:

* **`--in-process-gpu` is a load-bearing, historically fragile switch.** Test it against the exact Electron
  version being shipped, and re-test on every Electron bump. It is the single most likely thing in this
  plan to break silently.
* The usual companion workaround — a full-screen always-repainting canvas, because Chromium skips
  compositing when nothing changes — is **probably unnecessary for GDevelop**, whose game canvas repaints
  every frame under `requestAnimationFrame` anyway. Verify rather than assume; if the overlay flickers,
  that is the cause.

`in-process-gpu` must be **on by default** in a Steam build and exposed as `steam.overlayCompat` so it can
be disabled for diagnosis.

### 2.2 Depot layout: `dir`, never `nsis`

Steam depots take a **plain directory** that SteamPipe uploads verbatim; the Steam client is the installer.
Shipping an NSIS installer into a depot is wrong and will be rejected in review or produce a broken
install. The v2 config defaulted `build.target` to `nsis`; **v3 defaults it to `dir`.**

Required alongside the executable:

* `steam_api64.dll` next to the exe — GDevelop's Steamworks extension loads it through `steamworks.js`.
* The App ID set in **Game Properties → Steamworks** before export.
* `steam_appid.txt` **for local development only**. It must not be uploaded to the depot; the packager
  should refuse to build a depot folder containing one, or strip it and say so.

### 2.3 Steam Input — already handled, do not undo it

GDevelop's `main.js` disables `EnableWindowsGamingInputDataFetcher` because Steam suppresses XInput and
DirectInput and feeds its own virtual pad; without the fallback fetcher, Steam-launched games see **no
gamepad at all, including on Steam Deck**. The switch-merge logic in §5.2 exists specifically so this
survives. A regression test asserting the final `disable-features` value is mandatory, not optional.

### 2.4 Steam Deck

Windows Electron builds run on the Deck through Proton, where Chromium's sandbox and Steam's sandbox have
a history of conflicting, and where Game Mode has been reported to behave differently from Desktop Mode.
Treat the Deck as a first-class test target from M1, not a launch-week discovery:

* Prefer shipping a **native Linux depot** (GDevelop exports Linux via the same Electron path) over relying
  on Proton, if the Deck matters commercially.
* If Proton is the route, budget for sandbox flags and expect to test Game Mode explicitly.
* The Deck is also where `in-process-gpu` and `ignore-gpu-blocklist` are most likely to misbehave.

### 2.5 Saves and Steam Cloud

GDevelop's Storage actions are **`localStorage`-backed** (`events-tools/storagetools.js`; `runtimegame.js`
uses it too). That has two consequences:

* Saves live inside Electron's user-data Local Storage database, not in a tidy file. Steam **Auto-Cloud**
  wants globbable file paths, so Storage-based saves are awkward to sync. Games that need Cloud should use
  the FileSystem extension or `SaveState` and write real files.
* `localStorage` is **scoped to the origin**. Changing the origin discards it. This is the finding that
  drives §5.3.

---

## 3. Revised architecture

```
   GDevelop project  (App ID set in Game Properties → Steamworks)
        │
        │  "Electron Build" export  →  project source, not an exe
        ▼
   exported app/  ──────────────────────────────────────────────┐
        │                                                       │
        │  WGLEXE Packager — portable GUI (Tier 1)              │
        │    settings ✓ → assemble against bundled Electron     │
        ▼                                                       │
   ┌──────────────────────────────────────────────────┐         │
   │ main.js (patched)                                │         │
   │  • merged Chromium switch injection              │         │
   │  • --in-process-gpu       → Steam overlay        │         │
   │  • --enable-features=SharedArrayBuffer           │         │
   │       ⇒ SAB, origin unchanged, saves intact      │         │
   │  • window geometry / borderless from config      │         │
   │  • optional  native/wglexe.node  preload         │         │
   └───────────────────┬──────────────────────────────┘         │
                       │  loadFile('app/index.html')  (file://) │
                       ▼                                        │
   ┌──────────────────────────────────────────────────┐         │
   │ Chromium 128 renderer  (nodeIntegration: true)   │◄────────┘
   │                                                  │
   │   GDJS runtime — Pixi 7.4.2 / Three r160         │
   │     ├─ Steamworks / FileSystem / AdvancedWindow  │  ← keep working
   │     └─ WGLEXEOffloader extension  (Tier 0)       │
   │          • capability probe                      │
   │          • Web Worker pool (SAB when present)    │
   │          • BatchedMesh helper (3D draw batching) │
   │          • async shader compile                  │
   │          • native bridge, require('...node')     │
   └──────────────────────────────────────────────────┘
                       │
                       ▼
          assembled depot folder  →  SteamPipe
          (no Node, no npm, no electron-builder)
```

The host stays Electron, so everything GDevelop already ships — Steamworks, FileSystem, AdvancedWindow,
fullscreen — keeps working. That is the whole point.

---

## 4. Tier 0 — `WGLEXEOffloader` GDevelop extension

Pure JavaScript. No packager required. Runs in the browser export, the GDevelop preview, and the packaged
build, degrading feature-by-feature. **Ship this first** — it is independently useful and it is the test
harness for every later tier.

### Capability probe (the extension's foundation)

Every feature is gated on a runtime check, never on an assumption about the host:

| Expression / Condition | Probe |
| :--- | :--- |
| `IsSharedMemoryAvailable()` | `typeof SharedArrayBuffer !== 'undefined'` |
| `IsCrossOriginIsolated()` | `self.crossOriginIsolated === true` |
| `IsPackagedRuntime()` | `!!window.__WGLEXE__` |
| `IsNativeBridgeAvailable()` | `!!(window.__WGLEXE__ && window.__WGLEXE__.native)` |
| `IsMultiDrawSupported()` | `!!gl.getExtension('WEBGL_multi_draw')` |
| `HardwareThreadCount()` | `navigator.hardwareConcurrency` (fallback 4) |

Note the two are now genuinely independent: under the Steam configuration `IsSharedMemoryAvailable()` is
`true` while `IsCrossOriginIsolated()` is `false`. **Gate on the former.** Code that gates SAB usage on
`crossOriginIsolated` would silently disable itself in the shipping build.

### Features

1. **Worker pool.** `navigator.hardwareConcurrency - 1` workers, spawned from a **`Blob` URL** — required,
   because `new Worker('file.js')` is blocked on a `file://` origin. Transferable `ArrayBuffer` by default;
   `SharedArrayBuffer` + `Atomics` ring buffer when SAB is present.
2. **`DispatchWorkerTask(taskName, jsonArgs, resultVariable)`** — async; writes into a GDevelop variable and
   sets a "task done" condition. Registry of built-in tasks (grid pathfinding, distance/visibility batches,
   noise fields, sorting) plus a `RegisterTaskFromJS` hook.
3. **3D draw batching.** `BatchInstances(objectGroup)` builds a `THREE.BatchedMesh` from GDevelop 3D objects
   sharing a geometry/material, collapsing N draw calls to one. **This is the single largest real
   performance win available and it needs no packager at all.**
4. **Async shader compile.** Wrap Three/Pixi program linking in `KHR_parallel_shader_compile` polling so
   shader-heavy scenes stop hitching on load.
5. **Native bridge with fallback.** `CallNativeTask` → `window.__WGLEXE__.native` if present → worker pool
   if not → synchronous JS if neither. The event-sheet author writes one action and it works everywhere.
6. **`SetMaxFPS(n)`** — maps to the existing `runtimeGame.setMaximumFps(n)`, confirmed present in
   `runtimegame.js`. No native call needed.

### Hard boundary to document in the extension's description

Workers and native threads cannot touch the scene graph, objects, or variables. Only pure compute crosses
the boundary: numbers in, numbers out. Anything that mutates game state must come back to the main thread.
State this in the extension description so users don't file bugs about it.

---

## 5. Tier 1 — the packager (primary deliverable)

**A portable desktop application.** You unzip it, run it, point it at an exported GDevelop project, tick
what you want in Settings, and press Package. No install, no toolchain, no command line, nothing written
outside its own folder.

### 5.1 Why it assembles instead of builds

GDevelop's local "Electron Build" export emits an Electron **project source** — `main.js` with its
`GDJS_WINDOW_WIDTH`-style placeholders substituted, `package.json`, and `app/`. It does not emit an
executable; GDevelop's online build service runs `electron-builder` server-side to produce that.

So the packager has to turn source into a binary. The obvious route — shell out to `electron-builder` —
requires Node, npm, a network install of dev dependencies, and several minutes per build. That is not a
portable app.

An Electron application is, structurally, just `electron.exe` + its DLLs and `.pak` files +
`resources/app/`. So the packager **assembles** instead:

| Step | Action | Detail |
| :--- | :--- | :--- |
| 1 | **Validate** | Confirm a GDevelop Electron export: `main.js`, `package.json`, `app/index.html` present, and `main.js` carries the anchors §5.2 expects. Refuse clearly otherwise. |
| 2 | **Copy template** | Copy the bundled Electron runtime to the output folder. |
| 3 | **Place game** | Copy the export into `resources/app/`, optionally packed to `app.asar`. |
| 3b | **Supply dependencies** | GDevelop's local export contains **no `node_modules`** — its online build service runs `npm install`. But the exported `main.js` calls `require('@electron/remote/main').initialize()` unconditionally, so without this the build starts and dies. The packager vendors `@electron/remote` (and `steamworks.js` when Steam is on) and copies in whatever the export lacks. |
| 4 | **Patch `main.js`** | Anchored insertion of the switch block and window overrides — never regeneration, so GDevelop's own fixes survive. |
| 5 | **Write `wglexe.runtime.json`** | The runtime-readable subset of the settings, read by the injected code. |
| 6 | **Brand the exe** | Rename `electron.exe` → `Game.exe`; stamp icon and version resources in place. |
| 7 | **Steam files** | Drop `steam_api64.dll` beside the exe; strip any `steam_appid.txt` (§2.2). |
| 8 | **Verify** | Launch the result and assert in the renderer: `typeof SharedArrayBuffer === 'function'`; the final `disable-features` still contains `EnableWindowsGamingInputDataFetcher`; `--in-process-gpu` applied; the game actually loaded. Report failures in the UI — a packager that silently ships a broken build is worse than no packager. |

Seconds instead of minutes, and no dependency on anything installed on the machine.

**The verification handshake is a file, not stdout.** Electron on Windows is built as a
GUI-subsystem binary, so its stdout is not connected when another process spawns it and
anything written there is simply lost. The packager passes a report path in
`WGLEXE_VERIFY`; the injected code writes JSON there and exits. An `uncaughtException`
handler installed *before* the `@electron/remote` require reports startup failures the
same way — which is how step 3b's requirement was found rather than shipped.

### 5.1b Status: implemented and verified

**The tool is a real desktop application**, built by `build-portable.js` and verified
running from a copied folder with no Node, npm or toolchain present. It assembles itself
exactly the way it assembles games, and **uses its own Electron distribution as the ship
template** — one copy, not two (274 MB rather than 539 MB). The files belonging to Electron
are recorded in `electron-manifest.json` at build time rather than guessed at run time;
a wrong guess there would ship the packager's own settings and presets inside a game.
Verified: the produced game contains none of the tool's files, and running the tool writes
nothing outside its own folder — Chromium's profile is redirected into `data/`.

Two bugs worth recording, both found by running the thing rather than reading it:

* **Environment leakage.** `verify.js` passed `process.env` to the game it launches. When
  the packager itself runs under `ELECTRON_RUN_AS_NODE`, the game's own `electron.exe`
  inherited it, started as plain Node, and exited without a window. Every `ELECTRON_*` and
  `WGLEXE_*` variable is now stripped from the child environment.
* **Portable was not portable.** Electron writes its Chromium profile to
  `%APPDATA%<productName>` by default. `app.setPath('userData', …)` now redirects it
  inside the application folder.

M3 and M3b are built. Both `SharedArrayBuffer` modes have been assembled and run end to
end against GDevelop's real `main.js` and a real Electron distribution:

| Mode | Origin | `SharedArrayBuffer` | `crossOriginIsolated` | Steam Input fix | `--in-process-gpu` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `flag` (default) | `file://` | **yes** | no | intact | applied |
| `isolation` | `game://app/` | **yes** | **yes** | intact | n/a (Steam off) |

This settles §5.3 empirically rather than by argument: `--enable-features=SharedArrayBuffer`
does grant SAB on a `file://` origin, and the privileged-scheme route does produce
cross-origin isolation. Both work; the default stands on the reasoning in §5.3, not on
doubt about whether either functions.

**Icon and version stamping** is the only step needing real Win32 work: `BeginUpdateResource` /
`UpdateResource` / `EndUpdateResource`. C# reaches these natively (§5.7); the Electron build shells out to
a bundled `rcedit.exe`, which is what `electron-builder` does internally anyway.

### 5.1a "Can it package without Electron or Chromium?"

Two different questions, with two different answers.

**The packager's own GUI: yes.** Nothing about the tool requires a browser engine. That is exactly what the
C# stage in §5.7 delivers — a native Windows app of a few MB. Note the shipped *template* still contains
Chromium; it is the tool's interface that stops needing one.

**The packaged game: no, and this is not a limitation of the plan.** A GDevelop game is a WebGL application
driven by Pixi and Three. It needs a real browser engine with production WebGL 2 — and on Windows, every
such engine is Chromium: Electron, CEF, WebView2 and QtWebEngine are all the same renderer wearing
different hosts. The lightweight embeddables that are *not* Chromium (Ultralight, Sciter) are UI renderers
without the WebGL support Pixi and Three require, so they cannot run a GDevelop game at all.

The only way to avoid *shipping* Chromium is to use one already on the machine — WebView2 Evergreen, a
~5 MB host against the runtime preinstalled on Windows 11. §7 rules that out for this project, on
Steamworks, FileSystem, AdvancedWindow and the Gamepad API. And on Steam the motive is weak anyway: the
depot is downloaded through the Steam client, where a ~180 MB game is unremarkable.

So the honest framing is not "Chromium or not" but "**which Chromium, and who ships it**" — and for a Steam
title the answer is Electron 32, shipped by you, pinned and tested.

### 5.2 Switch injection — and the merge gotcha

`app.commandLine.appendSwitch(key, value)` called twice with the same key **replaces** the value; it does
not append to the list. GDevelop already sets `disable-features`. Naively appending a second
`disable-features` would silently delete the Steam Input fix and break controllers for every Steam Deck
player (§2.3). Switch values must be accumulated and written once:

```js
// --- wglexe:switches (injected) ---
const wglexe = require('./wglexe.runtime.json');
const featureList = { 'enable-features': [], 'disable-features': [] };

// Preserve GDevelop's own Steam Input workaround. Do not remove.
if (process.platform === 'win32') {
  featureList['disable-features'].push('EnableWindowsGamingInputDataFetcher');
}

const s = wglexe.steam || {};
if (s.overlayCompat !== false) {
  app.commandLine.appendSwitch('in-process-gpu');            // Steam overlay, §2.1
  if (s.disableDirectComposition) {
    app.commandLine.appendSwitch('disable-direct-composition');
  }
}

if ((wglexe.security || {}).sharedArrayBuffer === 'flag') {
  featureList['enable-features'].push('SharedArrayBuffer');  // §5.3
}

const g = wglexe.gpu || {};
if (g.angleBackend && g.angleBackend !== 'default') {
  app.commandLine.appendSwitch('use-angle', g.angleBackend);
}
if (g.ignoreGpuBlocklist) app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (g.disableVsync) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}
if (g.enableDraftExtensions) app.commandLine.appendSwitch('enable-webgl-draft-extensions');

for (const [key, values] of Object.entries(featureList)) {
  if (values.length) app.commandLine.appendSwitch(key, values.join(','));
}
// --- /wglexe:switches ---
```

### 5.3 SharedArrayBuffer: two modes, and why Steam picks the cheap one

**Mode A — `flag` (default for Steam).** One entry in `--enable-features`. The page keeps its `file://`
origin. `SharedArrayBuffer` becomes available; `self.crossOriginIsolated` stays `false`. Nothing else in
the game changes.

**Mode B — `isolation`.** Serve the game from a privileged `game://` scheme and inject
`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`, then
`loadURL('game://app/index.html')`. Standards-track and future-proof — and on Steam, actively harmful:

| Cost of Mode B | Detail | Applies here? |
| :--- | :--- | :--- |
| ~~Player saves are wiped~~ | Storage actions are `localStorage`-backed and `localStorage` is origin-scoped, so moving `file://` → `game://app` discards every existing save. | **No** — no shipped build, no installed base. Moot. |
| **Player authentication breaks** | `Extensions/PlayerAuthentication/playerauthenticationtools.js` opens a named popup and listens for `message`. `COOP: same-origin` severs the opener relationship with a cross-origin popup, so the reply never arrives. (`Multiplayer`'s `window.open` is only a `_blank` docs link and is unaffected.) | **Only if used.** GDevelop leaderboards depend on it. Steam identity/achievements do not. |
| **Cross-origin assets break** | `COEP: require-corp` blocks any CDN font, leaderboard script, ad SDK, or analytics beacon that doesn't send CORP. | **Only if used.** A self-contained Steam build usually loads nothing cross-origin. |
| **No clean fix at this Chromium version** | `Document-Isolation-Policy` grants isolation without COOP/COEP restrictions, but it shipped in **Chrome 137**; GDevelop pins Electron 32 / **Chromium 128**. | **Yes**, unless the Electron bump in §5.4 is taken. |

### Why Mode A is still the default

With no installed base, three of Mode B's four costs are gone or conditional. Mode B is now cheap. It is
still not *better*, because the thing it buys does not apply here:

Cross-origin isolation's value is durability on the open web — a page that isolates itself keeps
`SharedArrayBuffer` no matter what Chromium does to internal toggles. Mode A's one weakness is exactly
that: `--enable-features=SharedArrayBuffer` could be withdrawn in a future Chromium. **But you ship the
Chromium binary.** A build that works at ship time keeps working; an Electron bump is a deliberate,
testable act, not something that happens to your players overnight. Mode A's weakness is a web weakness
and this is not the web.

Meanwhile Mode B still costs a scheme handler, a path-traversal guard, header injection on every response,
and a permanent constraint that no future feature of the game may load a cross-origin resource or open an
auth popup. That is real surface area bought with no delivered benefit.

**Recommendation: ship Mode A. Run Mode B as a half-day spike** — it is implemented and selectable via
`security.sharedArrayBuffer: "isolation"`, and confirming it works keeps the door open for a browser/itch
build later, where isolation genuinely is the right answer.

### 5.4 The Electron bump — a separate, larger decision

With no installed base, nothing stops the packager from pinning a newer Electron than GDevelop's
`electron@32.3.3`. Electron ≥ 37 (Chromium ≥ 138) would bring Document-Isolation-Policy, making Mode B
free of every cost above, plus a newer WebGL/WebGPU stack and possibly better Proton behaviour.

**Do not take this bundled with the SAB decision.** Its costs are independent and non-trivial:

* GDevelop has not tested its runtime against that Chromium. You inherit any breakage.
* `steamworks.js` must be rebuilt for the new Node ABI — and it is the one dependency a Steam build cannot
  do without.
* `--in-process-gpu` is historically fragile and would need re-verifying on newer Chromium. If it has
  regressed, you lose the Steam overlay (§2.1) — a far worse trade than anything SAB mode affects.

Treat it as a post-M4 experiment with its own gate: bump only after the overlay, gamepad and Steamworks
tests in M4/M7 are passing on Electron 32, so you have a known-good baseline to bisect against.

### 5.5 Config schema v3

```json
{
  "appName": "GDevelopGame",
  "version": "1.0.0",
  "executableName": "Game.exe",
  "icon": "res/app.ico",
  "window": {
    "title": "GDevelop Game (WGLEXE)",
    "width": 1280, "height": 720,
    "minWidth": 640, "minHeight": 480,
    "resizable": true, "fullscreen": false, "borderless": false,
    "backgroundThrottling": false
  },
  "gpu": {
    "angleBackend": "default",
    "ignoreGpuBlocklist": false,
    "disableVsync": false,
    "enableDraftExtensions": false
  },
  "security": {
    "sharedArrayBuffer": "flag",
    "nativeBridge": false
  },
  "steam": {
    "enabled": true,
    "appId": null,
    "overlayCompat": true,
    "disableDirectComposition": false,
    "stripSteamAppIdTxt": true
  },
  "native": { "addon": null },
  "build": { "target": "dir", "runBuilder": true }
}
```

Changes and their reasons:

* `build.target` → **`dir`**. Steam depots take a folder, not an installer (§2.2).
* `steam` block added; `overlayCompat` defaults **on** (§2.1).
* `security.enableSharedArrayBuffer` / `crossOriginIsolation` / `unrestrictedSharedArrayBuffer` collapse
  into one three-valued `sharedArrayBuffer: "flag" | "isolation" | "off"`. The v2 booleans could express
  contradictory states.
* `window.framerateLimit` **removed** — it belongs to the game, via `SetMaxFPS` →
  `runtimeGame.setMaximumFps()`. A packager-level number could not be changed at runtime.
* `enableZeroCopy`, `enableGpuRasterization`, `enableParallelShaderCompile` **removed** — the first two are
  Chromium defaults affecting 2D compositing, not WebGL; the third is not a verifiable switch (§1).
* `angleBackend` defaults to `"default"`, not `"d3d11"`. ANGLE already selects D3D11 on Windows; forcing it
  removes Chromium's fallback logic and can turn a working machine into a black screen.
* `ignoreGpuBlocklist` defaults to `false`. The blocklist exists because those driver/GPU combinations
  crash; on by default it converts a software fallback into a refund.
* `disableVsync` defaults to `false` — it produces tearing, and its practical effect has been inconsistent
  across Chromium versions.

The pattern: every flag that trades stability for speed is opt-in and documented with its failure mode.

`build.target` survives as a field, but under the assembler model (§5.1) `dir` is the only mode that
matters; an installer would be a later, separate output option.

### 5.6 The application

**Portable means portable.** Everything lives in the tool's own folder; nothing is written to the registry,
`%APPDATA%`, or anywhere else. Copy the folder to a USB stick and it works, with its settings, on another
machine. With the runtime template bundled (chosen), it never needs a network connection.

```
WGLEXE_Packager/
├── WGLEXEPackager.exe
├── settings.json                  ← last project, window state, presets
├── presets/
│   ├── Steam (default).json
│   └── Browser build.json
├── runtime/
│   └── electron-32.3.3-win32-x64/ ← the ship template, bundled
├── tools/
│   └── rcedit.exe                 ← icon/version stamping (Electron stage only)
└── patches/
    └── gdevelop-5.x.main.json     ← anchors + insertion templates, as data
```

`patches/` matters more than it looks — see §5.7.

#### Screen 1 — Package

The whole job on one screen: pick the exported project folder, pick the output folder, see which preset is
active, press **Package**. A log pane below shows each assembler step from §5.1 and, at the end, the
verification results as pass/fail rows rather than buried text.

Drag-and-drop a folder onto the window to set the source. If the folder is not a GDevelop Electron export,
say which file was missing rather than "invalid project".

#### Screen 2 — Settings

Grouped checkboxes, mapping one-to-one onto §5.5. Two rules govern the whole screen:

1. **Every box that trades stability for speed states its failure mode inline**, in the UI, not in a manual.
   The plan's central discipline is worthless if the GUI hides it behind a friendly label.
2. **Defaults are the safe column.** A user who ticks nothing gets a correct Steam build.

```
┌─ Steam ─────────────────────────────────────────────────────────────┐
│ [x] Steam overlay support                                           │
│     Adds --in-process-gpu. Without it the overlay, screenshots and  │
│     the Steam on-screen keyboard do not appear.                     │
│ [ ] Also disable direct composition                                 │
│     Only if the overlay flickers. Try the box above first.          │
│     App ID  [ 480________ ]   (set in GDevelop Game Properties too) │
│ [x] Strip steam_appid.txt from output    Must not reach the depot.  │
├─ Performance ───────────────────────────────────────────────────────┤
│ [x] SharedArrayBuffer                          ( • flag  ○ isolation)│
│     "flag" keeps the file:// origin — recommended.                  │
│     "isolation" disables GDevelop player authentication.            │
│ [ ] Uncap frame rate                                                │
│     Disables v-sync. Causes screen tearing.                         │
│ [ ] Ignore GPU blocklist                                            │
│     Prevents software fallback — and can crash blocklisted drivers  │
│     instead of falling back. Off unless you are debugging.          │
│ [ ] WebGL draft extensions      Not needed for 3D batching.         │
│     Graphics backend  [ Automatic ▾ ]                               │
│     Automatic is correct on Windows. Forcing D3D11 removes          │
│     Chromium's own fallback and can produce a black screen.         │
├─ Window ────────────────────────────────────────────────────────────┤
│     Title [ ____________ ]  Size [ 1280 ] x [ 720 ]                 │
│ [x] Resizable   [ ] Start fullscreen   [ ] Borderless               │
│ [x] Keep running when unfocused                                     │
├─ Native (advanced) ─────────────────────────────────────────────────┤
│ [ ] Native compute addon        Requires a matching .node build.    │
└─────────────────────────────────────────────────────────────────────┘
```

Interlocks the UI enforces, so a bad combination is unreachable rather than merely documented:

* Selecting **isolation** raises an inline warning naming GDevelop player authentication and cross-origin
  assets, and offers to scan the project for both before allowing it.
* Unticking **Steam overlay support** while the Steam group is enabled warns that the overlay will not
  appear.
* Nothing can remove GDevelop's `EnableWindowsGamingInputDataFetcher` fix — it is not exposed as a toggle
  at all, because there is no legitimate reason to turn it off (§2.3).

**Presets** are named settings files in `presets/`. Ship "Steam (default)" and "Browser build"; let the
user save their own. This is how the tool stays useful when the answer to §11's open questions changes.

### 5.7 Staged stack: Electron now, C# later

Yes — start on Electron and migrate to C#, and the migration is cheap **if it is designed for from day
one**. The enabling decision is a single one:

> **The packaging logic must be data, not code.** Patch anchors and insertion templates live in
> `patches/*.json`. The settings schema lives in a JSON schema file. Neither is hardcoded in the GUI
> language.

With that in place the two stages share their entire substance and differ only in shell:

| | **Stage 1 — Electron** | **Stage 2 — C#** |
| :--- | :--- | :--- |
| Ships when | First — it is the shortest path to a working tool | After the pipeline is proven and stable |
| GUI | HTML/CSS/JS — the same language as the `main.js` patches and your GDevelop extension work | WinForms or WPF |
| Size | ~180 MB portable | ~90 MB self-contained, ~200 KB if .NET is present |
| Icon/version stamping | Bundled `rcedit.exe` | Native `UpdateResource` — the `tools/` folder disappears |
| Runtime template | **The tool's own Electron binaries can double as the ship template** | Bundled separately |
| Carried over unchanged | — | `patches/*.json`, the settings schema, presets, all verification rules |

What actually gets rewritten in Stage 2 is file copying, JSON reading, string insertion at named anchors,
and process launching — a few hundred lines in any language. What does *not* get rewritten is everything
that took thought: the anchors, the interlocks, the defaults, the failure-mode text, the verification
assertions.

Do Stage 2 when Stage 1's pipeline has stopped changing. Migrating a moving target means maintaining two
implementations of the same unfinished thing.

---

## 6. Tier 2 — optional native addon

Only after Tier 0 profiling shows a JS worker is genuinely the bottleneck. Because `nodeIntegration` is on,
this is a plain N-API module, not a new architecture:

* Build `wglexe.node` (N-API / `node-addon-api`, `/arch:AVX2`), one export:
  `run(taskName, Float64Array) → Float64Array`.
* Ship it at `resources/native/wglexe.node`; the packager marks it `asarUnpack`.
* A small preload sets `window.__WGLEXE__.native = require(...)` inside a `try/catch`; failure leaves the
  bridge undefined and Tier 0's fallback chain takes over silently.
* Rebuild per Electron ABI via `electron-rebuild` — pin `electron@32.3.3` and document it. **This is the
  real cost of Tier 2**, and it is compounded on Steam: the same ABI pin already governs `steamworks.js`,
  so an Electron bump now rebuilds two native addons and re-tests the overlay switch.

Expect the useful gain to be narrow: for workloads under roughly 10 000 elements, `postMessage` and
marshalling cost more than the SIMD saves. Measure before building.

---

## 7. Tier 3 — bespoke C++ host: ruled out

v2 deferred this behind a gate. **The Steam target closes it.**

GDevelop's Steamworks support is `Extensions/Steamworks/steamworkstools.js` → `require("steamworks.js")`, a
**native Node addon**. No WebView2 or CEF host can load it. Shipping to Steam without GDevelop's Steamworks
extension would mean reimplementing achievements, stats, rich presence, DRM and cloud against the C++
Steamworks SDK *and* re-exposing all of it to the event sheet — while simultaneously reimplementing
FileSystem, AdvancedWindow and fullscreen, and inheriting WebView2's documented Gamepad API defects on a
platform where Steam Input is mandatory.

For the record, had it gone ahead, CEF — not WebView2 — was the correct host:

| | WebView2 (Evergreen) | WebView2 (Fixed) | CEF | Electron (Tiers 0–2) |
| :--- | :--- | :--- | :--- | :--- |
| Chromium version control | none | full | full | full (pinned 128) |
| Distribution size | ~2 MB host | **>250 MB** | ~150 MB | ~180 MB |
| Runtime must exist on user machine | yes | bundled | bundled | bundled |
| Command-line switches | *"production apps shouldn't use"*, some ignored | same caveat | full, supported | full, supported |
| Gamepad API | documented defects (worked only with DevTools open) | same | reliable | reliable |
| GDevelop Steamworks / FileSystem / AdvancedWindow | **all break** | **all break** | **all break** | work today |

Tier 3 is now a decision record. Reopen it only if the Steam target is abandoned.

---

## 8. Flag reference

**Shipped by default in a Steam build**

| Switch | Effect |
| :--- | :--- |
| `--disable-features=EnableWindowsGamingInputDataFetcher` | GDevelop's existing Steam Input gamepad fix. **Preserve it.** |
| `--in-process-gpu` | Makes the Steam overlay work (§2.1). Fragile — re-test on every Electron bump. |
| `--enable-features=SharedArrayBuffer` | Grants SAB without cross-origin isolation (§5.3). |

**Opt-in**

| Switch | Effect | Default |
| :--- | :--- | :--- |
| `--disable-direct-composition` | Overlay companion fix for some titles. | off |
| `--use-angle=<backend>` | `default`, `d3d11`, `d3d11on12`, `gl`, `gles`, `vulkan`, `swiftshader`, `vulkan-swiftshader`. | `default` |
| `--ignore-gpu-blocklist` | Skips the driver blocklist; prevents software fallback. Can crash bad drivers. | off |
| `--disable-gpu-vsync` | Presents without vsync; tearing. | off |
| `--disable-frame-rate-limit` | Uncaps the compositor. Needed alongside the above for real effect. | off |
| `--enable-webgl-draft-extensions` | Draft WebGL extensions only. Not needed for `WEBGL_multi_draw`. | off |

**Rejected**

| Switch | Reason |
| :--- | :--- |
| `--enable-zero-copy` | Chromium default; affects compositing, not WebGL. |
| `--enable-gpu-rasterization` | Chromium default; affects 2D raster, not WebGL. |
| `--enable-parallel-shader-compile` | Not verifiable as a real switch. Use the `KHR_parallel_shader_compile` WebGL extension instead. |
| `--enable-features=Vulkan` | Chromium's Vulkan raster path is unrelated to WebGL performance; use `--use-angle=vulkan` if the Vulkan backend is genuinely wanted. |

---

## 9. Risks

| Risk | Severity | Mitigation |
| :--- | :--- | :--- |
| `appendSwitch` overwrite silently kills Steam Input gamepads | **High** | Merge logic in §5.2 + a build-time assertion on the final `disable-features` value. |
| `--in-process-gpu` breaks or regresses on an Electron bump, killing the overlay | **High** | Pin Electron; make overlay presence an explicit M4 test, re-run on every bump; `overlayCompat` toggle for bisecting. |
| Choosing Mode B isolation and silently disabling GDevelop player authentication | Medium | Default is Mode A. If `"isolation"` is selected, the packager scans the export for `PlayerAuthentication`/`Leaderboards` usage and warns. (The save-wipe hazard is moot — no installed base.) |
| Bumping Electron and losing the Steam overlay | **High** | §5.4: bump only after M4/M7 pass on Electron 32, so there is a known-good baseline to bisect against. |
| Patching `main.js` breaks on a GDevelop update | **High** | Anchored insertion, never regeneration; refuse to patch an unrecognized `main.js`. Pin a tested GDevelop version range. |
| `steam_appid.txt` shipped into the depot | Medium | `stripSteamAppIdTxt` on by default; build fails if one is present. |
| Steam Deck / Proton sandbox conflicts, Game Mode differences | Medium | Deck testing from M1; prefer a native Linux depot over Proton. |
| Native addon ABI drift (two addons now: `steamworks.js` + `wglexe.node`) | Medium | Pin `electron@32.3.3`; treat `wglexe.node` as optional with a silent fallback. |
| Users expect worker offload to speed up general gameplay | Medium | Document the pure-compute boundary (§4) in the extension description, not just here. |
| `--ignore-gpu-blocklist` crashes on blocklisted drivers | Medium | Off by default; documented failure mode. |
| Code signing / SmartScreen | Low on Steam | The Steam client launches the exe, so SmartScreen pressure is much lower than for direct download. Sign anyway if also selling direct. |

---

## 10. Milestones

| # | Deliverable | Exit criterion |
| :--- | :--- | :--- |
| **M1** | `WGLEXEOffloader`: capability probes + Blob-URL worker pool + `SetMaxFPS` | Runs unmodified in browser, preview, and Electron export; every probe correct in each; **runs on Steam Deck**. |
| **M2** | `BatchedMesh` batching action | A scene of 2 000 identical 3D objects shows a measured draw-call and frame-time drop. |
| **M3** ✅ | Assembler core, headless: validate → copy template → patch → brand → verify | Produces a running depot folder from a stock GDevelop export in seconds, with no Node/npm on the machine; no `steam_appid.txt` in output. Patch anchors live in `patches/*.json` (§5.7). |
| **M3b** ✅ | Portable GUI, Stage 1 (Electron): Package screen + Settings screen + presets | Runs from a copied folder with no install; writes nothing outside its own directory; every stability-trading toggle shows its failure mode inline; interlocks in §5.6 enforced. |
| **M4** | **Steam integration gate** | Overlay opens over the running game; achievements fire; gamepad works when launched from Steam; Big Picture and Deck Game Mode both verified. |
| **M5** ✅ | SharedArrayBuffer, Mode A | `typeof SharedArrayBuffer === 'function'` in the packaged build, with the `file://` origin unchanged and Steamworks still initialising. |
| **M6** | SAB worker path + async shader compile | Worker pool uses `SharedArrayBuffer` when present and transferables when not; both paths return identical results. |
| **M7** | Compatibility regression suite | Steamworks, FileSystem, AdvancedWindow, fullscreen, PlayerAuthentication, and gamepad all verified in the packaged build. |
| **M8** | Native addon (optional) | Only if M6 profiling justifies it. |
| **M9** | Portable GUI, Stage 2 (C#) — optional | Same `patches/*.json`, schema, presets and verification rules; native icon/version stamping; `tools/rcedit.exe` gone. Start only once M3's pipeline has stopped changing (§5.7). |

M1–M2 need no packager. **M4 is the milestone that decides whether the project ships**; if the overlay
cannot be made to work, that is worth knowing before any of Tier 2 is written. M7 is what makes it
releasable.

---

## 11. Open questions

1. **2D or 3D?** The BatchedMesh win is 3D-only. If the title is 2D, Tier 0's value drops sharply and the
   worker pool becomes the main deliverable.
2. ~~**Is there an already-shipped build with players?**~~ **Answered: no.** Mode A stays the default on
   its own merits (§5.3); the save-compatibility clause is dropped from M5; the Electron bump becomes a
   post-M4 option (§5.4).
3. **Does the game use GDevelop leaderboards / player authentication?** This is the last remaining cost of
   Mode B. If the title relies on Steam identity and Steam achievements only, Mode B becomes essentially
   free and the spike in §5.3 is worth running early.
4. **Steam Deck: Proton or a native Linux depot?** This changes the M1 test matrix and possibly the whole
   build pipeline.
5. **GDevelop version support range** — patching `main.js` couples this project to GDevelop's exporter.
   Pin a tested range and fail loudly outside it.
6. ~~**Python or Node for the CLI?**~~ **Answered: neither, and not a CLI.** The packager is a portable
   GUI application (§5.6) built on Electron first and optionally migrated to C# (§5.7). A headless mode
   remains worth exposing later for CI, driven by the same `patches/*.json` and settings schema.
7. **Does the tool ship one Electron template or several?** One (32.3.3) keeps the download at ~180 MB and
   matches the §5.3 default. Supporting the §5.4 bump later means either a second bundled template or an
   optional download — revisit after M4.

---

## Sources

* [Steamworks API Overview](https://partner.steamgames.com/doc/sdk/api) — `steam_api64.dll`, `steam_appid.txt` (dev only)
* [Steamworks in GDevelop](https://wiki.gdevelop.io/gdevelop5/all-features/steamworks/) — App ID in Game Properties, PC builds only
* [Enabling the Steam Overlay in an Electron app](https://jake.software/enabling-the-steam-overlay-in-an-electron-app) and [Greenworks troubleshooting](https://github.com/greenheartgames/greenworks/wiki/Troubleshooting) — `--in-process-gpu`, `--disable-direct-composition`, repaint requirement
* [Overlay woes on Linux build (steamworks.js #195)](https://github.com/ceifa/steamworks.js/issues/195)
* [Document Isolation Policy](https://developer.chrome.com/blog/document-isolation-policy) — shipped Chrome 137, desktop only
* [SharedArrayBuffer updates in Chrome 92](https://developer.chrome.com/blog/enabling-shared-array-buffer) — `--enable-features=SharedArrayBuffer` escape hatch
* [Make your website "cross-origin isolated" using COOP and COEP](https://web.dev/articles/coop-coep) and [A guide to enable cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide)
* [Electron `protocol` API](https://www.electronjs.org/docs/latest/api/protocol) — `registerSchemesAsPrivileged`, `protocol.handle` (Mode B)
* [WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags) and [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
* [Gamepad API only works when developer tools is opened (WebView2Feedback #3025)](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3025)
* [KHR_parallel_shader_compile (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/KHR_parallel_shader_compile)
* [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md) — `--use-angle` backend values
* Local GDevelop 5 install: `resources/GDJS/Runtime/Electron/{main.js,package.json}`, `Runtime/runtimegame.js`,
  `Runtime/events-tools/storagetools.js`, `Runtime/pixi-renderers/{three.js,pixi.js,runtimegame-pixi-renderer.js}`,
  `Runtime/Extensions/{AdvancedWindow,FileSystem,Steamworks,PlayerAuthentication,Multiplayer}`
