/**
 * test-runtime.mjs
 * Unit and integration tests for FloatingOrigin3D runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Create mock gdjs environment
global.gdjs = {
  __floatingOrigin3D: null,
};

// Load runtime
const runtimeCode = fs.readFileSync(path.join(here, 'FloatingOrigin3D.runtime.js'), 'utf8');
eval(runtimeCode);

const FO = global.gdjs.__floatingOrigin3D;
if (!FO) {
  console.error('FAIL: FloatingOrigin3D namespace not initialized.');
  process.exit(1);
}

console.log('--- Running FloatingOrigin3D Tests ---');

// Mock scene and objects
class MockObject {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this._threeObj = {
      position: { x, y, z },
      updateMatrixWorld: () => {},
    };
  }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
  setX(val) { this.x = val; }
  setY(val) { this.y = val; }
  setZ(val) { this.z = val; }
  getRenderer() {
    return {
      getThreeObject: () => this._threeObj,
    };
  }
}

class MockScene {
  constructor() {
    this.instances = [];
    this._threeCamera = {
      position: { x: 0, y: 0, z: 0 },
      updateMatrixWorld: () => {},
    };
  }
  getLayer() {
    return {
      getRenderer: () => ({
        getThreeCamera: () => this._threeCamera,
        getThreeScene: () => ({}),
      }),
    };
  }
  getAdhocListOfAllInstances() {
    return this.instances;
  }
}

// Test 1: Initialization and Coordinate Accumulation
{
  const mockOwner = new MockObject(1200, 0, 0);
  const mockBehavior = {
    owner: mockOwner,
    _data: { ShiftThreshold: 1000.0, StepSize: 1000.0, EnablePhysicsShift: false },
  };

  const state = FO.getState(mockBehavior);
  if (!state) {
    console.error('FAIL: State creation failed.');
    process.exit(1);
  }

  console.log('PASS: State initialized successfully.');

  // Test 2: Origin shift calculation
  const mockScene = new MockScene();
  mockScene.instances.push(mockOwner);
  mockScene._threeCamera.position.x = 1200;

  state.step(mockScene);

  if (state.originWorldX !== 1000.0) {
    console.error(`FAIL: Expected originWorldX to be 1000.0, got ${state.originWorldX}`);
    process.exit(1);
  }
  if (mockOwner.getX() !== 200.0) {
    console.error(`FAIL: Expected object local X to be 200.0, got ${mockOwner.getX()}`);
    process.exit(1);
  }
  if (mockScene._threeCamera.position.x !== 200.0) {
    console.error(`FAIL: Expected camera X to be 200.0, got ${mockScene._threeCamera.position.x}`);
    process.exit(1);
  }
  if (!state.hasRecentlyShifted) {
    console.error('FAIL: hasRecentlyShifted flag was not set.');
    process.exit(1);
  }

  // True World Coordinate expression test
  const trueX = state.getTruePlayerWorldX(mockOwner.getX());
  if (trueX !== 1200.0) {
    console.error(`FAIL: Expected truePlayerWorldX to be 1200.0, got ${trueX}`);
    process.exit(1);
  }

  console.log('PASS: Quantized Origin Shift & 64-bit Accumulation verified.');
}

console.log('All FloatingOrigin3D tests PASSED successfully!\n');
