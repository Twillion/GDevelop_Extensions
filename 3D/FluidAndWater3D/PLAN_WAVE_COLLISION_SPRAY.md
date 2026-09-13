# Plan — wave-collision spray (WaterDetailing3D)

**Status: planned, not implemented.** Nothing in this document is in 3.3.0.

When two crests run into each other the water has nowhere to go but up, and Sea of Thieves gets a
lot of its character from those vertical spurts. This is the plan for adding them to
`WaterDetailing3D`, as a module of the detailing behaviour rather than a separate one.

## 1. The hard part is telling a collision from an ordinary breaking crest

Foam already comes from the Jacobian fold, and the fold cannot answer this question. Take the
displacement gradient tensor `M = I + grad(D)`. It has two eigenvalues:

* A wave **spilling down its face** compresses in ONE direction. One eigenvalue drops, the other
  stays near 1.
* Two crests **colliding** compress in BOTH. Both eigenvalues drop.

The Jacobian is the *product* of the two, so both cases give the same large fold. The **larger
eigenvalue** separates them. Measured on the real field (resolution 64, tile 5000):

| rung | `fold > 0.3` (ordinary foam) | `lamMax < 0.85` (converging) | `lamMax < 0.7` (hard collision) |
| :--- | ---: | ---: | ---: |
| Beaufort 4 | 0.00% | 0.00% | 0.00% |
| Beaufort 6 | 5.32% | **0.24%** | 0.00% |
| Beaufort 9 | 26.03% | **5.44%** | 0.63% |
| Beaufort 12 | 39.26% | 10.52% | 4.05% |

That is a trigger roughly 40x more selective than the fold, it stays silent on a Beaufort 4 sea, it
grows with the sea state, and the sites it picks sit at 0.35–0.43 x Hs — high on the wave, which is
where a plume belongs. This is the part of the plan that is already validated.

```
T       = a + d                       // a, d are the diagonal of M
disc    = sqrt(max(T*T - 4*J, 0))
lamMax  = (T + disc) * 0.5
plume   = clamp((0.85 - lamMax) / 0.35, 0, 1) * step(0.15 * Hs, elevation)
```

## 2. Where the data goes

3.3.0 added a slope texture per cascade carrying `(dh/dx, dh/dy, -, -)`. **Its blue and alpha
channels are free**, so the plume mask costs no new texture and no new upload — it is written in the
same loop that already fills the slopes, in `updateOceanField`.

Only cascade 0 should drive it. Cascade 1 is ~4x steeper on a quarter-size tile and its eigenvalues
collapse everywhere; that is the same mistake that turned the foam into mountains in 3.2.0.

## 3. Rendering it — four options

| option | what it gives | cost | verdict |
| :--- | :--- | :--- | :--- |
| Vertex displacement | a bump on the surface | ~free | **No.** The mesh is 64x64 over the whole ocean; a spurt is far below one quad. It would read as a lump, not a spray. |
| Shader-only brightening | a white smear at the site | ~free | **No.** Cannot throw anything *above* the surface, which is the whole point. |
| Billboard sprite pool | camera-facing quads with a spray texture | one draw call, instanced | **Fallback.** Good enough, but needs an authored texture the extension does not ship. |
| **Droplet particles** | actual water thrown up and falling back | reuses existing system | **Recommended.** |

The extension already carries a droplet system with SPH, a pooled `particleMesh`, and lifecycle
teardown (`getTotalActiveDropletCount`, `disposePourableLiquid`). Spray is exactly what it is for.
Collision sites become spawn points with an upward initial velocity; gravity and the existing
integrator do the rest, and droplets already despawn on their own.

## 4. Proposed phases

**Phase 1 — detection.** Compute `lamMax` in `computeFoam` (the tensor is already assembled there;
this is a handful of extra float ops, no new pass) and pack the plume mask into `slopeData[i*4+2]`.
No visual change. Verifiable entirely offline: the rates in the table above become a test.

**Phase 2 — spawning.** A `stepWaterDetailing` pass walks the plume mask, picks sites above a
threshold, and spawns droplets at the displaced world position with velocity
`(0, 0, +k * sqrt(plume) * Hs)` plus a small lateral scatter. Rate-limited by a per-second budget so
a hurricane cannot spawn thousands. Sites are chosen with a rotating stride rather than a full scan,
so cost is fixed regardless of sea state.

**Phase 3 — look.** Droplet size, lifetime and colour take from the resolved style and sub-style, so
Sea of Thieves throws bigger, whiter, longer-lived spray than Realistic, and Pool Water throws
almost none (`foamCoverageScale` 0.05 already encodes that intent).

**Phase 4 — the base of the plume.** A collision should also brighten the water where it happens.
The plume mask is already in the texture by Phase 1, so this is one extra channel read in the
fragment shader feeding the existing foam term — cheap, and it stops the droplets looking detached
from the surface.

## 5. Properties to expose

Under the existing `PRESETS — START HERE` / effect-module grouping, named so they sort sensibly:

* `SprayEnabled` (bool, default **off** — same posture as the persistent foam buffer)
* `SprayAmount` (0–1, scales the per-second spawn budget)
* `SprayHeight` (0–2, multiplier on launch velocity)
* `SprayThreshold` (0–1, maps onto the `lamMax` cut so a stylised sea can spurt more readily)

## 6. Risks

* **Performance is the real one.** Droplets are CPU-integrated. The budget must be a hard cap, not a
  rate that scales with sea state, or Beaufort 12 (10.52% of the field converging) will spawn without
  bound. Default off until measured on hardware.
* **Double-counting foam.** Phase 4 adds to the same foam term the fold drives. If both fire at a
  collision the site will blow out to white. The plume contribution has to be a `max`, not a sum.
* **Cascade contamination.** Cascade 1 must be excluded from the eigenvalue test, for the reason in
  section 2.
* **Spawn position vs. displacement.** The field is indexed in undisplaced parameter space; the
  spawn point must have `dispX/dispY * choppiness` added or the spray will appear offset from the
  crest that threw it — visibly wrong at high choppiness.

## 7. What this plan does not settle

Whether the spray should collide with anything (ships, land), and whether it should feed the
persistent foam buffer so a plume leaves a patch behind. Both are worth doing and neither is costed
here.

## 8. How it gets verified

Phases 1 and 3 are fully checkable offline: spawn rates per Beaufort rung, monotonic growth with sea
state, silence at Beaufort 4, correct style scaling, and no droplets leaked on teardown. Phases 2
and 4 are visual and need GDevelop — as always, Node never compiles the GLSL and never draws a
frame.
