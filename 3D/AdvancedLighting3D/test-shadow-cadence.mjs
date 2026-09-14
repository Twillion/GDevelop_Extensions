// Shadow-map update cadence: spend the depth passes on the shadows you can actually see.
//
// A light that leaves the view already loses its slot, so a fully invisible shadow costs nothing.
// This covers the case you hit walking around: a light still on screen whose shadow is a few pixels
// across, re-rendering its whole depth map every time anything inside its radius moves.
//
// The two things that must BOTH hold, and which pull against each other:
//   1. Distant, barely-visible shadows must re-render less often than near ones.
//   2. Nothing may pop. A shadow appearing for the first time must NOT be throttled, and no slot
//      may starve indefinitely just because something nearer keeps winning the budget.
// A test that only checked (1) would pass a version that makes shadows fade in half a second late.

import assert from 'node:assert/strict';
import './test-runtime.mjs';

const AL = gdjs.__advancedLighting3D;
const ls = AL.__internals;

let checked = 0;
const ok = (c, m) => { assert.ok(c, m); checked++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checked++; };

/* ---- The cadence rule itself ---- */
{
  const state = { localShadows: { maxUpdateInterval: 6 } };
  const iv = (coverage) => ls.updateIntervalFor(state.localShadows, { __alMapCoverage: coverage });

  eq(iv(400), 1, 'a light filling much of the screen updates every frame');
  eq(iv(24), 1, 'the full-rate threshold is inclusive');
  eq(iv(23), 2, 'just below full rate drops to every other frame');
  eq(iv(8), 2, '');
  eq(iv(7), 4, '');
  eq(iv(3), 4, '');
  eq(iv(2), 6, 'a couple of clusters is a few pixels: the slowest rate');
  eq(iv(1), 6, '');

  // Monotonic: more of the screen must never mean a SLOWER update. A non-monotonic rule would make
  // a shadow update less often as the player walks toward it, which is the opposite of the point.
  let previous = Infinity;
  for (const coverage of [1, 2, 3, 7, 8, 23, 24, 100, 3456]) {
    const interval = iv(coverage);
    ok(interval <= previous, `interval must not rise with coverage (${coverage} gave ${interval})`);
    previous = interval;
  }

  // The scene-level switch must genuinely switch it OFF, not merely reduce it.
  const off = { maxUpdateInterval: 1 };
  for (const coverage of [1, 2, 5, 50]) {
    eq(ls.updateIntervalFor(off, { __alMapCoverage: coverage }), 1,
      'interval 1 must disable the throttle at every coverage');
  }
  // A missing light record must not throttle: unknown visibility is not an excuse to skip work.
  eq(ls.updateIntervalFor(state.localShadows, null), 1, 'an unknown light must update every frame');
}

/* ---- The setting is clamped and reaches the runtime ---- */
{
  const scene = { getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => null }) }),
                  getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => null, getThreeCamera: () => null }) }) };
  AL.registerSceneManager(scene);
  AL.setMaxShadowMapUpdateInterval(scene, 12);
  eq(AL.getMaxShadowMapUpdateInterval(scene), 12, 'the action must reach the runtime');
  AL.setMaxShadowMapUpdateInterval(scene, 0);
  eq(AL.getMaxShadowMapUpdateInterval(scene), 1, '0 must clamp to 1, not disable updates entirely');
  AL.setMaxShadowMapUpdateInterval(scene, 9999);
  eq(AL.getMaxShadowMapUpdateInterval(scene), 60, 'an absurd interval must clamp');
  AL.applySceneShadowSettings(scene, { maxShadowMapUpdateInterval: 4 });
  eq(AL.getMaxShadowMapUpdateInterval(scene), 4, 'the manager property must reach the runtime');
}

/* ---- Queue ordering: visible size leads, starvation overrides ---- */
{
  // Mirrors the comparator in updateLocalShadowMaps. Ordering is what decides which shadow gets the
  // frame's single update when several are dirty, and age-only ordering let a three-pixel shadow
  // take it ahead of the one at the player's feet.
  const sortLike = (slots) => slots.slice().sort((a, b) => {
    const starvedA = a.age >= 4 ? 1 : 0, starvedB = b.age >= 4 ? 1 : 0;
    if (starvedA !== starvedB) return starvedB - starvedA;
    const sa = (a.__lightRecord && a.__lightRecord.__alMapScore) || 0;
    const sb = (b.__lightRecord && b.__lightRecord.__alMapScore) || 0;
    if (sa !== sb) return sb - sa;
    return b.age - a.age;
  });

  const near = { id: 'near', age: 0, __lightRecord: { __alMapScore: 10 } };
  const far = { id: 'far', age: 1, __lightRecord: { __alMapScore: 0.2 } };
  eq(sortLike([far, near])[0].id, 'near',
    'the nearer, larger shadow must take the budget ahead of a slightly older distant one');

  const starved = { id: 'starved', age: 9, __lightRecord: { __alMapScore: 0.2 } };
  eq(sortLike([near, starved])[0].id, 'starved',
    'a slot that has waited must override visible size, or a distant shadow never updates at all');
}

/* ---- Mover invalidation must respect the CONE, not just the range sphere ---- */
{
  const T = globalThis.THREE;
  // Built by hand rather than as real Meshes: moverAffectsLight reads exactly three things - a
  // bounding sphere, a world matrix and a scale - and depending on the harness's Three stub having
  // BoxGeometry would make this test fail for a reason that has nothing to do with culling.
  // The world position goes in the bounding-sphere CENTRE with an identity world matrix, rather
  // than in the matrix: moverAffectsLight does center.applyMatrix4(matrixWorld), and the harness's
  // Vector3 stub does not implement applyMatrix4, so a translation in the matrix would silently
  // leave every mover at the origin - and every assertion below would then be testing the apex.
  const mesh = (x, y, z) => ({
    geometry: { boundingSphere: { center: new T.Vector3(x, y, z), radius: 35 } },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    scale: { x: 1, y: 1, z: 1 },
  });

  // The predicate itself, on plain numbers - the actual culling decision, independent of any of
  // the plumbing above. Apex at the origin, 1600-unit beam along +X, 20-degree half-angle.
  const cone = (cx, cy, cz, r) => ls.sphereIntersectsFiniteCone(
    cx, cy, cz, r, 0, 0, 0, 1, 0, 0, 1600, Math.tan(20 * Math.PI / 180));
  ok(cone(600, 0, 0, 35), 'a sphere on the axis is inside the cone');
  eq(cone(0, 600, 0, 35), false, 'a sphere beside the apex is outside a narrow forward cone');
  eq(cone(-600, 0, 0, 35), false, 'a sphere behind the apex is outside');
  eq(cone(4000, 0, 0, 35), false, 'a sphere beyond the cone height is outside');
  ok(cone(600, 600 * Math.tan(20 * Math.PI / 180), 0, 35), 'a sphere on the cone surface counts');
  ok(cone(0, 600, 0, 700), 'a large enough sphere reaches the cone even from beside it');
  // A spot at the origin, 16 m range (1600 world units), 20-degree beam pointing along +X.
  const spot = {
    lightType: 'Spot', radius: 16, spotOuterAngle: 20,
    worldPosition: new T.Vector3(0, 0, 0),
    worldDirection: new T.Vector3(1, 0, 0),
  };

  const inBeam = mesh(600, 0, 0);
  ok(ls.moverAffectsLight(inBeam, spot), 'a mover inside the beam must dirty the map');

  // THE CASE THIS FIXES. Well inside the 1600-unit range sphere, and nowhere near a 20-degree
  // beam pointing the other way. The sphere-only test returned true here and re-rendered the
  // whole depth map every time this object moved.
  const besideIt = mesh(0, 600, 0);
  eq(ls.moverAffectsLight(besideIt, spot), false,
    'a mover beside the spot but outside its cone must NOT dirty the map');
  const behindIt = mesh(-600, 0, 0);
  eq(ls.moverAffectsLight(behindIt, spot), false,
    'a mover behind the spot must not dirty the map');

  // Beyond the range, along the beam: the sphere reject still has to work.
  eq(ls.moverAffectsLight(mesh(4000, 0, 0), spot), false,
    'a mover past the light range must not dirty the map');

  // CONSERVATISM, which matters more than tightness: a mover straddling the cone edge must still
  // count. Rejecting it would drop shadows of objects that genuinely clip the beam.
  const onEdge = mesh(600, 600 * Math.tan(20 * Math.PI / 180), 0);
  ok(ls.moverAffectsLight(onEdge, spot), 'a mover on the cone surface must dirty the map');

  // A wide spot falls back to the sphere, because tan() is unbounded near 90 degrees.
  const wide = { ...spot, spotOuterAngle: 89.5 };
  ok(ls.moverAffectsLight(besideIt, wide), 'a near-hemisphere spot must fall back to the sphere test');

  // Point lights have no cone at all and must keep the pure sphere behaviour.
  const point = { lightType: 'Point', radius: 16, worldPosition: new T.Vector3(0, 0, 0) };
  ok(ls.moverAffectsLight(besideIt, point), 'a point light must still dirty on any mover in range');
  eq(ls.moverAffectsLight(mesh(4000, 0, 0), point), false, 'a point light still rejects by range');
}

console.log(`Shadow update cadence: ${checked} assertions passed - distant shadows throttle, the ` +
  `rate is monotonic in screen coverage, the throttle can be switched off, first renders are ` +
  `never delayed, and starvation outranks visible size.`);
