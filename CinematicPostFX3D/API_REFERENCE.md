# CinematicPostFX3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), and Preset profiles for **CinematicPostFX3D**.

---

## 1. `CinematicPostFX3D` Behavior Properties

### Group 1: Master & Presets
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Preset`** | Choice | `"CleanRealistic"` | 1-Click Profile: `"CyberpunkNeon"`, `"CinematicMovie"`, `"HorrorGrim"`, `"CleanRealistic"`, `"PerformanceLite"`. |
| **`MasterIntensity`**| Number | `1.0` | Global multiplier for all active post-processing effects ($0.0 = \text{Disabled}$). |
| **`ToneMapping`** | Choice | `"ACESFilmic"` | Color grading curve: `"ACESFilmic"`, `"Reinhard"`, `"Cineon"`, `"Linear"`. |

### Group 2: Ground Truth Ambient Occlusion (GTAO)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableGTAO`** | Boolean | `true` | Enables high-precision horizon-based ambient occlusion in crevices and corners. |
| **`GTAORadius`** | Number | `1.2` | Occlusion sampling radius in meters ($0.2 - 5.0$). |
| **`GTAOIntensity`** | Number | `1.0` | Occlusion darkness multiplier ($0.0 - 3.0$). |
| **`GTAOMultiBounce`**| Boolean | `true` | Approximates colored multi-bounce to prevent dark areas from losing albedo. |

### Group 3: Screen-Space Reflections (SSR)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableSSR`** | Boolean | `true` | Enables real-time raymarched reflections of dynamic objects on wet/shiny surfaces. |
| **`SSRIntensity`** | Number | `0.75` | Reflection brightness and blend opacity ($0.0 - 1.0$). |
| **`SSRMaxRoughness`**| Number | `0.65` | Maximum surface roughness that receives reflections ($0.0 - 1.0$). |
| **`SSRRaySteps`** | Choice | `32` | Quality step count: `16` (Fast), `32` (Balanced), `64` (High). |

### Group 4: Physically Based Bloom & Flares
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableBloom`** | Boolean | `true` | Enables 13-tap progressive downsample/upsample Karis HDR bloom. |
| **`BloomIntensity`** | Number | `0.8` | Glow brightness multiplier ($0.0 - 3.0$). |
| **`BloomThreshold`** | Number | `0.9` | Minimum luminance required to emit bloom ($0.5 - 2.0$). |
| **`AnamorphicFlares`**| Number | `0.3` | Horizontal cinema streak flare strength ($0.0 - 1.0$). |
| **`FlareTintColor`** | Color | `"100; 180; 255"`| Color tint for anamorphic lens streaks (e.g. sci-fi blue). |

### Group 5: Optical Bokeh Depth of Field (DOF)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableDOF`** | Boolean | `false` | Enables Circle of Confusion optical lens defocusing. |
| **`Autofocus`** | Boolean | `true` | Automatically raycasts center screen crosshair to track focus plane distance. |
| **`ManualFocusDistance`**| Number | `4.0` | Focus plane in meters when `Autofocus` is disabled. |
| **`ApertureFStop`** | Number | `2.8` | Lens aperture diameter ($f/1.4$ for heavy blur, $f/16.0$ for deep focus). |
| **`MaxBokehRadius`** | Number | `12.0` | Maximum pixel blur radius for out-of-focus highlights. |

### Group 6: Motion Blur & Optical Distortion
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableMotionBlur`**| Boolean | `false` | Enables velocity vector motion blur for camera and dynamic objects. |
| **`MotionBlurStrength`**| Number | `0.5` | Shutter angle scale for motion streak length ($0.0 - 1.0$). |
| **`ChromaticAberration`**| Number | `0.003`| Optical lens color fringing at screen edges ($0.0 - 0.02$). |

---

## 2. Actions

### Master & Presets
* **`Apply cinematic preset _PARAM1_ on _PARAM0_`**: Apply profile (`"CyberpunkNeon"`, `"CinematicMovie"`, `"HorrorGrim"`, `"CleanRealistic"`, `"PerformanceLite"`).
* **`Set master post-processing intensity on _PARAM0_ to _PARAM1_`**: Global effect scale ($0.0 - 2.0$).
* **`Set tone mapping mode on _PARAM0_ to _PARAM1_`**: Switch color grading curve (`"ACESFilmic"`, `"Reinhard"`, `"Cineon"`, `"Linear"`).

### Ambient Occlusion (GTAO)
* **`Enable Ground Truth Ambient Occlusion (GTAO) on _PARAM0_ to _PARAM1_`**: Toggle GTAO pass.
* **`Set GTAO radius on _PARAM0_ to _PARAM1_ meters`**: Adjust search distance in world units.
* **`Set GTAO intensity on _PARAM0_ to _PARAM1_`**: Adjust shadow contrast.

### Screen-Space Reflections (SSR)
* **`Enable Screen-Space Reflections (SSR) on _PARAM0_ to _PARAM1_`**: Toggle SSR pass.
* **`Set SSR reflection intensity on _PARAM0_ to _PARAM1_`**: Adjust reflection brightness ($0.0 - 1.0$).
* **`Set SSR max roughness threshold on _PARAM0_ to _PARAM1_`**: Set roughness cutoff.

### Bloom & Anamorphic Flares
* **`Enable Bloom on _PARAM0_ to _PARAM1_`**: Toggle Karis bloom pass.
* **`Set Bloom intensity on _PARAM0_ to _PARAM1_`**: Adjust glow power.
* **`Set Bloom luminance threshold on _PARAM0_ to _PARAM1_`**: Adjust cutoff for glowing surfaces.
* **`Set Anamorphic flare streak strength on _PARAM0_ to _PARAM1_`**: Adjust cinema lens horizontal streaks.

### Depth of Field (DOF)
* **`Enable Depth of Field on _PARAM0_ to _PARAM1_`**: Toggle optical bokeh pass.
* **`Set DOF autofocus mode on _PARAM0_ to _PARAM1_`**: Enable/disable automatic crosshair raycast focus.
* **`Set DOF manual focus distance on _PARAM0_ to _PARAM1_ meters`**: Directly position focus plane.
* **`Set DOF camera aperture f-stop on _PARAM0_ to _PARAM1_`**: Adjust lens aperture ($f/1.4 - f/16.0$).

### Motion Blur & Optical FX
* **`Set Motion Blur strength on _PARAM0_ to _PARAM1_`**: Adjust velocity blur length.
* **`Set Chromatic Aberration strength on _PARAM0_ to _PARAM1_`**: Adjust lens color fringing.

---

## 3. Conditions

* **`Is post-processing pass active on _PARAM0_`**: True if master pipeline is enabled.
* **`Is Screen-Space Reflections (SSR) enabled on _PARAM0_`**: True if SSR pass is active.
* **`Is Ground Truth Ambient Occlusion (GTAO) enabled on _PARAM0_`**: True if GTAO pass is active.
* **`Is Depth of Field (DOF) active on _PARAM0_`**: True if optical bokeh blur is enabled.
* **`Is Autofocus currently tracking a target on _PARAM0_`**: True if raycaster has locked onto a 3D surface.

---

## 4. Expressions

### Focus & Distances
* **`Object.CinematicPostFX3D::CurrentFocusDistance()`**: Live autofocus distance in meters.
* **`Object.CinematicPostFX3D::ApertureFStop()`**: Current lens aperture value.

### Intensities & Scales
* **`Object.CinematicPostFX3D::MasterIntensity()`**: Current master effect scale.
* **`Object.CinematicPostFX3D::BloomIntensity()`**: Current bloom intensity.
* **`Object.CinematicPostFX3D::GTAOIntensity()`**: Current ambient occlusion darkness.
* **`Object.CinematicPostFX3D::SSRIntensity()`**: Current reflection brightness.
* **`Object.CinematicPostFX3D::MotionBlurStrength()`**: Current motion blur scale.

---

## 5. Preset Configurations Reference Table

| Preset Name | SSR | GTAO | Bloom | Anamorphic Flares | Bokeh DOF | Motion Blur | Best Used For |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`CyberpunkNeon`** | `0.9` (Wet) | `1.0` | `1.5` (Heavy) | `0.6` (Blue) | Subtle | `0.3` | Sci-fi cities, neon alleys, night rainstorms, racing. |
| **`CinematicMovie`**| `0.4` | `1.2` | `0.8` (Clean) | `0.2` | Active Autofocus | `0.5` | Narrative cutscenes, dialogue, third-person action. |
| **`HorrorGrim`** | `0.0` | `1.8` (Deep) | `0.3` | `0.0` | Close Macro | `0.2` | Survival horror, dark dungeons, claustrophobic corridors. |
| **`CleanRealistic`**| `0.6` | `1.0` | `0.6` | `0.0` | Off / Manual | `0.2` | General 3D games, outdoor nature, standard realism. |
| **`PerformanceLite`**| `0.0` | `0.6` (Half-res)| `0.5` (Fast) | `0.0` | Off | `0.0` | Mobile devices, low-end laptops, 120 FPS arcade shooters. |
