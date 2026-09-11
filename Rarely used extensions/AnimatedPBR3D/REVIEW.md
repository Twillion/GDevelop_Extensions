# AnimatedPBR3D 1.0.0 — maintainer review

> **Correction (after the first in-engine run).** The review below understated the damage. It said
> "6 of 17 actions throw". In fact **nothing in 1.0.0 ever ran**: `doStepPreEvents` threw
> `ReferenceError: behavior is not defined` on frame 1 for every object, because a JsCode block
> receives only `(runtimeScene, eventsFunctionContext)` — there is no `behavior` and no `object` in
> scope. See **D15**. **D16** covers a second runtime-verified defect: conditions must assign
> `eventsFunctionContext.returnValue`; a bare `return` is discarded. Both are now fixed.
> I found these by running the extension, not by reading — the static review missed both.

Verified against the GDevelop install on disk: Three **r160**, PIXI **7.4.2**
(`resources/GDJS/Runtime/pixi-renderers/{three,pixi}.js`), editor/serializer strings read out of
`resources/app.asar`. All 26 inline JS blocks were extracted and `node --check`ed — **all parse clean**.

---

## Confirmed defects

### D1 — CRITICAL. The property block is under the wrong JSON key. No properties exist; 6 of 17 actions throw.

The behavior object carries `"properties"` with 47 entries. GDevelop's serializer reads
`"propertyDescriptors"`.

Evidence:
- libGD's element-name table in `app.asar` contains exactly `propertyDescriptors` and
  `sharedPropertyDescriptors`; there is no `properties` sibling for behaviors.
- Every extension in this repo that actually ships uses `propertyDescriptors`: 3DCRTplus (43 / 51),
  AdvancedMaterials (15), ExtrudedSprite3D (3 + 2), VolumetricFog (4 + 2), YAxisPhysicsCharacter3D (15).
  Only AnimatedPBR3D, SoftBody3D and Advanced3DMaterial use `properties`.

Three consequences:

1. Nothing appears in the editor. README §1/§2/§3 instruct the user to tick boxes that do not exist.
2. GDevelop generates `_get<Name>` / `_set<Name>` only for declared properties (codegen template in
   app.asar: `GETTER_NAME(){return this._behaviorData.PROPERTY_NAME!==undefined?...}`; naming
   confirmed against AdvancedMaterials and 3DCRT+, which pair `behavior._getX()` with declared
   props). With none declared, `SetAlbedoTexture`, `SetNormalTexture`, `SetRoughnessTexture`,
   `SetMetalnessTexture`, `SetEmissiveTexture` and `SetTiling` all call `behavior._setXxx(...)`
   → **TypeError, action aborts**.
3. Every `getString` / `getNumber` / `getBoolean` read falls back to its hardcoded default forever.
   Target mode is permanently "All materials"; tiling permanently 1; AO map, base-colour tint, alpha
   mode, material side, wireframe and shadow flags are unreachable by any code path.

Second half of the same bug: the entries use `extraInfo`, but GDevelop serializes `extraInformation`
(`Nx=(e,t)=>{const n=new VectorString;n.push_back(t);e.setExtraInfo(n)}`, and AdvancedMaterials /
BRDF / ThreeJsTweaks all use `extraInformation`). So the 4 Choice dropdowns and 6 Resource-kind
filters would still be wrong after a plain key rename. `Resource` is a fully supported, ungated
property type (`{value:"Resource",label:{id:"Resource"}}` sits unconditionally in the type dropdown).

### D2 — CRITICAL perf. Every animated frame re-uploads all six textures to the GPU.

`applyTextureTransform` ends with `texture.needsUpdate = true`. It runs for all 6 maps inside
`updateAllMaterialTextures`, which `tick` calls every frame while scrolling or a flipbook runs.

r160: `set needsUpdate(t){!0===t&&(this.version++,this.source.needsUpdate=!0)}` — bumps the texture
*and its source*. `WebGLTextures` re-enters upload on `__version!==texture.version`, and the inner
`texImage2D` is guarded by `source.version`, which was also bumped. So this is a genuine full
`texImage2D` per texture per frame, not a cheap flag.

None of it is needed. `texture.matrixAutoUpdate` is `true` by default and the renderer calls
`updateMatrix()` → `matrix.setUvTransform(offset, repeat, rotation, center)` each frame. Mutating
`offset` / `repeat` / `rotation` / `center` requires **no** `needsUpdate`.

The same function also sets `mat.needsUpdate = true` per material per frame. Verified this takes the
`(M=!0, v.__version=i.version)` branch in the renderer → `getProgram()` plus a uniform-list rebuild
every frame. Cheaper than the uploads, still pure waste.

### D3 — The resource→URL fallback is dead code that would 404 if reached.

`loadTextureFromResource` falls back to `imageManager.getResource(name)` then
`imageManager._getURL(name)`. **Neither exists on `gdjs.PixiImageManager`.** Full member list:

```
_getImageSource, _loadTexture, add, clear, deleteValuesFor, dispose, disposeAll,
getInvalidPIXITexture, getOrCreateDiskTexture, getOrCreateRectangleTexture,
getOrCreateScaledTexture, getOrLoadPIXITexture, getPIXITexture, getPIXIVideoTexture,
getResourceKinds, getThreeCubeTexture, getThreeMaterial, getThreeTexture, getValuesFor,
loadResource, processResource, unloadResource
```

Both `typeof` guards fail, `fileUrl` falls through to the bare resource name, and
`TextureLoader.load("MyTexture")` requests a path that isn't the resource file.

Public replacements exist: `game.getResourceLoader().getResource(name)` → `.file`, and
`.getFullUrl(url)`.

### D4 — The hand-rolled loader is unnecessary, and it gets colour space wrong.

`gdjs.PixiImageManager.getThreeTexture(resourceName)` is public. It caches per resource in
`_loadedThreeTextures`, sets `wrapS`/`wrapT = RepeatWrapping`, applies the resource's smoothing
setting, and sets `colorSpace = THREE.SRGBColorSpace`.

- **Correctness:** the extension never sets `colorSpace`. Three's `Texture` defaults to `NoColorSpace`
  (`NoColorSpace=""`), so albedo and emissive maps skip the sRGB→linear decode and render visibly too
  bright next to the same image on a stock GDevelop 3D object. Normal, roughness, metalness and AO
  must stay linear — the code gets that right only by omission.
- **Memory:** textures are cached *per behavior instance* (`state.ownedTextures`). 100 instances of
  one object = 100 GPU uploads of the same image. `getThreeTexture` shares one.

The cached texture can't be used directly, because the extension mutates `repeat`/`offset`/`rotation`
and the engine both shares and disposes that texture (`disposeAll`, `unloadResource`). The correct
pattern is `imageManager.getThreeTexture(name).clone()`: verified `Texture.copy` does
`this.source = t.source`, so the clone shares the decoded image and gets its own UV matrix. The
extension then owns and disposes the clone.

### D5 — The video texture and video element are never disposed.

`restoreOriginalMaterials` disposes `ownedMaterials` and `ownedTextures`. `state.videoTexture` is in
neither, so its WebGL texture stays allocated for the renderer's lifetime. `state.videoElement` and
`state.videoTexture` are never nulled.

Worse: `SetAlbedoTexture` does `state.videoTexture = null` without pausing or disposing anything.
Switching a screen from video back to a still image leaves the video decoding forever and orphans
the GPU texture.

I checked whether object pooling compounds this — it does not. `RuntimeInstanceContainer` pools up to
128 instances per type, but `RuntimeObject.reinitialize` builds **fresh behavior objects**
(`const h=new o(t,a,this)`), so `behavior.__animatedPBR3DState` never carries over. Straight leak,
not cross-instance contamination.

### D6 — `new THREE.CanvasTexture ? ... : ...` precedence bug (`doStepPreEvents:165`).

`new THREE.CanvasTexture` with no argument list is a complete NewExpression. This constructs a
throwaway CanvasTexture, evaluates it as truthy, then constructs the real one. One dead texture per
load. The intent was `THREE.CanvasTexture ? ... : ...`.

### D7 — `IsFlipbookPlaying` returns true before any flipbook exists.

Initial state is `flipbook.isPlaying = true` with `flipbook.enabled = false`. The condition reads
`isPlaying` alone, so it reports "playing" for every object carrying the behavior from frame 1.
Should be `enabled && isPlaying && !isFinished`.

### D8 — No action, condition or expression guards the singleton.

All 26 blocks call `gdjs.__animatedPBR3D.…` bare. The module is only created inside
`doStepPreEvents`, and that function returns early when `THREE` is undefined. If THREE is missing, or
a condition runs before the object's first `doStepPreEvents` (object created by events earlier in the
same frame, with no prior instance), this is a TypeError. The author's own AdvancedMaterials guards
it correctly: `gdjs.__advancedMaterials ? ... : false`.

### D9 — Failure state is computed and never surfaced.

`applyToBehavior` sets `state.error` and `state.state = 'Failed'` for "3D Renderer object not
available", "No compatible meshes found" and "No matching materials found" — and nothing reads any of
it. No condition, no expression, no console output. Attach this to a Sprite (see D13) and it silently
does nothing forever.

### D10 — `lastAppliedSignature` is written and never read.

`computeSettingsSignature` builds a 30-field signature every time `applyToBehavior` runs; nothing
compares it. The whole "re-apply when editor settings change" mechanism was written and never wired
up. Once D1 is fixed, changing a property at runtime still won't take effect.

### D11 — Action parameter ranges: no outright contradictions, five with no clamp at all.

| Action | Param | Doc says | Actually enforced |
|---|---|---|---|
| SetNormalTexture | Scale | "e.g. 1.0" | nothing (write is dead — D1) |
| SetRoughnessTexture | Roughness | "(0 to 1)" | clamped 0–1, but only on the *property* read the action can't write |
| SetMetalnessTexture | Metalness | "(0 to 1)" | same |
| SetEmissiveTexture | Red/Green/Blue | "(0-255)" | clamped in the action ✓ |
| SetEmissiveTexture | Strength | — | `Math.max(0,…)` on the property read |
| SetScrollSpeed | SpeedX / SpeedY / RotSpeed | — | **nothing.** NaN reaches `uvOffset` → `texture.offset` → NaN UV matrix → undefined render |
| SetTiling | TilingX / TilingY | — | **nothing.** 0 collapses the texture; NaN breaks the UV matrix |
| SetFlipbookConfig | Columns / Rows | — | `Math.max(1,…)` but **no `Math.floor`** — 2.5 columns gives fractional frame UVs |
| SetFlipbookConfig | FPS | — | `Math.max(0.1,…)`; `Math.max(0.1, NaN)` is `NaN` → `frameDuration` NaN → animation silently frozen |
| SetFlipbookFrame | FrameIndex | "(0-based)" | `Math.max(0, Math.floor(x)) % totalFrames` ✓ |
| SetVideoTexture | VideoURL | — | none |

The internal `getNumber` helper *does* have a `Number.isFinite` guard. Every action bypasses it.

### D12 — README accuracy (checked both directions).

**Actions:** all 13 bullets map to real actions. Two are combined names covering two actions each —
fine as prose.

**Conditions: all four are named by their event-sheet sentence, not their editor name.**

| README says | Actual name in the condition list |
|---|---|
| "Flipbook animation is playing" | **Is flipbook playing** |
| "Flipbook animation is finished" | **Is flipbook finished** |
| "UV scrolling is active" | **Is UV scrolling enabled** |
| "3D material is ready" | **Is material ready** |

Searching the editor for the README's wording finds nothing.

**Expressions:** all five correct; `Object.AnimatedPBR3D::Name()` is the right syntax.

**False claims:**
- "Zero Memory Leaks … automatic GPU cleanup" — see D5.
- "smoothly at 60+ FPS" — see D2.
- §1/§2/§3 "in the object properties" / "in the behavior settings" — see D1.
- "Add to any 3D Model, 3D Box, or 3D Object" — `objectType` is unset, so it's offered on 2D objects too.

**Documented nowhere, and currently unreachable:** AO map + intensity, base colour tint, alpha
mode/opacity/cutoff, depth write, material side, wireframe, cast/receive shadow, target mode +
material index/name/mesh name, texture filtering, UV offset X/Y, UV rotation angle + centre, flipbook
total-frames override, clone materials, include children. Twenty-plus settings.

### D14 — The five resource parameters use an unregistered type and the wrong key. *(found while implementing)*

Every texture action declares its resource parameter as
`{"name":"ResourceName","type":"resource","description":"Image resource","extraInfo":["image"]}`.

Both halves are wrong:
- **`"resource"` is not a registered parameter type.** GDevelop's parameter-type table is
  `…, musicfile, soundfile, imageResource, videoResource, jsonResource, bitmapFontResource,
  model3DResource, atlasResource, spineResource, …` — each with its own field component
  (`ImageResourceField`, `Model3DResourceField`, …). There is no bare `resource`. GDevelop's own
  Cube3D face action uses `addParameter("imageResource", …)`. The correct type here is
  **`imageResource`**.
- **Parameters serialize `supplementaryInformation` as a string, not `extraInfo` as a list.**
  Across this repo's working extensions: `supplementaryInformation` 379 uses, e.g. 3DCRT+'s
  `stringWithSelector` and every `behavior` parameter. The 5 `type:"resource"` parameters in the repo
  are all in AnimatedPBR3D; nothing else uses that type.

So even with D1 fixed, these five parameters would not render as resource pickers. Same fix pattern
as D1 — the file was written against a schema GDevelop doesn't use, in two places.

### D13 — `objectType` is absent (not just empty).

GDevelop's 3D objects are `Scene3D::Cube3DObject` and `Scene3D::Model3DObject` — two distinct types,
and an events-based behavior carries exactly one `objectType`. Restricting isn't viable without
dropping one of them plus any custom 3D object. Leaving it open is the right call; it should be
declared explicitly as `""` to match the author's other extensions, with the failure surfaced (D9)
instead of silence.

### D15 — FATAL. `behavior` and `object` are not in scope in a JsCode block. *(found by running it)*

Every one of the 27 blocks referenced `behavior` and/or `object` as bare identifiers. GDevelop
generates each JsCode event as:

```js
…prototype.doStepPreEventsContext.userFunc0x155da40 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) { … }
```

Only those two names exist. `doStepPreEvents` therefore threw `ReferenceError: behavior is not
defined` on the first frame, for every object, in 1.0.0 and in the first 2.0.0 build.

The enclosing method does build what's needed, and puts it on the context:

```js
var thisObjectList = [this.owner];
…
_objectArraysMap:  { "Object": thisObjectList },
_behaviorNamesMap: { "Behavior": this.name },
```

so the correct preamble — the same shape 3DCRT+ already uses — is:

```js
const __pbrObjects = eventsFunctionContext.getObjects("Object");
const object = __pbrObjects.length ? __pbrObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
```

Confirmed the same binding exists for action methods, not just lifecycle ones: every generated
function is a method on the behavior with `thisObjectList = [this.owner]`, so `getObjects("Object")[0]`
is always exactly the owner. Also set `parameterObjects: "Object"` on each JsCode event, which 3DCRT+
does and this file omitted.

### D16 — Conditions returned nothing. *(found by running it)*

The generated wrapper ends with:

```js
…IsMaterialReadyContext.eventsList0(runtimeScene, eventsFunctionContext);
return !!eventsFunctionContext.returnValue;
```

and `eventsList0` calls the JsCode block **discarding its return value**. All four conditions used
`return <expr>;`, so every one of them always evaluated false. They now assign
`eventsFunctionContext.returnValue`.

Worth noting: `AdvancedMaterials` and `YAxisPhysicsCharacter3D` in this repo use the same
`return <expr>;` pattern in their conditions, so their conditions are very likely broken the same
way. Not verified — I did not run them.

---

## Suspicions — not confirmed, need in-engine testing

- **S1. Video on export.** `VideoURL` is a plain `string` written straight to `<video>.src`, so it
  resolves relative to the exported `index.html`. GDevelop rewrites resource paths on export and the
  file never enters the resource pipeline (the parameter isn't a `resource`). I'd expect
  preview-from-project-folder to work and export to break. I did not test either. The clean fix is a
  `resource` parameter of kind `video` resolved through `getResourceLoader().getFullUrl()` — but
  that's a parameter-type change on a shipped action.
- **S2. Autoplay.** `play()` is called with `.catch(warn)`. If the browser blocks it (unmuted, no user
  gesture) the texture shows frame 0 forever with only a console warning. No retry on first input, no
  condition to detect it. Untested.
- **S3. Pause / off-screen.** `game.isPaused()` exists and is not consulted; video keeps decoding
  while the game is paused, and there's no visibility check. Untested.
- **S4. Scene change.** Behavior `onDestroy` runs on object destruction, so material restore happens
  at scene end. I did not trace `scenestack.js` for stack-pop versus scene-replace to confirm it fires
  in both. Any video still playing at that moment is only paused, never disposed (D5).
- **S6. Expression return type.** The five expressions declare `"expressionType": "number"`, but the
  generated code ends `return "" + eventsFunctionContext.returnValue;` — a *string* return. The two
  working extensions checked (AdvancedMaterials, YAxisPhysicsCharacter3D) set no `expressionType` at
  all on their Expression functions. `expressionType` is a real key in GDevelop, but it may expect an
  object rather than the bare string `"number"`. **Unresolved — I stopped mid-investigation.** If
  `CurrentFrame()` misbehaves in a numeric context, this is why.
- **S5. UV offset drift.** `state.uvOffset` accumulates unbounded — an hour at speed 0.5 reaches 1800,
  where float32 in the UV matrix starts to visibly quantize. A `% 1` wrap fixes it but changes what
  `ScrollOffsetX()` returns, so it's a call for the author.

---

## Merely untidy

- `restoreOriginalMaterials` branches on the *current* material shape, not the original's:
  `mesh.material = Array.isArray(mesh.material) ? orig.slice() : orig[0]`.
- `state.ownedTextures` is never pruned; changing the albedo resource N times accumulates N textures.
- `if (albedoTex) mat.map = albedoTex` — no way to *clear* a map once set.
- `SetFlipbookFrame` doesn't clear `isFinished`, so jumping to frame 0 on a finished non-looping
  animation leaves it finished and paused. It also doesn't set `enabled`, unlike its two siblings.
- `SetScrollSpeed` force-sets `isScrolling = true` — an undocumented side effect that silently undoes
  a prior `EnableScrolling(false)`.
- No function has a `group`, so all 17 actions land in one flat list. 3DCRT+ groups its.
- `parseColor`'s non-`;` branch uses `color.set()`, skipping the sRGB conversion the `;` branch does.
  Unreachable in practice (Color properties always deliver `R;G;B`), but inconsistent.
- Missing `shortDescription`, `helpPath`, `iconUrl`, `previewIconUrl`, `authorIds`, `globalVariables`,
  `sceneVariables`, `eventsBasedObjects` — all present in 3DCRTplus.json. No icon in the list.

---

## Not a defect — checked and cleared

- The 573-line module is built **once** (`if (!gdjs.__animatedPBR3D)`), not per frame. The shallow
  scan's reading was wrong. The real per-frame cost is D2 plus roughly twenty redundant property reads
  and a `.filter()` allocation inside `updateAllMaterialTextures`, all of it invariant.
- `aoMap` works on UV0. In r152+ `Texture.channel` defaults to 0 and `AOMAP_UV` follows it, so no
  second UV set is required.
- `Color.setRGB(r, g, b, colorSpace)` is a valid r160 signature.
- `pixiTexture.baseTexture.resource.source` is the correct PIXI 7 path — GDevelop's own
  `_getImageSource` uses it.
- A missing resource yields the magenta `_invalidTexture`, never null, so a typo'd name renders
  magenta rather than crashing. Matches engine convention.
- All 26 JS blocks pass `node --check`.
