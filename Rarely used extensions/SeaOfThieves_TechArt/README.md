# The Technical Art of Sea of Thieves

**Speaker:** Rare Ltd. (Technical Art & Rendering Engineering Teams)  
**Event:** Unreal Engine Showcase / GDC  
**Video URL:** [YouTube: The Technical Art of Sea of Thieves](https://www.youtube.com/watch?v=y9BOz2dFZzs)  
**Duration:** 41 minutes, 11 seconds (2,471 seconds)  
**Extracted Assets:** 201 Sampled 720p Frames + Complete Timecoded Transcript  

---

## Quick Links

- [📄 Full Timecoded Transcript (TRANSCRIPT.md)](TRANSCRIPT.md)
- [🔬 Academic Sources, Math & Shader Deep Dive (DEEP_DIVE_SOURCES.md)](DEEP_DIVE_SOURCES.md)
- [🌊 Open-Source Ocean Recreations & Repositories (OPEN_SOURCE_OCEAN_RECREATIONS.md)](OPEN_SOURCE_OCEAN_RECREATIONS.md)
- [🖼️ Frames Directory (201 Images)](frames/)
- [📋 Frames Index Data (frames_index.json)](frames_index.json)

---

## Executive Technical Summary

In *The Technical Art of Sea of Thieves*, Rare details how they tackled the unique challenge of combining **stylized, painterly art direction** with **physically based real-time simulation** in Unreal Engine 4 for a shared-world sandbox game.

### Key Technical Pillars

1. **The Ocean System**:
   - **FFT vs. Gerstner Waves:** Evaluated Tessendorf FFT ocean methods against analytical Gerstner wave sums. Kept realistic base motion while strictly stylizing foam and wave crests to avoid high-frequency visual noise.
   - **CPU-GPU Deterministic Buoyancy:** Synchronized wave displacement between GPU vertex shaders and CPU physics calculations so floating ships, cannonballs, and swimming players react with deterministic accuracy across networked clients.
   - **Advanced Water Shading:** Exaggerated Subsurface Scattering (SSS) beyond physical realism to give tropical translucency; used Jacobian determinism for wave folding and crest foam generation.

2. **Volumetric Stylized Clouds**:
   - **Sculpted Mesh Proxy:** Artists hand-sculpted low-poly cloud meshes to retain distinctive painterly shapes rather than pure procedural noise spheres.
   - **Lightweight Render Pipeline:** Forward-rendered low-poly cloud meshes with vertex lighting into an off-screen render target.
   - **Depth-Aware Gaussian Blur:** Downsampled cloud buffer to quarter resolution and filtered it using a single-pass compute shader Gaussian blur where standard deviation scales with depth, converting hard polygon edges into soft, voluminous clouds cheaply.
   - **Lighting & Scattering:** Simplified dual-channel lighting (Sunlight in Red, Ambient/Sky in Green) with customized Beer-Lambert extinction and powder/forward scattering approximations.

3. **Ship Ropes & Rigging**:
   - Used fast **Verlet integration** for hundreds of dynamic ship ropes, sail lines, and pulleys instead of heavy PhysX constraints.
   - Procedural spline mesh generation with dynamic LOD scaling based on camera distance and screen-space size.

4. **The Kraken (Tentacles)**:
   - Addressed the severe CPU cost of running complex inverse kinematics / animation graphs for multiple multi-segmented tentacles wrapping tightly around ship hulls.
   - Adapted Pixar's *Finding Dory* (Hank the Octopus) FEM simulation pipeline: pre-baked soft-tissue finite element deformations and animations in **Houdini**.
   - Exported directly to **Vertex Animation Textures (VAT)**, driving intricate non-penetrating tentacle wraps 100% on the GPU with zero CPU overhead.

5. **Procedural Lightning & Atmospheric Effects**:
   - Procedural branching algorithm generating dynamic lightning bolts.
   - Integrated screen-space and volumetric sky flashing synchronized with audio and ocean surface reflections.

---

## Chapter Breakdown & Visual Gallery

### 1. Introduction & Art Direction (00:00 - 03:31)

Rare introduces the game's sandbox nature, the tech art team's dual responsibilities (tools/pipeline vs engine/shaders), and the core art direction pillars: illustrative style, timeless aesthetic, and deliberate avoidance of high-frequency noise.

**Frame #1 — [00:00]**  
![frame_001_00m00s_Introduction__Overvi.jpg](frames/frame_001_00m00s_Introduction__Overvi.jpg)

**Frame #5 — [01:00]**  
![frame_005_01m00s_Introduction__Overvi.jpg](frames/frame_005_01m00s_Introduction__Overvi.jpg)

**Frame #15 — [01:40]**  
![frame_015_01m40s_Introduction__Overvi.jpg](frames/frame_015_01m40s_Introduction__Overvi.jpg)

**Frame #22 — [02:08]**  
![frame_022_02m08s_Introduction__Overvi.jpg](frames/frame_022_02m08s_Introduction__Overvi.jpg)

**Frame #24 — [02:47]**  
![frame_024_02m47s_Art_Direction.jpg](frames/frame_024_02m47s_Art_Direction.jpg)

**Frame #25 — [02:51]**  
![frame_025_02m51s_Art_Direction.jpg](frames/frame_025_02m51s_Art_Direction.jpg)

**Frame #26 — [03:26]**  
![frame_026_03m26s_Art_Direction.jpg](frames/frame_026_03m26s_Art_Direction.jpg)

### 2. Unreal Engine 4 Architecture & Shading Pipeline (03:31 - 05:22)

Overview of Rare's custom HLSL nodes, shader compiler workflows, and development pipeline inside Unreal Engine 4.

**Frame #27 — [03:31]**  
![frame_027_03m31s_Engine__Tooling.jpg](frames/frame_027_03m31s_Engine__Tooling.jpg)

**Frame #29 — [04:41]**  
![frame_029_04m41s_Engine__Tooling.jpg](frames/frame_029_04m41s_Engine__Tooling.jpg)

**Frame #31 — [04:53]**  
![frame_031_04m53s_Engine__Tooling.jpg](frames/frame_031_04m53s_Engine__Tooling.jpg)

### 3. Ocean: Visual Exploration & Shading (05:22 - 08:26)

The journey from raw Tessendorf FFT water simulations to the signature painterly Sea of Thieves ocean. Covers subsurface scattering, artistic water coloration, refraction, and stylized foam masks.

**Frame #32 — [05:28]**  
![frame_032_05m28s_Ocean_Exploration__V.jpg](frames/frame_032_05m28s_Ocean_Exploration__V.jpg)

**Frame #34 — [06:38]**  
![frame_034_06m38s_Ocean_Exploration__V.jpg](frames/frame_034_06m38s_Ocean_Exploration__V.jpg)

**Frame #38 — [07:27]**  
![frame_038_07m27s_Ocean_Exploration__V.jpg](frames/frame_038_07m27s_Ocean_Exploration__V.jpg)

**Frame #43 — [08:10]**  
![frame_043_08m10s_Ocean_Exploration__V.jpg](frames/frame_043_08m10s_Ocean_Exploration__V.jpg)

### 4. Ocean: Performance, Buoyancy & Simulation (08:26 - 14:51)

Deep dive into water vertex displacement, Jacobian wave sharpness, and the deterministic CPU-GPU buoyancy calculation that powers multiplayer ship physics.

**Frame #46 — [08:26]**  
![frame_046_08m26s_Ocean_Performance__S.jpg](frames/frame_046_08m26s_Ocean_Performance__S.jpg)

**Frame #51 — [10:04]**  
![frame_051_10m04s_Ocean_Performance__S.jpg](frames/frame_051_10m04s_Ocean_Performance__S.jpg)

**Frame #58 — [11:14]**  
![frame_058_11m14s_Ocean_Performance__S.jpg](frames/frame_058_11m14s_Ocean_Performance__S.jpg)

**Frame #64 — [12:40]**  
![frame_064_12m40s_Ocean_Performance__S.jpg](frames/frame_064_12m40s_Ocean_Performance__S.jpg)

**Frame #72 — [13:53]**  
![frame_072_13m53s_Ocean_Performance__S.jpg](frames/frame_072_13m53s_Ocean_Performance__S.jpg)

**Frame #80 — [14:40]**  
![frame_080_14m40s_Ocean_Performance__S.jpg](frames/frame_080_14m40s_Ocean_Performance__S.jpg)

### 5. Volumetric Clouds: Concept & Iteration (14:51 - 17:12)

Early experiments with cloud generation, moving away from pure raymarched volumetric noise towards artist-sculpted proxy shapes.

**Frame #82 — [14:51]**  
![frame_082_14m51s_Clouds_Concept.jpg](frames/frame_082_14m51s_Clouds_Concept.jpg)

**Frame #83 — [14:57]**  
![frame_083_14m57s_Clouds_Concept.jpg](frames/frame_083_14m57s_Clouds_Concept.jpg)

**Frame #84 — [15:18]**  
![frame_084_15m18s_Clouds_Concept.jpg](frames/frame_084_15m18s_Clouds_Concept.jpg)

**Frame #85 — [15:53]**  
![frame_085_15m53s_Clouds_Iteration.jpg](frames/frame_085_15m53s_Clouds_Iteration.jpg)

**Frame #87 — [16:36]**  
![frame_087_16m36s_Clouds_Iteration.jpg](frames/frame_087_16m36s_Clouds_Iteration.jpg)

**Frame #88 — [16:40]**  
![frame_088_16m40s_Clouds_Iteration.jpg](frames/frame_088_16m40s_Clouds_Iteration.jpg)

### 6. Volumetric Clouds: Rendering Architecture (17:12 - 25:12)

The complete technical breakdown of the cloud rendering pipeline: forward vertex-lit proxy meshes, quarter-resolution off-screen buffer, depth-dependent compute Gaussian blur, G-buffer packing, and lighting integration.

**Frame #89 — [17:12]**  
![frame_089_17m12s_Clouds_Rendering.jpg](frames/frame_089_17m12s_Clouds_Rendering.jpg)

**Frame #95 — [19:27]**  
![frame_095_19m27s_Clouds_Rendering.jpg](frames/frame_095_19m27s_Clouds_Rendering.jpg)

**Frame #102 — [20:06]**  
![frame_102_20m06s_Clouds_Rendering.jpg](frames/frame_102_20m06s_Clouds_Rendering.jpg)

**Frame #110 — [21:38]**  
![frame_110_21m38s_Clouds_Rendering.jpg](frames/frame_110_21m38s_Clouds_Rendering.jpg)

**Frame #117 — [22:52]**  
![frame_117_22m52s_Clouds_Rendering.jpg](frames/frame_117_22m52s_Clouds_Rendering.jpg)

**Frame #126 — [23:33]**  
![frame_126_23m33s_Clouds_Rendering.jpg](frames/frame_126_23m33s_Clouds_Rendering.jpg)

**Frame #134 — [24:54]**  
![frame_134_24m54s_Clouds_Rendering.jpg](frames/frame_134_24m54s_Clouds_Rendering.jpg)

### 7. Volumetric Clouds: Limitations & Optimizations (25:12 - 31:07)

Solving edge bleed, camera intersection clipping, temporal artifacts, and fitting the cloud rendering budget into the strict frame time.

**Frame #137 — [25:15]**  
![frame_137_25m15s_Clouds_Limitations__.jpg](frames/frame_137_25m15s_Clouds_Limitations__.jpg)

**Frame #140 — [26:18]**  
![frame_140_26m18s_Clouds_Limitations__.jpg](frames/frame_140_26m18s_Clouds_Limitations__.jpg)

**Frame #144 — [28:38]**  
![frame_144_28m38s_Clouds_Limitations__.jpg](frames/frame_144_28m38s_Clouds_Limitations__.jpg)

**Frame #148 — [30:23]**  
![frame_148_30m23s_Clouds_Limitations__.jpg](frames/frame_148_30m23s_Clouds_Limitations__.jpg)

### 8. Dynamic Rope Systems (31:07 - 34:26)

Simulating ship rigging and sails using lightweight Verlet integration on splines, maintaining high performance with dozens of ships and ropes.

**Frame #151 — [31:07]**  
![frame_151_31m07s_Ropes_Systems.jpg](frames/frame_151_31m07s_Ropes_Systems.jpg)

**Frame #153 — [31:58]**  
![frame_153_31m58s_Ropes_Systems.jpg](frames/frame_153_31m58s_Ropes_Systems.jpg)

**Frame #157 — [33:25]**  
![frame_157_33m25s_Ropes_Systems.jpg](frames/frame_157_33m25s_Ropes_Systems.jpg)

**Frame #160 — [33:37]**  
![frame_160_33m37s_Ropes_Systems.jpg](frames/frame_160_33m37s_Ropes_Systems.jpg)

### 9. Tentacles: The Kraken & Vertex Animation Textures (34:26 - 38:11)

Solving the ship-wrapping tentacle challenge using Houdini FEM simulation baked into GPU Vertex Animation Textures (VAT), bypassing CPU animation graph bottlenecks.

**Frame #163 — [34:51]**  
![frame_163_34m51s_Tentacles_Kraken.jpg](frames/frame_163_34m51s_Tentacles_Kraken.jpg)

**Frame #165 — [35:39]**  
![frame_165_35m39s_Tentacles_Kraken.jpg](frames/frame_165_35m39s_Tentacles_Kraken.jpg)

**Frame #169 — [36:49]**  
![frame_169_36m49s_Tentacles_Kraken.jpg](frames/frame_169_36m49s_Tentacles_Kraken.jpg)

**Frame #173 — [37:49]**  
![frame_173_37m49s_Tentacles_Kraken.jpg](frames/frame_173_37m49s_Tentacles_Kraken.jpg)

**Frame #176 — [38:02]**  
![frame_176_38m02s_Tentacles_Kraken.jpg](frames/frame_176_38m02s_Tentacles_Kraken.jpg)

### 10. Lightning & Conclusion (38:11 - 41:11)

Procedural lightning generation, dynamic sky and ocean illumination, and closing Q&A takeaways.

**Frame #178 — [38:11]**  
![frame_178_38m11s_Lightning__Wrap_Up.jpg](frames/frame_178_38m11s_Lightning__Wrap_Up.jpg)

**Frame #182 — [38:55]**  
![frame_182_38m55s_Lightning__Wrap_Up.jpg](frames/frame_182_38m55s_Lightning__Wrap_Up.jpg)

**Frame #187 — [39:51]**  
![frame_187_39m51s_Lightning__Wrap_Up.jpg](frames/frame_187_39m51s_Lightning__Wrap_Up.jpg)

**Frame #194 — [40:22]**  
![frame_194_40m22s_Lightning__Wrap_Up.jpg](frames/frame_194_40m22s_Lightning__Wrap_Up.jpg)

**Frame #200 — [41:03]**  
![frame_200_41m03s_Lightning__Wrap_Up.jpg](frames/frame_200_41m03s_Lightning__Wrap_Up.jpg)

