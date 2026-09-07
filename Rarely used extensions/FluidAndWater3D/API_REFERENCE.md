# FluidAndWater3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), and Preset profiles for **FluidAndWater3D**.

---

## 1. Gerstner Water 1 (`WaterBody3D`) Behavior Properties (Macro Oceans & Pools)

### Group 1: Waves & Wind
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`WaterType`** | Choice | `"Ocean"` | Reserved profile label. The current runtime stores it but does not retune other properties. |
| **`WaveHeight`** | Number | `18` | Master Gerstner-wave amplitude in GDevelop scene units. |
| **`WaveChoppiness`** | Number | `0.75` | Gerstner peak sharpness ($0.0 = \text{Smooth Sine}$, $1.0 = \text{Sharp Crests}$). |
| **`WaveSpeed`** | Number | `1.0` | Time frequency multiplier for wave propagation. |
| **`WindDirection`** | Number | `45.0` | Direction waves travel across the scene in degrees ($0 - 360^\circ$). |
| **`WaveTiling`** | Number | `1.0` | Divides the base wavelength. Higher = more, smaller waves; lower = longer swells. |
| **`DirectionalSpread`** | Number | `45.0` | How widely waves fan out from the wind, in degrees. **0** puts every wave on the wind — clean rolling swell all travelling one way. **45** is a normal wind sea. **70-90** gives a confused, choppy sea with crests in many directions. Raise this if the surface reads as parallel ridges all marching together. |
| **`PhaseSeed`** | Number | `0` | Shifts every octave by a different amount, producing a completely different arrangement of crests from the same sea state. Deterministic: the same value always rebuilds the same surface. |
| **`WaveIrregularity`** | Number | `0.4` | Deterministically bends and slowly evolves crest lines to break up straight Gerstner bands. `0` preserves straight authored waves; `1` is strongly confused. CPU queries and the GPU shader use the same term. |
| **`WaveScaleMode`** | Choice | `"Absolute"` | `"Absolute"` — wavelength is a fixed 300 units whatever the volume's size, so waves stay world-space and adjacent bodies tile seamlessly (oceans). `"RelativeToVolume"` — one base wave spans the volume's shorter horizontal side at `WaveTiling` 1, so waves stay proportional to the object (pools, ponds, lakes). |
| **`GridSubdivisions`** | Number | `48` | Surface mesh resolution (8 - 256). Sets which wave octaves can be drawn at all — see *Wave Scale and Mesh Resolution*. Raise it on large volumes. |

### Group 2: Color & Optics
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`MaterialSource`** | Choice | `"Builtin"` | Reserved selector. The current runtime always uses its built-in shader; `"Material3D"` delegation is not implemented. |
| **`ShallowColor`** | Color | `"64; 224; 208"` | Color at shallow water depths (Turquoise). |
| **`DeepColor`** | Color | `"10; 45; 90"` | Color in deep oceanic trenches (Dark Navy). |
| **`ExtinctionDepth`** | Number | `150.0` | Beer-Lambert scale length. Larger values keep water reading as `ShallowColor` further from the shoreline. See *Optical depth* under Limitations. |
| **`RefractionScale`** | Number | `0.02` | Wave-normal distortion applied to the caustic pattern. This is **not** screen-space refraction of the scene behind the water — see Limitations. |

### Group 3: Foam & Caustics
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ShoreFoamIntensity`**| Number | `0.85` | Opacity of the surf band along a matching `WaterEdge3D`, falling back to the water volume perimeter when no edge is registered. |
| **`CrestFoamIntensity`**| Number | `0.60` | Whitecap foam spawning on steep wave peaks. |
| **`EnableCaustics`** | Boolean | `true` | Projects animated Voronoi caustic light patterns onto underwater seabeds. |

### Group 4: Underwater Camera Submersion
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableUnderwaterFX`**| Boolean | `false` | Applies scene fog while the camera is inside and below this water surface. |
| **`UnderwaterFogColor`**| Color | `"15; 65; 110"` | Volumetric color tint when swimming underwater. |
| **`UnderwaterFogDensity`**| Number| `0.0005` | Exponential fog density in scene-unit scale. |

### Moving Physics3D/Jolt body interactions (shared by all water types)

`WaterBody3D` and `OceanWaveWorks3D` expose the same four properties. A moving object only needs a
`Physics3D` behavior; it does **not** need `Buoyancy3D`. The water detects overlap with its 3D volume,
reads Jolt linear velocity (falling back to measured position change), and emits expanding displacement
rings plus foam. Successive rings form a wake.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableBodyInteractions`** | Boolean | `true` | Enables automatic wakes and splash rings from moving Physics3D/Jolt objects inside this water volume. |
| **`InteractionStrength`** | Number | `14` | Maximum vertical ripple displacement in scene units. Entry and vertical movement receive a splash boost. |
| **`InteractionRadius`** | Number | `180` | Maximum radius reached by each expanding ring, in scene units. |
| **`InteractionSpeedThreshold`** | Number | `35` | Minimum movement speed in scene units per second before a ring is emitted. |

---

## 1c. `OceanWaveWorks3D` Behavior Properties (NVIDIA WaveWorks Cascaded FFT)

Spectral ocean simulation replica of NVIDIA WaveWorks. Separates ocean dynamics into three fields:
1. **Cascade 0 (Macro Gravity Swell):** Long-wavelength deep ocean swells with spatial repetition matching the body size.
2. **Cascade 1 (High-Frequency Wind Chop & Capillary Waves):** High-frequency wavelets tiled at higher spatial frequency (`CascadeScale`, default 0.25 = $4\times$ spatial density) blended smoothly by `CascadeWeight`. Runs **with** the wind.
3. **Cross swell:** A second full-wavelength sea running `SwellAngle` degrees off the wind, blended by `SwellWeight`. Without it every crest travels the same way and waves can never break against each other - a single Phillips spectrum cuts upwind energy to 7%, so the sea marches rather than colliding. It shares cascade 0's tile and resolution, so it costs FFTs but no extra texture, uniform or shader work.

Features full Beaufort wind scale calibration (Beaufort 0 Calm through Beaufort 12 Hurricane), multi-cascade Jacobian whitecap foam, subsurface scattering (SSS), dual-lobe specular glitter, and independent opacity control.

### Group 1: Sea State & Wind (Beaufort Scale)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`BeaufortScale`** | Choice | `"Beaufort 4 - Moderate Breeze"` | Calibrated Beaufort wind preset (`"Custom"`, `"Beaufort 0 - Calm"`, `"Beaufort 2 - Light Breeze"`, `"Beaufort 4 - Moderate Breeze"`, `"Beaufort 6 - Strong Breeze"`, `"Beaufort 9 - Strong Gale"`, `"Beaufort 12 - Hurricane"`). Retunes wind, choppiness, foam, and cascade weighting without altering mesh geometry. |
| **`WindSpeed`** | Number | `7.0` | Wind speed in m/s driving the Phillips spectrum. |
| **`WindDirection`** | Number | `45.0` | Direction waves travel across the scene in degrees ($0 - 360^\circ$). |
| **`PeakWavelength`** | Number | `0` | Crest-to-crest distance in scene units ($0 = \text{Auto-fit}$). |
| **`WavelengthScale`** | Number | `0` | Wavelength scale multiplier ($0 = \text{Auto-fit}$). |
| **`WaveHeightScale`** | Number | `1.0` | Art-direction wave height multiplier on top of the physical derivation. |
| **`Choppiness`** | Number | `0.9` | Horizontal displacement sharpness ($0.0 = \text{Smooth swell}$, $1.0 = \text{Sharp crests}$). |
| **`CascadeScale`** | Number | `0.25` | Relative tile scale of secondary high-frequency cascade ($0.25 = 4\times$ spatial tiling). |
| **`CascadeWeight`** | Number | `0.60` | Blend weight of the secondary high-frequency cascade ($0.0 - 1.5$). |
| **`SwellAngle`** | Number | `60` | Direction of the cross swell relative to the wind, in degrees. Around 60 and above gives the most collisions; below about 30 the two seas are too aligned to meet. |
| **`SwellWeight`** | Number | `0.55` | How much of the sea is the cross swell ($0.0 - 1.5$). Measured hard collisions at Beaufort 9: 0.44% with no cross swell, 1.44% at 0.55, 2.91% at 1.0. `0` disables the second sea and skips its FFTs. |
| **`Resolution`** | Number | `64` | FFT spectrum grid size ($16 - 128$). |
| **`GridSubdivisions`**| Number | `64` | Mesh surface vertex subdivisions ($8 - 256$). Preserved across preset changes. |
| **`TileSize`** | Number | `0` | Spatial repetition period in scene units ($0 = \text{Volume size}$). |
| **`Seed`** | Number | `1337` | Deterministic random seed for spectrum phases. |
| **`UnitsPerMetre`** | Number | `100.0` | Scene units per real-world metre. |

### Group 2: Color, Foam & Optics
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Opacity`** | Number | `0.85` | Global water surface opacity ($0.0 = \text{Invisible/clear}$, $1.0 = \text{Normal full opacity}$). |
| **`MicroDetail`** | Number | `0.55` | High-frequency procedural wind-aligned capillary ripple normal intensity. |
| **`ShallowColor`** | Color | `"64; 224; 208"` | Tropical shallow / shoreline / backlit crest SSS tint (Turquoise). |
| **`DeepColor`** | Color | `"10; 45; 90"` | Deep oceanic water tint (Dark Navy). |
| **`ExtinctionDepth`** | Number | `150.0` | Beer-Lambert absorption scale in scene units. |
| **`FoamIntensity`** | Number | `0.55` | Whitecap froth and shoreline foam brightness/opacity. |
| **`FoamCoverage`** | Number | `0.25` | Surface fold threshold where Jacobian whitecaps break. |
| **`MaskUnderEdges`** | Boolean | `true` | Cut water surface beneath `WaterEdge3D` land volumes. |
| **`EnableCaustics`** | Boolean | `true` | Dynamic animated Voronoi seabed light patterns. |
| **`EnableUnderwaterFX`**| Boolean| `false` | Automatic volumetric fog when camera submerges. |
| **`UnderwaterFogColor`**| Color | `"15; 65; 110"` | Underwater fog tint. |
| **`UnderwaterFogDensity`**| Number| `0.0005` | Visibility decay when submerged. |

---

## 1d. `Buoyancy3D` Behavior Properties

Buoyancy works with `WaterBody3D` and `OceanWaveWorks3D`. A hull receives lift only while its bounds
overlap the water volume in XY and extend above the volume's bottom. Leaving the volume applies no
force, clears `IsFloating`, and lets `Physics3D` gravity take over normally. `TargetWaterBody`, when
set, is strict: a missing or non-overlapping named object does not fall back to unrelated water.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Physics3D`** | Behavior | `Physics3D` | Physics behavior to drive. Renamed Physics3D behaviors are also auto-detected. |
| **`BuoyancyFactor`** | Number | `1.0` | Lift relative to the object's weight at full submersion. |
| **`HullProbeCount`** | Choice | `4-Corners` | `1-Center`, `4-Corners`, or `8-HullBox`. Use 8 for long ships. |
| **`FluidDrag`** | Number | `2.0` | Linear and rotational water drag. |
| **`WaveInfluence`** | Number | `0.8` | How strongly the hull follows the local wave normal and orbital velocity. |
| **`Ship Stability`** | Number | `0.65` | Restoring roll/pitch torque. `0` disables it; values near `1` suit stable ships. |
| **`Stability Damping`** | Number | `1.5` | Damps roll/pitch angular velocity while probes touch water. Yaw is unaffected. |
| **`MaxSubmersionDepth`** | Number | `0` | Probe depth in **scene units (pixels)** at which lift reaches its maximum. Leave at `0` and it scales to the object's own depth — full lift once the hull is half under — which is correct at any project scale. Set a number only to override that, remembering GDevelop 3D is roughly 100 units per metre. |
| **`TargetWaterBody`** | String | empty | Optional exact water-object name. |
| **`Enabled`** | Boolean | `true` | Enables buoyancy. Disabling immediately clears floating state. |

---

## 2. `PourableLiquid3D` Behavior Properties (Micro SPH Pouring)

### Group 1: Liquid Profile & Emitter
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`FluidPreset`** | Choice | `"Magic Potion"` | Profile: `"Water"`, `"Magic Potion"`, `"Honey Syrup"`, `"Green Slime"`, `"Acid Poison"`, `"Lava Magma"`. |
| **`MaxDroplets`** | Number | `1500` | Maximum live droplets **from this emitter**. The scene-wide solver holds 3,000 across all emitters. |
| **`FlowRate`** | Number | `60.0` | Droplets spawned per second when pouring. |
| **`PourTiltThreshold`**| Number | `45.0` | Bottle tilt angle in degrees that triggers automatic pouring. |
| **`DropletRadius`** | Number | `0.02` | Droplet radius in metres. Also sets the rendered sphere size and the volume one droplet contributes to a container: $V = \tfrac{4}{3}\pi r^3 \times 1000$ litres. |

### Group 2: SPH Physics Parameters
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Viscosity`** | Number | `1.0` | Fluid thickness ($0.1 = \text{Water}$, $10.0 = \text{Honey}$, $50.0 = \text{Slime}$). |
| **`SurfaceTension`** | Number | `0.8` | Clumping cohesion force holding liquid stream together. |
| **`RestDensity`** | Number | `1000.0`| SPH target fluid density ($\text{kg/m}^3$). |

### Group 3: Droplet Appearance
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LiquidColor`** | Color | `"220; 30; 120"`| Per-droplet tint, written to the instanced droplet mesh. Two emitters with different presets render in their own colours. |
| **`LiquidOpacity`** | Number | `0.85` | Droplet transparency. All droplets share one instanced material, so the scene uses the **highest** opacity among registered emitters. |
| **`LiquidRoughness`** | Number | `0.05` | Stored on the behavior and readable from events. The droplet renderer is unlit, so this currently has no visual effect — see Limitations. |

---

## 2a. `WaterEdge3D` Behavior Properties (Coastline Volumes)

`WaterEdge3D` affects both `WaterBody3D` and `OceanWaveWorks3D`. Its axis-aligned XY bounds represent land:
water beneath the bounds is masked, waves flatten across the shallow band, and foam is generated on
the water-facing side. The edge must be on the same layer and its Z span must cross the water's top
surface. Up to eight nearest edges are uploaded per water body.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`FoamWidth`** | Number | `0` (auto) | Width of the animated surf band outside the land boundary, in scene units. `0` fits it to the water body — about 8% of its short side — so foam stays readable at any scene scale. A fixed width that looks right on a small pond is a hairline on a large bay. |
| **`ShallowWidth`** | Number | `0` (auto) | Distance over which water color shallows and wave displacement fades toward the boundary. `0` uses three times the resolved foam band width. |
| **`Enabled`** | Boolean | `true` | Whether this edge currently affects matching water. |
| **`HideSourceObject`** | Boolean | `false` | Hides a dedicated helper box at runtime. Leave disabled when the source object is visible beach or cliff geometry. |

---

## 2b. `WaterDetailing3D` Behavior Properties (Visual Polish, Shaders, Foam & Sun Path)

`WaterDetailing3D` is a visual polish companion behavior that attaches to **any** 3D object that has a water behavior (`WaterBody3D` or `OceanWaveWorks3D`).

It drives the underlying shader uniforms directly with zero CPU physics overhead, providing:
1. **Dynamic Sun Heading & Elevation**: Direct control of sun azimuth ($0 - 360^\circ$) and altitude ($0 - 90^\circ$). Low elevations ($15 - 25^\circ$) cast the signature *Sea of Thieves* golden-hour sun specular trail.
2. **Dual-Lobe Specular Highlights**: Sharp solar disk reflection surrounded by a wide anisotropic ocean glint path.
3. **Anti-Aliased Capillary Ripples**: Smooth multi-octave normal harmonics (`MicroFrequency`, `MicroDetail`) that completely eliminate high-frequency moiré diamond grid patterns.
4. **Wave Depth Contrast**: Modulates Beer-Lambert optical depth column by surface normal tilt and elevation (`WaveContrast`). Troughs deepen into deep oceanic navy while crests stay vibrant and luminous, eliminating milky/washed-out cyan colors.
5. **Directional Subsurface Scattering (SSS)**: Realistic backlit inner glow through wave crests aligned with camera-sun opposition.
6. **Whitecap Foam Coloring & Coverage**: Custom foam tint and pinch coverage.
7. **Full Runtime Customizer Support**: Every single property can be edited via GDevelop actions and queried via expressions, allowing users to build in-game graphical settings customizers effortlessly.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Preset`** | Choice | `Sea of Thieves - Golden Hour` | Quick visual profile (`Sea of Thieves - Golden Hour`, `Sea of Thieves - Midday`, `Stormy - Dark`, `Crystal Clear Tropical`, `Custom`). Setting individual parameters automatically switches to `Custom`. |
| **`SunHeading`** | Number | `75.0` | Sun horizontal azimuth angle in degrees ($0^\circ = $ East, $90^\circ = $ North, $180^\circ = $ West, $270^\circ = $ South). |
| **`SunElevation`** | Number | `18.0` | Sun altitude angle above the horizon in degrees ($0^\circ = $ horizon sunrise/sunset, $90^\circ = $ overhead noon). Low angles generate dramatic specular trails. |
| **`SunColor`** | Color | `"255; 245; 225"` | Sun light and specular reflection tint (warm gold for sunset, bright pale yellow/white for midday). |
| **`SunSpecularIntensity`** | Number | `2.8` | Overall brightness multiplier for the sun reflection and ocean specular glint path. |
| **`SunSpecularRoughness`** | Number | `160.0` | Specular sharpness / exponent ($32 = $ broad diffuse sheen, $160 = $ crisp Sea of Thieves sun trail, $512 = $ mirror reflection). |
| **`WaveContrast`** | Number | `0.55` | Modulates Beer-Lambert depth between crests and troughs ($0.0 - 1.0$). Deepens wave troughs into navy without washing out crests. |
| **`ShallowColor`** | Color | `"35; 220; 200"` | Color at shallow depths and wave peaks (vibrant translucent turquoise). |
| **`DeepColor`** | Color | `"4; 22; 48"` | Color in deeper water and shaded wave troughs (deep oceanic navy). |
| **`ExtinctionDepth`** | Number | `260.0` | Optical transition depth in pixels where water shifts from shallow turquoise to deep ocean navy. |
| **`TranslucencyColor`** | Color | `"40; 255; 220"` | Subsurface scattering inner glow color when looking toward the sun through wave crests. |
| **`TranslucencyIntensity`**| Number | `1.60` | Brightness multiplier for wave crest translucency and backlight scattering. |
| **`TranslucencyPower`** | Number | `2.8` | Angular falloff sharpness of the directional backlight alignment cone for SSS ($0.5 - 16.0$). |
| **`FoamColor`** | Color | `"248; 252; 255"`| Tint color of wave whitecaps and crest foam (bright seafoam white). |
| **`FoamIntensity`** | Number | `0.75` | Brightness multiplier for crest whitecaps and shore foam. |
| **`FoamCoverage`** | Number | `0.35` | Surface pinch/steepness threshold for whitecap generation ($0.0 = $ rare foam on highest peaks, $1.0 = $ heavy foam everywhere). |
| **`SprayEnabled`** | Boolean | `false` | Enable upward droplet spray when wave crests collide (converging eigenvalues in the displacement gradient tensor). |
| **`SprayAmount`** | Number | `0.5` | Emission rate multiplier for wave-collision spray droplets ($0.0 = $ none, $1.0 = $ heavy plumes). |
| **`SprayHeight`** | Number | `1.0` | Velocity and height multiplier for upward spray droplets. |
| **`SprayThreshold`** | Number | `0.5` | Sensitivity threshold for wave collisions ($0.0 = $ easy triggering, $1.0 = $ only violent head-on collisions spurt). |
| **`MicroDetail`** | Number | `0.35` | Strength of anti-aliased capillary micro-ripples ($0.0 = $ glassy surface, $1.0+ = $ agitated chop). |
| **`MicroFrequency`** | Number | `1.0` | Spatial frequency multiplier for capillary micro-ripples ($0.5 = $ broad gentle ripples, $1.0 = $ crisp clear ripples, $2.0+ = $ fine surface disturbance). |
| **`Opacity`** | Number | `0.78` | Overall water surface opacity ($0.0 = $ completely transparent, $1.0 = $ fully opaque). |

---

## 2c. Skybox Cubemap Reflection & Scene DirectionalLight Auto-Sync

Both water models (`WaterBody3D`, `OceanWaveWorks3D`) automatically integrate with GDevelop's native 3D engine systems:

### 1. Native Skybox Cubemap Reflection
* **Where to enable in GDevelop:** **Layers Panel $\rightarrow$ Edit Layer Effects $\rightarrow$ Add Effect $\rightarrow$ Skybox**. Provide 6 cubemap face textures (Positive X, Negative X, Positive Y, Negative Y, Positive Z, Negative Z).
* **Automatic Detection:** The water runtime inspects `layer.getRenderer().getThreeScene().environment` and `background`. When a `CubeTexture` is attached, the water automatically switches from the procedural analytic sky dome to full high-resolution cubemap reflections (`u_EnvMap`) weighted by Schlick Fresnel.
* **Coordinate Inversion Correction:** Because GDevelop mirrors Three.js scenes vertically (`threeScene.scale.y = -1`), the water reflection pass samples cubemaps using `textureCube(u_EnvMap, vec3(reflectDir.x, -reflectDir.y, reflectDir.z))` so mountains, clouds, and skies reflect right-side-up.
* **Graceful Fallback:** If no Skybox effect is active on the layer, the water seamlessly falls back to the graduated analytic zenith-to-horizon sky dome with zero configuration or errors.

### 2. Scene `DirectionalLight` Auto-Sync
* **Automatic Sun Synchronization:** If the `WaterDetailing3D` companion behavior is not attached, the water automatically searches the 3D scene for any `DirectionalLight`.
* **Direction & Color:** It derives the sun vector from `sunLight.position - sunLight.target` and scales the sun tint by `sunLight.color * sunLight.intensity`.
* **Manual Override:** You can manually override the sun vector and color at any time via `SetSunDirection` and `SetSunColor` actions on `OceanWaveWorks3D`, or by attaching `WaterDetailing3D`.

---

## 2d. `WaterStrengthSlider3D` Behavior Properties (Continuous Sea-State Slider)

`WaterStrengthSlider3D` is a dedicated sea-state control behavior that can attach to any object (or water body) to dynamically modulate `OceanWaveWorks3D` and `WaterBody3D`.

Instead of jumping between discrete rungs, it provides a continuous strength value with optional smooth exponential damping transitions, ideal for game sliders, weather systems, or scripted storms.

Initial values are clamped to the selected range and applied without a startup transition. For example, normalized `0.5` starts at Beaufort 6. Damping affects later changes and settles exactly at the target; unchanged sliders skip spectrum rebuilds. Changing the target applies the current strength to the newly bound body.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ScaleMode`** | Choice | `Beaufort (0 - 12)` | Operating scale mode: `Beaufort (0 - 12)` (physical maritime scale) or `Normalized (0 - 1)` (fractional unit scale). |
| **`Strength`** | Number | `4.0` | Initial water strength target ($0.0 - 12.0$ in Beaufort mode, or $0.0 - 1.0$ in Normalized mode). |
| **`SmoothDamping`** | Number | `0.0` | Smooth transition time constant in seconds ($0.0 = $ instant jump, $> 0 = $ smooth exponential damping towards target). |
| **`TargetWaterBody`** | String | `""` | Optional object name of the target water body to control. If empty, automatically binds to the water body on the same object, or the first active water body/ocean in the scene. |

---

## 3. Actions

### `WaterBody3D` Actions
* **`Set wave height on _PARAM0_ to _PARAM1_ scene units`**: Updates Gerstner-wave amplitude in real time.
* **`Set wave irregularity on _PARAM0_ to _PARAM1_`**: Adjusts deterministic crest-line warping from 0 to 1.
* **`Set wind direction on _PARAM0_ to _PARAM1_ degrees`**: Rotates ocean swell propagation vector.
* **`Set water colors on _PARAM0_ (ShallowColor: _PARAM1_, DeepColor: _PARAM2_)`**: Updates water palette.
* **`Set underwater fog density on _PARAM0_ to _PARAM1_`**: Modifies murky underwater visibility.

### `OceanWaveWorks3D` Actions
* **`Set Beaufort scale on _PARAM0_ to _PARAM2_` (`SetBeaufortScale`)**: Changes the calibrated Beaufort wind scale preset (`Custom`, `Beaufort 0 - Calm`, `Beaufort 2 - Light Breeze`, `Beaufort 4 - Moderate Breeze`, `Beaufort 6 - Strong Breeze`, `Beaufort 9 - Strong Gale`, `Beaufort 12 - Hurricane`) without altering mesh subdivisions.
* **`Set secondary cascade blend weight on _PARAM0_ to _PARAM2_` (`SetCascadeWeight`)**: Dynamically tunes the high-frequency wavelet detail contribution ($0.0 - 1.5$).
* **`Set water opacity on _PARAM0_ to _PARAM2_` (`SetOpacity`)**: Controls water surface transparency ($0.0 = $ completely transparent, $1.0 = $ fully opaque).
* **`Set micro-wave ripples detail on _PARAM0_ to _PARAM2_` (`SetMicroDetail`)**: Controls procedural capillary ripple normal strength ($0.0 - 2.0$).
* **`Set wind on _PARAM0_ to _PARAM2_ m/s heading _PARAM3_ degrees` (`SetWind`)**: Updates wind speed and direction, rebuilding dual spectrum cascades and aligning capillary ripples.
* **`Set wave length on _PARAM0_ to _PARAM2_ units` (`SetPeakWavelength`)**: Sets crest-to-crest wavelength distance in scene units ($0 = $ auto fit).
* **`Set wave length scale on _PARAM0_ to _PARAM2_` (`SetWavelengthScale`)**: Sets wavelength scale ($0 = $ auto fit).
* **`Set ocean choppiness on _PARAM0_ to _PARAM2_` (`SetChoppiness`)**: Controls horizontal displacement sharpness and whitecap folding ($0.0 - 1.5$).
* **`Set sun direction on _PARAM0_ to heading _PARAM2_ degrees, elevation _PARAM3_ degrees` (`SetSunDirection`)**: Manually overrides sun heading ($0 - 360^\circ$) and elevation ($0 - 90^\circ$). Overrides scene directional light auto-sync.
* **`Set sun color on _PARAM0_ to _PARAM2_` (`SetSunColor`)**: Manually overrides sun specular and SSS backlight tint (`"R;G;B"`).
* **`Set ocean texture anisotropic filtering on _PARAM0_ to _PARAM2_x` (`SetTextureAnisotropy`)**: Sets hardware anisotropic filtering level ($1 - 16\text{x}$) for ocean displacement and slope textures at glancing angles.

### `WaterDetailing3D` Actions
* **`Set water detailing preset on _PARAM0_ to _PARAM2_` (`SetPreset`)**: Applies visual preset (`Sea of Thieves - Golden Hour`, `Sea of Thieves - Midday`, `Stormy - Dark`, `Crystal Clear Tropical`).
* **`Set sun heading on _PARAM0_ to _PARAM2_ degrees` (`SetSunHeading`)**: Adjusts horizontal azimuth angle ($0 - 360^\circ$).
* **`Set sun elevation on _PARAM0_ to _PARAM2_ degrees` (`SetSunElevation`)**: Adjusts sun altitude above horizon ($0 - 90^\circ$).
* **`Set sun color on _PARAM0_ to _PARAM2_` (`SetSunColor`)**: Sets sunlight and specular glint tint.
* **`Set sun specular intensity on _PARAM0_ to _PARAM2_` (`SetSunSpecularIntensity`)**: Sets brightness of the sun reflection glint trail.
* **`Set sun specular sharpness on _PARAM0_ to _PARAM2_` (`SetSunSpecularRoughness`)**: Sets specular roughness / exponent ($32 - 512$).
* **`Set complete sun lighting on _PARAM0_` (`SetSunLighting`)**: Compound action setting heading, elevation, color, specular intensity, and sharpness.
* **`Set shallow water color on _PARAM0_ to _PARAM2_` (`SetShallowColor`)**: Updates shallow and wave crest color tint.
* **`Set deep ocean color on _PARAM0_ to _PARAM2_` (`SetDeepColor`)**: Updates deep ocean and trough color tint.
* **`Set wave depth contrast on _PARAM0_ to _PARAM2_` (`SetWaveContrast`)**: Controls depth modulation factor between crests and troughs ($0.0 - 1.0$).
* **`Set extinction depth on _PARAM0_ to _PARAM2_ pixels` (`SetExtinctionDepth`)**: Sets Beer-Lambert optical depth in pixels.
* **`Set water palette & contrast on _PARAM0_` (`SetWaterPalette`)**: Compound action setting shallow color, deep color, wave contrast, and extinction depth.
* **`Set translucency color on _PARAM0_ to _PARAM2_` (`SetTranslucencyColor`)**: Sets SSS inner glow color.
* **`Set translucency intensity on _PARAM0_ to _PARAM2_` (`SetTranslucencyIntensity`)**: Sets SSS brightness multiplier.
* **`Set translucency falloff power on _PARAM0_ to _PARAM2_` (`SetTranslucencyPower`)**: Sets SSS backlight alignment cone sharpness ($0.5 - 16.0$).
* **`Set complete translucency / SSS on _PARAM0_` (`SetTranslucency`)**: Compound action setting color, intensity, and falloff power.
* **`Set foam color on _PARAM0_ to _PARAM2_` (`SetFoamColor`)**: Sets whitecap foam tint.
* **`Set foam brightness on _PARAM0_ to _PARAM2_` (`SetFoamIntensity`)**: Sets whitecap foam brightness multiplier.
* **`Set foam coverage threshold on _PARAM0_ to _PARAM2_` (`SetFoamCoverage`)**: Sets surface pinch threshold for foam coverage ($0.0 - 1.0$).
* **`Set complete foam parameters on _PARAM0_` (`SetFoam`)**: Compound action setting foam color, brightness, and coverage.
* **`Set micro-ripples detail on _PARAM0_ to _PARAM2_` (`SetMicroDetail`)**: Sets capillary micro-ripples amplitude ($0.0 - 2.0$).
* **`Set micro-ripples frequency on _PARAM0_ to _PARAM2_` (`SetMicroFrequency`)**: Sets spatial frequency scale for micro-ripples ($0.1 - 5.0$).
* **`Set micro-ripples detail & frequency on _PARAM0_` (`SetMicroRipples`)**: Compound action setting detail and frequency.
* **`Set water surface opacity on _PARAM0_ to _PARAM2_` (`SetOpacity`)**: Controls water surface opacity ($0.0 - 1.0$).
* **`Set wave-collision spray on _PARAM0_ to _PARAM2_` (`SetSprayEnabled`)**: Enable or disable droplet spray spawning at wave collision sites.
* **`Set wave spray amount on _PARAM0_ to _PARAM2_` (`SetSprayAmount`)**: Changes spray droplet emission rate multiplier ($0.0 - 1.0$).
* **`Set wave spray launch height on _PARAM0_ to _PARAM2_` (`SetSprayHeight`)**: Changes upward launch velocity and height multiplier for spray droplets.
* **`Set wave spray collision threshold on _PARAM0_ to _PARAM2_` (`SetSprayThreshold`)**: Changes sensitivity threshold for wave collisions ($0.0 - 1.0$).
* **`Set texture anisotropic filtering on _PARAM0_ to _PARAM2_x` (`SetTextureAnisotropy`)**: Sets hardware anisotropic filtering level ($1 - 16\text{x}$) for water detail, slope, and foam textures.

### `WaterStrengthSlider3D` Actions
* **`Set water strength on _PARAM0_ to _PARAM2_` (`SetStrength`)**: Sets water strength value ($0 - 12$ in Beaufort mode, or $0.0 - 1.0$ in Normalized mode).
* **`Set normalized water strength on _PARAM0_ to _PARAM2_` (`SetNormalizedStrength`)**: Sets normalized water strength ($0.0 - 1.0$), converting automatically to the active scale mode.
* **`Set strength transition damping on _PARAM0_ to _PARAM2_ seconds` (`SetSmoothDamping`)**: Sets smooth transition damping time constant in seconds ($0.0 = $ instant).
* **`Set target water body on _PARAM0_ to _PARAM2_` (`SetTargetWaterBody`)**: Sets object name of target water body to control.

### Buoyancy Actions
* **Set buoyancy factor**: Changes lift relative to object weight.
* **Set fluid drag** and **Set wave influence**: Tune motion through and alignment with water.
* **Set ship stability** and **Set ship stability damping**: Tune restoring torque and rocking decay at runtime.
* **Set max submersion depth**: Changes the probe depth at which lift reaches maximum.
* **Enable / Disable buoyancy**: Stops or resumes buoyancy and clears floating state when disabled.

### `PourableLiquid3D` Actions
* **`Start pouring liquid on _PARAM0_ (FlowRate: _PARAM1_)`**: Manually activates liquid emitter stream.
* **`Stop pouring liquid on _PARAM0_`**: Stops liquid emission.
* **`Set liquid preset on _PARAM0_ to _PARAM1_`**: Applies preset (`"Honey"`, `"Acid"`, `"Potion"`).
* **`Set liquid viscosity on _PARAM0_ to _PARAM1_`**: Adjusts fluid thickness live.
* **`Empty container volume on _PARAM0_`**: Resets liquid fill volume inside cup/cauldron to zero.

---

## 4. Conditions

### `WaterBody3D` Conditions
* **`Is camera underwater inside _PARAM0_`**: True if active camera has submerged below water surface.
* **`Is object floating on water _PARAM0_`**: True if rigid body is currently buoyant on waves.

### `OceanWaveWorks3D` Conditions
* **`Camera is submerged in _PARAM0_` (`IsCameraUnderwater`)**: True when the active camera is below the WaveWorks ocean surface.

### `WaterDetailing3D` Conditions
* **`Spray is enabled on _PARAM0_` (`IsSprayEnabled`)**: True if wave-collision spray droplets are currently enabled.
* **`Texture anisotropic filtering is enabled on _PARAM0_` (`IsTextureAnisotropyEnabled`)**: True if the companion ocean's slope textures use effective anisotropy above 1x after device and texture-format limits. False when no compatible ocean is bound.

### `WaterStrengthSlider3D` Conditions
* **`Water on _PARAM0_ is calm` (`IsCalm`)**: True if water strength is currently calm (Beaufort $< 1.0$).
* **`Water on _PARAM0_ is stormy` (`IsStormy`)**: True if water strength is currently stormy (Beaufort $\ge 8.0$).

### `PourableLiquid3D` Conditions
* **`Is bottle currently pouring on _PARAM0_`**: True if liquid droplets are actively streaming.
* **`Is container full on _PARAM0_`**: True if container has reached $100\%$ capacity.
* **`Is container fill level greater than _PARAM1_ percent on _PARAM0_`**: Threshold check ($0 - 100\%$).

---

## 5. Expressions

### Wave & Water Queries (`WaterBody3D`)
* **`Object.WaterBody3D::WaveHeightAt(x, y)`**: Returns live wave height $Z$ at world $(X, Y)$ coordinates.
* **`Object.WaterBody3D::WaterSurfaceZ(x, y)`**: Returns exact top surface altitude including waves.
* **`Object.WaterBody3D::SubmersionDepth()`**: Returns depth below the surface in scene units.

### WaveWorks Dual-Cascade Queries (`OceanWaveWorks3D`)
* **`Object.OceanWaveWorks3D::BeaufortScale()`**: Returns the current Beaufort scale preset name as string (`"Custom"`, `"Beaufort 0 - Calm"`, ..., `"Beaufort 12 - Hurricane"`).
* **`Object.OceanWaveWorks3D::CascadeWeight()`**: Returns the current secondary cascade blend weight ($0.0 - 1.5$).
* **`Object.OceanWaveWorks3D::Opacity()`**: Returns the current water surface opacity ($0.0 - 1.0$).
* **`Object.OceanWaveWorks3D::MicroDetail()`**: Returns the current micro-wave ripple normal intensity ($0.0 - 2.0$).
* **`Object.OceanWaveWorks3D::WaveHeightAt(x, y)`**: Returns combined dual-cascade wave displacement $Z$ at world $(X, Y)$.
* **`Object.OceanWaveWorks3D::SurfaceZ(x, y)`**: Returns absolute surface altitude $Z$ at world $(X, Y)$ including composite dual-cascade waves.
* **`Object.OceanWaveWorks3D::SignificantWaveHeight()`**: Returns significant wave height ($H_s = 0.21 V^2 / g$) in scene units.
* **`Object.OceanWaveWorks3D::WindSpeed()`**: Returns current wind speed in m/s.
* **`Object.OceanWaveWorks3D::TextureAnisotropy()`**: Returns the effective anisotropic filtering level of the ocean slope textures ($1 - 16$), or 1 when unavailable. The property/action stores the requested level; this expression reports the applied level.

### Water Detailing Queries (`WaterDetailing3D`)
* **`Object.WaterDetailing3D::Preset()`**: Returns active preset name (`"Sea of Thieves - Golden Hour"`, `"Sea of Thieves - Midday"`, `"Stormy - Dark"`, `"Crystal Clear Tropical"`, or `"Custom"`).
* **`Object.WaterDetailing3D::SunHeading()`**: Returns sun horizontal azimuth in degrees ($0 - 360$).
* **`Object.WaterDetailing3D::SunElevation()`**: Returns sun altitude angle above the horizon in degrees ($0 - 90$).
* **`Object.WaterDetailing3D::SunColor()`**: Returns sun light tint color formatted as `"R;G;B"`.
* **`Object.WaterDetailing3D::SunSpecularIntensity()`**: Returns sun reflection brightness multiplier.
* **`Object.WaterDetailing3D::SunSpecularRoughness()`**: Returns sun specular sharpness / exponent ($32 - 512$).
* **`Object.WaterDetailing3D::ShallowColor()`**: Returns shallow water color formatted as `"R;G;B"`.
* **`Object.WaterDetailing3D::DeepColor()`**: Returns deep ocean color formatted as `"R;G;B"`.
* **`Object.WaterDetailing3D::WaveContrast()`**: Returns wave optical depth contrast factor ($0.0 - 1.0$).
* **`Object.WaterDetailing3D::ExtinctionDepth()`**: Returns Beer-Lambert optical depth in pixels.
* **`Object.WaterDetailing3D::TranslucencyColor()`**: Returns SSS inner glow color formatted as `"R;G;B"`.
* **`Object.WaterDetailing3D::TranslucencyIntensity()`**: Returns SSS glow brightness multiplier.
* **`Object.WaterDetailing3D::TranslucencyPower()`**: Returns directional backlight alignment cone sharpness ($0.5 - 16.0$).
* **`Object.WaterDetailing3D::FoamColor()`**: Returns crest whitecap foam color formatted as `"R;G;B"`.
* **`Object.WaterDetailing3D::FoamIntensity()`**: Returns whitecap foam brightness multiplier.
* **`Object.WaterDetailing3D::FoamCoverage()`**: Returns whitecap surface coverage threshold ($0.0 - 1.0$).
* **`Object.WaterDetailing3D::SprayAmount()`**: Returns spray droplet emission rate multiplier ($0.0 - 1.0$).
* **`Object.WaterDetailing3D::SprayHeight()`**: Returns upward spray droplet launch height multiplier.
* **`Object.WaterDetailing3D::SprayThreshold()`**: Returns spray collision sensitivity threshold ($0.0 - 1.0$).
* **`Object.WaterDetailing3D::MicroDetail()`**: Returns capillary micro-ripples normal perturbation amplitude ($0.0 - 2.0$).
* **`Object.WaterDetailing3D::MicroFrequency()`**: Returns spatial frequency multiplier for micro-ripples ($0.1 - 5.0$).
* **`Object.WaterDetailing3D::Opacity()`**: Returns water surface opacity ($0.0 - 1.0$).
* **`Object.WaterDetailing3D::TextureAnisotropy()`**: Returns the companion ocean slope textures' effective filtering level ($1 - 16$), or 1 when no compatible ocean is bound. Float textures can fall back to 1x even when the device supports higher anisotropy for ordinary textures or persistent foam.
* **`Object.WaterDetailing3D::MaxDeviceAnisotropy()`**: Returns maximum hardware anisotropic filtering level supported by the current device GPU ($1 - 16$).

### Sea-State Slider Queries (`WaterStrengthSlider3D`)
* **`Object.WaterStrengthSlider3D::Strength()`**: Returns current water strength value according to active scale mode.
* **`Object.WaterStrengthSlider3D::NormalizedStrength()`**: Returns current normalized water strength ($0.0 - 1.0$).
* **`Object.WaterStrengthSlider3D::SmoothDamping()`**: Returns smooth transition damping in seconds.
* **`Object.WaterStrengthSlider3D::TargetWaterBody()`**: Returns object name of target water body.
* **`Object.WaterStrengthSlider3D::BeaufortLabel()`**: Returns formatted Beaufort scale label (e.g. `"Beaufort 4.2 - Moderate Breeze"`).
* **`Object.WaterStrengthSlider3D::BeaufortRungName()`**: Returns name of closest integer Beaufort rung (e.g. `"Moderate Breeze"`).
* **`Object.WaterStrengthSlider3D::WindSpeed()`**: Returns equivalent continuous wind speed in m/s.

### SPH & Container Queries
* **`Object.PourableLiquid3D::FillLevelPercent()`**: Container fill level percentage ($0.0 - 100.0\%$).
* **`Object.PourableLiquid3D::CurrentLiquidVolume()`**: Fluid volume accumulated in liters/milliliters.
* **`Object.PourableLiquid3D::ActiveDropletCount()`**: Number of live fluid particles in simulation.

---

## 6. Preset Profiles Tables

> [!NOTE]
> **Panel layout.** GDevelop reads a behavior’s properties from a sorted map, so the properties
> panel is ordered **alphabetically by property NAME** and each group section appears where its
> alphabetically-first property falls. Declaration order has no effect at all. That is why the
> preset selectors are named `ArtStyle`, `ArtWaterLook`, `ArtLighting`, `ArtWaterType`,
> `ArtWavePreset` and `ArtFluidPreset` — the `Art` prefix sorts them ahead of everything else so
> the **Presets — start here** section is the first thing in every panel. Their labels are
> unchanged. A build assertion re-derives this order and fails if a rename ever pushes the preset
> section down.

> [!TIP]
> **`WaterDetailing3D` is chosen on three independent axes** since 2.17.0, instead of one flat list:
>
> | Axis | Owns | Choices |
> | :--- | :--- | :--- |
> | **Style** — how it is drawn | the method: caustics-vs-depth, crest glow, contrast, foam character. **No colours.** | `Sea of Thieves`, `Realistic`, `Custom` |
> | **Water Type** — what it is | the palette and optics | `Open Ocean`, `Clear Tropical`, `Calm`, `Murky`, `Stormy`, `Swimming Pool`, `Custom` |
> | **Lighting** — what hour it is | the sun alone: heading, elevation, colour, specular lobe | `Golden Hour`, `Midday`, `Custom` |
>
> They compose in that order: the type supplies the palette, the lighting replaces the sun, then
> the style scales what is left — so a style still shapes whichever hour you picked. Each axis can
> be set to `Custom` on its own; setting **Lighting** to `Custom` hands the sun back to the
> Sun Heading / Elevation / Color properties while Style and Water Type stay on presets.
>
> Adding a sunrise, an overcast sky or a new art style is one entry in the matching table and one
> more value in that property’s list — no palette is duplicated.

> [!IMPORTANT]
> **A named preset overrides the individual properties.** Choosing anything other than `Custom`
> in a preset dropdown makes that preset own the colours, foam, optics and sea state; the
> individual properties beneath it are the **Custom-mode** values and are ignored until you set
> the preset to `Custom`. Before 2.13.0 the reverse was true by accident — GDevelop always sends
> every property, so the preset value was a fallback that could never be reached, and the
> `WaterDetailing3D` dropdown in particular changed nothing at all except the name its expression
> reported.

### 6a. Environmental Look Presets (`WaterDetailing3D`)

> [!NOTE]
> These looks used to appear in `OceanWaveWorks3D`’s **Beaufort Scale Preset** list as well. They were
> removed from that dropdown in 2.12.0: it now offers only `Custom` and the six wind rungs, because
> the label promises a physical wind scale and several entries duplicated it — `Stormy` was identical
> to `Beaufort 9 - Strong Gale` in every field, and `Swimming Pool` and `Flat Water` carried the same
> all-zero sea state as `Beaufort 0 - Calm`. Styling belongs to `WaterDetailing3D`. Any name listed
> here still resolves if an existing project or a `SetBeaufortScale` action uses it.

All water behaviors support dynamic environmental presets that simultaneously tune physical waves, wind, **water color palettes (shallow, deep, SSS glow)**, directional fibrous foam, and depth-attenuated caustics:

| Preset | Wind Speed ($V$) | Wave Height Scale | Choppiness ($\lambda$) | Foam (Int / Cov) | Shallow / Deep Color | Caustics | Visual & Environmental Character |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`Swimming Pool`** | `0.0` m/s | `0.0` | `0.0` | `0.0` / `0.0` | Vibrant Cyan `[20, 225, 240]` / Deep Azure `[10, 115, 185]` | `1.5` (Full) | **Resort Swimming Pool:** Crystal-clear turquoise water with vibrant seabed caustics, mirror-flat surface, zero wave displacement. |
| **`Sea of Thieves`** | `10.0` m/s | `1.0` | `1.0` | `1.1` / `0.35` | Tropical Emerald `[0, 215, 185]` / Deep Ocean `[4, 22, 48]` | `0.8` (Attenuated) | **Caribbean Sea of Thieves:** Iconic turquoise shallow water, radiant cyan backlit crest translucency, deep oceanic navy troughs, and wind-aligned fibrous whitecap lace. |
| **`Murky`** | `7.5` m/s | `0.8` | `0.85` | `0.75` / `0.25` | Deep Oceanic Slate `[18, 62, 88]` / Deep Navy `[6, 18, 32]` | `0.2` (Low) | **Deep Murky Waters:** Dark oceanic navy-blue water with reduced light transmission and optical depth (65 units), subtle low-contrast foam. Oceanic blue hue, not swamp green. |
| **`Stormy`** | `22.0` m/s | `1.4` | `1.3` | `1.1` / `0.55` | Dark Tempest Slate `[20, 52, 78]` / Midnight Abyss `[4, 12, 24]` | `0.1` (Minimal) | **Tempest / Gale:** Severe midnight slate-blue sea state, heavy crashing swells, aggressive optical contrast (0.85), dense wind-blown fibrous foam froth. |
| **`Calm`** | `3.5` m/s | `0.6` | `0.5` | `0.2` / `0.10` | Aquamarine `[15, 185, 200]` / Azure Navy `[8, 45, 90]` | `0.6` (Moderate) | **Peaceful Lagoon:** Glassy gentle rolling swells, delicate ripples, high water clarity with soft caustics. |
| **`Flat Water`** | `0.0` m/s | `0.0` | `0.0` | `0.0` / `0.0` | Inherited from Swimming Pool | `0.0` | Completely flat, mirror reflection with zero wave displacement. |
| **`Wavy`** | `11.0` m/s | `1.0` | `1.0` | `0.8` / `0.35` | Inherited from Sea of Thieves | `0.8` | Classic rolling swells with standard whitecaps and capillary micro-ripples. |

> [!NOTE]
> Presets dynamically update water colors, SSS translucency, foam, contrast, and caustics at runtime. Caustics automatically attenuate with optical water column depth ($\text{attenuation} = 1.0 - \tfrac{\text{depth}}{0.65 \times \text{ExtinctionDepth}}$) so open oceans never look like swimming pools, while dedicated pools retain bright caustics throughout.
> Presets **never** modify `GridSubdivisions` (mesh geometry resolution), ensuring zero vertex reallocation hitches or physics glitches at runtime.

### 6b. Fluid Presets (`PourableLiquid3D`)

| Preset | Viscosity ($\mu$) | Surface Tension | Opacity | Roughness | Visual Style |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`Water`** | `0.2` | `0.5` | `0.30` | `0.02` | Clear, rapid splashing, high refraction. |
| **`Magic Potion`** | `0.8` | `1.2` | `0.85` | `0.05` | Glowing magenta/cyan, sparkling highlights. |
| **`Honey Syrup`** | `15.0` | `2.5` | `0.90` | `0.08` | Thick, gooey, slow stringy pouring. |
| **`Green Slime`** | `35.0` | `3.0` | `0.95` | `0.15` | Chunky blobby viscous monster slime. |
| **`Acid Poison`** | `0.3` | `0.6` | `0.70` | `0.02` | Bright lime-green, sizzle bubble motes. |
| **`Lava Magma`** | `20.0` | `2.0` | `1.00` | `0.35` | Incandescent molten rock with crust. |

### 6c. Beaufort Wind Scale Presets (`OceanWaveWorks3D` & `WaterStrengthSlider3D`)

The maritime Beaufort scale provides all 13 standard rungs ($0 - 12$) plus continuous fractional interpolation. The six authored rungs below serve as **anchors** closely tracking the physical law $V = 0.836 \cdot B^{1.5}$; intermediate and fractional rungs are continuously interpolated, ensuring smooth transitions without sudden jumps in wave height or foam.

| Beaufort Scale | Wind Speed ($V$) | Wave Height Scale | Choppiness ($\lambda$) | Cascade Weight | Foam Intensity | Foam Coverage | Micro Detail | Real-World Sea State Description |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`Beaufort 0 - Calm`** (Anchor) | `0.0` m/s | `0.00` | `0.00` | `0.00` | `0.00` | `0.00` | `0.00` | **Calm (Sea like a mirror):** Flat water surface, zero wave displacement, mirror reflections. |
| **`Beaufort 1 - Light Air`** | `0.8` m/s | `0.18` | `0.30` | `0.20` | `0.08` | `0.04` | `0.15` | **Light Air (Ripples):** Direction shown by smoke drift, not by wind vanes. |
| **`Beaufort 2 - Light Breeze`** (Anchor) | `2.5` m/s | `0.35` | `0.60` | `0.40` | `0.15` | `0.08` | `0.30` | **Light Breeze (Small wavelets):** Crests have a glassy appearance and do not break. Short, delicate ripples. |
| **`Beaufort 3 - Gentle Breeze`** | `4.8` m/s | `0.55` | `0.75` | `0.50` | `0.35` | `0.16` | `0.42` | **Gentle Breeze (Large wavelets):** Crests begin to break; scattered whitecaps. |
| **`Beaufort 4 - Moderate Breeze`** (Anchor) | `7.0` m/s | `0.75` | `0.90` | `0.60` | `0.55` | `0.25` | `0.55` | **Moderate Breeze (Small waves becoming longer):** Fairly frequent white horses (whitecaps), noticeable swell. |
| **`Beaufort 5 - Fresh Breeze`** | `9.8` m/s | `0.88` | `0.98` | `0.65` | `0.70` | `0.32` | `0.62` | **Fresh Breeze (Moderate waves):** Many white horses; some spray. |
| **`Beaufort 6 - Strong Breeze`** (Anchor) | `12.5` m/s | `1.00` | `1.05` | `0.70` | `0.85` | `0.40` | `0.70` | **Strong Breeze (Large waves begin to form):** Extensive white foam crests everywhere, spray may reduce visibility. |
| **`Beaufort 7 - Near Gale`** | `15.7` m/s | `1.20` | `1.15` | `0.75` | `1.03` | `0.48` | `0.80` | **Near Gale (Sea heaps up):** White foam from breaking waves begins to be blown in streaks. |
| **`Beaufort 8 - Gale`** | `18.8` m/s | `1.40` | `1.25` | `0.80` | `1.22` | `0.57` | `0.90` | **Gale (Moderately high waves):** Edges of crests break into spindrift; foam is blown in well-marked streaks. |
| **`Beaufort 9 - Strong Gale`** (Anchor) | `22.0` m/s | `1.60` | `1.35` | `0.85` | `1.40` | `0.65` | `1.00` | **Strong Gale (High waves with dense foam streaks):** Crests begin to topple, roll and tumble over. Spray affects visibility. |
| **`Beaufort 10 - Storm`** | `26.3` m/s | `1.87` | `1.42` | `0.88` | `1.60` | `0.72` | `1.10` | **Storm (Very high waves with long overhanging crests):** Great patches of foam; tumbling sea. |
| **`Beaufort 11 - Violent Storm`** | `30.7` m/s | `2.13` | `1.48` | `0.92` | `1.80` | `0.78` | `1.20` | **Violent Storm (Exceptionally high waves):** Sea completely covered with long white patches of foam. |
| **`Beaufort 12 - Hurricane`** (Anchor) | `35.0` m/s | `2.40` | `1.55` | `0.95` | `2.00` | `0.85` | `1.30` | **Hurricane Force (Huge rogue waves):** The air is filled with foam and spray, sea completely white with driving spray. |

> [!NOTE]
> Changing `BeaufortScale` presets adjusts physical wind dynamics, dual-cascade weights, foam, and capillary detail, while strictly preserving `GridSubdivisions` (mesh geometry resolution). Integer rungs are memoised for referential stability.

### 6d. Water Detailing Presets (`WaterDetailing3D`)

| Preset | Sun Heading / Elevation | Sun Color | Specular (Int / Sharp) | Depth Contrast | Shallow / Deep Color | SSS Glow (Int / Pow) | Foam (Int / Cov) | Visual Style |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`Sea of Thieves - Golden Hour`** | $180^\circ$ / $18^\circ$ | Warm Gold | `2.6` / `128.0` | `0.70` | Vibrant Cyan / Deep Navy | `1.85` / `3.5` | `0.95` / `0.38` | **Low Sunset Golden Hour:** Signature blazing sun reflection glint trail, luminous cyan crest translucency against deep oceanic troughs, crisp whitecaps. |
| **`Sea of Thieves - Midday`** | $45^\circ$ / $65^\circ$ | Pale Warm White | `2.0` / `160.0` | `0.55` | Aquamarine / Dark Navy | `1.40` / `3.0` | `0.85` / `0.35` | **Tropical Midday Sun:** High overhead sun angle, wide crisp solar reflection, Caribbean turquoise shallow coloration, clear water clarity. |
| **`Stormy - Dark`** | $225^\circ$ / $30^\circ$ | Dim Cold Slate | `1.2` / `64.0` | `0.85` | Murky Sea-Green / Inky Black | `0.65` / `2.5` | `1.60` / `0.70` | **Ominous Tempest:** Dark slate sky lighting, broad muted specular sheen, severe optical contrast with inky black troughs, dense churning white froth. |
| **`Crystal Clear Tropical`**| $90^\circ$ / $50^\circ$ | Bright Sunlight | `2.4` / `220.0` | `0.40` | Pale Turquoise / Azure Blue | `1.50` / `3.0` | `0.50` / `0.25` | **Lagoon / Coral Reef:** High transparency, low contrast between crests and troughs, vibrant azure water, delicate light whitecap foam. |

---

## 7. Wave Scale and Mesh Resolution

Wave size is **not** derived from the water volume unless you ask for it.

`WaveScaleMode: "Absolute"` (the default) fixes the base wavelength at 300 scene units. Ten non-harmonic octaves descend from 300 to about 4.6 units at `WaveTiling` 1. Scaling the cube does not scale the waves. That is the right behaviour for an ocean — the surface does not slide when the object moves and neighbouring bodies line up — and the wrong behaviour for a swimming pool, where `"RelativeToVolume"` sizes the base wave to the volume's shorter side instead.

### Octaves below the mesh resolution are faded out

The surface is a `GridSubdivisions x GridSubdivisions` plane, so vertex spacing is `width / GridSubdivisions`. A Gerstner wave sampled at fewer than about four vertices per wavelength does not render as a wave — it renders as a crosshatch of sampling noise. Any octave shorter than `4 x vertex spacing` is therefore faded to zero, in the vertex shader **and** in the CPU solver, so buoyancy keeps agreeing with the surface on screen.

The practical consequence is that a large volume on a coarse mesh is calmer and smoother, not noisier. Retained octaves at `WaveTiling` 1:

| Setup | Vertex spacing | Octaves drawn |
| :--- | ---: | ---: |
| Absolute, 1000-unit volume, 48 subdivisions | 20.8 | resolution-filtered; query `WaveDetailPercent()` |
| Absolute, 1000-unit volume, 128 subdivisions | 7.8 | more short-wave detail retained |
| Absolute, 300-unit volume, 48 subdivisions | 6.3 | most authored amplitude retained |
| RelativeToVolume, 1000-unit volume, 48 subdivisions | 20.8 | most authored amplitude retained |
| RelativeToVolume, 400x240 pool, 48 subdivisions | 8.3 | most authored amplitude retained |
| RelativeToVolume, 400x240 pool, 96 subdivisions | 4.2 | additional fine chop retained |

`"RelativeToVolume"` holds detail better on large bodies because the fine octaves scale with the volume rather than staying fixed while the mesh stretches. If you want more chop on a big absolute-scale ocean, raise `GridSubdivisions` before raising `WaveTiling` — tiling shortens every wavelength and so pushes *more* octaves below the cutoff, not fewer.

Both wavelengths are recomputed when the volume is resized at runtime.

### When nothing is renderable

If **every** octave falls below the cutoff the water renders perfectly flat — visually identical to a broken shader. The runtime detects this and logs a one-time console warning naming the volume size, the vertex spacing, the longest octave, and the two concrete fixes with computed values. It re-warns only if the configuration actually changes, not once per frame.

`Object.WaterBody3D::WaveDetailPercent()` returns the same diagnostic to events: the percentage of the authored wave amplitude the mesh can draw. 100 means fully resolved, 0 means flat.

A worked example — a 6987 x 7501 ocean at the default settings:

| `WaveScaleMode` | `GridSubdivisions` | Longest octave | Amplitude drawn |
| :--- | ---: | ---: | ---: |
| `Absolute` | 48 | 300 | **0%** (flat) |
| `Absolute` | 101 | 300 | 40% |
| `Absolute` | 256 | 300 | 65% |
| `RelativeToVolume` | 48 | 6987 | **93%** |

For a body this large, `"RelativeToVolume"` is the answer. Also scale `WaveHeight` to the volume: at 100 units ≈ 1 m this is a 70 m ocean, and the default `WaveHeight` of 18 units is an 18 cm ripple. Real ocean swell wants roughly 150 - 300.

---

## 8. Units & Semantics

* **Scene units.** Every X/Y/Z argument and return value is in **GDevelop scene units** (pixels), matching `Object.X()` / `Object.Z()`. The SPH solver runs internally in metres at 100 units = 1 m, the same world scale Physics3D uses by default.
* **Container volume** is in **litres**. One droplet contributes $\tfrac{4}{3}\pi r^3 \times 1000$ L, so a default 0.02 m droplet is ≈ 0.034 L and a 1.0 L cauldron fills in about 30 droplets.
* **`BuoyancyFactor` is relative to the object's own weight.** With a `Physics3D` behavior attached, `1.0` at full submersion applies exactly enough upward impulse to cancel gravity (neutral buoyancy); above `1.0` the object rises, below `1.0` it sinks. Force is split evenly across the hull probes and applied at each probe's world position, which is what produces pitch and roll.
* **`FluidDrag`** is a quadratic drag coefficient applied against the local wave orbital velocity, also per probe. It only acts on the `Physics3D` path.
* **`Ship Stability`** adds a balanced force pair at the hull probes. It rights roll and pitch without adding net lift or changing yaw; **`Stability Damping`** removes angular oscillation. Both act only while probes touch water.
* **Water contact is finite.** Buoyancy requires horizontal overlap and rejects hulls entirely below the water object's bottom. Outside the volume, no lift or kinematic repositioning is applied, so a Physics3D object falls under normal Jolt gravity.
* **Without `Physics3D`**, `Buoyancy3D` falls back to driving `Z`, `RotationX` and `RotationY` directly. In that mode `BuoyancyFactor` is unused and `WaveInfluence` controls how hard the object is pinned to the surface.
* **Droplet floor.** Poured droplets settle on Z = 0 by default. Use the global action *Set droplet floor altitude* if your table or ground sits elsewhere.

---

## 9. Limitations

These are the gaps between the design document and what the shipped runtime does. They are listed so events are written against real behavior.

* **No screen-space refraction.** GDevelop does not expose the scene colour buffer to a custom material, so the water cannot sample and distort what is behind it. `RefractionScale` distorts the caustic pattern instead, which reads as refraction over a sea bed but not over arbitrary objects.
* **No depth pre-pass, so optical depth is approximated.** With a matching `WaterEdge3D`, the Beer-Lambert column is derived from signed distance to its land bounds; otherwise `WaterBody3D` falls back to its own perimeter. Moving Physics3D hulls can create wakes and splash foam, but they do not cut an exact silhouette out of the water or alter its optical depth.
* **No SSFR (screen-space fluid rendering).** Droplets render as an instanced sphere mesh, coloured per droplet, not as a smoothed metaball surface. The SPH physics — density, pressure, per-droplet viscosity, surface tension, container filling — is real; the surface reconstruction is not implemented.
* **Droplets do not collide with scene geometry.** They collide with each other, the droplet floor plane, and container AABBs. They pass through walls and sloped meshes.
* **Containers are axis-aligned boxes.** A container's fill volume is its object AABB; cylindrical and irregular vessels are approximated by their bounding box.
* **`MaterialSource: "Material3D"` is stored but not acted on.** `WaterBody3D` always renders with its own built-in shader.
* **`WaterType` is stored but does not change any default.** Tune the wave and colour properties directly.
* **One water surface mesh per behavior**, parented to the object's layer. A water body spanning multiple layers is not supported.
* **Water edges are axis-aligned boxes in XY.** Rotation and actual 3D Model contours are not sampled. Use several boxes to approximate a curved or diagonal shoreline.
