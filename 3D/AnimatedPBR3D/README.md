# Animated & Custom PBR Material 3D (`AnimatedPBR3D`)

**Author:** Christopher Monhollen (`Twillion`)
**License:** MIT
**Category:** 3D
**Version:** 2.0.0
**Tested against:** GDevelop 5 with Three.js r160 / PIXI 7.4.2

---

## Overview

`AnimatedPBR3D` is a behavior that takes over the material of a 3D object so you can:

1. **Assign custom PBR texture maps** from your project's image resources — albedo, normal,
   roughness, metalness, ambient occlusion and emissive.
2. **Scroll UVs in real time** for flowing water, lava, conveyor belts, road markings and forcefields.
3. **Animate a spritesheet flipbook** across the surface for talking mouths, blinking eyes,
   flickering screens and flame cards.
4. **Play video** on a 3D surface — in-game TVs, billboards, holographic terminals.

Every setting is available twice: as a **behavior property** you configure once in the editor, and
(for the common ones) as an **action** you drive from events.

---

## Installing

1. Open your GDevelop project.
2. **Project Manager** → **Extensions** → **Import or install an extension**.
3. Choose **Import an extension from a file** and select `AnimatedPBR3D.json`.
4. Add the **Animated & Custom PBR Material 3D** behavior to a 3D object.

The behavior accepts any object type, because GDevelop lets a behavior declare only one, and 3D Box
(`Scene3D::Cube3DObject`) and 3D Model (`Scene3D::Model3DObject`) are two different types. **Attach
it only to a 3D object.** On anything else it gives up after about three seconds and writes a single
explanatory warning to the developer console.

---

## Upgrading from 1.0.0

**1.0.0 was packaged against the wrong schema.** Its property block used a key GDevelop does not
read, so none of the 47 settings appeared in the editor, and the six actions that write a property
(`Set albedo`, `Set normal map`, `Set roughness`, `Set metalness`, `Set emissive`, `Set texture
tiling`) failed on their first line. Its five resource parameters also used an unregistered parameter
type.

2.0.0 fixes the packaging, so **settings that were previously inert now take effect**. Open the
behavior on each object and check the defaults before shipping — in particular *Alpha Mode*
(`Opaque`), *Material Side* (`Front`), *Cast Shadow* and *Receive Shadow* (both on). This is why the
version is a major bump even though no action, condition or expression was renamed or removed.

Three deliberate behaviour changes:

- **`Set UV scroll speed` no longer switches scrolling on.** In 1.0.0 it silently set the enabled
  flag, which meant it could undo a previous `Enable/disable UV scrolling: No`. Pair it with
  `Enable/disable UV scrolling` now.
- **`Set flipbook frame` now clears the finished state**, so a non-looping animation can be restarted
  from events.
- **The accumulated scroll offset wraps to the 0–1 range.** `Scroll UV offset X/Y` therefore returns
  a wrapped value rather than one that grows forever. This keeps the texture matrix precise during
  long sessions; the on-screen result is identical because UV offsets are periodic.

---

## Behavior properties

Configure these on the object; every one is live at runtime.

**General** — Apply On Creation · Include Children · Target Mode (*All materials · First material ·
Material index · Material name · Mesh name*) · Material Index · Material Name · Mesh Name · Clone
Materials

**PBR Textures** — Albedo / Base Color Map · Use Base Color Tint · Base Color Tint · Normal Map ·
Normal Map Scale · Roughness Map · Roughness Factor (0-1) · Metalness Map · Metalness Factor (0-1) ·
Ambient Occlusion (AO) Map · AO Intensity (0-1) · Emissive Map · Emissive Color · Emissive Strength ·
Texture Filtering (*Keep Original · Nearest · Linear*)

**UV Mapping** — Tiling X (Repeat) · Tiling Y (Repeat) · Offset X · Offset Y · UV Rotation (Degrees) ·
Rotation Center X · Rotation Center Y

**UV Scrolling** — Enable UV Scrolling · Scroll Speed X · Scroll Speed Y · Rotation Speed (deg/sec)

**Flipbook Animation** — Enable Flipbook Animation · Flipbook Columns (X frames) ·
Flipbook Rows (Y frames) · Animation FPS · Loop Animation · Total Frames (0 = all)

**Rendering** — Alpha Mode (*Opaque · Blend · Cutout · Additive · Multiply*) · Alpha Opacity (0-1) ·
Alpha Cutoff (Cutout Mode) · Depth Write · Material Side (*Front · Double · Back*) · Wireframe ·
Cast Shadow · Receive Shadow

Notes:

- **Clone Materials** (on by default) copies the material before editing it, so two instances of the
  same object can carry different textures. Turn it off to edit the shared material in place.
- **Apply On Creation** (on by default) applies the material as soon as the renderer is ready. Turn
  it off if you want nothing to happen until an action runs.
- **A texture slot left empty keeps whatever the object already had there**, so importing a 3D model
  with baked-in maps and overriding only the albedo works as expected.
- Scroll speeds and flipbook settings are read from the properties **once**, when the material is
  first applied. After that, events own them — a later texture action will not overwrite what
  `Set UV scroll speed` or `Configure flipbook spritesheet` put in place.

---

## Use cases

### Flowing water and lava

1. Set **Albedo / Base Color Map** to your tiling texture.
2. Tick **Enable UV Scrolling** and set **Scroll Speed Y** to `0.5`.

Or from events: *Set UV scroll speed of `Lava` to X: 0, Y: 0.5 (rotation: 0 deg/s)*, then
*Set UV scrolling for `Lava` to yes*.

### Animated faces (flipbook)

1. Build a spritesheet, e.g. 4 columns × 4 rows = 16 expressions.
2. Set the face material's **Albedo / Base Color Map** to it.
3. Tick **Enable Flipbook Animation**, set **Flipbook Columns** `4`, **Flipbook Rows** `4`,
   **Animation FPS** `12`.
4. Switch expression from events: *Set current flipbook frame of `Head` to 3*.

Frames are numbered left to right, top to bottom, starting at 0. **Total Frames** trims a partly
filled grid; leave it at `0` to use every cell.

### In-game TV / video billboard

```text
At the beginning of the scene:
  -> Set video texture on Screen3D from resource "trailer" (loop: yes, muted: yes)
```

Two things browsers enforce, which no extension can work around:

- **Autoplay needs the video muted**, or a user interaction first. If playback is blocked the surface
  holds the first frame and a warning appears in the developer console. Either ship it muted, or call
  *Play video texture* from a click or key press.
- **Video is not preloaded with the scene.** The surface stays on its previous texture until enough
  of the video has buffered.

Prefer **Set video texture (from resource)** for files inside your project: it resolves the path
through GDevelop's resource loader, so it survives export. **Set video texture** takes a raw URL and
is the right choice for remote or streamed video.

---

## Actions

Names below are exactly what you'll find in the editor.

**PBR textures**
- **Set albedo / base texture** — base colour texture from an image resource. Replaces any video
  playing on this object and shuts the video down.
- **Set normal map texture** — normal map and bump scale.
- **Set roughness map & factor** — roughness texture and factor. The factor is clamped to 0–1.
- **Set metalness map & factor** — metalness texture and factor. The factor is clamped to 0–1.
- **Set emissive map & glow** — emissive mask, RGB glow colour (each channel clamped to 0–255) and
  strength (clamped to 0 or above).

**UV mapping / scrolling**
- **Set texture tiling / repeat** — horizontal and vertical repetition.
- **Set UV scroll speed** — X, Y and rotation speed (degrees/sec). Does *not* enable scrolling.
- **Enable/disable UV scrolling** — turns the animation on or off.

**Flipbook animation**
- **Configure flipbook spritesheet** — columns, rows, FPS and loop mode. Enables the flipbook and
  starts it playing. Columns and rows are floored to whole numbers, minimum 1.
- **Set flipbook frame** — jump to a 0-based frame. Wraps past the end and clears the finished state.
- **Play flipbook animation** — enable and resume.
- **Pause flipbook animation** — hold the current frame.

**Video texture**
- **Set video texture** — load a video from a URL.
- **Set video texture (from resource)** — load a video from the project resources. *New in 2.0.0.*
- **Play video texture** / **Pause video texture** — playback control.

## Conditions

- **Is flipbook playing** — true only when the flipbook is enabled, playing and not finished.
- **Is flipbook finished** — true when a non-looping animation has reached its last frame.
- **Is UV scrolling enabled** — true when scrolling is switched on.
- **Is material ready** — true once the material has been applied successfully.

## Expressions

- `Object.AnimatedPBR3D::CurrentFrame()` — current flipbook frame index (0-based).
- `Object.AnimatedPBR3D::TotalFrames()` — number of frames in the flipbook.
- `Object.AnimatedPBR3D::ScrollOffsetX()` — horizontal UV scroll offset, wrapped to 0–1.
- `Object.AnimatedPBR3D::ScrollOffsetY()` — vertical UV scroll offset, wrapped to 0–1.
- `Object.AnimatedPBR3D::ScrollRotation()` — UV rotation in degrees, wrapped to 0–360.

---

## Performance and resource handling

- **Textures come from GDevelop's own loader** (`getThreeTexture`) and are cloned per behavior. The
  clone shares the decoded image and its GPU upload with every other user of that resource, and only
  the UV transform is private — so a hundred instances of one object do not mean a hundred uploads.
- **Colour space is set per slot.** Albedo and emissive are decoded as sRGB; normal, roughness,
  metalness and AO stay linear, as PBR data maps must.
- **Animating a texture costs no GPU uploads.** Scrolling and flipbook frames only write
  `offset`, `repeat`, `rotation` and `center`; Three.js rebuilds the UV matrix from those on its own.
  Nothing on the per-frame path marks a texture or material as needing an update.
- **Cleanup.** When an object is destroyed the behavior restores the original materials and disposes
  every material and texture it created, along with any video texture and its `<video>` element.
  Swapping a texture at runtime disposes the one it replaced. Textures owned by the engine are left
  alone — GDevelop disposes those itself on scene unload.

## Known limitations

- Only one object type can be declared per behavior, so the editor offers this behavior on 2D objects
  too. It cannot work there and says so in the console.
- Behavior properties are read when the material is applied. Changing one mid-preview through the
  debugger will not take effect until an action forces a re-apply.
- Video playback is subject to browser autoplay policy, and video keeps decoding while the game is
  paused.
