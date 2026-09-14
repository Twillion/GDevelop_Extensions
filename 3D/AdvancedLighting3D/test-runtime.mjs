import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
// The built extension embeds ShaderChain ahead of this runtime (see build-extension.mjs): the
// band-100 injector has to register against a chain that already exists, or the first material to
// enrol compiles with no clustered lighting at all. Concatenate them the same way here so the tests
// exercise the same load order that ships.
const chainCode = fs.readFileSync(
  path.join(here, '..', 'MaterialMaster', 'ShaderChain.runtime.js'), 'utf8');
const runtimeCode = chainCode + '\n' +
  fs.readFileSync(path.join(here, 'AdvancedLighting3D.runtime.js'), 'utf8');

// Mock gdjs and Three.js environment
globalThis.__createdTextures = [];
const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  registerInGameEditorPostStepCallback: (fn) => { registeredCallbacks.editorStep = fn; },
  hexToRGBColor: (hex) => [255, 180, 100]
};

const mockCanvasContext = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '',
  textAlign: '', textBaseline: '',
  fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  moveTo() {}, lineTo() {}, fillText() {}
};
globalThis.document = {
  createElement: (tag) => tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => mockCanvasContext }
    : { click() {} },
  body: { appendChild() {}, removeChild() {} }
};

globalThis.THREE = {
  RGBAFormat: 1023,
  FloatType: 1015,
  HalfFloatType: 1016,
  UnsignedShortType: 1012,
  UnsignedIntType: 1014,
  NearestFilter: 1003,
  LinearFilter: 1006,
  ClampToEdgeWrapping: 1001,
  RGIntegerFormat: 1030,
  RedIntegerFormat: 1028,
  SRGBColorSpace: 'srgb',
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
  Vector4: class {
    constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; }
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; }
  },
  Color: class {
    constructor() { this.r = 0; this.g = 0; this.b = 0; }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  },
  Matrix4: class {
    constructor() { this.elements = new Float32Array(16); }
    identity() { return this; }
    makeTranslation(x, y, z) { this.t = [x, y, z]; return this; }
    copy(m) { if (m && m.elements) this.elements.set(m.elements); return this; }
    clone() { const res = new this.constructor(); res.copy(this); return res; }
  },
  Group: class {
    constructor() { this.children = []; }
    add(obj) { this.children.push(obj); }
    remove(obj) { }
  },
  SphereGeometry: class { dispose() {} },
  PlaneGeometry: class {
    constructor(width, height) { this.width = width; this.height = height; }
    dispose() { this.disposed = true; }
  },
  MeshBasicMaterial: class {
    constructor(o) { Object.assign(this, o); this.isMeshBasicMaterial = true; }
    dispose() {}
  },
  CanvasTexture: class {
    constructor(canvas) { this.image = canvas; this.needsUpdate = false; }
    dispose() { this.disposed = true; }
  },
  InstancedMesh: class {
    constructor(g, m, count) {
      this.geometry = g; this.material = m; this.count = count;
      this.parent = null;
      this.matrices = new Array(count);
      this.colors = new Array(count);
      this.instanceMatrix = { needsUpdate: false };
      this.instanceColor = { needsUpdate: false };
    }
    setMatrixAt(i, m) { this.matrices[i] = m.t ? m.t.slice() : null; }
    setColorAt(i, c) { this.colors[i] = [c.r, c.g, c.b]; }
  },
  Raycaster: class {
    constructor() { this.far = Infinity; }
    set(origin, dir) { this.origin = origin; this.dir = dir; }
    // Deterministic stand-in: every ray whose direction points down (-Z in GDevelop
    // space, which is +Z mirrored) hits a grey surface; everything else is open sky.
    intersectObjects(meshes, recursive) {
      if (!meshes.length) return [];
      if (this.dir && this.dir.z < -0.3) {
        return [{ object: meshes[0], distance: 10 }];
      }
      return [];
    }
  },
  Mesh: class {
    constructor(g, m) {
      this.geometry = g;
      this.material = m;
      this.children = [];
      this.parent = null;
      this.position = new globalThis.THREE.Vector3();
      this.userData = {};
    }
    add(child) {
      if (child.parent && child.parent !== this && child.parent.remove) child.parent.remove(child);
      if (!this.children.includes(child)) this.children.push(child);
      child.parent = this;
    }
    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child.parent === this) child.parent = null;
    }
  },
  DataTexture: class {
    constructor(data, w, h, format, type) {
      this.image = { data, width: w, height: h };
      this.format = format;
      this.type = type;
      this.needsUpdate = false;
      // Every DataTexture the extension builds is recorded so the suite can assert none
      // exceeds what WebGL2 guarantees and that each backing array is large enough for the
      // dimensions claimed. The old 55,296-wide index strip failed both.
      globalThis.__createdTextures.push(this);
    }
    dispose() { this.disposed = true; }
  },
  Data3DTexture: class {
    constructor(data, w, h, d) {
      this.image = { data, width: w, height: h, depth: d };
      this.needsUpdate = false;
    }
    dispose() { this.disposed = true; }
  }
};

// Evaluate the runtime script
new Function(runtimeCode)();

let AL = gdjs.__advancedLighting3D;
assert.ok(AL, 'gdjs.__advancedLighting3D must be defined');

/* ------------------------------------------------------------------ helpers */

// Stands in for a GDevelop MeshStandardMaterial. Mirrors the one property the
// injector gates on and the clone semantics of three r160: Material.copy does NOT
// carry onBeforeCompile or customProgramCacheKey across, which is what lets a probe
// receiver's clone take a single clean injection.
function makeStandardMaterial(name) {
  return {
    name,
    isMeshStandardMaterial: true,
    needsUpdate: false,
    clone() { return makeStandardMaterial(this.name + '_clone'); },
    dispose() { this.disposed = true; }
  };
}

function makeShader() {
  return {
    vertexShader: '#include <worldpos_vertex>\ngl_Position = vec4(0.0);',
    fragmentShader: '#include <lights_fragment_begin>\nvec3 c = reflectedLight.directDiffuse;',
    uniforms: {},
    defines: {}
  };
}

console.log('--- Test 1: Blackbody Kelvin to sRGB Color Conversions ---');
const kelvinSamples = [
  { k: 1800, expectedHex: 'warm amber/candle' },
  { k: 2200, expectedHex: 'torch/fireplace' },
  { k: 2800, expectedHex: 'incandescent bulb' },
  { k: 5500, expectedHex: 'crisp daylight' },
  { k: 6500, expectedHex: 'cool overcast' },
  { k: 8500, expectedHex: 'moonlight/blue sky' }
];

let prevBlue = -1;
for (const sample of kelvinSamples) {
  const rgb = AL.kelvinToRGB(sample.k);
  assert.ok(rgb.length === 3, 'kelvinToRGB must return an [r, g, b] triple');
  for (const ch of rgb) {
    assert.ok(ch >= 0 && ch <= 1, `Channel ${ch} at ${sample.k}K must be normalised to [0, 1]`);
  }
  // Blue rises monotonically with temperature across the sampled range.
  assert.ok(rgb[2] >= prevBlue, `Blue must not fall as temperature rises (${sample.k}K)`);
  prevBlue = rgb[2];
  console.log(`  Passed: ${sample.k}K -> RGB(${rgb.map(v => v.toFixed(3)).join(', ')}) [${sample.expectedHex}]`);
}
// A candle must be warmer than moonlight.
const warm = AL.kelvinToRGB(1800);
const cool = AL.kelvinToRGB(8500);
assert.ok(warm[0] > warm[2], '1800K must be red-dominant');
assert.ok(cool[2] > cool[0], '8500K must be blue-dominant');

console.log('\n--- Test 2: Arvo Sphere-to-AABB Distance Squared ---');
const dInside = AL.arvoDistanceSq(0, 0, 0, 10, 10, 10, 5, 5, 5);
assert.strictEqual(dInside, 0, 'A point inside the AABB must have zero distance');

const dOutsideX = AL.arvoDistanceSq(0, 0, 0, 10, 10, 10, 13, 5, 5);
assert.strictEqual(dOutsideX, 9, 'A point 3 units past maxX must be 9 units squared away');

const dDiag = AL.arvoDistanceSq(0, 0, 0, 10, 10, 10, 13, 14, 5);
assert.strictEqual(dDiag, 25, 'Diagonal (3, 4) offset must be 25 units squared');
console.log('  Passed: Arvo squared distance metrics are exact.');

console.log('\n--- Test 3: Procedural Flicker Waveforms & Muzzle Flash ---');
const baseInt = 2.0;
const fireInt = AL.evaluateFlicker('FireFlicker', 1.5, 8.0, 0.25, baseInt);
assert.ok(fireInt > 0 && fireInt < baseInt * 2.0, 'FireFlicker must stay in a sane band');
assert.notStrictEqual(fireInt, baseInt, 'FireFlicker must actually modulate');

const pulseInt = AL.evaluateFlicker('PulseWave', 0.0, 8.0, 0.5, baseInt);
assert.ok(Math.abs(pulseInt - baseInt) < 1e-6, 'PulseWave at t=0 must equal the base intensity');

const noneInt = AL.evaluateFlicker('None', 2.0, 8.0, 0.5, baseInt);
assert.strictEqual(noneInt, baseInt, 'FlickerMode None must pass the intensity through');
console.log('  Passed: Procedural waveforms and modulation validated.');

console.log('\n--- Test 4: Scene Manager, Light Lifecycle & Diagnostics ---');

// A traversable stand-in for the layer's three scene.
const sceneMeshes = [];
const mockThreeScene = {
  children: [],
  add(o) { this.children.push(o); o.parent = this; },
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; },
  traverse(fn) { fn(this); sceneMeshes.forEach(fn); }
};

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
      getThreeScene: () => mockThreeScene
    })
  }),
  getElapsedTime: () => 16.6,
  getTimeManager: () => ({
    getTimeFromStart: () => 1000
  })
};

const mgrState = AL.registerSceneManager(mockScene, {
  maxLights: 256,
  enableVolumetricFog: true,
  volumetricFogDensity: 0.03,
  volumetricAnisotropy: 0.5,
  globalIntensityScale: 1.2
});

assert.ok(mgrState, 'Manager state must be initialized');
assert.strictEqual(mgrState.maxLights, 256);
assert.strictEqual(mgrState.enableVolumetricFog, true);
assert.strictEqual(mgrState.volumetricFogDensity, 0.03);

const totalClusters = AL.getTotalClusterCount(mockScene);
assert.strictEqual(totalClusters, 3456, 'Total clusters must equal 16 x 9 x 24 = 3456');

const vramBytes = AL.getClusterVRAMBytes(mockScene);
assert.ok(vramBytes > 0 && vramBytes < 600000,
  `VRAM footprint should stay below 600 KB with 64 lights per cluster (got ${vramBytes} bytes)`);

const mockObj1 = {
  getX: () => 0,
  getY: () => 0,
  getZ: () => 10,
  get3DRendererObject: () => null
};
const mockBehavior1 = {};
const light1 = AL.registerLight(mockScene, mockObj1, mockBehavior1, {
  lightType: 'Point',
  intensity: 1.5,
  radius: 15.0,
  colorMode: 'Kelvin',
  colorTemperature: 2200,
  flickerMode: 'FireFlicker'
});

assert.ok(light1, 'Light 1 should be registered');
assert.strictEqual(mgrState.lights.size, 1);

AL.stepLight(mockScene, mockObj1, mockBehavior1);
assert.ok(light1.currentIntensity > 0, 'Light current intensity must be calculated');

registeredCallbacks.postEvents(mockScene);

assert.strictEqual(AL.getActiveLightCount(mockScene), 1);
assert.ok(AL.getCPUBroadphaseTimeMs(mockScene) >= 0.0, 'CPUBroadphaseTimeMs must return valid duration');
console.log('  Passed: Scene Manager, VRAM calculations, and CPU Light Binning completed cleanly.');

console.log('\n--- Test 5: Clustered-only shader injection ---');
const sharedMaterial = makeStandardMaterial('PBR_Metal_Floor');

AL.hookObjectMaterials({
  isMesh: true,
  material: sharedMaterial,
  traverse(fn) { fn(this); }
}, mgrState);

assert.strictEqual(typeof sharedMaterial.customProgramCacheKey, 'function');
const clusteredKey = sharedMaterial.customProgramCacheKey();
// ShaderChain composes the key from every active injector, so this extension's fragment is now
// namespaced behind 'M3D|advlight3d:' rather than owning the whole string. That composition is the
// point: two injectors on one material must produce two distinct programs.
assert.ok(clusteredKey.startsWith('M3D|'), `Cache key is not chain-composed: ${clusteredKey}`);
assert.ok(clusteredKey.includes('advlight3d:GD_ADVLIGHT3D_V8|CL1|'), `Unexpected cache key ${clusteredKey}`);
assert.ok(clusteredKey.includes('|LP0'), 'A material with no probe receiver must report LP0');

const clusteredShader = makeShader();
sharedMaterial.onBeforeCompile(clusteredShader);

assert.strictEqual(clusteredShader.defines.USE_CLUSTERED_LIGHTS, 1);
assert.strictEqual(clusteredShader.defines.USE_PROBE_GRID, undefined,
  'A non-receiver material must not define USE_PROBE_GRID');
assert.ok(clusteredShader.fragmentShader.includes('getKarisAreaSpecular'), 'Karis area specular must be present');
assert.ok(clusteredShader.fragmentShader.includes('evaluateIESProfile'), 'IES profile helper must be present');
assert.ok(clusteredShader.fragmentShader.includes('texelFetch(uClusteredLightData'), 'Light buffer must be unpacked');
assert.ok(clusteredShader.uniforms.uClusteredLightData, 'uClusteredLightData must be bound');
assert.ok(clusteredShader.uniforms.uClusterGrid2D, 'uClusterGrid2D must be bound');
assert.ok(clusteredShader.uniforms.uLightIndexList, 'uLightIndexList must be bound');
assert.strictEqual(clusteredShader.vertexShader.includes('vProbeWorldPos'), false,
  'A non-receiver material must not carry the probe varying');
assert.ok(clusteredShader.fragmentShader.includes('float lightScaleFactor = PI * uGlobalClusteredIntensity;'),
  'Point, Spot and AreaCapsule must all receive GDevelop compatibility scaling in their shared loop');
assert.ok(!clusteredShader.fragmentShader.includes('uUseLegacyLights'),
  'Direct lights must not retain the deprecated dynamic legacy-lights path');
assert.ok(clusteredShader.fragmentShader.includes('vec3 clDiffuseL'),
  'Area capsules need a camera-independent direction for diffuse illumination');
assert.ok(clusteredShader.fragmentShader.includes('clSpecularL = getKarisAreaSpecular'),
  'The camera-dependent Karis representative point must be isolated to specular');
assert.ok(clusteredShader.fragmentShader.includes('attenuationDistance = length(toClosestOnSegment);'),
  'Capsule attenuation must use distance to the tube segment rather than its centre');
assert.ok(!clusteredShader.fragmentShader.includes('clL = getKarisAreaSpecular'),
  'The old camera-following shared light direction must never return');

// The BSDF calls must match the interface three r160 actually exposes. G_Smith does not
// exist there and F_Schlick takes three arguments, so the previous formulation could
// never compile.
assert.ok(clusteredShader.fragmentShader.includes('V_GGX_SmithCorrelated(alphaPrime, clSpecularNdotL, clNdotV)'),
  'Specular must use V_GGX_SmithCorrelated, the visibility term three r160 provides');
assert.ok(!clusteredShader.fragmentShader.includes('G_Smith'), 'G_Smith does not exist in three r160');
assert.ok(clusteredShader.fragmentShader.includes('F_Schlick(material.specularColor, material.specularF90, clVdotH)'),
  'F_Schlick takes (f0, f90, dotVH) in three r160');

// The view-space values must come from the locals lights_fragment_begin declares.
// vViewPosition is the negated fragment position, so using it as a position is a sign error.
assert.ok(clusteredShader.fragmentShader.includes('vec3 clP = geometryPosition;'),
  'Fragment position must come from geometryPosition');
assert.ok(clusteredShader.fragmentShader.includes('vec3 clV = geometryViewDir;'),
  'View direction must come from geometryViewDir');
assert.ok(!/toLight = lightPosView - vViewPosition/.test(clusteredShader.fragmentShader),
  'vViewPosition must not be used as a fragment position');

// A precision statement has to precede every declaration of the type it qualifies.
const fragPrelude = clusteredShader.fragmentShader;
assert.ok(fragPrelude.indexOf('precision highp usampler2D;') < fragPrelude.indexOf('uniform usampler2D'),
  'usampler2D precision must be declared before the first usampler2D uniform');
console.log('  Passed: clustered injection, fixed compatibility scale, cache key, r160 BSDF interface and precision ordering.');

console.log('\n--- Test 6: Probe receiver injection shares one hook and one cache key ---');
const receiverOriginal = makeStandardMaterial('Character_Body');
const receiverMesh = { isMesh: true, material: receiverOriginal };
const receiverRoot = {
  traverse(fn) { fn(receiverRoot); fn(receiverMesh); }
};
const receiverObject = {
  getX: () => 100, getY: () => 200, getZ: () => 0,
  getLayer: () => '',
  getRenderer: () => ({
    _threeObject: receiverRoot,
    get3DRendererObject: () => receiverRoot
  })
};
const receiverBehavior = {};
const rec = AL.registerReceiver(mockScene, receiverObject, receiverBehavior, {
  intensityMultiplier: 2.0,
  normalBias: 20.0,
  updateFrequency: 'Continuous',
  enabled: true
});

assert.ok(rec, 'Receiver must register');
assert.strictEqual(rec.materialClones.length, 1, 'The receiver must take one material clone');
const clone = rec.materialClones[0].clone;
assert.notStrictEqual(clone, receiverOriginal, 'The clone must not be the shared original');
assert.strictEqual(receiverMesh.material, clone, 'The mesh must render the clone');

const probeKey = clone.customProgramCacheKey();
assert.ok(probeKey.includes('|LP1'), 'A receiver clone must report LP1');
assert.notStrictEqual(probeKey, clusteredKey,
  'The probe and non-probe variants are different programs and must not share a cache key');

const probeShader = makeShader();
clone.onBeforeCompile(probeShader);

assert.strictEqual(probeShader.defines.USE_CLUSTERED_LIGHTS, 1, 'A receiver still gets clustered lights');
assert.strictEqual(probeShader.defines.USE_PROBE_GRID, 1, 'A receiver gets the probe grid');
assert.ok(probeShader.fragmentShader.includes('evaluateLightProbeGrid'), 'Probe sampler must be present');
assert.ok(probeShader.fragmentShader.includes('texelFetch(uClusteredLightData'),
  'One hook must carry both features: the clustered loop is still there');
assert.ok(probeShader.vertexShader.includes('vProbeWorldPos ='), 'World position must be written in the vertex shader');
assert.ok(probeShader.uniforms.uProbeVolumeDay !== undefined, 'uProbeVolumeDay must be declared');
assert.strictEqual(probeShader.uniforms.uProbeIntensity.value, 0.0,
  'Probe intensity must start at zero so the frames before the first sync add no light');
assert.strictEqual(probeShader.uniforms.uProbeNormalBias.value, 20.0);

// Ordering: irradiance is consumed by lights_fragment_end, so the probe term has to be
// added after the include and before the clustered block writes reflectedLight.
const hook = probeShader.fragmentShader;
assert.ok(hook.indexOf('#include <lights_fragment_begin>') < hook.indexOf('irradiance +='),
  'The probe term must be added after lights_fragment_begin');
assert.ok(hook.indexOf('irradiance +=') < hook.lastIndexOf('reflectedLight.directDiffuse +='),
  'The probe term must precede the clustered accumulation');
console.log('  Passed: one injection, two program variants, distinct cache keys.');

console.log('\n--- Test 7: Half-float round trip and altitude gradient ordering ---');
for (const v of [0.0, 0.25, 0.5, 1.0, 2.5, 0.0625]) {
  const back = AL.fromHalf(AL.toHalf(v));
  assert.ok(Math.abs(back - v) < 1e-3, `Half-float round trip failed for ${v} (got ${back})`);
}

const grad = AL.__internals.generateAltitudeGradientBuffer(2, 2, 3, [255, 0, 0], [0, 255, 0], [0, 0, 255]);
assert.strictEqual(grad.length, 2 * 2 * 3 * 4, 'Gradient buffer must be RGBA per probe');
// idx = ((z * resY + y) * resX + x) * 4 -- Z is the outer loop because Z is the height axis.
const bottom = AL.fromHalf(grad[1]);            // z=0, green channel of the ground colour
const top = AL.fromHalf(grad[((2 * 2 + 0) * 2 + 0) * 4]); // z=2, red channel of the sky colour
assert.ok(bottom > 0.9, 'The bottom slice must be the ground colour (green)');
assert.ok(top > 0.9, 'The top slice must be the sky colour (red)');
console.log('  Passed: half-float codec exact to 1e-3, gradient stacks along Z.');

console.log('\n--- Test 8: Probe volume bounds, mirroring and metrics ---');
const volumeObject = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getWidth: () => 1000, getHeight: () => 800, getDepth: () => 400,
  getLayer: () => '',
  setOpacity: () => {}, hide: () => {},
  getRenderer: () => ({ get3DRendererObject: () => ({ visible: true }) })
};
const volumeBehavior = {};
const vol = AL.registerVolume(mockScene, volumeObject, volumeBehavior, {
  resX: 8, resY: 8, resZ: 4,
  skyColor: '160;200;255',
  groundColor: '80;120;50',
  horizonColor: '200;220;240',
  volumeIntensity: 1.0
});

assert.ok(vol, 'Volume must register');
assert.strictEqual(vol.maxX, 1000);
assert.strictEqual(vol.maxY, 800);
// The 3D scene root is mirrored on Y, so three-space min.y is -maxY.
assert.strictEqual(vol.threeMin.y, -800, 'Mirrored three-space bounds must use -maxY');
assert.strictEqual(vol.threeSize.y, 800);
assert.ok(vol.textureDay, 'The day volume texture must be allocated');

assert.strictEqual(AL.getActiveProbeCount(mockScene), 8 * 8 * 4);
assert.ok(Math.abs(AL.getProbeSpacingX(mockScene) - 1000 / 7) < 1e-6);
assert.ok(Math.abs(AL.getProbeSpacingZ(mockScene) - 400 / 3) < 1e-6);
assert.strictEqual(AL.getProbeVRAMBytes(mockScene), 8 * 8 * 4 * 8, 'RGBA16F is 8 bytes per probe');
assert.strictEqual(AL.isProbeVolumeLoaded(mockScene), true);

// Explicit bounds must lock out the authoring cube.
AL.setProbeBounds(mockScene, 10, 20, 30, 500, 600, 700);
AL.updateVolume(mockScene, volumeObject, volumeBehavior, {});
assert.strictEqual(vol.minX, 10, 'Explicit bounds must survive the next doStepPreEvents sync');
assert.strictEqual(vol.maxZ, 700);
console.log('  Passed: bounds, Y mirroring, spacing, VRAM and the bounds lock.');

console.log('\n--- Test 9: Receiver uniform sync and day/night blending ---');
AL.setProbeGlobalIntensity(mockScene, 2.0);
AL.setDayNightBlend(mockScene, 0.25);
AL.stepReceiver(mockScene, receiverObject, receiverBehavior);

const u = clone.__alUniforms;
assert.ok(u, 'The clone must expose its uniform set');
// volumeIntensity 1.0 * multiplier 2.0 * global 2.0 * fixed GDevelop compatibility PI
assert.ok(Math.abs(u.uProbeIntensity.value - (1.0 * 2.0 * 2.0 * Math.PI)) < 1e-9,
  `Effective intensity must fold in GDevelop's compatibility PI factor (got ${u.uProbeIntensity.value})`);
assert.strictEqual(u.uProbeDayNightBlend.value, 0.25);
assert.strictEqual(u.uProbeVolumeMin.value.y, -600, 'Uniform bounds must be the mirrored ones');
assert.strictEqual(u.uProbeVolumeDay.value, vol.textureDay);
assert.strictEqual(u.uProbeVolumeNight.value, vol.textureDay,
  'With day/night off, the night sampler must fall back to the day texture');

// Disabling must drive the contribution to zero without recompiling.
rec.enabled = false;
AL.stepReceiver(mockScene, receiverObject, receiverBehavior);
assert.strictEqual(u.uProbeIntensity.value, 0.0, 'A disabled receiver must contribute nothing');
rec.enabled = true;
console.log('  Passed: uniform sync, fixed compatibility PI scale, day/night fallback, disable path.');

console.log('\n--- Test 10: Bake excludes receivers, and the .lpg.bin round trip ---');
// A receiver mesh and a debug sphere must both be kept out of the bake: baking them would
// burn a dynamic object's own occlusion into the volume permanently.
sceneMeshes.length = 0;
const worldMesh = { isMesh: true, visible: true, geometry: {}, name: 'Wall', material: { color: { r: 0.5, g: 0.5, b: 0.5 } } };
const debugMesh = { isMesh: true, visible: true, geometry: {}, name: 'AL_PROBE_DEBUG_SPHERES' };
sceneMeshes.push(worldMesh, debugMesh, receiverMesh);
receiverMesh.visible = true;
receiverMesh.geometry = {};

const bakeMeshes = AL.__internals.collectBakeGeometry(mockScene, '');
assert.ok(bakeMeshes.includes(worldMesh), 'World geometry must be baked');
assert.ok(!bakeMeshes.includes(debugMesh), 'Probe debug spheres must be excluded');
assert.ok(!bakeMeshes.includes(receiverMesh), 'Probe receivers must be excluded');

// Run the bake to completion with a generous budget.
AL.setBakeBudgetMs(mockScene, 5000);
assert.strictEqual(AL.startBake(mockScene), true, 'The bake must start');
assert.strictEqual(AL.isBakeInProgress(mockScene), true);
for (let guard = 0; guard < 200 && AL.isBakeInProgress(mockScene); guard++) {
  registeredCallbacks.postEvents(mockScene);
}
assert.strictEqual(AL.isBakeComplete(mockScene), true, 'The bake must complete');
assert.strictEqual(AL.getBakeProgress(mockScene), 1.0);
assert.strictEqual(vol.isBaked, true);

// Export and re-import must reproduce the volume exactly.
const buffer = AL.__internals.exportBinary(vol);
assert.ok(buffer, 'Export must produce a buffer');
const view = new DataView(buffer);
assert.strictEqual(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'LPG3');
assert.strictEqual(view.getUint32(4, true), 1, 'Format version must be 1');

const bakedCopy = Uint16Array.from(vol.dataDay);
vol.dataDay = new Uint16Array(vol.dataDay.length); // scribble over it
assert.strictEqual(AL.loadProbeDataFromBuffer(mockScene, buffer), true, 'Reload must validate and apply');
assert.deepStrictEqual(Array.from(vol.dataDay), Array.from(bakedCopy), 'The round trip must be lossless');

// A truncated file must be rejected rather than throwing a RangeError.
assert.strictEqual(AL.loadProbeDataFromBuffer(mockScene, buffer.slice(0, 80)), false,
  'A truncated probe file must be rejected');
// So must a bad magic number.
const badMagic = buffer.slice(0);
new DataView(badMagic).setUint8(0, 0x00);
assert.strictEqual(AL.loadProbeDataFromBuffer(mockScene, badMagic), false, 'Bad magic must be rejected');
console.log('  Passed: bake exclusions, amortised bake to completion, lossless .lpg.bin round trip, malformed input rejected.');

console.log('\n--- Test 11: GPU resources stay inside what WebGL2 guarantees ---');
// WebGL2 mandates MAX_TEXTURE_SIZE >= 2048. Typical desktop is 16384, but shipping a texture
// that only works on a good GPU is the same class of bug as shipping one that works nowhere:
// the upload fails, texelFetch returns 0, and every cluster slot resolves to light index 0.
const WEBGL2_MIN_TEXTURE_SIZE = 2048;
assert.ok(globalThis.__createdTextures.length >= 3, 'The manager must have built its data textures');
for (const t of globalThis.__createdTextures) {
  const w = t.image.width, h = t.image.height || 1, data = t.image.data;
  assert.ok(w <= WEBGL2_MIN_TEXTURE_SIZE && h <= WEBGL2_MIN_TEXTURE_SIZE,
    `Texture ${w}x${h} exceeds the ${WEBGL2_MIN_TEXTURE_SIZE} texture size WebGL2 guarantees`);
  const channels = t.format === THREE.RGBAFormat ? 4 : (t.format === THREE.RGIntegerFormat ? 2 : 1);
  assert.ok(data.length >= w * h * channels,
    `Texture ${w}x${h} needs ${w * h * channels} elements, array holds ${data.length}`);
}
console.log(`  Passed: ${globalThis.__createdTextures.length} textures, all within ${WEBGL2_MIN_TEXTURE_SIZE} and correctly sized.`);

console.log('\n--- Test 12: MaxLights reallocates its buffers ---');
const lightArrayBefore = mgrState.lightDataArray.length;
AL.setMaxLights(mockScene, 512);
assert.strictEqual(mgrState.maxLights, 512);
assert.ok(mgrState.lightDataArray.length > lightArrayBefore,
  'Raising MaxLights must grow the light data array, not silently drop every write past the old cap');
assert.strictEqual(mgrState.lightDataArray.length, 512 * 16, '4 RGBA32F texels = 16 floats per light');
assert.strictEqual(mgrState.lightDataTexture, null, 'The old texture must be dropped so it rebuilds at the new width');
registeredCallbacks.postEvents(mockScene);
assert.ok(mgrState.lightDataTexture, 'The texture must be rebuilt on the next tick');
assert.strictEqual(mgrState.lightDataTexture.image.width, 512 * 4);
AL.setMaxLights(mockScene, 256);
console.log('  Passed: MaxLights 256 -> 512 -> 256 reallocates both array and texture.');

console.log('\n--- Test 13: uResolution comes from the drawing buffer, not the CSS size ---');
// gl_FragCoord is in drawing-buffer pixels. Feeding it the CSS size clamps the far half of
// the screen into the last cluster column and row on every display with a pixel ratio above 1.
let askedForDrawingBuffer = false;
const hidpiScene = {
  ...mockScene,
  getGame: () => ({
    getRenderer: () => ({
      getThreeRenderer: () => ({
        capabilities: { isWebGL2: true },
        useLegacyLights: true,
        getSize: (t) => t.set(800, 600),
        getDrawingBufferSize: (t) => { askedForDrawingBuffer = true; return t.set(1600, 1200); }
      })
    })
  })
};
AL.registerSceneManager(hidpiScene, {});
AL.registerLight(hidpiScene, mockObj1, {}, { intensity: 1.0, radius: 15.0 });
registeredCallbacks.postEvents(hidpiScene);
assert.ok(askedForDrawingBuffer, 'The manager must ask for the drawing buffer size, not the CSS size');
console.log('  Passed: drawing-buffer size requested (2x CSS size honoured).');

console.log('\n--- Test 14: the 4th texel carries IES, inner cone and capsule axis ---');
const packScene = { ...mockScene };
AL.registerSceneManager(packScene, {});
const packState = AL.stateOf(packScene);
const spotObj = { getX: () => 0, getY: () => 0, getZ: () => 0, get3DRendererObject: () => null };
const spotBeh = {};
AL.registerLight(packScene, spotObj, spotBeh, {
  lightType: 'Spot', intensity: 1.0, radius: 50.0,
  spotInnerAngle: 20.0, spotOuterAngle: 40.0,
  iesProfile: 'Downlight'
});
AL.stepLight(packScene, spotObj, spotBeh);
registeredCallbacks.postEvents(packScene);

const d = packState.lightDataArray;
assert.strictEqual(d[3], 5000.0, 'Texel 0.w is the radius in world units');
const cosOuter = Math.cos(40 * Math.PI / 180);
const cosInner = Math.cos(20 * Math.PI / 180);
assert.ok(Math.abs(d[11] - cosOuter) < 1e-6, 'Texel 2.w is cos(outerAngle)');
assert.ok(Math.abs(d[13] - cosInner) < 1e-6, 'Texel 3.y is cos(innerAngle) - SpotInnerAngle used to be dead');
assert.strictEqual(d[12], 3, 'Texel 3.x is the IES profile id (Downlight = 3)');
assert.ok(d[13] > d[11], 'cos(inner) must exceed cos(outer) or the penumbra divides by zero');

// An inner angle authored wider than the outer one must clamp, not invert.
AL.updateLight(packScene, spotObj, spotBeh, { spotInnerAngle: 80.0 });
AL.stepLight(packScene, spotObj, spotBeh);
registeredCallbacks.postEvents(packScene);
assert.ok(packState.lightDataArray[13] > packState.lightDataArray[11],
  'An inner angle wider than the outer one must be clamped, not inverted');
console.log('  Passed: IES id and inner cone reach the GPU; inner/outer inversion is clamped.');

console.log('\n--- Test 16: the metre <-> world-unit contract ---');
// GDevelop 3D is pixel scale, but the light distance properties are authored in metres.
// WORLD_UNITS_PER_METER = 100 is the bridge, and EVERY distance crossing it has to be
// converted or the value is silently off by 100x. Before this conversion existed, the
// Frostbite 1/(d*d + 1) term was fed pixel distances, so a light 100 units away contributed
// ~1e-4 and nothing was visible at any radius.
const unitScene = { ...mockScene };
AL.registerSceneManager(unitScene, {});
const unitState = AL.stateOf(unitScene);
const unitObj = { getX: () => 0, getY: () => 0, getZ: () => 0, get3DRendererObject: () => null };

const capBeh = {};
AL.registerLight(unitScene, unitObj, capBeh, {
  lightType: 'AreaCapsule', intensity: 1.0, radius: 12.0, capsuleLength: 2.0
});
AL.stepLight(unitScene, unitObj, capBeh);
registeredCallbacks.postEvents(unitScene);

const lu = unitState.lightDataArray;
assert.strictEqual(lu[3], 1200, 'Radius 12 m must reach the GPU as 1200 world units');
// extraParam encodes the capsule as 10 + halfLength, and the shader compares that half-length
// against view-space positions, which are in world units.
assert.ok(lu[11] > 10.0, 'An AreaCapsule must still be flagged by extraParam > 10');
assert.strictEqual(lu[11] - 10.0, 100, 'A 2 m capsule is 100 world units per half - not 1');

// The behavior record keeps the authored metres; only the packed data is converted.
const capLight = capBeh.__alLight;
assert.strictEqual(capLight.radius, 12.0, 'The behavior keeps the authored value in metres');
assert.strictEqual(capLight.capsuleLength, 2.0);
assert.ok(capLight.viewDistance < 100,
  `ViewDistance() is documented in metres, so it must not report raw world units (got ${capLight.viewDistance})`);

// The shader must not hardcode the scale independently of the JS constant.
const unitShader = makeShader();
const unitMat = makeStandardMaterial('UnitProbe');
AL.hookObjectMaterials({ isMesh: true, material: unitMat, traverse(fn) { fn(this); } }, unitState);
unitMat.onBeforeCompile(unitShader);
assert.strictEqual(unitShader.defines.AL_WORLD_UNITS_PER_METER, '100.0',
  'The metre scale must reach the shader as a float-literal define');
assert.ok(unitShader.fragmentShader.includes('attenuationDistance / AL_WORLD_UNITS_PER_METER'),
  'The shader must read the scale from the define, not a literal that can drift from the JS constant');

// The attenuation the shader will compute must actually be visible. Mirrors the GLSL.
const attenAt = (distWorld, radiusMetres) => {
  const dm = distWorld / 100, rm = radiusMetres;
  const n = Math.max(1 - Math.pow(dm / rm, 4), 0);
  return (n * n) / (dm * dm + 1);
};
assert.ok(attenAt(100, 12) > 0.4, `A light 1 m away must be bright (got ${attenAt(100, 12)})`);
assert.ok(attenAt(400, 12) > 0.02, `A light 4 m away must still register (got ${attenAt(400, 12)})`);
assert.strictEqual(attenAt(1200, 12), 0, 'Attenuation must reach exactly 0 at the radius');

// The CPU broadphase must enclose the complete segment, not just a radius-sized sphere at
// its centre. This tube's centre is outside the right side of the frustum, but its -X end
// reaches into view and must therefore still be assigned to clusters.
const longCapsuleScene = { ...mockScene };
AL.registerSceneManager(longCapsuleScene, {});
const longCapsuleRoot = {
  getWorldPosition: (target) => target.set(700, 0, -500),
  getWorldDirection: (target) => target.set(-1, 0, 0)
};
const longCapsuleBehavior = {};
AL.registerLight(longCapsuleScene, {
  get3DRendererObject: () => longCapsuleRoot,
  getX: () => 700, getY: () => 0, getZ: () => -500
}, longCapsuleBehavior, {
  lightType: 'AreaCapsule', intensity: 1.0, radius: 1.0, capsuleLength: 10.0
});
registeredCallbacks.postEvents(longCapsuleScene);
assert.strictEqual(longCapsuleBehavior.__alLight.isInFrustum, true,
  'A capsule endpoint inside the frustum must survive conservative CPU culling');
console.log('  Passed: radius, capsule and view distance all cross the metre boundary consistently.');

console.log('\n--- Test 17: Receiver teardown restores the shared material ---');
AL.disposeReceiver(mockScene, receiverBehavior);
assert.strictEqual(receiverMesh.material, receiverOriginal, 'Teardown must restore the shared original');
assert.strictEqual(clone.disposed, true, 'The clone must be disposed');
assert.strictEqual(mgrState.hookedMaterials.has(clone), false,
  'A disposed clone must not be left in the hooked-material set');
assert.strictEqual(receiverBehavior.__alProbeReceiver, null);

AL.disposeVolume(mockScene, volumeBehavior);
assert.strictEqual(AL.isProbeVolumeLoaded(mockScene), false, 'Disposing the volume must clear it from the scene');
console.log('  Passed: material restoration, clone disposal, hook-set cleanup.');

console.log('\n--- Test 18: screen-space tile culling bins exactly what a full sweep would ---');
// The broadphase only tests the tiles a light's screen-space footprint covers. That is an
// optimisation on a correctness-critical loop: cull one tile too many and lights silently
// vanish from those clusters. This re-evaluates the runtime with the culling removed and
// asserts the two produce byte-identical cluster headers and index lists.
const fullSweepSrc = runtimeCode
  .replace('for (var j = jMin; j <= jMax; ++j) {', 'for (var j = 0; j < Sy; ++j) {')
  .replace('for (var i = iMin; i <= iMax; ++i) {', 'for (var i = 0; i < Sx; ++i) {')
  .replace('if (vx + cullRadius < -xRight || vx - cullRadius > xRight) continue;', '')
  .replace('if (vy + cullRadius < -yTop || vy - cullRadius > yTop) continue;', '');
assert.notStrictEqual(fullSweepSrc, runtimeCode,
  'The full-sweep variant must differ, or this test is comparing the runtime against itself');

// Deterministic placements spanning inside, on the edge of, and outside the frustum.
let equivSeed = 12345;
const equivRnd = () => { equivSeed = (equivSeed * 1103515245 + 12345) & 0x7fffffff; return equivSeed / 0x7fffffff; };
const EQUIV_CASES = [];
for (let i = 0; i < 400; i++) {
  EQUIV_CASES.push({
    x: (equivRnd() - 0.5) * 4000, y: (equivRnd() - 0.5) * 3000,
    z: equivRnd() * 1800 + 5, r: [0.5, 2, 4, 8, 12, 25][i % 6],
  });
}

// Re-evaluating the runtime replaces the module singleton AND re-registers every gdjs
// callback, so the entries in `registeredCallbacks` would afterwards belong to a different
// module instance than `AL` - with its own scene Map. Snapshot and restore both.
const savedModule = gdjs.__advancedLighting3D;
const savedCallbacks = { ...registeredCallbacks };

function binWith(code) {
  gdjs.__advancedLighting3D = undefined;
  new Function(code)();
  const api = gdjs.__advancedLighting3D;
  const sc = { ...mockScene };
  api.registerSceneManager(sc, { maxLights: 512 });
  const st = api.stateOf(sc);
  for (const c of EQUIV_CASES) {
    const beh = {};
    const obj = { getX: () => c.x, getY: () => c.y, getZ: () => c.z, get3DRendererObject: () => null };
    api.registerLight(sc, obj, beh, { intensity: 1.0, radius: c.r });
    api.stepLight(sc, obj, beh);
  }
  registeredCallbacks.postEvents(sc);
  return {
    grid: Array.from(st.clusterGridArray),
    idx: Array.from(st.lightIndexArray),
    active: st.activeLightCount,
    peak: st.maxLightsInCluster,
  };
}

const culled = binWith(runtimeCode);
const exhaustive = binWith(fullSweepSrc);
assert.strictEqual(culled.active, exhaustive.active, 'Both must bin the same number of lights');
assert.deepStrictEqual(culled.grid, exhaustive.grid, 'Cluster headers must be identical');
assert.deepStrictEqual(culled.idx, exhaustive.idx, 'Light index lists must be identical');
assert.ok(culled.active > 50, `The sample must actually exercise the binning (got ${culled.active} lights)`);

gdjs.__advancedLighting3D = savedModule;
Object.assign(registeredCallbacks, savedCallbacks);
assert.strictEqual(gdjs.__advancedLighting3D, AL, 'The original module instance must be restored');
console.log(`  Passed: ${culled.active} lights, ${culled.grid.length} headers and ${culled.idx.length} indices identical to a full sweep.`);

console.log('\n--- Test 19: the scene editor gets a live step of its own ---');
// GDevelop's 3D scene editor never runs events: it calls _updateObjectsForInGameEditor, then
// gdjs.callbacksInGameEditorPostStep, then render(). Neither the scene post-events callbacks
// nor any behavior's doStepPreEvents fire there, so without registering for that list no
// material is ever hooked while authoring and every light is invisible in the editor.
assert.strictEqual(typeof registeredCallbacks.editorStep, 'function',
  'The runtime must register a gdjs.registerInGameEditorPostStepCallback');

const edScene = { ...mockScene };
AL.registerSceneManager(edScene, {});
const edState = AL.stateOf(edScene);
const edObj = { getX: () => 0, getY: () => 0, getZ: () => 0, get3DRendererObject: () => null };
const edBeh = {};
AL.registerLight(edScene, edObj, edBeh, { intensity: 5.0, radius: 4.0, flickerMode: 'FireFlicker' });

// The authored intensity must be live immediately: stepLight has NOT run and never will in
// the editor, so a hardcoded currentIntensity of 1.0 would render every light at 1.0.
assert.strictEqual(edBeh.__alLight.currentIntensity, 5.0,
  'currentIntensity must be seeded from the authored Intensity, not hardcoded to 1.0');

// The callback is handed the editor, not the scene, and reads the scene off it.
const fakeEditor = { getCurrentScene: () => edScene };
registeredCallbacks.editorStep(fakeEditor);
assert.strictEqual(AL.getActiveLightCount(edScene), 1,
  'The editor step must run the broadphase so the light reaches the GPU while authoring');

// Flicker must not animate in the editor - authoring against a pulsing light is worse than
// authoring against a steady one.
assert.strictEqual(edBeh.__alLight.currentIntensity, 5.0,
  'Flicker must be pinned to the configured intensity in the editor');

// A malformed or sceneless editor must not throw into GDevelop's editor loop.
registeredCallbacks.editorStep(null);
registeredCallbacks.editorStep({});
registeredCallbacks.editorStep({ getCurrentScene: () => null });
console.log('  Passed: editor step registered, authored intensity live, flicker pinned, null-safe.');

console.log('\n--- Test 20: a default light must light a default-sized scene ---');
// Regression guard. The default Radius was once lowered from 12 m to 4 m to make a
// pathological 256-overlapping-light benchmark cheaper. Attenuation reaches EXACTLY zero at
// the radius, so that silently turned every surface past 400 world units from unlit-looking
// to genuinely unlit, and a stock "add a light to a cube" scene went black. Performance is a
// thing users tune; the default has to visibly work.
const defBeh = {};
AL.registerLight({ ...mockScene }, { getX: () => 0, getY: () => 0, getZ: () => 0, get3DRendererObject: () => null }, defBeh, {});
const defRadiusMetres = defBeh.__alLight.radius;
const defReachUnits = defRadiusMetres * 100;

// GDevelop's default 3D camera sits ~724 world units back and a character is 50-200 units
// tall, so a light that dies inside ~700 units cannot light an ordinary scene.
assert.ok(defReachUnits >= 1000,
  `The default light must reach at least 1000 world units; got ${defReachUnits} (Radius ${defRadiusMetres} m)`);

// And it must still be meaningfully bright at a typical wall distance, not merely non-zero.
const attenAtDefault = (distWorld) => {
  const dm = distWorld / 100;
  const n = Math.max(1 - Math.pow(dm / defRadiusMetres, 4), 0);
  return (n * n) / (dm * dm + 1);
};
assert.ok(attenAtDefault(600) > 0.005,
  `A default light must still register on a wall 6 m away (got ${attenAtDefault(600)})`);
assert.strictEqual(attenAtDefault(defReachUnits), 0, 'Attenuation must reach exactly 0 at the radius');
console.log(`  Passed: default Radius ${defRadiusMetres} m reaches ${defReachUnits} world units.`);

console.log('\n--- Test 21: off-centre cluster AABBs include their near plane ---');
let cameraMatrixRefreshes = 0;
const boundsCamera = {
  fov: 60, aspect: 1, near: 1, far: 1000,
  matrixWorldInverse: new THREE.Matrix4(),
  updateMatrixWorld: () => { cameraMatrixRefreshes++; }
};
const boundsScene = {
  ...mockScene,
  getLayer: () => ({ getRenderer: () => ({
    getThreeCamera: () => boundsCamera,
    getThreeScene: () => mockThreeScene
  }) })
};
AL.registerSceneManager(boundsScene, {});
registeredCallbacks.postEvents(boundsScene);
const boundsState = AL.stateOf(boundsScene);
const testK = 8;
const testI = 12;
const testJ = 6;
const nearZ = boundsState.depthSlices[testK];
const nearYTop = nearZ * Math.tan(Math.PI / 6);
const nearXRight = nearYTop;
const testX = -nearXRight + (2 * (testI + 0.5) / 16) * nearXRight;
const testY = -nearYTop + (2 * (testJ + 0.5) / 9) * nearYTop;
const boundsOffset = (testI + testJ * 16 + testK * 16 * 9) * 6;
const a = boundsState.clusterAABBs;
assert.strictEqual(AL.arvoDistanceSq(
  a[boundsOffset], a[boundsOffset + 1], a[boundsOffset + 2],
  a[boundsOffset + 3], a[boundsOffset + 4], a[boundsOffset + 5],
  testX, testY, -nearZ
), 0, 'An off-centre cluster AABB must contain the centre of its near-plane face');
assert.ok(cameraMatrixRefreshes > 0,
  'The editor step must refresh the camera matrix before packing view-space lights');
console.log('  Passed: near and far faces are bounded and the current camera matrix is used.');

console.log('\n--- Test 22: dense clusters retain 64 lights with 32-bit offsets ---');
const denseScene = { ...mockScene };
AL.registerSceneManager(denseScene, { maxLights: 128 });
const denseState = AL.stateOf(denseScene);
for (let lightNumber = 0; lightNumber < 80; lightNumber++) {
  AL.registerLight(denseScene, {
    getX: () => 0,
    getY: () => 0,
    getZ: () => -100,
    get3DRendererObject: () => null
  }, {}, { intensity: 1, radius: 50 });
}
registeredCallbacks.postEvents(denseScene);
assert.ok(denseState.clusterGridArray instanceof Uint32Array,
  'Cluster headers must use 32-bit offsets once the index stream exceeds 65,535 entries');
assert.strictEqual(AL.getMaxLightsInSingleCluster(denseScene), 64,
  'A dense cluster must retain the new 64-light budget');
assert.ok(Math.max(...denseState.clusterGridArray) > 65535,
  'The regression scene must exercise offsets beyond the old 16-bit ceiling');
console.log('  Passed: 64 lights retained and offsets safely cross the old 65,535 limit.');

console.log('\n--- Test 23: stale editor material injections are replaced ---');
const staleMaterial = makeStandardMaterial('StaleEditorWall');
const staleCompileHook = function () {};
staleMaterial.__alInjection = { probes: false, key: 'GD_ADVLIGHT3D_V2|CL1|G3D0|LP0' };
staleMaterial.onBeforeCompile = staleCompileHook;
AL.__internals.injectShaderOnMaterial(staleMaterial, mgrState, null);
assert.notStrictEqual(staleMaterial.onBeforeCompile, staleCompileHook,
  'A material injected by an older editor runtime must receive the current shader hook');
assert.strictEqual(staleMaterial.__alInjection.version, '2026.09.13.5',
  'The material injection must identify the runtime that owns its texture bindings');
assert.ok(staleMaterial.customProgramCacheKey().includes('advlight3d:GD_ADVLIGHT3D_V8|'),
  'Replacing stale bindings must force a new Three.js shader program');
console.log('  Passed: stale shader hook and frozen texture bindings replaced.');

console.log('\n--- Test 24: deprecated legacy-lights renderer API is never polled ---');
assert.ok(!runtimeCode.includes('.useLegacyLights'),
  'The runtime must not read the deprecated renderer.useLegacyLights property');
assert.ok(!runtimeCode.includes('uUseLegacyLights'),
  'The shader interface must not retain the obsolete dynamic legacy-lights uniform');
console.log('  Passed: fixed compatibility scaling avoids deprecated renderer access.');

console.log('\n--- Test 25: a Spot Cube3D adds an editor-proof decal to its forward face ---');
const authoredCubeMaterials = Array.from({ length: 6 }, (_, i) => makeStandardMaterial(`CubeFace${i}`));
const cubeMesh = new THREE.Mesh({}, authoredCubeMaterials.slice());
const spotCube = {
  // Cube3D-specific API used by the runtime to avoid touching arbitrary Model3D arrays.
  setFaceResourceName() {},
  getRenderer: () => ({ get3DRendererObject: () => cubeMesh }),
  get3DRendererObject: () => cubeMesh,
  getX: () => 0, getY: () => 0, getZ: () => 0
};
const spotCubeBehavior = {};
const spotCubeScene = { ...mockScene };
AL.registerLight(spotCubeScene, spotCube, spotCubeBehavior, { lightType: 'Spot' });
assert.strictEqual(cubeMesh.material[4], authoredCubeMaterials[4],
  'The marker must not depend on replacing Cube3D material slot 4');
assert.strictEqual(cubeMesh.children.length, 1, 'Spot must attach exactly one marker decal');
const markerDecal = cubeMesh.children[0];
assert.ok(markerDecal.material.isMeshBasicMaterial && markerDecal.material.map,
  'The direction marker must be an unlit bulb texture that remains visible in darkness');
assert.ok(markerDecal.position.z > 0.5,
  'The bulb decal must sit just above BoxGeometry front/+Z so the editor can render it');
assert.strictEqual(typeof markerDecal.raycast, 'function',
  'The marker must define a non-picking raycast hook for the editor');
for (const sideIndex of [0, 1, 2, 3, 5]) {
  assert.strictEqual(cubeMesh.material[sideIndex], authoredCubeMaterials[sideIndex],
    `Non-forward face ${sideIndex} must remain untouched`);
}

// A live object update can replace face materials. A child decal must survive and must not
// duplicate when the editor callback synchronizes it again.
const refreshedFront = makeStandardMaterial('RefreshedFront');
cubeMesh.material[4] = refreshedFront;
AL.__internals.syncSpotDirectionFace(spotCubeBehavior.__alLight);
assert.strictEqual(cubeMesh.children.length, 1,
  'The bulb decal must survive a Cube3D editor live update without duplication');
assert.strictEqual(cubeMesh.children[0], markerDecal,
  'Editor synchronization must retain the same decal mesh');
AL.updateLight(spotCubeScene, spotCube, spotCubeBehavior, { lightType: 'Point' });
assert.strictEqual(cubeMesh.children.length, 0,
  'Changing away from Spot must remove the direction decal');
assert.strictEqual(cubeMesh.material[4], refreshedFront,
  'Changing away from Spot must leave the latest authored front material untouched');
AL.updateLight(spotCubeScene, spotCube, spotCubeBehavior, { lightType: 'Spot' });
assert.strictEqual(cubeMesh.children.length, 1, 'Changing back to Spot must recreate the decal');
AL.destroyLight(spotCubeScene, spotCubeBehavior);
assert.strictEqual(cubeMesh.children.length, 0, 'Destroying the behavior must remove the decal');
assert.strictEqual(cubeMesh.material[4], refreshedFront,
  'Destroying the behavior must leave the Cube3D front material untouched');
console.log('  Passed: +Z/front decal visible, live-update-safe, non-picking and removable.');

console.log('\n--- Test 26: editor hot reload replaces a stale runtime ---');
const staleRuntime = { __runtimeVersion: 'stale-editor-build' };
gdjs.__advancedLighting3D = staleRuntime;
new Function(runtimeCode)();
assert.notStrictEqual(gdjs.__advancedLighting3D, staleRuntime,
  'Re-importing the extension must replace a stale editor runtime');
assert.strictEqual(gdjs.__advancedLighting3D.__runtimeVersion, '2026.09.13.5',
  'The replacement runtime must identify the current build');
assert.strictEqual(typeof registeredCallbacks.editorStep, 'function',
  'The replacement runtime must install its editor callback');
AL = gdjs.__advancedLighting3D;
console.log('  Passed: stale singleton replaced and editor callback refreshed.');

console.log('\n--- Test 27: Point-to-triangle squared distance (closestPointOnTriangleSq) ---');
{
  const ptDistSq = AL.__internals.closestPointOnTriangleSq;
  assert.strictEqual(typeof ptDistSq, 'function', 'closestPointOnTriangleSq must be exported in internals');

  // Triangle in XY plane at Z=0: A(0,0,0), B(10,0,0), C(0,10,0)
  // Interior query: (2, 2, 5) -> closest is (2, 2, 0), d^2 = 25
  const dInterior = ptDistSq(2, 2, 5,  0, 0, 0,  10, 0, 0,  0, 10, 0);
  assert.ok(Math.abs(dInterior - 25.0) < 1e-5, `Interior point distance expected 25, got ${dInterior}`);

  // Vertex query: (-3, -4, 0) -> closest is A(0, 0, 0), d^2 = 9 + 16 = 25
  const dVertex = ptDistSq(-3, -4, 0,  0, 0, 0,  10, 0, 0,  0, 10, 0);
  assert.ok(Math.abs(dVertex - 25.0) < 1e-5, `Vertex region distance expected 25, got ${dVertex}`);

  // Edge AB query: (5, -4, 0) -> closest is (5, 0, 0), d^2 = 16
  const dEdgeAB = ptDistSq(5, -4, 0,  0, 0, 0,  10, 0, 0,  0, 10, 0);
  assert.ok(Math.abs(dEdgeAB - 16.0) < 1e-5, `Edge AB distance expected 16, got ${dEdgeAB}`);

  // Edge AC query: (-3, 5, 0) -> closest is (0, 5, 0), d^2 = 9
  const dEdgeAC = ptDistSq(-3, 5, 0,  0, 0, 0,  10, 0, 0,  0, 10, 0);
  assert.ok(Math.abs(dEdgeAC - 9.0) < 1e-5, `Edge AC distance expected 9, got ${dEdgeAC}`);

  // Edge BC query: (8, 8, 0) -> closest is on hypotenuse x + y = 10 at (5, 5, 0), d^2 = (8-5)^2 + (8-5)^2 = 18
  const dEdgeBC = ptDistSq(8, 8, 0,  0, 0, 0,  10, 0, 0,  0, 10, 0);
  assert.ok(Math.abs(dEdgeBC - 18.0) < 1e-5, `Edge BC distance expected 18, got ${dEdgeBC}`);

  console.log('  Passed: Ericson Voronoi feature region tests are exact.');
}

console.log('\n--- Test 28: Felzenszwalb 1D EDT and Separable 3D EDT exactness ---');
{
  const felz1D = AL.__internals.felzenszwalb1D;
  const run3DEDT = AL.__internals.run3DEDT;
  assert.strictEqual(typeof felz1D, 'function', 'felzenszwalb1D must be exported in internals');
  assert.strictEqual(typeof run3DEDT, 'function', 'run3DEDT must be exported in internals');

  // 1D test: f = [1e20, 0, 1e20, 1e20, 1e20]
  const n = 5;
  const f = new Float32Array([1e20, 0, 1e20, 1e20, 1e20]);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  felz1D(f, d, v, z, n);
  const expected1D = [1, 0, 1, 4, 9];
  for (let i = 0; i < n; i++) {
    assert.strictEqual(d[i], expected1D[i], `1D EDT at index ${i} expected ${expected1D[i]}, got ${d[i]}`);
  }

  // 3D test: 8x8x8 grid with one seed at (3, 3, 3) = 0
  const S = 8;
  const grid = new Float32Array(S * S * S);
  grid.fill(1e20);
  grid[(3 * S + 3) * S + 3] = 0; // index for (3, 3, 3)

  run3DEDT(grid, S, S, S);

  // Center must be 0
  assert.strictEqual(grid[(3 * S + 3) * S + 3], 0.0, 'Center voxel must be 0');

  // Axis query (3, 3, 5) -> dist = 2.0
  const dAxis = grid[(5 * S + 3) * S + 3];
  assert.ok(Math.abs(dAxis - 2.0) < 1e-5, `Axis query expected 2.0, got ${dAxis}`);

  // Diagonal query (4, 5, 5) -> dist = sqrt((4-3)^2 + (5-3)^2 + (5-3)^2) = sqrt(1 + 4 + 4) = 3.0
  const dDiag = grid[(5 * S + 5) * S + 4];
  assert.ok(Math.abs(dDiag - 3.0) < 1e-5, `Diagonal query expected 3.0, got ${dDiag}`);

  console.log('  Passed: Felzenszwalb O(n) parabolic envelope and 3D Euclidean distances are exact.');
}

console.log('\n--- Test 29: SDF Binary format (.sdf.bin) round-trip and validation ---');
{
  const exportSDFBinary = AL.__internals.exportSDFBinary;
  const loadSDFBinary = AL.__internals.loadSDFBinary;
  assert.strictEqual(typeof exportSDFBinary, 'function', 'exportSDFBinary must be exported');
  assert.strictEqual(typeof loadSDFBinary, 'function', 'loadSDFBinary must be exported');

  const testScene = { ...mockScene };
  const mockSDFObject = {
    getX: () => 100, getY: () => 200, getZ: () => 300,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 500,
    getRenderer: () => null,
    getDepth: () => 500
  };
  const sdfBehavior = {};
  const vol = AL.registerSDFVolume(testScene, mockSDFObject, sdfBehavior, { resX: 16, resY: 16, resZ: 8 });
  assert.ok(vol, 'SDF volume must be registered');

  // Set known test distances in vol.data
  const totalVoxels = 16 * 16 * 8;
  for (let i = 0; i < totalVoxels; i++) {
    vol.data[i] = AL.toHalf(i * 0.25);
  }

  const bin = exportSDFBinary(vol);
  assert.ok(bin instanceof ArrayBuffer, 'exportSDFBinary must return an ArrayBuffer');
  assert.strictEqual(bin.byteLength, 56 + totalVoxels * 2, 'File size must match 56-byte header + payload');

  const view = new DataView(bin);
  // Magic: SDF3
  assert.strictEqual(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'SDF3');
  assert.strictEqual(view.getUint32(4, true), 1, 'Version must be 1');
  assert.strictEqual(view.getUint32(8, true), 16, 'ResX must be 16');
  assert.strictEqual(view.getUint32(12, true), 16, 'ResY must be 16');
  assert.strictEqual(view.getUint32(16, true), 8, 'ResZ must be 8');
  assert.strictEqual(view.getUint8(20), 0, 'Encoding must be 0 (R16F)');

  // Corrupt file rejection
  assert.strictEqual(loadSDFBinary(testScene, new ArrayBuffer(40)), false, 'Truncated header rejected');
  const badMagic = new ArrayBuffer(56 + totalVoxels * 2);
  assert.strictEqual(loadSDFBinary(testScene, badMagic), false, 'Invalid magic rejected');

  // Round trip load
  const loaded = loadSDFBinary(testScene, bin);
  assert.strictEqual(loaded, true, 'Valid SDF binary must load cleanly');
  assert.strictEqual(vol.isBaked, true, 'Volume isBaked must be set to true');
  assert.strictEqual(vol.boundsLocked, true, 'Volume boundsLocked must be set to true');
  assert.strictEqual(vol.resX, 16);
  assert.strictEqual(vol.resY, 16);
  assert.strictEqual(vol.resZ, 8);
  assert.strictEqual(AL.fromHalf(vol.data[10]), 2.5, 'Loaded distance values must match original half-floats');

  console.log('  Passed: .sdf.bin 56-byte header, R16F payload round-trip and validation verified.');
}

console.log('\n--- Test 30: SDF Material Program Cache Key and Shader Defines ---');
{
  const testScene = { ...mockScene };
  const state = AL.stateOf(testScene);
  const mat = makeStandardMaterial('SDFTestMat');

  // Without SDF:
  AL.setShadowMode(testScene, 'Off');
  state.sdfVolume = null;
  AL.__internals.injectShaderOnMaterial(mat, state, null);
  const keyNoSDF = mat.customProgramCacheKey();
  assert.strictEqual(keyNoSDF.includes('|SDF1'), false, 'Program cache key without SDF must not contain |SDF1');

  // With SDF active:
  AL.setShadowMode(testScene, 'Auto');
  state.sdfVolume = {
    texture: {},
    isBaked: true,
    threeMin: new THREE.Vector3(0, 0, 0),
    threeSize: new THREE.Vector3(100, 100, 100),
    resX: 16, resY: 16, resZ: 8, voxelSize: 6.25,
    maxX: 100, minX: 0
  };
  mat.__alInjection = null; // force re-inject
  AL.__internals.injectShaderOnMaterial(mat, state, null);
  const keyWithSDF = mat.customProgramCacheKey();
  assert.ok(keyWithSDF.includes('|SDF1'), `Program cache key with SDF must end with |SDF1, got ${keyWithSDF}`);

  // Test shader defines and uniforms in onBeforeCompile
  const mockShader = {
    fragmentShader: '#include <lights_fragment_begin>\nvoid main() {}',
    vertexShader: '#include <worldpos_vertex>\nvoid main() {}',
    defines: {},
    uniforms: {}
  };
  mat.onBeforeCompile(mockShader);
  assert.strictEqual(mockShader.defines.AL_SDF_SHADOWS, 1, 'AL_SDF_SHADOWS define must be set to 1');
  assert.ok(mockShader.uniforms.uSdfVolume, 'uSdfVolume uniform must be declared');
  assert.ok(mockShader.uniforms.uSdfMin, 'uSdfMin uniform must be declared');
  assert.ok(mockShader.uniforms.uSdfSize, 'uSdfSize uniform must be declared');
  assert.ok(mockShader.uniforms.uSdfParams, 'uSdfParams uniform must be declared');
  assert.ok(mockShader.uniforms.uViewToWorld, 'uViewToWorld uniform must be declared');
  assert.ok(mockShader.uniforms.uMaxShadowedLights, 'uMaxShadowedLights uniform must be declared');
  assert.ok(mockShader.uniforms.uPointShadowDistance, 'uPointShadowDistance uniform must be declared');

  console.log('  Passed: SDF program cache key (|SDF1), AL_SDF_SHADOWS define and uniforms confirmed.');
}

console.log('\n--- Test 31: 4th Texel Light Data Packing (Shadow Flag and Source Radius) ---');
{
  const testScene = { ...mockScene };
  const mockCam = {
    fov: 60, aspect: 16 / 9, near: 0.1, far: 1000.0,
    matrixWorldInverse: new THREE.Matrix4(),
    matrixWorld: new THREE.Matrix4(),
    updateMatrixWorld: () => {}
  };
  testScene.getLayer = () => ({
    getRenderer: () => ({
      getThreeCamera: () => mockCam,
      getThreeScene: () => null
    })
  });

  const state = AL.registerSceneManager(testScene);
  const lightObj = {
    getX: () => 0, getY: () => 0, getZ: () => 50,
    getRenderer: () => null
  };
  const lightBeh = {};
  AL.registerLight(testScene, lightObj, lightBeh, {
    lightType: 'Point',
    radius: 10.0,
    castShadow: true,
    shadowBias: 0.25,
    sourceRadius: 25.0
  });

  AL.doStepPostEvents(testScene);

  // Check 4th texel floats (indices 12..15 for light 0)
  const shadowData = state.lightDataArray[14];
  const srcRadius = state.lightDataArray[15];
  // shape.z = castFlag + bias/SHADOW_BIAS_ENCODE_SCALE. The bias is scaled down on pack and back up
  // in the shader so the fractional part can express more than one voxel: packing it raw capped the
  // usable range at 0.999, and anything larger was silently discarded.
  const BIAS_SCALE = 10.0;
  assert.strictEqual(Math.floor(shadowData), 1, 'shape.z must pack the cast flag in its integer part');
  assert.ok(Math.abs((shadowData % 1) * BIAS_SCALE - 0.25) < 1e-5,
    `shape.z fraction must decode to the configured bias (got ${(shadowData % 1) * BIAS_SCALE})`);
  // A bias well above 1 voxel must survive the round trip - this is what used to be clamped away.
  AL.updateLight(testScene, lightObj, lightBeh, { shadowBias: 3 });
  AL.doStepPostEvents(testScene);
  const bigBias = state.lightDataArray[14];
  assert.ok(Math.abs((bigBias % 1) * BIAS_SCALE - 3) < 1e-4,
    `a ShadowBias of 3 must decode as 3 voxels, not clamp to 0.999 (got ${(bigBias % 1) * BIAS_SCALE})`);
  AL.updateLight(testScene, lightObj, lightBeh, { shadowBias: 0.25 });
  AL.doStepPostEvents(testScene);
  assert.strictEqual(srcRadius, 25.0, 'Source radius (shape.w) must match configured sourceRadius');

  // Toggle shadow off
  AL.updateLight(testScene, lightObj, lightBeh, { castShadow: false });
  AL.doStepPostEvents(testScene);
  assert.strictEqual(Math.floor(state.lightDataArray[14]), 0, 'Disabling casts must clear the integer flag');
  assert.ok(Math.abs(state.lightDataArray[14] * BIAS_SCALE - 0.25) < 1e-5,
    'Disabling casts must leave the encoded bias fraction intact');

  console.log('  Passed: 4th texel shadow flag, per-light bias and source radius packing verified.');
}

console.log('\n--- Test 32: SDF Volume Lifecycle, Scene Cleanup and Diagnostics ---');
{
  const testScene = { ...mockScene };
  const mockSDFObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1600, getHeight: () => 1600, getDepth: () => 400,
    getRenderer: () => null,
    getZ: () => 0, getDepth: () => 400
  };
  const beh = {};
  const vol = AL.registerSDFVolume(testScene, mockSDFObj, beh, { resX: 32, resY: 32, resZ: 16 });
  assert.ok(vol, 'SDF volume must be registered');
  assert.strictEqual(AL.getSDFVoxelCount(testScene), 32 * 32 * 16, 'Voxel count must match product of dimensions');
  assert.strictEqual(AL.getSDFVRAMBytes(testScene), 32 * 32 * 16 * 2, 'VRAM bytes must be 2 bytes per voxel');
  assert.strictEqual(AL.isSDFVolumeLoaded(testScene), true, 'Volume texture must be allocated');

  // Cleanup
  registeredCallbacks.unloaded(testScene);
  const stateAfter = AL.stateOf(testScene);
  assert.strictEqual(stateAfter.sdfVolume, null, 'sdfVolume must be null after scene cleanup');
  assert.strictEqual(stateAfter.dummySdfTexture, null, 'dummySdfTexture must be null after scene cleanup');

  console.log('  Passed: SDF volume lifecycle, VRAM metrics and scene teardown verified.');
}


console.log('--- Regression: SDF activation, shadow modes and receiver variants ---');
{
  const scene = { ...mockScene };
  const state = AL.registerSceneManager(scene);
  const behavior = {};
  const volume = AL.registerSDFVolume(scene, {}, behavior, {resX:8,resY:8,resZ:4});
  const material = {isMeshStandardMaterial:true};
  const receiver = {normalBias:1};
  AL.__internals.injectShaderOnMaterial(material, state, receiver);
  assert.strictEqual(material.__alInjection.sdf, false, 'Unbaked volumes must not enable shadows');
  volume.isBaked = true;
  AL.doStepPostEvents(scene);
  assert.strictEqual(material.__alInjection.sdf, true, 'Bake completion must refresh existing materials');
  assert.strictEqual(material.__alInjection.probes, true, 'Refresh must preserve probe receivers');
  AL.setShadowMode(scene, 'Off');
  AL.doStepPostEvents(scene);
  assert.strictEqual(material.__alInjection.sdf, false);
  AL.setShadowMode(scene, 'Auto');
  AL.doStepPostEvents(scene);
  assert.strictEqual(material.__alInjection.sdf, true);
  AL.disposeSDFVolume(scene, behavior);
  AL.doStepPostEvents(scene);
  assert.strictEqual(material.__alInjection.sdf, false, 'Deleted volumes must disable their shader variant');
}
console.log('--- Regression: finite unbaked and empty baked SDF values ---');
{
  const scene = { ...mockScene };
  const volume = AL.registerSDFVolume(scene, {}, {}, {resX:8,resY:8,resZ:4});
  assert.ok([...volume.data].every(h => Number.isFinite(AL.fromHalf(h))));
  assert.ok(AL.startSDFBake(scene));
  for(let i=0;i<100 && !AL.isSDFBakeComplete(scene);i++) AL.doStepPostEvents(scene);
  assert.ok(AL.isSDFBakeComplete(scene));
  assert.ok([...volume.data].every(h => Number.isFinite(AL.fromHalf(h))));
}
console.log('--- Regression: anisotropic EDT matches brute force world distances ---');
{
  const [nx,ny,nz]=[4,5,3], spacing=[2,5,0.5];
  const grid=new Float32Array(nx*ny*nz).fill(1e20);
  const seeds=[[0,1,1,0.25],[3,4,0,1.5]];
  for(const [x,y,z,d] of seeds)grid[(z*ny+y)*nx+x]=d;
  AL.__internals.run3DEDT(grid,nx,ny,nz,...spacing);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const expected=Math.sqrt(Math.min(...seeds.map(([sx,sy,sz,d])=>d+((x-sx)*spacing[0])**2+((y-sy)*spacing[1])**2+((z-sz)*spacing[2])**2)));
    assert.ok(Math.abs(grid[(z*ny+y)*nx+x]-expected)<1e-5);
  }
}
console.log('--- Regression: directional shadows are evaluated before native BRDF ---');
{
  const scene={...mockScene}; AL.setShadowMode(scene,'Auto'); AL.setSunShadows(scene,'DistanceField'); const state=AL.registerSceneManager(scene);
  const volume=AL.registerSDFVolume(scene,{},{}, {resX:8,resY:8,resZ:4});volume.isBaked=true;
  const previous=THREE.ShaderChunk;
  THREE.ShaderChunk={lights_fragment_begin:'getDirectionalLightInfo( directionalLight, directLight );\nRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'};
  const material={isMeshStandardMaterial:true};
  AL.__internals.injectShaderOnMaterial(material,state,null);
  const shader={uniforms:{},vertexShader:'',fragmentShader:'#include <lights_fragment_begin>'};
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('length(uSdfSize), uSdfParams.w, 32)'));
  assert.ok(shader.fragmentShader.indexOf('directLight.color *= sdfShadow') < shader.fragmentShader.indexOf('RE_Direct('));
  THREE.ShaderChunk=previous;
}

console.log('\n--- Regression: auto-bake survives the instance settling after onCreated ---');
{
  // The bug: registerSDFVolume runs in onCreated, where a placed instance still reports the
  // object's DEFAULT size. Auto-bake fired there and snapshotted a bounds signature from that
  // wrong size. On the first step the real size landed, syncSDFVolumeBoundsFromObject rewrote the
  // bounds, stepSDFBake saw the signature change and cancelled — discarding sdfBakeState, with
  // `bakedOnce` already true so nothing retried. SDFBakeProgress() then read exactly 0.000 forever,
  // AL_SDF_SHADOWS was never defined, and SDF shadows silently did not exist.
  const scene = { ...mockScene };
  let settled = false;              // mimics a placed instance whose size lands on the first step
  const obj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => (settled ? 400 : 100),
    getHeight: () => (settled ? 400 : 100),
    getDepth: () => (settled ? 200 : 100),
    getRenderer: () => null,
  };
  const beh = {};
  const opts = { resX: 8, resY: 8, resZ: 4, autoBakeOnStart: true };

  const vol = AL.registerSDFVolume(scene, obj, beh, opts);
  beh.__alSdfVolume = vol;

  assert.strictEqual(AL.isSDFBakeInProgress(scene), false,
    'onCreated must NOT start the bake: the instance size has not landed yet');
  assert.strictEqual(vol.autoBakePending, true, 'the auto-bake must be queued instead');

  settled = true;
  AL.updateSDFVolume(scene, obj, beh, opts);

  assert.strictEqual(AL.isSDFBakeInProgress(scene), true,
    'the deferred auto-bake must start on the first step');
  assert.strictEqual(vol.boundsLocked, true, 'starting a bake must freeze the bounds');
  assert.strictEqual(vol.maxX, 400,
    'the frozen bounds must come from the SETTLED size, not the creation-time default');

  obj.getX = () => 777;             // the cube keeps moving; this used to kill the bake
  AL.updateSDFVolume(scene, obj, beh, opts);
  assert.strictEqual(vol.minX, 0, 'a locked volume must ignore later cube movement');
  assert.strictEqual(AL.isSDFBakeInProgress(scene), true,
    'the bake must survive the authoring cube moving mid-bake');

  for (let i = 0; i < 400 && AL.isSDFBakeInProgress(scene); i++) AL.__internals.stepSDFBake(scene);
  assert.ok(AL.getSDFBakeProgress(scene) > 0,
    `bake progress must leave 0.000 (got ${AL.getSDFBakeProgress(scene)})`);
  console.log('  Passed: deferred auto-bake, frozen bounds, survives movement, progress advances.');
}

console.log('\n--- Regression: re-baking after moving the cube re-fits bounds ---');
{
  const scene = { ...mockScene };
  let x = 0;
  const obj = {
    getX: () => x, getY: () => 0, getZ: () => 0,
    getWidth: () => 100, getHeight: () => 100, getDepth: () => 100,
    getRenderer: () => null,
  };
  const beh = {};
  const vol = AL.registerSDFVolume(scene, obj, beh, { resX: 8, resY: 8, resZ: 4 });
  vol.object = obj;

  AL.startSDFBake(scene);
  assert.strictEqual(vol.boundsLockSource, 'bake');
  assert.strictEqual(vol.minX, 0);

  AL.cancelSDFBake(scene);
  x = 500;
  AL.startSDFBake(scene);
  assert.strictEqual(vol.minX, 500,
    'a re-bake must re-fit to the moved cube, not stay pinned by the previous bake lock');

  AL.cancelSDFBake(scene);
  AL.setSDFVolumeBounds(scene, -10, -10, -10, 10, 10, 10);
  assert.strictEqual(vol.boundsLockSource, 'explicit');
  x = 9999;
  AL.startSDFBake(scene);
  assert.strictEqual(vol.minX, -10, 'explicitly set bounds must survive a later bake untouched');
  console.log('  Passed: re-bake re-fits, explicit bounds are respected.');
}

console.log('\n--- Regression: the shadow manager owns every scene-level shadow setting ---');
{
  // Choosing a shadow method in the manager but then having to hunt for that method's tuning in
  // event actions is the gap this closes. Declaring the properties is not enough — they have to
  // reach the runtime state, which is what this asserts.
  const scene = { ...mockScene };
  const beh = {};
  AL.registerShadowManager(scene, beh, {
    mode: 'Auto', sunShadows: 'DistanceField',
    count: 3, distance: 25000, lambda: 0.75, mapSize: 2048, blend: 0.1, softness: 1.5,
    bias: 0.0005, normalBias: 0.02,
    maxShadowedLights: 2, pointShadowDistance: 1234, sdfSunSoftness: 3.5,
    sdfHitEps: 0.25, sdfNormalBias: 2.5,
    maxShadowMappedLights: 3, maxShadowMapUpdatesPerFrame: 1,
  });

  const st = AL.stateOf(scene);
  assert.strictEqual(AL.shadowState(scene).mode, 'Auto', 'the manager must select shadow ownership');
  assert.strictEqual(AL.shadowState(scene).sunShadows, 'DistanceField', 'the manager must select the Sun shadow method');
  assert.strictEqual(st.maxShadowedLights, 2, 'SDF: max shadowed lights must apply');
  assert.strictEqual(st.pointShadowDistance, 1234, 'SDF: max ray distance must apply');
  assert.strictEqual(st.sdfSunSoftness, 3.5, 'SDF: sun softness must apply');
  assert.strictEqual(st.sdfHitEps, 0.25, 'SDF: hit threshold must apply');
  assert.strictEqual(st.sdfNormalBias, 2.5, 'SDF: sun normal bias must apply');

  const ls = AL.__internals.localShadowStateOf(scene);
  assert.strictEqual(ls.maxLights, 3, 'Maps: memory budget must apply');
  assert.strictEqual(ls.maxUpdatesPerFrame, 1, 'Maps: per-frame update budget must apply');

  // Clamps hold, so a nonsense inspector value cannot put the runtime in a bad state.
  AL.registerShadowManager(scene, beh, { mode: 'Maps', maxShadowMappedLights: 99,
    maxShadowMapUpdatesPerFrame: 0, maxShadowedLights: -5 });
  assert.ok(ls.maxLights <= 8, 'Maps budget must clamp to the slot cap');
  assert.ok(ls.maxUpdatesPerFrame >= 1, 'update budget must stay at least 1');
  assert.strictEqual(AL.stateOf(scene).maxShadowedLights, 0, 'negative SDF budget must clamp to 0');

  console.log('  Passed: mode, SDF tuning and shadow-map budgets all reach the runtime.');
}

console.log('\nALL 35 ADVANCED LIGHTING 3D UNIT TESTS PASSED CLEANLY (clustered + light probes + SDF shadows)!\n');
