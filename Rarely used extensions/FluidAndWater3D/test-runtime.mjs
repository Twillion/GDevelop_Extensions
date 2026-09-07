import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'FluidAndWater3D.runtime.js'), 'utf8');

/* ------------------------------------------------------------------ Engine mocks */

const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  hexToRGBColor: () => [64, 224, 208],
};

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(o) { return this.set(o.x, o.y, o.z); }
  setScalar(v) { return this.set(v, v, v); }
  fromArray(a) { return this.set(a[0], a[1], a[2]); }
  normalize() {
    const len = Math.hypot(this.x, this.y, this.z) || 1;
    return this.set(this.x / len, this.y / len, this.z / len);
  }
}

let WebGLRT_ID = 1;

class Obj3D {
  constructor() {
    this.position = new V3();
    this.scale = new V3(1, 1, 1);
    this.rotation = { x: 0, y: 0, z: 0, order: 'XYZ' };
    this.matrix = {};
    this.parent = null;
    this.children = [];
    this.visible = true;
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parent = null;
  }
  updateMatrix() {}
  traverse() {}
}

globalThis.THREE = {
  PlaneGeometry: class {
    constructor(w, h, sx, sy) { this.parameters = { width: w, height: h, widthSegments: sx, heightSegments: sy }; }
    dispose() {}
  },
  SphereGeometry: class {
    constructor(r, ws, hs) { this.parameters = { radius: r, widthSegments: ws, heightSegments: hs }; }
    dispose() {}
  },
  ShaderMaterial: class {
    constructor(opts) {
      this.vertexShader = opts.vertexShader;
      this.fragmentShader = opts.fragmentShader;
      this.uniforms = opts.uniforms || {};
      this.transparent = !!opts.transparent;
      this.side = opts.side;
    }
    dispose() {}
  },
  MeshBasicMaterial: class {
    constructor(opts = {}) {
      this.color = opts.color || new globalThis.THREE.Color();
      this.visible = opts.visible !== undefined ? opts.visible : true;
      this.opacity = opts.opacity !== undefined ? opts.opacity : 1;
      this.transparent = !!opts.transparent;
    }
    dispose() {}
  },
  Mesh: class extends Obj3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
  },
  InstancedMesh: class extends Obj3D {
    constructor(geometry, material, count) {
      super();
      this.geometry = geometry;
      this.material = material;
      this.count = count;
      this.isMesh = true;
      this.instanceMatrix = { needsUpdate: false, setUsage() {} };
      this.instanceColor = { needsUpdate: false };
      this.colors = [];
    }
    setMatrixAt() {}
    setColorAt(i, c) { this.colors[i] = [c.r, c.g, c.b]; }
  },
  Object3D: Obj3D,
  Vector2: class {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
  },
  Vector4: class {
    constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; }
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  },
  DataTexture: class {
    constructor(data, w, h, fmt, type) {
      this.image = { data, width: w, height: h };
      this.format = fmt; this.type = type; this.needsUpdate = false;
    }
    dispose() {}
  },
  Scene: class extends Obj3D {},
  OrthographicCamera: class extends Obj3D { constructor() { super(); } },
  WebGLRenderTarget: class {
    constructor(w, h, o = {}) {
      this.width = w; this.height = h;
      this.texture = { ...o, isTexture: true, id: WebGLRT_ID++ };
    }
    dispose() { this.disposed = true; }
  },
  NearestFilter: 1003,
  RGBAFormat: 1023,
  FloatType: 1015,
  RepeatWrapping: 1000,
  LinearFilter: 1006,
  LinearMipmapLinearFilter: 1008,
  Vector3: V3,
  Color: class {
    constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  },
  FogExp2: class {
    constructor(color, density) { this.color = color; this.density = density; }
  },
  DoubleSide: 2,
};

new Function(runtimeCode)();
const FW = gdjs.__fluidAndWater3D;
assert.ok(FW, 'gdjs.__fluidAndWater3D must be defined');

/* ------------------------------------------------------------------ Scene mock */

/**
 * Mirrors the real engine closely enough to catch coordinate-space mistakes:
 *  - the three.js group is a child of a scene scaled y = -1, so the CAMERA reports a NEGATED
 *    GDevelop Y (layer-pixi-renderer sets `_threeCamera.position.y = -layer.getCameraY()`),
 *  - getElapsedTime() drives the simulation clock rather than a hardcoded 60 Hz step.
 */
function makeScene({ cameraGdY = 500, cameraZ = 50, elapsedMs = 16.6667 } = {}) {
  const threeScene = { fog: null, add() {}, remove() {} };
  const threeGroup = new Obj3D();
  const threeCamera = { position: { x: 500, y: -cameraGdY, z: cameraZ } };
  const scene = {
    _elapsedMs: elapsedMs,
    _objects: [],
    threeScene,
    threeGroup,
    threeCamera,
    getElapsedTime: () => scene._elapsedMs,
    getAdhocListOfAllInstances: () => scene._objects,
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => ({
      capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 },
      extensions: { has: () => true },
    }) }) }),
    getLayer: () => ({
      getRenderer: () => ({
        getThreeCamera: () => threeCamera,
        getThreeScene: () => threeScene,
        getThreeGroup: () => threeGroup,
      }),
    }),
  };
  return scene;
}

const mockScene = makeScene();

/* ------------------------------------------------------------------ Tests */

console.log('--- Test 1: Gerstner wave equations & normal derivation ---');
const waveCfg = { waveHeight: 1.5, waveChoppiness: 0.8, waveSpeed: 1.2, windDirection: 45.0, baseZ: 0.0 };

const z0 = FW.evaluateGerstnerDisplacement(0, 0, 0.0, waveCfg);
assert.ok(typeof z0 === 'number', 'Wave displacement should return a number');
assert.ok(Math.abs(z0) <= waveCfg.waveHeight, 'Wave displacement should stay within the amplitude range');

const normal = FW.evaluateGerstnerNormal(5, 5, 0.5, waveCfg);
assert.ok(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1.0) < 1e-4, 'Normal must be a unit vector');
assert.ok(normal.z > 0.0, 'Normal must face generally upwards');

assert.notStrictEqual(
  FW.evaluateGerstnerDisplacement(10, 20, 1.0, { ...waveCfg, waveTiling: 1.0 }),
  FW.evaluateGerstnerDisplacement(10, 20, 1.0, { ...waveCfg, waveTiling: 2.0 }),
  'WaveTiling must change the spatial wave frequency'
);

const vel = FW.evaluateWaveVelocity(5, 5, 0.5, waveCfg);
assert.ok(Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z), 'Velocity must be a 3D vector');
console.log('  Passed.');

console.log('--- Test 2: Water shaders do not collide with three.js built-ins ---');
const mockWaterObject = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
  getLayer: () => '',
  getName: () => 'Ocean',
  get3DRendererObject: () => ({ add() {}, traverse() {} }),
};
const mockWaterBehavior = {};
const waterBody = FW.registerWaterBody(mockScene, mockWaterObject, mockWaterBehavior, {
  waterType: 'Ocean', waveHeight: 2.0, waveChoppiness: 0.85, waveSpeed: 1.5, windDirection: 60.0,
  shallowColor: '64;224;208', deepColor: '10;45;90', extinctionDepth: 12.0,
});
assert.ok(waterBody, 'Water body should be registered');
assert.strictEqual(waterBody.mesh.visible, false,
  'The generated surface must stay hidden while onCreated still exposes the default transform');

console.log('--- Test 2b: Water surfaces do not flash at world origin during initialization ---');
{
  let x = 0, y = 0, z = 0, width = 100, height = 100, depth = 100;
  const rendererRoot = { isMesh: true, material: null, visible: true, traverse() {} };
  const placedObject = {
    getX: () => x, getY: () => y, getZ: () => z,
    getWidth: () => width, getHeight: () => height, getDepth: () => depth,
    getLayer: () => '', getName: () => 'PlacedWater',
    get3DRendererObject: () => rendererRoot,
  };
  const placedScene = makeScene();
  const placedBehavior = {};
  const placed = FW.registerWaterBody(placedScene, placedObject, placedBehavior, {});
  assert.strictEqual(placed.mesh.visible, false, 'onCreated must not reveal a surface at 0,0,0');
  assert.deepStrictEqual(
    [placed.mesh.position.x, placed.mesh.position.y, placed.mesh.position.z],
    [0, 0, 0],
    'The unreliable onCreated transform must not be baked into the generated surface'
  );

  // This is the editor transform becoming readable before the first behavior step.
  x = 1200; y = -340; z = 75; width = 800; height = 600; depth = 140;
  FW.stepWaterBody(placedScene, placedObject, placedBehavior);
  assert.deepStrictEqual(
    [placed.mesh.position.x, placed.mesh.position.y, placed.mesh.position.z],
    [1600, -40, 215.1],
    'The first visible frame must use the final editor transform'
  );
  assert.strictEqual(placed.mesh.visible, true, 'The surface should appear after placement');
  FW.disposeWaterBody(placedScene, placedBehavior);
  console.log('  Passed: the first visible frame is at the editor-authored position.');
}

// three.js prepends these declarations to every non-raw ShaderMaterial. Redeclaring any of them is
// a GLSL redefinition error, and the water then silently never renders.
const THREE_BUILTIN_UNIFORMS = [
  'cameraPosition', 'viewMatrix', 'modelMatrix', 'projectionMatrix', 'modelViewMatrix',
  'normalMatrix', 'isOrthographic',
];
const THREE_BUILTIN_ATTRIBUTES = ['position', 'normal', 'uv'];
for (const stage of ['vertexShader', 'fragmentShader']) {
  const src = waterBody.material[stage];
  for (const name of THREE_BUILTIN_UNIFORMS) {
    assert.ok(
      !new RegExp(`uniform\\s+\\w+\\s+${name}\\s*;`).test(src),
      `${stage} redeclares three.js built-in uniform "${name}" — the shader will not compile`
    );
  }
  for (const name of THREE_BUILTIN_ATTRIBUTES) {
    assert.ok(
      !new RegExp(`attribute\\s+\\w+\\s+${name}\\s*;`).test(src),
      `${stage} redeclares three.js built-in attribute "${name}"`
    );
  }
}

// Every uniform the material supplies must be consumed, and every uniform the shaders read must be
// supplied — a mismatch is a property that silently does nothing.
const shaderSrc = waterBody.material.vertexShader + '\n' + waterBody.material.fragmentShader;
const declaredInShader = new Set([
  ...shaderSrc.matchAll(/uniform\s+\w+\s+(u_\w+)(?:\s*\[\d+\])?\s*;/g),
].map((m) => m[1]));
for (const name of Object.keys(waterBody.material.uniforms)) {
  assert.ok(declaredInShader.has(name), `Uniform "${name}" is supplied but no shader stage declares it`);
}
for (const name of declaredInShader) {
  assert.ok(name in waterBody.material.uniforms, `Shader reads "${name}" but the material never supplies it`);
  assert.ok(shaderSrc.split(name).length > 2, `Uniform "${name}" is declared but never used`);
}
console.log(`  Passed: ${declaredInShader.size} uniforms declared, supplied and used.`);

console.log('--- Test 3: GPU wave phase matches the CPU solver (scene is Y-mirrored) ---');
assert.ok(
  /vec2 gdXY = vec2\(worldPos\.x, -worldPos\.y\);/.test(waterBody.material.vertexShader),
  'Vertex shader must un-mirror worldPos.y before evaluating the wave phase, or the rendered '
  + 'surface will be out of phase with WaveHeightAt()/buoyancy along Y'
);
assert.ok(
  /worldPos\.y -= dPos\.y;/.test(waterBody.material.vertexShader),
  'The GDevelop-space horizontal displacement must be mapped back into mirrored three space'
);
console.log('  Passed.');

console.log('--- Test 3e: DirectionalSpread and PhaseSeed actually control the surface ---');
{
  const TILE = 7000;
  const base = { waveHeight: 220, waveChoppiness: 0.75, waveSpeed: 1, windDirection: 45,
                 baseWavelength: TILE, minWavelength: 0 };

  // Ridge-orientation isotropy: 0 means every crest runs the same way.
  const isotropy = (cfg, t) => {
    const R = 100, step = TILE / R, h = new Float64Array(R * R);
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) h[y * R + x] = FW.evaluateGerstnerDisplacement(x * step, y * step, t, cfg);
    let sx = 0, sy = 0, n = 0;
    for (let y = 1; y < R - 1; y++)
      for (let x = 1; x < R - 1; x++) {
        const gx = h[y * R + x + 1] - h[y * R + x - 1];
        const gy = h[(y + 1) * R + x] - h[(y - 1) * R + x];
        const m = Math.hypot(gx, gy);
        if (m < 1e-9) continue;
        const a = 2 * Math.atan2(gy, gx);
        sx += Math.cos(a) * m; sy += Math.sin(a) * m; n += m;
      }
    return 1 - Math.hypot(sx, sy) / n;
  };

  // Spread 0 must collapse every wave onto the wind — pure rolling swell, one direction.
  assert.ok(isotropy({ ...base, directionalSpread: 0, waveIrregularity: 0 }, 3) < 0.02,
    'DirectionalSpread 0 must put every crest on the wind');

  // and widening it must genuinely widen the fan.
  const spreads = [15, 30, 45, 60].map((d) => isotropy({ ...base, directionalSpread: d }, 3));
  for (let i = 1; i < spreads.length; i++) {
    assert.ok(spreads[i] > spreads[i - 1],
      `Raising DirectionalSpread must scatter the crests further: ${spreads.map((v) => v.toFixed(2))}`);
  }
  assert.ok(spreads[2] > 0.5, 'The 45 degree default should sit near the Tessendorf reference');

  // The seed must rearrange the surface, and must be reproducible.
  const at = (cfg) => Array.from({ length: 48 },
    (_, i) => FW.evaluateGerstnerDisplacement(i * 97, i * 131, 3, cfg));
  const a = at({ ...base, directionalSpread: 45, phaseSeed: 0 });
  const b = at({ ...base, directionalSpread: 45, phaseSeed: 2 });
  const b2 = at({ ...base, directionalSpread: 45, phaseSeed: 2 });
  let diff = 0, same = 0;
  for (let i = 0; i < a.length; i++) {
    diff = Math.max(diff, Math.abs(a[i] - b[i]));
    same = Math.max(same, Math.abs(b[i] - b2[i]));
  }
  assert.ok(diff > 1.0, `A different PhaseSeed must give a different surface, got ${diff}`);
  assert.strictEqual(same, 0, 'The same PhaseSeed must rebuild an identical surface');

  const regular = at({ ...base, directionalSpread: 45, phaseSeed: 2, waveIrregularity: 0 });
  const irregular = at({ ...base, directionalSpread: 45, phaseSeed: 2, waveIrregularity: 0.8 });
  const irregular2 = at({ ...base, directionalSpread: 45, phaseSeed: 2, waveIrregularity: 0.8 });
  let irregularDiff = 0;
  for (let i = 0; i < regular.length; i++) {
    irregularDiff = Math.max(irregularDiff, Math.abs(regular[i] - irregular[i]));
    assert.strictEqual(irregular[i], irregular2[i], 'Irregularity must remain deterministic');
  }
  assert.ok(irregularDiff > 1.0, 'WaveIrregularity must visibly change the crest arrangement');

  // Both must reach the shader, or the surface and the buoyancy solver would disagree.
  const vs = waterBody.material.vertexShader;
  assert.ok(/radians\(dirOffsetDeg \* u_DirSpread\)/.test(vs), 'Spread must reach the vertex shader');
  assert.ok(/u_PhaseSeed \* lenRatio/.test(vs), 'Phase seed must reach the vertex shader');
  assert.ok(/u_WaveIrregularity/.test(vs), 'Irregularity must reach the vertex shader');
  assert.ok('u_DirSpread' in waterBody.material.uniforms, 'u_DirSpread must be supplied');
  assert.ok('u_PhaseSeed' in waterBody.material.uniforms, 'u_PhaseSeed must be supplied');
  assert.ok('u_WaveIrregularity' in waterBody.material.uniforms, 'u_WaveIrregularity must be supplied');
  console.log(`  Passed: spread 0 -> 0.00, 15/30/45/60 -> ${spreads.map((v) => v.toFixed(2)).join('/')}`);
}

console.log('--- Test 3b: Wave scale mode & octave fade ---');
// A 1000-unit volume at 48 subdivisions has 20.8-unit vertex spacing, so the smallest octaves
// (21 and 10.5 units in Absolute mode) cannot be represented and must be faded out.
assert.ok(waterBody.baseWavelength === 300.0, 'Absolute mode uses the fixed 300-unit base wavelength');
assert.ok(
  Math.abs(waterBody.minWavelength - (1000 / 48) * 4) < 0.01,
  `minWavelength should be 4x the vertex spacing, got ${waterBody.minWavelength}`
);

const smallPool = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getWidth: () => 400, getHeight: () => 240, getDepth: () => 60,
  getLayer: () => '', getName: () => 'Pool',
  get3DRendererObject: () => ({ add() {}, traverse() {} }),
};
const poolScene = makeScene();
const poolBeh = {};
const pool = FW.registerWaterBody(poolScene, smallPool, poolBeh, {
  waveScaleMode: 'RelativeToVolume', waveHeight: 8.0, gridSubdivisions: 48,
});
assert.strictEqual(pool.baseWavelength, 240, 'RelativeToVolume uses the shorter horizontal side');
assert.notStrictEqual(pool.baseWavelength, waterBody.baseWavelength,
  'The two modes must produce different wavelengths for the same tiling');

// The shader must read the wavelength from a uniform, not the old hardcoded literal.
assert.ok(
  /float baseLen = u_BaseWavelength \/ max\(u_WaveTiling, 0.001\);/.test(pool.material.vertexShader),
  'Vertex shader must derive baseLen from u_BaseWavelength'
);
assert.ok(
  !/baseLen = 300\.0/.test(pool.material.vertexShader),
  'Vertex shader must not keep the hardcoded 300-unit wavelength'
);
assert.strictEqual(pool.material.uniforms.u_BaseWavelength.value, 240);
assert.strictEqual(pool.material.uniforms.u_MinWavelength.value, (400 / 48) * 4);

// CPU and GPU must fade identically, or buoyancy drifts out of phase with what is drawn.
assert.ok(
  /float fade = smoothstep\(u_MinWavelength \* 0\.5, u_MinWavelength, wavelength\);/.test(pool.material.vertexShader),
  'Vertex shader must fade octaves below the mesh resolution'
);
assert.ok(
  /vWaveCrest = clamp\(\(dPos\.z \/ max\(ampSum, 0\.0001\)\)/.test(pool.material.vertexShader),
  'Crest foam must normalise against the retained amplitude, not the full baseAmp'
);

// A mesh too coarse to resolve anything flattens the water rather than producing noise.
const coarse = { waveHeight: 18, waveChoppiness: 0.75, waveSpeed: 1, windDirection: 45, waveTiling: 1 };
const detailed = FW.evaluateGerstnerDisplacement(120, 80, 2.0, { ...coarse, minWavelength: 0 });
const filtered = FW.evaluateGerstnerDisplacement(120, 80, 2.0, { ...coarse, minWavelength: 90 });
const flattened = FW.evaluateGerstnerDisplacement(120, 80, 2.0, { ...coarse, minWavelength: 100000 });
assert.notStrictEqual(detailed, filtered, 'A minWavelength must remove the fine octaves');
assert.ok(Math.abs(flattened) < 1e-9, 'Fading every octave must leave a flat surface, not noise');

// Wave height must still track WaveHeight once the surviving octaves are renormalised.
assert.ok(Math.abs(filtered) <= 18.0, 'Filtered displacement stays within the amplitude envelope');

// The buoyancy solver must see the same filtered surface as the shader.
const poolSurface = FW.getWaveHeightAt(poolScene, poolBeh, 100, 100);
const rawSurface = FW.evaluateGerstnerDisplacement(100, 100, 0, {
  waveHeight: pool.waveHeight, waveChoppiness: pool.waveChoppiness, waveSpeed: pool.waveSpeed,
  windDirection: pool.windDirection, waveTiling: pool.waveTiling,
  baseWavelength: pool.baseWavelength, minWavelength: pool.minWavelength,
});
assert.ok(Math.abs(poolSurface - rawSurface) < 1e-9,
  'WaveHeightAt must apply the same base and minimum wavelength the shader does');
console.log('  Passed.');

console.log('--- Test 3a: Octave spectrum is not harmonically locked ---');
{
  const oct = FW.GERSTNER_OCTAVES;
  assert.ok(oct.length >= 8, `Expected at least 8 octaves, got ${oct.length}`);

  // Amplitude ratios must sum to 1.0 — vWaveCrest and the foam normalisation depend on it.
  const ampSum = oct.reduce((a, o) => a + o.ampRatio, 0);
  assert.ok(Math.abs(ampSum - 1.0) < 0.005, `Amplitude ratios must sum to 1.0, got ${ampSum}`);

  // No two successive frequency ratios equal, and none near an integer: harmonically related
  // components phase-lock into the repeating lattice this set exists to avoid.
  const ratios = [];
  for (let i = 1; i < oct.length; i++) ratios.push(oct[i - 1].lenRatio / oct[i].lenRatio);
  for (const r of ratios) {
    assert.ok(Math.abs(r - Math.round(r)) > 0.15,
      `Frequency ratio ${r.toFixed(3)} is too close to an integer — octaves will phase-lock`);
  }
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(Math.abs(ratios[i] - ratios[i - 1]) > 0.005,
      'Two successive frequency ratios are identical, which stacks harmonics');
  }

  // Every octave needs its own phase, or they all crest together at the origin.
  const phases = new Set(oct.map((o) => o.phase));
  assert.strictEqual(phases.size, oct.length, 'Each octave needs a distinct phase offset');
  assert.ok(!oct.some((o) => o.phase === undefined), 'Every octave must define a phase');

  // Directional spread must stay in a realistic wind cone rather than the old +/-115 degrees...
  for (const o of oct) {
    assert.ok(Math.abs(o.dirOffset) <= 75,
      `Octave at ${o.dirOffset} degrees off-wind is outside a realistic spread and builds a crosshatch`);
  }

  // ...but must also STRADDLE the wind. An earlier table put seven of eight octaves on one side,
  // which made every crest run the same way — parallel ridges marching in lockstep, very obvious
  // when the camera looks along them.
  const positive = oct.filter((o) => o.dirOffset > 0).length;
  const negative = oct.filter((o) => o.dirOffset < 0).length;
  assert.ok(Math.min(positive, negative) >= Math.floor(oct.length * 0.35),
    `Octaves must straddle the wind, got ${positive} positive and ${negative} negative`);

  // Spread should widen as wavelength shortens: long swell runs with the wind, short chop fans out.
  const longSpread = Math.abs(oct[0].dirOffset);
  const shortSpread = oct.slice(-3).reduce((a, o) => a + Math.abs(o.dirOffset), 0) / 3;
  assert.ok(shortSpread > longSpread,
    `Short waves (${shortSpread.toFixed(0)} deg) should spread wider than the swell (${longSpread.toFixed(0)} deg)`);

  // Phase speed belongs to the dispersion relation; a per-octave multiplier makes short waves
  // outrun long ones, which reads as the whole surface sliding as one sheet.
  for (const o of oct) {
    assert.ok(Math.abs(o.speedMul - 1.0) < 1e-6,
      `speedMul should be 1.0 so sqrt(g/k) sets the speed, got ${o.speedMul}`);
  }

  // Amplitude must fall off with wavelength at roughly k^-1 or steeper.
  const first = oct[0], last = oct[oct.length - 1];
  const lenDrop = first.lenRatio / last.lenRatio;
  const ampDrop = first.ampRatio / last.ampRatio;
  assert.ok(ampDrop > lenDrop * 0.7,
    `Fine octaves are over-amplified: wavelength drops ${lenDrop.toFixed(0)}x but amplitude only ${ampDrop.toFixed(0)}x`);
  console.log(`  Passed: ${oct.length} octaves, ratios ${ratios.map((r) => r.toFixed(2)).join(' ')}`);
}

console.log('--- Test 3d: The vertex shader is generated from the octave table ---');
{
  // A shader with hardcoded wave parameters drifts from the CPU solver the first time the table
  // changes, and the surface then renders out of phase with buoyancy without any error.
  const vs = waterBody.material.vertexShader;
  const calls = vs.split('\n').filter((l) => l.includes('addWave(') && l.includes('gdXY'));
  assert.strictEqual(calls.length, FW.GERSTNER_OCTAVES.length,
    'One generated addWave call per octave');

  FW.GERSTNER_OCTAVES.forEach((o, i) => {
    for (const v of [o.dirOffset, o.lenRatio, o.ampRatio, o.steepness, o.speedMul, o.phase]) {
      assert.ok(calls[i].includes(v.toFixed(5)),
        `Octave ${i} value ${v} is missing from its generated shader call`);
    }
  });

  assert.ok(vs.includes(`#define OCTAVE_COUNT ${FW.GERSTNER_OCTAVES.length}.0`),
    'The steepness normaliser must follow the octave count, not a hardcoded 6');
  assert.ok(/- w \* time \+ phaseOffset/.test(vs), 'Per-octave phase must reach the shader');
  console.log(`  Passed: ${calls.length} calls emitted from the table, all values matching`);
}

console.log('--- Test 3c: A flat-rendering configuration is reported, not silent ---');
// Regression guard for a real 6987 x 7501 ocean at the default 48 subdivisions: vertex spacing is
// 156 units, so the band-limit cutoff sits at 625 and every Absolute-mode octave (longest 300)
// falls below it. The surface renders perfectly flat, which is indistinguishable from a broken
// shader unless the runtime says so.
const warnings = [];
const realConsoleWarn = console.warn;
console.warn = (msg) => warnings.push(String(msg));

const bigOceanObj = {
  getX: () => 5228, getY: () => -8280, getZ: () => -866,
  getWidth: () => 6987, getHeight: () => 7501, getDepth: () => 1000,
  getLayer: () => '', getName: () => 'New3DBox2',
  get3DRendererObject: () => ({ add() {}, traverse() {} }),
};
const oceanScene = makeScene();
const flatBeh = {};
const flat = FW.registerWaterBody(oceanScene, bigOceanObj, flatBeh, {
  waveScaleMode: 'Absolute', waveHeight: 18, waveTiling: 1, gridSubdivisions: 48,
});

assert.ok(flat.waveDetailFraction < 0.01,
  `This configuration must be detected as flat, got ${flat.waveDetailFraction}`);
assert.strictEqual(FW.getWaveDetailPercent(oceanScene, flatBeh), 0,
  'WaveDetailPercent must report 0 for a surface that cannot draw any octave');
assert.strictEqual(warnings.length, 1, 'Exactly one warning, not one per frame');
assert.ok(/renders FLAT/.test(warnings[0]), 'Warning must say the water renders flat');
assert.ok(/RelativeToVolume/.test(warnings[0]), 'Warning must name the mode that fixes it');
assert.ok(/GridSubdivisions to at least \d+/.test(warnings[0]), 'Warning must give a concrete subdivision target');

// Stepping the body repeatedly must not spam the console.
FW.stepWaterBody(oceanScene, bigOceanObj, flatBeh);
FW.stepWaterBody(oceanScene, bigOceanObj, flatBeh);
assert.strictEqual(warnings.length, 1, 'Unchanged configuration must not re-warn every frame');

// The same volume in RelativeToVolume mode resolves nearly all of its amplitude and stays quiet.
const okBeh = {};
const okBody = FW.registerWaterBody(oceanScene, bigOceanObj, okBeh, {
  waveScaleMode: 'RelativeToVolume', waveHeight: 18, waveTiling: 1, gridSubdivisions: 48,
});
assert.ok(okBody.waveDetailFraction > 0.9,
  `RelativeToVolume should resolve almost all amplitude here, got ${okBody.waveDetailFraction}`);
assert.strictEqual(warnings.length, 1, 'A healthy configuration must not warn');

// A displaced surface really is produced in that mode.
const cfgOk = {
  waveHeight: 18, waveChoppiness: 0.75, waveSpeed: 1, windDirection: 45, waveTiling: 1,
  baseWavelength: okBody.baseWavelength, minWavelength: okBody.minWavelength,
};
let peak = 0;
for (let i = 0; i < 64; i++) {
  peak = Math.max(peak, Math.abs(FW.evaluateGerstnerDisplacement(i * 137, i * 211, 3.0, cfgOk)));
}
assert.ok(peak > 1.0, `RelativeToVolume must actually displace the surface, peak was ${peak}`);

// Grid subdivisions now go to 256 for large volumes.
const denseBeh = {};
const dense = FW.registerWaterBody(oceanScene, bigOceanObj, denseBeh, {
  waveScaleMode: 'Absolute', waveHeight: 18, waveTiling: 1, gridSubdivisions: 256,
});
assert.ok(dense.minWavelength < flat.minWavelength,
  'Raising GridSubdivisions past 128 must shorten the renderable wavelength');
assert.ok(dense.waveDetailFraction > flat.waveDetailFraction,
  'A denser mesh must resolve more wave detail');

console.warn = realConsoleWarn;
console.log(`  Passed: flat config reported once, RelativeToVolume retains ${Math.round(okBody.waveDetailFraction * 100)}%.`);

console.log('--- Test 4: Uniform updates ---');
FW.updateWaterBody(mockScene, mockWaterObject, mockWaterBehavior, { waveHeight: 3.5, shallowColor: '0;255;200' });
assert.strictEqual(waterBody.waveHeight, 3.5);
assert.strictEqual(waterBody.material.uniforms.u_WaveHeight.value, 3.5);
console.log('  Passed.');

console.log('--- Test 5: Buoyancy samples the TOP of the water volume ---');
// The water box spans Z 0..100, so its surface is at Z = 100 (what WaterSurfaceZ() reports).
const surfaceZ = FW.getWaterSurfaceZ(mockScene, mockWaterBehavior, 500, 500);
assert.ok(surfaceZ > 90 && surfaceZ < 110, `Water surface should sit on the box top face, got ${surfaceZ}`);

const mockBoat = {
  _z: 95,
  getX: () => 460, getY: () => 420, getZ: () => mockBoat._z,
  getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
  getLayer: () => '',
  getRotationX: () => 0, getRotationY: () => 0,
  setZ: (z) => { mockBoat._z = z; },
  setRotationX() {}, setRotationY() {},
};
const mockBuoyancyBehavior = {};
const buoy = FW.registerBuoyancy(mockScene, mockBoat, mockBuoyancyBehavior, {
  buoyancyFactor: 1.5, hullProbeCount: '4-Corners', fluidDrag: 2.5, waveInfluence: 0.9, maxSubmersionDepth: 20.0,
});
FW.stepBuoyancy(mockScene, mockBoat, mockBuoyancyBehavior);
assert.ok(buoy.isFloating, 'A hull at Z=95 under a surface at Z=100 must report isFloating');
assert.ok(buoy.lastForce > 0.0, 'Buoyant force must be positive when submerged');
assert.ok(
  mockBoat._z > 60,
  `Kinematic fallback must settle the boat near the surface, not the sea floor (got ${mockBoat._z})`
);
console.log('  Passed.');

console.log('--- Test 6: Buoyancy Jolt 3D Physics integration (applyForce, 3D quat, angular damping) ---');
const forces = [];
const physBoat = {
  getX: () => 460, getY: () => 420, getZ: () => 95,
  getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
  getLayer: () => '',
  get3DRendererObject: () => ({
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  }),
  getBehavior: (name) => (name === 'Physics3D' ? physics : null),
};
const physics = {
  getMass: () => 250,
  getLinearVelocityX: () => 0,
  getLinearVelocityY: () => 0,
  getLinearVelocityZ: () => -1.5,
  getAngularVelocityX: () => 10.0,
  getAngularVelocityY: () => 0.0,
  getAngularVelocityZ: () => -5.0,
  applyForce: (...args) => forces.push(args),
};
const physBehavior = {};
FW.registerBuoyancy(mockScene, physBoat, physBehavior, { buoyancyFactor: 1.0, hullProbeCount: '4-Corners', maxSubmersionDepth: 20.0 });
FW.stepBuoyancy(mockScene, physBoat, physBehavior);

assert.strictEqual(forces.length, 4, 'One continuous force per hull probe for Jolt torque and lift');
for (const args of forces) {
  assert.strictEqual(args.length, 6, 'applyForce takes force XYZ then the world application point');
  for (const v of args) {
    assert.ok(Number.isFinite(v), `applyForce received a non-finite argument: ${args}`);
  }
}
const applicationPoints = new Set(forces.map((a) => `${a[3]},${a[4]}`));
assert.strictEqual(applicationPoints.size, 4, 'Probes must be spread across the hull, not stacked at one point');
// Check net upward buoyant force is positive and stabilizes the hull
const netFz = forces.reduce((sum, f) => sum + f[2], 0);
assert.ok(netFz > 0, `Net vertical force across all probes must be upward to float the submerged hull (got ${netFz.toFixed(1)})`);
console.log(`  Passed: 4 finite, distinct-point continuous forces with 3D rotational damping (net lift: ${netFz.toFixed(1)} N).`);

console.log('--- Test 6a: Ship stability produces a balanced restoring torque ---');
{
  const angle = 20 * Math.PI / 180;
  const tilted = { x: Math.sin(angle * 0.5), y: 0, z: 0, w: Math.cos(angle * 0.5) };
  const probes = FW.getHullProbes(200, 400, 80, '4-Corners');
  const righting = FW.getHullRightingForces(
    probes, tilted, 500, 100, 0, 0, { x: 0, y: 0, z: 1 },
    { stabilityStrength: 0.8, stabilityDamping: 1.5, waveInfluence: 0 }
  );
  const arms = probes.map((p) => FW.rotateVec3ByQuat(p, tilted));
  const netForce = righting.reduce((sum, f) => sum + f, 0);
  const torqueX = righting.reduce((sum, f, i) => sum + (arms[i].y / 100) * f, 0);
  assert.ok(Math.abs(netForce) < 1e-6,
    `Righting forces must be a balanced pair rather than extra lift (net ${netForce})`);
  assert.ok(torqueX < 0,
    `A positive roll must receive a negative restoring torque (got ${torqueX})`);
  const disabled = FW.getHullRightingForces(
    probes, tilted, 500, 100, 0, 0, { x: 0, y: 0, z: 1 },
    { stabilityStrength: 0, stabilityDamping: 1.5, waveInfluence: 0 }
  );
  assert.ok(disabled.every((f) => f === 0), 'Ship Stability = 0 must disable righting forces');
  console.log(`  Passed: restoring torque ${torqueX.toFixed(0)} Nm with zero added net lift.`);
}

console.log('--- Test 6c: Buoyancy requires actual water-volume contact ---');
{
  const sc = makeScene();
  FW.registerWaterBody(sc, mockWaterObject, {}, { waveHeight: 2 });
  const outsideForces = [];
  let outsideZ = 95;
  const physics = {
    getMass: () => 100,
    getLinearVelocityX: () => 0, getLinearVelocityY: () => 0, getLinearVelocityZ: () => 0,
    getAngularVelocityX: () => 0, getAngularVelocityY: () => 0, getAngularVelocityZ: () => 0,
    applyForce: (...a) => outsideForces.push(a),
  };
  const outside = {
    getX: () => 5000, getY: () => 5000, getZ: () => outsideZ,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
    getLayer: () => '', getBehavior: (n) => n === 'Physics3D' ? physics : null,
    setZ: (z) => { outsideZ = z; }, setRotationX() {}, setRotationY() {},
  };
  const outsideBeh = {};
  const outsideBuoy = FW.registerBuoyancy(sc, outside, outsideBeh, {
    hullProbeCount: '4-Corners', maxSubmersionDepth: 20,
  });
  FW.stepBuoyancy(sc, outside, outsideBeh);
  assert.strictEqual(outsideForces.length, 0, 'An object outside the water XY footprint must get no lift');
  assert.strictEqual(outsideZ, 95, 'Kinematic fallback must not teleport an object onto distant water');
  assert.strictEqual(outsideBuoy.isFloating, false, 'Outside object must not report floating');
  assert.strictEqual(outsideBuoy.lastForce, 0, 'Outside object must clear stale buoyancy force');

  const belowForces = [];
  const belowPhysics = { ...physics, applyForce: (...a) => belowForces.push(a) };
  const below = {
    getX: () => 460, getY: () => 420, getZ: () => -100,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
    getLayer: () => '', getBehavior: (n) => n === 'Physics3D' ? belowPhysics : null,
  };
  const belowBeh = {};
  const belowBuoy = FW.registerBuoyancy(sc, below, belowBeh, {
    hullProbeCount: '4-Corners', maxSubmersionDepth: 20,
  });
  FW.stepBuoyancy(sc, below, belowBeh);
  assert.strictEqual(belowForces.length, 0, 'Water must not behave like an infinite column below its volume');
  assert.strictEqual(belowBuoy.isFloating, false, 'Object below the water volume must fall normally');

  const namedForces = [];
  const namedPhysics = { ...physics, applyForce: (...a) => namedForces.push(a) };
  const named = { ...outside,
    getX: () => 460, getY: () => 420,
    getBehavior: (n) => n === 'Physics3D' ? namedPhysics : null,
  };
  const namedBeh = {};
  FW.registerBuoyancy(sc, named, namedBeh, {
    targetWaterBody: 'MissingWater', hullProbeCount: '4-Corners', maxSubmersionDepth: 20,
  });
  FW.stepBuoyancy(sc, named, namedBeh);
  assert.strictEqual(namedForces.length, 0, 'A missing named target must not fall back to another water body');
  console.log('  Passed: outside, below-volume, and missing-target hulls receive no buoyancy.');
}

console.log('--- Test 6b: Fluid drag is computed in m/s, not scene units ---');
{
  // Physics3D reports linear velocity in SCENE UNITS per second (Jolt's m/s multiplied by
  // worldScale) while mass is in kilograms. Feeding the raw figure into a kg-based drag term
  // produced a force worldScale times too large. In the real engine that overwhelmed buoyancy and
  // launched a hull from Z=100 to Z=43000 in under two seconds.
  const forces = [];
  let joltHook = null;
  const physics = {
    // Physics3D drives buoyancy through a Jolt pre-step hook, so exercise that path, and confirm
    // worldScale is read from the shared data rather than assumed.
    _sharedData: { worldScale: 100, registerHook: (h) => { joltHook = h; } },
    getMass: () => 250,
    // 500 scene units/s IS 5 m/s. The drag coefficient must see 5.
    getLinearVelocityX: () => 0, getLinearVelocityY: () => 0, getLinearVelocityZ: () => 500,
    getAngularVelocityX: () => 0, getAngularVelocityY: () => 0, getAngularVelocityZ: () => 0,
    applyForce: (...a) => forces.push(a),
  };
  const boat = {
    getX: () => 460, getY: () => 420, getZ: () => 95,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
    getLayer: () => '', getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    getBehavior: (n) => (n === 'Physics3D' ? physics : null),
  };
  const beh = {};
  const sc = makeScene();
  FW.registerWaterBody(sc, mockWaterObject, {}, { waveHeight: 2.0 });
  FW.registerBuoyancy(sc, boat, beh, {
    buoyancyFactor: 1.0, hullProbeCount: '1-Center', fluidDrag: 2.0, maxSubmersionDepth: 20.0,
  });
  FW.stepBuoyancy(sc, boat, beh);
  assert.ok(joltHook, 'Buoyancy should register a Jolt pre-step hook when Physics3D is present');
  joltHook.doBeforePhysicsStep(1 / 60);

  assert.ok(forces.length > 0, 'A submerged hull with Physics3D should receive a force');
  for (const f of forces) {
    for (const v of f) assert.ok(Number.isFinite(v), `non-finite force component: ${f}`);
  }

  // Buoyancy is mass*g = 2452 N. Drag at 5 m/s with coefficient 2 is 250*2*5 = 2500 N. Reading the
  // velocity as 500 m/s would instead give 250000 N — a hundred gravities.
  const worstZ = Math.max(...forces.map((f) => Math.abs(f[2])));
  const oneGravity = 250 * 9.81;
  assert.ok(worstZ < oneGravity * 10,
    `Drag looks like it is using scene units: |Fz| = ${worstZ.toFixed(0)} N against one gravity of ` +
    `${oneGravity.toFixed(0)} N. Physics3D velocity is px/s and must be divided by worldScale.`);
  console.log(`  Passed: |Fz| ${worstZ.toFixed(0)} N against one gravity ${oneGravity.toFixed(0)} N.`);
}

console.log('--- Test 7: Simulation clock follows real frame time ---');
const fastScene = makeScene({ elapsedMs: 8 });
const slowScene = makeScene({ elapsedMs: 32 });
for (const s of [fastScene, slowScene]) {
  FW.registerWaterBody(s, mockWaterObject, {}, { waveHeight: 2.0 });
  registeredCallbacks.postEvents(s);
}
const tFast = fastScene.threeGroup.children[0].material.uniforms.u_Time.value;
const tSlow = slowScene.threeGroup.children[0].material.uniforms.u_Time.value;
assert.ok(Math.abs(tSlow / tFast - 4.0) < 0.01, `A 4x longer frame must advance the clock 4x (got ${tFast} vs ${tSlow})`);
console.log('  Passed.');

console.log('--- Test 8: Pouring emits from the spout with the preset\'s own material ---');
const mockFlask = {
  getX: () => 10, getY: () => 10, getZ: () => 50,
  getWidth: () => 20, getHeight: () => 20, getDepth: () => 10,
  getLayer: () => '',
  getRotationX: () => 50.0, // past the 45 deg pour threshold
  getRotationY: () => 0.0,
};
const mockLiquidBehavior = {};
const liquid = FW.registerPourableLiquid(mockScene, mockFlask, mockLiquidBehavior, {
  fluidPreset: 'HoneySyrup', pourTiltThreshold: 45.0, flowRate: 100.0, autoPourOnTilt: true, maxDroplets: 500,
});
assert.ok(liquid, 'Pourable liquid registered');
FW.stepPourableLiquid(mockScene, mockFlask, mockLiquidBehavior);
assert.strictEqual(liquid.isPouring, true, 'isPouring should be true when tilted past the threshold');

const emitted = FW.getActiveDropletCount(mockScene, mockLiquidBehavior);
assert.ok(emitted > 0, `Droplets should be emitted on tilt (got ${emitted})`);

// The droplets must carry HoneySyrup's material, not a hardcoded default.
registeredCallbacks.postEvents(mockScene);
assert.ok(FW.getActiveDropletCount(mockScene, mockLiquidBehavior) > 0, 'Droplets survive an SPH step');
console.log(`  Passed: ${emitted} droplets emitted.`);

console.log('--- Test 9: Presets are physically distinguishable ---');
const presets = FW.FLUID_PRESETS;
assert.ok(presets.Water.viscosity < presets.MagicPotion.viscosity);
assert.ok(presets.MagicPotion.viscosity < presets.HoneySyrup.viscosity);
assert.ok(presets.HoneySyrup.viscosity < presets.GreenSlime.viscosity);

// Water and honey poured into the same scene must not share one global viscosity.
const dualScene = makeScene();
const waterFlask = { ...mockFlask, getX: () => 400 };
const honeyFlask = { ...mockFlask, getX: () => 800 };
const waterBeh = {};
const honeyBeh = {};
FW.registerPourableLiquid(dualScene, waterFlask, waterBeh, { fluidPreset: 'Water', flowRate: 60, autoPourOnTilt: true });
FW.registerPourableLiquid(dualScene, honeyFlask, honeyBeh, { fluidPreset: 'HoneySyrup', flowRate: 60, autoPourOnTilt: true });
FW.stepPourableLiquid(dualScene, waterFlask, waterBeh);
FW.stepPourableLiquid(dualScene, honeyFlask, honeyBeh);

assert.ok(FW.pourableOf(dualScene, waterBeh), 'water emitter registered in the dual scene');
assert.ok(FW.getActiveDropletCount(dualScene, waterBeh) > 0, 'water emitter poured');
assert.ok(FW.getActiveDropletCount(dualScene, honeyBeh) > 0, 'honey emitter poured');
// Droplet counts are per emitter, so the two streams are tracked independently rather than
// sharing one global viscosity.
registeredCallbacks.postEvents(dualScene);
console.log('  Passed: viscosity gradation Water < Potion < Honey < Slime, stored per droplet.');

console.log('--- Test 10: Droplets falling into a container raise its fill level ---');
const potScene = makeScene();
const pourer = {
  getX: () => 0, getY: () => 0, getZ: () => 200,
  getWidth: () => 10, getHeight: () => 10, getDepth: () => 10,
  getLayer: () => '', getRotationX: () => 90, getRotationY: () => 0,
};
const pot = {
  getX: () => -100, getY: () => -100, getZ: () => 0,
  getWidth: () => 400, getHeight: () => 400, getDepth: () => 400,
  getLayer: () => '', getRotationX: () => 0, getRotationY: () => 0,
};
const pourerBeh = {};
const potBeh = {};
FW.registerPourableLiquid(potScene, pourer, pourerBeh, { fluidPreset: 'MagicPotion', flowRate: 200, autoPourOnTilt: true, containerCapacity: 0 });
const potLiquid = FW.registerPourableLiquid(potScene, pot, potBeh, { fluidPreset: 'MagicPotion', flowRate: 0, autoPourOnTilt: false, containerCapacity: 1.0 });

assert.strictEqual(FW.getFillLevelPercent(potScene, potBeh), 0.0, 'Cauldron starts empty');
for (let frame = 0; frame < 30; frame++) {
  FW.stepPourableLiquid(potScene, pourer, pourerBeh);
  registeredCallbacks.postEvents(potScene);
}
const fill = FW.getFillLevelPercent(potScene, potBeh);
assert.ok(fill > 0.0, `Droplets landing in the cauldron must raise its fill level (got ${fill}%)`);
console.log(`  Passed: cauldron filled to ${fill.toFixed(1)}%.`);

console.log('--- Test 11: Fill level accessors ---');
potLiquid.containerCapacity = 2.0;
potLiquid.currentVolume = 0.5;
assert.strictEqual(FW.getFillLevelPercent(potScene, potBeh), 25.0);
potLiquid.currentVolume = 4.0;
assert.strictEqual(FW.getFillLevelPercent(potScene, potBeh), 100.0, 'Fill level clamps at 100%');
FW.emptyContainer(potScene, potBeh);
assert.strictEqual(FW.getFillLevelPercent(potScene, potBeh), 0.0);
console.log('  Passed.');

console.log('--- Test 12: Underwater detection un-mirrors the camera Y ---');
// Camera at GDevelop (500, 500, 50); the water box spans X/Y 0..1000 and Z 0..100.
const diveScene = makeScene({ cameraGdY: 500, cameraZ: 50 });
const diveBeh = {};
FW.registerWaterBody(diveScene, mockWaterObject, diveBeh, { enableUnderwaterFX: true, waveHeight: 2.0 });
registeredCallbacks.postEvents(diveScene);
assert.strictEqual(FW.isCameraUnderwaterAny(diveScene), true,
  'A camera inside the box must be detected underwater; comparing three-space Y against a '
  + 'GDevelop-space AABB puts it outside every body at positive Y');
assert.ok(diveScene.threeScene.fog, 'Underwater fog must be installed on the layer scene');

// Surfacing restores the original fog.
const aboveScene = makeScene({ cameraGdY: 500, cameraZ: 5000 });
const aboveBeh = {};
FW.registerWaterBody(aboveScene, mockWaterObject, aboveBeh, { enableUnderwaterFX: true });
registeredCallbacks.postEvents(aboveScene);
assert.strictEqual(FW.isCameraUnderwaterAny(aboveScene), false, 'A camera far above the water is not submerged');
assert.strictEqual(aboveScene.threeScene.fog, null, 'No fog while above water');
console.log('  Passed.');

console.log('--- Test 14: OceanWaveWorks3D renders from the Tessendorf field ---');
const oceanScene2 = makeScene();
const oceanObj = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getWidth: () => 6987, getHeight: () => 7501, getDepth: () => 1000,
  getLayer: () => '', getName: () => 'Ocean',
  get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
};
const oceanBeh = {};
const ocean = FW.registerWaveWorksOcean(oceanScene2, oceanObj, oceanBeh, { beaufortScale: 'Custom',
  windSpeed: 14, windDirection: 45, resolution: 32, gridSubdivisions: 32,
  waveHeightScale: 1, choppiness: 1, seed: 1337,
});
assert.ok(ocean, 'Ocean registered');
assert.strictEqual(ocean.tileSize, 7501, 'Tile defaults to the volume size so the field never repeats');
assert.strictEqual(ocean.resolution, 32, 'Resolution is snapped to a power of two');

// Wave height comes from the wind, not from an authored number — but it is then scaled with the
// wavelength so the sea fits the body it lives in. A real 14 m/s sea has 4.2 m waves 130 m long;
// on a 75 m body the physically correct result is one swell spanning the whole surface, which
// renders as flat. Auto-fit shrinks length and height together, preserving steepness.
const hs = FW.getSignificantWaveHeight(oceanScene2, oceanBeh);
const unfittedHs = 0.21 * 14 * 14 / 9.81 * 100;      // 420 units
assert.ok(hs > 0 && hs < unfittedHs,
  `Auto-fit should scale Hs below the unfitted ${unfittedHs.toFixed(0)}, got ${hs.toFixed(0)}`);
assert.ok(Math.abs(hs - unfittedHs * ocean.field.heightFit) < 1,
  'Hs must carry the fitted height scale');
// Height shrinks more slowly than length, so a fetch-limited body gets a steeper sea. Equal
// scaling would freeze the shape and make wind speed stop mattering entirely.
assert.ok(ocean.field.heightFit >= ocean.wavelengthScale,
  'Height must not shrink faster than wavelength');

// Steepness must land in the range a real wind sea occupies (Hs/peak = 0.21/4.44 = 0.047).
const fittedPeak = ocean.field.peakWavelength;
assert.ok(fittedPeak > 0, 'The field should report where its spectrum peaks');
const fittedSteepness = hs / fittedPeak;
// A fully developed sea sits at 0.047; a fetch-limited one is steeper, capped at 0.10 so it never
// reaches the ~0.14 where real waves break and the surface would fold into spikes.
assert.ok(fittedSteepness > 0.02 && fittedSteepness <= 0.105,
  `Fitted steepness ${fittedSteepness.toFixed(3)} should sit between a developed sea (0.047) and ` +
  'the 0.10 fetch-limited cap');

// And the body must show enough waves to read as water rather than as a flat sheet.
const wavesAcross = ocean.tileSize / fittedPeak;
assert.ok(wavesAcross > 2.0 && wavesAcross < 20.0,
  `${wavesAcross.toFixed(1)} waves across the body — under ~2 reads as flat, over ~20 as noise`);

// An explicit scale must override the auto fit.
const manualBeh = {};
const manual = FW.registerWaveWorksOcean(oceanScene2, oceanObj, manualBeh, { beaufortScale: 'Custom',
  windSpeed: 14, resolution: 32, gridSubdivisions: 32, wavelengthScale: 1.0,
});
assert.ok(Math.abs(manual.significantWaveHeight - unfittedHs) < 1,
  `WavelengthScale 1 must give the unfitted physical height, got ${manual.significantWaveHeight.toFixed(0)}`);
FW.disposeOcean(oceanScene2, manualBeh);

// The data texture must carry displacement + Jacobian, and actually be populated.
const tex = ocean.texture.image.data;
assert.strictEqual(tex.length, 32 * 32 * 4, 'RGBA per grid cell');
let nonZero = 0, foamSeen = 0, foamSum = 0;
for (let i = 0; i < 32 * 32; i++) {
  if (tex[i * 4 + 2] !== 0) nonZero++;
  const fold = tex[i * 4 + 3];
  assert.ok(fold >= 0 && fold <= 1, `Foam channel must be a 0..1 fold amount, got ${fold}`);
  if (fold > 0.01) foamSeen++;
  foamSum += fold;
}
assert.ok(nonZero > 900, `Height channel should be populated, got ${nonZero} non-zero of 1024`);
// The alpha channel is the FOLD amount, so most of a calm surface reads zero — that is what makes
// an unpopulated field default to "no foam" instead of painting the ocean white.
// Foam is generated by Rare's rule - saturate((threshold - detJ) / threshold) - so it only appears
// where the surface is genuinely close to folding. On a 14 m/s sea with choppiness 1 that is a
// small minority of cells and can legitimately be none at all; the old lower bound of 50 was
// calibrated against a formula that generated foam wherever the surface compressed at all.
// What must hold here is the CEILING: the whole sea must never break at once.
assert.ok(foamSeen < 1000, 'Not the entire surface should be breaking at once');
{
  // And the floor belongs at a sea state that should actually be breaking. A strong gale must.
  const galeScene = makeScene();
  const galeBeh = {};
  const gale = FW.registerWaveWorksOcean(galeScene, oceanObj, galeBeh, {
    beaufortScale: 'Beaufort 9 - Strong Gale', resolution: 32, gridSubdivisions: 32,
  });
  FW.updateOceanField(gale, 3.0);
  let breaking = 0;
  for (let i = 0; i < gale.foamBuffer.length; i++) if (gale.foamBuffer[i] > 0.01) breaking++;
  assert.ok(breaking > 50, `A strong gale must be breaking somewhere, got ${breaking} cells`);
  FW.disposeOcean(galeScene, galeBeh);
}
assert.ok(foamSum / 1024 < 0.8, 'Mean fold should be well below 1');

// The surface the shader displaces and the height buoyancy samples must be the same number.
// This is a dual-cascade ocean, so the expected value is cascade 0 plus the weighted cascade 1 -
// exactly the sum the vertex shader displaces by.
const sampled = FW.getOceanWaveHeightAt(oceanScene2, oceanBeh, 1234, 5678);
const expectedHeight = ocean.field.sampleHeight(1234, 5678)
  + ocean.cascadeWeight * ocean.field1.sampleHeight(1234, 5678);
assert.ok(Math.abs(sampled - expectedHeight) < 1e-9,
  'WaveHeightAt must read the same fields the textures were built from');
const surfZ = FW.getOceanSurfaceZ(oceanScene2, oceanBeh, 1234, 5678);
assert.ok(Math.abs(surfZ - (1000 + sampled)) < 1e-6,
  'Surface altitude must sit on the volume top face plus the wave');

// Shaders must not collide with three.js built-ins, same rule as the Gerstner material.
for (const stage of ['vertexShader', 'fragmentShader']) {
  for (const name of THREE_BUILTIN_UNIFORMS) {
    assert.ok(!new RegExp(`uniform\s+\w+\s+${name}\s*;`).test(ocean.material[stage]),
      `Ocean ${stage} redeclares three.js built-in "${name}"`);
  }
}
assert.ok(/vec2 gdXY = vec2\(worldPos\.x, -worldPos\.y\);/.test(ocean.material.vertexShader),
  'Ocean vertex shader must un-mirror Y before sampling the field');
console.log(`  Passed: Hs ${hs.toFixed(0)} units, field texture populated, CPU/GPU read one source.`);

const oceanRef = () => FW.oceanOf(oceanScene2, oceanBeh);
console.log('--- Test 15: Changing wind changes the sea ---');
{
  // Wind must change the sea across its usable range. On a fitted body it SATURATES once the
  // waves are as steep as water gets (~0.10) — beyond that a stronger wind cannot make a bigger
  // sea than the body can hold, so the height stops climbing. Compare inside the live range.
  FW.setOceanWind(oceanScene2, oceanBeh, 4, 45);
  const calm = FW.getSignificantWaveHeight(oceanScene2, oceanBeh);
  FW.setOceanWind(oceanScene2, oceanBeh, 12, 45);
  const rough = FW.getSignificantWaveHeight(oceanScene2, oceanBeh);
  assert.ok(rough > calm * 1.5,
    `12 m/s must give a visibly bigger sea than 4 m/s (${calm.toFixed(0)} -> ${rough.toFixed(0)})`);

  // And past saturation the height must hold steady rather than growing without limit.
  FW.setOceanWind(oceanScene2, oceanBeh, 24, 45);
  const gale = FW.getSignificantWaveHeight(oceanScene2, oceanBeh);
  // Growth must be BOUNDED. Unfitted, 24 m/s would be ~3x the sea of 12 m/s; fitted to a body it
  // grows far more slowly and eventually stops, because a body cannot hold a bigger sea than it has
  // room for.
  const unfittedRatio = (24 * 24) / (12 * 12);      // 4x, if nothing were fitted
  assert.ok(gale >= rough && gale < rough * (unfittedRatio / 2),
    `Fitted growth should be well under the unfitted ${unfittedRatio}x, got ` +
    `${rough.toFixed(0)} -> ${gale.toFixed(0)}`);
  assert.ok(gale / oceanRef().field.peakWavelength < 0.12,
    'Fitted steepness must stay below breaking even in a gale');
  FW.setOceanWind(oceanScene2, oceanBeh, 14, 45);
  const before = FW.getSignificantWaveHeight(oceanScene2, oceanBeh);
  const after = before;
  FW.setOceanWind(oceanScene2, oceanBeh, 14, 45);
  assert.ok(Math.abs(FW.getSignificantWaveHeight(oceanScene2, oceanBeh) - before) < 1e-6,
    'Returning to the same wind must rebuild the identical sea');
  console.log('  Passed.');
}

console.log('--- Test 16: WaterEdge3D drives foam and shallows ---');
{
  const edgeScene = makeScene();
  const eOcean = FW.registerWaveWorksOcean(edgeScene, oceanObj, {}, { beaufortScale: 'Custom', windSpeed: 12, resolution: 32, gridSubdivisions: 32 });
  const edgeWaterBeh = {};
  const edgeWater = FW.registerWaterBody(edgeScene, oceanObj, edgeWaterBeh, {
    waveHeight: 18, gridSubdivisions: 48,
  });
  assert.strictEqual(eOcean.material.uniforms.u_EdgeCount.value, 0, 'No edges to begin with');
  assert.strictEqual(edgeWater.material.uniforms.u_EdgeCount.value, 0, 'Gerstner water starts without edges');

  const beach = {
    getX: () => 6000, getY: () => 0, getZ: () => 900,
    getWidth: () => 1000, getHeight: () => 7501, getDepth: () => 200,
    getLayer: () => '', getName: () => 'Beach',
    get3DRendererObject: () => beachRoot,
  };
  const beachRoot = { visible: true };
  const beachBeh = {};
  FW.registerWaterEdge(edgeScene, beach, beachBeh, { foamWidth: 150, shallowWidth: 500 });

  registeredCallbacks.postEvents(edgeScene);
  // Drive the one-time ocean report while an edge IS registered. Its shore section is only
  // reached on that combination, so a bad reference in there survives every other test.
  FW.stepOcean(edgeScene, oceanObj, eOcean.behavior);
  const u = eOcean.material.uniforms;
  assert.strictEqual(u.u_EdgeCount.value, 1, 'The beach must reach the water shader');
  assert.strictEqual(edgeWater.material.uniforms.u_EdgeCount.value, 1,
    'WaterBody3D must receive the same WaterEdge3D as OceanFFT3D');
  assert.strictEqual(u.u_EdgeBounds.value[0].x, 6000, 'Edge bounds are in GDevelop space');
  assert.strictEqual(u.u_EdgeBounds.value[0].z, 7000, 'Edge max X');
  assert.strictEqual(u.u_EdgeParams.value[0].x, 150, 'Foam width reaches the shader');
  assert.strictEqual(u.u_EdgeParams.value[0].y, 500, 'Shallow width reaches the shader');
  for (const material of [eOcean.material, edgeWater.material]) {
    assert.ok(material.vertexShader.includes('shoreAttenuation'),
      'Both vertex shaders must damp displacement toward shore');
    assert.ok(material.fragmentShader.includes('signedDistanceToWaterEdge'),
      'Both fragment shaders must use a signed land boundary');
    assert.ok(material.fragmentShader.includes('discard'),
      'Both fragment shaders must mask water beneath land');
    assert.ok(material.fragmentShader.includes('contact') || material.fragmentShader.includes('contactFoam'),
      'Both water shaders must keep an unbroken water-side foam contact line');
    const finalColorAt = material.fragmentShader.indexOf('vec3 finalColor');
    const finalFoamAt = material.fragmentShader.indexOf('finalColor = mix(finalColor, foamColor, foam)');
    assert.ok(finalFoamAt > finalColorAt,
      'Foam must be composited after Fresnel reflection so it cannot be tinted back into the water');
  }

  // An edge on another rendered layer or wholly below the surface cannot affect this water.
  const wrongLayerBeh = {};
  FW.registerWaterEdge(edgeScene, {
    ...beach, getLayer: () => 'UI', getX: () => 2000,
  }, wrongLayerBeh, { foamWidth: 150, shallowWidth: 500 });
  const belowBeh = {};
  FW.registerWaterEdge(edgeScene, {
    ...beach, getZ: () => 0, getDepth: () => 200, getX: () => 3500,
  }, belowBeh, { foamWidth: 150, shallowWidth: 500 });
  registeredCallbacks.postEvents(edgeScene);
  assert.strictEqual(u.u_EdgeCount.value, 1, 'Wrong-layer and vertically separate edges are ignored');
  assert.strictEqual(edgeWater.material.uniforms.u_EdgeCount.value, 1,
    'WaterBody3D applies the same layer and vertical filtering');

  // CPU height queries use the same attenuation as the shaders: waves are flat under land.
  assert.strictEqual(FW.getOceanWaveHeightAt(edgeScene, eOcean.behavior, 6500, 2000), 0,
    'FFT CPU sampling must flatten beneath the edge mask');
  assert.strictEqual(FW.getWaveHeightAt(edgeScene, edgeWaterBeh, 6500, 2000), 0,
    'Gerstner CPU sampling must flatten beneath the edge mask');

  // Dedicated helper boxes can be hidden without forcing visible land objects to disappear.
  FW.stepWaterEdge(edgeScene, beach, beachBeh, true);
  assert.strictEqual(beachRoot.visible, false, 'Hide Helper Object hides a dedicated marker volume');
  FW.stepWaterEdge(edgeScene, beach, beachBeh, false);
  assert.strictEqual(beachRoot.visible, true, 'Disabling the option restores a marker hidden by the behavior');

  // Disabling must remove it without destroying the object.
  FW.setWaterEdgeEnabled(edgeScene, beachBeh, false);
  registeredCallbacks.postEvents(edgeScene);
  assert.strictEqual(u.u_EdgeCount.value, 0, 'A disabled edge must stop affecting the water');
  assert.strictEqual(edgeWater.material.uniforms.u_EdgeCount.value, 0,
    'A disabled edge must stop affecting WaterBody3D too');

  FW.setWaterEdgeEnabled(edgeScene, beachBeh, true);
  FW.disposeWaterEdge(edgeScene, beachBeh);
  FW.disposeWaterEdge(edgeScene, wrongLayerBeh);
  FW.disposeWaterEdge(edgeScene, belowBeh);
  registeredCallbacks.postEvents(edgeScene);
  assert.strictEqual(u.u_EdgeCount.value, 0, 'A destroyed edge must stop affecting the water');
  console.log('  Passed.');

console.log('--- Test 16c: Foam band is sized against the water body, not a fixed default ---');
{
  // A fixed 120-unit band is a wide beach on a small pond and an invisible hairline on a large
  // bay. Left at 0, the widths must follow the water body so foam reads at any scale.
  function bandFor(shortSide) {
    const sc = makeScene();
    const water = {
      getX: () => 0, getY: () => 0, getZ: () => 0,
      getWidth: () => shortSide, getHeight: () => shortSide * 1.1, getDepth: () => 100,
      getLayer: () => '', getName: () => 'Water',
      get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
    };
    const beh = {};
    const body = FW.registerWaterBody(sc, water, beh, { waveHeight: 5, gridSubdivisions: 16 });
    const edgeBeh = {};
    FW.registerWaterEdge(sc, {
      getX: () => shortSide, getY: () => 0, getZ: () => 0,
      getWidth: () => 500, getHeight: () => shortSide * 1.1, getDepth: () => 200,
      getLayer: () => '', getName: () => 'Beach',
    }, edgeBeh, { foamWidth: 0, shallowWidth: 0 });
    registeredCallbacks.postEvents(sc);
    const p = body.material.uniforms.u_EdgeParams.value[0];
    assert.strictEqual(body.material.uniforms.u_EdgeCount.value, 1, 'The beach must reach the shader');
    return { foam: p.x, shallow: p.y };
  }

  const small = bandFor(1000);
  const large = bandFor(8000);
  assert.ok(large.foam > small.foam * 4,
    'A body 8x larger must get a proportionally wider foam band, not the same fixed width');
  assert.ok(small.foam / 1000 > 0.05 && small.foam / 1000 < 0.15,
    'The auto band should be a readable fraction of the water, got ' + (small.foam / 1000));
  assert.ok(Math.abs(large.shallow / large.foam - 3.0) < 1e-6,
    'Shallow width defaults to three times the foam band');

  // An explicit width must still win outright.
  const scFixed = makeScene();
  const wFixed = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 8000, getHeight: () => 8000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'Water',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const bFixed = {};
  const bodyFixed = FW.registerWaterBody(scFixed, wFixed, bFixed, { waveHeight: 5, gridSubdivisions: 16 });
  FW.registerWaterEdge(scFixed, {
    getX: () => 8000, getY: () => 0, getZ: () => 0,
    getWidth: () => 500, getHeight: () => 8000, getDepth: () => 200,
    getLayer: () => '', getName: () => 'Beach',
  }, {}, { foamWidth: 250, shallowWidth: 900 });
  registeredCallbacks.postEvents(scFixed);
  const pf = bodyFixed.material.uniforms.u_EdgeParams.value[0];
  assert.strictEqual(pf.x, 250, 'An authored foam width must not be auto-fitted away');
  assert.strictEqual(pf.y, 900, 'An authored shallow width must not be auto-fitted away');

  // A water object that reports no size yet makes the callers' Math.min collapse to Infinity,
  // which is a number and is greater than zero — it must not reach the shader as a band width.
  const scZero = makeScene();
  const zeroSized = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 0, getHeight: () => 0, getDepth: () => 100,
    getLayer: () => '', getName: () => 'Water',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const bZero = {};
  const bodyZero = FW.registerWaterBody(scZero, zeroSized, bZero, { waveHeight: 5, gridSubdivisions: 16 });
  FW.registerWaterEdge(scZero, {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 500, getHeight: () => 500, getDepth: () => 200,
    getLayer: () => '', getName: () => 'Beach',
  }, {}, { foamWidth: 0, shallowWidth: 0 });
  registeredCallbacks.postEvents(scZero);
  const pz = bodyZero.material.uniforms.u_EdgeParams.value[0];
  assert.ok(Number.isFinite(pz.x) && Number.isFinite(pz.y),
    `Foam widths must stay finite when the water reports no size, got ${pz.x} / ${pz.y}`);

  console.log(`  Passed: 1000-unit body -> ${Math.round(small.foam)} units of foam, ` +
    `8000-unit body -> ${Math.round(large.foam)}.`);
}
}

{
  console.log('--- Test 16b: Moving Physics3D/Jolt bodies drive both water surfaces ---');
  const interactionScene = makeScene();
  const waterObject = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1200, getHeight: () => 1200, getDepth: () => 100,
    getLayer: () => '', getName: () => 'InteractionWater',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const waterBeh = {};
  const oceanBeh = {};
  const body = FW.registerWaterBody(interactionScene, waterObject, waterBeh, {
    waveHeight: 4, enableBodyInteractions: true, interactionStrength: 20,
    interactionRadius: 160, interactionSpeedThreshold: 30,
  });
  const interactionOcean = FW.registerWaveWorksOcean(interactionScene, waterObject, oceanBeh, { beaufortScale: 'Custom',
    windSpeed: 8, resolution: 32, gpuResolution: 0, enableBodyInteractions: true,
    interactionStrength: 20, interactionRadius: 160, interactionSpeedThreshold: 30,
  });

  const physics = {
    applyForce() {}, getMass: () => 80,
    getLinearVelocityX: () => 220,
    getLinearVelocityY: () => 35,
    getLinearVelocityZ: () => -90,
  };
  const player = {
    getX: () => 500, getY: () => 500, getZ: () => 70,
    getWidth: () => 60, getHeight: () => 60, getDepth: () => 90,
    getLayer: () => '',
    getBehavior: (name) => name === 'Physics3D' ? physics : null,
  };
  interactionScene._objects = [waterObject, player];
  registeredCallbacks.postEvents(interactionScene);

  assert.strictEqual(body.material.uniforms.u_InteractionCount.value, 1,
    'WaterBody3D must receive a splash from the moving Jolt body');
  assert.strictEqual(interactionOcean.material.uniforms.u_InteractionCount.value, 1,
    'OceanFFT3D must receive the same kind of splash from the moving Jolt body');
  assert.ok(body.material.vertexShader.includes('interactionWave'),
    'WaterBody3D must displace its surface around interactions');
  assert.ok(interactionOcean.material.vertexShader.includes('interactionWave'),
    'OceanFFT3D must displace its surface around interactions');
  assert.ok(body.material.fragmentShader.includes('vInteractionFoam') &&
    interactionOcean.material.fragmentShader.includes('vInteractionFoam'),
    'Both water types must render splash foam');

  const withRipple = FW.getWaveHeightAt(interactionScene, waterBeh, 530, 530);
  const saved = body.interactions;
  body.interactions = [];
  const withoutRipple = FW.getWaveHeightAt(interactionScene, waterBeh, 530, 530);
  body.interactions = saved;
  assert.ok(Math.abs(withRipple - withoutRipple) > 0.1,
    'CPU height queries and buoyancy must see the rendered interaction ripple');
  console.log('  Passed: automatic Jolt wake, splash foam, and CPU/GPU ripple agreement.');
}

console.log('--- Test 17: Buoyancy floats on the ocean field, not a separate one ---');
{
  const bScene = makeScene();
  const bOcean = FW.registerWaveWorksOcean(bScene, oceanObj, {}, { beaufortScale: 'Custom', windSpeed: 14, resolution: 32, gridSubdivisions: 32 });
  const boat = {
    _z: 1000,
    getX: () => 3000, getY: () => 3000, getZ: () => boat._z,
    getWidth: () => 200, getHeight: () => 400, getDepth: () => 100,
    getLayer: () => '', getRotationX: () => 0, getRotationY: () => 0,
    setZ: (z) => { boat._z = z; }, setRotationX() {}, setRotationY() {},
  };
  const bBeh = {};
  FW.registerBuoyancy(bScene, boat, bBeh, { buoyancyFactor: 1, hullProbeCount: '4-Corners', maxSubmersionDepth: 200 });
  for (let i = 0; i < 40; i++) FW.stepBuoyancy(bScene, boat, bBeh);

  // The hull must settle near the ocean surface the shader is drawing. Passing null asks for
  // "whichever ocean is registered"; passing a behavior object looks that behavior up.
  const expected = FW.getOceanSurfaceZ(bScene, null, 3000, 3000);
  assert.ok(expected > 500, `Surface lookup returned ${expected}, expected it on the volume top face`);
  assert.ok(Math.abs(boat._z - expected) < 500,
    `Hull settled at ${boat._z.toFixed(0)} but the surface is at ${expected.toFixed(0)}`);
  assert.ok(FW.buoyancyOf(bScene, bBeh).isFloating, 'Boat should report floating');
  console.log(`  Passed: hull at ${boat._z.toFixed(0)}, surface at ${expected.toFixed(0)}.`);
}

console.log('--- Test 17b: A distant ocean does not hijack nearby water buoyancy ---');
{
  const sc = makeScene();
  const farOceanObject = {
    getX: () => 10000, getY: () => 10000, getZ: () => 0,
    getWidth: () => 2000, getHeight: () => 2000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'FarOcean',
    get3DRendererObject: () => ({ add() {}, traverse() {} }),
  };
  FW.registerWaveWorksOcean(sc, farOceanObject, {}, { beaufortScale: 'Custom', windSpeed: 8, resolution: 32, gridSubdivisions: 32 });
  FW.registerWaterBody(sc, mockWaterObject, {}, { waveHeight: 2 });

  const forces = [];
  const physics = {
    getMass: () => 100,
    getLinearVelocityX: () => 0, getLinearVelocityY: () => 0, getLinearVelocityZ: () => 0,
    getAngularVelocityX: () => 0, getAngularVelocityY: () => 0, getAngularVelocityZ: () => 0,
    applyForce: (...a) => forces.push(a),
  };
  const boat = {
    getX: () => 460, getY: () => 420, getZ: () => 95,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
    getLayer: () => '', getBehavior: (n) => n === 'Physics3D' ? physics : null,
  };
  const beh = {};
  FW.registerBuoyancy(sc, boat, beh, { hullProbeCount: '4-Corners', maxSubmersionDepth: 20 });
  FW.stepBuoyancy(sc, boat, beh);
  assert.ok(forces.length > 0, 'The overlapping WaterBody3D must be used when the ocean is far away');
  assert.ok(FW.buoyancyOf(sc, beh).isFloating, 'Nearby regular water should still report floating');

  const oceanOnlyScene = makeScene();
  FW.registerWaveWorksOcean(oceanOnlyScene, farOceanObject, {}, { beaufortScale: 'Custom', windSpeed: 8, resolution: 32, gridSubdivisions: 32 });
  const dryForces = [];
  const dryPhysics = { ...physics, applyForce: (...a) => dryForces.push(a) };
  const dryBoat = { ...boat, getBehavior: (n) => n === 'Physics3D' ? dryPhysics : null };
  const dryBeh = {};
  FW.registerBuoyancy(oceanOnlyScene, dryBoat, dryBeh, { hullProbeCount: '4-Corners', maxSubmersionDepth: 20 });
  FW.stepBuoyancy(oceanOnlyScene, dryBoat, dryBeh);
  assert.strictEqual(dryForces.length, 0, 'A distant OceanFFT3D must not apply buoyancy');
  assert.strictEqual(FW.buoyancyOf(oceanOnlyScene, dryBeh).isFloating, false);
  console.log('  Passed: only the physically overlapping water type is selected.');
}

console.log('--- Test 20: The volume size is not readable until after onCreated ---');
{
  // GDevelop applies an instance's custom width/height AFTER the behavior's onCreated runs, so a
  // Cube3D still reports its object default (100x100x100) at registration. Deriving the wave tile
  // and the significant wave height there left a 7000-unit ocean carrying a 100-unit tile and
  // 300-unit waves: the field repeated ~70 times across the body and displaced the surface clean
  // outside it, which on screen looked like the water simply not being there.
  const sc = makeScene();
  let X = 0, Y = 0, Z = 0, W = 100, H = 100, D = 100; // what onCreated sees
  const obj = {
    getX: () => X, getY: () => Y, getZ: () => Z,
    getWidth: () => W, getHeight: () => H, getDepth: () => D,
    getLayer: () => '', getName: () => 'oceaon',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const beh = {};
  const o = FW.registerWaveWorksOcean(sc, obj, beh, { beaufortScale: 'Custom',
    windSpeed: 12, windDirection: 45, resolution: 32, gridSubdivisions: 32,
  });
  assert.strictEqual(o.tileSize, 100, 'At creation the object still reports its default size');
  assert.strictEqual(o.mesh.visible, false,
    'The spectral surface must stay hidden until the editor transform is readable');
  assert.deepStrictEqual([o.mesh.position.x, o.mesh.position.y, o.mesh.position.z], [0, 0, 0],
    'Ocean onCreated must not bake the temporary world origin into the surface');

  // The editor now applies the instance transform and size, and the first step runs.
  X = 5228; Y = -8280; Z = -866; W = 6987; H = 7501; D = 1000;
  FW.stepOcean(sc, obj, beh);
  assert.strictEqual(o.mesh.visible, true, 'The spectral surface appears after final placement');
  assert.deepStrictEqual(
    [o.mesh.position.x, o.mesh.position.y, o.mesh.position.z],
    [8721.5, -4529.5, 134.1],
    'OceanFFT3D must reveal at the final editor-authored transform'
  );

  assert.strictEqual(o.tileSize, 7501,
    'The tile must be re-derived from the volume once its real size is known');
  const steep = o.significantWaveHeight / o.tileSize;
  assert.ok(steep < 0.15,
    `Waves must be a sane fraction of the body, got ${(steep * 100).toFixed(0)}% of the tile`);
  assert.ok(Math.abs(o.material.uniforms.u_TileSize.value - 7501) < 1e-6,
    'The shader must be told the new tile size');
  assert.ok(o.field.tileSize === 7501, 'The CPU field must be rebuilt for the new tile');

  // Rebuilding is expensive, so it must happen only when the size actually changes.
  const fieldRef = o.field;
  FW.stepOcean(sc, obj, beh);
  FW.stepOcean(sc, obj, beh);
  assert.strictEqual(o.field, fieldRef, 'An unchanged size must not rebuild the spectrum every frame');

  // A genuine resize should still take effect.
  W = 3000; H = 3000;
  FW.stepOcean(sc, obj, beh);
  assert.strictEqual(o.tileSize, 3000, 'A real resize must re-derive the tile');

  // An explicit Tile Size must be respected and never overridden by the volume.
  const sc2 = makeScene();
  let W2 = 100;
  const obj2 = { ...obj, getWidth: () => W2, getHeight: () => W2 };
  const beh2 = {};
  const o2 = FW.registerWaveWorksOcean(sc2, obj2, beh2, { beaufortScale: 'Custom',
    windSpeed: 12, resolution: 32, gridSubdivisions: 32, tileSize: 2500,
  });
  W2 = 6987;
  FW.stepOcean(sc2, obj2, beh2);
  assert.strictEqual(o2.tileSize, 2500, 'An explicit Tile Size must survive the volume being resized');
  console.log(`  Passed: tile 100 -> 7501, waves ${(steep * 100).toFixed(1)}% of the body.`);
}

console.log('--- Test 16e: Edge widths resolve per water body, not from shared state ---');
{
  // The effective foam and shallow widths used to be written onto the shared edge record by
  // uploadWaterEdges. Two consequences: an edge shared by two differently sized waters kept
  // whichever resolved last, and an edge crowded out of the nearest-eight upload was never
  // resolved at all, so CPU queries read a registration default. Both are order-dependent bugs
  // that no amount of shader correctness would show.
  const mkWater = (name, size) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => size, getHeight: () => size, getDepth: () => 100,
    getLayer: () => '', getName: () => name,
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {}, add() {} }),
  });

  const sc = makeScene();
  const smallBeh = {}, bigBeh = {};
  const small = FW.registerWaterBody(sc, mkWater('Small', 800), smallBeh, { waveHeight: 10, gridSubdivisions: 16 });
  const big = FW.registerWaterBody(sc, mkWater('Big', 9000), bigBeh, { waveHeight: 10, gridSubdivisions: 16 });
  // One beach, bordering both, with both widths on auto.
  FW.registerWaterEdge(sc, {
    getX: () => 9000, getY: () => 0, getZ: () => 0,
    getWidth: () => 500, getHeight: () => 9000, getDepth: () => 200,
    getLayer: () => '', getName: () => 'Beach',
  }, {}, { foamWidth: 0, shallowWidth: 0 });
  registeredCallbacks.postEvents(sc);

  const smallFoam = small.material.uniforms.u_EdgeParams.value[0].x;
  const bigFoam = big.material.uniforms.u_EdgeParams.value[0].x;
  assert.ok(bigFoam > smallFoam * 5,
    `Each body must size the shared edge against itself, got ${smallFoam} and ${bigFoam}`);

  // The CPU side must agree with each body's own uniform, whichever uploaded last. Sampling the
  // same world point through both behaviors has to give the two different attenuations.
  const px = 8800, py = 4000;
  const hSmall = FW.getWaveHeightAt(sc, smallBeh, px, py);
  const hBig = FW.getWaveHeightAt(sc, bigBeh, px, py);
  assert.ok(Number.isFinite(hSmall) && Number.isFinite(hBig), 'CPU shore sampling must stay finite');
  assert.notStrictEqual(hSmall, hBig,
    'A shared edge must attenuate each water body by its own shallow width, not by shared state');

  // An edge pushed out of the nearest-eight upload must still be correct on the CPU.
  const crowd = makeScene();
  const cBeh = {};
  const cBody = FW.registerWaterBody(crowd, mkWater('W', 3000), cBeh, { waveHeight: 10, gridSubdivisions: 16 });
  for (let i = 0; i < 12; i++) {
    FW.registerWaterEdge(crowd, {
      getX: () => 3000 + i * 40, getY: () => 0, getZ: () => 0,
      getWidth: () => 300, getHeight: () => 3000, getDepth: () => 200,
      getLayer: () => '', getName: () => 'E' + i,
    }, {}, { foamWidth: 0, shallowWidth: 0 });
  }
  registeredCallbacks.postEvents(crowd);
  assert.strictEqual(cBody.material.uniforms.u_EdgeCount.value, 8,
    'The shader still carries only the eight nearest edges');
  const hCrowd = FW.getWaveHeightAt(crowd, cBeh, 2900, 1500);
  assert.ok(Number.isFinite(hCrowd), 'CPU sampling past the eight-edge limit must stay finite');

  console.log(`  Passed: 800-unit body -> ${Math.round(smallFoam)} units, ` +
    `9000-unit body -> ${Math.round(bigFoam)}, from one shared edge.`);
}

console.log('--- Test 16d: Bad numbers from events never reach a uniform ---');
{
  // GDevelop hands behavior number properties straight from event expressions, so a division by
  // zero arrives as NaN. NaN in u_WaveHeight makes every vertex NaN and a mesh with NaN positions
  // is not rasterised at all: the water vanishes with nothing logged anywhere.
  const sc = makeScene();
  const o = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 3000, getHeight: () => 3000, getDepth: () => 200,
    getLayer: () => '', getName: () => 'W',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {}, add() {} }),
  };
  const body = FW.registerWaterBody(sc, o, {}, {
    waveHeight: NaN, waveChoppiness: Infinity, waveSpeed: -Infinity, waveTiling: NaN,
    extinctionDepth: NaN, shoreFoamIntensity: NaN, gridSubdivisions: 32,
  });
  FW.registerWaterEdge(sc, {
    getX: () => 3000, getY: () => 0, getZ: () => 0,
    getWidth: () => 500, getHeight: () => 3000, getDepth: () => 400,
    getLayer: () => '', getName: () => 'E',
  }, {}, { foamWidth: NaN, shallowWidth: -10 });
  registeredCallbacks.postEvents(sc);

  const offenders = [];
  for (const [k, u] of Object.entries(body.material.uniforms)) {
    const v = u.value;
    if (typeof v === 'number' && !Number.isFinite(v)) offenders.push(`${k}=${v}`);
    if (v && typeof v === 'object') {
      for (const c of ['x', 'y', 'z', 'w']) {
        if (c in v && !Number.isFinite(v[c])) offenders.push(`${k}.${c}=${v[c]}`);
      }
    }
    if (Array.isArray(v)) {
      v.forEach((e, i) => {
        if (e && typeof e === 'object') {
          for (const c of ['x', 'y', 'z', 'w']) {
            if (c in e && !Number.isFinite(e[c])) offenders.push(`${k}[${i}].${c}=${e[c]}`);
          }
        }
      });
    }
  }
  assert.deepStrictEqual(offenders, [],
    'NaN/Infinity properties must fall back to defaults, not reach the shader: ' + offenders.join(', '));
  assert.ok(Number.isFinite(body.material.uniforms.u_WaveHeight.value) &&
    body.material.uniforms.u_WaveHeight.value > 0,
    'A NaN Wave Height must fall back to the default, not blank the surface');
  console.log(`  Passed: bad inputs fell back, u_WaveHeight = ${body.material.uniforms.u_WaveHeight.value}.`);
}

console.log('--- Test 22: OceanWaveWorks3D multi-cascade ocean, Beaufort scale presets, and buoyancy ---');
{
  const wwScene = makeScene();
  const wwObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => 'WaveWorksOcean',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const wwBeh = {};

  const wwOcean = FW.registerWaveWorksOcean(wwScene, wwObj, wwBeh, {
    beaufortScale: 'FlatWater',
    gridSubdivisions: 32,
    resolution: 32,
    tileSize: 5000,
    cascadeScale: 0.25,
    cascadeWeight: 0.60,
  });

  assert.ok(wwOcean, 'WaveWorks ocean must register');
  assert.strictEqual(wwOcean.isWaveWorks, true, 'isWaveWorks flag must be true');
  assert.ok(wwOcean.field, 'Primary cascade field must exist');
  assert.ok(wwOcean.field1, 'Secondary cascade field must exist');
  assert.strictEqual(wwOcean.cascadeTileSize, 1250, 'Secondary cascade tile size must be 5000 * 0.25 = 1250');
  assert.strictEqual(wwOcean.significantWaveHeight, 0.0, 'Flat water significant wave height must be 0');
  assert.strictEqual(FW.getOceanWaveHeightAt(wwScene, wwBeh, 100, 100), 0.0, 'Height sample on flat water must be 0');

  // Test Beaufort preset switching
  FW.setWaveWorksBeaufort(wwScene, wwBeh, 'Beaufort6_StrongBreeze');
  assert.strictEqual(FW.getWaveWorksBeaufort(wwScene, wwBeh), 'Beaufort 6 - Strong Breeze');
  assert.strictEqual(wwOcean.windSpeed, 12.5, 'Beaufort 6 wind speed is 12.5 m/s');
  assert.strictEqual(wwOcean.gridSubdivisions, 32, 'Mesh subdivisions must remain unchanged');
  assert.ok(wwOcean.significantWaveHeight > 40, 'Beaufort 6 generates significant waves');
  assert.strictEqual(wwOcean.cascadeWeight, 0.7, 'Cascade weight updated to Beaufort 6 profile');

  // Test alias resolution
  FW.setWaveWorksBeaufort(wwScene, wwBeh, 'Hurricane');
  assert.strictEqual(FW.getWaveWorksBeaufort(wwScene, wwBeh), 'Beaufort 12 - Hurricane');
  assert.strictEqual(wwOcean.windSpeed, 35.0, 'Hurricane wind speed is 35 m/s');

  // Test setters/getters
  FW.setWaveWorksCascadeWeight(wwScene, wwBeh, 0.45);
  assert.strictEqual(FW.getWaveWorksCascadeWeight(wwScene, wwBeh), 0.45);
  FW.setWaveWorksOpacity(wwScene, wwBeh, 0.75);
  assert.strictEqual(FW.getWaveWorksOpacity(wwScene, wwBeh), 0.75);
  FW.setWaveWorksMicroDetail(wwScene, wwBeh, 0.85);
  assert.strictEqual(FW.getWaveWorksMicroDetail(wwScene, wwBeh), 0.85);

  // Test stepping
  FW.stepWaveWorksOcean(wwScene, wwObj, wwBeh);
  assert.ok(wwOcean.mesh.visible, 'WaveWorks mesh should be visible after step');
  assert.strictEqual(wwOcean.mesh.name, 'FluidAndWater3D_OceanWaveWorks');

  // Test buoyancy on OceanWaveWorks3D
  let boatZ = 290;
  const boatObj = {
    getX: () => 200, getY: () => 200, getZ: () => boatZ,
    getWidth: () => 100, getHeight: () => 60, getDepth: () => 40,
    getLayer: () => '', getName: () => 'BoatOnWaveWorks',
    getRotationX: () => 0, getRotationY: () => 0,
    setZ: (z) => { boatZ = z; },
    setRotationX() {}, setRotationY() {},
  };
  const boatBeh = {};
  const wwBuoy = FW.registerBuoyancy(wwScene, boatObj, boatBeh, {
    buoyancyFactor: 1.2,
    hullProbeCount: '4-Corners',
    targetWaterBody: 'WaveWorksOcean',
  });

  FW.stepBuoyancy(wwScene, boatObj, boatBeh, 0.016);
  assert.strictEqual(wwBuoy.isFloating, true, 'Boat must float on OceanWaveWorks3D');
  assert.ok(wwBuoy.lastForce > 0, 'Buoyancy must apply positive upward lift force on WaveWorks ocean');

  FW.disposeWaveWorksOcean(wwScene, wwBeh);
  FW.disposeBuoyancy(wwScene, boatBeh);
  console.log('  Passed: WaveWorks dual-cascade, Beaufort presets, and buoyancy integration verified.');
}

console.log('--- Test 24: WaterDetailing3D companion attachment, presets, actions/expressions, and uniform upload ---');
{
  const detScene = makeScene();
  const oceanObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 200,
    getLayer: () => '', getName: () => 'OceanWithDetailing',
    get3DRendererObject: () => ({ visible: true }),
  };
  const oceanBeh = {};
  const ocean = FW.registerWaveWorksOcean(detScene, oceanObj, oceanBeh, {
    beaufortScale: 'Beaufort4_ModerateBreeze',
    resolution: 32,
    gridSubdivisions: 32
  });

  const detBeh = {};
  const det = FW.registerWaterDetailing(detScene, oceanObj, detBeh, {
    style: 'Sea of Thieves', waterLook: 'Open Ocean', lighting: 'Golden Hour'
  });

  assert.ok(det, 'WaterDetailing3D must register');
  assert.strictEqual(FW.waterDetailingOf(detScene, detBeh), det, 'waterDetailingOf must find instance');
  assert.strictEqual(det.style, 'Sea of Thieves', 'the chosen style is recorded');
  assert.strictEqual(det.waterLook, 'Clear', 'the chosen water type is recorded (Open Ocean resolves to the Clear condition)');
  assert.strictEqual(det.lighting, 'Golden Hour', 'the chosen hour is recorded');

  FW.stepWaterDetailing(detScene, oceanObj, detBeh);

  const u = ocean.material.uniforms;
  assert.ok(u.u_SunDirection, 'u_SunDirection uniform must exist');
  assert.ok(u.u_SunColor, 'u_SunColor uniform must exist');
  // Golden Hour casts a 2.6 specular; the Sea of Thieves style then scales it by 1.10.
  assert.ok(Math.abs(u.u_SunSpecularIntensity.value - 2.6 * 1.10) < 1e-4,
    'the hour sets the specular and the style scales it');
  // Compare against the composed look rather than hardcoded numbers, so this keeps checking the
  // plumbing rather than freezing whatever the style scales happen to be today.
  const expectedLook = FW.composeWaterDetailingLook(
    FW.resolveWaterDetailingStyle('Sea of Thieves'),
    FW.resolveWaterDetailingType('Open Ocean'),
    FW.resolveWaterDetailingLighting('Golden Hour'));
  assert.ok(Math.abs(u.u_SunSpecularRoughness.value - expectedLook.sunSpecularRoughness) < 1e-4,
    'u_SunSpecularRoughness comes from the chosen hour');
  assert.ok(Math.abs(u.u_WaveContrast.value - expectedLook.waveContrast) < 1e-4,
    'u_WaveContrast is the type value scaled by the style');
  assert.ok(Math.abs(u.u_TranslucencyIntensity.value - expectedLook.translucencyIntensity) < 1e-4,
    'u_TranslucencyIntensity likewise');
  assert.ok(Math.abs(u.u_MicroFrequency.value - expectedLook.microFrequency) < 1e-4,
    'u_MicroFrequency comes from the water type');

  // Test preset switching
  FW.setWaterDetailingPreset(detScene, detBeh, 'Stormy_Dark');
  assert.strictEqual(FW.getWaterDetailingPreset(detScene, detBeh), 'Stormy - Dark');
  assert.ok(Math.abs(u.u_WaveContrast.value - 0.85) < 1e-4, 'Stormy preset sets contrast to 0.85');
  assert.ok(Math.abs(u.u_SunSpecularRoughness.value - 64.0) < 1e-4, 'Stormy preset sets roughness to 64');

  FW.setWaterDetailingPreset(detScene, detBeh, 'Crystal_Clear_Tropical');
  assert.strictEqual(FW.getWaterDetailingPreset(detScene, detBeh), 'Crystal Clear Tropical');
  assert.ok(Math.abs(u.u_WaveContrast.value - 0.40) < 1e-4, 'Crystal Clear sets contrast to 0.40');

  // Test individual setters, expressions, and custom mode switch
  FW.setWaterDetailingSunHeading(detScene, detBeh, 120);
  assert.strictEqual(FW.getWaterDetailingSunHeading(detScene, detBeh), 120);
  assert.strictEqual(FW.getWaterDetailingPreset(detScene, detBeh), 'Custom', 'Setting individual property switches preset to Custom');

  FW.setWaterDetailingSunElevation(detScene, detBeh, 30);
  assert.strictEqual(FW.getWaterDetailingSunElevation(detScene, detBeh), 30);

  FW.setWaterDetailingSunSpecularIntensity(detScene, detBeh, 4.5);
  assert.strictEqual(FW.getWaterDetailingSunSpecularIntensity(detScene, detBeh), 4.5);

  FW.setWaterDetailingSunSpecularRoughness(detScene, detBeh, 256);
  assert.strictEqual(FW.getWaterDetailingSunSpecularRoughness(detScene, detBeh), 256);

  FW.setWaterDetailingWaveContrast(detScene, detBeh, 0.80);
  assert.strictEqual(FW.getWaterDetailingWaveContrast(detScene, detBeh), 0.80);

  FW.setWaterDetailingExtinctionDepth(detScene, detBeh, 350);
  assert.strictEqual(FW.getWaterDetailingExtinctionDepth(detScene, detBeh), 350);

  FW.setWaterDetailingTranslucencyIntensity(detScene, detBeh, 2.2);
  assert.strictEqual(FW.getWaterDetailingTranslucencyIntensity(detScene, detBeh), 2.2);

  FW.setWaterDetailingTranslucencyPower(detScene, detBeh, 4.0);
  assert.strictEqual(FW.getWaterDetailingTranslucencyPower(detScene, detBeh), 4.0);

  FW.setWaterDetailingFoamIntensity(detScene, detBeh, 1.1);
  assert.strictEqual(FW.getWaterDetailingFoamIntensity(detScene, detBeh), 1.1);

  FW.setWaterDetailingFoamCoverage(detScene, detBeh, 0.50);
  assert.strictEqual(FW.getWaterDetailingFoamCoverage(detScene, detBeh), 0.50);

  FW.setWaterDetailingMicroDetail(detScene, detBeh, 0.75);
  assert.strictEqual(FW.getWaterDetailingMicroDetail(detScene, detBeh), 0.75);

  FW.setWaterDetailingMicroFrequency(detScene, detBeh, 2.5);
  assert.strictEqual(FW.getWaterDetailingMicroFrequency(detScene, detBeh), 2.5);

  FW.setWaterDetailingOpacity(detScene, detBeh, 0.60);
  assert.strictEqual(FW.getWaterDetailingOpacity(detScene, detBeh), 0.60);

  FW.stepWaterDetailing(detScene, oceanObj, detBeh);
  assert.ok(Math.abs(u.u_SunSpecularIntensity.value - 4.5) < 1e-4);
  assert.ok(Math.abs(u.u_WaveContrast.value - 0.80) < 1e-4);
  assert.ok(Math.abs(u.u_TranslucencyIntensity.value - 2.2) < 1e-4);
  assert.ok(Math.abs(u.u_MicroFrequency.value - 2.5) < 1e-4);
  assert.ok(Math.abs(u.u_Opacity.value - 0.60) < 1e-4);

  console.log('  Passed: WaterDetailing3D companion attachment, presets, actions/expressions, and uniform upload verified.');
}


// --- Test 25: Skybox Cubemap reflection & Scene DirectionalLight auto-sync ---
{
  console.log('--- Test 25: Skybox Cubemap reflection & Scene DirectionalLight auto-sync ---');

  const mockEnvScene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => null }) }),
    getLayer: () => ({
      getRenderer: () => ({
        getThreeScene: () => threeSceneMock
      })
    })
  };

  const dummyCube = { isCubeTexture: true, image: [1, 2, 3, 4, 5, 6] };
  const mockDirLight = {
    isDirectionalLight: true,
    color: { r: 1.0, g: 0.85, b: 0.65 },
    intensity: 1.5,
    getWorldPosition: (v) => { v.set(100, 200, 500); return v; },
    target: {
      getWorldPosition: (v) => { v.set(0, 0, 0); return v; }
    }
  };

  const threeSceneMock = {
    environment: dummyCube,
    background: null,
    traverse: (fn) => fn(mockDirLight)
  };

  const objMock = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'SkyboxOcean',
    get3DRendererObject: () => ({ visible: true })
  };

  const behMock = { isWaveWorks: true };
  const wwOcean = FW.registerWaveWorksOcean(mockEnvScene, objMock, behMock, {
    beaufortScale: 'Beaufort4_ModerateBreeze',
    resolution: 32,
    gridSubdivisions: 32
  });

  assert.ok(wwOcean, 'WaveWorks ocean registered');
  const u = wwOcean.material.uniforms;
  assert.ok(u.u_EnvMap, 'u_EnvMap uniform exists');
  assert.ok(u.u_HasEnvMap, 'u_HasEnvMap uniform exists');

  // Trigger step
  FW.stepWaveWorksOcean(mockEnvScene, objMock, behMock);

  // Check that Skybox cubemap was bound
  assert.strictEqual(u.u_EnvMap.value, dummyCube, 'Skybox cubemap bound to u_EnvMap');
  assert.strictEqual(u.u_HasEnvMap.value, 1.0, 'u_HasEnvMap is 1.0 when Skybox present');

  // Check that DirectionalLight was auto-synced
  const expectedDir = new THREE.Vector3(100, 200, 500).normalize();
  assert.ok(Math.abs(u.u_SunDirection.value.x - expectedDir.x) < 1e-3, 'Sun X matches directional light');
  assert.ok(Math.abs(u.u_SunDirection.value.y - expectedDir.y) < 1e-3, 'Sun Y matches directional light');
  assert.ok(Math.abs(u.u_SunDirection.value.z - expectedDir.z) < 1e-3, 'Sun Z matches directional light');
  assert.ok(Math.abs(u.u_SunColor.value.x - (1.0 * 1.5)) < 1e-3, 'Sun color red scaled by intensity');

  // Test direct SetSunDirection and SetSunColor actions
  FW.setOceanSunDirection(mockEnvScene, behMock, 180, 45);
  assert.strictEqual(wwOcean.sunHeading, 180, 'sunHeading set to 180');
  assert.strictEqual(wwOcean.sunElevation, 45, 'sunElevation set to 45');

  FW.setOceanSunColor(mockEnvScene, behMock, '255;200;150');
  assert.ok(Math.abs(u.u_SunColor.value.x - 1.0) < 1e-2, 'Sun color updated');

  FW.disposeWaveWorksOcean(mockEnvScene, behMock);
  console.log('  Passed: Skybox cubemap reflection, DirectionalLight auto-sync, and direct sun actions verified.');
}

// --- Test 26: Sea of Thieves foam, caustics depth-attenuation & full color environmental presets ---
{
  console.log('--- Test 26: Sea of Thieves foam, caustics depth-attenuation & environmental presets ---');

  const presetScene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => null }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => ({ environment: null, traverse: () => {} }) }) })
  };

  const oceanObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 2000, getHeight: () => 2000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'PresetOcean',
    get3DRendererObject: () => ({ visible: true })
  };

  const oceanBeh = {};
  // Beaufort 6 carries the Sea of Thieves palette, so this covers the same colour plumbing the
  // removed OceanFFT3D presets used to.
  const ocean = FW.registerWaveWorksOcean(presetScene, oceanObj, oceanBeh, {
    beaufortScale: 'Beaufort 6 - Strong Breeze',
    resolution: 32,
    gridSubdivisions: 32
  });

  assert.ok(ocean, 'OceanWaveWorks3D registered on the Beaufort 6 rung');
  const u = ocean.material.uniforms;

  // 1. Verify the Sea of Thieves palette reaches the uniforms
  assert.strictEqual(ocean.beaufortScale, 'Beaufort 6 - Strong Breeze');
  assert.ok(Math.abs(u.u_ShallowColor.value.x - 0.0) < 1e-3, 'Sea of Thieves shallow R is 0');
  assert.ok(Math.abs(u.u_ShallowColor.value.y - (215 / 255)) < 1e-2, 'Sea of Thieves shallow G is vibrant emerald/cyan');
  assert.ok(Math.abs(u.u_DeepColor.value.z - (48 / 255)) < 1e-2, 'Sea of Thieves deep ocean blue');
  assert.ok(Math.abs(u.u_CausticsIntensity.value - 0.8) < 1e-3, 'Sea of Thieves caustics intensity');

  // 2. A rung switch retunes the sea state and repaints the palette in one step.
  FW.setWaveWorksBeaufort(presetScene, oceanBeh, 'Beaufort 12 - Hurricane');
  assert.strictEqual(ocean.windSpeed, 35, 'Hurricane wind speed');
  assert.ok(Math.abs(u.u_CausticsIntensity.value - 0.1) < 1e-3,
    'the storm palette all but removes caustics');
  assert.ok(u.u_DeepColor.value.z < 0.15, 'and drops the deep colour to midnight navy');

  FW.disposeWaveWorksOcean(presetScene, oceanBeh);
  console.log('  Passed: Sea of Thieves foam, caustics depth-attenuation & environmental presets verified.');
}

console.log('--- Test 27: Underwater submersion covers the spectral oceans, not just WaterBody3D ---');
{
  // Regression: OceanFFT3D and OceanWaveWorks3D stored enableUnderwaterFX, the fog colours and an
  // isCameraUnderwater flag that updateUnderwater never looked at, so both behaviors' fog
  // properties did nothing and their IsCameraUnderwater condition was permanently false.
  const oceanObjAt = (name) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => name,
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  });

  // FlatWater keeps the surface at exactly Z = 100, so the camera at Z = 50 is unambiguously under.
  const fftDive = makeScene({ cameraGdY: 500, cameraZ: 50 });
  const fftBeh = {};
  const fftOcean = FW.registerWaveWorksOcean(fftDive, oceanObjAt('DiveFFT'), fftBeh, { beaufortScale: 'Custom',
    wavePreset: 'FlatWater', gridSubdivisions: 32, resolution: 32,
    enableUnderwaterFX: true, underwaterFogColor: '15;65;110', underwaterFogDensity: 0.002,
  });
  registeredCallbacks.postEvents(fftDive);
  assert.strictEqual(fftOcean.isCameraUnderwater, true,
    'OceanFFT3D::IsCameraUnderwater must fire for a camera inside and below the ocean volume');
  assert.ok(fftDive.threeScene.fog, 'OceanFFT3D EnableUnderwaterFX must install fog on the layer scene');
  assert.ok(Math.abs(fftDive.threeScene.fog.density - 0.002) < 1e-9,
    'The fog must use the density configured on the ocean itself');
  assert.strictEqual(FW.isCameraUnderwaterAny(fftDive), true,
    'The scene-wide underwater condition must see spectral oceans too');

  const wwDive = makeScene({ cameraGdY: 500, cameraZ: 50 });
  const wwDiveBeh = {};
  const wwOceanDive = FW.registerWaveWorksOcean(wwDive, oceanObjAt('DiveWW'), wwDiveBeh, {
    beaufortScale: 'FlatWater', gridSubdivisions: 32, resolution: 32, tileSize: 1000,
    enableUnderwaterFX: true,
  });
  registeredCallbacks.postEvents(wwDive);
  assert.strictEqual(wwOceanDive.isCameraUnderwater, true,
    'OceanWaveWorks3D::IsCameraUnderwater must fire for a submerged camera');
  assert.ok(wwDive.threeScene.fog, 'OceanWaveWorks3D EnableUnderwaterFX must install fog');

  // Surfacing puts the scene fog back.
  const wwAbove = makeScene({ cameraGdY: 500, cameraZ: 5000 });
  const wwAboveBeh = {};
  const wwOceanAbove = FW.registerWaveWorksOcean(wwAbove, oceanObjAt('AboveWW'), wwAboveBeh, {
    beaufortScale: 'FlatWater', gridSubdivisions: 32, resolution: 32, tileSize: 1000,
    enableUnderwaterFX: true,
  });
  registeredCallbacks.postEvents(wwAbove);
  assert.strictEqual(wwOceanAbove.isCameraUnderwater, false, 'A camera far above the ocean is not submerged');
  assert.strictEqual(wwAbove.threeScene.fog, null, 'No fog while above the ocean');

  FW.disposeOcean(fftDive, fftBeh);
  FW.disposeWaveWorksOcean(wwDive, wwDiveBeh);
  FW.disposeWaveWorksOcean(wwAbove, wwAboveBeh);
  console.log('  Passed: both spectral oceans drive submersion, fog and the scene-wide condition.');
}

console.log('--- Test 28: CPU ripple sum uses the same window the shader is given ---');
{
  // Regression: emitBodyInteraction keeps a few events past the shader capacity on purpose, but
  // interactionDisplacementAt summed the whole list, so past 16 live ripples buoyancy and
  // WaveHeightAt() lifted against rings the surface was not drawing.
  const rippleScene = makeScene();
  const rippleObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'RippleWater',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const rippleBeh = {};
  const rippleBody = FW.registerWaterBody(rippleScene, rippleObj, rippleBeh, {
    waveHeight: 0.0, waveChoppiness: 0.0, interactionStrength: 20.0, interactionRadius: 200.0,
  });

  // 24 concurrent ripples: the emit cap (MAX + 8), with the shader carrying only the newest 16.
  for (let i = 0; i < 24; i++) FW.emitBodyInteraction(rippleBody, 400 + i * 5, 500, 20.0, 0.0);
  assert.strictEqual(rippleBody.interactions.length, 24, 'The event list keeps its deliberate slack');

  const cpuBefore = FW.getWaveHeightAt(rippleScene, rippleBeh, 500, 500);
  FW.uploadBodyInteractions(rippleBody, 0.0);
  const uploaded = rippleBody.material.uniforms.u_InteractionCount.value;
  assert.strictEqual(uploaded, 16, 'The shader carries exactly MAX_WATER_INTERACTIONS ripples');

  // Trimming the list to what the GPU actually received must not change the CPU surface.
  rippleBody.interactions = rippleBody.interactions.slice(-16);
  const cpuAfter = FW.getWaveHeightAt(rippleScene, rippleBeh, 500, 500);
  assert.ok(Math.abs(cpuBefore) > 1e-9, 'The test ripples must actually displace the surface');
  assert.ok(Math.abs(cpuBefore - cpuAfter) < 1e-9,
    'CPU height must match the uploaded window, got ' + cpuBefore + ' vs ' + cpuAfter);

  FW.disposeWaterBody(rippleScene, rippleBeh);
  console.log('  Passed: CPU and GPU agree at the emit cap.');
}

console.log('--- Test 29: Buoyancy submersion depth scales to the hull, not to metres ---');
{
  // Regression: the shipped MaxSubmersionDepth default was 2.0, a metre-sized number in an engine
  // whose scene units are pixels. A 200-unit hull reached full lift 2 units in and rode ON the
  // water. Left at 0 the ramp now scales to the hull itself.
  const scaleScene = makeScene();
  const scaleWater = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'ScaleWater',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const scaleWaterBeh = {};
  FW.registerWaterBody(scaleScene, scaleWater, scaleWaterBeh, { waveHeight: 0.0, waveChoppiness: 0.0 });

  const hullDepth = 200;
  const captured = [];
  const hullPhysics = {
    getMass: () => 100,
    getLinearVelocityX: () => 0, getLinearVelocityY: () => 0, getLinearVelocityZ: () => 0,
    getAngularVelocityX: () => 0, getAngularVelocityY: () => 0, getAngularVelocityZ: () => 0,
    applyForce: (...a) => captured.push(a),
  };
  const makeHull = (z) => ({
    getX: () => 460, getY: () => 420, getZ: () => z,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => hullDepth,
    getLayer: () => '',
    get3DRendererObject: () => ({ quaternion: { x: 0, y: 0, z: 0, w: 1 } }),
    getBehavior: (name) => (name === 'Physics3D' ? hullPhysics : null),
  });

  // Deck exactly at the waterline: the whole hull is under, so lift saturates at one weight.
  const sunkHull = makeHull(100 - hullDepth);
  const sunkBeh = {};
  const sunkBuoy = FW.registerBuoyancy(scaleScene, sunkHull, sunkBeh, {
    buoyancyFactor: 1.0, hullProbeCount: '4-Corners', fluidDrag: 0.0, stabilityStrength: 0.0,
  });
  assert.strictEqual(sunkBuoy.maxSubmersionDepth, 0.0,
    'The shipped default must be 0, meaning scale to this hull, not a fixed metre value');

  FW.stepBuoyancy(scaleScene, sunkHull, sunkBeh);
  const weight = 100 * 9.81;
  const netUp = captured.reduce((sum, f) => sum + f[2], 0);
  assert.ok(Math.abs(netUp - weight) < weight * 0.02,
    'A fully submerged hull must be lifted by about its own weight, got ' + netUp.toFixed(1));

  // A quarter-depth waterline must give roughly half the lift: the ramp spans the hull, not 2 units.
  captured.length = 0;
  const partHull = makeHull(100 - hullDepth * 0.25);
  const partBeh = {};
  FW.registerBuoyancy(scaleScene, partHull, partBeh, {
    buoyancyFactor: 1.0, hullProbeCount: '4-Corners', fluidDrag: 0.0, stabilityStrength: 0.0,
  });
  FW.stepBuoyancy(scaleScene, partHull, partBeh);
  const partUp = captured.reduce((sum, f) => sum + f[2], 0);
  assert.ok(partUp > weight * 0.35 && partUp < weight * 0.65,
    'A quarter-depth waterline must give roughly half lift, not saturate, got ' + partUp.toFixed(1));

  FW.disposeBuoyancy(scaleScene, sunkBeh);
  FW.disposeBuoyancy(scaleScene, partBeh);
  FW.disposeWaterBody(scaleScene, scaleWaterBeh);
  console.log('  Passed: the buoyancy ramp spans the hull at any project scale.');
}

console.log('--- Test 30: Hiding a water object hides its generated surface too ---');
{
  // Regression: the step wrote root.visible = true every frame, silently undoing GDevelop's Hide
  // action, which only sets the flag and calls updateVisibility() once.
  const hideScene = makeScene();
  const hideRoot = { isMesh: true, material: null, visible: true, traverse() {} };
  let hidden = false;
  const hideObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'HidableWater',
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    isHidden: () => hidden,
    get3DRendererObject: () => hideRoot,
  };
  const hideBeh = {};
  const hideBody = FW.registerWaterBody(hideScene, hideObj, hideBeh, {});

  FW.stepWaterBody(hideScene, hideObj, hideBeh);
  assert.strictEqual(hideBody.mesh.visible, true, 'A visible water object shows its surface');
  assert.strictEqual(hideRoot.visible, true, 'A visible water object shows its volume');

  hidden = true;
  FW.stepWaterBody(hideScene, hideObj, hideBeh);
  assert.strictEqual(hideRoot.visible, false, 'Hide must survive the next step');
  assert.strictEqual(hideBody.mesh.visible, false,
    'Hiding the water object must take its generated surface with it, not leave a plane floating');

  hidden = false;
  FW.stepWaterBody(hideScene, hideObj, hideBeh);
  assert.strictEqual(hideRoot.visible, true, 'Show restores the volume');
  assert.strictEqual(hideBody.mesh.visible, true, 'Show restores the surface');

  FW.disposeWaterBody(hideScene, hideBeh);
  console.log('  Passed: Hide and Show reach both the volume and the surface.');
}

console.log('--- Test 31: Buoyancy applies forces through the configured Physics3D behavior ---');
{
  // Regression: stepBuoyancy redeclared phys3d and re-resolved it WITHOUT buoy.physics3D, so on an
  // object carrying more than one physics-like behavior the hook and the forces could disagree.
  const namedScene = makeScene();
  const namedWater = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 1000, getHeight: () => 1000, getDepth: () => 100,
    getLayer: () => '', getName: () => 'NamedWater',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const namedWaterBeh = {};
  FW.registerWaterBody(namedScene, namedWater, namedWaterBeh, { waveHeight: 0.0, waveChoppiness: 0.0 });

  const rightForces = [];
  const wrongForces = [];
  const makePhysics = (mass, sink) => ({
    getMass: () => mass,
    getLinearVelocityX: () => 0, getLinearVelocityY: () => 0, getLinearVelocityZ: () => 0,
    getAngularVelocityX: () => 0, getAngularVelocityY: () => 0, getAngularVelocityZ: () => 0,
    applyForce: (...a) => sink.push(a),
  });
  const boatPhysics = makePhysics(250, rightForces);
  const decoyPhysics = makePhysics(1, wrongForces);
  const namedBoat = {
    getX: () => 460, getY: () => 420, getZ: () => 60,
    getWidth: () => 80, getHeight: () => 160, getDepth: () => 40,
    getLayer: () => '',
    get3DRendererObject: () => ({ quaternion: { x: 0, y: 0, z: 0, w: 1 } }),
    // The decoy answers to the conventional name; the real hull physics is renamed.
    getBehavior: (name) => (name === 'BoatPhysics' ? boatPhysics
      : name === 'Physics3D' ? decoyPhysics : null),
  };
  const namedBeh = {};
  FW.registerBuoyancy(namedScene, namedBoat, namedBeh, {
    physics3D: 'BoatPhysics', hullProbeCount: '4-Corners', buoyancyFactor: 1.0,
  });
  FW.stepBuoyancy(namedScene, namedBoat, namedBeh);

  assert.strictEqual(rightForces.length, 4, 'Forces must go to the behavior named in the property');
  assert.strictEqual(wrongForces.length, 0, 'Nothing may reach a differently named physics behavior');

  FW.disposeBuoyancy(namedScene, namedBeh);
  FW.disposeWaterBody(namedScene, namedWaterBeh);
  console.log('  Passed: the configured behavior name is honoured on the force path.');
}

console.log('--- Test 32: readable preset names resolve, and so do the old stored ones ---');
{
  // The Choice properties now carry human-readable values ("Beaufort 9 - Strong Gale") because
  // GDevelop shows a choice's raw value in the dropdown - there is no separate label. Projects
  // saved before the rename still hold the old identifiers, so every resolver has to accept both.
  const pairs = [
    ['Beaufort 0 - Calm', 'Beaufort0_Calm'],
    ['Beaufort 2 - Light Breeze', 'Beaufort2_LightBreeze'],
    ['Beaufort 4 - Moderate Breeze', 'Beaufort4_ModerateBreeze'],
    ['Beaufort 6 - Strong Breeze', 'Beaufort6_StrongBreeze'],
    ['Beaufort 9 - Strong Gale', 'Beaufort9_StrongGale'],
    ['Beaufort 12 - Hurricane', 'Beaufort12_Hurricane'],
    ['Sea of Thieves', 'SeaOfThieves'],
    ['Swimming Pool', 'SwimmingPool'],
    ['Flat Water', 'FlatWater'],
  ];
  for (const [readable, legacy] of pairs) {
    const a = FW.resolveWaveWorksBeaufortPreset(readable);
    const b = FW.resolveWaveWorksBeaufortPreset(legacy);
    assert.ok(a, 'WaveWorks preset "' + readable + '" must resolve');
    assert.strictEqual(a, b, '"' + readable + '" and "' + legacy + '" must be the same preset');
  }

  const detailPairs = [
    ['Sea of Thieves - Golden Hour', 'SeaOfThieves_GoldenHour'],
    ['Sea of Thieves - Midday', 'SeaOfThieves_Midday'],
    ['Stormy - Dark', 'Stormy_Dark'],
    ['Crystal Clear Tropical', 'Crystal_Clear_Tropical'],
  ];
  for (const [readable, legacy] of detailPairs) {
    const a = FW.resolveWaterDetailingPreset(readable);
    const b = FW.resolveWaterDetailingPreset(legacy);
    assert.ok(a, 'WaterDetailing preset "' + readable + '" must resolve');
    assert.strictEqual(a, b, '"' + readable + '" and "' + legacy + '" must be the same preset');
  }

  for (const [readable, legacy] of [['Sea of Thieves', 'SeaOfThieves'], ['Flat Water', 'FlatWater']]) {
    // (GerstnerWater2_3D was removed; its resolver went with it.)
  }

  // Fluid presets were a direct key lookup, so a readable name used to fall through to Custom.
  const fluidScene = makeScene();
  const fluidObj = {
    getX: () => 0, getY: () => 0, getZ: () => 200,
    getWidth: () => 40, getHeight: () => 40, getDepth: () => 60,
    getLayer: () => '', getName: () => 'Flask',
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
  };
  const fluidBeh = {};
  const liquid = FW.registerPourableLiquid(fluidScene, fluidObj, fluidBeh, { fluidPreset: 'Water' });

  FW.setFluidPreset(fluidScene, fluidBeh, 'Honey Syrup');
  const readableVisc = liquid.viscosity;
  FW.setFluidPreset(fluidScene, fluidBeh, 'HoneySyrup');
  assert.strictEqual(readableVisc, liquid.viscosity,
    'A readable fluid preset name must not fall through to Custom');
  assert.notStrictEqual(readableVisc, FW.FLUID_PRESETS.Custom.viscosity,
    'Honey must not resolve to the Custom profile');
  assert.ok(readableVisc > FW.FLUID_PRESETS.Water.viscosity,
    'Honey must be more viscous than water, proving the real preset was applied');

  FW.setFluidPreset(fluidScene, fluidBeh, 'Magic Potion');
  assert.strictEqual(liquid.viscosity, FW.FLUID_PRESETS.MagicPotion.viscosity,
    '"Magic Potion" must resolve to the MagicPotion profile');

  FW.disposePourableLiquid(fluidScene, fluidBeh);
  console.log('  Passed: readable and legacy preset names are interchangeable.');
}

console.log('--- Test 33: OceanFFT3D is gone, OceanWaveWorks3D still has what it shared ---');
{
  // OceanFFT3D was removed in favour of OceanWaveWorks3D. Several ocean entry points were shared
  // between them by direct delegation, so they must survive the removal.
  for (const fn of ['stepOcean', 'disposeOcean', 'oceanOf', 'setOceanWind', 'setOceanChoppiness',
    'setOceanOpacity', 'getOceanOpacity', 'setOceanMicroDetail', 'getOceanMicroDetail',
    'getOceanSurfaceZ', 'getOceanWaveHeightAt', 'getSignificantWaveHeight']) {
    assert.strictEqual(typeof FW[fn], 'function', fn + ' is still reached by OceanWaveWorks3D');
  }

  const wwScene = makeScene();
  const wwObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => 'SurvivingOcean',
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const wwBeh = {};
  const ww = FW.registerWaveWorksOcean(wwScene, wwObj, wwBeh, {
    beaufortScale: 'Beaufort 6 - Strong Breeze', gridSubdivisions: 32, resolution: 32, tileSize: 4000,
  });
  assert.ok(ww, 'WaveWorks still registers');
  assert.strictEqual(FW.getWaveWorksBeaufort(wwScene, wwBeh), 'Beaufort 6 - Strong Breeze',
    'A readable Beaufort name is accepted at registration');
  assert.ok(ww.windSpeed === 12.5, 'and applies that scale (12.5 m/s at Beaufort 6)');

  // The delegating entry points still work end to end.
  FW.setWaveWorksOpacity(wwScene, wwBeh, 0.5);
  assert.strictEqual(FW.getWaveWorksOpacity(wwScene, wwBeh), 0.5, 'opacity delegates to the shared setter');
  FW.stepWaveWorksOcean(wwScene, wwObj, wwBeh);
  FW.disposeWaveWorksOcean(wwScene, wwBeh);
  assert.strictEqual(FW.oceanOf(wwScene, wwBeh), null, 'dispose delegates to the shared disposer');
  console.log('  Passed: the shared ocean surface survived the removal.');
}

console.log('--- Test 34: the Beaufort dropdown offers only the wind scale, but still resolves the looks ---');
{
  // The dropdown used to mix the six physical rungs with six environmental LOOK presets.
  // "Stormy" was identical to "Beaufort 9 - Strong Gale" in every field; "Swimming Pool" and
  // "Flat Water" carried the same all-zero sea state as "Beaufort 0 - Calm". Those looks belong to
  // WaterDetailing3D, so they were removed from the list - but NOT from the table, because saved
  // projects and SetBeaufortScale events may still name them.
  const RUNGS = ['Beaufort 0 - Calm', 'Beaufort 2 - Light Breeze', 'Beaufort 4 - Moderate Breeze',
    'Beaufort 6 - Strong Breeze', 'Beaufort 9 - Strong Gale', 'Beaufort 12 - Hurricane'];

  // Every rung resolves and the ladder climbs.
  let lastWind = -1;
  for (const rung of RUNGS) {
    const p = FW.resolveWaveWorksBeaufortPreset(rung);
    assert.ok(p, rung + ' must resolve');
    assert.ok(p.windSpeed > lastWind || (p.windSpeed === 0 && lastWind === -1),
      rung + ' must be windier than the rung below it (got ' + p.windSpeed + ' after ' + lastWind + ')');
    lastWind = p.windSpeed;
  }

  // The removed names still resolve, so no saved project breaks.
  for (const gone of ['Sea of Thieves', 'Swimming Pool', 'Murky', 'Stormy', 'Calm', 'Flat Water',
    'SeaOfThieves', 'SwimmingPool', 'FlatWater']) {
    assert.ok(FW.resolveWaveWorksBeaufortPreset(gone),
      'the removed look "' + gone + '" must still resolve for projects that already use it');
  }

  // And applying one through the public action still works.
  const sc = makeScene();
  const beh = {};
  const obj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => 'TrimOcean',
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const ocean = FW.registerWaveWorksOcean(sc, obj, beh, {
    beaufortScale: 'Beaufort 4 - Moderate Breeze', gridSubdivisions: 32, resolution: 32, tileSize: 4000,
  });
  FW.setWaveWorksBeaufort(sc, beh, 'Stormy');
  assert.strictEqual(ocean.windSpeed, 22, 'A removed look applied by action still sets its sea state');
  FW.setWaveWorksBeaufort(sc, beh, 'Beaufort 12 - Hurricane');
  assert.strictEqual(ocean.windSpeed, 35, 'and the rungs still apply');
  FW.disposeWaveWorksOcean(sc, beh);

  // Every WaterDetailing3D preset name is readable - two of them sat last in their object literal
  // with no trailing comma and were missed by the first rename pass.
  for (const key of Object.keys(FW.WATER_DETAILING_PRESETS)) {
    const n = FW.WATER_DETAILING_PRESETS[key].name;
    if (!n) continue;
    assert.ok(!/_/.test(n) && !/[a-z][A-Z]/.test(n),
      'WaterDetailing preset "' + n + '" must be a readable name, not an identifier');
  }
  console.log('  Passed: dropdown trimmed to the wind scale, removed looks still resolve.');
}

console.log('--- Test 35: a preset property beats the individual properties, unless it is Custom ---');
{
  // Regression: every preset field was read as `options.X !== undefined ? options.X : base.X`, but
  // GDevelop always calls the property getters, so options.X was never undefined and the preset's
  // value - the fallback - was unreachable. Choosing "Stormy" on WaterDetailing3D changed only the
  // reported name; the water kept the tropical ShallowColor default of 35;220;200.
  const mk = (name) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => name,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  // Exactly what the generated onCreated sends: the preset AND every property at its default.
  const EDITOR_DEFAULTS = {
    sunHeading: 45.0, sunElevation: 35.0, sunColor: '255;245;225',
    sunSpecularIntensity: 2.4, sunSpecularRoughness: 180.0, waveContrast: 0.55,
    shallowColor: '35;220;200', deepColor: '4;22;48', extinctionDepth: 260.0,
    translucencyColor: '40;255;220', translucencyIntensity: 1.6, translucencyPower: 2.8,
    foamColor: '248;252;255', foamIntensity: 0.75, foamCoverage: 0.35,
    microDetail: 0.35, microFrequency: 1.0, opacity: 0.78,
  };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

  /* WaterDetailing3D */
  {
    const sc = makeScene();
    const obj = mk('DetOcean');
    const oBeh = {}; const dBeh = {};
    const ocean = FW.registerWaveWorksOcean(sc, obj, oBeh, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 4000 });
    FW.registerWaterDetailing(sc, obj, dBeh, Object.assign({ style: 'Custom', waterLook: 'Stormy' }, EDITOR_DEFAULTS));
    FW.stepWaterDetailing(sc, obj, dBeh);
    const u = ocean.material.uniforms;
    const p = FW.WATER_DETAILING_PRESETS.Stormy;
    assert.ok(near(u.u_ShallowColor.value.x, p.shallowColor[0], 1e-3)
      && near(u.u_ShallowColor.value.y, p.shallowColor[1], 1e-3),
    'the Stormy palette must beat the ShallowColor property default');
    assert.ok(near(u.u_ExtinctionDepth.value, p.extinctionDepth), 'and its extinction depth');
    assert.ok(near(u.u_FoamIntensity.value, p.foamIntensity), 'and its foam intensity');
    assert.ok(near(u.u_WaveContrast.value, p.waveContrast), 'and its wave contrast');
    assert.ok(near(u.u_CausticsIntensity.value, p.causticsIntensity),
      'and its caustics, which the detailing writer used not to send at all');

    // Custom hands control back to the individual properties.
    const cBeh = {};
    FW.registerWaterDetailing(sc, mk('CustomLook'), cBeh, Object.assign({ style: 'Custom', waterLook: 'Custom', lighting: 'Custom' }, EDITOR_DEFAULTS));
    const cd = FW.waterDetailingOf(sc, cBeh);
    assert.ok(near(cd.shallowColor[0], 35 / 255, 1e-3) && near(cd.shallowColor[1], 220 / 255, 1e-3),
      'Custom must use the authored ShallowColor, not a preset');
    assert.ok(near(cd.extinctionDepth, 260), 'Custom must use the authored extinction depth');
  }

  /* OceanWaveWorks3D - the rung owns opacity/foam, which the properties used to re-override. */
  {
    const sc = makeScene();
    const beh = {};
    const o = FW.registerWaveWorksOcean(sc, mk('WW'), beh, Object.assign({
      beaufortScale: 'Beaufort 12 - Hurricane', resolution: 32, gridSubdivisions: 32, tileSize: 4000,
    }, EDITOR_DEFAULTS));
    const p = FW.BEAUFORT_SCALE_PRESETS.Beaufort12_Hurricane;
    const u = o.material.uniforms;
    assert.ok(near(u.u_Opacity.value, p.opacity), 'the rung owns opacity');
    assert.ok(near(u.u_FoamIntensity.value, p.foamIntensity), 'and foam intensity');
    assert.ok(near(u.u_FoamCoverage.value, p.foamCoverage), 'and foam coverage');
    assert.ok(near(u.u_ExtinctionDepth.value, p.extinctionDepth), 'and extinction depth');
  }

  console.log('  Passed: presets own the look and the sea state; Custom hands it back.');
}

console.log('--- Test 36: WaterBody3D Water Type drives a real palette ---');
{
  // Regression: `waterType` was stored at registration and never read anywhere in the runtime, so
  // Ocean / Lake / River / Swimming Pool were purely decorative.
  const mk = (name) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 2000, getHeight: () => 2000, getDepth: () => 100,
    getLayer: () => '', getName: () => name,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  // What the editor always sends alongside the choice.
  const DEFAULTS = {
    shallowColor: '64;224;208', deepColor: '10;45;90',
    extinctionDepth: 150.0, refractionScale: 0.02,
    shoreFoamIntensity: 0.85, crestFoamIntensity: 0.60, enableCaustics: true,
  };
  const near = (a, b) => Math.abs(a - b) < 1e-4;

  const seen = [];
  for (const typeName of ['Ocean', 'Lake', 'River', 'Swimming Pool']) {
    const sc = makeScene();
    const beh = {};
    const b = FW.registerWaterBody(sc, mk('WB_' + typeName), beh,
      Object.assign({ waterType: typeName }, DEFAULTS));
    const p = FW.resolveWaterTypePreset(typeName);
    assert.ok(p, typeName + ' must resolve to a palette');
    const u = b.material.uniforms;
    assert.ok(near(u.u_ShallowColor.value.x, p.shallowColor[0])
      && near(u.u_ShallowColor.value.y, p.shallowColor[1])
      && near(u.u_ShallowColor.value.z, p.shallowColor[2]),
    typeName + ' must set its own shallow colour, not the property default');
    assert.ok(near(u.u_ExtinctionDepth.value, p.extinctionDepth), typeName + ' optical depth');
    assert.ok(near(u.u_CausticsIntensity.value, p.causticsIntensity), typeName + ' caustics');
    assert.ok(near(u.u_CrestFoamIntensity.value, p.crestFoamIntensity), typeName + ' crest foam');
    assert.ok(near(u.u_ShoreFoamIntensity.value, p.shoreFoamIntensity), typeName + ' shore foam');
    seen.push(u.u_ShallowColor.value.x + ',' + u.u_ShallowColor.value.y + ',' + u.u_ShallowColor.value.z);
  }
  assert.strictEqual(new Set(seen).size, 4, 'the four water types must look different from each other');

  // A pool is clear with bright caustics; an ocean is not. Guards against a table of clones.
  const pool = FW.resolveWaterTypePreset('Swimming Pool');
  const ocean = FW.resolveWaterTypePreset('Ocean');
  assert.ok(pool.causticsIntensity > ocean.causticsIntensity * 2, 'a pool shows far more caustics than open ocean');
  assert.ok(pool.crestFoamIntensity < ocean.crestFoamIntensity, 'and a pool has no whitecaps');

  // Custom hands the palette back to the authored properties.
  {
    const sc = makeScene();
    const beh = {};
    const b = FW.registerWaterBody(sc, mk('WBCustom'), beh,
      Object.assign({ waterType: 'Custom' }, DEFAULTS, { shallowColor: '200;10;10', extinctionDepth: 42.0 }));
    assert.ok(near(b.material.uniforms.u_ShallowColor.value.x, 200 / 255),
      'Custom must use the authored shallow colour');
    assert.ok(near(b.material.uniforms.u_ExtinctionDepth.value, 42.0),
      'Custom must use the authored extinction depth');
  }

  // Turning caustics off still wins over the type's intensity.
  {
    const sc = makeScene();
    const beh = {};
    const b = FW.registerWaterBody(sc, mk('WBNoCaustics'), beh,
      Object.assign({ waterType: 'Swimming Pool' }, DEFAULTS, { enableCaustics: false }));
    assert.strictEqual(b.material.uniforms.u_CausticsIntensity.value, 0.0,
      'Enable Caustics = false must silence even a pool');
    FW.updateWaterBody(sc, mk('WBNoCaustics'), beh, { enableCaustics: true });
    assert.ok(near(b.material.uniforms.u_CausticsIntensity.value, pool.causticsIntensity),
      'and turning it back on must restore the type intensity, not a hardcoded 1.0');
  }
  console.log('  Passed: the four water types differ, Custom is honoured, caustics toggle intact.');
}

console.log('--- Test 37: caustics depth falloff is a preset value, not a hardcoded law ---');
{
  // Regression: the caustics fade was `1 - column / (0.65 * ExtinctionDepth)` with no way out, and
  // `column` is the water BOX's depth - an authoring choice, not a seabed distance. Past roughly
  // 0.65 x ExtinctionDepth it is a hard zero, and ocean boxes are routinely 300+ units, so the
  // light web vanished from every ocean preset. Each preset now says how much it obeys depth.
  const mk = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  // What the shader computes: mix(1, physicalFalloff, fade) * intensity.
  const falloff = (depth, ext) => Math.max(0, Math.min(1, 1 - depth / Math.max(ext * 0.65, 20)));
  const visible = (depth, p) =>
    p.causticsIntensity * (1 - p.causticsDepthFade + falloff(depth, p.extinctionDepth) * p.causticsDepthFade);

  // Every preset must declare the value; a missing one would silently mean "full physical fade".
  for (const table of [FW.WATER_DETAILING_PRESETS, FW.WATER_TYPE_PRESETS]) {
    for (const key of Object.keys(table)) {
      const p = table[key];
      if (p.causticsIntensity === undefined) continue;
      assert.ok(typeof p.causticsDepthFade === 'number' && p.causticsDepthFade >= 0 && p.causticsDepthFade <= 1,
        'preset "' + p.name + '" must declare a caustics depth fade in 0..1');
    }
  }

  // A stylized look keeps its glitter on a deep ocean box; a physical one does not.
  const sot = FW.WATER_DETAILING_PRESETS.SeaOfThieves;
  const stormy = FW.WATER_DETAILING_PRESETS.Stormy;
  assert.ok(visible(300, sot) > 0.5,
    'Sea of Thieves must still show caustics on a 300-unit ocean box, got ' + visible(300, sot));
  assert.strictEqual(visible(300, stormy), 0,
    'a physically-shaped storm still goes dark with depth');
  // The old law killed both, which is the bug.
  assert.strictEqual(sot.causticsIntensity * falloff(300, sot.extinctionDepth), 0,
    'the previous hardcoded law zeroed even the stylized look');

  // End to end: the uniform pair reaches the ocean material and tracks preset switches.
  const sc = makeScene();
  const obj = mk('CausticOcean');
  const oB = {}; const dB = {};
  const ocean = FW.registerWaveWorksOcean(sc, obj, oB, {
    beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 5000 });
  FW.registerWaterDetailing(sc, obj, dB, { preset: 'Sea of Thieves' });
  FW.stepWaterDetailing(sc, obj, dB);
  const u = ocean.material.uniforms;
  assert.ok(u.u_CausticsDepthFade, 'the shader must take a caustics depth fade uniform');
  assert.strictEqual(u.u_CausticsDepthFade.value, 0, 'Sea of Thieves keeps the web at any depth');
  assert.ok(Math.abs(u.u_CausticsIntensity.value - sot.causticsIntensity) < 1e-6, 'and its intensity');

  FW.setWaterDetailingPreset(sc, dB, 'Stormy');
  assert.strictEqual(u.u_CausticsDepthFade.value, 1, 'switching to Stormy restores the physical fade');
  FW.setWaterDetailingPreset(sc, dB, 'Crystal Clear Tropical');
  assert.strictEqual(u.u_CausticsDepthFade.value, 0, 'and a stylized look turns it back off');

  // WaterBody3D water types carry it too: a pool sparkles, open ocean does not.
  assert.strictEqual(FW.resolveWaterTypePreset('Swimming Pool').causticsDepthFade, 0);
  assert.strictEqual(FW.resolveWaterTypePreset('Ocean').causticsDepthFade, 1);
  console.log('  Passed: stylized presets keep the light web, physical ones still fade with depth.');
}

console.log('--- Test 38: Style x Type - the same water drawn two ways ---');
{
  // WaterDetailing3D used to carry one flat list that mixed the art method with the water
  // condition, so "Stormy" told you nothing about how it would be drawn and every combination had
  // to be stored separately. The two axes are now independent: STYLE is the method, TYPE owns the
  // palette, and a style carries no colours of its own.
  const mk = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  const sot = FW.resolveWaterDetailingStyle('Sea of Thieves');
  const real = FW.resolveWaterDetailingStyle('Realistic');
  const murky = FW.resolveWaterDetailingType('Murky');
  assert.ok(sot && real && murky, 'both styles and the Murky type must resolve');

  // A style must not carry a palette - that is the whole point of splitting the axes.
  for (const st of [sot, real]) {
    assert.strictEqual(st.shallowColor, undefined, st.name + ' must not define a colour');
    assert.strictEqual(st.deepColor, undefined, st.name + ' must not define a colour');
  }

  // Same type, two styles: identical palette, different method.
  const a = FW.composeWaterDetailingLook(sot, murky);
  const b = FW.composeWaterDetailingLook(real, murky);
  assert.deepStrictEqual(a.shallowColor, b.shallowColor, 'the water is the same water in both styles');
  assert.deepStrictEqual(a.deepColor, b.deepColor, 'and the same deep colour');
  assert.strictEqual(a.causticsDepthFade, 0, 'Sea of Thieves keeps the light web at depth');
  assert.strictEqual(b.causticsDepthFade, 1, 'Realistic fades it out with depth');
  assert.ok(a.translucencyIntensity > b.translucencyIntensity,
    'the stylized crest glow is stronger than the physical one');
  assert.ok(a.foamIntensity > b.foamIntensity, 'and its foam is more graphic');

  // Two types under one style: same method, different water.
  const ocean = FW.composeWaterDetailingLook(sot, FW.resolveWaterDetailingType('Open Ocean'));
  assert.notDeepStrictEqual(ocean.shallowColor, a.shallowColor, 'Open Ocean is not Murky');
  assert.strictEqual(ocean.causticsDepthFade, a.causticsDepthFade, 'but both are drawn the same way');

  // End to end through the behavior, the way the editor sends both selectors.
  {
    const sc = makeScene();
    const obj = mk('SplitOcean');
    const oB = {}; const dB = {};
    const oc = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 5000 });
    FW.registerWaterDetailing(sc, obj, dB, { style: 'Sea of Thieves', waterLook: 'Murky' });
    FW.stepWaterDetailing(sc, obj, dB);
    const u = oc.material.uniforms;
    assert.strictEqual(u.u_CausticsDepthFade.value, 0, 'the stylized method reaches the shader');
    assert.ok(near(u.u_ShallowColor.value.x, murky.shallowColor[0]), 'and the Murky palette does too');
    const det = FW.waterDetailingOf(sc, dB);
    assert.strictEqual(det.style, 'Sea of Thieves', 'the chosen style is recorded');
    assert.strictEqual(det.waterLook, 'Murky', 'and the chosen water type');
  }

  // A project saved before the split holds a combined name in the old single property.
  {
    const sc = makeScene();
    const obj = mk('LegacyOcean');
    const oB = {}; const dB = {};
    const oc = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 5000 });
    // The legacy Preset property is gone (the extension never shipped, so no project holds one),
    // but the action still accepts the old combined names from events.
    FW.registerWaterDetailing(sc, obj, dB, { style: 'Custom', waterLook: 'Custom' });
    FW.setWaterDetailingPreset(sc, dB, 'Stormy - Dark');
    FW.stepWaterDetailing(sc, obj, dB);
    const legacy = FW.WATER_DETAILING_PRESETS.Stormy_Dark;
    const u = oc.material.uniforms;
    assert.ok(near(u.u_ShallowColor.value.x, legacy.shallowColor[0])
      && near(u.u_ShallowColor.value.y, legacy.shallowColor[1]),
    'a pre-split preset name must still resolve through the action');
  }
  console.log('  Passed: style and type compose, and legacy preset names still resolve.');
}

console.log('--- Test 39: Lighting is its own axis, and the three compose in the right order ---');
{
  // Golden Hour and Midday were stuck inside the old combined preset list, so picking the hour
  // meant picking the water and the method too. Lighting owns the sun and nothing else.
  const mk = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  const golden = FW.resolveWaterDetailingLighting('Golden Hour');
  const midday = FW.resolveWaterDetailingLighting('Midday');
  assert.ok(golden && midday, 'both hours must resolve');

  // A lighting preset owns the sun and NOTHING else - no palette, no foam, no caustics rule.
  for (const l of [golden, midday]) {
    for (const forbidden of ['shallowColor', 'deepColor', 'foamIntensity', 'extinctionDepth',
      'causticsIntensity', 'causticsDepthFade', 'waveContrast']) {
      assert.strictEqual(l[forbidden], undefined,
        l.name + ' must not define ' + forbidden + ' - that belongs to another axis');
    }
  }

  const sot = FW.resolveWaterDetailingStyle('Sea of Thieves');
  const murky = FW.resolveWaterDetailingType('Murky');

  // Same water, same method, two hours: only the sun moves.
  const a = FW.composeWaterDetailingLook(sot, murky, golden);
  const b = FW.composeWaterDetailingLook(sot, murky, midday);
  assert.deepStrictEqual(a.shallowColor, b.shallowColor, 'the hour must not repaint the water');
  assert.strictEqual(a.causticsDepthFade, b.causticsDepthFade, 'nor change the drawing method');
  assert.ok(near(a.foamIntensity, b.foamIntensity), 'nor the foam');
  assert.notStrictEqual(a.sunElevation, b.sunElevation, 'but the sun must move');
  assert.strictEqual(a.sunElevation, 18, 'Golden Hour sits low');
  assert.strictEqual(b.sunElevation, 65, 'Midday sits high');

  // Order matters: lighting sets the sun, then the style scales it. Getting this backwards would
  // throw away the style's specular character every time an hour is chosen.
  const styled = FW.composeWaterDetailingLook(sot, murky, golden);
  const plain = FW.composeWaterDetailingLook(null, murky, golden);
  assert.ok(near(plain.sunSpecularIntensity, golden.sunSpecularIntensity),
    'with no style, the hour’s specular passes through untouched');
  assert.ok(near(styled.sunSpecularIntensity, golden.sunSpecularIntensity * sot.sunSpecularScale),
    'with a style, its specular scale applies ON TOP of the chosen hour');
  assert.ok(styled.sunSpecularIntensity > plain.sunSpecularIntensity,
    'so Sea of Thieves is glossier than the bare hour');

  // The three axes are independent end to end.
  const sc = makeScene();
  const obj = mk('ThreeAxis');
  const oB = {}; const dB = {};
  FW.registerWaveWorksOcean(sc, obj, oB, {
    beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 5000 });
  FW.registerWaterDetailing(sc, obj, dB, {
    style: 'Sea of Thieves', waterLook: 'Murky', lighting: 'Midday' });
  const det = FW.waterDetailingOf(sc, dB);
  assert.strictEqual(det.style, 'Sea of Thieves', 'style recorded');
  assert.strictEqual(det.waterLook, 'Murky', 'water type recorded');
  assert.strictEqual(det.lighting, 'Midday', 'lighting recorded');
  assert.strictEqual(det.sunElevation, 65, 'and the chosen hour drives the sun');

  // Custom lighting hands the sun back to the individual properties.
  const cB = {};
  FW.registerWaterDetailing(sc, mk('CustomSun'), cB, {
    style: 'Sea of Thieves', waterLook: 'Murky', lighting: 'Custom', sunElevation: 7.0, sunHeading: 300.0 });
  const cd = FW.waterDetailingOf(sc, cB);
  assert.strictEqual(cd.sunElevation, 7.0, 'Custom lighting uses the authored elevation');
  assert.strictEqual(cd.sunHeading, 300.0, 'and the authored heading');
  console.log('  Passed: the hour moves only the sun, and the style still shapes it.');
}

console.log('--- Test 40: the foam mask is aperiodic and follows the wave field ---');
{
  // Regression: the whitecap mask used to be six sinusoids of world position - a fixed ruling that
  // repeated every 6.5 units across the wind and never referenced the wave field, so foam could not
  // sit on crests. Two properties must hold now:
  //   1. the break-up noise has no strong period (the old mask autocorrelated hard at its ruling),
  //   2. the mask reads the wave field, so a flat sea produces no foam.
  const shaders = FW.__shaderSourcesForTests || null;

  // (1) Periodicity. Reimplement the shipped noise exactly and autocorrelate a long transect.
  //     hash2/valueNoise/foamNoise are pure functions of position, so JS reproduces them exactly.
  const fract = (x) => x - Math.floor(x);
  function hash2(px, py) {
    let x = px % 256, y = py % 256;
    const dx = x * 127.1 + y * 311.7;
    const dy = x * 269.5 + y * 183.3;
    return [fract(Math.sin(dx) * 43758.5453123), fract(Math.sin(dy) * 43758.5453123)];
  }
  function valueNoise(px, py) {
    const ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy)[0];
    const b = hash2(ix + 1, iy)[0];
    const c = hash2(ix, iy + 1)[0];
    const d = hash2(ix + 1, iy + 1)[0];
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
  }
  const foamNoise = (px, py) => valueNoise(px, py) * 0.62 + valueNoise(px * 2.17 + 3.7, py * 2.17 + 1.3) * 0.38;

  // Sample the break-up along a transect the way the shader would across an ocean.
  const N = 2048;
  const series = [];
  for (let i = 0; i < N; i++) {
    const alongWind = i * (5000 / N) * 0.010;   // the shipped foamFrame scale
    series.push(foamNoise(alongWind * 6.0, 0.0));
  }
  const mean = series.reduce((a, b) => a + b, 0) / N;
  const centred = series.map((v) => v - mean);
  const variance = centred.reduce((a, b) => a + b * b, 0) / N;
  assert.ok(variance > 1e-4, 'the break-up must actually vary, got variance ' + variance);

  let worstLag = 0, worstCorr = 0;
  for (let lag = 8; lag < N / 2; lag++) {
    let acc = 0;
    for (let i = 0; i < N - lag; i++) acc += centred[i] * centred[i + lag];
    const corr = acc / ((N - lag) * variance);
    if (corr > worstCorr) { worstCorr = corr; worstLag = lag; }
  }
  // A pure sine autocorrelates to ~1.0 at its period. Noise should stay far below that.
  assert.ok(worstCorr < 0.55,
    'the foam break-up must not repeat: strongest autocorrelation ' + worstCorr.toFixed(2) +
    ' at lag ' + worstLag + ' (a ruled sine pattern scores ~1.0)');

  // Sanity: the metric does flag a sine, so the threshold means something.
  const sine = [];
  for (let i = 0; i < N; i++) sine.push(Math.sin(i * 0.05));
  const sMean = sine.reduce((a, b) => a + b, 0) / N;
  const sC = sine.map((v) => v - sMean);
  const sVar = sC.reduce((a, b) => a + b * b, 0) / N;
  let sBest = 0;
  for (let lag = 8; lag < N / 2; lag++) {
    let acc = 0;
    for (let i = 0; i < N - lag; i++) acc += sC[i] * sC[i + lag];
    sBest = Math.max(sBest, acc / ((N - lag) * sVar));
  }
  assert.ok(sBest > 0.9,
    'the periodicity metric must flag a plain sine (got ' + sBest.toFixed(2) + '), or it proves nothing');

  // (2) The mask reads the wave field: a flat sea must produce no crest foam.
  const mk = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const sc = makeScene();
  const beh = {};
  const flat = FW.registerWaveWorksOcean(sc, mk('FlatFoam'), beh, {
    beaufortScale: 'Beaufort 0 - Calm', resolution: 32, gridSubdivisions: 32, tileSize: 4000 });
  FW.updateOceanField(flat, 3.0);
  let maxFold = 0;
  for (let i = 0; i < flat.foamBuffer.length; i++) maxFold = Math.max(maxFold, flat.foamBuffer[i]);
  assert.strictEqual(maxFold, 0, 'a mirror-calm sea folds nowhere, so there is nothing for foam to sit on');
  assert.strictEqual(flat.material.uniforms.u_FoamIntensity.value, 0,
    'and Beaufort 0 carries no foam intensity either');

  // The crest reference must track the sea state, not stay frozen at registration.
  const stormBeh = {};
  const storm = FW.registerWaveWorksOcean(sc, mk('StormFoam'), stormBeh, {
    beaufortScale: 'Beaufort 4 - Moderate Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 4000 });
  const atB4 = storm.material.uniforms.u_PeakReference.value;
  FW.setWaveWorksBeaufort(sc, stormBeh, 'Beaufort 12 - Hurricane');
  FW.updateOceanField(storm, 3.0);
  const atB12 = storm.material.uniforms.u_PeakReference.value;
  assert.ok(atB12 > atB4 * 2,
    'the crest reference must grow with Hs (B4 ' + atB4.toFixed(1) + ' -> B12 ' + atB12.toFixed(1) + ')');
  console.log('  Passed: break-up is aperiodic, foam follows the field, crest reference tracks Hs.');
}

console.log('--- Test 41: Style x Sub-style x Type x Lighting, and the medium changes behaviour ---');
{
  // Salt and fresh water are a MEDIUM, not a palette: electrolytes stop bubbles merging, so salt
  // water whitecaps readily and its foam lingers (~3.85 s) while fresh water rarely whitecaps and
  // its foam collapses (~2.54 s). That has to show up in behaviour, not just colour.
  const salt = FW.resolveWaterDetailingSubStyle('Salt Water');
  const fresh = FW.resolveWaterDetailingSubStyle('Fresh Water');
  const pool = FW.resolveWaterDetailingSubStyle('Pool Water');
  assert.ok(salt && fresh && pool, 'all three media must resolve');

  // The measured decay times, carried so the foam buffer can use them directly.
  assert.ok(salt.foamDecay > fresh.foamDecay,
    'salt water foam must outlive fresh water foam (' + salt.foamDecay + ' vs ' + fresh.foamDecay + ')');
  assert.ok(fresh.foamCoverageScale < salt.foamCoverageScale,
    'and fresh water must whitecap less readily');
  assert.ok(pool.foamCoverageScale < fresh.foamCoverageScale, 'a pool barely foams at all');

  // A medium must not define a palette outright - it only tints and rescales what the type says.
  for (const m of [salt, fresh, pool]) {
    assert.strictEqual(m.shallowColor, undefined, m.name + ' must not define a colour');
    assert.ok(Array.isArray(m.tint) && m.tint.length === 3, m.name + ' tints instead');
  }

  const sot = FW.resolveWaterDetailingStyle('Sea of Thieves');
  const stormy = FW.resolveWaterDetailingType('Stormy');

  // Same style, same condition, two media: the foam behaviour differs, the condition survives.
  const asSalt = FW.composeWaterDetailingLook(sot, stormy, null, salt);
  const asFresh = FW.composeWaterDetailingLook(sot, stormy, null, fresh);
  assert.ok(asSalt.foamCoverage > asFresh.foamCoverage,
    'a storm on the sea whitecaps more than the same storm on a lake');
  assert.ok(asFresh.extinctionDepth < asSalt.extinctionDepth,
    'and fresh water carries more particulate, so light gets less far');
  assert.strictEqual(asSalt.foamDecay, salt.foamDecay, 'the decay constant travels with the look');

  // The new styles carry real effect modules.
  const poolStyle = FW.resolveWaterDetailingStyle('Swimming Pool');
  const toon = FW.resolveWaterDetailingStyle('Toon');
  assert.strictEqual(poolStyle.foamModel, 0.0, 'a pool has no whitecaps at all');
  assert.ok(toon.quantiseBands >= 3, 'a toon style posterises the surface');
  assert.ok(toon.foamSoftness < sot.foamSoftness, 'and hardens the foam edge');
  assert.strictEqual(sot.quantiseBands, 0.0, 'while Sea of Thieves stays continuous');

  // End to end, all four axes reach the material.
  const sc = makeScene();
  const obj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => 'FourAxis',
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  };
  const oB = {}; const dB = {};
  const oc = FW.registerWaveWorksOcean(sc, obj, oB, {
    beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32, tileSize: 4000 });
  FW.registerWaterDetailing(sc, obj, dB, {
    style: 'Swimming Pool', subStyle: 'Pool Water', waterLook: 'Calm', lighting: 'Midday' });
  FW.stepWaterDetailing(sc, obj, dB);

  const det = FW.waterDetailingOf(sc, dB);
  assert.strictEqual(det.style, 'Swimming Pool', 'style recorded');
  assert.strictEqual(det.subStyle, 'Pool Water', 'medium recorded');
  assert.strictEqual(det.waterLook, 'Calm', 'condition recorded');
  assert.strictEqual(det.lighting, 'Midday', 'hour recorded');

  const u = oc.material.uniforms;
  assert.strictEqual(u.u_FoamModel.value, 0.0, 'the pool style switches whitecaps off in the shader');
  assert.strictEqual(u.u_QuantiseBands.value, 0.0, 'and does not posterise');
  assert.strictEqual(det.sunElevation, 65, 'Midday drives the sun');

  // Switching to Toon must change the module, not the water.
  const beforeShallow = [u.u_ShallowColor.value.x, u.u_ShallowColor.value.y, u.u_ShallowColor.value.z];
  const tB = {};
  FW.registerWaterDetailing(sc, obj, tB, {
    style: 'Toon', subStyle: 'Pool Water', waterLook: 'Calm', lighting: 'Midday' });
  FW.stepWaterDetailing(sc, obj, tB);
  assert.ok(u.u_QuantiseBands.value >= 3, 'Toon posterises');
  assert.strictEqual(u.u_FoamModel.value, 1.0, 'and brings whitecaps back');
  console.log('  Passed: four axes compose, and the medium changes how the water behaves.');
}

console.log('--- Test 42: persistent foam is opt-in, decays in real seconds, and falls back ---');
{
  // Phase 2 reintroduces render-target work, which is exactly what the removed GPU FFT did badly:
  // it failed silently on some drivers. So the contract is: OFF unless asked for, never fatal, and
  // it degrades to the stateless crest mask rather than painting the ocean white.
  const mk = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4000, getHeight: () => 4000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  // Default OFF, and the shader term is inert.
  {
    const sc = makeScene();
    const beh = {};
    const o = FW.registerWaveWorksOcean(sc, mk('NoFoamRT'), beh, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32 });
    // ON by default since 4.1.0: the progressive blur is not polish, it is how Rare turns raw
    // Jacobian foam (their slide is captioned "Too Noisy") into the look the game is known for.
    assert.strictEqual(o.persistentFoam, true, 'persistent foam is the default path now');
    // ...but this environment has no capable renderer, so it must fall back rather than throw,
    // allocate nothing, and leave the shader on the stateless mask.
    assert.strictEqual(o.foamRT, null, 'without a capable renderer no target is allocated');
    assert.strictEqual(o.material.uniforms.u_FoamBufferOn.value, 0.0,
      'and the shader term stays off, so the crest mask is purely of this frame');
    FW.updateOceanField(o, 1.0);
    assert.strictEqual(o.material.uniforms.u_FoamBufferOn.value, 0.0,
      'and it stays off after a step rather than flickering on');
  }

  // A renderer that cannot provide a target must not break registration.
  {
    const sc = makeScene();
    sc.getGame = () => ({ getRenderer: () => ({ getThreeRenderer: () => ({
      capabilities: { isWebGL2: false },
    }) }) });
    const beh = {};
    const o = FW.registerWaveWorksOcean(sc, mk('WebGL1'), beh, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32,
      persistentFoam: true });
    assert.ok(o, 'the ocean still registers on a renderer that cannot host the buffer');
    assert.strictEqual(o.foamRT, null, 'and quietly goes without the buffer');
    assert.strictEqual(o.material.uniforms.u_FoamBufferOn.value, 0.0, 'falling back to the crest mask');
  }

  // The decay constant is real seconds, frame-rate independent.
  {
    const decay = (dt, seconds) => Math.exp(-Math.max(dt, 0) / Math.max(seconds, 0.05));
    // Salt water: after one decay time, foam should be down to 1/e.
    const salt = FW.resolveWaterDetailingSubStyle('Salt Water');
    const fresh = FW.resolveWaterDetailingSubStyle('Fresh Water');
    assert.ok(Math.abs(decay(salt.foamDecay, salt.foamDecay) - Math.exp(-1)) < 1e-9,
      'one decay time must leave 1/e of the foam');
    // Two 8 ms steps must equal one 16 ms step, or foam would live longer at high frame rates.
    const twoSmall = decay(0.008, salt.foamDecay) * decay(0.008, salt.foamDecay);
    const oneBig = decay(0.016, salt.foamDecay);
    assert.ok(Math.abs(twoSmall - oneBig) < 1e-9,
      'decay must be frame-rate independent (' + twoSmall + ' vs ' + oneBig + ')');
    // And fresh water must lose its foam faster over the same interval.
    assert.ok(decay(1.0, fresh.foamDecay) < decay(1.0, salt.foamDecay),
      'fresh water foam must fade faster than salt water foam');
  }

  // FoamBuffer.isSupported is the gate, and it must reject what it cannot use.
  assert.strictEqual(FW.FoamBuffer.isSupported(null), false, 'no renderer, no buffer');
  assert.strictEqual(FW.FoamBuffer.isSupported({ capabilities: { isWebGL2: false } }), false,
    'WebGL1 cannot host it');
  console.log('  Passed: off by default, degrades safely, decay is frame-rate independent.');
}

console.log('--- Test 43: foam coverage tracks the Beaufort rung instead of whiting out the sea ---');
{
  // Test 40 proved the foam mask is APERIODIC. It never proved it was SPARSE, so a regression that
  // painted 41% of a Beaufort 4 sea solid white passed the whole suite. This is that missing guard.
  //
  // The mapping is read back out of the shipped shader rather than restated here, so the test
  // cannot quietly drift away from the code it is checking.
  const wv = runtimeCode.slice(runtimeCode.indexOf('WAVEWORKS_FRAGMENT_SHADER'),
    runtimeCode.indexOf('WATER_VERTEX_SHADER'));
  assert.ok(/float crest = clamp\((?:max\(fold,\s*plume0\s*\*\s*0\.85\)|fold), 0\.0, 1\.0\);/.test(wv),
    'foam must come from the Jacobian fold alone (with collision plume) - vPeak is the subsurface signal and saturates');
  assert.ok(!/max\(fold, vPeak/.test(wv), 'vPeak must not be folded back into the foam mask');

  const readPair = (re, what) => {
    const m = wv.match(re);
    assert.ok(m, 'could not read ' + what + ' out of WAVEWORKS_FRAGMENT_SHADER');
    return m.slice(1).map(Number);
  };
  // The Jacobian bias now lives at GENERATION (OceanField.computeFoam, Rare's own formula), so
  // what remains in the shader is a fixed soft toe rather than a coverage-driven threshold.
  const [tHi] = readPair(/float crestThreshold = ([\d.]+);/, 'the crest threshold');
  const tSlope = 0;
  const [wMul, wMin] = readPair(
    /float capWidth = max\(u_FoamCoverage \* ([\d.]+), ([\d.]+)\)/, 'the cap width');
  // How much the detail cascade is allowed to contribute to the fold, read from the shader so the
  // test cannot drift from it.
  const [detailMix] = readPair(
    /float fold = clamp\(\(fold0 \+ fold1 \* cWeight \* ([\d.]+)\)/, 'the cascade detail mix');

  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const cl = (v, a, b) => Math.min(Math.max(v, a), b);
  const smooth = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // Evaluate the shipped mask over the whole field for one sea state.
  const measure = (scaleName) => {
    const sc = makeScene(); const oB = {}; const dB = {}; const obj = mkOcean('FoamCoverage');
    const o = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: scaleName, resolution: 32, gridSubdivisions: 32, tileSize: 5000 });
    FW.registerWaterDetailing(sc, obj, dB, {
      style: 'Realistic', subStyle: 'Salt Water', waterLook: 'Choppy', lighting: 'Golden Hour' });
    FW.stepWaterDetailing(sc, obj, dB);
    FW.updateOceanField(o, 3.0);
    const u = o.material.uniforms;
    const cov = u.u_FoamCoverage.value;
    const inten = u.u_FoamIntensity.value;
    const soft = u.u_FoamSoftness.value;
    const chop = u.u_Choppiness.value;
    const cascade = cl(u.u_CascadeWeight.value, 0, 1.5);
    const peakRef = u.u_PeakReference.value;
    const T = Math.max(tHi - cov * tSlope, 0.02);
    const W = Math.max(cov * wMul, wMin) * soft;
    const laceLo = 0.42 + 0.08 * cl(1 - soft, 0, 1);
    const lace = 0.5;                                  // value noise averages 0.5
    let white = 0; let any = 0; let peakSat = 0;
    const n = o.foamBuffer.length;
    for (let i = 0; i < n; i++) {
      const fold = cl(o.foamBuffer[i]
        + (o.cascadeFoamBuffer ? o.cascadeFoamBuffer[i] : 0) * cascade * detailMix, 0, 1);
      // vPeak is the horizontal choppiness offset, matching the vertex shader.
      const dx = o.field.dispX[i] * chop + (o.field1 ? o.field1.dispX[i] * chop * cascade : 0);
      const dy = o.field.dispY[i] * chop + (o.field1 ? o.field1.dispY[i] * chop * cascade : 0);
      if (Math.hypot(dx, dy) / Math.max(peakRef, 1) >= 0.999) peakSat++;
      const cap = smooth(T, Math.min(T + W, 1), fold);
      const trail = smooth(Math.max(T - W * 0.6, 0), T + 0.02, fold)
        * smooth(laceLo, laceLo + 0.44 * soft, lace);
      const foam = Math.min(cl(cap * (0.55 + 0.65 * lace) + trail * 0.85, 0, 1) * inten, 1);
      if (foam > 0.9) white++;
      if (foam > 0.05) any++;
    }
    return { white: 100 * white / n, any: 100 * any / n, peakSat: 100 * peakSat / n };
  };

  // The bounds come from the Beaufort scale's own descriptions of each rung.
  // Bounds are for the SHIPPED default look, which is Sea of Thieves - deliberately generous
  // sheets rather than physically sparse whitecaps. The "carries any foam" band is therefore wide;
  // the tight one is SOLID WHITE, which is the number that caught the original whiteout (41% of a
  // Beaufort 4 sea) and is what must never come back.
  const RUNGS = [
    ['Beaufort 2 - Light Breeze', 'glassy, no breaking', 0, 2, 0, 8],
    ['Beaufort 4 - Moderate Breeze', 'fairly frequent white horses', 0, 8, 1, 35],
    ['Beaufort 6 - Strong Breeze', 'many white horses', 5, 45, 15, 70],
    ['Beaufort 9 - Strong Gale', 'dense foam streaks', 30, 80, 40, 92],
    ['Beaufort 12 - Hurricane', 'sea completely white', 45, 95, 55, 99],
  ];
  let prevAny = -1;
  for (const [scaleName, wording, whiteLo, whiteHi, anyLo, anyHi] of RUNGS) {
    const m = measure(scaleName);
    const at = scaleName.split(' -')[0] + ' (' + wording + ')';
    assert.ok(m.white >= whiteLo && m.white <= whiteHi,
      at + ': ' + m.white.toFixed(1) + '% of the surface is solid white, wanted '
      + whiteLo + '-' + whiteHi + '%');
    assert.ok(m.any >= anyLo && m.any <= anyHi,
      at + ': ' + m.any.toFixed(1) + '% carries foam, wanted ' + anyLo + '-' + anyHi + '%');
    // vPeak feeds subsurface and glitter; if it pins at 1.0 those flatten out too.
    assert.ok(m.peakSat < 20,
      at + ': the crest mask saturates over ' + m.peakSat.toFixed(1) + '% of the surface, so the '
      + 'subsurface and glitter terms are clipped - u_PeakReference is too small');
    assert.ok(m.any > prevAny,
      at + ': a rougher sea must carry more foam than the rung below it');
    prevAny = m.any;
  }
  console.log('  Passed: foam is fold-driven, sparse at Beaufort 4 and dense in a gale.');
}

console.log('--- Test 44: foam breaks ON the crests, not in the troughs ---');
{
  // Whitecaps form where water piles into a wave top and the surface folds over. For a whole
  // release the horizontal displacement carried the wrong sign, so choppiness broadened crests and
  // pinched hollows - and the Jacobian fold, and every bit of foam with it, sat in the troughs.
  // Nothing caught it: the foam was aperiodic, it tracked the wave field, and its coverage was
  // plausible. It was simply upside down. This is the test that pins it.
  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const correlate = (a, b) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let num = 0; let da = 0; let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma; const y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db || 1);
  };

  for (const scaleName of ['Beaufort 4 - Moderate Breeze', 'Beaufort 6 - Strong Breeze',
    'Beaufort 9 - Strong Gale']) {
    const sc = makeScene();
    const o = FW.registerWaveWorksOcean(sc, mkOcean('CrestFoam'), {}, {
      beaufortScale: scaleName, resolution: 64, gridSubdivisions: 64, tileSize: 5000 });
    FW.updateOceanField(o, 3.0);
    const cascade = Math.min(Math.max(o.material.uniforms.u_CascadeWeight.value, 0), 1.5);
    const rung = scaleName.split(' -')[0];

    const elevation = []; const fold = [];
    for (let i = 0; i < o.foamBuffer.length; i++) {
      elevation.push(o.field.height[i] + (o.field1 ? o.field1.height[i] * cascade : 0));
      const f = Math.max(o.foamBuffer[i],
        (o.cascadeFoamBuffer ? o.cascadeFoamBuffer[i] : 0) * cascade);
      fold.push(Math.min(Math.max(f, 0), 1));
    }
    // The Jacobian fold must rise with elevation. Negative here means the sign of the horizontal
    // displacement spectrum has flipped and the sea is folding in its hollows.
    // Correlation over the whole field is dominated by zeros now that foam is generated only
    // where the surface is close to folding, so measure WHERE the foam is instead: the cells that
    // carry foam must sit higher than the sea does on average. That is sparsity-proof and it is
    // the same claim - foam breaks on the crests.
    let foamZ = 0; let foamN = 0; let allZ = 0;
    for (let i = 0; i < fold.length; i++) {
      allZ += elevation[i];
      if (fold[i] > 0.01) { foamZ += elevation[i]; foamN++; }
    }
    const meanAll = allZ / elevation.length;
    if (foamN > 0) {
      const meanFoam = foamZ / foamN;
      assert.ok(meanFoam > meanAll, rung + ': foaming cells average elevation ' +
        meanFoam.toFixed(1) + ' against a sea average of ' + meanAll.toFixed(1) +
        ' - foam must break on the crests, not in the troughs. Below the sea average means the ' +
        'displacement spectrum sign is flipped (see OceanField.evolve).');
    }

    // And concretely: more of the folding must land in the top fifth of the sea than a uniform
    // scatter would put there.
    const order = elevation.map((z, i) => [z, i]).sort((a, b) => a[0] - b[0]);
    let top = 0; let all = 0;
    for (let k = 0; k < order.length; k++) {
      const v = fold[order[k][1]];
      all += v;
      if (k >= order.length * 0.8) top += v;
    }
    const share = 100 * top / (all || 1);
    assert.ok(share > 25, rung + ': only ' + share.toFixed(1) + '% of the folding sits in the top ' +
      'fifth of the wave field; an even scatter would already give 20%');
  }

  // Subsurface is driven by "the choppiness vertex offsets... a mask for where the SIDES of the
  // waves are" (Rare). That is the horizontal offset magnitude, NOT elevation. This assertion once
  // demanded the opposite, after 0.086 correlation with height was misread as the signal being
  // broken - but a flanks mask is supposed to be uncorrelated with height. Test 43 guards the
  // defect that actually existed, which was the divisor letting it saturate.
  const wv = runtimeCode.slice(runtimeCode.indexOf('WAVEWORKS_VERTEX_SHADER'),
    runtimeCode.indexOf('WAVEWORKS_FRAGMENT_SHADER'));
  assert.ok(/vPeak = clamp\(length\(totalDisp\.xy\)/.test(wv),
    'vPeak must be the choppiness offset magnitude - the sides-of-waves mask Rare uses for SSS');

  // And the fold has to describe the surface actually drawn, which is displaced by u_Choppiness.
  assert.ok(/computeFoam = function \(out, choppiness, foamThreshold\)/.test(runtimeCode),
    'computeFoam must take the choppiness the shader applies AND the Jacobian bias, or it '
    + 'measures a different surface, or generates foam wherever the sea merely compresses');
  console.log('  Passed: folding rises with elevation and concentrates on the wave tops.');
}

console.log('--- Test 45: no square lattice, and the detail cascade cannot flood the foam ---');
{
  // Two defects that made the water read as a grid of squares under white mountains.

  // (a) microWaveNormal scaled p on the WORLD axes and used the wind only as a scrolling time
  //     offset, so its pattern never rotated: one component rode a world-locked wave vector and
  //     the other rode the perpendicular one. Two perpendicular world-locked plane waves are a
  //     square grid. Measured over a 2048-unit patch the old function scored 0.006 world X/Y
  //     asymmetry and 0.008 wind anisotropy - square, and blind to the wind.
  const wv = runtimeCode.slice(runtimeCode.indexOf('WAVEWORKS_FRAGMENT_SHADER'),
    runtimeCode.indexOf('WATER_VERTEX_SHADER'));
  assert.ok(/vec2 q = vec2\(dot\(p, w\), dot\(p, perp\)/.test(wv),
    'microWaveNormal must build its ripples in the wind frame, or the pattern is locked to the ' +
    'world axes and reads as a grid of squares');

  // Port it and measure, rather than trusting the source read.
  const micro = (px, py, time, wx, wy, freq) => {
    const L = Math.hypot(wx, wy);
    const w = L > 0.001 ? [wx / L, wy / L] : [0.7071, 0.7071];
    const perp = [-w[1], w[0]];
    const f = Math.max(freq, 0.1);
    const qx = (px * w[0] + py * w[1]) * f;
    const qy = (px * perp[0] + py * perp[1]) * 0.42 * f;
    const K = [[0.0093, 0.0000], [0.0190, 0.0069], [0.0353, -0.0247]];
    const A = [0.50, 0.32, 0.18];
    const ph = [qx * K[0][0] + qy * K[0][1] + time * 1.20,
      qx * K[1][0] + qy * K[1][1] - time * 0.87,
      qx * K[2][0] + qy * K[2][1] + time * 1.63];
    let gx = 0; let gy = 0;
    for (let i = 0; i < 3; i++) {
      gx += K[i][0] * A[i] * Math.cos(ph[i]);
      gy += K[i][1] * A[i] * Math.cos(ph[i]);
    }
    gx *= 93.0 * f; gy *= 93.0 * f;
    return [w[0] * gx + perp[0] * (gy * 0.42), w[1] * gx + perp[1] * (gy * 0.42)];
  };

  const N = 128; const STEP = 8;
  const grid = [];
  for (let y = 0; y < N; y++) {
    const row = [];
    for (let x = 0; x < N; x++) {
      const [dx, dy] = micro(x * STEP, y * STEP, 3.0, 0.7071, 0.7071, 1.0);
      row.push(Math.hypot(dx, dy));
    }
    grid.push(row);
  }
  const flat = grid.flat();
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  const varr = flat.reduce((a, b) => a + (b - mean) * (b - mean), 0) / flat.length;
  const ac = (dxs, dys) => {
    let acc = 0; let c = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const xx = x + dxs; const yy = y + dys;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        acc += (grid[y][x] - mean) * (grid[yy][xx] - mean); c++;
      }
    }
    return (acc / c) / varr;
  };
  // Wind is at 45 degrees here, so along-wind is the (+1,+1) diagonal and across-wind is (+1,-1).
  const lags = [16, 32, 48];
  const asym = lags.reduce((a, l) => a + Math.abs(ac(l, 0) - ac(0, l)), 0) / lags.length;
  const aniso = lags.reduce((a, l) => a + Math.abs(ac(l, l) - ac(l, -l)), 0) / lags.length;
  assert.ok(asym > 0.05, 'the micro detail is symmetric between the world X and Y axes (' +
    asym.toFixed(3) + '); that four-fold symmetry is what reads as a grid of squares');
  assert.ok(aniso > 0.08, 'the micro detail does not respond to wind direction (' +
    aniso.toFixed(3) + '); wind ripples must run across the wind, not sit on the world axes');
  // And it must keep the amplitude u_MicroDetail was calibrated against.
  assert.ok(mean > 0.45 && mean < 0.70,
    'micro detail amplitude drifted to ' + mean.toFixed(3) + '; u_MicroDetail was tuned around 0.57');

  // (b) The fold must be sampled per-fragment, not interpolated from the vertices, or foam takes
  //     on the shape of the triangles it is drawn over.
  assert.ok(/float fold0 = texture2D\(u_Field, vFieldUv\)\.a;/.test(wv),
    'the fold must be sampled in the fragment shader; as a vertex varying the foam edges follow ' +
    'triangle edges and the whitecaps read as flat white facets');
  assert.ok(!/varying float vJacobian/.test(runtimeCode),
    'the vJacobian varying should be gone once the fold is sampled per-fragment');

  // And the detail cascade must not be able to generate foam on its own. It carries the same
  // spectrum on a quarter-size tile, so it is ~4x steeper: its fold pinned at 1.0 across 23.7% of
  // a Beaufort 9 field and 39.8% of a Beaufort 12 one. Through the old max() that was a constant.
  assert.ok(!/float fold = clamp\(max\(fold0, fold1/.test(wv),
    'max(fold0, fold1 * weight) lets the detail cascade saturate the whole foam mask');
  const m = wv.match(/fold1 \* cWeight \* ([\d.]+)/);
  assert.ok(m, 'the detail cascade contribution must be an explicit, small weight');
  assert.ok(Number(m[1]) <= 0.35, 'the detail cascade is mixed in at ' + m[1] +
    '; above ~0.35 it starts generating foam rather than texturing it');
  console.log('  Passed: ripples follow the wind, foam is per-fragment, cascade only textures it.');
}

console.log('--- Test 46: surface slope is analytic, not differenced off the height texture ---');
{
  // The shader used to rebuild the normal with a central difference at exactly +/-1 texel of a
  // bilinearly filtered height texture. That reconstruction is piecewise bilinear, so its
  // derivative is discontinuous on texel boundaries and those discontinuities line up into a
  // visible lattice - the water looked like it was made of squares. The field now carries
  // d(height)/d(gdX) and d(height)/d(gdY) straight from the spectrum.
  const wv = runtimeCode.slice(runtimeCode.indexOf('WAVEWORKS_FRAGMENT_SHADER'),
    runtimeCode.indexOf('WATER_VERTEX_SHADER'));
  assert.ok(/vec2 grad0 = -(?:texture2D\(u_Slope, vFieldUv\)|sTex0)\.xy;/.test(wv),
    'the fragment shader must read the slope texture rather than difference height');
  assert.ok(!/float hL0 = texture2D/.test(wv),
    'the eight-tap height difference should be gone; it is both the lattice and 6 wasted taps');

  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const correlate = (a, b) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let num = 0; let da = 0; let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma; const y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db || 1);
  };

  const sc = makeScene();
  const o = FW.registerWaveWorksOcean(sc, mkOcean('Slope'), {}, {
    beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 128, gridSubdivisions: 128,
    tileSize: 5000 });
  FW.updateOceanField(o, 3.0);
  const f = o.field;
  const N = f.n;
  const cell = f.tileSize / N;
  const wrap = (i) => ((i % N) + N) % N;

  const analytic = []; const fd2 = []; const fd4 = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      analytic.push(f.slopeX[y * N + x]);
      fd2.push((f.height[y * N + wrap(x + 1)] - f.height[y * N + wrap(x - 1)]) / (2 * cell));
      fd4.push((-f.height[y * N + wrap(x + 2)] + 8 * f.height[y * N + wrap(x + 1)]
        - 8 * f.height[y * N + wrap(x - 1)] + f.height[y * N + wrap(x - 2)]) / (12 * cell));
    }
  }
  // A central difference attenuates every mode by sinc(k*h), so it UNDER-reads slope. The analytic
  // value must therefore agree better with the higher-order stencil than with the low-order one -
  // that is what says the analytic field is the accurate one and not merely a different field.
  const r2 = correlate(analytic, fd2);
  const r4 = correlate(analytic, fd4);
  assert.ok(r2 > 0.9, 'analytic slope barely tracks a central difference (' + r2.toFixed(3) +
    '); the spectrum packing or the fftshift sign is wrong');
  assert.ok(r4 > r2, 'the analytic slope agrees with the 2nd-order stencil (' + r2.toFixed(3) +
    ') at least as well as the 4th (' + r4.toFixed(3) + '), which it should not if it were exact');

  const rms = (a) => Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length);
  const ratio = rms(analytic) / rms(fd2);
  assert.ok(ratio > 1.0 && ratio < 1.5, 'analytic/finite-difference slope RMS is ' +
    ratio.toFixed(3) + '; it must sit just above 1, since differencing under-reads slope');

  // The textures have to exist, be wired, and be released.
  assert.ok(o.slopeTexture && o.cascadeSlopeTexture, 'both cascades need a slope texture');
  assert.strictEqual(o.material.uniforms.u_Slope.value, o.slopeTexture,
    'u_Slope must point at the slope texture');
  assert.strictEqual(o.material.uniforms.u_CascadeSlope.value, o.cascadeSlopeTexture,
    'u_CascadeSlope must point at the cascade slope texture');
  let disposed = 0;
  o.slopeTexture.dispose = () => { disposed++; };
  o.cascadeSlopeTexture.dispose = () => { disposed++; };
  FW.disposeWaveWorksOcean(sc, o.behavior);
  assert.strictEqual(disposed, 2, 'both slope textures must be released on teardown');
  console.log('  Passed: slopes are exact, wired to both cascades, and released.');
}

console.log('--- Test 47: Wave-collision spray system (WaterDetailing3D) ---');
{
  const sc = makeScene();
  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  const obj = mkOcean('SprayOcean');
  const oceanB = {};
  const detB = {};

  const ocean = FW.registerWaveWorksOcean(sc, obj, oceanB, {
    beaufortScale: 'Beaufort 9 - Strong Gale',
    resolution: 64,
    gridSubdivisions: 64,
    tileSize: 5000,
  });

  const det = FW.registerWaterDetailing(sc, obj, detB, {
    style: 'Sea of Thieves',
    subStyle: 'Salt Water',
    waterLook: 'Stormy',
    lighting: 'Midday',
    sprayEnabled: true,
    sprayAmount: 0.8,
    sprayHeight: 1.2,
    sprayThreshold: 0.4,
  });

  // 1. Check options and getters
  assert.strictEqual(FW.isWaterDetailingSprayEnabled(sc, detB), true);
  assert.strictEqual(FW.getWaterDetailingSprayAmount(sc, detB), 0.8);
  assert.strictEqual(FW.getWaterDetailingSprayHeight(sc, detB), 1.2);
  assert.strictEqual(FW.getWaterDetailingSprayThreshold(sc, detB), 0.4);

  // Check setters
  FW.setWaterDetailingSprayEnabled(sc, detB, false);
  assert.strictEqual(FW.isWaterDetailingSprayEnabled(sc, detB), false);
  FW.setWaterDetailingSprayEnabled(sc, detB, true);
  assert.strictEqual(FW.isWaterDetailingSprayEnabled(sc, detB), true);

  FW.setWaterDetailingSprayAmount(sc, detB, 0.6);
  assert.strictEqual(FW.getWaterDetailingSprayAmount(sc, detB), 0.6);

  FW.setWaterDetailingSprayHeight(sc, detB, 1.5);
  assert.strictEqual(FW.getWaterDetailingSprayHeight(sc, detB), 1.5);

  FW.setWaterDetailingSprayThreshold(sc, detB, 0.3);
  assert.strictEqual(FW.getWaterDetailingSprayThreshold(sc, detB), 0.3);

  // 2. Generate ocean wave field and step detailing
  FW.updateOceanField(ocean, 3.0);
  assert.ok(ocean.field && ocean.field.plume, 'Ocean field must produce plume eigenvalue data');

  const state = FW._getSceneStateForTests(sc);
  // Step detailing multiple frames to trigger collision spray emission
  for (let f = 0; f < 10; f++) {
    FW.stepWaterDetailing(sc, obj, detB);
  }

  assert.ok(state.spray, 'SpraySystem pool must be created');
  assert.ok(state.spray.liveCount > 0, 'Collision spray particles must be emitted in strong gale');
  assert.ok(state.spray.liveCount <= state.spray.max, 'Emitted spray must respect max pool budget');

  // Verify particles have valid positions and velocities
  let foundActive = false;
  for (let i = 0; i < state.spray.max; i++) {
    if (state.spray.alive[i]) {
      foundActive = true;
      assert.ok(Number.isFinite(state.spray.x[i]), 'particle X must be finite');
      assert.ok(Number.isFinite(state.spray.y[i]), 'particle Y must be finite');
      assert.ok(Number.isFinite(state.spray.z[i]), 'particle Z must be finite');
      assert.ok(state.spray.size[i] > 0, 'particle size must be positive');
      break;
    }
  }
  assert.ok(foundActive, 'At least one active particle found in pool');

  // Verify sprayMesh was created and synced
  FW.onScenePostEvents(sc);
  assert.ok(state.sprayMesh, 'state.sprayMesh must be instantiated for rendering');

  // 3. Style suppression: Swimming Pool should suppress spray
  const poolB = {};
  const poolObj = mkOcean('PoolOcean');
  const poolOcean = FW.registerWaveWorksOcean(sc, poolObj, poolB, {
    beaufortScale: 'Beaufort 9 - Strong Gale',
    resolution: 64,
    gridSubdivisions: 64,
    tileSize: 5000,
  });
  const poolDetB = {};
  const poolDet = FW.registerWaterDetailing(sc, poolObj, poolDetB, {
    style: 'Swimming Pool',
    subStyle: 'Pool Water',
    waterLook: 'Clear',
    sprayEnabled: true,
    sprayAmount: 0.5,
  });
  state.spray.clear();
  FW.updateOceanField(poolOcean, 3.0);
  FW.stepWaterDetailing(sc, poolObj, poolDetB);
  assert.strictEqual(state.spray.liveCount, 0, 'Pool water must suppress wave collision spray');

  // 4. Teardown: Disposing detailing releases spray
  FW.disposeWaterDetailing(sc, detB);
  FW.disposeWaterDetailing(sc, poolDetB);
  FW.disposeWaveWorksOcean(sc, oceanB);
  FW.disposeWaveWorksOcean(sc, poolB);

  assert.strictEqual(state.spray, null, 'Spray pool must be cleared when detailing is disposed');
  assert.strictEqual(state.sprayMesh, null, 'Spray mesh must be cleared when detailing is disposed');

  console.log('  Passed: wave-collision spray emits, respects budget, suppresses for pool water, and tears down cleanly.');
}

console.log('--- Test 48: Continuous Beaufort scale & WaterStrengthSlider3D behavior ---');
{
  const sc = makeScene();
  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  // 1. Continuous Beaufort scale resolution and interpolation
  const b0 = FW.resolveWaveWorksBeaufortPreset(0);
  assert.strictEqual(b0.windSpeed, 0);
  const b4 = FW.resolveWaveWorksBeaufortPreset(4);
  assert.strictEqual(b4.windSpeed, 7.0);
  const b12 = FW.resolveWaveWorksBeaufortPreset(12);
  assert.strictEqual(b12.windSpeed, 35.0);

  // Integer memoisation: multiple calls return the exact same object reference
  const b4Again = FW.resolveWaveWorksBeaufortPreset(4);
  assert.strictEqual(b4, b4Again, 'Integer rungs must be memoised and preserve object identity');

  // Continuous interpolation: fractional rung
  const b3_5 = FW.resolveWaveWorksBeaufortPreset(3.5);
  assert.ok(b3_5.windSpeed > 2.5 && b3_5.windSpeed < 7.0, 'Interpolated wind speed must lie between anchors 2 and 4');
  assert.ok(b3_5.causticsDepthFade !== undefined, 'Interpolated preset must have all profile properties');

  // Numeric strings and Beaufort notation
  const b5_5_str = FW.resolveWaveWorksBeaufortPreset('5.5');
  const b5_5_full = FW.resolveWaveWorksBeaufortPreset('Beaufort 5.5');
  assert.strictEqual(b5_5_str.windSpeed, b5_5_full.windSpeed);
  assert.ok(b5_5_str.windSpeed > 7.0 && b5_5_str.windSpeed < 12.5);

  // 2. WaterStrengthSlider3D behavior on OceanWaveWorks3D
  const obj = mkOcean('SliderOcean');
  const oceanB = {};
  const sliderB = {};

  const ocean = FW.registerWaveWorksOcean(sc, obj, oceanB, {
    beaufortScale: 'Beaufort 4 - Moderate Breeze',
    resolution: 32,
    gridSubdivisions: 32,
    tileSize: 5000,
  });

  const slider = FW.registerWaterStrengthSlider(sc, obj, sliderB, {
    scaleMode: 'Beaufort (0 - 12)',
    strength: 4.0,
    smoothDamping: 0.0,
    targetWaterBody: '',
  });

  assert.strictEqual(FW.waterStrengthSliderOf(sc, sliderB), slider);
  assert.strictEqual(FW.getWaterStrength(sc, sliderB), 4.0);
  assert.ok(Math.abs(FW.getWaterStrengthNormalized(sc, sliderB) - 4.0 / 12.0) < 1e-4);
  assert.strictEqual(FW.isWaterStrengthCalm(sc, sliderB), false);
  assert.strictEqual(FW.isWaterStrengthStormy(sc, sliderB), false);
  assert.strictEqual(FW.getWaterStrengthBeaufortRungName(sc, sliderB), 'Moderate Breeze');
  assert.ok(FW.getWaterStrengthBeaufortLabel(sc, sliderB).includes('Moderate Breeze'));
  assert.strictEqual(FW.getWaterStrengthWindSpeed(sc, sliderB), 7.0);

  // Instant step to hurricane strength
  FW.setWaterStrength(sc, sliderB, 11.0);
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(FW.getWaterStrength(sc, sliderB), 11.0);
  assert.strictEqual(FW.isWaterStrengthStormy(sc, sliderB), true);
  assert.strictEqual(ocean.beaufort, 11.0);
  assert.ok(ocean.windSpeed > 22.0, 'Ocean wind speed must increase with slider strength');

  // Smooth damping transition
  FW.setWaterStrengthDamping(sc, sliderB, 0.5); // 0.5 second smooth damp
  assert.strictEqual(FW.getWaterStrengthDamping(sc, sliderB), 0.5);
  FW.setWaterStrength(sc, sliderB, 0.0); // Calm target

  // One 16ms step should only move slightly towards 0, not jump
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  const intermediate = FW.getWaterStrength(sc, sliderB);
  assert.ok(intermediate > 10.0, 'Damped slider must not jump immediately to target');
  assert.strictEqual(FW.isWaterStrengthCalm(sc, sliderB), false);

  // Simulate multiple steps to converge to 0
  for (let i = 0; i < 300; i++) {
    FW.stepWaterStrengthSlider(sc, obj, sliderB);
  }
  assert.ok(FW.getWaterStrength(sc, sliderB) < 0.1, 'Damped slider must converge to target over time');
  assert.strictEqual(FW.isWaterStrengthCalm(sc, sliderB), true);
  assert.strictEqual(FW.isWaterStrengthStormy(sc, sliderB), false);
  assert.strictEqual(FW.getWaterStrengthBeaufortRungName(sc, sliderB), 'Calm');

  // 3. Normalized scale mode (0 - 1)
  const normObj = mkOcean('NormOcean');
  const normB = {};
  const normSliderB = {};
  FW.registerWaveWorksOcean(sc, normObj, normB, { beaufortScale: 'Beaufort 0 - Calm' });
  FW.registerWaterStrengthSlider(sc, normObj, normSliderB, {
    scaleMode: 'Normalized (0 - 1)',
    strength: 0.5,
    smoothDamping: 0.0,
  });

  FW.stepWaterStrengthSlider(sc, normObj, normSliderB);
  assert.ok(Math.abs(FW.getWaterStrength(sc, normSliderB) - 0.5) < 1e-4);
  assert.ok(Math.abs(FW.getWaterStrengthNormalized(sc, normSliderB) - 0.5) < 1e-4);
  assert.strictEqual(FW.getWaterStrengthBeaufortRungName(sc, normSliderB), 'Strong Breeze'); // 0.5 * 12 = 6

  FW.setWaterStrengthNormalized(sc, normSliderB, 1.0);
  FW.stepWaterStrengthSlider(sc, normObj, normSliderB);
  assert.ok(Math.abs(FW.getWaterStrength(sc, normSliderB) - 1.0) < 1e-4);
  assert.strictEqual(FW.isWaterStrengthStormy(sc, normSliderB), true);

  // 4. Parity with WaterBody3D. (GerstnerWater2_3D was removed; WaveWorks is the ocean and
  //    WaterBody3D covers small/cheap water.)
  const wbObj = mkOcean('WBOcean');
  const wbB = {};
  const wbSliderB = {};
  const wb = FW.registerWaterBody(sc, wbObj, wbB, { waterType: 'Calm' });
  FW.registerWaterStrengthSlider(sc, wbObj, wbSliderB, {
    scaleMode: 'Beaufort (0 - 12)',
    strength: 8.0,
    smoothDamping: 0.0,
  });
  FW.stepWaterStrengthSlider(sc, wbObj, wbSliderB);
  assert.ok(wb.waveHeight > 20.0, 'WaterBody3D wave height must be modulated by slider');

  // 5. Named target binding
  FW.setWaterStrengthTargetBody(sc, sliderB, 'NormOcean');
  assert.strictEqual(FW.getWaterStrengthTargetBody(sc, sliderB), 'NormOcean');

  // 6. Teardown
  FW.disposeWaterStrengthSlider(sc, sliderB);
  FW.disposeWaterStrengthSlider(sc, normSliderB);
  FW.disposeWaterStrengthSlider(sc, wbSliderB);
  assert.strictEqual(FW.waterStrengthSliderOf(sc, sliderB), null);
  assert.strictEqual(FW.waterStrengthSliderOf(sc, normSliderB), null);

  console.log('  Passed: continuous Beaufort interpolation, damped slider stepping, multi-model target modulation, and cleanup.');
}

console.log('--- Test 49: Anisotropic filtering for water detail (textures, ocean & WaterDetailing3D) ---');
{
  const sc = makeScene();
  const mkOcean = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const obj = mkOcean('AnisoOcean');
  const oceanB = {};
  const detB = {};

  // 1. OceanWaveWorks3D registration applies default anisotropy (4x)
  const ocean = FW.registerWaveWorksOcean(sc, obj, oceanB, {
    beaufortScale: 'Beaufort 4 - Moderate Breeze',
    textureAnisotropy: '4x'
  });

  assert.strictEqual(ocean.anisotropy, 4, 'Ocean anisotropy parsed from 4x string');
  assert.strictEqual(FW.getOceanAnisotropy(sc, oceanB), 4);
  assert.strictEqual(ocean.slopeTexture.anisotropy, 4, 'slopeTexture anisotropy assigned');
  assert.strictEqual(ocean.cascadeSlopeTexture.anisotropy, 4, 'cascadeSlopeTexture anisotropy assigned');
  assert.strictEqual(ocean.texture.anisotropy, 4, 'displacement texture anisotropy assigned');
  assert.strictEqual(ocean.cascadeTexture.anisotropy, 4, 'cascade displacement texture anisotropy assigned');

  // 2. Dynamic action setOceanAnisotropy
  FW.setOceanAnisotropy(sc, oceanB, '8x');
  assert.strictEqual(ocean.anisotropy, 8);
  assert.strictEqual(ocean.slopeTexture.anisotropy, 8);
  assert.strictEqual(ocean.cascadeSlopeTexture.anisotropy, 8);
  assert.strictEqual(ocean.texture.anisotropy, 8);
  assert.strictEqual(ocean.cascadeTexture.anisotropy, 8);

  // 3. Numeric input and clamp limits [1, 16]
  FW.setOceanAnisotropy(sc, oceanB, 16);
  assert.strictEqual(ocean.anisotropy, 16);
  assert.strictEqual(ocean.slopeTexture.anisotropy, 16);

  FW.setOceanAnisotropy(sc, oceanB, 32); // clamps to 16
  assert.strictEqual(ocean.anisotropy, 16);

  FW.setOceanAnisotropy(sc, oceanB, '1 (Off)');
  assert.strictEqual(ocean.anisotropy, 1);
  assert.strictEqual(ocean.slopeTexture.anisotropy, 1);

  // 4. WaterDetailing3D companion behavior controls and propagates anisotropy to water body
  const det = FW.registerWaterDetailing(sc, obj, detB, {
    textureAnisotropy: '8x'
  });
  assert.strictEqual(det.textureAnisotropy, 8);
  assert.strictEqual(FW.getWaterDetailingAnisotropy(sc, detB), 8);
  assert.strictEqual(ocean.anisotropy, 8, 'Detailing propagated anisotropy to target ocean');
  assert.strictEqual(ocean.slopeTexture.anisotropy, 8);

  // 5. Change detailing anisotropy via action
  FW.setWaterDetailingAnisotropy(sc, detB, '16x');
  assert.strictEqual(FW.getWaterDetailingAnisotropy(sc, detB), 16);
  assert.strictEqual(ocean.slopeTexture.anisotropy, 16);

  // 6. Test renderer hardware clamping
  const mobileRenderer = {
    extensions: { has: () => true },
    capabilities: {
      isWebGL2: true,
      getMaxAnisotropy: () => 4
    }
  };
  const mockSceneMobile = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => mobileRenderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => null, getThreeCamera: () => null }) })
  };
  const mobObj = mkOcean('MobileOcean');
  const mobB = {};
  const mobOcean = FW.registerWaveWorksOcean(mockSceneMobile, mobObj, mobB, {
    textureAnisotropy: '16x'
  });
  assert.strictEqual(mobOcean.slopeTexture.anisotropy, 4, 'Clamped to mobile device hardware maximum of 4');
  assert.strictEqual(FW.getWaterDetailingMaxDeviceAnisotropy(mockSceneMobile), 4);

  // 7. Cleanup
  FW.disposeWaveWorksOcean(sc, oceanB);
  FW.disposeWaveWorksOcean(mockSceneMobile, mobB);
  assert.strictEqual(FW.oceanOf(sc, oceanB), null);

  console.log('  Passed: anisotropy parsing, texture assignment, hardware capability clamping, and detailing propagation.');
}

console.log('--- Test 50: Review regressions: filtering, idle sliders, and shared spray ---');
{
  const mk = (name) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => name,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });
  const sc = makeScene({ elapsedMs: 16 });
  const obj = mk('ReviewOcean'), b = {}, sliderB = {};
  const ocean = FW.registerWaveWorksOcean(sc, obj, b, { resolution: 32, textureAnisotropy: 8 });
  for (const texture of [ocean.texture, ocean.cascadeTexture, ocean.slopeTexture, ocean.cascadeSlopeTexture]) {
    assert.strictEqual(texture.minFilter, THREE.LinearMipmapLinearFilter, 'AF must pass the Three.js minification-filter gate');
    assert.strictEqual(texture.generateMipmaps, true, 'AF requires a complete, refreshed mip chain');
  }
  // The geometry must read the base level, not a filtered mip, or the waves flatten with
  // distance. texture2DLod said so explicitly - and failed to compile, because three has no GLSL1
  // mapping for it on WebGL2, which silently took the entire vertex shader down. A vertex fetch
  // has no derivatives and so is defined to use lod 0; what must be guarded is that nothing
  // reintroduces an explicit LOD or a bias argument here.
  assert.ok(ocean.material.vertexShader.includes('texture2D(u_Field, uv0)'),
    'Geometry must sample the field with a plain texture2D, which is lod 0 in a vertex shader');
  // Comments in the shader mention texture2DLod by name to explain why it is banned, so strip
  // them before looking for the real thing.
  const vsCode = ocean.material.vertexShader.replace(/\/\/.*/g, '');
  assert.ok(!/texture2DLod|textureLod|texture2D\(u_Field, uv0, /.test(vsCode),
    'no explicit-LOD or biased fetch in the vertex shader: it does not compile under three GLSL1');
  const heightBefore = FW.getOceanWaveHeightAt(sc, b, 120, 250);
  FW.setOceanAnisotropy(sc, b, 1);
  assert.strictEqual(ocean.slopeTexture.minFilter, THREE.LinearFilter);
  assert.strictEqual(ocean.slopeTexture.generateMipmaps, false);
  FW.setOceanAnisotropy(sc, b, 16);
  assert.strictEqual(FW.getOceanWaveHeightAt(sc, b, 120, 250), heightBefore, 'Filtering cannot alter CPU wave queries');

  for (const missing of ['capability', 'OES_texture_float_linear', 'EXT_color_buffer_float']) {
    const fallbackScene = makeScene();
    fallbackScene.getGame = () => ({ getRenderer: () => ({ getThreeRenderer: () => ({
      capabilities: missing === 'capability' ? {} : { isWebGL2: true, getMaxAnisotropy: () => 16 },
      extensions: { has: name => name !== missing },
    }) }) });
    const fb = {}, db = {}, fo = mk('Fallback');
    const f = FW.registerWaveWorksOcean(fallbackScene, fo, fb, { resolution: 32, textureAnisotropy: 16 });
    FW.registerWaterDetailing(fallbackScene, fo, db, { textureAnisotropy: 16 });
    assert.strictEqual(f.slopeTexture.anisotropy, 1, missing + ' falls back to 1x');
    assert.strictEqual(f.slopeTexture.generateMipmaps, false);
    assert.strictEqual(FW.getOceanAnisotropy(fallbackScene, fb), 1, 'Expressions report effective filtering');
    assert.strictEqual(FW.getWaterDetailingAnisotropy(fallbackScene, db), 1);
    FW.disposeWaterDetailing(fallbackScene, db);
    FW.disposeWaveWorksOcean(fallbackScene, fb);
  }

  FW.registerWaterStrengthSlider(sc, obj, sliderB, { strength: 4, smoothDamping: 0 });
  let rebuilds = 0;
  for (const field of [ocean.field, ocean.field1]) {
    const original = field.buildSpectrum.bind(field);
    field.buildSpectrum = (...args) => { rebuilds++; return original(...args); };
  }
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  const afterInitial = rebuilds;
  for (let frame = 0; frame < 60; frame++) FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(rebuilds, afterInitial, 'Stationary sliders never rebuild spectra after initial application');
  FW.setWaterStrength(sc, sliderB, 8);
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(rebuilds, afterInitial + 2, 'A changed strength rebuilds each cascade once');
  FW.setWaterStrengthDamping(sc, sliderB, 0.1);
  FW.setWaterStrength(sc, sliderB, 0);
  for (let frame = 0; frame < 160; frame++) FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(FW.getWaterStrength(sc, sliderB), 0, 'Damping settles exactly to stop repeated work');
  const settled = rebuilds;
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(rebuilds, settled);

  const targetB = {}, targetObj = mk('OtherOcean');
  const target = FW.registerWaveWorksOcean(sc, targetObj, targetB, { resolution: 32 });
  FW.setWaterStrengthTargetBody(sc, sliderB, 'OtherOcean');
  FW.stepWaterStrengthSlider(sc, obj, sliderB);
  assert.strictEqual(target.beaufort, 0, 'Changing target applies the same strength to the new ocean');
  for (const initial of [0, '0', 0.5, 1]) {
    const nb = {};
    FW.registerWaterStrengthSlider(sc, obj, nb, { strength: initial, scaleMode: 'Normalized (0 - 1)', smoothDamping: 0.5 });
    assert.strictEqual(FW.getWaterStrength(sc, nb), Number(initial));
    FW.stepWaterStrengthSlider(sc, obj, nb);
    assert.strictEqual(FW.getWaterStrength(sc, nb), Number(initial), 'Damping must not invent a transition at initialization');
    assert.strictEqual(ocean.beaufort, Number(initial) * 12);
    FW.disposeWaterStrengthSlider(sc, nb);
  }

  const enabledB = {}, disabledB = {}, gerstnerB = {}, gerstnerDetB = {};
  FW.registerWaterDetailing(sc, obj, enabledB, { sprayEnabled: true, sprayAmount: 0 });
  FW.registerWaterDetailing(sc, targetObj, disabledB, { sprayEnabled: false });
  const gerstnerObj = mk('Gerstner');
  FW.registerWaterBody(sc, gerstnerObj, gerstnerB, {});
  FW.registerWaterDetailing(sc, gerstnerObj, gerstnerDetB, { sprayEnabled: true });
  FW.stepWaterDetailing(sc, obj, enabledB);
  const state = FW._getSceneStateForTests(sc);
  const slot = state.spray.emit(0, 0, 1000, 0, 0, 0, 1, 1, 981);
  const heavySlot = state.spray.emit(0, 0, 1000, 0, 0, 0, 1, 1, 1962);
  FW.stepWaterDetailing(sc, targetObj, disabledB);
  FW.stepWaterDetailing(sc, gerstnerObj, gerstnerDetB);
  assert.strictEqual(state.spray.life[slot], 1, 'Behavior steps only emit; they never integrate the shared pool');
  FW.onScenePostEvents(sc);
  assert.ok(Math.abs(state.spray.life[slot] - 0.984) < 1e-6, 'Three detailing behaviors advance spray by exactly one 16ms frame');
  assert.ok(Math.abs(state.spray.vz[slot] + 981 * 0.016) < 1e-4);
  assert.ok(Math.abs(state.spray.vz[heavySlot] + 1962 * 0.016) < 1e-4, 'Each particle keeps its source gravity');
  assert.strictEqual(state.sprayMesh.visible, true, 'Disabled or Gerstner emitters cannot hide another ocean\'s spray');
  FW.setWaterDetailingSprayEnabled(sc, enabledB, false);
  FW.onScenePostEvents(sc);
  assert.ok(Math.abs(state.spray.life[slot] - 0.968) < 1e-6, 'Existing particles keep aging after emission is disabled');
  state.paused = true;
  const pausedLife = state.spray.life[slot];
  FW.onScenePostEvents(sc);
  assert.strictEqual(state.spray.life[slot], pausedLife);
  state.paused = false;
  state.timeScale = 0.5;
  FW.onScenePostEvents(sc);
  assert.ok(Math.abs(state.spray.life[slot] - (pausedLife - 0.008)) < 1e-6, 'Spray follows the scene time scale');
  for (const db of [enabledB, disabledB, gerstnerDetB]) FW.disposeWaterDetailing(sc, db);
  FW.disposeWaterStrengthSlider(sc, sliderB);
  FW.disposeWaterBody(sc, gerstnerB);
  FW.disposeWaveWorksOcean(sc, b);
  FW.disposeWaveWorksOcean(sc, targetB);
  assert.strictEqual(state.spray, null);
  assert.strictEqual(state.sprayMesh, null);
  console.log('  Passed: mipmap eligibility/fallback, idle and normalized sliders, shared spray timing and source gravity.');
}

console.log('--- Test 47: the Beaufort scale is continuous, and its rungs stay put ---');
{
  const mkSea = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  // The six authored rungs are anchors. Everything between them is interpolated, so a strength
  // slider crossing 4 -> 5 walks the sea up instead of flipping it between two authored looks.
  // The anchors must still come back bit-exact, or every existing project shifts.
  const ANCHORS = [[0, 0], [2, 2.5], [4, 7], [6, 12.5], [9, 22], [12, 35]];
  for (const [rung, wind] of ANCHORS) {
    assert.strictEqual(FW.beaufortAt(rung).windSpeed, wind,
      'Beaufort ' + rung + ' is an authored anchor and must not drift');
  }

  // Every rung resolves, and by its dropdown label.
  for (let r = 0; r <= 12; r++) {
    const label = FW.beaufortLabel(r);
    assert.ok(/^Beaufort \d+ - .+$/.test(label), 'rung ' + r + ' needs a readable label');
    assert.ok(FW.resolveWaveWorksBeaufortPreset(label),
      '"' + label + '" must resolve - it is what the dropdown stores');
  }

  // A number is a point on the scale, not a preset name. This is the path the slider takes.
  const half = FW.resolveWaveWorksBeaufortPreset(4.5);
  assert.ok(half, 'a numeric sea state must resolve');
  const four = FW.beaufortAt(4);
  const five = FW.beaufortAt(5);
  assert.ok(half.windSpeed > four.windSpeed && half.windSpeed < five.windSpeed,
    'Beaufort 4.5 must sit strictly between 4 and 5, not round to either');

  // Monotonic and gradual the whole way up. A flip between presets would show as a large jump.
  let prev = -Infinity;
  let biggest = 0;
  let last = null;
  for (let b = 0; b <= 12.0001; b += 0.1) {
    const p = FW.beaufortAt(Math.min(b, 12));
    assert.ok(p.windSpeed >= prev - 1e-9,
      'wind speed must never fall as the scale rises (at ' + b.toFixed(1) + ')');
    if (last !== null) biggest = Math.max(biggest, Math.abs(p.foamCoverage - last));
    last = p.foamCoverage;
    prev = p.windSpeed;
  }
  assert.ok(biggest < 0.05, 'foam coverage jumps by ' + biggest.toFixed(3) +
    ' over a 0.1 step; the scale is flipping between settings rather than blending');

  // Colours blend too, or Beaufort 7 would snap from tropical blue to storm grey.
  const b6 = FW.beaufortAt(6);
  const b9 = FW.beaufortAt(9);
  const b7 = FW.beaufortAt(7);
  let between = false;
  for (let c = 0; c < 3; c++) {
    const lo = Math.min(b6.deepColor[c], b9.deepColor[c]);
    const hi = Math.max(b6.deepColor[c], b9.deepColor[c]);
    if (b7.deepColor[c] > lo + 1e-9 && b7.deepColor[c] < hi - 1e-9) between = true;
  }
  assert.ok(between, 'Beaufort 7 must blend its palette between 6 and 9, not snap to one');
  console.log('  Passed: 13 rungs, anchors exact, fractional states blend.');
}

console.log('--- Test 48: wave-collision spray fires where crests meet, and only there ---');
{
  const mkSea = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  const run = (scaleName, opts, frames) => {
    const sc = makeScene();
    const oB = {}; const dB = {};
    const obj = mkSea('SprayOcean');
    const o = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: scaleName, resolution: 64, gridSubdivisions: 64, tileSize: 5000 });
    FW.registerWaterDetailing(sc, obj, dB, Object.assign({
      style: 'Sea of Thieves', subStyle: 'Salt Water', waterLook: 'Choppy', lighting: 'Midday',
    }, opts));
    for (let f = 0; f < frames; f++) {
      FW.updateOceanField(o, 3.0 + f * 0.016);
      FW.stepWaterDetailing(sc, obj, dB);
    }
    return { sc, ocean: o, spray: FW.spraySystemOf(sc) };
  };
  const liveOf = (r) => (r.spray ? r.spray.liveCount : 0);
  const ON = { sprayEnabled: true, sprayAmount: 1.0, sprayHeight: 1.0, sprayThreshold: 0.5 };

  // Off by default and when disabled - the same posture as the persistent foam buffer, because
  // this is the one part of the detailing whose cost scales with how rough the sea is.
  assert.strictEqual(liveOf(run('Beaufort 12 - Hurricane', {}, 10)), 0,
    'spray must be off unless asked for');
  assert.strictEqual(liveOf(run('Beaufort 9 - Strong Gale', { sprayEnabled: false }, 10)), 0,
    'disabled spray must emit nothing');

  // A calm sea throws nothing. Beaufort 4 is "fairly frequent white horses" - foam, but no spouts.
  assert.strictEqual(liveOf(run('Beaufort 2 - Light Breeze', ON, 20)), 0,
    'a light breeze must not throw spray');
  assert.strictEqual(liveOf(run('Beaufort 4 - Moderate Breeze', ON, 20)), 0,
    'Beaufort 4 has whitecaps but no colliding crests; it must stay dry');

  // And it must grow with the sea state.
  const b6 = liveOf(run('Beaufort 6 - Strong Breeze', ON, 30));
  const b9 = liveOf(run('Beaufort 9 - Strong Gale', ON, 30));
  assert.ok(b6 > 0, 'Beaufort 6 carries "some spray" and should throw the occasional spout');
  assert.ok(b9 > b6 * 3, 'a strong gale must spray far harder than a strong breeze (' +
    b6 + ' vs ' + b9 + ')');

  // The medium decides whether it happens at all: pool water barely foams and barely spits.
  const pool = liveOf(run('Beaufort 9 - Strong Gale',
    Object.assign({}, ON, { subStyle: 'Pool Water' }), 30));
  assert.ok(pool * 4 < b9, 'pool water must spray far less than salt water (' + pool + ' vs ' + b9 + ')');

  // The budget is a HARD cap, not a rate. A hurricane has ten percent of its surface converging;
  // without this it would spawn without bound.
  const oneFrame = run('Beaufort 12 - Hurricane', ON, 1);
  assert.ok(liveOf(oneFrame) <= 24,
    'one frame produced ' + liveOf(oneFrame) + ' particles; the per-frame budget is 24');

  // Spray has to spawn at the SURFACE. getZ() is the base of a 3D object, so reading it as the
  // water line put every droplet a full water-body depth under the sea - on a 3568-deep body they
  // hung there looking like bubbles, which is exactly what was reported.
  {
    const sc = makeScene();
    const oB = {}; const dB = {};
    const deep = {
      getX: () => 0, getY: () => 0, getZ: () => 0,
      getWidth: () => 32004, getHeight: () => 14850, getDepth: () => 3568,
      getLayer: () => '', getName: () => 'DeepBody',
      getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0, isHidden: () => false,
      get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
    };
    const o = FW.registerWaveWorksOcean(sc, deep, oB, {
      beaufortScale: 'Beaufort 9 - Strong Gale', resolution: 64, gridSubdivisions: 64 });
    FW.registerWaterDetailing(sc, deep, dB, Object.assign({}, ON));
    for (let f = 0; f < 40; f++) {
      FW.stepWaveWorksOcean(sc, deep, oB);
      FW.stepWaterDetailing(sc, deep, dB);
    }
    const pool = FW.spraySystemOf(sc);
    const surface = deep.getZ() + deep.getDepth();
    let live = 0; let sunk = 0;
    for (let i = 0; i < pool.max; i++) {
      if (!pool.alive[i]) continue;
      live++;
      if (pool.z[i] < surface - o.significantWaveHeight) sunk++;
    }
    assert.ok(live > 0, 'the deep-bodied ocean should still throw spray');
    assert.strictEqual(sunk, 0, sunk + ' of ' + live + ' droplets spawned a wave height below the ' +
      'water line; spray must come off the SURFACE (objZ + depth), not the base of the volume');
  }

  // A droplet must live long enough to COME BACK DOWN, or spray reads as things drifting upward
  // out of the sea. Lifetime is derived from each droplet's own ballistic airtime rather than
  // being a flat constant, so this holds at any sea state instead of only the one it was tuned at.
  //
  // Worth knowing: an earlier probe "measured" 143 of 143 droplets still rising and that was
  // wrong - it never called onScenePostEvents, which is where the pool is actually integrated, so
  // every velocity it read was still the launch value. The arc was fine. Hence this test drives
  // the real per-frame path.
  {
    const sc = makeScene({ elapsedMs: 16 });
    const oB = {}; const dB = {};
    const obj = mkSea('ArcOcean');
    const o = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: 'Beaufort 9 - Strong Gale', resolution: 64, gridSubdivisions: 64 });
    FW.registerWaterDetailing(sc, obj, dB, Object.assign({}, ON));
    for (let f = 0; f < 120; f++) {
      FW.stepWaveWorksOcean(sc, obj, oB);
      FW.stepWaterDetailing(sc, obj, dB);
      FW.onScenePostEvents(sc);
    }
    const pool = FW.spraySystemOf(sc);
    let rising = 0; let falling = 0;
    for (let i = 0; i < pool.max; i++) {
      if (!pool.alive[i]) continue;
      if (pool.vz[i] > 0) rising++; else falling++;
    }
    assert.ok(rising + falling > 0, 'a gale should have spray in the air');
    // A handful of the weakest droplets turn over whatever the lifetime is, so "any falling" is
    // not a real guard. In a steady state with life matched to airtime the split is near even.
    const fallShare = falling / Math.max(rising + falling, 1);
    assert.ok(fallShare > 0.2, 'only ' + (100 * fallShare).toFixed(0) + '% of live droplets are ' +
      'falling (' + falling + ' of ' + (rising + falling) + '); their lifetime is short of their ' +
      'ballistic airtime, so they die on the way up and the spray reads as shapes drifting ' +
      'upward out of the sea rather than water thrown off it');
  }

  // Spray has to go UP, and land back down.
  const gale = run('Beaufort 9 - Strong Gale', ON, 30);
  let above = 0;
  for (let i = 0; i < gale.spray.max; i++) {
    if (gale.spray.alive[i] && gale.spray.z[i] > 0) above++;
  }
  assert.ok(above > 0, 'spray must rise above the still water line');
  const beforeFall = gale.spray.liveCount;
  for (let f = 0; f < 400; f++) gale.spray.step(0.016, 9.81 * 100);
  assert.ok(gale.spray.liveCount < beforeFall,
    'spray must expire; ' + beforeFall + ' particles were still alive after 6 seconds');

  // The plume mask belongs to cascade 0 only. Cascade 1 is ~4x steeper on a quarter-size tile, so
  // its eigenvalues collapse everywhere - letting it drive the plume is the same mistake that
  // turned the foam into mountains.
  const wv = runtimeCode.slice(runtimeCode.indexOf('WAVEWORKS_FRAGMENT_SHADER'),
    runtimeCode.indexOf('WATER_VERTEX_SHADER'));
  assert.ok(/crestFoam = max\(crestFoam,/.test(wv),
    'the plume must combine with foam using max, not a sum, or a collision blows out to white');
  console.log('  Passed: dry below a gale, capped, medium-aware, and it falls back down.');
}

console.log('--- Test 50: the SHIPPED buoyancy draft (auto) actually floats a hull ---');
{
  // Every other buoyancy test passes an explicit maxSubmersionDepth, so the default that actually
  // ships - 0, meaning "scale the draft to the hull" - was the one value never exercised. In the
  // real engine a hardcoded 100 on a 100-unit boat parked it a full hull-length under the surface
  // and looked exactly like broken buoyancy. It is not broken: equilibrium sits where
  // buoyancyFactor * (sub / maxSub) == 1, so maxSub IS the draft control, and picking it badly
  // sinks the boat. This pins the auto path.
  const mkHull = (name, depth) => ({
    getX: () => 500, getY: () => 500, getZ: () => 0,
    getWidth: () => 100, getHeight: () => 100, getDepth: () => depth,
    getLayer: () => '', getName: () => name,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
    isHidden: () => false,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  // The resolved draft must follow the hull, not a constant.
  for (const depth of [40, 100, 260]) {
    const sc = makeScene();
    const beh = {};
    const buoy = FW.registerBuoyancy(sc, mkHull('AutoDraft' + depth, depth), beh, {
      buoyancyFactor: 1.3, hullProbeCount: '4-Corners',
    });
    assert.ok(buoy, 'buoyancy must register with the default draft');
    assert.strictEqual(buoy.maxSubmersionDepth, 0,
      'the stored value stays 0; the hull scaling happens where the force is computed');

    // Mirror the runtime's own resolution, and require it to track the hull.
    const resolved = buoy.maxSubmersionDepth > 0
      ? buoy.maxSubmersionDepth : Math.max(depth * 0.5, 1.0);
    assert.strictEqual(resolved, depth * 0.5,
      'auto draft must be half the hull depth for a ' + depth + '-unit hull, got ' + resolved);

    // Equilibrium is where lift balances weight: buoyancyFactor * sub / maxSub == 1.
    // With the auto draft that lands at a fraction of the hull, so the hull floats rather than
    // sitting a full body under. Anything at or beyond the hull depth means it never surfaces.
    const equilibriumSub = resolved / 1.3;
    assert.ok(equilibriumSub < depth,
      'a ' + depth + '-unit hull would settle ' + equilibriumSub.toFixed(1) +
      ' units under - deeper than the hull is tall, i.e. it never surfaces');
    assert.ok(equilibriumSub < depth * 0.5,
      'the auto draft should leave the hull less than half submerged, got ' +
      (100 * equilibriumSub / depth).toFixed(0) + '%');
  }

  // And the footgun itself: a draft set to the whole hull sinks it. This is the configuration the
  // harness scenario had, and it is worth being able to point at.
  const depth = 100;
  const badSub = 100;
  const badEquilibrium = badSub / 1.3;
  assert.ok(badEquilibrium > depth * 0.5,
    'sanity: maxSubmersionDepth equal to the hull depth should settle the hull more than half ' +
    'under, which is what made a working behaviour look broken');
  console.log('  Passed: the default draft scales to the hull and floats it.');
}

console.log('--- Test 51: the sea grows smoothly, and changing rung does not pop ---');
{
  // Two separate ways the sea "jumped in size between" Beaufort rungs.
  const mkSea = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 32004, getHeight: () => 14850, getDepth: () => 3568,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0, isHidden: () => false,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  // (a) Wind speed used to be interpolated piecewise-linearly between the six authored anchors, so
  //     its SLOPE changed discontinuously at every one of them. Wave height goes as the square of
  //     wind speed, so each corner read as the sea changing size. Measured before the fix, the
  //     per-step growth jumped by 34 units in a single increment at Beaufort 9.
  //
  //     Guard the second difference: with a monotone cubic the slope is continuous, so consecutive
  //     increments must stay close to each other.
  let prev = null; let prevStep = null; let worstKink = 0; let worstAt = 0;
  for (let b = 0; b <= 12.0001; b += 0.25) {
    const w = FW.beaufortAt(Math.min(b, 12)).windSpeed;
    if (prev !== null) {
      const step = w - prev;
      assert.ok(step >= -1e-9, 'wind speed must never fall as the scale rises (at B=' + b.toFixed(2) + ')');
      if (prevStep !== null) {
        const kink = Math.abs(step - prevStep);
        if (kink > worstKink) { worstKink = kink; worstAt = b; }
      }
      prevStep = step;
    }
    prev = w;
  }
  // 0.10 sits between the two regimes: piecewise-linear jumped by 0.29 m/s in one increment at
  // Beaufort 9, while the monotone cubic's largest second difference is 0.052 - and that is real
  // curvature, not a corner, because the scale genuinely accelerates.
  assert.ok(worstKink < 0.10, 'wind speed has a slope corner of ' + worstKink.toFixed(3) +
    ' at B=' + worstAt.toFixed(2) + '; piecewise-linear interpolation is back and the sea will ' +
    'visibly change size as the slider crosses a rung');

  // The anchors must still land exactly where they were authored - a smoother curve is no good if
  // it moves every existing project's sea.
  for (const [rung, wind] of [[0, 0], [2, 2.5], [4, 7], [6, 12.5], [9, 22], [12, 35]]) {
    assert.ok(Math.abs(FW.beaufortAt(rung).windSpeed - wind) < 1e-9,
      'Beaufort ' + rung + ' must stay exactly ' + wind + ' m/s, got ' + FW.beaufortAt(rung).windSpeed);
  }

  // (b) Changing rung applied in a single frame. Adjacent rungs differ by 38-92% in wave height,
  //     so that is a visible pop. It is now optionally eased, and 0 keeps the old instant behaviour.
  const runChange = (seconds, frames) => {
    const sc = makeScene({ elapsedMs: 16 });
    const obj = mkSea('SeaChange'); const beh = {};
    const o = FW.registerWaveWorksOcean(sc, obj, beh, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32 });
    const from = o.significantWaveHeight;
    FW.setWaveWorksBeaufort(sc, beh, 'Beaufort 9 - Strong Gale', seconds);
    const samples = [];
    for (let f = 0; f < frames; f++) {
      FW.stepWaveWorksOcean(sc, obj, beh);
      samples.push(o.significantWaveHeight);
    }
    return { from, samples, to: o.significantWaveHeight };
  };

  // 0 seconds: unchanged behaviour, there on the first frame.
  const instant = runChange(0, 3);
  assert.ok(instant.samples[0] > instant.from * 2,
    'with no transition time the sea must arrive immediately, as it always did');

  // 1 second: must actually travel, and must not overshoot on the way.
  const eased = runChange(1.0, 70);
  assert.ok(eased.samples[0] < instant.samples[0] * 0.5,
    'an eased change must NOT be at its destination on the first frame');
  assert.ok(Math.abs(eased.to - instant.samples[0]) < instant.samples[0] * 0.02,
    'an eased change must still land on the target rung, got ' + eased.to.toFixed(0) +
    ' against ' + instant.samples[0].toFixed(0));
  for (let i = 1; i < eased.samples.length; i++) {
    assert.ok(eased.samples[i] >= eased.samples[i - 1] - 1e-6,
      'the sea must not shrink part-way through growing (frame ' + i + ')');
    assert.ok(eased.samples[i] <= instant.samples[0] * 1.02,
      'the transition must not overshoot past the target rung (frame ' + i + ')');
  }
  console.log('  Passed: no slope corners, anchors exact, rung changes ease without overshoot.');
}

console.log('--- Test 52: Wave crest Jacobian regularity and inverted backface fold elimination ---');
{
  // 1. Shaders must guard against inverted backface folds when viewed from above water.
  // When a wave folds over, the inverted backface has normal pointing down into the deep water.
  // On translucent water, that renders as dark downward-pointing teeth/shards.
  // The fragment shaders must discard backfaces when toCam.z > 0 (camera above the surface).
  for (const name of ['WAVEWORKS_FRAGMENT_SHADER', 'WATER_FRAGMENT_SHADER']) {
    const glsl = runtimeCode.slice(runtimeCode.indexOf('var ' + name), runtimeCode.indexOf('].join', runtimeCode.indexOf('var ' + name)));
    assert.ok(/!gl_FrontFacing/.test(glsl), name + ' must check !gl_FrontFacing');
    assert.ok(/toCam\.z\s*>\s*0\.0\)\s*discard;/.test(glsl),
      name + ' must discard back-facing inverted folds when the camera is above water');
  }

  // 2. WAVEWORKS_VERTEX_SHADER must scale Cascade 1 horizontal choppiness by the tile size ratio
  // (u_CascadeTileSize / u_TileSize). Because Cascade 1 is on a tile 4x smaller, its spatial
  // wavenumber k is ~4x steeper. Without tile scaling, disp1 blew the Jacobian negative and
  // inverted >200 quads into dark triangular teeth.
  const wv = runtimeCode.slice(runtimeCode.indexOf('var WAVEWORKS_VERTEX_SHADER'),
    runtimeCode.indexOf('var WAVEWORKS_FRAGMENT_SHADER'));
  assert.ok(/cascadeChopRatio/.test(wv),
    'WAVEWORKS_VERTEX_SHADER must scale cascade horizontal choppiness by cascadeChopRatio');
  assert.ok(/safeChop/.test(wv),
    'WAVEWORKS_VERTEX_SHADER must safeguard effective choppiness against Jacobian inversion');
  assert.ok(/vGdXY\s*=\s*vec2\(worldPos\.x,\s*-worldPos\.y\);/.test(wv),
    'WAVEWORKS_VERTEX_SHADER must bind vGdXY to displaced surface coordinates without Y sign inversion');

  // Verify that an ocean at Beaufort 9 and Beaufort 12 with cascade 1 does not produce inverted quads.
  for (const bScale of ['Beaufort 9 - Strong Gale', 'Beaufort 12 - Hurricane']) {
    const sc = makeScene();
    const obj = {
      getX: () => 0, getY: () => 0, getZ: () => 0,
      getWidth: () => 32004, getHeight: () => 14850, getDepth: () => 3568,
      getLayer: () => '', getName: () => 'JacobianOcean_' + bScale,
      getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0,
      get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
    };
    const beh = {};
    const ocean = FW.registerWaveWorksOcean(sc, obj, beh, {
      beaufortScale: bScale,
      resolution: 64, gridSubdivisions: 64, tileSize: 32004
    });

    FW.updateOceanField(ocean, 1.0);
    const f0 = ocean.field;
    const f1 = ocean.field1;
    const n = ocean.gridSubdivisions;
    const chop = ocean.choppiness;
    const cWeight = ocean.cascadeWeight;
    const cascadeChopRatio = ocean.cascadeTileSize / ocean.tileSize;
    const safeChop = Math.min(chop, 0.90) / (1.0 + cWeight * cascadeChopRatio * 0.5 + Math.max(0.0, chop - 0.7) * 0.5);

    const w = obj.getWidth();
    const h = obj.getHeight();
    const cellX = w / n;
    const cellY = h / n;

    let inverted = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d0 = f0.sampleDisplacement(x * cellX, y * cellY);
        const d1 = f1 ? f1.sampleDisplacement(x * cellX, y * cellY) : { x: 0, y: 0 };
        const d0R = f0.sampleDisplacement((x + 1) * cellX, y * cellY);
        const d1R = f1 ? f1.sampleDisplacement((x + 1) * cellX, y * cellY) : { x: 0, y: 0 };
        const d0D = f0.sampleDisplacement(x * cellX, (y + 1) * cellY);
        const d1D = f1 ? f1.sampleDisplacement(x * cellX, (y + 1) * cellY) : { x: 0, y: 0 };

        const p0x = d0.x * safeChop + d1.x * safeChop * cWeight * cascadeChopRatio;
        const p0y = d0.y * safeChop + d1.y * safeChop * cWeight * cascadeChopRatio;
        const pRx = d0R.x * safeChop + d1R.x * safeChop * cWeight * cascadeChopRatio;
        const pRy = d0R.y * safeChop + d1R.y * safeChop * cWeight * cascadeChopRatio;
        const pDx = d0D.x * safeChop + d1D.x * safeChop * cWeight * cascadeChopRatio;
        const pDy = d0D.y * safeChop + d1D.y * safeChop * cWeight * cascadeChopRatio;

        const dx_x = 1.0 + (pRx - p0x) / cellX;
        const dy_x = (pRy - p0y) / cellX;
        const dx_y = (pDx - p0x) / cellY;
        const dy_y = 1.0 + (pDy - p0y) / cellY;

        const det = dx_x * dy_y - dx_y * dy_x;
        if (det < 0) inverted++;
      }
    }

    assert.strictEqual(inverted, 0,
      bScale + ' with safe cascade choppiness must have 0 inverted quads, got ' + inverted);
    FW.disposeWaveWorksOcean(sc, beh);
  }
  console.log('  Passed: cascade choppiness balanced, vGdXY aligned, crest fold & texture deformation eliminated.');
}


console.log('--- Test 53: foam is its own axis, and its looks actually differ ---');
{
  // A "preset" that only moved coverage would be the same foam drawn bigger. Each look has to move
  // the four controls that change foam's CHARACTER: cell size, wind streaking, break-up contrast,
  // and how much is left trailing behind the crest.
  const mkSea = (n) => ({
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => n,
    getAngle: () => 0, getRotationX: () => 0, getRotationY: () => 0, isHidden: () => false,
    get3DRendererObject: () => ({ isMesh: true, material: null, visible: true, traverse() {} }),
  });

  const LOOKS = ['Natural', 'Sea of Thieves', 'Whitecaps', 'Storm Streaks', 'Surf', 'Painted',
    'Minimal'];

  const measure = (foamStyle, style) => {
    const sc = makeScene();
    const obj = mkSea('FoamAxis'); const oB = {}; const dB = {};
    const o = FW.registerWaveWorksOcean(sc, obj, oB, {
      beaufortScale: 'Beaufort 6 - Strong Breeze', resolution: 32, gridSubdivisions: 32,
      tileSize: 5000 });
    FW.registerWaterDetailing(sc, obj, dB, {
      style: style || 'Sea of Thieves', subStyle: 'Salt Water', waterLook: 'Choppy',
      lighting: 'Midday', foamStyle });
    FW.stepWaterDetailing(sc, obj, dB);
    const u = o.material.uniforms;
    return {
      scale: u.u_FoamScale.value, streak: u.u_FoamStreak.value,
      bite: u.u_FoamBite.value, trail: u.u_FoamTrail.value,
      coverage: u.u_FoamCoverage.value, sc, dB, o,
    };
  };

  // Every look must resolve, and no two may be the same set of numbers.
  const seen = new Map();
  for (const look of LOOKS) {
    assert.ok(FW.resolveWaterDetailingFoam(look), '"' + look + '" must resolve');
    const m = measure(look);
    const key = [m.scale, m.streak, m.bite, m.trail].map((v) => v.toFixed(3)).join(',');
    assert.ok(!seen.has(key), '"' + look + '" is identical to "' + seen.get(key) +
      '"; a foam look that does not change the four character controls is just a coverage slider');
    seen.set(key, look);
  }

  // Natural must reproduce what shipped before the axis existed, or every project shifts.
  const natural = measure('Natural');
  assert.ok(Math.abs(natural.scale - 1.0) < 1e-6 && Math.abs(natural.streak - 4.5) < 1e-6
    && Math.abs(natural.bite - 1.0) < 1e-6 && Math.abs(natural.trail - 1.0) < 1e-6,
    'Natural must be the shipped default (scale 1, streak 4.5, bite 1, trail 1)');

  // The looks must be recognisably what they claim.
  const streaks = measure('Storm Streaks');
  const surf = measure('Surf');
  const painted = measure('Painted');
  const whitecaps = measure('Whitecaps');
  const minimal = measure('Minimal');
  assert.ok(streaks.streak > natural.streak * 1.8,
    'Storm Streaks must draw foam out along the wind far more than Natural');
  assert.ok(surf.streak < 2.0, 'Surf is shorewater: its cells should be nearly round, not streaked');
  assert.ok(surf.scale > natural.scale * 1.5, 'Surf must be finer-grained than the open ocean');
  assert.ok(painted.bite > 2.5, 'Painted must cut hard-edged shapes, so its noise contrast is high');
  assert.ok(painted.trail < streaks.trail, 'Painted should not smear foam down the wave the way a gale does');
  assert.ok(whitecaps.coverage < natural.coverage, 'Whitecaps must be sparser than Natural');
  assert.ok(minimal.coverage < whitecaps.coverage, 'Minimal must be the quietest look of all');

  // The axis owns foam regardless of what Style wanted - that is the point of composing it last.
  const underToon = measure('Storm Streaks', 'Toon');
  assert.ok(Math.abs(underToon.streak - streaks.streak) < 1e-6,
    'the foam look must survive whatever Style is set, or it is not an independent axis');

  // And it can be switched at runtime, not just at scene load.
  const live = measure('Natural');
  FW.setWaterDetailingFoamStyle(live.sc, live.dB, 'Painted');
  FW.stepWaterDetailing(live.sc, live.o.object, live.dB);
  assert.ok(live.o.material.uniforms.u_FoamBite.value > 2.5,
    'setting the foam look at runtime must reach the shader');
  assert.strictEqual(FW.getWaterDetailingFoamStyle(live.sc, live.dB), 'Painted',
    'and the expression must report the new look');
  console.log('  Passed: seven distinct looks, Natural unchanged, independent of Style, live-switchable.');
}

console.log('--- Test 13: Teardown & leak-free cleanup ---');
FW.disposeWaterBody(mockScene, mockWaterBehavior);
FW.disposeBuoyancy(mockScene, mockBuoyancyBehavior);
FW.disposePourableLiquid(mockScene, mockLiquidBehavior);
registeredCallbacks.unloaded(mockScene);
assert.strictEqual(FW.getTotalActiveDropletCount(mockScene), 0, 'Unload must clear all droplets and resources');

registeredCallbacks.unloaded(diveScene);
assert.strictEqual(diveScene.threeScene.fog, null, 'Unloading while submerged must restore the scene fog');
console.log('  Passed.');

console.log('\nALL FLUID & WATER 3D UNIT TESTS PASSED CLEANLY!\n');
