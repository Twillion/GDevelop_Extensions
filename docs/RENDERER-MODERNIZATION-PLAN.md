# Renderer modernization — plan of execution

**Scope:** `AdvancedLighting3D`, `MaterialMaster` (ShaderChain), `CinematicPostFX3D`.

**Revision 4.** See §12 for the full revision log. Revision 2 fixed the shader insertion point and the
Radiance Cascades over-claim; revision 3 supplied the specular-AA formulation, LUT colour pipeline and
acceptance metrics; revision 4 settles the equation choice, the clearcoat coupling, the ShaderChain
migration path, and replaces metrics that could not measure what they claimed.

**Verdict up front: defer TAA and SSGI; do not cancel them on principle.** They are deferred because
cheaper non-temporal work has not been measured yet, and because a clustered-forward WebGL2 renderer
has options a deferred engine does not. That is a scope decision subject to measurement. §6 records
what would reopen it.

Phase 0 is measurement infrastructure and must land first — every later gate is meaningless without
it.

---

## 0. Baseline — prerequisite for everything

### 0.1 Target and budget

| Axis | Target |
| :--- | :--- |
| Reference hardware | Integrated GPU (Intel Iris Xe class) as the floor; a mid discrete GPU as the comfort case |
| Resolution | 1280×720 and 1920×1080 |
| Frame budget | 16.6 ms total; post-processing chain ≤ 4.0 ms at 1080p on the comfort case |
| Memory ceiling | ≤ 128 MB of GPU-side render targets and volume textures combined |

### 0.2 Test scenes

Four fixed scenes in `demos/`, each with a scripted camera path:

1. **Cornell-ish box** — flat-shaded, strong coloured bounce. GI reference.
2. **Rough-metal sphere array** — high-frequency normal map, orbiting camera. Specular aliasing reference.
3. **Interior with a small bright emitter** — RC ringing stress case.
4. **Foliage / alpha-tested detail** — the material-aliasing case Tardif identified as forcing him
   temporal. Included so the plan does not pretend that problem is solved.

### 0.3 Metrics — no gate in this document is a judgement call

Revision 2 used "plausible", "not worse", "below threshold". Those are replaced:

| Gate phrase | Actual metric |
| :--- | :--- |
| **Sparkle / shimmer** | **Temporal change in *error*, not in image.** Render a matching 16×-supersampled reference sequence along the same path. Per frame compute `e[n] = abs(f[n] - ref[n])`, then report `mean(abs(e[n] - e[n-1]))` over 120 frames in a marked region. Raw `abs(f[n] - f[n-1])` is rejected: a moving camera changes legitimately, so blurrier output scores better simply by changing less. Stationary-camera runs use the raw delta (no legitimate motion) and are kept as a separate number. Both are accompanied by a recorded motion clip for visual review — the metric supports the judgement, it does not replace it. |
| **Static quality** | 16× supersampled offline render of the same frame as reference. Report RMSE and SSIM. |
| **GI correctness** | Offline path-traced reference of scene 1, matched per §8's reference-parity checklist (camera, lights *in matching units*, materials, exposure, bounce count). Report RMSE in a marked floor/wall region. Thresholds are fixed in §8's sub-phase table **before** the experiments run. |
| **Ringing** | Radial intensity profile sampled outward from the emitter in scene 3, differenced against the path-traced reference. Threshold is the peak deviation, recorded as a number. |
| **Timing** | 200 frames, discard the first 20. Report median and p95, not mean. |

### 0.4 Timing fallback

`EXT_disjoint_timer_query_webgl2` is unavailable or clamped in several browsers. Do not assume it.

- Primary: the extension when present, checking the disjoint flag and discarding disjoint samples.
- **Fallback:** CPU wall-clock over a fixed frame count with the pass toggled on and off, differenced.

**The fallback cannot certify the 4.0 ms GPU budget, and must not be reported as if it does.** CPU
wall-clock measures command submission, which is asynchronous; frame timing additionally folds in
presentation pacing and any CPU bottleneck. A pass can add real GPU time while moving neither number.

So:

- Where timer queries are available, the GPU-pass budget in §0.1 is a **pass/fail gate**.
- Where they are not, record the toggle comparison as coarse end-to-end evidence and mark GPU-pass
  timing **unavailable** for that configuration. An unavailable measurement is not a pass.
- Never compare a timer-query figure against a wall-clock one. Record which method produced each
  number.

### 0.9 What landed

**Partially built.** `demos/bench/` now contains the measurement infrastructure and ONE of the four
scenes. Scenes 1, 3 and 4 are **not built** — they gate phases not being worked on, and a stub that
rendered something plausible would be worse than an honest absence because a gate would appear to
have been evaluated.

| Piece | State |
| :--- | :--- |
| `metrics.mjs` | RMSE, windowed SSIM, temporal error delta, raw temporal delta, box downsample, region mask, median/p95 |
| `test-metrics.mjs` | 34 assertions against known answers |
| `harness.mjs` | Headless Chrome + SwiftShader, frames streamed one at a time |
| `scenes.js` | **Scene 2 only** (rough-metal sphere array, mipmapped normal map, orbiting camera) |
| `run-specular-aa.mjs` | Section 2's four-way acceptance comparison |
| `run-sigma-sweep.mjs` | SIGMA2 sweep against the supersampled reference |
| Scenes 1, 3, 4 | **Not built.** `benchBuild` throws by name rather than rendering a stand-in |

**A blind spot found by writing the metric tests:** `temporalErrorDelta` cannot see a *perfectly
symmetric* flicker, because `abs()` maps an alternating +/-d error to a constant. Real specular
aliasing is asymmetric so this rarely bites, but it is now asserted as a documented limitation
rather than left to be discovered during a phase gate. The raw delta does see it, which is a second
reason stationary runs keep that number.

**Timing is wall-clock only.** `EXT_disjoint_timer_query_webgl2` is reported present under
SwiftShader, but whole-frame wall clock is what is actually measured. Per §0.4 that **cannot**
certify the 4.0 ms GPU pass budget: GPU-pass timing is recorded as **unavailable**, and an
unavailable measurement is not a pass.

**Reduced frame counts.** §0.3 specifies 120 frames for the temporal metric and 200 for timing. The
runners default lower because the reference pass is 16x the pixels on a software rasteriser. Both
are environment-overridable and the reduction is printed in the output, not hidden.

**Known methodological caveat.** The supersampled reference is the *stock renderer* at 4x. Every
screen-space filtering term — Three's `geometryRoughness` included — shrinks as resolution rises,
so the reference structurally contains *less* screen-space filtering than any 1x render. That biases
RMSE in favour of less filtering. It does not invalidate the comparison, since all configurations
are measured against the same reference, but it means "RMSE rises" should be read as "drifts from a
higher-resolution rendering of itself", not as proof of a visual defect.

---

## 1. Shader composition ownership — prerequisite

> **STATUS: COMPLETE.** ShaderChain v2 shipped; AdvancedLighting3D converted to a band-100 injector.
> All six suites pass, including `test-shadow-webgl.mjs`, which compiles the generated GLSL in a real
> browser and reports `glErrors: []`. See §1.9 for what landed and what is still owed.

**Blocks Phase 2.**

### Two distinct risks, not one

Revision 2 conflated these. They are separate:

1. **Callback ownership.** `material.onBeforeCompile` is a single function property. Two systems
   assigning it do not compose — the last writer wins and the loser's edits vanish silently. **This
   happens regardless of which chunks they edit**; chunk adjacency is irrelevant to it. Same for
   `customProgramCacheKey`.
2. **Semantic conflict.** Separately, once composition is solved, two injectors that both write
   `material.roughness` or both restructure the lighting setup can still produce a wrong result. This
   one *is* about adjacency, and Phase 2 makes it live because it targets `lights_physical_fragment`,
   next to the `lights_fragment_begin` replacement AdvancedLighting3D owns.

Current state: `MaterialMaster/ShaderChain.runtime.js` is a proper composition mechanism with ordered
bands and a cache-key contract. `AdvancedLighting3D.runtime.js:1222` assigns its own hook directly,
outside ShaderChain.

### Standalone compatibility — the constraint revision 2 missed

**AdvancedLighting3D must keep working with MaterialMaster not installed.** Making ShaderChain the
owner cannot mean making it a dependency.

ShaderChain is already written to be embedded in multiple extension runtimes and self-guards with
`if (typeof THREE !== 'undefined' && !gdjs.__m3dShaderChain)`. That is an **existence guard with no
version check**, which creates the actual hazard:

> Both extensions embed a copy. Whichever loads first installs its copy and the other's is skipped.
> If AdvancedLighting3D ships an older ShaderChain lacking a band or contract the newer MaterialMaster
> injector relies on, the injector registers against the old copy and silently does nothing.

### The upgrade path must migrate already-installed hooks

Versioning alone does not fix this, because of how `install()` works
(`MaterialMaster/ShaderChain.runtime.js:74`):

```js
mat.onBeforeCompile = function (shader) {
    var active = activeFor(mat);   // reads the MODULE-PRIVATE `injectors` array
    ...
};
```

The callback closes over the private `injectors` array of the module instance that installed it.
Replacing `gdjs.__m3dShaderChain` with a newer copy creates a **new** private array; every material
already carrying the old callback keeps dispatching into the **old** one. Re-registering injectors on
the new namespace changes nothing for them.

This is not hypothetical: AdvancedLighting3D already carries `RUNTIME_VERSION` and
`__unregisterRuntimeCallbacks` precisely because re-importing an extension in the editor replaces a
live runtime with materials already in existence.

**Pick one and specify it:**

- **(a) Stable shared registry.** Move `injectors` to a namespaced object that survives module
  replacement, and have the dispatcher read it rather than a closure variable. Fixes fragmentation
  going forward; does not retroactively fix callbacks installed by a version that predates the change.
- **(b) Tracked reinstallation.** Keep a registry of installed materials that survives replacement,
  and have a newer module re-run `install()` on each. Heavier, but it repairs existing materials.

Default: **(a) plus (b)** — the shared registry prevents recurrence, the tracked reinstall handles the
materials already live at upgrade time.

### Work

1. Add a `VERSION` to ShaderChain and implement the migration above — not just a version check.
2. Embed the shared copy in AdvancedLighting3D and register its lighting injection as a band-100
   injector.
3. Define cleanup ownership — which extension unregisters what on scene dispose, and what happens
   when one extension is removed from a project mid-development.
4. Verify with a test material carrying both behaviors, in **both attachment orders**.
5. Verify clone safety — `Material.copy()` carries neither `onBeforeCompile` nor
   `customProgramCacheKey`, and JSON round-trips `userData`.
6. Verify a toggle-off recompiles correctly and destroy restores the original.
7. **Test an upgrade after materials already exist** — install the old version, create materials, load
   the new version, confirm new injectors reach the pre-existing materials. This is the case a version
   check alone silently fails.

Exit: both feature sets render together in either attachment order, across a clone and a toggle
cycle, **and** AdvancedLighting3D alone renders correctly in a project with MaterialMaster absent.

### 1.9 What landed

| Item | Where |
| :--- | :--- |
| `CHAIN_VERSION` + version-gated install; equal version does not replace | `MaterialMaster/ShaderChain.runtime.js` |
| Registry and tracked-material list moved to `gdjs.__m3dShaderChainState` | same |
| Upgrade re-installs tracked materials — `ensureAll()` would skip them, since they still report `__m3dChainInstalled === true` | same |
| `ensureAll()`, `uninstall()`, `unregister()`, `clearTracked()`, `trackedCount()` | same |
| `WeakRef` tracking where available, strong-array fallback | same |
| Unmigratable-registry warning, scoped to ids the shared registry does not already hold | same |
| Clustered/probe/SDF injection converted to `alInjectShader` + band-100 registration; every per-material value now read from `__alInjection` rather than an enrolment closure | `AdvancedLighting3D.runtime.js` |
| `use3D` added to `__alInjection` (was closure-only) | same |
| `chain.install()` replaces direct hook assignment; `chain.uninstall()` replaces the no-op stamp on teardown | same |
| `ensureAll()` on the post-events tick | same |
| ShaderChain embedded ahead of the runtime; control-char and direct-`onBeforeCompile` build guards added (AdvancedLighting3D previously had neither) | `AdvancedLighting3D/build-extension.mjs` |
| 20 coexistence assertions — both load orders, key separation, replacement recovery, one-sided teardown, clone safety | `AdvancedLighting3D/test-shaderchain-coexistence.mjs` (new) |
| 19 chain-v2 assertions | `MaterialMaster/test-materialmaster.mjs` §34 |
| Three harnesses updated to load ShaderChain in build order | `test-runtime.mjs`, `test-shadow-runtime.mjs`, `test-shadow-webgl.mjs` |
| Portal3D incompatibility recorded | both extension READMEs |

**Behavioural change to know about:** the program cache key is now composed. AdvancedLighting3D's
fragment appears as `advlight3d:GD_ADVLIGHT3D_V8|…` inside a larger `M3D|…` key instead of being the
whole string. Two assertions in `test-runtime.mjs` were updated for this. Anything outside this repo
that matched the old bare key will not match.

### 1.10 Still owed before Phase 2

- **GDevelop preview.** Every check above is Node or headless-browser. `test-shadow-webgl.mjs`
  compiles the shader and reports no GL errors, which is real evidence, but it does not prove the
  scene *looks* right. Open a project with a lighting receiver and a Material 3D behavior on one
  object and confirm both features render.
- **The editor re-import case** (§11): install, create materials, re-import the extension, confirm
  injectors still reach the pre-existing materials. The unit test simulates this by forcing
  `VERSION = 1`; the real trigger is a GDevelop editor re-import and has not been exercised.
- **Extension JSON grew 1648 KB → 1784 KB** from embedding ShaderChain in the runtime-carrying
  blocks. Acceptable, but if it matters later the chain could follow the same once-per-scene
  installer pattern the runtime already uses.

---

## 2. Geometric specular anti-aliasing

**Revised — revision 2 named the paper but not the formula, and over-stated what it fixes.**

### What Three r160 already does

`lights_physical_fragment` already applies:

```glsl
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness += geometryRoughness;
```

This is a Vlachos-style empirical clamp added in the **perceptual roughness** domain, on the
**geometric** normal.

### The exact algorithm

Tokuyoshi & Kaplanyan 2019, Listing 2 / Eq. 5 — the single-scalar-roughness form:

```glsl
// dndu, dndv: screen-space derivatives of the SHADING normal (world space)
vec3  dndu = dFdx( normal );
vec3  dndv = dFdy( normal );
float variance         = SIGMA2 * ( dot(dndu, dndu) + dot(dndv, dndv) );
float kernelRoughness2 = min( 2.0 * variance, KAPPA );
float filteredAlpha2   = clamp( alpha * alpha + kernelRoughness2, 0.0, 1.0 );
```

### Which equation — Eq. 4, explicitly

The paper gives two, and revision 3 quoted one next to the other's code:

| | Formula | Paper |
| :--- | :--- | :--- |
| **Conservative** | `ᾱ² = α² + min( 2σ²(‖Δnu‖² + ‖Δnv‖²), κ )` | Eq. 4, §4.5 — **this is what Listing 2 implements** |
| Less conservative | `ᾱ² = α² + min( σ²(‖Δnu‖² + ‖Δnv‖²), κ )` | Eq. 5, §4.6 — averages the eigenvalues |

Listing 2's caption reads "the red code is removed for less conservative filtering" — the red code is
the `2.0 *`. Conservative removes aliasing at the cost of overfiltering; less conservative trades some
underfiltering for sharper highlights.

**Decision: implement Eq. 4 / Listing 2 as written (the `2.0 *` stays).** Note that the two differ
only by a factor of two applied before the κ clamp, so they are equivalent to halving `SIGMA2` — Eq. 5
needs no second code path, and is reachable by tuning. Document that relationship rather than shipping
a mode switch.

**Domain, stated explicitly, because this is where a naive `max()` goes wrong:**

| Symbol | Meaning | Three equivalent |
| :--- | :--- | :--- |
| perceptual roughness `r` | artist-facing value | `material.roughness` |
| `α` | GGX NDF parameter | `r * r` |
| filtering happens in | **`α²`** | `pow(material.roughness, 4.0)` |

So the full conversion back is:

```glsl
float r     = material.roughness;          // perceptual
float alpha = r * r;                       // GGX parameter
float filteredAlpha2 = clamp( alpha*alpha + kernelRoughness2, 0.0, 1.0 );
float filteredAlpha  = sqrt( filteredAlpha2 );
material.roughness   = sqrt( filteredAlpha );   // back to perceptual
```

**Therefore `max(existing, new)` as written in revision 2 is dimensionally incoherent** — Three's
`geometryRoughness` is an additive term in `r`, and `kernelRoughness2` is an additive term in `α²`.
They cannot be compared directly.

**Decision: replace Three's term, do not combine it.** Remove the `geometryRoughness` lines and
substitute the T&K block. If a conservative floor against geometric curvature is still wanted, compute
it by running the same T&K kernel a second time on `nonPerturbedNormal` and taking the max of the two
`kernelRoughness2` values — both then live in the same domain.

Retain Three's `max(roughnessFactor, 0.0525)` floor; it is unrelated and still needed.

### Clearcoat is coupled — removing `geometryRoughness` breaks it

`geometryRoughness` is computed once and applied **twice** in r160:

```glsl
material.roughness          += geometryRoughness;
material.clearcoatRoughness += geometryRoughness;   // #ifdef USE_CLEARCOAT
```

`MaterialMaster/PhysicalMaterial3D.runtime.js` exposes clearcoat, so this path is live in this repo.
Deleting the term silently removes clearcoat roughness filtering and reintroduces sparkle on every
clearcoated surface — a regression in a feature the injector was never meant to touch.

**Required:** apply the T&K filter to `material.clearcoatRoughness` as well, converting through the
same `r → α → α² → filter → sqrt → sqrt → r` round trip with clearcoat's own roughness value, under
the `USE_CLEARCOAT` guard. Add a clearcoated sphere to test scene 2 so the regression is measurable
rather than discovered later.

### Constants

- `KAPPA = 0.18` — the clamping threshold, stated in the paper.
- `SIGMA2` — the pixel-filter-kernel variance. **The paper does not fix a numeric default**; it is a
  tuning parameter. Start at 0.15 (Filament's default for the same formulation) and expose it as a
  behavior property. Do not hardcode it.

### What this does and does not fix

The paper's own Limitations section, quoted rather than paraphrased:

- "relies on high quality shading normals and addresses **only the aliasing caused by specular
  highlights**"
- "**Aliasing caused by geometric discontinuities cannot be handled** by the method"
- "the filtering of the GGX NDF is approximated by assuming the Beckmann NDF, therefore **GGX
  highlights can be overblurred**"
- "the proposed kernel produces **underfiltering for grazing halfvectors**"

**And the claim revision 2 got wrong:** screen-space normal derivatives can only see variance that
*survives to the pixel*. Normal-map detail already destroyed by mip minification is not recoverable
this way. The paper itself points at Toksvig [2005] and LEAN mapping [Olano & Baker 2010] for that
case — they bake normal variance into the mip chain, which is a **different technique with an asset
pipeline cost**, explicitly out of scope here.

Corrected claim: this phase reduces specular aliasing from shading-normal variation visible at pixel
scale. It is not a general fix for normal-map aliasing.

### Acceptance

Four-way comparison on scene 2 using §0.3 metrics: stock `geometryRoughness` / AA disabled /
T&K on perturbed normal / T&K on both normals. Accept only if temporal delta drops **and** static
RMSE against the supersampled reference does not rise (the overblur failure mode). Record GPU ms.

### 2.9 What landed

**Implemented**, not **accepted**. The distinction is the point of this section.

Shipped as `MaterialMaster/SpecularAA3D.runtime.js` and a `SpecularAA3D` behavior (Enabled, Filter
width, Clamp threshold, Also filter geometric curvature). One ShaderChain injector at order 650 on
`lights_physical_fragment`, exactly as section 10 specified. `test-specular-aa.mjs`: 101 assertions.

**The bug that mattered: `onBeforeCompile` runs BEFORE `resolveIncludes`.** At injection time the
fragment source still contains the literal directive `#include <lights_physical_fragment>`, not the
chunk body, so searching for `material.roughness += geometryRoughness;` finds nothing. The first
implementation did exactly that, the edit silently did nothing, and the rendered image was
byte-identical with the filter on and off — indistinguishable from the feature being inert. The
injector now expands `THREE.ShaderChunk.lights_physical_fragment` itself, patches the expansion, and
substitutes it for the directive, with the already-resolved form kept as a fallback.

This is the same class of failure the local-shadow-map work hit twice: reasoning about shader source
instead of observing it. The Node source assertions passed throughout, because the test handed the
injector pre-resolved text that the real pipeline never produces.

**Verified.** Three's additive term is replaced rather than stacked (the domains are incompatible);
the round trip is the full `r -> a -> a^2 -> filter -> sqrt -> sqrt -> r`; Eq. 4's factor of two is
kept, with Eq. 5 reachable by halving sigma2 rather than by a second code path; clearcoat gets its
own independent kernel and round trip; `max(roughnessFactor, 0.0525)` survives; the cache key varies
with source-affecting flags but NOT with sigma2/kappa, so tuning does not recompile; unlit materials
are refused rather than throwing per compile; a missing anchor throws rather than no-opping.

**Now measured on scene 2 — and the result is not the expected one.** Four-way comparison,
128px, 8 frames, 16x supersampled reference:

| config | temporal | RMSE | SSIM |
| :--- | ---: | ---: | ---: |
| stock `geometryRoughness` | 6.524 | 20.55 | 0.7315 |
| filter installed, sigma2 = 0 | **5.711** | **16.96** | **0.8115** |
| T&K on shading normal (0.15) | 7.266 | 27.07 | 0.6708 |
| T&K on both normals (0.15) | 7.223 | 27.27 | 0.6676 |

A SIGMA2 sweep came out strictly monotonic: 0 best, 0.005/0.01/0.02 still passing both gates,
0.04 and above failing both.

**The win is removing Three's term, not adding T&K.** On this content Three's Vlachos clamp is
already over-filtering low-roughness metal, and the best configuration by every metric is to replace
it with a filter of zero width. Filament's 0.15 fails both gates badly.

**Default changed from 0.15 to 0.02** — the largest measured value still passing both gates.
Shipping a value measured to fail this plan's own acceptance would be indefensible; shipping 0 would
mean a feature named anti-aliasing that adds no filtering. This is one scene and one content type,
so it is a defensible default, not a universal constant.

**Consequence: it stays opt-in per object.** The measured benefit is real but small and
content-dependent, and it comes mostly from what the filter removes rather than what it adds.

---

## 3. 3D LUT colour grading

**Revised — revision 2 conflated tone mapping with encoding, and its acceptance test could not
detect the error it most needed to catch.**

### The actual colour pipeline

From this repo's own `CinematicPostFX3D/IMPLEMENTATION_PLAN.md`: `renderer.toneMapping` is never set,
so `OutputPass` performs **only** the sRGB conversion, and the extension's ACES curve is the sole tone
map. The chain is:

```
RenderPass → [CinematicPostFXPass: … → ACES tone map → LUT] → SMAA → OutputPass (sRGB OETF) → screen
```

So at the point the LUT would run, values are **tone-mapped, display-referred, and still linear** —
*not* sRGB-encoded. Authored LUTs (DaVinci, Photoshop, most `.cube` exports) expect **sRGB-encoded**
input. Feeding linear values to an sRGB-domain LUT is wrong and will look plausibly-but-incorrectly
graded, which is the worst failure mode.

### Required sequence

```
1. ACES tone map                 → linear, display-referred
2. sRGB OETF (linear → encoded)  → the domain the LUT table is authored in
3. sample LUT                    → graded, still sRGB-encoded
4. sRGB EOTF (encoded → linear)  → back to linear for the rest of the chain
5. OutputPass applies sRGB OETF  → framebuffer
```

Steps 2 and 4 are the ones revision 2 omitted.

### Scope: an sRGB-to-sRGB contract only

Revision 3 implied log LUTs were reachable by swapping two transfer functions. They are not. A log
LUT can differ in input encoding, output encoding, **working gamut**, and whether it is scene-referred
or display-referred. Supporting arbitrary log LUTs is colour-management work, not a shader change.

**This phase ships one documented contract: sRGB in, sRGB out, display-referred, Rec.709 primaries.**
Reject or warn on anything else. Log/ACES support is a separate project and is explicitly not in
scope here; do not design the API as though it were a flag.

Also: set `colorSpace = NoColorSpace` on the `Data3DTexture`. Tagging it `SRGBColorSpace` makes Three
decode the table values, which are literal outputs, not colours to be converted.

### Sampling spec

- Unroll the 1024×32 strip to a 32×32×32 `Data3DTexture`.
- **Axis order:** strip tile index → blue; within-tile x → red; within-tile y → green. Document
  whether green is flipped — the single most common LUT bug.
- **Texel centres, all three axes:**

  ```glsl
  vec3 lutUVW = ( clamp(color, 0.0, 1.0) * 31.0 + 0.5 ) / 32.0;
  ```

- `LinearFilter`, `ClampToEdgeWrapping` on all three axes, `generateMipmaps = false`.
- The packed-strip slice-bleed warning from revision 1 is removed — it does not apply once the data
  is a true 3D texture.

### Acceptance — two tests, because one is not enough

1. **Identity LUT** → must round-trip to within 1/255. This validates axis order, orientation and
   texel centres. **It cannot validate colour space**, because an identity LUT round-trips correctly
   in *any* domain. Revision 2 treated this as sufficient. It is not.
2. **Known-response LUT** → author a LUT with a predictable, non-identity response (e.g. a pure
   gamma shift, or one that maps mid-grey to a specified value). Apply the same LUT to the same
   captured frame in the authoring tool. The two results must match within tolerance. **This is the
   test that catches a wrong colour space.**

### 3.9 What landed

**Shipped**, in `CinematicPostFX3D`. All four checks pass: `test-lut-webgl.mjs` (3 assertions),
`test-runtime.mjs`, `test-extension.mjs`, `check-shaders.mjs`.

**Deviation from spec: a packed strip, not a `Data3DTexture`.** The spec assumed a `sampler3D`. That
is not reachable: the entire post chain is GLSL ES 1.00 — `gl_FragColor`, 64 `texture2D` calls
across ten shaders, no `#version` directive — and `sampler3D` does not exist in ES 1.00. Converting
the chain to GLSL3 to change one feature was not a proportionate trade. The implementation samples
an N-tile strip and interpolates the blue axis by hand.

**Consequence: the slice-bleed hazard is live again.** §3 removed that warning on the grounds that it
"does not apply once the data is a true 3D texture" — which is exactly the premise that no longer
holds. Hardware bilinear filtering near a tile edge would blend into the neighbouring blue slice.
Clamping the within-tile coordinate to texel centres, `(c * (N-1) + 0.5) / N`, keeps every sample at
least half a texel inside its own tile so the filter never crosses the boundary.

**Three hazards in GDevelop's own `getThreeTexture`**, each of which would have silently corrupted
every graded pixel:

1. It forces `colorSpace = SRGBColorSpace`. The table holds literal outputs; Three would decode them.
2. It forces `RepeatWrapping`, where the spec requires `ClampToEdgeWrapping`.
3. It returns a **cached, shared** texture, so mutating it would corrupt the same image everywhere
   else it is used.

The loader therefore builds a **fresh `THREE.Texture`** from the same image element rather than
mutating or cloning the manager's. Cloning is not sufficient: clones share a `Source`, and Three
keys its GPU upload by source, so a clone can inherit the original's `flipY`.

`flipY = false` is set explicitly — strips are authored with green increasing downward and Three
flips image textures by default. This is the green-axis flip §3 called the most common LUT bug.

**On the acceptance tests.** Test 1 passes at 0.5/255 against a 1/255 limit; test 2 at 0.96/255
against 2/255. Two mistakes were made writing them and both are worth recording, because each would
have produced a test that passed while proving nothing:

- Sampling the table with `NEAREST` quantised every input to 32 levels and defeated the very
  interpolation under test. The tests now use `LinearFilter`, matching what ships — which is also
  what makes them exercise the slice-bleed guard at all.
- The first known-response table was a gamma shift. Encode-pow-decode and a plain pow are
  numerically close and the two curves **cross**, so the minimum separation across probes was zero
  and the test could not discriminate. It is now an affine lift/gain, and the assertion is on the
  **maximum** separation. The correct and wrong pipelines now separate by 46/255, and a third
  assertion confirms the wrong pipeline actually fails the check — without that, test 2 could be
  passing for the wrong reason.

**Still owed:** the perf gate. §0 is not built, so the 4.0 ms post-chain budget is unmeasured. The
LUT adds two `texture2D` fetches and two transfer functions to one full-screen pass, which is
expected to be negligible, but that is an expectation and not a measurement.

---

## 4. Analytic height fog — CANCELLED

**Cancelled 2026-09-12 at the author's direction: fog is covered by the separate AdvancedWeather3D
extension.** Nothing in this phase will be built in AdvancedLighting3D. The existing fog actions
there are untouched; if they later need deprecating that is its own decision, not this phase.

The original text is kept below for reference only.

### Original scope

`AdvancedLighting3D.runtime.js:3898-3905` exposes three volumetric setters that no uniform consumes.

### Compositing design

Fog is a compositing operation on final radiance, **not part of light accumulation** — revision 1
placed it in the `lights_fragment_begin` injection, which would miss emissive contribution and
anything added after accumulation.

Required model:

- **Height-dependent density:** exponential falloff along +Z (this scene's up axis).
- **Integrated optical depth** along the view ray — the closed-form integral of exponential density
  between camera and fragment, not a point density sample.
- **Scattering colour**, with Henyey–Greenstein driving sun-facing inscatter from the existing
  `volumetricAnisotropy` parameter.
- **Composite as** `finalRadiance = transmittance * radiance + inscatter`, at the fog stage after all
  radiance is resolved.

Must define behaviour for: sky/background (no fragment depth — use far plane or skip), transparent
surfaces (per-layer or not at all: pick one and document it), and ordering against
`CinematicPostFX3D`'s tone map, which runs later in the chain and will re-map fogged values.

### API disposition

**Deprecate, do not delete.** The three actions are public API. Mark deprecated with a pointer to the
replacement; remove in a later major version. If the implementation does not land this cycle,
deprecation alone is the deliverable.

---

## 5. Spatiotemporal blue noise — experiment, not a guaranteed win

STBN's advantage is strongest *when filtered temporally*, and this plan deliberately avoids a temporal
filter. An animated mask without one can introduce frame-to-frame shimmer worse than the noise it
replaces.

Three-way comparison, both camera states, on scenes 2 and 3, against the GTAO slice search and SSR
ray offset:

| Variant | Stationary | Moving |
| :--- | :--- | :--- |
| Current sampling | baseline | baseline |
| Static spatial blue noise (no per-frame animation) | ? | ? |
| Animated STBN (128×128×64, `frameIndex % 64`) | ? | ? |

Scored with §0.3's temporal-delta and RMSE metrics. **Only after a variant wins both camera states**
may the bilateral blur radius be reduced, as a separate measured step.

Plausible outcome: static blue noise wins because it does not flicker. Record that if it happens.

---

## 6. Deferred: TAA and SSGI

### What Phase 2 does not fix

Per the paper's own limitations (§2) and Tardif's account, geometric specular AA addresses specular
highlight aliasing only. It does not address geometric-discontinuity aliasing, and it does not address
**material aliasing from runtime texture blending** — Tardif's stated reason for needing a temporal
component. Test scene 4 exists to measure exactly this.

### Reopen criteria

| Item | Reopen if |
| :--- | :--- |
| **SMAA T2x, then TAA** | Scene 4 shows material aliasing that Phase 2 + GDevelop's existing SMAA do not resolve, judged shipping-blocking. SMAA T2x is the cheaper first attempt. |
| **SSGI** | Phase 8 fails its gate *and* dynamic-occluder bounce is still wanted. SSGI needs *an* accumulator at viable sample counts — not necessarily full TAA. |

GDevelop's existing `SMAAPass` does **not** establish that MSAA is redundant; they address different
parts of the problem. Phase 7 measures it.

---

## 7. MSAA spike — timeboxed, may terminate in "no"

### Verification must be at framebuffer level

Reading back `renderTarget.samples` returns what was *requested*, not what was *allocated*. Required
checks, in order:

1. `gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE` after creation.
2. `gl.getParameter(gl.SAMPLES)` on the **bound** framebuffer — the actual allocated sample count.
3. **Resolved depth correctness.** This is the check most likely to fail and the one colour rendering
   cannot reveal: sample the depth texture in GTAO/SSR and confirm linearized depth matches known
   geometry distances in the test scene. A multisampled depth attachment that resolves incorrectly
   still renders colour perfectly while silently feeding garbage to every depth-dependent pass.
4. Measure against §0.1 budgets; compare against SMAA and Phase 2 on scenes 2 and 4.

Exit: if (1)–(3) fail or (4) exceeds budget, stop and **record the negative result here** so it is not
re-litigated.

---

## 8. Radiance Cascades — feasibility study, diffuse only

### Scope

[Split Radiance Cascades (2026)](https://arxiv.org/abs/2607.20384) targets **diffuse** GI and
evaluates both single-frame **and temporally accumulated** cases. Revision 1's "noise-free diffuse and
specular GI with no temporal accumulation" conflated the general/2D RC literature with this 3D paper.
The abstract publishes no frametime or memory figures.

**Commitment: an experimental diffuse-GI prototype.** Specular stays with the existing SSR pass.
Temporal accumulation is not ruled out for this phase.

### Distance is not radiance

`AdvancedLighting3D.runtime.js:1166` samples a **single-channel** `RedFormat` half-float distance
volume. A distance sample yields no albedo, no emission, no outgoing radiance. Required at a hit:

- **Hit normal** — SDF gradient via central differences (4–6 extra fetches per hit).
- **Albedo and emission** — *not present in any existing volume.* Needs a second volume texture or a
  surface cache. New baked data, new memory.
- **Lighting evaluation at the hit** — the clustered light loop exists but is written for fragment
  context, not an arbitrary world-space point.
- **Bounce and update policy** — one bounce or more; what invalidates a cached result.

### Sub-phases

| # | Work | Exit criterion |
| :--- | :--- | :--- |
| 8.1 | **Memory and execution feasibility on paper.** Cascade storage vs §0.1's 128 MB ceiling. Confirm WebGL2 can express the sparse hashmap at all — no compute shaders, no storage buffers. | Written analysis showing it fits, or a documented "no". |
| 8.2 | **Radiance representation.** Design and bake the albedo/emission volume; gradient hit normals. | **Radiance-domain:** for 64 fixed sample rays from marked points, returned radiance within **20% relative error** of the path-traced reference per ray. |
| 8.3 | **Single cascade**, no merging. | **Image-domain:** scene 1 RMSE ≤ **0.10** (normalised, marked floor/wall region) against the path-traced reference. |
| 8.4 | **Cascade hierarchy + ray splitting.** | Radiance discontinuity across the near/far cascade boundary ≤ **5%** of local radiance. |
| 8.5 | **Bilinear fix.** | Scene 3 peak radial deviation ≤ **10%** of reference at the same radius. |
| 8.6 | **Integrate** as a selectable alternative to the baked probe volume. | Within §0.1 budget; SSIM against reference ≥ the probe volume's measured SSIM. |

**Thresholds are fixed here, before the experiments run.** Revision 3 wrote "below the figure recorded
at 8.2", which let the threshold follow the result. It also used one number for two different
measurements: **8.2 measures per-ray radiance error, 8.3 measures image error over a region.** Those
are not interchangeable and now carry separate tolerances.

If a threshold proves wrong, change it deliberately and record *why* in §12 — do not silently move it
to whatever the implementation produced.

### Reference-renderer parity

An offline reference is only a reference if it matches. Before any 8.2–8.6 number is taken, verify the
path-traced render matches the GDevelop scene on **all** of:

- camera transform, FOV, and near/far
- light positions, colours, and intensities **in the same units** — GDevelop r160 uses legacy light
  units with a fixed `PI` scale (§9); the reference will be wrong by π if this is skipped
- **material albedo and roughness values**, not just "the same-looking material"
- **exposure and tone mapping** — compare in linear before ACES, or apply the identical curve to both
- **bounce count** — a 1-bounce prototype must be compared against a 1-bounce reference, not a fully
  converged one

**8.1 gates everything.** If WebGL2 cannot express the storage scheme, a spike before that analysis is
wasted.

### Honest limitations

- **The SDF is static and baked** (CPU narrow-band, 8 ms/frame budget, 128×128×32 default).
- **Dynamic lighting, qualified:** moving **analytic lights** can work, provided hit-point lighting is
  evaluated live from the clustered light data rather than baked. Moving **emissive geometry** will
  not — emission lives in a static baked volume. Revision 2's flat "dynamic emitters work" was wrong.
- **Dynamic occluders do not work** at all. Not Lumen; the docs must not imply it.
- Small penumbras resolve poorly — contact shadowing stays the SDF shadow pass's job.
- 3D RC is months-old research, unproven in production.
- Abandon if 8.1 or 8.2 fails. The baked probe volume already ships and works.

---

## 9. Validation rules for every phase

- **Node tests never compile GLSL.** `test-runtime.mjs` passing says nothing about whether a shader
  links; a broken shader silently draws nothing. `CinematicPostFX3D/check-shaders.mjs` is the static
  check. GDevelop preview is the only real one.
- **Preview every visual change in GDevelop.** The scene editor does not run events, so a JsCode-built
  object shows only its gizmo until it has a child object.
- **Watch for NUL bytes in built JSON.** They truncate `JsCode` and surface as
  `<Action> is not a function`. `node --check` never catches it.
- **The 3D scene root is Y-mirrored** (`scale.y = -1`) and up is **+Z**. All of Phase 8's world-space
  maths gets this wrong by default.
- **GDevelop r160 uses legacy light units** — irradiance carries a fixed `PI` scale.
- **Materials are shared game-wide.** Anything that mutates a material must clone and restore on destroy.

---

## 10. Order

```
0.  Baseline scenes, budgets, metrics, timing fallback   ── blocks everything
1.  Shader composition ownership + standalone compat     ── blocks Phase 2

3.  LUT                        ── independent; settle the colour pipeline before coding
2.  Specular AA                ── needs Phase 1; formula settled in §2
4.  Analytic fog               ── or deprecate-only

5.  Blue noise experiment   ─┐ independent of each other,
7.  MSAA spike              ─┘ both may terminate in "no"

8.  Radiance Cascades          ── 8.1 feasibility gates the rest
```

No time estimates until Phases 1 and 2 are implemented; the earlier "hours"/"~1d" figures were
withdrawn in revision 2 and are not restored.

### Which extensions each phase touches

Three extensions, plus `demos/`. Nothing else in the repo is modified.

| Phase | Extension | Files |
| :--- | :--- | :--- |
| **0** Baseline | `demos/` only | Four new scenes + scripted camera paths; capture/metric scripts |
| **1** Composition | **MaterialMaster** + **AdvancedLighting3D** | `ShaderChain.runtime.js` (version, shared registry, tracked reinstall); `AdvancedLighting3D.runtime.js` (embed shared ShaderChain, register its `lights_fragment_begin` injection as band 100); both `build-extension.mjs`; both test suites |
| **2** Specular AA | **MaterialMaster** | New injector registered at band 600–799 editing `lights_physical_fragment`; `PhysicalMaterial3D.runtime.js` for the clearcoat path; `build-extension.mjs`; `test-materialmaster.mjs` |
| **3** LUT | **CinematicPostFX3D** | `CinematicPostFX3D.runtime.js` (LUT pass + sRGB round-trip), `build-extension.mjs`, `check-shaders.mjs`, `test-runtime.mjs` |
| **4** Fog | **AdvancedLighting3D** | `AdvancedLighting3D.runtime.js` — new fog compositing stage, **not** the lighting injection; or deprecation-only edits to the three existing actions |
| **5** Blue noise | **CinematicPostFX3D** | `CinematicPostFX3D.runtime.js` — GTAO slice search and SSR ray offset; embedded STBN mask |
| **7** MSAA spike | **CinematicPostFX3D** | `CinematicPostFX3D.runtime.js:1616` target rebuild — the same code that already attaches the `DepthTexture` |
| **8** Radiance Cascades | **AdvancedLighting3D** | `AdvancedLighting3D.runtime.js` — new albedo/emission volume + bake, radiance march generalised from `sdfShadow`, cascade storage, probe-path integration |

`WeatherFX2D` and everything under `tools/` other than `CinematicPostFX3D` are
untouched.

### No new extension is created — and the coupling this introduces

This plan produces **no new standalone extension**. It upgrades three that already ship, and each
remains independently importable: someone who wants only the LUT imports CinematicPostFX3D and never
installs the other two.

**The exception is Phase 1, and it is the real architectural cost of this plan.** Today
AdvancedLighting3D and MaterialMaster know nothing about each other — which is precisely why they
collide on `onBeforeCompile`. Resolving that means both embedding the same versioned ShaderChain and
negotiating at runtime.

After Phase 1 they are still *separately installable* but no longer *independent*. The shared module
must handle:

- either extension installed alone
- either install order
- version skew between the two embedded copies
- upgrade migration with materials already live (§1)
- cleanup ownership when one extension is removed from a project mid-development

That is new surface area, and it is the genuine cost of Phase 2 — not the shader maths, which is now
fully specified. If Phase 1's verification proves harder than expected, the fallback is to put the
specular-AA injector inside AdvancedLighting3D's existing single injection instead and leave
MaterialMaster untouched. That keeps the two extensions independent at the price of specular AA only
working when AdvancedLighting3D is installed. **Decide this at Phase 1's exit, not after Phase 2 is
written.**

Merging the three into one extension is *not* the answer: they serve different concerns, and
`docs/MATERIAL-CONSOLIDATION-PLAN.md` already established the principle — property-override behaviors
merge, shader-injection systems stay separate.

### Scope boundary: only these three extensions

**Everything outside AdvancedLighting3D, MaterialMaster and CinematicPostFX3D is out of scope** and is
not a gate on any phase here. That includes `WeatherFX2D` and all of `tools/` apart
from CinematicPostFX3D.

One known consequence, recorded rather than handled: **Portal3D also assigns `onBeforeCompile`
directly** (`Portal3D.runtime.js:280`), so it will collide with whichever of the in-scope systems
patches the same material last. This is not being fixed. Add one line to the AdvancedLighting3D and
MaterialMaster READMEs noting the incompatibility — that is the whole obligation, and it costs nothing.

### Material replacement inside the three — this one is in scope

`MaterialMaster/MaterialController3D.runtime.js`, `AdvancedLighting3D.runtime.js` and
`CinematicPostFX3D.runtime.js` all construct `new THREE.Mesh*Material`. Replacing a material throws
away `onBeforeCompile`, `customProgramCacheKey` and the chain state with the discarded object, with no
error — `docs/MATERIAL-CONSOLIDATION-PLAN.md` already records this as a live bug.

This is not an external-extension problem; MaterialMaster does it to itself. ShaderChain's
`isInstalled()` exists for exactly this case.

**Phase 1 must add a re-install check on the per-frame tick** so a replaced material is re-patched
rather than silently losing its injection.

### CinematicPostFX3D renders the scene more than once

`CinematicPostFX3D.runtime.js:1610`, `:1766` and `:2120` each issue their own `renderer.render(...)`.
Phases 3, 5, 7 and 8 must account for this within the extension's own chain:

- **Depth provenance** — a depth-dependent pass reads whatever camera rendered last. Confirm GTAO, SSR
  and any RC screen-space component sample the main camera's frustum.
- **Cost** — an extra scene render re-runs every shader injection, so a specular-AA or RC cost measured
  against a single render is optimistic.

Verify both on test scenes 1–4. No additional test scene is needed now that out-of-scope extensions
are excluded.

### Deliverable form — everything here stays an importable extension

No phase requires forking GDevelop, patching GDJS, or shipping a custom engine build. Every technique
reaches the renderer through APIs the extensions already use:

| Mechanism | Already used by |
| :--- | :--- |
| `material.onBeforeCompile` + `customProgramCacheKey` | AdvancedLighting3D, MaterialMaster (ShaderChain) |
| `layerRenderer.addPostProcessingPass(pass)` | CinematicPostFX3D (4 call sites) |
| Rebuilding the composer's render targets | CinematicPostFX3D:1616 (DepthTexture attachment) |
| `THREE.Data3DTexture` volume bakes | AdvancedLighting3D (SDF + probe volumes) |
| Versioned runtime install on scene load | AdvancedLighting3D (`RUNTIME_VERSION`) |

Two qualifications:

**Phase 0 is tooling, not a shipped extension.** The test scenes are GDevelop projects and the capture
and metric scripts are Node/harness code. They live in the repo and never enter an extension JSON.

**Phase 7 is the only phase reaching into GDevelop-owned objects.** Rebuilding the layer's composer
targets to add `samples` mutates state GDevelop constructs and owns, so it is the one item here that
can break on a GDevelop update without any change on our side. That is already true of the existing
`DepthTexture` rebuild; Phase 7 widens the exposure. Weigh that against its result before adopting it,
and note it in the extension README if it ships.

### One packaging constraint: the STBN mask

**None of the three extension JSONs currently embeds a single base64 blob** — they are pure JS source.
A 128×128×64 scalar STBN mask is 1 MB raw, roughly 1.4 MB base64, which would nearly double
AdvancedLighting3D's 1.6 MB JSON and set a precedent for binary payloads in these files.

Options, in preference order:

1. **Smaller mask** — 64×64×16 is 64 KB raw / ~87 KB base64. Test whether it is sufficient for the
   GTAO and SSR sample counts actually in use before assuming the full size is needed.
2. **Procedural generation at load** — a hash- or R2-sequence approximation of blue noise, generated
   once on scene load. No payload at all; quality is lower than a void-and-cluster mask.
3. **Ship as a project asset** — the user adds a texture file. Keeps the JSON clean but adds a setup
   step and breaks the single-file import story.

Do not run true void-and-cluster generation at load; it takes seconds, not milliseconds. Decide this
in Phase 5 before writing the sampler, since it changes where the mask comes from.

---

## 10.5 Related: local-light shadow maps (AdvancedLighting3D)

Not part of this plan's phases, but the same three extensions and the same budgets. Clustered spot
and point lights currently have exactly one shadow source — the baked SDF — which is static-only and
needs an authored bounds cube. Real depth maps for those lights are specified in
[../AdvancedLighting3D/LOCAL_SHADOW_MAPS_PLAN.md](../AdvancedLighting3D/LOCAL_SHADOW_MAPS_PLAN.md).
It borrows §0.1's hardware floor and memory ceiling and §0.3's measurement method directly.

## 11. Open questions before coding

- §2: pick the `SIGMA2` default empirically on scene 2; 0.15 is a starting point, not a result. The
  equation choice is settled (Eq. 4), so this is the only free parameter.
- §1: confirm the (a)+(b) migration strategy survives a GDevelop editor re-import with live materials
  — that is the real-world trigger, not a synthetic test.
- §8: choose the offline reference renderer and confirm it can be driven to match the parity
  checklist. If matching light units and bounce count is impractical in the available tool, the RMSE
  gates are not usable and §8 needs a different acceptance basis before starting.

Resolved since revision 3: LUT domain (sRGB-to-sRGB only, §3), specular AA equation (Eq. 4, §2).

---

## 12. Revision log

### Revision 3 → 4 (external review, third round)

| # | Revision 3 said | Corrected to |
| :--- | :--- | :--- |
| 1 | Quoted Eq. 5 (`min(σ²·X, κ)`) beside Listing 2's code (`min(2.0·variance, κ)`) | They disagree by a factor of two. Listing 2 implements **Eq. 4** (§4.5, conservative); Eq. 5 (§4.6) is the less conservative alternative and is what Listing 2's "red code removed" note refers to. Settled on Eq. 4, noting the two differ only by a factor in `SIGMA2` and need no second code path. |
| 2 | (not mentioned) | `geometryRoughness` is applied to **`material.clearcoatRoughness`** as well as `material.roughness`. Removing it silently regresses clearcoat filtering — live in this repo via `PhysicalMaterial3D`. T&K must be applied to both; clearcoated sphere added to scene 2. |
| 3 | Shimmer = `mean(abs(f[n] - f[n-1]))` | Does not isolate shimmer: legitimate camera motion counts, so a blurrier image wins. Changed to temporal change **in error** against a matched supersampled reference sequence; raw delta retained only for stationary camera; motion clip kept for visual review. |
| 4 | CPU wall-clock as the timing fallback | Cannot certify a GPU budget — it measures async submission, and frame time folds in presentation pacing. Kept as coarse end-to-end evidence only; GPU-pass timing is now marked **unavailable** when timer queries are absent, and unavailable is not a pass. |
| 5 | ShaderChain: version + re-register injectors | Insufficient. `install()` closes over the module-private `injectors` array, so replacing the namespace leaves existing materials dispatching into the old registry. Added shared-registry + tracked-reinstallation strategy and an explicit upgrade-with-live-materials test. |
| 6 | LUT: "if the domain is log, steps 2 and 4 change accordingly" | Understates it — log LUTs differ in gamut and scene/display reference too. Narrowed to a single documented **sRGB-to-sRGB, Rec.709, display-referred** contract; log/ACES is out of scope, not a flag. |
| 7 | §8.3 gate: "below the figure recorded at 8.2" | Circular, and conflated per-ray radiance error with region image error. Separate numeric tolerances now fixed **before** the experiments run, plus a reference-parity checklist covering materials, exposure, light units and bounce count. |

### Revision 2 → 3 (external review, second round)

| # | Revision 2 said | Corrected to |
| :--- | :--- | :--- |
| 1 | "T&K 2019, apply to the perturbed normal, max against Three's term" | Formula now stated in full (Listing 2 / Eq. 5) with the α² domain made explicit. `max()` against Three's term was **dimensionally incoherent** — Three adds in `r`, T&K in `α²`. Decision: replace, don't combine. |
| 2 | "normal-map aliasing is covered" | Too broad. Screen-space derivatives cannot recover detail lost to mip minification; that needs Toksvig/LEAN. Claim narrowed, and the paper's own four stated limitations quoted. |
| 3 | LUT "applies after tone mapping" | Tone-mapped ≠ sRGB-encoded. Full sequence specified: ACES → sRGB OETF → LUT → sRGB EOTF → OutputPass. Added `NoColorSpace` on the texture. |
| 4 | Identity-LUT test as the gate | An identity LUT round-trips in *any* colour space, so it cannot catch the error it was meant to. Added a known-response LUT cross-checked against the authoring tool. |
| 5 | "plausible bounce", "not worse", "below threshold" | Replaced with defined metrics in §0.3: temporal delta over 120 frames, RMSE/SSIM against supersampled and path-traced references, radial deviation for ringing, median+p95 over 200 frames for timing. |
| 6 | (not mentioned) | §0.4 added: `EXT_disjoint_timer_query_webgl2` may be unavailable; CPU wall-clock toggle-differencing fallback specified, with a rule never to compare across methods. |
| 7 | "Make ShaderChain the owner" | Added standalone-extension compatibility: AdvancedLighting3D must work without MaterialMaster. Identified the real hazard — ShaderChain's guard is existence-only with no version check, so an older embedded copy silently wins. Version + upgrade path + cleanup ownership now specified. |
| 8 | MSAA: "assert the actual sample count" | Insufficient. Added `checkFramebufferStatus`, `gl.getParameter(gl.SAMPLES)` on the bound FBO, and **resolved-depth correctness in GTAO/SSR** — the failure colour rendering cannot reveal. |
| 9 | "Dynamic emitters work" | Wrong. Moving **analytic lights** can work if hit-point lighting is live; moving **emissive geometry** cannot, because emission is baked static. |
| 10 | §1 implied chunk adjacency causes the hook collision | Reworded. The collision is from both systems assigning the same callback, and is total regardless of chunk. Adjacency is a separate, second risk (semantic conflict). |

### Revision 1 → 2 (external review, first round)

| # | Revision 1 said | Corrected to |
| :--- | :--- | :--- |
| 1 | Inject at `roughnessmap_fragment`, ShaderChain order 500 | That chunk runs before normals exist. Moved to `lights_physical_fragment`, band 600–799. |
| 2 | (not mentioned) | Three r160 **already** applies `geometryRoughness` from `dFdx/dFdy(nonPerturbedNormal)`. |
| 3 | Hook collision is "a five-minute test" | Promoted to blocking prerequisite §1. |
| 4 | RC gives "noise-free diffuse and specular GI with no temporal accumulation" | Paper is **diffuse only** and evaluates temporal cases. Narrowed to an experimental diffuse prototype. |
| 5 | "Generalise `sdfShadow` into a radiance-returning march" | Distance ≠ radiance. Added §8.2. |
| 6 | Week-long RC spike first | Memory + WebGL2 feasibility (§8.1) gates the spike. |
| 7 | LUT strip slice-bleed warning after unrolling to 3D | Contradictory; removed. |
| 8 | Fog in the `lights_fragment_begin` injection | Wrong stage. Compositing model added; API deprecated rather than deleted. |
| 9 | Blue noise → "then reduce the blur radius" | Assumed the win. Now a three-way comparison. |
| 10 | TAA/SSGI "explicitly not doing" | Reframed as measured scope decisions with reopen criteria. |
| 11 | "hours"/"~1d" estimates | Withdrawn. |

---

## 13. References

- Tokuyoshi & Kaplanyan, *Improved Geometric Specular Antialiasing* (I3D 2019) — Listing 2, Eq. 5,
  κ = 0.18, and §6 Limitations —
  <https://www.jp.square-enix.com/tech/library/pdf/ImprovedGeometricSpecularAA.pdf>
- Kaplanyan et al., *Filtering Distributions of Normals for Shading Antialiasing* (HPG 2016) — the
  original slope-space method this improves on.
- Toksvig, *Mipmapping Normal Maps* (2005); Olano & Baker, *LEAN Mapping* (I3D 2010) — the
  complementary techniques for normal-map mip aliasing, out of scope here.
- *Stable Geometric Specular Antialiasing with Projected-NDF* (JCGT 10:2) —
  <https://www.jcgt.org/published/0010/02/02/paper.pdf>
- Three.js r160 `meshphysical.glsl.js` (chunk order) and `lights_physical_fragment.glsl.js`
  (existing `geometryRoughness`) — verify against the pinned r160 tag, not `dev`.
- *Split Radiance Cascades: Real-Time GI via Sparse Radiance Probes* (2026) —
  <https://arxiv.org/abs/2607.20384>
- Sannikov, *Radiance Cascades* overview — <https://m4xc.dev/articles/fundamental-rc/>
- Wolfe et al., *Spatiotemporal Blue Noise Masks* — <https://arxiv.org/abs/2112.09629>
- Tardif, *A Failed Adventure in Avoiding Temporal Anti-Aliasing* —
  <https://alextardif.com/Antialiasing.html>
