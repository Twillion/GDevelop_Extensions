# Material 3D v3.5 — review of the enhancement plan, and implementation method

Response to `ADVANCED_MATERIAL_ENHANCEMENT_PLAN.md`. The six modules are all worth building. The
plan's *ordering* and one of its architectural assumptions need to change first, and three of its
technical claims are wrong in ways that matter.

Everything below was checked against the Three.js r160 actually installed at
`…/GDevelop/resources/GDJS/Runtime/pixi-renderers/three.js`, not from memory.

---

## 1. The blocking problem the plan does not address

**`onBeforeCompile` is a single function property. Two behaviors cannot both own it.**

BRDF Material currently does `mat.onBeforeCompile = function (shader) {…}`. Modules 1, 2, 3, 4 and 6
all need shader injection, which means Material 3D would assign `mat.onBeforeCompile` too. **Whichever
assigns last silently wins.** No error, no warning — the loser's shader edits simply never appear.

This is the same class of failure as the `src.clone` bug, one level up, and it is worse: that one at
least threw. This one renders a plausible-looking surface that is quietly missing half its features.

The plan's compatibility matrix says *"BRDFMaterial continues to compose cleanly via
`reapplyIfPatched()`"*. That is true but unrelated — `reapplyIfPatched` handles material
**replacement**, not shader-hook **ownership**. It does not help here.

It is worse still for Module 2. SSS injects at `lights_fragment_begin`; that is precisely where BRDF
rewrites the diffuse term. Even if both hooks somehow ran, they would be editing the same region of
the same chunk.

### The fix: one hook, a chain of injectors

Before any module is written, `onBeforeCompile` becomes owned by a single shared installer in
`Material3D.runtime.js`. Injectors register into an ordered chain; each declares the chunk it edits.
BRDF becomes the first registered injector rather than the hook's owner.

```
mat.onBeforeCompile = (shader) => {          // one owner, installed once
  for (const inj of chain) inj.inject(shader, mat);   // ordered, declared chunk each
};
mat.customProgramCacheKey = () => chain.map(i => i.key(mat)).join('|');
```

This is Phase 0. Nothing else can start until it exists, and it is the only part of this plan that is
genuinely hard to retrofit later.

**Corollary, and it is the bug we just shipped a fix for:** neither `onBeforeCompile` nor
`customProgramCacheKey` is carried by `Material.copy()` — confirmed in r160. Material 3D clones
materials. So the chain installer must re-run on every clone, and the chain state must live on direct
material properties, never in `userData` (which `copy()` JSON round-trips). Same house rule as
`__brdfPatched` / `__brdfOriginalRef`.

---

## 2. Three claims in the plan that are wrong

### 2.1 Module 5 needs no shader work at all

The plan schedules Sheen / Iridescence / Anisotropy in Phase 4 alongside shader modules. **All eight
fields are native on `MeshPhysicalMaterial` in r160** — verified present: `sheen`, `sheenColor`,
`sheenRoughness`, `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange`, `anisotropy`,
`anisotropyRotation`.

They are plain assignments, identical in kind to the `transmission` / `clearcoat` work already
shipped in 3.0.0. **Module 5 is roughly an afternoon, not a phase, and it should go first** — it
delivers real capability with zero shader risk while Phase 0 is being designed.

### 2.2 "Zero recompilations" misreads what `customProgramCacheKey` does

The plan says the cache key *"maintains zero recompilations"*. It does the opposite of what that
implies. `customProgramCacheKey` does not prevent recompiling — it prevents Three.js from
**incorrectly sharing one compiled program** between materials whose injected shader source differs.

Toggling POM on *will* recompile, and should. With five independent boolean feature flags the
material has **up to 32 distinct shader permutations**, each compiled on first use. That is correct
behaviour, but it is a real cost and the opposite of the plan's framing. Toggling features
per-frame will stutter; the documentation must say so.

### 2.3 Triplanar silently disables half the existing feature set

Module 3 synthesises UVs from world position. That makes every existing UV feature meaningless the
moment it is enabled: `TilingX/Y`, `OffsetX/Y`, `RotationAngle`, UV scrolling, and the entire
flipbook and video path. The plan does not mention this.

This is the same "half the properties go inert" objection that kept BRDF out of the material
behavior — and here it argues for explicit handling, not separation. Decision: when `EnableTriplanar`
is on, the UV-transform properties are ignored and a condition reports it, rather than silently doing
nothing.

---

## 3. Ordering, revised

The plan sequences by module number. I am sequencing by **risk and dependency**, so that each tier
ships something usable and provable before the next begins.

| Tier | Work | Shader code? | Why here |
| :---: | :--- | :---: | :--- |
| **0** | Shared injection chain + cache key + clone-safe reinstall. Convert BRDF to an injector. | none | Blocks everything else. Only piece that is hard to retrofit. |
| **A** | **Module 5** (sheen, iridescence, anisotropy) — native fields. **Module 6 partial**: wetness albedo darkening + roughness drive, computed CPU-side. | none | Real capability, zero shader risk, proves the property/setter pipeline end to end. |
| **B** | **Module 3** Triplanar · **Module 4** Detail/RNM · **Module 1** POM | yes, one chunk each | Independent injectors, no overlap with BRDF's chunk. POM last in the tier — the raymarcher is the hardest single piece. |
| **C** | **Module 2** SSS · **Module 6** animated ripples | yes, contested chunk | SSS edits `lights_fragment_begin`, BRDF's territory. Needs the chain proven by Tier B first, and an explicit ordering contract with BRDF. |

Most of Module 6's *visible* value — wet surfaces darkening and going glossy — is
`albedo *= (1 - wetness*porosity*0.35)` and `roughness = mix(roughness, 0.02, wetness)`. Both are
plain field assignments on the existing material. Only the animated ripples need a shader and a
per-frame time uniform. Splitting the module that way moves the payoff forward by three tiers.

---

## 4. Method, concretely

**Same build discipline as 3.0.0.** Every module is declared in `build-extension.mjs`, never
hand-edited into the JSON. The existing validators already catch the failure modes that matter
(unparseable blocks, control characters, `properties` vs `propertyDescriptors`, mis-bound behavior
parameters, conditions that never assign `returnValue`, setters naming undeclared properties). Two
new validators are needed:

- every injector declares a chunk name that exists in the r160 shader source
- no two injectors in the default chain declare the same chunk without an explicit ordering

**Properties follow the existing override mechanism.** Every new property gets a setter for free
through `setOverride` — the getters already consult the override map, so no per-field runtime code is
needed. This is why the merge was worth doing and the new modules should not invent a second path.

**Each module ships with a diagnostic.** GDevelop 3D shader work fails silently; that is the whole
reason the diagnostics layer exists. Each module gets a condition that reports whether its chunk
**actually landed in the compiled shader** — a string match on `shader.fragmentShader` after
injection, recorded on the material. Without that, debugging a module that "does nothing" is guesswork.

**Testing.** `test-material3d.mjs` extends with, per module: the property/setter round-trip, the
cache-key composition, and the injector's declared chunk actually being present in a stubbed shader
source. The stub must keep modelling `Material.copy()` faithfully — that fidelity is what caught the
last bug, and the chain-reinstall-on-clone requirement is the same trap again.

**What the tests still will not prove.** Whether the GLSL compiles, and whether it looks right. Every
tier needs a run in GDevelop before the next starts. Tier B and C are the ones where a passing test
suite means the least.

---

## 5. Scope, honestly

Tier 0 and Tier A are small and low-risk — foundation plus two modules' worth of capability with no
GLSL.

Tiers B and C are the largest single body of work in this repository: five raymarching and projection
shaders, injected into a chunk system that fails silently, across up to 32 compile permutations,
verified only by looking at pictures. The plan's ~29-day estimate is plausible for focused work with
in-engine iteration, and is not a thing to compress.

**Recommendation: build Tier 0 and Tier A now**, ship them, confirm in GDevelop. Then take Tier B one
module at a time, each with its own in-engine check, rather than as a phase.
