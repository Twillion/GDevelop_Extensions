# Polygon3D API Reference

Complete reference for all Objects, Properties, Actions, Conditions, and Expressions provided by the **Polygon3D** extension.

---

## 🔶 Object: `RhombicDodecahedron3D`

An exact 12-rhombus space-filling solid oriented with its `(1,1,1)` direction along local Z.

### Face names

- Upper exterior: `UpperRhombusFace0` through `UpperRhombusFace11`
- Lower exterior: `LowerRhombusFace0` through `LowerRhombusFace11`
- Horizontal sliced cap: `MiddleCutFace`
- Internal radial sides: `UpperRadialFace0..5Left/Right` and `LowerRadialFace0..5Left/Right`

Opposite radial pairs are `0/3`, `1/4`, and `2/5`.

### Properties

| Property | Default | Description |
| :--- | :--- | :--- |
| `UpperHalfVisible` | `true` | Master visibility for all upper shell groups. |
| `LowerHalfVisible` | `true` | Master visibility for all lower shell groups. |
| `RadialFaceMask` | `0` | Six-bit enable mask for radial faces (`0` to `63`). |
| `DirectedHalfDirection` | `-1` | Symmetrical directed half `0` to `5`; `-1` keeps the full shell. |
| `MasterTextureResourceName` | `""` | Non-empty value overrides all per-face resources; the exterior uses continuous cylindrical UV wrapping. |
| `RhombusFacesResourceName` | `""` | Fallback texture for all 12 rhombi. |
| `UpperRhombusFace0...11ResourceName/Visible/ResourceRepeat` | Per face | Per-face upper-shell controls. |
| `LowerRhombusFace0...11ResourceName/Visible/ResourceRepeat` | Per face | Per-face lower-shell controls. |
| `MiddleCutFaceResourceName/Visible/ResourceRepeat` | Per face | Sealed horizontal cut controls. |
| `RadialFacesResourceName` | `""` | Fallback texture for all radial faces. |
| `UpperRadialFace0...5Left/RightResourceName/Visible/ResourceRepeat` | Per side | Independent upper left/right wall-side controls. |
| `LowerRadialFace0...5Left/RightResourceName/Visible/ResourceRepeat` | Per side | Independent lower left/right wall-side controls. |

### Actions, conditions, and expressions

| API | Type | Description |
| :--- | :--- | :--- |
| `SetUpperHalfVisibility(Visible)` | Action | Toggles upper material groups without changing geometry. |
| `SetLowerHalfVisibility(Visible)` | Action | Toggles lower material groups without changing geometry. |
| `SetDirectedHalf(Direction)` | Action | Retains one of six symmetrical radial halves and exposes its center plane; the left/right radial face controls remain independent. |
| `ClearDirectedHalf()` | Action | Restores the full shell without rebuilding geometry. |
| `SetRadialFaceEnabled(Direction, Enabled)` | Action | Toggles one radial direction from `0` to `5`. |
| `SetRadialFaceMask(Mask)` | Action | Sets all six radial directions with a bit mask. |
| `SetMasterTexture(TextureResource)` | Action | Sets or clears the overriding wrapped texture. |
| `SetFaceVisibility`, `SetFaceTexture`, `SetRepeatTextureOnFace` | Actions | Generic controls for all 49 logical face names, including independent left/right radial sides. |
| `IsUpperHalfVisible()` / `IsLowerHalfVisible()` | Conditions | Test shell-half visibility. |
| `IsDirectedHalfActive()` | Condition | Tests whether directed shell-sector filtering is active. |
| `IsRadialFaceEnabled(Direction)` | Condition | Tests one radial direction bit. |
| `IsFaceVisible(FaceName)` | Condition | Tests a face's visibility property. |
| `RadialFaceMask()` | Number expression | Returns the six-bit radial mask. |
| `DirectedHalfDirection()` | Number expression | Returns `0` to `5`, or `-1` for the full shell. |
| `MasterTexture()` | String expression | Returns the active master override. |
| `FaceTexture(FaceName)` | String expression | Returns a face texture resource name. |

---

## 🔷 Object: `HexBipyramid3D` (3D Hexagonal Bipyramid)

### 1. Properties (15 Face Slots & Controls)

#### Geometry & Slicing
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `EquatorRadius` | Number | `50` | Equator radius ($R_{\text{eq}}$) of the middle hexagonal ring at $z = 0$. |
| `CapRadius` | Number | `25` | Radius ($R_{\text{cap}}$) of the top and bottom flat hexagonal caps. |
| `TotalHeight` | Number | `80` | Full height ($H$) of the bipyramid block. |
| `BlockState` | Choice | `Full` | Slicing state: `Full`, `Bottom Half`, or `Top Half`. |

#### Top & Bottom Caps
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `TopCapVisible` | Boolean | `true` | Show or hide the top hexagonal cap. |
| `TopCapResourceName` | Image Resource | `""` | Texture image resource for the top cap. |
| `BottomCapVisible` | Boolean | `true` | Show or hide the bottom hexagonal cap. |
| `BottomCapResourceName` | Image Resource | `""` | Texture image resource for the bottom cap. |

#### Upper Facets (6 Sloped Faces)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `UpperFacesResourceName` | Image Resource | `""` | Master fallback texture for all 6 upper facets. |
| `UpperFace0Visible` .. `UpperFace5Visible` | Boolean | `true` | Individual visibility toggle for upper facets 0 to 5. |
| `UpperFace0ResourceName` .. `UpperFace5ResourceName` | Image Resource | `""` | Individual texture image for upper facets 0 to 5. |

#### Lower Facets (6 Sloped Faces)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `LowerFacesResourceName` | Image Resource | `""` | Master fallback texture for all 6 lower facets. |
| `LowerFace0Visible` .. `LowerFace5Visible` | Boolean | `true` | Individual visibility toggle for lower facets 0 to 5. |
| `LowerFace0ResourceName` .. `LowerFace5ResourceName` | Image Resource | `""` | Individual texture image for lower facets 0 to 5. |

#### Middle Cut Face
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `MiddleCutFaceVisible` | Boolean | `true` | Show or hide the internal horizontal cut face at $z = 0$. |
| `MiddleCutFaceResourceName` | Image Resource | `""` | Texture image resource for the internal cut face. |

---

### 2. Actions

#### `SetFaceVisibility(FaceName, Visible)`
Shows or hides any specific face (`TopCap`, `BottomCap`, `UpperFace0`..`UpperFace5`, `LowerFace0`..`LowerFace5`, `MiddleCutFace`).

#### `SetFaceTexture(FaceName, TextureResource)`
Sets or dynamically changes the image texture of any specific face.

#### `SetBlockState(State)`
Changes the slicing display state (`Full`, `Bottom Half`, `Top Half`).

#### `SetEquatorRadius(Radius)` / `SetCapRadius(Radius)` / `SetTotalHeight(Height)`
Adjusts geometry radii and height, regenerating procedural vertices and colliders.

#### `SnapToHexGrid(EquatorRadius)`
Snaps the object position $(X, Z)$ to the nearest gapless hexagonal honeycomb grid point.

---

### 3. Conditions

#### `IsFaceVisible(FaceName)`
Checks if a specific face is currently visible.

#### `IsBlockState(State)`
Checks if the object is in a specific slicing state (`Full`, `Bottom Half`, `Top Half`).

#### `IsFull()` / `IsHalfBlock()`
Checks if the block is whole or sliced.

---

### 4. Expressions

| Expression | Return Type | Description |
| :--- | :--- | :--- |
| `Object.Polygon3D::HexBipyramid3D::FaceTexture(FaceName)` | String | Returns the texture resource name assigned to a specific face. |
| `Object.Polygon3D::HexBipyramid3D::BlockState()` | String | Returns current block state (`"Full"`, `"Bottom Half"`, `"Top Half"`). |
| `Object.Polygon3D::HexBipyramid3D::SurfaceZ()` | Number | Returns the top walkable surface elevation $Z$ in world coordinates. |
| `Object.Polygon3D::HexBipyramid3D::CenterOffsetZ()` | Number | Returns vertical center offset along $Z$ ($0, -H/4, +H/4$). |
| `Object.Polygon3D::HexBipyramid3D::SurfaceY()` | Number | *Deprecated alias of `SurfaceZ()`.* |
| `Object.Polygon3D::HexBipyramid3D::EffectiveHeight()` | Number | Returns the active collision height ($H$ or $H/2$). |
| `Object.Polygon3D::HexBipyramid3D::CenterOffsetY()` | Number | *Deprecated alias of `CenterOffsetZ()`.* |

---

### 5. Honeycomb Grid Math (Free Functions)

| Expression | Return Type | Description |
| :--- | :--- | :--- |
| `Polygon3D::DeltaX(EquatorRadius)` | Number | Horizontal column offset $\Delta X = \sqrt{3} \cdot R_{\text{eq}}$ for seamless gapless honeycomb tiling. |
| `Polygon3D::DeltaZ(EquatorRadius)` | Number | Vertical row offset $\Delta Z = 1.5 \cdot R_{\text{eq}}$ for seamless gapless honeycomb tiling. |
| `Polygon3D::HexToWorldX(Col, Row, EquatorRadius)` | Number | Converts hex column & row to world $X$ with odd-row staggering. |
| `Polygon3D::HexToWorldZ(Col, Row, EquatorRadius)` | Number | Converts hex column & row to world $Z$. |
| `Polygon3D::WorldToHexCol(X, Z, EquatorRadius)` | Number | Converts world $(X, Z)$ to nearest hex grid column. |
| `Polygon3D::WorldToHexRow(X, Z, EquatorRadius)` | Number | Converts world $(X, Z)$ to nearest hex grid row. |
| `Polygon3D::SnapX(X, Z, EquatorRadius)` | Number | Returns the snapped world $X$ coordinate on the honeycomb grid. |
| `Polygon3D::SnapZ(X, Z, EquatorRadius)` | Number | Returns the snapped world $Z$ coordinate on the honeycomb grid. |
