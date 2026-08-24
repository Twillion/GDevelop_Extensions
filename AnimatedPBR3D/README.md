# Animated & Custom PBR Material 3D (`AnimatedPBR3D`)

**Author:** Christopher Monhollen (`Twillion`)  
**License:** MIT  
**Category:** 3D  
**Version:** 1.0.0  

---

## Overview

**`AnimatedPBR3D`** is a high-performance 3D material behavior for GDevelop 5. It allows you to:
1. **Assign Custom PBR Texture Maps:** Directly link 2D image resources from your GDevelop project asset manager onto any 3D model (Albedo, Normal Map, Roughness, Metalness, Ambient Occlusion, and Emissive glow).
2. **Animate Textures with Real-Time UV Scrolling:** Create flowing water, bubbling lava streams, moving conveyor belts, highway road marks, and pulsing forcefields.
3. **Animate Textures with Flipbook Spritesheets:** Animate 3D faces (talking mouths, blinking eyes), flickering screens, and flame particles using 2D grid spritesheets.
4. **Play Video Textures:** Stream `.mp4` and `.webm` videos directly onto 3D surfaces (in-game TVs, billboards, holographic terminals).
5. **Zero Memory Leaks:** Complete Three.js texture and material lifecycle management with automatic GPU cleanup when objects/scenes are destroyed.

---

## How to Install into GDevelop

1. Open your GDevelop project.
2. In the **Project Manager** (left panel), scroll to **Extensions** -> **Import or install an extension**.
3. Select **Import an extension from a file** and choose `AnimatedPBR3D.json`.
4. Add the **`Animated PBR Material 3D`** behavior to any 3D Model, 3D Box, or 3D Object!

---

## Use Cases & Quick Guides

### 1. Assigning Custom PBR Textures
In the object properties or via Event Sheets:
* **Albedo Map:** Pick your diffuse base color texture from project resources.
* **Normal Map:** Pick your normal bump texture (adjust scale 0.0 -> 2.0+).
* **Roughness Map / Factor:** Set surface glossiness (0.0 = mirror glossy, 1.0 = matte).
* **Metalness Map / Factor:** Set metal reflectivity (0.0 = wood/stone, 1.0 = metal).
* **Emissive Map / Color:** Set self-illumination mask and glow intensity.

---

### 2. Flowing Water & Lava (UV Scrolling)
In the object behavior settings:
* Check **`Enable UV Scrolling`**.
* Set **`Scroll Speed X`** to `0.0` and **`Scroll Speed Y`** to `0.5` (or use event action *Set UV scroll speed*).
* The texture will continuously flow across the 3D surface smoothly at 60+ FPS!

---

### 3. Animated 3D Character Faces (Flipbook Spritesheet)
To create 2D animated faces on 3D heads (like *Wind Waker* or *Genshin Impact*):
1. Create a 2D spritesheet of expressions (e.g. 4 columns x 4 rows = 16 face expressions).
2. Set the face material Albedo map to your spritesheet.
3. In the behavior properties or events:
   * Check **`Enable Flipbook Animation`**.
   * Set **`Columns`** to `4`, **`Rows`** to `4`, **`FPS`** to `12`.
4. Trigger emotion changes with action:
   * `Set current flipbook frame to 3` (Happy), `5` (Surprised), or `8` (Angry).

---

### 4. In-Game TV / Video Billboards
In your event sheet:
```text
At the beginning of the scene:
  -> Set video texture on Screen3D from URL "assets/trailer.mp4" (loop: yes, muted: yes)
```

---

## Actions, Conditions & Expressions Reference

### Actions
- **Set albedo / base texture**: Change base color texture from image resource.
- **Set normal map texture**: Change normal map and bump scale factor.
- **Set roughness map & factor**: Change roughness texture and numeric factor (0.0 - 1.0).
- **Set metalness map & factor**: Change metalness texture and numeric factor (0.0 - 1.0).
- **Set emissive map & glow**: Change emissive mask, RGB glow color, and strength.
- **Set UV scroll speed**: Set X/Y scrolling velocity and rotation velocity in deg/sec.
- **Enable/disable UV scrolling**: Turn continuous UV scrolling on or off.
- **Set texture tiling / repeat**: Adjust horizontal and vertical repetition (X, Y).
- **Configure flipbook spritesheet**: Set grid columns, rows, FPS, and loop mode.
- **Set flipbook frame**: Jump directly to a specific 0-based frame number.
- **Play / Pause flipbook**: Control spritesheet animation playback.
- **Set video texture**: Load and map an MP4/WebM video texture onto the 3D surface.
- **Play / Pause video texture**: Control video playback.

### Conditions
- **Flipbook animation is playing**: True if the flipbook animation is running.
- **Flipbook animation is finished**: True if a non-looping animation reached its final frame.
- **UV scrolling is active**: True if UV scrolling is currently enabled.
- **3D material is ready**: True once the Three.js material has initialized.

### Expressions
- `Object.AnimatedPBR3D::CurrentFrame()`: Current active flipbook frame index.
- `Object.AnimatedPBR3D::TotalFrames()`: Total frames in active flipbook animation.
- `Object.AnimatedPBR3D::ScrollOffsetX()`: Current horizontal UV scroll offset.
- `Object.AnimatedPBR3D::ScrollOffsetY()`: Current vertical UV scroll offset.
- `Object.AnimatedPBR3D::ScrollRotation()`: Current accumulated UV rotation angle.
