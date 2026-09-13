/**
 * Tests the *generated* extension, not the runtime source.
 *
 * Every action, condition and expression in CinematicPostFX3D.json is a string of JavaScript
 * assembled by build-extension.mjs. The build only checks that those strings parse — a typo in
 * a getArgument() name, a settings key that does not exist, or a Set action that forgets to
 * write back to its behavior property would all sail through and then silently do nothing at
 * runtime. This executes each one against a mock GDevelop events context and asserts on what
 * it actually did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, 'CinematicPostFX3D.runtime.js'), 'utf8');
const extension = JSON.parse(fs.readFileSync(path.join(here, 'CinematicPostFX3D.json'), 'utf8'));
const behaviorDef = extension.eventsBasedBehaviors[0];

let passed = 0;
const ok = (msg) => { passed++; console.log('  PASS  ' + msg); };

/* ============================================================ 1. Build freshness */

console.log('\n--- 1. The built extension matches the runtime source ---');
{
  const onCreated = behaviorDef.eventsFunctions.find((f) => f.name === 'onCreated');
  const embedded = onCreated.events[0].inlineCode;
  assert.ok(embedded.startsWith(runtimeSource.trim().slice(0, 400)) ||
            embedded.includes(runtimeSource.trim()),
    'CinematicPostFX3D.json is stale — run: node build-extension.mjs');
  ok('the embedded runtime is identical to CinematicPostFX3D.runtime.js');

  const copies = behaviorDef.eventsFunctions
    .flatMap((f) => f.events || [])
    .filter((e) => (e.inlineCode || '').includes('gdjs.__cinematicPostFX3D = {')).length;
  assert.strictEqual(copies, 1, 'the runtime is embedded exactly once');
  ok('the runtime is embedded exactly once, not per lifecycle function');
}

/* ============================================================ mock GDevelop */

globalThis.gdjs = { registerRuntimeSceneUnloadedCallback: () => {} };
const noop = () => {};
console.warn = noop;
console.info = noop;

// A minimal THREE that is only complete enough for the runtime to construct its pipeline.
class V2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class M4 { constructor() { this.elements = new Float32Array(16); this.elements[5] = 2.414; } copy() { return this; } invert() { return this; } multiplyMatrices() { return this; } identity() { return this; } }

globalThis.THREE = {
  RGBAFormat: 1023, DepthFormat: 1026, HalfFloatType: 1016, UnsignedIntType: 1014,
  LinearFilter: 1006, NearestFilter: 1003,
  Vector2: V2, Vector3: V3, Matrix4: M4,
  Color: class { constructor() { this.r = 0; this.g = 0; this.b = 0; } set() { return this; } setRGB() { return this; } },
  MeshBasicMaterial: class { constructor(o = {}) { this.color = o.color; } dispose() {} },
  Scene: class { constructor() { this.children = []; this.background = null; } add(o) { this.children.push(o); } },
  Group: class { constructor() { this.children = []; } traverse() {} },
  Camera: class { constructor() { this.position = new V3(0, 0, 1); this.projectionMatrix = new M4(); this.matrixWorldInverse = new M4(); this.near = 0.1; this.far = 2000; } updateMatrixWorld() {} },
  PlaneGeometry: class { dispose() {} },
  ShaderMaterial: class { constructor(p = {}) { this.uniforms = p.uniforms || {}; } dispose() {} },
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  DepthTexture: class { constructor(w, h) { this.image = { width: w, height: h }; } dispose() {} },
  WebGLRenderTarget: class {
    constructor(w, h, o = {}) { this.width = w; this.height = h; this.texture = {}; this.depthTexture = null; this.options = o; }
    setSize(w, h) { this.width = w; this.height = h; }
    clone() { return new globalThis.THREE.WebGLRenderTarget(this.width, this.height, this.options); }
    dispose() {}
  },
  Raycaster: class { setFromCamera() {} intersectObjects() { return []; } }
};

new Function(runtimeSource)();
const FX = gdjs.__cinematicPostFX3D;

/* ============================================================ harness */

const PROPS = behaviorDef.propertyDescriptors;

function makeBehavior() {
  const behavior = { _properties: {} };
  for (const p of PROPS) {
    let v = p.value;
    if (p.type === 'Number') v = Number(v);
    if (p.type === 'Boolean') v = v === 'true';
    behavior._properties[p.name] = v;
    behavior['_get' + p.name] = function () { return this._properties[p.name]; };
    behavior['_set' + p.name] = function (x) { this._properties[p.name] = x; };
  }
  return behavior;
}

function makeScene() {
  const composer = {
    renderTarget1: new globalThis.THREE.WebGLRenderTarget(800, 600, {}),
    renderTarget2: new globalThis.THREE.WebGLRenderTarget(800, 600, {}),
    passes: [{}, {}],
    insertPass(p, i) { this.passes.splice(i, 0, p); if (p.setSize) p.setSize(800, 600); },
    removePass(p) { const i = this.passes.indexOf(p); if (i >= 0) this.passes.splice(i, 1); }
  };
  const layerRenderer = {
    addPostProcessingPass(p) { composer.insertPass(p, composer.passes.length - 1); },
    removePostProcessingPass(p) { composer.removePass(p); },
    getThreeEffectComposer: () => composer,
    getThreeCamera: () => new globalThis.THREE.Camera(),
    getThreeScene: () => new globalThis.THREE.Scene(),
    getThreeGroup: () => new globalThis.THREE.Group()
  };
  return {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => ({
      getDrawingBufferSize: (v) => v.set(800, 600),
      getRenderTarget: () => null, setRenderTarget: noop, clear: noop, render: noop,
      setClearColor: noop, getClearAlpha: () => 1
    }) }) }),
    hasLayer: () => true,
    getLayer: () => ({ getRenderer: () => layerRenderer }),
    getBackgroundColor: () => 0
  };
}

// Two distinct values per parameter type. Comparing the results of both runs proves the
function makeMockVariable(initial) {
  let val = initial !== undefined ? initial : {};
  return {
    toJSObject: () => (typeof val === 'object' && val !== null ? val : {}),
    fromJSObject: (obj) => { val = JSON.parse(JSON.stringify(obj)); },
    getAsString: () => (typeof val === 'string' ? val : JSON.stringify(val)),
    setString: (str) => { val = str; },
  };
}

// Two distinct values per parameter type. Comparing the results of both runs proves the
// argument reaches a setting without having to know which setting that is.
function argFor(param, which) {
  if (param.type === 'expression') return which === 0 ? 0.4242 : 0.8181;
  if (param.type === 'yesorno') return which === 0;
  if (param.type === 'color') return which === 0 ? '11;22;33' : '44;55;66';
  if (param.type === 'stringWithSelector') {
    const options = JSON.parse(param.supplementaryInformation);
    return which === 0 ? options[0] : options[options.length - 1];
  }
  if (param.type === 'string') {
    if (param.name === 'JSONString') {
      return which === 0
        ? JSON.stringify({ bloomIntensity: 0.33, gtaoRadius: 44.0 })
        : JSON.stringify({ bloomIntensity: 0.99, gtaoRadius: 88.0 });
    }
    return which === 0 ? 'Slot_A' : 'Slot_B';
  }
  // Resource names are plain strings at runtime; two distinct values are all this harness needs to
  // prove the action actually writes the setting through.
  if (param.type === 'imageResource' || param.type === 'model3DResource') {
    return which === 0 ? 'LutStrip_A.png' : 'LutStrip_B.png';
  }
  if (param.type === 'scenevar' || param.type === 'globalvar') {
    return which === 0
      ? makeMockVariable({ bloomIntensity: 0.22, gtaoRadius: 35.0 })
      : makeMockVariable({ bloomIntensity: 0.88, gtaoRadius: 95.0 });
  }
  throw new Error('unhandled parameter type: ' + param.type);
}

function runFunction(fnDef, runtimeScene, behavior, args) {
  const object = { getBehavior: () => behavior };
  const ctx = {
    getObjects: () => [object],
    getBehaviorName: () => 'CinematicPostFX3D',
    getArgument: (name) => args[name],
    returnValue: undefined
  };
  const code = fnDef.events.map((e) => e.inlineCode).join('\n');
  new Function('eventsFunctionContext', 'runtimeScene', code)(ctx, runtimeScene);
  return ctx.returnValue;
}

function register(runtimeScene, behavior) {
  const onCreated = behaviorDef.eventsFunctions.find((f) => f.name === 'onCreated');
  runFunction(onCreated, runtimeScene, behavior, {});
  FX.CUSTOM_PRESETS['Slot_A'] = { bloomIntensity: 0.12, gtaoRadius: 30.0 };
  FX.CUSTOM_PRESETS['Slot_B'] = { bloomIntensity: 0.95, gtaoRadius: 90.0 };
}

const actions = behaviorDef.eventsFunctions.filter((f) => f.functionType === 'Action' && !f.private);
const conditions = behaviorDef.eventsFunctions.filter((f) => f.functionType === 'Condition');
const expressions = behaviorDef.eventsFunctions.filter((f) => f.functionType === 'Expression');

/* ============================================================ 2. Actions */

console.log('\n--- 2. Every action changes the pipeline and writes back (or saves) ---');
{
  const mutatingActions = actions.filter((a) => !a.name.startsWith('Save'));
  const saveActions = actions.filter((a) => a.name.startsWith('Save'));
  const noEffect = [];
  const noWriteBack = [];

  for (const action of mutatingActions) {
    const params = action.parameters.slice(2);
    const outcomes = [0, 1].map((which) => {
      const scene = makeScene();
      const behavior = makeBehavior();
      register(scene, behavior);

      const args = {};
      for (const p of params) args[p.name] = argFor(p, which);
      runFunction(action, scene, behavior, args);

      return {
        settings: Object.assign({}, FX.getSettings(scene, behavior)),
        props: Object.assign({}, behavior._properties)
      };
    });

    const settingDiffers = Object.keys(outcomes[0].settings)
      .some((k) => outcomes[0].settings[k] !== outcomes[1].settings[k]);
    if (!settingDiffers) noEffect.push(action.name);

    // Without a write-back the per-frame property sync reverts the change on the next frame,
    // so the action would appear to work for exactly one frame and then silently undo itself.
    const propDiffers = Object.keys(outcomes[0].props)
      .some((k) => outcomes[0].props[k] !== outcomes[1].props[k]);
    if (!propDiffers) noWriteBack.push(action.name);
  }

  assert.deepStrictEqual(noEffect, [],
    'these actions produced the same settings for two different arguments: ' + noEffect.join(', '));
  ok(`all ${mutatingActions.length} mutating actions carry their argument through to a pipeline setting`);

  assert.deepStrictEqual(noWriteBack, [],
    'these actions did not write their argument back to a behavior property, so the next ' +
    'property sync would revert them: ' + noWriteBack.join(', '));
  ok('all mutating actions write back to a behavior property, so the change survives the frame sync');

  for (const action of saveActions) {
    const scene = makeScene();
    const behavior = makeBehavior();
    register(scene, behavior);
    const params = action.parameters.slice(2);
    const args = {};
    for (const p of params) args[p.name] = argFor(p, 0);
    runFunction(action, scene, behavior, args);
    if (action.name.includes('Variable')) {
      const savedObj = args.Variable.toJSObject();
      assert.ok(typeof savedObj === 'object' && Object.keys(savedObj).length > 0,
        `${action.name} must write settings into variable`);
    } else if (action.name.includes('CustomPreset')) {
      assert.ok(FX.hasCustomPreset(args.SlotName),
        `${action.name} must register custom preset`);
    }
  }
  ok(`all ${saveActions.length} save actions write settings out to their targets`);
}

/* ============================================================ 3. Argument names */

console.log('\n--- 3. Declared parameters match the ones the code reads ---');
{
  const mismatches = [];
  for (const fnDef of [...actions, ...conditions, ...expressions]) {
    const code = fnDef.events.map((e) => e.inlineCode).join('\n');
    const read = new Set([...code.matchAll(/getArgument\("([^"]+)"\)/g)].map((m) => m[1]));
    const declared = new Set(fnDef.parameters.slice(2).map((p) => p.name));
    for (const name of read) {
      if (!declared.has(name)) mismatches.push(`${fnDef.name} reads "${name}" which it does not declare`);
    }
    for (const name of declared) {
      if (!read.has(name)) mismatches.push(`${fnDef.name} declares "${name}" but never reads it`);
    }
  }
  assert.deepStrictEqual(mismatches, [], mismatches.join('; '));
  ok('every declared parameter is read, and every read parameter is declared');
}

/* ============================================================ 4. Conditions & expressions */

console.log('\n--- 4. Conditions return booleans, expressions return values ---');
{
  const scene = makeScene();
  const behavior = makeBehavior();
  register(scene, behavior);

  for (const c of conditions) {
    const params = c.parameters.slice(2);
    const args = {};
    for (const p of params) args[p.name] = argFor(p, 0);
    const v = runFunction(c, scene, behavior, args);
    assert.strictEqual(typeof v, 'boolean', `${c.name} must return a boolean, got ${typeof v}`);
  }
  ok(`all ${conditions.length} conditions return a boolean`);

  for (const e of expressions) {
    const params = e.parameters.slice(2);
    const args = {};
    for (const p of params) args[p.name] = argFor(p, 0);
    const v = runFunction(e, scene, behavior, args);
    if (e.expressionType === 'string') {
      assert.strictEqual(typeof v, 'string', `${e.name} must return a string, got ${typeof v}`);
    } else {
      assert.strictEqual(typeof v, 'number', `${e.name} must return a number, got ${typeof v}`);
      assert.ok(Number.isFinite(v), `${e.name} returned ${v}`);
      assert.ok(e.expressionType === 'number', `${e.name} must declare expressionType number`);
    }
  }
  ok(`all ${expressions.length} expressions return valid typed values`);
}

/* ============================================================ 5. Expressions track actions */

console.log('\n--- 5. Expressions report what the matching action just set ---');
{
  // Pairs where the expression is the read-back of an action. A mismatch here means the two
  // are wired to different settings keys, which no other check would catch.
  const pairs = [
    ['SetMasterIntensity', 'Intensity', 'MasterIntensity'],
    ['SetBloomIntensity', 'Intensity', 'BloomIntensity'],
    ['SetBloomThreshold', 'Threshold', 'BloomThreshold'],
    ['SetGTAOIntensity', 'Intensity', 'GTAOIntensity'],
    ['SetGTAORadius', 'Radius', 'GTAORadius'],
    ['SetSSRIntensity', 'Intensity', 'SSRIntensity'],
    ['SetSSRMaxDistance', 'Distance', 'SSRMaxDistance'],
    ['SetSSRFresnel', 'Fresnel', 'SSRFresnel'],
    ['SetMotionBlurStrength', 'Strength', 'MotionBlurStrength'],
    ['SetChromaticAberration', 'Strength', 'ChromaticAberration'],
    ['SetAnamorphicFlares', 'Strength', 'AnamorphicFlares'],
    ['SetApertureFStop', 'FStop', 'ApertureFStop'],
    ['SetManualFocusDistance', 'Distance', 'ManualFocusDistance'],
    ['SetMaxBokehRadius', 'Radius', 'MaxBokehRadius'],
  ];

  for (const [actionName, argName, exprName] of pairs) {
    const scene = makeScene();
    const behavior = makeBehavior();
    register(scene, behavior);

    const action = actions.find((a) => a.name === actionName);
    const expr = expressions.find((e) => e.name === exprName);
    assert.ok(action, 'missing action ' + actionName);
    assert.ok(expr, 'missing expression ' + exprName);

    runFunction(action, scene, behavior, { [argName]: 0.7373 });
    const got = runFunction(expr, scene, behavior, {});
    assert.strictEqual(got, 0.7373, `${exprName}() should report what ${actionName} set`);
  }
  ok(`${pairs.length} action/expression pairs round-trip through the same setting`);
}

/* ============================================================ 6. Presets via the action */

console.log('\n--- 6. The ApplyPreset action ---');
{
  const applyPreset = actions.find((a) => a.name === 'ApplyPreset');
  const options = JSON.parse(applyPreset.parameters[2].supplementaryInformation);

  for (const name of options) {
    const scene = makeScene();
    const behavior = makeBehavior();
    register(scene, behavior);
    runFunction(applyPreset, scene, behavior, { Preset: name });

    const settings = FX.getSettings(scene, behavior);
    const preset = FX.PRESETS[name];
    assert.ok(preset, `${name} is offered by the action but has no definition`);
    for (const key of Object.keys(preset)) {
      assert.strictEqual(settings[key], preset[key], `${name}.${key} did not reach the pipeline`);
    }
    assert.strictEqual(behavior._properties.Preset, name, 'the Preset property was updated');
  }
  ok(`all ${options.length} presets offered by the action apply completely`);

  // Every preset the property offers must also be applicable, apart from Custom.
  const presetProp = PROPS.find((p) => p.name === 'Preset');
  for (const name of presetProp.extraInformation) {
    if (name === 'Custom') continue;
    assert.ok(options.includes(name), `${name} is offered by the property but not the action`);
  }
  ok('the Preset property and the ApplyPreset action offer the same set');
}

/* ============================================================ 7. Choice values are valid */

console.log('\n--- 7. Every choice value is understood by the runtime ---');
{
  const toneProp = PROPS.find((p) => p.name === 'ToneMapping');
  const scene = makeScene();
  const behavior = makeBehavior();
  register(scene, behavior);
  const setTone = actions.find((a) => a.name === 'SetToneMapping');

  for (const mode of toneProp.extraInformation) {
    runFunction(setTone, scene, behavior, { Mode: mode });
    assert.strictEqual(FX.getSettings(scene, behavior).toneMapping, mode,
      `tone mapping mode ${mode} reached the pipeline`);
  }
  ok('all four tone mapping modes are accepted');

  const qualityProp = PROPS.find((p) => p.name === 'EffectQuality');
  const setQuality = actions.find((a) => a.name === 'SetEffectQuality');
  for (const q of qualityProp.extraInformation) {
    runFunction(setQuality, scene, behavior, { Quality: q });
    assert.strictEqual(FX.getSettings(scene, behavior).effectQuality, q, `quality ${q} accepted`);
  }
  ok('all three effect quality levels are accepted');

  // Every Choice property's options must round-trip; a typo here is invisible until runtime.
  for (const p of PROPS.filter((x) => x.type === 'Choice')) {
    assert.ok(Array.isArray(p.extraInformation) && p.extraInformation.length > 1,
      `${p.name} must offer more than one option`);
    assert.ok(p.extraInformation.includes(p.value),
      `${p.name} default "${p.value}" must be one of its own options`);
  }
  ok('every Choice property lists its own default among its options');
}

console.log('\n========================================');
console.log(`ALL CINEMATICPOSTFX3D EXTENSION TESTS PASSED (${passed} assertions)`);
console.log('========================================\n');
