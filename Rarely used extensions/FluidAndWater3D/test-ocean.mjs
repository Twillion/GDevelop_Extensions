import fs from 'node:fs';
import assert from 'node:assert';

globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback() {}, registerRuntimeSceneUnloadedCallback() {},
};
new Function(fs.readFileSync(new URL("./FluidAndWater3D.runtime.js", import.meta.url), "utf8"))();
const FW = gdjs.__fluidAndWater3D;
const { OceanField, OceanFFT, phillipsSpectrum } = FW;

const TILE = 6987;
const opts = { windSpeed: 14, windDirection: 45, amplitude: 4, smallWaveCutoff: 2, seed: 1337 };

console.log('--- A. FFT correctness against a naive DFT ---');
{
  const N = 8;
  const fft = new OceanFFT(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const sre = [], sim = [];
  for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 1.3) * 2; im[i] = Math.cos(i * 0.7); sre.push(re[i]); sim.push(im[i]); }
  fft.transform(re, im, 0, 1);
  let worst = 0;
  for (let k = 0; k < N; k++) {
    let dr = 0, di = 0;
    for (let n = 0; n < N; n++) {
      const a = (2 * Math.PI * k * n) / N;
      dr += sre[n] * Math.cos(a) - sim[n] * Math.sin(a);
      di += sre[n] * Math.sin(a) + sim[n] * Math.cos(a);
    }
    worst = Math.max(worst, Math.abs(dr - re[k]), Math.abs(di - im[k]));
  }
  assert.ok(worst < 1e-3, `FFT disagrees with a direct DFT by ${worst}`);
  console.log(`  Passed: max deviation from naive DFT = ${worst.toExponential(2)}`);
}

console.log('--- B. Reconstructed height field is real-valued ---');
{
  const f = new OceanField(32, TILE, opts);
  f.evolve(3.7, 1.0);
  let maxIm = 0, maxRe = 0;
  for (let i = 0; i < f.him.length; i++) {
    maxIm = Math.max(maxIm, Math.abs(f.him[i]));
    maxRe = Math.max(maxRe, Math.abs(f.hre[i]));
  }
  // The Hermitian construction must leave the imaginary part negligible next to the real part.
  assert.ok(maxIm / maxRe < 1e-4,
    `Height field is not real: |im|=${maxIm.toExponential(2)} vs |re|=${maxRe.toExponential(2)}`);
  console.log(`  Passed: imaginary residue is ${(100 * maxIm / maxRe).toExponential(2)}% of the real part`);
}

console.log('--- C. The 32^2 CPU field is a low-pass of the 256^2 GPU field ---');
{
  // Same tile and seed: every wavenumber the small grid holds must carry an identical h0 to the
  // large grid. This is what stops buoyancy and the rendered surface being different oceans.
  const small = new OceanField(32, TILE, opts);
  const large = new OceanField(256, TILE, opts);
  let checked = 0, worst = 0;
  // -16 is the small grid's own Nyquist edge, which it deliberately zeroes; compare the interior
  // wavenumbers the two grids genuinely share.
  for (let iy = -15; iy < 16; iy++) {
    for (let ix = -15; ix < 16; ix++) {
      const si = (iy + 16) * 32 + (ix + 16);
      const li = (iy + 128) * 256 + (ix + 128);
      worst = Math.max(worst, Math.abs(small.h0re[si] - large.h0re[li]),
                              Math.abs(small.h0im[si] - large.h0im[li]));
      checked++;
    }
  }
  assert.ok(worst < 1e-6,
    `Shared wavenumbers disagree by ${worst} — the CPU and GPU oceans would diverge`);
  console.log(`  Passed: ${checked} shared wavenumbers identical (max diff ${worst.toExponential(2)})`);
}

console.log('--- D. Determinism ---');
{
  const a = new OceanField(32, TILE, opts);
  const b = new OceanField(32, TILE, opts);
  a.evolve(5.0, 1.0); b.evolve(5.0, 1.0);
  let worst = 0;
  for (let i = 0; i < a.height.length; i++) worst = Math.max(worst, Math.abs(a.height[i] - b.height[i]));
  assert.strictEqual(worst, 0, 'Same seed must give a bit-identical field');

  const c = new OceanField(32, TILE, { ...opts, seed: 99 });
  c.evolve(5.0, 1.0);
  let diff = 0;
  for (let i = 0; i < a.height.length; i++) diff = Math.max(diff, Math.abs(a.height[i] - c.height[i]));
  assert.ok(diff > 1e-6, 'A different seed must give a different ocean');
  console.log('  Passed: reproducible per seed, distinct across seeds');
}

console.log('--- E. Directional spreading actually suppresses cross-wind waves ---');
{
  // The Gerstner version gave waves 115 degrees off-wind full amplitude, which is what built the
  // crosshatch. Phillips must put far less energy across the wind than along it.
  const k = 0.01;
  const along = phillipsSpectrum(k, 0, 14, 1, 0, 4, 2);
  const across = phillipsSpectrum(0, k, 14, 1, 0, 4, 2);
  const against = phillipsSpectrum(-k, 0, 14, 1, 0, 4, 2);
  assert.ok(across < along * 1e-6, `Cross-wind energy ${across} should be ~0 next to along-wind ${along}`);
  assert.ok(against < along * 0.2, 'Waves running against the wind must be suppressed');
  console.log(`  Passed: along=${along.toExponential(2)} across=${across.toExponential(2)} against=${against.toExponential(2)}`);
}

console.log('--- E2. Spectrum L is in scene units, not metres ---');
{
  // k is in 1/scene-unit, so the fetch length L = V^2/g must be in scene units too. With L left in
  // metres, exp(-1/(kL)^2) underflows to zero for every long wave and the whole spectrum collapses
  // onto the shortest wavelength the grid can hold — which normalisation then scales to the full
  // significant wave height, giving waves far taller than they are long.
  const TILE = 7501, UPM = 100, V = 12;
  const longK = (2 * Math.PI) / TILE;              // the longest wave the tile can carry
  const shortK = longK * 64;

  const scaled = phillipsSpectrum(longK, 0, V, 1, 0, 1, 0, UPM);
  const unscaled = phillipsSpectrum(longK, 0, V, 1, 0, 1, 0, 1);
  assert.ok(scaled > 0, 'The longest wave must carry energy when L is in scene units');
  assert.strictEqual(unscaled, 0, 'Leaving L in metres zeroes it (the bug this guards)');
  assert.ok(scaled > phillipsSpectrum(shortK, 0, V, 1, 0, 1, 0, UPM),
    'A wind sea must put more energy in long waves than short ones');

  // Steepness must stay below breaking, and must not depend on grid resolution.
  const steeps = [32, 64, 128].map((res) => {
    const f = new OceanField(res, TILE, {
      windSpeed: V, windDirection: 45, amplitude: 1,
      smallWaveCutoff: Math.max(TILE / res * 0.25, 0.5), unitsPerMetre: UPM, seed: 1337,
    });
    f.normalizeToWindSpeed(UPM, 1);
    f.evolve(4, 1);
    let e = 0, w = 0, half = res / 2;
    for (let m = 0; m < res; m++) {
      for (let q = 0; q < res; q++) {
        const i = m * res + q;
        const kk = Math.hypot(q - half, m - half) * 2 * Math.PI / TILE;
        if (kk <= 0) continue;
        const en = f.h0re[i] ** 2 + f.h0im[i] ** 2;
        e += en; w += en * (2 * Math.PI / kk);
      }
    }
    return f.peakHeight() / (w / e);
  });
  for (const st of steeps) {
    assert.ok(st < 0.14, `Steepness ${st.toFixed(3)} is past breaking — the surface will fold apart`);
  }
  assert.ok(Math.max(...steeps) - Math.min(...steeps) < 0.01,
    `Steepness must not depend on grid resolution: ${steeps.map((v) => v.toFixed(3)).join(', ')}`);
  console.log(`  Passed: steepness ${steeps.map((v) => v.toFixed(3)).join(' / ')} across 32/64/128.`);
}

console.log('--- F. Wave height scales with wind speed (Phillips, not an authored amplitude) ---');
{
  const heights = [6, 10, 16, 24].map((v) => {
    const f = new OceanField(64, TILE, { ...opts, windSpeed: v });
    f.evolve(4.0, 1.0);
    return { v, peak: f.peakHeight() };
  });
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i].peak > heights[i - 1].peak,
      `More wind must mean bigger waves: ${JSON.stringify(heights)}`);
  }
  console.log('  Passed: ' + heights.map((h) => `${h.v}m/s->${h.peak.toFixed(1)}`).join('  '));
}

console.log('--- G. The field is not periodic within the tile (the Gerstner failure) ---');
{
  // Autocorrelation of a row against itself shifted. A lattice shows a strong secondary peak;
  // a proper wind sea decorrelates and stays low.
  const f = new OceanField(64, TILE, opts);
  f.evolve(2.0, 1.0);
  const N = 64, row = new Float32Array(N);
  for (let x = 0; x < N; x++) row[x] = f.height[8 * N + x];
  let mean = 0; for (const v of row) mean += v; mean /= N;
  let var0 = 0; for (const v of row) var0 += (v - mean) ** 2;

  let strongest = 0, at = 0;
  for (let lag = 4; lag < N / 2; lag++) {
    let c = 0;
    for (let x = 0; x < N; x++) c += (row[x] - mean) * (row[(x + lag) % N] - mean);
    const norm = c / var0;
    if (norm > strongest) { strongest = norm; at = lag; }
  }
  assert.ok(strongest < 0.75,
    `Field repeats at lag ${at} with correlation ${strongest.toFixed(2)} — that is a lattice, not a sea`);
  console.log(`  Passed: strongest secondary correlation ${strongest.toFixed(2)} at lag ${at} (lattice would be ~1.0)`);
}

console.log('--- H. Sampling is continuous and matches the grid ---');
{
  const f = new OceanField(32, TILE, opts);
  f.evolve(1.0, 1.0);
  const cell = TILE / 32;
  for (const [gx, gy] of [[5, 7], [0, 0], [31, 31], [17, 3]]) {
    const s = f.sampleHeight(gx * cell, gy * cell);
    const g = f.height[gy * 32 + gx];
    assert.ok(Math.abs(s - g) < 1e-3, `sampleHeight at a grid point should equal the grid: ${s} vs ${g}`);
  }
  // Wrapping
  assert.ok(Math.abs(f.sampleHeight(10, 20) - f.sampleHeight(10 + TILE, 20 + TILE)) < 1e-3,
    'Sampling must wrap on the tile');
  console.log('  Passed: grid-exact at nodes, wraps on the tile');
}

console.log('--- I. Frame cost at the chosen resolutions ---');
{
  for (const N of [32, 64, 256]) {
    const f = new OceanField(N, TILE, opts);
    const iters = N >= 256 ? 10 : 200;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) f.evolve(i * 0.016, 1.0);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / iters;
    console.log(`  N=${String(N).padStart(3)}  ${ms.toFixed(2).padStart(6)} ms/frame  (${(ms / 16.667 * 100).toFixed(1)}% of 60fps)`);
  }
}

console.log('\nOCEAN CORE TESTS PASSED\n');
