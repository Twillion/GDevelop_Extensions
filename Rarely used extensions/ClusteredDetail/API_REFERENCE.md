# ClusteredDetail — API Reference & GDevelop Specification

This document provides the complete specification of behaviors, properties, actions, conditions, expressions, and presets for **ClusteredDetail** (Clustered Forward Projective Decals for GDevelop 5).

---

## 1. Extension Summary & Compatibility

| Specification | Requirement / Metric |
| :--- | :--- |
| **Backend** | GDevelop 5 (Three.js WebGL2) |
| **Material Support** | `MeshStandardMaterial`, `MeshPhysicalMaterial` (Basic unlit materials are excluded) |
| **Max Active Decals** | 64, 128, 256, or 512 (Default: **128**) |
| **VRAM Footprint** | $< 60\text{ KB}$ for cluster indices & matrices + User's Texture Atlas |
| **Draw Call Overhead** | **0 extra draw calls** (evaluated inside base mesh pass) |
| **Target Frame Budget** | $< 0.05\text{ ms}$ CPU broadphase |

---

## 2. Behaviors

### 2.1 Behavior: `ClusteredDecal3D`
Add this behavior to any 3D object (typically a **Cube3D** or anchor object) to define an authored decal volume in the scene editor. The cube's scale defines the decal's width ($X$), height ($Y$), and projection depth ($Z$).

#### Properties:
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `AtlasIndex` | Number | `0` | Zero-based index into the active decal texture atlas (e.g. slot 0–15 for a $4 \times 4$ atlas). |
| `BlendMode` | Choice | `"AlphaBlend"` | Blending method: `"AlphaBlend"`, `"Multiply"`, `"NormalOnly"`, or `"EmissiveGlow"`. |
| `NormalCutoffAngle` | Number | `60.0` | Maximum surface angle in degrees. Surfaces angled steeper than this reject the decal. |
| `Opacity` | Number | `1.0` | Base opacity factor ($0.0$ to $1.0$). |
| `EmissiveIntensity` | Number | `1.0` | Brightness multiplier when `BlendMode` is `"EmissiveGlow"`. |
| `Lifetime` | Number | `-1.0` | Lifetime in seconds before auto-removal. `-1.0` = permanent / pinned in scene. |
| `FadeDuration` | Number | `1.0` | Duration in seconds of the linear fade-out before expiration. |

---

### 2.2 Behavior: `ReceiveClusteredDecals`
Add this behavior to any 3D model, floor, wall, or character mesh that should receive projected decals.

#### Properties:
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `Enabled` | Boolean | `true` | When true, the object's materials receive decal shader injections. |
| `LayerMask` | Number | `1` | Bitmask for layer filtering (e.g., allow blood decals on props but not on water). |

---

## 3. Global Scene Actions

### 3.1 Spawning Decals

#### `SpawnDecalOnSurface`
Spawns a dynamic decal oriented against a hit surface normal. Automatically aligns the decal's projection vector directly into the surface.
* **Parameters:**
  * `X, Y, Z` (Number): Hit position in 3D world coordinates.
  * `NormalX, NormalY, NormalZ` (Number): Surface normal vector at hit point.
  * `Width, Height, Depth` (Number): Dimensions of projection box in world units (e.g., $15, 15, 20$).
  * `AtlasIndex` (Number): Sub-image slot in the atlas (e.g., $0$ for bullet hole, $1$ for blood).
  * `BlendMode` (Choice): `"AlphaBlend"`, `"Multiply"`, `"NormalOnly"`, `"EmissiveGlow"`.
  * `Lifetime` (Number): Seconds before deletion (e.g. $30.0$).
  * `FadeDuration` (Number): Seconds of fading prior to deletion (e.g. $2.0$).

#### `SpawnDecalAtTransform`
Spawns a decal with explicit 3D Euler rotation angles.
* **Parameters:**
  * `X, Y, Z` (Number): World position.
  * `RotationX, RotationY, RotationZ` (Number): Euler angles in degrees.
  * `Width, Height, Depth` (Number): Box dimensions.
  * `AtlasIndex` (Number): Texture atlas index.
  * `BlendMode` (Choice): Blending mode.
  * `Lifetime` (Number): Lifetime in seconds.
  * `FadeDuration` (Number): Fade duration.

---

### 3.2 System Configuration Actions

#### `SetDecalAtlasTexture`
Assigns the global texture atlas resource used for decal projection.
* **Parameter:** `AtlasResource` (String/Resource name): Name of image resource in GDevelop project.

#### `SetDecalAtlasGrid`
Configures the sub-division grid of the atlas (e.g., $4 \times 4$ for 16 decals).
* **Parameters:**
  * `Columns` (Number): Number of horizontal tiles (Default: `4`).
  * `Rows` (Number): Number of vertical tiles (Default: `4`).

#### `ClearAllDynamicDecals`
Immediately removes all dynamic (non-pinned) decals from the scene.

#### `SetMaxDecals`
Reallocates the decal buffer capacity.
* **Parameter:** `Capacity` (Choice): `64`, `128`, `256`, or `512`.

---

## 4. Global Scene Conditions

| Condition | Description |
| :--- | :--- |
| `IsClusteredDetailSupported()` | Returns true if the device supports WebGL2 and 3D textures (`sampler3D`). |
| `ActiveDecalCount() > Value` | Compares the number of currently active dynamic decals against a threshold. |

---

## 5. Global Scene Expressions

| Expression | Return Type | Description |
| :--- | :--- | :--- |
| `ClusteredDetail::ActiveDecalCount()` | Number | Current number of active decals rendered this frame. |
| `ClusteredDetail::MaxDecals()` | Number | Maximum capacity of the decal ring buffer. |
| `ClusteredDetail::DecalCPUTimeMs()` | Number | CPU broadphase execution time in milliseconds. |

---

## 6. Atlas Coordinate Specification ($4 \times 4$ Default)

A standard $2048 \times 2048$ or $1024 \times 1024$ decal texture atlas is divided into 16 cells ($4 \times 4$):

```
+-----------+-----------+-----------+-----------+
|  Index 0  |  Index 1  |  Index 2  |  Index 3  |
|  Bullet 1 |  Bullet 2 |  Scorched |  Crack    |
+-----------+-----------+-----------+-----------+
|  Index 4  |  Index 5  |  Index 6  |  Index 7  |
|  Blood 1  |  Blood 2  |  Mud Puddle| Footstep L|
+-----------+-----------+-----------+-----------+
|  Index 8  |  Index 9  |  Index 10 |  Index 11 |
| Footstep R| Tire Track| Wall Grime| Rust Stain|
+-----------+-----------+-----------+-----------+
|  Index 12 |  Index 13 |  Index 14 |  Index 15 |
| Magic Rune| Laser Burn| Glow Glyph| Acid Pool |
+-----------+-----------+-----------+-----------+
```

The UV rectangle for slot $k$ in an $M \times N$ grid is computed automatically as:
$$\text{col} = k \pmod M, \quad \text{row} = \lfloor k / M \rfloor$$
$$u_{\text{min}} = \frac{\text{col}}{M}, \quad v_{\text{min}} = \frac{\text{row}}{N}, \quad \Delta u = \frac{1}{M}, \quad \Delta v = \frac{1}{N}$$

---

## 7. Blend Mode Reference

| Mode | Shader Action | Typical Usage |
| :--- | :--- | :--- |
| `"AlphaBlend"` | Standard linear interpolation (`mix`) with diffuse color based on decal alpha. | Blood splatters, paper posters, paint, graffiti. |
| `"Multiply"` | Multiplies underlying surface color by decal color: $\vec{C} \times \vec{C}_{\text{decal}}$. | Explosion burns, scorch marks, dark soot, wet patches. |
| `"NormalOnly"` | Modulates surface normal without altering base diffuse color. | Subtle bullet dents in metal, rock fractures, plaster cracks. |
| `"EmissiveGlow"` | Additive lighting accumulation multiplied by `EmissiveIntensity`. | Magic circles, glowing laser impacts, cyberpunk neon markings. |
