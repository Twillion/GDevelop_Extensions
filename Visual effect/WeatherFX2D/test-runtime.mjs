/**
 * WeatherFX2D runtime test suite.
 *
 * Run: node WeatherFX2D/test-runtime.mjs
 *
 * The tests that matter most here are the REGRESSION ones, because this extension exists to fix a
 * specific family of bugs that every naive implementation of these effects has:
 *
 *   - weather that only exists inside the world rectangle (0,0)-(resolution), so walking away from
 *     the origin makes it vanish;
 *   - a fixed world line where every particle wraps at once, so crossing one Y value makes the whole
 *     field visibly snap;
 *   - a filter whose framebuffer is sized from scene content, so its apparent amplitude and speed
 *     jump when the content bounds change.
 *
 * Each of those has a named test below. They are the point of the file - the rest is scaffolding.
 *
 * NOTE: this suite never compiles GLSL. The mocked PIXI.Filter stores the shader string and nothing
 * more, so a shader that cannot compile passes every test here and then silently draws nothing.
 * `check-shaders.mjs` covers what can be checked statically; the rest needs GDevelop.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'WeatherFX2D.runtime.js'), 'utf8');

/* ------------------------------------------------------------------ Engine mocks */

const callbacks = {};
globalThis.gdjs = {
  registerRuntimeSceneUnloadedCallback: (fn) => { callbacks.unloaded = fn; },
  registerRuntimeScenePostEventsCallback: (fn) => { callbacks.postEvents = fn; },
};

class Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x; this.y = y; this.width = width; this.height = height;
  }
}

class DisplayObject {
  constructor() {
    this.x = 0; this.y = 0;
    this.width = 0; this.height = 0;
    this.rotation = 0;
    this.alpha = 1;
    this.visible = true;
    this.zIndex = 0;
    this.parent = null;
    this.children = [];
    this.filters = null;
    this.filterArea = null;
    this.destroyed = false;
  }
  addChild(child) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
    return child;
  }
  destroy() { this.destroyed = true; }
}

class Container extends DisplayObject {}

class Sprite extends DisplayObject {
  constructor(texture) {
    super();
    this.texture = texture;
    this.tint = 0xffffff;
    this.blendMode = 0;
    this.anchor = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y === undefined ? x : y; } };
  }
}

class Filter {
  constructor(vertex, fragment, uniforms) {
    this.vertexSrc = vertex;
    this.fragmentSrc = fragment;
    this.uniforms = uniforms || {};
    this.padding = 0;
    this.autoFit = true;
    this.enabled = true;
    this.destroyed = false;
  }
  destroy() { this.destroyed = true; }
}

globalThis.PIXI = {
  Container,
  Sprite,
  Filter,
  Rectangle,
  Texture: { WHITE: { id: 'WHITE', baseTexture: {} }, from: () => ({ id: 'CANVAS', baseTexture: {} }) },
  BLEND_MODES: { NORMAL: 0, ADD: 1 },
  SCALE_MODES: { LINEAR: 1, NEAREST: 0 },
  RENDERER_TYPE: { WEBGL: 1, CANVAS: 2 },
};

// No `document`, so the runtime falls back to PIXI.Texture.WHITE for every particle. That is the
// crisp pixel-art path and the one worth exercising; the canvas path only changes which texture
// object is handed to the sprite.

const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

function makeLayer(name) {
  const container = new Container();
  return {
    name,
    container,
    cameraX: 0, cameraY: 0, zoom: 1, rotation: 0,
    getCameraX() { return this.cameraX; },
    getCameraY() { return this.cameraY; },
    getCameraZoom() { return this.zoom; },
    getCameraRotation() { return this.rotation; },
    getWidth() { return SCREEN_WIDTH; },
    getHeight() { return SCREEN_HEIGHT; },
    getRenderer() { return { getRendererObject: () => container }; },
  };
}

function makeScene() {
  const layers = { '': makeLayer(''), Background: makeLayer('Background') };
  const screen = new Rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  let elapsed = 16.6667;
  return {
    layers,
    screen,
    setElapsed(ms) { elapsed = ms; },
    getLayer(name) { return layers[name] !== undefined ? layers[name] : layers['']; },
    getTimeManager() { return { getElapsedTime: () => elapsed }; },
    getGame() {
      return {
        getGameResolutionWidth: () => SCREEN_WIDTH,
        getGameResolutionHeight: () => SCREEN_HEIGHT,
        getRenderer: () => ({
          getPIXIRenderer: () => ({ screen, type: PIXI.RENDERER_TYPE.WEBGL }),
        }),
      };
    },
  };
}

/* ------------------------------------------------------------------ Install */

// eslint-disable-next-line no-new-func
new Function(runtimeCode)();
const WFX = gdjs.__weatherFX2D;
assert.ok(WFX, 'runtime installed itself on gdjs');
const I = WFX._internals;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const near = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message || ''} expected ${expected} +/- ${tolerance}, got ${actual}`);
};

/* ================================================================== Helpers */

test('wrapSigned folds into a centred band', () => {
  near(I.wrapSigned(5, 100), 5, 1e-9);
  near(I.wrapSigned(60, 100), -40, 1e-9);
  near(I.wrapSigned(-60, 100), 40, 1e-9);
  near(I.wrapSigned(50, 100), -50, 1e-9);
});

test('wrapSigned resolves a teleport in one call', () => {
  // The whole reason this is a modulo and not a single subtract: a scene cut can move the camera
  // many field-widths at once, and a subtract would take that many frames to catch up.
  const result = I.wrapSigned(100000 + 7, 100);
  assert.ok(result >= -50 && result < 50, `expected inside the band, got ${result}`);
  near(result, 7, 1e-6);
});

test('wrapSigned leaves a degenerate span alone', () => {
  near(I.wrapSigned(37, 0), 37, 1e-9);
  near(I.wrapSigned(37, -5), 37, 1e-9);
});

test('wrapPositive folds into [0, span)', () => {
  near(I.wrapPositive(7, 100), 7, 1e-9);
  near(I.wrapPositive(107, 100), 7, 1e-9);
  near(I.wrapPositive(-7, 100), 93, 1e-9);
});

test('parseColorToHex accepts every form GDevelop hands over', () => {
  assert.strictEqual(I.parseColorToHex('255;128;0'), 0xff8000);
  assert.strictEqual(I.parseColorToHex('#ff8000'), 0xff8000);
  assert.strictEqual(I.parseColorToHex(0xff8000), 0xff8000);
  assert.strictEqual(I.parseColorToHex('nonsense', 0x123456), 0x123456);
  assert.strictEqual(I.parseColorToHex(undefined, 0x123456), 0x123456);
  assert.strictEqual(I.parseColorToHex('999;-5;0'), 0xff0000, 'components clamp to 0..255');
});

/* ================================================================== Option normalisation */

test('undefined options fall back to the type preset', () => {
  const snow = I.normalizeEmitterOptions({ type: 'Snow' });
  assert.strictEqual(snow.density, I.PRESETS.Snow.density);
  assert.strictEqual(snow.minSpeed, I.PRESETS.Snow.minSpeed);

  const rain = I.normalizeEmitterOptions({ type: 'Rain' });
  assert.strictEqual(rain.minSpeed, I.PRESETS.Rain.minSpeed);
  assert.ok(rain.minSpeed > snow.minSpeed * 5, 'rain is far faster than snow');
  assert.ok(rain.splashAmount > 0, 'rain brings splashes with it');
});

test('supplied options override the preset', () => {
  const custom = I.normalizeEmitterOptions({ type: 'Snow', density: 7, windAngle: 12 });
  assert.strictEqual(custom.density, 7);
  assert.strictEqual(custom.windAngle, 12);
  assert.strictEqual(custom.maxSpeed, I.PRESETS.Snow.maxSpeed, 'untouched fields still come from the preset');
});

test('an unknown type falls back to Snow rather than producing nothing', () => {
  const unknown = I.normalizeEmitterOptions({ type: 'Locusts' });
  assert.strictEqual(unknown.type, 'Snow');
  assert.strictEqual(unknown.density, I.PRESETS.Snow.density);
});

test('options are clamped into sane ranges', () => {
  const clamped = I.normalizeEmitterOptions({
    type: 'Snow', density: -50, opacity: 9000, softness: 4,
    minSize: 10, maxSize: 2, depthVariation: -3,
  });
  assert.strictEqual(clamped.density, 0);
  assert.strictEqual(clamped.opacity, 255);
  assert.strictEqual(clamped.softness, 1);
  assert.strictEqual(clamped.depthVariation, 0);
  assert.ok(clamped.maxSize >= clamped.minSize, 'an inverted size range is repaired, not honoured');
});

test('distortion modes carry their own defaults', () => {
  const heat = I.normalizeDistortionOptions({ mode: 'Heat Haze' });
  const water = I.normalizeDistortionOptions({ mode: 'Underwater' });
  const ripples = I.normalizeDistortionOptions({ mode: 'Ripples Only' });

  assert.strictEqual(heat.modeValue, 0);
  assert.strictEqual(water.modeValue, 1);
  assert.strictEqual(ripples.modeValue, 2);
  assert.ok(heat.horizonFade > 0, 'heat fades toward the top of the screen');
  assert.strictEqual(ripples.strength, 0, 'ripples-only has no standing wave');
  assert.ok(water.wavelengthY > heat.wavelengthY, 'underwater swims on a longer wavelength');
});

test('getPreset hands back a copy, not the live preset', () => {
  const copy = WFX.getPreset('Snow');
  copy.density = 999999;
  assert.notStrictEqual(I.PRESETS.Snow.density, 999999,
    'mutating the returned object must not rewrite the preset for every later call');
});

/* ================================================================== Camera maths */

test('field <-> world round-trips through pan, zoom and rotation', () => {
  for (const camera of [
    { x: 0, y: 0, zoom: 1, rotationRad: 0, viewWidth: 1920, viewHeight: 1080 },
    { x: 5000, y: -2500, zoom: 2.5, rotationRad: 0, viewWidth: 1920, viewHeight: 1080 },
    { x: -800, y: 640, zoom: 0.5, rotationRad: 0.7, viewWidth: 1920, viewHeight: 1080 },
  ]) {
    for (const [fx, fy] of [[0, 0], [300, -200], [-960, 540]]) {
      const worldX = I.fieldToWorldX(camera, fx, fy);
      const worldY = I.fieldToWorldY(camera, fx, fy);

      // Forward transform, copied from GDevelop's layer.js convertInverseCoords:
      //   screen = R(-rot) * (world - cam) * zoom
      const ex = worldX - camera.x;
      const ey = worldY - camera.y;
      const cos = Math.cos(-camera.rotationRad);
      const sin = Math.sin(-camera.rotationRad);
      const backX = (cos * ex - sin * ey) * camera.zoom;
      const backY = (sin * ex + cos * ey) * camera.zoom;

      near(backX, fx, 1e-6, 'field X round-trip');
      near(backY, fy, 1e-6, 'field Y round-trip');
    }
  }
});

test('buildCameraDelta is identity when the camera has not moved', () => {
  const camera = { x: 100, y: 200, zoom: 1.5, rotationRad: 0.3, viewWidth: 1920, viewHeight: 1080 };
  const delta = I.buildCameraDelta(camera, camera);
  near(delta.a, 1, 1e-9);
  near(delta.b, 0, 1e-9);
  near(delta.ox, 0, 1e-9);
  near(delta.oy, 0, 1e-9);
});

test('buildCameraDelta keeps a world-anchored point on the same world spot', () => {
  // This is the invariant the whole anchoring design rests on: carry a field coordinate through a
  // camera change and it must still name the same place on the map.
  const before = { x: 0, y: 0, zoom: 1, rotationRad: 0, viewWidth: 1920, viewHeight: 1080 };
  const after = { x: 640, y: -320, zoom: 2, rotationRad: 0.4, viewWidth: 1920, viewHeight: 1080 };

  const fx = 210;
  const fy = -90;
  const worldXBefore = I.fieldToWorldX(before, fx, fy);
  const worldYBefore = I.fieldToWorldY(before, fx, fy);

  const delta = I.buildCameraDelta(before, after);
  const movedX = delta.a * fx - delta.b * fy + delta.ox;
  const movedY = delta.b * fx + delta.a * fy + delta.oy;

  near(I.fieldToWorldX(after, movedX, movedY), worldXBefore, 1e-6, 'world X held');
  near(I.fieldToWorldY(after, movedX, movedY), worldYBefore, 1e-6, 'world Y held');
});

/* ================================================================== Emitter */

const STILL = {
  type: 'Snow', layerName: '', density: 40,
  minSpeed: 0, maxSpeed: 0, swayAmount: 0, swaySpeed: 0,
  gustStrength: 0, windSpread: 0, depthVariation: 0,
};

function startEmitter(scene, key, options) {
  WFX.registerEmitter(scene, key, options);
  WFX.stepEmitter(scene, key, options);
}

test('an emitter creates a container and fills it with sprites', () => {
  const scene = makeScene();
  startEmitter(scene, 'k', { type: 'Snow', density: 100 });
  const container = scene.layers[''].container.children[0];
  assert.ok(container, 'a container was parented to the layer');
  assert.ok(container.children.length > 0, 'sprites were created');
  assert.strictEqual(WFX.getParticleCount(scene, 'k'), container.children.length);
});

test('density means "particles visible on one screenful"', () => {
  const scene = makeScene();
  startEmitter(scene, 'k', { ...STILL, density: 200 });

  const camera = I.sampleCamera(scene, '');
  const config = I.normalizeEmitterOptions({ ...STILL, density: 200 });
  const padding = config.maxSize + 32;
  const fieldWidth = camera.viewWidth + padding * 2;
  const fieldHeight = camera.viewHeight + padding * 2;

  const stored = WFX.getParticleCount(scene, 'k');
  const onScreen = stored * ((camera.viewWidth * camera.viewHeight) / (fieldWidth * fieldHeight));
  near(onScreen, 200, 3, 'visible count matches the requested density');
});

test('intensity scales the particle count', () => {
  const scene = makeScene();
  startEmitter(scene, 'full', { ...STILL, density: 200, intensity: 1 });
  startEmitter(scene, 'half', { ...STILL, density: 200, intensity: 0.5 });
  const full = WFX.getParticleCount(scene, 'full');
  const half = WFX.getParticleCount(scene, 'half');
  near(half / full, 0.5, 0.05);
});

test('REGRESSION: weather is still on screen 10,000 px from the world origin', () => {
  // The original bug. Positions were written from getGameResolutionWidth() into a container the
  // camera transforms, so the field only ever existed inside the world rectangle (0,0)-(1920,1080)
  // and walking off it made the effect vanish entirely.
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL, density: 60 });

  layer.cameraX = 10000;
  layer.cameraY = 10000;
  WFX.stepEmitter(scene, 'k', { ...STILL, density: 60 });

  const sprites = layer.container.children[0].children;
  const onScreen = sprites.filter((s) =>
    Math.abs(s.x - layer.cameraX) <= SCREEN_WIDTH / 2 &&
    Math.abs(s.y - layer.cameraY) <= SCREEN_HEIGHT / 2);

  assert.ok(onScreen.length > sprites.length * 0.5,
    `expected most of the field on screen at (10000,10000), got ${onScreen.length}/${sprites.length}`);
});

test('REGRESSION: there is no world Y where the whole field wraps at once', () => {
  // The visible "SNAP". Recycling against a fixed world rectangle made every particle cross its
  // wrap line within a frame or two of each other, so the entire field jumped together.
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL, density: 80 });

  const sprites = layer.container.children[0].children;
  let worstFrameJumpCount = 0;

  for (let frame = 0; frame < 240; frame++) {
    const before = sprites.map((s) => s.y);
    layer.cameraY += 9; // a steady walk south, straight through where a fixed field edge would be
    WFX.stepEmitter(scene, 'k', { ...STILL, density: 80 });

    // A particle that wrapped moves by about a field height; ordinary tracking moves by ~9.
    const jumped = sprites.filter((s, i) => Math.abs(s.y - before[i]) > 500).length;
    worstFrameJumpCount = Math.max(worstFrameJumpCount, jumped);
  }

  assert.ok(worstFrameJumpCount < sprites.length * 0.25,
    `at most a quarter of the field may wrap in any one frame; saw ${worstFrameJumpCount}/${sprites.length}`);
});

test('world anchoring holds particles on the map while the camera pans', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL, anchoring: 'World' });
  WFX.stepEmitter(scene, 'k', { ...STILL, anchoring: 'World' });

  const sprites = layer.container.children[0].children;
  const before = sprites.map((s) => ({ x: s.x, y: s.y }));

  layer.cameraX += 40;
  layer.cameraY += 25;
  WFX.stepEmitter(scene, 'k', { ...STILL, anchoring: 'World' });

  // Only particles still inside the view must remain; particles outside may wrap normally.
  const interior = before.map((p, i) => ({ ...p, i })).filter(p =>
    Math.abs(p.x - layer.cameraX) < SCREEN_WIDTH / 2 &&
    Math.abs(p.y - layer.cameraY) < SCREEN_HEIGHT / 2);
  assert.ok(interior.length > 0);
  for (const p of interior) {
    near(sprites[p.i].x, p.x, 0.01);
    near(sprites[p.i].y, p.y, 0.01);
  }
});

test('screen anchoring carries particles along with the camera', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { ...STILL, anchoring: 'Screen' };
  startEmitter(scene, 'k', options);
  WFX.stepEmitter(scene, 'k', options);

  const sprites = layer.container.children[0].children;
  const before = sprites.map((s) => ({ x: s.x, y: s.y }));

  layer.cameraX += 40;
  layer.cameraY += 25;
  WFX.stepEmitter(scene, 'k', options);

  const carried = sprites.filter((s, i) =>
    Math.abs((s.x - before[i].x) - 40) < 0.01 && Math.abs((s.y - before[i].y) - 25) < 0.01).length;
  assert.ok(carried > sprites.length * 0.9,
    `screen-anchored particles move with the view; only ${carried}/${sprites.length} did`);
});

test('particle size is authored in screen pixels and survives a zoom', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { ...STILL, minSize: 4, maxSize: 4, density: 20 };
  startEmitter(scene, 'k', options);

  const sprite = layer.container.children[0].children[0];
  near(sprite.width * layer.zoom, 4, 1e-6, 'at zoom 1');

  layer.zoom = 3;
  WFX.stepEmitter(scene, 'k', options);
  near(sprite.width * layer.zoom, 4, 1e-6, 'still 4 screen px at zoom 3');
});

test('rain draws rotated streaks, snow draws unrotated dots', () => {
  const scene = makeScene();
  const layer = scene.layers[''];

  WFX.registerEmitter(scene, 'rain', { type: 'Rain', density: 30 });
  WFX.stepEmitter(scene, 'rain', { type: 'Rain', density: 30 });
  const rainSprite = layer.container.children[0].children[0];
  assert.ok(rainSprite.height > rainSprite.width, 'a raindrop is longer than it is wide');
  assert.notStrictEqual(rainSprite.rotation, 0, 'a raindrop is rotated to its travel angle');

  WFX.registerEmitter(scene, 'snow', { type: 'Snow', density: 30 });
  WFX.stepEmitter(scene, 'snow', { type: 'Snow', density: 30 });
  const snowSprite = layer.container.children[1].children[0];
  near(snowSprite.width, snowSprite.height, 1e-9, 'a flake is square');
  assert.strictEqual(snowSprite.rotation, 0);
});

test('embers use additive blending, snow does not', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  WFX.registerEmitter(scene, 'e', { type: 'Embers', density: 20 });
  WFX.stepEmitter(scene, 'e', { type: 'Embers', density: 20 });
  assert.strictEqual(layer.container.children[0].children[0].blendMode, PIXI.BLEND_MODES.ADD);

  WFX.registerEmitter(scene, 's', { type: 'Snow', density: 20 });
  WFX.stepEmitter(scene, 's', { type: 'Snow', density: 20 });
  assert.strictEqual(layer.container.children[1].children[0].blendMode, PIXI.BLEND_MODES.NORMAL);
});

test('a huge frame step is clamped instead of teleporting the field', () => {
  // A backgrounded tab hands over a multi-second elapsed time on the frame it regains focus.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Snow', density: 30, minSpeed: 100, maxSpeed: 100,
    swayAmount: 0, gustStrength: 0, windSpread: 0, depthVariation: 0 };
  startEmitter(scene, 'k', options);
  WFX.stepEmitter(scene, 'k', options);

  const sprite = layer.container.children[0].children[0];
  const before = sprite.y;
  scene.setElapsed(8000);
  WFX.stepEmitter(scene, 'k', options);

  const moved = Math.abs(sprite.y - before);
  assert.ok(moved <= 100 * 0.1 + 1e-6,
    `a step is clamped to 0.1 s, so at 100 px/s nothing may move more than 10 px; moved ${moved}`);
  scene.setElapsed(16.6667);
});

test('disabling hides the field without destroying it', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL });
  const container = layer.container.children[0];
  const count = container.children.length;

  WFX.stepEmitter(scene, 'k', { ...STILL, enabled: false });
  assert.strictEqual(container.visible, false);
  assert.strictEqual(container.children.length, count, 'particles survive so re-enabling is instant');

  WFX.stepEmitter(scene, 'k', { ...STILL, enabled: true });
  assert.strictEqual(container.visible, true);
});

test('changing the target layer re-homes the field', () => {
  const scene = makeScene();
  startEmitter(scene, 'k', { ...STILL, layerName: '' });
  assert.strictEqual(scene.layers[''].container.children.length, 1);

  WFX.stepEmitter(scene, 'k', { ...STILL, layerName: 'Background' });
  assert.strictEqual(scene.layers[''].container.children.length, 0, 'the old layer is left clean');
  assert.strictEqual(scene.layers.Background.container.children.length, 1);
});

test('disposing an emitter removes everything it made', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL });
  const container = layer.container.children[0];

  WFX.disposeEmitter(scene, 'k');
  assert.strictEqual(layer.container.children.length, 0);
  assert.ok(container.destroyed);
  assert.strictEqual(WFX.getParticleCount(scene, 'k'), 0);
});

test('rain splashes appear and expire; other types make none', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Rain', density: 20, splashAmount: 400 };
  startEmitter(scene, 'k', options);
  for (let i = 0; i < 12; i++) WFX.stepEmitter(scene, 'k', options);

  const total = layer.container.children[0].children.length;
  assert.ok(total > WFX.getParticleCount(scene, 'k'), 'splash sprites were added beyond the drops');

  // Turning the rate to 0 stops NEW rings; the ones already in the air fade out over their own
  // lifetime rather than popping out of existence mid-expansion.
  scene.setElapsed(100);
  for (let i = 0; i < 10; i++) WFX.stepEmitter(scene, 'k', { ...options, splashAmount: 0 });
  scene.setElapsed(16.6667);
  assert.strictEqual(layer.container.children[0].children.length, WFX.getParticleCount(scene, 'k'),
    'every ring eventually expired');
});

test('Ripples is a drawn-ring effect type with no falling particles', () => {
  // Their StartWaterRipple drew real rings with PIXI.Graphics rather than bending the image. That
  // is a different look from the distortion ripple and worth keeping, so it is its own type.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Ripples' };
  WFX.registerEmitter(scene, 'r', options);
  for (let i = 0; i < 30; i++) WFX.stepEmitter(scene, 'r', options);

  assert.strictEqual(WFX.getParticleCount(scene, 'r'), 0, 'nothing falls - the rings are the effect');
  assert.ok(layer.container.children[0].children.length > 0, 'rings were seeded across the view');
});

test('a ring can be spawned on demand at a scene position', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Ripples', splashAmount: 0 };
  WFX.registerEmitter(scene, 'r', options);
  WFX.stepEmitter(scene, 'r', options);
  assert.strictEqual(layer.container.children[0].children.length, 0);

  WFX.spawnParticleRipple(scene, 'r', 300, 120, 1);
  WFX.stepEmitter(scene, 'r', options);

  const ring = layer.container.children[0].children[0];
  assert.ok(ring, 'a ring appeared');
  near(ring.x, 300, 1, 'it landed on the requested scene X');
  near(ring.y, 120, 1, 'and scene Y');
});

test('an on-demand ring holds its place on the map while the camera moves', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Ripples', splashAmount: 0 };
  WFX.registerEmitter(scene, 'r', options);
  WFX.stepEmitter(scene, 'r', options);
  WFX.spawnParticleRipple(scene, 'r', 500, 500, 1);
  WFX.stepEmitter(scene, 'r', options);

  layer.cameraX += 260;
  layer.cameraY -= 140;
  WFX.stepEmitter(scene, 'r', options);

  const ring = layer.container.children[0].children[0];
  near(ring.x, 500, 1, 'still over the spot that spawned it');
  near(ring.y, 500, 1);
});

test('water rings stay on the surface with screen-anchored weather and camera changes', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Ripples', anchoring: 'Screen', splashAmount: 40 };
  WFX.startWeather(scene, '', options);
  for (let i = 0; i < 5; i++) callbacks.postEvents(scene);
  const rings = layer.container.children[0].children.map(sprite => ({ sprite, x: sprite.x, y: sprite.y }));
  assert.ok(rings.length > 0);
  WFX.setWeatherSetting(scene, '', 'Rings per second', 0);
  layer.cameraX += 400;
  layer.cameraY -= 170;
  WFX.spawnParticleRipple(scene, '', 123, 456, 1);
  callbacks.postEvents(scene);
  for (const ring of rings) {
    near(ring.sprite.x, ring.x, 1e-9);
    near(ring.sprite.y, ring.y, 1e-9);
  }
  const manual = layer.container.children[0].children.at(-1);
  near(manual.x, 123, 1e-9);
  near(manual.y, 456, 1e-9);
  layer.cameraX -= 900;
  layer.cameraY += 600;
  layer.zoom = 2;
  layer.rotation = 35;
  callbacks.postEvents(scene);
  near(manual.x, 123, 1e-9);
  near(manual.y, 456, 1e-9);
});

test('a ripple fired before the first step is queued, not dropped', () => {
  // "At the beginning of the scene" runs before the emitter has ever seen a camera.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { type: 'Ripples', splashAmount: 0 };
  WFX.registerEmitter(scene, 'r', options);

  WFX.spawnParticleRipple(scene, 'r', 80, 40, 1);
  assert.strictEqual(layer.container.children[0].children.length, 0, 'nothing to convert with yet');

  WFX.stepEmitter(scene, 'r', options);
  WFX.stepEmitter(scene, 'r', options);
  const ring = layer.container.children[0].children[0];
  assert.ok(ring, 'it appeared once a camera was available');
  near(ring.x, 80, 1);
});

/* ================================================================== Distortion */

test('a distortion attaches a filter and pins filterArea to exactly the screen', () => {
  // THE fix. `renderer.screen` is the one size PIXI's texture pool answers with an exact-fit
  // texture; anything else rounds up to the next power of two and the shader's uv scale jumps.
  const scene = makeScene();
  const layer = scene.layers[''];

  WFX.registerDistortion(scene, 'd', { mode: 'Heat Haze' });
  WFX.stepDistortion(scene, 'd', { mode: 'Heat Haze' });

  assert.strictEqual(layer.container.filters.length, 1);
  assert.strictEqual(layer.container.filterArea, scene.screen, 'pinned to the renderer screen itself');
  assert.strictEqual(layer.container.filterArea.width, SCREEN_WIDTH);
  assert.strictEqual(layer.container.filterArea.height, SCREEN_HEIGHT);
  assert.strictEqual(layer.container.filters[0].padding, 0,
    'any padding would push the request off the exact-fit path');
});

test('the filter is re-attached if something replaces the layer filter array', () => {
  // GDevelop rewrites `filters` wholesale when a layer effect is toggled.
  const scene = makeScene();
  const layer = scene.layers[''];
  WFX.registerDistortion(scene, 'd', { mode: 'Underwater' });
  WFX.stepDistortion(scene, 'd', { mode: 'Underwater' });

  layer.container.filters = [];
  WFX.stepDistortion(scene, 'd', { mode: 'Underwater' });
  assert.strictEqual(layer.container.filters.length, 1, 'the shader came back rather than going quiet');
});

test('an existing layer filter is preserved, not overwritten', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const theirs = new Filter(undefined, 'void main(){}', {});
  layer.container.filters = [theirs];

  WFX.registerDistortion(scene, 'd', { mode: 'Heat Haze' });
  WFX.stepDistortion(scene, 'd', { mode: 'Heat Haze' });
  assert.strictEqual(layer.container.filters.length, 2);
  assert.strictEqual(layer.container.filters[0], theirs);
});

test('every shader uniform is declared and supplied', () => {
  const source = I.DISTORTION_FRAGMENT_SHADER;
  const declared = new Set([...source.matchAll(/uniform\s+\w+\s+(\w+)\s*(?:\[\s*\d+\s*\])?\s*;/g)]
    .map((m) => m[1]));

  // PIXI supplies these automatically to every filter.
  const automatic = new Set(['uSampler', 'inputSize', 'outputFrame', 'inputClamp']);

  const scene = makeScene();
  WFX.registerDistortion(scene, 'd', { mode: 'Heat Haze' });
  const supplied = new Set(Object.keys(scene.layers[''].container.filters[0].uniforms));

  for (const name of declared) {
    if (automatic.has(name)) continue;
    assert.ok(supplied.has(name), `shader declares ${name} but the filter never supplies it`);
  }
  for (const name of supplied) {
    assert.ok(declared.has(name), `filter supplies ${name} but the shader never declares it`);
  }
});

test('the shader reads screen pixels from PIXI uniforms, not from vTextureCoord range', () => {
  const source = I.DISTORTION_FRAGMENT_SHADER;
  assert.ok(source.includes('vTextureCoord * inputSize.xy + outputFrame.xy'),
    'screen pixels must be recovered from inputSize/outputFrame');
  assert.ok(source.includes('inputClamp'),
    'edge sampling must clamp to inputClamp, not to 0..1 - a pow2 texture has dead padding past 1.0');
  assert.ok(/precision\s+highp\s+float/.test(source),
    'world pixel coordinates exceed mediump exact range within a screen or two of the origin');
  assert.ok(!/precision\s+mediump/.test(source));
});

test('wave phases stay folded to one turn however long it runs', () => {
  const scene = makeScene();
  const options = { mode: 'Underwater', speed: 3 };
  WFX.registerDistortion(scene, 'd', options);
  scene.setElapsed(100);
  for (let i = 0; i < 4000; i++) WFX.stepDistortion(scene, 'd', options);
  scene.setElapsed(16.6667);

  const phase = scene.layers[''].container.filters[0].uniforms.uPhase;
  for (let i = 0; i < 4; i++) {
    assert.ok(phase[i] >= 0 && phase[i] < Math.PI * 2 + 1e-6,
      `phase ${i} drifted out of one turn: ${phase[i]}`);
  }
});

test('world anchoring folds the origin to a seamless multiple of the wavelength', () => {
  // The harmonics are 2.3x and 2.7x the base, so folding at TEN wavelengths gives 23 and 27 whole
  // cycles and the fold is invisible for all three waves at once.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Underwater', wavelengthX: 100, wavelengthY: 200, anchoring: 'World' };
  WFX.registerDistortion(scene, 'd', options);
  WFX.stepDistortion(scene, 'd', options);

  const uniforms = layer.container.filters[0].uniforms;
  assert.ok(uniforms.uOrigin[0] >= 0 && uniforms.uOrigin[0] < 1000);
  assert.ok(uniforms.uOrigin[1] >= 0 && uniforms.uOrigin[1] < 2000);

  const originBefore = uniforms.uOrigin[0];
  layer.cameraX += 1000; // exactly ten wavelengths: the folded origin must land where it started
  WFX.stepDistortion(scene, 'd', options);
  near(uniforms.uOrigin[0], originBefore, 1e-6,
    'ten wavelengths is 10, 23 and 27 whole cycles of the three waves, so the fold is invisible');
});

test('world follow scales how far the camera drags the pattern', () => {
  // The reported bug: at follow 1 the pattern is glued to the map, so walking travels you THROUGH
  // it and adds to the apparent animation speed. Worst going up and down, where Heat Haze's 55px
  // vertical wavelength makes the coupling tightest.
  const scene = makeScene();
  const layer = scene.layers[''];
  const base = { mode: 'Underwater', wavelengthX: 1000, wavelengthY: 1000 };

  const originAfterWalk = (worldFollow) => {
    layer.cameraX = 0;
    layer.cameraY = 0;
    WFX.disposeDistortion(scene, 'd');
    WFX.registerDistortion(scene, 'd', { ...base, worldFollow });
    WFX.stepDistortion(scene, 'd', { ...base, worldFollow });
    const uniforms = layer.container.filters[0].uniforms;
    const before = uniforms.uOrigin[1];
    layer.cameraY += 400;
    WFX.stepDistortion(scene, 'd', { ...base, worldFollow });
    return uniforms.uOrigin[1] - before;
  };

  near(originAfterWalk(1), 400, 1e-6, 'fully glued to the map');
  near(originAfterWalk(0.3), 120, 1e-6, 'dragged along at 30%');
  near(originAfterWalk(0), 0, 1e-6, 'pinned to the screen');
});

test('a partial world follow still folds without a seam', () => {
  // The fold has to happen AFTER the follow is applied. Scaling an already-folded origin would move
  // the fold off the wavelength boundary and put a visible seam in the world.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Underwater', wavelengthX: 100, wavelengthY: 100, worldFollow: 0.5 };
  WFX.registerDistortion(scene, 'd', options);
  WFX.stepDistortion(scene, 'd', options);

  const uniforms = layer.container.filters[0].uniforms;
  const before = uniforms.uOrigin[0];
  // Ten wavelengths of PATTERN travel, which at half follow needs twice the camera travel.
  layer.cameraX += (100 * 10) / 0.5;
  WFX.stepDistortion(scene, 'd', options);
  near(uniforms.uOrigin[0], before, 1e-6);
});

test('the old World / Screen anchoring still maps onto follow', () => {
  assert.strictEqual(I.resolveWorldFollow({ anchoring: 'World' }), 1);
  assert.strictEqual(I.resolveWorldFollow({ anchoring: 'Screen' }), 0);
  assert.strictEqual(I.resolveWorldFollow({}), 1, 'unspecified anchoring is world anchored');
  assert.strictEqual(I.resolveWorldFollow({ worldFollow: 0.4 }), 0.4, 'an explicit value wins');
  assert.strictEqual(I.resolveWorldFollow({ worldFollow: 5 }), 1, 'clamped');
  assert.strictEqual(I.resolveWorldFollow({ worldFollow: -2 }), 0);
});

test('screen anchoring leaves the origin at zero', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Underwater', anchoring: 'Screen' };
  WFX.registerDistortion(scene, 'd', options);
  layer.cameraX = 7777;
  layer.cameraY = -321;
  WFX.stepDistortion(scene, 'd', options);

  const uniforms = layer.container.filters[0].uniforms;
  assert.strictEqual(uniforms.uOrigin[0], 0);
  assert.strictEqual(uniforms.uOrigin[1], 0);
});

test('ripples are stored in world space and converted to screen each frame', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Ripples Only' };
  WFX.registerDistortion(scene, 'd', options);

  WFX.spawnRipple(scene, 'd', 100, 50, 1);
  WFX.stepDistortion(scene, 'd', options);

  const uniforms = layer.container.filters[0].uniforms;
  assert.strictEqual(uniforms.uRippleCount, 1);
  near(uniforms.uRipples[0], 100 + SCREEN_WIDTH / 2, 1e-6, 'screen X with the camera at the origin');
  near(uniforms.uRipples[1], 50 + SCREEN_HEIGHT / 2, 1e-6);

  layer.cameraX = 100; // the camera now sits on the ripple, so it lands at screen centre
  WFX.stepDistortion(scene, 'd', options);
  near(uniforms.uRipples[0], SCREEN_WIDTH / 2, 1e-6, 'the ripple stayed over its spot on the map');
});

test('ripples expire and unused slots are marked dead', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Ripples Only', rippleLife: 0.5 };
  WFX.registerDistortion(scene, 'd', options);
  WFX.spawnRipple(scene, 'd', 0, 0, 1);
  WFX.stepDistortion(scene, 'd', options);
  assert.strictEqual(WFX.getRippleCount(scene, 'd'), 1);

  const uniforms = layer.container.filters[0].uniforms;
  assert.strictEqual(uniforms.uRipples[3 * 1 + 2], -1, 'unused slots carry a negative age');

  // Each step is clamped to 0.1 s no matter what the frame time was, so ageing a 0.5 s ripple out
  // takes several frames however long the tab was asleep.
  scene.setElapsed(600);
  for (let i = 0; i < 8; i++) WFX.stepDistortion(scene, 'd', options);
  scene.setElapsed(16.6667);
  assert.strictEqual(WFX.getRippleCount(scene, 'd'), 0);
});

test('a thirteenth ripple replaces the oldest rather than being dropped', () => {
  const scene = makeScene();
  const options = { mode: 'Ripples Only' };
  WFX.registerDistortion(scene, 'd', options);
  for (let i = 0; i < I.MAX_RIPPLES + 4; i++) WFX.spawnRipple(scene, 'd', i * 10, 0, 1);
  assert.strictEqual(WFX.getRippleCount(scene, 'd'), I.MAX_RIPPLES);

  WFX.stepDistortion(scene, 'd', options);
  const uniforms = scene.layers[''].container.filters[0].uniforms;
  // The four earliest were evicted, so slot 0 is now the fifth ripple spawned.
  near(uniforms.uRipples[0], 4 * 10 + SCREEN_WIDTH / 2, 1e-6);
});

test('disposing a distortion detaches the filter and releases filterArea', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  WFX.registerDistortion(scene, 'd', { mode: 'Heat Haze' });
  WFX.stepDistortion(scene, 'd', { mode: 'Heat Haze' });
  const filter = layer.container.filters[0];

  WFX.disposeDistortion(scene, 'd');
  assert.strictEqual(layer.container.filters.length, 0);
  assert.ok(filter.destroyed);
  assert.strictEqual(layer.container.filterArea, null);
});

test('disposing one of two distortions leaves the other one pinned', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  WFX.registerDistortion(scene, 'a', { mode: 'Heat Haze' });
  WFX.stepDistortion(scene, 'a', { mode: 'Heat Haze' });
  WFX.registerDistortion(scene, 'b', { mode: 'Underwater' });
  WFX.stepDistortion(scene, 'b', { mode: 'Underwater' });
  assert.strictEqual(layer.container.filters.length, 2);

  WFX.disposeDistortion(scene, 'a');
  assert.strictEqual(layer.container.filters.length, 1);
  assert.strictEqual(layer.container.filterArea, scene.screen,
    'dropping filterArea here would start the survivor snapping again');
});

test('all six distortion modes are distinct and ordered', () => {
  const modes = I.DISTORTION_MODES;
  const values = Object.values(modes);
  assert.strictEqual(new Set(values).size, values.length, 'no two modes share a number');
  assert.strictEqual(modes['Heat Haze'], 0);
  assert.strictEqual(modes.Underwater, 1);
  assert.strictEqual(modes['Ripples Only'], 2);
  assert.strictEqual(modes['Heat Shimmer'], 3);
  assert.strictEqual(modes['Tear Lines'], 4);
  assert.strictEqual(modes['Magnifier Band'], 5);

  // Every mode must carry a complete preset, or `pick()` silently falls through to a literal.
  const fields = Object.keys(I.DISTORTION_PRESETS['Heat Haze']);
  for (const name of Object.keys(modes)) {
    const preset = I.DISTORTION_PRESETS[name];
    assert.ok(preset, `${name} has no preset`);
    for (const field of fields) {
      assert.ok(preset[field] !== undefined, `${name} preset is missing ${field}`);
    }
  }
});

test('the shader branches cover every mode number exactly once', () => {
  // A mode that falls through every branch produces zero offset and looks broken but never errors,
  // so the branch bounds are worth asserting rather than eyeballing.
  const source = I.DISTORTION_FRAGMENT_SHADER;
  assert.ok(source.includes('if (uMode < 1.5)'), 'Heat Haze + Underwater');
  assert.ok(source.includes('uMode > 2.5 && uMode < 3.5'), 'Heat Shimmer');
  assert.ok(source.includes('uMode > 3.5 && uMode < 4.5'), 'Tear Lines');
  assert.ok(source.includes('uMode > 4.5'), 'Magnifier Band');
  // Mode 2 is meant to fall through everything - ripples only, no standing wave.
  assert.ok(!source.includes('uMode > 1.5 && uMode < 2.5'));
});

test('Heat Shimmer folds on the noise tile, every other mode on ten wavelengths', () => {
  // The fbm field tiles every 4096 cells, so its origin has to fold there or the pattern jumps at
  // the seam. The sine modes have 2.3x and 2.7x harmonics, so ten wavelengths is 23 and 27 whole
  // cycles and folds cleanly.
  assert.strictEqual(I.originFoldMultiplier(3), 4096);
  for (const mode of [0, 1, 2, 4, 5]) assert.strictEqual(I.originFoldMultiplier(mode), 10);

  assert.strictEqual(I.phaseFoldSpan(3), Math.PI * 2 * 4096);
  for (const mode of [0, 1, 2, 4, 5]) assert.strictEqual(I.phaseFoldSpan(mode), Math.PI * 2);
});

test('Heat Shimmer world origin folds without a seam', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Heat Shimmer', wavelengthX: 100, wavelengthY: 100, anchoring: 'World' };
  WFX.registerDistortion(scene, 'd', options);
  WFX.stepDistortion(scene, 'd', options);

  const uniforms = layer.container.filters[0].uniforms;
  const before = uniforms.uOrigin[0];
  layer.cameraX += 100 * 4096;
  WFX.stepDistortion(scene, 'd', options);
  near(uniforms.uOrigin[0], before, 1e-3, 'one full noise tile leaves the origin where it was');
});

test('tear strips are a whole number per cycle', () => {
  // Quantising happens in phase space, so a fractional strip count would make the last strip in
  // every cycle a different height and put a visible seam at the wrap.
  const config = I.normalizeDistortionOptions({ mode: 'Tear Lines', wavelengthY: 90, tearStripHeight: 4 });
  const bands = I.tearBandCount(config);
  assert.strictEqual(bands, Math.round(90 / 4));
  assert.strictEqual(bands, Math.floor(bands), 'a whole number of strips');

  assert.strictEqual(I.tearBandCount({ ...config, tearStripHeight: 0 }), 0, '0 means smooth edges');
  assert.strictEqual(I.tearBandCount({ ...config, tearStripHeight: 100000 }), 1, 'never below 1');
});

test('Tear Lines and Magnifier Band scroll their band at the plain speed', () => {
  // Both read the band position out of uPhase.y. The sine modes deliberately run that axis at 0.85
  // so the two axes do not beat; a band that scrolls at 0.85 of the requested speed is just wrong.
  const scene = makeScene();
  const layer = scene.layers[''];
  scene.setElapsed(1000);

  for (const mode of ['Tear Lines', 'Magnifier Band']) {
    const options = { mode, speed: 1 };
    WFX.registerDistortion(scene, mode, options);
    WFX.stepDistortion(scene, mode, options);
    const phase = layer.container.filters[layer.container.filters.length - 1].uniforms.uPhase;
    near(phase[1], phase[0], 1e-9, `${mode} advances uPhase.y at the same rate as uPhase.x`);
  }
  scene.setElapsed(16.6667);
});

test('intensity scales magnification around 1, not toward 0', () => {
  // Magnification is a ratio. Multiplying it by intensity would shrink the image at low intensity
  // instead of flattening the effect.
  const scene = makeScene();
  const layer = scene.layers[''];
  const options = { mode: 'Magnifier Band', magnification: 2 };

  WFX.registerDistortion(scene, 'd', options);
  WFX.stepDistortion(scene, 'd', options);
  const uniforms = layer.container.filters[0].uniforms;
  near(uniforms.uMagnification, 2, 1e-9);

  WFX.stepDistortion(scene, 'd', { ...options, intensity: 0.5 });
  near(uniforms.uMagnification, 1.5, 1e-9, 'halfway between no effect and full');

  WFX.stepDistortion(scene, 'd', { ...options, intensity: 0 });
  near(uniforms.uMagnification, 1, 1e-9, 'intensity 0 is no magnification at all');
});

test('the noise hash is bounded so it stays precise far from the origin', () => {
  const source = I.DISTORTION_FRAGMENT_SHADER;
  assert.ok(/cell = mod\(cell, 4096\.0\)/.test(source),
    'an unbounded hash argument loses precision and the shimmer degrades into repeating blocks');
});

/* ================================================================== Free-function path */

test('startWeather runs on its own through the post-events callback', () => {
  const scene = makeScene();
  WFX.startWeather(scene, '', { layerName: '', type: 'Snow', intensity: 1 });
  assert.ok(callbacks.postEvents, 'the runtime registered a post-events callback');

  callbacks.postEvents(scene);
  assert.ok(WFX.getParticleCount(scene, '') > 0,
    'one action starts it and it keeps stepping without an "update every frame" event');
});

test('calling startWeather again reconfigures rather than stacking a second field', () => {
  const scene = makeScene();
  WFX.startWeather(scene, '', { layerName: '', type: 'Snow', intensity: 1 });
  callbacks.postEvents(scene);
  const first = WFX.getParticleCount(scene, '');

  WFX.startWeather(scene, '', { layerName: '', intensity: 0.25 });
  callbacks.postEvents(scene);

  assert.strictEqual(scene.layers[''].container.children.length, 1, 'still exactly one container');
  assert.ok(WFX.getParticleCount(scene, '') < first, 'the new intensity took effect');
});

test('a partial update keeps the earlier options', () => {
  const scene = makeScene();
  WFX.startWeather(scene, '', { layerName: '', type: 'Rain', intensity: 1 });
  callbacks.postEvents(scene);

  WFX.startWeather(scene, '', { layerName: '', windAngle: 45 });
  callbacks.postEvents(scene);

  const sprite = scene.layers[''].container.children[0].children[0];
  assert.ok(sprite.height > sprite.width, 'still rain, not silently reset to snow');
});

test('behaviour keys and layer keys never collide', () => {
  const scene = makeScene();
  const behaviorA = {};
  WFX.startWeather(scene, '', { layerName: '', type: 'Snow' });
  WFX.registerEmitter(scene, behaviorA, { layerName: '', type: 'Rain' });
  WFX.stepEmitter(scene, behaviorA, { layerName: '', type: 'Rain' });
  assert.strictEqual(scene.layers[''].container.children.length, 2,
    'a layer-keyed system and a behavior-keyed system on the same layer stay separate');
});

test('global intensity and pause reach both subsystems', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL, density: 100 });
  WFX.registerDistortion(scene, 'd', { mode: 'Underwater' });
  WFX.stepDistortion(scene, 'd', { mode: 'Underwater' });
  const strengthAtFull = layer.container.filters[0].uniforms.uStrength;

  WFX.setGlobalIntensity(scene, 0.5);
  WFX.stepEmitter(scene, 'k', { ...STILL, density: 100 });
  WFX.stepDistortion(scene, 'd', { mode: 'Underwater' });
  near(layer.container.filters[0].uniforms.uStrength, strengthAtFull * 0.5, 1e-6);
  near(WFX.getGlobalIntensity(scene), 0.5, 1e-9);

  WFX.setPaused(scene, true);
  WFX.stepEmitter(scene, 'k', { ...STILL, density: 100 });
  WFX.stepDistortion(scene, 'd', { mode: 'Underwater' });
  assert.strictEqual(layer.container.children[0].visible, false);
  assert.strictEqual(layer.container.filters[0].enabled, false);
  assert.ok(WFX.isPaused(scene));
});

test('isActive reports both subsystems', () => {
  const scene = makeScene();
  assert.strictEqual(WFX.isActive(scene, 'Background'), false);
  WFX.startWeather(scene, 'Background', { layerName: 'Background', type: 'Fog' });
  assert.strictEqual(WFX.isActive(scene, 'Background'), true);
});

test('isSupported requires a WebGL renderer', () => {
  const scene = makeScene();
  assert.strictEqual(WFX.isSupported(scene), true);
  const canvasScene = makeScene();
  canvasScene.getGame = () => ({
    getGameResolutionWidth: () => SCREEN_WIDTH,
    getGameResolutionHeight: () => SCREEN_HEIGHT,
    getRenderer: () => ({ getPIXIRenderer: () => ({ screen: canvasScene.screen, type: 2 }) }),
  });
  assert.strictEqual(WFX.isSupported(canvasScene), false);
});

test('unloading a scene tears down every system it owned', () => {
  const scene = makeScene();
  const layer = scene.layers[''];
  startEmitter(scene, 'k', { ...STILL });
  WFX.registerDistortion(scene, 'd', { mode: 'Heat Haze' });
  WFX.stepDistortion(scene, 'd', { mode: 'Heat Haze' });

  callbacks.unloaded(scene);
  assert.strictEqual(layer.container.children.length, 0, 'no orphaned particle container');
  assert.strictEqual(layer.container.filters.length, 0, 'no orphaned filter');
  assert.strictEqual(scene.__weatherFX2D, null);
});

test('stepping an emitter that was never registered is a no-op, not a crash', () => {
  const scene = makeScene();
  WFX.stepEmitter(scene, 'ghost', { ...STILL });
  WFX.stepDistortion(scene, 'ghost', { mode: 'Heat Haze' });
  WFX.spawnRipple(scene, 'ghost', 0, 0, 1);
  WFX.disposeEmitter(scene, 'ghost');
  WFX.disposeDistortion(scene, 'ghost');
  assert.strictEqual(WFX.getParticleCount(scene, 'ghost'), 0);
});

test('an unknown layer name falls back to the base layer, as GDevelop does', () => {
  // getLayer(name) returns the base layer for any name it does not know, so a typo is silent.
  const scene = makeScene();
  startEmitter(scene, 'k', { ...STILL, layerName: 'Typo' });
  assert.strictEqual(scene.layers[''].container.children.length, 1);
});

test('packaged actions bootstrap and control effects without behavior objects', () => {
  const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));
  const saved = gdjs.__weatherFX2D;
  const run = (name, scene, args = {}) => {
    const fn = extension.eventsFunctions.find(f => f.name === name);
    assert.ok(fn, name);
    assert.ok(fn.parameters.every(p => p.type !== 'object' && p.type !== 'behavior'));
    const context = { getArgument: key => args[key] };
    for (const event of fn.events) new Function('runtimeScene', 'eventsFunctionContext', event.inlineCode)(scene, context);
    return context.returnValue;
  };
  try {
    for (const first of ['StartWeather', 'StartDistortion']) {
      delete gdjs.__weatherFX2D;
      const scene = makeScene();
      run(first, scene, { Layer: '', Type: 'Snow', Mode: 'Underwater', Intensity: 1 });
      assert.ok(gdjs.__weatherFX2D, 'start action installs runtime itself');
      run('StartWeather', scene, { Layer: '', Type: 'Snow', Intensity: 1 });
      run('StartDistortion', scene, { Layer: '', Mode: 'Underwater', Intensity: 1 });
      callbacks.postEvents(scene);
      assert.ok(run('ParticleCountOnLayer', scene, { Layer: '' }) > 0);
      for (const [kind, map] of [['Weather', I.WEATHER_NUMBER_FIELDS], ['Distortion', I.DISTORTION_NUMBER_FIELDS]]) {
        const selector = extension.eventsFunctions.find(f => f.name === `Set${kind}Setting`).parameters[1];
        assert.deepStrictEqual(JSON.parse(selector.supplementaryInformation), Object.keys(map));
        run(`Set${kind}Setting`, scene, { Layer: '', Setting: 'Intensity', Value: 0.4 });
        near(run(`${kind}Setting`, scene, { Layer: '', Setting: 'Intensity' }), 0.4, 1e-9);
      }
      run('SetWeatherSetting', scene, { Layer: '', Setting: 'Minimum speed', Value: 1 });
      run('SetWeatherType', scene, { Layer: '', Value: 'Rain' });
      near(run('WeatherSetting', scene, { Layer: '', Setting: 'Minimum speed' }), 700, 1e-9);
      run('SetWeatherAnchoring', scene, { Layer: '', Value: 'Screen' });
      run('SetDistortionMode', scene, { Layer: '', Value: 'Ripples Only' });
      callbacks.postEvents(scene);
      run('SpawnRipple', scene, { Layer: '', X: 100, Y: 120 });
      assert.strictEqual(run('RippleCountOnLayer', scene, { Layer: '' }), 1);
      run('SetWeatherFlag', scene, { Layer: '', Setting: 'Enabled', Value: false });
      run('SetDistortionFlag', scene, { Layer: '', Setting: 'Enabled', Value: false });
      callbacks.postEvents(scene);
      assert.strictEqual(scene.layers[''].container.children[0].visible, false);
      assert.strictEqual(scene.layers[''].container.filters[0].enabled, false);
      run('StopWeather', scene, { Layer: '' });
      run('StopDistortion', scene, { Layer: '' });
      assert.strictEqual(run('IsWeatherActive', scene, { Layer: '' }), false);
      callbacks.unloaded(scene);
      assert.strictEqual(scene.__weatherFX2D, null);
    }
  } finally {
    gdjs.__weatherFX2D = saved;
  }
});

test('every dedicated action bootstraps with defaults and configures its own effect', () => {
  const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));
  const saved = gdjs.__weatherFX2D;
  const actions = extension.eventsFunctions.filter(f => /^(Weather|Distortion) \/ /.test(f.group || ''));
  assert.strictEqual(actions.length, 52);
  const run = (fn, scene, overrides = {}) => {
    const args = Object.fromEntries(fn.parameters.map(p => [p.name,
      p.type === 'expression' ? Number(p.defaultValue) : p.type === 'yesorno' ? p.defaultValue === 'true' : p.defaultValue || '']));
    Object.assign(args, overrides);
    const context = { getArgument: key => args[key] };
    for (const event of fn.events) new Function('runtimeScene', 'eventsFunctionContext', event.inlineCode)(scene, context);
  };
  try {
    for (const fn of actions) {
      delete gdjs.__weatherFX2D;
      const scene = makeScene();
      assert.ok(fn.parameters.length <= 7, `${fn.name} has too many fields`);
      assert.ok(!fn.parameters.some(p => ['Type', 'Mode', 'Setting', 'Object', 'Behavior'].includes(p.name)));
      run(fn, scene, { Layer: 'Background' });
      callbacks.postEvents(scene);
      const shader = fn.group.startsWith('Distortion');
      const system = scene.__weatherFX2D[shader ? 'distortions' : 'emitters']['layer:Background'];
      assert.ok(system, fn.name);
      assert.strictEqual(system.autoOptions.layerName, 'Background');
      assert.ok(shader ? system.filter : system.container);
      callbacks.unloaded(scene);
    }
    const scene = makeScene();
    const action = name => actions.find(f => f.name === name);
    run(action('ConfigureSnowParticles'), scene, { Value_density: 17 });
    run(action('ConfigureSnowSwing'), scene, { Value_swayIrregularity: 0.8 });
    let options = scene.__weatherFX2D.emitters['layer:'].autoOptions;
    assert.strictEqual(options.density, 17, 'editing swing preserves particle settings');
    assert.strictEqual(options.swayIrregularity, 0.8);
    run(action('ConfigureRainFalling'), scene);
    options = scene.__weatherFX2D.emitters['layer:'].autoOptions;
    assert.strictEqual(options.type, 'Rain');
    assert.strictEqual(options.swayIrregularity, undefined, 'snow overrides do not leak into rain');
    callbacks.postEvents(scene);
    assert.strictEqual(gdjs.__weatherFX2D.getWeatherSetting(scene, '', 'Density'), 320);
    callbacks.unloaded(scene);
  } finally { gdjs.__weatherFX2D = saved; }
});

test('rain falls straight with stable per-drop angle and speed variation', () => {
  const scene = makeScene();
  WFX.startWeather(scene, '', { type: 'Rain', density: 10, splashAmount: 0 });
  callbacks.postEvents(scene);
  const system = scene.__weatherFX2D.emitters['layer:'];
  assert.strictEqual(I.PRESETS.Rain.windAngle, 90);
  assert.strictEqual(I.PRESETS.Rain.gustStrength, 0);
  const slopes = [];
  for (const p of system.particles) { p.fx = 0; p.fy = 0; }
  callbacks.postEvents(scene);
  for (const p of system.particles) slopes.push({ x: p.fx, y: p.fy });
  callbacks.postEvents(scene);
  system.particles.forEach((p, i) => {
    near(p.fx, slopes[i].x * 2, 1e-8);
    near(p.fy, slopes[i].y * 2, 1e-8);
    assert.ok(slopes[i].y > 0);
    assert.ok(Math.abs(slopes[i].x / slopes[i].y) <= Math.tan(3 * Math.PI / 180) + 1e-8);
  });
  assert.ok(new Set(slopes.map(p => p.y.toFixed(5))).size > 1, 'drop speeds vary');
});

test('snow swing reverses direction, stays bounded, and supports irregular flutter', () => {
  const scene = makeScene();
  WFX.startWeather(scene, '', { type: 'Snow', density: 1, minSpeed: 0, maxSpeed: 0,
    windAngle: 90, windSpread: 0, gustStrength: 0, swayAmount: 20, swaySpeed: 100, swayIrregularity: 0.8 });
  callbacks.postEvents(scene);
  const p = scene.__weatherFX2D.emitters['layer:'].particles[0];
  p.fx = 0; p.fy = 0; p.swayPhase = 0; p.swayRate = 1; p.angleJitter = 0;
  let positive = false, negative = false, previous = 0;
  for (let frame = 0; frame < 120; frame++) {
    callbacks.postEvents(scene);
    positive ||= p.fx > previous;
    negative ||= p.fx < previous;
    assert.ok(Math.abs(p.fx) <= 20 + 1e-8, 'swing stays within its configured distance');
    previous = p.fx;
  }
  assert.ok(positive && negative, 'flake swings both ways');
  assert.ok(Math.abs(p.fx) > 0.01, 'second frequency prevents a rigid one-second repeat');
});

test('event sentences use GDevelop scene offsets and keep values under the correct labels', () => {
  // GDevelop EventsFunctionsExtensionsLoader.ParametersIndexOffsets:
  // FreeFunction = 1 (hidden scene), BehaviorFunction = 0.
  const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));
  for (const owner of [extension, ...extension.eventsBasedBehaviors]) {
    const offset = owner === extension ? 1 : 0;
    for (const fn of owner.eventsFunctions) {
      if (fn.private || fn.functionType === 'Expression') continue;
      const actual = [...fn.sentence.matchAll(/_PARAM(\d+)_/g)].map(m => Number(m[1]) - offset);
      const expected = fn.parameters.flatMap((p, i) => p.type === 'behavior' ? [] : [i]);
      assert.deepStrictEqual(actual, expected, `${owner.name}.${fn.name}`);
    }
  }
  const fn = extension.eventsFunctions.find(f => f.name === 'SetDistortionFlag');
  const engineArguments = ['<hidden scene>', 'Base layer', 'Enabled', 'No'];
  const rendered = fn.sentence.replace(/_PARAM(\d+)_/g, (_, index) => engineArguments[Number(index)]);
  assert.strictEqual(rendered, 'Set distortion on layer Base layer; setting: Enabled; value: No');
});

test('direct distortion toggle has no redundant selector and preserves effect settings', () => {
  const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));
  const fn = extension.eventsFunctions.find(f => f.name === 'SetDistortionEnabled');
  assert.deepStrictEqual(fn.parameters.map(p => p.name), ['Layer', 'Enabled']);
  const scene = makeScene();
  WFX.startDistortion(scene, '', { mode: 'Underwater', strength: 7 });
  for (const enabled of [false, true]) {
    const context = { getArgument: key => key === 'Layer' ? '' : enabled };
    for (const event of fn.events) new Function('runtimeScene', 'eventsFunctionContext', event.inlineCode)(scene, context);
    callbacks.postEvents(scene);
    assert.strictEqual(scene.layers[''].container.filters[0].enabled, enabled);
    assert.strictEqual(WFX.getDistortionSetting(scene, '', 'Wave strength'), 7);
  }
});

test('every distortion defaults to full world anchoring and ripples stay on the map', () => {
  for (const mode of Object.keys(I.DISTORTION_MODES)) {
    const scene = makeScene();
    const layer = scene.layers[''];
    WFX.startDistortion(scene, '', { mode, speed: 0, wavelengthX: 100, wavelengthY: 100 });
    WFX.spawnRipple(scene, '', 50, 60, 1);
    callbacks.postEvents(scene);
    const uniforms = layer.container.filters[0].uniforms;
    const origin = [...uniforms.uOrigin];
    const ripple = [...uniforms.uRipples];
    layer.cameraX += 20;
    layer.cameraY += 30;
    callbacks.postEvents(scene);
    near(uniforms.uOrigin[0] - origin[0], 20, 1e-4, mode);
    near(uniforms.uOrigin[1] - origin[1], 30, 1e-4, mode);
    near(uniforms.uRipples[0] - ripple[0], -20, 1e-4, mode);
    near(uniforms.uRipples[1] - ripple[1], -30, 1e-4, mode);
  }
  const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));
  for (const fn of extension.eventsFunctions) {
    const placement = fn.parameters.find(p => p.name === 'Value_worldFollow');
    if (placement) assert.strictEqual(placement.defaultValue, '1');
  }
  assert.strictEqual(extension.eventsBasedBehaviors.find(b => b.name === 'ScreenDistortion2D')
    .propertyDescriptors.find(p => p.name === 'PlacementWorldFollow').value, '1');
});

test('heat and water oscillation phases are independent of camera travel', () => {
  const source = I.DISTORTION_FRAGMENT_SHADER;
  assert.ok(source.includes('sin(p.y * k.y) * sin(uPhase.x)'));
  assert.ok(source.includes('sin(p.x * k.x) * sin(uPhase.y)'));
  assert.ok(source.includes('sin(p.y * k.y * 2.3) * sin(uPhase.z)'));
  assert.ok(source.includes('sin(p.x * k.x * 2.7) * sin(uPhase.w)'));
  assert.ok(!source.includes('flow.y -= uPhase.x'));
  assert.ok(source.includes('(fbm(flow) - 0.5) * 2.0 * uStrength * sin(uPhase.x)'));
  for (const mode of ['Heat Haze', 'Underwater', 'Heat Shimmer']) {
    const stationary = makeScene(), moving = makeScene();
    WFX.startDistortion(stationary, '', { mode });
    WFX.startDistortion(moving, '', { mode });
    for (let frame = 0; frame < 120; frame++) {
      moving.layers[''].cameraY += frame < 60 ? 12 : -12;
      moving.layers[''].cameraX += 3;
      callbacks.postEvents(stationary);
      callbacks.postEvents(moving);
      const a = stationary.layers[''].container.filters[0].uniforms;
      const b = moving.layers[''].container.filters[0].uniforms;
      assert.deepStrictEqual([...a.uPhase], [...b.uPhase], mode);
      // A standing wave's temporal zero crossing is shared by every world position.
      for (const y of [0, 33, 999]) {
        near(Math.sin(y * 2 * Math.PI / b.uWavelength[1]) * Math.sin(0), 0, 1e-9);
      }
    }
  }
});

/* ================================================================== Run */

for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`\n  FAIL  ${name}\n        ${error.message}\n`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} tests passed`);
if (passed !== tests.length) {
  console.error(`${tests.length - passed} FAILED`);
}
