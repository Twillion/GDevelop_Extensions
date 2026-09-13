// SIGMA2 sweep on scene 2.
//
// Plan section 2: "SIGMA2 — the pixel-filter-kernel variance. The paper does not fix a numeric
// default; it is a tuning parameter. Start at 0.15 (Filament's default for the same formulation)
// and expose it as a behavior property. Do not hardcode it."
//
// 0.15 is a starting point, not an answer, and the four-way run showed it overblurring badly on
// this content. Choosing a default by measurement against a supersampled reference is exactly what
// Phase 0 exists to make possible. This is NOT fitting the constant to a convenient test: the
// reference is ground truth for this scene, and both gates still have to pass on their own terms.

import { openHarness } from './harness.mjs';
import { rmse, ssim, temporalErrorDelta, downsample, brightRegionMask } from './metrics.mjs';

const BASE = Number(process.env.BENCH_SIZE || 160);
const REF_SCALE = 4;
const FRAMES = Number(process.env.BENCH_FRAMES || 10);
const SIGMAS = (process.env.BENCH_SIGMAS || '0,0.005,0.01,0.02,0.04,0.08,0.15')
  .split(',').map(Number);

const toFloat = (buf) => { const f = new Float32Array(buf.length); for (let i = 0; i < buf.length; i++) f[i] = buf[i]; return f; };

const harness = await openHarness();
try {
  console.log(`Sigma2 sweep — scene 2, ${BASE}px, ${FRAMES} frames, ${REF_SCALE}x reference`);
  await harness.build('sphere-array', BASE * REF_SCALE, {});
  const references = [];
  for (let n = 0; n < FRAMES; n++) {
    references.push(downsample(toFloat(await harness.frame(n, FRAMES)), BASE * REF_SCALE, REF_SCALE));
  }
  const { mask } = brightRegionMask(references[Math.floor(FRAMES / 2)], 10);

  const measure = async (options) => {
    const info = await harness.build('sphere-array', BASE, options);
    const frames = [];
    for (let n = 0; n < FRAMES; n++) frames.push(toFloat(await harness.frame(n, FRAMES)));
    const mid = Math.floor(FRAMES / 2);
    return {
      injected: info.specularAAInjected,
      temporal: temporalErrorDelta(frames, references, mask),
      rmse: rmse(frames[mid], references[mid]),
      ssim: ssim(frames[mid], references[mid], BASE, BASE),
    };
  };

  const stock = await measure({});
  console.log('\nsigma2        temporal      RMSE     SSIM   vs stock');
  console.log('-'.repeat(62));
  console.log('stock    '.padEnd(10) + stock.temporal.toFixed(3).padStart(9) +
    stock.rmse.toFixed(2).padStart(10) + stock.ssim.toFixed(4).padStart(9) + '   baseline');

  const rows = [];
  for (const sigma2 of SIGMAS) {
    const r = await measure({ specularAA: true, sigma2 });
    if (!r.injected) throw new Error(`sigma2=${sigma2}: the filter did not reach the shader`);
    const accept = r.temporal < stock.temporal && r.rmse <= stock.rmse + 1e-6;
    rows.push({ sigma2, ...r, accept });
    console.log(String(sigma2).padEnd(10) + r.temporal.toFixed(3).padStart(9) +
      r.rmse.toFixed(2).padStart(10) + r.ssim.toFixed(4).padStart(9) +
      (accept ? '   ACCEPT' : '   reject'));
  }

  const accepted = rows.filter((r) => r.accept);
  console.log('-'.repeat(62));
  if (!accepted.length) {
    console.log('No sigma2 passes BOTH gates on this scene. The filter must stay opt-in.');
  } else {
    // Among configurations that pass both gates, prefer the one that reduces shimmer most — that is
    // what the phase is FOR. RMSE is a constraint, not the objective.
    const best = accepted.reduce((a, b) => (b.temporal < a.temporal ? b : a));
    console.log(`${accepted.length} of ${rows.length} values pass both gates.`);
    console.log(`Lowest temporal among them: sigma2 = ${best.sigma2} ` +
      `(temporal ${stock.temporal.toFixed(3)} -> ${best.temporal.toFixed(3)}, ` +
      `RMSE ${stock.rmse.toFixed(2)} -> ${best.rmse.toFixed(2)}, ` +
      `SSIM ${stock.ssim.toFixed(4)} -> ${best.ssim.toFixed(4)})`);
    console.log('This is ONE scene. Treat it as a defensible default, not a universal constant.');
  }
  if (harness.errors.length) console.log('\nbrowser errors: ' + harness.errors.join(' | '));
} finally {
  harness.close();
}
