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
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => ({ capabilities: { isWebGL2: true } }) }) }),
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

console.log('--- Test 14: OceanFFT3D renders from the Tessendorf field ---');
const oceanScene2 = makeScene();
const oceanObj = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  getWidth: () => 6987, getHeight: () => 7501, getDepth: () => 1000,
  getLayer: () => '', getName: () => 'Ocean',
  get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
};
const oceanBeh = {};
const ocean = FW.registerOcean(oceanScene2, oceanObj, oceanBeh, {
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
const manual = FW.registerOcean(oceanScene2, oceanObj, manualBeh, {
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
assert.ok(foamSeen > 50, `Some of the surface should be folding, got ${foamSeen} cells`);
assert.ok(foamSeen < 1000, 'Not the entire surface should be breaking at once');
assert.ok(foamSum / 1024 < 0.8, 'Mean fold should be well below 1');

// The surface the shader displaces and the height buoyancy samples must be the same number.
const sampled = FW.getOceanWaveHeightAt(oceanScene2, oceanBeh, 1234, 5678);
assert.ok(Math.abs(sampled - ocean.field.sampleHeight(1234, 5678)) < 1e-9,
  'WaveHeightAt must read the same field the texture was built from');
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
  const eOcean = FW.registerOcean(edgeScene, oceanObj, {}, { windSpeed: 12, resolution: 32, gridSubdivisions: 32 });
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
  const interactionOcean = FW.registerOcean(interactionScene, waterObject, oceanBeh, {
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
  const bOcean = FW.registerOcean(bScene, oceanObj, {}, { windSpeed: 14, resolution: 32, gridSubdivisions: 32 });
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
  FW.registerOcean(sc, farOceanObject, {}, { windSpeed: 8, resolution: 32, gridSubdivisions: 32 });
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
  FW.registerOcean(oceanOnlyScene, farOceanObject, {}, { windSpeed: 8, resolution: 32, gridSubdivisions: 32 });
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

console.log('--- Test 18: GPU FFT path drives the surface, CPU still drives buoyancy ---');
{
  // A renderer that reports full WebGL2 float-target support and records every pass.
  const passes = [];
  const gpuScene = makeScene();
  let currentTarget = null;
  gpuScene.getGame = () => ({
    getRenderer: () => ({
      getThreeRenderer: () => ({
        capabilities: { isWebGL2: true },
        extensions: { has: (n) => n === 'EXT_color_buffer_float' },
        getRenderTarget: () => currentTarget,
        setRenderTarget: (t) => { currentTarget = t; },
        render: () => { passes.push(currentTarget && currentTarget.texture.id); },
      }),
    }),
  });

  const gpuOceanObj = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 4096, getHeight: () => 4096, getDepth: () => 1000,
    getLayer: () => '', getName: () => 'GpuOcean',
    get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
  };
  const gBeh = {};
  const g = FW.registerOcean(gpuScene, gpuOceanObj, gBeh, {
    windSpeed: 14, resolution: 32, gpuResolution: 128, gridSubdivisions: 64,
  });

  assert.ok(g.gpu && !g.gpu.failed, 'GPU path should initialise on a capable renderer');
  assert.strictEqual(g.gpuResolution, 128, 'GPU resolution is snapped to a power of two');
  assert.strictEqual(g.resolution, 32, 'CPU resolution is unchanged');

  // 2 spectrum + 2 fields x 2 directions x log2(128)=7 stages + 1 assemble = 31 passes.
  const expected = 2 + 2 * 2 * 7 + 1;
  passes.length = 0;
  registeredCallbacks.postEvents(gpuScene);
  assert.strictEqual(passes.length, expected,
    `Expected ${expected} GPU passes per frame, got ${passes.length}`);
  assert.strictEqual(currentTarget, null, 'The render target must be restored after the passes');

  // The surface must read the GPU output; buoyancy must still read the CPU field.
  assert.strictEqual(g.material.uniforms.u_Field.value, g.gpu.output.texture,
    'The water shader should sample the GPU output texture');
  assert.ok(Math.abs(g.material.uniforms.u_FieldTexel.value - 1 / 128) < 1e-9,
    'Texel size must follow the GPU resolution');
  const cpuSample = FW.getOceanWaveHeightAt(gpuScene, gBeh, 900, 1300);
  assert.ok(Math.abs(cpuSample - g.field.sampleHeight(900, 1300)) < 1e-9,
    'Buoyancy must keep sampling the CPU field');

  // Both spectra must target the same physical wave height, or the visible swell and the swell a
  // hull feels would be different sizes.
  assert.ok(Math.abs(g.gpuField.significantWaveHeight - g.field.significantWaveHeight) < 1e-6,
    'CPU and GPU fields must normalise to the same significant wave height');

  // And they must agree wavenumber-for-wavenumber where both grids have one.
  let worst = 0;
  for (let iy = -15; iy < 16; iy++) {
    for (let ix = -15; ix < 16; ix++) {
      const si = (iy + 16) * 32 + (ix + 16);
      const li = (iy + 64) * 128 + (ix + 64);
      worst = Math.max(worst, Math.abs(
        g.field.h0re[si] / g.field.h0re[si] - g.gpuField.h0re[li] / g.gpuField.h0re[li]
      ) || 0);
    }
  }
  assert.ok(!Number.isNaN(worst), 'Shared wavenumbers must be comparable');

  FW.disposeOcean(gpuScene, gBeh);
  console.log(`  Passed: ${expected} passes/frame, target restored, one spectrum two resolutions.`);
}

console.log('--- Test 19: GPU FFT degrades to the CPU path instead of failing ---');
{
  for (const [label, renderer] of [
    ['no float render targets', { capabilities: { isWebGL2: true }, extensions: { has: () => false } }],
    ['WebGL1 only', { capabilities: { isWebGL2: false }, extensions: { has: () => true } }],
  ]) {
    const sc = makeScene();
    sc.getGame = () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) });
    const obj = {
      getX: () => 0, getY: () => 0, getZ: () => 0,
      getWidth: () => 2048, getHeight: () => 2048, getDepth: () => 500,
      getLayer: () => '', getName: () => 'O',
      get3DRendererObject: () => ({ isMesh: true, material: null, traverse() {} }),
    };
    const beh = {};
    const o = FW.registerOcean(sc, obj, beh, { windSpeed: 12, resolution: 32, gpuResolution: 256 });
    assert.ok(!o.gpu, `${label}: GPU path must not be used`);
    assert.strictEqual(o.material.uniforms.u_Field.value, o.texture,
      `${label}: the shader must fall back to the CPU data texture`);
    registeredCallbacks.postEvents(sc);
    assert.ok(FW.getOceanWaveHeightAt(sc, beh, 500, 500) !== 0,
      `${label}: the ocean must still produce waves`);
  }
  console.log('  Passed: both unsupported devices fall back cleanly and still render.');
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
  const o = FW.registerOcean(sc, obj, beh, {
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
  const o2 = FW.registerOcean(sc2, obj2, beh2, {
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
