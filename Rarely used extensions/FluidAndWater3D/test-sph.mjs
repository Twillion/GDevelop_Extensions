/**
 * Correctness checks and a host-side benchmark for the pourable-liquid SPH core.
 *
 * The timing output is diagnostic, not a cross-device performance promise. Local particle density,
 * browser overhead, rendering, and target hardware all affect the in-game cost.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback() {},
  registerRuntimeSceneUnloadedCallback() {},
};

new Function(fs.readFileSync(new URL('./FluidAndWater3D.runtime.js', import.meta.url), 'utf8'))();
const { SPHSolver } = gdjs.__fluidAndWater3D;
assert.equal(typeof SPHSolver, 'function', 'SPHSolver must be available to the validation suite');

const WATER = {
  viscosity: 0.2,
  surfaceTension: 0.5,
  restDensity: 1000,
  radius: 0.02,
  color: [0.25, 0.7, 0.95],
  owner: 1,
};

function emitGrid(solver, count, spacing = 0.035) {
  const side = Math.ceil(Math.cbrt(count));
  for (let i = 0; i < count; i++) {
    const x = (i % side) * spacing;
    const y = (Math.floor(i / side) % side) * spacing;
    const z = 1 + Math.floor(i / (side * side)) * spacing;
    assert.notEqual(solver.emit(x, y, z, 0, 0, 0, 10, WATER), -1);
  }
}

console.log('--- A. Spatial-hash density agrees with a brute-force neighbour sum ---');
{
  const solver = new SPHSolver(128);
  emitGrid(solver, 64);
  const beforeX = Float32Array.from(solver.x);
  const beforeY = Float32Array.from(solver.y);
  const beforeZ = Float32Array.from(solver.z);
  solver.step(1 / 60, { floorZ: -10 });

  for (let i = 0; i < solver.particleCount; i++) {
    let expected = 0;
    for (let j = 0; j < solver.particleCount; j++) {
      const dx = beforeX[i] - beforeX[j];
      const dy = beforeY[i] - beforeY[j];
      const dz = beforeZ[i] - beforeZ[j];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < solver.h2) {
        const d = solver.h2 - r2;
        expected += solver.particleMass * solver.poly6 * d * d * d;
      }
    }
    expected = Math.max(expected, solver.rest[i] * 0.5);
    const relativeError = Math.abs(solver.density[i] - expected) / Math.max(1, expected);
    assert.ok(relativeError < 2e-5, `particle ${i} density differs by ${relativeError}`);
  }
  console.log('  Passed: all 64 particle densities match the direct calculation.');
}

console.log('--- B. Integration remains finite and respects the floor ---');
{
  const solver = new SPHSolver(256);
  emitGrid(solver, 125);
  for (let frame = 0; frame < 120; frame++) solver.step(1 / 30, { floorZ: 0 });

  for (let i = 0; i < solver.particleCount; i++) {
    for (const value of [solver.x[i], solver.y[i], solver.z[i], solver.vx[i], solver.vy[i], solver.vz[i]]) {
      assert.ok(Number.isFinite(value), `particle ${i} contains a non-finite value`);
    }
    assert.ok(solver.z[i] >= 0, `particle ${i} passed through the floor`);
  }
  console.log('  Passed: 120 frames at 30 Hz produced finite particles above the floor.');
}

console.log('--- C. Dead slots are recycled without corrupting ownership ---');
{
  const solver = new SPHSolver(3);
  const a = solver.emit(0, 0, 1, 0, 0, 0, 10, { ...WATER, owner: 10 });
  const b = solver.emit(1, 0, 1, 0, 0, 0, 10, { ...WATER, owner: 20 });
  solver.emit(2, 0, 1, 0, 0, 0, 10, { ...WATER, owner: 30 });
  assert.equal(a, 0);
  assert.equal(b, 1);
  solver.kill(b);
  const recycled = solver.emit(3, 0, 1, 0, 0, 0, 10, { ...WATER, owner: 40 });
  assert.equal(recycled, b);
  assert.equal(solver.countOwnedBy(20), 0);
  assert.equal(solver.countOwnedBy(40), 1);
  assert.equal(solver.getActiveCount(), 3);
  console.log('  Passed: the free-list reused the dead slot and replaced its owner.');
}

console.log('--- D. Host-side SPH timing (diagnostic only) ---');
for (const count of [250, 750, 1500]) {
  const solver = new SPHSolver(count);
  emitGrid(solver, count);
  solver.step(1 / 60, { floorZ: -10 }); // JIT warm-up
  const samples = [];
  for (let frame = 0; frame < 8; frame++) {
    const start = performance.now();
    solver.step(1 / 60, { floorZ: -10 });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`  ${String(count).padStart(4)} dense droplets: ${median.toFixed(2)} ms median SPH step`);
}

console.log('\nSPH CORRECTNESS TESTS PASSED');
