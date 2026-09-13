/**
 * test-runtime.mjs
 * Comprehensive unit test suite for AdvancedWeather3D runtime engine.
 *
 * Run: node AdvancedWeather3D/test-runtime.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'AdvancedWeather3D.runtime.js'), 'utf8');
const extensionData = JSON.parse(fs.readFileSync(path.join(here, 'AdvancedWeather3D.json'), 'utf8'));

// --- Mock Three.js & GDevelop Environment ---
let dummyIdCounter = 0;

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  setFromMatrixPosition(m) { return this; }
  normalize() { return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  fromArray(arr) { this.x = arr[0]; this.y = arr[1]; this.z = arr[2]; return this; }
}

class MockQuaternion {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  setFromUnitVectors(v1, v2) { return this; }
}

class MockObject3D {
  constructor() {
    this.id = ++dummyIdCounter;
    this.position = new MockVector3();
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.quaternion = new MockQuaternion();
    this.scale = new MockVector3(1, 1, 1);
    this.matrix = { elements: new Float32Array(16) };
    this.children = [];
    this.parent = null;
    this.visible = true;
  }
  add(child) {
    this.children.push(child);
    child.parent = this;
  }
  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
  }
  updateMatrix() {}
  getWorldDirection(v) { if (v) v.set(0, 0, -1); return v; }
  traverse(cb) {
    cb(this);
    for (const c of this.children) {
      if (c && c.traverse) c.traverse(cb);
    }
  }
}

class MockInstancedMesh extends MockObject3D {
  constructor(geometry, material, count) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.count = count;
    this.matrices = new Array(count).fill(null);
    this.instanceMatrix = {
      setUsage() {},
      needsUpdate: false
    };
  }
  setMatrixAt(idx, mat) {
    this.matrices[idx] = mat;
  }
}

class MockColor {
  constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
}

class MockMaterial {
  constructor(opts = {}) {
    this.color = opts.color || new MockColor();
    this.opacity = opts.opacity !== undefined ? opts.opacity : 1.0;
    this.transparent = !!opts.transparent;
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : true;
    this.depthTest = opts.depthTest !== undefined ? opts.depthTest : true;
    this.blending = opts.blending || 1;
    this.side = opts.side || 0;
    this.uniforms = opts.uniforms || {};
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

class MockGeometry {
  constructor() {
    this.attributes = {};
    this.disposed = false;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  setIndex(idx) { this.index = idx; }
  computeVertexNormals() {}
  dispose() { this.disposed = true; }
}

class MockMesh extends MockObject3D {
  constructor(geom, mat) {
    super();
    this.geometry = geom;
    this.material = mat;
  }
}

globalThis.THREE = {
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  Object3D: MockObject3D,
  Mesh: MockMesh,
  InstancedMesh: MockInstancedMesh,
  MeshBasicMaterial: MockMaterial,
  ShaderMaterial: MockMaterial,
  BufferGeometry: MockGeometry,
  RingGeometry: class extends MockGeometry {},
  BoxGeometry: class extends MockGeometry {
    constructor(w, h, d) {
      super();
      this.parameters = { width: w, height: h, depth: d };
    }
  },
  WireframeGeometry: class extends MockGeometry {},
  LineBasicMaterial: MockMaterial,
  LineSegments: class extends MockObject3D {
    constructor(geom, mat) { super(); this.geometry = geom; this.material = mat; }
  },
  PointLight: class extends MockObject3D {
    constructor(color, intensity, distance) {
      super();
      this.color = color;
      this.intensity = intensity;
      this.distance = distance;
    }
  },
  BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  },
  Color: MockColor,
  DynamicDrawUsage: 35048,
  DoubleSide: 2,
  BackSide: 1,
  NormalBlending: 1,
  AdditiveBlending: 2
};

globalThis.gdjs = {
  hexToRGBColor: (hex) => [200, 220, 240]
};

// Evaluate runtime code
new Function(runtimeCode)();
const AW = globalThis.gdjs.__advancedWeather3D;

console.log('=== Starting AdvancedWeather3D Runtime Tests ===\n');

function createMockScene() {
  const threeGroup = new MockObject3D();
  const camera = new MockObject3D();
  camera.position.set(500, -300, 200);

  return {
    _elapsed: 16.6667,
    getElapsedTime() { return this._elapsed; },
    getLayer(layerName) {
      return {
        getRenderer() {
          return {
            getThreeGroup() { return threeGroup; },
            getThreeCamera() { return camera; }
          };
        }
      };
    },
    _threeGroup: threeGroup,
    _camera: camera
  };
}

function createMock3DBox(name, x, y, z, width, height, depth) {
  const root = new MockObject3D();
  root.visible = true;

  return {
    _name: name,
    _x: x, _y: y, _z: z,
    _w: width, _h: height, _d: depth,
    _layer: '',
    _hidden: false,
    getName() { return this._name; },
    getX() { return this._x; },
    getY() { return this._y; },
    getZ() { return this._z; },
    getWidth() { return this._w; },
    getHeight() { return this._h; },
    getDepth() { return this._d; },
    getLayer() { return this._layer; },
    isHidden() { return this._hidden; },
    get3DRendererObject() { return root; },
    _rootObject: root
  };
}

let testCount = 0;
function test(name, fn) {
  testCount++;
  try {
    fn();
    console.log(`✓ Test ${testCount}: ${name}`);
  } catch (err) {
    console.error(`✗ Test ${testCount} FAILED: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ------------------------------------------------------------- Test Cases

test('Generated extension metadata includes every modular behavior', () => {
  assert.strictEqual(extensionData.name, 'AdvancedWeather3D');
  assert.strictEqual(extensionData.version, '1.3.0');
  assert.deepStrictEqual(
    extensionData.eventsBasedBehaviors.map(behavior => behavior.name),
    [
      'RainVolume3D', 'SnowVolume3D', 'ClusteredFogVolume3D', 'HailVolume3D',
      'EmbersVolume3D', 'DustVolume3D', 'WeatherVolume3D', 'WeatherShelter3D'
    ]
  );
  const dust = extensionData.eventsBasedBehaviors.find(behavior => behavior.name === 'DustVolume3D');
  assert(dust.propertyDescriptors.some(property => property.name === 'EnableDustHaze'));
  assert(dust.eventsFunctions.some(fn => fn.name === 'SetDustHazeEnabled'));
  const fog = extensionData.eventsBasedBehaviors.find(behavior => behavior.name === 'ClusteredFogVolume3D');
  assert(fog.propertyDescriptors.some(property => property.name === 'FogQuality'));
  const hail = extensionData.eventsBasedBehaviors.find(behavior => behavior.name === 'HailVolume3D');
  assert(hail.eventsFunctions.some(fn => fn.name === 'TriggerLightningFlash'));
  const rain = extensionData.eventsBasedBehaviors.find(behavior => behavior.name === 'RainVolume3D');
  assert(rain.propertyDescriptors.some(property => property.name === 'RippleStyle'));
  assert(rain.eventsFunctions.some(fn => fn.name === 'SetRippleStyle'));
});

test('Runtime initialization and singleton presence', () => {
  assert(AW, 'AdvancedWeather3D singleton is mounted on gdjs');
  assert.strictEqual(typeof AW.registerWeatherVolume, 'function');
  assert.strictEqual(typeof AW.stepWeatherVolume, 'function');
  assert.strictEqual(typeof AW.disposeWeatherVolume, 'function');
});

test('Weather volume registration with defaults (Rain)', () => {
  const scene = createMockScene();
  const box = createMock3DBox('RainBox', 100, 200, 50, 1200, 800, 500);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain'
  });

  assert(vol, 'Volume registered');
  assert.strictEqual(vol.weatherType, 'Rain');
  assert.strictEqual(vol.bounds.width, 1200);
  assert.strictEqual(vol.bounds.height, 800);
  assert.strictEqual(vol.bounds.depth, 500);
  assert.strictEqual(vol.bounds.minX, 100, 'Authored bounds are resolved before particles are seeded');
  assert(vol.particles.capacity > 0, 'Particles allocated');
  assert(vol.splashes.capacity > 0, 'Splashes allocated');
  assert(vol.mesh, 'Three.js InstancedMesh created');
  assert(scene._threeGroup.children.includes(vol.mesh), 'Mesh added to scene');
  assert(vol.splashMesh, 'Splash mesh created');
  assert(vol.mesh.matrices.every(matrix => matrix !== null),
    'Particle instance transforms are initialized before the first simulation step');
  assert(vol.splashMesh.matrices.every(matrix => matrix !== null),
    'Inactive ripple transforms are hidden before the first simulation step');
});

test('Volume step updates bounding box and hides host cube mesh', () => {
  const scene = createMockScene();
  const box = createMock3DBox('RainBox', 150, 250, 40, 1000, 1000, 600);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    hideHostMesh: true
  });

  assert.strictEqual(box._rootObject.visible, true);

  AW.stepWeatherVolume(scene, box, behavior);

  assert.strictEqual(box._rootObject.visible, false, 'Host 3D cube mesh hidden');
  assert.strictEqual(vol.bounds.minX, 150);
  assert.strictEqual(vol.bounds.maxX, 1150);
  assert.strictEqual(vol.bounds.minY, 250);
  assert.strictEqual(vol.bounds.maxY, 1250);
  assert.strictEqual(vol.bounds.minZ, 40);
  assert.strictEqual(vol.bounds.maxZ, 640);
});

test('FollowCamera volume mode centers on active camera', () => {
  const scene = createMockScene();
  const box = createMock3DBox('InfiniteStorm', 0, 0, 0, 2000, 2000, 800);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    volumeMode: 'FollowCamera'
  });

  AW.stepWeatherVolume(scene, box, behavior);

  assert.strictEqual(vol.bounds.centerX, 500);
  assert.strictEqual(vol.bounds.centerY, 300);
  assert.strictEqual(vol.bounds.minX, 500 - 1000);
  assert.strictEqual(vol.bounds.maxX, 500 + 1000);
  assert.strictEqual(vol.bounds.minY, 300 - 1000);
  assert.strictEqual(vol.bounds.maxY, 300 + 1000);
});

test('Particle simulation steps, integrates velocity, and recycles at floor boundary', () => {
  const scene = createMockScene();
  const box = createMock3DBox('DropSim', 0, 0, 0, 500, 500, 300);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    particleDensity: 20,
    particleSpeed: 1000.0,
    windSpeed: 50.0,
    windDirection: 0.0
  });

  AW.stepWeatherVolume(scene, box, behavior);

  vol.particles.pos[0] = 250;
  vol.particles.pos[1] = 250;
  vol.particles.pos[2] = 2.0;

  scene._elapsed = 50;
  AW.stepWeatherVolume(scene, box, behavior);

  assert.strictEqual(vol.particles.pos[2], 300, 'Particle recycled to maxZ ceiling');
  assert(vol.splashes.activeCount > 0, 'Floor impact triggered splash');
});

test('Splash expansion and decay lifecycle', () => {
  const scene = createMockScene();
  const box = createMock3DBox('SplashSim', 0, 0, 0, 500, 500, 300);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    particleSpeed: 0,
    splashLifetime: 0.2,
    splashSize: 20.0
  });

  AW.stepWeatherVolume(scene, box, behavior);

  for (let s = 0; s < vol.splashes.capacity; s++) vol.splashes.active[s] = 0;

  const splashIdx = vol.splashes.head;
  AW._spawnSplash(vol, 100, 100, 0.1);
  assert.strictEqual(vol.splashes.active[splashIdx], 1);
  assert.strictEqual(vol.splashes.life[splashIdx], 0);

  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(vol.splashes.active[splashIdx], 1);
  assert(vol.splashes.life[splashIdx] > 0.08);

  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(vol.splashes.active[splashIdx], 0, 'Splash expired and deactivated');
});

test('WeatherShelter3D blocks raindrops from reaching interior floor', () => {
  const scene = createMockScene();
  const weatherBox = createMock3DBox('CourtyardRain', 0, 0, 0, 1000, 1000, 800);
  const weatherBeh = {};

  const vol = AW.registerWeatherVolume(scene, weatherBox, weatherBeh, {
    weatherType: 'Rain',
    particleDensity: 10
  });
  AW.stepWeatherVolume(scene, weatherBox, weatherBeh);

  const roofBox = createMock3DBox('GazeboRoof', 200, 200, 300, 400, 400, 50);
  const shelterBeh = {};

  const shelter = AW.registerShelter(scene, roofBox, shelterBeh, {
    enabled: true,
    splashOnRoof: true
  });

  assert(shelter, 'Shelter registered');
  assert.strictEqual(shelter.bounds.minX, 200);
  assert.strictEqual(shelter.bounds.maxX, 600);
  assert.strictEqual(shelter.bounds.minZ, 300);
  assert.strictEqual(shelter.bounds.maxZ, 350);

  vol.particles.pos[0] = 300;
  vol.particles.pos[1] = 300;
  vol.particles.pos[2] = 352.0;

  scene._elapsed = 10;
  AW.stepWeatherVolume(scene, weatherBox, weatherBeh);

  assert.strictEqual(vol.particles.pos[2], 800, 'Drop intercepted by shelter roof and recycled');

  AW.disposeShelter(scene, shelterBeh);
  assert.strictEqual(AW.getSceneState(scene).shelters.length, 0, 'Shelter disposed');
});

test('Thunderstorm lightning flash engine', () => {
  const scene = createMockScene();
  const box = createMock3DBox('StormArea', 0, 0, 0, 500, 500, 500);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    enableLightning: true
  });

  assert.strictEqual(vol.lightningActive, false);
  assert.strictEqual(vol.lightningBrightness, 0.0);

  AW.triggerLightningFlash(scene, behavior);
  assert.strictEqual(vol.lightningActive, true);
  assert.strictEqual(vol.lightningBrightness, 1.0);
  assert.strictEqual(vol.timeSinceLastLightning, 0.0);

  scene._elapsed = 50;
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(vol.lightningActive, true);
  assert(vol.lightningBrightness > 0.5);

  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  scene._elapsed = 100;
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(vol.lightningActive, false, 'Lightning flash concluded');
  assert.strictEqual(vol.lightningBrightness, 0.0);
});

test('Manual lightning flashes work while autonomous lightning is disabled', () => {
  const scene = createMockScene();
  const box = createMock3DBox('ManualLightning', 0, 0, 0, 500, 500, 500);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain', enableLightning: false
  });
  AW.triggerLightningFlash(scene, behavior);
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(vol.lightningActive, true);
  assert(vol.lightningBrightness > 0);
  assert(vol.lightningLight.intensity > 0);
});

test('Weather preset switching (Snow, Embers, Hail, Dust, Fog)', () => {
  const scene = createMockScene();
  const box = createMock3DBox('SeasonBox', 0, 0, 0, 500, 500, 500);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, { weatherType: 'Rain' });

  AW.updateWeatherVolume(scene, box, behavior, { weatherType: 'Snow' });
  assert.strictEqual(vol.weatherType, 'Snow');
  assert.strictEqual(vol.streakLength, 0.0);
  assert.strictEqual(vol.enableFloorSplashes, false);
  assert(vol.swayAmount >= 20.0);

  AW.updateWeatherVolume(scene, box, behavior, { weatherType: 'Embers' });
  assert.strictEqual(vol.weatherType, 'Embers');
  assert(vol.particleSpeed < 0, 'Embers have upward rising speed');
  assert.strictEqual(vol.material.blending, THREE.AdditiveBlending);
});

test('Spatial queries: isPointInsideVolume and isObjectInsideVolume', () => {
  const scene = createMockScene();
  const box = createMock3DBox('BoundsCheck', 100, 200, 50, 400, 300, 200);
  const behavior = {};

  AW.registerWeatherVolume(scene, box, behavior, { weatherType: 'Rain' });
  AW.stepWeatherVolume(scene, box, behavior);

  assert.strictEqual(AW.isPointInsideVolume(scene, behavior, 300, 350, 150), true);
  assert.strictEqual(AW.isPointInsideVolume(scene, behavior, 50, 350, 150), false);
  assert.strictEqual(AW.isPointInsideVolume(scene, behavior, 300, 350, 300), false);

  const playerInside = createMock3DBox('Player', 250, 300, 100, 20, 20, 50);
  const playerOutside = createMock3DBox('PlayerFar', 900, 900, 100, 20, 20, 50);

  assert.strictEqual(AW.isObjectInsideVolume(scene, behavior, playerInside), true);
  assert.strictEqual(AW.isObjectInsideVolume(scene, behavior, playerOutside), false);
});

test('Global wind and time multiplier controls', () => {
  const scene = createMockScene();
  AW.setGlobalWind(scene, 120.0, 90.0);
  assert.strictEqual(AW.getGlobalWindSpeed(scene), 120.0);
  assert.strictEqual(AW.getGlobalWindDirection(scene), 90.0);

  AW.setGlobalSpeedMultiplier(scene, 0.5);
  assert.strictEqual(AW.getSceneState(scene).globalSpeedMultiplier, 0.5);
});

test('Disposal and teardown cleans up Three.js objects', () => {
  const scene = createMockScene();
  const box = createMock3DBox('TempRain', 0, 0, 0, 500, 500, 500);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    enableClusteredFog: true
  });
  assert(scene._threeGroup.children.includes(vol.mesh));
  assert(vol.fogMesh, 'Fog mesh created');
  assert(scene._threeGroup.children.includes(vol.fogMesh));

  AW.disposeWeatherVolume(scene, behavior);

  assert(!scene._threeGroup.children.includes(vol.mesh), 'Mesh removed from scene');
  assert(!scene._threeGroup.children.includes(vol.fogMesh), 'Fog mesh removed from scene');
  assert(vol.geometry.disposed, 'Geometry disposed');
  assert(vol.material.disposed, 'Material disposed');
  assert(vol.fogGeometry.disposed, 'Fog geometry disposed');
  assert(vol.fogMaterial.disposed, 'Fog material disposed');
  assert.strictEqual(AW.getSceneState(scene).volumes.length, 0, 'Volume removed from state');
});

test('3D Wind Pitch & Streak Thickness Controls', () => {
  const scene = createMockScene();
  const box = createMock3DBox('WindPitchTest', 0, 0, 0, 600, 600, 400);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    windSpeed: 100.0,
    windDirection: 0.0, // along +X
    windPitch: -30.0,   // downward storm pitch
    streakThickness: 4.5
  });

  assert.strictEqual(vol.windPitch, -30.0);
  assert.strictEqual(vol.streakThickness, 4.5);

  AW.stepWeatherVolume(scene, box, behavior);

  // Check that updating pitch and thickness modifies the volume state
  AW.updateWeatherVolume(scene, box, behavior, {
    windPitch: 20.0,
    streakThickness: 6.0
  });

  assert.strictEqual(vol.windPitch, 20.0);
  assert.strictEqual(vol.streakThickness, 6.0);
});

test('Clustered Volumetric Fog creation, raymarch uniforms, and wind advection', () => {
  const scene = createMockScene();
  const box = createMock3DBox('ClusteredFogBox', 100, 200, 50, 1000, 800, 600);
  const behavior = {};

  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Fog',
    enableClusteredFog: true,
    fogThickness: 0.10,
    fogHeightFalloff: 2.0,
    fogAnisotropy: 0.6,
    windSpeed: 80.0,
    windDirection: 90.0
  });

  assert(vol.fogMesh, 'Fog mesh created');
  assert.strictEqual(vol.fogMaterial.side, THREE.BackSide, 'Rendered with BackSide for camera immersion');
  assert.strictEqual(vol.fogMaterial.transparent, true);

  AW.stepWeatherVolume(scene, box, behavior);

  const u = vol.fogMaterial.uniforms;
  assert(u.u_BoxMin, 'u_BoxMin present');
  assert.strictEqual(u.u_BoxMin.value.x, 100);
  assert.strictEqual(u.u_BoxMin.value.y, -1000);
  assert.strictEqual(u.u_BoxMin.value.z, 50);
  assert.strictEqual(u.u_BoxMax.value.x, 1100);
  assert.strictEqual(u.u_BoxMax.value.y, -200);
  assert.strictEqual(u.u_BoxMax.value.z, 650);
  assert.strictEqual(u.u_StepCount.value, 24, 'Medium fog quality uses 24 samples');
  AW.updateWeatherVolume(scene, box, behavior, { fogQuality: 'Ultra' });
  AW.stepWeatherVolume(scene, box, behavior);
  assert.strictEqual(u.u_StepCount.value, 64, 'Fog quality can be changed at runtime');

  // Step again to verify wind advection offset
  const initialOffsetY = vol.fogWindOffset[1];
  scene._elapsed = 50;
  AW.stepWeatherVolume(scene, box, behavior);
  assert(vol.fogWindOffset[1] > initialOffsetY, 'Wind advection shifted fog coordinates along wind vector');
});

test('Clustered Fog CPU spatial query (getFogDensityAt) with ground height falloff', () => {
  const scene = createMockScene();
  const box = createMock3DBox('FogQueryBox', 0, 0, 0, 1000, 1000, 500);
  const behavior = {};

  AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Fog',
    enableClusteredFog: true,
    fogThickness: 0.20,
    fogHeightFalloff: 2.5
  });
  AW.stepWeatherVolume(scene, box, behavior);

  // Outside volume returns 0
  assert.strictEqual(AW.getFogDensityAt(scene, behavior, -50, 500, 100), 0.0);
  assert.strictEqual(AW.getFogDensityAt(scene, behavior, 500, 500, 600), 0.0);

  // Sample low ground (z = 20) vs high elevation (z = 450)
  const groundDensity = AW.getFogDensityAt(scene, behavior, 500, 500, 20);
  const highDensity = AW.getFogDensityAt(scene, behavior, 500, 500, 450);

  assert(groundDensity >= 0.0, 'Ground density non-negative');
  assert(groundDensity >= highDensity, 'Ground fog has higher density than high elevation due to falloff');
});

test('Multi-behavior stacking on same 3D Box (RainVolume3D + ClusteredFogVolume3D)', () => {
  const scene = createMockScene();
  const sharedBox = createMock3DBox('StormAreaBox', 0, 0, 0, 1000, 1000, 500);
  const rainBehavior = { _name: 'RainVolume3D' };
  const fogBehavior = { _name: 'ClusteredFogVolume3D' };

  // Register Rain
  const rainVol = AW.registerWeatherVolume(scene, sharedBox, rainBehavior, {
    weatherType: 'Rain',
    particleCount: 800,
    windSpeed: 120.0
  });

  // Register Fog on the same box
  const fogVol = AW.registerWeatherVolume(scene, sharedBox, fogBehavior, {
    weatherType: 'Fog',
    enableClusteredFog: true,
    fogThickness: 0.15
  });

  const sceneState = AW.getSceneState(scene);
  assert.strictEqual(sceneState.volumes.length, 2, 'Both volumes registered in scene');

  // Step both
  AW.stepWeatherVolume(scene, sharedBox, rainBehavior);
  AW.stepWeatherVolume(scene, sharedBox, fogBehavior);

  assert(sharedBox._rootObject.visible === false, 'Shared box is hidden after stepping');

  assert(rainVol.mesh, 'Rain mesh exists');
  assert(fogVol.fogMesh, 'Fog mesh exists');

  // Dispose Rain only
  AW.disposeWeatherVolume(scene, rainBehavior);
  assert.strictEqual(sceneState.volumes.length, 1, 'One volume remaining');
  assert(sharedBox._rootObject.visible === false, 'Box remains hidden because fog behavior is still active');

  // Dispose Fog
  AW.disposeWeatherVolume(scene, fogBehavior);
  assert.strictEqual(sceneState.volumes.length, 0, 'No volumes remaining');
  assert(sharedBox._rootObject.visible === true, 'Box visibility restored after all weather behaviors disposed');
});

test('Runtime particle and renderer controls rebuild live resources', () => {
  const scene = createMockScene();
  const box = createMock3DBox('LiveControls', 10, 20, 30, 400, 300, 200);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain',
    particleDensity: 20,
    debugBounds: false
  });

  const originalMesh = vol.mesh;
  const originalGeometry = vol.geometry;
  AW.updateWeatherVolume(scene, box, behavior, { particleDensity: 5 });
  assert.strictEqual(vol.particles.capacity, 5);
  assert.strictEqual(vol.mesh.count, 5);
  assert(originalGeometry.disposed, 'Old particle geometry disposed after density rebuild');
  assert.notStrictEqual(vol.mesh, originalMesh, 'Particle mesh replaced after density rebuild');

  const densityGeometry = vol.geometry;
  AW.updateWeatherVolume(scene, box, behavior, { streakThickness: 7, streakLength: 35 });
  assert(densityGeometry.disposed, 'Particle shape change rebuilt geometry');

  const splashGeometry = vol.splashGeometry;
  AW.updateWeatherVolume(scene, box, behavior, { enableFloorSplashes: false });
  assert.strictEqual(vol.splashMesh, null);
  assert(splashGeometry.disposed, 'Splash renderer disposed when disabled');
  AW.updateWeatherVolume(scene, box, behavior, { enableFloorSplashes: true });
  assert(vol.splashMesh, 'Splash renderer created when enabled at runtime');

  const ringGeometry = vol.splashGeometry;
  AW.updateWeatherVolume(scene, box, behavior, { splashStyle: 'DoubleRing' });
  assert(ringGeometry.disposed, 'Previous ripple geometry disposed when style changes');
  assert.strictEqual(vol.splashGeometry.userData.advancedWeatherRippleStyle, 'DoubleRing');
  AW.updateWeatherVolume(scene, box, behavior, { splashStyle: 'Crown' });
  assert.strictEqual(vol.splashGeometry.userData.advancedWeatherRippleStyle, 'Crown');

  AW.updateWeatherVolume(scene, box, behavior, { debugBounds: true });
  assert(vol.debugWireframe, 'Debug renderer created when enabled at runtime');
  assert.strictEqual(vol.debugWireframe.scale.x, 400);
});

test('Zero particle density is supported for fog-only volumes', () => {
  const scene = createMockScene();
  const box = createMock3DBox('FogOnly', 0, 0, 0, 400, 400, 200);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Fog',
    particleDensity: 0,
    enableClusteredFog: true
  });
  assert.strictEqual(vol.particles.capacity, 0);
  assert.strictEqual(vol.mesh, null);
  assert(vol.fogMesh, 'Fog renderer still exists with no ambient particles');
});

test('Global wind combines as a vector without rotating local wind', () => {
  const scene = createMockScene();
  const box = createMock3DBox('WindVector', 0, 0, 0, 1000, 1000, 500);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain', particleDensity: 1, particleSpeed: 0,
    windSpeed: 100, windDirection: 0, windTurbulence: 0, swayAmount: 0
  });
  AW.setGlobalWind(scene, 0, 90);
  const startX = vol.particles.pos[0];
  const startY = vol.particles.pos[1];
  AW.stepWeatherVolume(scene, box, behavior);
  assert(vol.particles.pos[0] > startX, 'Local +X wind advances X');
  assert(Math.abs(vol.particles.pos[1] - startY) < 0.0001, 'Zero-speed global wind does not rotate local wind');
});

test('Follow-camera movement leaves existing weather static and seeds its leading edge', () => {
  const scene = createMockScene();
  const box = createMock3DBox('FollowStable', 0, 0, 10, 1000, 1000, 400);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain', volumeMode: 'FollowCamera', particleDensity: 2,
    particleSpeed: 0, windSpeed: 0, swayAmount: 0, windTurbulence: 0,
    enableFloorSplashes: true
  });

  // One drop remains within the shifted window; one is left behind.
  vol.particles.pos[0] = 500;
  vol.particles.pos[1] = 300;
  vol.particles.pos[2] = 200;
  vol.particles.pos[3] = 10;
  vol.particles.pos[4] = 300;
  vol.particles.pos[5] = 200;

  const splashIndex = vol.splashes.head;
  AW._spawnSplash(vol, 100, 120, 10.1);

  scene._camera.position.set(700, -300, 200);
  AW.stepWeatherVolume(scene, box, behavior);

  assert(Math.abs(vol.particles.pos[0] - 500) < 0.0001, 'Existing drop stays at its world X');
  assert(Math.abs(vol.particles.pos[1] - 300) < 0.0001, 'Existing drop stays at its world Y');
  assert(vol.particles.pos[3] >= 1000 && vol.particles.pos[3] <= 1200,
    'Trailing drop respawns in the newly exposed +X strip');
  assert(vol.particles.pos[4] >= -200 && vol.particles.pos[4] <= 800);
  assert(Math.abs(vol.splashes.pos[splashIndex * 3] - 100) < 0.0001,
    'Ripple stays at its world X');
  assert(Math.abs(vol.splashes.pos[splashIndex * 3 + 1] - 120) < 0.0001,
    'Ripple stays at its world Y');
});

test('Swept shelter collision catches and bounces hail crossing a thin roof in one frame', () => {
  const scene = createMockScene();
  scene._elapsed = 100;
  const weatherBox = createMock3DBox('FastHail', 0, 0, 0, 1000, 1000, 800);
  const roofBox = createMock3DBox('ThinRoof', 200, 200, 300, 400, 400, 10);
  const weatherBehavior = {};
  const shelterBehavior = {};
  const vol = AW.registerWeatherVolume(scene, weatherBox, weatherBehavior, {
    weatherType: 'Hail', particleDensity: 1, particleSpeed: 2000,
    particleSpeedVariation: 0, windSpeed: 0, swayAmount: 0
  });
  AW.registerShelter(scene, roofBox, shelterBehavior, { enabled: true });
  vol.particles.pos[0] = 300;
  vol.particles.pos[1] = 300;
  vol.particles.pos[2] = 400;
  vol.particles.vel[2] = -2000;
  AW.stepWeatherVolume(scene, weatherBox, weatherBehavior);
  assert(Math.abs(vol.particles.pos[2] - 310.1) < 0.001, 'Fast particle was intercepted at the roof top');
  assert(vol.particles.vel[2] > 0, 'Hail rebounds upward after impact');
  assert.strictEqual(vol.particles.bounceCount[0], 1);
});

test('Shelter runtime state and original host visibility are preserved', () => {
  const scene = createMockScene();
  const roof = createMock3DBox('ToggleRoof', 0, 0, 100, 100, 100, 10);
  const shelterBehavior = {};
  const shelter = AW.registerShelter(scene, roof, shelterBehavior, { enabled: true, splashOnRoof: true });
  AW.updateShelter(scene, shelterBehavior, { enabled: false, splashOnRoof: false });
  assert.strictEqual(AW.shelterOf(scene, shelterBehavior), shelter);
  assert.strictEqual(shelter.enabled, false);
  assert.strictEqual(shelter.splashOnRoof, false);

  const hiddenBox = createMock3DBox('OriginallyHidden', 0, 0, 0, 100, 100, 100);
  hiddenBox._rootObject.visible = false;
  const weatherBehavior = {};
  AW.registerWeatherVolume(scene, hiddenBox, weatherBehavior, { weatherType: 'Rain' });
  AW.stepWeatherVolume(scene, hiddenBox, weatherBehavior);
  AW.disposeWeatherVolume(scene, weatherBehavior);
  assert.strictEqual(hiddenBox._rootObject.visible, false, 'Disposal restores original host visibility');
});

test('Lightning from stacked rain illuminates the matching fog volume', () => {
  const scene = createMockScene();
  const box = createMock3DBox('LitFogStack', 0, 0, 0, 500, 500, 300);
  const rainBehavior = {};
  const fogBehavior = {};
  const rain = AW.registerWeatherVolume(scene, box, rainBehavior, {
    weatherType: 'Rain', enableLightning: true, lightningIntensity: 2
  });
  const fog = AW.registerWeatherVolume(scene, box, fogBehavior, {
    weatherType: 'Fog', particleDensity: 0, enableClusteredFog: true
  });
  AW.triggerLightningFlash(scene, rainBehavior);
  AW.stepWeatherVolume(scene, box, rainBehavior);
  AW.stepWeatherVolume(scene, box, fogBehavior);
  assert(rain.lightningBrightness > 0);
  assert(fog.fogMaterial.uniforms.u_LightningIntensity.value > 0);
  assert(Math.abs(rain.simulationTime - fog.simulationTime) < 0.000001,
    'Each volume advances by one frame rather than multiplying shared time');
});

test('Hot-reload cleanup disposes live scene resources', () => {
  const scene = createMockScene();
  const box = createMock3DBox('HotReloadVolume', 0, 0, 0, 200, 200, 100);
  const behavior = {};
  const vol = AW.registerWeatherVolume(scene, box, behavior, {
    weatherType: 'Rain', enableClusteredFog: true
  });
  AW.stepWeatherVolume(scene, box, behavior);
  AW.__cleanup();
  assert.strictEqual(AW.getSceneState(scene).volumes.length, 0);
  assert(!scene._threeGroup.children.includes(vol.mesh));
  assert.strictEqual(box._rootObject.visible, true);
});

console.log(`\n🎉 ALL ${testCount} TESTS PASSED SUCCESSFULLY!`);
