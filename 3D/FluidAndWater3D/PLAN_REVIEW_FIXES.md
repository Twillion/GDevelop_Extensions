# Review fixes

Scope: fix the filtering, strength slider, and shared spray issues found in the September 5 review. Preserve existing public actions and behavior names.

1. Configure mipmaps and a compatible minification filter for anisotropic water detail. Keep vertex displacement at mip level zero. Fall back to 1x when capabilities or float filtering/mipmap support are unavailable. Preserve persistent foam when its filtering changes, and distinguish requested settings from effective filtering in the documentation.
2. Initialize slider state in Beaufort units, including normalized input and zero. Cache the last applied target/value and stop damping once converged so stationary sliders do not rebuild spectra.
3. Move shared spray integration/render synchronization to the scene tick. Keep emission per detailing behavior and store gravity per particle so another water body cannot change existing droplets' motion.
4. Add regression coverage for real sampler eligibility, fallback and filter changes, idle/retargeted sliders, normalized initialization, and multiple detailing behaviors. Verify with the existing runtime/ocean/SPH/shader/build suite plus a real Three.js/WebGL sampler check.

## Completed

All four steps are implemented. Regression testing also exposed missing numeric Beaufort values on exact preset anchors; cached anchors now include their level, including calm (0) and hurricane (12). Slider bindings also discard removed targets before resolving a replacement.

Validation:

- `node "3D/FluidAndWater3D/build-extension.mjs"` rebuilt the extension JSON; all 199 generated JavaScript blocks parsed successfully.
- `node "3D/FluidAndWater3D/test-all.mjs" --webgl` passed the static shader checks, runtime regressions, FFT/ocean checks, SPH checks, generated JSON freshness check, and real WebGL test.
- The idle-slider regression verifies zero extra spectrum rebuilds across 60 unchanged frames after initial application, versus 120 in the reviewed implementation.
- Three detailing behaviors now age spray by one 16 ms frame, with per-particle gravity, pause, and time-scale checks.
- Headless Chrome using the local Three.js r160 and SwiftShader reported actual GL anisotropy 4 on all four ocean textures with `LINEAR_MIPMAP_LINEAR`. Runtime 8x/1x/4x changes preserved both foam histories, shaders compiled, and no WebGL errors were reported.
- `git diff --check` passed for the extension directory.

The browser check validates actual WebGL behavior using a software renderer. Physical GPU performance and visual quality in a full GDevelop game remain outside this validation. Mipmap generation adds rendering work when filtering is enabled; 1x disables that work for the owned textures.
