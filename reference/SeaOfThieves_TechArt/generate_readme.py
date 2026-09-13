import json
import os

with open('SeaOfThieves_TechArt/frames_index.json', 'r', encoding='utf-8') as f:
    frames = json.load(f)

# Pick representative frames for each major section
# Total 201 frames available
selected_frames = {
    'Intro': [1, 5, 15, 22],
    'ArtDirection': [24, 25, 26],
    'Engine': [27, 29, 31],
    'Ocean_Exploration': [32, 34, 38, 43],
    'Ocean_Performance': [46, 51, 58, 64, 72, 80],
    'Clouds_Concept': [82, 83, 84],
    'Clouds_Iteration': [85, 87, 88],
    'Clouds_Rendering': [89, 95, 102, 110, 117, 126, 134],
    'Clouds_Limitations': [137, 140, 144, 148],
    'Ropes': [151, 153, 157, 160],
    'Kraken_Tentacles': [163, 165, 169, 173, 176],
    'Lightning': [178, 182, 187, 194, 200]
}

def get_frame(idx):
    for f in frames:
        if f['index'] == idx:
            return f
    return None

doc = []
doc.append("# The Technical Art of Sea of Thieves\n\n")
doc.append("**Speaker:** Rare Ltd. (Technical Art & Rendering Engineering Teams)  \n")
doc.append("**Event:** Unreal Engine Showcase / GDC  \n")
doc.append("**Video URL:** [YouTube: The Technical Art of Sea of Thieves](https://www.youtube.com/watch?v=y9BOz2dFZzs)  \n")
doc.append("**Duration:** 41 minutes, 11 seconds (2,471 seconds)  \n")
doc.append("**Extracted Assets:** 201 Sampled 720p Frames + Complete Timecoded Transcript  \n\n")

doc.append("---\n\n")
doc.append("## Quick Links\n\n")
doc.append("- [📄 Full Timecoded Transcript (TRANSCRIPT.md)](TRANSCRIPT.md)\n")
doc.append("- [🖼️ Frames Directory (201 Images)](frames/)\n")
doc.append("- [📋 Frames Index Data (frames_index.json)](frames_index.json)\n\n")

doc.append("---\n\n")
doc.append("## Executive Technical Summary\n\n")
doc.append("In *The Technical Art of Sea of Thieves*, Rare details how they tackled the unique challenge of combining **stylized, painterly art direction** with **physically based real-time simulation** in Unreal Engine 4 for a shared-world sandbox game.\n\n")

doc.append("### Key Technical Pillars\n\n")
doc.append("1. **The Ocean System**:\n")
doc.append("   - **FFT vs. Gerstner Waves:** Evaluated Tessendorf FFT ocean methods against analytical Gerstner wave sums. Kept realistic base motion while strictly stylizing foam and wave crests to avoid high-frequency visual noise.\n")
doc.append("   - **CPU-GPU Deterministic Buoyancy:** Synchronized wave displacement between GPU vertex shaders and CPU physics calculations so floating ships, cannonballs, and swimming players react with deterministic accuracy across networked clients.\n")
doc.append("   - **Advanced Water Shading:** Exaggerated Subsurface Scattering (SSS) beyond physical realism to give tropical translucency; used Jacobian determinism for wave folding and crest foam generation.\n\n")

doc.append("2. **Volumetric Stylized Clouds**:\n")
doc.append("   - **Sculpted Mesh Proxy:** Artists hand-sculpted low-poly cloud meshes to retain distinctive painterly shapes rather than pure procedural noise spheres.\n")
doc.append("   - **Lightweight Render Pipeline:** Forward-rendered low-poly cloud meshes with vertex lighting into an off-screen render target.\n")
doc.append("   - **Depth-Aware Gaussian Blur:** Downsampled cloud buffer to quarter resolution and filtered it using a single-pass compute shader Gaussian blur where standard deviation scales with depth, converting hard polygon edges into soft, voluminous clouds cheaply.\n")
doc.append("   - **Lighting & Scattering:** Simplified dual-channel lighting (Sunlight in Red, Ambient/Sky in Green) with customized Beer-Lambert extinction and powder/forward scattering approximations.\n\n")

doc.append("3. **Ship Ropes & Rigging**:\n")
doc.append("   - Used fast **Verlet integration** for hundreds of dynamic ship ropes, sail lines, and pulleys instead of heavy PhysX constraints.\n")
doc.append("   - Procedural spline mesh generation with dynamic LOD scaling based on camera distance and screen-space size.\n\n")

doc.append("4. **The Kraken (Tentacles)**:\n")
doc.append("   - Addressed the severe CPU cost of running complex inverse kinematics / animation graphs for multiple multi-segmented tentacles wrapping tightly around ship hulls.\n")
doc.append("   - Adapted Pixar's *Finding Dory* (Hank the Octopus) FEM simulation pipeline: pre-baked soft-tissue finite element deformations and animations in **Houdini**.\n")
doc.append("   - Exported directly to **Vertex Animation Textures (VAT)**, driving intricate non-penetrating tentacle wraps 100% on the GPU with zero CPU overhead.\n\n")

doc.append("5. **Procedural Lightning & Atmospheric Effects**:\n")
doc.append("   - Procedural branching algorithm generating dynamic lightning bolts.\n")
doc.append("   - Integrated screen-space and volumetric sky flashing synchronized with audio and ocean surface reflections.\n\n")

doc.append("---\n\n")
doc.append("## Chapter Breakdown & Visual Gallery\n\n")

def render_frame_block(title, frame_ids, description):
    res = [f"### {title}\n\n", f"{description}\n\n"]
    for fid in frame_ids:
        fr = get_frame(fid)
        if fr:
            res.append(f"**Frame #{fr['index']} — [{fr['timestamp']}]**  \n")
            res.append(f"![{fr['filename']}](frames/{fr['filename']})\n\n")
    return "".join(res)

# 1. Intro & Art Direction
doc.append(render_frame_block(
    "1. Introduction & Art Direction (00:00 - 03:31)",
    selected_frames['Intro'] + selected_frames['ArtDirection'],
    "Rare introduces the game's sandbox nature, the tech art team's dual responsibilities (tools/pipeline vs engine/shaders), and the core art direction pillars: illustrative style, timeless aesthetic, and deliberate avoidance of high-frequency noise."
))

# 2. Engine & Tooling
doc.append(render_frame_block(
    "2. Unreal Engine 4 Architecture & Shading Pipeline (03:31 - 05:22)",
    selected_frames['Engine'],
    "Overview of Rare's custom HLSL nodes, shader compiler workflows, and development pipeline inside Unreal Engine 4."
))

# 3. Ocean: Exploration & Visuals
doc.append(render_frame_block(
    "3. Ocean: Visual Exploration & Shading (05:22 - 08:26)",
    selected_frames['Ocean_Exploration'],
    "The journey from raw Tessendorf FFT water simulations to the signature painterly Sea of Thieves ocean. Covers subsurface scattering, artistic water coloration, refraction, and stylized foam masks."
))

# 4. Ocean: Performance & Simulation
doc.append(render_frame_block(
    "4. Ocean: Performance, Buoyancy & Simulation (08:26 - 14:51)",
    selected_frames['Ocean_Performance'],
    "Deep dive into water vertex displacement, Jacobian wave sharpness, and the deterministic CPU-GPU buoyancy calculation that powers multiplayer ship physics."
))

# 5. Clouds: Concept & Iteration
doc.append(render_frame_block(
    "5. Volumetric Clouds: Concept & Iteration (14:51 - 17:12)",
    selected_frames['Clouds_Concept'] + selected_frames['Clouds_Iteration'],
    "Early experiments with cloud generation, moving away from pure raymarched volumetric noise towards artist-sculpted proxy shapes."
))

# 6. Clouds: Rendering Pipeline
doc.append(render_frame_block(
    "6. Volumetric Clouds: Rendering Architecture (17:12 - 25:12)",
    selected_frames['Clouds_Rendering'],
    "The complete technical breakdown of the cloud rendering pipeline: forward vertex-lit proxy meshes, quarter-resolution off-screen buffer, depth-dependent compute Gaussian blur, G-buffer packing, and lighting integration."
))

# 7. Clouds: Limitations & Optimizations
doc.append(render_frame_block(
    "7. Volumetric Clouds: Limitations & Optimizations (25:12 - 31:07)",
    selected_frames['Clouds_Limitations'],
    "Solving edge bleed, camera intersection clipping, temporal artifacts, and fitting the cloud rendering budget into the strict frame time."
))

# 8. Rope Systems
doc.append(render_frame_block(
    "8. Dynamic Rope Systems (31:07 - 34:26)",
    selected_frames['Ropes'],
    "Simulating ship rigging and sails using lightweight Verlet integration on splines, maintaining high performance with dozens of ships and ropes."
))

# 9. Kraken Tentacles
doc.append(render_frame_block(
    "9. Tentacles: The Kraken & Vertex Animation Textures (34:26 - 38:11)",
    selected_frames['Kraken_Tentacles'],
    "Solving the ship-wrapping tentacle challenge using Houdini FEM simulation baked into GPU Vertex Animation Textures (VAT), bypassing CPU animation graph bottlenecks."
))

# 10. Lightning & Wrap Up
doc.append(render_frame_block(
    "10. Lightning & Conclusion (38:11 - 41:11)",
    selected_frames['Lightning'],
    "Procedural lightning generation, dynamic sky and ocean illumination, and closing Q&A takeaways."
))

with open('SeaOfThieves_TechArt/README.md', 'w', encoding='utf-8') as f:
    f.writelines(doc)

print("Generated SeaOfThieves_TechArt/README.md successfully!")
