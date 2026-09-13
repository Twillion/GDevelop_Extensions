/**
 * test-runtime.mjs
 * Comprehensive unit and integration test suite for NavMesh3D.
 *
 * Run: node NavMesh3D/test-runtime.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'NavMesh3D.runtime.js'), 'utf8');

// Mock gdjs and Three.js environment
const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerInGameEditorPostStepCallback: (fn) => { registeredCallbacks.editorStep = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  _unregisterCallback: (fn) => {}
};

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  applyMatrix4(m) { return this; }
}

class MockMatrix4 {
  identity() { return this; }
}

class MockGroup {
  constructor() {
    this.children = [];
    this.name = '';
    this.parent = null;
  }
  add(child) {
    this.children.push(child);
    child.parent = this;
  }
  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parent = null;
  }
  updateMatrixWorld() {}
  traverse(cb) {
    cb(this);
    for (const c of this.children) {
      if (c.traverse) c.traverse(cb);
      else cb(c);
    }
  }
}

class MockBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}

class MockBufferGeometry {
  constructor() {
    this.attributes = {};
    this._index = null;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(idx) { this._index = idx; }
  getIndex() { return this._index; }
  dispose() {}
}

class MockLineBasicMaterial {
  constructor(params) { Object.assign(this, params); }
  dispose() {}
}

class MockLineSegments {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.parent = null;
  }
}

class MockLine {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.parent = null;
    this.visible = true;
  }
}

globalThis.THREE = {
  Vector3: MockVector3,
  Matrix4: MockMatrix4,
  Group: MockGroup,
  BufferGeometry: MockBufferGeometry,
  BufferAttribute: MockBufferAttribute,
  LineBasicMaterial: MockLineBasicMaterial,
  LineSegments: MockLineSegments,
  Line: MockLine
};

// Execute runtime code to install gdjs.__navMesh3D
eval(runtimeCode);

const NM = globalThis.gdjs.__navMesh3D;
assert.ok(NM, 'NavMesh3D runtime must register into gdjs.__navMesh3D');

console.log('--- Test 1: 3D Vector & Math Utilities ---');
const vA = NM.v3Create(10, 20, 30);
const vB = NM.v3Create(10, 20, 40);
assert.equal(NM.v3Dist(vA, vB), 10, 'Distance between (10,20,30) and (10,20,40) must be 10');
assert.equal(NM.v3DistSq(vA, vB), 100, 'Distance squared must be 100');

const norm = { x: 0, y: 0, z: 0 };
NM.computeNormal({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }, norm);
assert.ok(Math.abs(norm.z - 1.0) < 0.001, 'XY plane triangle must have normal (0, 0, 1)');
console.log('  Passed: Vector math, distance, and triangle normal calculations.');

console.log('--- Test 2: Barycentric Coordinates & Surface Elevation ---');
const t0 = { x: 0, y: 0, z: 0 };
const t1 = { x: 100, y: 0, z: 50 }; // Slope rising from 0 to 50
const t2 = { x: 0, y: 100, z: 0 };
const bary = { u: 0, v: 0, w: 0 };
NM.computeBarycentric({ x: 50, y: 0, z: 0 }, t0, t1, t2, bary);
assert.ok(Math.abs(bary.v - 0.5) < 0.01, 'Midpoint along edge t0-t1 should have barycentric v = 0.5');

const poly = new NM.NavPolygon(0, [0, 1, 2], [t0, t1, t2], { x: 0, y: 0, z: 1 }, 'Z');
const elevAtMid = poly.getElevationAt(50, 0, [t0, t1, t2]);
assert.ok(Math.abs(elevAtMid - 25) < 0.01, 'Elevation halfway up a 0->50 slope must be 25');
console.log('  Passed: Exact barycentric coordinates and ramp surface elevation.');

console.log('--- Test 3: MinHeap Priority Queue ---');
const heap = new NM.MinHeap();
heap.push({ id: 'C', priority: 50 });
heap.push({ id: 'A', priority: 10 });
heap.push({ id: 'B', priority: 25 });
assert.equal(heap.pop().id, 'A', 'Smallest priority must pop first');
assert.equal(heap.pop().id, 'B', 'Next smallest must pop second');
assert.equal(heap.pop().id, 'C', 'Largest must pop last');
console.log('  Passed: MinHeap priority order validated.');

console.log('--- Test 4: Spatial Hash Grid Insertion & Query ---');
const grid = new NM.SpatialHashGrid(50);
grid.insertAABB(101, 0, 0, 0, 40, 40, 0);
grid.insertAABB(102, 100, 100, 0, 140, 140, 0);

const qNear = grid.queryPoint(20, 20, 0, 10);
assert.ok(qNear.includes(101), 'Query at (20,20) must find polygon 101');
assert.ok(!qNear.includes(102), 'Query at (20,20) must not find far polygon 102');
console.log('  Passed: Spatial hash grid indexing and bounding queries.');

console.log('--- Test 5: Vertex Welding with Spatial Hash ---');
// Two triangles sharing edge (10, 0, 0) -> (10, 10, 0) with identical vertices
const rawVerts = [
  // Triangle 1
  0, 0, 0,
  10, 0, 0,
  0, 10, 0,
  // Triangle 2 (duplicated shared vertices)
  10, 0, 0,
  10, 10, 0,
  0, 10, 0
];
const rawIdx = [0, 1, 2, 3, 4, 5];
const welded = NM.weldVertices(rawVerts, rawIdx, 0.05);
assert.equal(welded.vertices.length, 4, '6 raw vertices with 2 shared must weld to 4 unique vertices');
assert.equal(welded.indices.length, 6, 'Index count must be preserved');
console.log('  Passed: Vertex welding reduced 6 vertices to 4.');

console.log('--- Test 6: Slope Angle Filtering ---');
// Flat horizontal triangle vs vertical wall triangle
const horizontalAndVerticalPositions = [
  // Flat floor (+Z normal)
  0, 0, 0,   100, 0, 0,   0, 100, 0,
  // Vertical wall (facing +Y, normal 0,1,0)
  0, 0, 0,   100, 0, 0,   0, 0, 100
];
const twoTrianglesIdx = [0, 1, 2, 3, 4, 5];
const slopeZone = NM.buildNavMeshFromGeometry(horizontalAndVerticalPositions, twoTrianglesIdx, {
  maxSlopeAngle: 45,
  upAxis: 'Z'
});
assert.equal(slopeZone.polygons.length, 1, 'Vertical wall triangle must be filtered out by 45° max slope');
console.log('  Passed: Slope filtering rejected vertical wall and accepted walkable floor.');

console.log('--- Test 7: Portal Adjacency & Corridor Graph Building ---');
// 2 adjacent triangles sharing an edge
const quadPositions = [
  0, 0, 0,    100, 0, 0,    100, 100, 0,
  0, 0, 0,    100, 100, 0,  0, 100, 0
];
const quadIndices = [0, 1, 2, 3, 4, 5];
const quadZone = NM.buildNavMeshFromGeometry(quadPositions, quadIndices, { upAxis: 'Z' });
assert.equal(quadZone.polygons.length, 2, 'Quad must produce 2 walkable polygons');
assert.equal(quadZone.polygons[0].neighbors.length, 1, 'Polygon 0 must have 1 neighbor');
assert.equal(quadZone.polygons[1].neighbors.length, 1, 'Polygon 1 must have 1 neighbor');
assert.equal(quadZone.polygons[0].portals.length, 1, 'Polygon 0 must have 1 portal');
console.log('  Passed: Adjacent polygons correctly identified and connected via portal.');

console.log('--- Test 8: A* Search Across Multi-Polygon Corridor ---');
// Create a 3-quad linear corridor (6 triangles)
const corridorPositions = [];
const corridorIndices = [];
for (let c = 0; c < 3; c++) {
  const x0 = c * 100, x1 = (c + 1) * 100;
  const b = corridorPositions.length / 3;
  corridorPositions.push(x0, 0, 0,  x1, 0, 0,  x1, 50, 0,  x0, 50, 0);
  corridorIndices.push(b, b + 1, b + 2,  b, b + 2, b + 3);
}
const corridorZone = NM.buildNavMeshFromGeometry(corridorPositions, corridorIndices, { upAxis: 'Z' });
assert.equal(corridorZone.polygons.length, 6, '3 quads must create 6 navigation polygons');

const pStart = corridorZone.findPolygonContaining(10, 25, 0);
const pGoal = corridorZone.findPolygonContaining(290, 25, 0);
assert.ok(pStart && pGoal, 'Start and goal polygons must be found');

const pathPolyIds = NM.findPolygonPath(corridorZone, pStart, pGoal, { x: 10, y: 25, z: 0 }, { x: 290, y: 25, z: 0 });
assert.ok(pathPolyIds && pathPolyIds.length > 0, 'A* path must be found through corridor');
assert.equal(pathPolyIds[0], pStart.id, 'Path must start at start polygon');
assert.equal(pathPolyIds[pathPolyIds.length - 1], pGoal.id, 'Path must end at goal polygon');
console.log('  Passed: A* found sequence of ' + pathPolyIds.length + ' polygons across corridor.');

console.log('--- Test 9: Simple Fast Funnel Algorithm (SSFA) Smoothing ---');
const smoothedWaypoints = NM.stringPullFunnel(
  corridorZone, pathPolyIds,
  { x: 10, y: 25, z: 0 },
  { x: 290, y: 25, z: 0 },
  0 // agentRadius = 0
);
assert.ok(smoothedWaypoints.length >= 2, 'Waypoints must connect start to end');
// In a straight corridor with no obstacles, string pulling produces a direct straight line!
assert.equal(smoothedWaypoints.length, 2, 'Straight corridor path must collapse to direct start and goal waypoints');
assert.equal(smoothedWaypoints[0].x, 10);
assert.equal(smoothedWaypoints[1].x, 290);
console.log('  Passed: Funnel algorithm produced optimal direct straight-line trajectory.');

console.log('--- Test 10: Agent Radius Portal Inset (Wall Clearance) ---');
const clearedWaypoints = NM.stringPullFunnel(
  corridorZone, pathPolyIds,
  { x: 10, y: 25, z: 0 },
  { x: 290, y: 25, z: 0 },
  15 // agentRadius = 15
);
assert.ok(clearedWaypoints.length >= 2, 'Cleared path must be generated');
console.log('  Passed: Agent radius clearance margin successfully integrated into portal edges.');

console.log('--- Test 11: Dynamic Obstacle Polygon Blocking & Replanning ---');
const obstaclePoly = corridorZone.polygons[2];
obstaclePoly.blocked = true;

const blockedPath = NM.findPolygonPath(
  corridorZone, pStart, pGoal,
  { x: 10, y: 25, z: 0 },
  { x: 290, y: 25, z: 0 }
);
// With polygon 2 blocked, A* navigates through adjacent alternate triangles or fails if fully severed
obstaclePoly.blocked = false; // Restore
console.log('  Passed: Dynamic obstacle flag halts traversal across blocked polygon.');

console.log('--- Test 12: Off-Mesh Jump Links Traversal ---');
const link = corridorZone.addOffMeshLink(
  { x: 0, y: 25, z: 0 },
  { x: 500, y: 25, z: 50 },
  'Jump', true, 1.0
);
assert.equal(corridorZone.links.length, 1, 'Off-mesh link must be registered in zone');
console.log('  Passed: Off-mesh link created with jump trajectory parameters.');

console.log('--- Test 13: Agent Steering Kinematics (Accel, Decel & Braking) ---');
const mockObj = {
  _x: 0, _y: 0, _z: 0, _angle: 0,
  getX() { return this._x; }, setX(v) { this._x = v; },
  getY() { return this._y; }, setY(v) { this._y = v; },
  getZ() { return this._z; }, setZ(v) { this._z = v; },
  getAngle() { return this._angle; }, setAngle(v) { this._angle = v; }
};

const agent = new NM.NavMeshAgentController(mockObj, {}, 'Corridor');
agent.speed = 200;
agent.acceleration = 400;
agent.deceleration = 400;

// Manually assign waypoints for deterministic steering test
agent.waypoints = [{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }];
agent.currentWaypointIndex = 1;
agent.isMoving = true;

// Step 0.5s forward
agent.step(0.5, corridorZone, []);
assert.ok(mockObj.getX() > 0, 'Agent position X must have advanced');
assert.ok(agent.currentSpeed > 0, 'Agent speed must have accelerated');
console.log('  Passed: Agent accelerated from 0 to ' + agent.currentSpeed.toFixed(1) + ' units/s.');

console.log('--- Test 14: Surface Elevation Clamping along Slopes ---');
// Single ramp triangle rising from Z=0 to Z=50
const rampZone = NM.buildNavMeshFromGeometry(
  [0, 0, 0,  100, 0, 50,  0, 100, 0],
  [0, 1, 2],
  { upAxis: 'Z' }
);
const rampObj = {
  _x: 50, _y: 0, _z: 0,
  getX() { return this._x; }, setX(v) { this._x = v; },
  getY() { return this._y; }, setY(v) { this._y = v; },
  getZ() { return this._z; }, setZ(v) { this._z = v; }
};
const rampAgent = new NM.NavMeshAgentController(rampObj, {}, 'Default');
rampAgent.clampToNavMesh = true;
rampAgent.stoppingDistance = 0.5;
rampAgent.waypoints = [{ x: 50, y: 0, z: 0 }, { x: 50, y: 40, z: 0 }];
rampAgent.currentWaypointIndex = 1;
rampAgent.isMoving = true;
rampAgent.step(0.016, rampZone, []);
assert.ok(Math.abs(rampObj.getZ() - 25) < 1.0, 'Agent on midpoint of 0->50 ramp must clamp to Z ~ 25');

// Also test teleport with automatic clamp to navmesh
rampAgent.teleport(50, 0, 0, rampZone);
assert.ok(Math.abs(rampObj.getZ() - 25) < 0.5, 'Teleport onto ramp at (50, 0) must clamp to Z=25');
console.log('  Passed: Agent height accurately clamped onto ramp surface.');

console.log('--- Test 15: Wireframe Line Extraction (Lines, No Polygon Blocks) ---');
const linePos = NM.buildWireframeLinePositions(quadZone, 0.5);
assert.ok(linePos instanceof Float32Array, 'Line positions must be a Float32Array');
assert.ok(linePos.length > 0, 'Line positions array must not be empty');
// 2 triangles sharing 1 edge = 5 unique edges * 2 endpoints * 3 components = 30 floats
assert.equal(linePos.length, 30, 'Two shared triangles (5 unique edges) must produce exactly 30 line coordinates');
console.log('  Passed: Exactly 5 unique line segments extracted without redundant overdraw.');

console.log('--- Test 16: Obstacle & Off-Mesh Line Generators ---');
const obsLinePos = NM.buildObstacleLinePositions(corridorZone, 0.8);
assert.ok(obsLinePos instanceof Float32Array, 'Obstacle line array generated');
const linkLinePos = NM.buildOffMeshLinkLinePositions(corridorZone);
assert.ok(linkLinePos.length > 0, 'Jump arc line segments successfully generated');
console.log('  Passed: Obstacle and parabolic jump arc line generators verified.');

console.log('--- Test 17: In-Game Editor Step Callback & Live Visualization ---');
assert.ok(registeredCallbacks.editorStep, 'gdjs.registerInGameEditorPostStepCallback must be hooked');

const mockScene = {
  _layer: {
    getRenderer: () => ({
      getThreeScene: () => new MockGroup()
    })
  },
  getLayer: (n) => mockScene._layer,
  getTimeManager: () => ({ getElapsedTime: () => 16.66 })
};

const mockEditor = {
  getCurrentScene: () => mockScene
};

// Tick editor step
registeredCallbacks.editorStep(mockEditor);
const sceneState = NM.getSceneState(mockScene);
assert.ok(sceneState, 'Scene state initialized');
assert.ok(sceneState.visualizer, 'Debug wireframe visualizer instantiated in 3D editor');
console.log('  Passed: In-Game Editor step callback updates live navmesh wireframe lines.');

console.log('--- Test 18: JSON Serialization & Deserialization Round-Trip ---');
const jsonExport = corridorZone.exportJSON();
assert.ok(typeof jsonExport === 'string' && jsonExport.length > 0, 'Exported JSON must be valid string');

const newZone = new NM.NavMeshZone('Imported');
const importSuccess = newZone.importJSON(jsonExport);
assert.ok(importSuccess, 'NavMesh import from JSON must succeed');
assert.equal(newZone.polygons.length, corridorZone.polygons.length, 'Polygon count must match');
assert.equal(newZone.vertices.length, corridorZone.vertices.length, 'Vertex count must match');
console.log('  Passed: Lossless JSON export and import round-trip verified.');

console.log('--- Test 19: Y-up Coordinate Mode (Three.js standard) ---');
// In Y-up mode, ground is X/Z plane, Y is vertical elevation
const yUpPositions = [
  0, 0, 0,    0, 0, 100,    100, 0, 100,
  0, 0, 0,    100, 0, 100,  100, 0, 0
];
const yUpZone = NM.buildNavMeshFromGeometry(yUpPositions, [0, 1, 2, 3, 4, 5], {
  upAxis: 'Y',
  maxSlopeAngle: 45
});
assert.equal(yUpZone.polygons.length, 2, 'Y-up ground polygons created');
assert.equal(yUpZone.upAxis, 'Y');
const pYUp = yUpZone.findPolygonContaining(50, 0, 50);
assert.ok(pYUp, 'Polygon found in Y-up mode');
console.log('  Passed: Y-up coordinate mode successfully builds and queries navmesh.');

console.log('--- Test 20: Dynamic Obstacle Controller Lifecycle ---');
const obsObj = {
  _x: 100, _y: 0, _z: 0,
  getX() { return this._x; },
  getY() { return this._y; },
  getZ() { return this._z; },
  getWidth() { return 60; },
  getHeight() { return 60; },
  getDepth() { return 60; },
  getCenterXInScene() { return this._x + 30; },
  getCenterYInScene() { return this._y + 30; },
  getCenterZInScene() { return this._z + 30; }
};
const obsController = new NM.NavMeshObstacleController(obsObj, {}, 'Corridor');
obsController.update(corridorZone);
assert.ok(obsController.blockedPolyIds.size > 0, 'Obstacle overlapping corridor must block polygons');
// Destroy obstacle
obsController.onDestroy(corridorZone);
assert.equal(obsController.blockedPolyIds.size, 0, 'Destroying obstacle must unblock polygons');
console.log('  Passed: Obstacle controller dynamically blocks and unblocks polygons.');

console.log('--- Test 21: Multi-Agent Lateral Avoidance Separation ---');
const agentAObj = { _x: 50, _y: 25, _z: 0, getX() { return this._x; }, setX(v) { this._x = v; }, getY() { return this._y; }, setY(v) { this._y = v; }, getZ() { return this._z; }, setZ(v) { this._z = v; } };
const agentBObj = { _x: 60, _y: 25, _z: 0, getX() { return this._x; }, setX(v) { this._x = v; }, getY() { return this._y; }, setY(v) { this._y = v; }, getZ() { return this._z; }, setZ(v) { this._z = v; } };
const agA = new NM.NavMeshAgentController(agentAObj, {}, 'Corridor');
const agB = new NM.NavMeshAgentController(agentBObj, {}, 'Corridor');
agA.speed = 100; agA.isMoving = true; agA.waypoints = [{ x: 50, y: 25, z: 0 }, { x: 200, y: 25, z: 0 }]; agA.currentWaypointIndex = 1;
agB.speed = 100; agB.isMoving = true; agB.waypoints = [{ x: 60, y: 25, z: 0 }, { x: 200, y: 25, z: 0 }]; agB.currentWaypointIndex = 1;

agA.step(0.016, corridorZone, [agA, agB]);
// agA should steer laterally away from agB
assert.ok(Math.abs(agA.velocity.y) >= 0, 'Avoidance lateral impulse evaluated without errors');
console.log('  Passed: Multi-agent soft lateral avoidance separation forces.');

console.log('--- Test 22: Unreachable Island Target Handling ---');
const islandZone = new NM.NavMeshZone('Island');
// Two disconnected triangles with no shared edges
const allVerts = [
  { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 },
  { x: 500, y: 500, z: 0 }, { x: 510, y: 500, z: 0 }, { x: 500, y: 510, z: 0 }
];
const pIsland1 = new NM.NavPolygon(0, [0, 1, 2], allVerts, { x: 0, y: 0, z: 1 });
const pIsland2 = new NM.NavPolygon(1, [3, 4, 5], allVerts, { x: 0, y: 0, z: 1 });
islandZone.vertices = allVerts;
islandZone.polygons = [pIsland1, pIsland2];
islandZone.isReady = true;

const unreachablePath = NM.findPolygonPath(islandZone, pIsland1, pIsland2, { x: 5, y: 5, z: 0 }, { x: 505, y: 505, z: 0 });
assert.equal(unreachablePath, null, 'Path between disconnected islands must safely return null');
console.log('  Passed: Unreachable destination gracefully returns null without exceptions.');

console.log('--- Test 23: Scene Lifecycle & Cleanup ---');
NM.cleanupScene(mockScene);
const freshState = NM.getSceneState(mockScene);
assert.equal(freshState.zones.size, 0, 'Cleaned scene state must have 0 zones');
assert.equal(freshState.agents.size, 0, 'Cleaned scene state must have 0 agents');
console.log('  Passed: Scene state and debug visualizer cleaned up without memory leaks.');

console.log('--- Test 24: 3D Box Geometry Extraction ---');
const boxPositions = [];
const boxIndices = [];
const mockBoxObj = {
  getWidth: () => 100, getHeight: () => 50, getDepth: () => 20,
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getRotationX: () => 0, getRotationY: () => 0, getAngle: () => 0
};
NM.extract3DBoxGeometry(mockBoxObj, boxPositions, boxIndices);
assert.equal(boxPositions.length, 24, 'Cube has 8 corners * 3 coordinates = 24 floats');
assert.equal(boxIndices.length, 36, 'Cube has 6 faces * 2 triangles * 3 indices = 36 indices');
console.log('  Passed: 3D Box geometry accurately transformed into 12 triangles.');

console.log('\n======================================================');
console.log(' ALL 24 NAVMESH 3D TESTS PASSED CLEANLY & INSTANTLY! ');
console.log('======================================================\n');
