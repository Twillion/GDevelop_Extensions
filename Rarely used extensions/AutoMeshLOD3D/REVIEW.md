# AutoMeshLOD3D 1.0.0 — correctness review

Verified against the installed runtime at
`C:\Users\chris\AppData\Local\Programs\GDevelop\resources\GDJS\Runtime\` (Three **r160**).
The decimator was exercised directly under Node; every measurement quoted below is from an
actual run, not an estimate.

**C1, C2 and M3 are fixed** (see each section for what changed and the numbers after). Everything
else below is still open. **Nothing has been run inside GDevelop yet** — the C1 fix in particular
wants an in-engine check: two instances of one model at different distances, plus one animated
skinned model to confirm the per-instance geometry does not disturb skinning or morph targets.

## What is already right

- `AutoMeshLOD3D.json` is byte-identical to what `build-extension.mjs` produces from the current
  `.worker.js` / `.runtime.js` — the shipped JSON is not stale.
- No NUL or control characters; all inline JS blocks parse.
- Uses `propertyDescriptors` (not `properties`), so the `_get<Name>` getters will exist.
- The `PREAMBLE` resolves `object` / `behavior` through `eventsFunctionContext` rather than assuming
  they are in scope, and conditions assign `eventsFunctionContext.returnValue`. Both of the traps
  that broke AnimatedPBR3D 1.0.0 are avoided here.
- `Scene3D::Model3DObject`, `get3DRendererObject()`, `layer.getRenderer().getThreeCamera()` and
  `getGameResolutionHeight()` all match the runtime on disk.
- The QEM math (`evaluateQuadric`) is correct, and on welded geometry the decimator hits its targets
  exactly (50.0% / 20.0%) while retaining 99.1% / 92.3% of surface area, with zero degenerate
  triangles.

---

## C1 — FIXED. Geometry is shared between all instances of a model; LOD is applied per instance.

`Model3DRuntimeObject3DRenderer` builds each instance with `THREE_ADDONS.SkeletonUtils.clone(...)`,
and Three's `Mesh.copy` does `this.geometry = t.geometry` — clones **share the geometry object**.

`applyLOD` mutates that shared object:

```js
meshData.geometry.setIndex(targetIndexBuffer);   // runtime.js:612
```

So with N instances of the same `.glb`, whichever instance ran `doStepPreEvents` last decides the
LOD for **all** of them. A single distant tree drops the whole forest to LOD 2; a close one pulls
them all back — every frame, re-uploading the index buffer each time. `ensureIndexedGeometry`
(runtime.js:238) and `dispose()` (runtime.js:641) mutate the same shared object too, so destroying
one instance restores full detail for every other instance.

**Fixed.** `makeInstanceGeometry` gives each behavior instance its own `BufferGeometry` that re-uses
the *same* attribute objects (`setAttribute(name, sharedAttr)`, plus morph attributes, groups and
draw range) and differs only in `index`; `initialize` installs it on the mesh. That keeps the
shared-VBO claim intact — `BufferGeometry.clone()` would not, it deep-copies the attributes. The
cache is now keyed on the *source* geometry's uuid, so instances of one model still decimate once
between them. `makeIndexAttribute` replaces `ensureIndexedGeometry` and no longer writes an index
onto the shared geometry, and `dispose` hands the mesh its shared geometry back (dropping the
wrapper rather than calling `dispose()` on it, which would evict the shared attributes from the
renderer and force every other instance to re-upload).

Verified on a stub-THREE harness with two instances built over one geometry: distinct geometries,
`position` attribute still shared by both, one decimation result reused, and A at LOD 2 (160 tris)
alongside B at LOD 1 (399 tris) with the source geometry untouched at 800.

## C2 — FIXED. On non-indexed geometry the "decimation" only deletes triangles, leaving holes.

`ensureIndexedGeometry` deliberately supports non-indexed geometry by generating an identity index
(runtime.js:244). In that case every triangle owns three unique vertices, no edge is shared, and a
collapse can only degenerate the triangle it happens inside. Measured on a 960-triangle sphere:

| input | LOD | triangles | surface area kept | output tris that are verbatim originals |
| --- | --- | ---: | ---: | ---: |
| welded | 0.5 | 480 (50%) | 99.1% | 110 / 480 |
| welded | 0.2 | 192 (20%) | 92.3% | 32 / 192 |
| non-indexed | 0.5 | 480 (50%) | **67.3%** | **480 / 480** |
| non-indexed | 0.2 | 192 (20%) | **29.2%** | **192 / 192** |

100% of surviving triangles are untouched originals, and the area loss tracks the triangle loss
exactly: the mesh is being punched full of holes, not simplified. The triangle-count target is met,
so nothing reports a failure.

**Fixed.** `decimate` now welds by exact position first (numeric spatial hash on the float bit
patterns, so no per-vertex strings), builds all topology on the welded representatives, and maps back
at snapshot time: a corner that never moved keeps its **original** vertex id — and with it its own UV
and normal copy — while only corners that actually moved take the representative's id. Both are ids
into the untouched vertex buffer, so the shared-VBO property is unchanged. Triangles that weld to
zero area are dropped up front, and `PreserveSeams` now also pins a position whose duplicate copies
disagree on UV, the way it already pinned mesh borders.

After the fix, the same three inputs:

| input | LOD | triangles | surface area kept | output tris that are verbatim originals |
| --- | --- | ---: | ---: | ---: |
| welded | 0.5 / 0.2 | 50% / 20% | 99.1% / 95.6% | 128/480, 33/192 |
| seam-split | 0.5 / 0.2 | 49.9% / 20% | 99.1% / 94.7% | 120/479, 34/192 |
| non-indexed | 0.5 / 0.2 | 50% / 20% | **99.1% / 95.6%** | **128/480, 33/192** |

The non-indexed case is now identical to the welded one, as it should be — 67.3%/29.2% area became
99.1%/95.6%, and it is rewriting triangles instead of deleting them. No out-of-range or degenerate
indices in any output. Cost is essentially unchanged (65k tris: 1464 ms / +134 MB, against
1485 ms / +127 MB before), so M5 still stands.

One residual: for a *flat-shaded* mesh — copies that share UVs but differ in normals — a moved corner
takes the representative's normal, which is not detected as a seam. LOD meshes shade differently
anyway; worth revisiting only if it shows up in practice.

## H1 — The "Enable / Disable AutoMeshLOD" action does nothing.

The action writes `state.enabled`, but `step` reads the behavior property instead:

```js
if (!getB(behavior, 'Enabled', true)) {   // runtime.js:482
```

`state.enabled` only feeds the `IsEnabled` condition and `GetTotalTrianglesSaved`, so after using
the action the condition reports the opposite of what is actually happening. Either read
`state.enabled` in `step`, or have the action call the generated `_setEnabled`.

## H2 — The cache key ignores the ratios the buffers were computed with.

`generateGeometryKey` returns `geometry.uuid` (runtime.js:231). Because geometry is shared (C1), two
objects using the same model *always* collide. The second one to initialise adopts the first one's
`lodIndices` no matter what its own `LOD1Ratio` / `LOD2Ratio` / `PreserveSeams` are set to, silently.
Key on `uuid + ratios + preserveSeams`.

## H3 — Animation throttling doesn't throttle animation, and leaks a disabled flag.

`step` toggles `mesh.matrixAutoUpdate` (runtime.js:577 / 584). That flag governs the mesh node's own
local matrix; it has no effect on `AnimationMixer.update()` or `Skeleton.update()`, which GDevelop
drives from its own renderer. No bone work is skipped, so the property tooltip ("LOD1: 30 FPS,
LOD2: 15 FPS") is not achieved at any distance.

Worse, the whole block is gated on `state.currentLOD > 0`. If the object returns to LOD 0 on a frame
where the flag was last set to `false`, nothing ever sets it back — that mesh's local matrix is
frozen from then on, and `dispose()` doesn't restore it either.

## H4 — `castShadow` is force-written every frame and never restored.

```js
state.meshes[i].mesh.castShadow = shouldCastShadow;   // runtime.js:558
```

This runs unconditionally for every mesh, so an object the user configured *not* to cast shadows
starts casting them the moment it is inside the cutoff, fighting GDevelop's own `_updateShadow()`.
The original value is never captured and never restored on disable or destroy. Record the initial
`castShadow` per mesh and only ever clear it, never set it.

## M1 — Any mesh with 4 or fewer triangles always fails decimation.

`decimate` short-circuits for `initialTriangleCount <= 4` and assigns **the same `Uint32Array`
instance** to every ratio (worker.js:155-160). The worker then pushes that one `ArrayBuffer` into
the transfer list twice, which is a spec violation — confirmed under Node:
`DataCloneError - Transfer list contains duplicate ArrayBuffer`. It is thrown inside the `try`, so it
comes back as a `DECIMATE_ERROR` and that mesh silently stays at LOD 0 forever. Copy per ratio, or
de-duplicate the transfer list.

## M2 — The worker UMD executes on the main thread every frame, and hijacks `window.onmessage`.

`build-extension.mjs` prepends the entire worker source to `doStepPreEvents`, and JsCode blocks are
emitted as a `userFunc` that runs once per instance per frame. So the UMD IIFE re-runs constantly,
re-creating `MinHeap` and `decimate`, and each time hits:

```js
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = function (e) { ... };   // worker.js:479-480
```

In a browser `self` is `window` and `window.postMessage` is a function, so this installs — and
re-installs, 60×/sec per object — a global `onmessage` handler, clobbering anything else on the
page. Guard on `typeof importScripts === 'function'` (or `WorkerGlobalScope`) instead.

## M3 — FIXED in passing. Every job shipped a redundant copy of the original index buffer.

`extractMeshBuffers` returned `originalIndex` (a `THREE.BufferAttribute`) inside the object that
becomes `payload.geometry`. It was not in the transfer list and the worker never read it, so
`postMessage` structured-cloned the whole attribute — including a full copy of the index array — on
every job. The C1 rework re-signed that function as `extractMeshBuffers(geometry, indexAttr)` and it
no longer returns the attribute.

## M4 — ScreenCoverage mode uses an unscaled radius and ignores its own settings.

`boundingRadius` is `geometry.boundingSphere.radius` in the model's local space (runtime.js:361), but
GDevelop normalises the model and rescales it via a matrix on the wrapping group. The projected-pixel
figure is therefore off by the model's entire scale factor. The mode also ignores `globalLODBias` (it
uses raw `dist`, not `effectiveDist`) and both configured LOD distances, in favour of hard-coded
60 px / 160 px thresholds that appear in no documentation.

## M5 — Cost and memory of a single decimation job.

Measured (welded spheres, both ratios, one call):

| triangles | time | peak heap |
| ---: | ---: | ---: |
| 9,024 | 107 ms | — |
| 16,128 | 297 ms | +27 MB |
| 65,024 | 1,485 ms | +127 MB |

Cost is superlinear, driven by the string-keyed `edgeFaceCount` Map and `evaluatedEdges` Set
(`` `${u}_${v}` ``). Four workers on a couple of 65k models is a multi-hundred-MB spike, and the
synchronous fallback would stall the main thread for over a second. Pack edge keys numerically
(`u * vertexCount + v`) and use typed arrays.

Related: `geometryCache` is commented "LRU cache" but has no eviction of any kind — it only grows,
across scene changes, until `ClearLODCache` is called by hand. The worker pool and `activeInstances`
are likewise never torn down between scenes.

## L1 — Dead fallback builds a Worker out of `"[object Object]"`.

If `__AUTOMESH_WORKER_CODE__` were ever missing, `getWorkerSource()` returns
`AutoMeshDecimator.toString()` — `"[object Object]"` for a plain object, which is truthy, so the
`if (!workerCode) return false` guard passes and a Worker is constructed from garbage
(runtime.js:49-55). Harmless in the built extension, but a trap; return `''` or check for a function.

## L2 — `currentLOD` is set to `-1` while any mesh is still waiting.

`applyLOD` sets `state.currentLOD = -1` if any mesh fell back (runtime.js:619). While that holds, the
`CurrentLODIs` condition is false for 0, 1 and 2 alike, the throttling branch is skipped, and `step`
re-enters `applyLOD` every frame. A separate `partial` flag would keep the reported tier meaningful.

## L3 — A mesh that fails extraction is left permanently "not ready".

In `initialize`, `state.meshes.push(meshData)` happens before the `extractMeshBuffers` /
`if (!extracted) continue` check (runtime.js:383-404), so a failed mesh stays in the array with
`ready === false` and `decimationReady` can never become true for that object.

## L4 — Three copies of the runtime in the JSON.

`onCreated`, `doStepPreEvents` and `onFirstSceneLoaded` each embed the full 56 KB worker+runtime
string: 168 KB of the 217 KB file. `onFirstSceneLoaded` alone is enough, given the
`if (!gdjs.__autoMeshLOD3D)` guard.

## L5 — Documentation claims the code does not implement.

- API_REFERENCE §3 shows `skinIndices` / `skinWeights` in the worker payload — the runtime never
  extracts or sends skin data.
- API_REFERENCE §3 shows the reply keyed `lodIndices: {1: ..., 2: ...}` — it is actually keyed by
  ratio (`{"0.5": ..., "0.2": ...}`).
- `PreserveSeams` is labelled "Preserve UV & Boundary Seams". Before the C2 fix, `uvs` and `normals`
  were passed into `decimate` and never read — only geometric boundary edges
  (`edgeFaceCount === 1`) were protected. `uvs` now drives seam pinning; `normals` are still unread.
- README's "zero 60 FPS frame drops" is undercut by M2 (per-frame main-thread work) and M5.
- `LastError` is exposed but `state.lastError` is only written on decimation failure; the two
  "no 3D renderer / no mesh" failures in `initialize` set it and then `step` retries `initialize`
  every frame, so it churns rather than latching.
