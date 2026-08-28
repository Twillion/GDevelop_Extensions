import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'ClusteredLightManager3D.runtime.js'), 'utf8');

// Mock gdjs and Three.js environment
const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  hexToRGBColor: (hex) => [255, 180, 100]
};

globalThis.THREE = {
  RGBAFormat: 1023,
  FloatType: 1015,
  UnsignedShortType: 1012,
  NearestFilter: 1003,
  ClampToEdgeWrapping: 1001,
  RGIntegerFormat: 1030,
  RedIntegerFormat: 1028,
  Vector2: class {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
  },
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    applyMatrix4(m) { return this; }
    transformDirection(m) { return this; }
    normalize() { return this; }
  },
  Matrix4: class {
    constructor() { this.elements = new Float32Array(16); }
    identity() { return this; }
  },
  Group: class {
    constructor() { this.children = []; }
    add(obj) { this.children.push(obj); }
    remove(obj) { }
  },
  SphereGeometry: class {},
  MeshBasicMaterial: class {},
  Mesh: class {
    constructor(g, m) { this.geometry = g; this.material = m; }
  },
  DataTexture: class {
    constructor(data, w, h, format, type) {
      this.image = { data, width: w, height: h };
      this.format = format;
      this.type = type;
      this.needsUpdate = false;
    }
    dispose() {}
  },
  Data3DTexture: class {
    constructor(data, w, h, d) {
      this.image = { data, width: w, height: h, depth: d };
      this.needsUpdate = false;
    }
    dispose() {}
  }
};

// Evaluate the runtime script
new Function(runtimeCode)();

const CLM = gdjs.__clusteredLightManager3D;
assert.ok(CLM, 'gdjs.__clusteredLightManager3D must be defined');

console.log('--- Test 1: Blackbody Kelvin to sRGB Color Conversions ---');
const kelvinSamples = [
  { k: 1800, expectedHex: 'warm amber/candle' },
  { k: 2200, expectedHex: 'torch/fireplace' },
  { k: 2800, expectedHex: 'incandescent bulb' },
  { k: 5500, expectedHex: 'crisp daylight' },
  { k: 6500, expectedHex: 'cool overcast' },
  { k: 8500, expectedHex: 'moonlight/blue sky' }
];

for (const sample of kelvinSamples) {
  const rgb = CLM.kelvinToRGB(sample.k);
  assert.ok(Array.isArray(rgb) && rgb.length === 3, `kelvinToRGB(${sample.k}) must return [r, g, b]`);
  assert.ok(rgb[0] >= 0.0 && rgb[0] <= 1.0, `Red component ${rgb[0]} must be within [0, 1]`);
  assert.ok(rgb[1] >= 0.0 && rgb[1] <= 1.0, `Green component ${rgb[1]} must be within [0, 1]`);
  assert.ok(rgb[2] >= 0.0 && rgb[2] <= 1.0, `Blue component ${rgb[2]} must be within [0, 1]`);

  // Warm lights should have R > B
  if (sample.k <= 4000) {
    assert.ok(rgb[0] >= rgb[2], `Warm light (${sample.k}K) should have R >= B, got R=${rgb[0]}, B=${rgb[2]}`);
  }
  // Cool lights should have higher blue ratio
  if (sample.k >= 6500) {
    assert.ok(rgb[2] > 0.8, `Cool light (${sample.k}K) should have high blue, got B=${rgb[2]}`);
  }
  console.log(`  Passed: ${sample.k}K -> RGB(${rgb.map(v => v.toFixed(3)).join(', ')}) [${sample.expectedHex}]`);
}

console.log('\n--- Test 2: Arvo Sphere-to-AABB Distance Squared ---');
// Test inside box
const dInside = CLM.arvoDistanceSq(0, 0, 0, 10, 10, 10, 5, 5, 5);
assert.strictEqual(dInside, 0.0, 'Point inside AABB must have distance 0');

// Test point at (13, 5, 5) -> distance to maxX (10) is 3, distSq = 9
const dOutsideX = CLM.arvoDistanceSq(0, 0, 0, 10, 10, 10, 13, 5, 5);
assert.strictEqual(dOutsideX, 9.0, 'Point offset by 3 on X must have d^2 = 9');

// Test diagonal offset (13, 14, 5) -> dx=3, dy=4 -> distSq = 9 + 16 = 25
const dDiag = CLM.arvoDistanceSq(0, 0, 0, 10, 10, 10, 13, 14, 5);
assert.strictEqual(dDiag, 25.0, 'Diagonal point (3, 4, 0) must have d^2 = 25');
console.log('  Passed: Arvo squared distance metrics are exact.');

console.log('\n--- Test 3: Procedural Flicker Waveforms & Muzzle Flash ---');
const baseInt = 2.0;

// Fire flicker
const fireInt = CLM.evaluateFlicker('FireFlicker', 1.5, 8.0, 0.25, baseInt);
assert.ok(fireInt > 0.0, 'Fire flicker intensity must be positive');
assert.ok(Math.abs(fireInt - baseInt) <= baseInt * 0.35, 'Fire variation must stay within reasonable bounds');

// Pulse wave
const pulseInt = CLM.evaluateFlicker('PulseWave', 0.0, 8.0, 0.5, baseInt);
assert.strictEqual(pulseInt, baseInt, 'PulseWave at t=0 has sin(0)=0 -> factor 1.0');

// None pattern
const noneInt = CLM.evaluateFlicker('None', 2.0, 8.0, 0.5, baseInt);
assert.strictEqual(noneInt, baseInt, 'Flicker mode "None" must return unmodified base intensity');

console.log('  Passed: Procedural waveforms and modulation validated.');

console.log('\n--- Test 4: Scene Manager, Light Lifecycle & Diagnostics ---');
const mockScene = {
  getGame: () => ({
    getRenderer: () => ({
      getThreeRenderer: () => ({
        capabilities: { isWebGL2: true },
        useLegacyLights: true,
        getSize: (target) => target.set(1920, 1080)
      })
    })
  }),
  getLayer: () => ({
    getRenderer: () => ({
      getThreeCamera: () => ({
        fov: 60,
        aspect: 16 / 9,
        near: 0.1,
        far: 1000.0,
        matrixWorldInverse: new THREE.Matrix4()
      }),
      getThreeScene: () => ({
        add: () => {},
        remove: () => {},
        traverse: () => {}
      })
    })
  }),
  getElapsedTime: () => 16.6,
  getTimeManager: () => ({
    getTimeFromStart: () => 1000
  })
};

// Register manager
const mgrState = CLM.registerSceneManager(mockScene, {
  maxLights: 256,
  enableVolumetricFog: true,
  volumetricFogDensity: 0.03,
  volumetricAnisotropy: 0.5,
  enableContactShadows: true,
  globalIntensityScale: 1.2
});

assert.ok(mgrState, 'Manager state must be initialized');
assert.strictEqual(mgrState.maxLights, 256);
assert.strictEqual(mgrState.enableVolumetricFog, true);
assert.strictEqual(mgrState.volumetricFogDensity, 0.03);

// Verify VRAM and Cluster Count expressions
const totalClusters = CLM.getTotalClusterCount(mockScene);
assert.strictEqual(totalClusters, 3456, 'Total clusters must equal 16 x 9 x 24 = 3456');

const vramBytes = CLM.getClusterVRAMBytes(mockScene);
assert.ok(vramBytes > 0 && vramBytes < 200000, `VRAM footprint should be < 200 KB (got ${vramBytes} bytes)`);

// Register dynamic lights
const mockObj1 = {
  getX: () => 0,
  getY: () => 0,
  getZ: () => 10,
  get3DRendererObject: () => null
};
const mockBehavior1 = {};
const light1 = CLM.registerLight(mockScene, mockObj1, mockBehavior1, {
  lightType: 'Point',
  intensity: 1.5,
  radius: 15.0,
  colorMode: 'Kelvin',
  colorTemperature: 2200,
  flickerMode: 'FireFlicker'
});

assert.ok(light1, 'Light 1 should be registered');
assert.strictEqual(mgrState.lights.size, 1);

// Step light animation
CLM.stepLight(mockScene, mockObj1, mockBehavior1);
assert.ok(light1.currentIntensity > 0, 'Light current intensity must be calculated');

// Execute CPU Broadphase post-events
registeredCallbacks.postEvents(mockScene);

assert.strictEqual(CLM.getActiveLightCount(mockScene), 1);
assert.ok(CLM.getCPUBroadphaseTimeMs(mockScene) >= 0.0, 'CPUBroadphaseTimeMs must return valid duration');
console.log('  Passed: Scene Manager, VRAM calculations, and CPU Light Binning completed cleanly.');

console.log('\n--- Test 5: Shader Injection, Karis Area Specular & Program Cache Key ---');
const mockMaterial = {
  name: 'PBR_Metal_Floor',
  onBeforeCompile: null
};

CLM.hookObjectMaterials({
  isMesh: true,
  material: mockMaterial,
  traverse(fn) { fn(this); }
}, mgrState);

assert.strictEqual(typeof mockMaterial.customProgramCacheKey, 'function');
assert.strictEqual(mockMaterial.customProgramCacheKey(), 'GD_CLUSTERED_LIGHTS_V1', 'customProgramCacheKey must equal GD_CLUSTERED_LIGHTS_V1');

// Test onBeforeCompile
const mockShader = {
  fragmentShader: '#include <lights_fragment_begin>\nvec3 finalColor = reflectedLight.directDiffuse + reflectedLight.directSpecular;',
  uniforms: {},
  defines: {}
};
mockMaterial.onBeforeCompile(mockShader);

assert.ok(mockShader.fragmentShader.includes('USE_CLUSTERED_LIGHTS'), 'Fragment shader must include clustered forward hooks');
assert.ok(mockShader.fragmentShader.includes('getKarisAreaSpecular'), 'Fragment shader must include Karis Area Specular function');
assert.ok(mockShader.fragmentShader.includes('evaluateIESProfile'), 'Fragment shader must include IES Photometric Profile function');
assert.ok(mockShader.fragmentShader.includes('texelFetch(uClusteredLightData'), 'Fragment shader must unpack light buffer texels');
assert.ok(mockShader.uniforms.uClusteredLightData, 'Uniform uClusteredLightData must be defined');
assert.ok(mockShader.uniforms.uClusterGrid2D, 'Uniform uClusterGrid2D must be defined');
assert.ok(mockShader.uniforms.uLightIndexList, 'Uniform uLightIndexList must be defined');

console.log('  Passed: Shader hooks, program cache key, and GLSL Karis area & IES curves verified.');

console.log('\nALL 5 CLUSTERED LIGHT MANAGER UNIT TESTS PASSED CLEANLY!\n');
