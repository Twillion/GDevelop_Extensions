# Changelog

## 2.6.0 — The actual flicker: binary gates on per-pixel values

With every effect enabled, the flicker was **motion blur**, and it was two bugs in four lines.

```glsl
if (velLen > 0.0005 && velLen < 0.1) {   // hard gate
  vec3 blurAccum = finalRGB;             // centre tap from the composited image...
  for (int m = 1; m < 6; m++)
    blurAccum += texture2D(tColor, ...); // ...the other five from the raw scene
  finalRGB = blurAccum / 6.0;
}
```

- **The velocity test was a binary gate on a per-pixel quantity.** Velocity is reconstructed from each pixel's own depth, so neighbouring pixels cross any fixed threshold on different frames. Patches of the screen therefore snap between blurred and sharp every frame while the camera moves. Strength is now a `smoothstep` ramp in and out, and the result is blended by it.
- **The taps were mixed from two different buffers.** The accumulator was seeded with the fully composited colour (ambient occlusion, reflections and bloom included) and the remaining five samples came from the raw scene colour. The instant the gate flipped on, every affected pixel jumped from 100% composited to five-sixths raw — a large brightness step, which is what made the toggling so visible. All six taps now come from the same buffer.

**Also softened:** SSR rejected reflection rays on `R.z > 0.0`, a hard sign test sitting exactly where the depth-reconstructed normal is noisiest, so grazing surfaces flipped between reflecting and not. It now fades out across a small angular band.

**Regression guard.** `check-shaders.mjs` now fails the build on any branch that gates a per-pixel continuous value (velocity, reflection direction, circle of confusion, brightness) without a ramp. Genuinely binary tests — a raymarch hit, a normal facing check — are listed explicitly with the reason. Verified both ways: the current shaders pass, and reintroducing the original velocity gate fails the build.

**Note on the previous two releases.** The bloom threshold colour space (2.3.0) and the bloom/focus coupling (2.5.0) were real bugs and remain fixed, but neither was this symptom. This one only manifests while the camera moves, which is precisely when motion blur is the only effect doing anything different.

---

## 2.5.0 — Bloom decoupled from focus

The flicker reported against 2.3.0 and 2.4.0 was not in the bloom pyramid at all.

**Bloom was sampling the Depth of Field output.** Depth of Field is not static while the camera moves: autofocus re-raycasts every third frame and the focus plane eases toward whatever the crosshair happens to hit, so the Circle of Confusion changes continuously. Defocusing a bright highlight spreads its energy and lowers its peak — which can push it under the bloom threshold entirely. The glow then switches off and back on as focus drifts. Because a threshold is a hard boundary, that presents as a flicker rather than a shimmer, and it only happens when Depth of Field is enabled, which is true of `CyberpunkNeon`, `CinematicMovie` and `HorrorGrim`.

- **Bloom now samples the scene from before the defocus.** A defocused highlight blooms as though it were sharp, which is a small static inaccuracy in place of a large moving one. A regression test asserts the pyramid never reads the depth-of-field target.
- **The autofocus ease was slowed from 0.15 to 0.08 per frame.** The raycast target jumps whenever the crosshair crosses an object edge, which is constant while moving; a slower ease turns those steps into a pull rather than a lurch.

The pyramid fixes in 2.3.0 and the clamp and radius controls in 2.4.0 remain correct and worth having — the tent upsample genuinely was doing no blurring, and the threshold genuinely was in the wrong colour space. They were just not the cause of this particular symptom.

**Tests:** 81 → 82 runtime assertions.

---

## 2.4.0 — Bloom stability in motion

Follow-up to 2.3.0, addressing the symptom actually reported: bloom flickering while the camera moves.

The likely cause was the tent-upsample bug fixed in 2.3.0 — with its offsets collapsed to sub-texel distances the upsample chain did no blurring at all, so the pyramid summed sharp aliased mips and every bright sub-pixel feature shimmered under motion. Bloom's entire temporal stability comes from that progressive blur. Two standard mitigations on top of it:

- **`BloomMaxBrightness` (Bloom Firefly Clamp, default 12.0).** Bounds how bright a single pixel may be before it enters the pyramid. One specular glint at 50.0 moving between texels can swing a whole mip frame to frame; clamping the input bounds that swing. This is the first thing to lower if flicker persists.
- **`BloomRadius` (default 1.0).** Width of the blur at each pyramid step. Wider is softer and noticeably more stable in motion. This also brings the extension to parity with GDevelop's built-in bloom, which exposes strength, radius and threshold.

Both come with actions, and `BloomRadius` with an expression.

**Tests:** 80 → 81 runtime assertions.

---

## 2.3.0 — Bloom actually blooms

**Bloom was producing nothing at all.** Three bugs, the first fatal:

- **The threshold was applied in the wrong colour space.** The composer buffer is linear HDR — GDevelop converts to sRGB in `OutputPass` at the very end — but the default threshold of `0.9` had been chosen as if it were a display value. In linear light a surface that looks bright grey on screen is only about `0.6`, so `0.9` needs roughly sRGB 0.96 to pass: the first mip zeroed the entire image and bloom added exactly nothing. `HorrorGrim` at `1.2` could never have bloomed anything but emissive materials. GDevelop's own 3D bloom effect ships with a threshold of **0** for precisely this reason. The default is now `0.3`, presets are retuned to 0.25–0.6, and the property documents that the value is linear light.
- **The downsample was passed the destination texel size instead of the source's.** The 13-tap footprint is defined in source texels, and the destination is half the size, so every tap was spread twice as far as intended.
- **The upsample had the same bug, with worse consequences.** The tent filter samples the smaller mip below it, so using the larger destination's texel size collapsed all nine offsets to sub-texel distances — the tent degenerated into plain bilinear and did no blurring whatsoever.

Regression tests now assert that each pyramid stage receives its own source texel size, and that no preset or default threshold sits above what real geometry can reach in linear light.

**Tests:** 78 → 80 runtime assertions.

---

## 2.2.0 — Memory, resolve, hygiene

**Memory**

- **Render targets are allocated on demand.** Every buffer was previously created up front regardless of what was enabled — about **62 MB at 1080p**, when a bloom-only setup needs 10 MB and the default (every effect off) needs none. Each pass now creates its buffers the first time it runs, and they are still disposed together on resize, quality change or scene unload.

**Reflections**

- **SSR resolve pass.** The raymarch leaves a ragged hit/miss boundary, and a mirror-sharp reflection on a surface that is only partly smooth was wrong anyway. A new blur pass widens with the surface's roughness — the "roughness cone blur" the 1.0 docs promised but never implemented, now possible because the reflectivity mask exists. A polished mirror gets only a one-pixel cleanup; the blur never grows a reflection outward onto a surface that produced none.
- The reflectivity mask now packs **reflectivity in red and roughness in green**. `mesh.userData.ssrRoughness` overrides the derived value.

**Robustness**

- **The mask pass is exception-safe.** It temporarily swaps every mesh's material; a throw between the swap and the restore previously left the entire scene wearing flat grey materials for the rest of the session. The restore is now in a `finally`.
- **The mask material cache no longer leaks.** It was a `Map` keyed by source material, which pinned every material the scene had ever rendered and prevented it from being collected. Now a `WeakMap`, with our own mask materials tracked separately so they can still be disposed.
- The temporary material stash key is deleted from `userData` rather than set to `undefined`.
- **The layer's effect composer is looked up fresh each frame** instead of cached forever, so a composer rebuilt by GDevelop does not leave the pass attaching depth to render targets nothing draws into.

**Testing**

- **The generated extension is now tested, not just parsed.** `test-extension.mjs` executes every action, condition and expression from the built JSON against a mock GDevelop events context. That glue is assembled by string concatenation, and the build previously only checked it parsed — a mistyped `getArgument` name, a settings key that does not exist, or a `Set` action that forgets to write back to its behavior property (and so silently reverts on the next frame) would all have shipped. It also asserts every declared parameter is read, that action/expression pairs round-trip through the same setting, that every preset applies completely, and that the JSON is not stale relative to the runtime.
- The build runs both suites and refuses to report success if either fails.
- Covered the last untested runtime exports: `parseColor`, `applyCineon`, `karisLumaWeight`.

**Tests:** 66 → 78 runtime assertions, plus 13 new assertions over the generated extension.

**Housekeeping**

- Removed the unused `str`, `freeFn` and `evFree` build helpers.
- Corrected documentation that still described the AO and reflection buffers as fixed half resolution now that `EffectQuality` controls them.

---

## 2.1.0 — Polish

**Quality**

- **Depth-aware upsampling of the AO and reflection buffers.** They render at reduced resolution and were being read back with plain bilinear filtering, which bleeds them across depth discontinuities — a halo around every object. The composite (and the new merge pass) now take four depth-weighted taps, sharing the depth fetches between both buffers.
- **AO and SSR are applied before Depth of Field, not after.** Previously the composite applied them at the very end, so a razor-sharp reflection or contact shadow sat on a surface the defocus had already blurred. A merge pass now folds them into the colour buffer ahead of DOF. It only runs when DOF is active alongside AO or SSR; otherwise the composite applies them directly as before.
- **Interleaved gradient noise** for the GTAO slice rotation, replacing `fract(sin(...))`. Better spatial distribution, and it does not collapse into visible bands at mediump precision on mobile GPUs.
- **Real anamorphic streaks.** The old version was a two-tap lateral smear of the bloom buffer. There is now a dedicated wide horizontal blur pass, which is what actually produces the streak.

**Control**

- **New `EffectQuality` property** (`Full` / `Half` / `Quarter`) sizing the GTAO, SSR and reflectivity-mask buffers. Previously hardcoded to half. `PerformanceLite` now uses `Quarter`. Bloom, DOF and the composite are always full resolution.
- **New `Set effect buffer quality` action.**
- **Autofocus is bounded by the camera frustum** — the raycast now sets `near` and `far` from the layer camera instead of testing geometry that could never be in focus.
- **`mesh.userData.cinematicIgnoreAutofocus`** excludes a mesh from autofocus. A first-person weapon or other camera-locked prop sits in front of everything and would otherwise own the focus plane permanently.

**Housekeeping**

- One-shot console warnings reset per scene, so a fresh preview reports an existing problem instead of staying silent because an earlier run mentioned it.
- Shader static checks cover the two new shaders.
- Test suite: 53 → 66 assertions.

---

## 2.0.0 — Depth, scale, and honesty

This release is a near-total rewrite. Several properties were renamed or removed; see **Migrating** below.

**The headline fix: there was no depth buffer.**

GDevelop builds each 3D layer's composer as `new EffectComposer(renderer)`, whose default render targets carry a depth *renderbuffer* — not a sampleable depth *texture*. Every depth-dependent pass was reading `0.0` for every pixel:

| Effect | 1.0 behaviour |
| :--- | :--- |
| GTAO | Silent no-op, two full passes of wasted GPU time |
| SSR | Silent no-op |
| Depth of Field | Uniform full-screen blur with no depth separation |
| Motion Blur | Wrong velocity, smeared on any camera movement |

The 1.0 code tried to patch this by assigning `readBuffer.depthTexture` at render time, which three ignores once a framebuffer exists. Both composer ping-pong targets are now disposed and rebuilt with a real `DepthTexture`.

**GDevelop 3D is pixel-scale, not metric.**

A default 3D layer puts the camera about 724 world units from the `z = 0` plane, with `near = 0.1` and `far = 2000`. Two consequences the 1.0 shaders got wrong:

- Every world-space default was metric (a 1.2-unit AO radius, a 4-unit focus distance) and therefore effectively zero. All retuned to scene scale.
- At that near/far ratio a raw depth of `0.999` is only about **95 units** out, so the `rawDepth >= 0.999` sky test in every shader was discarding the entire scene. All passes now linearise depth and compare against the far plane.
- The Circle of Confusion used a literal 50mm thin lens, which saturates every pixel at these distances. It is now a dimensionless defocus term that behaves identically at any world scale.

**Effects that were wrong even with correct input**

- **Bloom upsampling never added the matching mip back in**, so the pyramid collapsed to the smallest mip blurred five times and all mid-frequency glow was lost. Now properly additive, and the pyramid starts at half resolution rather than jumping straight to quarter.
- **The Karis 13-tap kernel dropped its centre tap** — it was fetched and discarded, with the inner diagonals wrongly substituted into all four corner boxes.
- **The bilateral blur only ran horizontally**; the vertical half of the separable filter was never issued.
- **GTAO was not GTAO** — it was a distance-falloff SSAO. It now performs a real horizon search with the Jimenez arc integral. `GTAOMultiBounce` was uploaded to the shader and never read; multi-bounce now works, using the polynomial fit that brightens rather than darkens.
- **SSR reflected off every surface** at uniform intensity. It is now gated by a per-pixel reflectivity mask built from each material's roughness and metalness — see Migrating.
- **`SSRRaySteps` offered 64** but the shader clamped to 48.

**Features that did not exist**

- **Autofocus was never implemented.** There was no raycaster anywhere in the runtime; `IsAutofocusTracking` returned a hardcoded `false` and `CurrentFocusDistance` returned the manual value. It now raycasts screen centre against the layer's 3D group and eases the focus plane onto the hit.
- **The `Preset` property did nothing.** It was stored as a dead string and never routed through the preset application; only the `ApplyPreset` action worked. It now applies at creation and writes back into the behavior's properties so the per-frame sync stays consistent with it.

**New**

- `TargetLayer` property — the pass was previously hardcoded to the base layer.
- `Diagnostics` property — logs composer, depth, camera and buffer state once at startup.
- `Depth buffer is available` condition.
- Clear console warnings when the target layer has no 3D composer, or when a second behavior instance tries to drive the same renderer-global pipeline.

**Fixed**

- The scene background was being overwritten every frame, clobbering any skybox or environment map. It is now only filled in when the scene has none.
- A full-resolution half-float render target plus float depth texture (~24 MB at 1080p) was allocated and never used.
- The runtime was embedded twice in the extension JSON. Now once.

### Migrating from 1.0

**Removed:** `SSRMaxRoughness` — there is no G-buffer, so it was never read by any shader. Replaced by `SSRMaxDistance` (world units) and `SSRFresnel`.

**Renamed semantics:** `Preset` gained a `Custom` option, which is now the default. Set it to a named preset to have that preset applied at creation.

**Rescaled:** `GTAORadius` (`1.2` → `50`) and `ManualFocusDistance` (`4.0` → `700`) are in GDevelop world units. If you had tuned these by hand, multiply by roughly 40–175 depending on your camera distance.

**Behaviour change:** SSR no longer reflects off everything. GDevelop's default 3D material is fully rough and scores zero reflectivity, so **nothing reflects until you make a material smooth or metallic**, or set `mesh.userData.ssrReflectivity`. Set `SSRSurfaces` to `Everything` for the old behaviour.
