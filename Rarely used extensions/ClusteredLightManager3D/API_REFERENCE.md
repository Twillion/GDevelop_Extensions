# ClusteredLightManager3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), Presets, and Color Temperature constants for **ClusteredLightManager3D**.

---

## 1. `ClusteredLightManager3D` (Scene Manager Properties)

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`MaxLights`** | Number | `256` | Maximum active dynamic lights streamed to GPU simultaneously ($64 - 512$). |
| **`ClusterGridX`** | Number | `16` | Horizontal screen cluster slices ($S_x$). |
| **`ClusterGridY`** | Number | `9` | Vertical screen cluster slices ($S_y$). |
| **`ClusterGridZ`** | Number | `24` | Logarithmic depth cluster slices ($S_z$). |
| **`EnableVolumetricFog`** | Boolean | `false` | Enables clustered volumetric atmospheric light scattering and god rays. |
| **`VolumetricFogDensity`** | Number | `0.02` | Density of the atmospheric participating medium ($\sigma_s$). |
| **`VolumetricAnisotropy`** | Number | `0.4` | Henyey-Greenstein forward scattering factor ($g \in [0.0, 0.9]$). |
| **`EnableContactShadows`** | Boolean | `true` | Enables screen-space contact micro-shadowing (SSCS) for nearby lights. |
| **`GlobalIntensityScale`** | Number | `1.0` | Master multiplier for all dynamic clustered lights in the scene. |

---

## 2. `ClusteredLight3D` (Object Behavior Properties)

### Group 1: Light Shape & Dimensions
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LightType`** | Choice | `"Point"` | Light emission geometry: `"Point"`, `"Spot"`, or `"AreaCapsule"`. |
| **`Intensity`** | Number | `1.0` | Base radiant intensity multiplier. |
| **`Radius`** | Number | `12.0` | Maximum attenuation distance in meters (smoothly reaches 0 at boundary). |
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
* **`Set volumetric atmospheric fog density to _PARAM0_`**: Configure scene-wide clustered fog density.
* **`Set volumetric fog forward scattering anisotropy to _PARAM0_`**: Adjust god ray directional bias ($g \in [0.0, 0.9]$).
* **`Enable clustered contact micro-shadows _PARAM0_`**: Toggle screen-space contact shadowing globally.

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
* **`ClusteredLightManager3D::ActiveLightCount()`**: Total number of lights rendered in the current frame.
* **`ClusteredLightManager3D::MaxLightsInSingleCluster()`**: Peak light count in the densest cluster (for performance monitoring).
* **`ClusteredLightManager3D::CPUBroadphaseTimeMs()`**: Execution time in milliseconds for CPU light binning.

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
