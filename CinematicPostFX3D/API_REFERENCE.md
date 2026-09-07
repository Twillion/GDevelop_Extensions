# CinematicPostFX3D — API Reference

Every property, action, condition and expression on the `CinematicPostFX3D` behavior, as shipped in version 2.6.0.

All world-space values are in **GDevelop world units**, not metres. See the [README](./README.md#units-gdevelop-world-units-not-metres) for why that matters.

---

## 1. Behavior Properties

### Master & Presets

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`Preset`** | Choice | `Custom` | Applied **once**, when the behavior is created, overwriting every property below it. `Custom` uses your own values as-is. Options: `Custom`, `DefaultGameplay`, `CinematicCutscene`, `VibrantFantasy`, `NightNeon`, `HorrorTension`, `PerformanceLite`, `PlayerCustom`. |
| **`MasterIntensity`** | Number | `1.0` | Crossfades between the untouched scene and the fully graded result. `0.0` is a true bypass. |
| **`ToneMapping`** | Choice | `ACESFilmic` | `ACESFilmic`, `Reinhard`, `Cineon`, `Linear`. |
| **`EffectQuality`** | Choice | `Half` | Resolution of the ambient occlusion, reflection and reflectivity-mask buffers. `Full` sharpens them at roughly four times the cost; `Quarter` is for low-end hardware. Bloom, depth of field and the composite are always full resolution. |
| **`TargetLayer`** | String | `""` | Name of the 3D layer to post-process; empty means the base layer. The layer must be rendering in 3D or there is no effect composer to attach to. |
| **`Diagnostics`** | Boolean | `false` | Logs one console line at startup: composer found, depth texture attached, camera near/far and distance, buffer size. Start here when an effect appears to do nothing. |

### Ground Truth Ambient Occlusion — needs depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableGTAO`** | Boolean | `false` | Horizon-based ambient occlusion in crevices and contact points. |
| **`GTAORadius`** | Number | `50` | Occlusion search radius in world units. Useful range roughly 20–150. |
| **`GTAOIntensity`** | Number | `1.0` | Applied as an exponent on visibility, so `1.0` is neutral and higher is darker. |
| **`GTAOMultiBounce`** | Boolean | `true` | Polynomial multi-bounce fit so coloured crevices keep bounce light instead of going black. |

### Screen-Space Reflections — needs depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableSSR`** | Boolean | `false` | Raymarched reflections of on-screen geometry. |
| **`SSRIntensity`** | Number | `0.6` | Reflection brightness and blend opacity, 0.0–1.0. |
| **`SSRMaxDistance`** | Number | `400` | How far a reflection ray may travel, in world units. |
| **`SSRFresnel`** | Number | `0.6` | How strongly reflections favour grazing angles. `0` = equal at all angles, `1` = pure Schlick Fresnel. |
| **`SSRSurfaces`** | Choice | `MaterialBased` | Which surfaces reflect. `MaterialBased` renders a reflectivity mask from each material's `roughness` and `metalness`, so only smooth or metallic surfaces reflect — GDevelop's default material is fully rough, so **nothing reflects until you make it shiny**. `Everything` mirrors the scene onto every surface. |
| **`SSRRaySteps`** | Choice | `32` | `16` (fast), `32` (balanced), `64` (high). All three are honoured; the shader marches up to 64 steps. |
| **`EffectQuality`** | Choice | `Half` | Resolution of the reflection buffer. `Full`, `Half` or `Quarter`. |

### 13-Tap Karis HDR Bloom & Anamorphic Flares

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableBloom`** | Boolean | `false` | Half-resolution 5-stage downsample / 4-stage upsample pyramid with Karis anti-firefly luma weighting. |
| **`BloomIntensity`** | Number | `0.8` | Overall glow brightness. |
| **`BloomThreshold`** | Number | `0.3` | Minimum brightness in **linear light** before a pixel glows. Surface values in the buffer are linear HDR; GDevelop converts to sRGB at the very end, so a grey that looks 0.7 on screen is only ~0.45 here. Keep below 0.8. |
| **`BloomRadius`** | Number | `1.0` | Filter width across the pyramid mips. Larger values produce a wider, smoother, more stable glow. |
| **`BloomMaxBrightness`** | Number | `12.0` | Firefly suppression ceiling on the first downsample pass. Caps the brightest texel before it can bleed into mips. |
| **`AnamorphicFlares`** | Number | `0.3` | Intensity of wide horizontal lens streak derived from bloom mips. |
| **`FlareTintColor`** | Color | `100;180;255` | Color of anamorphic flare streaks (RGB semicolon-separated). |

### Bokeh Depth of Field — needs depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableDOF`** | Boolean | `false` | 16-tap golden-angle spiral bokeh blur. |
| **`Autofocus`** | Boolean | `true` | Center-screen raycaster that continuously pulls focus to whatever the camera looks at. |
| **`ManualFocusDistance`** | Number | `700` | Fallback distance in world units used when autofocus is off or looking into empty space. |
| **`ApertureFStop`** | Number | `2.8` | Lens aperture. Lower numbers (f/1.4, f/2.0) give shallower depth of field; higher numbers give deeper focus. |
| **`MaxBokehRadius`** | Number | `12` | Maximum blur radius in screen pixels. |

### Motion Blur & Optical FX — motion blur needs depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableMotionBlur`** | Boolean | `false` | Camera-velocity streak reconstructed from depth and previous frame matrices. |
| **`MotionBlurStrength`** | Number | `0.5` | Streak intensity scale. |
| **`ChromaticAberration`** | Number | `0.003` | Radial color fringing split towards screen edges. |

---

## 2. Actions

### Master, Presets & Custom Graphics Setup
| Action | Parameter |
| :--- | :--- |
| Apply cinematic preset _on object_ | Preset name (choice: `DefaultGameplay`, `CinematicCutscene`, `VibrantFantasy`, `NightNeon`, `HorrorTension`, `PerformanceLite`, `PlayerCustom`) |
| Save post-processing settings to global variable | Global variable (`globalvar`) |
| Apply post-processing settings from global variable | Global variable (`globalvar`) |
| Save post-processing settings to scene variable | Scene variable (`scenevar`) |
| Apply post-processing settings from scene variable | Scene variable (`scenevar`) |
| Save current settings as custom preset slot | Slot name (string, e.g. `"PlayerCustom"`) |
| Apply custom preset slot | Slot name (string, e.g. `"PlayerCustom"`) |
| Apply post-processing settings from JSON | JSON string |
| Set master post-processing intensity | Number |
| Set effect buffer quality | Full / Half / Quarter (choice) |
| Set tone mapping mode | Mode (choice) |

### Ambient Occlusion (GTAO)
| Action | Parameter |
| :--- | :--- |
| Enable Ground Truth Ambient Occlusion (GTAO) | Yes/No |
| Set GTAO radius … world units | Number |
| Set GTAO intensity | Number |
| Enable GTAO multi-bounce approximation | Yes/No |

### Screen-Space Reflections (SSR)
| Action | Parameter |
| :--- | :--- |
| Enable Screen-Space Reflections (SSR) | Yes/No |
| Set SSR reflection intensity | Number |
| Set SSR maximum ray distance … world units | Number |
| Set SSR Fresnel falloff | Number |
| Set which surfaces reflect | MaterialBased / Everything (choice) |
| Set SSR ray step count | 16 / 32 / 64 (choice) |

### Bloom & Anamorphic Flares
| Action | Parameter |
| :--- | :--- |
| Enable Bloom | Yes/No |
| Set Bloom intensity | Number |
| Set Bloom luminance threshold | Number |
| Set Bloom radius | Number |
| Set Bloom firefly clamp | Number |
| Set Anamorphic flare streak strength | Number |
| Set Flare tint color | Color |

### Depth of Field (DOF)
| Action | Parameter |
| :--- | :--- |
| Enable Depth of Field | Yes/No |
| Set DOF autofocus mode | Yes/No |
| Set DOF manual focus distance … world units | Number |
| Set DOF camera aperture f-stop | Number |
| Set DOF maximum bokeh blur radius | Number |

### Motion Blur & Optical FX
| Action | Parameter |
| :--- | :--- |
| Enable Motion Blur | Yes/No |
| Set Motion Blur strength | Number |
| Set Chromatic Aberration strength | Number |

Every `Set…` action writes through to the behavior's own property as well as the live pipeline, so the change survives the per-frame property sync.

---

## 3. Conditions

| Condition | True when |
| :--- | :--- |
| **Post-processing pass is active** | The pipeline exists and its pass is attached to a layer composer. |
| **Depth buffer is available** | A depth texture was successfully attached to the layer composer. GTAO, SSR, DOF and Motion Blur all need this; without it they are skipped. |
| **Screen-Space Reflections (SSR) is enabled** | SSR is on and its intensity is above zero. |
| **Ground Truth Ambient Occlusion (GTAO) is enabled** | GTAO is on and its intensity is above zero. |
| **Bloom is enabled** | Bloom is on and its intensity is above zero. |
| **Depth of Field (DOF) is active** | DOF is on. |
| **Autofocus is currently tracking a target** | The centre-screen raycast is currently hitting something. Reports a real lock. |
| **Motion Blur is enabled** | Motion blur is on and its strength is above zero. |
| **Custom preset slot exists** | A custom preset slot has been saved in memory during this session. |

---

## 4. Expressions

### Master & Presets
| Expression | Returns |
| :--- | :--- |
| `ExportSettingsToJSON()` | String — All active post-processing settings serialized as JSON. |
| `MasterIntensity()` | Number — Current master grade crossfade. |

### Depth of Field
| Expression | Returns |
| :--- | :--- |
| `CurrentFocusDistance()` | Live focus plane distance in world units — the eased autofocus value when autofocus is on, otherwise the manual distance. |
| `ManualFocusDistance()` | The configured manual focus distance. |
| `ApertureFStop()` | Current lens aperture. |
| `MaxBokehRadius()` | Current maximum blur radius in pixels. |

### Ambient Occlusion
| Expression | Returns |
| :--- | :--- |
| `GTAOIntensity()` | Current occlusion exponent. |
| `GTAORadius()` | Current search radius in world units. |

### Reflections
| Expression | Returns |
| :--- | :--- |
| `SSRIntensity()` | Current reflection opacity. |
| `SSRMaxDistance()` | Current maximum ray distance in world units. |
| `SSRFresnel()` | Current grazing-angle falloff amount. |

### Bloom
| Expression | Returns |
| :--- | :--- |
| `BloomIntensity()` | Current glow multiplier. |
| `BloomThreshold()` | Current luminance cutoff. |
| `BloomRadius()` | Current pyramid blur width. |
| `AnamorphicFlares()` | Current streak strength. |

### Optical
| Expression | Returns |
| :--- | :--- |
| `MotionBlurStrength()` | Current streak scale. |
| `ChromaticAberration()` | Current fringing offset. |

---

## 5. Preset values

| Setting | DefaultGameplay | CinematicCutscene | VibrantFantasy | NightNeon | HorrorTension | PerformanceLite |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tone mapping | ACES | ACES | ACES | ACES | ACES | Reinhard |
| Effect quality | Half | Half | Half | Half | Half | **Quarter** |
| GTAO | on | on | on | on | on | **off** |
| GTAO radius | 55 | 70 | 55 | 60 | 85 | 40 |
| GTAO intensity | 1.0 | 1.2 | 1.1 | 1.0 | 1.6 | 0.6 |
| GTAO multi-bounce | on | on | on | on | **off** | off |
| SSR | on | on | on | on | **off** | **off** |
| SSR intensity | 0.5 | 0.4 | 0.6 | 0.85 | 0.0 | 0.0 |
| SSR max distance | 400 | 400 | 400 | 500 | 300 | 250 |
| SSR Fresnel | 0.6 | 0.7 | 0.6 | 0.5 | 0.8 | 0.6 |
| SSR surfaces | MaterialBased | MaterialBased | MaterialBased | MaterialBased | MaterialBased | MaterialBased |
| SSR ray steps | 32 | 32 | 32 | 32 | 16 | 16 |
| Bloom | on | on | on | on | on | on |
| Bloom intensity | 0.5 | 0.8 | 0.85 | 1.2 | 0.3 | 0.5 |
| Bloom threshold | 0.4 | 0.38 | 0.35 | 0.28 | 0.55 | 0.5 |
| Anamorphic flares | 0.0 | 0.25 | 0.0 | 0.35 | 0.0 | 0.0 |
| Flare tint | white | `100;180;255` | `255;235;200` | `100;170;255` | white | white |
| DOF | **off** | on | **off** | on | on | **off** |
| Autofocus | off | on | off | on | on | off |
| Focus distance | 700 | 700 | 700 | 700 | 320 | 700 |
| Aperture | f/2.8 | f/2.8 | f/2.8 | f/5.6 | f/3.2 | f/4.0 |
| Max bokeh radius | 10 | 10 | 10 | 8 | 8 | 8 |
| Motion blur | on | on | on | on | on | **off** |
| Motion blur strength | 0.15 | 0.4 | 0.15 | 0.3 | 0.2 | 0.0 |
| Chromatic aberration | 0.001 | 0.002 | 0.0 | 0.003 | 0.004 | 0.0 |

Best used for:
* **DefaultGameplay** — Clean, grounded, crisp visual clarity with contact shadows and no gameplay-disrupting blur.
* **CinematicCutscene** — Dialogue sequences and story cutscenes with autofocus bokeh DOF and 180° film motion blur.
* **VibrantFantasy** — Stylized platformers, sunny adventure games, and warm golden-hour RPGs.
* **NightNeon** — Futuristic sci-fi, wet rainy asphalt, glowing neon signs, and racing.
* **HorrorTension** — Survival horror and grimdark dungeons; pitch-black crevices with multi-bounce off and matte surfaces.
* **PerformanceLite** — Low-spec laptops, mobile devices, and high-framerate competitive play with quarter-resolution buffers.
* **PlayerCustom** — Restores the player's saved personalized graphic configuration.
