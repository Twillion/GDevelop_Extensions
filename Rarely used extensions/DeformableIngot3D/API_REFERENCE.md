# DeformableIngot3D — API Reference & Specification

Complete reference of Object Properties, Actions, Conditions, and Expressions for **DeformableIngot3D**.

---

## 1. Object Properties

| Property | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| **`SubdivisionsX`** | Number | `16` | Initial grid resolution along width (X-axis). |
| **`SubdivisionsY`** | Number | `8` | Initial grid resolution along depth (Y-axis). |
| **`SubdivisionsZ`** | Number | `8` | Initial grid resolution along thickness/height (Z-axis). |
| **`Tint`** | Color | `200;200;210` | Base RGB color tint of the ingot metal. |
| **`Metalness`** | Number | `0.85` | PBR metalness value ($0.0 - 1.0$). |
| **`Roughness`** | Number | `0.35` | PBR surface roughness ($0.0 - 1.0$). |
| **`EnableThermal`** | Boolean | `true` | Enables temperature tracking and forging heat simulation. |
| **`InitialTemperature`** | Number | `20.0` | Ambient temperature in degrees Celsius ($^\circ\text{C}$). |
| **`AmbientTemperature`** | Number | `20.0` | Passive cooling target. |
| **`HeatDiffusion`** | Number | `1.5` | Local heat equalization rate. |
| **`AirCooling`** | Number | `0.08` | Passive cooling coefficient. |
| **`ForgingTemperature`** | Number | `650` | Minimum temperature for plastic deformation. |
| **`IdealForgingTemperature`** | Number | `950` | Temperature for full plasticity. |
| **`AnvilEnabled`** | Boolean | `true` | Enables the local anvil-plane constraint. |
| **`AnvilLocalZ`** | Number | `-0.5` | Normalized local anvil-plane height. |

---

## 2. Actions

### Camera & Raycast Vertex Detection
* **`Deform mesh at screen pointer (ScreenX, ScreenY, Layer, BrushType, Radius, Strength, Falloff)`**:
  Casts a ray from camera through viewport coordinates `(ScreenX, ScreenY)` to detect intersection on the mesh surface and applies the chosen deformation (`"Push"`, `"Pull"`, `"HammerBlow"`, `"Smooth"`, `"Flatten"`).
* **`Deform mesh along 3D ray (OriginX, OriginY, OriginZ, DirX, DirY, DirZ, BrushType, Radius, Strength, Falloff)`**:
  Casts a 3D ray from world origin/direction to intersect the mesh and deform vertices.
* **`Cast ray from screen pointer (ScreenX, ScreenY, Layer)`**:
  Performs camera raycasting against the mesh and caches hit coordinates without immediately modifying vertices.

### Remeshing & Reset
* **`Remesh mesh with subdivisions (SubX, SubY, SubZ, Preserve)`**:
  Dynamically re-tessellates the geometry at runtime. When `Preserve` is true, existing surface displacements are mapped onto the new geometry.
* **`Reset mesh deformation`**:
  Restores the pristine un-deformed base shape.
* **`Smooth mesh region (CenterX, CenterY, CenterZ, Radius, Strength, Iterations)`**:
  Applies localized Laplacian relaxation to smooth out surface wrinkles or creases.

### Thermal Blacksmithing
* **`Heat mesh region in forge (CenterX, CenterY, CenterZ, Radius, HeatRate, MaxTemp)`**:
  Increases metal temperature in degrees Celsius per second.
* **`Quench mesh in water trough (CoolRate)`**:
  Cools hot metal in water.
* **`Advance heat simulation (DeltaSeconds)`**: Diffuses heat and applies frame-independent air cooling.

### Forging, fracture, and assembly
* **`Forge from camera center (OffsetX, OffsetY, Layer, FaceRadius, ImpactVelocity)`**: Raycasts from the camera center plus a pixel offset and applies a temperature-aware strike.
* **`Break mesh along plane (NormalX, NormalY, NormalZ, PlaneOffset)`**: Partitions triangles and creates a second uncapped render fragment.
* **`Combine part into tool or prop (Part, LocalPosition, LocalRotation)`**: Parents another 3D object's renderer to the workpiece.
* **`Tween assembled prop pose (...)`** and **`Advance assembled prop tween (DeltaSeconds)`**: Run a mathematical transform animation without an authored clip.

---

## 3. Conditions

* **`Has raycast hit`**: True if the last raycast intersected this mesh.
* **`Is mesh deformed`**: True if the mesh vertices have been modified from their initial un-deformed state.
* **`Is prop pose tweening`**: True while a mathematical pose tween is active.

---

## 4. Expressions

* **`DeformableIngot3D::RaycastHitX()`**: World X coordinate of last raycast intersection.
* **`DeformableIngot3D::RaycastHitY()`**: World Y coordinate of last raycast intersection.
* **`DeformableIngot3D::RaycastHitZ()`**: World Z coordinate of last raycast intersection.
* **`DeformableIngot3D::RaycastHitNormalX()`**: Surface normal X at the raycast contact point.
* **`DeformableIngot3D::RaycastHitNormalY()`**: Surface normal Y at the raycast contact point.
* **`DeformableIngot3D::RaycastHitNormalZ()`**: Surface normal Z at the raycast contact point.
* **`DeformableIngot3D::RaycastHitDistance()`**: Distance from camera/ray origin to hit point.
* **`DeformableIngot3D::VertexCount()`**: Total vertex count of the procedural geometry.
* **`DeformableIngot3D::TriangleCount()`**: Total triangle count of the procedural geometry.
* **`DeformableIngot3D::SubdivisionsX()`**: Current subdivision count along X.
* **`DeformableIngot3D::SubdivisionsY()`**: Current subdivision count along Y.
* **`DeformableIngot3D::SubdivisionsZ()`**: Current subdivision count along Z.
* **`DeformableIngot3D::AverageTemperature()`**: Current temperature in degrees Celsius.
* **`LastStrikeEfficiency()`**, **`LastStrikeAffectedVertices()`**: Feedback from the latest temperature-aware strike.
* **`FragmentCount()`**, **`AssembledPartCount()`**: Fracture and tool-assembly state.
* **`ShapeLength()`**, **`ShapeWidth()`**, **`ShapeThickness()`**: Current world-space workpiece extents.
