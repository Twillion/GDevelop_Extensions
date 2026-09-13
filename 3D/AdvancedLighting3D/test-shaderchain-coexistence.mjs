/**
 * test-shaderchain-coexistence.mjs
 *
 * Phase 1 exit criterion: AdvancedLighting3D and MaterialMaster both edit the compiled shader, and
 * before this refactor each assigned `material.onBeforeCompile` directly. One function property,
 * two writers — the second silently won and the first's edits vanished with no error.
 *
 * What this file proves:
 *   - two extensions embedding ShaderChain resolve to ONE chain, in either load order
 *   - injectors from both land on the same material, ordered by band
 *   - the program cache key carries a fragment from each, so Three cannot reuse one's program
 *     for the other
 *   - a material swapped out by one extension is recovered for both by ensureAll()
 *   - teardown by one extension does not strip the other's injection
 *
 * What it does NOT prove: that the generated GLSL compiles. Node never runs a shader compiler, so
 * a broken chunk edit passes every assertion here and silently draws nothing. Preview in GDevelop.
 *
 * Run: node AdvancedLighting3D/test-shaderchain-coexistence.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const chainPath = path.join(here, '..', 'MaterialMaster', 'ShaderChain.runtime.js');
const chainSrc = fs.readFileSync(chainPath, 'utf8');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

/* ------------------------------------------------------------------ minimal environment */

class MockMaterial {
  constructor(name) {
    this.name = name || 'mat';
    this.isMeshStandardMaterial = true;
    this.needsUpdate = false;
    this.defines = {};
  }
  clone() {
    const m = new MockMaterial(this.name);
    // Three's copy() carries neither hook nor cache key — that is the whole clone hazard.
    for (const k of Object.keys(this)) {
      if (k === 'onBeforeCompile' || k === 'customProgramCacheKey') continue;
      if (k === '__m3dChainInstalled') continue;
      m[k] = this[k];
    }
    return m;
  }
  dispose() {}
}

const makeShader = () => ({
  uniforms: {},
  defines: {},
  fragmentShader: '#include <lights_fragment_begin>\n#include <roughnessmap_fragment>\nvoid main(){}',
  vertexShader: '#include <worldpos_vertex>\nvoid main(){}',
});

globalThis.THREE = { Vector2: class {}, Vector3: class {}, Vector4: class {} };

/** Fresh global state, then load the chain `times` times — one per extension embedding it. */
function bootChain(times = 1) {
  globalThis.gdjs = {};
  for (let i = 0; i < times; i++) {
    new Function('runtimeScene', 'eventsFunctionContext', chainSrc)(null, null);
  }
  return globalThis.gdjs.__m3dShaderChain;
}

/* Injector shaped like the real AdvancedLighting3D band-100 registration: everything per-material
 * is read from __alInjection, nothing is captured from an enrolment closure. */
const advLightInjector = (log) => ({
  id: 'advlight3d', chunk: 'lights_fragment_begin', order: 100,
  isActive: (mat) => !!(mat && mat.__alInjection),
  key: (mat) => (mat && mat.__alInjection && mat.__alInjection.key) || '',
  inject: (shader, mat) => {
    log.push('advlight3d');
    shader.defines.USE_CLUSTERED_LIGHTS = 1;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>', '// clustered lighting\n');
    mat.__alUniforms = shader.uniforms;
  },
});

/* Injector shaped like a MaterialMaster surface-band module. */
const materialMasterInjector = (log) => ({
  id: 'brdf', chunk: 'roughnessmap_fragment', order: 150,
  isActive: (mat) => mat && mat.__brdfMode !== undefined,
  key: (mat) => 'mode' + mat.__brdfMode,
  inject: (shader) => {
    log.push('brdf');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>', '// brdf override\n');
  },
});

function enrolAdvLight(mat, key) {
  mat.__alInjection = { key: key || 'GD_ADVLIGHT3D_V8|CL1', owner: {}, probes: false };
}

/* ------------------------------------------------------------------ tests */

console.log('\n1. Two extensions embedding ShaderChain resolve to one chain');
{
  const chain = bootChain(2);
  check('a second identical copy does not replace the first', !!chain && chain.VERSION === 2);
  check('shared state exists exactly once',
    !!globalThis.gdjs.__m3dShaderChainState &&
    globalThis.gdjs.__m3dShaderChainState.injectors.length === 0);
}

console.log('\n2. Both injectors land on one material — registration order A then B');
{
  const chain = bootChain(2);
  const log = [];
  chain.register(advLightInjector(log));
  chain.register(materialMasterInjector(log));

  const mat = new MockMaterial('shared');
  enrolAdvLight(mat);
  mat.__brdfMode = 3;
  chain.install(mat);

  const shader = makeShader();
  mat.onBeforeCompile(shader);

  check('both injectors ran', log.join(',') === 'advlight3d,brdf', log.join(','));
  check('  clustered lighting replaced its chunk',
    shader.fragmentShader.includes('// clustered lighting'));
  check('  and the BRDF override replaced its own',
    shader.fragmentShader.includes('// brdf override'));
  check('  neither chunk survives unedited',
    !shader.fragmentShader.includes('#include <lights_fragment_begin>') &&
    !shader.fragmentShader.includes('#include <roughnessmap_fragment>'));
  check('both ids recorded on the material',
    chain.injectedIds(mat).join(',') === 'advlight3d,brdf', chain.injectedIds(mat).join(','));
}

console.log('\n3. Same result with the opposite registration order — B then A');
{
  const chain = bootChain(2);
  const log = [];
  chain.register(materialMasterInjector(log));   // reversed
  chain.register(advLightInjector(log));

  const mat = new MockMaterial('shared');
  enrolAdvLight(mat);
  mat.__brdfMode = 3;
  chain.install(mat);
  mat.onBeforeCompile(makeShader());

  check('band order wins over registration order',
    log.join(',') === 'advlight3d,brdf', log.join(','));
}

console.log('\n4. The cache key distinguishes every combination');
{
  const chain = bootChain(2);
  chain.register(advLightInjector([]));
  chain.register(materialMasterInjector([]));

  const both = new MockMaterial('both');
  enrolAdvLight(both); both.__brdfMode = 3; chain.install(both);

  const lightOnly = new MockMaterial('light');
  enrolAdvLight(lightOnly); chain.install(lightOnly);

  const brdfOnly = new MockMaterial('brdf');
  brdfOnly.__brdfMode = 3; chain.install(brdfOnly);

  const kBoth = both.customProgramCacheKey();
  const kLight = lightOnly.customProgramCacheKey();
  const kBrdf = brdfOnly.customProgramCacheKey();

  check('the combined key carries both fragments',
    kBoth.includes('advlight3d:') && kBoth.includes('brdf:'), kBoth);
  check('a lighting-only material gets a different key', kLight !== kBoth, `${kLight} vs ${kBoth}`);
  check('a BRDF-only material gets a different key again',
    kBrdf !== kBoth && kBrdf !== kLight);
  check('a differing BRDF mode changes the key', (() => {
    const other = new MockMaterial('b2');
    enrolAdvLight(other); other.__brdfMode = 7; chain.install(other);
    return other.customProgramCacheKey() !== kBoth;
  })());
}

console.log('\n5. Material replacement recovers BOTH injections');
{
  const chain = bootChain(2);
  const log = [];
  chain.register(advLightInjector(log));
  chain.register(materialMasterInjector(log));

  const mat = new MockMaterial('swapped');
  enrolAdvLight(mat); mat.__brdfMode = 1;
  chain.install(mat);

  // A runtime swaps in a fresh material: the hook and the installed flag go with the old object.
  mat.onBeforeCompile = () => {};
  mat.__m3dChainInstalled = false;
  check('the swapped material reads as uninstalled', chain.isInstalled(mat) === false);

  chain.ensureAll();
  log.length = 0;
  mat.onBeforeCompile(makeShader());
  check('ensureAll() restores both injectors, not just one',
    log.join(',') === 'advlight3d,brdf', log.join(','));
}

console.log('\n6. One extension tearing down does not strip the other');
{
  const chain = bootChain(2);
  const log = [];
  chain.register(advLightInjector(log));
  chain.register(materialMasterInjector(log));

  const mat = new MockMaterial('teardown');
  enrolAdvLight(mat); mat.__brdfMode = 1;
  chain.install(mat);

  // AdvancedLighting3D's scene teardown: drop its own enrolment record, leave the chain alone.
  mat.__alInjection = null;
  log.length = 0;
  mat.onBeforeCompile(makeShader());

  check('the lighting injector stops applying', !log.includes('advlight3d'), log.join(','));
  check('  but the material keeps its chain hook', chain.isInstalled(mat) === true);
  check('  and the other extension still injects', log.join(',') === 'brdf', log.join(','));
}

console.log('\n7. Clone safety with both extensions active');
{
  const chain = bootChain(2);
  const log = [];
  chain.register(advLightInjector(log));
  chain.register(materialMasterInjector(log));

  const original = new MockMaterial('orig');
  enrolAdvLight(original); original.__brdfMode = 2;
  chain.install(original);

  const clone = original.clone();
  check('a clone loses the hook', chain.isInstalled(clone) === false);
  check('  and ensure() re-installs it', chain.ensure(clone) === true);

  log.length = 0;
  clone.onBeforeCompile(makeShader());
  check('  after which the clone runs both injectors',
    log.join(',') === 'advlight3d,brdf', log.join(','));
}

console.log(`\n${'='.repeat(50)}`);
console.log(` ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(50)}\n`);
process.exit(fail ? 1 : 0);
