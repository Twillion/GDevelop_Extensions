# LightProbeGrid3D — Extension Overview

**LightProbeGrid3D** gives dynamic 3D objects in **GDevelop 5** indirect ambient light that varies
with *where they are standing*. A character walking under a canopy, into a cave, or along a red-lit
corridor picks up the ambient colour of that place, instead of the single flat ambient value a scene
otherwise gets.

It does this by baking the scene's ambient light into a small 3D texture and sampling it per
fragment, which costs no additional draw calls and about 16 KB of VRAM at default settings.

> **Status: Implemented and Verified.** The runtime engine (`LightProbeGrid3D.runtime.js`),
> extension builder (`build-extension.mjs`), and extension JSON (`LightProbeGrid3D.json`) are built
> and pass all verification tests against the installed GDevelop runtime (Three r160, PIXI 7.4.2).

---

## What it does that a HemisphereLight does not

GDevelop already ships a `HemisphereLight` effect that blends a sky colour into a ground colour by
surface orientation, for free. **If all you want is a sky/ground gradient, use it — this extension
would give you the same picture with more setup.**

What a probe grid adds is *occlusion and spatial variation*: the cave is dark because there is rock
overhead, and the corridor is red because the wall beside it is red. That information only comes from
sampling the actual scene, which is why **baking is the feature**, not an optional extra.

The extension does ship an altitude-gradient fallback, so objects look sensible before the first
bake. On its own, that fallback is equivalent to a HemisphereLight — it is a starting point, not the
destination.

---

## Key points

- **WebGL2 3D textures (`sampler3D`).** One hardware-filtered fetch per fragment returns the
  interpolated ambient colour at that point in the world.
- **Small.** The default 16 × 16 × 4 grid is 8 KB; a dense 32 × 8 × 32 day+night pair is 128 KB.
- **No additional draw calls.** The extension injects into existing materials rather than adding
  lights. It does add one shader program, two texture units and a per-draw uniform upload.
- **Day / night blending.** Two baked states, blended on the GPU by a single global factor — no CPU
  recomputation, no rebake.
- **Debug visualiser.** Instanced probe spheres tinted by their sampled colour, one draw call, in
  **preview and runtime**. Not in the editor — a `.json` extension has no editor rendering hook.

---

## Requirements and limits

| | |
| :--- | :--- |
| **WebGL2** | Required. On a WebGL1 context the extension disables itself and logs once; `sampler3D` does not exist in GLSL ES 1.00, so there is no degraded mode. Check `LightProbeGrid::IsSupported()` before your setup events. |
| **Lit materials** | Model3D objects set to material type **Basic**, and Basic Cube3D faces, cannot receive probe light — `MeshBasicMaterial` has no lighting at all. The behavior warns, naming the object. |
| **Units** | GDevelop world units (pixels). A humanoid character is typically 50–200 units tall. |
| **Working scale** | Sensible from roughly a room up to a few thousand units per axis. At the default 16 probes per horizontal axis, a 2,000-unit level gives ~125-unit spacing — about a character-and-a-half. Beyond that, raise resolution and accept the bake cost. |
| **Volumes per scene** | One. Overlapping-volume blending is a v2 feature. |

---

## Quick Start

1. **Define the volume.** Add a **Cube3D** to your scene, stretch it over the level with the 3D scale
   gizmo, add the `LightProbeVolume3D` behavior, and set the cube's opacity to 0. The cube's bounds
   are the volume's bounds.
2. **Set colours and resolution.** Sky colour, ground bounce colour, and probes per axis. The
   defaults (16 × 16 × 4) suit a single level; note that **Z is the height axis** in GDevelop.
3. **Attach the receiver.** Add `ReceiveLightProbes` to your player, enemies, and props.
4. **Bake.** Call `LightProbeGrid::StartBake()` once and poll `IsBakeComplete()`. This is the step
   that produces cave shadowing and coloured bounce; until you run it you have a sky/ground gradient
   and nothing more. Export with `ExportProbeData` so shipping builds load the result instead of
   rebaking.
5. **Play.** Your characters' ambient light now changes as they move through the level.

Baking is not instant. At the default 1,024 probes it is a few thousand scene renders, amortised
across frames under a per-frame millisecond budget so the game stays responsive. Raising resolution
raises that cost as the product of all three axes: 32 × 8 × 32 is eight times the work of the
default.

---

## Directory contents

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — architecture, the nineteen corrections made
  against the installed GDevelop runtime, shader injection pipeline, phases, and the verification
  plan.
- [API_REFERENCE.md](./API_REFERENCE.md) — behaviors, actions, conditions, expressions, the `.lpg.bin`
  format, and the GLSL interface.

Both documents cite the runtime facts they depend on, read from
`C:\Users\chris\AppData\Local\Programs\GDevelop\resources\GDJS\Runtime\` (Three r160, PIXI 7.4.2).
The four that shape the design most: the 3D scene root is mirrored on Y, up is Z, materials are
shared game-wide, and `useLegacyLights` is on.
