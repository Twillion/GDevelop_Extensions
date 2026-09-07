# Audit: our water against Rare's own talk

Source: `SeaOfThieves_TechArt/` — transcript, slides and deep-dive of *The Technical Art of Sea of
Thieves* (Rare). Everything below is quoted or measured, not remembered.

---

## What we already get right

| | |
| :--- | :--- |
| Jacobian-determinant foam | *"You take the Jacobian determinant of the transform and generate foam where it goes negative."* We do (since 3.1.0 — before that foam came from the choppiness offset). |
| Foam at crests, from folding | *"an indicator of where choppiness offsets cause the wave peaks to overlap."* Fixed in 3.1.0; the displacement sign had been inverted and foam formed in the troughs. |
| Storms bias the Jacobian | *"for stormy water we just increase the amplitude of the waves and we bias the Jacobian even further."* That is exactly what the Beaufort scale does. |
| Tessendorf base, stylised foam | *"we mostly stylize the foam."* Same split. |
| Exaggerated SSS | *"boosted the strength of the subsurface scattering beyond what would be considered realistic."* Same. |

---

## 1. Our foam threshold is their formula with the knob pinned wide open

Rare's shader, from the deep dive:

```hlsl
float detJ = Jxx * Jzz - Jxz * Jzx;
float foamIntensity = saturate((foamThreshold - detJ) / foamThreshold);
```

Ours, in `OceanField.computeFoam`:

```js
out[i] = clamp(1.0 - jacobian, 0.0, 1.0);
```

That is **their formula with `foamThreshold` hardcoded to 1.0** — the most permissive value it can
take. Their "Jacobian No Bias" slide shows the determinant sitting between +1 and +2 and dipping
below zero at only three points across an entire wave profile; foam is meant to be a *rare* event.
Ours fires wherever the surface compresses at all.

We then compensated downstream with `crestThreshold = 0.22 - 0.23 * coverage` applied to an already
saturated signal — fighting a problem we created at generation time.

**Fix:** make `foamThreshold` a real control, apply it in `computeFoam`, and let foam coverage drive
*it* rather than the downstream smoothstep band.

---

## 2. The progressive blur is not polish — it IS the noise solution

Two consecutive slides:

- **"Foam Generation — Too Noisy"**: raw biased-Jacobian foam. Speckled white over everything. It
  looks almost exactly like the over-foamed screenshots reported during this work.
- **"Foam Generation — Progressive Blur"**: soft, smeared, directional foam that follows the wave
  structure. This is the Sea of Thieves look.

*"it's definitely far too noisy for our art style so what we do is we actually progressively blur the
render targets... where you have the peaks of the waves you still get these kind of sharp crests but
then that foam gradually dissipates over the progressive blur frame by frame."*

Our persistent foam buffer exists, is **off by default, and has never run on hardware**. Instead we
add procedural value-noise "lace" to break the foam up — adding high-frequency detail where Rare
removes it, and against their stated art pillar of avoiding high-frequency noise.

**Fix:** make the buffer the default path and prove it in the harness. Highest-value change we have,
and we now have a reference image of the target.

---

## 3. Foam frequency should fall as foam disperses

*"we have a high frequency foam texture at the crest of the wave and then we blend to a lower
frequency texture as it blends out."*

Two textures, selected by how dispersed the foam is. Our `u_FoamScale` is a constant per preset.

**Fix:** drive the lace frequency from the foam buffer value — fresh foam fine, old foam coarse.

---

## 4. We moved the SSS mask AWAY from the reference

*"for the subsurface scattering we use the choppiness vertex offsets from the FFT sim to generate a
mask for **where the sides of the waves are**, and then we just use a dot product of the light and
view vector for the SSS contribution."*

The original `vPeak = length(totalDisp.xy)` was precisely that: the choppiness offset magnitude, a
**sides-of-waves** mask. In 3.1.0 it was measured against elevation, found to correlate at only
0.086, called "not a crest signal", and changed to `totalDisp.z`.

But a sides mask *should* be uncorrelated with elevation — it peaks on the flanks, not the tops. The
measurement was right and the conclusion was wrong. The genuine bug was the divisor
(`0.28 x Hs`) making it saturate over a third of the surface, not the choice of signal.

**Fix:** restore the choppiness-offset magnitude for the SSS term, keeping the corrected reference
scale. Elevation can stay wherever a true crest mask is wanted.

---

## 5. Spray comes from the foam signal, not a separate detector

*"we also use the same water crest where we generate foam to generate some particles off the top of
the waves."*

Ours spawns from a bespoke detector: the larger eigenvalue of the displacement gradient tensor,
which separates two crests colliding from one crest breaking. It is more selective than the fold and
it works — but it is extra machinery the reference does not need, and it lets spray and foam disagree
about where the sea is breaking.

**Option:** drive spray from the foam generation events instead. Simpler, self-consistent, and
matches the source. The eigenvalue test could stay as an optional "collision spray" mode.

---

## Priority

1. Progressive blur / persistent buffer on by default (§2) — the single biggest visual gap.
2. Real `foamThreshold` at generation (§1) — makes foam sparse where it should be, and removes the
   downstream band hack.
3. Foam frequency by dispersion (§3) — needs §2 first, since it reads from the buffer.
4. Restore the SSS sides mask (§4) — small, and corrects a regression we introduced.
5. Spray from the foam signal (§5) — simplification, not a fix.
