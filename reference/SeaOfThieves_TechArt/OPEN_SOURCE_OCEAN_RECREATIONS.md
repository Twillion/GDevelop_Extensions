# Open-Source Ocean & Water Systems Inspired by Sea of Thieves

Since Rare's proprietary ocean system is built upon **Jerry Tessendorf's 2001 FFT formulation**, **Gerstner wave cascades**, and **Jacobian determinant foam detection**, several prominent open-source projects have implemented these exact mathematical models. 

Below is a curated directory of the best open-source ocean systems, compute shader implementations, and technical breakdown repositories across **Unreal Engine**, **Unity**, **Godot**, **Three.js**, and **DirectX/C++**.

---

## Master Comparison Table

| Project | Engine / Framework | License | Primary Tech Stack | Key Features |
| :--- | :--- | :--- | :--- | :--- |
| [**Crest Ocean System**](https://github.com/wave-harmonic/crest) | Unity (URP / HDRP) | MIT | Compute Shaders, C# | The gold standard. Nested LOD cascades, multi-scale FFT, Jacobian foam, deterministic CPU/GPU buoyancy queries. |
| [**Ocean-Simulation (gasgiant)**](https://github.com/gasgiant/Ocean-Simulation) | Unity | MIT | HLSL Compute, C# | Cleanest academic Tessendorf implementation. Phillips & JONSWAP spectra, compute iFFT, Jacobian foam masks. |
| [**godot4-oceanfft (tessarakkt)**](https://github.com/tessarakkt/godot4-oceanfft) | Godot 4 | MIT | Godot Shading Language, Vulkan Compute | Real-time Tessendorf FFT ocean for Godot 4 with GPU vertex displacement and CPU height queries for boat buoyancy. |
| [**Water (Garrett Gunnell / Acerola)**](https://github.com/GarrettGunnell/Water) | Unity | MIT | HLSL, Compute Shaders | Educational companion to Acerola's water simulation breakdowns. Covers FFT, Gerstner peaks, and depth SSS. |
| [**UE4-OceanProject**](https://github.com/UE4-OceanProject/OceanProject) | Unreal Engine 4 | MIT | C++, HLSL, UE Materials | Multi-point boat buoyancy, Gerstner waves, underwater caustic rendering, physics interaction for UE4. |
| [**fftWater (iamyoukou)**](https://github.com/iamyoukou/fftWater) | Standalone C++ / DX11 | MIT | C++, HLSL Compute | Pure DirectX 11 compute shader implementation of Tessendorf 2001 with zero engine boilerplate. |
| [**jbouny/ocean**](https://github.com/jbouny/ocean) | Three.js / WebGL | MIT | JavaScript, GLSL | Interactive browser-based Tessendorf FFT ocean with foam generation and Fresnel reflections. |
| [**Alex Tardif's Water Walkthrough**](https://alextardif.com/Water.html) | Standalone C++ / D3D11 | Free / Article | C++, HLSL | Celebrated technical breakdown and code guide explicitly recreating the *Sea of Thieves* stylized look and SSS. |

---

## Detailed Project Breakdowns

### 1. Crest Ocean System
- **Repository:** [wave-harmonic/crest](https://github.com/wave-harmonic/crest)
- **Engine:** Unity (Universal Render Pipeline & High Definition Render Pipeline)
- **Why it's relevant to *Sea of Thieves*:**
  - Crest is widely considered the closest open-source equivalent to *Sea of Thieves*' ocean rendering.
  - Implements **nested concentric ring LODs** (shape textures) centered on the camera, dramatically reducing vertex count on distant water.
  - Generates dynamic crest foam using the **divergence and Jacobian stretching** of the displacement field.
  - Features high-performance **CPU readback queries** for boat physics and floating player buoyancy with deterministic wave evaluation.
  - Handles dynamic water masks (preventing water from rendering inside ship hulls).

---

### 2. Ocean-Simulation (by gasgiant)
- **Repository:** [gasgiant/Ocean-Simulation](https://github.com/gasgiant/Ocean-Simulation)
- **Engine:** Unity (HLSL Compute Shaders)
- **Why it's relevant to *Sea of Thieves*:**
  - Implements the exact math from **Jerry Tessendorf's 2001 paper** and **Christopher Horvath's 2015 empirical wave spectra paper**.
  - Supports multiple wave spectra: Phillips, JONSWAP, and TMA.
  - Performs the 2D Inverse Fast Fourier Transform (iFFT) entirely on the GPU via compute shaders (using the Cooley-Tukey radix-2 butterfly algorithm).
  - Explicitly outputs displacement textures $\mathbf{D}(x, z)$ and calculates the **Jacobian matrix determinant** to trigger dynamic foam maps.

---

### 3. Godot 4 Ocean FFT (by tessarakkt)
- **Repository:** [tessarakkt/godot4-oceanfft](https://github.com/tessarakkt/godot4-oceanfft)
- **Engine:** Godot 4.x (Vulkan / RenderingDevice)
- **Why it's relevant to *Sea of Thieves*:**
  - Modern open-source Godot 4 implementation utilizing Godot’s `RenderingDevice` compute shaders.
  - Evaluates the ocean spectrum on the GPU and provides asynchronous or immediate height queries back to GDScript / C++ for ship floating physics.
  - Includes custom foam accumulation shaders and shoreline interaction.

---

### 4. Water (by Garrett Gunnell / "Acerola")
- **Repository:** [GarrettGunnell/Water](https://github.com/GarrettGunnell/Water)
- **Engine:** Unity
- **Why it's relevant to *Sea of Thieves*:**
  - Accompanies the widely acclaimed YouTube technical breakdown *"How Video Games Render Water"* and *"Simulating Oceans"*.
  - Step-by-step implementation showing how to transition from simple Gerstner sums to full FFT displacement, accompanied by depth-based water absorption (Beer-Lambert), subsurface scattering (translucency), and Jacobian foam.

---

### 5. UE4-OceanProject (Community Project)
- **Repository:** [UE4-OceanProject/OceanProject](https://github.com/UE4-OceanProject/OceanProject)
- **Engine:** Unreal Engine 4
- **Why it's relevant to *Sea of Thieves*:**
  - One of the earliest and most comprehensive community water systems for Unreal Engine 4.
  - Contains a **Buoyancy Movement Component** that samples wave heights across multiple test points on a ship's collision mesh, calculating hydrostatic buoyant force, torque, and water drag.
  - Provides underwater post-process volumes, screen-space water drops, and shoreline depth dampening.

---

### 6. Standalone C++ / DirectX 11 FFT Water (by iamyoukou)
- **Repository:** [iamyoukou/fftWater](https://github.com/iamyoukou/fftWater)
- **Tech:** C++, DirectX 11, HLSL
- **Why it's relevant to *Sea of Thieves*:**
  - Stripped-down, pure graphics programming repository focusing solely on the compute shader FFT pipeline without game engine overhead.
  - Excellent for inspecting the exact HLSL compute shaders used to generate butterfly textures, twiddle factors, ping-pong FFT passes, and normal/Jacobian extraction.

---

### 7. Alex Tardif's Water Walkthrough
- **Article & Code:** [alextardif.com/Water.html](https://alextardif.com/Water.html)
- **Tech:** Custom C++ / DirectX 11 / HLSL
- **Why it's relevant to *Sea of Thieves*:**
  - Alex Tardif (Lead Graphics Engineer at That's No Moon, ex-Volition) wrote this detailed breakdown specifically analyzing the visual techniques of *Sea of Thieves*.
  - Covers how to combine multi-octave Gerstner waves with custom foam masks, artist-controlled color ramps for water depth, and exaggerated Subsurface Scattering (SSS) to reproduce the vibrant tropical Caribbean water aesthetic.

---

## Which System Should You Use?

1. **If you use Unity:** Use [**Crest**](https://github.com/wave-harmonic/crest) for production games, or [**Ocean-Simulation**](https://github.com/gasgiant/Ocean-Simulation) if you want a clean, isolated compute-shader FFT reference.
2. **If you use Godot 4:** Use [**godot4-oceanfft**](https://github.com/tessarakkt/godot4-oceanfft).
3. **If you use Unreal Engine:** Inspect [**UE4-OceanProject**](https://github.com/UE4-OceanProject/OceanProject) alongside UE5's built-in Water Plugin (which provides native Gerstner waves and buoyancy).
4. **If you want to understand the exact HLSL shaders from scratch:** Study [**Alex Tardif's Walkthrough**](https://alextardif.com/Water.html) and [**Acerola's Water repo**](https://github.com/GarrettGunnell/Water).
