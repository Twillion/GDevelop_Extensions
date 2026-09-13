# Implementation Plan (revised): `InGameCamera3D`

Live in-game camera feeds — CCTV monitors, TV screens, arcade cabinets, rear-view mirrors — by
rendering a GDevelop 3D layer from a second camera into an offscreen texture and binding that
texture onto a `Cube3D` face or a `Model3D` material.

Revision of the first draft. Everything marked **[verified]** was read out of the installed GDevelop
runtime at
`C:\Users\chris\AppData\Local\Programs\GDevelop\resources\GDJS\Runtime\`
(GDevelop 5.6.279, Three **r160**, PIXI 7.4.2), not inferred.

The first draft described how render-to-texture works in Three.js. Almost all of the real difficulty
is in how render-to-texture works *inside GDevelop's renderer*, which is not a stock Three setup:
one `WebGLRenderer` shared with PIXI, `autoClear` disabled, one `THREE.Scene` per layer, and
materials memoised across the whole game.

---

## What changed from the first draft, and why

### C1 — `autoClear` is off, and nothing ever restores the render target. **[verified]**

`runtimegame-pixi-renderer.js` configures the renderer once:

```js
this._threeRenderer.shadowMap.enabled = true;
this._threeRenderer.shadowMap.type    = THREE.PCFSoftShadowMap;
this._threeRenderer.autoClear         = false;   // <— global
this._threeRenderer.useLegacyLights   = true;
```

Two consequences the first draft walks straight into:

1. **The render target is never cleared for us.** Each camera pass composites onto the previous
   frame's contents — colour smears, and stale depth makes geometry vanish. Every pass must clear
   explicitly.
2. **`grep -c setRenderTarget runtimescene-pixi-renderer.js` → `0`. [verified]** The engine's render
   loop calls `renderer.render(scene, camera)` against whatever target happens to be bound. If a
   camera pass returns without unbinding, *the entire game renders into our CCTV texture* and the
   screen goes black.

So the pass body is fixed, and non-negotiable:

```js
const previousTarget = renderer.getRenderTarget();
renderer.setRenderTarget(cam.target);
renderer.clear(true, true, true);          // colour + depth + stencil; autoClear is off
renderer.render(sourceScene, cam.threeCamera);
renderer.setRenderTarget(previousTarget);  // restore, always, including on throw
```

Wrap it in `try/finally` so a shader compile error cannot black out the game.

### C2 — There is no "the 3D scene". Scenes are per-layer. **[verified]**

`layer-pixi-renderer.js` gives every layer its own `THREE.Scene`, `THREE.Camera` and
`EffectComposer` (`getThreeScene()`, `getThreeCamera()`, `getThreeEffectComposer()`), and lights are
added per-layer. The scene render loop iterates `_orderedLayers` and renders each one separately.

The first draft's `CreateCamera(Name, Resolution, FPSCap, FOV)` has no parameter for *what the camera
films*. Every camera now names a source layer, and there are two ways to film it — see
**Two capture modes** below, which is the headline structure of the extension:

**Superseded in part by C18:** a mode B camera is a behavior on an object, so it films the layer that
object lives on and needs no `SourceLayer` argument; a mode A camera is addressed by its layer
directly. The point that survives is that a camera without a named source is underspecified.

Filming several layers into one target is possible — render them in order with clearing suppressed
after the first — but it is a v2 feature (`AddSourceLayer`), not a free detail. v1 is one layer per
camera, documented as such. Several *cameras* per layer is v1 and is the whole point of mode B.

Related trap: the loop hands `scene.background` to the *first visible 3D layer only* and nulls it on
the rest. **[verified]** Our pass runs before that assignment for the current frame, so it inherits
whatever the previous frame left on that scene. Set `scene.background` deliberately for the duration
of the pass (or accept the layer's own background and document it).

### C3 — The pass runs in `registerRuntimeScenePostEventsCallback`. **[verified]**

The first draft said `tick(runtimeScene)` "executes off-screen render passes" without saying when.
This is the decision everything else hangs off. `runtimescene.js::renderAndStep` is, in order:

```
_updateObjectsPreEvents  →  callbacksRuntimeScenePreEvents  →  events
   →  _stepBehaviorsPostEvents  →  callbacksRuntimeScenePostEvents  →  render()
```

so post-events is the last hook before rendering. **Chosen.** The alternative — an
`EffectComposer` pass, which is what `3DCRT+` does — runs with Three's GL state already established,
but makes ordering against the layer that *contains* the screen load-bearing, and couples us to the
post-processing stack we do not otherwise need.

The cost of the post-events choice, and its mitigations:

- **We are touching GL outside the render phase.** The engine brackets every 2D↔3D transition with
  `threeRenderer.resetState()` and `pixiRenderer.reset()`. **[verified]** We do the same around our
  passes: `resetState()` before, and `resetState()` + `pixiRenderer.reset()` after.
- **Three object transforms are one frame stale.** `render()` calls `_updateObjectsPreRender()`,
  which is what pushes logical positions into the Three objects. **[verified]** At post-events time
  the meshes still hold last frame's transforms. This only matters for follow/look-at cameras, and
  the fix is to read the *logical* position (`object.getX()`, `getY()`, `getZ()`) — always current at
  post-events — never the Three object's `.position`.

### C4 — There is no 3D Plane object. Scope cut. **[verified]**

The 3D extension registers exactly two objects: `Scene3D::Cube3DObject` and
`Scene3D::Model3DObject`. `BindTo3DPlane` has nothing to bind to.

v1 drops it. A flat TV screen is a `Cube3D` with a small depth, which already works through the cube
path. Shipping our own `eventsBasedObject` plane is a real scope addition and is deferred.

### C5 — Cube3D face materials are shared game-wide. Clone before binding. **[verified]**

`Cube3DRuntimeObjectPixiRenderer` builds its six material slots from the image manager:

```js
getImageManager().getThreeMaterial(resourceName, { useTransparentTexture, forceBasicMaterial, vertexColors: true })
```

and `pixi-image-manager.js::getThreeMaterial` memoises the result:

```js
getThreeMaterial(name, opts) {
  const cached = this._loadedThreeMaterials.get(name, opts);
  if (cached) return cached;                 // <— same object, every caller
  ...
  this._loadedThreeMaterials.set(name, opts, material);
}
```

The material on our TV's front face is *the same object* as on every other cube using that texture.
Assigning a render target to `.map` in place turns every cube in the game into a TV.

**Binding always clones**, per instance, and the clone is owned and disposed by us. Three more Cube3D
specifics, all verified in the same file:

- **Face index is permuted.** GDevelop face index → material slot is
  `{3:0, 2:1, 5:2, 4:3, 0:4, 1:5}` (the renderer's `g` table), with the inverse `R` used at
  construction. "Front" is not slot 0. Ship the table, do not re-derive it at each call site.
- **UVs are per-face lookup tables with flips** driven by `getFacesOrientation()` (`"Y"` or not) and,
  for the back face, `getBackFaceUpThroughWhichAxisRotation()`. A feed bound to different faces will
  come out mirrored or rotated. Expose `FlipHorizontally` / `FlipVertically` / `Rotation` on the
  binding rather than pretending one orientation fits all six faces.
- **`vertexColors: true` and `updateTint()` writes a `color` attribute.** A custom screen material
  must declare `vertexColors` or the object's tint silently stops applying to that face.

### C6 — Cube3D UV remapping crashes on a render-target texture. **[verified]**

`updateTextureUvMapping()` guards on `if (!material || !material.map) continue;` and then, in the
repeat branch, reads:

```js
this._boxMesh.scale.x / material.map.source.data.width
```

A `WebGLRenderTarget.texture` has `source.data === null`, so this is a `TypeError`, not a wrong
number. It fires whenever the bound face has "repeat texture" enabled and anything calls
`updateSize()` or `updateFace()` — i.e. **resizing the TV crashes the game.**

Mitigation, in order of preference:

1. On bind, force `shouldRepeatTextureOnFaceAtIndex` off for the bound face if the API allows it;
   otherwise
2. give the render-target texture a `source.data` shim carrying `{ width, height }`, which satisfies
   the arithmetic and yields correct repeat UVs; and
3. either way, document that "repeat texture" on a live face is unsupported, and re-assert the
   binding after any size change (see C7's revalidation pass, which covers this too).

Option 2 is the one to implement — it is three lines and it makes resize behave rather than merely
not crash.

### C7 — Model3D destroys bindings on its own, and shares materials across instances. **[verified]**

```js
_updateModel(...) {
  const clone = THREE_ADDONS.SkeletonUtils.clone(this._originalModel.scene);
  ...
  this._replaceMaterials(group);
  this.get3DRendererObject().remove(this._threeObject);
  this.get3DRendererObject().add(group);
  this._threeObject = group;                  // <— whole subtree replaced
}
```

Two problems:

1. Any change to the model resource or the material type rebuilds the subtree and silently discards
   our binding, with no notification.
2. `SkeletonUtils.clone` **shares materials** between clones, so the aliasing problem of C5 applies
   to every instance of the same model.

So bindings cannot be fire-and-forget. Each binding stores the mesh identity it attached to and
**revalidates once per frame** (cheap: an identity comparison), rebinding if `_threeObject` has been
swapped. This is the same self-healing pattern as `ExternalSkeletalAnimator3D`'s mixer-identity check
and it also covers hot reload.

Binding by material *name* must define its behaviour when several meshes share one material: bind
**all** matching meshes, cloning per mesh, and report the count through an expression so the user can
tell whether they hit what they meant.

### C8 — GDevelop's coordinate conventions, not Three's. **[verified]**

`layer-pixi-renderer.js::updatePosition`:

```js
camera.rotation.order = "ZYX";
camera.position.x =  layer.getCameraX();
camera.position.y = -layer.getCameraY();      // <— negated
camera.rotation.z = -toRad(layer.getCameraRotation());
```

and the layer's scene is itself Y-flipped at construction:

```js
this._threeScene = new THREE.Scene();
this._threeScene.scale.y = -1;                // <— the whole scene, not just the camera
this._threeGroup = new THREE.Group();
this._threeScene.add(this._threeGroup);
```

`SetCameraPosition(Name, X, Y, Z)` taking raw Three coordinates would place our cameras mirrored
against every other 3D API in the engine. All public actions and expressions use **GDevelop** world
coordinates and degrees; the negation and `ZYX` order are applied internally, in one place.

The `scale.y = -1` gives the scene a negative determinant, so anything *we* add to a layer scene is
subject to it — relevant to the `PointLight` of C11 (unaffected, lights have no winding) and to any
debug geometry (affected). Mode A sidesteps the whole question by copying a transform that is already
expressed in that space; see below.

`Model3D` compounds this — `stretchModelIntoUnitaryCube` applies `makeScale(sx, -sy, sz)`, a negative
determinant that flips winding. **[verified]** Screen meshes inside a GLTF may therefore need
`side: THREE.DoubleSide` to be visible from the expected side; make it a binding option.

### C9 — Specify the whole colour chain, not just the render target. **[verified]**

`outputColorSpace` is never assigned in the renderer setup, so it is Three r160's default,
`SRGBColorSpace`. The first draft says "configure the render target with `THREE.SRGBColorSpace`" and
stops there, which is half of a decision. Get the pair wrong in either direction and the feed ships
washed out or crushed. The chain, written down once:

| Stage | Setting |
|---|---|
| Render target texture | `colorSpace = THREE.SRGBColorSpace` — the pass encodes on write, which keeps 8-bit precision usable |
| Screen material `.map` | samples that texture; Three decodes sRGB→linear because the texture declares it |
| Main output | `renderer.outputColorSpace` (default `SRGBColorSpace`) encodes once, at the end |

One encode, one decode, one encode. Also: `WebGLRenderTarget` has **no MSAA** unless constructed with
`samples: n`. Without it, feeds are visibly aliased against an antialiased main view. Expose it as an
`Antialiasing` argument on `CreateCamera` defaulting to `0` (off), since it is not free.

Target construction, in full:

```js
// width/height come from the Resolution preset (C19), clamped to maxTextureSize
new THREE.WebGLRenderTarget(width, height, {
  minFilter:  nearest ? THREE.NearestFilter : THREE.LinearFilter,
  magFilter:  nearest ? THREE.NearestFilter : THREE.LinearFilter,
  depthBuffer: true,
  stencilBuffer: false,
  samples: antialiasing,
  colorSpace: THREE.SRGBColorSpace,
});
```

Note `samples` and a low `Resolution` pull against each other: multisampling a 320×240 CCTV feed
smooths the very edges the pixel grid is meant to show. Default `Antialiasing` to `0` and mention that
it is for `HD`-class screens, not for the retro ones.

### C10 — Shadow maps dominate the second pass. **[verified]**

`shadowMap.enabled = true` globally, so every camera pass re-renders every shadow map. The first
draft's "saves 50–80% of GPU work" from frame throttling is optimistic until this is handled:

```js
const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
renderer.shadowMap.autoUpdate = false;        // reuse the main view's maps
// ... pass ...
renderer.shadowMap.autoUpdate = shadowAutoUpdate;
```

Shadow maps are view-independent for directional and point lights, so reuse is correct, not a cheat.
This is the actual optimisation; frame throttling is on top of it.

### C11 — Emissive does not light the room. Default to `MeshBasicMaterial`.

Resolves the first draft's open question #2, which recommended emissive PBR. `emissive` and
`emissiveMap` on a `MeshStandardMaterial` brighten only that surface's own pixels. Illuminating a
dark room needs a real light or a bloom pass. The first draft's
`SetEmissiveGlow(Object, Intensity, Color)` described as "make the TV screen light up the dark room"
promises something it cannot do.

Decision:

- **Default: `MeshBasicMaterial`.** A monitor is emissive by nature, it is cheaper, and it is
  immune to `useLegacyLights = true` **[verified]** intensity conventions.
- **Option: `MeshStandardMaterial`** with the feed on both `.map` and `.emissiveMap`, for screens
  that should be dimmed by scene lighting.
- **`SetScreenLight(Object, Enabled, Intensity, Radius)`** — an actual `PointLight` the extension
  parents to the screen and disposes with the binding. Named for what it does.

### C12b — A 2D layer as on-screen UI: `3DCRT+` already has the working recipe. **[verified]**

Grabbing a 2D layer and compositing it onto the feed — `CAM 02 — CORRIDOR`, a timestamp, a `REC ●`,
or a whole 2D minigame — is not new work. `3DCRT+`'s `_ensureOverlay()` does it, and the awkward parts
are already found and commented. Port it rather than rediscover it.

The recipe, verbatim in shape:

```js
const container = runtimeScene.getLayer(layerName).getRenderer()._pixiContainer;

if (!this._pixiRT) this._pixiRT = PIXI.RenderTexture.create({ width: w, height: h });
else if (this._pixiRT.width !== w || this._pixiRT.height !== h) this._pixiRT.resize(w, h);

pixi.reset();                                   // 1. Three left the context in its state
const pv = container.visible, pr = container.renderable, pa = container.alpha;
container.visible = true; container.renderable = true; container.alpha = 1;
pixi.render(container, { renderTexture: this._pixiRT, clear: true });
container.visible = pv; container.renderable = pr; container.alpha = pa;

pixi.renderTexture.bind(null);                  // 2. see below — the subtle one
pixi.reset();
three.resetState();                             // 3. hand the context back

pixi.texture.bind(base, 0);                     // force the GL texture to exist
const glHandle = base._glTextures[pixi.CONTEXT_UID].texture;
const props = three.properties.get(this._overlayTexture);
props.__webglTexture = glHandle;
props.__webglInit = true;
```

Four details that are each a day's debugging if rediscovered:

1. **It renders the container itself**, forcing `visible` / `renderable` / `alpha` for the duration and
   restoring after. So a **hidden UI layer works** — which is the whole point, since the HUD should
   appear on the TV and not on the player's screen. It does not depend on the engine having rendered
   the layer.
2. **`pixi.renderTexture.bind(null)` after the grab.** `3DCRT+`'s own comment: without it "every other
   2D layer GDevelop draws later this frame inherits the RenderTexture's flipped projection and comes
   out mirrored." **This matters more for us than for `3DCRT+`.** It grabs mid-render; we grab at
   post-events (C3), *before* PIXI has drawn anything this frame — so leaving the projection bound
   wrong would corrupt every 2D layer in the game, not some of them. Mandatory, not defensive.
3. **`isRenderTargetTexture = true`, `generateMipmaps = false`, `colorSpace = SRGBColorSpace`, and
   `__webglInit = true`** alongside `__webglTexture`. The sRGB tag is what lets the shader composite
   directly against `tDiffuse` with no manual decode, encoding once at the end (C9).
4. **Disposal order.** Clear the borrowed handle *before* disposing the wrapper:
   `props.__webglTexture = undefined; props.__webglInit = false;` — otherwise Three deletes a texture
   PIXI still owns. This belongs in C13's lifecycle wiring.

**Where it composites.** `3DCRT+` places the overlay "in between camera + display": sampled at the
warped `pos` so the HUD follows curvature and stretch, reconstructed at footage resolution so
scanlines affect it consistently with the 3D, but *not* re-pixelated and *not* aberration-split. That
position is exactly our screen material, since our screen material *is* the display stage. So the
overlay uniforms (`tOverlay`, `overlayOpacity`, `overlayGlow`) come across with the screen-space half
of the shader, and the phosphor-glow ring comes with them.

**Ownership: per camera.** A character generator lives in the camera, so the overlay is a camera
property and every screen showing that camera shows the same HUD. The grab is throttled with the
camera's FPS cap, so it costs one PIXI container render per camera per *filmed* frame.

**Sizing: scale the container during the grab.** A GDevelop 2D layer is game-resolution sized and a
camera target usually is not. Rather than grabbing at game resolution and reconciling in the shader,
scale the container to the target as part of the grab — it is one more save/restore alongside the
`visible` / `renderable` / `alpha` ones already there, and it keeps `tOverlay` in the *same UV space*
as `tDiffuse`, so the ported compositing code needs no fit logic at all.

**Scale and position together. [verified]** The layer's `_pixiContainer` already carries the layer
camera's transform — `scale.set(zoom, zoom)`, `rotation`, and a `position` derived from the viewport
origin — so our factor must compose with what is there, and the position is in game-resolution
pixels, so scaling only `scale` leaves the content offset:

```js
const sx = targetW / gameW, sy = targetH / gameH;
const prev = { x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y };
c.scale.set(prev.sx * sx, prev.sy * sy);
c.position.set(prev.x * sx, prev.y * sy);       // both, or the HUD lands off-centre
pixi.render(container, { renderTexture: this._pixiRT, clear: true });
c.scale.set(prev.sx, prev.sy); c.position.set(prev.x, prev.y);
```

**Three modes, and scaling must be switchable off:**

| `SetOverlayFit` | Behaviour |
|---|---|
| `Stretch` *(default)* | non-uniform to the target, so the layer fills the screen exactly |
| `Uniform` | uniform scale and centre, for a logo that has to stay round |
| `None` | **the container is not touched at all** — authored pixels land 1:1 in the target |

`Stretch` is the default because letterbox bars on a CCTV monitor read as a bug, and a HUD authored
for a screen is authored for that screen's shape.

`None` is not a fallback, it is the right answer whenever the HUD is pixel art: any scaling resamples
text and softens it, and the re-snapping below stops being enough. It is also what you want when the
target is already game-resolution sized, or when the overlay is deliberately a small corner element at
exact pixel dimensions — with `None` the target simply shows the top-left `targetW × targetH` of the
layer at 1:1. Say that plainly in the README rather than describing it as "unscaled", which sounds
like a limitation instead of a choice.

### Authoring workflow — position the UI on screen, then hide the layer

Because the grab captures the layer **as its own camera sees it** (the transform is the camera's), the
HUD is positioned with ordinary GDevelop camera actions on that layer. Which gives a genuinely good
authoring loop, and it is worth putting in the README as *the* recommended way to build a screen UI:

1. Build the HUD on its own 2D layer, **left visible**. It draws over the game as normal.
2. Position and scale it with the usual camera actions until it sits where you want, watching it
   full-size on screen rather than squinting at a texture on a distant TV.
3. Point a camera at it with `SetOverlayLayer`, and confirm it composites.
4. **Hide the layer.** It vanishes from the player's view and remains on the TV — the grab does not
   depend on the engine rendering it (C12b).

Step 4 is a one-action switch between "authoring" and "shipped", with no rebuild and nothing to
reconfigure, which is what makes the loop worth recommending.

One caveat that survives all three modes: if the game uses pixel-rounded coordinates, re-snap the
scaled position under `Stretch` and `Uniform`, or pixel-art text can land on fractional pixels and
soften. Under `None` the question does not arise, which is another reason it is the honest default for
pixel art.

**Premultiplied alpha:** `3DCRT+` leaves a commented fallback for if the grab ever yields premultiplied
alpha. Carry the comment; it costs nothing and it is the first thing to try if the HUD composites with
dark fringes.

### C12 — The PIXI bridge already exists in the engine, and invisible layers are never rendered. **[verified]**

The first draft presents the zero-copy bridge as a `3DCRT+` discovery. The engine does exactly this
in `layer-pixi-renderer.js`:

```js
updateThreePlaneTextureFromPixiRenderTexture(threeRenderer, pixiRenderer) {
  const glTex = this._renderTexture.baseTexture._glTextures[pixiRenderer.CONTEXT_UID];
  if (glTex) threeRenderer.properties.get(this._threePlaneTexture).__webglTexture = glTex.texture;
}
```

It is private and tied to 2D+3D layers, so we still re-implement it, but the hazards are known and
two are already commented in `3DCRT+`'s own source:

- **Re-fetch the handle every frame.** PIXI reallocates on resize and on context loss; a cached
  handle silently points at a dead texture.
- **Never let `needsUpdate` fire** on the bridged texture — Three would re-upload and clobber the
  handle.
- **V-flip.** A PIXI `RenderTexture` is vertically flipped relative to Three; mirror V in the shader
  or on the texture.
- **The engine skips invisible layers entirely** (`if (!layer.isVisible()) continue`). So the
  "hidden 2D layer running an arcade minigame" case works — events still run on invisible layers —
  but *we* must drive `renderer.render(container, { renderTexture })` ourselves, and `reset()` the
  PIXI renderer afterwards. The plan must not imply the engine renders it for us.

### C13 — Lifecycle, or it leaks. Absent from the first draft.

The first draft has `dispose(runtimeScene)` and never says what calls it. Wire all three:

**C18 solves most of this by construction** — a behavior's `onDestroy` releases its own target, scene
unload takes the instances with it, and object identity cannot collide the way names could. What
remains:

- `onDestroy` on `Camera3D` — dispose the target and any chain buffers; unbind every screen pointing
  at it, so a destroyed camera leaves a black screen rather than a dangling texture.
- `onDestroy` on `LiveScreen` — restore the original material and dispose the clone (C5, C7).
- `gdjs.registerRuntimeSceneUnloadedCallback` **[verified]** — still needed for the mode A
  `layerViews` map and for the overlay `RenderTexture`s, which no behavior owns.
- The overlay's borrowed GL handle must be cleared before its wrapper is disposed (C12b), wherever
  that disposal is reached from.

Budget, and document it: one 1024×1024 RGBA target with depth is roughly 6 MB. Warn once in the
console past a configurable total (default 64 MB) rather than silently allocating.

### C14 — Aspect ratio is a decision, not a default.

Nothing in the first draft reconciles the camera's aspect with the screen's. Set
`camera.aspect = width / height; camera.updateProjectionMatrix()` from the *target* dimensions
**[verified pattern]**, then choose how the result meets a screen quad of a different shape:
`Stretch` (default, matches what users expect from a texture), `Fit` (letterbox in UV) or `Fill`
(crop in UV). One enum on the binding.

### C15 — Scope cut: the effect matrix duplicates `3DCRT+`.

The first draft is five subsystems and roughly forty actions in v1: RTT core, 2D layer capture, a
full CRT/VHS/night-vision/thermal suite, camera behaviours, and material binding across three object
types.

The effect suite substantially duplicates `3DCRT+`, which is already maintained in this repo and
whose 1.0.0 release cycle was spent *removing* effects (bloom, brightness, saturation, contrast) and
correcting overstated ranges. Rebuilding a wider effect surface per-screen invites the same cleanup.

**v1 ships:** camera create/destroy, placement, look-at, throttled RTT, binding to a Cube3D face and
a Model3D material, power on/off, and exactly three colour modes (`Color`, `Monochrome`,
`NightVision`) plus `Scanlines` and `StaticNoise` as uniforms on one screen material.

**Deferred:** thermal, VHS glitch, interlacing, rolling bar, chromatic aberration, fisheye, patrol
and follow (under C18 these are just moving the camera object — a tween on its angle, or the existing
"stick to object" tools — and need no actions of ours at all), multi-layer composite, 2D overlay compositing, our own plane object.

### C16 — Build and schema conventions, carried over.

From the `AnimatedPBR3D` post-mortem and the `ExternalSkeletalAnimator3D` build script:

- The build script **rejects any control character** in generated `inlineCode`, checked by char code
  rather than a regex literal. A single NUL truncates the block, unbalances the generated file, and
  surfaces as `<Action> is not a function` with the behavior still visible in the editor.
  `node --check` does **not** catch it.
- Every generated `inlineCode` block is parsed with `new Function` before anything is written.
- The output is linted for wrong schema keys.
- Functions namespace as `InGameCamera3D::…` — the first draft wrote `InGameCamera::…`, which would
  not resolve.

### C17 — Behavior *and* free functions, and now for a reason.

Resolves the first draft's open question #1, which answered "yes, both, for versatility". The real
argument is C5/C7/C13: binding needs **per-instance** state (the cloned material, the original
material to restore, the mesh identity to revalidate) and **per-instance destruction**. That is
exactly what an `eventsBasedBehavior` provides and what free functions on an object parameter do not.

- **`LiveScreen` behavior** on the screen object — owns the binding, the cloned material, the
  revalidation tick, and unbinding on destroy.
- **Free functions** for cameras, which are scene-scoped and have no natural owner object.

### C18 — A camera is a behavior on a 3D object, not a name in a registry. **[verified]**

Supersedes the string-named `CreateVirtualCamera(Name, …)` API used in C2, C8, C13 and C17 above;
those corrections stand except where this one replaces their mechanism.

**A dropdown of cameras is not possible.** `3DCRT+` builds its effect dropdowns with
`stringWithSelector` and a list hardcoded in the JSON **[verified]**:

```json
{ "type": "stringWithSelector",
  "supplementaryInformation": "[\"Scanlines\", \"Bulge\", \"Border\", \"Mask\", …]" }
```

That list is baked at build time. Effects are a closed set, so it works for them and we adopt it (see
below). Cameras are created at runtime, so the editor has nothing to populate from — there is no
runtime-populated dropdown for an events-based extension. The choice is therefore free-form strings,
or GDevelop's native way of identifying a thing that has a transform: **an object**.

**Decision: a `Camera3D` behavior, placed on any 3D object** — normally the security-camera model
itself, or an invisible `Cube3D`. This deletes more of the plan than it adds:

- **Identity is the object reference.** A real editor picker, no typos, no name registry, no
  collisions across scenes (which is what C13's per-scene keying existed to prevent).
- **The transform is the object's transform.** `SetCameraPosition`, `SetCameraRotation`,
  `SetCameraLookAt`, and the follow/patrol modes from the first draft all disappear — you move,
  rotate and tween the object with the actions that already exist. A patrol sweep is a tween on the
  object's angle. C8's coordinate conversion still happens, but once, inside the behavior, reading
  the object's own `getX/getY/getZ` and 3D rotation rather than from arguments.
- **The source layer is implied.** An object is already on a layer, so a camera films the layer it
  lives on and C2's `SourceLayer` parameter is gone. Moving the camera object to another layer
  re-points the feed, which is the behaviour a user would guess.
- **Lifecycle is GDevelop's.** `onDestroy` releases the target; scene unload takes the instances with
  it. Most of C13 is solved by construction rather than by callback wiring.
- **Several instances are free**, including several cameras on one object type.

**What it costs, recorded honestly:**

1. **A camera attached to nothing** becomes "put the behavior on an invisible `Cube3D`" rather than a
   bare string. Slightly more setup, in exchange for a gizmo that can be seen and dragged in the 3D
   editor — on balance better, but it is a change in how it feels.
2. **Binding takes two objects.** Behavior properties cannot hold object references, so the bind is an
   action: `BindToCubeFace(Screen, ScreenBehavior, CameraObject, CameraBehavior, Face)`.
3. **Instance picking is GDevelop's, not ours.** With several instances of the camera object in
   scope, the action receives the picked set. Take the first and document it — standard semantics,
   but the kind of thing that produces a confused bug report if unstated.

**Mode A needs no identity at all.** A layer-view camera *is* its layer, so it is addressed by a
`layer` parameter — a real editor picker, and a type `3DCRT+` already uses twice **[verified]**. One
layer-view camera per layer, no invented names anywhere in the extension.

**Effects keep the dropdown, copied from `3DCRT+`.** `SetEffectEnabled(Effect, Enabled)` and
`EffectIsEnabled(Effect)` over a static list beat a dozen `SetXEnabled` actions, and the pattern suits
the shader design: toggles are float uniforms (see *The structure worth copying*), so enabling is
orthogonal to tuning and neither recompiles anything.

### C19 — Camera resolution is the primary control; the texture is allocated from it.

The render target's size is not a technical detail to be tuned separately from the look. It **is** the
camera's resolution, and every other resolution-ish knob should derive from it rather than sit beside
it. One property, `Resolution`, drives target allocation, `camera.aspect`, the emulated CRT grid, the
overlay grab size and the memory budget.

**This makes the low-resolution look real rather than simulated.** C9's earlier framing had `res` — the
shader's emulated grid — as a divisor of a large target, i.e. a large render pretending to be small.
If the camera's resolution is 320×240, allocate a 320×240 target and the grid *is* the footage. The
pixelation is then genuine: it is in the signal, it survives being viewed from any distance, and it
costs less to render rather than more. `SetEmulatedResolution` survives as a secondary fine-tune (a
512 target sampled on a 256 grid filters differently from a 256 target), defaulting to a divisor of 1.

**Presets, because this is a place a dropdown genuinely works (C18).** Resolution is a closed set plus
an escape hatch, so `stringWithSelector` applies:

| Preset | Size | Bytes (RGBA + depth) | Reads as |
|---|---|---|---|
| `Tiny` | 160×120 | ~0.15 MB | barely-there security feed, heavy pixel grid |
| `Low` | 320×240 | ~0.6 MB | classic CCTV |
| `Standard` | 512×512 | ~2 MB | **default** — a TV in a room, square-friendly for cube faces |
| `SD` | 640×480 | ~2.4 MB | clean 4:3 monitor |
| `HD` | 1280×720 | ~7 MB | a modern screen, and the point where a camera wall gets expensive |
| `Custom` | `Width` × `Height` | — | anything, including deliberately non-square |

Putting the cost in the table is the point: a user choosing `HD` for eight cameras should be able to
see that it is 56 MB before they discover it as a frame-rate problem.

**Resolution sets shape, not just sharpness.** The target's dimensions feed `camera.aspect`
(C14), so switching a camera from `SD` (4:3) to `HD` (16:9) changes the framing, not only the detail.
Say so plainly in the README — it is the single most likely misunderstanding, because "resolution"
suggests sharpness alone.

**Changing it at runtime reallocates. [design constraint]**

- Dispose the old target and any chain buffers first, or the change leaks at exactly the rate a user
  is likely to call it (e.g. tying resolution to a quality slider that fires per drag event).
- Every bound screen holds a reference to the old texture and must be re-pointed. This is the same
  revalidation the bindings already do each frame (C7), so route it through that rather than adding a
  second path.
- There is one frame of blank or stale feed. With `autoClear` off (C1) that means *stale*, not black,
  which is the better failure — but it means a resolution change during a cut looks like a hitch.
  Debounce, and do not reallocate when the requested size is unchanged.
- Clamp to `renderer.capabilities.maxTextureSize` and warn once. `Custom` invites a user to type
  4096 and discover a silent failure on mobile.

**Filtering belongs with it.** Low resolution with `LinearFilter` reads as a blurry mistake; with
`NearestFilter` it reads as a deliberate pixel grid. Expose `Filtering` (`Linear` / `Nearest`) rather
than inferring it from size — auto-switching at a threshold is the kind of magic that produces "why
did my TV change when I nudged a number" — but document `Low` + `Nearest` as the CCTV recipe.

**Both modes and the overlay follow.** `EnableLayerViewCamera` takes the same preset, and C12b's
overlay `RenderTexture` is created at the camera's resolution so the HUD is composited in the same UV
space as the feed under `Stretch`.

---

## Two capture modes

Every camera has a **source layer** (C2) and one of two ways of filming it. The distinction is not a
convenience wrapper — the two modes differ in what owns the transform, what the feed costs, and which
hazards apply.

| | **Mode A — Layer view** | **Mode B — Virtual camera** |
|---|---|---|
| What it films | exactly what that layer's own camera sees | the layer's scene, from a viewpoint we own |
| Transform owned by | the layer (`getThreeCamera()`) | the camera **object** it is attached to (C18) |
| Cameras per layer | one — the layer has one camera | many, independent, all filming the same world |
| Typical use | a whole layer built as a "studio" for a TV channel; a hidden layer running a 2D or 3D scene shown on a screen; picture-in-picture of another view | CCTV covering the room the player is standing in; rear-view mirror; drone feed; security wall |
| 2D content on the layer | supported, with the caveat below | not applicable (a virtual camera films 3D only) |
| Cost when the source layer is hidden | one render (ours) | one render (ours) |
| Cost when the source layer is visible | two renders — ours and the engine's | two renders |

The two are complementary and both are v1. Mode B is what makes "cameras other than the main player
camera in a layer show up on a screen" work: the player layer keeps its own camera untouched, and any
number of virtual cameras film the same `THREE.Scene` from elsewhere.

### Mode A — how it renders

The layer already owns a camera; we copy it rather than borrow it.

```js
// once, on create or when the layer's camera type changes
cam.threeCamera = layerCamera instanceof THREE.OrthographicCamera
  ? new THREE.OrthographicCamera(...)
  : new THREE.PerspectiveCamera(...);

// every pass
const src = layer.getRenderer().getThreeCamera();
src.updateMatrixWorld();
cam.threeCamera.position.copy(src.position);
cam.threeCamera.quaternion.copy(src.quaternion);
cam.threeCamera.near = src.near;
cam.threeCamera.far  = src.far;
if (src.isPerspectiveCamera) {
  cam.threeCamera.fov = src.fov;
  cam.threeCamera.aspect = cam.target.width / cam.target.height;   // ours, not the layer's
} else {
  cam.threeCamera.zoom = src.zoom;
  // ortho frustum re-derived for the target's aspect, preserving vertical extent
}
cam.threeCamera.updateProjectionMatrix();
```

**Copy, do not borrow.** The obvious shortcut is to render with the layer's own camera and temporarily
override `aspect`. That mutates live engine state mid-frame: the layer camera's aspect comes from
`layer.getWidth() / layer.getHeight()` **[verified]**, so any target that is not the game's aspect
ratio needs an override, and a throw between override and restore leaves the player's own projection
wrong for the rest of the frame. C1's `try/finally` would catch it, but copying removes the failure
class rather than handling it. The copy is ~8 assignments per camera per frame.

**Orthographic layers must be mirrored.** `layer-pixi-renderer.js` picks the camera type from
`layer.getCameraType() === RuntimeLayerCameraType.ORTHOGRAPHIC` **[verified]** and builds
`new THREE.OrthographicCamera(-w/2, w/2, h/2, -h/2, near, far)`. A mode A camera that assumes
perspective silently produces a wrong projection on an ortho layer. `getCamera3DFieldOfView()` returns
`0` for ortho **[verified]** — a usable type probe, but check the instance, not the FOV.

**Under C18 there is nothing to reject.** An earlier draft had mode B's transform actions no-op on a
layer-view camera. With cameras as behaviors on objects and mode A keyed by layer, the two do not
share an API at all: there is no camera object in mode A, so there is nothing to try to move. If a
user wants to deviate from the layer's view, that is mode B — a camera object placed where they want
it. Not offering an offset parameter keeps both modes easy to reason about.

### Mode A caveats that mode B does not have

**1. 2D content on the layer is one frame stale, or blank. [verified]** A layer whose rendering type
is `TWO_D_PLUS_THREE_D` shows its 2D content on a plane mesh inside the Three scene, and that plane's
texture is refreshed *during* `render()`:

```js
layerRenderer.renderOnPixiRenderTexture(pixiRenderer);
layerRenderer.updateThreePlaneTextureFromPixiRenderTexture(threeRenderer, pixiRenderer);
layerRenderer.show2DRenderingPlane(has2DObjects);
```

Our pass runs at post-events (C3), before that. So:

- **Visible source layer** — the feed shows last frame's 2D content. One frame of lag on a TV screen
  is invisible in practice; document it and move on.
- **Hidden source layer** — the engine skips it entirely **[verified]**, so the plane texture is never
  refreshed and the 2D content is permanently blank. This is exactly the "hidden layer running an
  arcade minigame, shown on a cabinet" case, so it cannot be left broken.

The fix is to drive those two engine calls ourselves before the pass, for mode A cameras whose source
layer has 2D content. They are private methods, which is the same bet C12 already takes, and the same
`pixiRenderer.reset()` discipline applies afterwards. This is the one place where mode A and the
deferred 2D-capture subsystem (C12) touch; keeping it to *calling the engine's own two methods*, rather
than re-implementing the bridge, is what keeps it inside v1.

**2. The layer's post-processing is bypassed.** The engine's loop chooses per layer **[verified]**:

```js
layerRenderer.hasPostProcessingPass() ? composer.render() : renderer.render(scene, camera);
```

We take the second branch always, so a source layer carrying post effects — including `3DCRT+` — films
without them. That is surprising enough to be a documented limit rather than a silent difference.
Routing through the layer's `EffectComposer` means redirecting a composer that owns its own targets and
its `renderToScreen` flag; it is a v2 item (`SetUsePostProcessing`), not a flag we can add cheaply.

**3. Feedback is guaranteed, not incidental.** If a screen bound to a mode A camera sits *on the layer
being filmed*, it is in shot by construction. C1's guard already hides every screen bound to the camera
being rendered, which covers it — but mode A is where it fires routinely rather than as an edge case,
so it needs a test (verification 5b) rather than just an argument.

### Choosing between them, for the README

- "I want a security camera looking at the room the player is in" → **mode B** on the player's layer.
- "I want four cameras on four corridors, on one monitor wall" → **four mode B cameras**, one layer.
- "I want a TV channel / a 2D minigame / a separate 3D set, not visible to the player except on the
  screen" → build it on its own layer, hide the layer, **mode A**.
- "I want a minimap or picture-in-picture of another visible layer" → **mode A** on that layer.

---

## Post-processing: a camera chain and a screen shader

**Decision: screen effects run in the screen object's own fragment shader, not as a post pass on the
feed. Both the effect maths and the way the code is organised come from `3DCRT+`.** Pixelation,
scanlines, shadow mask, bulge, border, aberration, roll, flicker, interlace and grain are already
written and tuned there; they transfer rather than get rebuilt. `3DCRT+` itself is unchanged and
remains the whole-layer path for the player's own view.

This changes the v1 cost calculus recorded in C15. That correction assumed a wide effect surface meant
writing a wide effect surface; reusing existing code does not, so the effect set is now **inherited**
and only genuinely new work is deferred. See the revised C15 note there.

### Two effect spaces, because effects are not all the same kind of thing

There are two places an effect can run, and the right answer is **both** — they are not competing
options, they are different physics:

**1. The camera's own post-processing chain, in feed space.** A virtual camera gets an
`EffectComposer` of its own: `RenderPass(sourceScene, cam.threeCamera)` followed by N shader passes,
resolving into the camera's render target. This is the general mechanism, it mirrors how layers
already work so it needs no new mental model, and it is *correct* for anything that happened to the
image before it reached the TV — pixelation, emulated low resolution, colour grading, grain,
aberration, roll, interlace, signal blur, dropout. Pixelating in feed space is genuinely pixelating
the signal; doing it in screen space would be a drawing of pixelation.

**Cost is opt-in.** A camera with no passes allocates nothing extra and writes straight to its target
exactly as C1 describes. Ping-pong buffers and the composer are created on the first pass added.
Follow the engine's own convention when inserting: `addPostProcessingPass` inserts *before* the
trailing antialiasing and output passes rather than appending **[verified]**.

**2. The screen object's material, in screen space.** Everything about the *display* stays here:

- **Only the screen material knows how large the TV is in the player's view.** A pass on a 512² feed
  cannot know the TV occupies 80 px on screen, so scanlines and shadow mask baked at feed resolution
  alias into shimmer at distance. See `dimensions` below.
- **The screen is a lit object in a room.** Glass specular, room reflections and the emissive feed
  belong in one material, and curvature applied in the screen's own UV space reads as curved glass
  rather than a warped image.
- **Mode A and mode B behave identically**, so a screen looks the same however its feed was produced.

**Which space an effect belongs in — the test:** *would this effect still exist if the TV were
switched off and you looked at the raw video file?* Yes → the camera chain, it happened to the
signal. No → the screen material, it is the tube.

**The screen material is the default of the two**, and the camera chain is reached for deliberately.
The material exists regardless — fit, orientation and lighting mode live there whatever we decide
about effects — so effects on it are incremental, and they cost no extra targets and no extra passes.
The chain costs one or two targets per camera plus N full-screen passes at target resolution:
negligible at 512² throttled to 15 fps, not negligible at 1024² across eight uncapped cameras.

Neither space can be dropped, which is why this is a split rather than a choice. A chain-only design
warps the image while leaving the screen's edges straight, so bulge reads as a distorted picture
rather than curved glass, and baked scanlines either shimmer or mip to grey. A material-only design
makes pixelation a lie that breaks as the player walks closer — the signal's pixel grid should be
fixed in the signal, not in the view of it — and forfeits bloom and shared grading across a monitor
wall.

**The `3DCRT+` shader already cleaves along this line. [verified]** Its own section comments mark the
split before we impose it:

```glsl
// GEOMETRY -- tube shape shared by camera + display (not graded).
// --- Softness prepass: pixelate (enPixelate). [CAMERA-ONLY, pre-overlay]
//     'spos' is the sample coordinate for the FILMED WORLD only.
```

So splitting the ported maths into a feed-space half and a screen-space half follows a seam that is
already there, rather than cutting across one.

### The structure worth copying **[verified]**

`3DCRT+`'s `ShaderPass` is organised in a way that scales to a large effect set, and the camera
extension should follow it:

- **One flat uniform block from a factory** — `uniforms: CRT_UNIFORMS()` — rather than uniforms
  scattered per effect.
- **Feature toggles are `float` uniforms** (`enScanlines`, `enBulge`, `enMask`, …), not `#define`
  permutations. Toggling an effect never recompiles the shader, which matters when a game switches
  a monitor's look at runtime.
- **A plain `settings` object is the source of truth**, synced to uniforms at one point, with all
  clamping and derivation done at that boundary:

  ```js
  u.warpX.value  = bulge / 32;                                  // one user value -> two uniforms
  u.warpY.value  = bulge / 24;
  u.borderL.value = Math.min(Math.max(bm + settings.borderLeft, 0), 0.45);
  ```

  This is the part most worth keeping. It lets the action surface stay ergonomic — one `Bulge`
  number, one border margin — while the shader stays flat and branch-light, and it means clamping
  lives in exactly one place instead of in every setter.
- **An error-once guard** (`_erroredOnce`) so a broken frame does not fill the console — the same
  discipline as the one-time warning for mode A's rejected transform actions.
- **`material.extensions = { derivatives: true }`** for `fwidth()` on WebGL1; harmless on WebGL2.
- **The pass order is documented in section comments** (`GEOMETRY -- tube shape shared by camera +
  display`, and so on), with a master `intensity` blend against the untouched `original` at the end.
  Keep both conventions; the order comments are what make a 46-uniform shader maintainable.

### The maths comes across nearly verbatim **[verified]**

The `3DCRT+` fragment shader is already written entirely against `varying vec2 vUv` and
`uniform sampler2D tDiffuse`, with **46 uniforms** and ten `en*` feature toggles. On a Cube3D face
`vUv` is likewise 0..1 (C5's UV tables), so the body transfers with three changes:

| | `3DCRT+` (ShaderPass) | Here (screen material) |
|---|---|---|
| Vertex shader | full-screen quad | standard mesh vertex shader passing `uv` → `vUv` |
| `tDiffuse` | the layer's rendered frame | the camera's render target |
| `res` — the emulated low-res grid | `canvas / divisor` | **the render target's own size** (camera-owned) |
| `dimensions` — physical display px | canvas size | **derived per-fragment, see below** (screen-owned) |

**`dimensions` is where the port gets better rather than merely equivalent.** It drives the aperture
mask (`col *= Mask(vUv * dimensions)`), blur radii (`1.5 / dimensions`) and pixelate blocks — all of
which are meant to be in *display* pixels. On a TV in world space that is neither the canvas nor the
render target; it is how many screen pixels the TV currently covers. The shader can work it out
itself:

```glsl
vec2 dimensions = 1.0 / max(fwidth(vUv), vec2(1e-6));   // on-screen px per UV unit
```

So the mask, blur and pixelate sizes stay physically correct as the player walks toward the TV or
views it at an angle, with no CPU work and no uniform to keep in sync. This is the aliasing problem
solved as a side effect of where the shader now lives.

Related: the shader **already uses `fwidth()`** for border antialiasing. In a full-screen pass that
derivative is per-feed-pixel; in a screen material it becomes per-final-screen-pixel, which is the
behaviour we want — but it does mean values tuned in `3DCRT+` will not look identical at the same
numbers. Expect to re-tune defaults rather than copy them, and say so in the README.

`fwidth` is core in GLSL ES 3.0, and Three r160 runs WebGL2 by default, so no extension pragma is
needed. If a WebGL1 fallback ever matters, that is where it breaks first.

### What maps to the camera, and what to the screen (C17)

The shader's own uniform groups fall along the split cleanly — and now the *mechanism* differs per
side too, not just the ownership. Signal properties are passes on the camera's chain; display
properties are uniforms on the `LiveScreen` material:

| Camera — the signal | Screen — the display |
|---|---|
| `res` (= target size / divisor), `enPixelate`, `pixelateSize` | `dimensions` (derived), `enMask`, `maskDark`, `maskLight` |
| `tint`, `enColor`, `gammaCorrect` — Color / B&W / NightVision | `enScanlines`, `hardScan`, `hardPix` |
| `aberration`, `enAberration` | `enBulge`, `warpX`, `warpY`, `stretchX/Y` |
| `grain*`, `enGrain` — sensor noise | `enBorder`, `borderL/R/T/B` — the bezel |
| `enRoll`, `rollSpeed`, `rollHeight`, `flicker`, `enInterlace` | `intensity` — master opacity, and screen brightness |
| `enBlur`, `blurAmount` — signal softness | |

Two TVs showing one camera can then have different glass; one TV switching between cameras changes
signal without changing glass. `time` is driven from the scene clock for both.

**`tOverlay` / `overlayOpacity` / `overlayGlow` already exist in the shader.** That is the HUD
compositing path (`CAM 02 — CORRIDOR`, timestamps) from the first draft, and it needs no new shader
work — only a texture to bind, which is the deferred 2D-capture subsystem (C12). Keeping the uniforms
in the port now means enabling it later is a binding change, not a shader change.

### Multi-pass effects come free with the camera chain

The earlier draft deferred bloom and heavy blur because a screen-material shader cannot do a
downsample pyramid. A camera chain can, and GDevelop's stock 3D effects are already built as Three
passes — `Scene3D::Bloom` wraps `THREE_ADDONS.UnrealBloomPass` **[verified]**. Since
`gdjs.PixiFiltersTools.getFilterCreator(name)` is public **[verified]**, a camera chain can
instantiate a stock effect and add its pass:

```js
const filter = gdjs.PixiFiltersTools.getFilterCreator('Scene3D::Bloom').makeFilter(...);
cameraComposer.addPass(filter.shaderPass);      // bypasses applyEffect, see below
```

Two caveats, both real:

- **`applyEffect` hard-checks the target type. [verified]**
  `return target instanceof gdjs.Layer ? (…addPostProcessingPass…) : false;` — so stock effects
  cannot be *applied* to anything but a layer. Reaching past it to `.shaderPass` works but is an
  implementation detail of each filter class, not a declared interface.
- **Not every effect has a pass.** The fog effects set `scene.fog` rather than adding a pass, so a
  `.shaderPass` grab silently yields nothing for them. Whitelist the effects known to be pass-based
  rather than offering the whole stock list and failing unpredictably on some of it.

Treat this as a v2 opportunity with a v1 hook, not a v1 feature. It is worth noting now because it
changes what "deferred" means: bloom on a TV screen becomes a wiring job rather than a shader job.

### Should the effects be a separate extension plugging into the camera API?

Eventually, probably. Not for v1.

**It is technically fine.** GDevelop extensions share one `gdjs` namespace, so a second extension's
JsCode can call `gdjs.__inGameCamera3D.addPass(cameraName, pass)` — the same reach-into-internals
move `3DCRT+` already makes against layers. Nothing in the engine prevents it.

**Three reasons to keep it internal until it has earned the split:**

1. **It would freeze an unshipped API.** Pass ordering, buffer ownership, resize, disposal and the
   mode A/B distinction are all still moving. A plug-in point defined before its first consumer works
   is a guess; defined after, it is a description.
2. **There is no dependency declaration between events-based extensions.** A user who installs the
   effects extension and not the camera extension gets silence, not an error. That cliff has to be
   papered over with guard-and-warn machinery we would be writing for one consumer we also wrote.
3. **The ecosystem argument does not pay off yet.** The reason to build a generic effect API would be
   to inherit GDevelop's existing effects — and `applyEffect`'s `instanceof gdjs.Layer` check blocks
   exactly that, as above. What is left is a plug-in API with a single known client.

**So:** build the chain internally, with the ported CRT passes as its first consumer, shipped inside
`InGameCamera3D`. Keep `addPass` / `removePass` on the published namespace object and mark them
**unstable** in the README. If a second consumer appears — or if `3DCRT+` should later target cameras
as well as layers — the hook exists and has been proven by a real user rather than an imagined one.

### Two copies of the maths, and that is fine

`3DCRT+` is hand-maintained JSON with no build script **[verified: the folder holds only the `.json`,
README, LICENSE and release zips]**, so there is no shared-source arrangement to set up without giving
a shipped 1.0.0 extension a build pipeline it does not have. Copy, and keep the copy easy to find:
the shader lives in **one file**, `InGameCamera3D/crt-shader.glsl.js`, so a future single-source move
stays available if it ever earns its keep.

Keep **action and property names identical to `3DCRT+`'s** wherever the uniform is the same. Users
moving between the two extensions then transfer what they already know, and a fix made in one is easy
to locate in the other.

---

## Revised architecture

```
gdjs.__inGameCamera3D = {
  scenes: WeakMap<RuntimeScene, {
    // C18: no name registry. Mode B cameras are Camera3D behavior instances,
    // registered on activation and dropped in onDestroy; mode A is keyed by layer.
    cameras:      Set<Camera3DBehavior>,   // { threeCamera, target, chain?, fpsCap, … }
    layerViews:   Map<string, Camera>,     // layer name -> layer-view camera
    bindings:     Set<Binding>,            // one per LiveScreen behavior instance
    budgetBytes:  number,
  }>,

  // called from registerRuntimeScenePostEventsCallback, once per frame, per scene
  tick(runtimeScene) {
    const renderer = runtimeScene.getGame().getRenderer().getThreeRenderer();   // [verified accessor]
    if (!renderer) return;

    for (const binding of state.bindings) binding.revalidate();   // C7: subtree may have been rebuilt

    const due = [...state.cameras.values()].filter(c => c.enabled && c.isDue(dt) && c.isNeeded());
    if (!due.length) return;

    renderer.resetState();                                   // C3
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;                   // C10
    const previousTarget = renderer.getRenderTarget();
    try {
      for (const cam of due) {
        // mode A: copy the layer camera, re-aspected for our target.
        // mode B: push our own logical coords into Three (C8).
        cam.syncTransform();
        cam.refresh2DPlaneIfNeeded(pixiRenderer);             // mode A only; see Two capture modes
        hideSelfReferencingScreens(cam);                      // recursion guard, all bindings of cam
        renderer.setRenderTarget(cam.target);
        renderer.clear(true, true, true);                     // C1
        renderer.render(cam.sourceScene(), cam.threeCamera);  // never composer.render() in v1
        restoreHiddenScreens();
      }
    } finally {
      renderer.setRenderTarget(previousTarget);              // C1
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.resetState();
      runtimeScene.getGame().getRenderer().getPIXIRenderer().reset();   // C3
    }
  },
}
```

`isNeeded()` covers throttling (`fpsCap`), power state, and skipping cameras whose every bound screen
is invisible. Frustum culling of the screen against the main camera is deferred — it needs current
world matrices, which C3 says we do not have at post-events time, and a stale-frame pop on re-entry
is a worse trade than it looks.

**Recursion guard, corrected.** The first draft hides "the target screen mesh", singular. A camera may
have many bound screens, and the WebGL feedback-loop error triggers on *any* draw that samples the
texture currently bound as the framebuffer's colour attachment. So: hide every screen bound to *this*
camera for the duration of *this* camera's pass. Screens bound to a different camera are a different
texture and stay visible — which is what makes a wall of monitors filming each other work.

---

## Deliverables

```
InGameCamera3D/
├── InGameCamera3D.json          # built artefact, never hand-edited
├── InGameCamera3D.runtime.js    # readable source, embedded by the build
├── crt-shader.glsl.js           # the ported 3DCRT+ fragment body, isolated for future sharing
├── build-extension.mjs          # C16 guards: control chars, new Function parse, schema lint
├── PLAN.md                      # this file
└── README.md                    # includes the documented limits below
```

**Limits the README must state, because each is a supported-behaviour boundary, not a bug:**
one source layer per camera, though many cameras per layer (C2); no Plane object (C4); "repeat
texture" unsupported on a live cube face (C6); binding by material name binds every matching mesh
(C7); emissive does not illuminate the room, use `SetScreenLight` (C11); shadow maps are reused from
the main view, so a camera looking somewhere the main view never sees may show stale shadows (C10).

**Mode A specifically:** transform actions are rejected; the layer's post-processing is bypassed;
2D content on the filmed layer lags by one frame; and a filmed layer that is *visible* is rendered
twice per frame. All four are in **Two capture modes** above with their reasons.

That last one is a real visual artefact and the honest trade for C10. If it matters for a given game,
`SetShadowMode(Name, "PerPass")` re-enables `autoUpdate` for that camera at full cost.

## v1 API surface

**Cameras**

**Mode B — the `Camera3D` behavior (C18).** Put it on the security-camera model, or an invisible
`Cube3D`. Position, rotation, following and patrol are the object's own — no actions here for any of
them.

```
# behavior properties, set in the editor and changeable at runtime
Resolution             # dropdown: Tiny|Low|Standard|SD|HD|Custom           (C19)
Width, Height          # used only when Resolution = Custom
Filtering              # "Linear" | "Nearest"                               (C19)
FOV, Near, Far
FPSCap                 # 0 = every frame
Enabled                # power; the target keeps its last frame when off
ShadowMode             # "Reuse" | "PerPass"                                (C10)
Antialiasing           # samples; 0 = off                                   (C9)

# actions on the behavior
SetEnabled(Object, Behavior, Enabled)
SetFPSCap(Object, Behavior, FPS)
SetFOV(Object, Behavior, FOV)
SetClipping(Object, Behavior, Near, Far)
SetResolution(Object, Behavior, Preset)         # dropdown; reallocates      (C19)
SetCustomResolution(Object, Behavior, Width, Height)
SetFiltering(Object, Behavior, Mode)
```

**Mode A — free functions keyed by layer (C18).** The camera *is* the layer, so there is no name:

```
EnableLayerViewCamera(Layer, Resolution, FPSCap)    # same preset dropdown as mode B (C19)
DisableLayerViewCamera(Layer)
SetLayerViewResolution(Layer, Resolution)
SetLayerViewFPSCap(Layer, FPS)
```

**Screen (`LiveScreen` behavior)**

```
BindToCubeFace(Object, Behavior, CameraObject, CameraBehavior, Face)      # C18: first picked instance
BindToModelMaterial(Object, Behavior, CameraObject, CameraBehavior, MaterialName)
BindToLayerView(Object, Behavior, Layer)                                  # mode A has no camera object
Unbind(Object, Behavior)
SetFit(Object, Behavior, Mode)                  # "Stretch" | "Fit" | "Fill"      (C14)
SetOrientation(Object, Behavior, FlipH, FlipV, Rotation)                        # (C5)
SetMaterialMode(Object, Behavior, Mode)         # "Unlit" | "Lit"                (C11)
SetScreenLight(Object, Behavior, Enabled, Intensity, Radius)                    # (C11)

# display effects — ported 3DCRT+ uniforms, names kept identical to 3DCRT+
SetScanlines(Object, Behavior, Enabled, HardScan, HardPix)
SetMask(Object, Behavior, Enabled, MaskDark, MaskLight)
SetBulge(Object, Behavior, Enabled, WarpX, WarpY)
SetStretch(Object, Behavior, StretchX, StretchY)
SetBorder(Object, Behavior, Enabled, L, R, T, B)
SetIntensity(Object, Behavior, Intensity)       # master opacity
```

**Signal effects — `Camera3D` behavior actions (mode B), ported `3DCRT+` uniforms**

```
SetEffectEnabled(Object, Behavior, Effect, Enabled)     # dropdown, C18 — the 3DCRT+ pattern
EffectIsEnabled(Object, Behavior, Effect)               # condition, same dropdown

SetColorMode(Object, Behavior, Mode)            # "Color" | "Monochrome" | "NightVision"
SetTint(Object, Behavior, R, G, B)
SetGamma(Object, Behavior, GammaCorrect)
SetEmulatedResolution(Object, Behavior, Divisor)  # drives `res`; 1 = native target size
SetPixelate(Object, Behavior, Size)
SetAberration(Object, Behavior, Amount)
SetGrain(Object, Behavior, Amount, Size, Color, Speed)
SetRoll(Object, Behavior, Speed, Height)
SetFlicker(Object, Behavior, Amount)
SetSignalBlur(Object, Behavior, Amount)
TriggerGlitch(Object, Behavior, Duration, Strength)

# 2D layer as on-screen UI (C12b) — ported from 3DCRT+'s overlay
SetOverlayLayer(Object, Behavior, Layer, Opacity)   # layer picker; may be hidden
SetOverlayGlow(Object, Behavior, Glow)              # phosphor bloom on the HUD's own bright pixels
SetOverlayFit(Object, Behavior, Mode)               # "Stretch" (default) | "Uniform" | "None"
                                                    #   None = no scaling at all, 1:1 authored pixels
```

**Signal effects and overlay are mode B only, and that is principled rather than a cut.** Mode A
films a layer, so a HUD goes *on that layer* alongside everything else it is filming — the overlay
composite exists precisely because mode B films 3D and has nowhere to put 2D. Likewise a layer that
wants grading already has GDevelop's own layer effects. Mode A screens still get the full display
half through the `LiveScreen` behavior, so a layer-view TV looks like a TV.

**Conditions**: `IsEnabled` and `EffectIsEnabled` on `Camera3D`; `IsBound` and `IsBoundToLayerView`
on `LiveScreen`; `LayerViewCameraIsEnabled(Layer)`.

**Expressions**: `FOV`, `Near`, `Far`, `TargetWidth`, `TargetHeight` on `Camera3D` — position and
rotation come from the object's own expressions, so we add none. On `LiveScreen`: `BoundMeshCount`
(C7). Scene-wide: `TotalTextureMemoryMB()` (C13).

## Engine context: what GDevelop plans, and what it costs us

Researched 2026-08-26 against GDevelop's own material and the surrounding extension ecosystem.

### This fills an acknowledged gap, not a soon-to-close one

Render-to-texture — "a camera can send data to an image, so what the camera sees is displayed on a
screen or plane" — is an **open feature request** on the GDevelop forum, not an implemented or
scheduled feature. Projecting a 2D camera onto an in-world screen is requested separately. So the
extension is filling a real hole rather than racing the engine to it. Worth restating in the README:
users are searching for this by those words.

### Three planned engine changes that could disturb us

From GDevelop's engineering write-up on the 3D editor, the stated future work includes:

1. **Full 2D/3D separation, enabling unified editing.** This is the one to watch. C12b's overlay
   depends on a layer's `_pixiContainer` and on PIXI and Three sharing a GL context. A 2D/3D
   separation is precisely the change that could invalidate that bridge. Mitigation is already in the
   design: the grab lives behind one function, and a failure leaves `_overlayTexture` null so the
   composite self-disables rather than crashing — carry that `try/catch` shape over from `3DCRT+`
   verbatim, it is a forward-compatibility feature, not just error handling.
2. **Custom shaders with an integrated editor.** If this lands, our screen shader may want to become
   something a user can extend rather than a fixed uniform set. Another reason to keep `addPass` /
   `removePass` published-but-unstable (see *Should the effects be a separate extension*) instead of
   designing a plug-in API now.
3. **Occlusion culling.** Would interact with our `isNeeded()` skip logic. Not a conflict, but if the
   engine gains a "is this object visible" answer, our own culling should defer to it rather than
   compete.

Also relevant: the editor renders through the engine itself and shares one preview instance across
scene tabs "reducing WebGL contexts". A camera extension that allocates render targets per instance is
therefore also allocating them *in the editor*, which is a good reason for the budget warning in C13
to exist and to be visible during editing rather than only at runtime.

### Performance techniques worth adopting

The `Performance3D` extension is prior art in this exact ecosystem, and several of its techniques
apply directly to a second render pass:

| Technique | How it applies here |
|---|---|
| **Frozen shadow maps for static scenes** | Independent confirmation of C10. Our `shadowMap.autoUpdate = false` around the pass is the same idea, and the biggest single win available. |
| **Frustum and distance culling** | Our `isNeeded()`. Deferred in v1 for the reason in *Revised architecture* (no current world matrices at post-events), but this is where it goes when added. |
| **Distance-based LOD, pausing animation on far objects** | A camera throttled to 10 fps does not need 60 fps skeletal updates in shot. A future `Camera3D` option. |
| **Material sharing / sorting by material** | Cuts against C5 and C7, which force us to *clone* materials per screen. Clone only the bound screen's material, never the whole model's — the cost of getting this wrong is a draw-call regression, not just memory. |
| **Lower-resolution mipmaps for distant objects** | The render target *is* the distant object, so its `Resolution` (C19) is the LOD control. A `Low` preset on a TV that is never approached is the cheapest optimisation in the extension, and `SetResolution` makes it switchable at runtime. |
| **Reporting draw calls, triangles, GPU memory** | `renderer.info` is already read for verification 7. Expose it: a `TotalTextureMemoryMB()` expression plus draw-call delta per camera turns "is my TV wall affordable" into a measurable question. |

The general guidance for GDevelop projects — that large textures dominate GPU memory — lands squarely
on this extension, since every camera allocates one. Default to **512×512**, not 1024²: it is the
resolution at which a TV in a room reads correctly, and four of them cost less than one 1024² target.

## Verification

**Automated, in `build-extension.mjs`** — and only what is genuinely static:

1. Control-character rejection over every `inlineCode` block, by char code (C16).
2. `new Function` parse of every block.
3. Schema key lint against the extension JSON shape.
4. Assert the Cube3D face-index table matches the runtime's `g` table, so a GDevelop update that
   repermutes faces fails the build instead of shipping a rotated feed.

GPU memory, texture disposal and context handling are **not** statically checkable; they move to the
manual list. The first draft listed them as automated.

**Manual, in GDevelop** — the scenarios that actually break:

1. Cube3D front face bound; other five faces keep their own textures and are not affected.
2. **A second cube using the same face texture is untouched** (C5 — this is the regression that
   would otherwise reach users).
3. Resize a bound cube, with "repeat texture" both on and off (C6).
4. Model3D bound by material name; then change the model's material type at runtime to force
   `_updateModel`, and confirm the binding heals (C7).
5. Two cameras filming each other's screens; then one camera filming its own screen (C1 feedback
   guard).
   **5b.** The same, in mode A, with the screen sitting *on the filmed layer* — where being in shot
   is structural rather than accidental.
   **5c.** Four mode B cameras on one layer, four screens, all live at once — the monitor-wall case,
   and the one that proves cameras are genuinely independent of the layer's own camera. Use four
   *instances of one camera object* as well as four distinct objects, to exercise C18's picking rule.
   **5f.** Destroy a camera object mid-feed: its screens go black, no dangling texture, and
   `TotalTextureMemoryMB()` drops (C13/C18). Then move a camera object to another layer and confirm
   the feed re-points.
   **5d.** A mode A camera on a **hidden** layer carrying 2D objects: confirm the 2D content appears
   and animates rather than showing blank, which is the caveat that needs code, not documentation.
   **5e.** A mode A camera on an **orthographic** layer: confirm the projection matches what that
   layer draws on screen, not a perspective approximation of it.
6. Destroy a bound object mid-feed; change scene with cameras live; confirm
   `TotalTextureMemoryMB` returns to zero (C13).
7. FPS cap at 10 / 15 / 30 against an uncapped baseline, with `renderer.info` read before and after,
   to confirm C10's shadow saving is real rather than assumed.
8. A colour chart on the filmed layer, compared side by side against the same chart viewed directly —
   the single check that catches a C9 double-encode.
9. **Walk toward and away from a TV with mask and scanlines on**, and view it at a grazing angle.
   The mask must stay a mask rather than dissolving into shimmer, which is the whole point of
   deriving `dimensions` from `fwidth` — and the check that a post pass on the feed would fail.
10. **A hidden 2D layer as HUD** on a camera feed: text and a blinking `REC ●` appear on the TV,
    animate, and are absent from the player's own view. Then run the authoring loop in reverse —
    show the layer, reposition with a camera action, hide it again — and confirm the TV tracks the
    change with no other edit.
    **10b.** All three `SetOverlayFit` modes, with a pixel-art HUD under `None` — text must be
    pixel-exact, which is the mode's whole reason for existing.
12. **Resolution (C19):** step a live camera through every preset and back. Each change must
    reallocate without leaking — watch `TotalTextureMemoryMB()` return to the same figure for the same
    preset — re-point every bound screen, and show at most one frame of stale feed. Then confirm `SD`
    and `HD` frame the scene *differently*, not just more sharply, and that `Low` + `Nearest` gives a
    crisp pixel grid rather than a blur.
11. **Every other 2D layer in the game still renders correctly** with an overlay active — the
    `renderTexture.bind(null)` check (C12b). A mirrored or misprojected UI elsewhere on screen is the
    failure signature, and it will not show up in any test that only looks at the TV.

Per standing practice, this is handed over and tested in GDevelop; no browser or WebGL harness is
built to pre-verify it.

## Suggested sequencing

1. **Core pass, mode B** — C1, C3, C8, C9, C10, C18. The `Camera3D` behavior on one object, filming
   its own layer, into one hardcoded quad. Nothing bindable yet. Getting the black-screen and
   washed-out-colour classes of bug out of the way first is most of the risk, and mode B is the mode
   where the pass is entirely ours.
2. **Mode A** — camera copy, ortho mirroring, rejected transform actions. Still the hardcoded quad.
   Deliberately before binding: it shares the whole pass with mode B, so a bug that appears in one
   mode and not the other is diagnostic while the rest is still simple. Manual checks 5e.
3. **Cube3D binding** — C5, C6, C14, C17. Manual checks 1–3.
4. **Model3D binding** — C7. Manual check 4.
5. **Lifecycle and guards** — C13, recursion guard. Manual checks 5, 5b, 5c, 6.
6. **Mode A 2D-plane refresh** — the one piece of C12 that v1 needs, last because it is the only
   step that calls engine-private methods and it is isolated behind `refresh2DPlaneIfNeeded`.
   Manual check 5d.
7. **Screen material, plain** — feed on an unlit material, `SetScreenLight` (C11), orientation and
   fit. No CRT maths yet, so any problem here is a material problem.
8. **Screen shader** — lift the screen-space half of the `3DCRT+` body into `crt-shader.glsl.js`,
   swap the vertex shader, repoint `tDiffuse`, wire `dimensions` from `fwidth`, then re-tune
   defaults. **First, because the material exists regardless** — fit, orientation and lighting mode
   already live there, so the effects are incremental on something already built, and they cost no
   extra targets or passes. Manual check 9.
9. **Camera chain** — optional `EffectComposer` per camera, allocated on first pass added, inserting
   before the trailing passes as the engine does. Feed-space half of the ported maths goes here.
   `addPass` / `removePass` published but marked unstable. Second, because it is opt-in
   infrastructure that only earns its cost for signal effects and multi-pass.
10. **2D layer overlay** — port `_ensureOverlay` (C12b), wire `tOverlay` / `overlayOpacity` /
    `overlayGlow` in the screen shader, and the fit decision. After the screen shader, because it
    composites into it. Manual checks 10–11.
11. **Build guards and README** — C16, documented limits, the copy-of-3DCRT+ note, the unstable-hook
    note. Manual checks 7–8.

Deferred to v2, tracked here so the cut is deliberate rather than forgotten: filming through a
layer's `EffectComposer`
(`SetUsePostProcessing`), multi-layer composite (C2), the wider effect matrix (C15), and a native
plane object (C4).

## Open questions

1. **C6 mitigation.** The `source.data` shim is three lines and makes resize correct rather than
   merely non-fatal, but it depends on an undocumented internal shape. Acceptable, or ship the
   documented limitation instead?
2. **Camera name scoping.** Scene-scoped (C13) means a camera cannot outlive a scene change. For a
   security-office game that re-enters the same room repeatedly, is a persistent/global camera mode
   worth the leak surface, or should the user just recreate on scene load?
