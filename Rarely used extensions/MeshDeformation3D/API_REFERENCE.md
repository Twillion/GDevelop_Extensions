# MeshDeformation3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), Brush types, and Quality Grading metrics for **MeshDeformation3D**.

---

## 1. `MeshDeformation3D` Behavior Properties

### Group 1: Mode & Core Settings
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`DeformationMode`** | Choice | `"Blacksmithing"` | Active domain mode: `"Blacksmithing"`, `"ClaySculpting"`, `"StoneChiseling"`, `"VehicleDamage"`, or `"General"`. |
| **`EnableUndoRedo`** | Boolean | `true` | Maintains historical vertex delta snapshots for undo/redo actions. |
| **`MaxUndoSteps`** | Number | `20` | Maximum number of reversible strokes stored in memory. |

### Group 2: Thermal & Malleability Simulation
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableThermalSimulation`**| Boolean | `true` | Enables real-time heat conduction, air cooling, and blackbody glowing shaders. |
| **`InitialTemperature`** | Number | `20.0` | Ambient starting temperature in degrees Celsius ($^\circ\text{C}$). |
| **`AirCoolingRate`** | Number | `12.0` | Natural heat dissipation into air ($^\circ\text{C} / \text{sec}$). |
| **`ThermalConductivity`** | Number | `0.45` | Speed of heat diffusion between neighboring vertices. |
| **`MalleabilityMinTemp`**| Number | `600.0` | Temperature ($^\circ\text{C}$) where metal begins to soften. |
| **`MalleabilityMaxTemp`**| Number | `1050.0` | Temperature ($^\circ\text{C}$) of peak plasticity (bright yellow heat). |

### Group 3: Plasticity & Volume Flow
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`CompressionFactor`** | Number | `1.0` | Depth displacement multiplier along hammer strike normal ($k_{\text{compress}}$). |
| **`LateralSpreadFactor`**| Number | `0.5` | Outward radial displacement multiplier ($k_{\text{spread}} = 0.5 \times k_{\text{compress}}$ for strict volume conservation). |

---

## 2. Actions

### General Brush & Sculpting Actions
* **`Apply brush deformation on _PARAM0_ (Type: _PARAM1_, Center: X:_PARAM2_, Y:_PARAM3_, Z:_PARAM4_, Direction: X:_PARAM5_, Y:_PARAM6_, Z:_PARAM7_, Force: _PARAM8_, Radius: _PARAM9_, Falloff: _PARAM10_)`**: Universal sculpt stroke (`"Push"`, `"Pull"`, `"Pinch"`, `"Inflate"`, `"Deflate"`, `"Flatten"`).
* **`Smooth mesh region on _PARAM0_ (Center: X:_PARAM1_, Y:_PARAM2_, Z:_PARAM3_, Radius: _PARAM4_, Strength: _PARAM5_, Iterations: _PARAM6_)`**: Applies Laplacian smoothing to eliminate surface wrinkles or harsh facets.
* **`Undo last deformation on _PARAM0_`**: Reverts the most recent stroke.
* **`Redo deformation on _PARAM0_`**: Re-applies an undone stroke.
* **`Reset mesh to original un-deformed shape on _PARAM0_`**: Restores the pristine source model geometry.

### Blacksmithing & Thermal Actions
* **`Apply hammer blow on _PARAM0_ (HitX:_PARAM1_, HitY:_PARAM2_, HitZ:_PARAM3_, DirX:_PARAM4_, DirY:_PARAM5_, DirZ:_PARAM6_, Force:_PARAM7_, Radius:_PARAM8_)`**: Plastic volume-preserving hammer strike.
* **`Heat mesh region on _PARAM0_ (CenterX:_PARAM1_, CenterY:_PARAM2_, CenterZ:_PARAM3_, Radius:_PARAM4_, HeatRate:_PARAM5_, MaxTemp:_PARAM6_)`**: Heats metal in forge fire ($^\circ\text{C}/\text{sec}$).
* **`Quench entire mesh in water on _PARAM0_ (CoolRate:_PARAM1_)`**: Instantly cools and hardens hot metal in water trough.
* **`Set temperature at vertex region on _PARAM0_ (CenterX:_PARAM1_, CenterY:_PARAM2_, CenterZ:_PARAM3_, Radius:_PARAM4_, Temp:_PARAM5_)`**: Directly overrides local temperature.

### Chiseling & Sharpening Actions
* **`Chisel stone cut on _PARAM0_ (PlaneOriginX:_PARAM1_, PlaneOriginY:_PARAM2_, PlaneOriginZ:_PARAM3_, PlaneNormalX:_PARAM4_, PlaneNormalY:_PARAM5_, PlaneNormalZ:_PARAM6_, Depth:_PARAM7_, Radius:_PARAM8_)`**: Planar subtractive stone carving.
* **`Apply grindstone sharpening on _PARAM0_ (ContactX:_PARAM1_, ContactY:_PARAM2_, ContactZ:_PARAM3_, BevelAngle:_PARAM4_, PolishStrength:_PARAM5_, Radius:_PARAM6_)`**: Edge beveling and specular mirror polish painting.

### Blueprint Quality Grading
* **`Evaluate blueprint shape against target model on _PARAM0_ (BlueprintModelResource:_PARAM1_, Tolerance:_PARAM2_)`**: Compares deformed model against a ghost blueprint template.

---

## 3. Conditions

* **`Is mesh heated to forging temperature on _PARAM0_`**: True if average temperature $> 750^\circ\text{C}$ (malleable).
* **`Is mesh cold / hardened on _PARAM0_`**: True if temperature $< 400^\circ\text{C}$ (stiff/quenched).
* **`Is blueprint score greater than _PARAM1_ percent on _PARAM0_`**: Checks if overall quality score exceeds threshold ($0 - 100\%$).
* **`Can undo deformation on _PARAM0_`**: True if undo history is available.
* **`Can redo deformation on _PARAM0_`**: True if redo history is available.

---

## 4. Expressions

### Temperature & Physical State
* **`Object.MeshDeformation3D::AverageTemperature()`**: Average temperature of all vertices in $^\circ\text{C}$.
* **`Object.MeshDeformation3D::MaxTemperature()`**: Peak temperature of hottest vertex.
* **`Object.MeshDeformation3D::TemperatureAt(x, y, z)`**: Live temperature at specified 3D world coordinates.
* **`Object.MeshDeformation3D::MalleabilityAt(x, y, z)`**: Plasticity factor ($0.0 = \text{stiff}$, $1.0 = \text{fully malleable}$).

### Quality & Blueprint Grading
* **`Object.MeshDeformation3D::QualityScore()`**: Overall Masterwork score ($0.0 - 100.0\%$).
* **`Object.MeshDeformation3D::SymmetryScore()`**: Bilateral symmetry match ($0.0 - 100.0\%$).
* **`Object.MeshDeformation3D::ShapeDeviationScore()`**: Profile silhouette accuracy ($0.0 - 100.0\%$).
* **`Object.MeshDeformation3D::SharpnessScore()`**: Edge bevel definition score.

### History & Stats
* **`Object.MeshDeformation3D::UndoCount()`**: Available undo steps.
* **`Object.MeshDeformation3D::TotalVertexCount()`**: Number of deforming vertices in geometry.

---

## 5. Brush & Falloff Reference Tables

### Brush Modes
| Brush Type | Action on Surface | Ideal Use Case |
| :--- | :--- | :--- |
| **`"PlasticHammer"`** | Normal compression + lateral outward squish | Blacksmithing, sword shaping, metal flowing. |
| **`"Push"`** | Pushes vertices inward along hit normal | Dents, bullet impacts, stone depressions. |
| **`"Pull"`** | Pulls vertices outward along hit normal | Clay extrusions, horn sculpting, pulling blades. |
| **`"Pinch"`** | Draws nearby vertices inward toward tool center | Blade ridges, sharp creases, sculpture lips/eyes. |
| **`"Inflate"`** | Expands vertices outward along their local vertex normals | Muscle definition, bulging metal, clay fattening. |
| **`"Flatten"`** | Projects vertices onto average tool contact plane | Anvil flattening, sword bevels, faceted stone. |
| **`"Smooth"`** | Weighted Laplacian neighbor averaging | Removing roughness, organic clay blending. |

### Falloff Kernels
| Falloff Name | Curve Formula | Profile Shape |
| :--- | :--- | :--- |
| **`"Gaussian"`** | $w(u) = e^{-u^2 / (2\sigma^2)}$ | Natural soft dome (default). |
| **`"Smoothstep"`** | $w(u) = (1-u)^2(1+2u)$ | Ultra-smooth organic bell curve with zero boundary derivative. |
| **`"Sharp"`** | $w(u) = (1-u)^3$ | High-peaked cone for sharp pinches and spikes. |
| **`"Linear"`** | $w(u) = 1 - u$ | Rigid cone shape. |
| **`"Constant"`** | $w(u) = 1.0$ | Hard cylindrical stamp. |
