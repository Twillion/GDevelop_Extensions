# AdvancedLighting3D — Shadow Selector and Hybrid CSM/SDF Plan

## Status

Runtime implementation and automated Three.js r160 / software-WebGL validation are now present. Real GDevelop editor/export acceptance and hardware performance gates below remain pending. Cascade lights have zero intensity and supply only maps; the native Sun remains the sole radiance source. Unimplemented contact-shadow controls were removed from the extension API in 4.1.0.

Design approved for an unpublished extension. There are no compatibility constraints. The default
shadow mode will be **Hybrid (CSM + SDF)**.

The former `CascadedShadowMaps3D` folder has been deleted; its mathematical and API reference is
folded into **Appendix A** of this document, which is now the single source of truth for the CSM
half. This plan defines how CSM becomes part of `AdvancedLighting3D` without creating a second
extension or a competing material hook.

## 0. Companion plan — local-light shadow maps

CSM serves the Sun; the SDF serves local lights. Neither can give a spot light a shadow from a
*moving* caster, and the SDF additionally requires an authored bounds cube before any local shadow
exists at all. A third source — real depth maps for clustered spot and point lights — is specified
in [LOCAL_SHADOW_MAPS_PLAN.md](LOCAL_SHADOW_MAPS_PLAN.md), which adds the `Maps` and `MapsSDF` modes
to the table in §5 here. The selector, ownership rules and single-material-hook constraint below
govern it unchanged.

## 1. Goal

Add one scene-wide shadow selector with four modes:

| Mode | Directional Sun | Dynamic objects | Clustered point/spot lights | Static world |
| --- | --- | --- | --- | --- |
| `Off` | None | None | None | None |
| `CSM` | CSM | CSM casters | No SDF shadows | CSM receivers/casters |
| `SDF` | SDF raymarch | Receive only | SDF raymarch | SDF volume |
| `Hybrid` | CSM | CSM casters | SDF raymarch | CSM near camera, SDF for local lights |

`Hybrid` is the default because it covers the two gaps that neither technique solves alone:

- CSM follows the camera and renders moving characters, vehicles, foliage, and props.
- SDF provides soft static-world occlusion for many clustered local lights without one shadow-map
  render pass per light.

## 2. Ownership rules

Only one subsystem may shadow a given light contribution.

1. The directional Sun uses CSM in `CSM` and `Hybrid` modes.
2. The directional Sun uses SDF only in `SDF` mode.
3. Clustered point, spot, and area-capsule lights use SDF in `SDF` and `Hybrid` modes.
4. Clustered lights are unshadowed in `CSM` mode because CSM applies only to directional light.
5. Contact micro-shadows are a separate finishing feature. They may be enabled in any non-`Off`
   mode, but their strength must be capped in `Hybrid` so they do not visibly darken an existing CSM
   contact edge twice.
6. GDevelop's original directional Sun must be disabled or excluded while the CSM Sun is active;
   otherwise direct light is added more than once.

## 3. Public API

### Scene action

`SetShadowMode(Mode)` with a string selector containing exactly:

- `Off`
- `CSM`
- `SDF`
- `Hybrid`

### Scene condition and expression

- `ShadowModeIs(Mode)`
- `ShadowMode()` returning the current canonical mode
- `IsCSMActive()`
- `IsSDFShadowsEnabled()` remains available but reports effective state, not merely the last toggle

### CSM controls

- `SetCSMCascadeCount(Count)` — clamp to 2–4, default 3
- `SetCSMMaxDistance(Distance)` — world units, default 25000 (250 m)
- `SetCSMSplitLambda(Lambda)` — clamp to 0–1, default 0.75
- `SetCSMShadowMapSize(Size)` — selector: 1024, 2048, 4096; default 2048
- `SetCSMBias(ConstantBias, NormalBias)`
- `SetCSMSeamBlendWidth(Width)` — clamp to 0–0.25, default 0.10
- `SetCSMSoftness(Radius)`
- `SetCSMSunDirection(X, Y, Z)`

Matching expressions expose cascade count, maximum distance, split lambda, map size, and the split
distance for a requested cascade. `IsCSMActive()` must return false until its lights, shader defines,
and shadow maps are ready.

### Inspector configuration

Add a scene-level `AdvancedShadowManager3D` behavior. It can be attached to one empty 3D object and
owns these properties:

- `ShadowMode`: `Hybrid` by default
- `CascadeCount`: `3`
- `MaxShadowDistance`: `25000`
- `SplitLambda`: `0.75`
- `ShadowMapSize`: `2048`
- `ConstantBias`: `0.0005`
- `NormalBias`: `0.02`
- `SeamBlendWidth`: `0.10`
- `CSMSoftness`: `1.5`
- Contact-shadow controls are omitted until a real screen-space pass exists.

Only one manager is active per scene. Additional instances wait in registration order and the next one takes over when the owner is destroyed.
The free action API still works without a manager by creating scene state with the defaults.

## 4. Runtime architecture

### One material hook

CSM must join the existing `AdvancedLighting3D` `onBeforeCompile` chain. It must not install its own
global `ShaderChunk` override or replace `material.onBeforeCompile` independently. The generated
program key must include the active feature set:

`GD_ADVLIGHT3D_V7|CL1|G3D<n>|LP<n>|SDF<n>|CSM<n>|C<n>|FADE<n>`

The hook adds:

- CSM cascade split uniforms
- the camera near and effective shadow-far uniforms
- CSM selection logic around Three.js's directional-light shadow sampling
- existing clustered lighting, probe, and SDF blocks after the native direct-light block

Changing cascade count requires material recompilation. Moving the camera, Sun, or split distances
updates uniforms and shadow cameras without recompiling.

### CSM scene state

Add a `csm` record to the existing per-scene state:

- normalized mode and requested settings
- 2–4 `THREE.DirectionalLight` instances and targets
- normalized cascade breaks and view-space split distances
- cached camera projection values
- frustum corners, light-space bounds, matrices, and vectors allocated once
- active/ready/error diagnostics
- original GDevelop Sun visibility/intensity state for restoration

Do not allocate shadow maps in `SDF` or `Off` mode. Dispose them immediately when leaving a CSM mode.

### Cascade fitting per frame

1. Clamp shadow far to `min(camera.far, MaxShadowDistance)`.
2. Calculate practical splits by blending uniform and logarithmic splits with `SplitLambda`.
3. Reconstruct the eight world-space corners for each sub-frustum.
4. Transform them into light space and fit a square orthographic bound.
5. Expand the depth range by the caster margin.
6. Snap the light-space center to shadow texel increments to prevent crawling.
7. Update each cascade light and target before Three renders its shadow pass.
8. Update split uniforms used to select and blend cascades in the fragment shader.

The calculation must honor GDevelop's mirrored Three.js Y root and its Z-up world convention. Tests
must cover both without hiding sign errors behind symmetric scenes.

## 5. Hybrid composition

In `Hybrid`, the Sun's direct-light term is evaluated once through CSM. The SDF shader must skip its
directional-Sun branch and remain available only for clustered local lights. Static geometry may
still cast through CSM near the camera; this is intentional because CSM supplies higher-frequency
detail. It is not a duplicate shadow contribution because the SDF Sun term is disabled.

Use a 10% blend band between adjacent cascades. The final cascade fades to unshadowed Sun over its
outer band instead of ending abruptly. SDF local-light shadows do not participate in this distance
blend.

## 6. Lifecycle

- On scene load: initialize shadow state with `Hybrid`; delay GPU allocation until a camera and Three
  scene are available.
- On manager creation: apply inspector properties and claim manager ownership.
- Before render/post-events: update CSM camera fits, shadow targets, and shader uniforms.
- On mode change: create or dispose CSM resources, update effective SDF flags, and invalidate affected
  materials once.
- On scene unload or hot reload: remove cascade lights and targets, dispose shadow maps, restore the
  original Sun, clear material CSM defines/uniform references, and unregister callbacks.

## 7. Implementation phases

### Phase 1 — Selector and state machine

Add canonical mode parsing, manager behavior, free actions/conditions/expressions, effective feature
flags, lifecycle transitions, diagnostics, and unit tests. No UI option may silently fall back to a
different shadow technique.

### Phase 2 — CSM cameras and resources

Create cascade lights, practical splits, world-frustum reconstruction, stable light-space fitting,
texel snapping, renderer shadow-map setup, and cleanup. Verify the shadow passes exist before adding
shader selection.

### Phase 3 — Shared shader integration

Add CSM defines, uniforms, cascade selection, seam blending, cache-key variants, and uniform refresh
to the existing material hook. Verify Standard and Physical materials and reject unsupported material
families with the current one-shot warning system.

### Phase 4 — Hybrid rules

Disable the SDF Sun term in Hybrid, retain SDF local-light shadows, prevent duplicate native Sun
lighting, honor authored mesh shadow flags, and restore owned renderer and Sun state when switching modes.

### Phase 5 — Editor and exported-game verification

Exercise mode switching in the scene editor, Preview, browser export, and desktop export. Profile
each map size and cascade count on representative scenes before documenting performance claims.

## 8. Required tests

### Unit tests

- all four selector values normalize and round-trip
- Hybrid is the initial mode
- effective CSM/SDF flags match the ownership table
- practical splits are ordered, bounded, and end at 1
- changing lambda changes interior splits but not the final split
- cascade bounds contain all eight sub-frustum corners
- snapped centers move only in whole texel increments
- cascade resources allocate and dispose exactly once per transition
- cache keys differ by CSM state, cascade count, and fade state
- leaving CSM restores the original Sun state
- scene teardown leaves no lights, targets, shadow maps, callbacks, or retained materials

### Real-engine scenarios

- walking character casts a moving shadow across all cascade boundaries
- camera translation and rotation show no visible shadow crawling
- transition bands have no hard seam or doubled darkness
- last cascade fades cleanly at maximum distance
- Hybrid Sun brightness matches CSM-only brightness
- SDF point lights remain shadowed in Hybrid
- moving objects do not leave SDF ghost shadows
- runtime switching among all four modes does not leak GPU resources or retain stale shaders
- two manager behaviors produce one owner and one diagnostic

### Performance gates

Record GPU frame time, shadow draw calls, and VRAM for 2/3/4 cascades at 1024/2048/4096. Do not claim
60 FPS from Node timing. Publish recommended presets only after measurements on desktop integrated
graphics, desktop discrete graphics, and one WebGL2 mobile device.

## 9. Completion criteria

The feature is complete when all selector modes produce visibly distinct and correct output, Hybrid
passes the ownership tests without double-shadowing, dynamic casters work under the Sun, existing SDF
local-light tests remain green, runtime mode switching is leak-free, and an exported GDevelop game
passes the real-engine scenario suite.

---

# Appendix A — CSM mathematical and API reference

Folded in from the deleted `CascadedShadowMaps3D/` blueprint (README, IMPLEMENTATION_PLAN,
API_REFERENCE). That folder no longer exists; this appendix supersedes it.

## A.0 Units

The source blueprint was written in meters. `AdvancedLighting3D` works in GDevelop's pixel-scale
world units at **100 units = 1 m**. Every distance below is given in world units with the original
meter value in parentheses. Do not copy a bare meter number out of the old prose into code.

## A.1 Practical split scheme

Cascade split distances over `[zNear, zMaxShadow]` blend a logarithmic and a uniform series:

$$z_i = \lambda \cdot z_{\text{near}} \left(\frac{z_{\text{max}}}{z_{\text{near}}}\right)^{\frac{i}{N}} + (1 - \lambda) \cdot \left(z_{\text{near}} + \frac{i}{N}(z_{\text{max}} - z_{\text{near}})\right)$$

- `N` = cascade count, clamped 2–4, default 3.
- `λ` = `SplitLambda`, clamped 0–1, default 0.75 (0 = uniform, 1 = logarithmic).

Worked example at `zNear = 10` (0.1 m), `zMax = 25000` (250 m), `N = 3`, `λ = 0.75`:

| Break | World units | Meters | Role |
| --- | ---: | ---: | --- |
| `z0` | 10 | 0.10 | near plane |
| `z1` | 1480 | 14.8 | cascade 0 — high-density micro-shadows |
| `z2` | 6240 | 62.4 | cascade 1 — mid-range props and trees |
| `z3` | 25000 | 250.0 | cascade 2 — distant terrain and horizon |

Splits must be ordered, bounded, and end exactly at `zMax`; changing `λ` moves interior breaks only.

## A.2 Sub-frustum tight fitting in light space

For each cascade `i`:

1. Take the 8 corners of the sub-frustum `[z_i, z_{i+1}]` in camera view space.
2. Unproject to world space via the camera world matrix.
3. Transform into light view space using the Sun's rotation matrix.
4. Fit the light-space AABB `[xMin, xMax, yMin, yMax, zMin, zMax]`.
5. Extrude the near plane backward by `CasterExtrusion` — default **5000** (50 m) — so casters
   standing behind the cascade boundary still render into the map.

Honor GDevelop's mirrored Three.js Y root and Z-up convention here; test with an asymmetric scene so
a sign error cannot hide.

## A.3 Light-space texel stabilization (snapping)

Fractional sub-texel movement of the orthographic origin is what makes shadow edges crawl and
shimmer. Snap the origin to whole world-texel increments:

$$\text{worldTexelSize} = \frac{x_{\text{max}} - x_{\text{min}}}{\text{shadowResolution}}$$

$$\Delta X = \left\lfloor \frac{x_{\text{min}}}{\text{worldTexelSize}} \right\rfloor \cdot \text{worldTexelSize} - x_{\text{min}}, \quad \Delta Y = \left\lfloor \frac{y_{\text{min}}}{\text{worldTexelSize}} \right\rfloor \cdot \text{worldTexelSize} - y_{\text{min}}$$

then offset both extents on each axis by its delta. The grid stays anchored to world space and edges
hold still under camera translation and rotation. This is the mechanism that replaces the separate
`StableShadowAnchor3D` blueprint.

## A.4 16-tap Poisson disk PCF

Hardware PCF is limited to 2×2. Filter with a stratified 16-tap Poisson kernel instead:

$$S(u, v) = \frac{1}{16} \sum_{k=0}^{15} \text{SampleShadowMap}\left((u, v) + \vec{P}_k \cdot \text{FilterRadius}, z_{\text{light}} - \text{Bias}\right)$$

First taps of the reference distribution (extend to 16):

```
P[0] = (-0.3262, -0.4058),  P[1] = (-0.8401, -0.0735),  P[2] = (-0.6959,  0.4571)
P[3] = (-0.2033,  0.6206),  P[4] = ( 0.9623, -0.1950),  P[5] = ( 0.4734, -0.4800)
```

`FilterRadius` (`CSMSoftness`) defaults to 1.5, useful range 0.5–4.0.

## A.5 Dithered cascade seam blending

Crossfade a band of width `w = SeamBlendWidth * z_{i+1}` (default 0.10) rather than stepping:

$$t = \text{smoothstep}(z_{i+1} - w, z_{i+1}, z_{\text{view}}), \quad \text{Shadow} = \text{mix}(\text{Shadow}_i, \text{Shadow}_{i+1}, t)$$

The last cascade fades to unshadowed Sun across its outer band instead of ending abruptly.

## A.6 Deferred screen-space contact-shadow design (not shipped)

Short depth-buffer raymarch from the fragment toward the light:

$$\vec{P}_{\text{step}} = \frac{\vec{L}_{\text{screen}} \cdot \text{RayLength}}{\text{Steps}}, \quad \vec{P}_{\text{sample}} = \vec{P}_{\text{screen}} + \vec{P}_{\text{step}} \cdot s, \quad s \in [1, \text{Steps}]$$

With `ΔZ = Z_sample - SampleLinearDepth(P_sample.xy)`, the ray is occluded when
`0.001 < ΔZ < Thickness`, giving a contact shadow factor of 0.

These values are retained only as design notes. The extension exposes no SSCS properties or actions.

> SSCS needs a readable scene depth texture. GDevelop's composer does not provide one by default —
> a `DepthTexture` must be attached to **both** ping-pong render targets or every depth read
> returns 0.0.

## A.7 Shadow atlas layout

Pack all 3–4 cascades into a single `THREE.DepthTexture` atlas (2048² or 4096²) rather than binding
one shadow sampler per cascade, to stay within WebGL texture-unit limits:

```
+------------------------+------------------------+
|  Cascade 0 (Near)      |  Cascade 1 (Mid)       |
|  [0.0,0.5] x [0.5,1.0] |  [0.5,1.0] x [0.5,1.0] |
+------------------------+------------------------+
|  Cascade 2 (Far)       |  Cascade 3 / Unused    |
|  [0.0,0.5] x [0.0,0.5] |  [0.5,1.0] x [0.0,0.5] |
+------------------------+------------------------+
```

Note the divergence from §4 of this plan: the integrated design uses 2–4 `THREE.DirectionalLight`
instances and lets Three allocate their shadow maps, which is simpler and keeps the native
directional shadow sampling path. Treat this atlas layout as the fallback to adopt only if texture
units become the binding constraint.

## A.8 Injected shader chunk

Reference sketch for the CSM block. It must be added to the **existing** `AdvancedLighting3D`
`onBeforeCompile` chain (§4) — never as a global `ShaderChunk` override or a second
`material.onBeforeCompile`.

```glsl
// --- CASCADED SHADOW MAP EVALUATION ---
#ifdef USE_CSM_SHADOWS
  float viewDepth = -vViewPosition.z;
  int cascadeIndex = 0;

  if (viewDepth > uCSMSplits[1]) {
    cascadeIndex = 2;
  } else if (viewDepth > uCSMSplits[0]) {
    cascadeIndex = 1;
  }

  vec4 shadowCoord = uCSMShadowMatrices[cascadeIndex] * vec4(vWorldPosition, 1.0);
  shadowCoord.xyz /= shadowCoord.w;

  // Slope-scale depth bias
  float cosTheta = clamp(dot(geometryNormal, uSunDirection), 0.0, 1.0);
  float bias = max(uSlopeScaleBias * (1.0 - cosTheta), uConstantBias);

  // 16-Tap Poisson Disk PCF
  float shadowFactor = 0.0;
  vec2 texelSize = vec2(1.0 / uShadowMapSize);

  for (int tap = 0; tap < 16; ++tap) {
    vec2 offset = uPoissonDisk[tap] * uShadowFilterRadius * texelSize;
    float depthSample = texture(uCSMShadowAtlas, shadowCoord.xy + offset).r;
    shadowFactor += (depthSample < shadowCoord.z - bias) ? 0.0 : 1.0;
  }
  shadowFactor *= 0.0625;

  #ifdef USE_SSCS
    shadowFactor *= evaluateContactShadow(gl_FragCoord.xy, vViewPosition, uSunDirectionView);
  #endif

  directDiffuse *= shadowFactor;
  directSpecular *= shadowFactor;
#endif
```

Cascade count is a compile-time variant and belongs in the program cache key
(`…|CSM<n>|…`, §4). Splits, matrices, and Sun direction are uniform updates and must not recompile.

## A.9 Parameter defaults

Blueprint behavior properties mapped onto the `AdvancedShadowManager3D` properties in §3:

| Blueprint property | Plan property | Default | Range |
| --- | --- | ---: | --- |
| `CascadeCount` | `CascadeCount` | 3 | 2–4 |
| `MaxShadowDistance` | `MaxShadowDistance` | 25000 (250 m) | — |
| `SplitLambda` | `SplitLambda` | 0.75 | 0–1 |
| `ShadowAtlasResolution` | `ShadowMapSize` | 2048 | 1024 / 2048 / 4096 |
| `CasterExtrusionDistance` | *(new)* `CasterExtrusion` | 5000 (50 m) | — |
| `StabilizeTexels` | always on (§A.3) | `true` | — |
| `FilterRadius` | `CSMSoftness` | 1.5 | 0.5–4.0 |
| `SeamBlendWidth` | `SeamBlendWidth` | 0.10 | 0–0.25 |
| `EnableSSCS` | Removed until implemented | — | — |
| `ContactRayLength` | Removed until implemented | — | — |
| `ContactRaySteps` | Removed until implemented | — | — |
| `ContactShadowIntensity` | Removed until implemented | — | — |
| `ConstantBias` | `ConstantBias` | 0.0005 | — |
| `SlopeScaleBias` | `NormalBias` | 0.02 | — |

The blueprint's per-object behavior ACEs (`Object.CascadedShadowMaps3D::CascadeSplit(index)` and
friends) are **not** carried over. CSM is scene-wide here, so the equivalents are the free
actions/conditions/expressions in §3. `TexelResolution(cascadeIndex)` is worth keeping as a scene
expression for tuning; it reports world units per shadow texel.

## A.10 Performance budgets

Targets inherited from the blueprint. They are unverified estimates, not measurements — §8 still
requires real hardware numbers before any of this is published as a claim.

| Subsystem | CPU budget | GPU budget | Memory |
| --- | ---: | ---: | --- |
| CPU frustum fitting and snapping | < 0.04 ms | — | 0 B per frame |
| Cascade depth passes (3 cascades) | < 0.02 ms | < 1.1 ms | one 2048² or 4096² depth atlas |
| PBR fragment evaluation (16-tap PCF) | — | < 0.4 ms | one fetch per tap |
| SSCS pass | — | < 0.5 ms | fullscreen depth read |
| **Total frame overhead** | **< 0.06 ms** | **< 2.0 ms** | target 60 FPS at 1080p/1440p |
