# Changelog

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

**Tests:** 66 → 76 assertions, including lazy allocation per effect, the roughness channel, and a simulated GL failure during the mask render.

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
