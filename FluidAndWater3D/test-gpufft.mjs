/**
 * Verifies the GPU FFT ALGORITHM without a GPU.
 *
 * The butterfly lookup table and the pass ordering are the parts that are easy to get wrong and
 * impossible to eyeball in a shader. Here the exact same passes the fragment shader performs are
 * replayed in JS over plain arrays — same butterfly texels, same top/bottom fetches, same
 * `p + w*q` — and the result is compared against the CPU transform that is already checked against
 * a naive DFT. If these agree, the algorithm and the indices are right and only the WebGL plumbing
 * (render targets, texture formats) remains unverified.
 */
import fs from 'node:fs';
import assert from 'node:assert';

globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback() {}, registerRuntimeSceneUnloadedCallback() {},
};
new Function(fs.readFileSync(new URL('./FluidAndWater3D.runtime.js', import.meta.url), 'utf8'))();
const FW = gdjs.__fluidAndWater3D;
const { buildButterflyData, OceanFFT, OceanField } = FW;

const cmul = (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br];

/** Replays the butterfly passes exactly as FFT_BUTTERFLY_FRAGMENT does, on CPU arrays. */
function gpuStyleFFT2D(n, re, im) {
  const { data, stages } = buildButterflyData(n);
  let curRe = Float64Array.from(re);
  let curIm = Float64Array.from(im);
  let nextRe = new Float64Array(n * n);
  let nextIm = new Float64Array(n * n);

  for (let direction = 0; direction < 2; direction++) {   // 0 = horizontal, 1 = vertical
    for (let stage = 0; stage < stages; stage++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const index = direction === 0 ? x : y;
          const o = (stage * n + index) * 4;
          const wRe = data[o], wIm = data[o + 1];
          const top = data[o + 2], bottom = data[o + 3];

          const ti = direction === 0 ? y * n + top : top * n + x;
          const bi = direction === 0 ? y * n + bottom : bottom * n + x;

          const [mr, mi] = cmul(wRe, wIm, curRe[bi], curIm[bi]);
          nextRe[y * n + x] = curRe[ti] + mr;
          nextIm[y * n + x] = curIm[ti] + mi;
        }
      }
      [curRe, nextRe] = [nextRe, curRe];
      [curIm, nextIm] = [nextIm, curIm];
    }
  }
  return { re: curRe, im: curIm };
}

console.log('--- A. Butterfly table is well formed ---');
{
  for (const n of [8, 16, 64, 256]) {
    const { data, stages } = buildButterflyData(n);
    assert.strictEqual(stages, Math.log2(n), `${n} needs log2(n) stages`);
    assert.strictEqual(data.length, stages * n * 4, 'One RGBA texel per stage and index');
    for (let i = 0; i < stages * n; i++) {
      const top = data[i * 4 + 2], bottom = data[i * 4 + 3];
      assert.ok(Number.isInteger(top) && top >= 0 && top < n, `bad top index ${top}`);
      assert.ok(Number.isInteger(bottom) && bottom >= 0 && bottom < n, `bad bottom index ${bottom}`);
      const mag = Math.hypot(data[i * 4], data[i * 4 + 1]);
      assert.ok(Math.abs(mag - 1) < 1e-5, `twiddle must be unit magnitude, got ${mag}`);
    }
    // Stage 0 must reference every input exactly once, i.e. it carries the bit-reversal.
    const touched = new Set();
    for (let y = 0; y < n; y++) {
      touched.add(data[(0 * n + y) * 4 + 2]);
      touched.add(data[(0 * n + y) * 4 + 3]);
    }
    assert.strictEqual(touched.size, n, 'Stage 0 must cover every input index (bit-reversal)');
  }
  console.log('  Passed: tables for N = 8, 16, 64, 256 are well formed.');
}

console.log('--- B. GPU pass sequence reproduces the verified CPU transform ---');
{
  for (const n of [8, 16, 32, 64]) {
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      re[i] = Math.sin(i * 0.37) * 3 + Math.cos(i * 1.13);
      im[i] = Math.cos(i * 0.71) * 2;
    }

    const gpu = gpuStyleFFT2D(n, re, im);

    const cpuRe = Float32Array.from(re);
    const cpuIm = Float32Array.from(im);
    new OceanFFT(n).transform2D(cpuRe, cpuIm);

    let worst = 0, scale = 0;
    for (let i = 0; i < n * n; i++) {
      worst = Math.max(worst, Math.abs(gpu.re[i] - cpuRe[i]), Math.abs(gpu.im[i] - cpuIm[i]));
      scale = Math.max(scale, Math.abs(cpuRe[i]), Math.abs(cpuIm[i]));
    }
    const rel = worst / scale;
    assert.ok(rel < 1e-4,
      `N=${n}: GPU pass sequence differs from the CPU transform by ${rel.toExponential(2)} relative`);
    console.log(`  N=${String(n).padStart(3)} relative deviation ${rel.toExponential(2)}`);
  }
  console.log('  Passed: the shader\'s butterfly ordering is the same transform.');
}

console.log('--- C. Channel packing matches what the shaders actually do ---');
{
  // The spectrum pass writes vec4(h, dx): TWO independent complex numbers, .xy and .zw. The
  // butterfly pass transforms both channels side by side. So after the transform the two REAL
  // results live in .x and .z.
  //
  // This test previously validated a different design (IFFT(H + i*DX), recovering both fields from
  // one complex channel). That design is also valid, but it is not the one implemented — and
  // because the test agreed with itself rather than with the shader, the assemble pass shipped
  // reading .y, the near-zero imaginary part, and horizontal displacement silently vanished.
  const n = 32;
  const reA = new Float64Array(n * n), imA = new Float64Array(n * n);
  const reB = new Float64Array(n * n), imB = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    reA[i] = Math.sin(i * 0.31); imA[i] = Math.cos(i * 0.77);
    reB[i] = Math.cos(i * 0.19); imB[i] = Math.sin(i * 1.07);
  }

  // Transform each channel separately, as the dual-channel butterfly does.
  const outA = gpuStyleFFT2D(n, reA, imA);
  const outB = gpuStyleFFT2D(n, reB, imB);

  // Simulate the dual-channel pass: one RGBA texel carrying both, advanced together.
  const { data, stages } = buildButterflyData(n);
  let cur = new Float64Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    cur[i * 4] = reA[i]; cur[i * 4 + 1] = imA[i];
    cur[i * 4 + 2] = reB[i]; cur[i * 4 + 3] = imB[i];
  }
  let next = new Float64Array(n * n * 4);
  for (let direction = 0; direction < 2; direction++) {
    for (let stage = 0; stage < stages; stage++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const index = direction === 0 ? x : y;
          const o = (stage * n + index) * 4;
          const wRe = data[o], wIm = data[o + 1];
          const ti = (direction === 0 ? y * n + data[o + 2] : data[o + 2] * n + x) * 4;
          const bi = (direction === 0 ? y * n + data[o + 3] : data[o + 3] * n + x) * 4;
          const d = (y * n + x) * 4;
          for (const c of [0, 2]) {   // .xy and .zw advance independently
            const [mr, mi] = cmul(wRe, wIm, cur[bi + c], cur[bi + c + 1]);
            next[d + c] = cur[ti + c] + mr;
            next[d + c + 1] = cur[ti + c + 1] + mi;
          }
        }
      }
      [cur, next] = [next, cur];
    }
  }

  let worst = 0;
  for (let i = 0; i < n * n; i++) {
    worst = Math.max(worst,
      Math.abs(cur[i * 4] - outA.re[i]), Math.abs(cur[i * 4 + 1] - outA.im[i]),
      Math.abs(cur[i * 4 + 2] - outB.re[i]), Math.abs(cur[i * 4 + 3] - outB.im[i]));
  }
  assert.ok(worst < 1e-6, `Dual-channel pass must match two separate transforms, off by ${worst}`);
  console.log(`  Passed: .xy and .zw transform independently (error ${worst.toExponential(2)}).`);
}

console.log('--- C2. The assemble pass reads the channels the spectrum pass wrote ---');
{
  // Static check against the real shader source, so the two halves can never drift apart again.
  const src = fs.readFileSync(new URL('./FluidAndWater3D.runtime.js', import.meta.url), 'utf8');

  const spectrumWrites = /gl_FragColor = vec4\(h, dx\);/.test(src);
  assert.ok(spectrumWrites, 'Spectrum pass should pack h in .xy and dx in .zw');

  const assembleLine = src.split('\n').find((l) => l.includes('return vec3(') && l.includes('(dispX, dispY, height)'));
  assert.ok(assembleLine, 'Could not find the assemble unpack line');
  assert.ok(/return vec3\(a\.z \* s, b\.x \* s, a\.x \* s\)/.test(assembleLine),
    `Assemble must read dispX from .z (the real part of the second channel), not .y. Got: ${assembleLine.trim()}`);

  // And the foam channel must be the fold amount, so a zeroed texture means no foam.
  assert.ok(/float fold = clamp\(1\.0 - jacobian, 0\.0, 1\.0\);/.test(src),
    'Assemble must store the fold amount, not the raw Jacobian');
  assert.ok(/float fold = clamp\(vJacobian, 0\.0, 1\.0\);/.test(src),
    'The water fragment shader must read the fold amount directly');
  console.log('  Passed: spectrum, assemble and water shader agree on the channel layout.');
}

console.log('--- D. Pass count is what a GPU can afford ---');
{
  for (const n of [64, 128, 256]) {
    const stages = Math.log2(n);
    // 2 spectrum passes + 2 fields x 2 directions x stages + 1 assemble
    const passes = 2 + 2 * 2 * stages + 1;
    console.log(`  N=${String(n).padStart(3)}  ${passes} fullscreen passes/frame at ${n}x${n}`);
    assert.ok(passes <= 40, `${passes} passes is too many`);
  }
  console.log('  Passed.');
}

console.log('\nGPU FFT ALGORITHM TESTS PASSED\n');
