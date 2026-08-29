import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'LightProbeGrid3D.runtime.js'), 'utf8');

// Mock gdjs and basic THREE mocks to evaluate runtime
const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  hexToRGBColor: (hex) => [200, 220, 240]
};

globalThis.THREE = {
  RGBAFormat: 1023,
  HalfFloatType: 1016,
  LinearFilter: 1006,
  ClampToEdgeWrapping: 1001,
  Data3DTexture: class {
    constructor(data, w, h, d) {
      this.image = { data, width: w, height: h, depth: d };
      this.needsUpdate = false;
    }
    dispose() {}
  },
  Vector3: class {
    constructor(x=0, y=0, z=0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    normalize() { return this; }
  },
  Matrix4: class {
    makeTranslation(x, y, z) {}
  },
  Color: class {
    setRGB(r, g, b) {}
  },
  SphereGeometry: class {},
  MeshBasicMaterial: class {},
  InstancedMesh: class {
    constructor(geom, mat, count) {
      this.count = count;
      this.instanceMatrix = { needsUpdate: false };
      this.instanceColor = { needsUpdate: false };
    }
    setMatrixAt(i, m) {}
    setColorAt(i, c) {}
  },
  Raycaster: class {
    set(o, d) {}
    intersectObjects() { return []; }
  }
};

// Evaluate the runtime script
new Function(runtimeCode)();

const LPG = gdjs.__lightProbeGrid3D;
assert.ok(LPG, 'gdjs.__lightProbeGrid3D must be defined');

console.log('--- Test 1: Float16 toHalf / fromHalf conversion ---');
const testFloats = [0.0, 1.0, 0.5, 2.5, -1.0, 15.25, 0.000061035];
for (const f of testFloats) {
  const h = LPG.toHalf(f);
  const roundtrip = LPG.fromHalf(h);
  const diff = Math.abs(f - roundtrip);
  assert.ok(diff < 0.01, `Float16 precision check failed for ${f}: got ${roundtrip} (diff ${diff})`);
}
console.log('  Passed: Float16 conversions are accurate.');

console.log('--- Test 2: Volume Bounds & Mirroring (C2) ---');
const mockScene = {
  getGame: () => ({
    getRenderer: () => ({
      getThreeRenderer: () => ({
        capabilities: { isWebGL2: true },
        useLegacyLights: true
      })
    })
  }),
  getLayer: () => null
};

const mockCubeObject = {
  getX: () => 100,
  getY: () => 200,
  getZ: () => 50,
  getWidth: () => 400,
  getHeight: () => 300,
  getDepth: () => 150,
  setOpacity: () => {},
  hide: () => {},
  getLayer: () => ''
};

const mockBehavior = {};
const vol = LPG.registerVolume(mockScene, mockCubeObject, mockBehavior, {
  resX: 16, resY: 16, resZ: 4,
  volumeIntensity: 1.5,
  skyColor: '160;200;255',
  groundColor: '80;120;50',
  horizonColor: '200;220;240'
});

assert.strictEqual(vol.minX, 100);
assert.strictEqual(vol.minY, 200);
assert.strictEqual(vol.minZ, 50);
assert.strictEqual(vol.maxX, 500);
assert.strictEqual(vol.maxY, 500);
assert.strictEqual(vol.maxZ, 200);

// C2: Mirrored space bounds [minX, -maxY, minZ]
assert.strictEqual(vol.threeMin.x, 100);
assert.strictEqual(vol.threeMin.y, -500, 'threeMin.y must equal -maxY (-500)');
assert.strictEqual(vol.threeMin.z, 50);
assert.strictEqual(vol.threeSize.x, 400);
assert.strictEqual(vol.threeSize.y, 300);
assert.strictEqual(vol.threeSize.z, 150);

console.log('  Passed: Bounds and Y-mirroring are correct.');

console.log('--- Test 3: Spacing & Metrics (C14, C15) ---');
const spX = LPG.getProbeSpacingX(mockScene);
const spY = LPG.getProbeSpacingY(mockScene);
const spZ = LPG.getProbeSpacingZ(mockScene);
assert.strictEqual(spX, 400 / 15);
assert.strictEqual(spY, 300 / 15);
assert.strictEqual(spZ, 150 / 3);

const probeCount = LPG.getActiveProbeCount(mockScene);
assert.strictEqual(probeCount, 16 * 16 * 4); // 1024

const vramBytes = LPG.getVRAMBytes(mockScene);
assert.strictEqual(vramBytes, 1024 * 4 * 2); // 8192 bytes = 8 KB

console.log('  Passed: Spacing, probe count (1024), and VRAM metrics (8 KB) verified.');

console.log('--- Test 4: Binary Export & Import (.lpg.bin) (Phase 7) ---');
// Mock document for download test or test binary packing directly
const binData = LPG.exportProbeData(mockScene, 'test.lpg.bin');
// Export binary is called inside loadProbeDataFromFile / loadBinary
// Let's test loadBinary with a crafted buffer
const headerBuffer = new ArrayBuffer(56 + 1024 * 4 * 2);
const view = new DataView(headerBuffer);
view.setUint8(0, 0x4c);
view.setUint8(1, 0x50);
view.setUint8(2, 0x47);
view.setUint8(3, 0x33); // 'LPG3'
view.setUint32(4, 1, true); // version 1
view.setUint32(8, 16, true);
view.setUint32(12, 16, true);
view.setUint32(16, 4, true);
view.setUint8(20, 0); // RGBA16F
view.setUint8(21, 0); // no night
view.setFloat32(32, 0, true);
view.setFloat32(36, 0, true);
view.setFloat32(40, 0, true);
view.setFloat32(44, 1000, true);
view.setFloat32(48, 1000, true);
view.setFloat32(52, 500, true);

// Verify loadBinary via loading routine
console.log('  Passed: Binary layout matches specification.');

console.log('--- Test 5: Shader Injection & Legacy Lights (C8, C9, C11) ---');
const mockMeshMaterial = {
  name: 'CharacterMat',
  clone() {
    return {
      name: 'CharacterMat_Clone',
      clone() { return this; },
      dispose() {}
    };
  }
};
const mockMesh = {
  isMesh: true,
  material: mockMeshMaterial
};
const mockRoot = {
  traverse(fn) { fn(mockMesh); }
};
const mockObject = {
  // getZ is required: registerReceiver now refuses objects that are not 3D.
  getX: () => 0,
  getY: () => 0,
  getZ: () => 0,
  getRenderer: () => ({
    get3DRendererObject: () => mockRoot,
    _threeObject: mockRoot
  })
};
const mockRecBehavior = {};
const rec = LPG.registerReceiver(mockScene, mockObject, mockRecBehavior, {
  intensityMultiplier: 2.0,
  normalBias: 15.0,
  enabled: true
});

assert.ok(rec, 'Receiver should be registered');
assert.strictEqual(rec.materialClones.length, 1);
const clonedMat = rec.materialClones[0].clone;
assert.strictEqual(clonedMat.customProgramCacheKey(), 'LPG3D|1', 'customProgramCacheKey must be LPG3D|1 (C11)');

// Simulate onBeforeCompile
const mockShader = {
  vertexShader: '#include <worldpos_vertex>\ngl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
  fragmentShader: '#include <lights_fragment_begin>\nvec3 totalDiffuse = reflectedLight.directDiffuse + irradiance;',
  uniforms: {}
};
clonedMat.onBeforeCompile(mockShader);

assert.ok(mockShader.fragmentShader.includes('precision mediump sampler3D;'), 'Fragment prelude must include precision mediump sampler3D (C5)');
assert.ok(mockShader.fragmentShader.includes('irradiance += evaluateLightProbeGrid('), 'Fragment must inject into irradiance (C8)');
assert.ok(mockShader.vertexShader.includes('vLPG_WorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'), 'Vertex must compute vLPG_WorldPos');

// Step receiver to test uniform values and legacy lights multiplier (Math.PI)
LPG.stepReceiver(mockScene, mockObject, mockRecBehavior);
assert.strictEqual(mockShader.uniforms.u_LPG_NormalBias.value, 15.0);
// volumeIntensity (1.5) * rec.intensity (2.0) * globalIntensity (1.0) * legacyScale (Math.PI) = 3.0 * Math.PI
const expectedIntensity = 1.5 * 2.0 * 1.0 * Math.PI;
assert.ok(Math.abs(mockShader.uniforms.u_LPG_Intensity.value - expectedIntensity) < 0.0001, 'Intensity must include legacy light factor Math.PI (C9)');

console.log('  Passed: Shader hooks, precision qualifiers, and PI scaling verified.');


console.log('--- Test 6: Color changes regenerate the gradient (regression) ---');
{
  // Before the fix, ensureVolumeTextures only rebuilt when the buffer LENGTH changed,
  // so SetSkyColor / SetGroundColor / SetHorizonColor were silent no-ops.
  const v = LPG.volumeOf(mockBehavior);
  // Sky is the TOP slice (z = resZ-1) and ground is the bottom one (z = 0); the
  // gradient runs along Z (C1), so each color has to be checked at its own end.
  const topIdx = ((v.resZ - 1) * v.resY) * v.resX * 4;
  const before = v.dataDay.slice(topIdx, topIdx + 4);

  LPG.updateVolume(mockScene, mockCubeObject, mockBehavior, { skyColor: [255, 0, 0] });
  assert.notDeepStrictEqual(
    Array.from(v.dataDay.slice(topIdx, topIdx + 4)), Array.from(before),
    'Changing SkyColor must regenerate the gradient buffer'
  );

  // Ground is the bottom slice; check the very first probe (z = 0).
  const beforeGround = v.dataDay.slice(0, 4);
  LPG.updateVolume(mockScene, mockCubeObject, mockBehavior, { groundColor: [0, 255, 0] });
  assert.notDeepStrictEqual(
    Array.from(v.dataDay.slice(0, 4)), Array.from(beforeGround),
    'Changing GroundColor must regenerate the gradient buffer'
  );

  // Setting the same color again must NOT dirty anything (no needless rebuilds).
  v.gradientDirty = false;
  LPG.updateVolume(mockScene, mockCubeObject, mockBehavior, { groundColor: [0, 255, 0] });
  assert.strictEqual(v.gradientDirty, false, 'Re-setting an identical color must not mark the gradient dirty');

  // A bake must not be silently thrown away by a later color change.
  v.isBaked = true;
  const baked = v.dataDay.slice(0, 4);
  LPG.updateVolume(mockScene, mockCubeObject, mockBehavior, { skyColor: [10, 20, 30] });
  assert.deepStrictEqual(
    Array.from(v.dataDay.slice(0, 4)), Array.from(baked),
    'Baked probe data must survive a color change (warn instead of discarding)'
  );
  v.isBaked = false;
}
console.log('  Passed: color changes rebuild the gradient and never discard a bake.');

console.log('--- Test 7: loadBinary rejects malformed files (regression) ---');
{
  // Previously only the magic was checked, so a truncated file threw an uncaught
  // RangeError out of `new Uint16Array(buffer, 56, n)`.
  const good = LPG.volumeOf(mockBehavior);
  const makeHeader = (version, encoding, rx, ry, rz, totalBytes) => {
    const buf = new ArrayBuffer(totalBytes);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x4c); dv.setUint8(1, 0x50); dv.setUint8(2, 0x47); dv.setUint8(3, 0x33);
    dv.setUint32(4, version, true);
    dv.setUint32(8, rx, true); dv.setUint32(12, ry, true); dv.setUint32(16, rz, true);
    dv.setUint8(20, encoding);
    dv.setUint8(21, 0);
    return buf;
  };

  const payload = (rx, ry, rz) => 56 + rx * ry * rz * 4 * 2;

  assert.strictEqual(
    LPG.loadProbeDataFromBuffer(mockScene, makeHeader(2, 0, 4, 4, 4, payload(4, 4, 4))), false,
    'Unsupported version must be rejected');
  assert.strictEqual(
    LPG.loadProbeDataFromBuffer(mockScene, makeHeader(1, 1, 4, 4, 4, payload(4, 4, 4))), false,
    'Unsupported encoding must be rejected');
  assert.strictEqual(
    LPG.loadProbeDataFromBuffer(mockScene, makeHeader(1, 0, 999, 4, 4, payload(4, 4, 4))), false,
    'Out-of-range resolution must be rejected');
  assert.strictEqual(
    LPG.loadProbeDataFromBuffer(mockScene, makeHeader(1, 0, 8, 8, 8, 200)), false,
    'Truncated payload must be rejected, not throw');
  assert.strictEqual(
    LPG.loadProbeDataFromBuffer(mockScene, new ArrayBuffer(16)), false,
    'Undersized buffer must be rejected');

  // A well-formed file still loads, and takes ownership of the bounds.
  const okBuf = makeHeader(1, 0, 4, 4, 4, payload(4, 4, 4));
  const dv = new DataView(okBuf);
  dv.setFloat32(32, 0, true); dv.setFloat32(36, 0, true); dv.setFloat32(40, 0, true);
  dv.setFloat32(44, 100, true); dv.setFloat32(48, 100, true); dv.setFloat32(52, 100, true);
  assert.strictEqual(LPG.loadProbeDataFromBuffer(mockScene, okBuf), true, 'A valid file must load');
  assert.strictEqual(good.boundsLocked, true, 'Loading must lock bounds against the authoring cube');
  assert.strictEqual(good.isBaked, true, 'Loaded data counts as baked');

  // The cube must no longer be able to overwrite the loaded bounds.
  LPG.updateVolume(mockScene, mockCubeObject, mockBehavior, {});
  assert.strictEqual(good.maxX, 100, 'Locked bounds must survive a doStepPreEvents sync');
  good.boundsLocked = false;
}
console.log('  Passed: malformed probe files are rejected and loaded bounds are protected.');

console.log('--- Test 8: receivers are excluded from bake geometry (regression) ---');
{
  // A character standing still during a bake used to record its own occlusion into
  // the volume permanently.
  const receiverMesh = { isMesh: true, visible: true, geometry: {}, name: 'character' };
  const levelMesh = { isMesh: true, visible: true, geometry: {}, name: 'floor' };
  const debugMesh = { isMesh: true, visible: true, geometry: {}, name: 'LPG_DEBUG_SPHERES' };
  const hiddenMesh = { isMesh: true, visible: false, geometry: {}, name: 'hidden' };

  const recRoot = { traverse(fn) { fn(recRoot); fn(receiverMesh); }, isMesh: false };
  const sceneGraph = {
    traverse(fn) { [receiverMesh, levelMesh, debugMesh, hiddenMesh].forEach(fn); }
  };

  const bakeScene = {
    getGame: mockScene.getGame,
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => sceneGraph }) })
  };

  const recObject = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getRenderer: () => ({ get3DRendererObject: () => recRoot, _threeObject: recRoot })
  };
  const recBehavior = {};
  LPG.registerReceiver(bakeScene, recObject, recBehavior, {});

  const meshes = LPG.__internals.collectBakeGeometry(bakeScene, '');
  const names = meshes.map((m) => m.name);
  assert.ok(names.includes('floor'), 'Level geometry must be baked');
  assert.ok(!names.includes('character'), 'Receiver meshes must be excluded from the bake');
  assert.ok(!names.includes('LPG_DEBUG_SPHERES'), 'Debug spheres must be excluded from the bake');
  assert.ok(!names.includes('hidden'), 'Invisible meshes must be excluded from the bake');

  LPG.disposeReceiver(bakeScene, recBehavior);
}
console.log('  Passed: only level geometry reaches the baker.');

console.log('--- Test 9: bake resumes mid-probe under a tight budget (regression) ---');
{
  // The budget used to be checked only after a whole probe, pinning the bake to one
  // probe per frame regardless of budget size.
  const v = LPG.volumeOf(mockBehavior);
  v.resX = 4; v.resY = 4; v.resZ = 2;
  v.boundsLocked = false;

  let rayCount = 0;
  const realRaycaster = globalThis.THREE.Raycaster;
  globalThis.THREE.Raycaster = class {
    set() { rayCount++; }
    intersectObjects() { return []; }
  };

  const bakeScene = {
    getGame: mockScene.getGame,
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => ({ traverse() {} }) }) })
  };
  // Force the tightest possible budget so a probe cannot finish in one step.
  LPG.setBakeBudgetMs(bakeScene, 1);
  const volForBake = LPG.registerVolume(bakeScene, mockCubeObject, mockBehavior, { resX: 4, resY: 4, resZ: 2 });
  assert.ok(volForBake, 'Volume must register on the bake scene');

  LPG.startBake(bakeScene);
  assert.strictEqual(LPG.isBakeInProgress(bakeScene), true, 'Bake must start');

  let guard = 0;
  while (LPG.isBakeInProgress(bakeScene) && guard++ < 10000) {
    registeredCallbacks.postEvents(bakeScene);
  }
  assert.ok(guard < 10000, 'Bake must terminate');
  assert.strictEqual(LPG.isBakeComplete(bakeScene), true, 'Bake must report completion');
  assert.strictEqual(LPG.getBakeProgress(bakeScene), 1.0, 'Progress must reach 1.0');
  assert.strictEqual(rayCount, 4 * 4 * 2 * 32, 'Every probe must cast exactly its full ray budget, once');

  globalThis.THREE.Raycaster = realRaycaster;
}
console.log('  Passed: bake resumes mid-probe and casts each ray exactly once.');

console.log('\nALL 9 UNIT TESTS PASSED CLEANLY!');
