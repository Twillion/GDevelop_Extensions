# In-Game Camera 3D

Live camera feeds on 3D screens in GDevelop — CCTV monitors, TV sets, rear-view mirrors, arcade
cabinets, picture-in-picture. Also known as **render to texture** or a **render target**.

By **Twillion**.

> **Prototype — v0.3.0.** Camera objects, 3D layer views and 2D layer capture all work, shown on a
> face of a 3D Box. The CRT and signal effects described in `PLAN.md` are not built yet.
> See [What is not in this version](#what-is-not-in-this-version).

---

## Install

Load `InGameCamera3D.json` in GDevelop: **Project manager → Extensions → Import an extension**.

Rebuild it after editing the runtime:

```bash
node InGameCamera3D/build-extension.mjs
```

Never hand-edit `InGameCamera3D.json` — it is generated, and the build applies guards that catch
failures GDevelop otherwise reports a long way from their cause.

---

## Quick start: a security camera on a TV

1. Put a 3D Box in the scene where the camera should be. Call it `SecurityCam`. Make it small.
   You can leave it visible — a camera never appears in its own feed, so a visible camera object
   shows up in the room like a real one without filming the inside of itself.
2. Add the **In-game camera (3D)** behavior to it.
3. Rotate it so it faces what you want to film. **It films along its +X axis** — an angle of `0`
   faces right, the same as a 2D sprite. If your camera is a model that points a different way,
   change **Films along** in the behavior.
4. Put another 3D Box in the scene for the TV. Add the **Live screen (3D)** behavior to it.
5. In events, once at the start of the scene:

```
Show camera SecurityCam on the Front face of TV
```

That is the whole setup. Move or rotate `SecurityCam` at any time — with a tween, a behavior, or by
parenting it to something — and the feed follows.

You pick the camera *object*; you do not also pick its behavior. The extension finds the camera on
whatever object you point it at, which also means renaming the behavior on that object is harmless.
If you pick an object that has no camera behavior, the console says so by name.

### An arcade cabinet: a 2D layer on a screen

A 2D layer can be the screen's source directly — for arcade machines, in-game minigames, computer
terminals, anything you would rather build with sprites and text than with 3D geometry.

1. Put the minigame on its own 2D layer, say `Arcade`.
2. On the cabinet object, with the **Live screen (3D)** behavior:

```
Show 2D layer "Arcade" on the Front face of ArcadeCabinet
```

**Hide the layer** and it plays only on the cabinet. Its events keep running — a hidden layer still
ticks, it is just not drawn to the player's view — so the minigame is genuinely playable on the
screen, not a recording of one.

The layer is captured straight off the GPU into the screen's texture with no readback, so this costs
about one extra draw of that layer. Cap it with **Set the frame rate of a 2D layer capture** if the
minigame does not need 60 fps.

Use **Capture a 2D layer** first if you want to choose the resolution or how the layer fills the
screen:

- **Stretch** (default) — the layer fills the screen exactly. Bars on a monitor look like a bug.
- **Uniform** — scaled and centred, for artwork that must keep its proportions.
- **None** — no scaling at all, authored pixels land 1:1. **This is the one for pixel art**: any
  scaling resamples text and softens it.

### Filming a whole 3D layer instead

To show what an entire layer's own camera sees — a TV channel built on its own layer, a minimap, a
2D game on an arcade cabinet:

```
Start filming 3D layer "Studio" at Standard resolution, capped to 0 FPS
Show the view of 3D layer "Studio" on the Front face of TVSet
```

The filmed layer can be **hidden**. Hiding it removes it from the player's view but not from the
screen, which makes this the natural way to build a set the player only ever sees on a monitor.

---

## The three sources

|  | **Camera object** | **3D layer view** | **2D layer capture** |
|---|---|---|---|
| Shows | the layer, from wherever the object is | what that 3D layer's own camera sees | a 2D layer, drawn straight onto the screen |
| Aimed by | moving and rotating the object | the layer's camera | the layer's camera |
| How many | as many as you like, all on one layer | one per layer | one per layer |
| Use it for | CCTV, rear-view mirrors, drone feeds, monitor walls | a studio set, a minimap, picture-in-picture | arcade cabinets, minigames, terminals, UI screens |
| Costs | one extra render of that 3D layer | the same | one extra draw of that 2D layer |

All three end up in the same place: a face of a 3D Box carrying the `Live screen` behavior. A monitor wall covering four
corridors is four camera objects on one layer. A TV channel nobody can walk into is a hidden 3D layer.
A playable cabinet is a hidden 2D layer.

---

## Resolution

**Resolution is the camera's texture size, and it sets the shape of the shot as well as its
sharpness.** Switching `SD` (4:3) to `HD` (16:9) re-frames what is in view; it does not merely add
detail.

| Preset | Size | Memory | Reads as |
|---|---|---|---|
| Tiny | 160×120 | ~0.15 MB | barely-there feed, heavy pixel grid |
| Low | 320×240 | ~0.6 MB | classic CCTV |
| **Standard** | 512×512 | ~2 MB | default; square, so it suits cube faces |
| SD | 640×480 | ~2.4 MB | clean 4:3 monitor |
| HD | 1280×720 | ~7 MB | a modern screen — eight of these is 56 MB |
| Custom | yours | — | anything |

A low resolution here is **real**, not a filter: the feed genuinely is 320×240, so it costs less to
render rather than more, and the pixels hold up from any distance. Pair `Low` with
**Filtering: Nearest** for a crisp pixel grid; `Linear` at low resolutions just looks blurry.

Leave **Antialiasing** at `0` unless you are using `HD`. It smooths exactly the pixel grid the retro
presets exist to show.

Read `InGameCamera3D::TotalTextureMemoryMB()` to see what your feeds actually cost.

---

## Performance

A camera renders its layer a second time, so treat cameras as you would extra draw calls.

- **Cap the frame rate.** A monitor does not need 60 fps. `10`–`15` costs a fraction as much *and*
  gives an authentic surveillance judder. This is the single biggest saving available.
- **Turn cameras off when nobody can see them.** **Turn camera X on: no** keeps the last captured frame
  on the screen, so a switched-off camera still looks like a working monitor.
- **Drop the resolution** for screens the player never walks up to. The render target *is* the
  distant object, so its resolution is the level-of-detail control.
- **Shadows are reused from the main view by default.** This is a large saving and it is why the
  default exists. The cost: a camera pointed somewhere the player has never been may show stale
  shadows. Switch that camera's **Shadows** property to `PerPass` if it matters.

---

## The screen is black

Two very different causes, and the console tells them apart.

- **`camera pass failed — the feed will stay black`**, with an error attached. Something threw; the
  stack says what.
- **`rendered nothing — the camera is not pointing at any geometry`**, with the camera's position and
  the direction it is looking. The pass worked; there was simply nothing in shot.

For the second one, in order of likelihood:

1. **It is aimed the wrong way.** A camera films along its **+X** axis, so an unrotated camera looks
   to the right. Rotate the camera object, or set **Films along** to the axis your camera model
   actually points down.
2. **It is on the wrong layer.** A camera films the layer its object is on, and nothing else.
3. **Everything is behind the near plane, or beyond the far plane.** Defaults are 3 and 2000.
4. **The scene has no light.** A 3D scene with no light renders black from every angle, including
   the one you are already looking through — but a camera pointed somewhere unlit while your main
   view happens to be lit will look like a bug in the extension.

No warning at all, and still black, means the pass is not running: check that the camera object has
the **In-game camera (3D)** behavior and that its **On** property is ticked.

## Known limits in this version

- **Screens are 3D Boxes.** GDevelop has no 3D Plane object, so a flat screen is a Box with a small
  depth. Showing a feed on a 3D Model material is not supported.
- **"Repeat texture" is not supported on a bound cube face.** Turn it off for the face you bind.
- **Screen orientation is not adjustable yet.** Cube faces have per-face UV flips built into
  GDevelop, so a feed on the Back, Left or Bottom face may appear mirrored. Front and Right are the
  reliable ones for now.
- **The screen does not light the room.** `Lit` mode lets scene lighting dim the screen, but no
  material setting makes a screen illuminate its surroundings — that needs an actual light.
- **A 3D layer view does not include that layer's post-processing effects.** It films the raw layer.
- **A 2D layer capture is the layer as its own camera sees it**, so panning that layer's camera pans
  what is on the screen. Usually what you want; occasionally surprising.
- **Screen fit is per source, not per screen.** Two screens showing one source share its texture. If a
  screen is not the shape of its feed, author the source to match — for a 2D layer that means laying
  the minigame out at the screen's proportions.
- **All screens showing one source share its texture**, so per-screen fit and orientation are not
  available yet.

---

## What is not in this version

Implemented in `PLAN.md`, not yet in code:

- CRT and signal effects — scanlines, shadow mask, bulge, pixelation, grain, roll, aberration.
  The plan is to port these from `3DCRT+`, split into a feed-space half (the camera) and a
  screen-space half (the display).
- A 2D layer composited *over* a 3D camera feed as a HUD — the overlay in `PLAN.md` C12b. Showing a
  2D layer as the whole screen already works, see above.
- A per-camera post-processing chain, and multi-pass effects such as bloom.
- Per-screen fit modes (`Stretch` / `Fit` / `Fill`) and orientation flips.

---

## Reference

### In-game camera (3D) — behavior

Put it on any 3D object. The object's position and rotation aim the camera.

**Properties:** Resolution, Custom width/height, Filtering, Field of view, Near plane, Far plane,
Frame rate cap, On, Shadows, Antialiasing samples, Films along.

**Actions:** turn on/off, set resolution, set custom resolution, set filtering, set field of view,
set clipping, set frame rate, set which way it films.

**Conditions:** camera is on.

**Expressions:** `TargetWidth`, `TargetHeight`, `FOV`. Position and rotation come from the object's
own expressions, so this behavior adds none.

### Live screen (3D) — behavior

Put it on the 3D Box that should display a feed.

**Properties:** Screen lighting (`Unlit` / `Lit`), Visible from both sides.

**Actions:** show a camera, a 3D layer or a 2D layer on a 3D Box face, and stop showing a feed.

**Conditions:** screen is showing a feed.


### Scene actions

**3D layer view:** film a 3D layer, stop filming it, set its frame rate, set its resolution, and a
condition for whether it is being filmed.

**2D layer capture:** capture a 2D layer, stop capturing it, set its frame rate, and a condition for
whether it is being captured.

**Diagnostics:** `TotalTextureMemoryMB()`.

---

## For maintainers

`PLAN.md` carries the design and, more usefully, the reasons — nineteen numbered corrections, each
marked `[verified]` where it was read out of the installed GDJS runtime rather than assumed. Several
are non-obvious enough to be worth reading before changing anything here:

- **C1** — `renderer.autoClear` is `false` globally and nothing in the engine ever calls
  `setRenderTarget`, so a pass that fails to clear smears and one that fails to unbind renders the
  whole game into a texture.
- **C5** — materials are memoised game-wide by the image manager, so the material on one cube's face
  is the same object as on every other cube using that texture. Bindings clone, and revalidate every
  frame in case the mesh or a material slot is replaced underneath them.
- **C6** — a render target texture has `source.data === null`, which crashes Cube3D's UV remapping.
- **C18** — why cameras are objects rather than names.

The build script refuses to emit on a control character (a single NUL truncates a block and surfaces
much later as `<Action> is not a function`), parses every generated block, lints the schema, and
asserts the Cube3D face permutation against the installed engine.
