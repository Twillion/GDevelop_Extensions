# Demand-Driven Shadows — Plan

Status: proposed, not implemented.

## 0. The proposal

> "Shouldn't we just always assume the game is a hybrid and only actually initiate the shadow
> system when it's called for?"

Yes, with one significant caveat about *when* arming happens. The mode enum currently decides both
**policy** (which techniques are permitted) and **allocation** (which subsystems are built). Those
should be separated: policy stays authored, allocation becomes demand-driven.

## 1. What is already demand-driven, and what is not

Three subsystems, three different gates today:

| Subsystem | Allocates | Shader permutation | Gated on today | Demand-driven? |
|---|---|---|---|---|
| SDF | `Data3DTexture` bake | `AL_SDF_SHADOWS` | volume behavior present **and** `isBaked` | **Yes** |
| CSM (Sun) | `count` x `mapSize`^2 depth maps (3 x 2048^2 by default) | `csmCount` in key | mode permits **and** a visible directional light with intensity > 0 exists | Partly |
| Local maps | up to `LOCAL_SHADOW_SLOTS` (4) spot/point maps | `AL_LOCAL_SHADOW_MAPS` + 4 samplers | **mode only** | **No** |

`localMapsEnabled()` is now just `mode === 'Auto'` — nothing else. So in `Auto`, the default,
**every** `MeshStandardMaterial` in the game compiles in four shadow samplers, the `cubeToUV` cube
path and the sampling loop, whether or not a single light ever requests a map.

That is the concrete waste the proposal removes. SDF already does the right thing and needs no
change; CSM needs a caster check; local maps need the real work.

## 2. The caveat that shapes the whole design: arming causes recompiles

Feature flags are baked into `cacheKey` (`AdvancedLighting3D.runtime.js:2135`). Changing one
recompiles **every hooked material**. Naive laziness converts a constant startup cost into a frame
hitch at the worst possible moment — the player turns on a flashlight and the game stalls.

Worse, the native-light coupling is scene-wide. Verified in the shipped r160 bundle:

- `projectObject`: `if (false === t.visible) return; ... else if (t.isLight) pushLight(t),
  t.castShadow && pushShadow(t)` — an **invisible light is pushed neither as a light nor as a
  shadow**. So toggling a slot light's `visible` changes `NUM_SPOT_LIGHT_SHADOWS`, which recompiles
  every material in the scene, including objects this extension never touched. This is the source
  of the 3.2 s p95 hitch already recorded in the local-shadow-map plan.
- `WebGLShadowMap.render`: `if (false === h.autoUpdate && false === h.needsUpdate) continue` —
  evaluated per light, **after** the arrays are built. A *visible* slot light with
  `autoUpdate = false` and `needsUpdate = false` keeps the permutation stable and still skips its
  depth render entirely.

So the rules are:

- **R1 — Arm once, never disarm within a scene.** A subsystem that arms stays armed for the
  scene's lifetime. Oscillation is worse than the cost being avoided.
- **R2 — Arm before the first visible frame wherever the demand is authored.** Authored data
  (behaviors present, `CastShadows` checkboxes, an SDF volume in the scene) is knowable during the
  first step. Only genuinely dynamic demand should arm late.
- **R3 — Park slot lights visible, not hidden.** Unused slots go to `autoUpdate = false`,
  `needsUpdate = false` instead of `visible = false`. Zero depth renders, stable
  `NUM_SPOT_LIGHT_SHADOWS`. Costs a native spot-shadow sample per fragment in every material —
  see section 6 for the escape from that.

## 3. Honest scoping: the default just shipped blunts this

`CastShadows` now defaults to **true** (deliberately — a fresh light casting with no configuration
was the point). So in any scene with a clustered spot or point light, local maps arm anyway and
demand-gating buys nothing there.

The wins are therefore narrower than the proposal sounds:

- Scenes whose clustered lights are all `AreaCapsule`, or all `ShadowTechnique = SDF`/`None`.
- Scenes using the extension only for probes, flicker or tinting, with no shadow-casting light.
- Scenes with a Sun but no mesh with `castShadow` — today those still allocate ~50 MB of cascades.
- The SDF path in scenes with no volume — already correct, no change.

That is still worth doing, and the *policy* simplification in section 4 is worth doing on its own
merits regardless. But this is not a broad win across every project and should not be sold as one.

## 4. Policy: collapse the mode enum — DONE, and further than planned

Shipped. The mode is now purely an **ownership** question — who shadows this scene — with exactly
three answers:

- **`Auto`** (default) — this extension shadows the scene and picks how.
- **`Native`** — GDevelop owns shadowing entirely; the extension touches nothing.
- **`Off`** — no shadows at all. Still a tested contract (`test-shadow-runtime.mjs`).

`CSM`, `SDF`, `Hybrid`, `Maps`, `MapsSDF` were **deleted**, not kept. There are no shipped games
using these extensions, so the compatibility argument for keeping them does not apply. They were
never techniques anyway — they enumerated every pairing of two independent choices, which now live
where they belong:

- **How the Sun casts**: `shadowState.sunShadows` = `Cascades` | `DistanceField` | `Off`, exposed as
  the manager property `SunShadowMethod` and the action `SetSunShadows`.
- **How each local light casts**: the existing per-light `ShadowTechnique`.

Two orthogonal axes express all five retired modes without enumerating their product.
`setShadowMode` now *rejects* the retired names rather than silently reinterpreting them, which is
asserted.

Under `Auto` the per-light `ShadowTechnique` dropdown (Auto / ShadowMap / SDF / None) becomes the
primary lever, which is the right place for it: the scene says "whatever is needed", the light says
"I need this kind".

## 5. Implementation

### 5.1 Arming state

Add to scene state:

    armed: { maps: false, csm: false, sdf: false }   // latched, never cleared while the scene lives

Replace `localMapsEnabled(state)` with `localMapsArmed(state)`:

- `Off` / `Native` -> false, always.
- `Auto` -> `state.armed.maps`.

`sdfEnabled` stays as it is. The existing `hasSDF` texture test in `injectShaderOnMaterial` already
supplies its demand half, and `sunShadows === 'DistanceField'` states the Sun's intent explicitly.

### 5.2 The arming scan

One function, `evaluateShadowDemand(state, root)`, run:

1. once on the first `doStepPreEvents` after scene load (R2), and
2. whenever a light behavior is created, or `CastShadows` / `ShadowTechnique` is set through the
   action, or a mesh's `castShadow` is set — event-driven, not per frame.

It sets, never clears:

- `armed.maps` if any registered light has `active && castShadow`, type `Spot` or `Point`, and
  technique not `SDF`/`None`. This is the existing candidate predicate in `updateLocalShadowMaps`
  lifted out so it feeds the permutation as well as the selection. **Write it as one named
  predicate**, so the caster/light mobility model in `USABILITY_PLAN.md` 2.2 can replace its body
  later without restructuring the arming code around it.
- `armed.csm` if a directional light exists **and** at least one mesh has `castShadow === true`.
  The caster half is new and is what stops a sun-only scene allocating cascades. The traversal runs
  in the scan, not per frame.
- `armed.sdf` if an SDF volume behavior is registered.

### 5.3 Deferred arming and the recompile

When the scan arms something after the first frame, materials must recompile. Do it in one batch at
end of step, not per material as discovered, and count it: `getShadowRecompileCount()` as a debug
expression, so the hitch is measurable rather than mysterious.

Add a manager property **`PreloadShadowSystems`** (`None` / `Maps` / `CSM` / `All`, default `None`)
that force-arms at load. A game that spawns its first shadow-casting light mid-gameplay sets this
and pays the cost during loading instead.

### 5.4 Slot parking (R3) — DONE

In `ensureLocalSlot` and the release path, replace `slot.light.visible = false` with:

    slot.light.visible = true;
    slot.light.intensity = 0;
    slot.light.shadow.autoUpdate = false;
    slot.light.shadow.needsUpdate = false;

Once armed, allocate all `capacity` slot lights up front and never remove them, so
`NUM_SPOT_LIGHT_SHADOWS` is constant for the scene's life. Point slots still swap a `SpotLight` for
a `PointLight`, which changes `NUM_POINT_LIGHT_SHADOWS` — so **allocate point and spot slots from a
fixed authored split** rather than swapping by whichever light won the slot this frame.

### 5.5 Budget weighting — TIME budget DONE, memory budget deferred

A point light costs six depth renders but counts as one against `maxShadowMappedLights` and
`maxShadowMapUpdatesPerFrame`. With `maxUpdatesPerFrame = 2`, two dirty point lights permit twelve
face renders in a frame. Weight both budgets by face count (1 for spot, 6 for point) in the
selection loop. This lands in the same code as 5.4 and should ship with it.

### 5.6 Stale label

`build-extension.mjs:301` still describes the `SetCastShadows` action as "Enable SDF soft shadows".
The property was renamed; the action was not. One-line fix.

## 6. Later, optional: stop using native lights for the depth pass

Every problem in section 2 comes from borrowing Three's `WebGLShadowMap` via zero-intensity native
lights. Rendering the depth maps directly — `renderer.setRenderTarget()` with a depth override
material, driven by our own camera fitting — removes:

- the `NUM_*_LIGHT_SHADOWS` permutation coupling, and with it the scene-wide recompile hitch,
- the wasted native shadow sample per fragment from parked slots,
- the spot-vs-point slot-type split in 5.4,
- the `LOCAL_SHADOW_SLOTS = 4` sampler cap, since we would own the target and could use a
  `WebGLArrayRenderTarget`, which is the already-planned path to 8 lights.

This is the structurally correct design and it subsumes the array-texture item already on the list.
It is also a substantially larger change and should not be bundled with sections 4-5.

## 7. Acceptance

1. A scene with clustered lights but no shadow caster compiles **without** `AL_LOCAL_SHADOW_MAPS`.
   Assert on the generated `cacheKey`.
2. A scene with a shadow-casting spot arms and still produces the shadow that
   `test-gdjs-shadow-maps.mjs` asserts today. No regression in the real-engine harness.
3. Arming from the load-time scan produces **zero** recompiles after the first rendered frame.
4. Arming triggered mid-scene recompiles once, not once per material;
   `getShadowRecompileCount()` returns 1.
5. A sun-only scene with no `castShadow` mesh allocates no cascade lights.
6. `Off` still suppresses the native Sun; `Native` still leaves it casting. Existing assertions in
   `test-shadow-runtime.mjs` pass unchanged.
7. Retired mode strings are rejected, not silently reinterpreted. (Done.)
8. Two dirty point lights render at most `maxUpdatesPerFrame` **faces**, not lights.

## 8. Order

1. ~~Section 4 (policy)~~ — **done**, and it deleted the retired modes rather than keeping them.
2. The shared status evaluator, `USABILITY_PLAN.md` 2.1, so every arming fallback is observable.
3. Sections 5.1-5.3 (arming) plus 5.6.
4. Sections 5.4-5.5 (slot parking, budget weighting).
5. Section 6 only if the parked-slot sampling cost measures badly.

## 9. Revision log

- **r2.** Mode collapse implemented and extended: the five combined technique modes were deleted
  rather than retained, since no shipped games constrain the design. `sunShadows` added as its own
  axis. Also fixed while here: the injection cache compared neither `localMaps` nor `use3D` despite
  both reaching `cacheKey`, so a material kept a stale program variant whenever either flipped
  alone — precisely the failure mode demand-driven arming would have hit. A `warnOnce` now fires
  when the Sun is set to `DistanceField` with no baked volume, which silently removes its shadow.
- The demand-gating work in sections 5.1-5.5 is **not** started. Its demand predicate should be
  written so the caster/light mobility model in `USABILITY_PLAN.md` 2.2 can replace it later
  without restructuring, and it should report through the status evaluator in that plan's 2.1.


## 10. Revision r3 — 2026-09-12

**5.4 slot parking: done.** `parkSlotLight()` replaces both `slot.light.visible = false` sites. A
parked slot stays visible with `intensity = 0`, `shadow.autoUpdate = false` and
`shadow.needsUpdate = false`. That keeps `NUM_SPOT_LIGHT_SHADOWS` constant — the flag whose change
recompiles every material in the scene, including objects this extension never touched — while
still skipping the depth render entirely. `autoUpdate` was already permanently false in this design,
with rendering driven by `needsUpdate`, so parking fits the existing model and only `visible`
changed.

**5.5 time budget: done, weighted by face count.** `slotFaceCost()` returns 6 for a point light and
1 for a spot, read from `shadow.getFrameExtents()` where available so it stays correct if a shadow
type changes shape. `MaxShadowMapUpdatesPerFrame = 2` no longer permits twelve face renders when
both dirty lights are points. One deliberate exception: the first update is always allowed through
even if it alone exceeds the budget, or a point light costing 6 would starve forever under a budget
of 2 and never cast at all.

**5.5 memory budget: deliberately NOT weighted.** `MaxShadowMappedLights` is a user-facing number
documented as "how many lights may hold a depth map". Making a point light consume 6 of it would
silently change what every existing setting means. The acute problem was the frame spike, which the
time budget fixes; redefining the memory budget is a UX decision worth raising rather than slipping
in. Still open.

**Still open here:** `ensureLocalSlot` swaps a `SpotLight` for a `PointLight` when a point light
wins a slot, which changes `NUM_POINT_LIGHT_SHADOWS` and so still triggers the scene-wide recompile
that 5.4 otherwise eliminates. The fix is a fixed authored spot/point split, allocated once. 5.4 is
therefore a large improvement, not a complete one.

**Resolved 2026-09-13: texture-unit safety.** There are four local-map samplers. Linked-program
measurement now establishes the complete cost: 25 active fragment samplers with Native local maps,
21 with Owned, against WebGL2's guaranteed minimum of 16. A scene-wide allocator reads the hardware
limit, scans the heaviest material and external native shadow casters, and admits complete optional
feature blocks before shader compilation. `test-sampler-ladder.mjs` forces the raw permutations to
measure their cost, then verifies the automatic 16-unit fallback links at 11 units with CSM and
Native local maps suppressed. This prevents the black/white scene failure while preserving as many
explicitly requested features as fit.

## 11. Section 6 — owned depth rendering, r1 (2026-09-12)

**Shipped as an opt-in backend, OFF by default.** Manager property `Maps: Depth renderer` =
`Native` (default) | `Owned`. `test-owned-depth-webgl.mjs` covers it.

**What it does.** Renders each local shadow map directly with `renderer.setRenderTarget()` plus a
`MeshDepthMaterial` override and our own camera fitting, instead of borrowing Three's shadow pass
through a hidden zero-intensity light. The shader is UNCHANGED: it still reads a texture, a matrix
and a few scalars, so this replaces the producer, not the consumer.

**Measured result.** `spotShadowMap[0]` disappears from the generated program entirely:

    native declares:  uClusteredLightData, uAlLocalMap0..3, spotShadowMap[0]
    owned declares:   uClusteredLightData, uAlLocalMap0..3

One texture unit saved with a single shadowed light, and the saving is one unit PER shadowed light
because `spotShadowMap[]` is sized by count. On the 16-unit hardware that started this, four
shadowed spots is four units back.

**SPOT ONLY.** A point light compares radial distance, which needs `MeshDistanceMaterial` — and in
r160 that material no longer exposes `referencePosition` as a property; Three sets that uniform from
the light during its own pass, and the whole point here is that there is no light. Driving it
without the reference position would measure distance from the world origin, which is the kind of
nearly-plausible wrongness that costs hours. Point lights fall back to Native automatically, and the
unreachable cube branch warns rather than half-rendering. Finishing it needs our own distance
shader.

**NOT yet equivalent to Native, which is why it is not the default.** On the test scene the owned
shadow lands within 0.5px horizontally but **9.9px vertically** of the native one, and covers 1.6x
the area. Both are inside the test's tolerances, but neither is "the same picture". Roughly 40% of
lit pixels differ by more than 40% in each direction, which reads as a spatial offset rather than a
uniform brightness change. Likely candidates: the near-plane derivation, the spot FOV (native uses
`angle * 2`, this uses `spotOuterAngle * 2`, and those are not the same number once the native path
clamps angle), and PCF radius. This needs closing before Owned can be the default.

**Three test-scene bugs found while building this**, each of which made a working backend look
broken:
- The camera was aimed at +Y in a scene whose root carries `scale.y = -1`, so BOTH backends rendered
  a black frame and the comparison measured two black images.
- The dark-region detector required `v > 8`, so a backend shadowing EVERYTHING scored zero dark
  pixels and looked identical to one shadowing nothing.
- The depth-map scan unpacked RGBA depth from the red channel; `packDepthToRGBA` puts the coarsest
  bits in ALPHA, so the reported depths were meaningless.

## 12. The SDF volume box artefact — fixed, and what it uncovered (2026-09-12)

**Reported:** a hard-edged quad on the ground exactly matching the SDFVolume3D bounds, inside an
otherwise smooth spotlight pool. Vanished with shadow ownership Off, so it came from the shadow
path, not scene geometry.

**Cause.** The ray origin did not clear the bake's solid band. The bake marks everything within half
a voxel DIAGONAL of a surface as solid; the march started at
`normal * max(shadowBias * voxelSize, 0.1)`, where the bias defaults to 0.02 and `voxelSize` is the
SMALLEST axis. So every fragment on the floor began inside solid space, `sdfSampleStatic` returned
below `hitEps` on the first sample, and the march returned 0.0 — fully shadowed. Outside the volume
the ray-box test returns 1.0 immediately, so the boundary became a hard edge: the volume drew itself.

**Fix.** `uSdfDilation` is published to the shader and both march origins clear it:
`max(max(bias * voxelSize, uSdfDilation * 1.05), 0.1)`. Measured by `test-sdf-boundary-webgl.mjs`
with a volume containing nothing but flat floor: the luminance step across the boundary goes from
**233.4 to 0.0**.

**A trap worth recording.** The first attempt declared `uSdfDilation` inside the `AL_SDF_SHADOWS`
guard while the Sun hook, which lives outside that guard, referenced it. The shader then failed to
compile and EVERY shadow in the scene disappeared — which read as "the fix removes all shadows" and
caused the fix to be reverted once as disproved. It is declared unconditionally now, beside
`uViewToWorld`, which was moved out for exactly the same reason earlier.

**RETRACTED — local SDF shadows DO work.** An earlier revision of this section claimed they never
cast from an occluder. That was wrong, and the cause was a bug in my own test: the boundary harness
took a `withCaster` flag that the page function never declared, so both "with caster" runs rendered
an empty scene. Zero darkened pixels meant zero occluders, not a broken march. Corrected results:

| | artefact at boundary | real occluder shadows |
| :--- | ---: | ---: |
| before the ray-origin fix | 233.4 luminance | 72.5% of frame (self-occlusion, not a shadow) |
| after | **0.0** | **4.3% of frame** (localised, correct) |

`test-local-sdf-shadow-webgl.mjs` now reports 3.1% where it used to report 72.5%.

**The lesson that survives.** That suite asserted only "some region darkened" and passed happily on
72.5% at every shadow bias — a constant, not a shadow. A bare existence check cannot tell a shadow
from a uniform artefact. Both suites now bound the shadowed FRACTION from above as well as below,
and the note at the top of that file records why.

**Raised `maxSteps` from 12 to 32** for the local march while investigating. Sphere tracing advances
by the distance to the nearest surface, so a ray travelling near the floor crawls; 12 steps was not
obviously enough. This was not the cause of the artefact and its benefit is unmeasured.


## 13. Owned backend equivalence — NOT closed (2026-09-12)

Asked to close the reported ~10px offset. It is not a 10px offset: **85.3% of lit pixels differ by
more than 25 luminance** between the Owned and Native backends on the same scene, and the owned
render is dimmer overall (mean 109.4 vs 119.6).

The earlier "within 0.5px horizontally, 9.9px vertically" figure was produced by a weak metric. The
test compared the CENTROID of a dark luminance band, and two substantially different images can have
dark regions whose centroids land near each other. That number should not have been reported as
near-equivalence, and the test now prints the divergence loudly.

**Eliminated, each measured rather than reasoned:**

| Hypothesis | Evidence |
| :--- | :--- |
| Light-space matrix differs | Element-wise delta is **exactly zero** |
| Shadow camera differs | near 28, far 1400, fov 120, identical position in both |
| Depth/normal bias differ | Both resolve to the same values from the same light record |
| Material side / winding | FrontSide and BackSide give identical output |
| Map clear colour | Fixed to white (Three's behaviour); no change to the result |
| Depth map contents | Sampled region reads identically in both |

Everything measurable about the transform and the map matches, and the images still diverge. The
cause is unknown.

**Consequence.** Owned stays opt-in and off by default. It remains useful as the ONLY configuration
that fits 16 texture units, and that is why it shipped — but it is not a drop-in replacement for
Native and must not be presented as one.

**VSM is NOT started, deliberately.** It was to be built on this backend, since owning the depth
pass is what makes moment storage possible. Building it on a foundation that diverges 85% from the
reference would make both problems harder to diagnose, not easier. The equivalence has to close
first.
