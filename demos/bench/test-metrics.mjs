// Unit tests for the Phase 0 metrics.
//
// These exist because every gate in the modernization plan is decided by these numbers. A metric
// that is quietly wrong does not fail loudly — it produces a confident figure that sends the
// decision the wrong way, which is worse than having no metric at all.

import assert from 'node:assert/strict';
import { rmse, ssim, temporalErrorDelta, temporalRawDelta, downsample, luminance, brightRegionMask, stats }
  from './metrics.mjs';

let checked = 0;
const ok = (c, m) => { assert.ok(c, m); checked++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checked++; };

/* ---- RMSE ---- */
{
  const a = new Float32Array([0, 10, 20, 30]);
  near(rmse(a, a), 0, 1e-9, 'identical buffers have zero RMSE');
  const b = new Float32Array([3, 13, 23, 33]);
  near(rmse(a, b), 3, 1e-6, 'a constant offset of 3 gives RMSE 3');
  const c = new Float32Array([0, 10, 20, 34]);
  near(rmse(a, c), Math.sqrt(16 / 4), 1e-6, 'a single error of 4 over 4 pixels gives RMSE 2');
  assert.throws(() => rmse(a, new Float32Array(3)), /length mismatch/);
  checked++;
}

/* ---- SSIM ---- */
{
  const W = 16;
  const img = new Float32Array(W * W);
  for (let i = 0; i < img.length; i++) img[i] = (i * 7) % 256;
  near(ssim(img, img, W, W), 1.0, 1e-9, 'an image against itself is exactly 1');

  // A constant offset degrades luminance similarity but preserves structure, so SSIM must fall
  // below 1 while staying well above 0. If this returned 1 the luminance term is missing.
  const shifted = new Float32Array(img.length);
  for (let i = 0; i < img.length; i++) shifted[i] = img[i] + 40;
  const s1 = ssim(img, shifted, W, W);
  ok(s1 < 0.999, `a luminance shift must reduce SSIM (got ${s1})`);
  ok(s1 > 0.3, `a pure luminance shift must not collapse SSIM (got ${s1})`);

  // Structure destroyed: SSIM must fall much further than for a luminance shift alone. If a
  // scrambled image scored as well as a shifted one, the covariance term is broken.
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const noise = new Float32Array(img.length);
  for (let i = 0; i < img.length; i++) noise[i] = rand() * 255;
  const s2 = ssim(img, noise, W, W);
  ok(s2 < s1, `destroying structure must score worse than shifting luminance (${s2} vs ${s1})`);

  // Two flat images of the same value are perfectly similar even though variance is zero — the
  // stabilising constants exist precisely so this does not divide by zero.
  const flatA = new Float32Array(W * W).fill(128);
  const flatB = new Float32Array(W * W).fill(128);
  near(ssim(flatA, flatB, W, W), 1.0, 1e-9, 'identical flat regions must be 1, not NaN');
  ok(Number.isFinite(ssim(flatA, new Float32Array(W * W).fill(0), W, W)),
    'a flat black vs flat white comparison must stay finite');
}

/* ---- Temporal metrics ---- */
{
  // THE case that justifies the whole design. A camera pan: every frame differs a lot from the
  // last, but the renderer tracks the reference perfectly. Raw delta reports a large number;
  // the error-delta metric correctly reports zero.
  const N = 4, P = 16;
  const frames = [], refs = [];
  for (let n = 0; n < N; n++) {
    const f = new Float32Array(P);
    for (let i = 0; i < P; i++) f[i] = (i + n * 5) * 3 % 200;
    frames.push(f);
    refs.push(Float32Array.from(f));          // renderer matches reference exactly
  }
  near(temporalErrorDelta(frames, refs), 0, 1e-9,
    'a renderer that tracks the reference exactly must score zero, however much the image moves');
  ok(temporalRawDelta(frames) > 10,
    'the raw delta must be large for the same sequence — which is why it is wrong for moving cameras');

  // Now a renderer that shimmers: error alternates between frames while the reference is static.
  const staticRef = new Float32Array(P).fill(100);
  const shimmer = [];
  for (let n = 0; n < 6; n++) {
    const f = new Float32Array(P);
    for (let i = 0; i < P; i++) f[i] = 100 + (n % 2 === 0 ? 10 : -10);
    shimmer.push(f);
  }
  const refSeq = new Array(6).fill(null).map(() => Float32Array.from(staticRef));
  // e[n] alternates 10, 10, 10... in magnitude — abs() makes a symmetric flicker invisible to the
  // error metric. This is a REAL limitation and is asserted so it stays documented, not discovered.
  near(temporalErrorDelta(shimmer, refSeq), 0, 1e-9,
    'a perfectly symmetric flicker is invisible to the error-delta metric (documented limitation)');
  near(temporalRawDelta(shimmer), 20, 1e-6,
    'the raw delta does see symmetric flicker — which is why stationary runs keep it');

  // An asymmetric shimmer, which is what real specular aliasing looks like, IS caught.
  const asym = [];
  for (let n = 0; n < 6; n++) {
    const f = new Float32Array(P);
    for (let i = 0; i < P; i++) f[i] = 100 + (n % 2 === 0 ? 0 : 25);
    asym.push(f);
  }
  near(temporalErrorDelta(asym, refSeq), 25, 1e-6, 'asymmetric shimmer is measured at its amplitude');

  // The mask must actually restrict the region.
  const mask = new Uint8Array(P); mask.fill(0); mask[0] = 1;
  near(temporalErrorDelta(asym, refSeq, mask), 25, 1e-6, 'masking to one pixel keeps the same value here');
  assert.throws(() => temporalErrorDelta([frames[0]], [refs[0]]), /at least two frames/);
  checked++;
}

/* ---- Downsample ---- */
{
  // A 4x4 buffer downsampled by 2 must average each 2x2 block.
  const src = new Float32Array([
    0, 10, 100, 110,
    20, 30, 120, 130,
    200, 210, 40, 50,
    220, 230, 60, 70,
  ]);
  const out = downsample(src, 4, 2);
  near(out[0], 15, 1e-6, 'top-left block averages to 15');
  near(out[1], 115, 1e-6, 'top-right block averages to 115');
  near(out[2], 215, 1e-6, 'bottom-left block averages to 215');
  near(out[3], 55, 1e-6, 'bottom-right block averages to 55');
  assert.throws(() => downsample(src, 4, 3), /must divide/);
  checked++;

  // A flat buffer must survive downsampling unchanged — catches a normalisation error.
  const flat = new Float32Array(64).fill(77);
  const flatOut = downsample(flat, 8, 4);
  ok(Array.from(flatOut).every((v) => Math.abs(v - 77) < 1e-6), 'downsampling a flat buffer preserves its value');
}

/* ---- Luminance and mask ---- */
{
  const rgba = new Uint8Array([0, 0, 0, 255, 30, 60, 90, 255, 255, 255, 255, 255]);
  const lum = luminance(rgba);
  near(lum[0], 0, 1e-6, 'black is 0');
  near(lum[1], 60, 1e-6, 'the mean of 30/60/90 is 60');
  near(lum[2], 255, 1e-6, 'white is 255');

  const { mask, count } = brightRegionMask(lum, 8);
  assert.equal(count, 2, 'only the two non-black pixels are in the region');
  assert.equal(mask[0], 0); assert.equal(mask[1], 1);
  checked += 3;
}

/* ---- Stats ---- */
{
  const s = stats([5, 1, 4, 2, 3]);
  near(s.median, 3, 1e-9, 'median of 1..5 is 3');
  assert.equal(s.n, 5); checked++;
  // p95 of 100 samples 1..100 must be near the top, and must NOT be the mean.
  const many = stats(Array.from({ length: 100 }, (_, i) => i + 1));
  ok(many.p95 >= 95, `p95 must sit in the tail (got ${many.p95})`);
  ok(Math.abs(many.median - 50.5) <= 1, `median must be mid-range (got ${many.median})`);
  assert.deepEqual(stats([]), { median: 0, p95: 0, n: 0 }); checked++;
}

console.log(`Phase 0 metrics: ${checked} assertions passed — RMSE, windowed SSIM, temporal error ` +
  `delta vs raw delta (including the documented symmetric-flicker blind spot), downsampling, ` +
  `region masking, median/p95.`);
