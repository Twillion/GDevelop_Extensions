# AdvancedLighting3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), Presets, and Color Temperature constants for **AdvancedLighting3D**.

---

## 1. Scene Settings

**There is no scene manager behavior.** The runtime installs itself from an `onSceneLoaded`
extension lifecycle function; scene-wide settings are free actions, not properties.

| Setting | Action | Default | Description |
| :--- | :--- | :---: | :--- |
| Max lights | `SetMaxLights` | `256` | Dynamic lights streamed to the GPU simultaneously ($64 - 512$). Changing it reallocates the light data texture. |
| Master brightness | `SetGlobalIntensity` | `1.0` | Multiplier over all clustered lights. |
| Shadow mode | `SetShadowMode` | `Hybrid` | Select `Off`, `CSM`, `SDF`, or `Hybrid`. This is the sole global shadow selector. |
| Max Shadowed Lights | `SetMaxShadowedLights` | `4` | Cap on simultaneous shadowed clustered point/spot lights ($1 - 16$). |
| Point Shadow Distance | `SetPointShadowDistance` | `800.0` | Cutoff distance in world units beyond which point/spot shadows are skipped. |
| Sun Penumbra Softness | `SetSDFSunSoftness` | `1.8` | Angular diameter in degrees of directional Sun source ($0.1 - 10.0^\circ$). |
| Cluster grid | *(none)* | `16 x 9 x 24` | Compile-time constants. Not configurable. |

---

## 2. `ClusteredLight3D` (Object Behavior Properties)

### Group 1: Light Shape & Dimensions
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LightType`** | Choice | `"Point"` | Light emission geometry: `"Point"`, `"Spot"`, or `"AreaCapsule"`. |
| **`Intensity`** | Number | `1.0` | Base radiant intensity multiplier. |
| **`Radius`** | Number | `12.0` | Maximum reach in **metres**, converted at 100 world units per metre (so 12 m = 1200 units). Attenuation reaches **exactly 0** at the boundary — beyond it a surface is not dim, it is unlit. |
| **`CapsuleLength`** | Number | `2.0` | Length of tube/bar in meters (only for `AreaCapsule`). |
| **`SpotInnerAngle`** | Number | `25.0` | Inner cone cutoff in degrees (only for `Spot`). |
| **`SpotOuterAngle`** | Number | `45.0` | Outer cone soft penumbra in degrees (only for `Spot`). |

### Group 2: Color & Blackbody Temperature
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ColorMode`** | Choice | `"Kelvin"` | Color definition method: `"Kelvin"` (Physical Temperature) or `"RGB"`. |
| **`ColorTemperature`** | Number | `2200` | Blackbody temperature in Kelvin ($1000\text{K} - 12000\text{K}$). |
| **`LightColor`** | Color | `"255; 180; 100"` | Direct RGB color when `ColorMode` is `"RGB"`. |
| **`EmissiveBoost`** | Number | `1.0` | Over-bright color boost for bloom/glow effects. |

### Group 3: IES Profiles & Shadows
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`IESProfile`** | Choice | `"None"` | Architectural photometric profile: `"None"`, `"WallSconce"`, `"StreetLamp"`, `"Downlight"`, `"Searchlight"`. |
| **`CastShadows`** | Boolean | `false` | Enables SDF volumetric raymarched soft shadows from this specific light. |
| **`SourceRadius`** | Number | `0.0` | Physical source radius in world units for penumbra softness; 0 uses 5% of the light radius. |
| **`ShadowBias`** | Number | `0.02` | SDF normal offset in voxel-size units, clamped to 0–0.999. |

## Lightflickereffects (companion behavior)

Attach alongside ClusteredLight3D. The animation properties below no longer belong to ClusteredLight3D. Optional `LightBehavior` (String, empty by default) selects a specific light behavior name; empty chooses the first light on the object.

### Procedural Animation & Flicker
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`FlickerMode`** | Choice | `"None"` | Animation pattern: `"None"`, `"FireFlicker"`, `"FluorescentHum"`, `"SirenStrobe"`, `"PulseWave"`. |
| **`FlickerSpeed`** | Number | `8.0` | Oscillation / noise frequency (Hz). |
| **`FlickerIntensityVariation`** | Number | `0.25` | Amplitude of random flicker brightness changes ($0.0 - 1.0$). |

---

## 3. Actions

### Scene & Light Manager Actions
* **`Set global clustered light intensity to _PARAM0_`**: Master scene brightness multiplier.
* **`Set maximum active streamed dynamic lights to _PARAM0_`**: Light budget, $64 - 512$. Reallocates the light data texture.
* **`Enable or disable SDF soft shadows in scene (_PARAM0_)`**: Global toggle for distance field shadows.
* **`Set maximum simultaneous SDF shadowed lights to _PARAM0_`**: Budget limit ($1 - 16$) for point/spot soft shadows.
* **`Set maximum point light shadow distance to _PARAM0_`**: Distance cutoff (world units) for dynamic light shadows.
* **`Set directional sun shadow softness angle to _PARAM0_`**: Penumbra softness angle in degrees ($0.1 - 10.0^\circ$).
* **`Set SDF hit epsilon to _PARAM0_`** / **`Set SDF normal bias to _PARAM0_`**: Raymarcher surface offset tuning.

### Object Actions (`ClusteredLight3D`)
* **`Set light intensity on _PARAM0_ to _PARAM1_`**: Update brightness.
* **`Set light attenuation radius on _PARAM0_ to _PARAM1_`**: Change maximum reach in meters.
* **`Set whether light casts shadows on _PARAM0_ to _PARAM1_`**: Toggle SDF soft shadow casting for this light.
* **`Set light source radius on _PARAM0_ to _PARAM1_`**: Set light emitter radius for penumbra softness.
* **`Set light color temperature in Kelvin on _PARAM0_ to _PARAM1_`**: Set physical color (e.g. `1800` for candle, `6500` for fluorescent).
* **`Set light RGB color on _PARAM0_ to _PARAM1_`**: Set custom RGB color string (e.g. `"#00ffcc"` or `"0;255;200"`).
* **`Set spotlight angles on _PARAM0_ (Inner: _PARAM1_, Outer: _PARAM2_)`**: Adjust spot focus and soft penumbra.
* **`Set area capsule length on _PARAM0_ to _PARAM1_`**: Adjust neon tube/bar length in meters.
### Lightflickereffects animation actions
* **`Set procedural flicker mode on _PARAM0_ to _PARAM1_ with speed _PARAM2_ and variation _PARAM3_`**: Configure flame/strobe animations.
* **`Trigger muzzle flash burst on _PARAM0_ with duration _PARAM1_ seconds`**: Single-shot high-intensity decay burst.

---

## 4. Conditions

* **`Is clustered light active on _PARAM0_`**: Checks if light is currently emitting within camera frustum.
* **`Is light within camera view frustum on _PARAM0_`**: True if light's bounding sphere intersects the active camera frustum.
* **`Does light cast shadows on _PARAM0_`**: True if `CastShadows` is enabled on this light.
* **`Are SDF soft shadows enabled in scene`**: True if global SDF shadow raymarching is active.
* **`Is light procedural flicker active on _PARAM0_`**: Lightflickereffects condition: checks if flicker is configured and playback is not paused.

---

## 5. Expressions

### Metrics & Properties
* **`Object.ClusteredLight3D::Intensity()`**: Returns current active intensity (including flicker offsets).
* **`Object.ClusteredLight3D::Radius()`**: Returns attenuation radius in meters.
* **`Object.ClusteredLight3D::ColorTemperature()`**: Returns color temperature in Kelvin.
* **`Object.ClusteredLight3D::CapsuleLength()`**: Returns tube length in meters.
* **`Object.ClusteredLight3D::ViewDistance()`**: Distance from active camera to light in meters.
* **`Object.ClusteredLight3D::SourceRadius()`**: Returns light source radius in world units.

### Manager Diagnostics & Metrics
* **`AdvancedLighting3D::ActiveLightCount()`**: Total number of lights rendered in the current frame.
* **`AdvancedLighting3D::MaxLightsInSingleCluster()`**: Peak light count in the densest cluster (for performance monitoring).
* **`AdvancedLighting3D::CPUBroadphaseTimeMs()`**: Execution time in milliseconds for CPU light binning.
* **`AdvancedLighting3D::SDFVoxelCount()`**: Total voxel count ($resX \times resY \times resZ$) of active SDF volume.
* **`AdvancedLighting3D::SDFVRAMBytes()`**: GPU memory allocated for the 3D distance field (2 bytes per voxel).
* **`AdvancedLighting3D::SDFBakeProgress()`**: Baking progress from 0.0 to 1.0 (triangle query phase -> EDT phase).
* **`AdvancedLighting3D::SDFSunSoftness()`**: Current directional Sun shadow softness angle in degrees.

---

## 6. Physical Color Temperature Reference Table

| Kelvin ($K$) | Light Source | Visual Atmosphere | Hex Approximation |
| :---: | :--- | :--- | :---: |
| **`1,800 K`** | Candle / Matchstick Flame | Deep warm amber / cozy fire | `#FF7A00` |
| **`2,200 K`** | Fireplace / Campfire / Torch | Golden fire glow | `#FFA13D` |
| **`2,800 K`** | Warm Incandescent Lightbulb | Cozy domestic interior | `#FFC58F` |
| **`3,200 K`** | Halogen Lamp / Studio Flood | Warm crisp white | `#FFD6AA` |
| **`4,000 K`** | Natural Warm Sunlight | Balanced neutral white | `#FFEACC` |
| **`5,500 K`** | Mid-Day Direct Sunlight | Pure crisp daylight | `#FFFDF9` |
| **`6,500 K`** | Overcast Sky / Fluorescent Tube | Clean cool daylight | `#DCE5FF` |
| **`8,500 K`** | Cinematic Moonlight / Clear Blue Sky | Deep cool night blue | `#A8C4FF` |

---

## 7. `LightProbeVolume3D` (Behavior — attach to a Cube3D)

Defines the bounds, resolution and ambient colours of the scene's light probe grid. The cube's
transform *is* the volume; the cube hides itself at runtime. One volume per scene.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ResolutionX`** | Number | `16` | Probes along world X. Clamped to $[2, 64]$. |
| **`ResolutionY`** | Number | `16` | Probes along world Y. Clamped to $[2, 64]$. |
| **`ResolutionZ`** | Number | `4` | Probes along world Z — **the height axis in GDevelop**. Clamped to $[2, 64]$. |
| **`SkyColor`** | Color | `160; 200; 255` | Ambient colour arriving from above (+Z). |
| **`GroundColor`** | Color | `80; 120; 50` | Ambient bounce colour arriving from below (−Z). |
| **`HorizonColor`** | Color | `200; 220; 240` | Ambient colour at the horizon. |
| **`VolumeIntensity`** | Number | `1.0` | Ambient scale for this volume. Applies immediately, no rebake. |
| **`DayNightMode`** | Boolean | `false` | Allocate and blend a second night volume. |
| **`AutoBakeOnStart`** | Boolean | `false` | Start baking when the scene starts. |
| **`ShowDebugSpheres`** | Boolean | `false` | Draw one instanced sphere per probe, tinted by its sampled colour. |

**Actions:** `SetSkyColor`, `SetGroundColor`, `SetHorizonColor`, `SetVolumeIntensity`,
`SetAutoBakeOnStart`, `SetShowDebugSpheres`.
**Conditions:** `IsDebugVisualizerEnabled`, `IsAutoBakeOnStart`, `IsVolumeBaked`.
**Expressions:** `VolumeIntensity()`, `ProbeCount()`.

Changing a colour *after* a bake keeps the baked data and warns — re-run `StartProbeBake` to apply
the new colours. Changing the resolution invalidates the bake, because the buffer no longer matches
the grid.

---

## 8. `ReceiveLightProbes` (Behavior — attach to any lit 3D object)

Samples the active probe volume per fragment. Receivers also keep receiving clustered dynamic
lights and SDF shadows: all features come from the same injected shader.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`IntensityMultiplier`** | Number | `1.0` | Per-instance multiplier on received indirect light. |
| **`NormalBiasOffset`** | Number | `15.0` | Offset of the sample position along the surface normal, in world units (pixels). Raise it if surfaces pick up the ambient of the wall behind them. |
| **`UpdateFrequency`** | Choice | `"Continuous"` | `"Continuous"` (every frame) or `"Throttled"` (every 5 frames). |
| **`Enabled`** | Boolean | `true` | Whether sampling is active on this instance. |

**Actions:** `SetIntensityMultiplier`, `SetNormalBiasOffset`, `SetEnabled`.
**Conditions:** `IsReceiving`, `IsEnabled`.
**Expressions:** `ProbeIntensity()`, `ProbeNormalBias()`.

---

## 9. Light Probe Scene Functions

### Actions
* **`SetProbeVolumeBounds(minX, minY, minZ, maxX, maxY, maxZ)`**: set bounds explicitly, in GDevelop coordinates. From this point the authoring cube no longer controls the volume.
* **`SetDayNightBlend(_PARAM0_)`**: `0.0` = day, `1.0` = night. GPU-side, no rebake.
* **`SetProbeGlobalIntensity(_PARAM0_)`**: master multiplier over every receiver.
* **`ToggleProbeDebugVisualizer(_PARAM0_)`**: show or hide the instanced probe spheres.
* **`StartProbeBake()`** / **`CancelProbeBake()`**: run or abandon the amortised raycast bake.
* **`SetProbeBakeBudgetMs(_PARAM0_)`**: milliseconds per frame the bake may consume (default `8.0`).
* **`ExportProbeData(_PARAM0_)`**: download the baked volume as `.lpg.bin`. Browser contexts only.
* **`LoadProbeDataFromFile(_PARAM0_)`**: fetch and apply a `.lpg.bin`.

### Conditions
* **`IsProbeVolumeLoaded`**, **`IsProbeBakeInProgress`**, **`IsProbeBakeComplete`**, **`IsDayNightModeEnabled`**.
* **`IsSupported`** is shared across all systems — one WebGL2 check covers all features.

### Expressions
* **`DayNightBlend()`**, **`ActiveProbeCount()`**, **`ProbeSpacingX/Y/Z()`**, **`ProbeBakeProgress()`**, **`ProbeVRAMBytes()`**.

---

## 10. `SDFVolume3D` (Behavior — attach to a Cube3D)

Defines the bounding volume and 3D voxel resolution for Signed Distance Field soft shadows.
The cube's scale and position represent the shadow volume in world space; the cube hides itself at runtime.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ResolutionX`** | Number | `128` | Distance field voxels along world X ($8 - 256$). |
| **`ResolutionY`** | Number | `128` | Distance field voxels along world Y ($8 - 256$). |
| **`ResolutionZ`** | Number | `32` | Distance field voxels along world Z ($4 - 128$). |
| **`AutoBakeOnStart`** | Boolean | `false` | Automatically extract static meshes and compute distance field when the scene loads. |

**Actions:** `SetAutoBakeOnStart`.
**Conditions:** `IsAutoBakeOnStart`, `IsVolumeBaked`.
**Expressions:** `VoxelCount()`.

---

## 11. SDF Soft Shadow Scene Functions

### Actions
* **`SetSDFVolumeBounds(minX, minY, minZ, maxX, maxY, maxZ)`**: Manually set distance field boundaries in GDevelop world units.
* **`SetMaxShadowedLights(_PARAM0_)`**: Maximum simultaneous dynamic point/spot lights that raymarch shadows ($1 - 16$).
* **`SetPointShadowDistance(_PARAM0_)`**: View distance cutoff (world units) for dynamic light shadow evaluation.
* **`SetSDFSunSoftness(_PARAM0_)`**: Angular diameter in degrees ($0.1 - 10.0^\circ$) for directional Sun penumbra.
* **`SetSDFHitEps(_PARAM0_)`**: Surface intersection distance threshold in voxels (default `0.05`).
* **`SetSDFNormalBias(_PARAM0_)`**: Offset along surface normal in voxels to prevent self-shadowing acne (default `1.0`).
* **`StartSDFBake()`** / **`CancelSDFBake()`**: Start or stop background distance field computation.
* **`SetSDFBakeBudgetMs(_PARAM0_)`**: Per-frame CPU time budget in milliseconds for triangle query seeding (default `8.0`).
* **`ExportSDFData(_PARAM0_)`**: Download baked distance field as an `.sdf.bin` file.
* **`LoadSDFDataFromFile(_PARAM0_)`**: Fetch and apply an `.sdf.bin` binary file asynchronously.

### Conditions
* **`IsSDFVolumeLoaded`**: True if the 3D distance field texture is allocated on the GPU.
* **`IsSDFBakeInProgress`**: True while triangle queries or Felzenszwalb transform are actively executing.
* **`IsSDFBakeComplete`**: True when distance field computation is fully finished.
* **`AreSDFShadowsEnabled`**: True if SDF shadow evaluation is enabled.

### Expressions
* **`SDFVoxelCount()`**: Total number of voxels in the active distance field.
* **`SDFVRAMBytes()`**: GPU VRAM footprint in bytes for the R16F texture.
* **`SDFBakeProgress()`**: Baking progress ratio from $0.0$ to $1.0$.
* **`SDFSunSoftness()`**: Directional Sun softness angle in degrees.

---

## 12. Shader Interface

All features are injected into a **single** `onBeforeCompile` on each material, with a cache key of
the form:
`GD_ADVLIGHT3D_V6|CL1|G3D<0|1>|LP<0|1>|SDF<0|1>`

**Defines Injected**
- `AL_SDF_SHADOWS 1` (when an active SDF volume is loaded and shadows are enabled)

**Uniforms**

| Name | Type | Meaning |
| :--- | :--- | :--- |
| `uClusteredLightData` | `sampler2D` RGBA32F | 4 texels per light — see the packing table below. |
| `uClusterGrid3D` / `uClusterGrid2D` | `usampler3D` / `usampler2D` RG32UI | Per-cluster `(offset, count)`. |
| `uLightIndexList` | `usampler2D` R16UI | Concatenated per-cluster light index stream, 2048 x 108. |
| `uClusterGridDims` | `vec3` | Grid dimensions as floats. |
| `uProbeVolumeDay` / `uProbeVolumeNight` | `sampler3D` RGBA16F | Baked probe volumes. |
| `uProbeVolumeMin` / `uProbeVolumeSize` | `vec3` | Probe volume bounds in Three.js space. |
| `uProbeIntensity` | `float` | Probe radiance intensity scaling. |
| `uProbeDayNightBlend`, `uProbeNormalBias` | `float` | Probe blend factor and normal offset. |
| `uSdfVolume` | `sampler3D` R16F | 3D Signed Distance Field texture storing world-unit Euclidean distance. |
| `uSdfMin` / `uSdfSize` | `vec3` | SDF bounding box in Three.js space ($[minX, -maxY, minZ]$). |
| `uSdfParams` | `vec4` | `(voxelSize, hitEps, globalNormalBias, sunPenumbraFactor)`. |
| `uViewToWorld` | `mat4` | Current camera view-to-world transformation matrix. |
| `uMaxShadowedLights` | `int` | Maximum simultaneous dynamic lights allowed to trace shadows. |
| `uPointShadowDistance`| `float` | Distance threshold for dynamic light shadow raymarching. |

**Light data packing** — 4 RGBA32F texels per light:

| Texel | `.x` | `.y` | `.z` | `.w` |
| :---: | :--- | :--- | :--- | :--- |
| 0 | view-space position x | y | z | attenuation radius |
| 1 | colour r | g | b | intensity |
| 2 | view-space direction x | y | z | type flag: `0` point, `cos(outer)` spot, `10 + halfLength` capsule |
| 3 | IES profile id (0-4) | `cos(innerAngle)` | integer shadow flag + fractional per-light bias | source radius (penumbra size) |

---

## 13. `.lpg.bin` Format

Little-endian. Byte offsets:

| Offset | Size | Field |
| :--- | :--- | :--- |
| `0` | 4 | Magic `LPG3` |
| `4` | 4 | `uint32` version — must be `1` |
| `8`, `12`, `16` | 4 each | `uint32` resX, resY, resZ (each in $[2, 64]$) |
| `20` | 1 | Encoding — `0` = RGBA16F |
| `21` | 1 | Flags — bit 0 set if a night volume follows |
| `22` | 10 | Reserved, zero |
| `32` | 24 | `float32` minX, minY, minZ, maxX, maxY, maxZ — **unmirrored** GDevelop coordinates |
| `56` | `resX·resY·resZ·8` | Day payload, RGBA16F, indexed `((z·resY + y)·resX + x)·4` |
| … | same | Night payload, if the flag is set |

---

## 14. `.sdf.bin` Format

Little-endian. Byte offsets:

| Offset | Size | Field |
| :--- | :--- | :--- |
| `0` | 4 | Magic `SDF3` |
| `4` | 4 | `uint32` version — must be `1` |
| `8`, `12`, `16` | 4 each | `uint32` resX, resY, resZ (each in $[4, 256]$) |
| `20` | 1 | Encoding — `0` = R16F half-float Euclidean distance |
| `21` | 1 | Flags — reserved (`0`) |
| `22` | 10 | Reserved, zero |
| `32` | 24 | `float32` minX, minY, minZ, maxX, maxY, maxZ — **unmirrored** GDevelop coordinates |
| `56` | `resX·resY·resZ·2` | Distance field payload, R16F, indexed `(z·resY + y)·resX + x` |

## LightTweens tween API

| Action | Target | Additional arguments |
| --- | --- | --- |
| TweenIntensity | Nonnegative intensity; 0 fades out | Duration (seconds), Easing, Playback |
| TweenRadius | Nonnegative radius in metres | Duration, Easing, Playback |
| TweenColor | RGB color | Duration, Easing, Playback |
| TweenTemperature | 1000–12000 Kelvin | Duration, Easing, Playback |
| PauseTweens / ResumeTweens | Light transitions only | None |
| StopTween | Intensity, Radius, Color, Temperature, or All | Channel |

Easing: Linear, EaseIn, EaseOut, EaseInOut, CubicIn, CubicOut, CubicInOut, SineIn, SineOut, SineInOut, ExponentialInOut. Playback: Once, Loop, PingPong. Zero duration applies immediately. Replacing a tween starts from its current value; color and temperature are mutually exclusive. StopTween leaves current values and does not stop flicker.

Conditions: IsTweenPlaying(Channel), IsTweenFinished(Channel). Finished remains true until the channel is restarted or stopped. Expression: TweenProgress(Channel), 0–1 for the current leg. FlickerSpeed() and FlickerIntensityVariation() now belong to Lightflickereffects.

Migration: add Lightflickereffects, copy previous flicker property values, and redirect old animation events to the companion. See README for examples.

Lightflickereffects also provides ApplyFlickerPreset(Preset): Candle, Torch, Fluorescent, Alarm, Breathing, None. Presets configure mode, speed and variation without changing base color or intensity. StopAllEffects stops flicker and flashes only; LightTweens transitions continue. IsPaused reports pause/deactivation; IsLightConnected checks target binding. Explicit pauses survive behavior deactivation/reactivation.

LightTweens is a separate companion with only a LightBehavior binding property. Tween actions accept durations in seconds (default 1). Both companions can control the same light: LightTweens changes base values and Lightflickereffects modulates intensity. Pauses, deactivation and teardown are independent. IsPaused and IsLightConnected are available on each behavior.

## Shadow selector and CSM API

SetShadowMode(Mode): Off, CSM, SDF, Hybrid (default). This is the only global shadow selector. ShadowModeIs(Mode), ShadowMode(), and IsCSMActive expose selected mode and readiness. IsSDFShadowsEnabled is true in SDF and Hybrid modes. CSM uses the first visible native directional Sun on the base layer.

SetCSMCascadeCount: 2–4, default 3. SetCSMMaxDistance: world units, default 25000, bounded by camera far. SetCSMSplitLambda: 0–1, default 0.75. SetCSMShadowMapSize: 1024/2048/4096, default 2048. SetCSMBias: depth bias and world-space normal bias, both accept zero. SetCSMSeamBlendWidth: 0–0.25, default 0.1. SetCSMSoftness: PCF radius 0–10. SetCSMSunDirection: ray direction in GDevelop XYZ; zero input ignored. CSMCascadeCount, CSMMaxDistance, CSMSplitLambda, CSMShadowMapSize, CSMSeamBlendWidth, CSMSoftness and CSMSplitDistance(index) report configuration.

AdvancedShadowManager3D exposes these settings as inspector properties. Only one instance owns a scene. Extra managers wait in registration order; when the owner is destroyed, the next manager takes over with its own settings. Free actions work without a manager. CSM cascades carry zero intensity, so the native Sun contributes brightness exactly once. CSM honors each mesh's existing `castShadow` and `receiveShadow` flags.

SDF bake distances include conservative voxel dilation. SDF local shadow candidates are sorted by cluster-center distance, within the 64-light cluster limit. Static SDF fields must be rebaked after geometry changes. Per-light ShadowBias affects local SDF ray origins; the global SDF normal bias affects the directional Sun.
