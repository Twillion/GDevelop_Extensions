# Material 3D

**Author:** Christopher Monhollen (`Twillion`) · **Version:** 3.0.0 · **Category:** 3D
**Tested against:** GDevelop 5 with Three.js r160 / PIXI 7.4.2

One extension, two behaviors, replacing four.

| Behavior | What it does |
| :--- | :--- |
| **Material 3D** | Sets material fields — PBR maps, colour, glass, alpha, shadows. 57 properties, 76 functions. |
| **BRDF Material** | Patches the material's shader to swap the diffuse lighting model. 13 properties, 17 functions. |

> **Status: built and unit-tested, NOT yet run in GDevelop.** `node Material3D/test-material3d.mjs`
> passes 38 checks against the real runtime under a stub Three.js, and the build script validates
> every JS block, property key and parameter binding. None of that is a substitute for loading the
> extension in the editor — see [Verifying](#verifying) for the scene that would.

---

## What this replaces

| Extension | Version | Disposition |
| :--- | :---: | :--- |
| Animated & Custom PBR Material 3D | 2.0.0 | **Base.** Its runtime is the core of Material 3D. |
| Advanced 3D Material | 1.0.0 | Diagnostics, runtime retargeting and per-property setters absorbed. |
| Advanced Materials *(by Antigravity)* | 1.3.1 | Transmission / IOR / thickness / clearcoat **reimplemented, not copied** — see [Attribution](#attribution). |
| BRDF Materials | 3.2.0 | Kept whole, as the second behavior. Not merged. |

---

## Why BRDF is a separate behavior

The three material extensions all did the same *kind* of thing — build a Three.js material and
assign fields — so merging them lost nothing. BRDF Materials does something categorically different:
it leaves the material alone and patches its **shader** through `onBeforeCompile`, rewriting the
diffuse lighting term to one of 13 models (Oren-Nayar, Minnaert, Toon, Velvet, Callisto, Kajiya-Kay…).

Folding it into the material behavior would produce one behavior where selecting a BRDF model makes
~30 properties inert, and setting a material property makes ~12 inert. Two behaviors in one extension
is the honest shape.

### They used to break each other

This is the bug worth knowing about, because it produced **no error of any kind**. If a material
override behavior replaced the material *after* BRDF had patched it, the patched clone was discarded
along with its `onBeforeCompile` hook and `userData.__brdf*` state. The surface silently reverted to
the stock Three.js diffuse and nothing appeared in the console.

Material 3D now calls `gdjs.__brdfMaterial3D.reapplyIfPatched()` immediately after it applies, so the
patch is rebuilt on top of the new material. Stack them in either order and both survive. The
**BRDF patch is active** condition reports the state directly if you want to assert it.

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
| **Expressions** | `State()` · `LastError()` · `MaterialClass()` · `MatchingMeshCount()` · `MatchingMaterialCount()` · `RetryCount()` |

When a material does not appear, `HasMatchingMeshes` plus `MatchingMeshCount()` tells you in one
condition whether the problem is your targeting or something else.

---

## Everything is settable at runtime

All 57 properties have setter actions. This includes **which** material is targeted — `Set target
mode`, `Set material index`, `Set material name`, `Set mesh name` — which the base extension could
only set in the editor.

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
node Material3D/build-extension.mjs
```

Never hand-edit `Material3D.json` — it is generated. The build refuses to write if any JS block fails
to parse, a control character appears (a NUL truncates a JsCode block and surfaces much later as
"`<Action>` is not a function"), a behavior serializes `properties` instead of `propertyDescriptors`,
a behavior parameter is bound to the wrong type, a condition never assigns
`eventsFunctionContext.returnValue`, or a setter overrides a property that was never declared.

```bash
node Material3D/test-material3d.mjs
```

38 checks covering material-class selection, the Preserve defaults, the override layer, the
diagnostics, mesh-name targeting, restore, and the BRDF composition hook.

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

## Attribution

`Advanced Materials` v1.3.1 is authored by **Antigravity**, not by this project. Its transmission,
IOR, thickness and clearcoat features are present here, but the implementation was **written fresh
against the Three.js `MeshPhysicalMaterial` API** rather than copied — those fields are direct
assignments and the Three.js documentation is the only reference needed. No code from that extension
is in this one.

If you have permission to use Antigravity's work directly, crediting them here would be the right
thing regardless.
