# AdvancedLighting3D — Clustered Dynamic Lighting, Baked Indirect GI & SDF Soft Shadows

**AdvancedLighting3D** is a complete dynamic lighting architecture and material pipeline for
**GDevelop 5 (Three.js WebGL2 backend)**. It covers direct light, indirect GI, and raymarched soft shadows:

1. **Direct light.** By partitioning the camera view frustum into a 3D grid of **3,456 spatial clusters**
($16 \times 9 \times 24$ depth slices), it can register up to **512 active dynamic lights**
(torches, streetlamps, campfires, neon signs, magic spells, muzzle flashes) without shader
recompilation for ordinary light updates (Karis area light specular
reflections, blackbody Kelvin colour temperatures, IES photometric profiles, and spot cones).

2. **Indirect light.** A **`LightProbeVolume3D`** bakes the scene's ambient into a small RGBA16F 3D
texture that **`ReceiveLightProbes`** objects sample per fragment, so a character walking under a
canopy, into a cave, or along a red-lit corridor picks up the ambient colour of *that place* instead
of the single flat ambient value a scene otherwise gets. About 16 KB of VRAM at default settings and
no additional draw calls.

3. **SDF Soft Shadows.** An **`SDFVolume3D`** bakes scene geometry into an
R16F 3D Signed Distance Field via exact Ericson triangle queries and Felzenszwalb's $O(N)$ separable
Euclidean Distance Transform. The injected PBR shader raymarches this distance field with Quilez's
improved penumbra estimator, delivering approximate contact-hardening soft shadows for the
directional Sun in SDF mode and clustered local lights in SDF/Hybrid modes. Local shadow candidates are ordered by distance to each cluster center; the per-fragment budget defaults to four. This is a conservative surface-distance approximation; small features require sufficient voxel resolution.

> **Why one extension.** All three systems inject into the same `lights_fragment_begin` chunk of the same
> shared materials. Unifying them provides **one injection, one customProgramCacheKey and one
> post-events tick**, guaranteeing that direct clustered lights, probe irradiance, and SDF raymarched
> shadows evaluate in optimal mathematical order with zero cache collisions.

---

## 🌟 Key Highlights

- **Clustered light evaluation:** Up to 512 registered lights; each pixel evaluates up to 64 entries in its cluster. Cost depends on overlap and shadow settings.
- **Zero Shader Recompilation Stutter:** Light data is streamed dynamically through WebGL2 DataTextures and 3D textures (`sampler3D`), eliminating all runtime shader recompilations when lights spawn, move, or extinguish.
- **Physically Based Area Lights (Karis Model):** Replaces artificial pinpoint specular reflections with realistic broad reflections for glowing embers, light bulbs, and neon tube/capsule lights.
- **Blackbody Radiation Color Temperature:** Set authentic physical lighting in Kelvin (1,800K candle flames to 8,500K moonlight).
- **IES Photometric Profiles:** Real-world architectural light distributions (wall sconces, streetlamps, spotlights, downlights), carried to the GPU in the fourth light texel.
- **Volumetric SDF Soft Shadows:** Fast 3D Signed Distance Field raymarching using Inigo Quilez's penumbra estimator. Contact-hardening soft shadows for the directional Sun and clustered local lights. CSM uses native shadow-map passes for the Sun in Hybrid mode.
- **O(N) Separable Euclidean Distance Transform:** Static geometry is converted into high-precision distance volumes using Ericson triangle distance tests and 3-axis Felzenszwalb parabolic envelopes under an amortised frame budget.
- **Baked Indirect Light Probes:** A 3D grid of probes captures occlusion and coloured bounce, sampled with one hardware-filtered `sampler3D` fetch per fragment. Caves go dark because there is rock overhead; the corridor goes red because the wall beside it is red.
- **Day / Night Probe Blending:** Two baked states blended on the GPU by a single global factor — no CPU recomputation, no rebake.
- **Binary Stream Files (.lpg.bin & .sdf.bin):** Both probe grids and SDF distance volumes can be exported during authoring and loaded instantly in shipping builds with zero runtime baking.
- **Hybrid Co-Existence Pipeline:** Seamlessly adds to GDevelop's native Sun, skybox and ambient light without breaking changes.

---

## 📐 The Unified Lighting Pipeline

```mermaid
flowchart TD
    subgraph "1. Dynamic Scene Lights & SDF Volume"
        L1["Point Lights & Torches"]
        L2["Neon Tubes & Area Capsules"]
        L3["Spotlights & Flashlights"]
        L4["Directional Sun Light"]
        SDFVol["SDF Volume 3D Grid"]
    end

    subgraph "2. CPU View-Space Broadphase (< 0.1ms)"
        Cam["Camera View Transform"]
        Frustum["16 x 9 x 24 Logarithmic Cluster Grid"]
        Arvo["Arvo Sphere/Cone-to-AABB Tests"]
    end

    subgraph "3. Packed WebGL2 GPU Buffers (< 1 MB VRAM)"
        TexLight["uClusteredLightData (RGBA32F)<br/>PosXYZ, Radius, ColorRGB, ShadowFlag, SrcRadius"]
        Tex3D["uClusterGrid3D (Data3DTexture RG32UI)<br/>16x9x24 Voxels -> (Offset, Count)"]
        TexIdx["uLightIndexList (DataTexture R16UI)<br/>Concatenated Light Index Stream"]
        TexSDF["uSdfVolume (Data3DTexture R16F)<br/>Global Signed Distance Field Volume"]
    end

    subgraph "4. Injected PBR Material Shader"
        Frag["gl_FragCoord + Linear View Depth"]
        Lookup["Sample (Offset, Count) in 3D Cluster Texture"]
        Karis["Karis Area Specular + Frostbite Windowed Attenuation"]
        Shape["IES Profile + Spot Inner/Outer Cone"]
        Raymarch["Quilez SDF Shadow Raymarcher (Sun + Clustered)"]
        Probe["Probe Grid Irradiance (receivers only)"]
    end

    L1 --> Cam
    L2 --> Cam
    L3 --> Cam
    Cam --> Frustum
    Frustum --> Arvo
    Arvo --> TexLight
    Arvo --> Tex3D
    Arvo --> TexIdx
    SDFVol --> TexSDF

    TexLight --> Karis
    Tex3D --> Lookup
    TexIdx --> Lookup
    Frag --> Lookup
    Lookup --> Karis
    Karis --> Shape
    TexSDF --> Raymarch
    L4 --> Raymarch
    Shape --> Raymarch
    Raymarch --> FinalLit["Final Lit Surface"]
    Probe --> FinalLit
```

---

## 📊 Comparison: Standard GDevelop Lighting vs. AdvancedLighting3D

| Metric / Capability | Standard GDevelop 3D Lighting | AdvancedLighting3D |
| :--- | :--- | :--- |
| **Max Dynamic Lights** | Depends on the renderer and material path | **64–512 registered lights (256 default), with at most 64 in one cluster** |
| **CPU cost of 100 Lights** | One draw path per light | **~1.3 ms broadphase, measured** (see below; GPU cost unprofiled) |
| **Shader Hitching on Spawn** | Light-count changes can alter the render path | **Ordinary light updates stream through textures without recompiling** |
| **Specular Reflections** | Pinpoint plastic white dots | **Realistic Area Lights (Karis Tube & Sphere)** |
| **Light Color Modeling** | Manual RGB hex codes | **Kelvin Blackbody Temperature (1,800K–8,500K)** |
| **Light Profiles** | Uniform spheres only | **IES Photometric Lobes (Sconces, Downlights)** |
| **Dynamic Shadows** | Traditional shadow maps: multi-pass rasterization, acne, peter-panning, strictly limited light count | **SDF Raymarched Soft Shadows: single 3D distance field, contact hardening, Sun + clustered lights, zero extra draw calls** |
| **Indirect / Ambient Light** | One flat ambient value for the whole scene | **Spatially varying baked probe grid (occlusion + coloured bounce)** |
| **Ambient in a Cave** | Same as outdoors | **Dark, because the bake saw rock overhead** |
| **Day / Night Ambient** | Manual re-tint | **Two baked volumes blended by one GPU factor** |
| **GPU VRAM Overhead** | Depends on native light and shadow settings | **Cluster buffers scale with MaxLights; probes and SDF scale with volume resolution; CSM scales with cascade count and map size** |

---

## Shadow modes and CSM

Hybrid is the default. CSM follows the first visible native directional Sun on the base 3D layer; it does not add another source of brightness. If there is no native Sun, CSM stays inactive. Add one in GDevelop before expecting Sun shadows.

| Mode | Sun shadows | Clustered local-light shadows |
| --- | --- | --- |
| Off | Disabled | Disabled |
| CSM | Cascaded shadow maps | Disabled |
| SDF | Baked distance field | Baked distance field |
| Hybrid | Cascaded shadow maps | Baked distance field |

Use SetShadowMode, or add one **AdvancedShadowManager3D** to configure the scene in the inspector. CSM supports 2–4 cascades (default 3), 1024/2048/4096 maps (default 2048), maximum distance, practical split lambda, depth/normal bias, PCF softness and seam blending. Fitting handles the mirrored Y root and Z-up coordinates, snaps to shadow texels, overlaps cascade transition bands and fades the final cascade to unshadowed Sun. Meshes keep their authored Three.js `castShadow` and `receiveShadow` flags, so enable those flags on the casters and receivers that should participate. Mode changes and scene cleanup release owned maps and restore renderer settings.

SDF baking now yields during voxel seeding, each distance-transform scanline, and conversion. Geometry collection and GPU texture upload remain synchronous. Deleting/resizing a volume cancels stale bake work. Loaded files validate bounds and samples. Zero normal bias is valid. Empty fields stay finite. Conservative half-voxel-diagonal dilation reduces thin-wall leaks, at the cost of slightly thicker silhouettes; rebake older SDF files to use this change. Local shadow priorities use distance to the cluster center, not exact per-fragment nearest-neighbor sorting.

SDF is **static geometry only**: moving casters need CSM for Sun shadows; moving local-light casters are not implemented. Only the base 3D layer is currently managed. Per-light `ShadowBias` offsets local SDF rays in voxel-size units; the global SDF normal bias controls the directional Sun.

### Validation

Run node AdvancedLighting3D/test-light-flicker-effects.mjs, node AdvancedLighting3D/test-shadow-runtime.mjs, and node AdvancedLighting3D/test-shadow-webgl.mjs. The WebGL test uses the repository's Three.js r160 and headless Chrome with SwiftShader, checks actual changed pixels, mode restoration, cascade bounds and shader errors, and writes shadow-validation.png. It requires Chrome (or CHROME_PATH).

Software-WebGL tests are not hardware performance measurements or a full GDevelop export test. Desktop/mobile GPU profiling and editor/export acceptance testing remain outstanding. No universal 60 FPS guarantee is made.

## 🚀 Quick Start Guide

1. **No scene manager to add.** The runtime installs itself when the scene loads. Optionally call `SetMaxLights` (64–512, default 256) if you expect more than 256 simultaneous lights.
2. **Add Light Behavior:** Add the **`ClusteredLight3D`** behavior to any 3D object (torches, lampposts, projectiles, or empty light anchors).
3. **Customize Properties:**
   - Set **Light Type:** `Point`, `Spot`, or `AreaCapsule`.
   - A Spot light attached to a Cube3D automatically places an unlit bulb decal over the cube's front (`+Z`) face. This is the exact face the cone points out of, and the decal is attached directly to the editor's Cube3D mesh so face-material refreshes cannot erase it.
   - An AreaCapsule is a two-sided tube along the object's local Z axis. Diffuse lighting and attenuation use the nearest point on the fixed tube; only its physically view-dependent specular reflection uses the Karis representative point.
   - Set **Color Temperature:** e.g. `2200K` for warm torch fire or `5500K` for cool halogen.
   - Set **Attenuation Radius:** e.g. `12.0` meters.
   - For animation, add **`Lightflickereffects`** to the same object. Its **Flicker Mode** setting includes `FireFlicker` for flame modulation.
4. **Trigger In Event Sheet:**
   - On spell cast: `ClusteredLight3D::SetIntensity(3.5)` and `ClusteredLight3D::SetRadius(25.0)`
   - On shooting: `Lightflickereffects::TriggerMuzzleFlash(duration: 0.05)`
   - Master brightness: `AdvancedLighting3D::SetGlobalIntensity(1.2)`

### Lightflickereffects and LightTweens

These are separate optional companions for **ClusteredLight3D**. Add either or both to the same object. Leave **Light behavior name** empty to connect to its first light, or enter a specific behavior name when it has multiple lights. Use one of each companion per light.

**Lightflickereffects** provides FireFlicker, FluorescentHum, SirenStrobe and PulseWave, with speed and variation. ApplyFlickerPreset configures Candle, Torch, Fluorescent, Alarm, Breathing or None. TriggerMuzzleFlash creates a decaying burst. PauseEffects, ResumeEffects and StopAllEffects affect only flicker and flashes.

**LightTweens** smoothly changes intensity, radius (metres), RGB color and temperature (Kelvin). Each action takes a target, **duration in seconds** (default 1), easing style and playback mode. Available styles: Linear, EaseIn, EaseOut, EaseInOut, CubicIn, CubicOut, CubicInOut, SineIn, SineOut, SineInOut and ExponentialInOut. Playback can be Once, Loop or PingPong.

For a half-second fade out, call LightTweens → TweenIntensity with target 0, duration 0.5, EaseOut, Once. For a breathing radius, use TweenRadius with your target radius, duration 2, SineInOut, PingPong.

Intensity and radius can tween together. Color and temperature replace each other. Restarting a channel begins at its current value; zero duration applies immediately. PauseTweens and ResumeTweens control only transitions. StopTween stops one channel or All at the current values. IsTweenPlaying, IsTweenFinished and TweenProgress expose status; finished remains true until restarted or stopped, so use Trigger once for a one-shot event.

Flicker modulates the tweened base intensity. Both behaviors work independently of their order on the object. Pauses are independent and survive behavior deactivation/reactivation. Destroying either companion leaves the other active. IsPaused and IsLightConnected are available on both. Animation runs in the game; the editor shows steady authored lighting.

**Extension API changes:** Original ClusteredLight3D flicker settings and events now belong to Lightflickereffects. Transition actions previously on Lightflickereffects now belong to LightTweens. Only the extension is updated; project files are not modified.

### Adding baked indirect light

5. **Define the probe volume.** Add a **Cube3D** to the scene, stretch it over the level with the 3D scale
   gizmo and add the **`LightProbeVolume3D`** behavior. The cube's bounds are the volume's bounds and
   the cube hides itself at runtime. Note that **Z is the height axis** in GDevelop, so the default
   grid is $16 \times 16 \times 4$.
6. **Attach receivers.** Add **`ReceiveLightProbes`** to your player, enemies and props. Receivers
   also keep receiving clustered dynamic lights and SDF shadows — all three share one shader.
7. **Bake probes.** Call `StartProbeBake()` once and poll `IsProbeBakeComplete()`. Export with
   `ExportProbeData` so shipping builds load the `.lpg.bin` directly instead of rebaking.

### Adding Signed Distance Field (SDF) Soft Shadows

8. **Define the shadow volume.** Add a **Cube3D** bounding the static level geometry and attach the
   **`SDFVolume3D`** behavior. Set dimensions like $64 \times 64 \times 32$ or $128 \times 128 \times 32$.
9. **Bake geometry.** Enable **`AutoBakeOnStart`** or call `StartSDFBake()`. The amortised Felzenszwalb
   algorithm calculates exact Euclidean distance fields across all static meshes. Export with `ExportSDFData`
   to save an `.sdf.bin` file and load it in production via `LoadSDFDataFromFile`.
10. **Enable shadow casting.** On any `ClusteredLight3D`, check **`CastShadows`** (true) and set
    **`SourceRadius`** (e.g. 5.0–20.0 for soft penumbra). The Three.js directional Sun light automatically
    casts raymarched soft shadows across the distance field!

---

## ⚠️ Requirements and limits

| | |
| :--- | :--- |
| **WebGL2** | Required by all systems. `sampler3D` and `usampler3D` do not exist in GLSL ES 1.00, so there is no degraded mode. Check `IsSupported()` before your setup events. |
| **Lit standard materials** | Injection is applied to `MeshStandardMaterial` only. Objects set to material type **Basic** cannot receive clustered light, probe light, or SDF shadows — `MeshBasicMaterial` has no lighting at all. The extension warns once, naming the material. |
| **Units** | The clustered light `Radius`, `CapsuleLength` and `SourceRadius` are in **metres**; the runtime converts at 100 world units per metre. Probe/SDF bounds and offsets stay in raw GDevelop world units. |
| **SDF & Probe volumes per scene** | One active probe volume and one active SDF volume per scene. Overlapping multi-volume blending is not implemented. |
| **SDF Static Geometry** | The distance field is baked from static scene meshes. Dynamic skinned characters receive shadows from the static world; dynamic character self-shadowing is not evaluated in the static SDF volume. |
| **Scene editor** | Clustered lights **do** render live in the 3D scene editor via `gdjs.registerInGameEditorPostStepCallback`. Flicker and muzzle flashes are pinned to the configured intensity in the editor so authoring is against a steady light. |

---

## 🖊️ In the scene editor

Lights render live in GDevelop's **3D scene editor**, not just in Preview. That is not automatic:
the editor drives its own loop (`_updateObjectsForInGameEditor` → `gdjs.callbacksInGameEditorPostStep`
→ `render()`) and **never runs events**, so a behavior's `doStepPreEvents` and the scene's
post-events callbacks both stay silent there. The extension registers for that editor callback list
explicitly and runs the same broadphase from it.

Two consequences worth knowing while authoring:

- **Flicker and muzzle flashes do not animate in the editor.** Each light is drawn at its configured
  `Intensity`. Authoring against a pulsing light is worse than authoring against a steady one.
- **`Intensity` is live without a step.** The light's working intensity is seeded from the property
  at creation rather than defaulting to `1.0`, because nothing in the editor would ever update it.

## 📈 Measured CPU cost

The CPU broadphase, timed in the Node harness at a 4 m radius (16 x 9 x 24 grid, 1920x1080,
fov 45). Note the **default is 12 m**, not 4 — see the warning below the table:

| Active lights | Broadphase / frame |
| ---: | ---: |
| 0 | 0.21 ms |
| 1 | 0.58 ms |
| 16 | 1.21 ms |
| 64 | 1.24 ms |
| 256 | 1.83 ms |
| 500 | 1.70 ms |

Two things keep that flat. The per-cluster bins are typed arrays allocated once and reused —
they used to be 3,456 freshly allocated JS arrays every frame, which cost 0.84 ms before a
single light was considered. And a light is only tested against the tiles its screen-space
footprint actually covers, rather than all 144 tiles of every depth slice it spans.

**Radius is the performance knob — but reach comes first.** A light whose radius covers the whole
view lands in every cluster and defeats the clustering: 256 lights at 4 m cost 1.8 ms, the same 256
at 12 m cost 10.5 ms. It is tempting to make the default small for that reason. Don't: attenuation
reaches **exactly zero** at the radius, so a surface past it is not dim, it is *unlit*, and a 4 m
default turns a stock scene black the moment anything sits more than 400 units from the light.
The default is 12 m (1200 units) because that lights an ordinary scene. Lower it per-light once you
have something on screen and `CPUBroadphaseTimeMs()` says you need to.

*(GPU cost is not measured here — nothing has been profiled in GDevelop yet.)*

---

## ❌ Architectural boundaries

| Feature | Status |
| :--- | :--- |
| **Dynamic character shadow casters** | SDF volumes represent static world geometry. Dynamic skinned characters do not write into the static SDF volume; they receive shadows cast by the world. |
| **Projective Decals** | Planned in a dedicated decoupled package (`ClusteredDetail`), not part of lighting. |
| **Configurable cluster grid** | `ClusterGridX/Y/Z` are compile-time constants (16 × 9 × 24). |
| **Multiple layers** | The cluster broadphase reads the camera and scene from the base layer (`""`) only. Lights, probes, and SDF volumes on other layers are not handled. |

Everything else in this document is wired end to end and covered by the test suite.

---

## 📚 Documentation Index

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Technical architecture, mathematical formulations (logarithmic depth slicing, Arvo distance metrics, Karis representative point area specular, Frostbite windowed attenuation, volumetric scattering integrals), WebGL2 texture packing, and implementation phases.
- [API_REFERENCE.md](./API_REFERENCE.md) — Complete specification of Manager and Object Properties, Actions, Conditions, Expressions, Presets, and Color Temperature constants.
