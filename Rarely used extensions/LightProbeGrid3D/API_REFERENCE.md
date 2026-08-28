# LightProbeGrid3D — API Reference & Specification

Behaviors, Actions, Conditions, Expressions, data formats and GLSL interfaces for
**LightProbeGrid3D**.

Every default and constraint here follows the corrections in
[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), which are cited inline as **C1**–**C19**. Where
this document differs from the first draft, the correction number says why.

**Units are GDevelop world units (pixels), never metres** (**C14**). A humanoid character is
typically 50–200 units tall.

---

## 0. Requirements

| Requirement | Behaviour if unmet |
| :--- | :--- |
| **WebGL2 context** | The entire subsystem disables itself, logs once, and leaves every material untouched. `sampler3D` does not exist in GLSL ES 1.00, so injecting on WebGL1 is a shader compile error, not a degraded look. (**C4**) |
| **A lit material type** | `MeshBasicMaterial` has no lighting chunks. Model3D objects set to material type **Basic**, and Cube3D faces with `forceBasicMaterial`, cannot receive probe light; the behavior warns once, naming the object. (**C10**) |
| **One volume per scene** | v1 supports a single active volume. Overlapping-volume blending is deferred. |

---

## 1. Behaviors

### 1.1 `LightProbeVolume3D`

*Attach to a **Cube3D** object. The cube's position and size are the volume bounds, which gives you
the editor's 3D scale gizmo for free. Set the cube's opacity to 0, or hide it, so it does not render.*

A `.json` extension cannot declare a new object type, so this is a behavior on an existing object
rather than a `LightProbeVolume3D` object (**C12**).

#### Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ResolutionX`** | Number | `16` | Probes along world X. Clamped to [2, 64]. |
| **`ResolutionY`** | Number | `16` | Probes along world Y. Clamped to [2, 64]. |
| **`ResolutionZ`** | Number | `4` | Probes along world **Z — the height axis** (**C1**). Clamped to [2, 64]. |
| **`SkyColor`** | Color | `rgb(160, 200, 255)` | Ambient colour arriving from above. |
| **`GroundColor`** | Color | `rgb(80, 120, 50)` | Ambient bounce colour arriving from below. |
| **`HorizonColor`** | Color | `rgb(200, 220, 240)` | Ambient colour at the horizon plane. |
| **`VolumeIntensity`** | Number | `1.0` | Global ambient scale for this volume. `1.0` matches a GDevelop `AmbientLight` of the same colour and intensity (**C9**). |
| **`DayNightMode`** | Boolean | `false` | Allocate and blend a second night volume. |
| **`AutoBakeOnStart`** | Boolean | `false` | Automatically start amortized scene ambient probe bake when the scene loads. |
| **`ShowDebugSpheres`** | Boolean | `false` | Draw probe spheres **in preview and runtime only — not in the editor** (**C19**). |

Resolution is authoritative and spacing is derived, not the other way round (**C15**). Spacing is
reported read-only through `LightProbeGrid::GetProbeSpacingX/Y/Z()`. Making spacing authoritative
would mean that stretching the volume cube silently multiplies the probe count — a level grown from
500 to 5,000 units at 15-unit spacing goes from a 64 KB texture to a 46 MB one with no warning.

`ResolutionZ` defaults lower than X and Y because ambient light varies far less with altitude than
horizontally, and because probe count — and therefore bake time — is the product of all three.

Default probe count is 16 × 16 × 4 = **1,024**. This is deliberately below the first draft's 8,192:
at 6 renders per probe a CubeCamera bake of 8,192 probes is 49,152 full scene renders, roughly 98
seconds of unresponsive GPU work (**C13.3**).

---

### 1.2 `ReceiveLightProbes`

*Attach to any lit 3D object (`Model3DRuntimeObject`, `Cube3DRuntimeObject`) to sample the volume.*

#### Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`IntensityMultiplier`** | Number | `1.0` | Per-instance multiplier on received indirect light. |
| **`NormalBiasOffset`** | Number | `15.0` | Offset along the surface normal, **in world units** (**C14**). Roughly a quarter of a probe cell at default settings. |
| **`UpdateFrequency`** | Choice | `Continuous` | `Continuous` (every frame) or `Throttled` (every 5 frames, for distant objects). |
| **`Enabled`** | Boolean | `true` | Whether sampling is active on this instance. |

> **Implementation note — material cloning.** GDevelop shares materials across the whole game:
> `SkeletonUtils.clone` does not clone materials, and `getThreeMaterial` memoises by
> (resource, options). Writing a uniform on the material a behavior finds would change lighting for
> every object in the game using that model or texture. This behavior therefore **clones the material
> on attach**, per mesh per instance, and refcounts the source (**C3**).
>
> The cost is: no extra draw calls, no extra shader compiles, no extra GPU memory — one `Material`
> object per mesh per instance and one uniform upload per draw. On destroy, the clone is disposed and
> the original reference restored; the memoised source is **never** disposed (**C18**).

The first draft's `0.2` default for `NormalBiasOffset` was specified in metres. In a pixel-unit
GDevelop scene that is one fifth of a pixel — indistinguishable from zero, which defeats the purpose
of the bias entirely.

#### Actions
* **`Set intensity multiplier to _PARAM1_ on _PARAM0_`**
* **`Set normal bias offset to _PARAM1_ on _PARAM0_`** — world units.
* **`Enable / Disable receiving light probes on _PARAM0_`**

#### Conditions
* **`_PARAM0_ is receiving light probes`** — false when disabled, when the volume is not loaded, when
  the context is WebGL1 (**C4**), or when the object's material type is Basic (**C10**).

#### Expressions
* **`Object.ReceiveLightProbes::Intensity()`**
* **`Object.ReceiveLightProbes::NormalBias()`**

---

## 2. Global Actions, Conditions & Expressions

### Actions

* **`LightProbeGrid::SetBounds(MinX, MinY, MinZ, MaxX, MaxY, MaxZ)`**
  Sets volume bounds in GDevelop world coordinates for the code-driven case, as an alternative to
  sizing the Cube3D. The runtime applies the Y mirror on upload (**C2**); callers pass ordinary
  GDevelop coordinates and never deal with the mirror.

* **`LightProbeGrid::SetDayNightBlend(Number factor)`**
  Global day → night interpolation. `0.0` = day, `1.0` = night. Clamped. Requires `DayNightMode`.

* **`LightProbeGrid::SetGlobalIntensity(Number intensity)`**
  Global multiplier across all volumes.

* **`LightProbeGrid::LoadProbeDataFromFile(String filePath)`**
  Loads a `.lpg.bin` payload into the active 3D texture. Rejects a file whose resolution does not
  match the current volume rather than reinterpreting the buffer.

* **`LightProbeGrid::StartBake()`**
  Begins an amortised bake. Work is spread across frames inside a per-frame millisecond budget in
  `registerRuntimeScenePostEventsCallback`; it does not block (**C13.3**). Poll
  `GetBakeProgress()` and `IsBakeComplete()`.

* **`LightProbeGrid::CancelBake()`**
  Aborts an in-progress bake and restores the previous volume contents.

* **`LightProbeGrid::SetBakeBudgetMs(Number ms)`**
  Per-frame bake budget. Default `8`.

* **`LightProbeGrid::ExportProbeData(String fileName)`**
  Writes the current volume to `.lpg.bin`. Preview/desktop only.

* **`LightProbeGrid::ToggleDebugVisualizer(Boolean enable)`**
  Shows or hides the instanced debug spheres. Preview and runtime only (**C19**).

The first draft's single `BakeSceneProbes(outputFileName)` conflated a multi-second operation with a
file write and gave events no way to observe progress. It is split into
`StartBake` / `GetBakeProgress` / `IsBakeComplete` / `ExportProbeData`.

### Conditions

* **`LightProbeGrid::IsSupported()`** — WebGL2 present and the subsystem is active (**C4**). Gate
  your setup events on this.
* **`LightProbeGrid::IsProbeVolumeLoaded()`** — a valid 3D texture is bound.
* **`LightProbeGrid::IsBakeInProgress()`**
* **`LightProbeGrid::IsBakeComplete()`**
* **`LightProbeGrid::IsDayNightModeEnabled()`**

`IsDayNightBlendActive()` from the first draft conflated "day/night mode is on" with "a blend is
currently animating". The extension does not drive the blend — events do — so only the former is
meaningful.

### Expressions

* **`LightProbeGrid::GetDayNightBlend()`** — current blend, 0.0–1.0.
* **`LightProbeGrid::GetActiveProbeCount()`** — $N_x \times N_y \times N_z$.
* **`LightProbeGrid::GetProbeSpacingX()`** / **`Y()`** / **`Z()`** — derived, read-only (**C15**).
* **`LightProbeGrid::GetBakeProgress()`** — 0.0–1.0.
* **`LightProbeGrid::GetVRAMBytes()`** — actual texture bytes, for budgeting.

---

## 3. Coordinates, orientation and units

The single most common source of wrong-looking results, and the reason for tests 2 and 6 in the
plan's verification table.

| Fact | Consequence for this API |
| :--- | :--- |
| **Up is +Z** (`HemisphereLight` hard-codes `_top = "Z+"`) (**C1**) | `ResolutionZ` is the altitude axis. Sky/ground gradients run along Z. |
| **The 3D scene root has `scale.y = -1`** (**C2**) | The shader's world space is Y-mirrored relative to GDevelop's. All API surfaces take **unmirrored GDevelop coordinates**; the runtime mirrors on upload. `min.y` in three-space is `-maxY` in GDevelop space. |
| **World units are pixels** (**C14**) | No parameter is ever documented in metres. |
| **`useLegacyLights = true`** (**C9**) | Ambient light colours are pre-multiplied by π on upload, so the runtime applies the same π to injected irradiance. `VolumeIntensity = 1.0` therefore matches an `AmbientLight` at the same colour and intensity. Without this the extension reads π× too dark. |

---

## 4. Data Format Specification

### `.lpg.bin` (canonical)

The first draft's JSON format is dropped as a shipping format. A 32 × 8 × 32 day+night volume is
65,536 float values; as JSON that is roughly 800 KB of text parsed on the main thread to produce
128 KB of GPU data. The binary layout matches the GPU layout exactly, so loading is a copy, not a
conversion.

**Header — 32 bytes, little-endian:**

| Offset | Size | Field |
| ---: | ---: | :--- |
| 0 | 4 | Magic `LPG3` (ASCII) |
| 4 | 4 | `version` — uint32, currently `1` |
| 8 | 4 | `resX` — uint32 |
| 12 | 4 | `resY` — uint32 |
| 16 | 4 | `resZ` — uint32 (height, **C1**) |
| 20 | 1 | `encoding` — uint8: `0` = RGBA16F, `1` = RGBA8 |
| 21 | 1 | `flags` — uint8: bit 0 = night volume present |
| 22 | 2 | reserved, zero |
| 24 | 4 | reserved, zero |
| 28 | 4 | reserved, zero |

**Bounds — 24 bytes**, immediately following: `minX, minY, minZ, maxX, maxY, maxZ` as float32, in
**unmirrored GDevelop coordinates**. Mirroring is a runtime upload concern and must not be baked into
the file (**C2**).

**Payload:** day volume as $resX \times resY \times resZ \times 4$ half floats (or bytes), in
`((z * resY + y) * resX + x) * 4` order — z is the outer loop. If bit 0 of `flags` is set, the night
volume follows in the same layout.

Spacing is not stored: it is `(max - min) / (res - 1)` per axis (**C15**).

Default volume size: 16 × 16 × 4 × 4 channels × 2 bytes = **8 KB**; day+night = **16 KB**.
At 32 × 8 × 32: **64 KB**, day+night **128 KB**.

### `.lightprobe.json` (debug only)

Retained for inspection and diffing, not for shipping. Same fields as the header plus `dataDay` /
`dataNight` as plain float arrays. Loading it is supported but logs a warning recommending `.lpg.bin`.

---

## 5. GLSL Shader Injection Specification

Injected into `MeshStandardMaterial` / `MeshPhysicalMaterial` / `MeshPhongMaterial` — anything that
includes `lights_fragment_begin`. Not `MeshBasicMaterial` (**C10**).

### 5.1 Fragment prelude

```glsl
precision mediump sampler3D;            // C5 — GLSL ES 3.00 defines no default
                                        // precision for sampler3D in fragment shaders.

uniform sampler3D u_LPG_VolumeDay;
uniform sampler3D u_LPG_VolumeNight;    // bound to Day when night is unused — C11
uniform vec3  u_LPG_VolumeMin;          // mirrored on upload — C2
uniform vec3  u_LPG_VolumeSize;
uniform float u_LPG_Intensity;          // includes the legacy-lights PI — C9
uniform float u_LPG_DayNightBlend;
uniform float u_LPG_NormalBias;         // world units — C14

varying vec3 vLPG_WorldPos;

vec3 evaluateLightProbeGrid( vec3 worldPos, vec3 worldNormal ) {
    vec3 samplePos = worldPos + worldNormal * u_LPG_NormalBias;
    vec3 uvw = clamp( ( samplePos - u_LPG_VolumeMin ) / u_LPG_VolumeSize,
                      vec3( 0.0 ), vec3( 1.0 ) );
    vec3 day   = texture( u_LPG_VolumeDay,   uvw ).rgb;
    vec3 night = texture( u_LPG_VolumeNight, uvw ).rgb;
    return mix( day, night, u_LPG_DayNightBlend ) * u_LPG_Intensity;
}
```

No `material.glslVersion` change is needed. Three r160 upgrades every non-raw material to
`#version 300 es` on a WebGL2 context, unconditionally — the gate in `WebGLProgram` is
`isWebGL2 && !isRawShaderMaterial`, not `glslVersion === GLSL3`. Setting `glslVersion` ourselves
would suppress the `gl_FragColor` → `pc_fragColor` shim and break the material (**C4**).

### 5.2 Vertex, after `#include <worldpos_vertex>`

```glsl
#ifdef USE_INSTANCING
    vLPG_WorldPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
    vLPG_WorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif
```

Recomputed rather than reusing Three's `worldPosition`, which only exists under `USE_ENVMAP`,
`DISTANCE`, `USE_SHADOWMAP` or `USE_TRANSMISSION`.

### 5.3 Fragment, after `#include <lights_fragment_begin>`

```glsl
irradiance += evaluateLightProbeGrid(
    vLPG_WorldPos,
    inverseTransformDirection( normal, viewMatrix )
);
```

`irradiance` is the accumulator that `lights_fragment_end` hands to `RE_IndirectDiffuse`, which
applies `BRDF_Lambert`. This is the same path `AmbientLight` and `HemisphereLight` already take.

The first draft added the contribution to `diffuseColor` **and** `reflectedLight.indirectDiffuse`.
That double-counts, and writing `diffuseColor` tints albedo — so the object also becomes brighter
under every direct light in the scene, and washes out to white (**C8**).

`inverseTransformDirection` lives in the `common` chunk, always included. It returns the normal in
the same Y-mirrored world space as `vLPG_WorldPos`, so the bias offset stays consistent (**C2.2**).

### 5.4 Texture state (CPU side)

```js
const tex = new THREE.Data3DTexture( halfFloatData, resX, resY, resZ );
tex.format    = THREE.RGBAFormat;
tex.type      = THREE.HalfFloatType;                 // C7 — RGBA16F is core-filterable in WebGL2
tex.minFilter = tex.magFilter = THREE.LinearFilter;  // C6 — the constructor defaults to Nearest
tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
tex.generateMipmaps = false;
tex.needsUpdate = true;
```

Both lines are load-bearing:

* `Data3DTexture`'s constructor sets `magFilter = minFilter = NearestFilter`. Without `LinearFilter`
  there is no trilinear interpolation at all — just blocky voxel stepping (**C6**).
* `FloatType` (RGBA32F) linear filtering needs `OES_texture_float_linear`, an *optional* WebGL2
  extension. Where it is missing the texture silently falls back to nearest — the same symptom, on
  some machines only (**C7**).
* Without `ClampToEdgeWrapping`, a fragment at the volume boundary blends with the voxel on the
  opposite face.

### 5.5 Program cache key

```js
material.customProgramCacheKey = () => 'LPG3D|1';
```

Three's default is `onBeforeCompile.toString()`, and `getProgramCacheKey` pushes `shaderID` for
built-in materials — the generated source is never hashed. Two materials whose `onBeforeCompile` has
identical source text but injects different code, because the closure captured a different flag,
would silently share one compiled program (**C11**).

v1 compiles exactly one variant, which makes this class of bug impossible; the explicit key is there
so that adding a variant later cannot reintroduce it silently.

---

## 6. Deferred to v2

| Feature | Why deferred |
| :--- | :--- |
| **L1 / L2 spherical harmonics** | The first draft's L2 formula omits the SH normalisation constants and the cosine-lobe convolution coefficients, so band magnitudes are wrong by factors of 2–4. Storage is also 7 RGBA texels and 7 fetches per probe against the advertised single fetch. v1 ships L0; L1 (4 coefficients, 2 texels) is the sane upgrade (**C17**). |
| **Multiple overlapping volumes** | Needs a priority and feather scheme. |
| **Runtime probe relighting** | Baked volumes only; day/night is a two-state blend. |
| **Editor-side debug rendering** | A `.json` extension has no editor rendering hook (**C12**, **C19**). |
