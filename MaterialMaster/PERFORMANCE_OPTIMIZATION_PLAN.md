# MaterialMaster Performance Optimization Plan

## Objective

Make MaterialMaster safe for projects containing many material behaviors and displaced objects while
preserving its current appearance, behavior API, deterministic patterns, exact material targeting,
and resource-ownership rules.

The work is ordered by expected impact. The Displaced Mesh rebuild-loop correction is a release
blocker; later phases reduce recurring CPU work, allocation pressure, shader cost, and memory use.

---

## Current baseline

- Generated extension size: approximately 921 KiB.
- Automated tests: 312 passing.
- Core material behavior is mostly event-driven in its default mode.
- Physical, Wet, Pattern, and Animated behaviors perform unnecessary synchronization each frame.
- Displaced Mesh currently rebuilds geometry every frame in both `On creation` and
  `On property change` modes.

Performance changes must not weaken lifecycle, exact-slot targeting, shader-chain, or restoration
tests.

### Execution status

- [x] Correct Displaced Mesh update-mode semantics.
- [x] Coalesce property-change rebuilds.
- [x] Add rebuild timing/count diagnostics.
- [x] Replace static contributor sync loops with material-generation checks.
- [x] Cache Core target filtering per behavior and generation.
- [x] Cache anisotropy scans/writes per generation.
- [x] Reuse displacement offset, gap, color, and seam-cluster storage.
- [x] Add a 250,000-live-vertex global safety budget.
- [x] Make zero-strength Pattern Material inactive in the shader chain.
- [x] Add automated hot-path regression coverage.
- [ ] Add multiple shader quality tiers (requires real-GPU profiling to select useful variants).
- [ ] Establish cross-device GPU budgets in the real-engine harness.

---

## Phase 0 — add performance instrumentation

Add inexpensive internal counters that are enabled only in tests or diagnostic mode:

- material synchronizations;
- target resolutions;
- material rebuilds;
- shader rebuild requests;
- anisotropy scans and texture writes;
- geometry rebuilds;
- displaced vertices;
- temporary bytes allocated by a geometry rebuild;
- geometry normal/bounds recomputations.

Expose optional diagnostics:

- `GeometryRebuildCount()`
- `LastRebuildMilliseconds()`
- `LastDisplacedVertexCount()`
- `EstimatedGeometryBytes()`
- `MaterialGeneration()`

Do not call high-resolution timers per frame unless diagnostics are enabled.

### Exit criteria

- Tests can assert operation counts rather than only visual state.
- Instrumentation disabled by default has negligible runtime cost.

---

## Phase 1 — stop continuous geometry rebuilding

Correct `DisplacedMesh3D.sync()` so update modes mean:

| Mode | Rebuild behavior |
| --- | --- |
| On creation | Exactly once after a compatible renderer/mesh becomes available. |
| On property change | Once when dirty; multiple changes in one frame are coalesced. |
| Manual | Only `RebuildMesh` performs the rebuild. |

Required control flow:

```js
if (state.state === "Uninitialized" || state.state === "WaitingForRenderer") {
  return applyDeformation(behavior, object);
}

if (params.updateMode === "OnPropertyChange" && state.dirty) {
  return applyDeformation(behavior, object);
}

return true;
```

Additional requirements:

1. A property setter calls `markDirty()` but never causes multiple rebuilds during one event frame.
2. `RebuildMesh` remains an explicit immediate operation.
3. Changing subdivision is treated as a topology rebuild.
4. Changing only displacement parameters reuses existing topology.
5. Failed/budget-exceeded rebuilds retain the last valid working geometry.
6. Waiting states retry with a small bounded cadence instead of heavy work every frame.

### Tests

- Run 120 ticks in `On creation`: rebuild count must remain 1.
- Change ten properties in one frame in `On property change`: rebuild count increases by 1.
- Run 120 ticks in `Manual`: rebuild count remains 0 until `RebuildMesh`.
- A renderer appearing late produces exactly one successful rebuild.

### Exit criteria

- No unchanged displaced object performs vertex/noise/normal/bounds work after initialization.
- This phase ships before any other performance enhancement.

---

## Phase 2 — introduce contributor dirty/version tracking

Physical, Wet, Pattern, BRDF, and Animated behaviors should synchronize only when one of these
versions changes:

- behavior property version;
- Core material generation;
- target-selection version;
- renderer/root identity;
- relevant shared dependency version, such as the active pattern recipe.

Each contributor state receives:

```js
{
  dirty,
  propertyVersion,
  appliedPropertyVersion,
  appliedMaterialGeneration,
  appliedTargetSignature
}
```

All public setters increment `propertyVersion` and set `dirty = true`.

The frame hook performs only integer/reference comparisons when nothing changed. It must not parse
colors, allocate objects, resolve targets, traverse meshes, or rewrite material fields.

### Per-behavior policy

- **Physical:** apply on property or material-generation change.
- **Wet:** apply on wet-property or material-generation change. Later animated wetness should use a
  dedicated numeric update path.
- **Pattern:** update uniforms on property change; reattach only on material-generation or target
  change.
- **BRDF:** update uniforms on property change; request shader recompilation only when source-
  structural state changes.
- **Animated:** perform setup on property/material-generation change; retain a minimal animation
  tick for scrolling, flipbooks, and video only.

### Exit criteria

- 1,000 unchanged ticks cause zero target resolutions and zero material writes for static
  contributors.
- Animated ticks touch only active animated textures and counters.

---

## Phase 3 — cache targeting and anisotropy

### Target caching

Create a target signature from:

- Core material generation;
- target mode;
- material index/name;
- mesh name;
- include-children selection.

Reuse the resolved target array while this signature is unchanged. Invalidate it when Core commits
new targets or a targeting setter changes.

### Anisotropy caching

Make anisotropy a controller-level requested state rather than something every contributor scans
independently.

For each root store:

```js
{
  requestedAnisotropy,
  appliedAnisotropy,
  appliedGeneration
}
```

Only rescan texture slots when:

- requested anisotropy changes;
- material generation changes;
- a texture map changes;
- Animated Material creates a new texture clone/video texture.

Do not set `texture.needsUpdate` when its anisotropy already equals the requested value.

### Exit criteria

- Multiple behaviors requesting the same anisotropy produce one scan per material generation.
- An unchanged 60-second scene produces no repeated anisotropy writes.

---

## Phase 4 — optimize Displaced Mesh allocations

Store topology-dependent work in the geometry ownership record:

- `rawOffsets` typed array;
- `gapFactors` typed array;
- reusable vertex-color array;
- seam clusters;
- box face-local edge distances;
- base position and normal arrays;
- topology signature.

Rebuild these caches only when geometry topology or subdivision changes.

### Required changes

1. Reuse `Float32Array` buffers instead of allocating them every deformation pass.
2. Reuse the existing color `BufferAttribute`; update its array in place.
3. Build seam clusters once per topology instead of creating a `Map` every rebuild.
4. Precompute per-vertex box edge distance.
5. Avoid recomputing normals when displacement strength is zero or the final position buffer is
   unchanged.
6. Recompute bounds only after a successful position change.
7. Preserve a fast reset path using `TypedArray.set(basePositions)`.
8. Replace string seam keys with quantized numeric/spatial-hash keys where safe.

### Exit criteria

- Rebuilding unchanged topology allocates no vertex-count-proportional temporary arrays.
- A 100-cycle rebuild test shows stable heap/resource counts.

---

## Phase 5 — geometry budgets and scheduling

Keep the per-object `MaxVerticesPerObject` limit and add a scene-level controller budget:

- maximum live displaced vertices;
- maximum live displaced geometry bytes;
- maximum geometry rebuilds per frame;
- optional maximum rebuild milliseconds per frame.

Recommended defaults:

- Per object: 20,000 vertices.
- Scene warning: 250,000 displaced vertices.
- Scene hard cap: configurable; disabled only by explicit user choice.
- Rebuild scheduling: one large or several small rebuilds per frame.

Budget checking occurs before geometry allocation. A rejected rebuild leaves the previous valid
geometry attached.

### Optional distance-based detail

Add later, not in the first optimization pass:

- High/Medium/Low subdivision presets selected at creation.
- Manual `RebuildAtSubdivision` action.
- No automatic continuous LOD geometry rebuilding.

### Exit criteria

- Creating many objects cannot allocate beyond the configured scene budget without a diagnostic.
- Scheduled rebuilds do not produce an unbounded single-frame queue.

---

## Phase 6 — optimize procedural shaders

### Pattern shader

Add a quality property:

| Quality | Behavior |
| --- | --- |
| Low | Simplified hash; no continuous value noise. |
| Medium | Current standard patterns and one value-noise sample. |
| High | Voronoi and enhanced procedural variation. |

Additional rules:

1. `Enabled = false` or `Strength = 0` removes the pattern injector from the active set.
2. Avoid evaluating noise when variation/noise strength is zero.
3. Provide a lightweight shader path for Solid, Checker, Grid, and Stripes.
4. Consider structural cache-key variants for simple versus Voronoi shaders so unused expensive
   code can be compiled out.
5. Keep ordinary color, saturation, tint, scale, and seed changes uniform-only.

### BRDF shader

- Keep uniform-only changes recompilation-free.
- Consider compiling only the selected BRDF family if profiling shows the current unified library
  harms mobile drivers.
- Retain shader-chain ordering and honest injector diagnostics.

### Physical material guidance

- Keep transmission opt-in.
- Document transmission and large transparent surfaces as high-cost.
- Change the general anisotropy default to 8×, with 16× reserved for high-quality/hero assets.

### Exit criteria

- Disabled/zero-strength Pattern Material adds no fragment shader work.
- Low quality materially reduces shader time on the target low-end GPU.

---

## Phase 7 — extension size and generated-code cleanup

The approximately 921 KiB JSON is acceptable, but generated inline code should be audited for
unnecessary duplication.

Actions:

1. Confirm each shared runtime is embedded only where initialization requires it.
2. Remove stale compatibility/runtime branches that cannot be reached in the current version.
3. Keep source readable; do not minify the authored runtime merely to reduce repository size.
4. Measure exported game JavaScript separately from extension JSON size.
5. Record raw and compressed export-size changes before and after optimization.

### Exit criteria

- No duplicate runtime initialization blocks in the exported game bundle where avoidable.
- Size work does not compromise debugging or shader diagnostics.

---

## Benchmark matrix

Use the real GDevelop/Three.js harness. Measure CPU frame time, GPU frame time where available,
heap, renderer geometry/texture/program counts, and worst-frame spikes.

### Scene A — static materials

- 1, 100, 500 objects.
- Core only.
- Core + Physical.
- Core + Wet.
- Core + Pattern using Brick.
- Core + Pattern using Voronoi.

### Scene B — animation

- 1, 50, 200 scrolling objects.
- 1, 50, 200 flipbooks.
- 1, 10, 25 video materials.

### Scene C — displacement

- 1, 25, 100 cubes.
- Subdivision 8, 12, 16, and 32.
- Pattern Driven, Geological Weathering, and Hybrid.
- Initial creation spike.
- Unchanged 10-second runtime.
- Batched property changes.
- Destroy/recreate cycles.

### Scene D — composition

- Core + Pattern + Displaced + Wet.
- Core + Physical + Pattern + BRDF.
- All behaviors together on 25 objects.

### Target budgets

Establish separate desktop and lower-end targets. Initial recommended goals:

- Unchanged static contributors: less than 0.1 ms total CPU per frame for 100 objects.
- No geometry rebuild activity after initialization.
- A default subdivision-12 cube rebuild: target below 2 ms on reference desktop hardware.
- No individual scheduled rebuild frame above 8 ms on reference desktop hardware.
- Stable renderer geometry/texture/program counts after 100 create/destroy cycles.
- No sustained garbage-collection spikes from material or displacement updates.

These values must be recorded with hardware/browser details and adjusted from measured evidence.

---

## Regression tests

Add tests proving:

1. `On creation` displacement rebuilds exactly once.
2. Property changes are coalesced.
3. Manual mode never rebuilds implicitly.
4. Static contributors do not resolve targets on unchanged ticks.
5. Core generation changes reattach every contributor exactly once.
6. Uniform-only changes do not replace materials or compile new shader variants.
7. Anisotropy changes scan once and unchanged values scan zero times.
8. Displacement topology caches survive parameter-only rebuilds.
9. Typed arrays and color attributes are reused.
10. Disabled pattern shaders are absent from the active injector set.
11. Geometry/material/texture/program counts return to baseline after lifecycle stress.
12. Existing visual output and deterministic pattern fixtures remain unchanged.

---

## Implementation order

1. Add counters and failing hot-path tests.
2. Fix Displaced Mesh update-mode semantics.
3. Add contributor dirty/generation tracking.
4. Centralize target and anisotropy caching.
5. Cache Displaced Mesh topology and typed arrays.
6. Add scene budgets and rebuild scheduling.
7. Add pattern shader quality/zero-cost disabled paths.
8. Run real-engine benchmarks and tune defaults.
9. Audit generated size and update documentation.

Do not combine all phases into one unmeasured rewrite. Record the benchmark delta after each phase
so regressions can be isolated.

---

## Definition of done

Performance work is complete when:

1. Displaced Mesh performs no repeated work while unchanged.
2. Static material contributors perform no target traversal or material writes while unchanged.
3. Animated Material's frame path touches only active animation/video state.
4. Anisotropy and target resolution are cached and correctly invalidated.
5. Displacement rebuilds reuse topology-dependent arrays and seam data.
6. Per-object and scene-wide geometry budgets are enforced before allocation.
7. Disabled procedural effects add no shader work.
8. Lifecycle stress produces stable material, texture, geometry, and shader-program counts.
9. All existing and new regression tests pass.
10. Real-engine benchmark results meet the documented desktop and lower-end budgets.
