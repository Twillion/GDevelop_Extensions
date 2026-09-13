# AdvancedLighting3D — Local-light shadow maps

Companion to [SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md](SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md),
which owns the CSM/SDF selector. This document covers the third shadow source: **real shadow maps
for clustered spot and point lights.**

**Verdict up front: spot lights should render a depth map, not march the SDF.** The SDF path stays —
it is genuinely good at cheap soft shadows from many lights over static world geometry — but it
cannot serve a spot light aimed at a moving character, and requiring an authored bounds cube to get
any local shadow at all is the wrong default for game work.

---

## 1. Why this exists

Established while debugging a real project (`The Hundred Acre`), not from theory:

| Limitation | Consequence in that project |
| :--- | :--- |
| **SDF is static and baked** | The `Player` object can never cast a shadow. Neither can anything else that moves. |
| **Requires an authored bounds cube** | A `volumebake` Cube3D had to be placed and sized by hand before a single shadow existed. |
| **Bounds are a hard boundary** | The volume covered **0.9%** of that scene's ground (434×559 against 4909×5313). Shadows stop at the seam. |
| **Resolution splits across the volume** | Covering more ground costs cubic memory: 128³ is 2M voxels, 256³ is 16.7M. |
| **Bake cost** | An incremental CPU bake at 8 ms/frame. Any bounds change restarts it. |
| **CSM cannot substitute** | Cascades split the view frustum along a *directional* axis. The technique structurally does not apply to point or spot lights — this is why the mode table lists local shadows as "disabled" under CSM. |

A spot light is the case where a shadow map is strictly better: one depth render from the light's
own point of view, no volume, no bake, and **dynamic casters work**.

### What this does not replace

SDF stays the right tool for: many lights sharing one static field, soft area shadows, and the
directional Sun in `SDF` mode. Shadow maps cost one depth render *per shadowed light per frame*;
the SDF costs one march regardless of light count. Keep both, and let the mode decide.

---

## 2. Scope

**Phase A — spot lights.** One 2D depth map per shadowed spot. This is the whole value: spots are
directional, a single map covers the cone, and Three.js already implements the hard parts.

**Phase B — point lights. DONE.** Implemented alongside Phase A rather than deferred. Three's
`PointLightShadow` renders six cube faces into a single 4x2 atlas, and its `shadow.matrix` is a pure
translation by `-lightPosition` — exactly the light-to-fragment vector a cube lookup needs — so both
types share one matrix uniform. The sampler branches on a per-slot `kind` uniform and does the
cube-face selection with a port of Three's `cubeToUV`.

**Open cost issue:** a point light counts as ONE against both budgets while costing SIX depth
renders. `MaxShadowMapUpdatesPerFrame = 2` therefore permits up to twelve face renders in a frame if
both dirty lights are points. The budgets should be weighted by face count before this is called
finished.

**Not in scope:** area/capsule lights (no standard shadow-map formulation), and any change to CSM or
the SDF Sun path.

---

## 3. Public API

One new value on the existing shadow-mode enum, and one per-light property.

### Scene mode

```
SetShadowMode("Maps")     — Sun: CSM.  Local lights: shadow maps.  SDF unused.
SetShadowMode("Hybrid")   — unchanged: Sun CSM, local SDF.
SetShadowMode("MapsSDF")  — Sun: CSM.  Local: maps where budget allows, SDF beyond it.
```

`MapsSDF` is the interesting one and should be the recommended default once Phase A lands: near
lights get crisp dynamic shadows, distant ones fall back to the static field, and the transition is
a budget decision rather than an authoring decision.

### Per-light

`CastShadows` stays the single on/off switch. **`ShadowTechnique` is a dropdown choosing how that
light shadows**, so the decision is per light rather than scene-wide — a key light can have a crisp
map while ambient fill lights share the cheap static field.

| `ShadowTechnique` | Behaviour |
| :--- | :--- |
| **`Auto`** (default) | The budget decides. Competes for a shadow map by §6's ranking; falls back to the SDF if it does not win a slot. This is what most lights should stay on. |
| **`ShadowMap`** | Always take a map. Reserved ahead of every `Auto` light. If more `ShadowMap` lights exist than slots, the excess falls back to SDF and a warning names them — a forced request that cannot be honoured must not fail silently. |
| **`SDF`** | Never take a map; always march the distance field. Use for lights over purely static geometry, where a map would render once and then cost memory for nothing. |
| **`None`** | Lit but never shadowed, without touching `CastShadows`. Useful for fill lights where a shadow would only add noise. |

Other per-light properties:

| Property | Default | Notes |
| :--- | :--- | :--- |
| `ShadowMapSize` | 1024 | 512 / 1024 / 2048. Per light, so a key light can afford more. |
| `ShadowMapBias` | 0.0005 | Depth bias, distinct from the SDF's voxel-space `ShadowBias`. |
| `ShadowNormalBias` | 0.02 | |
| `ShadowMapNear` | 1.0 | Light-space near plane; far derives from `Radius`. |
| `ShadowMapStatic` | false | Declares nothing in this light's frustum will ever move: render once, never re-render. See §7.5. |

**Scene mode still gates what is reachable.** `ShadowTechnique` selects within the mode, it does not
override it — in `Hybrid` (no maps) every light uses the SDF regardless, and in `Maps` an `SDF` light
goes unshadowed. `MapsSDF` is the mode where the dropdown means everything, which is why it should
become the recommended default.

### Scene controls

```
SetMaxShadowMappedLights(n)       — memory budget: maps allocated. default 4, hard cap 8 (§5)
SetMaxShadowMapUpdatesPerFrame(n) — time budget: maps re-rendered per frame. default 2 (§7.5)
MaxShadowMappedLights()           — expression
ShadowMappedLightCount()          — expression, how many hold a map right now
ShadowMapUpdatesThisFrame()       — expression, how many actually re-rendered
```

Two separate budgets, because caching splits them: allocating a map costs memory once, re-rendering
it costs time every frame it happens.

---

## 4. Why Three.js does most of this

`THREE.SpotLight` already implements `shadow.camera`, `shadow.matrix`, bias, radius and the depth
render. The work here is **not** writing shadow mapping; it is:

1. Keeping a `THREE.SpotLight` in sync with each shadow-mapped clustered light — **at zero
   intensity**, exactly as CSM already does for its cascade lights. The clustered loop remains the
   only radiance source; the native light exists solely to own a shadow map.
2. Feeding the resulting map and matrix into the clustered fragment loop.
3. Deciding which lights get one.

Point 1 is a proven pattern in this codebase. `shadowState()` already holds `lights`, `maps`,
`matrices` and `managers` for CSM, and `syncCSMUniforms()` already pushes them into the shader. This
follows the same shape.

---

## 5. Storage — the real constraint

CSM binds one sampler per cascade (`uAlCSMMap0..3`). Doing the same for local lights would spend a
texture unit per shadowed light, on top of the clustered data textures, the SDF volume, the probe
volumes and the material's own maps. WebGL2 guarantees only 16 fragment texture units.

**Use a `sampler2DArray`.** Three r160 ships `WebGLArrayRenderTarget`, so all local shadow maps live
in one array texture, one layer per light, bound to a single unit.

```glsl
uniform sampler2DArray uAlLocalShadowMaps;   // one layer per shadow-mapped light
uniform mat4  uAlLocalShadowMatrix[8];
uniform vec4  uAlLocalShadowParams[8];       // x: bias, y: normalBias, z: far, w: layer index
```

The per-light layer index rides in the light data texture. `shape` (texel 3) is full —
`(iesId, cosInner, shadowData, srcRadius)` — so the layer index goes in a **new fifth texel**,
widening the light record from 16 to 20 floats. That is a change to `LIGHT_TEXELS` and the packing
stride, and every consumer of the light data texture must move with it.

**Cap at 8 lights.** Beyond that the array texture and the uniform arrays both grow past what is
reasonable on the integrated-GPU floor, and `MapsSDF` already provides the fallback.

**Fallback path:** if `WebGLArrayRenderTarget` is unavailable or the array render fails, fall back to
4 individual `WebGLRenderTarget` samplers and cap at 4. Assert the actual capability at init rather
than assuming it — the same lesson as the MSAA spike in the modernization plan.

---

## 6. Selection policy

Which lights get a map, when more are shadow-enabled than the budget allows:

1. Lights outside the camera frustum get nothing.
2. Sort the remainder by **screen-space footprint** — projected radius over distance — not raw
   distance. A large light just off-centre matters more than a small one dead ahead.
3. Assign layers to the top N.
4. In `MapsSDF`, everything below the cut keeps its SDF march. In `Maps`, it goes unshadowed.

**Hysteresis is required.** Reassigning layers every frame makes shadows pop on and off as the
camera drifts. Hold an assignment for a minimum number of frames, and require a margin before
evicting. The existing cluster broadphase already computes `viewDistance` and `isInFrustum` per
light, so the inputs are there.

---

## 7. Shader integration

The local shadow test sits in the clustered loop beside the existing SDF branch, at the same point
`sdfShadowFactor` is applied:

```glsl
#ifdef AL_LOCAL_SHADOW_MAPS
  float mapShadow = 1.0;
  int layer = int(extra2.x);            // new fifth texel
  if (layer >= 0 && (shadowBits & 1u) == 1u && clDiffuseNdotL > 0.0) {
    vec4 lightSpace = uAlLocalShadowMatrix[layer] * vec4(worldPos + worldNormal * normalBias, 1.0);
    mapShadow = sampleLocalShadowPCF(uAlLocalShadowMaps, layer, lightSpace, bias);
  }
  radiance *= mapShadow;
#endif
```

Constraints this must respect, each of which has already cost a debugging session in this repo:

- **ShaderChain owns `onBeforeCompile`.** This lands inside the existing band-100 `advlight3d`
  injector — no second hook.
- **The program cache key must vary** with whether local maps are active and with the light count,
  or Three reuses a program compiled for a different configuration.
- **The scene root is Y-mirrored** (`scale.y = -1`) and **up is +Z**. Shadow camera fitting gets
  this wrong by default; CSM's existing fitting code is the reference.
- **GDevelop r160 uses legacy light units** — the native `SpotLight` must stay at zero intensity so
  it contributes no radiance, only a map.
- **`updateMatrixWorld` before reading transforms.** A shadow camera fitted from stale matrices
  points at where the light used to be. This is the same defect that made SDF bakes silently empty
  away from the world origin.

---

## 7.5 Caching — why this is affordable at all

**A shadow map only needs re-rendering when something inside that light's frustum actually moves.**
Without caching, eight shadowed spots cost eight depth passes every frame forever. With it, a spot
lighting a static corridor renders **once** and then costs exactly what the SDF costs — nothing —
until the Player walks into it.

For a game that is mostly static level geometry with a few moving characters, which is the common
GDevelop 3D case, this is the difference between "too expensive to default on" and "free most
frames". It is not an optimisation to add later; it is the reason the feature is viable.

### Dirty rules

A light's map is valid until any of these happen, at which point it is marked dirty:

| Trigger | Test |
| :--- | :--- |
| A caster inside the frustum moved, rotated or resized | AABB of the moved object against the light's frustum |
| A caster was created or destroyed inside the frustum | same AABB test at create/destroy |
| The light moved, rotated, or changed `Radius` / cone angles | compare against the transform the map was rendered with |
| `ShadowMapSize` changed | reallocate, always dirty |
| The light was just assigned a layer by §6 | first render |

`ShadowMapStatic = true` suppresses every trigger except reallocation. It is an author's promise, and
a wrong promise shows as a shadow frozen in the wrong place — so it needs saying plainly in the
property description rather than being presented as a free speed-up.

### Cost of the check

Per frame: **(objects that moved) × (lights holding a map)**. With an 8-light cap and a handful of
movers that is a few dozen AABB-vs-frustum tests — negligible against even one depth pass. Only
objects that actually moved are considered; a static scene does zero work.

The cluster broadphase already tracks per-light `isInFrustum` and `viewDistance` each frame, so the
light-side inputs exist. What is new is a per-frame list of moved casters.

### Staggering — the time budget

Dirty lights do not all re-render in the same frame. `MaxShadowMapUpdatesPerFrame` (default **2**)
caps it, and the rest wait:

1. Collect dirty lights.
2. Sort by §6's screen-footprint ranking, but **add an age term** — frames since last render.
3. Re-render the top N. The remainder stay dirty and rank higher next frame.

The age term is what stops one permanently-dirty light (a spot following the Player) from starving
every other. Without it a single always-moving light monopolises the budget forever.

**A one-frame-stale shadow is imperceptible; a shadow that never updates is a bug.** That is the
trade this budget is making, and it is why the age term is not optional.

### Interaction with the memory budget

The two caps are independent and must not be conflated:

- `MaxShadowMappedLights` (default 4, cap 8) — how many maps **exist**. Memory. §5.
- `MaxShadowMapUpdatesPerFrame` (default 2) — how many **re-render**. Time.

Eight allocated maps with two updates per frame is a perfectly reasonable steady state: 32 MB
resident, two depth passes per frame, and seven of the eight shadows correct-and-free on any given
frame.

### Editor and first frame

Nothing moves in the GDevelop scene editor, so every map renders once and then holds. On the first
frame of a preview every assigned light is dirty at once — that is a legitimate spike, and it must
respect the update budget rather than rendering all eight immediately, or the first frames hitch.

---

## 7.9 Implementation status — working, spot and point, in the real engine

`test-gdjs-shadow-maps.mjs` boots an actual `gdjs.RuntimeGame` with real `Cube3DObject` instances
and passes all 13 assertions. All eight other suites pass. Both spot and point paths shadow, and
shadows track moving casters.

### The bug that made scenes go black

**A light's own holder object was casting into that light's shadow map.**

ClusteredLight3D normally sits on a Cube3D placed as a marker, and GDevelop defaults its
"Shadow casting" property on. The light is at that cube's centre, so the cube *encloses* it: the
depth map filled with the inside of the holder at roughly the near plane, and every fragment in the
scene read as occluded. The symptom was a completely black scene the instant a light was granted a
map — which looks nothing like "the shadow is in the wrong place".

Material type does not protect against this. `castShadow` is a mesh flag, so a "No lighting effect"
(MeshBasicMaterial) holder still writes depth.

**The same root cause applies to the SDF**, and was fixed alongside: `collectBakeGeometry` baked
every visible mesh, holder cubes included, so an SDF shadow ray hit the holder just before reaching
the light and returned fully occluded. A light that appears to do nothing, rather than a shadow that
looks wrong. Light-owned meshes are now excluded from both paths.

### How it was found

Purely by measurement, after several wrong theories:

| step | reading | conclusion |
| :--- | :--- | :--- |
| native spot added, no cast | 88,614 lit | not the recompile |
| native spot casting | 88,614 lit | not the native light |
| our slot assigned | **0 lit** | it is our sampler |
| shadow map contents | 1,048,576 non-clear texels | the map is full of real data |
| JS replay of the lookup | uv (0.74, 0.24), z 0.958 | the coordinates are correct |
| GPU emitting the stored depth | max 0.216 | **stored depth is far too small** |

Solving 0.216 back through the projection gives ~30 world units from the light — the near plane.
Something was sitting on top of the light. That was the holder cube.

### What the synthetic tests could never catch

They build scenes from raw `THREE.Mesh` objects and attach lights to bare mock objects with no
renderer at all. A real GDevelop light lives on a **Cube3D with geometry that casts shadows**. No
amount of synthetic testing would have surfaced this; `test-gdjs-shadow-maps.mjs` should be the
acceptance gate for anything touching shadows from here on.

### A test bug worth recording

The real-engine assertion originally read `darkened > 200` and **passed on a completely black
frame** — every lit pixel had "darkened". It now also requires the darkened region to be between 1%
and 90% of the lit area. An assertion that cannot distinguish a shadow from a blackout is worse than
no assertion, and it is why this was reported working once before it was.

### Measured scaling (`bench-light-scaling.mjs`)

SwiftShader software rasteriser — **relative shape only, not real frame times.** Absolute
milliseconds are perhaps one to two orders of magnitude slower than a real GPU.

| lights | mode | median | depth passes/frame | mapped |
| ---: | :--- | ---: | ---: | ---: |
| 1–16 | Off (clustered only) | 0.6–0.9 ms | 0 | 0 |
| 32 | Off | 2.3 ms | 0 | 0 |
| 64 | Off | 3.8 ms | 0 | 0 |
| 1 | Maps, static scene | 1.1 ms | **0.00** | 1 |
| 4 | Maps, static scene | 0.9 ms | **0.00** | 4 |
| 8 | Maps, static scene | 0.7 ms | **0.00** | 4 (cap) |
| 4 | Maps, caster moving every frame | 0.9 ms | 1.93 | 4 |
| 8 | Maps, caster moving every frame | 0.9 ms | 1.88 | 4 (cap) |

Three things this establishes, none of which depend on the noisy timings:

- **The clustered light loop is flat to ~32 lights** and knees between 32 and 64. That knee is the
  light loop itself, not shadows.
- **Caching is total.** A static scene runs **zero** depth passes per frame at every light count.
  A cached shadow map costs exactly what the SDF costs: nothing.
- **Both budgets hold.** Constant movement settles at ~1.9 passes/frame against a cap of 2, and only
  4 lights hold maps even when 8 request them — the `MaxShadowMappedLights` default.

**One real cost the benchmark exposed:** a 3.2 s p95 outlier when the 8th shadow-mapped light was
added. Adding a native `SpotLight` with `castShadow` changes Three's `NUM_SPOT_LIGHT_SHADOWS`, which
invalidates and recompiles **every** material program. That is a genuine hitch on any hardware, not
a software-rasteriser artefact. Allocate shadow-mapped lights at scene start rather than spawning
them mid-gameplay, or pre-warm the slots. Worth an explicit note in the README before this ships.

### Still to do

- **Array-texture storage** (§5) — currently 4 individual samplers, the documented fallback. The
  `sampler2DArray` path is what raises the cap from 4 to 8.
- **The behavior properties are runtime-only.** `ShadowTechnique`, `ShadowMapSize` and the rest are
  accepted by `registerLight`/`updateLight` but not yet exposed in the GDevelop inspector, so they
  are only reachable from events. That is the next piece of work.
- **GDevelop editor and export acceptance** (A.8).

## 8. Phases

| # | Work | Exit criterion |
| :--- | :--- | :--- |
| A.1 | **Capability spike.** Assert `WebGLArrayRenderTarget` works on the integrated-GPU floor: allocate, render a layer, sample it. | Written result, or a documented fallback to 4 separate targets. |
| A.2 | **Light record widening.** 16 → 20 floats, `LIGHT_TEXELS` updated, every packing/unpacking site moved. | Existing suites pass unchanged; clustered lighting visually identical with maps disabled. |
| A.3 | **One shadowed spot.** Native `SpotLight` at zero intensity, one map, matrix into the shader. | A moving caster throws a shadow that tracks it — the thing SDF cannot do. |
| A.4 | **Array storage + memory budget + selection**, with hysteresis. | 8 shadowed spots render within budget; no popping as the camera pans across them. |
| A.5 | **Caching and staggered updates** (§7.5): dirty tracking, age-weighted ranking, `MaxShadowMapUpdatesPerFrame`, `ShadowMapStatic`. | A static scene re-renders **zero** maps per frame after the first; one moving caster dirties only the lights whose frustum it entered. |
| A.6 | **`ShadowTechnique` dropdown** (§3): Auto / ShadowMap / SDF / None, plus the warning when a forced `ShadowMap` cannot get a slot. | Each value behaves as specified; an unhonourable force warns rather than silently degrading. |
| A.7 | **`MapsSDF` composition.** Lights past the budget fall back to the SDF march. | No visible discontinuity at the handover; a light crossing the boundary does not flicker. |
| A.8 | **Editor + export acceptance.** | Works in a GDevelop preview and an export, not only in the harness. |

A.5 lands before the dropdown deliberately: until caching exists, the honest cost of a shadow map is
one depth pass per light per frame, and any per-light technique choice would be made against the
wrong numbers.

**Abandon criterion:** if A.1 shows array render targets are unusable on the floor hardware *and*
the 4-target fallback cannot hold budget, stop and keep SDF. Say so here rather than shipping
something that only works on a discrete GPU.

---

## 9. Budget

Same targets as the renderer modernization plan: integrated GPU floor, ≤ 4.0 ms total post/lighting
overhead at 1080p, ≤ 128 MB of GPU-side targets.

A 1024² depth map is ~4 MB. Eight is 32 MB — a quarter of the whole ceiling, before the SDF volume
and probe volumes. **`ShadowMapSize` defaulting to 1024 with a cap of 8 is the memory design, not a
convenience.** Measure at 512 as well; for a spot lighting a small area it is often indistinguishable.

### Render cost, and why caching dominates it

A depth pass writes no colour and runs no lighting, so it scales with **geometry and draw calls**,
not resolution. That is the opposite of the post-processing passes in the modernization plan.

| Scene | Per shadowed spot, per re-render |
| :--- | :--- |
| A few hundred triangles (typical GDevelop 3D scene) | well under 0.1 ms — rounding error |
| A few thousand draw calls | 0.3–1 ms on the integrated floor |
| Point light | **×6** — one shadowed point costs six spots, which is why Phase B is deferred |

Sampling is the cheap side: one array-texture fetch, or 4–16 with PCF. The SDF's 12-step sphere
trace is *more* expensive per fragment; its advantage is having no render cost at all.

**Caching (§7.5) is what closes that gap.** A cached static map costs exactly what the SDF costs —
nothing — while still supporting a dynamic caster the moment one enters the frustum. Budget against
`MaxShadowMapUpdatesPerFrame × per-pass cost`, not against the number of allocated maps; those are
different numbers and conflating them overstates the cost by roughly the cache hit rate.

---

## 10. Acceptance testing

`test-local-sdf-shadow-webgl.mjs` is the template — it renders in headless Chrome with real
Three.js, flips `castShadow`, and counts pixels that darken. Two gaps it was written to close apply
here too: **test a moving caster**, and **build the scene away from the world origin**.

New test, `test-local-shadow-maps-webgl.mjs`:

1. Static caster, spot light, mode `Maps` → shadow pixels appear. Baseline.
2. **Caster moves; shadow moves with it.** Capture two frames with the caster at different
   positions and assert the darkened region shifts. This is the capability SDF does not have and is
   the whole justification for the feature — if only one assertion survives, it is this one.
3. Scene at x ≈ 1800, not the origin.
4. Budget: 12 shadow-enabled spots, cap 8 → exactly 8 mapped, `ShadowMappedLightCount()` agrees.
5. `MapsSDF`: a light past the cut still shadows, via the SDF.
6. `glErrors` empty, frame time within §9.

Caching (§7.5) — these are counter assertions, not pixel assertions, and `ShadowMapUpdatesThisFrame()`
is the instrument:

7. **Static scene settles to zero.** Render 60 frames with nothing moving → updates reach 0 and stay
   there. If a static scene keeps re-rendering maps, caching is not working and the whole cost case
   collapses.
8. **A mover dirties only what it should.** Move one caster inside light A's frustum and nowhere near
   light B's → A updates, B does not.
9. **Starvation.** One permanently-moving light plus seven static ones, update budget 2 → every light
   re-renders within a bounded number of frames. Asserts the age term actually works.
10. **First-frame spike is capped.** 8 lights assigned on frame 1 → no frame exceeds
    `MaxShadowMapUpdatesPerFrame`.
11. **`ShadowMapStatic` suppresses.** Mark a light static, move a caster through its frustum →
    updates stay 0 and the shadow visibly does not follow. The wrong-promise failure mode, asserted
    so it is understood rather than discovered.

---

## 11. What this fixes for the author

- **No bounds cube.** A spot light casts a shadow with the light and the `CastShadows` checkbox,
  nothing else.
- **Dynamic casters.** The `Player` casts a shadow.
- **No bake.** No multi-second wait, no cancellation, no silent empty volume.
- **No boundary seam.** The shadow exists wherever the light reaches.
- **SDF remains** for the static-many-lights case and for the Sun.

---

## 12. References

- [SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md](SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md) — CSM/SDF
  selector, cascade fitting, the mode table this extends.
- [SDF_SHADOW_IMPLEMENTATION_PLAN.md](SDF_SHADOW_IMPLEMENTATION_PLAN.md) — the path this sits beside.
- [../docs/RENDERER-MODERNIZATION-PLAN.md](../docs/RENDERER-MODERNIZATION-PLAN.md) — budgets,
  measurement method and the validation rules in §9/§10 there apply unchanged.
- `test-local-sdf-shadow-webgl.mjs` — harness template, and the reason the moving-caster and
  away-from-origin cases are called out explicitly.
