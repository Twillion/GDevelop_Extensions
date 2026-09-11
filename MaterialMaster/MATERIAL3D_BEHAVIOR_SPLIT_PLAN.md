# Material 3D — behavior split and migration plan

**Objective:** replace the single 68-property `Material3D` behavior with focused, composable
behaviors while keeping exactly one owner of each Three.js material. This is intentionally a clean,
breaking replacement: no projects depend on the current behavior, so compatibility adapters would
add complexity without protecting real users.

The target extension contains these behaviors:

| Behavior | Role | Owns/replaces `mesh.material`? |
| :--- | :--- | :---: |
| **Material 3D Core** | Targeting, material construction, common PBR fields, maps, render state, diagnostics, restoration | **Yes — sole owner** |
| **Physical Material 3D** | Transmission, clearcoat, sheen, iridescence, anisotropy | No |
| **Animated Material 3D** | UV transforms, scrolling, flipbooks, video | No |
| **Wet Material 3D** | Wetness, porosity, later ripples/puddles | No |
| **Tiled Custom Pattern Material 3D** | Procedural pattern recipes and packed pattern ingredients | No |
| **BRDF Material** | Alternative diffuse-lighting models | No |

This is a division of the current Material 3D behavior, not six independent material replacement
systems. Core creates one material pipeline; the other behaviors contribute features to it.

### Implementation status

- [x] Phase 0 lifecycle, disposal, exact-slot targeting, diagnostics, and metadata repairs
- [x] Shared controller foundation with exact targets, generations, ordered contributors, and
  refresh-level request queues
- [x] Physical Material 3D behavior and automatic Physical-class negotiation
- [x] Rename/finalize Material 3D Core and remove extracted fields from its public behavior
- [x] Extract Animated Material 3D
- [x] Extract Wet Material 3D
- [x] Convert BRDF fully from clone ownership to a non-cloning contributor
- [x] Remove the extracted physical, animated, video, and wetness paths from the Core runtime
- [x] Implement Tiled Custom Pattern Material 3D procedural MVP

The generated v4 extension contains only the focused public behaviors. The Core runtime retains no
physical, animated, video, or wetness implementation path.

---

## 1. Non-negotiable ownership rules

1. Only Material 3D Core may clone, replace, restore, or dispose `mesh.material`.
2. Contributor behaviors never keep an unvalidated material reference across frames.
3. Core owns texture acquisition and release, including video textures and cloned resource textures.
4. Contributors register desired state through a shared controller rather than calling one another's
   generated behavior accessors.
5. Core preserves the exact target records `(mesh, material slot)` across rebuilds.
6. A contributor may request a uniform refresh or structural shader rebuild, but may not perform the
   rebuild itself.
7. The shared shader chain remains the only owner of `onBeforeCompile` and
   `customProgramCacheKey`.

These rules prevent cloning loops, target expansion, stale references, double disposal, and one
behavior silently erasing another behavior's work.

---

## 2. Behavior boundaries

### Material 3D Core

Core retains the settings that define material identity, targeting, and lifecycle.

**Application and targeting**

- Apply on creation
- Update mode
- Clone materials
- Include child meshes
- Target mode
- Material index
- Material name
- Mesh name

**Material class**

- Auto / Keep Original / Basic / Standard / Physical
- Auto selects the minimum class required by registered contributors

**Common surface**

- Override base color / base color
- Roughness
- Metalness
- Override emissive / emissive color / strength

**Common texture maps**

- Albedo
- Normal and normal scale
- Roughness
- Metalness
- AO and AO intensity
- Emissive
- Texture filtering

**Render state and mesh state**

- Alpha mode, alpha, cutoff, and depth write
- Rendered side
- Wireframe and fog
- Cast/receive shadow
- Render order

**Lifecycle and diagnostics**

- Apply/reapply
- Restore original materials
- Ready/waiting/failed/idle state
- Error and retry count
- Matching mesh/material count
- Actual material class
- Active contributors and shader injectors
- Material generation number

Core should be approximately 35–40 properties rather than 68. It remains substantial because these
settings all participate in selecting and constructing the actual material.

### Physical Material 3D

- Transmission
- IOR
- Thickness
- Clearcoat
- Clearcoat roughness
- Sheen, sheen color, sheen roughness
- Iridescence, IOR, thickness minimum/maximum
- Anisotropy and rotation

When any physical-only feature is active, the contributor reports `requiresPhysical: true`. Core's
Auto mode then promotes the material to `MeshPhysicalMaterial`. Turning the last physical feature
off lets Core demote it on the next structural apply.

### Animated Material 3D

- Tiling, offset, rotation, and rotation center
- UV scrolling and rotation speed
- Flipbook grid, FPS, looping, frame state, play/pause/seek
- Video resource/URL, looping, muted state, play/pause

Core owns the texture handles; Animated Material owns animation time and UV state. Animation updates
texture transforms without setting texture `needsUpdate` every frame. Video playback uploads are
left to `VideoTexture.update()`/browser frame callbacks.

### Wet Material 3D

- Wetness
- Porosity
- Wet roughness target
- Darkening strength
- Optional puddle/ripple settings later

Wetness modifies the dry result after Core, Physical, and Pattern inputs are known. It must cache a
dry baseline per material generation, not repeatedly darken the previous wet frame.

### Tiled Custom Pattern Material 3D

Defined in `PATTERN_MATERIAL_PLAN.md`. It contributes procedural color/PBR/normal signals and
optional packed ingredient textures. It runs before Wet Material so wetness affects the composed
surface.

### BRDF Material

Retains its model and Callisto parameters. It registers the base-lighting shader injector but no
longer clones materials. Core material replacement automatically causes all contributors, including
BRDF, to attach to the new generation.

---

## 3. Shared material controller

Create `MaterialController3D.runtime.js` and initialize it once as
`gdjs.__materialController3D`. Use a `WeakMap` keyed by the root Three.js object; do not store
behavior objects or material instances in serializable `userData`.

Suggested controller state:

```js
{
  generation: 0,
  core: null,
  targets: [
    { mesh, slot, originalMaterial, liveMaterial }
  ],
  contributors: new Map(),
  textures: new Map(),
  state: 'Uninitialized',
  error: ''
}
```

Suggested contributor contract:

```js
{
  id: 'physical',
  order: 300,
  requiresPhysical(state) {},
  structuralKey(state) {},
  attach(material, context) {},
  updateUniforms(material, context) {},
  updateFrame(material, context, dt) {},
  detach(material, context) {},
  dispose(context) {}
}
```

Required controller API:

- `registerCore(object, behavior)` / `unregisterCore(...)`
- `registerContributor(object, instanceKey, contributor)`
- `unregisterContributor(object, instanceKey)`
- `setTargets(object, targetRecords)`
- `getTargets(object)` returning exact live `(mesh, slot, material)` records
- `requestUniformRefresh(object, contributorId)`
- `requestMaterialRebuild(object, reason)`
- `requestShaderRebuild(object, reason)`
- `acquireTexture(object, resourceName, options)` / `releaseTexture(handle)`
- `applyContributors(object, generation)`
- `tickContributors(object, dt)`
- `restore(object)` / `dispose(object)`

Registration must work in any GDevelop behavior order:

- If Core runs first, it builds the material; a later contributor registers and attaches to the live
  generation immediately.
- If a contributor runs first, it records its state; Core sees it when it builds later in the frame.
- Re-registering the same behavior instance replaces its registration without duplication.
- Removing a behavior detaches only that contributor and requests the smallest required refresh.

Each behavior instance needs a stable runtime registration key. Do not key only by behavior type,
because GDevelop may allow multiple behavior instances or user-selected instance names.

---

## 4. Material rebuild pipeline

A Core rebuild is transactional:

1. Resolve and snapshot exact target records.
2. Determine the required material class from Core plus every active contributor.
3. Build candidate materials without altering the live meshes.
4. Copy the intentionally preserved authored fields.
5. Apply Core properties and maps.
6. Attach contributors in declared order.
7. Install the shared shader chain once.
8. Commit each candidate to its original `(mesh, slot)`.
9. Increment the generation.
10. Dispose materials from the previous generation only after a successful commit.

If any required step fails, dispose the candidates and retain the prior live generation. This avoids
meshes referencing disposed or half-configured materials.

The target list must never be rebuilt by gathering every material from a touched mesh. A target of
slot 1 remains slot 1 after every contributor and rebuild.

### Refresh levels

Use the least expensive refresh that can express a change:

| Level | Examples | Recompile? |
| :--- | :--- | :---: |
| Frame update | UV scroll, flipbook time, video frame | No |
| Uniform update | Color, seed, scale, wetness, BRDF parameters | No |
| Shader rebuild | Pattern type, quality tier, feature enable/disable | Yes |
| Material rebuild | Standard ↔ Physical, target change, restore/reapply | Yes/new material |

Contributors declare which level each setter requires. Do not make every property setter clone the
material.

---

## 5. Texture ownership

Core maintains reference-counted handles for resource textures. A texture-cache key includes:

- resource name;
- color space;
- filter mode;
- wrap mode;
- atlas/packing interpretation;
- whether independent mutable UV state is required.

Decoded image sources should be shared. Texture objects may be cloned when UV transforms differ.
Contributor removal decrements its handles; Core disposes a clone only when its count reaches zero.
Original GDevelop textures are never disposed by the extension.

Video elements and `VideoTexture` instances belong to the registration that created them, but Core
coordinates their disposal before dropping the associated material generation.

---

## 6. Clean replacement strategy

Remove the monolithic `Material3D` behavior after its runtime logic has been moved into the
controller and focused behaviors. There is no legacy adapter, compatibility behavior, duplicated
property surface, or migration helper.

Use these stable internal names:

- `MaterialCore3D`
- `PhysicalMaterial3D`
- `AnimatedMaterial3D`
- `WetMaterial3D`
- `TiledCustomPatternMaterial3D`

`BRDFMaterial` keeps its existing internal name.

The old behavior's fields move as follows:

| Current group | New behavior |
| :--- | :--- |
| Apply, Targeting, Surface, Maps, Render State | Material 3D Core |
| Glass/Clearcoat and Sheen/Iridescence/Anisotropy | Physical Material 3D |
| UV Transform, Scrolling, Flipbook, Video | Animated Material 3D |
| Wetness | Wet Material 3D |

The extension version should receive a major bump because behavior names and ACEs change, but no
runtime migration path is required. Once the new behaviors pass composition testing, delete the old
behavior declaration and its monolithic runtime in the same change so there is only one supported
architecture.

---

## 7. Build layout

Suggested files:

```text
Material3D/
  ShaderChain.runtime.js
  MaterialController3D.runtime.js
  MaterialCore3D.runtime.js
  PhysicalMaterial3D.runtime.js
  AnimatedMaterial3D.runtime.js
  WetMaterial3D.runtime.js
  PatternMaterial3D.runtime.js
  BRDFMaterial.runtime.js
  build-extension.mjs
  test-material-controller.mjs
  test-material-core.mjs
  test-physical-material.mjs
  test-animated-material.mjs
  test-wet-material.mjs
  test-pattern-material.mjs
  test-brdf-material.mjs
  test-material-composition.mjs
```

The build script remains the source of truth for `Material3D.json`. Add validators for:

- exactly one runtime assigns `mesh.material`;
- only ShaderChain assigns `onBeforeCompile`/`customProgramCacheKey`;
- every contributor id and order is unique;
- every contributor setter names a declared property;
- structural options appear in the program cache key;
- uniform-only options do not appear in the cache key;
- behavior parameters bind to the correct behavior type;
- version and documented property/function counts agree with the generated manifest.

The first validator can allow narrowly reviewed assignment sites in Core rather than using a fragile
blanket substring rule.

---

## 8. Extraction sequence

### Phase 0 — repair before extraction

1. Fix BRDF clone ownership so repeated reapply does not leak displaced clones.
2. Fix BRDF reattachment so a selected material slot never expands to all slots on the mesh.
3. Make `BRDF patch is active` report actual successful shader injection.
4. Synchronize extension version, README counts, and generated description.
5. Add disposal and multi-material regression tests.

**Exit:** the current monolith has trustworthy lifecycle behavior before code is moved.

### Phase 1 — introduce the controller and Core

1. Create `MaterialController3D.runtime.js`.
2. Move target records, original materials, generations, transactional rebuild, and disposal into it.
3. Create `MaterialCore3D` and move the Core property groups and ACEs into it.
4. Convert BRDF from cloning to a controller contributor.
5. Port the relevant existing tests plus new lifecycle tests to Core/controller fixtures.

**Exit:** Core reproduces the common material behavior and only the controller owns materials.

### Phase 2 — extract Physical Material 3D

1. Add the new behavior and move physical-only properties/setters.
2. Implement `requiresPhysical` negotiation with Core Auto mode.
3. Test enable/disable and Standard/Physical promotion/demotion cycles.

**Exit:** physical features work through the new contributor with no double apply.

### Phase 3 — extract Animated Material 3D

1. Move UV state and frame updates.
2. Move flipbook state/actions/conditions.
3. Move video lifecycle behind controller texture handles.
4. Verify texture reuse, play/pause/seek, restore, and removal.

**Exit:** animation can be added or removed without rebuilding unrelated material properties.

### Phase 4 — extract Wet Material 3D

1. Move wetness and dry-baseline state.
2. Apply wetness after pattern/physical surface values.
3. Verify drying restores the current composed dry result, not only the original model value.
4. Keep the contributor ready for later ripple injection.

**Exit:** wetness composes with Core, BRDF, and Physical without cumulative darkening.

### Phase 5 — remove the monolith and finalize the divided extension

1. Delete the old `Material3D` behavior declaration and monolithic runtime after all logic is moved.
2. Publish Material 3D Core with its final focused property list.
3. Split tests and API references by behavior.
4. Update README, manifest version, counts, examples, and behavior descriptions.
5. Run real GDevelop editor/runtime verification before declaring the split stable.

### Phase 6 — implement Tiled Custom Pattern Material 3D

Proceed through `PATTERN_MATERIAL_PLAN.md` only after the contributor API and material generations
are stable.

---

## 9. Composition tests

Test every single behavior and these combinations:

| Combination | Critical assertion |
| :--- | :--- |
| Core + Physical | Auto promotes to Physical and demotes safely. |
| Core + Animated | UV updates touch only target textures/material slots. |
| Core + Wet | Wet/dry cycles do not compound color. |
| Core + BRDF | Rebuild retains injector without cloning/leaking. |
| Core + Pattern | Recipe shader attaches to the current generation. |
| Core + Pattern + Wet | Wetness modifies the composed pattern result. |
| Core + Physical + BRDF | Physical fields and custom diffuse both survive rebuild. |
| All contributors | Declared ordering is stable and every injector reports landing. |

Run 100 cycles of target changes, class promotion/demotion, preset changes, behavior removal, and
restore. Assert that live material/texture counts return to baseline and no disposed object remains
attached to a mesh.

---

## 10. User-facing experience

A typical object should need only:

- **Material 3D Core** for ordinary PBR control;
- plus one or two specialized behaviors for the desired effect.

Examples:

```text
Glass window     = Core + Physical
Animated screen  = Core + Animated
Wet cobblestone  = Core + Pattern + Wet
Stylized cloth   = Core + Physical + BRDF
Plain model tint = Core only
```

Contributor behaviors should show a clear diagnostic when Core is missing: “Material 3D Core is
required on this object.” They should remain idle rather than independently replacing the material.

Core diagnostics should list active contributors, for example:

```text
physical, pattern-material, wetness, brdf
```

---

## 11. Definition of success

The split is complete when:

1. only Core/controller code assigns or disposes mesh materials;
2. each focused behavior can be added, removed, and updated independently;
3. attachment order does not change the result;
4. exact mesh/material-slot targeting survives every rebuild;
5. no material or texture count grows during repeated apply/restore cycles;
6. the monolithic behavior and its duplicate runtime paths have been removed;
7. common property changes update uniforms/settings without unnecessary shader compilation;
8. Pattern Material can be implemented entirely through the contributor contract;
9. automated tests and a real GDevelop scene verify every supported composition.
