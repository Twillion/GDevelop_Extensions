# CascadedShadowMaps3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), and Preset profiles for **CascadedShadowMaps3D**.

---

## 1. `CascadedShadowMaps3D` Behavior Properties

### Group 1: Cascade Configuration
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`CascadeCount`** | Choice | `3` | Number of active shadow cascades: `3` (Standard) or `4` (Extreme Distance). |
| **`MaxShadowDistance`** | Number | `250.0` | Maximum distance in meters from the camera where shadows are cast. |
| **`SplitLambda`** | Number | `0.75` | Practical split blend factor: $0.0 = \text{Uniform}$, $1.0 = \text{Logarithmic}$ ($0.5 - 0.85$ recommended). |
| **`ShadowAtlasResolution`**| Choice | `4096` | Resolution of packed depth texture atlas: `2048` or `4096`. |
| **`CasterExtrusionDistance`**| Number | `50.0` | Backward extrusion distance in meters to capture casters behind sub-frustums. |

### Group 2: Filtering & Stabilization
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`StabilizeTexels`** | Boolean | `true` | Snaps light orthographic projections to world texel grid increments (Zero shimmering). |
| **`FilterRadius`** | Number | `1.5` | 16-Tap Poisson Disk PCF softness radius ($0.5 - 4.0$). |
| **`SeamBlendWidth`** | Number | `0.10` | Transition crossfade width between cascade boundaries ($0.0 - 0.25$). |

### Group 3: Screen-Space Contact Shadows (SSCS)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableSSCS`** | Boolean | `true` | Traces screen-space depth rays for razor-sharp micro contact shadows under feet/props. |
| **`ContactRayLength`** | Number | `0.15` | Maximum raymarch distance in meters ($0.05 - 0.5$). |
| **`ContactRaySteps`** | Number | `8` | Number of depth buffer raymarch sample steps ($4 - 16$). |
| **`ContactShadowIntensity`**| Number | `0.85` | Darkness scale of contact occlusion ($0.0 - 1.0$). |

### Group 4: Depth Bias & Slope Scaling
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ConstantBias`** | Number | `0.0005` | Constant depth bias offset to prevent shadow acne. |
| **`SlopeScaleBias`** | Number | `0.002` | Dynamic bias scaling based on surface angle relative to sun vector. |

---

## 2. Actions

### Distance & Split Controls
* **`Set max shadow distance on _PARAM0_ to _PARAM1_`**: Updates maximum shadow horizon in meters (e.g. `250.0`).
* **`Set cascade split lambda on _PARAM0_ to _PARAM1_`**: Balances logarithmic vs. uniform depth splits ($0.0 - 1.0$).
* **`Set PCF filter radius on _PARAM0_ to _PARAM1_`**: Adjusts shadow softness blur radius.
* **`Set seam blend transition width on _PARAM0_ to _PARAM1_`**: Adjusts crossfade width across cascade seams.

### Sun Direction & Orientation
* **`Set sun direction angles on _PARAM0_ (Pitch: _PARAM1_, Yaw: _PARAM2_)`**: Updates sun rotation for time-of-day cycles.
* **`Set sun light vector on _PARAM0_ (X: _PARAM1_, Y: _PARAM2_, Z: _PARAM3_)`**: Directly sets normalized light vector.

### Screen-Space Contact Shadows (SSCS)
* **`Enable screen-space contact shadows on _PARAM0_ to _PARAM1_`**: Toggles micro-shadow raymarching pass.
* **`Set contact shadow ray length on _PARAM0_ to _PARAM1_ meters`**: Adjusts reach of contact micro-shadows.
* **`Set contact shadow intensity on _PARAM0_ to _PARAM1_`**: Adjusts darkness multiplier ($0.0 - 1.0$).

### Bias Controls
* **`Set shadow bias on _PARAM0_ (Constant: _PARAM1_, SlopeScale: _PARAM2_)`**: Fine-tunes depth acne offsets.

---

## 3. Conditions

* **`Is cascaded shadow mapping active on _PARAM0_`**: True if CSM renderer is currently active.
* **`Is screen-space contact shadows enabled on _PARAM0_`**: True if SSCS micro-shadow pass is running.
* **`Is camera within shadow distance on _PARAM0_`**: True if camera distance to sun origin is $< \text{MaxShadowDistance}$.

---

## 4. Expressions

### Splits & Metrics
* **`Object.CascadedShadowMaps3D::MaxDistance()`**: Returns maximum shadow distance in meters.
* **`Object.CascadedShadowMaps3D::CascadeSplit(index)`**: Returns split depth in meters for cascade index ($0 - 3$).
* **`Object.CascadedShadowMaps3D::TexelResolution(cascadeIndex)`**: Returns world-space texel resolution (cm/texel).
* **`Object.CascadedShadowMaps3D::ActiveCascadeCount()`**: Returns number of configured cascades (e.g. `3`).
* **`Object.CascadedShadowMaps3D::SplitLambda()`**: Returns current split lambda factor.

---

## 5. Preset Profiles Table

| Preset Name | Cascades | Max Distance | Split Lambda ($\lambda$) | Filter Radius | SSCS Enabled | Best For |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`FirstPersonSharp`** | `3` | `100m` | `0.80` (Near-heavy) | `1.2` (Crisp) | `true` | FPS games, character facial closeups, indoor/outdoor transitions. |
| **`ThirdPersonBalanced`**| `3` | `250m` | `0.75` (Balanced) | `1.5` (Smooth) | `true` | Action RPGs, third-person adventures, vehicle games. |
| **`OpenWorldHorizon`** | `4` | `500m` | `0.85` (Distant) | `2.0` (Soft) | `true` | Massive open terrains, flight simulators, mountain horizons. |
| **`MobileOptimized`** | `2` | `120m` | `0.70` | `1.0` (Fast) | `false` | Mobile devices, low-power WebGL2 laptops, high-FPS arcade titles. |
