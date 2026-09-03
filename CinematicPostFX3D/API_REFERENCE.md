# CinematicPostFX3D — API Reference

Every property, action, condition and expression on the `CinematicPostFX3D` behavior, as shipped in version 2.2.0.

All world-space values are in **GDevelop world units**, not metres. See the [README](./README.md#units-gdevelop-world-units-not-metres) for why that matters.

---

## 1. Behavior Properties

### Master & Presets

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`Preset`** | Choice | `Custom` | Applied **once**, when the behavior is created, overwriting every property below it. `Custom` uses your own values as-is. Options: `Custom`, `CyberpunkNeon`, `CinematicMovie`, `HorrorGrim`, `CleanRealistic`, `PerformanceLite`. |
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
| *(no property)* | — | — | Reflection sharpness follows the surface's own roughness: a resolve pass blurs the reflection buffer wider on rough surfaces and barely at all on mirrors. Override per mesh with `userData.ssrRoughness`. |
| **`SSRSurfaces`** | Choice | `MaterialBased` | Which surfaces reflect. `MaterialBased` renders a reflectivity mask from each material's `roughness` and `metalness`, so only smooth or metallic surfaces reflect — GDevelop's default material is fully rough, so **nothing reflects until you make it shiny**. `Everything` mirrors the scene onto every surface. |
| **`SSRRaySteps`** | Choice | `32` | `16` (fast), `32` (balanced), `64` (high). All three are honoured; the shader marches up to 64 steps. |

### Bloom & Anamorphic Flares — works without depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableBloom`** | Boolean | `false` | 13-tap Karis HDR bloom, 5-mip pyramid with additive recombination. |
| **`BloomIntensity`** | Number | `0.8` | Glow brightness multiplier, 0.0–3.0. |
| **`BloomThreshold`** | Number | `0.9` | Minimum luminance required to emit bloom, 0.5–2.0. Applied at the first mip only. |
| **`AnamorphicFlares`** | Number | `0.3` | Horizontal cinema streak strength, 0.0–1.0. Above zero this adds a dedicated wide horizontal blur pass; at exactly zero the pass is skipped entirely. |
| **`FlareTintColor`** | Color | `100;180;255` | Colour tint for the anamorphic streaks. |

### Depth of Field — needs depth

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableDOF`** | Boolean | `false` | Circle of Confusion bokeh defocus, 16-tap golden-angle spiral. |
| **`Autofocus`** | Boolean | `true` | Raycasts the centre of the screen against the layer's 3D group, bounded by the camera's near and far planes, and eases the focus plane onto the hit. Falls back to `ManualFocusDistance` when nothing is in front of the camera. Runs every third frame. Set `mesh.userData.cinematicIgnoreAutofocus = true` to exclude a mesh — useful for a first-person weapon that would otherwise own the focus plane permanently. |
| **`ManualFocusDistance`** | Number | `700` | Focus plane in world units, used when autofocus is off or has no target. A default 3D layer puts the camera about 724 units out. |
| **`ApertureFStop`** | Number | `2.8` | `f/1.4` for heavy bokeh, `f/16` for deep focus. Defocus is measured relative to the focus distance, so the same value looks the same at any scene scale. |
| **`MaxBokehRadius`** | Number | `12.0` | Maximum blur radius in pixels. |

### Motion Blur & Optical FX

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`EnableMotionBlur`** | Boolean | `false` | Camera-velocity blur reconstructed from depth and the previous view-projection matrix. **Needs depth.** |
| **`MotionBlurStrength`** | Number | `0.5` | Streak length scale, 0.0–1.0. |
| **`ChromaticAberration`** | Number | `0.003` | Radial colour fringing, 0.0–0.02. Works without depth. |

---

## 2. Actions

### Master & Presets
| Action | Parameter |
| :--- | :--- |
| Apply cinematic preset _on object_ | Preset name (choice) |
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

---

## 4. Expressions

All return numbers.

### Depth of Field
| Expression | Returns |
| :--- | :--- |
| `CurrentFocusDistance()` | Live focus plane distance in world units — the eased autofocus value when autofocus is on, otherwise the manual distance. |
| `ManualFocusDistance()` | The configured manual focus distance. |
| `ApertureFStop()` | Current lens aperture. |
| `MaxBokehRadius()` | Current maximum blur radius in pixels. |

### Master
| Expression | Returns |
| :--- | :--- |
| `MasterIntensity()` | Current master grade crossfade. |

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
| `AnamorphicFlares()` | Current streak strength. |

### Optical
| Expression | Returns |
| :--- | :--- |
| `MotionBlurStrength()` | Current streak scale. |
| `ChromaticAberration()` | Current fringing offset. |

---

## 5. Preset values

| Setting | CyberpunkNeon | CinematicMovie | HorrorGrim | CleanRealistic | PerformanceLite |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Tone mapping | ACES | ACES | ACES | ACES | Reinhard |
| Effect quality | Half | Half | Half | Half | **Quarter** |
| GTAO | on | on | on | on | **off** |
| GTAO radius | 60 | 70 | 90 | 55 | 40 |
| GTAO intensity | 1.0 | 1.2 | 1.8 | 1.0 | 0.6 |
| GTAO multi-bounce | on | on | off | on | off |
| SSR | on | on | **off** | on | **off** |
| SSR intensity | 0.9 | 0.4 | 0.0 | 0.6 | 0.0 |
| SSR max distance | 500 | 400 | 300 | 400 | 250 |
| SSR Fresnel | 0.5 | 0.7 | 0.8 | 0.6 | 0.6 |
| SSR surfaces | MaterialBased | MaterialBased | MaterialBased | MaterialBased | MaterialBased |
| SSR ray steps | 32 | 32 | 16 | 32 | 16 |
| Bloom | on | on | on | on | on |
| Bloom intensity | 1.5 | 0.8 | 0.3 | 0.6 | 0.5 |
| Bloom threshold | 0.8 | 0.9 | 1.2 | 0.9 | 1.0 |
| Anamorphic flares | 0.6 | 0.2 | 0.0 | 0.0 | 0.0 |
| Flare tint | `80;160;255` | `100;180;255` | white | white | white |
| DOF | on | on | on | **off** | **off** |
| Autofocus | on | on | **off** | off | off |
| Focus distance | 700 | 700 | 320 | 700 | 700 |
| Aperture | f/5.6 | f/2.4 | f/1.8 | f/2.8 | f/4.0 |
| Max bokeh radius | 8 | 12 | 14 | 10 | 8 |
| Motion blur | on | on | on | on | **off** |
| Motion blur strength | 0.3 | 0.5 | 0.2 | 0.2 | 0.0 |
| Chromatic aberration | 0.004 | 0.002 | 0.006 | 0.001 | 0.0 |

Best used for: **CyberpunkNeon** — neon cities, night rain, racing. **CinematicMovie** — cutscenes and third-person action. **HorrorGrim** — dark corridors and claustrophobic interiors. **CleanRealistic** — general 3D, outdoors. **PerformanceLite** — mobile and low-end hardware.
