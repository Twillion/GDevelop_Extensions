# Plan — Sea of Thieves fidelity, per-style effect modules, and a water-type library

Status: **implemented in 3.0.0.** All five phases shipped; see the Delivered section at the end
for what changed and what remains unverified.

Written against 2.20.0.

---

## 1. What the screenshots actually show

Three separate defects, measured rather than guessed.

### 1a. The lines — foam is a sine pattern, not foam

`WAVEWORKS_FRAGMENT_SHADER` builds its whitecap mask from pure sinusoids of **world position**:

```glsl
vec2 foamUv = vec2(dot(vGdXY, wDir) * 0.025 + u_Time * 0.55,
                   dot(vGdXY, wCross) * 0.12 - u_Time * 0.18);
float fn1 = sin(foamUv.x * 3.5 + sin(foamUv.y * 4.0)) * 0.5 + 0.5;
float fn2 = sin(foamUv.x * 7.0 - foamUv.y * 5.0 + u_Time) * 0.5 + 0.5;
float cellNoise = sin(foamUv.y * 8.0 + fn1 * 3.14159) * cos(foamUv.x * 5.0) * 0.5 + 0.5;
```

Every term is periodic, so the mask is a set of straight parallel bands at fixed spacing:

| term | period | direction |
| :--- | ---: | :--- |
| `fn1  sin(foamUv.x * 3.5)` | 71.8 units | along wind |
| `fn1  sin(foamUv.y * 4.0)` | 13.1 units | across wind |
| `fn2  sin(foamUv.x * 7.0)` | 35.9 units | along wind |
| `fn2  sin(foamUv.y * 5.0)` | 10.5 units | across wind |
| `cell sin(foamUv.y * 8.0)` | 6.5 units | across wind |
| `cell cos(foamUv.x * 5.0)` | 50.3 units | along wind |

On a 5000-unit ocean the 6.5-unit band repeats **764 times across the surface**. That regular ruling
is what reads as "lines".

**The deeper problem:** not one of those terms references the wave field. The pattern is identical
whether the sea is mirror-flat or breaking. `vJacobian` only gates *where* the ruling shows through,
so foam does not sit on crests — a striped mask is revealed near them.

### 1b. Broad white blotches — the second specular lobe is enormous

```glsl
float specDisc    = pow(NdotH, specRough * 2.0) * specInt;          // roughness 160 -> pow 320, a tight sun disc
float specGlitter = pow(NdotH, max(specRough * 0.22, 12.0)) * ...;  // roughness 160 -> pow 35, very wide
```

An exponent of 35 is a wide lobe, so "glitter" covers large areas of the surface as soft white
patches rather than resolving into points. It is doing the job of an ambient term, not a glint.

### 1c. Subsurface uses the wrong signal

```glsl
float crestFactor = clamp((1.0 - normal.z) * 2.5 + fold * 0.6, 0.0, 1.0);
```

This is driven by surface *tilt*. Sea of Thieves drives it from horizontal **choppiness
displacement** instead (§2). Tilt is high on every wave face; choppiness peaks only at crests, which
is why ours glows on slopes rather than on the tops of waves.

---

## 2. What Sea of Thieves actually does

From Rare's SIGGRAPH 2018 talk and its summaries:

1. **Foam lives in a buffer that is blurred with feedback**, "to simulate the foam dispersing and to
   give a softer mask, more in keeping with the style of the game." Foam is a *temporal, accumulating
   field*, not a per-pixel function of position.
2. **Foam is generated at wave peaks**, and additionally **around objects intersecting the surface**,
   inside a camera-centred window, using depth-buffer comparisons.
3. **Water colour blends between a deep-water colour and a sub-surface colour**, driven by a
   combination of **view angle, sun direction, and a wave-peak mask**.
4. **The wave-peak mask comes from the FFT choppiness vertex offsets** — greater choppiness offset
   means a peak, which shows more subsurface because light travels a shorter distance through water.

The single most important structural difference from ours: **their foam has memory and ours has
none.** Everything else is a refinement.

---

## 3. Gap analysis

| Sea of Thieves | FluidAndWater3D 2.20.0 | Gap |
| :--- | :--- | :--- |
| Foam buffer, blurred with feedback | per-pixel sinusoid mask | **large** — no accumulation, no dispersal |
| Foam generated at wave peaks | `vJacobian` gate over a fixed ruling | medium — right signal, wrong mask |
| Object-intersection foam via depth buffer | ripple events pushed from `detectBodyInteractions` | small — event-driven works, no depth test |
| Peak mask from choppiness offsets | `1 - normal.z` (tilt) | **medium** — wrong signal |
| Deep ↔ subsurface blend on view + sun + peak | Beer-Lambert `transmit` + additive SSS | medium — additive rather than a blend |
| Progressive blur softens the mask | none | large |

We already have the two things that are hard to retrofit: a real spectral wave field with a Jacobian,
and horizontal displacement available in the vertex shader (`totalDisp.xy`, line 87). The peak mask
is a two-line change; the foam buffer is the real work.

---

## 4. The work

### Phase 1 — Foam that follows the water (no new render targets)

The whole of Phase 1 is shader-local and carries no per-frame CPU or memory cost.

1. **Emit a peak mask varying.** In the vertex shader, `totalDisp.xy` is already the choppiness
   offset. Add `vPeak = clamp(length(totalDisp.xy) / max(u_PeakReference, 1.0), 0.0, 1.0)` and pass
   it through. `u_PeakReference` scales with `Hs` so the mask is sea-state independent.
2. **Rebuild the foam mask around the wave field.** Replace the six sinusoids with a mask whose
   *shape* comes from the water: `fold` (Jacobian) and `vPeak` decide where, and a small
   value-noise/FBM term decides the break-up. Noise must be sampled in a frame that moves with the
   waves (`vGdXY` already carries the displaced position), so foam travels with the crest instead of
   the surface sliding under a fixed pattern.
3. **Replace the ruling with gradient noise.** A 2–3 octave value noise removes the periodicity
   entirely. Cost is a handful of ALU ops; no texture needed.
4. **Fix the specular split.** Keep `specDisc` at `pow(NdotH, roughness * 2)`; raise the glitter
   exponent from `roughness * 0.22` to roughly `roughness * 0.6` and drive its *amount* from `vPeak`
   so sparkle concentrates on crests.

**Verification:** `check-shaders.mjs` for compile-safety, plus a numeric test that asserts the foam
mask has no fixed spatial period — sample the mask along a line and assert the autocorrelation shows
no strong peak at any lag. That test would have caught the current ruling.

### Phase 2 — Foam with memory (the actual SoT effect)

A foam buffer: one low-resolution render target per ocean, ping-ponged.

- Each frame: `newFoam = max(decay * blur(previousFoam), generated)` where `generated` comes from
  Phase 1's peak/fold mask, and `blur` is a cheap 4-tap.
- Sampled in the fragment shader by world XY, so foam persists in *world* space and streaks behind
  moving crests.
- Wakes and splashes write into the same buffer instead of the current 16-slot ripple array, which
  removes the `MAX_WATER_INTERACTIONS` ceiling entirely.
- `decay` comes from the **sub-style**: roughly 3.85 s for salt water against 2.54 s for fresh, with
  a higher formation threshold on fresh so lakes rarely whitecap at all. This is the axis paying for
  itself — one constant per medium, no palettes duplicated.

**Cost:** two 256² RGBA8 targets per ocean plus one blit per frame. Roughly the footprint the removed
GPU FFT used to occupy, so the budget exists.

**Risk:** this is the piece that reintroduces render-target work, and the removed GPU FFT is a
cautionary tale — it failed silently on some drivers and had to self-check its output. Phase 2 must
ship with the same treatment: validate the first frame, and fall back to Phase 1's stateless mask if
the target is unusable. **Phase 1 must stand on its own so Phase 2 is optional.**

### Phase 3 — Colour model

Move from "Beer-Lambert transmit, then add SSS" to SoT's blend: mix deep ↔ subsurface by a factor
built from `NdotV`, `dot(viewDir, -sunDir)` and `vPeak`. This is the change most likely to alter
every existing preset's appearance, so it goes last and each preset gets re-checked on screen.

---

## 5. Restructuring: Style, Sub-style, Type

### Why salt and fresh water are a sub-style, not a type

My first draft had these as optical types. That was wrong, and the reason matters: **salt and fresh
water differ in how the water behaves, not just in what colour it is.**

Electrolytes in seawater inhibit bubble coalescence, so bubbles survive longer and whitecaps both
form more readily and persist longer:

| | fresh water | salt water |
| :--- | :--- | :--- |
| whitecap decay time | ~2.54 s | ~3.85 s |
| bubble surface lifetime | <0.01–3 s | 0.3–30 s |
| whitecap formation | uncommon on lakes and rivers | forms readily |

A *condition* (murky, stormy, calm) describes the state the water is in. A *medium* changes the rules
the foam plays by — which is a method trait, and belongs on the same side of the model as the
rendering style. It also plugs straight into Phase 2: the foam buffer's feedback term is

```
newFoam = max(decay * blur(previousFoam), generated)
```

and `decay` **is** the whitecap decay time. Salt vs fresh is literally one constant in that line,
plus a different formation threshold. Modelling it as a palette would have thrown that away.

### The revised axes

| Axis | Owns | Choices |
| :--- | :--- | :--- |
| **Style** — how it is drawn | rendering method: caustics-vs-depth, foam model, subsurface model, specular character | Sea of Thieves, Realistic, Swimming Pool, (Toon, Painterly), Custom |
| **Sub-style** — what liquid it is | the medium: foam formation threshold and decay, base clarity and colour cast, particulate load | Salt Water, Fresh Water, Pool Water, Custom |
| **Type** — what state it is in | the condition layered on the medium: agitation, silt, clarity | Clear, Calm, Choppy, Stormy, Murky, Tropical, Custom |
| **Lighting** — what hour it is | the sun alone | Golden Hour, Midday, Custom |

Composition order, extending what 2.17.0 already does:

```
type (condition)  ->  sub-style (medium)  ->  lighting (sun)  ->  style (method scales)
```

The medium sits after the condition because it constrains it: "murky" means something different in a
lake than in the open sea, and the medium is what says so.

### What this buys

| | records stored | looks reachable |
| :--- | ---: | ---: |
| one flat combined list (pre-2.16) | 10 | 10 |
| Style x Type x Lighting (2.17.0) | 11 | 36 |
| **Style x Sub-style x Type x Lighting** | **17** | **270** |

Adding a medium costs one record and multiplies every existing combination, which is the whole point
of splitting the axes in the first place.

### Swimming Pool

Still promoted to a **Style**, as you asked — pool water is a rendering approach: caustics dominate,
there are no whitecaps, the floor reads through, ripples are small and high-frequency.

**Pool Water** also exists as a **sub-style**, because the medium genuinely differs: chlorinated,
near-zero particulate, and essentially non-foaming. `Swimming Pool + Pool Water` is the ordinary
case; `Realistic + Pool Water` is a pool rendered physically rather than stylised.

### Migration

No shipped projects, so these are renames rather than aliases:

- `Open Ocean` (type) → sub-style `Salt Water` + type `Clear`
- `Swimming Pool` (type) → sub-style `Pool Water`
- `Clear Tropical` (type) → sub-style `Salt Water` + type `Tropical`
- `Calm`, `Murky`, `Stormy` stay as types


## 6. Styles as effect-module bundles

Today a style is four scale factors plus `causticsDepthFade`. To carry real "special effects", make
a style a **bundle of module switches**:

```js
SeaOfThieves: {
  name: 'Sea of Thieves',
  modules: {
    caustics:     { mode: 'surface', depthFade: 0.0, intensity: 0.8 },
    foam:         { model: 'peak',   contrast: 1.4, breakup: 'noise' },
    subsurface:   { model: 'peak',   intensity: 1.4 },
    specular:     { glitter: 0.9, discSharpness: 1.0 },
    quantise:     { bands: 0 },
  },
},
SwimmingPool: {
  modules: {
    caustics:     { mode: 'floor', depthFade: 0.0, intensity: 1.5 },
    foam:         { model: 'none' },
    subsurface:   { model: 'none' },
    specular:     { glitter: 0.3, discSharpness: 1.4 },
    quantise:     { bands: 0 },
  },
},
```

Each module maps to one uniform or a small group, and unknown modules are ignored — so adding
"Toon" later is a table entry plus one `if` in the shader, exactly as adding an hour is today.

`composeWaterDetailingLook` gains a third merge step: type supplies optics, lighting supplies the
sun, style supplies module settings *and* the existing scales.

---

## 7. Sequencing

| Phase | Work | Risk | Verifiable offline? |
| :--- | :--- | :--- | :--- |
| 1 | peak varying, wave-driven foam mask, noise break-up, specular split | low | partly — periodicity test + `check-shaders` |
| 5 | Swimming Pool → Style; Salt/Fresh/Pool Water **sub-styles**; conditions stay types | low | yes — table and resolver tests |
| 6 | module bundles | low | yes |
| 3 | colour model change | **medium** — alters every preset | no, needs eyes |
| 2 | foam buffer with feedback | **high** — render targets, driver-dependent | no, needs a GPU |

Recommended order: **1 → 5 → 6 → 3 → 2.** Phase 1 alone should remove the lines and put foam on the
crests, which is the visible complaint; 5 and 6 are structural and safe; 3 and 2 are the ones that
want screenshots at each step.

---

## 8. Honest limits

- **Nothing here can be visually verified from my side.** `check-shaders.mjs` is static analysis, the
  Node suite mocks `THREE.ShaderMaterial` and never compiles GLSL, and per your instruction I am not
  driving a browser harness. Every phase needs a look in GDevelop.
- **Phase 2 is the one I would not merge without testing on more than one GPU**, for the same reason
  the GPU FFT was removed.
- The SIGGRAPH talk is a *talk*, not a paper — it describes the approach but not the constants. The
  numbers above are my proposals, not Rare's.

---

## 9. Open questions

1. **Four look selectors is the main cost of this shape** — Style, Sub-style, Type, Lighting. The
   alternative is folding the medium into the style names (`Realistic — Salt Water`,
   `Realistic — Fresh Water`), which keeps three dropdowns but stores one record per combination and
   loses the shared foam constants. I have written the plan around the separate axis because it
   matches the centralisation you asked for, but say if four is too many.
2. **Pool Water vs Swimming Pool** — the style and the sub-style are one word apart. Rename either?
3. **Calm** — kept as a condition/type. It could equally be a sea state on the water behavior, since
   `OceanWaveWorks3D` already sets agitation via Beaufort. Duplicated concept?
4. **Toon and Painterly** — worth building, or noise?
5. **Phase 2** — do you want the foam buffer at all, given the GPU FFT history? Phase 1 may get close
   enough for a stylized look, and the sub-style foam constants only become visible with it.

---

## Sources

- [The Technical Art of Sea of Thieves — Ang, Catling, Ciardi, Kozin (SIGGRAPH 2018 Talks)](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf)
- [SIGGRAPH history entry for the talk](https://history.siggraph.org/learning/the-technical-art-of-sea-of-thieves-by-ang-catling-ciardi-and-kozin/)
- [ACM listing](https://dl.acm.org/doi/10.1145/3214745.3214820)
- [Sea of Thieves-inspired water in Godot (80.lv)](https://80.lv/articles/stunning-sea-of-thieves-inspired-water-in-godot)

On salt vs fresh water foam behaviour:

- [Why Seawater Is Foamy — Physics Magazine (APS)](https://physics.aps.org/articles/v16/155)
- [A Systematic Analysis of the Salinity Effect on Air Bubbles Evolution — Harb & Foroutan, JGR Oceans 2019](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2019JC015337)
- [Bubbles Produced by Breaking Waves in Fresh and Salt Waters — J. Physical Oceanography](https://journals.ametsoc.org/view/journals/phoc/30/7/1520-0485_2000_030_1809_bpbbwi_2.0.co_2.xml)
- [Effects of Salinity on Surface Lifetime of Large Individual Bubbles — JMSE](https://doi.org/10.3390/jmse5030041)

---

## Delivered in 3.0.0

| Phase | Shipped | Verified by |
| :--- | :--- | :--- |
| 1 — wave-driven foam | `vPeak` choppiness varying, 2-octave value noise sampled in the displaced frame, narrowed glitter lobe | Test 40 (autocorrelation < 0.55; a plain sine scores > 0.9), `check-shaders.mjs` |
| 5 — axes | Style × Sub-style × Type × Lighting; Swimming Pool promoted to a style; Salt / Fresh / Pool media; types are now conditions | Test 41 |
| 6 — effect modules | `u_FoamModel`, `u_FoamSoftness`, `u_GlitterScale`, `u_QuantiseBands`; Toon and Painterly styles added | Test 41 |
| 3 — colour model | subsurface is a **blend** driven by the choppiness peak mask, not an additive term keyed on surface tilt | suite regression only |
| 2 — foam buffer | ping-ponged render target, feedback blur, decay from the medium, `resetState()` bracketing, first-frame validation, opt-in | Test 42 (default off, safe fallback, frame-rate-independent decay) |

### The checker grew two teeth

Building Phase 1 introduced two breakages that the uniform-only check could not see, and both would
have shipped as water that simply does not draw:

* `WATER2_FRAGMENT_SHADER` called `foamNoise()` while the definition sat in a different shader. GLSL
  does not link across shaders, so that is an undefined function.
* Two shaders declared a local `float foamNoise` that collided with the helper's name.

`check-shaders.mjs` now also flags a function called but never defined in that same shader, and a
local variable shadowing a helper. Both were confirmed by reintroducing the bugs.

### Still unverified

- **Everything visual.** `check-shaders.mjs` proves the shaders parse and reference only what they
  declare; it cannot compile GLSL, and it cannot tell you whether the foam looks right.
- **Phase 2 on a real GPU.** The buffer is off by default for exactly this reason. Its failure modes
  are the ones that bit the removed GPU FFT: a driver silently declining the render target, and
  three's cached GL state going stale because GDevelop shares one WebGL context with PIXI. Both are
  guarded — `resetState()` brackets the pass, the first output is read back and checked — but
  neither guard is proven on hardware.
- **Phase 1 tuning (partly done in 3.0.1).** The noise scales (`* 6.0`, `* 17.0`) and the `smoothstep(0.42, 0.86, …)` gate
  are starting values chosen by eye, not measured ones. Expect a tuning pass.

---

## 3.0.1 — the Beaufort 4 whiteout

A Beaufort 4 sea rendered almost entirely white. Two faults, both introduced by Phase 1:

**Foam was reading the wrong signal.** Phase 1 wrote `crest = max(fold, vPeak * 0.85)`, mixing the
Jacobian fold with the choppiness peak mask. Those are different signals with different jobs: Sea of
Thieves drives *foam* from the fold and *subsurface* from the peak mask. Measured over the field, the
fold's 90th percentile at Beaufort 4 is 0.144 while `vPeak`'s median is 0.82 — so effectively all the
foam was coming from the peak mask, which saturates first. `crest` is the fold alone now.

**`u_PeakReference` was 3× too small.** It divided by `0.28 × Hs`, but the horizontal displacement
magnitude measures 0.49–1.44 × Hs across the ladder, p90 near 0.85 × Hs. `vPeak` sat at 1.0 over a
third of the surface, which also flattened the subsurface blend and the glitter lobe that read it.
The divisor is `0.85 × Hs`.

**The threshold band was sized for the wrong range.** With foam correctly fold-driven, the old
`0.95 − 0.65 × coverage` threshold (0.638 at the Realistic/Choppy default) sat above the fold's
*maximum* below a gale, so the sea would have gone from all-white to no foam at all. The WaveWorks
band is now `0.30 − 0.26 × coverage` with a `max(0.24 × coverage, 0.06)` ramp, chosen by sweeping
five candidates against the Beaufort scale's own wording. The Gerstner shader keeps the old band on
purpose — its `fold` is a different quantity on a different scale.

Measured after the fix, at Realistic / Salt Water / Choppy / Golden Hour:

| rung | surface carrying foam | solid white | Beaufort says |
| :--- | ---: | ---: | :--- |
| 2 | 0.0% | 0.0% | glassy, no breaking |
| 4 | 7.3% | 0.4% | fairly frequent white horses |
| 6 | 42.6% | 26.8% | many white horses |
| 9 | 60.9% | 52.7% | dense foam streaks |
| 12 | 68.3% | 63.3% | sea completely white |

Beaufort 4 was 60.3% / 41.3% before.

### Why the suite missed it

Test 40 asserted the foam mask was **aperiodic**. It never asserted it was **sparse**, so a mask that
painted 41% of a moderate sea solid white satisfied every check. Test 43 is that missing guard: it
reads the threshold mapping back out of the shipped shader — so it cannot drift from the code — and
bounds foam coverage per Beaufort rung, requires coverage to rise monotonically with the sea state,
and fails if `vPeak` saturates over more than 25% of the surface. Both halves were confirmed by
reintroducing each bug and watching the test fail.

---

## 3.1.0 — the foam was upside down

Prompted by a one-line question: *did you notice the foam at the peaks of the waves in Sea of
Thieves?* Measuring rather than answering turned up three defects, the first of them serious.

**The horizontal displacement spectrum carried the wrong sign.** Tessendorf's choppiness exists to
pinch crests and broaden troughs. With the shipped sign it did the opposite — and since the Jacobian
fold is computed from that displacement, the fold, and every whitecap with it, formed in the
**hollows**. Measured over the field, `corr(fold, elevation)` was **−0.665**; foam in the top fifth
of the wave field was **0.0%** at Beaufort 4 and **1.1%** at Beaufort 6, against 20% for an even
scatter. Flipping the factor from `-i` to `+i` in `OceanField.evolve` gives **+0.679**, and 37% /
43% of the foam moves into the top fifth. Tessendorf's `-i` assumes the opposite exponent
convention to the transform this file uses.

**`vPeak` was not a crest signal.** It was `length(totalDisp.xy)`, on the stated theory that the
choppiness offset peaks on wave tops. It does not: against elevation it correlates at **0.086**, and
its mean varies only 0.82–1.00 across the ten wave-height deciles — essentially a constant. It was
driving subsurface scattering, the glitter lobe, and (until 3.0.1) foam. It now reads elevation
above the still plane, which correlates at 0.88 and is what the Gerstner shader already used via
`dPos.z`. `u_PeakReference` divides elevation now, so it is `0.5 × Hs`; that leaves 3.5–11% of the
surface at full crest mask across the ladder.

This also reframes 3.0.1. `max(fold, vPeak * 0.85)` was not merely saturating — it was compositing a
nearly **uniform** field into the foam mask. That is why the sea went white edge to edge.

**`computeFoam` measured the wrong surface.** `evolve` bakes in a choppiness of 1.0 and the vertex
shader scales the displacement again by `u_Choppiness`, so the Jacobian described geometry that was
never drawn. It now takes the choppiness as an argument at all three call sites.

Foam placement after the fix (share of all foam in the top fifth of wave height; 20% = no preference):

| | Beaufort 4 | Beaufort 6 |
| :--- | ---: | ---: |
| before | 0.0% | 1.1% |
| after | 37.2% | 42.8% |

Coverage per rung is unchanged from the 3.0.1 table — the band did not need retuning.

### Tests

Test 44 pins the sign: `corr(fold, elevation)` must exceed 0.35 at Beaufort 4, 6 and 9, more than
25% of the folding must sit in the top fifth of the field, `vPeak` must come from `totalDisp.z`, and
`computeFoam` must take a choppiness argument. Reintroducing the old sign fails it at −0.596.

Test 43's crest-saturation check was reading `hypot(dispX, dispY)` — the signal that no longer
exists — so it was retargeted to elevation at the same time.

**Why nothing caught this earlier.** The inverted foam was aperiodic (Test 40), tracked the wave
field (Test 40), and had plausible coverage per sea state (Test 43). Every property the suite
checked was true. It was simply in the wrong place, and no test asked *where*.

### Still worth a look

`significantWaveHeight` is meant to be 4σ by definition, but measured against the drawn two-cascade
surface it comes to 2.7–3.6σ, because the normalisation measures cascade 0 alone and cascade 1 adds
variance afterwards. Not fixed here — `Hs` also feeds buoyancy and gameplay expressions, so it wants
its own pass.

---

## 3.2.0 — the squares and the mountains

Two reported defects, both traced to specific causes by measurement.

### The water was made of squares

`microWaveNormal` scaled `p` on the **world axes** and used the wind only as a scrolling time
offset, so its spatial structure never rotated. Its `dx` rode wave vector `k·(1.8, 1.0)` and its
`dy` rode `k·(−1.0, 1.8)` — two permanently perpendicular, world-locked plane waves, which is a
square grid by construction. Measured over a 2048-unit patch:

| | world X/Y asymmetry | wind anisotropy |
| :--- | ---: | ---: |
| before | 0.006 | 0.008 |
| after | 0.169 | 0.241 |

Zero on the first column means the field looks statistically identical along X and Y — four-fold
symmetry, i.e. squares. Zero on the second means the wind direction did nothing at all.

The replacement builds one height field in the **wind frame**, squashed 0.42 across the wind so
ripples run in long crests perpendicular to it, from three octaves at deliberately non-harmonic
wavenumbers. The normal is that field's **analytic gradient**, so x and y come from the same waves
instead of from separate perpendicular sines — that is what removes the symmetry. The `93.0`
constant restores the old mean amplitude (0.570 vs 0.571), so `u_MicroDetail` keeps its meaning.

### The foam looked like mountains

Two independent causes.

**The fold was a vertex varying.** `vJacobian` was computed per-vertex and interpolated across a
64×64 grid spanning the whole ocean, so foam edges ran along triangle edges and sawtoothed down
their diagonals — flat white facets with straight sides, reading as terrain. The fold already lives
in the alpha channel of the two textures the fragment samples anyway, so it is now read per-fragment
for two extra taps and the varying is gone.

**The detail cascade was flooding the mask.** Cascade 1 carries the same spectrum on a quarter-size
tile (cell 19.5 units against 78.1), so its surface is ~4× steeper and its Jacobian runs far past
the clamp:

| rung | cascade 0 p90 | cascade 1 p90 | cascade 1 pinned at 1.0 |
| :--- | ---: | ---: | ---: |
| Beaufort 4 | 0.089 | 0.251 | 0.0% |
| Beaufort 6 | 0.245 | 0.668 | 1.6% |
| Beaufort 9 | 0.549 | 1.445 | **23.7%** |
| Beaufort 12 | 0.904 | 2.564 | **39.8%** |

The shader took `max(fold0, fold1 * cWeight)`. Through a max, a channel pinned at 1.0 over a third
of the field is a near-constant, and the whole sea foams. Whitecaps break off the **dominant** wave;
short waves only texture the foam that results. The rule is now
`fold0 + fold1 * cWeight * 0.15` — cascade 0 decides where, cascade 1 only roughens.

Cascade 0 alone is a well-behaved signal: its 90th percentile climbs 0.009 / 0.089 / 0.245 / 0.549 /
0.904 across Beaufort 2, 4, 6, 9 and 12 without ever saturating. The band was retuned onto it
(`0.22 − 0.23 × coverage`, ramp `max(0.14 × coverage, 0.04)`), which also narrows the foam so it
hugs crests. Coverage at Realistic / Salt Water / Choppy: Beaufort 6 falls 49.0% → 35.5%, Beaufort 9
67.4% → 60.0%, while Beaufort 4 stays at 8.3%.

### Tests

Test 45 ports `microWaveNormal` and fails if its world X/Y asymmetry drops below 0.05 or its wind
anisotropy below 0.08, and if the mean amplitude drifts outside 0.45–0.70. It also asserts the fold
is sampled per-fragment, that the `vJacobian` varying is gone, that the cascades are no longer
combined with a `max()`, and that the detail mix stays at or below 0.35. Test 43 was updated to read
the cascade rule out of the shader so it cannot drift from it.

### Checked and found correct

`foamCoverageScale` (Salt 1.00 / Fresh 0.45 / Pool 0.05) **is** applied — Fresh Water genuinely
halves coverage. That was suspected and ruled out rather than "fixed".

### Still unverified

The surface normal is a central difference at exactly ±1 texel of a bilinearly filtered field
texture, which is its own lattice generator, separate from `microWaveNormal`. Removing it properly
needs analytic slopes carried in their own texture — there are no free channels in the current
packing. Not attempted here; if a grid is still visible after this pass, that is the next suspect.

---

## 3.3.0 — analytic slopes

The lattice flagged as unfinished in 3.2.0 is gone. The fragment shader was rebuilding the surface
normal with a central difference at exactly ±1 texel of a **bilinearly filtered** height texture.
That reconstruction is piecewise bilinear, so its derivative is discontinuous on texel boundaries,
and sampling at exactly one texel lines those discontinuities up into a grid.

`OceanField` now carries `d(height)/d(gdX)` and `d(height)/d(gdY)` taken from the spectrum. Both are
real fields, so they share **one** complex transform: feed it `C = h * (-ky + i*kx)` and the result
carries `dh/dx` in its real part and `dh/dy` in its imaginary part. One extra FFT per cascade.

The shader reads them from a slope texture per cascade — **two taps replacing eight**, so this is
cheaper than what it replaces as well as correct.

### Verifying it without a GPU

A wrong sign or a wrong fftshift here would be invisible until something looked odd, so the slopes
were checked against finite differences of the same height field:

| | correlation with analytic | RMS ratio |
| :--- | ---: | ---: |
| 2nd-order central difference | 0.9668 | 1.143 |
| 4th-order central difference | 0.9811 | 1.066 |

A central difference attenuates every mode by `sinc(k·h)`, so it *under-reads* slope — which is why
the analytic RMS sits above it and why the higher-order stencil agrees more closely. Both numbers
moving the right way is what says the analytic field is the accurate one rather than merely a
different one. Test 46 asserts exactly that ordering, plus wiring and teardown.

### Fixed in passing

The scene-unload path disposed `texture` but never `cascadeTexture` — a leak of one float texture
per ocean per scene load, unrelated to this change.

### Still unverified

Everything visual, as always. Node compiles no GLSL and draws no frames.

---

## 3.4.0 — spray, a continuous scale, and a strength slider

### The Beaufort scale is now continuous

The six authored rungs became **anchors** rather than six separate looks. Every value between them
is interpolated — numbers linearly, colours channel by channel — so Beaufort 7 genuinely sits
between 6's blue and 9's storm grey instead of snapping to one of them. The anchors themselves come
back bit-exact, so nothing in an existing project shifts.

That one mechanism serves both new features: the dropdown grew from 6 rungs to all **13** (Beaufort
0–12, plus Custom), and the strength slider reads the same function at fractional values.

The authored wind speeds already tracked the scale's own relation `V = 0.836 · B^1.5` to within a
few percent (2.5 / 7 / 12.5 / 22 / 35 against 2.36 / 6.69 / 12.29 / 22.58 / 34.76), so interpolating
between them stays physically honest.

### Water Strength Slider

A sub-behaviour driving the sea from one number, 0–12 (or normalised 0–1). It is incremental by
construction rather than by lerping between preset property sets: the number resolves to a point on
the continuous scale, which resolves to a wind speed, and wave height follows the wind physically.
Measured across 0→12 in 0.1 steps, significant wave height is monotonic and the largest single-step
jump is **8.69 units** — a flip between authored presets would be tens. Optional damping eases the
sea toward a new setting instead of snapping.

### Wave-collision spray

Built as planned in `PLAN_WAVE_COLLISION_SPRAY.md`, with one deliberate departure. The plan said to
reuse the existing droplet system; on inspection that is a full SPH solver with neighbour searches
and pressure solves, costing ~2.4 ms for 1500 particles. Spray is water in the air — it launches, it
falls, it dies — so it got a flat ballistic pool instead. Thousands of spray particles now cost less
than a hundred SPH ones.

Detection is the eigenvalue test from the plan, validated before any of it was written: a wave
spilling down its face compresses in one direction, two crests colliding compress in both, and the
Jacobian — being their product — cannot tell them apart. The larger eigenvalue can.

Measured behaviour, 30 frames at full spawn rate:

| rung | live particles | peak height |
| :--- | ---: | ---: |
| Beaufort 2 | 0 | — |
| Beaufort 4 | 0 | — |
| Beaufort 6 | 14 | 0.42 × Hs |
| Beaufort 9 | 568 | 0.75 × Hs |
| Beaufort 12 | 720 (pool cap) | 0.75 × Hs |

The onset was moved from 0.85 to 0.95 during tuning: at 0.85 the mask never rose above ~0.1 below a
gale, so Beaufort 6 — which the scale describes as carrying "some spray" — threw none at all. The
range keeps Beaufort 4 silent regardless.

Everything from the plan's risk list is handled. The per-frame budget is a **hard cap** (24 at full
rate, verified), not a rate that scales with the sea. The plume combines with foam through `max`,
never a sum. Cascade 1 is excluded from the eigenvalue test and writes a literal zero. Spawn points
add the choppiness displacement, so spray leaves the crest that threw it rather than appearing
beside it. The medium scales it: pool water threw 14 particles where salt water threw 568.

Off by default, like the persistent foam buffer, and for the same reason — it is the only part of
the detailing whose cost scales with how rough the sea is.

### Tests

Test 47 pins the scale: anchors bit-exact, all 13 labels resolving, a numeric sea state landing
strictly between its neighbours, monotonic wind speed, foam coverage never jumping more than 0.05
over a 0.1 step, and palettes blending. Test 48 pins the spray: off by default, silent at Beaufort 2
and 4, growing with the sea state, pool water suppressed, the budget capped, particles rising above
the waterline and expiring, and the `max` combination in the shader.

60 tests now.

### Still unverified

Everything visual. Node compiles no GLSL and draws no frames — the spray's appearance, the new
rungs' palettes and the slider's feel all need GDevelop.

---

## 3.4.1 — the ocean was not drawing at all

Run under `gdjs-harness`, on a real WebGL2 context shared with PIXI, against THREE r160.

Every number in this document up to here came from the CPU field. That says nothing about whether
the shader the water is actually drawn with compiles — and it did not:

```
THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
Program Info Log: Vertex shader is not compiled.
ERROR: 0:143: 'texture2DLod' : no matching overloaded function found
ERROR: 0:144: 'texture2DLod' : no matching overloaded function found
```

`texture2DLod` is a real GLSL ES 1.00 builtin, but three feeds a raw `ShaderMaterial` through its
GLSL1 path and rewrites only a fixed set of names for WebGL2 — `texture2D` is mapped, `texture2DLod`
is not. The vertex shader failed to compile, which took the whole program down, and **the ocean drew
nothing**. It fails silently: three logs to the console and the surface simply never appears.

The intent behind it was sound — those textures do carry a mip chain for anisotropic filtering, and
the geometry must read the base level or the waves flatten with distance. A vertex-shader fetch has
no derivatives and so is defined to use lod 0, which is exactly what is wanted, so plain `texture2D`
says the same thing in a dialect that compiles.

After the fix, across a 34-step sweep of every Beaufort rung, style, type, sub-style and lighting
value, plus six fractional sea states: **0 GLSL errors, 0 shader-error blocks, program linked.**

### Why nothing caught it

`check-shaders.mjs` had `texture2DLod` in its own builtin whitelist, because it *is* in the GLSL
spec. The check was asking the wrong question: not "is this a real builtin" but "does this survive
three's GLSL1-on-WebGL2 layer". It now carries a `BANNED_BUILTINS` table — `texture2DLod`,
`texture2DProjLod`, `textureLod`, `texelFetch`, `textureGrad` — each with the reason it will not
compile here. Reintroducing the bug now fails the check with `1 SHADER(S) WOULD FAIL TO COMPILE`.

The unit test that asserted `texture2DLod` was present was, in effect, pinning the broken state. It
now asserts the intent instead: a plain `texture2D` fetch with no explicit LOD or bias argument.

### Verified visually, at last

| held at | result |
| :--- | :--- |
| Beaufort 6 / Realistic / Choppy | waves render; foam is patchy and sits on crests |
| Beaufort 9 / Sea of Thieves / Stormy | heavy crest foam, troughs still dark; 381 spray particles alive |

A new harness scenario, `waveworks_presets`, drives both behaviours exactly as the generated ones do
and asks the GL context directly whether the program linked. `?hold=<beaufort>,<style>,<type>` parks
it on one preset for a screenshot. It replaces the stale `ocean` scenario, which still called
`FW.registerOcean` — removed with OceanFFT3D.

`serve.js` now falls back to `Rarely used extensions/` when an extension is not at the repo root, so
the harness works either side of the restructure.

### One correction

An earlier note in this file claimed the field textures set `generateMipmaps false`. They do not —
they build a mip chain for anisotropic filtering. That is precisely why the base-level fetch matters.

---

## Buoyancy3D — chased, and it was not a bug

Resurrecting the dead `buoyancy` harness scenario showed a boat sitting 136 units under the surface
and never rising. That looked like broken buoyancy. It was not, and the chase is worth recording
because the wrong conclusion was available at every step.

**What was ruled out.** The rigid body was live (`findPhysics3D: FOUND`, mass 1.44 kg, `applyForce`
present). Gravity was not a units mismatch — the scene uses `-9.8` with `worldScale: 100`, matching
the extension's `GRAVITY = 9.81`. The reported 13.86 N was ≈1.3× the boat's weight, exactly what
`buoyancyFactor: 1.3` intends. And the body's vertical velocity did respond, swinging −278 → +43.

**What it actually was.** `frac = sub / maxSubmersionDepth`, so equilibrium sits where
`buoyancyFactor × frac == 1`, i.e. at a submersion of `maxSubmersionDepth / buoyancyFactor`.
**`maxSubmersionDepth` is the draft control.** The scenario hardcoded it to 100 on a 100-unit boat,
which parks the hull about one boat-length under. Measured on a flat sea:

| maxSubmersionDepth | hull settles below surface |
| ---: | ---: |
| 100 | 115 |
| 30 | 15 |
| 12 | 2 |
| **0 (shipped default)** | **17, `submerged: false`** |

The default is 0, which means "scale the draft to the hull — full lift once the hull is half under".
With it, the boat floats on a flat sea and rides waves at Beaufort 6, its velocity converging to
zero. The behaviour was correct the whole time; the scenario had overridden the one property that
decides whether a boat floats.

**The real gap.** Every existing buoyancy test passed an explicit `maxSubmersionDepth` (20). The
value that actually ships — 0 — was the only one never exercised. Test 50 covers it: the resolved
draft must track hull depth across 40, 100 and 260-unit hulls, and the resulting equilibrium must
leave the hull less than half submerged rather than deeper than it is tall.

The scenario now uses the default, with `?maxsub=` and `?sea=` overrides retained for exactly this
kind of investigation.

---

## 3.5.0 — the sea changed size in steps

Reported as "the water in the Beaufort scale jumps in size between them". Two independent causes,
and one thing that turned out not to be a defect at all.

### Wind speed had corners

The rungs were interpolated **piecewise-linearly**, which is continuous in value but not in slope.
Wind speed climbed at 0.69 m/s per quarter-rung through Beaufort 4-6, then 0.79 through 6-9, then
1.08 through 9-12. Significant wave height goes as the *square* of wind speed, so every one of those
corners showed up as the sea visibly changing size — worst at Beaufort 9, where the growth per step
jumped by 34 units in a single increment.

Replaced with **monotone cubic (Fritsch-Carlson)** interpolation. It passes exactly through every
authored anchor, its first derivative is continuous, and the limiter guarantees monotonicity — a
plain cubic spline would overshoot and let the sea grow past the next rung and come back.

| | largest slope discontinuity in wind speed |
| :--- | ---: |
| piecewise-linear | 0.292 m/s at Beaufort 9 |
| monotone cubic | 0.052 m/s (real curvature, not a corner) |

`heightFit` was a second, smaller source: a hard `Math.min` of three branches has a corner wherever
the winning branch changes, which left a kink near Beaufort 7.75. The two *fitting* branches are now
blended with a rounded minimum. The ceiling of 1.0 stays a hard min on purpose — it is not a branch,
it is the definition of "unfitted", and rounding it quietly shrank every sea that was not
fetch-limited at all. A test caught that immediately.

### Changing rung applied in a single frame

Adjacent rungs differ by a lot, and that part is not a bug — the scale is roughly cubic in B:

| step | growth in Hs |
| :--- | ---: |
| Beaufort 6 → 7 | +80% |
| Beaufort 7 → 8 | +53% |
| Beaufort 8 → 9 | +38% |

Applying that in one frame is a pop. The "Set Beaufort scale" action now takes a **transition time
in seconds**; 0 is instant and is exactly the old behaviour. Because the scale is continuous, easing
is just animating the rung number and re-applying, smoothstepped so the sea neither lurches into
motion nor stops dead. Beaufort 6 → 9 over one second measures
335 → 372 → 465 → 619 → 811 → 974 → 1130 → 1241 → 1267.

Applying and scheduling had to be split first: the per-frame advance originally re-entered the
public setter, which cancelled the very transition it was running, so the sea moved one frame and
stopped.

### Not a defect

The user's own diagnosis of the earlier "mountains" screenshot was correct: with their real water
body (32004 x 14850 x 3568) at Beaufort 9 the steepness is **0.040** — textbook. The same sea reads
as a flat plane from a high camera and as moving hills from near the surface. Reproduced both ways
in the harness. I had twice concluded "waves too big for the body" before checking whether Beaufort 9
could reach that steepness at all. It cannot.

### Tests

Test 51 bounds the second difference of wind speed across the whole scale (0.10, which sits between
the two regimes), re-checks that all six anchors are still bit-exact, and requires an eased rung
change to not be at its destination on the first frame, to land on target, and never to shrink or
overshoot on the way. Restoring linear interpolation fails it at 0.292.

---

## 3.5.1 — the transition parameter threw on first use

`Set Beaufort scale` shipped referencing `seconds`, which was never read out of the events context:

```
ReferenceError: seconds is not defined
```

A GDevelop parameter is not a JavaScript variable. The block has to fetch it:
`const seconds = Number(eventsFunctionContext.getArgument("Seconds")) || 0;`. The sentence now also
names the parameter (`over _PARAM3_ seconds`), or it is invisible in the events sheet.

### Why the build said "clean"

The build parses every JS block, and a bare undeclared identifier parses perfectly — it is only a
reference. So `201 JS blocks parsed clean` was true and useless: the error cannot exist until the
action runs in a real game.

The build now also checks, for every function parameter, that a block referencing the parameter's
name actually declares that identifier. It ignores names used as property accesses (`ocean.waveHeight`)
and as object keys (`{ waveHeight: val }`), which is what the pre-existing `SetWaveHeight` action does
and which is not a reference at all. Removing the `getArgument` line now fails the build with the
exact fix printed.

Two things went wrong while writing that guard, both worth remembering: `String.replace` treats `$&`
in the *replacement* as the matched text, which silently ate an anchor; and a JS regex built from a
string literal needs doubled backslashes, so `'\w'` had quietly become `w` and `'\b'` a backspace
character, leaving a guard that could never match anything. The regex is now written with explicit
character classes and no backslashes at all.

---

## 3.6.0 — the spray was underwater

Reported as "stuck underwater and just looks like freaking bubbles". Both halves were literally true.

**It spawned at the bottom of the water body.** The emitter took its base height from
`object.getZ()`, which for a GDevelop 3D object is the *base* of the volume, not the surface. The
water surface mesh sits at `objZ + depth`. On a 3568-deep body every droplet was therefore born
3568 units under the sea, where it hung for its whole life. Measured on that body at Beaufort 9:
96 of 96 droplets spawned below the water line before the fix, 0 after, with the pool now sitting at
Z 3783-4172 against a still surface of 3568.

**And they were spheres.** A uniform round billboard is a bubble, whatever else you do to it. Each
droplet is now oriented along its own velocity and stretched up to 3.2x along it, so fast ones read
as streaks and slow ones go round again as they hang at the top of the arc.

**They also outlived their landing.** A droplet that fell back through the surface kept drifting for
the rest of its lifetime, underwater, which is the bubble look again. `SpraySystem.step` now takes
the water line and retires anything falling back through it.

The orientation path is guarded on the THREE API being present, because the unit tests mock
`Object3D` without a quaternion and the renderer must degrade rather than throw.

### Test

Test 48 gained a deep-body case: a 32004 x 14850 x **3568** ocean at Beaufort 9, asserting that no
droplet spawns a wave height below the surface. Restoring `object.getZ()` fails it with
"96 of 96 droplets spawned a wave height below the water line".

---

## 3.7.0 — foam becomes its own axis

Style says how the water is drawn, Sub-style what liquid it is, Type what condition it is in. None
of them say what the **whitecaps** look like, and that is a separate art decision — a North Sea gale
and a reef break can share all three and still have completely different foam.

### Four controls, not a coverage slider

A foam preset that only moved coverage and intensity would be the same foam drawn bigger. The
WaveWorks fragment shader gained four uniforms that change foam's *character*:

| uniform | what it does |
| :--- | :--- |
| `u_FoamScale` | how big one clump of foam is |
| `u_FoamStreak` | how far the wind draws that clump out (1 round, 4.5 ocean, 9 gale bands) |
| `u_FoamBite` | contrast of the break-up noise: soft spume against hard-edged islands |
| `u_FoamTrail` | how much foam is left hanging below the crest after it passes |

Cell size and elongation used to be welded together in two magic numbers (`0.010` along the wind,
`0.045` across it). They are now separate, which is what makes a "long parallel storm bands" look
possible at all.

### The looks

| look | scale | streak | bite | trail | character |
| :--- | ---: | ---: | ---: | ---: | :--- |
| Natural | 1.00 | 4.5 | 1.00 | 1.00 | the open-ocean default, identical to every earlier version |
| Sea of Thieves | 0.55 | 3.0 | 0.70 | 1.60 | big soft sheets that hang on the back of the wave |
| Whitecaps | 1.60 | 2.2 | 1.80 | 0.35 | sparse, high contrast, clean water between crests |
| Storm Streaks | 0.75 | 9.0 | 1.25 | 2.20 | wind drags everything into long parallel bands |
| Surf | 2.40 | 1.3 | 0.55 | 1.80 | fine aerated bubbles that linger |
| Painted | 0.40 | 2.6 | 3.20 | 0.70 | hard-edged flat shapes, foam as an illustrator inks it |
| Minimal | 1.20 | 3.0 | 1.40 | 0.20 | quiet, for water that should not be busy |

`Natural` reproduces the shipped defaults exactly, so a project that never touches the selector
renders identically to 3.6.0.

**Foam composes LAST.** The other three axes each nudge foam coverage as a side effect of what they
are really for; this one exists to decide the whitecaps, so it gets the final say and survives
whatever Style is set.

### Verified

Seven looks, seven distinct parameter sets. Rendered on real WebGL through the harness at Beaufort 9:
Whitecaps is visibly sparse and hard-edged with clean water between crests, Storm Streaks is drawn
out and spread down the wave faces. Test 53 requires all seven to differ in the four controls, pins
Natural to the old defaults, checks each look is recognisably what it claims (Storm Streaks streaks,
Surf is round and fine, Painted has high bite, Minimal is quietest), confirms the axis survives a
different Style, and that it can be switched at runtime.

### Not done

The Gerstner shader (`WATER2`) keeps its own foam block and takes only the coverage/intensity part
of the preset — the four character controls are WaveWorks-only for now.

---

## 4.0.0 — GerstnerWater2_3D removed

Three water behaviours was one too many. **WaterBody3D** and **GerstnerWater2_3D** were both
octave-sum Gerstner, each carrying its own copy of the foam block, the noise helpers and the crest
logic — and that duplication had already caused real bugs (the `foamNoise` call that lived in one
shader and was defined in the other took the whole surface down).

`GerstnerWater2_3D` billed itself as "stylized Sea of Thieves water". That is now OceanWaveWorks3D's
job, done better, with an actual Sea of Thieves entry on the foam axis. Its purpose was fully
absorbed, so it went.

**What remains, with a clear split:**

| behaviour | role |
| :--- | :--- |
| OceanWaveWorks3D | the ocean — spectral, Tessendorf, the working water |
| WaterBody3D | small and cheap water — pools, rivers, ponds, and the fallback where WebGL2 float textures are unavailable |

Keeping *a* Gerstner path is deliberate, for two reasons that are visible in the code: WaveWorks
gates on `OES_texture_float_linear` and `EXT_color_buffer_float`, and its spectral model is simply
wrong for a swimming pool — a Phillips spectrum in a bathtub, costing eight CPU FFTs and four float
texture uploads a frame no matter how small the puddle.

### What came out

| | lines |
| :--- | ---: |
| `WATER2_FRAGMENT_SHADER` | 227 |
| `WATER2_VERTEX_SHADER` | 162 |
| register / step / dispose | 262 |
| public API (presets, wave height, steepness, speed, wind, opacity, micro-detail, translucency) | 209 |
| wave maths (`evaluateGerstner2Displacement`, `evaluateGerstner2Normal`, `waveConfig2Of`) | 106 |
| `GERSTNER2_PRESETS` + resolver | 126 |
| behaviour definition in the builder | 233 |
| tests | ~200 |

The extension JSON drops from **4427 KB to 3488 KB**, a fifth of its size.

Every `isGerstnerWater2` dispatch was collapsed rather than left as dead code — buoyancy's wave
config, normal and surface probes, the splash surface probe, the shared displacement lookup, and the
strength slider's per-model arm. Nothing can set that flag any more, so a two-armed ternary would
only read as though a second water model still existed.

### Verified

Full suite green, `check-shaders` passes with WATER2 dropped from its list, and both surviving water
paths were run in the harness on real WebGL: the WaveWorks program still links with an empty info
log and 0 GLSL errors, and the `gerstner` scenario (WaterBody3D) still reaches DONE.

---

## 4.1.0 — aligned with Rare's actual method

Driven by `REFERENCE_AUDIT_SOT.md`, which compared what we built against the talk itself rather than
against memory. Four of the five divergences are closed.

### The foam threshold is real now

Rare generate foam with `saturate((foamThreshold - detJ) / foamThreshold)`. Ours hardcoded that
threshold to **1.0** — the most permissive value it can take — so foam appeared wherever the surface
compressed at all, and a second threshold downstream then tried to take it back. Two controls
fighting over one decision.

`computeFoam` takes the threshold now, and the coverage slider drives it: asking for more foam
biases the Jacobian, which is exactly the control the talk describes turning up for storms. The
downstream band drops to a fixed soft toe (0.02) whose only job is to stop single texels popping.

Generated foam, measured per rung on a 5000-unit tile:

| rung | cells folding | strongly folding |
| :--- | ---: | ---: |
| Beaufort 2 | 0.0% | 0.0% |
| Beaufort 4 | 1.1% | 0.0% |
| Beaufort 6 | 21.3% | 0.0% |
| Beaufort 9 | 38.9% | 9.0% |
| Beaufort 12 | 47.2% | 24.5% |

Foam is meaningfully sparser than before at moderate sea states. That is the intended behaviour —
Rare's own "no bias" slide generates foam at three points across an entire wave profile — and the
coverage slider is the way back up.

### The progressive blur is on

Their two consecutive slides make the argument: raw Jacobian foam is captioned **"Too Noisy"**, and
the fix is not a threshold, it is progressively blurring an accumulation buffer frame by frame. Our
buffer already did exactly that — ping-ponged targets, 4-tap blur, exponential decay, injection via
`max(blurred * decay, generated)` — and was switched off, never having run on hardware.

It is the default path now, and when live it **is** the foam rather than a `max()` on top of the
instantaneous fold; taking the max would put the hard un-blurred stamp back and undo the blur.

Verified in the harness on real WebGL2 at Beaufort 4, 6 and 9: `foam buffer: live, shader reading
it`, 0 GLSL errors. The capability gate, the `resetState()` bracketing and the first-frame read-back
all stay, so it still degrades to the stateless mask on hardware that cannot host it.

### Foam frequency follows dispersion

*"a high frequency foam texture at the crest... blend to a lower frequency texture as it blends
out."* The octave mix now reads the buffer: fresh foam samples the fine octave at 0.46, dispersed
foam falls to 0.10. It was a constant per preset before.

### The subsurface mask goes back to the flanks

Rare drive SSS from *"the choppiness vertex offsets... a mask for where the SIDES of the waves are"*.
That is `length(totalDisp.xy)`, which is what we originally had. In 3.1.0 it was measured
correlating 0.086 with elevation, read as "nearly flat, therefore broken", and changed to elevation.

But a flanks mask **should** be uncorrelated with height — it peaks between crest and trough. The
measurement was right and the conclusion was wrong; the only real defect was the divisor, which
pinned the mask at 1.0 across a third of the surface. Restored, with the corrected `0.85 x Hs`.

Test 44 previously asserted the elevation version, so it was pinning the regression. It now asserts
the flanks mask, and Test 43 keeps the saturation guard that catches the defect that did exist.

### Not done

Spray still uses its own eigenvalue detector rather than spawning from the foam signal as Rare do.
That is a simplification rather than a fix, and the detector works, so it stays for now.

---

## 4.2.0 — Sea of Thieves is the default foam

Judged side by side, the Sea of Thieves look beats the physically sparse one at every sea state, so
it is the default now. `Natural` is still there and is still the honest open-ocean foam — it is what
shipped before 4.1.0 — but generous trailing sheets are what this extension is for.

The change is one line of default in two places, but it interacts with 4.1.0: the Sea of Thieves
look carries a 1.25x coverage bias, which feeds the Jacobian threshold, which is what brings back
the foam that the physically-honest threshold had taken out of moderate seas. Beaufort 6 on a large
body went from close to bare to carrying visible crest foam.

Test 43's bounds were widened for the new default, deliberately and only on the "carries any foam"
band. The tight bound stays on **solid white**, because that is the number that caught the original
whiteout (41% of a Beaufort 4 sea) and it is the one that must never come back.

The harness scenario had been hardcoding `foamStyle: 'Natural'`, which masked the shipped default
from every screenshot taken through it. It now passes nothing unless `?foam=` is given, so what gets
photographed is what users get.

---

## 4.3.0 — the water had no depth to look into

Reported as the reflection maths looking wrong. It was not the reflection maths — Schlick, `reflect()`,
the sky gradient and the sun lobe were all fine. The problem was upstream, in the optical depth.

`column` was `u_WaterDepth`, the water body's **Z thickness**. On a body 3568 units deep against a
130-unit extinction depth that is **27 extinction lengths**: `transmit` underflows to zero in every
channel, in every pixel. Consequences, all visible in the screenshots:

- `u_ShallowColor` never appears at all. The turquoise the palette is built around is unreachable.
- The water contributes no spatial variation, because a constant column produces a constant colour.
- With nothing but a constant behind it, Fresnel at a low camera (~0.8) leaves the surface a mirror
  of a procedural sky that has no clouds and no structure - one flat pale wash.

Two changes:

**The optical path is clamped and view-dependent.** `min(column, extinctionDepth * 1.5)` stops the
*shape* of the volume deciding the look, and dividing by `NdotV` makes the path longer at grazing
angles, which is where an ocean's near-dark / far-bright gradient actually comes from. There was no
such gradient before because the column was the same everywhere.

**Fresnel has a ceiling** (`u_FresnelMax`, 0.72). Physically it reaches 1.0 at grazing and the
surface becomes a perfect mirror; with a featureless procedural sky that is a large flat wash.
Holding some water colour back is what keeps the sea reading as water from a low camera.

Verified in the harness at Beaufort 6 and 9, from a low camera and from above: 0 GLSL errors, and the
surface now shows near-field teal, brighter reflection toward the horizon, and dark troughs where
before every pixel was the same pale cyan.

### Note

A deep water volume is a reasonable thing to author - it is a collision shape as much as a visual
one - so tying optical depth to it was a trap rather than a setting. `ExtinctionDepth` is the control
that was always meant to own this, and now does.

---

## 4.3.1 — the white was the background, and 4.3.0 caused it

Reported as "that white is reflection, not foam", at Near Gale. Both halves of that were right, and
the cause was a regression from 4.3.0.

### Isolating it

Rendering the same frame with foam removed, then specular, then the sky reflection, the white band
survived all three. So it was none of them. Turning the material fully opaque removed it.

`alpha = mix(0.40, 0.95, 1.0 - transmit.g)`. That was calibrated when `transmit` underflowed to zero
on any deep body, which pinned alpha at 0.95. Clamping the optical path in 4.3.0 made `transmit`
large and healthy — and alpha collapsed to **0.40**. Deep ocean silently became 60% transparent, and
what showed through was whatever was behind it: white in the harness, sky in a real project, which
is exactly why it read as reflection.

Opacity now follows how much water is actually below the surface — `column` against the extinction
depth — rather than the clamped path used for colour. Those were the same number until 4.3.0
separated them, and nothing noticed. Shallow water near a shore still goes transparent, because
`column` is genuinely reduced there.

### And the point that was raised

*"The light reflection doesn't take into consideration the scale of the water, so a big wave
increases the reflection's size, when real ocean water isn't uniform enough to have reflections that
big."*

That is missing sub-pixel roughness, and it is a real second defect. Past the distance where wave
detail stops resolving we shade a whole patch with one smooth normal, so a large face behaves like a
mirror and the highlight grows with the wave. Real water keeps its ripples; they are simply smaller
than a pixel, and their spread of normals both widens the lobe and lowers the average reflectance.

The shader now measures how much water one pixel covers (`fwidth(vGdXY)`) against the finest detail
the field carries (`u_CascadeTileSize * u_CascadeTexel`, 125 units here) and uses that ratio to widen
and dim the specular lobe and to pull Fresnel down from its single-normal peak.

### Lesson worth keeping

Three isolation switches (`?nofoam`, `?nospec`, `?nofresnel`) turned an argument into a measurement
in one pass. The first `?nospec` attempt was useless because the shader reads
`(u_SunSpecularIntensity > 0.0) ? it : 2.2` — setting it to zero restores the default rather than
disabling it. That "0 means default" idiom is everywhere in this shader and it makes zero a bad
probe value.

---

## 4.4.0 — spray stops looking like souls

Reported as the spray looking like "souls rising from the ground", in a screenshot of the **sky**
with white slivers hanging in it.

### The real fix: it was drawn wrong, not simulated wrong

Each droplet was a 24-face sphere oriented along its velocity and stretched up to 3.2x. Against a
bright sky that is a field of white capsules. Now:

- a **camera-facing quad** (two triangles) instead of an oriented sphere, so there is no long axis
  left to read as a sliver;
- a **soft radial sprite**, generated in code at 32x32 so the extension still ships no image asset -
  water in the air is a diffuse blob of light, and an opaque white shape will never be one;
- the velocity stretch is **gone**, which is what produced the capsule silhouette.

Launch speed and lifetime were also brought down (0.9 to 0.55, and lifetime now derived from each
droplet's own ballistic airtime rather than a flat 1.1 s). Peak height above the surface falls from
960 to 774 units at Beaufort 9, and lifetime tracks the arc at any sea state instead of only the one
a constant was tuned at.

### A measurement I got wrong, and the correction

While investigating I reported that "143 of 143 droplets are still rising" and treated it as proof
that every droplet died on the way up. **That was wrong.** The probe never called
`onScenePostEvents`, which is where the pool is actually integrated, so every velocity it read was
still the launch value - of course they all looked like they were rising.

Re-measured with the real per-frame path, the original configuration gives 98 rising against 61
falling. The arc was completing all along. The lifetime change is a robustness improvement, not a
bug fix, and this file previously said otherwise.

Test 48 now drives the real per-frame path and requires more than 20% of live droplets to be
falling. "Any falling at all" is not a guard: the weakest droplets turn over whatever the lifetime
is, so that assertion passed even against a deliberately broken lifetime.

### Also settled

The washed-out screenshot that prompted this was **the sky**, not the water. Time was spent chasing
a water defect that was not there. The transparency regression found on the way - 4.3.1, where alpha
collapsed from 0.95 to 0.40 - was real and is fixed, but it was not what that screenshot showed.
