# CinematicPostFX3D — Implementation Notes

How the pipeline is wired into GDevelop, the constraints that shaped it, and the maths behind each pass.

---

## 1. Where the pass lives

A GDevelop 3D layer builds its own composer in `layer-pixi-renderer.js`:

```js
this._threeEffectComposer = new THREE_ADDONS.EffectComposer(threeRenderer);
this._threeEffectComposer.addPass(new THREE_ADDONS.RenderPass(scene, camera));
if (antialiasing !== 'none') composer.addPass(new SMAAPass(w, h));
composer.addPass(new OutputPass());
```

`addPostProcessingPass(pass)` inserts before SMAA/OutputPass, so the chain is:

```
RenderPass -> [CinematicPostFXPass] -> SMAA -> OutputPass -> screen
```

Two consequences worth knowing:

- **`renderer.toneMapping` is never set**, so `OutputPass` only does the sRGB conversion. Our ACES curve is the only tone map in the chain — no double grading.
- **`renderer.autoClear = false`.** Every intermediate pass draws a full-screen quad with `depthTest: false`, which covers the target completely, so no explicit clears are needed.

---

## 2. The depth attachment

`new EffectComposer(renderer)` with no target argument creates:

```js
new WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: HalfFloatType })
```

`depthBuffer` defaults to `true`, but that is a **renderbuffer** — write-only, not sampleable. `readBuffer.depthTexture` is `null`, and any pass that samples a depth uniform gets an empty texture reading `0.0` everywhere.

Assigning `depthTexture` at render time does not help. `WebGLRenderer.setRenderTarget` only rebuilds a target when its framebuffer has not been created yet:

```js
if (properties.__webglFramebuffer === undefined) textures.setupRenderTarget(renderTarget);
else if (properties.__hasExternalTextures) textures.rebindTextures(...);
```

By the time our pass runs, `RenderPass` has already caused setup. So the fix is to **dispose the target first**, which clears the cached framebuffer, then attach:

```js
rt.dispose();                                 // forces a rebuild on next bind
const dt = new THREE.DepthTexture(rt.width, rt.height);
dt.format = THREE.DepthFormat;
dt.type   = THREE.UnsignedIntType;            // DEPTH_COMPONENT24
rt.depthTexture = dt;
```

**Both** ping-pong targets need one. `RenderPass.needsSwap === false`, and three passes per frame do swap, so `renderTarget1` and `renderTarget2` alternate as the scene buffer from one frame to the next.

**Timing.** `EffectComposer.insertPass()` calls `pass.setSize()` on attach, and `EffectComposer.setSize()` resizes both targets *before* calling each pass's `setSize()`. That makes `Pass.setSize` the correct hook for both the initial attach and every resize.

**Resize.** `WebGLRenderTarget.setSize()` resizes `this.texture.image` and calls `dispose()` — but it does **not** touch `depthTexture.image`. Left alone, a resize produces a colour attachment at the new size and a depth attachment at the old one: an incomplete framebuffer. `setSize` re-syncs the dimensions and disposes again.

Composer targets are created with `samples = 0`, so there is no MSAA resolve to work around.

---

## 3. Scene scale

`Layer.getCameraZ(fov)` is:

```js
0.5 * this.getHeight() / this.getCameraZoom() / Math.tan(0.5 * toRad(fov))
```

For the defaults — 600px tall, zoom 1, 45° — that is **724 world units**. Near and far default to `0.1` and `2000`.

Two things fall out of this.

**World-space parameters must be in the tens or hundreds.** A 1.2-unit AO radius on geometry 724 units from the camera projects to under a pixel.

**A raw depth cutoff is useless.** Window depth for a perspective projection is:

$$d = \frac{f + n}{2(f - n)} \cdot 2 - \frac{f \cdot n}{(f-n) \cdot z} \cdot 2 \cdot \tfrac{1}{2} \quad\Rightarrow\quad d \approx 1.00005 - \frac{0.100005}{z}$$

| z (units) | 10 | 100 | 724 | 2000 |
| :--- | ---: | ---: | ---: | ---: |
| raw depth | 0.99005 | 0.99905 | 0.99991 | 1.0 |

A `rawDepth >= 0.999` sky test rejects everything past **~95 units** — the entire scene. Every pass therefore linearises first and compares against the far plane:

```glsl
float rawToLinear(float d) {
  if (uIsOrtho == 1) return uNear + d * (uFar - uNear);
  float zNdc = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - zNdc * (uFar - uNear));
}
bool isSky(float linearZ) { return linearZ >= uFar * 0.995; }
```

`uNear`, `uFar` and `uIsOrtho` are uploaded to every depth-reading pass from the live layer camera.

---

## 4. Per-pass notes

### A. Ground Truth Ambient Occlusion

Four screen-space slices, six horizon steps per side, at whatever `EffectQuality` selects (half by default).

For each slice, a plane is built through the view vector `V = normalize(-P)` and the slice direction, the surface normal is projected into it, and the signed angle of that projection is `γ`. Horizon angles `h₁` (toward `+tangent`) and `h₂` (toward `−tangent`) start at `±π/2` and close in as occluders are found, faded by distance so a sample at the radius edge contributes nothing.

After clamping the arc to the normal-oriented hemisphere:

$$\theta_1 = \gamma + \min(h_1 - \gamma, \tfrac{\pi}{2}), \qquad \theta_2 = \gamma + \max(h_2 - \gamma, -\tfrac{\pi}{2})$$

the inner integral is the Jimenez et al. (2016) arc form:

$$a_h = \tfrac{1}{4}\Big(-\cos(2\theta_1 - \gamma) + \cos\gamma + 2\theta_1\sin\gamma\Big) + \tfrac{1}{4}\Big(-\cos(2\theta_2 - \gamma) + \cos\gamma + 2\theta_2\sin\gamma\Big)$$

weighted by the projected normal length and averaged over slices. An unoccluded hemisphere integrates to exactly `1.0` — asserted in the test suite.

The world radius is converted to a pixel radius per fragment using `projectionMatrix[1][1]`:

```glsl
radiusPixels = uRadius * uProjScale * 0.5 * uResolution.y / linearZ
```

Interleaved gradient noise rotates the slice set per pixel to break up four-direction banding — `fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))))`, which distributes far better than a `fract(sin(...))` hash and does not band at mediump precision. A **separable bilateral blur then runs on both axes** with a depth tolerance of `5%` of the centre depth, so edge stopping works at any scene scale.

**Upsampling.** The AO and reflection buffers are smaller than the frame (`EffectQuality`), and reading them back with plain bilinear filtering bleeds them across depth discontinuities — a visible halo around every object. Both are gathered with four taps whose weights come from how close each neighbour's linear depth is to the centre, with the four depth fetches shared between the two buffers. If every neighbour is rejected (an isolated sliver of geometry) it falls back to bilinear rather than punching a hole.

**Ordering.** AO and reflections are folded into the colour buffer by a merge pass *before* Depth of Field, not by the composite afterwards. Applied at the end they stay razor sharp on a surface the defocus has already blurred, which is very visible with an open aperture. The merge pass only runs when DOF is active alongside AO or SSR; otherwise the composite applies them directly and the pass is skipped. The AO/SSR application itself lives in one shared GLSL snippet used by both shaders.

**Multi-bounce** is applied in the composite pass, where the scene colour is available as an albedo estimate. It uses the polynomial fit, which is clamped to never darken:

$$\text{mb}(x, a) = \mathrm{clamp}\big(x(a_1x^2 + b_1x + c_1),\ x,\ 1\big)$$

with `a₁ = 2.0404a − 0.3324`, `b₁ = −4.7951a + 0.6417`, `c₁ = 2.7552a + 0.6903`.

### B. Screen-Space Reflections

Runs at `EffectQuality` resolution. Reflect the view vector about the depth-derived normal, reject rays heading back toward the camera, then march in screen space with the step count from `SSRRaySteps` (8–64). Ray length and surface thickness both scale with view depth:

```glsl
rayLen    = min(uMaxDistance, max(1.0, linearZ * 2.0));
thickness = max(0.5, linearZ * 0.02);
```

A hit is `deltaZ < 0 && deltaZ > -thickness`, refined by four bisection steps. The final alpha is `intensity × edgeFade × distanceFade × fresnel`, where fresnel is `mix(1.0, (1 - N·V)⁵, uFresnel)`.

**The reflectivity mask.** A screen-space raymarch has no idea which surfaces are supposed to be reflective, so an ungated SSR pass mirrors the world onto floors, terrain and walls. At the default Fresnel of 0.6 a ground plane picks up roughly a 25% mirror — clearly wrong, and it flickers as the raymarch hits and misses between frames.

Before marching, the pipeline renders `layerRenderer.getThreeGroup()` once with every mesh's material temporarily swapped for a cached `MeshBasicMaterial` whose colour encodes:

$\text{reflectivity} = (1 - \text{roughness})^2 \cdot (0.25 + 0.75\,\text{metalness})$

Squared so the falloff away from a polished surface is quick; the `0.25` floor is there because a polished dielectric still reflects. Materials with no `roughness` fall back to `shininess / 100` (Phong) or score zero (Basic/unlit). Transparent materials are skipped, and `mesh.userData.ssrReflectivity` overrides everything.

GDevelop's default 3D material is `roughness 1, metalness 0`, which scores exactly zero — so out of the box nothing reflects, and reflectivity is opt-in.

Details that matter:

- The **group** is rendered, not the scene, so the 2D rendering plane at `z = 0` stays out of the mask.
- Mask materials are cached per source material, but their colour is recomputed every frame, so runtime roughness/metalness edits take effect immediately.
- Original materials are restored immediately after the render. A leaked swap would leave meshes flat grey in the visible frame.
- Multi-material meshes are skipped rather than guessed at.
- The mask target is the only intermediate created with `depthBuffer: true`, because it is the only one that renders real geometry and has to depth-sort.
- The swap/restore is wrapped in `try/finally`. A throw in between would otherwise leave every mesh in the scene wearing a flat grey material for the rest of the session.
- The cache is a `WeakMap` keyed by source material. A plain `Map` pins every material the scene has ever rendered and stops it being collected; the mask materials we create are tracked in a separate array so they can still be disposed.

The pass largely pays for itself: the SSR shader rejects any pixel below `0.01` reflectivity before marching a single ray, and in a typical scene that is most of the screen.

`SSRSurfaces: Everything` skips the mask pass and restores uniform reflection.

**The resolve pass.** The mask writes reflectivity to red and roughness to green, and a blur pass after the raymarch widens its radius with that roughness — the roughness cone blur the original docs promised, now possible because the mask exists. Two properties keep it safe: the radius floor is one pixel, so a mirror is only cleaned up rather than softened, and a pixel whose own alpha is zero is passed through untouched, so a reflection can never grow outward onto a surface that produced none.

### C. Bokeh Depth of Field

A literal thin-lens CoC in world units scales with the focus distance, which is exactly why a 50 mm lens focused at "4" saturated every pixel of a scene sitting 700 units out. The defocus term used here is dimensionless:

$$\mathrm{CoC}(z) = \mathrm{clamp}\!\left(\frac{|z - z_f|}{z} \cdot \frac{k}{N},\ 0,\ 1\right) \cdot R_{\max}, \qquad k = 2.8$$

`k` calibrates the f-stop so that at `f/2.8` a subject at twice the focus distance lands on half the maximum radius. The result is identical at any world scale — asserted in the test suite.

Sampling is 16 golden-angle spiral taps. Foreground samples are weighted by `sCoC / centerCoC`, which is what stops a sharp foreground smearing across a blurred background.

**Autofocus** raycasts screen centre against `layerRenderer.getThreeGroup()` — *not* the layer scene, which contains the 2D rendering plane at `z = 0` with `renderOrder = MAX_SAFE_INTEGER` and would swallow every hit. The ray is bounded by the camera's own near and far planes, so it does not test geometry that could never be in focus, and meshes carrying `userData.cinematicIgnoreAutofocus` are skipped — which is what stops a camera-locked first-person prop owning the focus plane forever. It runs every third frame and eases the focus plane at `0.15` per frame, giving a natural focus pull. With no hit it falls back to the manual distance.

### D. 13-Tap Karis Bloom

Five mips starting at half resolution. The downsample is the standard 13-tap arrangement — one centre box at weight `0.5` and four corner boxes at `0.125`, **each containing the centre tap**. The first mip weights each sub-box by `1 / (1 + luma)` to suppress fireflies and applies the luminance threshold; later mips use a plain box average.

The upsample is progressive and **additive**:

```
up[n-2] = tent(down[n-1]) + down[n-2]
up[i]   = tent(up[i+1])   + down[i]
```

Without the additive term the pyramid collapses to the smallest mip blurred repeatedly and every mid-frequency component of the glow is lost.

**Bloom samples the scene from before Depth of Field.** This is deliberate and is the one place the pipeline departs from physical ordering. Reading the DOF output couples glow brightness to the focus plane, and the focus plane is not static: autofocus re-raycasts every third frame and eases toward whatever the crosshair hits, which changes constantly while the camera moves. Defocusing a bright highlight spreads its energy and lowers its peak, which can push it under the bloom threshold entirely — so the glow switches off and back on as focus drifts. Because the threshold makes it bistable, that reads as a hard flicker rather than a shimmer. Sampling before the defocus means a blurred highlight blooms as though it were sharp, which is a small static inaccuracy in place of a large moving one.

Anamorphic streaks get their own pass: a 13-tap horizontal-only blur of the finished bloom buffer at a wide stride. The look comes from a lens whose aperture is far wider than it is tall, so highlights smear sideways and nowhere else — the previous two-tap version inside the composite was a lateral smear, not a streak. The pass is skipped entirely at zero flare strength.

### E. Motion Blur

World position is reconstructed from depth and the inverse view-projection matrix, reprojected through the previous frame's view-projection, and the NDC delta becomes a velocity vector. Six samples along it, all taken from the same colour buffer.

**Velocity is ramped, not gated.** Blur strength is `smoothstep(0.0004, 0.0025, |v|) * (1 - smoothstep(0.06, 0.12, |v|))` and the result is blended by that strength. This matters more than it looks: velocity is derived from each pixel's *own* depth, so a fixed threshold is crossed by neighbouring pixels on different frames, and patches of the screen snap between blurred and sharp every frame while the camera moves. That is what flicker is. The upper ramp still suppresses the enormous smear on the first frame after a teleport, but fades into it rather than switching.

This is camera velocity only — per-object motion vectors would need a G-buffer.

### F. Tone Mapping

ACES Filmic `x(2.51x + 0.03) / (x(2.43x + 0.59) + 0.14)`, Reinhard, Cineon, or Linear. `MasterIntensity` crossfades between the untouched scene colour and the graded result, so `0.0` is a real bypass.

---

## 5. Buffers

| Target | Resolution | Format |
| :--- | :--- | :--- |
| Composer rt1 / rt2 (GDevelop's, we attach depth) | Full | RGBA16F + DEPTH_COMPONENT24 |
| GTAO / GTAO blur (ping-pong) | `EffectQuality` | RGBA8 |
| SSR reflectivity mask | `EffectQuality` | RGBA8 + depth |
| SSR raymarch | `EffectQuality` | RGBA16F |
| SSR resolve | `EffectQuality` | RGBA16F |
| AO/SSR merge (only with DOF) | Full | RGBA16F |
| Anamorphic streak (only with flares) | 1/2 | RGBA16F |
| DOF | Full | RGBA16F |
| Bloom pyramid, 5 down + 5 up | 1/2 → 1/32 | RGBA16F |

All intermediates are created with `depthBuffer: false` except the reflectivity mask, which is the only one that renders real geometry and has to depth-sort.

**Allocation is lazy.** Creating every buffer up front costs about 62 MB at 1080p regardless of what is switched on, and every effect defaults to off. Each pass now calls `_rt(name, w, h, hdr, depth)` the first time it runs, which creates or resizes that one target. `_ensureTargets` only tracks the frame size and quality divisor, disposing the whole set when either changes.

---

## 6. Behavior model

The compositor is **per-renderer**, not per-object. The behavior is just a handle on it, which has consequences the code makes explicit:

- The first registered instance drives the pipeline. Later instances log a warning and set `__cinematicIgnored`, so they cannot fight over settings each frame.
- `doStepPreEvents` re-reads every property into the live settings, so inspector edits and `Set…` actions both work. Every `Set…` action therefore also writes back to the behavior property, or the sync would revert it on the next frame.
- The `Preset` property is applied **once at creation** and written back into the behavior's properties, which is what keeps it consistent with the per-frame sync. `Custom` skips this.
- The runtime is embedded in `onCreated` only. `onCreated` always precedes `doStepPreEvents` for the same behavior, and every action guards on `gdjs.__cinematicPostFX3D` existing.

---

## 7. Known gaps

- No real normal buffer or per-object motion vectors. Normals are reconstructed from depth with a best-of-four-neighbours pick, which is stable in interiors and noisier on thin silhouettes. The reflectivity mask pass could be extended to output view normals too, which would fix this for both SSR and GTAO, but a custom shader would lose the automatic skinning/morph support that `MeshBasicMaterial` gives for free.
- Reflections are mirror-sharp; there is no roughness-driven cone blur.
- One layer per pipeline.
- No temporal accumulation, so GTAO and SSR carry the noise a single frame gives them. The bilateral blur and depth-aware upsample handle most of the AO case; SSR still shimmers on moving geometry.
- No measured frame-time budget. The pass counts are known (GTAO 3, SSR 1 plus a mask scene render, merge 1, DOF 1, bloom 9, streak 1, composite 1) but the cost depends entirely on resolution and scene content.
