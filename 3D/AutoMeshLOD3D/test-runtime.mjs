/**
 * test-runtime.mjs
 * Unit and integration tests for AutoMeshLOD3D runtime & decimation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Setup global environment
global.gdjs = {
  __autoMeshLOD3D: null,
};

// Load worker & runtime
const workerSrc = fs.readFileSync(path.join(here, 'AutoMeshLOD3D.worker.js'), 'utf8');
const rawRuntime = fs.readFileSync(path.join(here, 'AutoMeshLOD3D.runtime.js'), 'utf8');
const combined = `${workerSrc}\n${rawRuntime}`;
eval(combined);

const AML = global.gdjs.__autoMeshLOD3D;
if (!AML) {
  console.error('FAIL: AutoMeshLOD3D namespace not initialized.');
  process.exit(1);
}

console.log('--- Running AutoMeshLOD3D Tests ---');

// Test 1: QEM Decimator verification on sphere mesh
{
  const decimator = global.AutoMeshDecimator || (typeof self !== 'undefined' && self.AutoMeshDecimator);
  if (!decimator) {
    console.error('FAIL: AutoMeshDecimator engine not found.');
    process.exit(1);
  }

  // Create a grid of triangles (10x10 quads = 200 triangles)
  const positions = [];
  const indices = [];
  const N = 10;
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) {
      positions.push(x, Math.sin(x * 0.5) * Math.cos(y * 0.5), y);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i0 = y * (N + 1) + x;
      const i1 = i0 + 1;
      const i2 = (y + 1) * (N + 1) + x;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  const result = decimator.decimate({
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    ratios: [0.5, 0.2],
    preserveSeams: true,
  });

  const origTris = indices.length / 3;
  const lod1Tris = result[0.5].length / 3;
  const lod2Tris = result[0.2].length / 3;

  console.log(`Original: ${origTris} tris | LOD1: ${lod1Tris} tris | LOD2: ${lod2Tris} tris`);

  if (lod1Tris > origTris * 0.55 || lod1Tris < origTris * 0.4) {
    console.error(`FAIL: LOD1 reduction out of range: ${lod1Tris}/${origTris}`);
    process.exit(1);
  }
  if (lod2Tris > origTris * 0.25 || lod2Tris < origTris * 0.1) {
    console.error(`FAIL: LOD2 reduction out of range: ${lod2Tris}/${origTris}`);
    process.exit(1);
  }

  console.log('PASS: QEM Decimator achieved target triangle reductions.');
}

// Test 2: Behavior State and Hysteresis
{
  const mockOwner = {
    getX: () => 0,
    getY: () => 0,
    getZ: () => 0,
    getRenderer: () => ({
      getThreeObject: () => null,
    }),
  };

  const mockBehavior = {
    owner: mockOwner,
    _data: {
      LOD1Distance: 25.0,
      LOD1Reduction: 50.0,
      LOD2Distance: 60.0,
      LOD2Reduction: 80.0,
      ShadowCutoff: 40.0,
    },
  };

  const state = AML.getState(mockBehavior);
  if (!state) {
    console.error('FAIL: AutoMeshLODState creation failed.');
    process.exit(1);
  }

  state.forcedLOD = 1;
  state.setLODLevel(1);
  if (state.currentLOD !== 1) {
    console.error(`FAIL: Expected currentLOD 1, got ${state.currentLOD}`);
    process.exit(1);
  }

  console.log('PASS: Behavior state and LOD level overrides verified.');
}

console.log('All AutoMeshLOD3D tests PASSED successfully!\n');
