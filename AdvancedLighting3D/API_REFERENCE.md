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
| Cluster grid | *(none)* | `16 x 9 x 24` | Compile-time constants. Not configurable. |

`SetVolumetricFogEnabled`, `SetVolumetricFogDensity`, `SetVolumetricAnisotropy` and
`EnableContactShadows` exist and store scene state, but **no shader code reads them** — see the
"What this extension does not do" section of the README.

---

## 2. `ClusteredLight3D` (Object Behavior Properties)

### Group 1: Light Shape & Dimensions
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LightType`** | Choice | `"Point"` | Light emission geometry: `"Point"`, `"Spot"`, or `"AreaCapsule"`. |
| **`Intensity`** | Number | `1.0` | Base radiant intensity multiplier. |
| **`Radius`** | Number | `12.0` | Maximum reach in **metres**, converted at 100 world units per metre (so 12 m = 1200 units). Attenuation reaches **exactly 0** at the boundary — beyond it a surface is not dim, it is unlit. Lowering this is the main performance lever, but never at the cost of losing the light. |
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

### Group 3: IES Profiles & Contact Shadows
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`IESProfile`** | Choice | `"None"` | Architectural photometric profile: `"None"`, `"WallSconce"`, `"StreetLamp"`, `"Downlight"`, `"Searchlight"`. |
| **`CastContactShadows`**| Boolean | `true` | Enables screen-space raytraced micro-shadows from this specific light. |
| **`ShadowBias`** | Number | `0.02` | Normal offset bias to prevent self-shadow acne. |

### Group 4: Procedural Animation & Flicker
| Property | Type | Default | Description |
| :--- | :--- | :---: | :---: |
| **`FlickerMode`** | Choice | `"None"` | Animation pattern: `"None"`, `"FireFlicker"`, `"FluorescentHum"`, `"SirenStrobe"`, `"PulseWave"`. |
| **`FlickerSpeed`** | Number | `8.0` | Oscillation / noise frequency (Hz). |
| **`FlickerIntensityVariation`** | Number | `0.25` | Amplitude of random flicker brightness changes ($0.0 - 1.0$). |

---

## 3. Actions

### Manager Actions
* **`Set global clustered light intensity to _PARAM0_`**: Master scene brightness multiplier.
* **`Set maximum active streamed dynamic lights to _PARAM0_`**: Light budget, $64 - 512$. Reallocates the light data texture.
* *Inert (state only, no shader reads them):* `Set volumetric atmospheric fog density`, `Set volumetric fog forward scattering anisotropy`, `Enable clustered contact micro-shadows`, `Enable volumetric atmospheric fog`.

### Object Actions (`ClusteredLight3D`)
* **`Set light intensity on _PARAM0_ to _PARAM1_`**: Update brightness.
* **`Set light attenuation radius on _PARAM0_ to _PARAM1_`**: Change maximum reach in meters.
* **`Set light color temperature in Kelvin on _PARAM0_ to _PARAM1_`**: Set physical color (e.g. `1800` for candle, `6500` for fluorescent).
* **`Set light RGB color on _PARAM0_ to _PARAM1_`**: Set custom RGB color string (e.g. `"#00ffcc"` or `"0;255;200"`).
* **`Set spotlight angles on _PARAM0_ (Inner: _PARAM1_, Outer: _PARAM2_)`**: Adjust spot focus and soft penumbra.
* **`Set area capsule length on _PARAM0_ to _PARAM1_`**: Adjust neon tube/bar length in meters.
* **`Set procedural flicker mode on _PARAM0_ to _PARAM1_ with speed _PARAM2_ and variation _PARAM3_`**: Configure flame/strobe animations.
* **`Trigger muzzle flash burst on _PARAM0_ with duration _PARAM1_ seconds`**: Single-shot high-intensity decay burst.

---

## 4. Conditions

* **`Is clustered light active on _PARAM0_`**: Checks if light is currently emitting within camera frustum.
* **`Is light within camera view frustum on _PARAM0_`**: True if light's bounding sphere intersects the active camera frustum.
* **`Is volumetric fog enabled in scene`**: Checks if atmospheric light scattering is active.
* **`Is light procedural flicker active on _PARAM0_`**: Checks if animated flicker/pulse is running.

---

## 5. Expressions

### Metrics & Properties
* **`Object.ClusteredLight3D::Intensity()`**: Returns current active intensity (including flicker offsets).
* **`Object.ClusteredLight3D::Radius()`**: Returns attenuation radius in meters.
* **`Object.ClusteredLight3D::ColorTemperature()`**: Returns color temperature in Kelvin.
* **`Object.ClusteredLight3D::CapsuleLength()`**: Returns tube length in meters.
* **`Object.ClusteredLight3D::ViewDistance()`**: Distance from active camera to light in meters.

### Manager Diagnostics
* **`AdvancedLighting3D::ActiveLightCount()`**: Total number of lights rendered in the current frame.
* **`AdvancedLighting3D::MaxLightsInSingleCluster()`**: Peak light count in the densest cluster (for performance monitoring).
* **`AdvancedLighting3D::CPUBroadphaseTimeMs()`**: Execution time in milliseconds for CPU light binning.

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
lights: both features come from the same injected shader.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`IntensityMultiplier`** | Number | `1.0` | Per-instance multiplier on received indirect light. |
| **`NormalBiasOffset`** | Number | `15.0` | Offset of the sample position along the surface normal, in world units (pixels). Raise it if surfaces pick up the ambient of the wall behind them. |
| **`UpdateFrequency`** | Choice | `"Continuous"` | `"Continuous"` (every frame) or `"Throttled"` (every 5 frames). |
| **`Enabled`** | Boolean | `true` | Whether sampling is active on this instance. |

**Actions:** `SetIntensityMultiplier`, `SetNormalBiasOffset`, `SetEnabled`.
**Conditions:** `IsReceiving`, `IsEnabled`.
**Expressions:** `ProbeIntensity()`, `ProbeNormalBias()`.

Attaching the behavior **clones** the object's materials, because GDevelop memoises materials
game-wide and the probe uniforms are per-instance. `onDestroy` restores the shared originals and
disposes the clones.

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
* **`IsSupported`** is shared with the clustered half — one WebGL2 check covers both.

### Expressions
* **`DayNightBlend()`**, **`ActiveProbeCount()`**, **`ProbeSpacingX/Y/Z()`**, **`ProbeBakeProgress()`**, **`ProbeVRAMBytes()`**.

---

## 10. Shader Interface

Both features are injected into a **single** `onBeforeCompile` on each material, with a cache key of
the form `GD_ADVLIGHT3D_V6|CL1|G3D<0|1>|LP<0|1>`. The `LP` digit is what keeps a probe receiver's program
distinct from a plain clustered one; a shared constant key here is exactly the failure that made the
two extensions unsafe to use together.

**Injection points**

| Chunk | What is added |
| :--- | :--- |
| `#include <lights_fragment_begin>` | The probe term (`irradiance += evaluateLightProbeGrid(...)`), then the clustered light loop writing `reflectedLight.directDiffuse` / `directSpecular`. Order matters: `irradiance` is consumed later by `lights_fragment_end`. |
| `#include <worldpos_vertex>` | `vProbeWorldPos`, instancing-aware. Receivers only. |

**Uniforms**

| Name | Type | Meaning |
| :--- | :--- | :--- |
| `uClusteredLightData` | `sampler2D` RGBA32F | 4 texels per light — see the packing table below. |
| `uClusterGrid3D` / `uClusterGrid2D` | `usampler3D` / `usampler2D` RG32UI | Per-cluster `(offset, count)`. The 2D form is the fallback when `Data3DTexture` is unavailable. |
| `uLightIndexList` | `usampler2D` R16UI | Concatenated per-cluster light index stream, 2048 x 108. |
| `uClusterGridDims` | `vec3` | Grid dimensions as floats. Deliberately not `ivec3`: three uploads integer uniforms through `uniform3iv`, which needs a real array. |
| `uProbeVolumeDay` / `uProbeVolumeNight` | `sampler3D` RGBA16F | Baked probe volumes. |
| `uProbeVolumeMin` / `uProbeVolumeSize` | `vec3` | Volume bounds in **mirrored** three space: min is `[minX, -maxY, minZ]`. |
| `uProbeIntensity` | `float` | `volumeIntensity × instanceMultiplier × globalIntensity × π`. The fixed π factor preserves GDevelop r160's legacy light-unit brightness without polling Three.js's deprecated `useLegacyLights` property. Starts at `0.0`. |
| `uProbeDayNightBlend`, `uProbeNormalBias` | `float` | Blend factor and normal offset. |

**Engine interface used** (Three r160): `geometryPosition`, `geometryNormal`, `geometryViewDir`,
`F_Schlick(f0, f90, dotVH)`, `D_GGX(alpha, dotNH)`, `V_GGX_SmithCorrelated(alpha, dotNL, dotNV)`,
`inverseTransformDirection`, `PI`, `RECIPROCAL_PI`. Note there is **no** `G_Smith` in r160, and
`vViewPosition` is the *negated* fragment position — `geometryPosition` is the position.

**Light data packing** — 4 RGBA32F texels per light, `uClusteredLightData` is `MaxLights * 4` wide:

| Texel | `.x` | `.y` | `.z` | `.w` |
| :---: | :--- | :--- | :--- | :--- |
| 0 | view-space position x | y | z | attenuation radius |
| 1 | colour r | g | b | intensity |
| 2 | view-space direction x | y | z | type flag: `0` point, `cos(outer)` spot, `10 + halfLength` capsule |
| 3 | IES profile id (0-4) | `cos(innerAngle)` | — | — |

**Light index list** — `uLightIndexList` is a **2048 x 108** R16UI texture, addressed as
`ivec2(i % 2048, i / 2048)`. A 1D strip would need 221,184 texels of width, over thirteen times the
16,384 that typical desktop hardware allows and 108 times the 2,048 WebGL2 guarantees; the
upload failed silently and every fetch returned index 0.

---

## 11. `.lpg.bin` Format

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

Loading a file **locks the bounds**: the file's bounds are the ones its data was baked against, so
the authoring cube stops driving the volume. A bounds mismatch warns once. Truncated files, bad
magic, unknown versions and out-of-range resolutions are all rejected rather than throwing.
