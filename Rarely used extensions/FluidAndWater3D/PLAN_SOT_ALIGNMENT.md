# Plan: align the foam with Rare's actual method

Derived from `REFERENCE_AUDIT_SOT.md`. Five divergences, four of them worth fixing now.

## Phase 1 — a real foam threshold, applied at generation

`computeFoam` currently hardcodes Rare's `foamThreshold` to 1.0, the most permissive value, so foam
is generated wherever the surface compresses at all instead of where it folds.

- `computeFoam(out, choppiness, foamThreshold)` returning `saturate((T - detJ) / T)`.
- Threshold comes from the foam axis and the coverage slider, so "more foam" biases the Jacobian —
  which is exactly the control Rare describes — instead of widening a smoothstep downstream.
- With foam sparse at source, the downstream `crestThreshold` band can relax toward a plain
  intensity ramp.
- **Verify:** per-Beaufort coverage still climbs monotonically and Beaufort 4 stays near a few
  percent. Test 43 already bounds this and must keep passing.

## Phase 2 — the progressive blur on by default

The buffer already ping-pongs two targets, blurs 4-tap, decays exponentially and injects the
Jacobian: `max(blurred * decay, generated)`. That IS Rare's method. It is simply switched off and
has never run on hardware.

- Default `persistentFoam` to on, keeping the existing capability gate and the read-back validation
  so it still degrades to the stateless mask rather than painting the ocean white.
- When the buffer is live it becomes the crest source, not a `max()` bolted onto the instantaneous
  fold — the buffer already contains this frame's generation.
- **Verify:** in the harness, on real WebGL, that the buffer allocates, validates, and that foam
  visibly softens and trails. Screenshot against the "Progressive Blur" slide.

## Phase 3 — foam frequency falls as foam disperses

*"a high frequency foam texture at the crest... blend to a lower frequency texture as it blends out."*

- Drive the lace octave mix from the buffer value: fresh, bright foam samples the fine octave;
  dispersed foam falls back to the coarse one.
- Depends on Phase 2, since the signal is the buffer.
- **Verify:** numerically, that the effective frequency falls as the buffer value falls.

## Phase 4 — restore the subsurface "sides of the waves" mask

Rare drives SSS from the choppiness offset magnitude, which marks wave flanks. We changed it to
elevation in 3.1.0 after measuring it correlating 0.086 with elevation and misreading that as
"broken" — but a flanks mask should be uncorrelated with height. The real bug was only the divisor.

- `vPeak` back to `length(totalDisp.xy)` with the corrected reference scale.
- **Verify:** it must not saturate (the original defect), and must stay uncorrelated with elevation,
  which is the signature of a flanks mask rather than a crest mask.

## Phase 5 — spray from the foam signal (not doing yet)

Rare spawns spray from the same crest signal that generates foam. Ours uses a bespoke eigenvalue
test that separates colliding crests from breaking ones. That is more selective and it works, so
this is a simplification rather than a fix. Left as a documented option.

## Order and risk

1 before 2: the blur needs something sparse to blur. 3 after 2: it reads the buffer. 4 is
independent and small. Phase 2 carries the only real risk — render targets on a WebGL context shared
with PIXI, which is what broke the removed GPU FFT — so the capability gate, the `resetState()`
bracketing and the first-frame read-back all stay.
