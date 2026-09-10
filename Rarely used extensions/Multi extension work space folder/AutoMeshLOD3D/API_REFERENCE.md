# AutoMeshLOD3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, and Expressions (ACEs) for **AutoMeshLOD3D**.

---

## 1. `AutoMeshLOD3D` Behavior Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LOD1Distance`** | Number | `25.0` | Distance in meters where model swaps to LOD1. |
| **`LOD1Reduction`**| Number | `50.0` | Triangle reduction percentage for LOD1 ($10 - 90\%$). |
| **`LOD2Distance`** | Number | `60.0` | Distance in meters where model swaps to LOD2. |
| **`LOD2Reduction`**| Number | `80.0` | Triangle reduction percentage for LOD2 ($10 - 95\%$). |
| **`ShadowCutoff`** | Number | `40.0` | Distance in meters beyond which shadow casting is disabled. |

---

## 2. Actions

* **`Set LOD distance on _PARAM0_ (Level: _PARAM1_, Distance: _PARAM2_)`**: Adjusts LOD transition radius.
* **`Force LOD level on _PARAM0_ to _PARAM1_`**: Manually overrides active LOD tier (`-1` = Auto, `0` = Full, `1` = LOD1, `2` = LOD2).
* **`Bake HLOD cluster from object group _PARAM1_ into proxy _PARAM2_`**: Bakes sector props into a unified HLOD mesh.

---

## 3. Conditions

* **`Is LOD level active on _PARAM0_ (Level: _PARAM1_)`**: True if mesh is currently rendering at specified LOD level.
* **`Is background decimation complete on _PARAM0_`**: True when Web Worker has finished generating index buffers.

---

## 4. Expressions

* **`Object.AutoMeshLOD3D::CurrentLODLevel()`**: Returns active LOD index ($0$, $1$, or $2$).
* **`Object.AutoMeshLOD3D::CurrentTriangleCount()`**: Returns live rendered triangle count.
* **`Object.AutoMeshLOD3D::OriginalTriangleCount()`**: Returns un-decimated baseline triangle count.
