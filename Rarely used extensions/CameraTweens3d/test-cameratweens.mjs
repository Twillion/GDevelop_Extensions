/**
 * test-cameratweens.mjs
 * Unit and integration test suite for CameraTweens3D.
 *
 * Run: node CameraTweens3d/test-cameratweens.mjs
 *
 * The THREE mock below does real quaternion and vector math, not no-ops: the camera channel's
 * capture / accumulate / restore protocol is only meaningful if composing and un-composing
 * rotations actually happens, so the regression tests for it would pass vacuously otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ THREE mock */

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    this.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    this.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    this.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    return this;
  }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

class MockEuler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
  set(x, y, z, order) {
    this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this;
  }
}

class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new MockQuaternion(this.x, this.y, this.z, this.w); }
  setFromEuler(e) {
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
    const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    if (e.order === 'YXZ') {
      this.x = s1 * c2 * c3 + c1 * s2 * s3;
      this.y = c1 * s2 * c3 - s1 * c2 * s3;
      this.z = c1 * c2 * s3 - s1 * s2 * c3;
      this.w = c1 * c2 * c3 + s1 * s2 * s3;
    } else { // XYZ
      this.x = s1 * c2 * c3 + c1 * s2 * s3;
      this.y = c1 * s2 * c3 - s1 * c2 * s3;
      this.z = c1 * c2 * s3 + s1 * s2 * c3;
      this.w = c1 * c2 * c3 - s1 * s2 * s3;
    }
    return this;
  }
  multiply(q) { return this.multiplyQuaternions(this, q); }
  multiplyQuaternions(a, b) {
    const { x: ax, y: ay, z: az, w: aw } = a;
    const { x: bx, y: by, z: bz, w: bw } = b;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  angleTo(q) {
    const d = Math.abs(this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w);
    return 2 * Math.acos(Math.min(1, d));
  }
}

class MockCamera {
  constructor(fov = 45) {
    this.position = new MockVector3();
    this.quaternion = new MockQuaternion();
    this.fov = fov;
    this.isPerspectiveCamera = true;
    this.projectionUpdates = 0;
  }
  updateProjectionMatrix() { this.projectionUpdates++; }
}

globalThis.THREE = {
  Vector3: MockVector3,
  Euler: MockEuler,
  Quaternion: MockQuaternion,
  PerspectiveCamera: MockCamera,
};

globalThis.gdjs = { registerRuntimeSceneUnloadedCallback: () => {} };

const runtimeSrc = fs.readFileSync(path.join(here, 'CameraTweens3D.runtime.js'), 'utf8');
new Function(runtimeSrc)();

const CT = globalThis.gdjs.__cameraTweens3D;
assert.ok(CT, 'CameraTweens3D runtime should be installed on gdjs.__cameraTweens3D');

/* ------------------------------------------------------------------ Harness */

let nextObjectId = 1;

function makeObject(overrides = {}) {
  const s = { x: 0, y: 0, z: 0, angle: 0 };
  return {
    s,
    id: nextObjectId++,
    getX: () => s.x,
    getY: () => s.y,
    getZ: () => s.z,
    getAngle: () => s.angle,
    getDepth: () => 0,
    _behaviors: [],
    ...overrides,
  };
}

/** A scene with one 3D layer, whose camera starts at GDevelop's real default FOV of 45. */
function makeScene(fov = 45) {
  const camera = new MockCamera(fov);
  const layer = {
    cameraRotation: 0,
    getRenderer: () => ({ getThreeCamera: () => camera }),
    getCamera3DFieldOfView: () => camera.fov,
    setCamera3DFieldOfView: (v) => { camera.fov = v; },
    getCameraRotation() { return this.cameraRotation; },
  };
  const scene = {
    dtMs: 1000 / 60,
    camera,
    layer,
    getElapsedTime() { return this.dtMs; },
    getLayer: () => layer,
  };
  return scene;
}

/** The exact option bag build-extension.mjs passes at onCreated, with untouched defaults. */
function onCreatedOptions(over = {}) {
  return {
    presetProfile: 'Tactical Military (COD / Tarkov)',
    bobProfile: 'Default for Preset',
    leanProfile: 'Default for Preset',
    landingImpactProfile: 'Default for Preset',
    breathingProfile: 'Default for Preset',
    recoilProfile: 'Default for Preset',
    shakeProfile: 'Default for Preset',
    speedRushFOVProfile: 'Default for Preset',
    baseFOV: 0,
    adsFOVTarget: 0,
    masterMotionScale: 1.0,
    masterShakeScale: 1.0,
    motionSicknessMode: 'Default for Preset',
    worldUnitsPerMeter: 100,
    walkSpeedReference: 0,
    layerName: '',
    ...over,
  };
}

function step(scene, object, behavior, frames = 1) {
  for (let i = 0; i < frames; i++) {
    CT.doStepPreEvents(scene, object, behavior);
    CT.doStepPostEvents(scene, object, behavior);
  }
}

const pass = (msg) => console.log('  ✓ ' + msg);

console.log('\n--- CameraTweens3D verification suite ---\n');

/* ------------------------------------------------------------------ 1. Noise */

console.log('1. Noise generator');
for (let t = 0; t < 100; t += 0.5) {
  const n1 = CT.noise1D(t);
  assert.ok(n1 >= -1.0 && n1 <= 1.0, `noise1D out of range [-1, 1]: ${n1}`);
  assert.ok(!isNaN(CT.noise3D(t, t * 1.5, t * 2.0)), 'noise3D returned NaN');
}
// The phase wrap in the solver relies on the lattice being exactly 256-periodic.
for (let t = 0.1; t < 5; t += 0.37) {
  assert.ok(Math.abs(CT.noise1D(t) - CT.noise1D(t + 256)) < 1e-12,
    'noise1D is not exactly periodic over 256 — the shake-time wrap would jump');
}
pass('bounded, continuous, and exactly 256-periodic');

/* ------------------------------------------------------------------ 2. Spring */

console.log('2. Critically damped spring solver');
let pos = 1.0, vel = 0.0;
for (let s = 0; s < 60; s++) {
  const r = CT.solveCriticallyDampedSpring(pos, vel, 0.0, 16.0, 0.016);
  pos = r.pos; vel = r.vel;
  assert.ok(!isNaN(pos) && !isNaN(vel), 'spring solver returned NaN');
}
assert.ok(Math.abs(pos) < 0.01, `spring did not converge: ${pos}`);
pass('stable and convergent');

/* ------------------------------------------------------------------ 3. Presets & profiles */

console.log('3. Presets and module profiles');
{
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions());
  assert.strictEqual(st.bobIntensity, 0.8, 'Tactical preset bob');
  assert.strictEqual(st.leanMaxAngle, 2.0, 'Tactical preset strafe');
  assert.strictEqual(st.sprintFOVBonus, 8.0, 'Tactical preset sprint FOV');
}
{
  // D2 regression: the untouched property defaults used to overwrite the preset here.
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions({
    presetProfile: 'Accessibility & Comfort (Zero Motion Sickness)',
    shakeProfile: 'Cinematic Heavy (1.5x)',
  }));
  assert.strictEqual(st.motionSicknessMode, true,
    'D2: the Accessibility preset must actually enable comfort mode');
  assert.strictEqual(st.shakeIntensity, 1.5,
    'D2: the ShakeProfile dropdown must survive the property pass');
  assert.strictEqual(st.masterShakeScale, 1.0,
    'D2: the master scale is the user slider and is never written by a preset');
}
{
  // D21 regression: a field zeroed by one preset must not leak into the next.
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions());
  CT.applyPreset(b, 'Accessibility & Comfort (Zero Motion Sickness)');
  assert.strictEqual(st.turnLeanAngle, 0);
  CT.applyPreset(b, 'Tactical Military (COD / Tarkov)');
  assert.strictEqual(st.turnLeanAngle, 1.5, 'D21: preset switch must reset unmentioned fields');
  assert.strictEqual(st.motionSicknessMode, false, 'D21: comfort mode must reset too');
}
pass('presets apply, survive the property pass, and reset cleanly between switches');

/* ------------------------------------------------------------------ 4. "Off" really is off */

console.log('4. "Off" profiles disable their whole module (D6)');
{
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions({
    landingImpactProfile: 'Off (Disabled)',
    leanProfile: 'Off (0° Flat)',
    recoilProfile: 'Off (Disabled)',
  }));

  assert.strictEqual(st.turnLeanAngle, 0, 'strafe Off must also kill turn banking');

  CT.triggerLandingImpact(b, 800);
  assert.strictEqual(st.landingPitchVel, 0, 'landing Off must also kill the pitch dip');
  assert.strictEqual(st.landingYVel, 0, 'landing Off must kill the compression');

  CT.applyRecoil(b, 3.0, 0.5, 0.04);
  assert.strictEqual(st.recoilPitchVel, 0, 'recoil Off must kill pitch');
  assert.strictEqual(st.recoilYawVel, 0, 'recoil Off must also kill yaw');
  assert.strictEqual(st.recoilZVel, 0, 'recoil Off must also kill kickback');
}
pass('landing, strafe and recoil switch off completely');

/* ------------------------------------------------------------------ 5. Scale and speed */

console.log('5. World-unit scale and speed ratio (D1, D9)');
{
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => true }];
  const st = CT.initialize(o, b, onCreatedOptions());

  let peakBob = 0;
  for (let f = 0; f < 240; f++) {
    o.s.x += 300 * (1 / 60); // 300 world units/s — an ordinary GDevelop walk
    step(scene, o, b);
    peakBob = Math.max(peakBob, Math.abs(CT.getHeadBobY(b)));
  }

  assert.ok(st.currentSpeedRatio > 0.5 && st.currentSpeedRatio < 1.79,
    `D9: speed ratio should track speed, not sit on its ceiling (got ${st.currentSpeedRatio})`);
  assert.ok(peakBob > 1.0,
    `D1: head bob must be visible in world units (got ${peakBob.toFixed(3)})`);
  assert.ok(peakBob < 40.0,
    `D1: head bob must not be absurd either (got ${peakBob.toFixed(3)})`);
}
pass('bob amplitude lands in world units; speed ratio is not pinned');

/* ------------------------------------------------------------------ 6. Landing */

console.log('6. Landing impact (D4, D5)');
function dropTest(fallUnitsPerSecond) {
  const scene = makeScene();
  const o = makeObject(), b = {};
  let onFloor = true;
  o._behaviors = [{ isOnFloor: () => onFloor }];
  const st = CT.initialize(o, b, onCreatedOptions());

  let triggers = 0, impulse = 0;
  for (let f = 0; f < 40; f++) {
    if (f === 3) onFloor = false;
    if (!onFloor) o.s.z -= fallUnitsPerSecond / 60;
    if (f === 15) onFloor = true; // contact frame
    const before = st.landingYVel;
    step(scene, o, b);
    // A landing is a downward step in the compression velocity; the spring's own return is
    // never anywhere near this large in one frame.
    const jump = before - st.landingYVel;
    if (jump > 1) { triggers++; impulse = Math.max(impulse, jump); }
  }
  return { triggers, impulse };
}

const slow = dropTest(300);  // ~3 m/s
const fast = dropTest(700);  // ~7 m/s, still under the compression clamp
assert.strictEqual(slow.triggers, 1, `D5: a landing must fire exactly once (got ${slow.triggers})`);
assert.strictEqual(fast.triggers, 1, `D5: a landing must fire exactly once (got ${fast.triggers})`);
assert.ok(fast.impulse > slow.impulse * 1.5,
  `D4: a harder landing must hit harder (slow ${slow.impulse.toFixed(1)} vs fast ${fast.impulse.toFixed(1)})`);
pass(`fires once per landing, and scales with fall speed (${slow.impulse.toFixed(0)} -> ${fast.impulse.toFixed(0)})`);

{
  // The same, driven by a character behavior instead of position differences.
  const scene = makeScene();
  const o = makeObject(), b = {};
  let onFloor = true, fall = 0;
  o._behaviors = [{
    isOnFloor: () => onFloor,
    getCurrentFallSpeed: () => fall,
    getCurrentForwardSpeed: () => 0,
    getCurrentSidewaysSpeed: () => 0,
    getForwardSpeedMax: () => 400,
    getSidewaysSpeedMax: () => 400,
  }];
  const st = CT.initialize(o, b, onCreatedOptions());
  step(scene, o, b, 3);
  assert.ok(st.motionSource, 'U1: a character behavior must be picked up as the motion source');
  onFloor = false; fall = 900;
  step(scene, o, b, 10);
  onFloor = true; fall = 0; // contact frame reports zero, as the real behavior does
  const before = st.landingPitchVel;
  step(scene, o, b);
  assert.ok(st.landingPitchVel - before > 5,
    'D4: the peak airborne fall speed must survive to the contact frame');
}
pass('character-behavior fall speed is used and survives the contact frame');

/* ------------------------------------------------------------------ 7. FOV */

console.log('7. Field of view (D3, D15)');
{
  const scene = makeScene(45); // GDevelop's real default
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions());
  step(scene, o, b, 5);
  assert.strictEqual(st.baseFOV, 45,
    `D3: BaseFOV=0 must inherit the layer FOV, not force 75 (got ${st.baseFOV})`);
  assert.ok(Math.abs(scene.camera.fov - 45) < 0.01,
    `D3: adding the behavior must not change the rendered FOV (got ${scene.camera.fov})`);
}
{
  const scene = makeScene(45);
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions({ baseFOV: 80, adsFOVTarget: 40 }));
  step(scene, o, b, 3);
  assert.strictEqual(st.baseFOV, 80, 'an explicit BaseFOV must win over the layer');

  CT.tweenFOV(b, 100, 0.2);
  step(scene, o, b, 30);
  assert.ok(Math.abs(st.currentFOV - 100) < 1.0, `tween should reach its target (got ${st.currentFOV})`);
  assert.strictEqual(st.baseFOV, 80, 'D15: a tween must not overwrite the resting FOV');

  CT.releaseFOVTween(b, 0.2);
  step(scene, o, b, 40);
  assert.ok(Math.abs(st.currentFOV - 80) < 1.0,
    `D15: releasing a tween must return to the resting FOV (got ${st.currentFOV})`);
}
pass('inherits the layer FOV, and tweens are reversible');

/* ------------------------------------------------------------------ 8. Camera channel */

console.log('8. Camera restore integrity (D7, D8, D13)');
{
  // One contributor: apply then release must return the camera exactly.
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => true }];
  CT.initialize(o, b, onCreatedOptions());
  CT.addTrauma(b, 1.0);
  o.s.x += 5;
  step(scene, o, b, 3);

  const restPos = new MockVector3(scene.camera.position.x, scene.camera.position.y, scene.camera.position.z);
  CT.doStepPostEvents(scene, o, b);
  assert.ok(scene.camera.position.distanceTo(restPos) > 1e-9, 'the shake should have moved the camera');
  CT.doStepPreEvents(scene, o, b);
  assert.ok(scene.camera.position.distanceTo(new MockVector3(0, 0, 0)) < 1e-9,
    'release must return the camera to its base position');
  assert.ok(scene.camera.quaternion.angleTo(new MockQuaternion()) < 1e-9,
    'release must return the camera to its base rotation');
  assert.ok(Math.abs(scene.camera.fov - 45) < 1e-9, 'release must return the camera FOV');
}
{
  // D8: two behaviors on one layer. Rotation restore used to be a right-multiply by the
  // inverse, which only cancels for the last delta applied — so A's undo corrupted B's.
  const scene = makeScene();
  const oA = makeObject(), bA = {};
  const oB = makeObject(), bB = {};
  oA._behaviors = [{ isOnFloor: () => true }];
  oB._behaviors = [{ isOnFloor: () => true }];
  CT.initialize(oA, bA, onCreatedOptions());
  CT.initialize(oB, bB, onCreatedOptions());
  CT.addTrauma(bA, 1.0);
  CT.addTrauma(bB, 0.8);

  for (let f = 0; f < 5; f++) {
    CT.doStepPreEvents(scene, oA, bA);
    CT.doStepPreEvents(scene, oB, bB);
    CT.doStepPostEvents(scene, oA, bA);
    CT.doStepPostEvents(scene, oB, bB);
  }
  CT.doStepPreEvents(scene, oA, bA);
  CT.doStepPreEvents(scene, oB, bB);

  assert.ok(scene.camera.position.distanceTo(new MockVector3(0, 0, 0)) < 1e-9,
    `D8: two contributors must still restore the position exactly (off by ${scene.camera.position.distanceTo(new MockVector3(0, 0, 0))})`);
  assert.ok(scene.camera.quaternion.angleTo(new MockQuaternion()) < 1e-9,
    `D8: two contributors must still restore the rotation exactly (off by ${scene.camera.quaternion.angleTo(new MockQuaternion())} rad)`);
  assert.ok(Math.abs(scene.camera.fov - 45) < 1e-6, 'D8: two contributors must restore the FOV');
}
{
  // D7: something else re-bases the camera between apply and release. The stale delta must not
  // be subtracted out of a transform it was never added to.
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => true }];
  CT.initialize(o, b, onCreatedOptions());
  CT.addTrauma(b, 1.0);
  step(scene, o, b, 2);
  CT.doStepPostEvents(scene, o, b);

  // Simulate a later behavior calling layer.setCameraX(), which writes absolutely.
  scene.camera.position.set(500, -250, 700);
  CT.doStepPreEvents(scene, o, b);
  assert.ok(scene.camera.position.distanceTo(new MockVector3(500, -250, 700)) < 1e-9,
    'D7: an externally re-based camera must be left alone, not drifted by a stale delta');
}
{
  // D13: deactivating must hand the camera back.
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => true }];
  CT.initialize(o, b, onCreatedOptions());
  CT.addTrauma(b, 1.0);
  step(scene, o, b, 2);
  CT.doStepPostEvents(scene, o, b);
  assert.ok(scene.camera.position.distanceTo(new MockVector3(0, 0, 0)) > 1e-9, 'precondition: camera offset');
  CT.onDeActivate(scene, o, b);
  assert.ok(scene.camera.position.distanceTo(new MockVector3(0, 0, 0)) < 1e-9,
    'D13: onDeActivate must release the camera');
}
pass('single, dual and externally-rebased cameras all restore correctly');

/* ------------------------------------------------------------------ 9. Trauma, recoil, expressions */

console.log('9. Trauma, recoil and expression fidelity');
{
  const scene = makeScene();
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions());
  CT.addTrauma(b, 0.8);
  assert.ok(Math.abs(CT.getTraumaLevel(b) - 0.8) < 1e-9);
  assert.strictEqual(CT.isTraumaShakeActive(b), true);
  scene.dtMs = 500;
  step(scene, o, b);
  assert.ok(st.trauma < 0.8, 'trauma must decay');
  CT.stopAllShakes(b);
  assert.strictEqual(CT.isTraumaShakeActive(b), false);

  scene.dtMs = 1000 / 60;
  CT.applyRecoil(b, 4.0, 1.0, 0.05);
  assert.ok(st.recoilPitchVel > 0, 'recoil must inject velocity');
  step(scene, o, b, 40);
  assert.ok(Math.abs(st.recoilPitch) < 0.5, 'recoil must settle back');

  // D18: a yaw-only recoil used to read as inactive.
  st.recoilPitch = 0; st.recoilYaw = 2.0; st.recoilZ = 0;
  assert.strictEqual(CT.isRecoilActive(b), true, 'D18: yaw-only recoil must count as active');
}
{
  // D17: the expressions must report what was applied, damping included.
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => false }]; // airborne: bob is damped to zero
  const st = CT.initialize(o, b, onCreatedOptions());
  for (let f = 0; f < 30; f++) { o.s.x += 300 / 60; step(scene, o, b); }
  assert.strictEqual(CT.getHeadBobY(b), 0,
    'D17: HeadBobY must report the damped, applied value — not a raw recomputation');
  assert.ok(st.currentSpeedRatio > 0, 'precondition: the object is genuinely moving');
}
pass('trauma decays, recoil settles, expressions match the camera');

/* ------------------------------------------------------------------ 10. Comfort mode */

console.log('10. Comfort mode');
{
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions({ motionSicknessMode: 'On' }));
  assert.strictEqual(st.motionSicknessMode, true, 'explicit On must win');
}
{
  const o = makeObject(), b = {};
  const st = CT.initialize(o, b, onCreatedOptions({
    presetProfile: 'Accessibility & Comfort (Zero Motion Sickness)',
    motionSicknessMode: 'Off',
  }));
  assert.strictEqual(st.motionSicknessMode, false, 'explicit Off must override the preset');
}
{
  const scene = makeScene();
  const o = makeObject(), b = {};
  o._behaviors = [{ isOnFloor: () => true }];
  const st = CT.initialize(o, b, onCreatedOptions({ motionSicknessMode: 'On' }));
  for (let f = 0; f < 60; f++) { o.s.x += 300 / 60; step(scene, o, b); }
  assert.strictEqual(CT.getHeadBobX(b), 0,
    'comfort mode must flatten horizontal sway, as the docs claim');
  assert.strictEqual(st.leanRollCurrent, 0, 'comfort mode must hold the horizon flat');
}
pass('choice semantics hold, and comfort mode flattens sway and roll');

/* ------------------------------------------------------------------ 11. Generated JSON */

console.log('11. Generated CameraTweens3D.json');
const extensionJson = JSON.parse(fs.readFileSync(path.join(here, 'CameraTweens3D.json'), 'utf8'));
assert.strictEqual(extensionJson.name, 'CameraTweens3D');
assert.strictEqual(extensionJson.eventsBasedBehaviors.length, 1);

const behDef = extensionJson.eventsBasedBehaviors[0];
const props = behDef.propertyDescriptors;
assert.strictEqual(props.length, 16, `expected 16 properties, found ${props.length}`);
for (const p of props) {
  assert.ok(p.group, `property ${p.name} has no editor group`);
}
const choiceProps = props.filter((p) => p.type === 'Choice');
assert.strictEqual(choiceProps.length, 9, `expected 9 Choice dropdowns, found ${choiceProps.length}`);
for (const cp of choiceProps) {
  assert.ok(Array.isArray(cp.extraInformation), `Choice ${cp.name} missing extraInformation`);
  assert.ok(cp.extraInformation.length >= 4, `Choice ${cp.name} has fewer than 4 options`);
}

const baseFOVProp = props.find((p) => p.name === 'BaseFOV');
assert.strictEqual(baseFOVProp.value, '0', 'D3: BaseFOV must default to "inherit the layer"');

const lifecycleNames = behDef.eventsFunctions.filter((f) => f.private).map((f) => f.name).sort();
assert.deepStrictEqual(lifecycleNames,
  ['doStepPostEvents', 'doStepPreEvents', 'onActivate', 'onCreated', 'onDeActivate', 'onDestroy'],
  'D13: activate/deactivate hooks must be wired');

// D19: the runtime is embedded exactly twice, and never inside a per-frame hook.
const marker = 'Procedural Camera Motion, Shakes';
const allBlocks = [
  ...extensionJson.eventsFunctions.flatMap((f) => f.events.map((e) => ({ name: 'ext.' + f.name, code: e.inlineCode }))),
  ...behDef.eventsFunctions.flatMap((f) => f.events.map((e) => ({ name: f.name, code: e.inlineCode }))),
];
const withRuntime = allBlocks.filter((b) => b.code.includes(marker)).map((b) => b.name).sort();
assert.deepStrictEqual(withRuntime, ['ext.onFirstSceneLoaded', 'onCreated'],
  `D19: runtime should be embedded only in onFirstSceneLoaded and onCreated (found in ${withRuntime.join(', ')})`);

// D22: a `behavior` parameter with no supplementaryInformation makes the code generator emit
// `getBehavior("")`, which returns undefined — so every ACE throws on its first call while the
// lifecycle hooks keep working. This is the one defect a "does the behavior run?" check misses.
const behaviorType = `${extensionJson.name}::${behDef.name}`;
for (const f of behDef.eventsFunctions) {
  assert.strictEqual(f.parameters[0]?.type, 'object', `${f.name}: first parameter must be the object`);
  assert.strictEqual(f.parameters[1]?.type, 'behavior', `${f.name}: second parameter must be the behavior`);
  assert.strictEqual(f.parameters[1].supplementaryInformation, behaviorType,
    `D22: ${f.name} behavior parameter must be bound to "${behaviorType}", ` +
    `or GDevelop generates getBehavior("") and the action throws`);
}

const actionsList = behDef.eventsFunctions.filter((f) => f.functionType === 'Action' && !f.private);
const conditionsList = behDef.eventsFunctions.filter((f) => f.functionType === 'Condition');
const expressionsList = behDef.eventsFunctions.filter((f) => f.functionType === 'Expression');
assert.strictEqual(actionsList.length, 35, `expected 35 actions, found ${actionsList.length}`);
assert.strictEqual(conditionsList.length, 7, `expected 7 conditions, found ${conditionsList.length}`);
assert.strictEqual(expressionsList.length, 17, `expected 17 expressions, found ${expressionsList.length}`);

// Every action/condition/expression must reach a function that actually exists on the runtime.
for (const f of [...actionsList, ...conditionsList, ...expressionsList]) {
  for (const e of f.events) {
    const calls = e.inlineCode.match(/CT\.([A-Za-z0-9_]+)\(/g) || [];
    for (const call of calls) {
      const name = call.slice(3, -1);
      assert.ok(typeof CT[name] === 'function',
        `${f.name} calls CT.${name}(), which the runtime does not export`);
    }
  }
}
pass('schema, groups, lifecycle hooks, embed count and every ACE binding check out');

console.log('\n========================================');
console.log(' ALL 11 VERIFICATION PHASES PASSED');
console.log('========================================\n');
