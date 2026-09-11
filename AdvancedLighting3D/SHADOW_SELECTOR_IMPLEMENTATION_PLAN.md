# AdvancedLighting3D — Shadow Selector and Hybrid CSM/SDF Plan

## Status

Design approved for an unpublished extension. There are no compatibility constraints. The default
shadow mode will be **Hybrid (CSM + SDF)**.

The existing `CascadedShadowMaps3D` documents remain the mathematical and API reference for the CSM
half. This plan defines how CSM becomes part of `AdvancedLighting3D` without creating a second
extension or a competing material hook.

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
- `EnableContactShadows`: `true`
- `ContactShadowStrength`: `0.35`

Only one manager is active per scene. A second instance reports a clear diagnostic and remains idle.
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
lighting, tune contact-shadow strength, and restore all original scene state when switching modes.

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
