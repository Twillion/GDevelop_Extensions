# AutoMeshLOD3D — Automated Single-Mesh Simplification & HLOD Cluster Generator for GDevelop

**AutoMeshLOD3D** is an automated Level of Detail (LOD) and Hierarchical Proxy generation engine for **GDevelop 5 (WebGL2 / Three.js backend)**.

---

## 🌟 Key Highlights

- **1 Single Model In $\rightarrow$ Multi-Tier LOD Out:** No manual decimation in external 3D software required.
- **Shared Vertex Memory:** All LOD levels share the original vertex positions, UV coordinates, normals, and skeletal bone weights—saving up to 70% VRAM compared to traditional multi-mesh LOD.
- **Asynchronous Web Worker Processing:** QEM edge collapse algorithms run in background worker threads with **zero 60 FPS frame drops**.
- **Dual Role (Standalone & HLOD Pipeline):**
  1. **Standalone Extension:** Attach to any individual 3D model (e.g. dynamic monster, vehicle, hero) for automatic runtime single-mesh LOD swapping.
  2. **HLOD Cluster Generator for `WorldPartition3D`:** Bakes entire multi-mesh static prop clusters into single low-poly proxy meshes with unified texture atlases for distant world partition sectors.

---

## 📚 Documentation

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Technical blueprint, QEM edge collapse, Web Worker pipeline, and HLOD cluster baking.
- [API_REFERENCE.md](./API_REFERENCE.md) — Properties, Actions, Conditions, Expressions (ACEs).
