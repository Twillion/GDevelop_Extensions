# AdvancedWeather3D Polish Plan

Goal: provide a coherent, runtime-controllable 3D weather toolkit that goes beyond GDevelop's native particle effects while remaining practical for real projects.

## Phase 1 — Runtime correctness and lifecycle

Status: completed in 1.3.0.

- Resolve authored bounds before particle seeding.
- Initialize particle and ripple instance transforms before the first rendered frame.
- Keep existing follow-camera particles and ripples world-anchored while recycling trailing particles into the newly exposed leading edge.
- Combine local and global wind as independent vectors.
- Rebuild particle pools, geometry, splash renderers, and debug bounds when runtime actions require it.
- Support zero-particle fog-only volumes.
- Synchronize shelter actions and conditions with runtime state.
- Use swept roof collision for fast precipitation.
- Preserve original host visibility across stacked behaviors and teardown.
- Dispose live resources during extension hot reload.
- Share lightning illumination between weather behaviors stacked on one object.

## Phase 2 — Effect quality and behavior parity

Status: started in 1.3.0.

- Taper velocity-aligned precipitation streaks.
- Add hail rebound arcs on floors and shelter roofs.
- Add switchable single-ring, double-ring, and splash-crown impact meshes.
- Add ember size flicker and richer flake/mote rotation.
- Add Low, Medium, High, and Ultra volumetric sampling tiers with stable ray jitter.
- Add a dedicated `DustVolume3D` behavior with optional volumetric haze.
- Give fog, hail, and embers the relevant runtime controls previously available only on the universal behavior.

Remaining:

- Soft particle edges and per-instance opacity.
- Per-splash fading and more varied impact shapes.
- Optional precipitation accumulation and wetness outputs for gameplay/material integration.
- Optional thunder audio timing hooks and strike-position output.

## Phase 3 — Fog/renderer integration

Status: planned.

- Integrate opaque-scene depth so fog stops at visible surfaces and composites over final radiance correctly.
- Add an optional half-resolution fog target and depth-aware upsampling.
- Evaluate temporal accumulation only if it improves motion stability without visible ghosting.
- Coordinate with the shared material/post-processing chain to avoid shader-hook conflicts.

## Phase 4 — Shipping quality

Status: in progress.

- Keep generated metadata, README, and API reference aligned.
- Add real Three.js r160 WebGL validation alongside mock regression tests.
- Add representative GDevelop demo scenes and mobile/desktop presets.
- Profile particle count, shelter count, and fog quality combinations before publishing recommended budgets.

## Validation commands

```powershell
node AdvancedWeather3D/build-extension.mjs
node AdvancedWeather3D/test-runtime.mjs
node AdvancedWeather3D/test-webgl.mjs
```
