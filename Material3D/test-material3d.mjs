/**
 * test-material3d.mjs — drives the real Material3D runtime under Node with a stub THREE.
 *
 * Run: node Material3D/test-material3d.mjs
 *
 * This does NOT prove the extension works in GDevelop — only a run in the editor does that.
 * What it does prove is that the three mechanisms introduced by the merge behave as intended:
 * the property-override layer, material-class selection, and the BRDF composition hook. Those
 * are the parts a JSON lint cannot see, and the parts that fail silently in-engine.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ stub THREE */

class StubColor {
  constructor() { this.r = 1; this.g = 1; this.b = 1; }
  copy(o) { this.r = o.r; this.g = o.g; this.b = o.b; return this; }
  set() { return this; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
}
class BaseMat {
  constructor() {
    this.color = new StubColor();
    this.userData = {};
    this.name = '';
    this.wireframe = false;
    this.fog = true;
    this.transparent = false;
    this.opacity = 1;
    this.alphaTest = 0;
    this.side = 0;
    this.depthWrite = true;
    this.needsUpdate = false;
    this.disposed = false;
  }
  /**
   * Models THREE.Material.copy() faithfully, which the first version of this stub did not:
   *   - userData is JSON round-tripped, so an object stored there loses its prototype
   *   - custom direct properties (__brdfPatched, __brdfOriginalRef) are NOT carried over
   *   - onBeforeCompile is NOT carried over
   * Getting this wrong is what let "src.clone is not a function" reach GDevelop.
   */
  clone() {
    const c = new this.constructor();
    for (const k of ['name', 'wireframe', 'fog', 'transparent', 'opacity', 'alphaTest',
                     'side', 'depthWrite', 'roughness', 'metalness', 'emissiveIntensity',
                     'transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness',
                     'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      if (this[k] !== undefined) c[k] = this[k];
    }
    if (this.color) c.color = new StubColor().copy(this.color);
    if (this.emissive) c.emissive = new StubColor().copy(this.emissive);
    c.userData = JSON.parse(JSON.stringify(this.userData ?? {}));
    return c;
  }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial extends BaseMat { constructor() { super(); this.isMeshBasicMaterial = true; this.type = 'MeshBasicMaterial'; } }
class MeshStandardMaterial extends BaseMat {
  constructor() { super(); this.isMeshStandardMaterial = true; this.type = 'MeshStandardMaterial';
    this.roughness = 0.5; this.metalness = 0; this.emissive = new StubColor(); this.emissiveIntensity = 1; }
}
class MeshPhysicalMaterial extends MeshStandardMaterial {
  constructor() { super(); this.isMeshPhysicalMaterial = true; this.type = 'MeshPhysicalMaterial';
    this.transmission = 0; this.ior = 1.5; this.thickness = 0.01; this.clearcoat = 0; this.clearcoatRoughness = 0;
    // Native r160 fields used by the sheen / iridescence / anisotropy module.
    this.sheen = 0; this.sheenColor = new StubColor(); this.sheenRoughness = 1;
    this.iridescence = 0; this.iridescenceIOR = 1.3; this.iridescenceThicknessRange = [100, 400];
    this.anisotropy = 0; this.anisotropyRotation = 0; }
}

globalThis.THREE = {
  MeshBasicMaterial, MeshStandardMaterial, MeshPhysicalMaterial,
  Color: StubColor,
  FrontSide: 0, BackSide: 1, DoubleSide: 2,
  NormalBlending: 1, AdditiveBlending: 2, MultiplyBlending: 4,
  SRGBColorSpace: 'srgb', LinearSRGBColorSpace: 'srgb-linear',
  NearestFilter: 1003, LinearFilter: 1006,
  RepeatWrapping: 1000, Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } },
  Matrix3: class { setUvTransform() { return this; } identity() { return this; } },
  Texture: class { constructor() { this.userData = {}; } dispose() {} },
};

globalThis.gdjs = {};

/* ------------------------------------------------------------------ load runtime */

const chainSrc = fs.readFileSync(path.join(here, 'ShaderChain.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', chainSrc)(null, null);
const runtimeSrc = fs.readFileSync(path.join(here, 'Material3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', runtimeSrc)(null, null);
const M3 = globalThis.gdjs.__material3D;
if (!M3) { console.error('FAIL: runtime did not register gdjs.__material3D'); process.exit(1); }

/* ------------------------------------------------------------------ stub object/behavior */

const makeMesh = (name, mat) => ({
  isMesh: true, name, material: mat, geometry: {}, userData: {},
  castShadow: false, receiveShadow: false, renderOrder: 0,
  traverse(fn) { fn(this); },
});

const makeBehavior = (props) => {
  const b = {};
  for (const [k, v] of Object.entries(props)) {
    b['_get' + k] = () => v;
    b['_set' + k] = (nv) => { props[k] = nv; };
  }
  return b;
};

const DEFAULTS = {
  ApplyOnCreation: true, UpdateMode: 'Apply once', CloneMaterials: true, IncludeChildren: true,
  TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: '',
  ShaderType: 'Auto', UseBaseColor: false, BaseColor: '255;255;255',
  Roughness: 0.5, Metalness: 0, UseEmissive: false, EmissiveColor: '0;0;0', EmissiveStrength: 1,
  AlbedoMap: '', NormalMap: '', NormalScale: 1, RoughnessMap: '', MetalnessMap: '',
  AOMap: '', AOIntensity: 1, EmissiveMap: '',
  Transmission: 0, IOR: 1.5, Thickness: 0.1, Clearcoat: 0, ClearcoatRoughness: 0,
  TextureFiltering: 'Keep Original', TilingX: 1, TilingY: 1, OffsetX: 0, OffsetY: 0,
  RotationAngle: 0, RotationCenterX: 0.5, RotationCenterY: 0.5,
  EnableScroll: false, ScrollSpeedX: 0, ScrollSpeedY: 0, ScrollRotationSpeed: 0,
  EnableFlipbook: false, FlipbookColumns: 1, FlipbookRows: 1, FlipbookFPS: 12,
  FlipbookLoop: true, FlipbookTotalFrames: 0,
  AlphaMode: 'Preserve', Alpha: 1, AlphaCutoff: 0.1, DepthWrite: true,
  MaterialSide: 'Preserve', Wireframe: false, Fog: true,
  CastShadow: true, ReceiveShadow: true, RenderOrder: 0,
  Sheen: 0, SheenColor: '255;255;255', SheenRoughness: 1,
  Iridescence: 0, IridescenceIOR: 1.3, IridescenceThicknessMin: 100, IridescenceThicknessMax: 400,
  Anisotropy: 0, AnisotropyRotation: 0,
  Wetness: 0, Porosity: 0.5,
};

const setup = (overrideProps = {}, baseMat = new MeshStandardMaterial()) => {
  const mesh = makeMesh('Body', baseMat);
  const behavior = makeBehavior({ ...DEFAULTS, ...overrideProps });
  const object = { get3DRendererObject: () => mesh };
  const game = { getImageManager: () => ({ getPIXITexture: () => null }) };
  return { mesh, behavior, object, game };
};

/* ------------------------------------------------------------------ assertions */

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

console.log('\n1. Material class selection');
{
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('Auto with no physical props builds Standard',
    a.mesh.material.isMeshStandardMaterial && !a.mesh.material.isMeshPhysicalMaterial,
    a.mesh.material.type);

  const b = setup({ Transmission: 0.9 });
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('Auto with transmission builds Physical', b.mesh.material.isMeshPhysicalMaterial === true, b.mesh.material.type);
  check('  transmission actually assigned', b.mesh.material.transmission === 0.9, String(b.mesh.material.transmission));

  const c = setup({ Clearcoat: 0.5 });
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('Auto with clearcoat builds Physical', c.mesh.material.isMeshPhysicalMaterial === true, c.mesh.material.type);

  const d = setup({ ShaderType: 'Basic (unlit)' });
  M3.applyToBehavior(d.behavior, d.object, d.game);
  check('Explicit Basic builds Basic', d.mesh.material.isMeshBasicMaterial === true, d.mesh.material.type);

  const e = setup({ ShaderType: 'Physical (transmission, clearcoat)' });
  M3.applyToBehavior(e.behavior, e.object, e.game);
  check('Explicit Physical builds Physical even with no physical props',
    e.mesh.material.isMeshPhysicalMaterial === true, e.mesh.material.type);
}

console.log('\n2. Preserve defaults do not clobber the model');
{
  const authored = new MeshStandardMaterial();
  authored.transparent = true; authored.opacity = 0.4; authored.side = THREE.DoubleSide;
  const a = setup({}, authored);
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('AlphaMode Preserve keeps transparency', a.mesh.material.transparent === true);
  check('AlphaMode Preserve keeps opacity', a.mesh.material.opacity === 0.4, String(a.mesh.material.opacity));
  check('MaterialSide Preserve keeps DoubleSide', a.mesh.material.side === THREE.DoubleSide, String(a.mesh.material.side));

  const b = setup({ AlphaMode: 'Opaque' }, (() => { const m = new MeshStandardMaterial(); m.transparent = true; m.opacity = 0.4; return m; })());
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('AlphaMode Opaque does flatten transparency', b.mesh.material.transparent === false && b.mesh.material.opacity === 1);
}

console.log('\n3. Runtime override layer');
{
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('starts at property roughness', a.mesh.material.roughness === 0.5, String(a.mesh.material.roughness));

  M3.setOverride(a.behavior, 'Roughness', 0.9);
  check('override marks dirty', M3.isDirty(a.behavior) === true);
  M3.refreshSettings(a.behavior);
  check('refresh applies the override', a.mesh.material.roughness === 0.9, String(a.mesh.material.roughness));
  check('refresh clears dirty', M3.isDirty(a.behavior) === false);

  // The falsy-value trap: hasOwnProperty, not truthiness.
  M3.setOverride(a.behavior, 'Roughness', 0);
  M3.refreshSettings(a.behavior);
  check('override of 0 wins over the property', a.mesh.material.roughness === 0, String(a.mesh.material.roughness));

  M3.setOverride(a.behavior, 'Wireframe', true);
  M3.refreshSettings(a.behavior);
  check('boolean override applies', a.mesh.material.wireframe === true);

  M3.setOverride(a.behavior, 'CastShadow', false);
  M3.setOverride(a.behavior, 'RenderOrder', 7);
  M3.refreshSettings(a.behavior);
  check('mesh-level castShadow override applies', a.mesh.castShadow === false);
  check('mesh-level renderOrder override applies', a.mesh.renderOrder === 7, String(a.mesh.renderOrder));
}

console.log('\n4. Diagnostics reflect reality');
{
  const a = setup();
  check('state before apply is Uninitialized', M3.getStateName(a.behavior) === 'Uninitialized', M3.getStateName(a.behavior));
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('state after apply is Ready', M3.getStateName(a.behavior) === 'Ready', M3.getStateName(a.behavior));
  check('mesh count is 1', M3.getMeshCount(a.behavior) === 1, String(M3.getMeshCount(a.behavior)));
  check('material count is 1', M3.getMaterialCount(a.behavior) === 1, String(M3.getMaterialCount(a.behavior)));
  check('no error recorded', M3.getError(a.behavior) === '', M3.getError(a.behavior));
  check('material class reported as Standard', M3.getMaterialClassName(a.behavior) === 'Standard', M3.getMaterialClassName(a.behavior));

  const b = setup({ Transmission: 0.5 });
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('material class reported as Physical', M3.getMaterialClassName(b.behavior) === 'Physical', M3.getMaterialClassName(b.behavior));

  // No renderer at all — the failure must be visible, not silent.
  const c = setup();
  c.object.get3DRendererObject = () => null;
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('missing renderer reports a non-Ready state', M3.getStateName(c.behavior) !== 'Ready', M3.getStateName(c.behavior));
  check('  and matched zero meshes', M3.getMeshCount(c.behavior) === 0, String(M3.getMeshCount(c.behavior)));
}

console.log('\n5. Targeting by mesh name');
{
  const a = setup({ TargetMode: 'Mesh name', MeshName: 'Nope' });
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('non-matching mesh name matches nothing', M3.getMaterialCount(a.behavior) === 0, String(M3.getMaterialCount(a.behavior)));

  const b = setup({ TargetMode: 'Mesh name', MeshName: 'Body' });
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('matching mesh name matches one', M3.getMaterialCount(b.behavior) === 1, String(M3.getMaterialCount(b.behavior)));
}

console.log('\n6. Restore drops overrides');
{
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  M3.setOverride(a.behavior, 'Roughness', 0.99);
  const st = M3.getBehaviorState(a.behavior);
  M3.restoreOriginalMaterials(st, [a.mesh]);
  check('restore clears overrides', Object.keys(st.overrides).length === 0, JSON.stringify(st.overrides));
  check('restore clears dirty', st.dirty === false);
  check('restore resets state', st.state === 'Uninitialized', st.state);
}

console.log('\n7. BRDF composition hook');
{
  const brdfSrc = fs.readFileSync(path.join(here, 'BRDFMaterial.runtime.js'), 'utf8');
  new Function('runtimeScene', 'eventsFunctionContext', brdfSrc)(null, null);
  const B = globalThis.gdjs.__brdfMaterial3D;
  check('BRDF runtime registers', !!B);
  check('  and exports reapplyIfPatched', typeof B.reapplyIfPatched === 'function');

  const a = setup();
  // Nothing patched yet — the hook must be a no-op, not an error.
  check('reapplyIfPatched is a no-op when unpatched', B.reapplyIfPatched(a.object) === false);

  // Patch, then let Material3D swap the material out from under it.
  B.apply(a.object, B.readParams(makeBehavior({
    BRDFModel: 'oren-nayar', ColorR: 0.8, ColorG: 0.8, ColorB: 0.8, Roughness: 0.5,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
  })));
  check('BRDF patch marks the material', a.mesh.material.userData.__brdfPatched === true);
  check('  and records params for re-patching', !!a.mesh.userData.__brdf || !!a.object.get3DRendererObject().userData.__brdf);

  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('BRDF patch survives a Material3D apply', a.mesh.material.__brdfPatched === true,
    'patch was lost — the composition hook did not fire');
  check('  and the live material has an onBeforeCompile hook',
    typeof a.mesh.material.onBeforeCompile === 'function');

  // Regression: reported from GDevelop as "TypeError: src.clone is not a function".
  // THREE.Material.copy() JSON round-trips userData, so a Material stored there came back as a
  // plain object on the next clone. Repeated apply/clone cycles must stay stable.
  let threw = null;
  try {
    for (let i = 0; i < 4; i++) {
      M3.applyToBehavior(a.behavior, a.object, a.game);
      B.reapplyIfPatched(a.object);
    }
  } catch (e) { threw = e; }
  check('repeated apply + re-patch cycles do not throw', threw === null, threw && threw.message);
  check('  material is still patched after 4 cycles', a.mesh.material.__brdfPatched === true);
  check('  and the original reference is still a real material',
    typeof a.mesh.material.__brdfOriginalRef?.clone === 'function');

  // A clone of a patched material must not claim to be patched — it has no hook.
  const stray = a.mesh.material.clone();
  check('a clone of a patched material reads as unpatched',
    stray.__brdfPatched === undefined, 'clone inherited a stale patched flag');
}


console.log('\n8. Sheen / iridescence / anisotropy (native r160 fields)');
{
  const a = setup({ Sheen: 0.8, SheenRoughness: 0.3 });
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('Auto picks Physical for sheen', a.mesh.material.isMeshPhysicalMaterial === true, a.mesh.material.type);
  check('  sheen assigned', a.mesh.material.sheen === 0.8, String(a.mesh.material.sheen));
  check('  sheenRoughness assigned', a.mesh.material.sheenRoughness === 0.3, String(a.mesh.material.sheenRoughness));

  const b = setup({ Iridescence: 0.6, IridescenceIOR: 2.0, IridescenceThicknessMin: 200, IridescenceThicknessMax: 700 });
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('Auto picks Physical for iridescence', b.mesh.material.isMeshPhysicalMaterial === true);
  check('  iridescence assigned', b.mesh.material.iridescence === 0.6, String(b.mesh.material.iridescence));
  check('  thickness range assigned', b.mesh.material.iridescenceThicknessRange[0] === 200 &&
    b.mesh.material.iridescenceThicknessRange[1] === 700, JSON.stringify(b.mesh.material.iridescenceThicknessRange));

  const c = setup({ Anisotropy: 0.5, AnisotropyRotation: 90 });
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('Auto picks Physical for anisotropy', c.mesh.material.isMeshPhysicalMaterial === true);
  check('  anisotropyRotation converted to radians',
    Math.abs(c.mesh.material.anisotropyRotation - Math.PI / 2) < 1e-9, String(c.mesh.material.anisotropyRotation));

  // Min > max would produce an inverted range; the runtime clamps max up to min.
  const d = setup({ Iridescence: 0.5, IridescenceThicknessMin: 500, IridescenceThicknessMax: 100 });
  M3.applyToBehavior(d.behavior, d.object, d.game);
  check('inverted thickness range is corrected',
    d.mesh.material.iridescenceThicknessRange[1] >= d.mesh.material.iridescenceThicknessRange[0],
    JSON.stringify(d.mesh.material.iridescenceThicknessRange));
}

console.log('\n9. Wetness (CPU-side, no shader)');
{
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  const dryRough = a.mesh.material.roughness;
  check('dry roughness untouched', dryRough === 0.5, String(dryRough));

  M3.setOverride(a.behavior, 'Wetness', 1);
  M3.refreshSettings(a.behavior);
  check('fully wet drives roughness to the water film', Math.abs(a.mesh.material.roughness - 0.02) < 1e-9,
    String(a.mesh.material.roughness));

  M3.setOverride(a.behavior, 'Wetness', 0);
  M3.refreshSettings(a.behavior);
  check('drying restores the original roughness', Math.abs(a.mesh.material.roughness - 0.5) < 1e-9,
    String(a.mesh.material.roughness));

  // The ratchet bug: colour is not rewritten from a property when UseBaseColor is off, so a naive
  // implementation re-darkens the already-darkened colour every pass until the surface is black.
  const b = setup({ Porosity: 1 });
  M3.applyToBehavior(b.behavior, b.object, b.game);
  const before = b.mesh.material.color.r;
  M3.setOverride(b.behavior, 'Wetness', 0.5);
  for (let i = 0; i < 10; i++) M3.refreshSettings(b.behavior);
  const after = b.mesh.material.color.r;
  check('repeated wet passes do not compound the darkening',
    Math.abs(after - before * (1 - 0.5 * 1 * 0.35)) < 1e-6, `${before} -> ${after}`);

  M3.setOverride(b.behavior, 'Wetness', 0);
  M3.refreshSettings(b.behavior);
  check('drying restores the original colour', Math.abs(b.mesh.material.color.r - before) < 1e-6,
    String(b.mesh.material.color.r));

  // Metal has no pores: it goes glossy without darkening.
  const c = setup({ Porosity: 0 });
  M3.applyToBehavior(c.behavior, c.object, c.game);
  const metalBefore = c.mesh.material.color.r;
  M3.setOverride(c.behavior, 'Wetness', 1);
  M3.refreshSettings(c.behavior);
  check('zero porosity does not darken', Math.abs(c.mesh.material.color.r - metalBefore) < 1e-9);
  check('  but still goes glossy', Math.abs(c.mesh.material.roughness - 0.02) < 1e-9);
}

console.log('\n10. Shared shader chain');
{
  const chain = globalThis.gdjs.__m3dShaderChain;
  check('chain registered', !!chain);
  check('BRDF registered itself as an injector', chain.registeredIds().indexOf('brdf') >= 0,
    JSON.stringify(chain.registeredIds()));

  // Two injectors must both run. Before the chain, whichever assigned onBeforeCompile last won.
  const ran = [];
  chain.register({
    id: 'test-early', chunk: 'map_fragment', order: 100,
    isActive: (m) => m.__testEarly === true,
    key: () => 'v1',
    inject: (shader) => { ran.push('test-early'); shader.fragmentShader += '\n// early'; },
  });
  chain.register({
    id: 'test-late', chunk: 'roughnessmap_fragment', order: 900,
    isActive: (m) => m.__testLate === true,
    key: () => 'v1',
    inject: (shader) => { ran.push('test-late'); shader.fragmentShader += '\n// late'; },
  });

  const mat = new MeshStandardMaterial();
  mat.__testEarly = true;
  mat.__testLate = true;
  chain.install(mat);
  const shader = { uniforms: {}, fragmentShader: 'void main(){}', vertexShader: '' };
  mat.onBeforeCompile(shader);

  check('both injectors ran', ran.join(',') === 'test-early,test-late', ran.join(','));
  check('  ordered by declared order', ran[0] === 'test-early');
  check('  both edits are present in the shader',
    shader.fragmentShader.includes('// early') && shader.fragmentShader.includes('// late'));
  check('injectedIds reports what ran', chain.injectedIds(mat).join(',') === 'test-early,test-late',
    chain.injectedIds(mat).join(','));
  check('hasInjector answers per id', chain.hasInjector(mat, 'test-late') === true);

  // Cache key must distinguish feature combinations, or Three.js reuses one compiled program
  // across materials whose generated source differs.
  const keyBoth = mat.customProgramCacheKey();
  mat.__testLate = false;
  const keyOne = mat.customProgramCacheKey();
  check('cache key varies with the active set', keyBoth !== keyOne, `${keyBoth} vs ${keyOne}`);

  // A failing injector must not cost the others their edits.
  chain.register({
    id: 'test-throws', chunk: 'map_fragment', order: 50,
    isActive: (m) => m.__testEarly === true,
    key: () => 'v1',
    inject: () => { throw new Error('deliberate'); },
  });
  const shader2 = { uniforms: {}, fragmentShader: 'void main(){}', vertexShader: '' };
  let threw2 = null;
  try { mat.onBeforeCompile(shader2); } catch (e) { threw2 = e; }
  check('a throwing injector does not break the chain', threw2 === null, threw2 && threw2.message);
  check('  and the healthy injector still applied', shader2.fragmentShader.includes('// early'));

  // The copy() trap again, one level up: clones lose onBeforeCompile entirely.
  const cloned = mat.clone();
  check('a clone loses the chain hook', chain.isInstalled(cloned) === false);
  cloned.__testEarly = true;
  check('ensure() re-installs it', chain.ensure(cloned) === true);
  check('  and the clone is now hooked', chain.isInstalled(cloned) === true);
}

console.log('\n11. Chain survives a Material3D apply');
{
  const chain = globalThis.gdjs.__m3dShaderChain;
  const B = globalThis.gdjs.__brdfMaterial3D;
  const a = setup();
  B.apply(a.object, B.readParams(makeBehavior({
    BRDFModel: 'toon', ColorR: 0.8, ColorG: 0.8, ColorB: 0.8, Roughness: 0.5,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
  })));
  check('BRDF installed the chain, not a raw hook', chain.isInstalled(a.mesh.material) === true);

  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('chain is still installed after a material rebuild', chain.isInstalled(a.mesh.material) === true,
    'the ensure() pass in applyToBehavior did not run');
  check('  and BRDF is still an active injector on it',
    chain.activeFor(a.mesh.material).some((i) => i.id === 'brdf'));
}

console.log(`\n${'='.repeat(46)}`);
console.log(` ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail ? 1 : 0);
