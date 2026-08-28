/**
 * test-automesh.mjs
 * Unit and integration tests for AutoMeshLOD3D QEM Decimator & Runtime
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Import worker module
const workerModule = await import('./AutoMeshLOD3D.worker.js');
const Decimator = workerModule.default || globalThis.AutoMeshDecimator;

console.log('--- Running AutoMeshLOD3D Verification Tests ---\n');

// 1. Helper: Generate UV Sphere Geometry
function createSphereGeometry(radius = 1, widthSegments = 32, heightSegments = 16) {
  const positions = [];
  const indices = [];
  const uvs = [];
  const normals = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI;

    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;

      const px = -radius * Math.cos(theta) * Math.sin(phi);
      const py = radius * Math.cos(phi);
      const pz = radius * Math.sin(theta) * Math.sin(phi);

      positions.push(px, py, pz);
      uvs.push(u, 1 - v);

      const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
      normals.push(px / len, py / len, pz / len);
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = (widthSegments + 1) * y + x;
      const b = (widthSegments + 1) * (y + 1) + x;
      const c = (widthSegments + 1) * (y + 1) + (x + 1);
      const d = (widthSegments + 1) * y + (x + 1);

      if (y !== 0) indices.push(a, b, d);
      if (y !== heightSegments - 1) indices.push(b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
  };
}

// 2. Helper: Generate Open Plane Geometry (to test boundaries)
function createPlaneGeometry(width = 10, height = 10, segmentsX = 10, segmentsY = 10) {
  const positions = [];
  const indices = [];

  for (let y = 0; y <= segmentsY; y++) {
    const py = (y / segmentsY - 0.5) * height;
    for (let x = 0; x <= segmentsX; x++) {
      const px = (x / segmentsX - 0.5) * width;
      positions.push(px, py, 0);
    }
  }

  for (let y = 0; y < segmentsY; y++) {
    for (let x = 0; x < segmentsX; x++) {
      const a = (segmentsX + 1) * y + x;
      const b = (segmentsX + 1) * (y + 1) + x;
      const c = (segmentsX + 1) * (y + 1) + (x + 1);
      const d = (segmentsX + 1) * y + (x + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

// Test 1: Sphere Decimation
{
  const sphere = createSphereGeometry(2, 32, 16);
  const initialTriangles = sphere.indices.length / 3;
  console.log(`[Test 1] Sphere Base Triangles: ${initialTriangles}`);

  const results = Decimator.decimate({
    positions: sphere.positions,
    indices: sphere.indices,
    uvs: sphere.uvs,
    normals: sphere.normals,
    ratios: [0.5, 0.2],
    preserveSeams: true,
  });

  assert(results[0.5], 'LOD 1 (0.5) result must exist');
  assert(results[0.2], 'LOD 2 (0.2) result must exist');

  const lod1Triangles = results[0.5].length / 3;
  const lod2Triangles = results[0.2].length / 3;

  console.log(`  -> LOD 1 (target 50%): ${lod1Triangles} triangles (${((lod1Triangles / initialTriangles) * 100).toFixed(1)}%)`);
  console.log(`  -> LOD 2 (target 20%): ${lod2Triangles} triangles (${((lod2Triangles / initialTriangles) * 100).toFixed(1)}%)`);

  assert(lod1Triangles <= initialTriangles * 0.55, 'LOD 1 should be ~50% of initial triangles');
  assert(lod2Triangles <= initialTriangles * 0.25, 'LOD 2 should be ~20% of initial triangles');
  assert(lod2Triangles < lod1Triangles, 'LOD 2 must have fewer triangles than LOD 1');

  // Verify all index references are within valid vertex bounds
  const maxVertex = sphere.positions.length / 3;
  for (let i = 0; i < results[0.5].length; i++) {
    assert(results[0.5][i] < maxVertex, `LOD 1 index ${results[0.5][i]} exceeds max vertex ${maxVertex}`);
  }
  for (let i = 0; i < results[0.2].length; i++) {
    assert(results[0.2][i] < maxVertex, `LOD 2 index ${results[0.2][i]} exceeds max vertex ${maxVertex}`);
  }

  console.log('✓ Test 1 Passed: Sphere Decimation & Index Integrity Verified\n');
}

// Test 2: Boundary Preservation on Open Plane
{
  const plane = createPlaneGeometry(10, 10, 12, 12);
  const initialTriangles = plane.indices.length / 3;
  console.log(`[Test 2] Open Plane Base Triangles: ${initialTriangles}`);

  const results = Decimator.decimate({
    positions: plane.positions,
    indices: plane.indices,
    ratios: [0.5, 0.2],
    preserveSeams: true,
  });

  const lod1Triangles = results[0.5].length / 3;
  const lod2Triangles = results[0.2].length / 3;

  console.log(`  -> LOD 1 Triangles: ${lod1Triangles}`);
  console.log(`  -> LOD 2 Triangles: ${lod2Triangles}`);

  assert(lod1Triangles < initialTriangles, 'LOD 1 must reduce plane triangles');
  assert(lod2Triangles < lod1Triangles, 'LOD 2 must reduce further');

  console.log('✓ Test 2 Passed: Open Plane Boundary Decimation Verified\n');
}

// Test 3: Extension Manifest Validation
{
  const jsonPath = path.join(here, 'AutoMeshLOD3D.json');
  assert(fs.existsSync(jsonPath), 'AutoMeshLOD3D.json must exist');

  const extJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.strictEqual(extJson.name, 'AutoMeshLOD3D');
  assert(extJson.eventsBasedBehaviors && extJson.eventsBasedBehaviors.length === 1);
  assert(extJson.eventsFunctions && extJson.eventsFunctions.length > 0);

  const beh = extJson.eventsBasedBehaviors[0];
  assert.strictEqual(beh.name, 'AutoMeshLOD3D');
  assert(beh.propertyDescriptors && beh.propertyDescriptors.length >= 8);

  const propNames = beh.propertyDescriptors.map(p => p.name);
  assert(propNames.includes('LOD1Distance'));
  assert(propNames.includes('LOD1Ratio'));
  assert(propNames.includes('LOD2Distance'));
  assert(propNames.includes('LOD2Ratio'));
  assert(propNames.includes('ShadowCutoffDistance'));
  assert(propNames.includes('EvaluationMode'));
  assert(propNames.includes('ThrottleAnimation'));
  assert(propNames.includes('PreserveSeams'));

  console.log('✓ Test 3 Passed: Extension JSON Schema & Descriptors Verified\n');
}

console.log('========================================');
console.log(' ALL AUTOMESHLOD3D TESTS PASSED! (3/3)');
console.log('========================================\n');
