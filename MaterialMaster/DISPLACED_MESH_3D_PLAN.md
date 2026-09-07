# Integrate Displaced Mesh 3D into Material 3D

## Goal

Add a focused geometry behavior named **`DisplacedMesh3D`** (**Displaced Mesh 3D**) to the
Material3D extension suite. It creates real vertex displacement while preserving Material 3D's
single-owner architecture:

- **Material 3D Core** remains the sole owner of `mesh.material`.
- **Displaced Mesh 3D** becomes the sole owner of its cloned/rebuilt `mesh.geometry`.
- **Tiled Custom Pattern Material 3D** supplies a neutral, shared pattern recipe.
- Neither behavior reaches into another generated behavior's private fields.

The first release targets reliable static geometry. It allows procedural brick, tile, grid, dots,
hexagons, and Voronoi patterns to raise surface regions and sink gaps, and provides a general
geological-weathering mode using layered noise, terraces, edge erosion, and inexpensive
height-derived cavity shading.

The purpose is to produce many visually distinct, high-detail surfaces from a small texture set—or
no texture set—without generating a unique large texture pack for every material.

---

## Scope

### Supported in the first release

- `Scene3D::Cube3DObject`, rebuilt with subdivided `THREE.BoxGeometry`.
- Known static Polygon3D geometries, including `HexBipyramid3D` and
  `RhombicDodecahedron3D`, when their geometry is compatible.
- Static `THREE.Mesh` model parts that already contain sufficient vertex density.
- Indexed and non-indexed static `BufferGeometry`, provided required position and normal
  attributes exist.
- Multiple mesh children and multiple material slots without changing material ownership.
- Pattern-driven, geological, noise-only, and hybrid displacement.
- Full restoration of the exact original geometry reference when the behavior is removed.

### Explicitly unsupported in the first release

- Automatic subdivision of arbitrary imported models.
- `SkinnedMesh`, bones, or skinning attributes.
- Morph targets.
- `InstancedMesh` geometry mutation.
- Updating GDevelop collision geometry or physics collision shapes.
- Runtime deformation every frame.
- True baked ambient occlusion or topology-aware curvature simulation.

Unsupported geometry is skipped and reported through diagnostics. It is never partially mutated.

---

## Performance model

Subdivision must be controlled by both detail and total geometry cost.

For a box with `N` segments on each face:

- approximate vertices: `6 × (N + 1)²`;
- triangles: `12 × N²`.

Examples:

| Segments | Approx. vertices | Triangles |
| ---: | ---: | ---: |
| 8 | 486 | 768 |
| 12 | 1,014 | 1,728 |
| 16 | 1,734 | 3,072 |
| 24 | 3,750 | 6,912 |
| 32 | 6,534 | 12,288 |

Safety rules:

1. `Subdivision` is clamped from 1 to 32.
2. `MaxVerticesPerObject` defaults to 20,000 and caps the total across all affected meshes.
3. Rebuilds are queued and coalesced so multiple setters produce at most one rebuild.
4. Expensive changes default to **Manual rebuild** at runtime.
5. No geometry allocation occurs during the per-frame path.
6. Geometry is cloned per behavior instance before mutation; shared source geometry is never
   modified.
7. Diagnostics expose vertex and triangle counts before users multiply the object across a scene.

---

## Architecture

### Ownership contract

```text
Material 3D Core
  owns material cloning, replacement, restoration, and disposal

Displaced Mesh 3D
  owns geometry cloning/replacement, deformation, restoration, and disposal

Tiled Custom Pattern Material 3D
  owns the pattern recipe and shader presentation

Pattern Math 3D
  neutral shared evaluator used by Pattern Material and Displaced Mesh
```

`DisplacedMesh3D` may register status with `MaterialController3D`, but it is not a material
contributor and may never assign or dispose `mesh.material`.

### Geometry ownership registry

Add a small `GeometryController3D` service keyed by the root `THREE.Object3D`. For each affected
mesh it stores:

```js
{
  mesh,
  originalGeometry,
  workingGeometry,
  basePositions,
  baseNormals,
  generation
}
```

Required behavior:

- reject a second geometry-owning behavior on the same mesh with a visible diagnostic;
- preserve the exact original geometry reference;
- dispose only the working geometry it created;
- restore before releasing ownership;
- resolve live meshes again during rebuilds instead of trusting stale references;
- tolerate object/mesh destruction without throwing.

### Shared pattern mathematics

Create `PatternMath3D.runtime.js` and expose `gdjs.__patternMath3D`.

It provides:

```js
normalizeRecipe(rawRecipe)
evalPattern(u, v, normalizedRecipe)
hash2(x, y, seed)
valueNoise2(x, y, seed)
```

`evalPattern` returns:

```js
{
  fill,       // 0 gap/border, 1 surface
  edge,       // anti-aliased transition amount
  surface,    // signed displacement mask
  variation   // deterministic per-cell/noise variation
}
```

Signed displacement is defined clearly:

- gap/mortar region: `-1`;
- transition: `-1..0`;
- main surface: `0..1`;
- `PatternDepth` controls inward displacement;
- `PatternRaise` controls outward displacement.

The JS and GLSL implementations use the same constants and algorithm definitions. A conformance
fixture samples a fixed UV/seed matrix and compares CPU results with expected reference values.
Actual GPU parity is verified separately in the real-engine harness.

---

## Displacement modes

### Pattern Driven

Reads the normalized recipe published by Tiled Custom Pattern Material on the same root object. If
that behavior is absent, it uses the Displaced Mesh behavior's fallback pattern type, scale, seed,
gap, and softness properties.

Vertices move along their pristine base normals:

```text
offset = surfaceRegion × PatternRaise - gapRegion × PatternDepth
position = basePosition + baseNormal × offset
```

Repeated rebuilds always start from cached pristine positions and never compound displacement.

### Geological Weathering

Uses deterministic 3D fractal value/simplex noise with:

- configurable octave count;
- frequency and lacunarity;
- amplitude and persistence;
- horizontal sedimentary terraces;
- controllable terrace sharpness;
- edge/corner rounding and seeded chipping;
- high-frequency micro-pitting.

The preset is called **Geological Weathering**, not after a commercial game.

### Custom Noise

Applies only the layered noise and optional terraces. This is the predictable general-purpose mode.

### Hybrid

Combines pattern displacement with geological variation:

```text
finalOffset = patternOffset + geologicalOffset
```

Every component is independently clamped so an extreme combination cannot invert or explode the
mesh unintentionally.

---

## Edge erosion

For generated boxes, use known face-local coordinates to calculate distance from each face edge.
Apply rounding and chipping before normal recomputation. Duplicate vertices on separate cube faces
must receive compatible displacement at shared corners to avoid cracks.

For arbitrary static model geometry, true corner distance is unavailable without expensive
topology processing. First release behavior:

- use normal/position-based erosion only when a reliable generated-geometry adapter exists;
- otherwise disable `CornerErosion` for that mesh and report the limitation;
- never claim general-purpose topology-aware erosion.

---

## Cavity shading

Use the name **Crevice Shading**, not ambient occlusion, because the first release does not perform
light transport or topology-aware AO.

Compute a stable approximation from displacement height, slope, and local pattern gap values. Write
the result to `geometry.attributes.color` only when `CreviceShading > 0`.

Material Core must receive a controller request to enable `material.vertexColors` on exact target
materials. Displaced Mesh must not modify the material directly. Removing the behavior restores the
previous vertex-color requirement.

Future work may add adjacency-based curvature after seam welding and topology validation.

---

## Behavior declaration

### Identity

- Internal name: `DisplacedMesh3D`
- Editor name: **Displaced Mesh 3D**
- Object type: unrestricted, with runtime compatibility validation

### Properties

#### General

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| Enabled | Boolean | `true` | Restores original geometry when disabled. |
| DisplacementMode | Choice | `Hybrid` | Pattern Driven, Geological Weathering, Custom Noise, Hybrid. |
| UpdateMode | Choice | `On creation` | On creation, On property change, Manual. |
| IncludeChildren | Boolean | `true` | Traverse compatible child meshes. |
| Seed | Number | `1` | `0` derives a stable per-instance seed; it does not change every rebuild. |

#### Geometry budget

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| SubdivideCubes | Boolean | `true` | Only generated cube adapters are rebuilt. |
| Subdivision | Number | `12` | Integer, clamped 1–32. |
| MaxVerticesPerObject | Number | `20000` | Hard total budget across affected meshes. |
| PreserveSharpEdges | Boolean | `true` | Avoid smoothing intended hard boundaries. |

#### Pattern displacement

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| PatternDepth | Number | `0.08` | Inward gap depth in local units. |
| PatternRaise | Number | `0.02` | Outward surface height in local units. |
| **superseded** — the Fallback* set was removed; use PatternType / ScaleX / ScaleY / GapWidth / EdgeSoftness. |||
| FallbackPattern | Choice | `Brick` | Used only when Pattern Material is absent. |
| FallbackScaleX | Number | `8` | Fallback recipe scale. |
| FallbackScaleY | Number | `8` | Fallback recipe scale. |
| FallbackGapWidth | Number | `0.06` | Fallback gap width. |
| FallbackEdgeSoftness | Number | `0.02` | Fallback edge transition. |

#### Geological displacement

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| RoughnessStrength | Number | `0.15` | Maximum geological displacement in local units. |
| NoiseFrequency | Number | `2` | Base spatial frequency. |
| NoiseOctaves | Number | `4` | Integer, clamped 1–6. |
| NoisePersistence | Number | `0.5` | Amplitude reduction per octave. |
| NoiseLacunarity | Number | `2` | Frequency increase per octave. |
| TerraceLayers | Number | `4` | Integer; `0` disables terraces. |
| TerraceSharpness | Number | `0.6` | Smooth-to-stepped terrace transition. |
| CornerErosion | Number | `0.35` | Adapter-dependent edge rounding/chipping. |
| MicroPitting | Number | `0.05` | High-frequency detail strength. |
| CreviceShading | Number | `0.5` | Vertex-color crevice darkening, 0–1. |

All displacement strengths are mesh-local units. Documentation must not label them as meters.

---

## Actions

Every public property receives a matching setter. Additionally expose:

- `RandomizeSeed`
- `RebuildMesh`
- `ResetToOriginal`
- `CaptureCurrentAsBase`

Setter behavior:

- **On creation:** setters mark dirty but do not automatically perform expensive topology changes.
- **On property change:** setters queue one coalesced rebuild.
- **Manual:** setters only mark dirty until `RebuildMesh` is called.

`CaptureCurrentAsBase` is explicit because it changes what Reset restores to. It must never happen
implicitly.

---

## Conditions and expressions

### Conditions

- `IsReady`
- `IsMeshDisplaced`
- `HasPendingRebuild`
- `IsBudgetExceeded`
- `HasUnsupportedMeshes`

### Expressions

- `State()`
- `LastError()`
- `Seed()`
- `Subdivision()`
- `AffectedMeshCount()`
- `SkippedMeshCount()`
- `VertexCount()`
- `TriangleCount()`
- `EstimatedGeometryBytes()`

States:

```text
Uninitialized
WaitingForRenderer
Ready
Dirty
BudgetExceeded
UnsupportedGeometry
Failed
```

---

## Runtime workflow

### Initial synchronization

1. Resolve the root `THREE.Object3D`.
2. Traverse candidate meshes according to `IncludeChildren`.
3. Validate geometry and reject unsupported mesh classes.
4. Estimate the complete vertex/triangle budget before allocating anything.
5. Abort atomically if the budget would be exceeded.
6. Acquire geometry ownership for every compatible mesh.
7. Clone or rebuild geometry through the appropriate adapter.
8. Cache pristine positions and normals.
9. Evaluate displacement from pristine data.
10. Recompute normals and bounds.
11. Publish diagnostics and optional vertex-color requirement.

### Rebuild

1. Coalesce pending requests.
2. Re-read normalized parameters and shared pattern recipe.
3. If topology did not change, reuse existing buffers and reset positions from cached base data.
4. If topology changed, estimate the budget first, build new working geometry, then atomically swap.
5. Dispose the previous working geometry only after the replacement is successfully attached.
6. Recompute vertex normals, bounding box, and bounding sphere.
7. Mark only changed attributes as needing update.

### Disposal/reset

1. Restore each mesh's exact original geometry reference.
2. Release vertex-color requirements through the controller.
3. Dispose only working geometries owned by this behavior.
4. Clear cached arrays and ownership records.
5. Leave materials untouched.

---

## Files

### New

- `Material3D/PatternMath3D.runtime.js`
- `Material3D/GeometryController3D.runtime.js`
- `Material3D/DisplacedMesh3D.runtime.js`

### Modified

- `Material3D/PatternMaterial3D.runtime.js`
- `Material3D/MaterialController3D.runtime.js`
- `Material3D/build-extension.mjs`
- `Material3D/test-material3d.mjs`
- `Material3D/README.md`
- `Material3D/Material3D.json` (generated)

---

## Implementation phases

### Phase 1 — shared deterministic pattern math

1. Extract normalized recipe and CPU evaluator.
2. Preserve existing Pattern Material shader behavior.
3. Add fixed reference fixtures for every pattern type.
4. Publish recipe state through a neutral controller interface.

**Exit criterion:** existing Material3D tests pass and fixed CPU pattern samples are deterministic.

### Phase 2 — geometry ownership and static deformation

1. Implement `GeometryController3D`.
2. Clone supported static geometries.
3. Cache pristine positions/normals.
4. Implement reset, disposal, and conflict diagnostics.

**Exit criterion:** 100 deform/reset cycles return geometry counts and references to baseline.

### Phase 3 — cube subdivision adapter

1. Detect supported GDevelop cube geometry without relying only on object names.
2. Generate segmented `BoxGeometry` with preserved six-face groups and UV orientation.
3. Enforce whole-object vertex budget before allocation.
4. Test every segment boundary and all six material groups.

**Exit criterion:** subdivisions 1, 4, 12, 16, and 32 have correct counts, groups, UVs, bounds,
and disposal.

### Phase 4 — pattern displacement

1. Add Pattern Driven and fallback recipes.
2. Separate inward depth from outward raise.
3. Confirm face UV orientation and mortar alignment.
4. Add Pattern + Wet + Physical + BRDF composition tests.

**Exit criterion:** reference UV locations produce matching material regions and displaced regions.

### Phase 5 — geological modes

1. Add deterministic 3D multi-octave noise.
2. Add terraces and micro-pitting.
3. Add adapter-safe edge erosion.
4. Add Hybrid mode and displacement clamps.

**Exit criterion:** same seed/geometry/parameters produce byte-identical position buffers.

### Phase 6 — crevice shading and final integration

1. Generate optional vertex-color shading.
2. Coordinate the `vertexColors` material requirement through Core.
3. Add all actions, diagnostics, documentation, and manifest validation.
4. Run the real GDevelop/Three.js harness.

**Exit criterion:** all automated, lifecycle, resource, and visual tests pass.

---

## Automated verification

Add tests for:

1. deterministic pattern samples for all eight pattern modes;
2. cube vertex and triangle counts at multiple subdivision levels;
3. preservation of six material groups and face UVs;
4. atomic rejection when the vertex budget is exceeded;
5. no displacement accumulation over repeated rebuilds;
6. inward gap and outward surface displacement;
7. deterministic noise and terrace output;
8. safe unsupported-mesh reporting;
9. geometry ownership conflict rejection;
10. vertex-color creation and requirement removal;
11. exact original geometry restoration;
12. disposal exactly once per owned working geometry;
13. 100 rebuild/reset cycles with stable live-resource counts;
14. composition with every Material3D behavior;
15. no contributor runtime assignment to `mesh.material`;
16. no material runtime assignment to `mesh.geometry`.

---

## Real-engine verification

Create a dedicated harness scene containing:

- one subdivided cube showing all six faces;
- brick pattern with clearly aligned raised bricks and recessed mortar;
- hex and Voronoi pattern samples;
- geological rock samples at low and high subdivision;
- a compatible pre-tessellated static model;
- rejected skinned and low-density imported model examples;
- Core + Pattern + Displaced + Wet + Physical + BRDF composition;
- 25 repeated displaced objects for a basic frame-time and memory check.

Verify:

- silhouettes, shadows, bounds, frustum culling, UV orientation, and material groups;
- no cracks at generated cube corners;
- no shader/material ownership regression;
- no growth in geometry or texture counts after repeated create/destroy cycles;
- collision remains unchanged and is documented clearly.

---

## Definition of done

The integration is complete only when:

1. Material Core remains the only material owner.
2. Displaced Mesh is the only owner of its working geometry.
3. Pattern and geometry use a neutral shared recipe contract.
4. Pattern displacement aligns visually with the shader on every supported face.
5. Rebuilds never compound deformation.
6. Unsupported geometry fails visibly and without mutation.
7. Vertex and triangle budgets are enforced before allocation.
8. Original geometry is restored exactly and owned geometry is disposed exactly once.
9. Existing Material3D tests continue to pass.
10. New unit, lifecycle, resource, composition, and real-engine visual tests pass.
11. Collision limitations and supported mesh types are documented in the editor-facing behavior.

---

## Future extensions

After the static first release is stable:

- optional topology-aware subdivision for validated imported meshes;
- welded adjacency and true curvature-derived masks;
- GPU vertex displacement for animated visuals, explicitly render-only;
- parallax/normal derivation from the same pattern height field;
- displacement baking/export tooling;
- an optional collision-rebuild integration if GDevelop exposes a safe supported API.
