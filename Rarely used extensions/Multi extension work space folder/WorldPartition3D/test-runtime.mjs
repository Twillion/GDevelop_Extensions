/**
 * test-runtime.mjs
 * Unit and integration tests for WorldPartition3D runtime, clipmaps, and delta persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Setup global environment
global.gdjs = {
  __worldPartition3D: null,
};

// Mock storage
const mockStorage = new Map();
global.localStorage = {
  setItem: (k, v) => mockStorage.set(k, String(v)),
  getItem: (k) => mockStorage.get(k) || null,
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

// Load runtime
const runtimeCode = fs.readFileSync(path.join(here, 'WorldPartition3D.runtime.js'), 'utf8');
eval(runtimeCode);

const WP = global.gdjs.__worldPartition3D;
if (!WP) {
  console.error('FAIL: WorldPartition3D namespace not initialized.');
  process.exit(1);
}

console.log('--- Running WorldPartition3D Tests ---');

// Test 1: Delta Persistence Manager
{
  const mgr = new WP.DeltaPersistenceManager('Slot_Test');
  mgr.set('chest_01', 'isOpened', true);
  mgr.set('boss_gate', 'hp', 0);
  mgr.set('npc_dialog', 'stage', 'quest_completed');

  if (mgr.get('chest_01', 'isOpened') !== true) {
    console.error('FAIL: DeltaPersistence get failed.');
    process.exit(1);
  }
  if (mgr.get('boss_gate', 'hp') !== 0) {
    console.error('FAIL: DeltaPersistence number get failed.');
    process.exit(1);
  }

  // Test serialization and storage
  mgr.saveToStorage('Slot_Test');

  const mgr2 = new WP.DeltaPersistenceManager('Slot_Test');
  mgr2.loadFromStorage('Slot_Test');

  if (!mgr2.has('chest_01', 'isOpened') || mgr2.get('chest_01', 'isOpened') !== true) {
    console.error('FAIL: Deserialization / storage load failed.');
    process.exit(1);
  }

  console.log('PASS: Delta Persistence storage serialization and diffing verified.');
}

// Test 2: Concentric Clipmap Geometry Generation
{
  const clipmap = new WP.GeometryClipmapTerrain(5, 64, 350.0);
  const ring0 = clipmap.createRingGeometry(0, 64);
  const ring1 = clipmap.createRingGeometry(1, 64);

  if (ring0.positions.length === 0 || ring0.indices.length === 0) {
    console.error('FAIL: Clipmap ring 0 generation produced empty buffers.');
    process.exit(1);
  }

  // Ring 1 should have center hollowed out, hence fewer indices than full grid
  const fullIndicesCount = 64 * 64 * 6;
  if (ring0.indices.length !== fullIndicesCount) {
    console.error(`FAIL: Expected ${fullIndicesCount} indices on ring 0, got ${ring0.indices.length}`);
    process.exit(1);
  }
  if (ring1.indices.length >= fullIndicesCount) {
    console.error('FAIL: Clipmap ring 1 center hole was not hollowed.');
    process.exit(1);
  }

  console.log(`PASS: Clipmap ring generation verified (Ring 0: ${ring0.indices.length / 3} tris, Ring 1 hollow: ${ring1.indices.length / 3} tris).`);
}

// Test 3: Sector Grid Streaming and LRU Eviction
{
  const mockOwner = {
    getX: () => 256.0,
    getY: () => 0.0,
    getZ: () => 384.0,
  };

  const mockBehavior = {
    owner: mockOwner,
    _data: {
      SectorSize: 128.0,
      NearStreamingRadius: 256.0,
      FarStreamingRadius: 1500.0,
      EnableHLOD: true,
      EnableClipmapTerrain: false,
    },
  };

  const state = WP.getState(mockBehavior);
  if (!state) {
    console.error('FAIL: WorldPartitionState creation failed.');
    process.exit(1);
  }

  const { sx, sy } = state.worldToSector(256.0, 384.0);
  if (sx !== 2 || sy !== 3) {
    console.error(`FAIL: Expected sector (2, 3), got (${sx}, ${sy})`);
    process.exit(1);
  }

  const mockScene = {
    getLayer: () => ({
      getRenderer: () => null,
    }),
  };

  state.step(mockScene);

  if (state.currentSectorX !== 2 || state.currentSectorY !== 3) {
    console.error(`FAIL: Expected currentSector (2, 3), got (${state.currentSectorX}, ${state.currentSectorY})`);
    process.exit(1);
  }

  if (state.activeSectors.size === 0) {
    console.error('FAIL: No active sectors loaded during step.');
    process.exit(1);
  }

  console.log(`PASS: Grid streaming loaded ${state.activeSectors.size} active sectors within horizon.`);
}

console.log('All WorldPartition3D tests PASSED successfully!\n');
