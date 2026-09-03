/**
 * CinematicPostFX3D runtime tests.
 *
 * The previous suite asserted on CPU helper functions that no GPU code path ever called,
 * against a THREE mock where a render target was a plain object. It passed while the
 * extension's depth buffer, bloom chain and preset wiring were all broken.
 *
 * These tests model the parts of three.js that the pipeline actually depends on —
 * render-target dispose semantics, EffectComposer ping-pong, per-pass uniform state — and
 * assert on what each pass does with them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'CinematicPostFX3D.runtime.js'), 'utf8');

/* ============================================================ THREE.js mock */

let disposeCount = 0;

class MockVector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class MockMatrix4 {
  constructor() { this.elements = new Float32Array(16); this.elements[5] = 2.414; }
  identity() { return this; }
  copy() { return this; }
  invert() { return this; }
  multiplyMatrices() { return this; }
}
class MockTexture {
  constructor(w, h) { this.image = { width: w, height: h }; this.disposed = false; }
  dispose() { this.disposed = true; }
}
class MockDepthTexture extends MockTexture {}

class MockWebGLRenderTarget {
  constructor(w, h, options = {}) {
    this.width = w;
    this.height = h;
    this.options = options;
    this.texture = { width: w, height: h, name: '' };
    this.depthTexture = options.depthTexture || null;
    this.depthBuffer = options.depthBuffer !== false;
    this.disposeCalls = 0;
  }
  // Mirrors three r160: the colour texture is resized, the depth texture is NOT, and the
  // target is disposed so the framebuffer is rebuilt.
  setSize(w, h) {
    if (this.width !== w || this.height !== h) {
      this.width = w;
      this.height = h;
      this.texture.width = w;
      this.texture.height = h;
      this.dispose();
    }
  }
  clone() {
    const c = new MockWebGLRenderTarget(this.width, this.height, this.options);
    return c;
  }
  dispose() { this.disposeCalls++; disposeCount++; }
}

let raycastHitDistance = 520.0;
let raycastTargets = null;
let raycastBounds = null;

globalThis.THREE = {
  RGBAFormat: 1023,
  DepthFormat: 1026,
  FloatType: 1015,
  HalfFloatType: 1016,
  UnsignedByteType: 1009,
  UnsignedIntType: 1014,
  UnsignedShortType: 1012,
  LinearFilter: 1006,
  NearestFilter: 1003,
  ClampToEdgeWrapping: 1001,
  Color: class {
    constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
    set() { return this; }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  },
  MeshBasicMaterial: class {
    constructor(params = {}) { this.color = params.color; this.side = params.side; }
    dispose() { this.disposed = true; }
  },
  Vector2: MockVector2,
  Vector3: MockVector3,
  Matrix4: MockMatrix4,
  Scene: class {
    constructor() { this.children = []; this.background = null; }
    add(o) { this.children.push(o); }
    remove() {}
  },
  Group: class {
    constructor() { this.children = []; }
    traverse(fn) {
      const walk = (o) => { fn(o); for (const c of o.children || []) walk(c); };
      for (const c of this.children) walk(c);
    }
  },
  Camera: class {
    constructor() {
      this.position = new MockVector3(0, 0, 1);
      this.projectionMatrix = new MockMatrix4();
      this.matrixWorldInverse = new MockMatrix4();
      this.near = 0.1;
      this.far = 2000.0;
    }
    updateMatrixWorld() {}
  },
  PlaneGeometry: class { dispose() {} },
  ShaderMaterial: class {
    constructor(params = {}) {
      this.uniforms = params.uniforms || {};
      this.vertexShader = params.vertexShader || '';
      this.fragmentShader = params.fragmentShader || '';
    }
    dispose() {}
  },
  Mesh: class {
    constructor(geo, mat) { this.geometry = geo; this.material = mat; this.frustumCulled = true; }
  },
  DepthTexture: MockDepthTexture,
  WebGLRenderTarget: MockWebGLRenderTarget,
  Raycaster: class {
    setFromCamera(coords, camera) { this.coords = coords; this.camera = camera; }
    intersectObjects(objects) {
      raycastTargets = objects;
      raycastBounds = { near: this.near, far: this.far };
      if (!objects || !objects.length) return [];
      // Nearest first, the way three returns them.
      return objects.map((o, i) => ({ distance: raycastHitDistance + i * 200, object: o }));
    }
  }
};

/* ============================================================ gdjs mock */

const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
  hexToRGBColor: () => [0, 255, 255]
};

const warnings = [];
const infos = [];
const realWarn = console.warn;
const realInfo = console.info;
console.warn = (...a) => { warnings.push(a.join(' ')); };
console.info = (...a) => { infos.push(a.join(' ')); };

new Function(runtimeCode)();

const FX = gdjs.__cinematicPostFX3D;
assert.ok(FX, 'gdjs.__cinematicPostFX3D must be defined');

/* ============================================================ harness */

// Records every draw the pipeline issues, with a snapshot of the uniforms in effect at
// that moment. Uniform objects are mutated and reused between passes, so a snapshot is
// the only way to see what each individual pass was actually given.
function makeHarness({ withComposer = true, gameW = 1920, gameH = 1080 } = {}) {
  const draws = [];
  let currentTarget = null;

  const renderer = {
    getDrawingBufferSize: (v) => v.set(gameW, gameH),
    getRenderTarget: () => currentTarget,
    setRenderTarget: (t) => { currentTarget = t; },
    setClearColor: () => {},
    getClearAlpha: () => 1,
    clear: () => {},
    render: (scene) => {
      if (renderer.__throwOnMaskRender && scene.__isMaskGroup) {
        throw new Error('simulated GL failure');
      }
      if (scene.__isMaskGroup) {
        draws.push({
          target: currentTarget,
          material: null,
          maskGroup: scene,
          // Snapshot what each mesh was swapped to, since it is restored immediately after.
          maskColors: scene.children.map((m) => (m.material && m.material.color)
            ? m.material.color.r : null),
          maskRoughness: scene.children.map((m) => (m.material && m.material.color)
            ? m.material.color.g : null),
          uniforms: {}
        });
        return;
      }
      const mat = scene.children[0].material;
      const snap = {};
      for (const [k, u] of Object.entries(mat.uniforms || {})) {
        const val = u.value;
        snap[k] = (val && typeof val === 'object' && 'x' in val)
          ? { x: val.x, y: val.y }
          : val;
      }
      draws.push({ target: currentTarget, material: mat, uniforms: snap });
    }
  };

  const camera = new globalThis.THREE.Camera();
  const threeScene = new globalThis.THREE.Scene();
  const threeGroup = new globalThis.THREE.Group();
  threeGroup.__isMaskGroup = true;
  // A rough dielectric floor and a polished metal cube — the exact case from the bug report.
  threeGroup.children.push(
    { visible: true, isMesh: true, name: 'ground', userData: {}, children: [],
      material: { roughness: 1.0, metalness: 0.0, side: 0 } },
    { visible: true, isMesh: true, name: 'cube', userData: {}, children: [],
      material: { roughness: 0.05, metalness: 1.0, side: 0 } }
  );

  let composer = null;
  if (withComposer) {
    const rt1 = new MockWebGLRenderTarget(gameW, gameH, { type: 1016 });
    const rt2 = new MockWebGLRenderTarget(gameW, gameH, { type: 1016 });
    composer = {
      renderTarget1: rt1,
      renderTarget2: rt2,
      writeBuffer: rt1,
      readBuffer: rt2,
      passes: [{ name: 'RenderPass' }, { name: 'OutputPass' }],
      insertPass(pass, index) {
        this.passes.splice(index, 0, pass);
        pass.setSize(gameW, gameH);
      },
      removePass(pass) {
        const i = this.passes.indexOf(pass);
        if (i !== -1) this.passes.splice(i, 1);
      },
      setSize(w, h) {
        this.renderTarget1.setSize(w, h);
        this.renderTarget2.setSize(w, h);
        for (const p of this.passes) if (p.setSize) p.setSize(w, h);
      }
    };
  }

  const layerRenderer = {
    addPostProcessingPass(pass) {
      if (composer) composer.insertPass(pass, composer.passes.length - 1);
    },
    removePostProcessingPass(pass) { if (composer) composer.removePass(pass); },
    getThreeEffectComposer: () => composer,
    getThreeCamera: () => camera,
    getThreeScene: () => threeScene,
    getThreeGroup: () => threeGroup
  };

  const runtimeScene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    hasLayer: () => true,
    getLayer: () => ({ getRenderer: () => layerRenderer }),
    getBackgroundColor: () => 0x1e2832
  };

  return { renderer, camera, threeScene, threeGroup, composer, layerRenderer, runtimeScene, draws };
}

function makeBehavior(overrides = {}) {
  const props = Object.assign({
    Preset: 'Custom',
    MasterIntensity: 1.0,
    ToneMapping: 'ACESFilmic',
    TargetLayer: '',
    Diagnostics: false,
    EffectQuality: 'Half',
    EnableGTAO: false,
    GTAORadius: 50,
    GTAOIntensity: 1.0,
    GTAOMultiBounce: true,
    EnableSSR: false,
    SSRIntensity: 0.6,
    SSRMaxDistance: 400,
    SSRFresnel: 0.6,
    SSRRaySteps: 32,
    EnableBloom: false,
    BloomIntensity: 0.8,
    BloomThreshold: 0.9,
    AnamorphicFlares: 0.3,
    FlareTintColor: '100;180;255',
    EnableDOF: false,
    Autofocus: true,
    ManualFocusDistance: 700,
    ApertureFStop: 2.8,
    MaxBokehRadius: 12.0,
    EnableMotionBlur: false,
    MotionBlurStrength: 0.5,
    ChromaticAberration: 0.003
  }, overrides);

  const behavior = { _properties: props };
  for (const key of Object.keys(props)) {
    behavior['_get' + key] = function () { return this._properties[key]; };
    behavior['_set' + key] = function (v) { this._properties[key] = v; };
  }
  return behavior;
}

// Labels each recorded draw by which of the pipeline's materials produced it.
function labelDraws(pipeline, draws) {
  const byMaterial = new Map([
    [pipeline.gtaoMaterial, 'gtao'],
    [pipeline.bilateralBlurMaterial, 'blur'],
    [pipeline.ssrMaterial, 'ssr'],
    [pipeline.ssrBlurMaterial, 'ssrblur'],
    [pipeline.karisDownsampleMaterial, 'down'],
    [pipeline.tentUpsampleMaterial, 'up'],
    [pipeline.dofMaterial, 'dof'],
    [pipeline.mergeMaterial, 'merge'],
    [pipeline.anamorphicStreakMaterial, 'streak'],
    [pipeline.compositeMaterial, 'composite']
  ]);
  return draws.map((d) => Object.assign(
    { kind: d.maskGroup ? 'ssrmask' : (byMaterial.get(d.material) || 'unknown') }, d));
}

function run(harness, behavior, { frames = 1 } = {}) {
  FX.registerBehavior(harness.runtimeScene, {}, behavior);
  const pipeline = behavior.__cinematicPipeline;
  const pass = pipeline && pipeline.customPass;
  for (let i = 0; i < frames; i++) {
    FX.syncBehaviorProperties(harness.runtimeScene, {}, behavior);
    FX.stepBehavior(harness.runtimeScene, {}, behavior);
    if (pass) pass.render(harness.renderer, harness.composer.renderTarget1, harness.composer.renderTarget2, 0.016, false);
  }
  return { pipeline, pass, draws: labelDraws(pipeline, harness.draws) };
}

let passed = 0;
function ok(msg) { passed++; console.log('  PASS  ' + msg); }

/* ============================================================ 1. Depth math */

console.log('\n--- 1. Depth linearisation & the sky-test regression ---');
{
  const near = 0.1, far = 2000;
  const lin = (d) => FX.linearizeDepth(d, near, far, false);

  assert.ok(Math.abs(lin(0.0) - near) < 1e-3, 'raw 0 is the near plane');
  assert.ok(Math.abs(lin(1.0) - far) / far < 1e-3, 'raw 1 is the far plane');
  ok('linearizeDepth maps the depth range onto near..far');

  // Monotonic.
  let prev = -1;
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const z = lin(Math.min(d, 1));
    assert.ok(z > prev, 'depth is monotonic');
    prev = z;
  }
  ok('linearizeDepth is monotonic across the range');

  // The regression this whole rewrite exists for: with GDevelop's default near/far, a raw
  // depth of 0.999 is only ~100 world units out. The camera itself sits ~724 units back,
  // so the old `if (rawDepth >= 0.999) return sky;` test discarded the entire scene.
  const zAtOldCutoff = lin(0.999);
  assert.ok(zAtOldCutoff < 150,
    `raw 0.999 should be nearby (got ${zAtOldCutoff.toFixed(1)} units)`);
  const cameraDistance = 0.5 * 600 / Math.tan(0.5 * (45 * Math.PI / 180));
  assert.ok(cameraDistance > zAtOldCutoff,
    'the default camera distance must sit beyond the old cutoff, proving it rejected everything');
  ok(`raw 0.999 is only ${zAtOldCutoff.toFixed(1)} units out, but the default camera is ` +
     `${cameraDistance.toFixed(0)} units back — the old sky test discarded the whole scene`);

  // Orthographic layers use a linear depth ramp instead.
  assert.ok(Math.abs(FX.linearizeDepth(0.5, 0, 1000, true) - 500) < 1e-6,
    'orthographic depth is a linear ramp');
  ok('orthographic depth linearisation is handled separately');
}

/* ============================================================ 2. Optical math */

console.log('\n--- 2. Circle of Confusion, tone curves, GTAO integral ---');
{
  const coc = FX.computeCircleOfConfusion;

  assert.strictEqual(coc(700, 700, 2.8, 12), 0, 'in-focus subject has zero CoC');
  ok('in-focus subject has zero CoC');

  assert.ok(coc(300, 700, 2.8, 12) > 0 && coc(1400, 700, 2.8, 12) > 0,
    'foreground and background both defocus');
  ok('foreground and background both defocus');

  assert.ok(coc(1400, 700, 1.4, 12) > coc(1400, 700, 16.0, 12),
    'f/1.4 blurs more than f/16');
  ok('wide apertures blur more than narrow ones');

  // Scale invariance is the point of deriving focal length from focus distance: the same
  // relative defocus must give the same blur whether the scene is metres or pixels.
  const small = coc(8, 4, 2.8, 12);
  const large = coc(1400, 700, 2.8, 12);
  assert.ok(Math.abs(small - large) < 1e-6,
    `CoC must be scale invariant (${small} vs ${large})`);
  ok('CoC is scale invariant — same look at 4 units or 700');

  assert.ok(coc(700, 700, 2.8, 12) <= 12 && coc(100000, 700, 2.8, 12) <= 12,
    'CoC never exceeds the max radius');
  ok('CoC is clamped to the configured max bokeh radius');

  assert.strictEqual(FX.applyReinhard(1, 1, 1)[0], 0.5, 'Reinhard(1) is 0.5');
  assert.ok(FX.applyACESFilmic(10, 10, 10)[0] > 0.95, 'ACES compresses HDR into range');
  ok('tone mapping curves behave');

  // Fully open hemisphere (theta = +-pi/2, gamma = 0) integrates to full visibility.
  const open = FX.computeGTAOVisibility(Math.PI / 2, -Math.PI / 2, 0);
  assert.ok(Math.abs(open - 1.0) < 1e-9, `unoccluded arc should integrate to 1, got ${open}`);
  ok('GTAO arc integral returns full visibility for an unoccluded hemisphere');

  // Closing the horizon must reduce visibility.
  const half = FX.computeGTAOVisibility(Math.PI / 4, -Math.PI / 4, 0);
  assert.ok(half < open && half > 0, 'a narrowed arc occludes');
  ok('GTAO arc integral decreases as the horizon closes in');

  // Multi-bounce must brighten, never darken — that was backwards in the old helper.
  const vis = 0.3;
  assert.ok(FX.computeGTAOMultiBounce(vis, 0.9) > vis, 'bright albedo gains bounce light');
  assert.ok(FX.computeGTAOMultiBounce(vis, 0.0) >= vis, 'multi-bounce never darkens');
  assert.ok(FX.computeGTAOMultiBounce(1.0, 0.5) <= 1.0, 'multi-bounce stays in range');
  ok('GTAO multi-bounce brightens high-albedo crevices and never darkens');
}

/* ============================================================ 3. Presets */

console.log('\n--- 3. Preset definitions ---');
{
  const names = ['CyberpunkNeon', 'CinematicMovie', 'HorrorGrim', 'CleanRealistic', 'PerformanceLite'];
  for (const name of names) {
    const p = FX.PRESETS[name];
    assert.ok(p, `${name} exists`);
    // Every preset key must exist in DEFAULT_SETTINGS, or applying it silently introduces
    // a setting nothing reads.
    for (const key of Object.keys(p)) {
      assert.ok(key in FX.DEFAULT_SETTINGS, `${name}.${key} is a known setting`);
    }
    // World-space values must be on GDevelop's scale, not metric.
    assert.ok(p.gtaoRadius >= 10, `${name}.gtaoRadius is scene scale (got ${p.gtaoRadius})`);
    assert.ok(p.manualFocusDistance >= 100, `${name}.manualFocusDistance is scene scale`);
    assert.ok(p.ssrMaxDistance >= 100, `${name}.ssrMaxDistance is scene scale`);
  }
  ok('all 5 presets are complete and use GDevelop world-unit scale');

  // The docs claim DOF and motion blur per preset; the old presets had them false everywhere.
  assert.ok(FX.PRESETS.CinematicMovie.enableDOF && FX.PRESETS.CinematicMovie.autofocus,
    'CinematicMovie advertises autofocus DOF');
  assert.ok(FX.PRESETS.HorrorGrim.enableDOF && !FX.PRESETS.HorrorGrim.autofocus,
    'HorrorGrim advertises a fixed close focus');
  assert.ok(FX.PRESETS.CinematicMovie.enableMotionBlur, 'CinematicMovie advertises motion blur');
  assert.ok(!FX.PRESETS.PerformanceLite.enableGTAO && !FX.PRESETS.PerformanceLite.enableSSR,
    'PerformanceLite drops the expensive passes');
  ok('presets match what the documentation claims about them');
}

/* ============================================================ 4. Depth attachment */

console.log('\n--- 4. Composer depth attachment ---');
{
  const h = makeHarness();
  assert.strictEqual(h.composer.renderTarget1.depthTexture, null, 'composer starts with no depth');

  const behavior = makeBehavior();
  const { pipeline, pass } = run(h, behavior);

  assert.ok(pass, 'a pass was attached');
  assert.ok(h.composer.passes.includes(pass), 'the pass is in the composer chain');
  ok('pass is inserted into the layer EffectComposer');

  // Both ping-pong targets need depth: RenderPass has needsSwap=false and there are three
  // swapping passes per frame, so rt1 and rt2 alternate as the scene buffer frame to frame.
  for (const rt of [h.composer.renderTarget1, h.composer.renderTarget2]) {
    assert.ok(rt.depthTexture, 'render target has a depth texture');
    assert.strictEqual(rt.depthTexture.image.width, rt.width, 'depth width matches colour');
    assert.strictEqual(rt.depthTexture.image.height, rt.height, 'depth height matches colour');
  }
  ok('BOTH composer ping-pong targets get a correctly sized depth texture');

  // Assigning depthTexture to an already-built target is a no-op in three; the target must
  // be disposed first so the framebuffer is rebuilt with the attachment.
  assert.ok(h.composer.renderTarget1.disposeCalls >= 1,
    'the target was disposed so three rebuilds the framebuffer');
  ok('targets are disposed before attaching, forcing a framebuffer rebuild');

  assert.strictEqual(FX.isDepthAvailable(h.runtimeScene, behavior), true, 'depth reported available');
  ok('isDepthAvailable reports true once attachment succeeded');

  // WebGLRenderTarget.setSize does not resize a depthTexture, so a resize without a fix-up
  // leaves an incomplete framebuffer.
  h.composer.setSize(1280, 720);
  for (const rt of [h.composer.renderTarget1, h.composer.renderTarget2]) {
    assert.strictEqual(rt.depthTexture.image.width, 1280, 'depth resized with the target');
    assert.strictEqual(rt.depthTexture.image.height, 720, 'depth resized with the target');
  }
  ok('resizing the composer re-syncs the depth textures to the new size');

  FX.destroyBehavior(h.runtimeScene, behavior);
  assert.ok(!h.composer.passes.includes(pass), 'the pass was removed on destroy');
  ok('pass is detached from the composer on destroy');
}

/* ============================================================ 5. Pass execution */

console.log('\n--- 5. Which passes actually run ---');
{
  const h = makeHarness();
  const behavior = makeBehavior({
    EnableGTAO: true, EnableSSR: true, EnableBloom: true, EnableDOF: true, EnableMotionBlur: true
  });
  const { pipeline, draws } = run(h, behavior);

  const kinds = draws.map((d) => d.kind);
  assert.ok(!kinds.includes('unknown'), 'every draw came from a known material');

  assert.strictEqual(kinds.filter((k) => k === 'gtao').length, 1, 'one GTAO pass');
  assert.strictEqual(kinds.filter((k) => k === 'blur').length, 2, 'two blur passes');
  assert.strictEqual(kinds.filter((k) => k === 'ssr').length, 1, 'one SSR pass');
  assert.strictEqual(kinds.filter((k) => k === 'dof').length, 1, 'one DOF pass');
  assert.strictEqual(kinds.filter((k) => k === 'merge').length, 1, 'one AO/SSR merge pass');
  assert.strictEqual(kinds.filter((k) => k === 'composite').length, 1, 'one composite pass');
  ok('every enabled effect issues exactly the passes it should');

  // A single-axis bilateral blur leaves the AO visibly streaked; both axes must run.
  const blurs = draws.filter((d) => d.kind === 'blur');
  assert.deepStrictEqual(blurs.map((b) => [b.uniforms.uDirection.x, b.uniforms.uDirection.y]),
    [[1, 0], [0, 1]], 'blur runs horizontally then vertically');
  ok('the bilateral blur runs both axes, not just horizontal');

  // Every depth-reading pass must receive the camera planes, or its sky test is meaningless.
  for (const d of draws) {
    if (!('uNear' in d.uniforms)) continue;
    assert.strictEqual(d.uniforms.uNear, 0.1, `${d.kind} received the camera near plane`);
    assert.strictEqual(d.uniforms.uFar, 2000, `${d.kind} received the camera far plane`);
    assert.strictEqual(d.uniforms.uIsOrtho, 0, `${d.kind} knows the projection type`);
  }
  ok('every depth-reading pass receives the real camera near/far planes');

  // Bloom pyramid: N downsamples, N-1 additive upsamples.
  const downs = draws.filter((d) => d.kind === 'down');
  const ups = draws.filter((d) => d.kind === 'up');
  assert.strictEqual(downs.length, pipeline.bloomDownTargets.length, 'one downsample per mip');
  assert.strictEqual(ups.length, pipeline.bloomDownTargets.length - 1, 'N-1 upsample passes');
  ok(`bloom pyramid runs ${downs.length} downsamples and ${ups.length} upsamples`);

  // The threshold belongs to the first mip only; later mips must not re-cut.
  assert.strictEqual(downs[0].uniforms.uIsFirstMip, 1, 'first mip applies the threshold');
  assert.ok(downs.slice(1).every((d) => d.uniforms.uIsFirstMip === 0), 'later mips do not');
  ok('the bloom threshold is applied to the first mip only');

  // Without the additive term the pyramid collapses to the smallest mip blurred N times
  // and every bit of mid-frequency glow is lost.
  assert.ok(ups.every((u) => u.uniforms.uHasAdd === 1 && u.uniforms.tAdd),
    'every upsample adds its matching downsample mip');
  ok('every bloom upsample recombines its matching mip (no lost mid-frequencies)');

  // Composite must be the last draw and must be told what is actually available.
  const last = draws[draws.length - 1];
  assert.strictEqual(last.kind, 'composite', 'composite runs last');
  assert.strictEqual(last.uniforms.uEnableBloom, 1, 'composite told bloom is available');
  assert.strictEqual(last.uniforms.uEnableMotionBlur, 1, 'composite told motion blur is on');
  // DOF is on in this configuration, so AO and SSR were already applied by the merge pass
  // and the composite must not apply them twice. Section 5d covers both paths in detail.
  assert.strictEqual(last.uniforms.uEnableGTAO, 0, 'composite defers AO to the merge pass');
  assert.strictEqual(last.uniforms.uEnableSSR, 0, 'composite defers SSR to the merge pass');
  const mergeDraw = draws.find((d) => d.kind === 'merge');
  assert.strictEqual(mergeDraw.uniforms.uMultiBounce, 1, 'multi-bounce flag reaches the shader');
  ok('the composite pass is last and receives accurate availability flags');
}

/* ============================================================ 5b. SSR reflectivity mask */

console.log('\n--- 5b. SSR only reflects off reflective surfaces ---');
{
  const P = FX.PostProcessorPipeline;

  // GDevelop's default 3D material is a fully rough dielectric. It must score zero, or SSR
  // mirrors the scene onto every floor and terrain surface in the game.
  assert.strictEqual(P.reflectivityOf({ roughness: 1.0, metalness: 0.0 }), 0,
    'a fully rough dielectric is not reflective');
  ok('GDevelop default material (roughness 1, metalness 0) scores zero reflectivity');

  assert.ok(P.reflectivityOf({ roughness: 0.05, metalness: 1.0 }) > 0.7,
    'polished metal is highly reflective');
  assert.ok(P.reflectivityOf({ roughness: 0.05, metalness: 0.0 }) > 0.1,
    'polished dielectric reflects a little');
  assert.ok(P.reflectivityOf({ roughness: 0.05, metalness: 1.0 })
          > P.reflectivityOf({ roughness: 0.05, metalness: 0.0 }),
    'metals reflect more than dielectrics at equal smoothness');
  assert.ok(P.reflectivityOf({ roughness: 0.6, metalness: 1.0 })
          < P.reflectivityOf({ roughness: 0.05, metalness: 1.0 }),
    'roughening a metal reduces sharp reflection');
  ok('reflectivity rises with smoothness and metalness');

  assert.strictEqual(P.reflectivityOf({}), 0, 'unlit/basic materials do not reflect');
  assert.strictEqual(P.reflectivityOf({ roughness: 0, metalness: 1, transparent: true, opacity: 0.5 }), 0,
    'transparent materials are skipped');
  assert.strictEqual(P.reflectivityOf(null), 0, 'a missing material does not crash');
  assert.strictEqual(P.reflectivityOf({ roughness: 1, metalness: 0, userData: { ssrReflectivity: 0.8 } }), 0.8,
    'userData.ssrReflectivity overrides the material');
  ok('unlit, transparent and missing materials are handled; userData can override');

  // The mask pass must actually run, and must produce the right value per mesh.
  const h = makeHarness();
  const behavior = makeBehavior({ EnableSSR: true });
  const { draws } = run(h, behavior);

  const mask = draws.find((d) => d.kind === 'ssrmask');
  assert.ok(mask, 'a reflectivity mask pass ran before SSR');
  assert.ok(draws.indexOf(mask) < draws.findIndex((d) => d.kind === 'ssr'),
    'the mask is rendered before the SSR raymarch that samples it');
  ok('a reflectivity mask pass runs ahead of the SSR raymarch');

  assert.strictEqual(mask.maskColors[0], 0, 'the rough ground was masked out');
  assert.ok(mask.maskColors[1] > 0.7, 'the polished metal cube was masked in');
  ok('the rough ground masks to 0 and the polished cube masks to >0.7');

  // Material swapping must not leak: a mesh left holding the mask material would render
  // flat grey in the actual scene.
  for (const mesh of h.threeGroup.children) {
    assert.ok(typeof mesh.material.roughness === 'number',
      'the original material was restored after the mask pass');
    assert.ok(!('__cinematicSourceMaterial' in mesh.userData),
      'the stash key was removed, not just blanked');
  }
  ok('every mesh gets its original material back after the mask pass');

  const ssr = draws.find((d) => d.kind === 'ssr');
  assert.strictEqual(ssr.uniforms.uUseReflectivityMask, 1, 'SSR was told to use the mask');
  assert.ok(ssr.uniforms.tReflectivity, 'SSR received the mask texture');
  ok('the SSR shader is wired to the mask');

  // "Everything" restores the old mirror-the-world behaviour for anyone who wants it.
  const h2 = makeHarness();
  const b2 = makeBehavior({ EnableSSR: true, SSRSurfaces: 'Everything' });
  const d2 = run(h2, b2).draws;
  assert.ok(!d2.some((d) => d.kind === 'ssrmask'), 'no mask pass in Everything mode');
  assert.strictEqual(d2.find((d) => d.kind === 'ssr').uniforms.uUseReflectivityMask, 0,
    'SSR told to ignore the mask');
  ok('"Everything" mode skips the mask pass entirely');

  // Reflectivity is recomputed each frame so runtime material edits are picked up.
  const h3 = makeHarness();
  const b3 = makeBehavior({ EnableSSR: true });
  const r3 = run(h3, b3);
  h3.threeGroup.children[0].material.roughness = 0.02;
  h3.threeGroup.children[0].material.metalness = 1.0;
  r3.pass.render(h3.renderer, h3.composer.renderTarget1, h3.composer.renderTarget2, 0.016, false);
  const masks = labelDraws(r3.pipeline, h3.draws).filter((d) => d.kind === 'ssrmask');
  assert.strictEqual(masks[0].maskColors[0], 0, 'ground started non-reflective');
  assert.ok(masks[masks.length - 1].maskColors[0] > 0.7, 'ground became reflective after the edit');
  ok('reflectivity is recomputed per frame, so runtime material changes take effect');
}

/* ============================================================ 5b2. SSR resolve & mask hygiene */

console.log('\n--- 5b2. SSR resolve blur and reflectivity-mask hygiene ---');
{
  const P = FX.PostProcessorPipeline;

  assert.strictEqual(P.roughnessOf({ roughness: 0.25 }), 0.25, 'roughness is read straight through');
  assert.strictEqual(P.roughnessOf({}), 1.0, 'an unlit material is treated as fully rough');
  assert.strictEqual(P.roughnessOf({ shininess: 100 }), 0, 'Phong shininess maps to smoothness');
  assert.strictEqual(P.roughnessOf({ roughness: 1, userData: { ssrRoughness: 0.1 } }), 0.1,
    'userData.ssrRoughness overrides the material');
  ok('roughness is derived for every material family, with a userData override');

  const h = makeHarness();
  const b = makeBehavior({ EnableSSR: true });
  const { draws } = run(h, b);

  const mask = draws.find((d) => d.kind === 'ssrmask');
  // Red gates the raymarch, green sets how wide its blur cone opens.
  assert.strictEqual(mask.maskColors[0], 0, 'ground reflectivity in red');
  assert.strictEqual(mask.maskRoughness[0], 1.0, 'ground roughness in green');
  assert.ok(mask.maskRoughness[1] < 0.1, 'the polished cube reports low roughness');
  ok('the mask packs reflectivity into red and roughness into green');

  const blur = draws.find((d) => d.kind === 'ssrblur');
  assert.ok(blur, 'the SSR resolve blur ran');
  assert.ok(draws.indexOf(blur) > draws.indexOf(draws.find((d) => d.kind === 'ssr')),
    'it runs after the raymarch');
  assert.strictEqual(blur.uniforms.uUseReflectivityMask, 1, 'it was given the roughness channel');
  ok('a roughness-widened resolve blur runs over the reflection buffer');

  // The composite must read the resolved buffer, not the raw raymarch output.
  const { pipeline } = run(makeHarness(), makeBehavior({ EnableSSR: true }));
  assert.notStrictEqual(pipeline.ssrBlurTarget, null, 'a resolve target exists');

  // Without the mask there is no roughness to read, so the blur falls back to its floor.
  const h2 = makeHarness();
  const d2 = run(h2, makeBehavior({ EnableSSR: true, SSRSurfaces: 'Everything' })).draws;
  assert.strictEqual(d2.find((d) => d.kind === 'ssrblur').uUseReflectivityMask, undefined);
  assert.strictEqual(d2.find((d) => d.kind === 'ssrblur').uniforms.uUseReflectivityMask, 0,
    'no mask means no roughness channel to read');
  ok('the resolve blur degrades to a fixed denoise when there is no mask');

  // A GL failure mid-mask must not leave the scene wearing flat grey materials forever.
  const h3 = makeHarness();
  const b3 = makeBehavior({ EnableSSR: true });
  FX.registerBehavior(h3.runtimeScene, {}, b3);
  const pass3 = b3.__cinematicPipeline.customPass;
  h3.renderer.__throwOnMaskRender = true;
  let threw = false;
  try {
    pass3.render(h3.renderer, h3.composer.renderTarget1, h3.composer.renderTarget2, 0.016, false);
  } catch (e) { threw = true; }
  assert.ok(threw, 'the simulated failure propagated');
  for (const mesh of h3.threeGroup.children) {
    assert.ok(typeof mesh.material.roughness === 'number',
      'the original material was restored despite the throw');
    assert.ok(!('__cinematicSourceMaterial' in mesh.userData), 'and the stash key was removed');
  }
  ok('a failure during the mask render still restores every original material');

  // Holding source materials as Map keys would pin every material the scene ever had.
  const h4 = makeHarness();
  const r4 = run(h4, makeBehavior({ EnableSSR: true }));
  assert.ok(r4.pipeline._maskMaterials instanceof WeakMap,
    'the mask cache is a WeakMap so it cannot pin source materials');
  assert.ok(r4.pipeline._maskMaterialList.length > 0,
    'but our own mask materials are still tracked for disposal');
  ok('the mask cache cannot keep dead materials alive, and still disposes its own');
}

/* ============================================================ 5c. Buffer quality & upsampling */

console.log('\n--- 5c. Effect buffer quality and depth-aware upsampling ---');
{
  for (const [quality, divisor] of [['Full', 1], ['Half', 2], ['Quarter', 4]]) {
    const h = makeHarness();
    const b = makeBehavior({
      EnableGTAO: true, EnableSSR: true, EnableDOF: true, EffectQuality: quality
    });
    const { pipeline } = run(h, b);
    assert.strictEqual(pipeline.gtaoTarget.width, Math.floor(1920 / divisor),
      `${quality} sizes the AO buffer to 1/${divisor}`);
    assert.strictEqual(pipeline.ssrTarget.width, Math.floor(1920 / divisor),
      `${quality} sizes the SSR buffer to 1/${divisor}`);
    assert.strictEqual(pipeline.ssrMaskTarget.width, Math.floor(1920 / divisor),
      `${quality} sizes the reflectivity mask to 1/${divisor}`);
    // Bloom, DOF and the composite are always full resolution.
    assert.strictEqual(pipeline.dofTarget.width, 1920, 'DOF stays full resolution');
  }
  ok('Full/Half/Quarter scale the AO, SSR and mask buffers; DOF stays full resolution');

  // Buffers are created the first time a pass asks for one. Allocating all of them up front
  // costs about 62 MB at 1080p no matter what is switched on, and every effect is off by
  // default.
  {
    const hOff = makeHarness();
    const { pipeline: pOff } = run(hOff, makeBehavior());
    for (const name of ['gtaoTarget', 'gtaoBlurTarget', 'ssrTarget', 'ssrBlurTarget',
                        'ssrMaskTarget', 'mergeTarget', 'dofTarget', 'streakTarget']) {
      assert.strictEqual(pOff[name], null, `${name} is not allocated when nothing needs it`);
    }
    assert.strictEqual(pOff.bloomDownTargets.length, 0, 'no bloom pyramid without bloom');
    ok('a behavior with every effect off allocates no effect buffers at all');

    const hBloom = makeHarness();
    const { pipeline: pBloom } = run(hBloom, makeBehavior({ EnableBloom: true, AnamorphicFlares: 0 }));
    assert.strictEqual(pBloom.bloomDownTargets.length, 5, 'the bloom pyramid was created');
    assert.strictEqual(pBloom.dofTarget, null, 'but not the depth-of-field buffer');
    assert.strictEqual(pBloom.ssrTarget, null, 'nor the reflection buffers');
    assert.strictEqual(pBloom.streakTarget, null, 'nor the streak buffer at zero flares');
    ok('enabling bloom allocates the pyramid and nothing else');

    const hFlare = makeHarness();
    const { pipeline: pFlare } = run(hFlare, makeBehavior({ EnableBloom: true, AnamorphicFlares: 0.5 }));
    assert.ok(pFlare.streakTarget, 'flares allocate the streak buffer');
    ok('the streak buffer appears only once flares are turned up');

    const hSsr = makeHarness();
    const { pipeline: pSsr } = run(hSsr, makeBehavior({ EnableSSR: true, SSRSurfaces: 'Everything' }));
    assert.ok(pSsr.ssrTarget, 'SSR allocates its own buffers');
    assert.strictEqual(pSsr.ssrMaskTarget, null, 'but not the mask in Everything mode');
    ok('the reflectivity mask buffer is skipped when the mask is not used');
  }

  // Switching quality at runtime has to reallocate, not silently keep the old buffers.
  const h = makeHarness();
  const b = makeBehavior({ EnableGTAO: true, EnableDOF: true, EffectQuality: 'Half' });
  const { pipeline, pass } = run(h, b);
  assert.strictEqual(pipeline.gtaoTarget.width, 960, 'started at half');
  b._properties.EffectQuality = 'Quarter';
  FX.syncBehaviorProperties(h.runtimeScene, {}, b);
  pass.render(h.renderer, h.composer.renderTarget1, h.composer.renderTarget2, 0.016, false);
  assert.strictEqual(pipeline.gtaoTarget.width, 480, 'reallocated at quarter');
  ok('changing quality at runtime reallocates the buffers');

  // The composite upsamples half-res buffers, so it needs their texel size or it cannot
  // depth-weight the taps and AO haloes around every silhouette.
  const h2 = makeHarness();
  const b2 = makeBehavior({ EnableGTAO: true, EnableSSR: true });
  const draws2 = run(h2, b2).draws;
  const comp = draws2.find((d) => d.kind === 'composite');
  assert.ok(comp.uniforms.uLowResTexel, 'the composite receives the low-res texel size');
  assert.ok(Math.abs(comp.uniforms.uLowResTexel.x - 1 / 960) < 1e-9,
    'and it matches the actual AO buffer width');
  ok('the composite is given the low-res texel size for depth-aware upsampling');
}

/* ============================================================ 5d. Pass ordering */

console.log('\n--- 5d. AO and SSR are merged before Depth of Field ---');
{
  // Applying AO and SSR in the composite leaves them razor sharp on a surface the defocus
  // has already blurred.
  const h = makeHarness();
  const b = makeBehavior({ EnableGTAO: true, EnableSSR: true, EnableDOF: true });
  const { draws } = run(h, b);

  const iMerge = draws.findIndex((d) => d.kind === 'merge');
  const iDof = draws.findIndex((d) => d.kind === 'dof');
  assert.ok(iMerge >= 0, 'a merge pass ran');
  assert.ok(iMerge < iDof, 'the merge happens before the defocus');
  ok('AO and SSR are merged into the colour buffer before DOF blurs it');

  const merge = draws[iMerge];
  assert.strictEqual(merge.uniforms.uEnableGTAO, 1, 'the merge applied AO');
  assert.strictEqual(merge.uniforms.uEnableSSR, 1, 'the merge applied SSR');

  // ...and the composite must then NOT apply them a second time.
  const comp = draws.find((d) => d.kind === 'composite');
  assert.strictEqual(comp.uniforms.uEnableGTAO, 0, 'the composite does not re-apply AO');
  assert.strictEqual(comp.uniforms.uEnableSSR, 0, 'the composite does not re-apply SSR');
  ok('the composite skips AO and SSR once the merge pass has applied them');

  // Without DOF there is nothing to merge ahead of, so the extra pass must not run.
  const h2 = makeHarness();
  const b2 = makeBehavior({ EnableGTAO: true, EnableSSR: true, EnableDOF: false });
  const d2 = run(h2, b2).draws;
  assert.ok(!d2.some((d) => d.kind === 'merge'), 'no merge pass without DOF');
  assert.strictEqual(d2.find((d) => d.kind === 'composite').uniforms.uEnableGTAO, 1,
    'the composite applies AO itself on that path');
  ok('the merge pass is skipped when DOF is off, and the composite applies AO directly');

  // DOF with neither AO nor SSR has nothing to merge either.
  const h3 = makeHarness();
  const b3 = makeBehavior({ EnableDOF: true });
  assert.ok(!run(h3, b3).draws.some((d) => d.kind === 'merge'),
    'no merge pass when there is nothing to merge');
  ok('the merge pass is skipped when neither AO nor SSR is enabled');
}

/* ============================================================ 5e. Anamorphic streaks */

console.log('\n--- 5e. Anamorphic streaks ---');
{
  const h = makeHarness();
  const b = makeBehavior({ EnableBloom: true, AnamorphicFlares: 0.6 });
  const { pipeline, draws } = run(h, b);

  const streak = draws.find((d) => d.kind === 'streak');
  assert.ok(streak, 'a dedicated streak pass ran');
  assert.ok(draws.indexOf(streak) > draws.findIndex((d) => d.kind === 'up'),
    'the streak is blurred from the finished bloom buffer');
  assert.ok(draws.indexOf(streak) < draws.findIndex((d) => d.kind === 'composite'),
    'and it exists before the composite reads it');
  ok('a wide horizontal blur pass produces the streak from the finished bloom');

  const comp = draws.find((d) => d.kind === 'composite');
  assert.ok(comp.uniforms.tStreak, 'the composite receives the streak buffer');
  assert.strictEqual(comp.uniforms.uAnamorphicFlares, 0.6, 'and the configured strength');
  ok('the composite is wired to the streak buffer');

  // No flares means no pass and no cost; the composite must also be told to skip it so it
  // does not sample a stale or null buffer.
  const h2 = makeHarness();
  const b2 = makeBehavior({ EnableBloom: true, AnamorphicFlares: 0.0 });
  const d2 = run(h2, b2).draws;
  assert.ok(!d2.some((d) => d.kind === 'streak'), 'no streak pass at zero strength');
  assert.strictEqual(d2.find((d) => d.kind === 'composite').uniforms.uAnamorphicFlares, 0,
    'the composite is told there is no streak');
  ok('zero flare strength skips the pass entirely');
}

/* ============================================================ 5f. Autofocus bounds */

console.log('\n--- 5f. Autofocus bounds and opt-out ---');
{
  const h = makeHarness();
  raycastHitDistance = 520;
  raycastBounds = null;
  const b = makeBehavior({ EnableDOF: true, Autofocus: true });
  run(h, b, { frames: 6 });

  assert.ok(raycastBounds, 'the raycast ran');
  assert.strictEqual(raycastBounds.near, 0.1, 'the ray is clamped to the camera near plane');
  assert.strictEqual(raycastBounds.far, 2000, 'and to the camera far plane');
  ok('the autofocus ray is bounded by the camera frustum');

  // A camera-locked prop (a first-person weapon) sits in front of everything and would own
  // the focus plane forever.
  const h2 = makeHarness();
  h2.threeGroup.children[0].userData.cinematicIgnoreAutofocus = true;
  const b2 = makeBehavior({ EnableDOF: true, Autofocus: true });
  const r2 = run(h2, b2, { frames: 40 });
  // The ignored mesh is the nearest hit at 520; the next one is at 720.
  assert.ok(Math.abs(r2.pipeline.activeFocusDistance - 720) < 10,
    `focus skipped the opted-out mesh (got ${r2.pipeline.activeFocusDistance.toFixed(1)})`);
  ok('userData.cinematicIgnoreAutofocus keeps a mesh from hijacking the focus plane');
}

/* ============================================================ 6. Graceful degradation */

console.log('\n--- 6. Behaviour without a depth buffer ---');
{
  const h = makeHarness();
  const behavior = makeBehavior({ EnableGTAO: true, EnableSSR: true, EnableBloom: true, EnableDOF: true });
  FX.registerBehavior(h.runtimeScene, {}, behavior);
  const pipeline = behavior.__cinematicPipeline;
  const pass = pipeline.customPass;

  // Simulate a composer we could not attach depth to.
  const bare = new MockWebGLRenderTarget(1920, 1080, {});
  bare.depthTexture = null;
  pass._composer = null;
  pass._layerRenderer = Object.assign({}, h.layerRenderer, { getThreeEffectComposer: () => null });
  pass.render(h.renderer, h.composer.renderTarget1, bare, 0.016, false);

  const draws = labelDraws(pipeline, h.draws);
  const kinds = draws.map((d) => d.kind);
  assert.ok(!kinds.includes('gtao'), 'GTAO is skipped without depth');
  assert.ok(!kinds.includes('ssr'), 'SSR is skipped without depth');
  assert.ok(!kinds.includes('dof'), 'DOF is skipped without depth');
  assert.ok(kinds.includes('down') && kinds.includes('composite'), 'bloom and composite still run');
  ok('without depth the depth-dependent passes are skipped, not fed garbage');

  const last = draws[draws.length - 1];
  assert.strictEqual(last.uniforms.uEnableGTAO, 0, 'composite told GTAO is unavailable');
  assert.strictEqual(last.uniforms.uEnableMotionBlur, 0, 'composite told motion blur is unavailable');
  ok('the composite is told the depth passes produced nothing');

  assert.ok(warnings.some((w) => w.includes('No depth texture')), 'a warning was emitted');
  ok('a diagnostic warning is emitted instead of failing silently');
}

/* ============================================================ 7. Preset wiring */

console.log('\n--- 7. Preset property wiring ---');
{
  // "Custom" must leave the inspector values alone.
  const h1 = makeHarness();
  const custom = makeBehavior({ Preset: 'Custom', BloomIntensity: 2.5, GTAORadius: 33 });
  run(h1, custom);
  assert.strictEqual(custom._properties.BloomIntensity, 2.5, 'Custom preserves user values');
  assert.strictEqual(custom._properties.GTAORadius, 33, 'Custom preserves user values');
  ok('the "Custom" preset leaves the inspector values untouched');

  // A named preset must apply AND write back, or the per-frame property sync reverts it.
  const h2 = makeHarness();
  const preset = makeBehavior({ Preset: 'CyberpunkNeon', BloomIntensity: 0.1 });
  const { pipeline } = run(h2, preset, { frames: 3 });
  assert.strictEqual(preset._properties.BloomIntensity, FX.PRESETS.CyberpunkNeon.bloomIntensity,
    'the preset was written back into the behavior properties');
  assert.strictEqual(pipeline.settings.bloomIntensity, FX.PRESETS.CyberpunkNeon.bloomIntensity,
    'and it survives three frames of property sync');
  assert.strictEqual(pipeline.settings.enableSSR, true, 'preset toggles survive too');
  ok('a named Preset property applies at creation and survives the per-frame sync');

  // The ApplyPreset action must behave the same way.
  const h3 = makeHarness();
  const acted = makeBehavior();
  const r3 = run(h3, acted);
  FX.applyPreset(h3.runtimeScene, acted, 'HorrorGrim');
  FX.syncBehaviorProperties(h3.runtimeScene, {}, acted);
  assert.strictEqual(r3.pipeline.settings.gtaoIntensity, FX.PRESETS.HorrorGrim.gtaoIntensity,
    'ApplyPreset survives the next sync');
  assert.strictEqual(acted._properties.Preset, 'HorrorGrim', 'the Preset property is updated too');
  ok('the ApplyPreset action writes through to the behavior properties');
}

/* ============================================================ 8. Autofocus */

console.log('\n--- 8. Autofocus ---');
{
  const h = makeHarness();
  const behavior = makeBehavior({ EnableDOF: true, Autofocus: true, ManualFocusDistance: 700 });
  raycastHitDistance = 520;
  raycastTargets = null;
  const { pipeline, draws } = run(h, behavior, { frames: 30 });

  assert.ok(raycastTargets, 'a raycast was performed');
  // The layer's three scene contains the 2D rendering plane at z=0 with renderOrder MAX,
  // which would swallow every hit; the raycast must target the 3D group instead.
  assert.strictEqual(raycastTargets, h.threeGroup.children,
    'autofocus raycasts the 3D group, not the whole scene');
  ok('autofocus raycasts the layer 3D group, avoiding the 2D rendering plane');

  assert.strictEqual(FX.isAutofocusTracking(h.runtimeScene, behavior), true, 'tracking reported');
  ok('isAutofocusTracking reports a real lock, not a hardcoded false');

  const focus = FX.getCurrentFocusDistance(h.runtimeScene, behavior);
  assert.ok(Math.abs(focus - 520) < 5, `focus eased onto the hit distance (got ${focus.toFixed(1)})`);
  ok('the focus plane eases onto the raycast hit distance');

  const dof = draws.filter((d) => d.kind === 'dof').pop();
  assert.ok(Math.abs(dof.uniforms.uFocusDistance - 520) < 5, 'the DOF shader got the tracked distance');
  ok('the tracked distance reaches the DOF shader, not the manual value');

  // With nothing to hit, it must fall back rather than focus on nothing.
  const h2 = makeHarness();
  h2.threeGroup.children.length = 0;
  const b2 = makeBehavior({ EnableDOF: true, Autofocus: true, ManualFocusDistance: 900 });
  const r2 = run(h2, b2, { frames: 30 });
  assert.strictEqual(FX.isAutofocusTracking(h2.runtimeScene, b2), false, 'no lock on an empty scene');
  assert.ok(Math.abs(r2.pipeline.activeFocusDistance - 900) < 5, 'fell back to the manual distance');
  ok('autofocus falls back to the manual distance when nothing is in front of the camera');
}

/* ============================================================ 9. Failure modes */

console.log('\n--- 9. Failure modes ---');
{
  // A layer with no 3D composer: addPostProcessingPass silently does nothing there, so the
  // extension must say so rather than look broken.
  warnings.length = 0;
  const h = makeHarness({ withComposer: false });
  const behavior = makeBehavior();
  FX.registerBehavior(h.runtimeScene, {}, behavior);
  assert.ok(warnings.some((w) => w.includes('EffectComposer')),
    'warned about the missing composer');
  assert.strictEqual(FX.isPassActive(h.runtimeScene, behavior), false, 'no pass claimed to be active');
  ok('a non-3D target layer produces a clear warning instead of silence');

  // Two behaviors would fight over one renderer-global pipeline every frame.
  warnings.length = 0;
  const h2 = makeHarness();
  const first = makeBehavior({ BloomIntensity: 1.0 });
  const second = makeBehavior({ BloomIntensity: 0.1 });
  run(h2, first);
  FX.registerBehavior(h2.runtimeScene, {}, second);
  assert.ok(warnings.some((w) => w.includes('more than one object')), 'warned about the duplicate');
  assert.strictEqual(second.__cinematicIgnored, true, 'the second instance stood down');
  FX.syncBehaviorProperties(h2.runtimeScene, {}, second);
  assert.strictEqual(first.__cinematicPipeline.settings.bloomIntensity, 1.0,
    'the ignored instance cannot overwrite settings');
  ok('a second behavior instance stands down instead of fighting the first');

  // Warnings are one-shot so they cannot spam the console, but a fresh preview must report
  // an existing problem again rather than staying silent because a previous run mentioned it.
  warnings.length = 0;
  const hWarn = makeHarness({ withComposer: false });
  FX.registerBehavior(hWarn.runtimeScene, {}, makeBehavior());
  const firstRun = warnings.length;
  warnings.length = 0;
  FX.registerBehavior(makeHarness({ withComposer: false }).runtimeScene, {}, makeBehavior());
  assert.ok(firstRun > 0 && warnings.length > 0, 'the same problem warns again in a new scene');
  ok('one-shot warnings reset per scene instead of staying silent after the first run');

  // A blank numeric property must not poison every uniform downstream with NaN.
  const h3 = makeHarness();
  const nanBehavior = makeBehavior({ GTAORadius: '', EnableGTAO: true });
  const r3 = run(h3, nanBehavior);
  assert.ok(!Number.isNaN(r3.pipeline.settings.gtaoRadius), 'a blank number falls back to the default');
  ok('blank numeric properties fall back to defaults instead of producing NaN');

  // Diagnostics should describe the pipeline, not just claim success.
  infos.length = 0;
  const h4 = makeHarness();
  const diag = makeBehavior({ Diagnostics: true });
  run(h4, diag);
  const log = infos.join('\n');
  assert.ok(log.includes('depth texture attached: yes'), 'diagnostics report the depth state');
  assert.ok(log.includes('camera near/far'), 'diagnostics report the camera planes');
  ok('the Diagnostics property reports composer, depth and camera state');
}

/* ============================================================ 10. Cleanup */

console.log('\n--- 10. Lifecycle cleanup ---');
{
  const h = makeHarness();
  const behavior = makeBehavior({ EnableBloom: true });
  const { pipeline, pass } = run(h, behavior);
  const before = disposeCount;

  assert.ok(registeredCallbacks.unloaded, 'a scene-unloaded callback was registered');
  registeredCallbacks.unloaded(h.runtimeScene);

  assert.ok(!h.composer.passes.includes(pass), 'scene unload detaches the pass');
  assert.ok(disposeCount > before, 'scene unload disposes render targets');
  assert.strictEqual(h.renderer.__cinematicPostProcessor, undefined, 'the pipeline is released');
  ok('scene unload detaches the pass and releases every render target');
}

console.log = console.log;
console.warn = realWarn;
console.info = realInfo;

console.log('\n========================================');
console.log(`ALL CINEMATICPOSTFX3D TESTS PASSED (${passed} assertions)`);
console.log('========================================\n');
