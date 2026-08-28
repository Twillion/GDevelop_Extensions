# AutoMeshLOD3D — Automated Single-Mesh Simplification LOD for GDevelop

**AutoMeshLOD3D** is an automated Level of Detail (LOD) extension for **GDevelop 5 (WebGL2 / Three.js backend)**. 

Instead of requiring 3D artists and game developers to manually create, decimate, and export multiple `.glb` models in Blender, **AutoMeshLOD3D takes a single 3D model and automatically generates optimized lower-polygon index buffers in the background at runtime.**

---

## Key Highlights

- **1 Single Model In $\rightarrow$ Multi-Tier LOD Out:** No manual decimation in external 3D software required.
- **Shared Vertex Memory:** All LOD levels share the original vertex positions, UV texture coordinates, normals, and skeletal bone weights—saving up to 70% VRAM compared to traditional multi-mesh LOD.
- **Asynchronous Web Worker Processing:** Mesh simplification algorithms (Quadric Error Metric / QEM Edge Collapse) run in background worker threads with **zero 60 FPS frame drops** during scene loading.
- **Skeletal Animation Preservation:** Decimates animated characters without breaking skin weights or bone bindings.
- **Unified Throttling:** Automatically couples geometry decimation with shadow cutoff and distant skeletal animation tick throttling.
- **Sniper & FOV-Proof:** Supports projected screen-pixel coverage evaluation so zoomed-in models never look low-poly.

---

## Quick Start Guide

1. **Add the Behavior:** In GDevelop, add the **`AutoMeshLOD3D`** behavior to your 3D Model object (`Model3D`).
2. **Configure Distance & Reduction:**
   - **LOD 1 Distance:** `25.0` meters $\rightarrow$ **Reduction:** `50%` *(Renders half the triangles)*
   - **LOD 2 Distance:** `60.0` meters $\rightarrow$ **Reduction:** `80%` *(Renders 20% of original triangles)*
   - **Shadow Cutoff:** `40.0` meters *(Disables real-time shadow casting beyond 40m)*
3. **Play:** As the camera moves away, the mesh automatically swaps to lower triangle counts with zero asset authoring overhead!

---

## Documentation Index

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Technical blueprint, QEM edge collapse algorithms, Web Worker pipeline, index buffer swapping, and verification plan.
- [API_REFERENCE.md](./API_REFERENCE.md) — Complete specification of Properties, Actions, Conditions, Expressions (ACEs), and Web Worker messaging protocol.
