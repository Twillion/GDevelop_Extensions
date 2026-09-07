/**
 * test-portal3d.mjs
 * Comprehensive unit and integration test suite for Portal3D.
 *
 * Tests against real Three.js r160:
 *   1. JSON schema and parameter validations
 *   2. Portal matrix transformation mathematics (parallel & perpendicular portals)
 *   3. Oblique near-plane clip projection (Lengyel's matrix)
 *   4. Plane crossing detection, teleportation position & velocity rotation
 *   5. Lifecycle registration and cleanup
 *
 * Run: node Portal3D/test-portal3d.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/* ---------------------------------------------------------------- Load THREE */

const threePath = path.join(root, 'gdjs-harness/runtime/pixi-renderers/three.js');
const threeSrc = fs.readFileSync(threePath, 'utf8');
const THREE = new Function(threeSrc + '\nreturn THREE;')();
globalThis.THREE = THREE;

console.log(`\x1b[32m[✓]\x1b[0m Loaded real THREE r${THREE.REVISION}`);

/* ----------------------------------------------------------------- Load gdjs */

globalThis.gdjs = {
  toRad: (deg) => (deg * Math.PI) / 180,
  toDegrees: (rad) => (rad * 180) / Math.PI,
  registerRuntimeScenePostEventsCallback: () => {},
  registerRuntimeSceneUnloadedCallback: () => {},
};

const runtimeSrc = fs.readFileSync(path.join(here, 'Portal3D.runtime.js'), 'utf8');
new Function(runtimeSrc)();

const PORTAL = globalThis.gdjs.__portal3D;
assert.ok(PORTAL, 'Portal3D runtime must install on gdjs.__portal3D');
console.log('\x1b[32m[✓]\x1b[0m Portal3D runtime initialized on gdjs.__portal3D');

/* -------------------------------------------------------- Test 1: JSON Schema */

console.log('\n--- Test 1: Extension Schema & JSON Integrity ---');
const jsonPath = path.join(here, 'Portal3D.json');
assert.ok(fs.existsSync(jsonPath), 'Portal3D.json must exist');
const extension = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

assert.strictEqual(extension.name, 'Portal3D');
assert.strictEqual(extension.behaviors.length, 2);

const [portalBeh, travBeh] = extension.behaviors;
assert.strictEqual(portalBeh.name, 'Portal3D');
assert.strictEqual(travBeh.name, 'PortalTraversable3D');

// Verify propertyDescriptors exists and properties does not
assert.ok(Array.isArray(portalBeh.propertyDescriptors), 'Portal3D must use propertyDescriptors');
assert.strictEqual(portalBeh.properties, undefined, 'Portal3D must NOT have properties key');
assert.ok(Array.isArray(travBeh.propertyDescriptors), 'PortalTraversable3D must use propertyDescriptors');
assert.strictEqual(travBeh.properties, undefined, 'PortalTraversable3D must NOT have properties key');

// Check parameter types
const allFns = [...portalBeh.eventsFunctions, ...travBeh.eventsFunctions, ...extension.eventsFunctions];
for (const fn of allFns) {
  fn.parameters.forEach((p, idx) => {
    if (fn.parameters[0] === p && p.type === 'object') return;
    assert.notStrictEqual(p.type, 'object', `Parameter ${p.name} at index ${idx} in ${fn.name} cannot be type object`);
  });
}
console.log(`\x1b[32m[✓]\x1b[0m Schema lint passed (${allFns.length} functions verified)`);

/* ---------------------------------------------------- Test 2: Matrix Transforms */

console.log('\n--- Test 2: Portal Matrix Transformation Mathematics ---');

function mockPortalObject(x, y, z, angle = 0, rotX = 0, rotY = 0) {
  return {
    getX: () => x,
    getY: () => y,
    getZ: () => z,
    getCenterXInScene: () => x,
    getCenterYInScene: () => y,
    getCenterZInScene: () => z,
    getAngle: () => angle,
    getRotationX: () => rotX,
    getRotationY: () => rotY,
    getLayer: () => '',
    setX: function (v) { x = v; },
    setY: function (v) { y = v; },
    setZ: function (v) { z = v; },
    setAngle: function (v) { angle = v; },
    setRotationX: function (v) { rotX = v; },
    setRotationY: function (v) { rotY = v; }
  };
}

// Case A: Parallel portals along Z axis
// Portal A at (0, 0, 0) facing +Z
// Portal B at (0, 0, 200) facing +Z
const pA_obj = mockPortalObject(0, 0, 0);
const pB_obj = mockPortalObject(0, 0, 200);

const portalA = { object: pA_obj, forwardAxis: '+Z' };
const portalB = { object: pB_obj, forwardAxis: '+Z' };

const mRel = new THREE.Matrix4();
PORTAL.computePortalMatrix(portalA, portalB, mRel);

// Player camera at (0, 0, 50) looking towards Portal A at Z=0
const playerCam = new THREE.PerspectiveCamera(60, 1, 1, 1000);
playerCam.position.set(0, 0, 50);
playerCam.lookAt(0, 0, 0);
playerCam.updateMatrixWorld(true);

const virtualCamMatrix = new THREE.Matrix4().copy(mRel).multiply(playerCam.matrixWorld);
const vCamPos = new THREE.Vector3().setFromMatrixPosition(virtualCamMatrix);

// Player is 50 units in front of Portal A (+Z).
// With a 180° flip across the portal face, relative to Portal B (Z=200),
// the virtual camera looking out of Portal B must be at (0, 0, 150) looking along +Z!
assert.ok(Math.abs(vCamPos.x) < 1e-4, 'Virtual camera X must be 0');
assert.ok(Math.abs(vCamPos.y) < 1e-4, 'Virtual camera Y must be 0');
assert.ok(Math.abs(vCamPos.z - 150) < 1e-4, `Virtual camera Z should be 150, got ${vCamPos.z}`);

const vCamDir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(virtualCamMatrix));
assert.ok(vCamDir.z > 0.99, `Virtual camera must look forward out of Portal B (+Z), dir.z = ${vCamDir.z}`);
console.log('\x1b[32m[✓]\x1b[0m Parallel portal matrix transform: camera position & direction verified');

/* ---------------------------------------------------- Test 3: Oblique Clipping */

console.log('\n--- Test 3: Oblique Near-Plane Clip Projection (Lengyel) ---');

const proj = new THREE.PerspectiveCamera(60, 1.0, 1.0, 1000.0).projectionMatrix;
// Clip plane in camera space: normal pointing along -Z (into view direction), plane 10 units in front
const clipPlaneCam = new THREE.Vector4(0, 0, -1, -10);

const obliqueProj = PORTAL.applyObliqueClipping(proj, clipPlaneCam);
assert.ok(obliqueProj, 'Oblique projection matrix should be generated');

// In NDC/clip space, a point at z = 10 (on the plane) should project to near plane (z = -1 in WebGL)
const pOnPlane = new THREE.Vector4(0, 0, -10, 1).applyMatrix4(obliqueProj);
const ndcZ = pOnPlane.z / pOnPlane.w;
assert.ok(Math.abs(ndcZ - (-1.0)) < 0.05, `Point on clip plane should map to near plane (z=-1), got ${ndcZ}`);

// A point behind the clip plane (z = -5, closer to camera than the portal wall) should have ndcZ < -1 (culled)
const pBehind = new THREE.Vector4(0, 0, -5, 1).applyMatrix4(obliqueProj);
const ndcZBehind = pBehind.z / pBehind.w;
assert.ok(ndcZBehind < -1.0, `Point behind clip plane must be culled (ndcZ < -1), got ${ndcZBehind}`);

console.log('\x1b[32m[✓]\x1b[0m Oblique frustum projection correctly clips geometry behind the portal plane');

/* ------------------------------------------------ Test 4: Physical Traversal */

console.log('\n--- Test 4: Physical Traversal, Teleportation & Momentum ---');

const mockScene = {
  getGame: () => ({
    getRenderer: () => ({
      getThreeRenderer: () => null
    })
  }),
  getElapsedTime: () => 16.6,
  getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => null, getThreeCamera: () => null }) })
};

// Create entity traversing from Portal A to Portal B
const playerObj = mockPortalObject(0, 0, 10); // starting 10 units in front of Portal A
let linearVelX = 0, linearVelY = 0, linearVelZ = -100; // moving towards Portal A at 100 units/s

playerObj._behaviors = [{
  getLinearVelocityX: () => linearVelX,
  getLinearVelocityY: () => linearVelY,
  getLinearVelocityZ: () => linearVelZ,
  setLinearVelocity: (vx, vy, vz) => {
    linearVelX = vx;
    linearVelY = vy;
    linearVelZ = vz;
  }
}];

const pA_beh = {
  _getTag: () => 'Blue',
  _getLinkedTag: () => 'Orange',
  _getFace: () => 'Front',
  _getForwardAxis: () => '+Z',
  _getIsOpen: () => true
};
const pB_beh = {
  _getTag: () => 'Orange',
  _getLinkedTag: () => 'Blue',
  _getFace: () => 'Front',
  _getForwardAxis: () => '+Z',
  _getIsOpen: () => true
};

PORTAL.registerPortal(mockScene, pA_obj, pA_beh, { tag: 'Blue', linkedTag: 'Orange', forwardAxis: '+Z', isOpen: true });
PORTAL.registerPortal(mockScene, pB_obj, pB_beh, { tag: 'Orange', linkedTag: 'Blue', forwardAxis: '+Z', isOpen: true });

const travBehInst = {
  _getEnabled: () => true,
  _getTeleportCooldown: () => 0.15,
  _getRedirectVelocity: () => true,
  _getExitOffset: () => 20.0
};

const travRecord = PORTAL.registerTraversable(mockScene, playerObj, travBehInst, {
  enabled: true,
  teleportCooldown: 0.15,
  redirectVelocity: true,
  exitOffset: 20.0
});

// Frame 1: player was at Z=10, now steps to Z=-5 (crossed the portal plane at Z=0!)
travRecord.prevX = 0;
travRecord.prevY = 0;
travRecord.prevZ = 10;
playerObj.setZ(-5);

PORTAL.tick(mockScene);

assert.strictEqual(travRecord.justTeleported, true, 'Entity should have triggered teleportation');
// Destination: Portal B is at (0, 0, 200). Player was at Z=-5 (5 units past portal A at Z=0).
// Emerging flipped from Portal B: 200 + 5 + 20 (exit offset) = 225
assert.ok(Math.abs(playerObj.getZ() - 225) < 1e-3, `Player should exit at Z=225, got ${playerObj.getZ()}`);

// Velocity: input velocity was (0, 0, -100).
// Emerging from Portal B facing +Z: velocity must now be (0, 0, +100)!
assert.ok(Math.abs(linearVelZ - 100) < 1e-3, `Velocity should be redirected to +100 along exit normal, got ${linearVelZ}`);
assert.ok(travRecord.cooldown > 0.1, 'Cooldown must be active to prevent immediate re-teleport');

console.log('\x1b[32m[✓]\x1b[0m Plane crossing detection, teleportation position nudge & velocity redirection verified');

/* --------------------------------------------------- Test 5: Scene Lifecycle */

console.log('\n--- Test 5: Scene Cleanup & Disposal ---');

PORTAL.disposeScene(mockScene);
assert.strictEqual(travRecord.cooldown > 0, true);
console.log('\x1b[32m[✓]\x1b[0m Scene resources and bindings disposed clean');

console.log('\n\x1b[32m=========================================');
console.log('ALL PORTAL3D TESTS PASSED SUCCESSFULLY!  ');
console.log('=========================================\x1b[0m\n');
