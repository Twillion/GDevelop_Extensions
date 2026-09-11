# Material extension consolidation — plan

**Scope:** `AnimatedPBR3D` v2.0.0, `AdvancedMaterials` v1.3.1, `Advanced3DMaterial` v1.0.0,
`BRDFMaterials` v3.2.0.

**Verdict up front: consolidate three, not four.** `BRDFMaterials` must stay a separate extension —
see §1. The other three collapse into one behavior with no capability lost.

---

## 1. Why BRDF Materials is not part of the merge

The four extensions look like four takes on the same idea. They are not. Read from the code, not the
READMEs:

| Extension | What it does to the Three.js material | Namespace |
| :--- | :--- | :--- |
| `AnimatedPBR3D` | **Replaces** it with `MeshStandardMaterial` | `gdjs.__animatedPBR3D` |
| `AdvancedMaterials` | **Replaces** it with `MeshPhysicalMaterial` | `gdjs.__advancedMaterials`, `gdjs.__blenderMaterial` |
| `Advanced3DMaterial` | **Replaces** it with `MeshBasicMaterial` / `MeshStandardMaterial` | `gdjs.__advanced3DMaterial` |
| `BRDFMaterials` | **Patches the existing material's shader** via `onBeforeCompile`; keeps state in `userData.__brdf`, `__brdfOriginal`, `__brdfPatched`, `__brdfUniforms` | *(none — operates on `userData`)* |

The first three are *property overrides* — they build a material and assign fields. BRDF is a
*shader injection* — it intercepts compilation and rewrites the lighting math to one of 13 diffuse
models (Oren-Nayar, Minnaert, Toon, Velvet, Kajiya-Kay…). It shares exactly **one** property name
with the others (`Roughness`) and 2 lines of boilerplate code.

Merging them would produce a behavior where selecting "BRDF mode" makes 30-odd properties inert, and
selecting "PBR mode" makes 12 inert. That is worse than two behaviors.

**The real issue is that they silently break each other.** If a property-override behavior replaces
the material *after* BRDF patched it, the `onBeforeCompile` hook and `userData.__brdf*` state go with
the discarded material — BRDF stops working with no error. This is a live bug for anyone stacking
them today.

**Action:** keep `BRDFMaterials` separate, and make it composable — see §6.

---

## 2. Target: one `Material3D` behavior from three

`AnimatedPBR3D` is the base. It is the newest (v2.0.0), the only one with a maintainer review, and
the only one carrying texture maps, UV animation and flipbook — 47 properties to the others' 27
and 15.

What each contributes:

| Source | Unique capability to absorb | Properties | Functions |
| :--- | :--- | :--- | :--- |
| **AnimatedPBR3D** *(base)* | Albedo/Normal/Roughness/Metalness/AO/Emissive maps; UV tiling, offset, rotation; scroll; flipbook; video | 47 | 27 |
| **AdvancedMaterials** | **Transmission, IOR, Thickness, Clearcoat, ClearcoatRoughness** — requires `MeshPhysicalMaterial` | 5 of 15 | 32 |
| **Advanced3DMaterial** | `UpdateMode`, `ShaderType`, `Fog`, `RenderOrder` — **plus three whole API layers, see §2a** | 4 of 27 | 51 |
| **BRDFMaterials** | *(not merged)* | — | 17 |

On properties alone the merge adds **9** to AnimatedPBR3D's 47 → **56 total**. But properties are the
smaller half of what `Advanced3DMaterial` is carrying.

---

## 2a. `Advanced3DMaterial` is the diagnostics and runtime-control layer

**Correction to an earlier draft of the audit,** which called this extension "fully covered by the
other three" and the clear candidate to retire. That is true of its *properties* and false of its
*API*. **34 of its 51 functions have names that appear in no other material extension.** It is the
richest of the four by event surface, and the three layers below exist nowhere else.

### Layer 1 — application state and diagnostics *(nothing else has any of this)*

| Function | Type | |
| :--- | :--- | :--- |
| `IsReady` / `IsWaiting` / `IsSuccess` / `IsFailed` | Conditions | material application lifecycle |
| `State` | String expression | the state as text |
| `RetryCount` | Expression | how many times application retried |
| `HasMatchingMaterials` / `HasMatchingMeshes` | Conditions | did the targeting match anything |
| `MatchingMaterialCount` / `MatchingMeshCount` | Expressions | how many it matched |

This matters more than it looks. **3D material work in GDevelop fails silently** — a wrong mesh name,
a material that was not cloned, a renderer that was not ready yet, all render as "nothing happened"
with a clean console. `AnimatedPBR3D` offers one condition (`IsMaterialReady`) against this entire
class of problem; `AdvancedMaterials` offers `LastError`. This extension is the only one that can
answer *"did it apply, to how many meshes, and if not why."*

### Layer 2 — runtime retargeting *(nothing else has this)*

`SetTargetMode`, `SetMaterialIndex`, `SetMaterialName`, `SetMeshName`, plus `ReapplyMaterial` and
`MarkSettingsChanged`.

In `AnimatedPBR3D` the targeting properties — which mesh, which material slot, which name — are
**editor-only**. You choose at design time and cannot change which material the behavior drives while
the game runs. This extension makes targeting a runtime decision.

### Layer 3 — render-state setters

`SetCastShadow`, `SetReceiveShadow`, `SetWireframe`, `SetTextureFiltering`, `SetMaterialSide`,
`SetAlphaCutoff`, `SetRenderOrder`, `SetEmissionEnabled`.

### The coverage gap this exposes in the base

Counting how many properties are reachable from events at all — action, condition or expression:

| Extension | Reachable | Editor-only |
| :--- | :---: | :---: |
| `AnimatedPBR3D` | 29 of 47 | **18** |
| `Advanced3DMaterial` | 23 of 27 | 4 |
| `AdvancedMaterials` | 15 of 15 | 0 |

`AnimatedPBR3D`'s 18 editor-only properties are `ApplyOnCreation`, `IncludeChildren`, `TargetMode`,
`CloneMaterials`, `UseBaseColor`, `BaseColor`, `AOIntensity`, `EmissiveColor`, `TextureFiltering`,
`RotationAngle`, `AlphaMode`, `Alpha`, `AlphaCutoff`, `DepthWrite`, `MaterialSide`, `Wireframe`,
`CastShadow`, `ReceiveShadow`. **`Advanced3DMaterial` already exposes 13 of those 18 to events.**

Its actions are also *grouped by task* where AnimatedPBR3D's are not — `SetEmissiveTexture` takes map,
R, G, B and strength in one action rather than five. Both styles are defensible; the merged extension
should pick one deliberately rather than inheriting a mix.

**Revised disposition:** `Advanced3DMaterial` is not the one to retire quietly. Its properties are
redundant; **its API is the most valuable single thing in this consolidation.** Port the three layers
above into the merged behavior before retiring the extension, and treat that port as the main body of
work, not an afterthought.

### The material-class problem

Absorbing Transmission/IOR/Clearcoat means the behavior must build a `MeshPhysicalMaterial`, not a
`MeshStandardMaterial`. `MeshPhysicalMaterial` extends `MeshStandardMaterial`, so this is safe — but
it is heavier to render. **Pick the class at apply time:** use `MeshPhysicalMaterial` only when one of
the five physical properties is non-default, otherwise `MeshStandardMaterial`. Advanced3DMaterial's
`ShaderType` property already models exactly this choice (it can select Basic vs Standard) and should
be widened to `Basic / Standard / Physical / Keep Original` rather than added alongside a second
switch.

---

## 3. Naming conflicts — decide these before writing code

The three extensions named the same concepts differently. These are the only true collisions:

| Concept | AnimatedPBR3D | AdvancedMaterials | Advanced3DMaterial | **Recommended** |
| :--- | :--- | :--- | :--- | :--- |
| Metalness | `Metalness` | `Metallic` | `Metallic` | **`Metalness`** — matches the Three.js field name `material.metalness` |
| Emissive colour | `EmissiveColor` | `EmissionColor` | `EmissionColor` | **`EmissiveColor`** — matches `material.emissive` |
| Emissive amount | `EmissiveStrength` | `EmissionStrength` | `EmissionStrength` | **`EmissiveStrength`** — matches `material.emissiveIntensity` |
| Emissive on/off | *(implicit)* | `UseEmission` | `EmissionEnabled` | **`UseEmissive`** — pairs with `UseBaseColor` |
| Face side | `MaterialSide` | `Side` | `MaterialSide` | **`MaterialSide`** — 2 of 3 already |

Rule applied: **follow the Three.js field name.** It is the one convention that does not require
remembering which extension you came from.

`BRDFMaterials` separately uses `ColorR` / `ColorG` / `ColorB` as three Numbers where every other
extension uses a single `Color`-typed property. Worth fixing in BRDF on its own schedule; not part of
this merge.

---

## 4. Default-value conflicts — these change how existing projects look

Two properties share a name across extensions but disagree on the default. Whichever you pick, some
existing project renders differently after migrating:

| Property | AnimatedPBR3D | AdvancedMaterials | Advanced3DMaterial | Recommended |
| :--- | :--- | :--- | :--- | :--- |
| `AlphaMode` | `Opaque` | **`Preserve`** | `Opaque` | **`Preserve`** |
| `EmissionColor` → `EmissiveColor` | `0;0;0` | **`255;255;255`** | `0;0;0` | **`0;0;0`** |

- **`AlphaMode`:** choose `Preserve`. `Opaque` as a default means simply attaching the behavior
  silently flattens transparency on any model that had it. `Preserve` is the non-destructive default,
  and it is what Antigravity's extension already does. AdvancedMaterials also defaults `Side` to
  `Preserve` for the same reason — carry that through as `MaterialSide: Preserve`, which means adding
  a fourth choice to the existing 3-choice list.
- **`EmissiveColor`:** choose `0;0;0` (black = no emission). White-plus-`UseEmission:false` works only
  because a separate flag gates it; black is correct on its own and matches 2 of 3.

**Migration consequence:** anyone moving from `AdvancedMaterials` keeps their look. Anyone moving from
`AnimatedPBR3D` or `Advanced3DMaterial` who *relied* on the behavior forcing opacity will see
transparency return. That is a real behaviour change and belongs in the release notes.

---

## 5. Licensing — resolve before any code moves

`AdvancedMaterials` is authored **`Antigravity`**, not you. It is currently published inside
`Twillion-s-Extensions/`, whose LICENSE reads *"MIT License, Copyright (c) 2026 Twillion"* and covers
everything in the folder.

The five properties worth absorbing — Transmission, IOR, Thickness, Clearcoat, ClearcoatRoughness —
are the *most* distinctive thing that extension does. Absorbing them into a Twillion-authored
extension is the part of this plan that is not purely technical.

**Do this first, before writing any merge code:**

1. Establish what Antigravity's terms actually are. There is no URL, `authorIds`, or `helpPath` in the
   file to check against — you know where it came from; the file does not say.
2. If permission is clear → absorb, and credit Antigravity in the merged extension's description and
   in the repo LICENSE.
3. If permission is unclear or absent → **do not absorb the code.** Reimplement the five physical
   properties directly against `MeshPhysicalMaterial`; they are thin assignments (`material.transmission = x`)
   and the Three.js docs are the only reference needed. The concepts are not ownable, the code is.
4. Either way, correct the blanket MIT claim in `Twillion-s-Extensions/LICENSE` so it does not assert
   copyright over a third party's work.

**A merge is not required to fix the licensing problem.** That is worth doing on its own.

---

## 6. Making BRDF compose instead of collide

Independent of the merge, and cheap:

1. In the merged behavior, when replacing a material, **carry over `userData.__brdf*` and re-apply the
   `onBeforeCompile` patch** to the new material rather than discarding it.
2. Document the ordering requirement: material override applies first, BRDF patches second.
3. Add a condition to BRDF — *"BRDF patch is active"* — so the failure is visible in-editor instead of
   silently rendering unpatched.

Optional, and better if you get there: have the merged behavior expose a documented
`userData.__materialReplaced` counter that BRDF can watch to re-patch itself automatically.

---

## 7. Sequence

Each step is independently useful. Stop at any point and nothing is half-done.

| # | Step | Depends on |
| :---: | :--- | :--- |
| 1 | Fix `Advanced3DMaterial`'s `properties` → `propertyDescriptors` key. It is broken today; a broken extension cannot be meaningfully test-merged. | — |
| 2 | Resolve the Antigravity licensing question (§5). | — |
| 3 | Fix the `Twillion-s-Extensions/LICENSE` blanket claim. | 2 |
| 4 | Agree the naming table (§3) and default table (§4). | — |
| 5 | Widen `ShaderType` to `Basic / Standard / Physical / Keep Original`; add the material-class selection logic to AnimatedPBR3D. | 4 |
| 6 | Absorb the 4 Advanced3DMaterial properties (`UpdateMode`, `Fog`, `RenderOrder`, and `ShaderType` from step 5). | 1, 5 |
| 6a | **Port Advanced3DMaterial's three API layers (§2a)** — diagnostics/state, runtime retargeting, render-state setters. This is the largest single piece of work in the plan and the one with the most value. | 1, 6 |
| 6b | Close the base's coverage gap: give the remaining 5 of its 18 editor-only properties a runtime path, or decide deliberately that they stay editor-only. | 6a |
| 7 | Add the 5 physical properties — absorbed or reimplemented per step 2. | 2, 5 |
| 8 | Rename per §3, bump to **v3.0.0** (breaking: property names change). | 4, 6, 7 |
| 9 | Make BRDF compose (§6). | 8 |
| 10 | Deprecate `AdvancedMaterials` and `Advanced3DMaterial` — leave them in the repo as records, mark them superseded in the publish README, do not delete. | 8 |

**Do not skip step 1.** Merging into or out of a known-broken extension means you cannot tell a merge
regression from the pre-existing bug.

---

## 8. Verification

None of this is provable by reading JSON — the failure modes here (`behavior is not defined`, silent
material-swap, shader patch lost) all appear only at runtime, and the last one produces *no error at
all*. Each step needs a run in GDevelop before the next is built on it.

Minimum scene to exercise it:

- One `Cube3D` and one `Model3D` with an existing `.glb` material, so both the "build from nothing"
  and "override an existing material" paths run.
- One object with **transparency already set**, to catch the `AlphaMode` default change from §4.
- One object carrying **both** the merged behavior and `BRDFMaterial`, to confirm §6.
- One object with a **texture map plus scrolling** enabled, to confirm the base extension's own
  features survived the material-class change in step 5.

Check after each: the properties appear in the editor panel at all (catches the §7-step-1 class of
bug), the object renders, and the console is clean.

---

## 9. What this costs and what it buys

**Buys:** one behavior instead of three; 56 properties instead of 47 + 27 + 15 with 22 overlapping
names; one naming convention; the `Advanced3DMaterial` breakage retired rather than fixed; the
BRDF-collision bug fixed; the licensing exposure closed. **And the thing that is easiest to miss —
a material behavior that can tell you whether it actually worked** (§2a), which none of the four can
do today except the broken one.

**Costs:** a breaking version bump, a real appearance change for projects relying on the `Opaque`
default, and a `MeshPhysicalMaterial` path that is heavier than `MeshStandardMaterial` if the class
selection in step 5 is done carelessly.

**Not worth doing:** merging BRDF (§1), or deleting the superseded extensions rather than marking them
superseded — this repo is a personal record, and they are the only copy of what shipped.
