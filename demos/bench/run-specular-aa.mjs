// Phase 2 acceptance run, per docs/RENDERER-MODERNIZATION-PLAN.md section 2 "Acceptance":
//
//   "Four-way comparison on scene 2 using section 0.3 metrics: stock geometryRoughness / AA
//    disabled / T&K on perturbed normal / T&K on both normals. Accept only if temporal delta drops
//    AND static RMSE against the supersampled reference does not rise (the overblur failure mode)."
//
// Both halves are gates. A configuration that reduces shimmer by blurring the image away from
// ground truth has not improved anything, which is exactly what the RMSE half is there to catch.

import { openHarness } from './harness.mjs';
import { rmse, ssim, temporalErrorDelta, downsample, brightRegionMask, stats } from './metrics.mjs';

const BASE = Number(process.env.BENCH_SIZE || 192);
const REF_SCALE = 4;                       // 4x linear = 16 samples per pixel
const FRAMES = Number(process.env.BENCH_FRAMES || 16);
const TIMING_FRAMES = Number(process.env.BENCH_TIMING_FRAMES || 40);

// The plan specifies 120 frames for the temporal metric and 200 for timing. Those are reduced here
// because this runs on SwiftShader, a software rasteriser, where the reference pass alone is
// BASE*4 squared pixels per frame. The reduction is recorded rather than hidden: it widens the
// confidence interval on the temporal number, and it is the first thing to raise if a result comes
// out marginal. Both are overridable by environment variable.
const SPEC_FRAMES = 120, SPEC_TIMING = 200;

const CONFIGS = [
  { id: 'stock', label: 'stock geometryRoughness (Three default)', options: {} },
  { id: 'off', label: 'AA disabled (filter installed, zero width)', options: { specularAA: true, sigma2: 0.0 } },
  { id: 'tk-shading', label: 'T&K on perturbed (shading) normal', options: { specularAA: true, sigma2: 0.15 } },
  { id: 'tk-both', label: 'T&K on both normals', options: { specularAA: true, sigma2: 0.15, geometricFloor: true } },
];

const toFloat = (buf) => { const f = new Float32Array(buf.length); for (let i = 0; i < buf.length; i++) f[i] = buf[i]; return f; };

const harness = await openHarness();
try {
  /* ---- 1. The reference sequence: the SAME scene, unfiltered, at 4x, box-downsampled. ---------
     Ground truth is the stock renderer supersampled — what the 1x render is trying to approximate.
     Rendering the reference with a filter enabled would bake the thing under test into the answer. */
  console.log(`Scene 2 (sphere array) — ${BASE}px, ${FRAMES} frames, ${REF_SCALE}x reference (${REF_SCALE ** 2} samples/px)`);
  if (FRAMES < SPEC_FRAMES) console.log(`  NOTE: plan specifies ${SPEC_FRAMES} frames; running ${FRAMES} on SwiftShader.`);

  const refInfo = await harness.build('sphere-array', BASE * REF_SCALE, {});
  console.log(`  reference build: webgl2=${refInfo.webgl2} materials=${refInfo.materials} timerQuery=${refInfo.timerQueryAvailable}`);
  const references = [];
  for (let n = 0; n < FRAMES; n++) {
    const raw = await harness.frame(n, FRAMES);
    references.push(downsample(toFloat(raw), BASE * REF_SCALE, REF_SCALE));
  }
  const { mask, count } = brightRegionMask(references[Math.floor(FRAMES / 2)], 10);
  console.log(`  marked region: ${count} of ${BASE * BASE} pixels (${(100 * count / (BASE * BASE)).toFixed(1)}%)`);

  /* ---- 2. Each configuration at 1x, along the identical camera path ---- */
  const results = [];
  for (const config of CONFIGS) {
    const info = await harness.build('sphere-array', BASE, config.options);
    if (config.options.specularAA && !info.specularAAInjected) {
      throw new Error(`${config.id}: specular AA was requested but did NOT reach the generated shader`);
    }
    const frames = [];
    for (let n = 0; n < FRAMES; n++) frames.push(toFloat(await harness.frame(n, FRAMES)));

    const mid = Math.floor(FRAMES / 2);
    const timing = await harness.time(TIMING_FRAMES);
    results.push({
      ...config,
      injected: info.specularAAInjected,
      temporal: temporalErrorDelta(frames, references, mask),
      rmse: rmse(frames[mid], references[mid]),
      ssim: ssim(frames[mid], references[mid], BASE, BASE),
      timing: stats(timing.samples),
      timingMethod: timing.method,
    });
    console.log(`  measured ${config.id}`);
  }

  /* ---- 3. Report ---- */
  const baseline = results.find((r) => r.id === 'stock');
  console.log('\n' + '='.repeat(78));
  console.log('PHASE 2 ACCEPTANCE — scene 2, four-way comparison');
  console.log('='.repeat(78));
  console.log('config                                    temporal      RMSE     SSIM   frame ms');
  console.log('-'.repeat(78));
  for (const r of results) {
    console.log(
      r.label.padEnd(40) +
      r.temporal.toFixed(3).padStart(9) +
      r.rmse.toFixed(2).padStart(10) +
      r.ssim.toFixed(4).padStart(9) +
      (r.timing.median.toFixed(2) + '/' + r.timing.p95.toFixed(2)).padStart(12));
  }
  console.log('-'.repeat(78));
  console.log(`baseline = ${baseline.label}`);
  console.log(`timing method: ${results[0].timingMethod}`);
  console.log('timing is median/p95 of WHOLE-FRAME wall clock. Per plan section 0.4 this CANNOT');
  console.log('certify the 4.0 ms GPU pass budget; GPU-pass timing is unavailable in this');
  console.log('configuration, and an unavailable measurement is not a pass.');

  console.log('\nVERDICT');
  let anyAccepted = false;
  for (const r of results) {
    if (r.id === 'stock') continue;
    const temporalDrop = r.temporal < baseline.temporal;
    const rmseHeld = r.rmse <= baseline.rmse + 1e-6;
    const accepted = temporalDrop && rmseHeld;
    if (accepted) anyAccepted = true;
    console.log(`  ${r.id.padEnd(12)} temporal ${temporalDrop ? 'DROPS' : 'rises'} ` +
      `(${baseline.temporal.toFixed(3)} -> ${r.temporal.toFixed(3)}), ` +
      `RMSE ${rmseHeld ? 'holds' : 'RISES'} (${baseline.rmse.toFixed(2)} -> ${r.rmse.toFixed(2)})  =>  ` +
      (accepted ? 'ACCEPT' : 'REJECT'));
  }
  console.log(anyAccepted
    ? '\nAt least one configuration meets section 2 acceptance.'
    : '\nNo configuration meets section 2 acceptance on this scene. Phase 2 stays opt-in.');
  if (harness.errors.length) console.log('\nbrowser errors: ' + harness.errors.join(' | '));
} finally {
  harness.close();
}
