# Polygon 3D (Polygon3D)

**Procedural 3D Polygon Objects for GDevelop 5.**

`Polygon3D` is an extension suite of procedural 3D polygon shapes modeled directly after GDevelop's built-in **3D Cube (`Cube3DObject`)**, featuring **GDevelop native texture uploading, default texture fallbacks, individual face visibility, and texture repeating (tiling)**.

---

## 🔷 Included 3D Objects

### 1. `HexBipyramid3D` (3D Hexagonal Bipyramid)
- **14-Face Beveled Diamond Block**:
  - 2 flat hexagonal caps (Top Cap, Bottom Cap)
  - 6 upper sloped facets
  - 6 lower sloped facets
  - 1 middle horizontal cut face (revealed during slicing)
- **Native Texture & Material Pipeline**:
  - Dedicated Image Resource picker per face + bulk fallbacks
  - Texture repeat / tiling per face (`repeatTextureOnFace` + `tileScale`)
  - Full preview property synchronization
  - Dynamic half-block slicing (`Full`, `Bottom Half`, `Top Half`)
  - Dynamic Physics3D collision adjustment
  - Gapless hexagonal honeycomb grid snapping

### 2. `RhombicDodecahedron3D` (3D Rhombic Dodecahedron)
- **Exact space-filling geometry**:
  - 14 vertices and 12 congruent rhombus faces
  - `(1,1,1)` lattice direction oriented along GDevelop's local Z axis
  - Face-to-face compatibility with an FCC rhombic-dodecahedral lattice
- **Geometry variants**:
  - Fixed upper and lower shell fragments tagged into six radial sectors; halves are hidden with face visibility rather than geometry rebuilding
  - Exact horizontal center face exposed as `MiddleCutFace`
  - Six radial directions split by height and viewing side: `Upper/LowerRadialFace0..5Left/Right`
  - Opposite radial directions (`0/3`, `1/4`, `2/5`) form three complete center planes
  - `SetDirectedHalf(0..5)` retains one symmetrical half-shell and automatically exposes its complete center plane while preserving independent left/right side visibility
- **Face controls**:
  - Independent visibility, texture, and texture repetition for all 49 public logical face slots
  - Optional master texture override with continuous cylindrical wrapping across the exterior shell
  - `RadialFaceMask` six-bit property (`0` to `63`)
  - Runtime actions for individual radial directions and the complete mask
  - Directed-half property, action, condition, and expression without geometry-state swapping
- **GDevelop integration**:
  - The procedural mesh is attached to the owning `CustomRuntimeObject3D` renderer, so GDevelop remains responsible for world position, scale, rotation, and visibility
  - Both procedural objects are childless; no internal `Cube3DObject` placeholder can appear as a cube or compete with the generated mesh
  - Runtime initialization seeds the custom-object bounds/hitbox before preview sizing, so placed instances retain their editor position instead of falling back to the origin
  - The scene editor uses the standard procedural custom-object bounds; the complete textured mesh is generated when the preview starts

---

## 💎 Native Texture Architecture (Matching 3D Cube)

| Feature | GDevelop 3D Cube | HexBipyramid3D |
| :--- | :--- | :--- |
| **Material Pipeline** | `imageManager.getThreeMaterial(resourceName, options)` | `imageManager.getThreeMaterial(resourceName, options)` |
| **Default Texture** | Automatically displays GDevelop's default purple/grid placeholder | Automatically displays GDevelop's default purple/grid placeholder |
| **Face Texturing** | Dedicated Image Resource picker per face | Dedicated Image Resource picker per face + bulk fallbacks |
| **Texture Repeat / Tiling** | `repeatTextureOnFace` + `tileScale` | `repeatTextureOnFace` + `tileScale` + dynamic UV scaling |
| **Color Tinting** | Multiplied with vertex color buffer | Multiplied with vertex color buffer |
| **Material Models** | `StandardWithoutMetalness` (PBR) & `Basic` (unlit) | `StandardWithoutMetalness` (PBR) & `Basic` (unlit) |

---

## ⚡ Event Sheet Actions & Conditions

- **`SetFaceTexture(FaceName, TextureResource)`**: Dynamically assign or swap face textures at runtime.
- **`SetFaceVisibility(FaceName, Visible)`**: Toggle visibility of any individual face.
- **`SetRepeatTextureOnFace(FaceName, Repeat)`**: Enable or disable texture tiling on any face.
- **`SetTileScale(Scale)`**: Adjust texture repeat scale factor.
- **`SetBlockState(State)`**: Slicing state (`Full`, `Bottom Half`, `Top Half`).
- **`SnapToHexGrid(EquatorRadius)`**: Snap block to seamless gapless honeycomb grid.
