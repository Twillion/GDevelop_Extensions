# Making This Easier — Unreal's Model, and What to Borrow

Status: proposed. Companion to `DEMAND_DRIVEN_SHADOWS_PLAN.md`.

## 1. How Unreal actually does lighting

### 1.1 Light culling — the same strategy, not the same implementation

UE builds a **clustered light grid on the GPU**: the frustum is divided into froxels, lights are
binned per froxel, and shading reads only the lights touching its cluster.

`AdvancedLighting3D` uses the same broad *strategy* and the same data model, but **the binning runs
on the CPU in JavaScript** and is uploaded as textures — `cpuBroadphaseTimeMs` is measured from
`AdvancedLighting3D.runtime.js:4155` to 4500, and the per-cluster loop at 4425 sorts light indices
in JS every frame. Same idea, different execution, and the CPU cost is real and measured. Do not
describe this as "architecturally the same GPU light grid".

### 1.2 Mobility — the decision that drives everything

Mobility is Unreal's **primary** abstraction, but not its only one — it still exposes a project-level
shadow-map method, per-light Distance Field Shadow and ray-traced-shadow toggles, and per-light
resolution scale. The accurate claim is that Mobility is the question authors answer *first*, and
technique controls sit behind it as overrides.

The question Unreal asks per light and per mesh is **Mobility**.

| Mobility | Meaning | What the renderer does |
|---|---|---|
| **Static** | Never moves, never changes | Fully baked into lightmaps. Zero runtime cost. |
| **Stationary** | Fixed transform, but colour/intensity may change | Direct lighting dynamic, indirect baked. Capped at 4 overlapping per area, because the precomputed shadow mask has 4 channels. |
| **Movable** | Anything may change | Fully dynamic, most expensive. |

Mobility is a statement about **the content**, not about the renderer. The author says "this lamp
never moves"; the engine decides that means lightmaps. This is the single most important thing to
borrow, and section 2.1 is about doing exactly that.

### 1.3 Shadowing

- **Cascaded Shadow Maps** for the directional light near the camera — same technique as the CSM
  here, same practical split scheme.
- **Distance Field Shadows.** Each mesh asset gets its own baked SDF. A **Global Distance Field**
  is assembled around the camera from those per-mesh fields each frame. This is the key difference
  from the single baked volume here: because the field is composed of per-mesh instances, **a mesh
  that moves takes its distance field with it**. That is why Unreal's distance fields handle
  movers and this extension's cannot.
- **Virtual Shadow Maps** (UE5). A conceptually enormous shadow map per light, split into 128x128
  pages, where only the pages visible pixels actually need are resident and rendered. Pages
  covering static geometry are **cached and not re-rendered**. This is precisely the
  invalidate-on-mover caching already implemented here, but at page granularity instead of
  whole-map granularity.
- **Ray-traced shadows** where the hardware offers it.

### 1.4 Global illumination and reflections

- **Lumen** (UE5 default): a surface cache built from mesh "cards", screen-space traces first,
  falling back to distance-field traces (software) or hardware ray tracing, with radiance caching
  at several levels — adaptive screen probes plus a world-space cache for distant lighting.
- Notably, **Lumen depends heavily on temporal accumulation**, which is the same dependency the
  TAA discussion in `docs/RENDERER-MODERNIZATION-PLAN.md` circles. Unreal's answer to noise is not
  a cleverer sampler, it is history reuse.
- Legacy baked path is **Lightmass** / GPU Lightmass.

### 1.5 Units and per-light knobs

Physical units throughout — candelas for point and spot, lux for directional — plus IES photometric
profiles (already imitated here) and an **Attenuation Radius** that is both the falloff and the
culling bound. Quality knobs live in **scalability groups** and **Post Process Volumes**, not on
individual lights.

## 2. What to borrow, in value order

Ranked by how much time each would actually have saved on this project.

### 2.1 A shared shadow status evaluator — **SHIPPED**

One evaluator, used by everything else. Not a console message: a function returning a **stable
reason code** per light, so the same logic drives the readable report, the expressions, and the
start-of-scene warnings.

Checks, in order, stopping at the first that fails:

1. Light active, intensity above zero.
2. `CastShadows` on.
3. Scene shadow ownership is `Auto`.
4. `ShadowTechnique` permits a map, and the light type can take one (AreaCapsule cannot).
5. The light won a shadow-map slot, rather than being cut by `MaxShadowMappedLights`.
6. A caster with `castShadow` is inside the light's **actual influence volume** — for a spot that
   means the cone, not a sphere — and on a layer the light affects.
7. A receiver with `receiveShadow` is likewise in range.
8. On the SDF path: a volume exists, is baked (not still baking), and the caster is inside it.

Surface it as:

- `ExplainLightShadows(light)` — readable multi-line report.
- `LightShadowStatus(light)` / `LightShadowReason(light)` — expressions, so events can branch.
- Optional console logging.
- The same evaluator, run once **after the first shadow selection pass** rather than at scene
  creation, produces the start-of-scene warnings (old section 2.5, now folded in here). Running it
  at creation would report "no slot" for every light, because selection has not happened yet.

Every wrong theory in the debugging session that produced these extensions — the light probes
guess, the radius-units guess, the bias guess, the aim guess — dies at check 6 or check 8.

### 2.2 Caster and light mobility — two properties, not one

The per-light `ShadowTechnique` dropdown asks the author to know that "SDF means static casters
only". That is renderer knowledge leaking into authoring. Mobility replaces it with a question about
content — but it takes **two** properties, because two different things can move:

- **Caster mobility** (on the mesh): can this geometry move or deform? This decides whether the SDF
  can represent it at all.
- **Light mobility** (on the light): can the light move, or change its shadow projection? This
  decides map invalidation and caching. `ShadowMapStatic` (`AdvancedLighting3D.runtime.js:397`) is
  already a crude version of exactly this.

Two states, not Unreal's three. `Stationary` earns its meaning from Lightmass and precomputed
shadow masks, neither of which exists here, so it would be a label with no mechanism behind it.
**Static** and **Movable** are enough.

The resolver must be **availability-aware**. "Static caster -> never needs a map" is wrong whenever
the SDF is absent, still baking, out of bounds, or incompatible:

    SDF ready AND every relevant caster represented in it  -> SDF
    else map available AND budget won                      -> ShadowMap
    else                                                   -> unshadowed, with a reason code

That last line is why 2.1 comes first: the fallback must be observable before the resolver is
allowed to choose it.

`ShadowTechnique` stays as an expert override — not for compatibility, which no longer applies, but
because forcing a specific method is genuinely useful when profiling.

### 2.3 Automatic SDF bounds — **SHIPPED**, AutoScene by default and guarded

> "I really dislike having to place a box around a cluster light to be able to have shadows"

The complaint is legitimate, but the obvious fix is the riskiest thing in this plan.

**It is not equivalent to Unreal's Global Distance Field.** Unreal generates per-mesh distance
fields **offline** and instances them; Epic states mesh distance field generation cannot be done at
runtime. A single AABB around every caster in a sparse level stretches a fixed-resolution grid until
its voxels are larger than the props, and the shadows become useless — while still costing a
surprise bake on first load.

Ship instead:

- `BoundsMode = AutoScene | Explicit`, **defaulting to `AutoScene`** (decided 2026-09-12). Placing
  a box by hand is the stated pain point, and defaulting to `Explicit` would leave it unsolved.
- Configurable padding and a **maximum extent**.
- The resulting voxel size reported **before** baking.
- Exceeding the quality threshold refuses to bake and reports why, through the 2.1 evaluator.
- **No camera-following rebake.** That is an architectural dead end without per-mesh fields or
  clipmapped regions.

Note also that "no `SDFVolume3D` exists" currently means there is no volume **record** at all:
`registerSDFVolume` hangs the volume off `behavior.__alSdfVolume`
(`AdvancedLighting3D.runtime.js:3585`) and `startSDFBake` refuses outright without one
(`:3761`). An implicit volume needs a full lifecycle — creation, bounds locking, disposal — not just
computed bounds.

**Decided: `AutoScene`.** It cannot regress a scene that already has a volume, and a scene without
one gets no SDF shadows *at all* today — so the only real risk is the surprise bake, which the
maximum-extent guard bounds. The guard and the voxel-size report are therefore not optional extras;
they are what makes this default safe.

This is also no longer a theoretical nicety. The reference project
(`My project3/The Hundred Acre..json`) has **zero** `SDFVolume3D` behaviors attached to any object,
so `startSDFBake` refuses, `hasSDF` never becomes true, and the SDF branch is never compiled into a
single shader. Every SDF setting in that project is inert. `AutoScene` is what makes the SDF path
reachable without the author knowing it needs a box.

### 2.4 Lighting quality presets — with explicit Custom semantics

The manager carries 16 prefixed properties. Unreal's answer is **scalability groups**.

`LightingQuality = Low | Medium | High | Ultra | Custom`, default `High`.

The semantics must be explicit, because serialized numeric properties cannot tell you whether the
author deliberately edited them:

- A preset value **ignores** the serialized detail fields and computes the effective settings.
- `Custom` uses the individual fields.
- If the editor API allows it, offer "copy current preset into Custom" so tweaking from a preset
  does not mean retyping 16 numbers.

Per-light overrides — map size in particular — stay regardless. Scalability supplies defaults and
broad adjustment; it does not abolish local tuning.

## 2.6 Shipped in this pass

- `diagnoseLightShadow` returns `{code, ok, message}`; codes are stable, messages are not.
- Events surface: `Explain shadows in the console` (whole scene), `Explain this light shadow`,
  `Shadow reason code` and `Shadow report` expressions, `Is actually casting a shadow` condition,
  `Lights actually casting shadows` count.
- Start-of-scene validation runs the same evaluator once **after** the first selection pass, and
  stays quiet about deliberate choices (`Off`, `Native`, technique `None`, `CastShadows` off).
- `SDFBoundsMode` = `AutoScene` (default) | `Explicit`, with `SDFAutoPadding` (200) and
  `SDFMaxAutoExtent` (20000). An `SDFVolume3D` you place always wins over the automatic fit.
- The fit reports its resulting voxel size **before** baking, and refuses with an actionable message
  past the extent limit rather than baking something useless.
- Removed `sdfInflate`, a state field that was never read — the real dilation is a hardcoded 0.5 in
  the bake. It looked like a tuning knob and was not one.

Not done, and deliberately: no camera-following rebake, and no re-fit after the first one.

## 3. Order

1. ~~**2.1** — shared status evaluator~~ **DONE**.
2. `DEMAND_DRIVEN_SHADOWS_PLAN.md` sections 5.1-5.3 (arming). Its demand predicate should be
   written so 2.2 can replace it later without restructuring.
3. **2.4** — quality presets with explicit `Custom` semantics.
4. **2.2** — caster and light mobility, and the availability-aware resolver.
5. ~~**2.3** — automatic SDF bounds with cost guards~~ **DONE**.
6. ~~Validation warnings~~ **DONE**, as the 2.1 evaluator run after the first selection pass.

Remaining: arming (2 above), quality presets (3), mobility (4).

## 4. Deliberately not borrowed

- **Lightmaps / Lightmass.** Baked lightmaps need per-asset UV unwrapping and an offline bake stage.
  GDevelop has no asset pipeline step to hang that on, and the probe volume already covers the cheap
  end of baked indirect.
- **Virtual Shadow Maps.** Page residency needs compute shaders and an indirection texture; WebGL2
  has no compute. The caching already implemented captures the useful part at whole-map granularity.
- **Lumen.** Needs hardware ray tracing, or a global distance field plus heavy temporal
  accumulation. Already deferred in `docs/RENDERER-MODERNIZATION-PLAN.md` section 8.

## 5. Note on compatibility

There are no shipped games using these extensions, so backwards compatibility is **not** a design
constraint. Any reasoning in these plans that rested on "existing project JSONs would break" is
void — the combined shadow mode enum was collapsed to `Auto`/`Off`/`Native` on exactly that basis.
`ShadowTechnique` survives on its own merit as a profiling override, not for compatibility.
