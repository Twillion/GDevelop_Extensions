# 3DCRT+ — API Reference

A configurable retro-screen post-processing toolkit for GDevelop's built-in 3D engine. This document lists the runtime **actions**, **conditions**, and **expressions** the extension exposes. Version **1.0.0**, tested against **GDevelop 5.6.280**.

3DCRT+ applies post-processing across an entire 3D scene — true 3D post-processing, not a 2D CRT overlay. Since 1.0.0 it runs as a single fullscreen pass inside the target layer's own effect chain, alongside GDevelop's built-in 3D layer effects.

There are two ways to control 3DCRT+:

1. **Behavior properties** — add the **3DCRT+** behavior to an object on your 3D layer and set values in the properties panel. Good for static, set-once configuration.
2. **Events (this doc)** — actions, conditions, and expressions for driving any parameter at runtime.

All effect parameters are global to the 3D rendering, not per-object. The behavior on the object exists to host the settings and attach the pass; you don't need one behavior per effect. You can also skip the behavior entirely and drive everything from events.

---

## Lifecycle actions

| Action label | Parameters | Description |
|---|---|---|
| **Start shader render effect** | `Layer3D` (layer) | Turns the effect on for the game's 3D rendering. Pass a 3D layer name, or leave empty for the base/all 3D layers. |
| **Stop shader render effect** | — | Turns the effect off. |

The behavior also installs and starts the effect automatically once 3D is ready, so in most projects you won't need **Start** explicitly — use it (and **Stop**) when you want to gate the effect on/off from events.

---

## Group toggle

Each effect belongs to a group that can be switched on or off independently. Everything is **off by default**.

| Action label | Parameters | Description |
|---|---|---|
| **Enable or disable a CRT effect** | `Effect` (string), `Enable` (yes/no) | Turns one effect group on or off. |

**Accepted `Effect` values** (the parameter is a dropdown, so the editor offers these; typing one works too):

`Scanlines` · `Bulge` · `Border` · `Mask` · `Aberration` · `Roll` · `Flicker` · `Interlace` · `Color` · `Grain` · `Blur` · `Pixelate`

> Note: `Color` covers gamma and phosphor tint (saturation and contrast moved to GDevelop's built-in effects in 1.0.0). `Grain` covers all four grain parameters. Opacity and image stretch are not gated by any group — they always apply.

---

## Parameter actions (setters)

All take a single number unless noted. Ranges below are the practical/intended ranges; values outside them still apply but may look extreme.

### Scanlines (group: `Scanlines`)
| Action label | Range | Notes |
|---|---|---|
| **Set CRT scanline thickness** | 0–100 | Darkness/width of the scanline gaps. |
| **Set CRT pixel sharpness** | 0–100 | Sharpness of the reconstructed pixels. |
| **Set CRT scanline count** | 0–2000 | Number of scanlines. Set to **0** to switch to fixed pixel-size mode instead. |
| **Set CRT pixel size** | 1–64 | Pixel block size; used when scanline count is 0. |

### Screen shape
| Action label | Group | Range | Notes |
|---|---|---|---|
| **Set CRT screen bulge** | `Bulge` | 0–5 | Barrel curvature, 0 = flat. |
| **Set CRT border size** | `Border` | 0–45 | Master black border inset. |
| **Set CRT border left (extra)** | `Border` | 0–45 | Extra inset added to the left side. |
| **Set CRT border right (extra)** | `Border` | 0–45 | Extra inset on the right. |
| **Set CRT border top (extra)** | `Border` | 0–45 | Extra inset on top. |
| **Set CRT border bottom (extra)** | `Border` | 0–45 | Extra inset on the bottom. |

### Shadow mask (group: `Mask`)
| Action label | Range | Notes |
|---|---|---|
| **Set CRT shadow mask dark level** | 0–100 | How dark the unlit sub-pixels go. |
| **Set CRT shadow mask light level** | 0.1–5 | Brightness boost of the lit sub-pixels. |

### Signal & motion
| Action label | Group | Range | Notes |
|---|---|---|---|
| **Set shader render chromatic aberration** | `Aberration` | 0–10 | Channel-split fringe, scales from screen center. |
| **Set shader render roll speed** | `Roll` | −5 to 5 | Speed of the rolling bar. |
| **Set shader render roll height** | `Roll` | 0–1 | Height of the rolling bar. |
| **Set shader render flicker** | `Flicker` | 0–20 | Per-frame brightness instability. |
| **Set shader render interlacing** | `Interlace` | 0–1 | Alternating-line dimming. |

### Color grading (group: `Color`)
| Action label | Range | Notes |
|---|---|---|
| **Set shader render gamma** | 0.1–5 | 1 = neutral. Below 1 lifts midtones, above 1 darkens them. Hard-clamped to 0.1–5 — by 4–5 the picture is essentially black. |
| **Set shader render phosphor tint** | R, G, B (0–4 each) | Three numbers. `1, 1, 1` = no tint; lower a channel to tint toward the others (e.g. `1, 0.78, 0.55` = warm amber). |

### Grain (group: `Grain`)
| Action label | Range | Notes |
|---|---|---|
| **Set CRT grain amount** | 0–100 | Strength. |
| **Set CRT grain size** | 1–100 | Cell size: fine static → coarse VHS. |
| **Set CRT grain colour** | 0–100 | 0 = mono film grain, 100 = full RGB static. |
| **Set CRT grain speed** | 0–100 | Frozen → fast. |

> **Units.** Camera blur radius and pixelate block size are measured in **real screen pixels**, independent of Pixel size and Scanline count, so changing the emulated grid does not move them. Chromatic aberration is the one effect measured in *emulated* pixels, deliberately: it is a signal artifact, so it should ride the scanline grid.

### Camera softness (groups: `Blur`, `Pixelate`)

A **prepass on the filmed world**, applied before a called 2D/UI layer composites — so the camera can be soft while the UI drawn on the screen stays sharp. Both are off by default and independent of each other.

| Action label | Group | Range | Notes |
|---|---|---|---|
| **Set camera blur** | `Blur` | 0–100 | Defocus. Maps to a 0–16 px gaussian radius. |
| **Set camera pixelate block size** | `Pixelate` | 1–64 | Block size in **real screen pixels**. 1 = no pixelation. |

**How it sits in the chain.** The prepass runs at the point the scene is sampled, so the colour grading sees the soft image. The overlay composites afterwards, and the whole display stage (shadow mask, interlacing, roll, flicker, grain, bezel) still runs over both, because those belong to the glass rather than the lens.

**Pixelate vs. Pixel size.** These are different knobs. `Set CRT pixel size` / `Set CRT scanline count` drive the emulated scanline grid (`res`) and only mean something with scanlines on. **Set camera pixelate block size** is independent: it works with scanlines off and does not change your scanline count.

**Blur and scanlines.** Blur resolves the scene through a gaussian, so as the radius climbs the scanline detail softens with the picture. Small values stay close to the sharp image. Chromatic aberration is carried through the blur rather than dropped.

### Master
| Action label | Range | Notes |
|---|---|---|
| **Set shader render opacity** | 0–255 | Master fade of the whole effect. Not gated by any group. |

---

## Overlay layer (run a HUD through the effect)

By default the effect treats your 2D UI as untouched — it's drawn on top of the CRT quad, so a HUD stays crisp while the world behind it gets scanlines, curvature, glow, etc. Sometimes you want the opposite: a HUD that looks like it's *part of the same tube*. The overlay feature pulls a chosen **2D layer** into the CRT pass so it picks up curvature, scanlines, opacity, and an optional phosphor glow along with the 3D.

How it works: the named 2D layer is captured into a texture (shared GPU texture, no per-frame CPU readback) and composited inside the shader between the camera signal and the display. Turn it on with the action below and the named layer is grabbed every frame; leave it off and nothing extra is captured or rendered, so the default path costs nothing.

| Action label | Parameters | Range | Description |
|---|---|---|---|
| **Render a 2D layer through the effect** | `OverlayLayer` (layer) | — | Start compositing the named 2D layer inside the effect. |
| **Stop rendering the 2D layer through the effect** | — | — | Stop compositing the overlay; the layer goes back to drawing normally on top. |
| **Set overlay layer opacity** | `Value` (number) | 0–1 | Fade for the overlay only (1 = fully visible). **Note the scale:** this is 0–1, unlike the master **Set shader render opacity** which is 0–255. |
| **Set overlay UI glow** | `Value` (number) | 0–5 | Phosphor bloom on the overlay's own bright pixels. 0 = none. |

**Avoiding the double-draw.** When a layer is composited through the effect, you usually don't want GDevelop *also* drawing it normally on top — if it does, that raw crisp copy lands over the finished quad and the HUD escapes the effect. There are two ways to handle this:

1. **Hide the layer in the editor (recommended).** Toggle the layer's visibility *off* in the layer panel. GDevelop then skips drawing it the normal way, so there's no raw copy on top — but the overlay grab still captures it every frame while you're calling it from events, so it shows up *only* through the CRT. This sidesteps layer ordering entirely and is the simplest way to do it.
2. **Order it below the 3D layer.** Keep the layer visible but place it *below* your 3D layer in the list. A layer drawn at or above the 3D layer gets painted raw on top and escapes the effect.

> Scanlines follow the 3D: with the `Scanlines` group on, the overlay is reconstructed with scanlines too; with it off, the overlay is pixel-snapped without gaps, so toggling scanlines affects the HUD the same way it affects the world.

**Combining with 2D layer effects.** Normal 2D layer effects (blur, tint, outline, etc.) applied to the overlay layer carry through and then get the CRT treatment on top — the grab renders the layer's container with its filters intact. So far the 2D effects that have been tried work as expected, but not every effect has been tested. If a specific one doesn't show through, that's the first thing to check. Your other 2D layers are unaffected either way: the grab restores PIXI's render state afterward, so turning the overlay on never disturbs the rest of your 2D drawing.

---

## Conditions

| Condition label | Parameters | Description |
|---|---|---|
| **Shader render effect is enabled** | — | True while the overall effect is on. |
| **A CRT effect is enabled** | `Effect` (string) | True if the named group is on. Uses the same group names as the toggle action. |

---

## Expressions (read current values)

All return a number. Use anywhere an expression is accepted (e.g. `CRTScreenBulge()`).

| Expression | Returns |
|---|---|
| `ShaderRenderOpacity()` | Opacity |
| `CRTScanlineThickness()` | Scanline thickness |
| `CRTPixelSharpness()` | Pixel sharpness |
| `CRTScanlineCount()` | Scanline count |
| `CRTPixelSize()` | Pixel size |
| `CRTScreenBulge()` | Screen bulge |
| `CRTBorder()` | Border size |
| `CRTShadowMaskDarkLevel()` | Shadow mask dark level |
| `CRTShadowMaskLightLevel()` | Shadow mask light level |
| `ShaderRenderAberration()` | Chromatic aberration |
| `ShaderRenderRollSpeed()` | Roll speed |
| `ShaderRenderRollHeight()` | Roll height |
| `ShaderRenderFlicker()` | Flicker |
| `ShaderRenderInterlace()` | Interlacing |
| `ShaderRenderGamma()` | Gamma |
| `ShaderRenderTintRed()` | Tint — red channel |
| `ShaderRenderTintGreen()` | Tint — green channel |
| `ShaderRenderTintBlue()` | Tint — blue channel |
| `ShaderRenderGrainAmount()` | Grain amount |
| `ShaderRenderGrainSize()` | Grain size |
| `ShaderRenderGrainColor()` | Grain colour |
| `ShaderRenderGrainSpeed()` | Grain speed |
| `ShaderRenderBlur()` | Camera blur (0–100) |
| `ShaderRenderPixelateSize()` | Camera pixelate block size in real pixels (1–64) |

---

## Moved to GDevelop's built-in effects (1.0.0)

**Bloom, Brightness, Saturation and Contrast were removed in 1.0.0.** GDevelop's own 3D layer effects cover them, and since 0.8.0 those compose correctly with this extension, so carrying duplicates was pointless. Use the layer effect list instead:

| Removed from 3DCRT+ | Use instead |
|---|---|
| `Set shader render bloom` (+ threshold, radius, soft knee, tint) | **Bloom** |
| `Set shader render brightness` | **Brightness and contrast** |
| `Set shader render contrast` | **Brightness and contrast** |
| `Set shader render saturation` | **Hue and saturation** (which also gives you hue rotation, which 3DCRT+ never had) |

The `Bloom` and `Brightness` effect groups are gone from **Enable or disable a CRT effect** too.

**Gamma and phosphor tint stayed** — GDevelop has no equivalent for either. Exposure is not gamma, and hue rotation cannot do a per-channel multiply, which is what a monochrome amber or green phosphor needs.

**One visible difference with bloom.** 3DCRT+ added its glow *after* scanline reconstruction, so it stayed smooth over the scanlines. The native Bloom runs *before* this extension's pass, so the CRT's `Tri()` reconstruction re-samples the glow and it comes out following the scanline structure. Both get clipped by the bezel, since the border kill is the last thing the shader does.

---

## Working alongside GDevelop's built-in 3D effects

Since **0.8.0** the effect runs as a real post-processing pass inside the target layer's `EffectComposer` — the same chain, through the same `addPostProcessingPass` entry point, that GDevelop's own 3D effects use. So you can stack 3DCRT+ with **Bloom**, **Brightness and contrast**, **Exposure**, **Hue and saturation**, and they compose properly instead of fighting.

Two consequences worth knowing:

- **3DCRT+ runs last.** The built-in effects grade the raw 3D scene, then the CRT pass applies the tube look on top of the result. That is the order you want: a native Bloom or Hue shift affects the scene, and the scanlines, mask and bezel go over the finished image.
- **Antialiasing softens scanlines.** GDevelop adds an `SMAAPass` after your passes unless the project's antialiasing is set to **None**. For a crisp scanline look, turn it off.

**Multiple 3D layers now work.** Each layer owns its own composer, so pointing the effect at a layer no longer means every other 3D layer gets overwritten.

---

## Notes & known gaps

- **Image stretch (X/Y)** can be set in the **behavior properties** but has **no runtime action or expression** in this version — you can't change it from events yet. Default is no stretch.
- **Unknown group names are ignored silently.** The selector offers the valid names, but if you type one from events, a misspelling fails quietly rather than erroring.
- **Everything is off by default.** Adding the extension changes nothing until you enable a group (in the properties panel or via *Enable or disable a CRT effect*).
- **Shadow-mask** strength varies with display DPI — tune per project.
- **Performance.** Cost scales with the number of enabled effects and the output resolution. The shadow mask, grain and camera blur are the most expensive; enable those selectively on lower-end or mobile hardware. The overlay grab adds one layer render + composite per frame *only while it's switched on*.
- **Overlay across scenes.** The overlay grab resolves the layer against the current scene each frame, so it works after a scene change — including in projects where the effect persists across scenes.

---

## Example: fade the effect in on pickup

```
Condition: (player picks up camcorder)
Action:    Start shader render effect (layer: "")
Action:    Enable or disable a CRT effect — "Scanlines" : yes
Action:    Enable or disable a CRT effect — "Grain" : yes
Action:    Set shader render opacity to 0
```
Then ramp `Set shader render opacity` from 0 toward 255 over time for a power-on fade.

To run a HUD through the same tube (put the HUD on its own 2D layer and hide that layer in the editor):

```
Action: Render a 2D layer through the effect (layer: "HUD")
Action: Set overlay UI glow to 0.4
```

---

*3DCRT+ by Twillion. Core CRT math adapted from Timothy Lottes' public-domain shader. See `LICENSE.txt` for terms.*
