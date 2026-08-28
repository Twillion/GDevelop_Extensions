# AutoMeshLOD3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), Global Managers, and Web Worker messaging protocols for **AutoMeshLOD3D**.

---

## 1. `AutoMeshLOD3D` Behavior

*Attach this behavior to any 3D object (e.g. `Model3DRuntimeObject`) to enable automated geometry decimation, shadow culling, and animation throttling.*

### Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LOD1Distance`** | Number | `25.0` | Camera distance (in meters) to trigger Level 1 simplification. |
| **`LOD1Ratio`** | Number | `0.5` | Target triangle ratio for LOD 1 ($0.5 = 50\%$ of original triangles). |
| **`LOD2Distance`** | Number | `60.0` | Camera distance (in meters) to trigger Level 2 simplification. |
| **`LOD2Ratio`** | Number | `0.2` | Target triangle ratio for LOD 2 ($0.2 = 20\%$ of original triangles). |
| **`ShadowCutoffDistance`** | Number | `40.0` | Distance beyond which real-time shadow casting (`castShadow`) is disabled. |
| **`EvaluationMode`** | Choice | `Distance` | `Distance` (Linear Euclidean distance) or `ScreenCoverage` (Projected screen pixel diameter). |
| **`ThrottleAnimation`** | Boolean | `true` | Throttle skeletal rig matrix updates for distant animated models. |
| **`PreserveSeams`** | Boolean | `true` | Strictly preserve UV and material seam boundaries during edge collapse. |
| **`DebugLogs`** | Boolean | `true` | Log real-time LOD tier transitions, face counts, and decimation benchmarks to the developer console. |

---

### Actions

* **`Set LOD 1 distance on _PARAM0_ to _PARAM1_`**: Dynamically change the distance threshold for Level 1 simplification.
* **`Set LOD 2 distance on _PARAM0_ to _PARAM1_`**: Dynamically change the distance threshold for Level 2 simplification.
* **`Set shadow cutoff distance on _PARAM0_ to _PARAM1_`**: Dynamically adjust the shadow cutoff range.
* **`Force LOD Level on _PARAM0_ to _PARAM1_`**: Manually lock the mesh to a specific LOD tier (`0` = Full, `1` = Med, `2` = Low, `-1` = Auto/Dynamic).
* **`Enable / Disable AutoMeshLOD on _PARAM0_`**: Toggle dynamic LOD evaluation on this instance.
* **`Enable debug console logging on _PARAM0_`**: Toggle real-time LOD transition and face count console logging.

---

### Conditions

* **`Current LOD level of _PARAM0_ is _PARAM1_`**: Checks if the object is currently rendering at LOD 0, 1, or 2.
* **`Is mesh decimation ready on _PARAM0_`**: Returns true if the background worker has finished computing the simplified index buffers.
* **`Is casting shadow on _PARAM0_`**: Returns true if the object is currently within shadow casting range.
* **`Is debug logging enabled on _PARAM0_`**: Returns true if debug console logs are active for this instance.

---

### Expressions

* **`Object.AutoMeshLOD3D::CurrentLOD()`**: Returns the active integer LOD level ($0, 1, \text{or } 2$).
* **`Object.AutoMeshLOD3D::ActiveTriangleCount()`**: Returns the exact number of triangles currently being rendered for this instance.
* **`Object.AutoMeshLOD3D::OriginalTriangleCount()`**: Returns the base high-poly triangle count.
* **`Object.AutoMeshLOD3D::CameraDistance()`**: Returns current Euclidean distance from the active 3D camera.

---

## 2. Global Actions & Expressions

### Actions
* **`AutoMeshLOD3D::SetGlobalLODBias(Number bias)`**: Multiplies all LOD distances across the scene by a global bias (e.g. `1.5` for high-end PCs, `0.7` for mobile performance mode).
* **`AutoMeshLOD3D::PrecomputeLOD(Object object)`**: Immediately submits the object geometry to the worker queue at level start.
* **`AutoMeshLOD3D::ClearLODCache()`**: Clears the in-memory shared index buffer cache to free RAM.

### Expressions
* **`AutoMeshLOD3D::GetPendingJobCount()`**: Returns the number of mesh decimation tasks currently queued in the background worker pool.
* **`AutoMeshLOD3D::GetTotalTrianglesSaved()`**: Returns the real-time sum of triangles saved across all active `AutoMeshLOD3D` instances in the scene.

---

## 3. Web Worker Messaging Protocol

### Input Message (Main Thread $\rightarrow$ Worker):
```javascript
{
  type: "DECIMATE_REQUEST",
  jobId: 1042,
  ratios: [0.5, 0.2], // Target reduction ratios for LOD1 and LOD2
  preserveSeams: true,
  geometry: {
    positions: Float32Array, // Transferred
    indices: Uint32Array,    // Transferred
    uvs: Float32Array,        // Transferred
    skinIndices: Float32Array,// Optional
    skinWeights: Float32Array // Optional
  }
}
```

### Output Message (Worker $\rightarrow$ Main Thread):
```javascript
{
  type: "DECIMATE_COMPLETE",
  jobId: 1042,
  executionTimeMs: 8.4,
  lodIndices: {
    1: Uint32Array, // 50% Decimated Index Buffer (Transferred)
    2: Uint32Array  // 20% Decimated Index Buffer (Transferred)
  }
}
```
