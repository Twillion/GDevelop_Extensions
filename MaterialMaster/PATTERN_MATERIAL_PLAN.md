# Tiled Custom Pattern Material 3D — architecture and implementation plan

**Behavior name:** `TiledCustomPatternMaterial3D`  
**Editor name:** **Tiled Custom Pattern Material 3D**  
**Purpose:** create many distinct, high-detail materials from a small library of reusable shapes,
noise functions, palettes, and optional packed textures.

The goal is not simply to disguise tiling. A material is a compact **recipe**: repeated structure,
per-cell variation, weathering, and micro-detail are evaluated together and drive color, height,
normal, roughness, metalness, and ambient occlusion. Two recipes may share every source texture and
still look materially different.

---

## 1. Product boundary

Tiled Custom Pattern Material 3D is an optional behavior in the Material3D extension. It depends on **Material 3D
Core**, which remains the only behavior allowed to clone, replace, restore, or dispose
`mesh.material`.

Tiled Custom Pattern Material 3D:

- applies an RGB overlay tint to the composed texture/pattern result;
- provides saturation control from grayscale (`0`) through normal (`1`) to boosted (`2`);

- registers one feature with the shared shader chain;
- owns recipe parameters and optional pattern-pack texture clones;
- never replaces a material;
- writes its feature state onto the Core-owned live materials;
- asks Core to reinstall/recompile the shader only when the recipe structure changes;
- updates uniforms without recompiling when ordinary values change.

This ownership rule is mandatory. Letting both behaviors replace materials would recreate the stale
references, lost patches, and disposal problems that the Material3D split is intended to solve.

### Relationship to other behaviors

| Behavior | Relationship |
| :--- | :--- |
| Material 3D Core | Required owner of targeting, material lifetime, maps, and render state. |
| Physical Material 3D | Consumes Pattern Material's roughness/metalness result normally. |
| BRDF Material | Runs first as base lighting; Pattern Material changes the surface inputs. |
| Wet Material 3D | Runs after the pattern result, so wetness affects the composed surface. |
| Animated Material 3D | May animate the base UV; pattern scale remains independently controllable. |
| Triplanar Material 3D | Optional coordinate provider; not part of the first release. |

Recommended shader-chain order: `brdf:100`, coordinate generation `250`, pattern material `420`,
wetness/ripples `500`, lighting additions `600+`.

---

## 2. The recipe model

A free-form node editor is the wrong first interface for GDevelop. It creates an unbounded shader
compiler, difficult serialization, and a property panel that is hard to understand. Version 1 uses
a fixed four-stage recipe whose stages are broad enough to generate useful families of materials.

```text
Coordinates
    |
    v
1. Structure -------- repeated cells and their borders
    |
    +--> cell id ---- deterministic variation per repeated shape
    v
2. Palette ---------- base/secondary/border colors and PBR ranges
    |
    v
3. Weathering ------- large noise, stains, cracks, dirt, wear
    |
    v
4. Micro detail ----- pores, grain, scratches, fine normal/roughness
    |
    v
Color + height + normal + roughness + metalness + AO
```

Every stage produces one reusable signal. The signal is calculated once and reused across material
outputs. For example, the border signal can simultaneously choose mortar color, lower height,
increase roughness, and darken AO. It must not be recalculated separately for every output.

### Stage 1 — repeated structure

Initial structure types:

- Solid
- Grid / square tile
- Running-bond brick
- Plank
- Hexagon
- Dot / stud
- Stripe
- Checker
- Voronoi cell / irregular stone

Shared controls:

- scale X/Y;
- rotation in 90-degree steps;
- gap/border width and softness;
- shape roundness;
- row offset;
- per-cell size and position variation;
- deterministic seed.

The structure function returns at least:

```glsl
struct PatternCell {
  float fill;       // inside versus gap/border
  float edge;       // distance/weight near the edge
  float cellRandom; // stable value derived from integer cell id and seed
  vec2 localUV;     // coordinates within the selected cell
};
```

Randomness must be derived from integer cell coordinates and the seed. It must never use time or
screen coordinates, otherwise the pattern will shimmer as the camera moves.

### Stage 2 — palette and surface identity

The palette converts structure signals into a material:

- primary, secondary, and border colors;
- per-cell hue/value variation;
- primary and border roughness;
- primary and border metalness;
- border recess/height;
- optional color ramp with 2–4 stops.

Neutral source patterns are tinted here. This is the primary multiplier: one grayscale stone source
can become concrete, sandstone, slate, ice, alien rock, or painted masonry without another albedo
texture.

### Stage 3 — weathering

Initial generators:

- value noise;
- fractal Brownian motion (fBm);
- ridged noise;
- cellular noise;
- directional streaks;
- crack mask;
- domain-warped noise.

Controls include scale, octaves, contrast, coverage, warp, direction, and seed offset. Weathering can
target color, roughness, height, or layer coverage independently. Examples include moss coverage,
rust, stains, worn paint, soil patches, and darker cavities.

For efficiency, the same base noise value should feed all enabled weathering outputs. Additional
octaves are a quality choice, not separate effects.

### Stage 4 — micro detail

Micro detail adds high-frequency information near the camera:

- procedural grain, pores, scratches, or fibers; or
- one optional reusable packed detail texture.

It primarily affects normal and roughness, with restrained color influence. Detail fades with
camera distance and derivative footprint to avoid shimmer and moire. The first release should offer
grain, pores, and directional scratches; fibers can follow later.

---

## 3. Optional efficient texture pack

The behavior must work without textures, but one compact pattern pack can substantially increase
quality. The pack is shared across every recipe and object.

Recommended 1024x1024 assets:

| Image | Channels | Purpose |
| :--- | :--- | :--- |
| Neutral pattern atlas | RGBA color | Four neutral 512x512 structural source tiles. |
| Normal/height atlas | R = normal X, G = normal Y, B = height, A = cavity | Reconstruct normal Z in shader. |
| Surface atlas | R = AO, G = roughness, B = metalness/material mask, A = variation | PBR data in one GPU texture. |
| Mask atlas | R = cracks, G = stains, B = streaks/wear, A = organic coverage | Four reusable grayscale masks. |

Rules:

1. All maps for a source tile use the same atlas rectangle and randomized transformation.
2. Color textures use sRGB; normal, height, masks, and PBR data remain linear.
3. Use power-of-two dimensions for reliable repeat wrapping and mipmapping across targets.
4. Keep the default pack at 1024x1024. A 2048 pack is an optional desktop-quality asset, not the
   baseline.
5. Never generate a unique large canvas or render-target texture per object; that would recover the
   variation but lose the memory advantage.
6. Clone only the texture object when independent UV state is needed; continue sharing decoded image
   sources, as Material3D already does.

Approximate RGBA8 GPU memory with mipmaps is 5.33 MiB at 1024x1024 and 21.33 MiB at 2048x2048. Four
packed 1024 images are therefore roughly 21.3 MiB, compared with roughly 85.3 MiB for four 2048
images. These are planning estimates and the diagnostic should report an estimate, not claim exact
driver allocation.

---

## 4. Anti-repetition without excessive sampling

The shader combines three techniques:

1. **Per-cell procedural variation** — nearly free once the structure is known; varies tint,
   roughness, scale, mirroring, and 90-degree rotation.
2. **Macro modulation** — low-frequency procedural noise breaks large uniform areas without a
   texture lookup.
3. **Optional two-placement stochastic blend** — samples two deterministic transformed placements
   and blends them to hide obvious texture repetition.

Do not start with four-way texture bombing. Applied across color, normal, and packed PBR textures it
multiplies the sample count too quickly and often replaces repetition with blur.

Normal maps require special handling:

- rotate normal XY whenever the texture placement rotates;
- invert the appropriate component when mirroring;
- reconstruct Z after sampling packed XY;
- combine base and detail normals with RNM or an equivalent orientation-preserving method;
- never average encoded normal RGB as ordinary colors.

Height-aware blending is optional in the High tier. Balanced uses normalized weighted blending.

---

## 5. Quality tiers and budgets

| Tier | Intended target | Noise | Texture placement | Approximate texture samples |
| :--- | :--- | :--- | :--- | :---: |
| Fast | mobile / many objects | 1–2 octaves | single | 0 procedural-only; 3–4 packed |
| Balanced | default | 3 octaves | two-placement for selected maps | 6–9 |
| High | desktop / hero surfaces | 4–5 octaves + warp | two-placement + height blend | 9–14 |

The exact count depends on which optional maps are enabled. The build must document and test the
sample count of every compile-time feature combination. Twenty-sample default materials are not
acceptable.

Features that change generated GLSL—structure type, texture mode, triplanar mode, quality tier—belong
in `customProgramCacheKey` and set `needsUpdate` only when changed. Colors, scales, seeds, coverage,
roughness, and strengths are uniforms and must update without recompiling.

---

## 6. GDevelop-facing behavior

The editor should expose useful recipes without presenting a shader graph. Properties are grouped
and advanced groups start collapsed.

### Core properties

- Enabled
- Preset
- Quality: Fast / Balanced / High
- Coordinate mode: UV *(v1)*; World Triplanar *(later)*
- Global scale X/Y
- Seed

### Structure properties

- Pattern type
- Pattern scale X/Y
- Rotation: 0 / 90 / 180 / 270 / Random 90
- Gap width
- Edge softness
- Roundness
- Row offset
- Cell size variation
- Cell position variation

### Palette properties

- Primary color
- Secondary color
- Border color
- Color variation
- Primary/border roughness
- Primary/border metalness
- Border height

### Weathering properties

- Weathering type
- Scale
- Coverage
- Contrast
- Strength
- Domain warp
- Target: Color / Roughness / Height / Combined
- Weathering color

### Detail properties

- Detail type
- Detail texture *(optional image resource)*
- Detail scale
- Normal strength
- Roughness strength
- Color strength
- Fade start/end distance

### Packed pattern properties

- Use pattern pack
- Neutral pattern atlas
- Normal/height atlas
- Surface atlas
- Mask atlas
- Atlas tile index
- Stochastic blending

### Initial actions

- Set preset
- Set seed
- Set global scale
- Set pattern type
- Set primary/secondary/border colors
- Set gap width
- Set color variation
- Set roughness range
- Set weathering type/coverage/strength
- Set detail type/strength
- Set quality
- Set pattern-pack resources
- Randomize recipe *(assigns a generated seed only; deterministic afterward)*
- Apply recipe

### Conditions and expressions

- Pattern material is ready
- Pattern shader is active
- Uses procedural-only recipe
- Uses pattern pack
- Last application succeeded / failed
- `RecipeSeed()`
- `PatternType()`
- `QualityTier()`
- `EstimatedTextureSamples()`
- `EstimatedTextureMemoryMiB()`
- `LastError()`

Setters update uniforms immediately when possible. `Apply recipe` batches changes and performs the
single required recompile when a structural option changed.

---

## 7. Presets

Presets are parameter defaults, not duplicated shaders or textures. The first useful set should
prove breadth:

- Running-bond brick
- Weathered stone blocks
- Irregular cobblestone
- Ceramic tile
- Wood planks
- Painted metal panels
- Hammered metal
- Cracked dry ground
- Speckled terrazzo
- Scales / sci-fi cells

Selecting a preset copies values into the behavior state. Users can then modify every value; a
preset is not a locked mode.

Recipe import/export can be added later as a compact JSON string expression/action after the field
schema stabilizes.

---

## 8. Runtime architecture

Create `PatternMaterial3D.runtime.js` and embed it through `build-extension.mjs` alongside the shared
chain. Runtime state is per behavior instance; shader feature state is attached as direct properties
on each live material so it is not corrupted by Three.js `userData` cloning.

Suggested material state:

```js
material.__m3dPattern = {
  enabled: true,
  structuralKey: 'brick|packed|balanced|uv',
  uniforms: { /* stable Three.js uniform objects */ },
  textures: { /* Core-owned/shared texture references */ }
};
```

The injector should be registered as `pattern-material` at order 420. It will need to touch more
than one Three.js chunk: common/helper declarations, map/color application, normal application,
roughness, metalness, and AO. Extend the shader-chain declaration from one `chunk` string to a
`chunks` array before implementing it. The build validator must confirm every declared chunk exists
in the supported Three.js revision.

Evaluate the recipe once per fragment into a shared result:

```glsl
struct M3DPatternResult {
  vec3 color;
  vec3 normalTS;
  float height;
  float roughness;
  float metalness;
  float ao;
};
```

Later injected chunks consume this result rather than repeating shape/noise calculations. Shader
source should be assembled from small feature blocks at compile time so disabled generators do not
remain as runtime branches in every pixel.

### Core API needed before this behavior

The complete extraction and compatibility sequence is specified in
[`MATERIAL3D_BEHAVIOR_SPLIT_PLAN.md`](./MATERIAL3D_BEHAVIOR_SPLIT_PLAN.md).

The Material3D division should expose a private shared controller with:

- `getLiveTargetMaterials(object, coreBehavior)`;
- `registerContributor(object, behaviorId, contributor)`;
- `unregisterContributor(...)`;
- `requestUniformRefresh(...)`;
- `requestShaderRebuild(...)`;
- `acquireTexture(resource, colorSpace, samplingKey)`;
- `releaseTexture(handle)`;
- `getMaterialGeneration()` to reject stale references after a rebuild.

This contributor API should be completed before Pattern Material starts. Building directly against
the present monolithic behavior would create avoidable migration work.

---

## 9. Implementation phases

### Phase 0 — prerequisites and correctness

1. Complete the Material3D behavior division and shared Core contributor API.
2. Fix existing Material3D/BRDF material ownership and multi-slot retargeting defects.
3. Extend shader-chain metadata to support `chunks: []` and explicit conflicts.
4. Add a test shader fixture taken from the supported Three.js revision.
5. Add material-generation IDs so contributors never update discarded clones.

**Exit:** Core can rebuild a targeted material and all registered contributors reattach to exactly
the same targeted slots without leaking or broadening the target.

### Phase 1 — procedural proof of concept

1. Add UV coordinates, deterministic hash, rectangle/grid, running-bond brick, and value noise.
2. Produce color, border height, roughness, and a height-derived normal.
3. Add seed, scale, three colors, gap, edge softness, and roughness controls.
4. Register the injector and diagnostics.
5. Ship one brick and one tile preset.

**Exit:** ten visibly distinct materials can be produced from zero image textures by changing only
recipe values, with no shimmer while camera or object moves.

### Phase 2 — useful procedural library

1. Add plank, hexagon, stripe, checker, dot, and Voronoi structures.
2. Add fBm, ridged, cellular, cracks, streaks, and domain warping.
3. Add per-cell 90-degree rotation, mirroring, scale, position, and color variation.
4. Add macro weathering and distance-faded micro detail.
5. Add the initial preset set.

**Exit:** the behavior covers masonry, stone, wood, manufactured panels, ground, and stylized
surfaces without image resources.

### Phase 3 — packed texture ingredients

1. Add the four optional atlas resources and tile selection.
2. Implement correct color spaces and consistent transforms across maps.
3. Implement normal XY rotation/mirroring and Z reconstruction.
4. Add single-placement Fast and two-placement Balanced sampling.
5. Add height-aware blending in High quality.
6. Add estimated sample and memory diagnostics.

**Exit:** one 1024 pattern pack demonstrably creates at least 25 useful recipes without loading
additional material textures.

### Phase 4 — composition and polish

1. Verify BRDF, Physical, Wet, and Animated behavior combinations.
2. Add optional triplanar coordinate input.
3. Add recipe JSON import/export if the schema is stable.
4. Add shader compilation warm-up for a known recipe set if practical.
5. Tune mobile precision, loops, and feature limits from profiling.

**Exit:** supported behavior combinations render consistently and quality tiers meet their declared
sample budgets on representative mobile and desktop hardware.

---

## 10. Verification plan

### Unit tests

- deterministic hash: same seed/cell is stable, different seeds vary;
- every structure remains bounded and periodic where expected;
- gap and edge masks are continuous at cell boundaries;
- packed channel decode and normal reconstruction;
- rotation/mirroring correctly transforms normal XY;
- uniform changes do not change the program cache key;
- structural changes do change the cache key;
- shader injection fails visibly when an expected Three.js chunk is absent;
- compile-time feature combinations stay within their sample budgets;
- reapply/restore cycles dispose every owned material and texture exactly once;
- material-index targeting never expands to neighboring slots;
- multiple objects with the same recipe share sources without sharing mutable UV state.

### Visual regression scenes

1. Flat plane viewed close and at grazing angles.
2. Sphere and bevelled cube to expose normal errors.
3. Large floor to reveal repetition and macro uniformity.
4. Adjacent meshes using the same seed and different seeds.
5. Multi-material model with only one targeted slot.
6. Moving camera to reveal shimmer, aliasing, and distance transitions.
7. BRDF + Pattern + Wet + Physical composition scene.
8. Mobile Fast versus desktop Balanced/High comparison.

Capture reference screenshots for each preset and quality tier. A stubbed shader test is necessary,
but it cannot validate visual correctness or actual GDevelop extension loading.

### Performance acceptance

- no per-frame JavaScript allocation in the steady-state update path;
- no shader recompilation for color, seed, scale, coverage, or strength changes;
- no unique large generated texture per object;
- sample-count diagnostic agrees with inspected generated GLSL;
- no material or texture growth after 100 apply/restore and preset-change cycles;
- stable frame time when many objects share one recipe;
- no visible temporal shimmer under camera motion.

---

## 11. Deliberate exclusions from version 1

- arbitrary user-authored shader code;
- a node-graph editor;
- unlimited layers;
- runtime baking to a unique high-resolution texture;
- arbitrary-angle stochastic normal-map rotation;
- parallax occlusion mapping;
- procedural texture generation on the CPU every frame;
- automatic conversion of arbitrary texture packs into the packed layout.

These can be reconsidered after the fixed recipe proves useful and measurable. Excluding them keeps
the first implementation understandable, portable, and bounded.

---

## 12. Definition of success

Tiled Custom Pattern Material 3D succeeds when:

1. a small shared ingredient pack—or no images at all—produces a broad family of recognizable
   materials;
2. recipes are mostly parameter data and do not multiply VRAM with each object;
3. repetition is reduced without obvious blur or temporal instability;
4. mobile and desktop costs are explicit and selectable;
5. it composes with the other Material3D behaviors without replacing materials or losing target
   selection;
6. users can create a useful result from presets, then understand how shape, palette, weathering,
   and detail layers formed it.
