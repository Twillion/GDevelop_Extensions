# Material 3D

**Author:** Christopher Monhollen (`Twillion`) · **Version:** 4.0.0 · **Category:** 3D
**Tested against:** GDevelop 5 with Three.js r160 / PIXI 7.4.2

One extension with focused, composable material behaviors.

| Behavior | What it does |
| :--- | :--- |
| **Material 3D Core** | Owns targeting and material lifetime, common PBR maps/fields, anisotropic filtering, render state, restoration and diagnostics. 39 properties, 63 functions. |
| **Physical Material 3D** | Adds glass, clearcoat, sheen, iridescence and anisotropy through the shared material controller. 20 properties, 36 functions. |
| **Animated Material 3D** | Adds independent UV transforms, scrolling, flipbooks, video and anisotropic filtering. 22 properties, 42 functions. |
| **Tiled Custom Pattern Material 3D** | Synthesizes repeated structures with seeded noise, RGB texture-overlay tint, saturation, palette variation, roughness, metalness and anisotropic filtering. 28 properties, 48 functions. |
| **Wet Material 3D** | Adds non-compounding wet darkening, configurable wet roughness and anisotropic filtering. 9 properties, 23 functions. |
| **BRDF Material** | Patches the material's shader to swap the diffuse lighting model with texture anisotropy control. 16 properties, 30 functions. |
| **Displaced Mesh 3D** | Physical vertex displacement, cube face subdivision, pattern relief coupling, geological weathering, crevice shading and anisotropic filtering. 40 properties, 71 functions. |

> **Status: built, unit-tested (417/417 pass), and headless browser verified.** `node MaterialMaster/test-materialmaster.mjs`
> passes 417 checks against the real runtime under a stub Three.js, and headless browser validation renders 90+ real frames cleanly under Three.js r160.

---

## What this replaces

| Extension | Version | Disposition |
| :--- | :---: | :--- |
| Animated & Custom PBR Material 3D | 2.0.0 | **Base.** Its runtime is the core of Material 3D. |
| Advanced 3D Material | 1.0.0 | Diagnostics, runtime retargeting and per-property setters absorbed. |
| Advanced Materials *(by Antigravity)* | 1.3.1 | Transmission / IOR / thickness / clearcoat **reimplemented, not copied** — see [Attribution](#attribution). |
| BRDF Materials | 3.2.0 | Reworked as the non-cloning **BRDF Material** contributor. |

---

## Why BRDF is a separate behavior

The three material extensions all did the same *kind* of thing — build a Three.js material and
assign fields — so merging them lost nothing. BRDF Materials does something categorically different:
it leaves the material alone and patches its **shader** through `onBeforeCompile`, rewriting the
diffuse lighting term to one of 13 models (Oren-Nayar, Minnaert, Toon, Velvet, Callisto, Kajiya-Kay…).

Folding it into Core would produce a behavior full of unrelated or inert controls. Keeping it as a
focused contributor makes the lighting choice optional and composable.

### They used to break each other

This is the bug worth knowing about, because it produced **no error of any kind**. If a material
override behavior replaced the material *after* BRDF had patched it, the patched clone was discarded
along with its `onBeforeCompile` hook and `userData.__brdf*` state. The surface silently reverted to
the stock Three.js diffuse and nothing appeared in the console.

In v4, BRDF registers with the shared controller, patches Core-owned materials in place, and never
clones or replaces them. Stack the behaviors in either order and both survive. The **BRDF patch is
active** condition reports whether its shader injector actually compiled.

---

## The shared shader chain

`material.onBeforeCompile` is **one function property, not a list**. Two behaviors that both assign
it do not compose — whichever assigns last silently wins, and the loser's shader edits never appear.

Since Material 3D, BRDF Material, and every planned v3.5 module (parallax occlusion, subsurface
scattering, triplanar, detail normals, rain ripples) all need to edit the compiled shader, **nobody
assigns the hook directly**. `ShaderChain.runtime.js` owns it; injectors register into an ordered
chain, each declaring the Three.js chunk it edits.

- `customProgramCacheKey` is composed from the active set, so two materials with different features
  never share one compiled program.
- A throwing injector is caught and logged; the others still apply.
- `Material.copy()` carries neither the hook nor the cache key, so the chain is re-installed after
  every material rebuild. Forgetting that is the same silent-revert class of bug as the userData
  trap below.
- The build refuses to compile if any runtime assigns `onBeforeCompile` directly.

**Shader injector is active** and `ShaderInjectors()` report what actually reached the compiler —
empty until the object has drawn one frame.

---

## Sheen, iridescence, anisotropy, wetness

Added in 3.1.0, and neither needs a shader.

**Sheen / iridescence / anisotropy** are native `MeshPhysicalMaterial` fields in Three.js r160, so
they are plain assignments like transmission and clearcoat. They exist **only** on the Physical
class — `Auto` accounts for all five physical triggers, so raising any of them promotes the material
rather than dropping the assignment silently.

**Wetness** is two field assignments: porous surfaces darken as water fills their pores
(`albedo × (1 − wetness × porosity × 0.35)`), and the water film drives roughness toward `0.02`.
Set **Porosity** to 0 for metal — it goes glossy without darkening. Animated rain ripples are a
separate module and do need a shader.

---

## Anisotropic Texture Filtering (`texture.anisotropy`)

In standard WebGL and Three.js pipelines, textures viewed at oblique, grazing, or shallow angles (such as floors, walls, roads, terrain, or distant angled surfaces) can suffer from severe mipmap blurriness.

**MaterialMaster** introduces **Anisotropic Texture Filtering** across **every behavior in the family**:
- **Supported Modes**: `16x` (default & recommended), `Max` (automatically queries the active GPU renderer via `capabilities.getMaxAnisotropy()`), `8x`, `4x`, `2x`, `1 (Off)`, and `Keep Original`.
- **Works Everywhere**:
  - Composed with **Material 3D Core** (applied to all managed materials and texture slots).
  - Standalone with **any individual behavior** (`PhysicalMaterial3D`, `AnimatedMaterial3D`, `TiledCustomPatternMaterial3D`, `WetMaterial3D`, `BRDFMaterial`, or `DisplacedMesh3D`) attached directly to a 3D model or box without Core.
- **Covers All Active Texture Slots**: Albedo map, normal map, roughness map, metalness map, ambient occlusion map, emissive map, and video textures.
- **Dynamic Runtime Controls**:
  - Actions: `SetAnisotropicFiltering(mode)`, `SetTextureAnisotropy(level)`.
  - Expressions: `TextureAnisotropy()` (numeric level), `AnisotropicFiltering()` (mode string).
  - Condition: `IsAnisotropicFilteringEnabled()` (checks if anisotropy > 1).
  - In-place updates: changing filtering at runtime updates `texture.anisotropy` and triggers `texture.needsUpdate = true` immediately without rebuilding the material.

### Anisotropy needs a mipmap chain, and GDevelop's textures do not have one

This is the bug that made the whole feature inert, and like the rest of the family it reported
success the entire time.

Anisotropic filtering works by taking several samples **along a mipmap chain**. With no chain there
is nothing for it to sample, so the setting applies, `TextureAnisotropy()` reads back `16`, and not
one pixel changes. And GDevelop builds every 3D texture with `minFilter = LinearFilter`
(`pixi-image-manager.js`, `getThreeTexture`) — one of exactly two filters for which Three.js skips
mipmap generation entirely. So on a stock engine texture, anisotropy was **always** doing nothing,
in the default configuration, with a clean console and a condition cheerfully reporting "enabled".

Requesting anisotropy above 1 now ensures the texture has a chain to sample: `generateMipmaps` on
and `minFilter` set to `LinearMipmapLinearFilter`. Two deliberate exceptions:

- **Nearest-filtered textures are left alone.** That is the pixel-art choice, and forcing a mip
  chain would blur exactly what you asked to keep crisp. Anisotropy does nothing there, by design.
- **An anisotropy of 1 forces nothing.** Turning the feature off must not drag a mip chain in
  behind it.

The re-upload stays behind a real change — setting `needsUpdate` pushes the whole image to the GPU,
so doing it per frame would be worse than the blur it fixes.

**Anisotropic filtering is actually filtering** is a separate condition from **Anisotropic filtering
is enabled**, and the distinction is the point: the first says it is changing pixels, the second only
says it is switched on. This is the same pairing as `BlendNeighborCount()` against **Blending with
neighbours** — configured versus working. Filtering is a property of the *image*, not of one object,
so a texture shared by several objects carries one filter setting for all of them.

---

## Displaced Mesh 3D & Geometry Ownership

**Displaced Mesh 3D** introduces real vertex deformation and geological weathering while preserving Material3D's strict single-ownership model:
- **Material 3D Core** remains the sole owner of `mesh.material`.
- **Displaced Mesh 3D** becomes the sole owner of its cloned/rebuilt `mesh.geometry`. It never assigns `mesh.material`.
- **Geometry Controller 3D** (`GeometryController3D.runtime.js`) tracks geometry ownership, caches pristine base positions and normals, and guarantees clean disposal and restoration without memory leaks.
- **Tiled Custom Pattern Material 3D** shares its active procedural recipe with Displaced Mesh 3D so procedural bricks, tiles, dots, hexagons, and Voronoi cells physically sink mortar gaps inward (`PatternDepth`) and extrude surface faces outward (`PatternRaise`).

### Performance behavior

- **On creation** performs one geometry rebuild, then remains idle.
- **On property change** coalesces setter changes and rebuilds once in the next pre-events step.
- **Manual** rebuilds only through `RebuildMesh`.
- Repeated deformation reuses offset, gap, vertex-color, and seam-cluster buffers when topology is unchanged.
- A 20,000-vertex per-object limit and 250,000-live-vertex global safety budget are enforced before allocation.
- `GeometryRebuildCount()` and `LastRebuildMilliseconds()` expose rebuild diagnostics.
- Static Physical, Wet, and Pattern contributors use generation checks rather than resolving targets and rewriting materials every frame.
- Animated Material keeps only its animation/video update path active while unchanged.
- **Geological Weathering** layers deterministic 3D simplex noise, sedimentary terracing steps, and corner/edge erosion to transform sharp cubes into weathered stones or rocks without requiring external 3D modeling software.
- **Crevice Shading** computes recessed depth factors and shades vertex colors (`geometry.attributes.color`), coordinating with Material 3D Core via `MaterialController3D` to automatically enable `material.vertexColors = true`.
- **GDevelop Cube3DObject Adapter** transparently subdivides Three.js `BoxGeometry` while preserving all 6 material groups and UV coordinates. Vertex counts are strictly clamped to `MaxVerticesPerObject` (default 20,000) to prevent engine freeze or memory exhaustion.
- **Non-Compounding & Safe**: Displacements calculate offsets strictly relative to the cached base geometry. Repeated property changes or rebuilds never cause runaway compounding. Removing or disabling the behavior instantly restores the original geometry reference.

---

## Surface expansion — why packed cubes go see-through, and the fix

A GDevelop **Cube3D** is `BoxGeometry(1,1,1)` with the *mesh* scaled to the object's size. Displaced
Mesh 3D therefore deforms a unit cube spanning −0.5..+0.5, and **every displacement value is a
fraction of the whole object, not a world distance**. `RoughnessStrength` of `0.15` moves a surface
by up to 15% of the cube.

Three things then pull the rim of every face inward, and on a grid of touching cubes that is exactly
where the gaps appear:

- `CornerErosion` subtracts along the normal as a vertex approaches a face border — that is its job.
- The fbm term is signed, so on average half of the surface moves inward.
- `BridgeSeams` averages the three face normals at a cube corner into a diagonal, so a negative
  average offset retreats the corner toward the cube centre — opening a gap on both neighbours.

Until now nothing could push a vertex outward independently of the noise. Two controls now can:

| Property | What it does |
| :--- | :--- |
| **Inflate** | A flat outward push along the normal, applied *after* the erosion/noise clamp so nothing can eat it. Offsets a box surface by a constant distance, which rounds the edges rather than scaling the cube. |
| **Edge seal** | As a vertex approaches a face border, blends its offset toward `max(offset, 0)`. The rim stops receding while the middle of the face still pillows freely. This is the control that makes a grid watertight; `Inflate` alone just fattens everything, silhouette included. |
| **Edge seal width** | How far in from the border the seal fades out, in face-local units. |

**Use relative units** (on by default) makes `Inflate` and `Blend radius` fractions of the object's
smallest world dimension, so one value reads the same on a 1-unit and a 500-unit cube. Turn it off to
author both in raw world units.

### Picking a seal width

The seal only has to pin the outermost ring of vertices, so the useful width is **a little over one
subdivision grid step** — `1.1 / Subdivision`, which `RecommendedEdgeSealWidth()` returns. Anything
wider closes the same gap while flattening more of the face. Measured on a weathered block at
`Subdivision: 12`, `RoughnessStrength: 0.15`, `CornerErosion: 0.35`:

| Setting | Gap between two blocks | Face relief kept |
| :--- | ---: | ---: |
| No seal | **10.1%** of block width | 7.76% |
| `EdgeSeal 1`, width `0.09` | 0% | 7.64% |
| `EdgeSeal 1`, width `0.15` | 0% | 6.70% |
| `EdgeSeal 0.6`, width `0.09` | 4.0% | 7.69% |

A partial seal leaves a partial gap — this is a control you either commit to or leave off. The
falloff is smoothstepped rather than linear, because a linear ramp releases with a sudden change in
slope at exactly `Edge seal width` and that reads as a crease ringing every face.

Either way the push is **scale-compensated**: on a cube that is 100 wide and 400 tall, the same
inflate moves the X and Y faces the same *world* distance instead of bulging four times as far up.

---

## Neighbour blending — merging adjacent blocks

**Blend with neighbours** makes an object's surface bulge into whatever is standing beside it, so two
stones placed together read as one larger stone instead of two boxes. It does this without changing
topology, without creating a merged mesh, and without touching the single-ownership rules: each
object still owns exactly its own geometry and pushes only its own vertices.

`MeshBlend3D.runtime.js` is a scene-level registry — the first thing in this extension that is not
keyed by a single root. Each participating object publishes an oriented box into a uniform spatial
hash. A rebuild then asks for the boxes near itself and, for each vertex, evaluates the polynomial
smooth-minimum of their signed distance fields. Because the vertex already sits on its own surface,
that collapses to a single bounded term: zero further than **Blend radius** away, rising to
`radius / 4` on contact, and clamped there when objects overlap.

| Property | What it does |
| :--- | :--- |
| **Blend with neighbours** | Off by default. Turning it on publishes this object and lets it bulge toward others. |
| **Blend group** | Empty blends with *any* participating neighbour. A non-empty string only blends with objects carrying the same string, so stone can merge with stone without melting into wood. Trimmed and case-insensitive. |
| **Blend radius** | How far apart two objects still attract each other, and how large the fillet is where they meet. |
| **Blend corner radius** | Rounds the corners of the neighbour's implicit box so the blend does not snag on a hard edge. |

Blending is the one input that can change without this behavior's own properties changing — a block
placed, moved, or destroyed beside this one alters its surface. Each frame the behavior re-publishes
its box and hashes its neighbourhood (a spatial-hash lookup over a handful of cells) and rebuilds
**only when that hash actually moves**. `Manual` update mode opts out and waits for
**Rebuild displaced mesh**. Destroying an object, disabling it, or switching blending off withdraws
its box, and the surviving neighbours notice on their next frame.

**Blending with neighbours** is a condition, and `BlendNeighborCount()` an expression: together they
answer "switched on" versus "actually found something", which the property alone cannot.
`RecommendedBlendRadius()` returns a sane starting value for the current unit mode.

---

## Living with the Cube3D renderer

Subdividing a Cube3D means the engine's own renderer is still writing to a geometry it no longer
recognises. Two of its assumptions break, and both are handled here rather than left to surprise you.

**The tint.** A Cube3D keeps its object colour in `geometry.attributes.color` and builds its
materials with `vertexColors: true`. Replacing the 24-vertex geometry with a subdivided one used to
drop that attribute, and turning crevice shading off used to `deleteAttribute('color')` outright —
which is not "no tint" but **black**, because the shader still declares `attribute vec3 color` with
nothing bound.

The pristine colours are now snapshotted onto the geometry record and either written straight back
or used as the base that crevice shading multiplies, so a red block stays red and darkens in its
recesses instead of turning grey. `BoxGeometry` is face-major, so a per-face tint maps onto the
matching subdivided face exactly. An object that genuinely had no vertex colours still does not gain
an empty attribute.

**The UVs.** `updateTextureUvMapping()` walks vertex indices 0..23 with `case` blocks keyed to
`Math.floor(e / 4)` — hard-coded for the unsubdivided box. On our geometry those indices address the
first face and a half of a much larger grid, so any `updateSize()` or face change scribbles Cube3D
face UVs over our vertices and the texture tears.

The engine offers no hook to intercept that, so the corruption is detected and undone: the pristine
UVs are kept on the record and only the 24-vertex range the engine can reach is compared each frame,
which is 48 float reads per mesh regardless of subdivision. `UVRepairCount()` reports how often it
has fired. A resize also rebuilds the displacement outright, since object scale is what the aspect
tiling, inflate compensation and blend push are all computed against.

---

## Working with authored models

A `.glb` arrives with its PBR already authored, so the guiding rule for every behavior here is that
attaching one must not quietly undo what the model shipped with. That is what the `Use*` gates are
for — `UseRoughness`, `UseMetalness`, `UseBaseColor` and `UseEmissive` all default to off, meaning
*don't touch*, and `Alpha mode` and `Rendered side` default to `Preserve` for the same reason. A
texture slot left empty falls back to the map the model already had rather than blanking it.

Four places did not honour that rule, and all four failed in the silent way this extension exists to
eliminate.

**A material class change kept almost nothing.** A class change cannot clone — a Standard material
does not become a Physical one — so the replacement is built fresh and the authored fields have to be
carried over by hand. Only `name`, `color`, `map`, `roughness` and `metalness` were. The moment any
Physical field promoted the class, an emissive panel went black, a double-sided transparent leaf card
came back opaque and single-sided, and `Preserve` could not help because there was no longer anything
on the material to preserve. Emissive colour and intensity, `side`, `transparent`, `opacity`,
`alphaTest`, `depthWrite`, `vertexColors`, `flatShading`, `normalScale`, `aoMapIntensity`,
`envMapIntensity`, `alphaMap`, `bumpMap`, `lightMap` and `envMap` now all survive the change, each
guarded on both sides so carrying a Physical into a Basic drops what Basic cannot honour instead of
inventing it.

**Wrap modes were forced onto textures the extension did not own.** Every bound map was switched to
`RepeatWrapping`, including maps that arrived with the model. glTF routinely authors `ClampToEdge` for
atlases and non-tiling UV layouts, and switching that to Repeat bleeds the edges — for every other
object drawing the same shared texture, and permanently, since `Restore original materials` has no
record of a texture it never owned. A model's own textures are now left exactly as authored. Textures
this extension loads are still set to Repeat, and so is the private clone Animated Material 3D drives,
which is what tiling and scrolling actually need.

**AO maps did nothing on most models.** Three.js r160 samples `aoMap` from the *second* UV set,
`geometry.attributes.uv1`. Most exporters write a single UV set unless a second is added on purpose,
so an ambient occlusion map on a typical export sampled an attribute that was not there and
contributed nothing, with a clean console. A single-UV model now has its `uv` aliased onto `uv1` —
with one UV set those are the same coordinates, so it is what the model meant — and
`AOUVAliasCount()` reports when that happened. A model shipping a real second UV set is left alone.

**Wireframe and fog were written unconditionally.** Both came straight from their property
defaults on every apply, so merely attaching the behavior forced wireframe off and fog on over
whatever the model authored — the same silent overwrite the `Use*` gates and the `Preserve` defaults
exist to prevent. They now write only when the value actually says something: a setter override, or
a property moved off its default. Setting **Wireframe** to true still turns it on, setting **Fog** to
false still turns it off, and the setter actions still reach both in either direction; what no
longer happens is a default quietly flattening a model that had chosen otherwise.

**Normal and AO strength could not reach a model's own maps.** `NormalScale` and `AOIntensity` applied
only to maps this behavior had loaded itself, so both were inert on a model's baked-in normal and AO
maps. They now reach whichever map is bound — but only when the value was actually set, because a
default of 1 would otherwise overwrite the strength the model authored the instant the behavior was
attached, which is the very failure the `Use*` gates exist to prevent.

---

## Diagnostics — the reason the merge was worth doing

3D material work in GDevelop fails quietly. A wrong mesh name, a renderer that was not ready yet, a
material that was never cloned — all of it renders as *nothing happened*, with a clean console. Of
the four extensions merged here, only Advanced 3D Material could report on itself, and it was the one
that was broken.

Material 3D exposes:

| | |
| :--- | :--- |
| **Conditions** | Material is ready · application succeeded · failed · waiting for renderer · is idle · has matching materials · has matching meshes · is using shader type · has pending changes |
| **Expressions** | `State()` · `LastError()` · `MaterialClass()` · `MatchingMeshCount()` · `MatchingMaterialCount()` · `RetryCount()` · `MeshNames()` · `MaterialNames()` · `AOUVAliasCount()` |

When a material does not appear, `HasMatchingMeshes` plus `MatchingMeshCount()` tells you in one
condition whether the problem is your targeting or something else.

`MeshNames()` and `MaterialNames()` close the other half of that loop. Mesh-name and material-name
targeting could only ever read back the string you typed, never what there was to type, so a name
that came out of a modelling tool had to be copied by eye and a typo failed silently. Both
expressions list what the object actually carries, and a targeting miss now names the value it
looked for alongside the values that were available:

```
No materials matched the current Target Mode. Looking for mesh "Rock_LOD1".
This object has: Rock_LOD0, Moss.
```

---

## Everything is settable at runtime

Each focused behavior exposes setters for its own properties. Core includes runtime targeting actions
such as `Set target mode`, `Set material index`, `Set material name`, and `Set mesh name`.

The mechanism: setters write into a per-instance override map that the runtime's property getters
consult ahead of the editor property. **Update mode** decides when a change lands:

- **Apply once** *(default)* — changes apply on the next frame.
- **Every frame** — every property is re-read and re-applied each frame. Use when something outside
  this behavior is driving the properties.
- **Manual** — nothing lands until you call **Reapply material**. Batch a dozen setters, then apply once.

`Restore original materials` puts the object back as it shipped and drops every override.

---

## Material class

Three Three.js classes are reachable through the **Material class** property:

| Choice | Builds | Notes |
| :--- | :--- | :--- |
| **Auto** *(default)* | Standard, or Physical | Physical only when transmission or clearcoat is above 0. |
| Keep Original | whatever is there | Clones the existing material unchanged. |
| Basic (unlit) | `MeshBasicMaterial` | Ignores lights entirely. Cheapest. |
| Standard (PBR) | `MeshStandardMaterial` | The workhorse. |
| Physical | `MeshPhysicalMaterial` | Adds transmission, IOR, thickness, clearcoat. Heavier. |

`MaterialClass()` reports which one was actually built — useful under **Auto**.

---

## Breaking changes from the extensions this replaces

**The Displaced Mesh 3D `Fallback*` properties are gone.** `FallbackPattern`, `FallbackScaleX`,
`FallbackScaleY`, `FallbackGapWidth` and `FallbackEdgeSoftness` were a second copy of the five
pattern knobs the behavior already exposes as `PatternType`, `ScaleX`, `ScaleY`, `GapWidth` and
`EdgeSoftness`. Only `FallbackPattern` was ever read, and only when `PatternType` was empty — which
it never is, since it defaults to `Brick`. So the set was already inert.

It also should not have existed. In a shipped game a silent fallback means a surface that quietly
renders the wrong pattern with nothing to tell you which set of numbers you are looking at; you end
up changing values that are not being read. The recipe now comes from exactly one place: Tiled Custom
Pattern Material 3D when it is attached, so the shaded pattern and the physical relief cannot drift
apart, or this behavior's own pattern properties when it is not.

Nothing renders differently. Set the plain `PatternType` / `ScaleX` / `ScaleY` / `GapWidth` /
`EdgeSoftness` properties instead — GDevelop drops the removed values from existing projects, so any
event sheet calling `Set fallback pattern` and friends needs updating to the plain setters.

**Alpha mode and Rendered side now default to `Preserve`.** Previously they defaulted to `Opaque` and
`Front`, which meant that merely attaching the behavior flattened transparency and back-face
rendering on any model that shipped with them. `Preserve` touches neither. Set them explicitly to get
the old behaviour.

**Emissive is gated behind `Override emissive`.** Previously the emissive colour was written
unconditionally, so the default black fought whatever glow the model already had.

**Names follow the Three.js field they set**, so what you set is what you can look up in the Three.js
docs:

| Was | Now |
| :--- | :--- |
| `Metallic` | **`Metalness`** (`material.metalness`) |
| `EmissionColor` | **`EmissiveColor`** (`material.emissive`) |
| `EmissionStrength` | **`EmissiveStrength`** (`material.emissiveIntensity`) |
| `UseEmission` / `EmissionEnabled` | **`UseEmissive`** |
| `Side` | **`MaterialSide`** |

Both behaviors declare a `Roughness` property, and that is deliberate — they are not the same value.
Material 3D's drives `material.roughness`; BRDF's is fed to the diffuse model. The build script
asserts this stays the only overlap.

---

## Building

```bash
node MaterialMaster/build-extension.mjs
```

Never hand-edit `MaterialMaster.json` — it is generated. The build refuses to write if any JS block fails
to parse, a control character appears (a NUL truncates a JsCode block and surfaces much later as
"`<Action>` is not a function"), a behavior serializes `properties` instead of `propertyDescriptors`,
a behavior parameter is bound to the wrong type, a condition never assigns
`eventsFunctionContext.returnValue`, or a setter overrides a property that was never declared.

```bash
node MaterialMaster/test-materialmaster.mjs
```

417 checks covering material-class selection, the Preserve defaults, the override layer, performance hot paths, the
diagnostics, mesh-name targeting, restore, BRDF composition, contributors (Physical, Wet, Animated, Pattern),
authored-model survival, anisotropic filtering effectiveness, and Displaced Mesh 3D geometry deformation.

---

## Verifying

The unit tests run against a stub Three.js. They cannot see anything about how GDevelop actually
loads the extension. A scene that would exercise the parts they cannot:

1. A **Cube3D** and a **Model3D** with an authored `.glb` material — covers both "build from nothing"
   and "override what exists".
2. An object whose material **already has transparency**, to confirm the `Preserve` default leaves it
   alone.
3. An object carrying **both behaviors**, to confirm the BRDF patch survives.
4. An object with a **texture map plus scrolling**, to confirm the base extension's own features
   survived the material-class change.
5. A deliberately **wrong mesh name**, to confirm `HasMatchingMeshes` reports false rather than
   failing silently.

Check for each: the properties appear in the editor panel at all, the object renders, and the console
is clean.

---

## Upcoming Enhancements (v3.5 Roadmap)

A comprehensive enhancement plan has been formulated in [`ADVANCED_MATERIAL_ENHANCEMENT_PLAN.md`](./ADVANCED_MATERIAL_ENHANCEMENT_PLAN.md) to integrate 6 advanced visual shader modules directly into `Material3D`:
1. **Parallax Occlusion Mapping (POM):** 3D height relief depth and self-shadowing on cobblestones and bricks without adding polygons.
2. **Subsurface Scattering (SSS):** Translucent skin, ear, wax, and leaf light diffusion.
3. **Triplanar World Mapping:** Seamless, distortion-free texturing across steep cliffs and boulders with zero UV unwrapping.
4. **Micro-Detail Textures:** Reoriented normal mapping (RNM) for skin pores, fabric weaves, and metal scratches up close.
5. **Sheen, Iridescence & Anisotropy:** Velvet cloth sheen, thin-film soap/oil iridescence, and brushed metal anisotropic reflections.
6. **Dynamic Wetness & Puddle Ripples:** Surface darkening, mirror roughness, and animated rain puddles.

---

## Attribution

`Advanced Materials` v1.3.1 is authored by **Antigravity**, not by this project. Its transmission,
IOR, thickness and clearcoat features are present here, but the implementation was **written fresh
against the Three.js `MeshPhysicalMaterial` API** rather than copied — those fields are direct
assignments and the Three.js documentation is the only reference needed. No code from that extension
is in this one.

If you have permission to use Antigravity's work directly, crediting them here would be the right
thing regardless.
