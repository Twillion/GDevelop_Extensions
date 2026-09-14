// Scene 4 (alpha-tested foliage) — is it fit to be a measurement surface?
//
// A test scene is not "done" when it renders. It is done when it demonstrably EXHIBITS the artefact
// the phases that depend on it are supposed to measure. Plan §0.2 includes scene 4 as "the
// material-aliasing case ... so the plan does not pretend that problem is solved", and Phase 7
// (MSAA) compares against it. A foliage scene that happened not to alias would let Phase 7 conclude
// "MSAA is fine here" from a scene incapable of showing otherwise.
//
// So this checks four things, in increasing order of what they would let through:
//   1. It renders at all, with no page errors.
//   2. It is not degenerate — not blank, not uniform.
//   3. Alpha testing is actually doing something: raising the cutoff visibly removes foliage.
//   4. It aliases measurably, by §0.3's temporal error delta against a supersampled reference of
//      the same path — AND that aliasing is attributable to the alpha-tested foliage rather than
//      to the ground and fence around it, checked against the same scene built without leaf cards.
//
// (4) is the one that matters. (1)-(3) only stop it passing for a silly reason.

import assert from 'node:assert/strict';
import { openHarness } from './harness.mjs';
import { temporalErrorDelta, downsample, brightRegionMask, rmse } from './metrics.mjs';

const BASE = Number(process.env.BENCH_SIZE || 160);
const REF_SCALE = 4;
const FRAMES = Number(process.env.BENCH_FRAMES || 10);

const toFloat = (buf) => {
  const f = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) f[i] = buf[i];
  return f;
};

async function sequence(harness, scene, size, options, frames, refScale) {
  const info = await harness.build(scene, size, options);
  const out = [];
  for (let n = 0; n < frames; n++) {
    const raw = await harness.frame(n, frames);
    out.push(refScale ? downsample(toFloat(raw), size, refScale) : toFloat(raw));
  }
  return { info, frames: out };
}

const harness = await openHarness();
try {
  console.log(`Scene 4 — alpha-tested foliage, ${BASE}px, ${FRAMES} frames, ${REF_SCALE}x reference`);

  /* ---- 1. It renders ---- */
  const built = await harness.build('foliage', BASE, {});
  console.log(`  build: webgl2=${built.webgl2} materials=${built.materials}`);
  assert.equal(built.webgl2, true, 'the bench must run on WebGL2');
  assert.ok(built.materials >= 2,
    'the scene must expose both its leaf material and its slat material — the slats are the ' +
    'geometric-edge control that tells "MSAA does nothing here" apart from "MSAA is not on"');

  /* ---- 2. Not degenerate ---- */
  const first = toFloat(await harness.frame(0, FRAMES));
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < first.length; i++) {
    if (first[i] < min) min = first[i];
    if (first[i] > max) max = first[i];
    sum += first[i];
  }
  const mean = sum / first.length;
  console.log(`  luminance: min ${min} max ${max} mean ${mean.toFixed(1)}`);
  assert.ok(max - min > 60,
    `the frame spans only ${max - min} luminance levels; a flat or blank scene measures nothing`);
  assert.ok(mean > 15 && mean < 240, `mean luminance ${mean.toFixed(1)} suggests a blown or black frame`);

  /* ---- 3. The alpha test is load-bearing ---- */
  // Raise the cutoff and more of every leaf is discarded. If the image does not change, the
  // material is not actually alpha-testing and the whole scene is mislabelled.
  await harness.build('foliage', BASE, { alphaTest: 0.95 });
  const cut = toFloat(await harness.frame(0, FRAMES));
  const cutDelta = rmse(first, cut);
  console.log(`  alphaTest 0.5 -> 0.95 changes the image by RMSE ${cutDelta.toFixed(2)}`);
  assert.ok(cutDelta > 2.0,
    `raising the alpha cutoff changed the image by only ${cutDelta.toFixed(2)} RMSE, so the ` +
    'foliage is not being alpha-tested and this scene does not contain the case it exists for');

  /* ---- 4. It aliases measurably ---- */
  const refFoliage = await sequence(harness, 'foliage', BASE * REF_SCALE, {}, FRAMES, REF_SCALE);
  const runFoliage = await sequence(harness, 'foliage', BASE, {}, FRAMES, 0);
  const maskFoliage = brightRegionMask(refFoliage.frames[Math.floor(FRAMES / 2)], 10);
  const foliageDelta = temporalErrorDelta(runFoliage.frames, refFoliage.frames, maskFoliage.mask);

  const refSpheres = await sequence(harness, 'sphere-array', BASE * REF_SCALE, {}, FRAMES, REF_SCALE);
  const runSpheres = await sequence(harness, 'sphere-array', BASE, {}, FRAMES, 0);
  const maskSpheres = brightRegionMask(refSpheres.frames[Math.floor(FRAMES / 2)], 10);
  const spheresDelta = temporalErrorDelta(runSpheres.frames, refSpheres.frames, maskSpheres.mask);

  console.log(`  temporal error delta: foliage ${foliageDelta.toFixed(3)}, ` +
    `sphere array ${spheresDelta.toFixed(3)}`);
  console.log(`  marked region: foliage ${maskFoliage.count} px, spheres ${maskSpheres.count} px`);

  assert.ok(foliageDelta > 0.5,
    `the foliage scene's temporal error delta is ${foliageDelta.toFixed(3)} — too stable to be a ` +
    'useful aliasing surface. Phase 7 would be measuring MSAA against a scene that does not alias.');
  // The scene-2 number is RECORDED, not asserted against. An earlier version of this test required
  // foliage to alias more than the sphere array; that was a requirement invented here, not one §0.2
  // makes. The two scenes exhibit different artefacts — specular shimmer on a near-mirror normal
  // map versus coverage aliasing on alpha-tested cutouts — and the temporal metric was designed for
  // the first. Comparing them ranks nothing meaningful.

  /* ---- 4b. The aliasing must come from the FOLIAGE, not the scenery around it ---- */
  const refBare = await sequence(harness, 'foliage', BASE * REF_SCALE, { noFoliage: true }, FRAMES, REF_SCALE);
  const runBare = await sequence(harness, 'foliage', BASE, { noFoliage: true }, FRAMES, 0);
  const maskBare = brightRegionMask(refBare.frames[Math.floor(FRAMES / 2)], 10);
  const bareDelta = temporalErrorDelta(runBare.frames, refBare.frames, maskBare.mask);
  console.log(`  temporal error delta without the leaf cards: ${bareDelta.toFixed(3)}`);

  assert.ok(foliageDelta > bareDelta * 1.5,
    `removing the leaf cards only moved the temporal error delta from ${foliageDelta.toFixed(3)} ` +
    `to ${bareDelta.toFixed(3)}. The scene's instability is coming from the ground and slats, not ` +
    'from the alpha-tested foliage, so Phase 7 would be measuring the wrong thing here.');

  if (harness.errors.length) throw new Error('browser errors: ' + harness.errors.join(' | '));

  console.log('');
  console.log('Scene 4 is fit for purpose: it renders, it alpha-tests, it aliases measurably, and');
  console.log(`the aliasing is attributable to the foliage (${foliageDelta.toFixed(3)} with leaf ` +
    `cards, ${bareDelta.toFixed(3)} without). Phase 7 (MSAA) and Phase 5 can measure against it.`);
  console.log('');
  console.log('NOT a ranking against scene 2: that scene measures specular shimmer on a near-mirror');
  console.log('normal map, this one measures coverage aliasing on cutouts. Different artefacts.');
} finally {
  harness.close();
}
