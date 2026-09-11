# Weather FX 2D

Snow, rain, fog, embers, water rings, heat haze, heat shimmer, underwater distortion, tear lines and
a travelling magnifier band — for 2D GDevelop games.

Everything here stays correct **anywhere on the map, at any zoom, at any resolution**. That is the
entire reason this extension exists — see [Why this exists](#why-this-exists).

---

## Install and start an effect

1. Import `WeatherFX2D.json` in GDevelop's Functions/Behaviors extension manager.
2. Add an **At the beginning of the scene** event.
3. Choose **Weather → Snow → Start snow**, or the dedicated start action for another effect.
4. Leave the layer empty for the base layer and preview. No object, behavior, or per-frame action is needed.

## Configure each effect

Every effect has its own action group. Configuration actions can also start the effect themselves.
They expose only relevant settings, in forms with at most six settings plus the layer:

| Effect | Dedicated configuration actions |
| --- | --- |
| Snow | Particles, appearance, falling, swing, placement |
| Rain | Drops, appearance, falling, splashes, placement |
| Fog | Patches, appearance, drift, sway, placement |
| Embers | Particles, appearance, rising, flutter, placement |
| Water rings | Rings, appearance, placement |
| Heat haze | Waves, heat, ripples, placement |
| Heat shimmer | Shimmer, ripples, placement |
| Underwater | Waves, ripples, placement |
| Distortion ripples | Ripples, placement |
| Tear lines | Strips, ripples, placement |
| Magnifier band | Lens, ripples, placement |

For snow, **Configure snow falling** sets the speed range and direction variation.
**Configure snow swing** separately sets sideways travel distance, swing frequency, and irregularity.
Each flake has its own speed, swing phase, and swing rate. Irregularity adds a second flutter frequency;
0 gives a regular swing, and 1 gives the strongest irregular flutter. Swing distance is in screen pixels.

Rain defaults to falling straight down, with up to 3 degrees of variation per drop and a range of
fall speeds. It does not sway or gust by default. Its falling action can add wind and gusts;
its splash action controls world-anchored water impacts.

Changing one configuration section preserves the other sections of that effect. Switching to a
different effect on the same layer restores that effect's defaults before applying your settings.
There is one standalone weather system and one standalone distortion system per layer. Use separate
layers to combine several weather types or several distortions.

The existing shared actions remain under **Advanced → Shared weather controls** and
**Advanced → Shared distortion controls** for existing projects and generic event logic. These include
stop actions, manual ring/ripple spawning, and numeric setting expressions. Global intensity and pause
apply to both standalone effects and optional behaviors.

**Water rings and rain splashes always stay at their world spawn positions.** Falling particles can
use World or Screen anchoring. Distortion placement controls the standing pattern's world-follow amount;
spawned distortion ripples stay anchored to their world position independently.

For behavior-based setup, attach **Weather Emitter 2D** or **Screen Distortion 2D** to an object.
The sections below describe those optional behavior properties.

---

## The two behaviors

### Weather Emitter 2D

Particles: **Snow**, **Rain**, **Fog**, **Embers**, **Ripples**.

`Ripples` is the odd one out — nothing falls, and the effect is expanding rings *drawn on* the
water rather than a shader bending the image. Good for a pond surface, or put the behavior on your
player and spawn rings by hand as they wade.

The first thing in the panel is **Effect type**, and the second is **Use built-in settings for this
type**, which is **on** by default. While it is on, every Look / Motion / Particles / Rain / Ring
number below is ignored and the built-in look for the chosen type is used. Turn it **off** to author
those numbers yourself.

Four things always apply either way, because you should not have to disable the presets to reach
them: **Effect layer**, **Enabled**, **Intensity** (multiplies the particle count — this is the one
to tween for a storm building or dying), and the whole **Placement** group.

To start from a built-in look and then edit it, use the action **Copy a built-in look into the
settings** — it writes the preset's numbers into the behavior's own properties and switches the
built-in settings off, so you get a working starting point instead of 19 blank numbers.

**Units.** Sizes are in screen pixels, speeds in screen pixels per second — which is why the look
holds through a zoom change. **Density** means *particles visible on one screenful*. **Angles**
follow GDevelop: `0` is right, `90` is straight down, `270` is straight up.

### Screen Distortion 2D

A shader on the whole layer. Six modes:

| Mode | What it looks like |
| :--- | :--- |
| **Heat Haze** | Smooth sine shimmer, sideways, fading toward the top of the screen |
| **Heat Shimmer** | The turbulent cousin — fractal noise instead of a sine. Reads as real rising air |
| **Underwater** | Slow swim on both axes, long wavelength |
| **Tear Lines** | Hard-edged horizontal strips that jump sideways. Quantise the edges for pixel art |
| **Magnifier Band** | A lens scrolls down the screen, stretching whatever passes through it |
| **Ripples Only** | No standing wave at all — nothing moves until something hits the water |

Same shape as the emitter: **Mode** first, **Use built-in settings for this mode** second and on by
default. Everything drawn on the target layer is bent, objects included; other layers are untouched.

**Ripples** (the shader kind) are the fun part. `Spawn a ripple at this object` centres one on
whatever object carries the behavior — put it on the player and call it as each footstep lands. Or
`Spawn a ripple at a position` with any scene coordinates, including `CursorX()` / `CursorY()`. Up
to 12 run at once; a thirteenth replaces the oldest. They are stored in world coordinates, so each
one stays over the spot that spawned it while the camera moves.

Two kinds of ripple, deliberately: **Screen Distortion 2D** bends the image, **Weather Emitter 2D**
in `Ripples` mode draws visible rings. Different looks, both useful, and you can run both at once.

---

## Built-in looks

| | Snow | Rain | Fog | Embers | Ripples |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Density (on screen) | 220 | 320 | 26 | 90 | 0 |
| Size (px) | 2 – 5 | 1 – 2 | 140 – 380 | 2 – 4 | — |
| Speed (px/s) | 35 – 95 | 700 – 1300 | 4 – 16 | 25 – 70 | — |
| Wind angle | 90 (down) | 90 (down) | 0 (right) | 275 (up) | — |
| Wind spread | 14° | 3° | 22° | 22° | — |
| Sway | 16 px | none | 10 px | 22 px | — |
| Softness | 0 (crisp) | 0 (crisp) | 1 (soft) | 0.75 | — |
| Additive | no | no | no | **yes** | no |
| Rings / second | — | 26 | — | — | 8 |
| Ring radius (px) | — | 5 – 13 | — | — | 14 – 46 |
| Ring lifetime | — | 0.45 s | — | — | 2.2 s |

| | Heat Haze | Heat Shimmer | Underwater | Tear Lines | Magnifier Band | Ripples Only |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Wave strength | 4 px | 5 px | 9 px | 2 px | 0 | 0 |
| Wavelength across | 160 px | 240 px | 220 px | 160 px | 160 px | — |
| Wavelength down | 55 px | 150 px | 190 px | 90 px | 420 px | — |
| Speed | 1.1 | 0.45 | 0.55 | 0.35 | 0.25 | — |
| Fade toward top | 0.55 | 0.6 | 0 | 0 | 0 | — |
| Tear offset / coverage | — | — | — | 7 px / 0.35 | — | — |
| Tear strip height | — | — | — | 4 px | — | — |
| Magnification / band | — | — | — | — | 1.35 / 70 px | — |
| Ripple strength | 8 px | 8 px | 10 px | 8 px | 8 px | 12 px |

---

## Notes worth knowing

**Softness 0 draws a crisp square.** For pixel art that is correct, and it is also the cheapest path
— it uses PIXI's built-in white texture and batches into a single draw call.

**Anchoring.** Particles use a binary `World` / `Screen`. `World` (default) leaves them on the map,
so moving the camera moves you past them; `Screen` pins them to the display like a HUD overlay.
Camera rotation is handled exactly in both.

**Distortion defaults to world anchoring (1).** Heat haze, heat shimmer, underwater waves,
tear lines and magnifier patterns track the map when the camera moves. Use 0 only for an
intentional screen effect. Existing events or behaviors saved with 0.3 must be changed to 1;
importing a new extension does not replace values already stored in your project.
Spawned ripple centres always stay at their world positions.

**Wind does not rotate with the camera.** Snow falls down the *screen*, not down the *world*. In a 2D
game that is almost always what you want; it matters only if you rotate the camera.

**Heat Shimmer scrolls rows by offsetting them, not by giving each row its own speed.** Their
original used a per-row speed multiplier, which cannot fold seamlessly — the fold would shift every
row by a different amount and leave a visible seam in the world. Offsetting looks the same and never
pops.

**Frame steps are clamped to 0.1 s.** A tab regaining focus hands over a multi-second step, and
integrating it whole would teleport the whole field in one frame.

**Performance.** All particles of one emitter share a single texture and batch into one draw call.
Density 220 at the default margin stores about 300 sprites. Check the real count with the
`ParticleCount` expression before pushing density high.

**WebGL.** The distortion shader needs it. On a canvas fallback the particles still work and the
distortion does nothing. Test with the `WeatherFX 2D is supported` condition.

---

## Replacing the older `WeatherControl` extension

This covers all ten effects from that extension, corrected, plus five that were not there.

| `WeatherControl` | Here | Notes |
| :--- | :--- | :--- |
| `StartSnow` | Snow | Was pinned to the world rectangle `(0,0)–(resolution)` |
| `BetterSnow` | Snow | Their corrected version. This one wraps instead of destroy/respawn, which also removes the thinning wedge you get when moving against the wind |
| `StartRain` | Rain | Same world-rectangle bug; splashes added |
| `Heat` | Underwater | Structurally a direct port — same 2.3× / 2.7× harmonics |
| `StartHeatWave`, `StartRealHeat` | Heat Shimmer | Both were fbm noise; collapsed into one mode |
| `StartMirageLine`, `Haze` | Tear Lines | MirageLine is Tear Lines with the ambient wave on; Haze is the same with it at 0 |
| `NewheatWave` | Magnifier Band | Travelling magnifying band |
| `StartWaterRipple`, `SpawnWaterRipple` | Ripples effect type | Drawn rings, ambient spawn rate, plus spawn-on-demand |
| — | Fog, Embers | New |
| — | Distortion ripples | New — the shader kind, alongside the drawn kind |
| — | Global intensity, pause | New |
| — | Behavior panels, presets, world-follow control | New |

Everything above went through the same correctness pass: pinned `filterArea`, screen-pixel
derivation, `highp`, seamless world-anchoring folds, and phases that never drift.

---

## Why this exists

Three bugs show up in nearly every hand-rolled version of these effects in GDevelop. They share a
symptom — *"it snaps at a certain Y, it gets stronger and faster, and if I walk away from my objects
it disappears entirely"* — and two completely unrelated causes.

**Particles: world coordinates written as if they were screen coordinates.** The container you get
from `layer.getRenderer().getRendererObject()` is in **world** space — GDevelop rewrites its
transform from the camera every frame (`layer-pixi-renderer.js`, `updatePosition`: scale = zoom,
position = viewportOrigin − cam × zoom). Positioning particles with `getGameResolutionWidth()`
therefore pins the whole effect inside the world rectangle `(0,0)–(1920,1080)` and nowhere else.
Walk off it and the weather is gone; the wrap test `drop.y > gameHeight` becomes a fixed line on your
map that the entire field crosses together.

Here, particles are integrated in **field space** — screen pixels relative to the centre of the view
— and wrapped against a box that is always centred on the camera. There is no fixed world line and
no world rectangle to fall out of. Wrapping is a modulo rather than a subtract, so a camera teleport
resolves in one frame.

**Distortion: trusting `vTextureCoord` to be screen UV.** It is neither screen UV nor `0..1`. PIXI's
default filter vertex shader computes it as `aVertexPosition * (outputFrame.zw * inputSize.zw)`. With
no `filterArea` set, `FilterSystem.push` sizes the framebuffer from `target.getBounds()` — the union
of every object on the layer, clipped to the screen — and `TexturePool.getOptimalTexture` returns an
exact-fit texture for **exactly one size, the full screen**; one pixel off and it rounds up to the
next power of two. So `vTextureCoord`'s range collapses from `0..1` to about `0..0.53` in a single
frame, and every amplitude and wavelength expressed in UV units snaps with it. When the bounds stop
intersecting the screen at all, PIXI zeroes the frame and the filter never runs.

Here, `filterArea` is pinned to exactly `renderer.screen` (never padded — padding pushes the request
off that exact-fit path), and the shader recovers real screen pixels from PIXI's own `inputSize` and
`outputFrame` uniforms. Edge sampling clamps to `inputClamp` rather than `0..1`, because past
`inputClamp` a power-of-two texture is dead padding. Precision is `highp`, which is required rather
than cosmetic: world coordinates exceed `mediump`'s exact range within a screen or two of the origin.

**World anchoring has to fold, and the fold has to be invisible.** World coordinates grow without
bound, so they are folded before reaching the shader. Ten wavelengths is the fold for the sine modes,
because the harmonics are 2.3× and 2.7× the base and ten of each is 23 and 27 whole cycles. Heat
Shimmer folds at 4096 instead, because its `hash()` wraps the noise lattice at 4096 cells — which
both keeps `sin()`'s argument precise far from the origin and makes the noise tile exactly there.
Tear Lines quantises its strips in *phase* space rather than in pixels, because phase is periodic and
world Y is not.

All of the above was read out of the GDJS runtime shipped with GDevelop 5.6.279 (PIXI 7.4.2).

---

## Developing

```bash
node WeatherFX2D/build-extension.mjs           # rebuild WeatherFX2D.json
node WeatherFX2D/build-api-reference.mjs       # rebuild API_REFERENCE.md
node WeatherFX2D/test-runtime.mjs              # 67 tests, no dependencies
node WeatherFX2D/check-shaders.mjs             # static GLSL sanity check
```

Add `--check` to either build script to fail instead of writing, for CI.

Edit `WeatherFX2D.runtime.js` (the engine) or `build-extension.mjs` (the declarations) — never
`WeatherFX2D.json` or `API_REFERENCE.md`, which are generated.

The build refuses to produce a file if a property has no group, a property name is duplicated, the
properties panel would not open on the Effect group, a behavior function takes `object` anywhere but
parameter 0, a JsCode block references a parameter it never fetched, a block fails to parse, a block
contains a NUL byte, or the JS calls a runtime function that does not exist.

Neither `test-runtime.mjs` nor `check-shaders.mjs` compiles GLSL — a broken shader passes both and
then silently draws nothing. Verify visually in GDevelop.

MIT licensed.

Water rings and rain splashes always stay at their world spawn positions, including when falling
particles use Screen anchoring. Camera movement does not move an existing ring across the map.

### Camera-independent heat and water oscillation (v1.5)

Heat haze, underwater waves, and heat shimmer now oscillate over a stationary world pattern.
Spatial shape and animation phase are multiplied rather than added, so moving through the pattern
does not advance its oscillation phase. This changes their look from travelling waves to standing
waves. Camera movement still reveals different parts of the spatial pattern. Tear strips and the
magnifier band retain their intentional scrolling motion. Spawned ripple centres remain world-anchored.
