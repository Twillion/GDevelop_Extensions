/**
 * test-materialmaster.mjs — drives every MaterialMaster runtime under Node with a stub THREE.
 *
 * Run: node MaterialMaster/test-materialmaster.mjs
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * It does NOT prove the extension works in GDevelop. Only loading it in the editor does that, and
 * two whole classes of failure are invisible here by construction: the stub THREE never compiles
 * GLSL, so a broken shader passes every check below and simply never draws; and nothing here
 * exercises how GDevelop actually loads and installs the runtimes.
 *
 * What it does prove is the behaviour a JSON lint cannot see and that fails silently in-engine:
 * the property-override layer, material-class selection, exact mesh/slot targeting, restoration,
 * shader-chain composition and clone survival, contributor attach/detach across material
 * generations, geometry ownership and disposal, the hot-path guards that keep static contributors
 * from resolving targets every frame, and the surface-expansion, neighbour-blending, tint and UV
 * arithmetic added for packed voxel grids.
 *
 * All twelve runtime files are loaded here; keep it that way when adding one.
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
    this.vertexColors = false;
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
                     'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
                     'vertexColors']) {
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
class StubTexture {
  constructor() {
    this.isTexture = true;
    this.wrapS = 1001;
    this.wrapT = 1001;
    this.userData = {};
    this.repeat = new THREE.Vector2(1,1);
    this.offset = new THREE.Vector2();
    this.center = new THREE.Vector2(.5,.5);
    this.rotation = 0;
    this.anisotropy = 1;
    this.needsUpdate = false;
    this.disposed = false;
    this.updates = 0;
  }
  clone() { const t = new StubTexture(); t.anisotropy = this.anisotropy; return t; }
  dispose() { this.disposed = true; }
  update() { this.updates++; }
}

class StubBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = Math.floor(array.length / itemSize);
    this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) {
    const idx = i * this.itemSize;
    this.array[idx] = x;
    this.array[idx + 1] = y;
    this.array[idx + 2] = z;
  }
}

class StubBufferGeometry {
  constructor() {
    this.attributes = {};
    this.groups = [];
    this.index = null;
    this.disposed = false;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  deleteAttribute(name) { delete this.attributes[name]; }
  computeVertexNormals() {
    if (this.attributes.position) {
      const count = this.attributes.position.count;
      if (!this.attributes.normal) {
        this.attributes.normal = new StubBufferAttribute(new Float32Array(count * 3), 3);
      }
      for (let i = 0; i < count; i++) {
        this.attributes.normal.setXYZ(i, 0, 1, 0);
      }
    }
  }
  computeBoundingBox() {}
  computeBoundingSphere() {}
  clone() {
    const g = new StubBufferGeometry();
    for (const [k, v] of Object.entries(this.attributes)) {
      g.setAttribute(k, new StubBufferAttribute(new Float32Array(v.array), v.itemSize));
    }
    g.groups = this.groups.map(grp => ({ ...grp }));
    if (this.index) g.index = { array: new Uint16Array(this.index.array), count: this.index.count };
    return g;
  }
  dispose() { this.disposed = true; }
}

class StubBoxGeometry extends StubBufferGeometry {
  constructor(width = 1, height = 1, depth = 1, ws = 1, hs = 1, ds = 1) {
    super();
    this.type = 'BoxGeometry';
    this.parameters = { width, height, depth, widthSegments: ws, heightSegments: hs, depthSegments: ds };
    const seg = ws;
    const faceVerts = (seg + 1) * (seg + 1);
    const totalVerts = 6 * faceVerts;
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);

    const faceNormals = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    let vIdx = 0;
    for (let f = 0; f < 6; f++) {
      const fn = faceNormals[f];
      this.groups.push({ start: f * seg * seg * 6, count: seg * seg * 6, materialIndex: f });
      for (let iy = 0; iy <= seg; iy++) {
        for (let ix = 0; ix <= seg; ix++) {
          const u = ix / seg;
          const v = 1 - (iy / seg);
          uvs[vIdx * 2] = u;
          uvs[vIdx * 2 + 1] = v;
          normals[vIdx * 3] = fn[0];
          normals[vIdx * 3 + 1] = fn[1];
          normals[vIdx * 3 + 2] = fn[2];

          const px = (u - 0.5) * width;
          const py = (v - 0.5) * height;
          if (fn[0] !== 0) {
            positions[vIdx * 3] = fn[0] * width * 0.5;
            positions[vIdx * 3 + 1] = py;
            positions[vIdx * 3 + 2] = px;
          } else if (fn[1] !== 0) {
            positions[vIdx * 3] = px;
            positions[vIdx * 3 + 1] = fn[1] * height * 0.5;
            positions[vIdx * 3 + 2] = py;
          } else {
            positions[vIdx * 3] = px;
            positions[vIdx * 3 + 1] = py;
            positions[vIdx * 3 + 2] = fn[2] * depth * 0.5;
          }
          vIdx++;
        }
      }
    }
    this.setAttribute('position', new StubBufferAttribute(positions, 3));
    this.setAttribute('normal', new StubBufferAttribute(normals, 3));
    this.setAttribute('uv', new StubBufferAttribute(uvs, 2));
    this.index = { count: 6 * seg * seg * 6, array: new Uint16Array(6 * seg * seg * 6) };
  }
}

globalThis.THREE = {
  MeshBasicMaterial, MeshStandardMaterial, MeshPhysicalMaterial,
  Color: StubColor,
  BufferAttribute: StubBufferAttribute,
  BufferGeometry: StubBufferGeometry,
  BoxGeometry: StubBoxGeometry,
  FrontSide: 0, BackSide: 1, DoubleSide: 2,
  NormalBlending: 1, AdditiveBlending: 2, MultiplyBlending: 4,
  SRGBColorSpace: 'srgb', LinearSRGBColorSpace: 'srgb-linear',
  NearestFilter: 1003, LinearFilter: 1006,
  RepeatWrapping: 1000, Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } },
  Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
  Matrix3: class { setUvTransform() { return this; } identity() { return this; } },
  Texture: StubTexture,
  // A minimal stand-in for the real chunk, carrying the one call BRDF rewrites. Without this the
  // injector cannot be exercised at all, which is how a shader edit reaches the engine untested.
  ShaderChunk: {
    lights_physical_pars_fragment: [
      'void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition,',
      '  const in vec3 geometryNormal, const in vec3 geometryViewDir, inout ReflectedLight reflectedLight ) {',
      '  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
      '  vec3 irradiance = dotNL * directLight.color;',
      '  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      '}',
      'void RE_IndirectDiffuse_Physical( const in vec3 irradiance, inout ReflectedLight reflectedLight ) {',
      '  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      '}',
    ].join('\n'),
  },
};

globalThis.gdjs = {};

/* ------------------------------------------------------------------ load runtime */

const chainSrc = fs.readFileSync(path.join(here, 'ShaderChain.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', chainSrc)(null, null);
const controllerSrc = fs.readFileSync(path.join(here, 'MaterialController3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', controllerSrc)(null, null);
const physicalSrc = fs.readFileSync(path.join(here, 'PhysicalMaterial3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', physicalSrc)(null, null);
const wetSrc = fs.readFileSync(path.join(here, 'WetMaterial3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', wetSrc)(null, null);
const animatedSrc = fs.readFileSync(path.join(here, 'AnimatedMaterial3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', animatedSrc)(null, null);
const patternMathSrc = fs.readFileSync(path.join(here, 'PatternMath3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', patternMathSrc)(null, null);
const geometryControllerSrc = fs.readFileSync(path.join(here, 'GeometryController3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', geometryControllerSrc)(null, null);
const meshBlendSrc = fs.readFileSync(path.join(here, 'MeshBlend3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', meshBlendSrc)(null, null);
const patternSrc = fs.readFileSync(path.join(here, 'PatternMaterial3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', patternSrc)(null, null);
const displacedSrc = fs.readFileSync(path.join(here, 'DisplacedMesh3D.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', displacedSrc)(null, null);
const runtimeSrc = fs.readFileSync(path.join(here, 'MaterialMaster.runtime.js'), 'utf8');
new Function('runtimeScene', 'eventsFunctionContext', runtimeSrc)(null, null);
const M3 = globalThis.gdjs.__material3D;
if (!M3) { console.error('FAIL: runtime did not register gdjs.__material3D'); process.exit(1); }

/* ------------------------------------------------------------------ stub object/behavior */

let nextMeshId = 1;
const makeMesh = (name, mat, geom = {}) => ({
  isMesh: true, name, uuid: `mesh-${nextMeshId++}`, material: mat, geometry: geom, userData: {},
  castShadow: false, receiveShadow: false, renderOrder: 0,
  traverse(fn) { fn(this); },
});

const makeBehavior = (props) => {
  const b = {};
  for (const [k, v] of Object.entries(props)) {
    b['_get' + k] = () => props[k];
    b['_set' + k] = (nv) => { props[k] = nv; };
  }
  return b;
};

const DEFAULTS = {
  ApplyOnCreation: true, UpdateMode: 'Apply once', CloneMaterials: true, IncludeChildren: true,
  TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: '',
  ShaderType: 'Auto', UseBaseColor: false, BaseColor: '255;255;255',
  UseRoughness: false, Roughness: 0.5, UseMetalness: false, Metalness: 0,
  UseEmissive: false, EmissiveColor: '0;0;0', EmissiveStrength: 1,
  AlbedoMap: '', NormalMap: '', NormalScale: 1, RoughnessMap: '', MetalnessMap: '',
  AOMap: '', AOIntensity: 1, EmissiveMap: '',
  Transmission: 0, IOR: 1.5, Thickness: 0.1, Clearcoat: 0, ClearcoatRoughness: 0,
  TextureFiltering: 'Keep Original', AnisotropicFiltering: '16x', TilingX: 1, TilingY: 1, OffsetX: 0, OffsetY: 0,
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
  const object = {
    get3DRendererObject: () => mesh,
    hasBehavior: (name) => name === 'MaterialCore3D' || name === 'MaterialMaster'
  };
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
  check('Core ignores extracted transmission fields', b.mesh.material.isMeshPhysicalMaterial !== true, b.mesh.material.type);
  check('  and does not assign transmission', b.mesh.material.transmission === undefined, String(b.mesh.material.transmission));

  const c = setup({ Clearcoat: 0.5 });
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('Core ignores extracted clearcoat fields', c.mesh.material.isMeshPhysicalMaterial !== true, c.mesh.material.type);

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
  check('legacy physical fields do not affect Core diagnostics', M3.getMaterialClassName(b.behavior) === 'Standard', M3.getMaterialClassName(b.behavior));

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
    BRDFModel: 'oren-nayar', Roughness: 0.5, FollowMaterialRoughness: false,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
  })));
  check('BRDF waits for Core targets instead of replacing the material', a.mesh.material.userData.__brdfPatched !== true);
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
  check('  and BRDF no longer keeps an original material clone reference',
    a.mesh.material.__brdfOriginalRef === undefined);

  // A clone of a patched material must not claim to be patched — it has no hook.
  const stray = a.mesh.material.clone();
  check('a clone of a patched material reads as unpatched',
    stray.__brdfPatched === undefined, 'clone inherited a stale patched flag');
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
    BRDFModel: 'toon', Roughness: 0.5, FollowMaterialRoughness: false,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
  })));
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('BRDF installed the chain on the Core-owned material', chain.isInstalled(a.mesh.material) === true);
  check('chain is still installed after a material rebuild', chain.isInstalled(a.mesh.material) === true,
    'the ensure() pass in applyToBehavior did not run');
  check('  and BRDF is still an active injector on it',
    chain.activeFor(a.mesh.material).some((i) => i.id === 'brdf'));
}


console.log('\n12. BRDF polish: ordering, dead sliders, honest diagnostics');
{
  const chain = globalThis.gdjs.__m3dShaderChain;
  const B = globalThis.gdjs.__brdfMaterial3D;

  const brdfBehavior = (over = {}) => makeBehavior({
    BRDFModel: 'oren-nayar', Roughness: 0.5, FollowMaterialRoughness: true,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5, ...over,
  });

  // The dead sliders are gone: readParams must not reach for colour getters that no longer exist.
  const params = B.readParams(brdfBehavior());
  check('readParams no longer reads colour', !('r' in params) && !('g' in params) && !('b' in params),
    Object.keys(params).join(','));
  check('  and does read the follow toggle', params.followMaterialRoughness === true);

  // BRDF is the base layer and must sort ahead of the modifier bands.
  const ids = chain.registeredIds();
  const early = { id: 'z-late-probe', chunk: 'roughnessmap_fragment', order: 500,
    isActive: (m) => m.__probe === true, key: () => 'v', inject: () => {} };
  chain.register(early);
  const mat = new MeshStandardMaterial();
  mat.__probe = true;
  const a = setup();
  B.apply(a.object, B.readParams(brdfBehavior()));
  M3.applyToBehavior(a.behavior, a.object, a.game);
  a.mesh.material.__probe = true;
  const order = chain.activeFor(a.mesh.material).map((i) => i.id);
  check('BRDF sorts before a band-400 modifier', order.indexOf('brdf') === 0, order.join(','));

  // Follow-material-roughness: the diffuse uniform tracks material.roughness.
  const b = setup({ Roughness: 0.9, UseRoughness: true });
  B.apply(b.object, B.readParams(brdfBehavior()));
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('diffuse roughness follows the material',
    Math.abs(b.mesh.material.__brdfUniforms.uBrdfRoughness.value - 0.9) < 1e-9,
    String(b.mesh.material.__brdfUniforms.uBrdfRoughness.value));

  // With the toggle off, the behavior's own number is authoritative again.
  const c = setup();
  B.apply(c.object, B.readParams(brdfBehavior({ FollowMaterialRoughness: false, Roughness: 0.25 })));
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('toggle off keeps the behavior roughness',
    Math.abs(c.mesh.material.__brdfUniforms.uBrdfRoughness.value - 0.25) < 1e-9,
    String(c.mesh.material.__brdfUniforms.uBrdfRoughness.value));

  // Unlit: BRDF has no lighting stage to patch. It must report that, not claim success.
  const d = setup();
  B.apply(d.object, B.readParams(brdfBehavior()));
  M3.applyToBehavior(d.behavior, d.object, d.game);
  const unlitShader = { uniforms: {}, fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }', vertexShader: '' };
  let unlitThrew = null;
  try { d.mesh.material.onBeforeCompile(unlitShader); } catch (e) { unlitThrew = e; }
  check('an unlit shader does not crash the chain', unlitThrew === null, unlitThrew && unlitThrew.message);
  check('  and brdf is NOT reported as injected', chain.hasInjector(d.mesh.material, 'brdf') === false,
    'it claimed to be active on a material with no lighting stage');

  // A lit shader: brdf must be reported as injected, and the diffuse call must be present.
  const e = setup();
  B.apply(e.object, B.readParams(brdfBehavior()));
  M3.applyToBehavior(e.behavior, e.object, e.game);
  const litShader = {
    uniforms: {},
    fragmentShader: '#include <common>\n#include <lights_physical_pars_fragment>\nvoid main(){}',
    vertexShader: '',
  };
  e.mesh.material.onBeforeCompile(litShader);
  check('a lit shader reports brdf injected', chain.hasInjector(e.mesh.material, 'brdf') === true);
  check('  and the custom diffuse call is in the source', litShader.fragmentShader.includes('brdfCustom('));
  check('  and the helper library was added', litShader.fragmentShader.includes('brdf_orenNayar'));
  check('  and runtime reports the patch active only after compilation', B.isPatchActive(e.object) === true);
}

console.log('\n13. BRDF lifecycle and exact material-slot targeting');
{
  const B = globalThis.gdjs.__brdfMaterial3D;
  const params = B.readParams(makeBehavior({
    BRDFModel: 'oren-nayar', Roughness: 0.5, FollowMaterialRoughness: false,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
  }));

  const mesh = makeMesh('Multi', [new MeshStandardMaterial(), new MeshStandardMaterial()]);
  const object = {
    get3DRendererObject: () => mesh,
    hasBehavior: (name) => name === 'MaterialCore3D' || name === 'MaterialMaster'
  };
  const behavior = makeBehavior({ ...DEFAULTS, TargetMode: 'Material index', MaterialIndex: 1 });
  const game = { getImageManager: () => ({ getThreeTexture: () => null }) };

  B.apply(object, params);
  M3.applyToBehavior(behavior, object, game);

  check('BRDF patches only the exact Core target slot',
    mesh.material[0].__brdfPatched !== true && mesh.material[1].__brdfPatched === true);
  check('Material3D retains only the selected slot after BRDF reattachment',
    M3.getBehaviorState(behavior).targetMaterials.length === 1 &&
    M3.getBehaviorState(behavior).targetMaterials[0] === mesh.material[1]);

  const untouchedRoughness = mesh.material[0].roughness;
  M3.setOverride(behavior, 'Roughness', 0.91);
  M3.refreshSettings(behavior);
  check('a later setter does not modify the neighboring material slot',
    mesh.material[0].roughness === untouchedRoughness && mesh.material[1].roughness === 0.91,
    `${mesh.material[0].roughness},${mesh.material[1].roughness}`);

  const priorLivePatch = mesh.material[1];
  B.apply(object, params);
  check('BRDF parameter reapply does not replace the Core-owned material', mesh.material[1] === priorLivePatch);
  M3.reapply(behavior, object, game);
  check('Core reapply disposes its previous material exactly once', priorLivePatch.disposed === true);
}

console.log('\n14. Shared material controller');
{
  const C = globalThis.gdjs.__materialController3D;
  check('controller runtime registers', !!C);

  const mesh = makeMesh('Controlled', [new MeshStandardMaterial(), new MeshStandardMaterial()]);
  const root = mesh;
  const calls = [];
  C.registerContributor(root, 'late', {
    id: 'late', order: 500,
    attach: (mat, context) => calls.push(`late:${context.slot}:${context.generation}`),
  });
  C.registerContributor(root, 'early', {
    id: 'early', order: 100,
    attach: (mat, context) => calls.push(`early:${context.slot}:${context.generation}`),
    requiresPhysical: () => true,
  });

  const generation1 = C.commitTargets(root, [{ mesh, slot: 1, material: mesh.material[1] }]);
  check('first target commit creates generation 1', generation1 === 1, String(generation1));
  check('contributors attach in declared order', calls.join(',') === 'early:1:1,late:1:1', calls.join(','));
  check('controller preserves the exact selected slot',
    C.getTargets(root).length === 1 && C.getTargets(root)[0].slot === 1);
  check('contributors negotiate Physical material requirement', C.requiredMaterialClass(root) === 'Physical');
  check('active contributor ids are ordered', C.activeContributorIds(root).join(',') === 'early,late');

  const replacement = new MeshStandardMaterial();
  mesh.material[1] = replacement;
  check('target lookup resolves the current live material, not a stale reference',
    C.getTargets(root)[0].material === replacement);

  C.requestUniformRefresh(root, 'early');
  C.requestShaderRebuild(root, 'pattern type');
  C.requestMaterialRebuild(root, 'class change');
  const requests = C.consumeRequests(root);
  check('controller separates uniform, shader, and material requests',
    requests.uniforms[0] === 'early' && requests.shader[0] === 'pattern type' &&
    requests.material[0] === 'class change');
  const emptyRequests = C.consumeRequests(root);
  check('consuming requests clears them',
    emptyRequests.uniforms.length === 0 && emptyRequests.shader.length === 0 && emptyRequests.material.length === 0);

  let detached = 0;
  C.registerContributor(root, 'removable', {
    id: 'removable', order: 700,
    detach: () => { detached++; },
  });
  C.unregisterContributor(root, 'removable');
  check('late registration attaches and unregister detaches the contributor', detached === 1, String(detached));
  const lifecycleOwner = {};
  const lifecycleTexture = new StubTexture();
  const lifecycleResource = { disposed: false, dispose() { this.disposed = true; } };
  C.acquireTextureClone(root, lifecycleOwner, lifecycleTexture);
  C.ownResource(root, lifecycleOwner, lifecycleResource);
  const ownedClone = C.getState(root, false).textureOwners.get(lifecycleOwner).get(lifecycleTexture);
  check('controller clear releases the root state', C.clear(root) === true && C.getState(root, false) === null);
  check('controller clear disposes resources regardless of behavior destruction order',
    ownedClone.disposed === true && lifecycleResource.disposed === true);
}

console.log('\n15. Physical Material contributor');
{
  const P = globalThis.gdjs.__physicalMaterial3D;
  check('Physical Material runtime registers', !!P);
  const a = setup();
  const physicalBehavior = makeBehavior({
    Transmission: 0.8, IOR: 1.45, Thickness: 0.25,
    Clearcoat: 0.4, ClearcoatRoughness: 0.2,
    Sheen: 0.3, SheenColor: '128;64;255', SheenRoughness: 0.6,
    Iridescence: 0.5, IridescenceIOR: 1.7,
    IridescenceThicknessMin: 200, IridescenceThicknessMax: 600,
    Anisotropy: 0.7, AnisotropyRotation: 90,
  });

  // Contributor-first lifecycle order: it registers before Core has produced target materials.
  P.sync(physicalBehavior, a.object);
  check('Physical contributor waits safely when Core has no targets',
    P.stateOf(physicalBehavior).state === 'WaitingForCore');
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('Core Auto mode negotiates Physical class from the contributor',
    a.mesh.material.isMeshPhysicalMaterial === true, a.mesh.material.type);
  check('Physical contributor applies fields after the Core commit',
    a.mesh.material.transmission === 0.8 && a.mesh.material.clearcoat === 0.4 &&
    a.mesh.material.iridescence === 0.5 && a.mesh.material.anisotropy === 0.7);
  check('Physical contributor converts anisotropy rotation to radians',
    Math.abs(a.mesh.material.anisotropyRotation - Math.PI / 2) < 1e-9,
    String(a.mesh.material.anisotropyRotation));
  check('controller reports the physical contributor',
    globalThis.gdjs.__materialController3D.activeContributorIds(a.mesh).includes('physical'));
}

console.log('\n16. Wet Material contributor');
{
  const W = globalThis.gdjs.__wetMaterial3D;
  check('Wet Material runtime registers', !!W);
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  const wetBehavior = makeBehavior({ Wetness: 0.5, Porosity: 1, WetRoughness: 0.02, DarkeningStrength: 0.4 });
  const dryColor = a.mesh.material.color.r;
  const dryRoughness = a.mesh.material.roughness;
  W.sync(wetBehavior, a.object);
  check('Wet contributor reaches Ready after Core has targets', W.stateOf(wetBehavior).state === 'Ready');
  check('Wet contributor darkens from the dry baseline',
    Math.abs(a.mesh.material.color.r - dryColor * 0.8) < 1e-6, String(a.mesh.material.color.r));
  check('Wet contributor blends roughness toward its configurable target',
    Math.abs(a.mesh.material.roughness - (dryRoughness + (0.02 - dryRoughness) * 0.5)) < 1e-9,
    String(a.mesh.material.roughness));
  for (let i = 0; i < 10; i++) W.sync(wetBehavior, a.object);
  check('repeated contributor sync does not compound darkening',
    Math.abs(a.mesh.material.color.r - dryColor * 0.8) < 1e-6, String(a.mesh.material.color.r));
  W.dispose(wetBehavior);
  check('removing Wet contributor restores the composed dry color',
    Math.abs(a.mesh.material.color.r - dryColor) < 1e-6, String(a.mesh.material.color.r));
  check('removing Wet contributor restores dry roughness',
    Math.abs(a.mesh.material.roughness - dryRoughness) < 1e-9, String(a.mesh.material.roughness));
  check('controller removes only the Wet contributor',
    !globalThis.gdjs.__materialController3D.activeContributorIds(a.mesh).includes('wetness'));
}

console.log('\n17. Animated Material contributor');
{
  const A = globalThis.gdjs.__animatedMaterial3D;
  check('Animated Material runtime registers', !!A);
  const source = new StubTexture();
  const base = new MeshStandardMaterial(); base.map = source;
  const a = setup({}, base);
  M3.applyToBehavior(a.behavior, a.object, a.game);
  const behavior = makeBehavior({
    TilingX: 2, TilingY: 3, OffsetX: .1, OffsetY: .2, RotationAngle: 0,
    RotationCenterX: .5, RotationCenterY: .5, EnableScroll: true,
    ScrollSpeedX: .5, ScrollSpeedY: .25, ScrollRotationSpeed: 90,
    EnableFlipbook: true, FlipbookColumns: 2, FlipbookRows: 2,
    FlipbookFPS: 10, FlipbookLoop: true, FlipbookTotalFrames: 4,
  });
  A.sync(behavior, a.object);
  const animatedTexture = a.mesh.material.map;
  check('Animated contributor clones mutable texture state', animatedTexture !== source);
  check('Animated contributor applies flipbook-scaled tiling',
    animatedTexture.repeat.x === 1 && animatedTexture.repeat.y === 1.5,
    `${animatedTexture.repeat.x},${animatedTexture.repeat.y}`);
  A.tick(behavior, a.object, 0.1);
  check('Animated contributor advances scrolling without a material rebuild',
    Math.abs(animatedTexture.offset.x - 0.65) < 1e-9 && Math.abs(animatedTexture.rotation - Math.PI/20) < 1e-9,
    `${animatedTexture.offset.x},${animatedTexture.rotation}`);
  check('Animated contributor advances the flipbook deterministically', A.stateOf(behavior).frame === 1);
  A.dispose(behavior);
  check('removing Animated contributor restores the original map', a.mesh.material.map === source);
  check('controller disposes the contributor-owned texture clone', animatedTexture.disposed === true);
}

console.log('\n18. Tiled Custom Pattern Material procedural shader');
{
  const P = globalThis.gdjs.__patternMaterial3D;
  check('Pattern Material runtime registers', !!P);
  const a = setup();
  M3.applyToBehavior(a.behavior, a.object, a.game);
  const behavior = makeBehavior({Enabled:true,PatternType:'Brick',ScaleX:8,ScaleY:4,Seed:42,GapWidth:.06,EdgeSoftness:.02,PrimaryColor:'200;100;50',SecondaryColor:'120;60;30',BorderColor:'30;30;30',TextureOverlayColor:'128;255;64',Saturation:.4,ColorVariation:.2,NoiseScale:2,NoiseStrength:.15,SurfaceRoughness:.65,BorderRoughness:.9,Metalness:0,Strength:1});
  P.sync(behavior,a.object);
  check('Pattern contributor attaches to the Core material', a.mesh.material.__m3dPattern?.enabled === true);
  check('Pattern injector is active before compilation',
    gdjs.__m3dShaderChain.activeFor(a.mesh.material).some(i=>i.id==='pattern-material'));
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <uv_vertex>\nvoid main(){}',fragmentShader:'#include <common>\nvoid main(){vec4 diffuseColor=vec4(1.);float roughnessFactor=.5;float metalnessFactor=0.;#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>}'};
  a.mesh.material.onBeforeCompile(shader);
  check('Pattern shader injects deterministic structure and noise functions',
    shader.fragmentShader.includes('m3dPattern(')&&shader.fragmentShader.includes('m3dNoise('));
  check('Pattern shader drives color, roughness and metalness',
    shader.fragmentShader.includes('diffuseColor.rgb*=')&&shader.fragmentShader.includes('roughnessFactor=mix')&&shader.fragmentShader.includes('metalnessFactor=mix'));
  check('Pattern shader applies RGB overlay tint and saturation',
    shader.fragmentShader.includes('uM3DPatternOverlayColor')&&shader.fragmentShader.includes('uM3DPatternSaturation'));
  const uniforms=a.mesh.material.__m3dPattern.uniforms;
  check('Pattern recipe values are uniforms', uniforms.uM3DPatternSeed.value===42&&uniforms.uM3DPatternScale.value.x===8&&uniforms.uM3DPatternSaturation.value===.4);
  check('RGB overlay is stored as a shader color uniform',
    !!uniforms.uM3DPatternOverlayColor.value&&uniforms.uM3DPatternOverlayColor.value.g>uniforms.uM3DPatternOverlayColor.value.r);
  behavior._setSeed(99);P.sync(behavior,a.object);
  check('changing recipe values updates stable uniforms without replacing material',
    a.mesh.material.__m3dPattern.uniforms===uniforms&&uniforms.uM3DPatternSeed.value===99,
    `${a.mesh.material.__m3dPattern.uniforms===uniforms},${uniforms.uM3DPatternSeed.value}`);
  P.dispose(behavior);
  check('removing Pattern contributor deactivates its shader feature', !a.mesh.material.__m3dPattern);

  // Standalone pattern test on an object with manual texture, without Core
  const manualMesh = { uuid: 'manual-mesh-1', isMesh: true, material: new MeshStandardMaterial() };
  manualMesh.material.map = new StubTexture(); // simulate manual texture added by user
  const standaloneObject = {
    get3DRendererObject: () => {
      return {
        isMesh: false,
        traverse: (cb) => { cb(manualMesh); }
      };
    }
  };
  const standaloneBehavior = makeBehavior({
    Enabled: true, PatternType: 'Hexagons', ScaleX: 6, ScaleY: 6, Seed: 77,
    GapWidth: 0.05, EdgeSoftness: 0.02, PrimaryColor: '220;180;100',
    SecondaryColor: '180;140;60', BorderColor: '30;20;10',
    TextureOverlayColor: '255;255;255', Saturation: 1, ColorVariation: 0.1,
    NoiseScale: 3, NoiseStrength: 0.2, SurfaceRoughness: 0.5,
    BorderRoughness: 0.8, Metalness: 0.1, Strength: 1
  });

  P.sync(standaloneBehavior, standaloneObject);
  check('Pattern functions standalone on object with manual texture without Core',
    P.stateOf(standaloneBehavior).state === 'Ready');
  check('Pattern attaches to manual mesh material in standalone mode',
    manualMesh.material.__m3dPattern?.enabled === true);
  check('ShaderChain is installed on manual mesh material in standalone mode',
    gdjs.__m3dShaderChain.isInstalled(manualMesh.material) === true);
  check('OverwriteTexture defaults to true when omitted',
    P.read(standaloneBehavior).overwriteTexture === true);
  check('uM3DPatternOverwriteTexture uniform is 1 when enabled',
    manualMesh.material.__m3dPattern.uniforms.uM3DPatternOverwriteTexture.value === 1);
  check('AutoTiling defaults to true when omitted',
    P.read(standaloneBehavior).autoTiling === true);
  check('uM3DPatternAutoTiling uniform is 1 when enabled',
    manualMesh.material.__m3dPattern.uniforms.uM3DPatternAutoTiling.value === 1);

  const standaloneShader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <uv_vertex>\nvoid main(){}',
    fragmentShader: '#include <common>\nvoid main(){\nvec4 diffuseColor=vec4(1.);\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n}'
  };
  manualMesh.material.onBeforeCompile(standaloneShader);
  check('Standalone pattern shader injects successfully',
    standaloneShader.fragmentShader.includes('m3dPattern(') &&
    gdjs.__m3dShaderChain.injectedIds(manualMesh.material).includes('pattern-material'));
  check('Standalone pattern does not duplicate uv attribute in vertex shader',
    !standaloneShader.vertexShader.includes('attribute vec2 uv'));
  check('Standalone pattern injects overwrite texture branch',
    standaloneShader.fragmentShader.includes('uM3DPatternOverwriteTexture>0.5') &&
    standaloneShader.fragmentShader.includes('diffuseColor.rgb=mix(diffuseColor.rgb,m3dPatternResult.color'));
  check('Standalone pattern injects auto tiling aspect calculation',
    standaloneShader.fragmentShader.includes('uM3DPatternAutoTiling>0.5') &&
    standaloneShader.vertexShader.includes('vM3DPatternNormal=normal'));

  standaloneBehavior._setOverwriteTexture = (val) => { standaloneBehavior._overwriteTexture = val; };
  standaloneBehavior._getOverwriteTexture = () => standaloneBehavior._overwriteTexture;
  standaloneBehavior._setOverwriteTexture(false);
  standaloneBehavior._setAutoTiling = (val) => { standaloneBehavior._autoTiling = val; };
  standaloneBehavior._getAutoTiling = () => standaloneBehavior._autoTiling;
  standaloneBehavior._setAutoTiling(false);
  P.sync(standaloneBehavior, standaloneObject);
  check('Setting overwrite texture to false updates uniform to 0 in-place',
    manualMesh.material.__m3dPattern.uniforms.uM3DPatternOverwriteTexture.value === 0);
  check('Setting auto tiling to false updates uniform to 0 in-place',
    manualMesh.material.__m3dPattern.uniforms.uM3DPatternAutoTiling.value === 0);

  // Visual Glitch prevention & RotationAngle tests
  check('Pattern shader uses Dave Hoskins sine-free hash to eliminate circular moiré tree-rings',
    standaloneShader.fragmentShader.includes('0.1031') && standaloneShader.fragmentShader.includes('33.33'));
  check('Pattern shader uses Analytic Anti-Aliasing (fwidth) to eliminate distance shimmering',
    standaloneShader.fragmentShader.includes('fwidth(d)') && standaloneShader.fragmentShader.includes('1.0-smoothstep(0.0,aa,d)'));
  check('Pattern shader injects rotation matrix transform',
    standaloneShader.fragmentShader.includes('uM3DPatternRotation') && standaloneShader.fragmentShader.includes('mat2(cR,sR,-sR,cR)'));

  // Test calcScale on thin walls and curbs to verify NO frequency explosion
  const thinWallObj = { getWidth: () => 2000, getHeight: () => 100, getDepth: () => 20 };
  const wallScale = P.calcScale(null, thinWallObj);
  check('calcScale normalizes thin wall to reference 100 without explosion',
    Math.abs(wallScale[0] - 20) < 1e-5 && Math.abs(wallScale[1] - 1) < 1e-5 && Math.abs(wallScale[2] - 0.2) < 1e-5,
    `${wallScale[0]},${wallScale[1]},${wallScale[2]}`);

  const defaultCubeObj = { getWidth: () => 100, getHeight: () => 100, getDepth: () => 100 };
  const cubeScale = P.calcScale(null, defaultCubeObj);
  check('calcScale preserves 1:1:1 on default 100x100x100 cube',
    cubeScale[0] === 1 && cubeScale[1] === 1 && cubeScale[2] === 1);

  const meterModelObj = { getWidth: () => 2.0, getHeight: () => 1.0, getDepth: () => 0.5 };
  const meterScale = P.calcScale(null, meterModelObj);
  check('calcScale normalizes small meter-scale model relative to max dimension',
    meterScale[0] === 1.0 && meterScale[1] === 0.5 && meterScale[2] === 0.25);

  // Test RotationAngle uniform updates
  standaloneBehavior._setRotationAngle = (val) => { standaloneBehavior._rotationAngle = val; };
  standaloneBehavior._getRotationAngle = () => standaloneBehavior._rotationAngle;
  standaloneBehavior._setRotationAngle(90);
  P.sync(standaloneBehavior, standaloneObject);
  check('Setting RotationAngle to 90 updates uM3DPatternRotation uniform to PI/2',
    Math.abs(manualMesh.material.__m3dPattern.uniforms.uM3DPatternRotation.value - Math.PI / 2) < 1e-5);
  standaloneBehavior._setRotationAngle(45);
  P.sync(standaloneBehavior, standaloneObject);
  check('Setting RotationAngle to 45 updates uM3DPatternRotation uniform to PI/4',
    Math.abs(manualMesh.material.__m3dPattern.uniforms.uM3DPatternRotation.value - Math.PI / 4) < 1e-5);

  P.dispose(standaloneBehavior);
  check('Standalone disposal cleans up pattern state', !manualMesh.material.__m3dPattern);
}

console.log('\n19. Displaced Mesh 3D physical deformation');
{
  const PM = globalThis.gdjs.__patternMath3D;
  const GC = globalThis.gdjs.__geometryController3D;
  const DM = globalThis.gdjs.__displacedMesh3D;

  check('PatternMath3D runtime registers', !!PM);
  check('GeometryController3D runtime registers', !!GC);
  check('DisplacedMesh3D runtime registers', !!DM);

  // 1. PatternMath3D determinism & modes
  const modes = ['Solid', 'Grid', 'Brick', 'Checker', 'Stripes', 'Dots', 'Hexagons', 'Voronoi'];
  let allModesEvaluated = true;
  for (const mode of modes) {
    const res = PM.evalPattern(0.5, 0.5, { type: mode, scaleX: 4, scaleY: 4, seed: 1, gap: 0.06, softness: 0.02 });
    if (!res || typeof res.surface !== 'number' || typeof res.edge !== 'number') {
      allModesEvaluated = false;
    }
  }
  check('PatternMath3D evaluates all 8 pattern modes with signed displacement', allModesEvaluated);

  const eval1 = PM.evalPattern(0.25, 0.25, { type: 'Brick', scaleX: 8, scaleY: 4, seed: 42, gap: 0.06, softness: 0.02 });
  const eval2 = PM.evalPattern(0.25, 0.25, { type: 'Brick', scaleX: 8, scaleY: 4, seed: 42, gap: 0.06, softness: 0.02 });
  check('PatternMath3D is strictly deterministic for identical UV and seed',
    eval1.surface === eval2.surface && eval1.variation === eval2.variation);

  const gapSample = PM.evalPattern(0.0, 0.0, { type: 'Brick', scaleX: 1, scaleY: 1, seed: 1, gap: 0.2, softness: 0.02 });
  check('Pattern gap region produces signed inward displacement', gapSample.surface < 0 && gapSample.edge > 0.5);

  // 2. GeometryController3D exclusive ownership & cache
  const rootObj = {};
  const testOwnerA = { id: 'ownerA' };
  const testOwnerB = { id: 'ownerB' };
  const origGeom = new THREE.BufferGeometry();
  const workGeom = new THREE.BufferGeometry();
  const testMesh = { geometry: origGeom, traverse(fn) { fn(this); } };
  const basePos = new Float32Array(9);
  const baseNorm = new Float32Array(9);

  const acqA = GC.acquireOwnership(rootObj, testOwnerA, testMesh, workGeom, basePos, baseNorm);
  check('GeometryController acquires ownership', acqA.ok === true && GC.getRecord(rootObj, testMesh)?.owner === testOwnerA);
  testMesh.geometry = workGeom;

  const acqB = GC.acquireOwnership(rootObj, testOwnerB, testMesh, workGeom, basePos, baseNorm);
  check('Second owner cannot steal geometry lock', acqB.ok === false && acqB.error.includes('already owned'));

  const relA = GC.releaseOwnership(rootObj, testOwnerA);
  check('GeometryController releases ownership and restores original geometry',
    relA === true && testMesh.geometry === origGeom);
  check('Working geometry is disposed on release', workGeom.disposed === true);
  check('Ownership released so mesh is no longer owned', !GC.isMeshOwnedByOther(testMesh, testOwnerA));

  // 3. DisplacedMesh3D cube subdivision
  const origBox = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const cubeMesh = makeMesh('CubeMesh', new MeshStandardMaterial(), origBox);
  const cubeObj = { get3DRendererObject: () => cubeMesh };
  const displacedBehavior = makeBehavior({
    Enabled: true,
    DisplacementMode: 'Hybrid',
    UpdateMode: 'On creation',
    IncludeChildren: true,
    Seed: 1234,
    SubdivideCubes: true,
    Subdivision: 4,
    MaxVerticesPerObject: 20000,
    PreserveSharpEdges: true,
    PatternDepth: 0.08,
    PatternRaise: 0.02,
    RoughnessStrength: 0.1,
    NoiseFrequency: 2,
    NoiseOctaves: 3,
    NoisePersistence: 0.5,
    NoiseLacunarity: 2,
    TerraceLayers: 4,
    TerraceSharpness: 0.6,
    CornerErosion: 0.35,
    MicroPitting: 0.05,
    CreviceShading: 0.5,
  });

  DM.sync(displacedBehavior, cubeObj);
  check('DisplacedMesh3D reaches Ready state', DM.stateOf(displacedBehavior).state === 'Ready');
  check('DisplacedMesh3D reports affected mesh count', DM.stateOf(displacedBehavior).affectedMeshCount === 1);

  const subSeg = 4;
  const expectedVerts = 6 * (subSeg + 1) * (subSeg + 1); // 6 * 25 = 150
  check('Cube BoxGeometry subdivided to expected vertex count (seg=4 -> 150 verts)',
    cubeMesh.geometry.attributes.position.count === expectedVerts);
  check('Cube geometry preserves 6 face groups for multi-material support',
    cubeMesh.geometry.groups.length === 6);
  check('Cube geometry preserves UV attributes',
    cubeMesh.geometry.attributes.uv && cubeMesh.geometry.attributes.uv.count === expectedVerts);

  // 4. Non-compounding displacement test
  const snapPos = new Float32Array(cubeMesh.geometry.attributes.position.array);
  const cacheRecord = GC.getRecord(cubeMesh, cubeMesh);
  const cachedOffsets = cacheRecord && cacheRecord.rawOffsets;
  const cachedGaps = cacheRecord && cacheRecord.gapFactors;
  const cachedColors = cacheRecord && cacheRecord.creviceColors;
  const cachedSeams = cacheRecord && cacheRecord.seamClusters;
  for (let i = 0; i < 10; i++) {
    DM.rebuildMesh(displacedBehavior, cubeObj);
  }
  let maxCompoundingDiff = 0;
  const currPos = cubeMesh.geometry.attributes.position.array;
  for (let i = 0; i < snapPos.length; i++) {
    const d = Math.abs(currPos[i] - snapPos[i]);
    if (d > maxCompoundingDiff) maxCompoundingDiff = d;
  }
  check('Repeated rebuilds (10x) do NOT compound displacement', maxCompoundingDiff < 1e-6, `max diff: ${maxCompoundingDiff}`);
  const reusedRecord = GC.getRecord(cubeMesh, cubeMesh);
  check('Repeated rebuilds reuse offset and gap arrays',
    reusedRecord && reusedRecord.rawOffsets === cachedOffsets && reusedRecord.gapFactors === cachedGaps);
  check('Repeated rebuilds reuse vertex-color and seam caches',
    reusedRecord && reusedRecord.creviceColors === cachedColors && reusedRecord.seamClusters === cachedSeams);

  // 5. Budget limit guard
  displacedBehavior._setSubdivision(32); // (32+1)^2 * 6 = 6534 vertices
  displacedBehavior._setMaxVerticesPerObject(500); // lower than 6534
  DM.markDirty(displacedBehavior, cubeObj);
  DM.rebuildMesh(displacedBehavior, cubeObj);
  check('Exceeding MaxVerticesPerObject flags budget exceeded',
    DM.stateOf(displacedBehavior).isBudgetExceeded === true);
  check('Budget rejection preserves previous geometry rather than crashing',
    cubeMesh.geometry.attributes.position.count === expectedVerts);

  // Reset budget & subdivision
  displacedBehavior._setSubdivision(4);
  displacedBehavior._setMaxVerticesPerObject(20000);
  DM.markDirty(displacedBehavior, cubeObj);
  DM.rebuildMesh(displacedBehavior, cubeObj);
  check('Restoring valid budget clears budget exceeded flag',
    DM.stateOf(displacedBehavior).isBudgetExceeded === false);

  // 6. Crevice shading & vertex colors coordination with MaterialController3D
  check('Crevice shading allocates vertex color attribute on working geometry',
    !!cubeMesh.geometry.attributes.color && cubeMesh.geometry.attributes.color.count === expectedVerts);

  let hasDarkShade = false;
  const colArray = cubeMesh.geometry.attributes.color.array;
  for (let i = 0; i < colArray.length; i++) {
    if (colArray[i] < 0.99) { hasDarkShade = true; break; }
  }
  check('Recesses and gaps receive darkened crevice vertex colors', hasDarkShade);

  check('MaterialController coordinates vertexColors requirement',
    gdjs.__materialController3D.requiresVertexColors(cubeMesh) === true);

  // When Core applies material settings, vertexColors is set to true
  const coreMat = new MeshStandardMaterial();
  const coreSetup = setup({}, coreMat);
  coreSetup.mesh = cubeMesh;
  M3.applyToBehavior(coreSetup.behavior, cubeObj, coreSetup.game);
  check('Material 3D Core enables vertexColors on materials when requested by DisplacedMesh3D',
    cubeMesh.material.vertexColors === true);

  // Disable crevice shading -> should remove color attribute and clear requirement
  displacedBehavior._setCreviceShading(0);
  DM.markDirty(displacedBehavior, cubeObj);
  DM.rebuildMesh(displacedBehavior, cubeObj);
  check('Disabling crevice shading removes color attribute', !cubeMesh.geometry.attributes.color);
  check('Disabling crevice shading clears vertexColors requirement in controller',
    gdjs.__materialController3D.requiresVertexColors(cubeMesh) === false);

  // 7. Pattern displacement integration with PatternMaterial3D
  const patBehavior = makeBehavior({
    Enabled: true,
    PatternType: 'Hexagons',
    ScaleX: 6,
    ScaleY: 6,
    Seed: 777,
    GapWidth: 0.1,
    EdgeSoftness: 0.02,
    PrimaryColor: '200;200;200',
    SecondaryColor: '100;100;100',
    BorderColor: '20;20;20',
    TextureOverlayColor: '255;255;255',
    Saturation: 1,
    ColorVariation: 0,
    NoiseScale: 1,
    NoiseStrength: 0,
    SurfaceRoughness: 0.5,
    BorderRoughness: 0.8,
    Metalness: 0,
    Strength: 1
  });
  globalThis.gdjs.__patternMaterial3D.sync(patBehavior, cubeObj);

  displacedBehavior._setDisplacementMode('Pattern Driven');
  displacedBehavior._setPatternDepth(0.12);
  displacedBehavior._setPatternRaise(0.04);
  DM.markDirty(displacedBehavior, cubeObj);
  DM.rebuildMesh(displacedBehavior, cubeObj);
  check('DisplacedMesh3D reads active recipe from PatternMaterial3D',
    cubeMesh.geometry !== origBox && DM.stateOf(displacedBehavior).state === 'Ready');

  // 8. Disposal & original geometry restoration
  DM.dispose(displacedBehavior, cubeObj);
  check('DisplacedMesh3D disposal restores exact original geometry reference',
    cubeMesh.geometry === origBox);
  check('Disposed working geometry had its resources freed',
    cubeMesh.geometry.disposed !== true); // original was NOT disposed
  check('DisplacedMesh3D state resets to Uninitialized after disposal',
    DM.stateOf(displacedBehavior).state === 'Uninitialized');

  // 9. Seam bridging (watertight edges & corners with zero separation)
  const seamBox = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4);
  const seamMesh = makeMesh('SeamMesh', new MeshStandardMaterial(), seamBox);
  const seamObj = { get3DRendererObject() { return seamMesh; }, scale: { x: 1, y: 1, z: 1 } };
  const seamBehavior = makeBehavior({
    Enabled: true,
    DisplacementMode: 'Geological Weathering',
    RoughnessStrength: 0.3,
    NoiseFrequency: 2.0,
    SubdivideCubes: true,
    Subdivision: 4,
    BridgeSeams: true
  });
  DM.sync(seamBehavior, seamObj);
  const bridgedGeom = seamMesh.geometry;
  const bridgedPos = bridgedGeom.attributes.position;
  const rec = GC.getRecord(seamMesh, seamMesh);
  const bPos = rec ? rec.basePositions : null;

  let maxSeamGap = 0;
  let coLocatedPairsChecked = 0;
  const posClusters = new Map();
  for (let vi = 0; vi < bridgedPos.count; vi++) {
    const k = Math.round(bPos[vi * 3] * 2000) + '_' + Math.round(bPos[vi * 3 + 1] * 2000) + '_' + Math.round(bPos[vi * 3 + 2] * 2000);
    if (!posClusters.has(k)) posClusters.set(k, []);
    posClusters.get(k).push(vi);
  }

  posClusters.forEach((verts) => {
    if (verts.length > 1) {
      for (let i = 1; i < verts.length; i++) {
        const vA = verts[0];
        const vB = verts[i];
        const dx = bridgedPos.getX(vA) - bridgedPos.getX(vB);
        const dy = bridgedPos.getY(vA) - bridgedPos.getY(vB);
        const dz = bridgedPos.getZ(vA) - bridgedPos.getZ(vB);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > maxSeamGap) maxSeamGap = dist;
        coLocatedPairsChecked++;
      }
    }
  });

  check('Seam bridging ensures co-located edge and corner vertices have zero separation',
    coLocatedPairsChecked > 0 && maxSeamGap < 1e-5, `checked ${coLocatedPairsChecked} pairs, maxGap: ${maxSeamGap}`);

  // Test with BridgeSeams: false -> co-located vertices move along perpendicular normals and separate
  seamBehavior._setBridgeSeams = (val) => { seamBehavior._bridgeSeams = val; };
  seamBehavior._getBridgeSeams = () => seamBehavior._bridgeSeams;
  seamBehavior._setBridgeSeams(false);
  DM.markDirty(seamBehavior, seamObj);
  DM.rebuildMesh(seamBehavior, seamObj);
  const unbridgedPos = seamMesh.geometry.attributes.position;
  let maxUnbridgedGap = 0;
  posClusters.forEach((verts) => {
    if (verts.length > 1) {
      for (let i = 1; i < verts.length; i++) {
        const vA = verts[0];
        const vB = verts[i];
        const dx = unbridgedPos.getX(vA) - unbridgedPos.getX(vB);
        const dy = unbridgedPos.getY(vA) - unbridgedPos.getY(vB);
        const dz = unbridgedPos.getZ(vA) - unbridgedPos.getZ(vB);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > maxUnbridgedGap) maxUnbridgedGap = dist;
      }
    }
  });
  check('Disabling bridge seams allows independent face normal displacement', maxUnbridgedGap > 0.05);

  // 10. Enhanced pattern relief (bevel, height variance, surface noise)
  const bevelEvalFlat = PM.evalPattern(0.1, 0.5, { type: 'Brick', scaleX: 1, scaleY: 1, bevel: 0, gap: 0.05, softness: 0.02 });
  const bevelEvalCurved = PM.evalPattern(0.1, 0.5, { type: 'Brick', scaleX: 1, scaleY: 1, bevel: 1.0, gap: 0.05, softness: 0.02 });
  check('PatternBevel produces curved convex relief profile',
    typeof bevelEvalCurved.relief === 'number' && bevelEvalCurved.relief < bevelEvalFlat.relief);

  const cell1 = PM.evalPattern(0.2, 0.2, { type: 'Brick', scaleX: 4, scaleY: 4, seed: 10 });
  const cell2 = PM.evalPattern(0.8, 0.8, { type: 'Brick', scaleX: 4, scaleY: 4, seed: 10 });
  check('Pattern produces cellHash for individual brick height variance',
    typeof cell1.cellHash === 'number' && typeof cell2.cellHash === 'number' && cell1.cellHash !== cell2.cellHash);

  DM.dispose(seamBehavior, seamObj);
}

/* ================================================================= 20. Anisotropic Texture Filtering */
{
  console.log('\n20. Anisotropic Texture Filtering');

  const MC = gdjs.__materialController3D;
  const PHY = gdjs.__physicalMaterial3D;
  const ANIM = gdjs.__animatedMaterial3D;
  const WET = gdjs.__wetMaterial3D;
  const PAT = gdjs.__patternMaterial3D;
  const BRDF = gdjs.__brdfMaterial3D;
  const DM = gdjs.__displacedMesh3D;
  check('MaterialController3D registers resolveAnisotropy and apply helpers',
    typeof MC.resolveAnisotropy === 'function' &&
    typeof MC.applyAnisotropyToMaterial === 'function' &&
    typeof MC.applyAnisotropyToObject === 'function' &&
    typeof MC.getObjectAnisotropy === 'function');

  // 1. Resolution
  check('resolveAnisotropy("16x") resolves to 16', MC.resolveAnisotropy('16x') === 16);
  check('resolveAnisotropy("8x") resolves to 8', MC.resolveAnisotropy('8x') === 8);
  check('resolveAnisotropy("4x") resolves to 4', MC.resolveAnisotropy('4x') === 4);
  check('resolveAnisotropy("2x") resolves to 2', MC.resolveAnisotropy('2x') === 2);
  check('resolveAnisotropy("1 (Off)") resolves to 1', MC.resolveAnisotropy('1 (Off)') === 1);
  check('resolveAnisotropy("Keep Original") resolves to null', MC.resolveAnisotropy('Keep Original') === null);
  check('resolveAnisotropy(16) numeric resolves to 16', MC.resolveAnisotropy(16) === 16);
  check('resolveAnisotropy("Max") resolves to valid positive number (fallback 16 without renderer capabilities)',
    typeof MC.resolveAnisotropy('Max') === 'number' && MC.resolveAnisotropy('Max') >= 1);

  // 2. applyAnisotropyToMaterial on multiple texture slots
  const multiTexMat = new MeshStandardMaterial();
  const mapTex = new StubTexture();
  const normTex = new StubTexture();
  const roughTex = new StubTexture();
  multiTexMat.map = mapTex;
  multiTexMat.normalMap = normTex;
  multiTexMat.roughnessMap = roughTex;

  MC.applyAnisotropyToMaterial(multiTexMat, 16);
  check('applyAnisotropyToMaterial updates map.anisotropy', mapTex.anisotropy === 16);
  check('applyAnisotropyToMaterial flags map.needsUpdate', mapTex.needsUpdate === true);
  check('applyAnisotropyToMaterial updates normalMap.anisotropy', normTex.anisotropy === 16);
  check('applyAnisotropyToMaterial updates roughnessMap.anisotropy', roughTex.anisotropy === 16);

  // 3. MaterialCore3D integration
  const baseMatWithTex = new MeshStandardMaterial();
  const baseTex = new StubTexture();
  baseMatWithTex.map = baseTex;

  const coreSetup = setup({ AnisotropicFiltering: '16x' }, baseMatWithTex);
  M3.applyToBehavior(coreSetup.behavior, coreSetup.object, coreSetup.game);

  const coreState = M3.getBehaviorState(coreSetup.behavior);
  const liveCoreMat = coreState.targetMaterials[0];
  check('Core material inherits texture with anisotropy 16', liveCoreMat.map && liveCoreMat.map.anisotropy === 16);
  check('M3.getAnisotropicFiltering reports 16x', M3.getAnisotropicFiltering(coreSetup.behavior) === '16x');
  check('M3.getTextureAnisotropy reports 16', M3.getTextureAnisotropy(coreSetup.behavior) === 16);

  // Runtime update via override
  M3.setOverride(coreSetup.behavior, 'AnisotropicFiltering', '4x');
  M3.refreshSettings(coreSetup.behavior);
  check('Changing AnisotropicFiltering to 4x updates texture anisotropy in-place', liveCoreMat.map.anisotropy === 4);
  check('Texture needsUpdate flagged on anisotropy change', liveCoreMat.map.needsUpdate === true);
  check('getObjectAnisotropy reports 4 on root', MC.getObjectAnisotropy(coreSetup.mesh) === 4);

  // 4. Standalone PhysicalMaterial3D without Core
  const physMat = new MeshStandardMaterial();
  const physTex = new StubTexture();
  physMat.map = physTex;
  const physMesh = makeMesh('PhysMesh', physMat);
  const physObj = { get3DRendererObject: () => physMesh };
  const physBehavior = makeBehavior({
    Transmission: 0, IOR: 1.5, Thickness: 0.1, Clearcoat: 0, ClearcoatRoughness: 0,
    Sheen: 0, SheenColor: '255;255;255', SheenRoughness: 1, Iridescence: 0, IridescenceIOR: 1.3,
    IridescenceThicknessMin: 100, IridescenceThicknessMax: 400, Anisotropy: 0, AnisotropyRotation: 0,
    AnisotropicFiltering: '8x'
  });
  PHY.sync(physBehavior, physObj);
  check('Standalone PhysicalMaterial3D applies 8x anisotropy directly to mesh textures', physTex.anisotropy === 8);
  check('Standalone PhysicalMaterial3D flags needsUpdate', physTex.needsUpdate === true);
  PHY.dispose(physBehavior);

  // 5. Standalone AnimatedMaterial3D without Core
  const animMat = new MeshStandardMaterial();
  const animTex = new StubTexture();
  animMat.map = animTex;
  const animMesh = makeMesh('AnimMesh', animMat);
  const animObj = { get3DRendererObject: () => animMesh };
  const animBehavior = makeBehavior({
    TilingX: 1, TilingY: 1, OffsetX: 0, OffsetY: 0, RotationAngle: 0,
    RotationCenterX: 0.5, RotationCenterY: 0.5, ScrollSpeedX: 0, ScrollSpeedY: 0,
    ScrollRotationSpeed: 0, FlipbookColumns: 1, FlipbookRows: 1, FlipbookFPS: 12,
    FlipbookTotalFrames: 0, EnableScroll: false, EnableFlipbook: false, FlipbookLoop: true,
    AnisotropicFiltering: '4x'
  });
  ANIM.sync(animBehavior, animObj);
  check('Standalone AnimatedMaterial3D applies 4x anisotropy directly to mesh textures', animTex.anisotropy === 4);
  ANIM.dispose(animBehavior);

  // 6. Standalone WetMaterial3D without Core
  const wetMat = new MeshStandardMaterial();
  const wetTex = new StubTexture();
  wetMat.map = wetTex;
  const wetMesh = makeMesh('WetMesh', wetMat);
  const wetObj = { get3DRendererObject: () => wetMesh };
  const wetBh = makeBehavior({
    Wetness: 0.5, Porosity: 0.5, WetRoughness: 0.02, DarkeningStrength: 0.35,
    AnisotropicFiltering: '16x'
  });
  WET.sync(wetBh, wetObj);
  check('Standalone WetMaterial3D applies 16x anisotropy directly to mesh textures', wetTex.anisotropy === 16);
  WET.dispose(wetBh);

  // 7. Standalone TiledCustomPatternMaterial3D without Core
  const patMat = new MeshStandardMaterial();
  const patTex = new StubTexture();
  patMat.map = patTex;
  const patMesh = makeMesh('PatMesh', patMat);
  const patObj = { get3DRendererObject: () => patMesh };
  const patBh = makeBehavior({
    Enabled: true, PatternType: 'Brick', ScaleX: 8, ScaleY: 8, AutoTiling: true,
    Seed: 1, GapWidth: 0.06, EdgeSoftness: 0.02, PrimaryColor: '180;180;180',
    SecondaryColor: '130;130;130', BorderColor: '45;45;45', TextureOverlayColor: '255;255;255',
    Saturation: 1, OverwriteTexture: true, ColorVariation: 0.15, NoiseScale: 2,
    NoiseStrength: 0.15, SurfaceRoughness: 0.6, BorderRoughness: 0.9, Metalness: 0, Strength: 1,
    AnisotropicFiltering: '2x'
  });
  PAT.sync(patBh, patObj);
  check('Standalone PatternMaterial3D applies 2x anisotropy directly to mesh textures', patTex.anisotropy === 2);
  PAT.dispose(patBh);

  // 8. Standalone BRDFMaterial without Core
  const brdfMat = new MeshStandardMaterial();
  const brdfTex = new StubTexture();
  brdfMat.map = brdfTex;
  const brdfMesh = makeMesh('BRDFMesh', brdfMat);
  const brdfObj = { get3DRendererObject: () => brdfMesh };
  const brdfBh = makeBehavior({
    BRDFModel: 'burley', FollowMaterialRoughness: true, Roughness: 0.5,
    DiffuseFresnel: 1, DiffuseFresnelFalloff: 0.75, DiffuseFresnelTangentFalloff: 0.75,
    RetroReflection: 1, RetroReflectionFalloff: 0.75, RetroReflectionTangentFalloff: 0.75,
    SmoothTerminator: 0, SmoothTerminatorLength: 0.5,
    AnisotropicFiltering: '8x'
  });
  BRDF.apply(brdfObj, BRDF.readParams(brdfBh));
  check('Standalone BRDFMaterial applies 8x anisotropy directly to mesh textures', brdfTex.anisotropy === 8);
  BRDF.dispose(brdfObj);

  // 9. Standalone DisplacedMesh3D without Core
  const dmMat = new MeshStandardMaterial();
  const dmTex = new StubTexture();
  dmMat.map = dmTex;
  const dmMesh = makeMesh('DMMesh', dmMat);
  const dmObj = { get3DRendererObject: () => dmMesh };
  const dmBh = makeBehavior({
    Enabled: true, DisplacementMode: 'Hybrid', UpdateMode: 'On creation',
    IncludeChildren: true, Seed: 1, SubdivideCubes: false, Subdivision: 1,
    MaxVerticesPerObject: 20000, PreserveSharpEdges: true, BridgeSeams: true,
    AutoTiling: true, PatternDepth: 0.08, PatternRaise: 0.02, PatternBevel: 0.5,
    PatternHeightVariance: 0.25, PatternSurfaceNoise: 0.15,
    RoughnessStrength: 0.15, NoiseFrequency: 2, NoiseOctaves: 4, NoisePersistence: 0.5,
    NoiseLacunarity: 2, TerraceLayers: 4, TerraceSharpness: 0.6, CornerErosion: 0.35,
    MicroPitting: 0.05, CreviceShading: 0.5,
    AnisotropicFiltering: '16x'
  });
  DM.sync(dmBh, dmObj);
  check('Standalone DisplacedMesh3D applies 16x anisotropy directly to mesh textures', dmTex.anisotropy === 16);
  DM.dispose(dmBh, dmObj);

  // 10. Keep Original leaves anisotropy unchanged
  const keepMat = new MeshStandardMaterial();
  const keepTex = new StubTexture();
  keepTex.anisotropy = 4;
  keepTex.needsUpdate = false;
  MC.applyAnisotropyToMaterial(keepMat, null);
  check('"Keep Original" (null) leaves existing anisotropy untouched', keepTex.anisotropy === 4);
  check('"Keep Original" does not trigger needsUpdate', keepTex.needsUpdate === false);
}

console.log('\n21. Baked PBR roughness & metalness preservation');
{
  // 1. By default (UseRoughness: false, UseMetalness: false), mesh with baked roughness 0.22 and metalness 0.88 is preserved
  const bakedMat = new MeshStandardMaterial();
  bakedMat.roughness = 0.22;
  bakedMat.metalness = 0.88;
  const a = setup({}, bakedMat);
  M3.applyToBehavior(a.behavior, a.object, a.game);
  check('Baked roughness is preserved when UseRoughness is false', Math.abs(a.mesh.material.roughness - 0.22) < 1e-4, String(a.mesh.material.roughness));
  check('Baked metalness is preserved when UseMetalness is false', Math.abs(a.mesh.material.metalness - 0.88) < 1e-4, String(a.mesh.material.metalness));

  // 2. Override roughness when UseRoughness is true
  const b = setup({ UseRoughness: true, Roughness: 0.77 }, bakedMat.clone());
  M3.applyToBehavior(b.behavior, b.object, b.game);
  check('Roughness is overridden when UseRoughness is true', Math.abs(b.mesh.material.roughness - 0.77) < 1e-4, String(b.mesh.material.roughness));

  // 3. Override metalness when UseMetalness is true
  const c = setup({ UseMetalness: true, Metalness: 0.95 }, bakedMat.clone());
  M3.applyToBehavior(c.behavior, c.object, c.game);
  check('Metalness is overridden when UseMetalness is true', Math.abs(c.mesh.material.metalness - 0.95) < 1e-4, String(c.mesh.material.metalness));

  // 4. Preserved baked texture maps enforce RepeatWrapping
  const mappedMat = new MeshStandardMaterial();
  const bakedTex = new StubTexture();
  mappedMat.map = bakedTex;
  const d = setup({}, mappedMat);
  M3.applyToBehavior(d.behavior, d.object, d.game);
  check('Preserved baked texture map has RepeatWrapping enforced', bakedTex.wrapS === THREE.RepeatWrapping && bakedTex.wrapT === THREE.RepeatWrapping);
}

console.log('\n22. Standalone Contributor behaviors (without Core)');
{
  const PHYS = globalThis.gdjs.__physicalMaterial3D;
  const WET = globalThis.gdjs.__wetMaterial3D;
  const ANIM = globalThis.gdjs.__animatedMaterial3D;

  // 1. Standalone PhysicalMaterial3D promotes Standard to Physical and sets physical properties
  const stdMat = new MeshStandardMaterial();
  const stdMesh = makeMesh('StdMesh', stdMat);
  const stdObj = { get3DRendererObject: () => stdMesh }; // No hasBehavior
  const physBh = makeBehavior({
    Transmission: 0.85, IOR: 1.52, Thickness: 0.25, Clearcoat: 0.9, ClearcoatRoughness: 0.1,
    Sheen: 0.5, SheenColor: '255;200;200', SheenRoughness: 0.3, Iridescence: 0.7,
    IridescenceIOR: 1.4, IridescenceThicknessMin: 120, IridescenceThicknessMax: 380,
    Anisotropy: 0.6, AnisotropyRotation: 45, AnisotropicFiltering: '16x',
    TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: ''
  });
  PHYS.sync(physBh, stdObj);
  check('Standalone PhysicalMaterial3D promotes Standard material to Physical', stdMesh.material.isMeshPhysicalMaterial === true);
  check('Standalone PhysicalMaterial3D sets transmission', Math.abs(stdMesh.material.transmission - 0.85) < 1e-4);
  check('Standalone PhysicalMaterial3D sets clearcoat', Math.abs(stdMesh.material.clearcoat - 0.9) < 1e-4);
  check('Standalone PhysicalMaterial3D reaches Ready state', PHYS.stateOf(physBh).state === 'Ready');
  PHYS.dispose(physBh);

  // 2. Standalone WetMaterial3D applies darkening and wet roughness
  const dryMat = new MeshStandardMaterial();
  dryMat.roughness = 0.8;
  const dryMesh = makeMesh('DryMesh', dryMat);
  const dryObj = { get3DRendererObject: () => dryMesh };
  const wetBh = makeBehavior({
    Wetness: 0.75, Porosity: 0.6, WetRoughness: 0.05, DarkeningStrength: 0.4,
    AnisotropicFiltering: '16x', TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: ''
  });
  WET.sync(wetBh, dryObj);
  check('Standalone WetMaterial3D reaches Ready', WET.stateOf(wetBh).state === 'Ready');
  check('Standalone WetMaterial3D reduces roughness', dryMesh.material.roughness < 0.8);
  check('Standalone WetMaterial3D reports isWet', WET.read(wetBh).wetness > 0);
  WET.dispose(wetBh);
  check('Disposing standalone WetMaterial3D restores original roughness', Math.abs(dryMesh.material.roughness - 0.8) < 1e-4);

  // 3. Standalone AnimatedMaterial3D clones map and scrolls UV
  const animMat = new MeshStandardMaterial();
  const origTex = new StubTexture();
  animMat.map = origTex;
  const animMesh = makeMesh('AnimMesh', animMat);
  const animObj = { get3DRendererObject: () => animMesh };
  const animBh = makeBehavior({
    TilingX: 2, TilingY: 3, OffsetX: 0.1, OffsetY: 0.2, RotationAngle: 0, RotationCenterX: 0.5, RotationCenterY: 0.5,
    EnableScroll: true, ScrollSpeedX: 1, ScrollSpeedY: 2, ScrollRotationSpeed: 0,
    EnableFlipbook: false, FlipbookColumns: 1, FlipbookRows: 1, FlipbookFPS: 12, FlipbookLoop: true, FlipbookTotalFrames: 0,
    AnisotropicFiltering: '16x', TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: ''
  });
  ANIM.sync(animBh, animObj);
  check('Standalone AnimatedMaterial3D reaches Ready', ANIM.stateOf(animBh).state === 'Ready');
  check('Standalone AnimatedMaterial3D cloned original map', animMesh.material.map !== origTex);
  check('Standalone AnimatedMaterial3D applied tiling', animMesh.material.map.repeat.x === 2 && animMesh.material.map.repeat.y === 3);
  ANIM.tick(animBh, animObj, 0.5);
  check('Standalone AnimatedMaterial3D scrolled offset X', Math.abs(animMesh.material.map.offset.x - 0.6) < 1e-4);
  ANIM.dispose(animBh);
  check('Disposing standalone AnimatedMaterial3D restores original map', animMesh.material.map === origTex);
}

console.log('\n23. Material slot targeting on multi-material meshes');
{
  const MC = globalThis.gdjs.__materialController3D;
  const PHYS = globalThis.gdjs.__physicalMaterial3D;
  const WET = globalThis.gdjs.__wetMaterial3D;

  const mat0 = new MeshStandardMaterial(); mat0.name = 'SlotZero'; mat0.roughness = 0.5;
  const mat1 = new MeshStandardMaterial(); mat1.name = 'Gold';     mat1.roughness = 0.3;
  const mat2 = new MeshStandardMaterial(); mat2.name = 'Glass';    mat2.roughness = 0.1;
  const multiMesh = makeMesh('MultiMesh', [mat0, mat1, mat2]);
  const multiObj = { get3DRendererObject: () => multiMesh };

  // 1. resolveBehaviorTargets with 'All materials'
  const allBh = makeBehavior({ TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: '' });
  const allTargets = MC.resolveBehaviorTargets(multiMesh, allBh);
  check('TargetMode "All materials" resolves all 3 slots', allTargets.length === 3);

  // 2. resolveBehaviorTargets with 'First material'
  const firstBh = makeBehavior({ TargetMode: 'First material', MaterialIndex: 0, MaterialName: '', MeshName: '' });
  const firstTargets = MC.resolveBehaviorTargets(multiMesh, firstBh);
  check('TargetMode "First material" resolves slot 0 only', firstTargets.length === 1 && firstTargets[0].slot === 0);

  // 3. resolveBehaviorTargets with 'Material index' = 1
  const idxBh = makeBehavior({ TargetMode: 'Material index', MaterialIndex: 1, MaterialName: '', MeshName: '' });
  const idxTargets = MC.resolveBehaviorTargets(multiMesh, idxBh);
  check('TargetMode "Material index" resolves slot 1 only', idxTargets.length === 1 && idxTargets[0].slot === 1 && idxTargets[0].material === mat1);

  // 4. resolveBehaviorTargets with 'Material name' = 'Gold'
  const nameBh = makeBehavior({ TargetMode: 'Material name', MaterialIndex: 0, MaterialName: 'Gold', MeshName: '' });
  const nameTargets = MC.resolveBehaviorTargets(multiMesh, nameBh);
  check('TargetMode "Material name" resolves "Gold" material only', nameTargets.length === 1 && nameTargets[0].material.name === 'Gold');

  // 5. Standalone PhysicalMaterial3D targeted to slot 2 ('Glass' or MaterialIndex: 2)
  const physSlotBh = makeBehavior({
    Transmission: 0.9, IOR: 1.5, Thickness: 0.1, Clearcoat: 0, ClearcoatRoughness: 0,
    Sheen: 0, SheenColor: '255;255;255', SheenRoughness: 1, Iridescence: 0, IridescenceIOR: 1.3,
    IridescenceThicknessMin: 100, IridescenceThicknessMax: 400, Anisotropy: 0, AnisotropyRotation: 0,
    AnisotropicFiltering: '16x', TargetMode: 'Material index', MaterialIndex: 2, MaterialName: '', MeshName: ''
  });
  PHYS.sync(physSlotBh, multiObj);
  check('Only slot 2 is promoted to PhysicalMaterial', multiMesh.material[2].isMeshPhysicalMaterial === true);
  check('Slot 0 remains StandardMaterial', multiMesh.material[0].isMeshStandardMaterial && !multiMesh.material[0].isMeshPhysicalMaterial);
  check('Slot 1 remains StandardMaterial', multiMesh.material[1].isMeshStandardMaterial && !multiMesh.material[1].isMeshPhysicalMaterial);
  check('Slot 2 has transmission applied', multiMesh.material[2].transmission === 0.9);
  PHYS.dispose(physSlotBh);

  // 6. Standalone WetMaterial3D targeted to slot 1 ('Gold')
  const wetSlotBh = makeBehavior({
    Wetness: 1, Porosity: 0.5, WetRoughness: 0.01, DarkeningStrength: 0.35,
    AnisotropicFiltering: '16x', TargetMode: 'Material index', MaterialIndex: 1, MaterialName: '', MeshName: ''
  });
  const dryRough1 = multiMesh.material[1].roughness;
  WET.sync(wetSlotBh, multiObj);
  check('WetMaterial3D targets only slot 1 (roughness reduced)', multiMesh.material[1].roughness < dryRough1);
  check('Slot 0 roughness untouched by targeted WetMaterial', multiMesh.material[0].roughness === 0.5);
  WET.dispose(wetSlotBh);
}

console.log('\n24. Authentic SDF patterns & brick aspect ratio');
{
  const PM = globalThis.gdjs.__patternMath3D;

  // 1. Herringbone (mode 8) evaluates cleanly with signed displacement
  const hRes = PM.evalPattern(0.5, 0.5, { type: 'Herringbone', scaleX: 4, scaleY: 4, gap: 0.06, softness: 0.02, seed: 1 });
  check('Herringbone evaluates without error', typeof hRes.relief === 'number' && Number.isFinite(hRes.relief));
  check('Herringbone produces signed height', typeof hRes.height === 'number');

  // 2. Basketweave (mode 9) evaluates cleanly
  const bRes = PM.evalPattern(0.3, 0.7, { type: 'Basketweave', scaleX: 4, scaleY: 4, gap: 0.06, softness: 0.02, seed: 1 });
  check('Basketweave evaluates without error', typeof bRes.relief === 'number' && Number.isFinite(bRes.relief));

  // 3. WoodPlanks (mode 10) evaluates cleanly
  const wRes = PM.evalPattern(0.2, 0.8, { type: 'WoodPlanks', scaleX: 3, scaleY: 3, gap: 0.06, softness: 0.02, seed: 1 });
  check('WoodPlanks evaluates without error', typeof wRes.relief === 'number' && Number.isFinite(wRes.relief));

  // 4. Brick (mode 2) aspect ratio ~2.85: center of brick is flat top (relief = 1.0)
  const brickCenter = PM.evalPattern(0.178125, 0.0625, { type: 'Brick', scaleX: 8, scaleY: 8, gap: 0.06, softness: 0.02, seed: 1, brickAspectRatio: 2.85 });
  check('Brick center has flat top face (relief = 1.0)', Math.abs(brickCenter.relief - 1.0) < 1e-3, String(brickCenter.relief));

  // 5. Mortar groove in brick produces negative relief
  const brickMortar = PM.evalPattern(0.0, 0.0, { type: 'Brick', scaleX: 8, scaleY: 8, gap: 0.06, softness: 0.02, seed: 1, brickAspectRatio: 2.85 });
  check('Brick mortar groove produces negative relief', brickMortar.relief < 0, String(brickMortar.relief));

  // 6. Brick per-cell tilt and height variance
  const brickA = PM.evalPattern(0.178125, 0.0625, { type: 'Brick', scaleX: 8, scaleY: 8, gap: 0.06, softness: 0.02, seed: 1, heightVariance: 0.25, brickAspectRatio: 2.85 });
  const brickB = PM.evalPattern(0.178125, 0.3125, { type: 'Brick', scaleX: 8, scaleY: 8, gap: 0.06, softness: 0.02, seed: 1, heightVariance: 0.25, brickAspectRatio: 2.85 });
  check('Different brick rows produce distinct cell hashes', brickA.cellHash !== brickB.cellHash);
  check('Height variance produces distinct heights between bricks', Math.abs(brickA.height - brickB.height) > 0.001);

  // 7. Inverted smoothstep fix: edge transitions are smooth and non-inverted (fill >= 0 and <= 1)
  for (let m = 1; m <= 10; m++) {
    const res = PM.evalPattern(0.123, 0.456, { mode: m, scaleX: 6, scaleY: 6, gap: 0.08, softness: 0.03, seed: 42 });
    check(`Pattern mode ${m} fill is within [0, 1]`, res.fill >= 0 && res.fill <= 1, String(res.fill));
  }
}

console.log('\n25. Direct pattern displacement in DisplacedMesh3D');
{
  const DM = globalThis.gdjs.__displacedMesh3D;
  const GC = globalThis.gdjs.__geometryController3D;

  const mesh = makeMesh('DirectMesh', new MeshStandardMaterial(), new StubBoxGeometry(4));
  const obj = { get3DRendererObject: () => mesh };
  const dmBh = makeBehavior({
    Enabled: true, DisplacementMode: 'Pattern Driven', UpdateMode: 'On creation',
    IncludeChildren: true, Seed: 42, SubdivideCubes: false, Subdivision: 1,
    MaxVerticesPerObject: 20000, PreserveSharpEdges: true, BridgeSeams: true,
    AutoTiling: true, PatternDepth: 0.12, PatternRaise: 0.04, PatternBevel: 0.5,
    PatternHeightVariance: 0.25, PatternSurfaceNoise: 0.15,
    UseDirectPattern: true, PatternType: 'Brick', ScaleX: 6, ScaleY: 6,
    GapWidth: 0.08, EdgeSoftness: 0.02, PatternTiltStrength: 0.2, BrickAspectRatio: 2.85,
    RoughnessStrength: 0, NoiseFrequency: 2, NoiseOctaves: 4, NoisePersistence: 0.5,
    NoiseLacunarity: 2, TerraceLayers: 0, TerraceSharpness: 0.6, CornerErosion: 0,
    MicroPitting: 0, CreviceShading: 0, AnisotropicFiltering: '16x'
  });

  DM.sync(dmBh, obj);
  check('DisplacedMesh3D reaches Ready with direct pattern', DM.stateOf(dmBh).state === 'Ready');
  const initialRebuilds = DM.stateOf(dmBh).rebuildCount;
  for (let i = 0; i < 120; i++) DM.sync(dmBh, obj);
  check('On creation mode does not rebuild during 120 unchanged ticks',
    DM.stateOf(dmBh).rebuildCount === initialRebuilds, String(DM.stateOf(dmBh).rebuildCount));
  check('Mesh is deformed by direct pattern', DM.stateOf(dmBh).affectedMeshCount > 0);
  check('DisplacedMesh3D reads useDirectPattern: true', DM.readParams(dmBh).useDirectPattern === true);
  check('Direct pattern recipe resolves Brick pattern', DM.readParams(dmBh).patternType === 'Brick');
  check('Direct pattern recipe resolves brickAspectRatio 2.85', DM.readParams(dmBh).brickAspectRatio === 2.85);

  const posAttr = mesh.geometry.attributes.position;
  let hasNonZero = false;
  for (let i = 0; i < posAttr.array.length; i++) {
    if (posAttr.array[i] !== 0) hasNonZero = true;
  }
  check('Working geometry has non-zero vertex coordinates', hasNonZero);
  dmBh._setUpdateMode('On property change');
  const beforeBatchedChange = DM.stateOf(dmBh).rebuildCount;
  for (let i = 0; i < 10; i++) DM.markDirty(dmBh, obj);
  check('Property setters queue work without rebuilding synchronously',
    DM.stateOf(dmBh).rebuildCount === beforeBatchedChange);
  DM.sync(dmBh, obj);
  check('Ten property changes coalesce into one rebuild',
    DM.stateOf(dmBh).rebuildCount === beforeBatchedChange + 1);
  DM.sync(dmBh, obj);
  check('On property change remains idle after the dirty rebuild',
    DM.stateOf(dmBh).rebuildCount === beforeBatchedChange + 1);
  dmBh._setUpdateMode('Manual');
  DM.markDirty(dmBh, obj);
  DM.sync(dmBh, obj);
  check('Manual mode never rebuilds implicitly',
    DM.stateOf(dmBh).rebuildCount === beforeBatchedChange + 1);
  DM.rebuildMesh(dmBh, obj);
  check('Manual RebuildMesh performs exactly one rebuild',
    DM.stateOf(dmBh).rebuildCount === beforeBatchedChange + 2);
  DM.dispose(dmBh, obj);
  check('Disposed DisplacedMesh3D releases ownership', !GC.isMeshOwnedByOther(mesh, dmBh));
}

console.log('\n26. Automatic material isolation on shared materials across objects');
{
  const MC = globalThis.gdjs.__materialController3D;
  const PATTERN = globalThis.gdjs.__patternMaterial3D;
  const WET = globalThis.gdjs.__wetMaterial3D;

  // 1. Standalone PatternMaterial3D isolates shared material and does NOT bleed to sibling objects
  const sharedMat = new MeshStandardMaterial();
  const meshA = makeMesh('Step', sharedMat);
  const objA = { get3DRendererObject: () => meshA };
  const meshB = makeMesh('Wall', sharedMat);
  const objB = { get3DRendererObject: () => meshB };

  check('Before sync: meshA and meshB share exact same material instance', meshA.material === meshB.material);

  const patternBh = makeBehavior({
    Enabled: true, PatternType: 'Brick', ScaleX: 4, ScaleY: 4, Seed: 1, GapWidth: 0.06, EdgeSoftness: 0.02,
    PrimaryColor: '200;200;200', SecondaryColor: '150;150;150', BorderColor: '80;80;80', TextureOverlayColor: '255;255;255',
    Saturation: 1, ColorVariation: 0.15, NoiseScale: 2, NoiseStrength: 0.15, SurfaceRoughness: 0.6, BorderRoughness: 0.9,
    Metalness: 0, Strength: 1, OverwriteTexture: true, AutoTiling: true, AnisotropicFiltering: '16x',
    TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: ''
  });

  PATTERN.sync(patternBh, objA);

  check('meshA material was cloned and isolated', meshA.material !== sharedMat);
  check('meshA material has pattern installed', meshA.material.__m3dPattern && meshA.material.__m3dPattern.enabled === true);
  check('meshB material remains original sharedMat', meshB.material === sharedMat);
  check('meshB material does NOT have pattern (no bleed-through to other objects!)', meshB.material.__m3dPattern === undefined);

  // 2. Repeated sync calls on objA do NOT re-clone or recreate isolated material
  const isolatedMatA = meshA.material;
  PATTERN.sync(patternBh, objA);
  check('Repeated sync reuses isolated material without re-cloning', meshA.material === isolatedMatA);

  PATTERN.dispose(patternBh);

  // 3. Multi-material mesh (e.g. 6-face 3D Box) with slot targeting
  const sharedFaceMat = new MeshStandardMaterial();
  const multiMeshA = makeMesh('BoxA', [sharedFaceMat, sharedFaceMat, sharedFaceMat]);
  const multiObjA = { get3DRendererObject: () => multiMeshA };
  const multiMeshB = makeMesh('BoxB', [sharedFaceMat, sharedFaceMat, sharedFaceMat]);
  const multiObjB = { get3DRendererObject: () => multiMeshB };

  const slotPatternBh = makeBehavior({
    Enabled: true, PatternType: 'Brick', ScaleX: 4, ScaleY: 4, Seed: 1, GapWidth: 0.06, EdgeSoftness: 0.02,
    PrimaryColor: '200;200;200', SecondaryColor: '150;150;150', BorderColor: '80;80;80', TextureOverlayColor: '255;255;255',
    Saturation: 1, ColorVariation: 0.15, NoiseScale: 2, NoiseStrength: 0.15, SurfaceRoughness: 0.6, BorderRoughness: 0.9,
    Metalness: 0, Strength: 1, OverwriteTexture: true, AutoTiling: true, AnisotropicFiltering: '16x',
    TargetMode: 'Material index', MaterialIndex: 1, MaterialName: '', MeshName: ''
  });

  PATTERN.sync(slotPatternBh, multiObjA);

  check('Slot 1 on BoxA was isolated', multiMeshA.material[1] !== sharedFaceMat);
  check('Slot 1 on BoxA has pattern installed', multiMeshA.material[1].__m3dPattern && multiMeshA.material[1].__m3dPattern.enabled === true);
  check('Slot 0 on BoxA was NOT modified', multiMeshA.material[0].__m3dPattern === undefined);
  check('Slot 1 on BoxB remains untouched sharedFaceMat with NO pattern', multiMeshB.material[1] === sharedFaceMat && multiMeshB.material[1].__m3dPattern === undefined);

  PATTERN.dispose(slotPatternBh);

  // 4. Standalone WetMaterial3D also isolates shared material
  const dryShared = new MeshStandardMaterial();
  dryShared.roughness = 0.85;
  const wetMeshA = makeMesh('WetObj', dryShared);
  const wetObjA = { get3DRendererObject: () => wetMeshA };
  const wetMeshB = makeMesh('DryObj', dryShared);
  const wetObjB = { get3DRendererObject: () => wetMeshB };

  const wetBh = makeBehavior({
    Wetness: 1, Porosity: 0.5, WetRoughness: 0.1, DarkeningStrength: 0.35,
    AnisotropicFiltering: '16x', TargetMode: 'All materials', MaterialIndex: 0, MaterialName: '', MeshName: ''
  });

  WET.sync(wetBh, wetObjA);
  check('WetObj material was isolated from shared material', wetMeshA.material !== dryShared);
  check('WetObj material has wet roughness applied', wetMeshA.material.roughness < 0.85);
  check('DryObj material remains dryShared with original roughness 0.85', wetMeshB.material === dryShared && wetMeshB.material.roughness === 0.85);

  WET.dispose(wetBh);
}

console.log('\n27. Inspector panel preset & primary selector positioning and preset resolution');
{
  const extJson = JSON.parse(fs.readFileSync(path.join(here, 'MaterialMaster.json'), 'utf8'));
  const bMap = new Map(extJson.eventsBasedBehaviors.map((b) => [b.name, b]));

  // 0. Coverage guards.
  //
  // A runtime file that no test loads is a file whose bugs reach the editor first, and one the
  // build forgot to embed ships as a behavior that does nothing. Both have happened, so both are
  // checked against the directory rather than a hand-maintained list.
  const onDisk = fs.readdirSync(here).filter((f) => f.endsWith('.runtime.js')).sort();
  const suiteSrc = fs.readFileSync(path.join(here, 'test-materialmaster.mjs'), 'utf8');
  const buildSrc = fs.readFileSync(path.join(here, 'build-extension.mjs'), 'utf8');
  const notLoaded = onDisk.filter((f) => !suiteSrc.includes(`'${f}'`));
  const notBuilt = onDisk.filter((f) => !buildSrc.includes(`'${f}'`));
  check('Every runtime file on disk is loaded by this suite', notLoaded.length === 0, notLoaded.join(', '));
  check('Every runtime file on disk is read by the build', notBuilt.length === 0, notBuilt.join(', '));

  // The removed Fallback* set must not reappear anywhere in the shipped extension.
  const jsonText = JSON.stringify(extJson);
  check('No Fallback* property survives in the built extension',
    !/"name":"Fallback/.test(jsonText) && !/_setFallback|_getFallback/.test(jsonText));

  // 1. Core
  const coreB = bMap.get('MaterialCore3D');
  check('Core behavior exists in JSON', !!coreB);
  check('Core property 0 is Preset', coreB.propertyDescriptors[0].name === 'Preset');
  check('Core property 0 group is Presets & Material Class', coreB.propertyDescriptors[0].group === 'Presets & Material Class');
  check('Core property 1 is ShaderType', coreB.propertyDescriptors[1].name === 'ShaderType');
  check('Core property 1 group is Presets & Material Class', coreB.propertyDescriptors[1].group === 'Presets & Material Class');
  const coreLastProps = coreB.propertyDescriptors.slice(-8).map((p) => p.name);
  check('Core targeting & apply properties are at the end', coreLastProps.includes('TargetMode') && coreLastProps.includes('ApplyOnCreation'));

  // 2. Physical
  const physB = bMap.get('PhysicalMaterial3D');
  check('Physical behavior exists in JSON', !!physB);
  check('Physical property 0 is Preset', physB.propertyDescriptors[0].name === 'Preset');
  check('Physical property 0 group is Presets & Glass', physB.propertyDescriptors[0].group === 'Presets & Glass');
  const physLastProps = physB.propertyDescriptors.slice(-4).map((p) => p.name);
  check('Physical targeting properties are at the end', physLastProps.includes('TargetMode') && physLastProps.includes('MeshName'));

  // 3. Pattern
  const patB = bMap.get('TiledCustomPatternMaterial3D');
  check('Pattern behavior exists in JSON', !!patB);
  check('Pattern property 0 is Preset', patB.propertyDescriptors[0].name === 'Preset');
  check('Pattern property 0 group is Presets & Pattern', patB.propertyDescriptors[0].group === 'Presets & Pattern');
  check('Pattern property 1 is PatternType', patB.propertyDescriptors[1].name === 'PatternType');
  check('Pattern property 2 is Enabled', patB.propertyDescriptors[2].name === 'Enabled');
  const patLastProps = patB.propertyDescriptors.slice(-4).map((p) => p.name);
  check('Pattern targeting properties are at the end', patLastProps.includes('TargetMode') && patLastProps.includes('MeshName'));

  // 4. BRDF
  const brdfB = bMap.get('BRDFMaterial');
  check('BRDF behavior exists in JSON', !!brdfB);
  check('BRDF property 0 is BRDFModel', brdfB.propertyDescriptors[0].name === 'BRDFModel');
  check('BRDF property 0 group is Model', brdfB.propertyDescriptors[0].group === 'Model');
  const brdfLastProps = brdfB.propertyDescriptors.slice(-5).map((p) => p.name);
  check('BRDF targeting properties are at the end', brdfLastProps.includes('TargetMode') && brdfLastProps.includes('MeshName'));

  // 5. Animated
  const animB = bMap.get('AnimatedMaterial3D');
  check('Animated behavior exists in JSON', !!animB);
  check('Animated property 0 group is UV Transform', animB.propertyDescriptors[0].group === 'UV Transform');
  const animLastProps = animB.propertyDescriptors.slice(-4).map((p) => p.name);
  check('Animated targeting properties are at the end', animLastProps.includes('TargetMode') && animLastProps.includes('MeshName'));

  // 6. Wet
  const wetB = bMap.get('WetMaterial3D');
  check('Wet behavior exists in JSON', !!wetB);
  check('Wet property 0 group is Wet Surface', wetB.propertyDescriptors[0].group === 'Wet Surface');
  const wetLastProps = wetB.propertyDescriptors.slice(-4).map((p) => p.name);
  check('Wet targeting properties are at the end', wetLastProps.includes('TargetMode') && wetLastProps.includes('MeshName'));

  // 7. Displaced
  const dispB = bMap.get('DisplacedMesh3D');
  check('Displaced behavior exists in JSON', !!dispB);
  check('Displaced property 0 is DisplacementMode', dispB.propertyDescriptors[0].name === 'DisplacementMode');
  check('Displaced property 0 group is Displacement & Mode', dispB.propertyDescriptors[0].group === 'Displacement & Mode');
  check('Displaced property 1 is Enabled', dispB.propertyDescriptors[1].name === 'Enabled');
  const dispLastProps = dispB.propertyDescriptors.slice(-4).map((p) => p.name);
  check('Displaced general properties are at the end', dispLastProps.includes('UpdateMode') && dispLastProps.includes('Seed'));

  // 8. Runtime preset resolution: Core presets
  const chromeSetup = setup({ Preset: 'Metal / Chrome' });
  M3.applyToBehavior(chromeSetup.behavior, chromeSetup.object, chromeSetup.game);
  check('Core Metal / Chrome preset applies metalness 1.0', chromeSetup.mesh.material.metalness === 1.0);
  check('Core Metal / Chrome preset applies low roughness 0.05', chromeSetup.mesh.material.roughness === 0.05);

  const rubberSetup = setup({ Preset: 'Rubber' });
  M3.applyToBehavior(rubberSetup.behavior, rubberSetup.object, rubberSetup.game);
  check('Core Rubber preset applies high roughness 0.9', rubberSetup.mesh.material.roughness === 0.9);
  check('Core Rubber preset applies metalness 0.0', rubberSetup.mesh.material.metalness === 0.0);

  const glassSetup = setup({ Preset: 'Glass / Window', ShaderType: 'Auto' });
  M3.applyToBehavior(glassSetup.behavior, glassSetup.object, glassSetup.game);
  check('Core Glass / Window preset promotes to PhysicalMaterial under Auto', glassSetup.mesh.material.isMeshPhysicalMaterial === true);

  // 9. Runtime preset resolution: Pattern presets
  const PATTERN = globalThis.gdjs.__patternMaterial3D;
  const brickBh = makeBehavior({ Preset: 'Red Brick', PatternType: 'Brick' });
  const brickParams = PATTERN.read(brickBh);
  check('Pattern Red Brick preset resolves Brick mode', brickParams.type === 'Brick');
  check('Pattern Red Brick preset resolves brick primary color', brickParams.primary === '180;60;45');
  check('Pattern Red Brick preset resolves roughness 0.8', brickParams.roughPrimary === 0.8);

  const subwayBh = makeBehavior({ Preset: 'Subway Tiles', PatternType: 'Brick' });
  const subwayParams = PATTERN.read(subwayBh);
  check('Pattern Subway Tiles preset resolves Tiles mode', subwayParams.type === 'Tiles');
  check('Pattern Subway Tiles preset resolves gap 0.03', subwayParams.gap === 0.03);

  // 10. Runtime preset resolution: Physical presets
  const PHYSICAL = globalThis.gdjs.__physicalMaterial3D;
  const glassBh = makeBehavior({ Preset: 'Clear Glass' });
  const glassParams = PHYSICAL.read(glassBh);
  check('Physical Clear Glass preset resolves transmission 0.95', glassParams.transmission === 0.95);
  check('Physical Clear Glass preset resolves ior 1.5', glassParams.ior === 1.5);

  const carBh = makeBehavior({ Preset: 'Car Lacquer' });
  const carParams = PHYSICAL.read(carBh);
  check('Physical Car Lacquer preset resolves clearcoat 1.0', carParams.clearcoat === 1.0);
}

console.log('\n28. Performance hot-path guards');
{
  const MC = globalThis.gdjs.__materialController3D;
  const cases = [
    ['Physical', globalThis.gdjs.__physicalMaterial3D, makeBehavior({ Preset:'Custom', Transmission:0, IOR:1.5, Thickness:.1, Clearcoat:0, ClearcoatRoughness:0, Sheen:0, SheenColor:'255;255;255', SheenRoughness:1, Iridescence:0, IridescenceIOR:1.3, IridescenceThicknessMin:100, IridescenceThicknessMax:400, Anisotropy:0, AnisotropyRotation:0, AnisotropicFiltering:'8x', TargetMode:'All materials', MaterialIndex:0, MaterialName:'', MeshName:'' })],
    ['Wet', globalThis.gdjs.__wetMaterial3D, makeBehavior({ Wetness:.5, Porosity:.5, WetRoughness:.05, DarkeningStrength:.35, AnisotropicFiltering:'8x', TargetMode:'All materials', MaterialIndex:0, MaterialName:'', MeshName:'' })],
    ['Pattern', globalThis.gdjs.__patternMaterial3D, makeBehavior({ Preset:'Custom', Enabled:true, PatternType:'Brick', ScaleX:8, ScaleY:8, RotationAngle:0, Seed:1, GapWidth:.06, EdgeSoftness:.02, PrimaryColor:'180;180;180', SecondaryColor:'130;130;130', BorderColor:'45;45;45', TextureOverlayColor:'255;255;255', Saturation:1, ColorVariation:.15, NoiseScale:2, NoiseStrength:.15, SurfaceRoughness:.6, BorderRoughness:.9, Metalness:0, Strength:1, OverwriteTexture:true, AutoTiling:true, AnisotropicFiltering:'8x', TargetMode:'All materials', MaterialIndex:0, MaterialName:'', MeshName:'' })]
  ];
  for (const [name, runtime, behavior] of cases) {
    const a = setup();
    M3.applyToBehavior(a.behavior, a.object, a.game);
    runtime.sync(behavior, a.object);
    MC.resetPerformanceMetrics(a.mesh);
    for (let i = 0; i < 1000; i++) runtime.tick(behavior, a.object);
    const metrics = MC.getPerformanceMetrics(a.mesh);
    check(`${name} performs zero target resolutions over 1000 unchanged ticks`, metrics.targetResolutions === 0, JSON.stringify(metrics));
    check(`${name} performs zero anisotropy scans over 1000 unchanged ticks`, metrics.anisotropyScans === 0, JSON.stringify(metrics));
    runtime.dispose(behavior);
  }

  const animSource = new StubTexture();
  const animMaterial = new MeshStandardMaterial(); animMaterial.map = animSource;
  const a = setup({}, animMaterial);
  M3.applyToBehavior(a.behavior, a.object, a.game);
  const behavior = makeBehavior({ TilingX:1, TilingY:1, OffsetX:0, OffsetY:0, RotationAngle:0, RotationCenterX:.5, RotationCenterY:.5, EnableScroll:false, ScrollSpeedX:0, ScrollSpeedY:0, ScrollRotationSpeed:0, EnableFlipbook:false, FlipbookColumns:1, FlipbookRows:1, FlipbookFPS:12, FlipbookLoop:true, FlipbookTotalFrames:0, AnisotropicFiltering:'8x', TargetMode:'All materials', MaterialIndex:0, MaterialName:'', MeshName:'' });
  globalThis.gdjs.__animatedMaterial3D.sync(behavior, a.object);
  MC.resetPerformanceMetrics(a.mesh);
  for (let i = 0; i < 1000; i++) globalThis.gdjs.__animatedMaterial3D.tick(behavior, a.object, 1/60);
  const metrics = MC.getPerformanceMetrics(a.mesh);
  check('Inactive Animated performs zero target resolutions over 1000 ticks', metrics.targetResolutions === 0, JSON.stringify(metrics));
  check('Inactive Animated performs zero anisotropy scans over 1000 ticks', metrics.anisotropyScans === 0, JSON.stringify(metrics));
  globalThis.gdjs.__animatedMaterial3D.dispose(behavior);

  const zeroPattern = setup();
  M3.applyToBehavior(zeroPattern.behavior, zeroPattern.object, zeroPattern.game);
  const zeroBehavior = makeBehavior({ Preset:'Custom', Enabled:true, PatternType:'Brick', ScaleX:8, ScaleY:8, RotationAngle:0, Seed:1, GapWidth:.06, EdgeSoftness:.02, PrimaryColor:'180;180;180', SecondaryColor:'130;130;130', BorderColor:'45;45;45', TextureOverlayColor:'255;255;255', Saturation:1, ColorVariation:.15, NoiseScale:2, NoiseStrength:.15, SurfaceRoughness:.6, BorderRoughness:.9, Metalness:0, Strength:0, OverwriteTexture:true, AutoTiling:true, AnisotropicFiltering:'8x', TargetMode:'All materials', MaterialIndex:0, MaterialName:'', MeshName:'' });
  globalThis.gdjs.__patternMaterial3D.sync(zeroBehavior, zeroPattern.object);
  check('Zero-strength Pattern adds no active fragment injector',
    !gdjs.__m3dShaderChain.activeFor(zeroPattern.mesh.material).some((injector) => injector.id === 'pattern-material'));
  globalThis.gdjs.__patternMaterial3D.dispose(zeroBehavior);
}

console.log('\n29. Surface expansion and neighbour blending');
{
  const DMx = globalThis.gdjs.__displacedMesh3D;
  const MB = globalThis.gdjs.__meshBlend3D;

  // A cube placed in the world the way the engine places one: unit BoxGeometry on a mesh whose
  // world matrix carries the object's size and position. Column-major, matching THREE.
  const worldCube = (name, seg, cx, cy, cz, sx, sy, sz) => {
    const mesh = makeMesh(name, new MeshStandardMaterial(), new THREE.BoxGeometry(1, 1, 1, seg, seg, seg));
    mesh.matrixWorld = {
      elements: [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, cx, cy, cz, 1],
    };
    mesh.updateMatrixWorld = () => {};
    return { mesh, object: { get3DRendererObject: () => mesh } };
  };

  // Every noise and pattern term off, so the only thing moving a vertex is what is under test.
  const quietProps = (extra) => ({
    Enabled: true, DisplacementMode: 'Custom Noise', UpdateMode: 'On creation',
    IncludeChildren: true, Seed: 7, SubdivideCubes: true, Subdivision: 4,
    MaxVerticesPerObject: 20000, PreserveSharpEdges: true, BridgeSeams: false, AutoTiling: false,
    PatternDepth: 0, PatternRaise: 0, PatternBevel: 0, PatternHeightVariance: 0,
    PatternSurfaceNoise: 0, UseDirectPattern: false, PatternType: 'Solid',
    ScaleX: 1, ScaleY: 1, GapWidth: 0, EdgeSoftness: 0.01,
    RoughnessStrength: 0, NoiseFrequency: 1, NoiseOctaves: 1, NoisePersistence: 0.5,
    NoiseLacunarity: 2, TerraceLayers: 0, TerraceSharpness: 0, CornerErosion: 0,
    MicroPitting: 0, CreviceShading: 0, AnisotropicFiltering: '16x',
    UseRelativeUnits: true, Inflate: 0, EdgeSeal: 0, EdgeSealWidth: 0.15,
    BlendNeighbors: false, BlendGroup: '', BlendRadius: 0.25, BlendCornerRadius: 0.15,
    ...extra,
  });

  // Largest |x| over the +X face's vertices, i.e. how far that face sits from the centre.
  const faceExtentX = (mesh) => {
    const pos = mesh.geometry.attributes.position;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) max = Math.max(max, pos.getX(i));
    return max;
  };
  const faceExtentY = (mesh) => {
    const pos = mesh.geometry.attributes.position;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) max = Math.max(max, pos.getY(i));
    return max;
  };

  MB.clear();

  /* --- Inflate ------------------------------------------------------------- */
  const plain = worldCube('Plain', 4, 0, 0, 0, 100, 100, 100);
  const plainB = makeBehavior(quietProps());
  DMx.sync(plainB, plain.object);
  const plainExtent = faceExtentX(plain.mesh);
  check('Quiet cube with no expansion keeps its original half extent',
    Math.abs(plainExtent - 0.5) < 1e-6, String(plainExtent));

  const puffed = worldCube('Puffed', 4, 0, 0, 0, 100, 100, 100);
  const puffedB = makeBehavior(quietProps({ Inflate: 0.1 }));
  DMx.sync(puffedB, puffed.object);
  const puffedExtent = faceExtentX(puffed.mesh);
  // 0.1 relative on a 100-unit cube is 10 world units, i.e. 0.1 in local unit-cube space.
  check('Inflate pushes the surface outward', puffedExtent > plainExtent, String(puffedExtent));
  check('Inflate of 0.1 relative moves the face by 10% of the cube',
    Math.abs(puffedExtent - 0.6) < 1e-4, String(puffedExtent));

  // The whole point of scale compensation: on a cube that is 100 wide and 400 tall, the same
  // inflate must move the X and Y faces the same WORLD distance, not the same local distance.
  const stretched = worldCube('Stretched', 4, 0, 0, 0, 100, 400, 100);
  const stretchedB = makeBehavior(quietProps({ Inflate: 0.1 }));
  DMx.sync(stretchedB, stretched.object);
  const worldPushX = (faceExtentX(stretched.mesh) - 0.5) * 100;
  const worldPushY = (faceExtentY(stretched.mesh) - 0.5) * 400;
  check('Inflate is scale-compensated on a non-uniform cube',
    Math.abs(worldPushX - worldPushY) < 1e-3, `${worldPushX} vs ${worldPushY}`);

  const rawUnits = worldCube('RawUnits', 4, 0, 0, 0, 100, 100, 100);
  const rawUnitsB = makeBehavior(quietProps({ UseRelativeUnits: false, Inflate: 25 }));
  DMx.sync(rawUnitsB, rawUnits.object);
  check('Absolute units treat Inflate as world distance',
    Math.abs(faceExtentX(rawUnits.mesh) - 0.75) < 1e-4, String(faceExtentX(rawUnits.mesh)));

  // Bridge seams is on by default and rewrites the apply step entirely — it averages the offset
  // and the normal across coincident vertices — so expansion has to survive that path too, not
  // just the simple one the tests above exercise.
  const bridged = worldCube('Bridged', 4, 0, 0, 0, 100, 100, 100);
  const bridgedB = makeBehavior(quietProps({ BridgeSeams: true, Inflate: 0.1 }));
  DMx.sync(bridgedB, bridged.object);
  const bridgedExtent = faceExtentX(bridged.mesh);
  check('Inflate still expands with bridge seams enabled', bridgedExtent > 0.5 + 1e-6, String(bridgedExtent));
  // Face centres are a single vertex, so they take the full push; shared edges average three
  // normals into a diagonal and travel the same distance along it, which is what rounds the box
  // rather than fattening it into a larger cube.
  check('Bridged face centre takes the full inflate',
    Math.abs(bridgedExtent - 0.6) < 1e-4, String(bridgedExtent));

  /* --- Edge seal ----------------------------------------------------------- */
  // Corner erosion is the term that deliberately pulls face borders inward; the seal exists to
  // stop it opening a gap between two packed cubes.
  const erodedProps = { DisplacementMode: 'Geological Weathering', CornerErosion: 1, RoughnessStrength: 0.4 };
  const eroded = worldCube('Eroded', 4, 0, 0, 0, 100, 100, 100);
  const erodedB = makeBehavior(quietProps(erodedProps));
  DMx.sync(erodedB, eroded.object);

  const sealed = worldCube('Sealed', 4, 0, 0, 0, 100, 100, 100);
  const sealedB = makeBehavior(quietProps({ ...erodedProps, EdgeSeal: 1, EdgeSealWidth: 0.25 }));
  DMx.sync(sealedB, sealed.object);

  // How far the RIM of each face sits from the centre, along that face's own axis. The seal only
  // governs border vertices — face interiors are meant to keep pillowing freely — so measuring
  // the whole mesh would just report the deepest interior dimple and prove nothing.
  const rimExtent = (mesh, seg) => {
    const pos = mesh.geometry.attributes.position;
    const faceVerts = (seg + 1) * (seg + 1);
    const axisOfFace = [0, 0, 1, 1, 2, 2]; // stub box face order: +X -X +Y -Y +Z -Z
    const get = [pos.getX.bind(pos), pos.getY.bind(pos), pos.getZ.bind(pos)];
    let worst = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const local = i % faceVerts;
      const gx = local % (seg + 1);
      const gy = Math.floor(local / (seg + 1));
      if (gx !== 0 && gx !== seg && gy !== 0 && gy !== seg) continue; // interior, not the rim
      worst = Math.min(worst, Math.abs(get[axisOfFace[Math.floor(i / faceVerts)]](i)));
    }
    return worst;
  };
  check('Corner erosion pulls the rim inside the cube without a seal',
    rimExtent(eroded.mesh, 4) < 0.5 - 1e-6, String(rimExtent(eroded.mesh, 4)));
  check('Edge seal lifts the retracted rim back toward the base surface',
    rimExtent(sealed.mesh, 4) > rimExtent(eroded.mesh, 4),
    `${rimExtent(sealed.mesh, 4)} vs ${rimExtent(eroded.mesh, 4)}`);
  check('A full edge seal holds the rim at the base surface',
    Math.abs(rimExtent(sealed.mesh, 4) - 0.5) < 1e-6, String(rimExtent(sealed.mesh, 4)));

  /* --- blendPush shape ----------------------------------------------------- */
  MB.clear();
  const probe = worldCube('Probe', 2, 0, 0, 0, 100, 100, 100);
  const probeKey = {};
  MB.publish(probeKey, probe.mesh, '', 0.5, 0.5, 0.5);
  const probeEntry = MB._entries.get(probeKey);
  const k = 40;
  check('Blend push is zero well outside the blend radius',
    MB.blendPush([probeEntry], 0, 0, 500, k, 0) === 0);
  check('Blend push peaks at radius/4 on contact',
    Math.abs(MB.blendPush([probeEntry], 0, 0, 50, k, 0) - k / 4) < 1e-6,
    String(MB.blendPush([probeEntry], 0, 0, 50, k, 0)));
  check('Blend push never exceeds radius/4 when deeply overlapping',
    MB.blendPush([probeEntry], 0, 0, 0, k, 0) <= k / 4 + 1e-9);
  check('Blend push decreases with distance',
    MB.blendPush([probeEntry], 0, 0, 60, k, 0) > MB.blendPush([probeEntry], 0, 0, 80, k, 0));

  /* --- Two adjacent cubes -------------------------------------------------- */
  MB.clear();
  const left = worldCube('Left', 4, 0, 0, 0, 100, 100, 100);
  const right = worldCube('Right', 4, 100, 0, 0, 100, 100, 100);
  const blendProps = { BlendNeighbors: true, BlendGroup: 'stone', BlendRadius: 0.4, UpdateMode: 'On property change' };
  const leftB = makeBehavior(quietProps(blendProps));
  const rightB = makeBehavior(quietProps(blendProps));

  DMx.sync(leftB, left.object);
  DMx.sync(rightB, right.object);
  // Left published first and saw nobody; right saw left. Re-sync left now that both are present.
  DMx.sync(leftB, left.object);

  check('Registry holds both participating cubes', MB.count() === 2, String(MB.count()));
  check('Left cube found its neighbour', DMx.stateOf(leftB).blendNeighborCount === 1,
    String(DMx.stateOf(leftB).blendNeighborCount));

  const leftPos = left.mesh.geometry.attributes.position;
  let facingMax = -Infinity, awayMin = Infinity;
  for (let i = 0; i < leftPos.count; i++) {
    const x = leftPos.getX(i);
    if (x > 0) facingMax = Math.max(facingMax, x);
    if (x < 0) awayMin = Math.min(awayMin, x);
  }
  check('The face touching the neighbour bulges outward', facingMax > 0.5 + 1e-6, String(facingMax));
  check('The far face is untouched by the blend', Math.abs(awayMin + 0.5) < 1e-6, String(awayMin));

  /* --- Group filtering ----------------------------------------------------- */
  MB.clear();
  const stone = worldCube('Stone', 4, 0, 0, 0, 100, 100, 100);
  const wood = worldCube('Wood', 4, 100, 0, 0, 100, 100, 100);
  const stoneB = makeBehavior(quietProps({ BlendNeighbors: true, BlendGroup: 'stone', BlendRadius: 0.4 }));
  const woodB = makeBehavior(quietProps({ BlendNeighbors: true, BlendGroup: 'wood', BlendRadius: 0.4 }));
  DMx.sync(woodB, wood.object);
  DMx.sync(stoneB, stone.object);
  check('Different blend groups do not merge', DMx.stateOf(stoneB).blendNeighborCount === 0,
    String(DMx.stateOf(stoneB).blendNeighborCount));

  MB.clear();
  const anyA = worldCube('AnyA', 4, 0, 0, 0, 100, 100, 100);
  const anyB = worldCube('AnyB', 4, 100, 0, 0, 100, 100, 100);
  const anyABeh = makeBehavior(quietProps({ BlendNeighbors: true, BlendGroup: '', BlendRadius: 0.4 }));
  const anyBBeh = makeBehavior(quietProps({ BlendNeighbors: true, BlendGroup: 'wood', BlendRadius: 0.4 }));
  DMx.sync(anyBBeh, anyB.object);
  DMx.sync(anyABeh, anyA.object);
  check('An empty blend group merges with any participant',
    DMx.stateOf(anyABeh).blendNeighborCount === 1, String(DMx.stateOf(anyABeh).blendNeighborCount));

  /* --- Registry eviction --------------------------------------------------- */
  MB.clear();
  const host = worldCube('Host', 4, 0, 0, 0, 100, 100, 100);
  const guest = worldCube('Guest', 4, 100, 0, 0, 100, 100, 100);
  const hostB = makeBehavior(quietProps({ BlendNeighbors: true, BlendRadius: 0.4 }));
  const guestB = makeBehavior(quietProps({ BlendNeighbors: true, BlendRadius: 0.4 }));
  DMx.sync(guestB, guest.object);
  DMx.sync(hostB, host.object);
  const withGuest = DMx.stateOf(hostB).blendSignature;
  check('Host blended with guest', DMx.stateOf(hostB).blendNeighborCount === 1);

  DMx.dispose(guestB, guest.object);
  check('Destroying a neighbour withdraws it from the registry', MB.count() === 1, String(MB.count()));
  DMx.sync(hostB, host.object);
  check('Host re-deformed once its neighbour disappeared',
    DMx.stateOf(hostB).blendSignature !== withGuest && DMx.stateOf(hostB).blendNeighborCount === 0);
  check('Host surface returned to its base extent',
    Math.abs(faceExtentX(host.mesh) - 0.5) < 1e-6, String(faceExtentX(host.mesh)));

  // Turning blending off has to withdraw the box too, not merely stop reading it.
  MB.clear();
  const quitter = worldCube('Quitter', 4, 0, 0, 0, 100, 100, 100);
  const quitterProps = quietProps({ BlendNeighbors: true, BlendRadius: 0.4 });
  const quitterB = makeBehavior(quitterProps);
  DMx.sync(quitterB, quitter.object);
  check('Participant is registered while blending is on', MB.count() === 1, String(MB.count()));
  quitterB._setBlendNeighbors(false);
  DMx.sync(quitterB, quitter.object);
  check('Turning blending off withdraws the participant', MB.count() === 0, String(MB.count()));

  MB.clear();
}

console.log('\n30. Cube3D tint and UV survival');
{
  const DMx = globalThis.gdjs.__displacedMesh3D;
  const MB = globalThis.gdjs.__meshBlend3D;
  MB.clear();

  // A Cube3D as the engine actually hands it over: 24-vertex unit box, a `color` attribute holding
  // the object tint, and materials built with vertexColors: true.
  const tintedCube = (r, g, bl, seg = 1) => {
    const geom = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
    const count = geom.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bl; }
    geom.setAttribute('color', new StubBufferAttribute(colors, 3));
    const mesh = makeMesh('Tinted', new MeshStandardMaterial(), geom);
    mesh.matrixWorld = { elements: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1] };
    mesh.updateMatrixWorld = () => {};
    return { mesh, object: { get3DRendererObject: () => mesh } };
  };

  const quiet = (extra) => ({
    Enabled: true, DisplacementMode: 'Custom Noise', UpdateMode: 'On property change',
    IncludeChildren: true, Seed: 3, SubdivideCubes: true, Subdivision: 4,
    MaxVerticesPerObject: 20000, PreserveSharpEdges: true, BridgeSeams: false, AutoTiling: false,
    PatternDepth: 0, PatternRaise: 0, PatternBevel: 0, PatternHeightVariance: 0,
    PatternSurfaceNoise: 0, UseDirectPattern: false, PatternType: 'Solid',
    ScaleX: 1, ScaleY: 1, GapWidth: 0, EdgeSoftness: 0.01,
    RoughnessStrength: 0, NoiseFrequency: 1, NoiseOctaves: 1, NoisePersistence: 0.5,
    NoiseLacunarity: 2, TerraceLayers: 0, TerraceSharpness: 0, CornerErosion: 0,
    MicroPitting: 0, CreviceShading: 0, AnisotropicFiltering: '16x',
    UseRelativeUnits: true, Inflate: 0, EdgeSeal: 0, EdgeSealWidth: 0.15,
    BlendNeighbors: false, BlendGroup: '', BlendRadius: 0.25, BlendCornerRadius: 0.15,
    ...extra,
  });

  /* --- the black-cube bug -------------------------------------------------- */
  const noCrevice = tintedCube(1, 0, 0);
  const noCreviceB = makeBehavior(quiet({ CreviceShading: 0 }));
  DMx.sync(noCreviceB, noCrevice.object);
  const ncColor = noCrevice.mesh.geometry.attributes.color;
  check('Subdivided cube still has a colour attribute with crevice shading off', !!ncColor);
  check('  and it is sized for the subdivided geometry',
    !!ncColor && ncColor.count === noCrevice.mesh.geometry.attributes.position.count,
    ncColor ? `${ncColor.count}` : 'missing');
  check('  and it carries the original tint, not black',
    !!ncColor && Math.abs(ncColor.getX(0) - 1) < 1e-6 && Math.abs(ncColor.getY(0)) < 1e-6,
    ncColor ? `${ncColor.getX(0)},${ncColor.getY(0)},${ncColor.getZ(0)}` : 'missing');

  /* --- crevice shading multiplies the tint --------------------------------- */
  const shaded = tintedCube(1, 0, 0);
  const shadedB = makeBehavior(quiet({
    DisplacementMode: 'Geological Weathering', CreviceShading: 1,
    RoughnessStrength: 0.4, CornerErosion: 1,
  }));
  DMx.sync(shadedB, shaded.object);
  const shColor = shaded.mesh.geometry.attributes.color;
  let anyDarkened = false, greenLeaked = false;
  for (let i = 0; i < shColor.count; i++) {
    if (shColor.getX(i) < 1 - 1e-6) anyDarkened = true;
    if (shColor.getY(i) > 1e-6 || shColor.getZ(i) > 1e-6) greenLeaked = true;
  }
  check('Crevice shading darkens some vertices', anyDarkened);
  check('Crevice shading keeps the block red instead of turning it grey', !greenLeaked);

  /* --- untinted objects still get the attribute removed -------------------- */
  const plainGeom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const plainMesh = makeMesh('Untinted', new MeshStandardMaterial(), plainGeom);
  plainMesh.matrixWorld = { elements: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1] };
  plainMesh.updateMatrixWorld = () => {};
  const plainB = makeBehavior(quiet({ CreviceShading: 0 }));
  DMx.sync(plainB, { get3DRendererObject: () => plainMesh });
  check('An object that never had vertex colours does not gain an empty one',
    !plainMesh.geometry.attributes.color);

  /* --- per-face tint maps onto the subdivided faces ------------------------ */
  const faceGeom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const faceColors = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 3;
      faceColors[i] = f / 5; faceColors[i + 1] = 0; faceColors[i + 2] = 1 - f / 5;
    }
  }
  faceGeom.setAttribute('color', new StubBufferAttribute(faceColors, 3));
  const perFace = DMx.captureBaseColors(faceGeom, 6 * 25, true);
  check('Per-face tint maps to the matching subdivided face',
    Math.abs(perFace[0] - 0) < 1e-6 &&
    Math.abs(perFace[(1 * 25) * 3] - 0.2) < 1e-6 &&
    Math.abs(perFace[(5 * 25) * 3] - 1) < 1e-6,
    `${perFace[0]}, ${perFace[25 * 3]}, ${perFace[125 * 3]}`);

  /* --- UV repair ----------------------------------------------------------- */
  const uvCube = tintedCube(0, 1, 0);
  const uvB = makeBehavior(quiet({}));
  DMx.sync(uvB, uvCube.object);
  const uvAttr = uvCube.mesh.geometry.attributes.uv;
  const pristine = new Float32Array(uvAttr.array);
  check('UV repair is a no-op while the engine has not touched anything',
    DMx.stateOf(uvB).uvRepairCount === 0);

  // Exactly what Cube3DRuntimeObjectPixiRenderer.updateTextureUvMapping does: scribble over
  // vertex indices 0..23 assuming the unsubdivided 24-vertex box.
  for (let e = 0; e <= 23; e++) {
    uvAttr.array[e * 2] = -99;
    uvAttr.array[e * 2 + 1] = -99;
  }
  DMx.sync(uvB, uvCube.object);
  check('The engine UV remap is detected and undone',
    DMx.stateOf(uvB).uvRepairCount === 1, String(DMx.stateOf(uvB).uvRepairCount));
  let uvRestored = true;
  for (let i = 0; i < pristine.length; i++) {
    if (Math.abs(uvAttr.array[i] - pristine[i]) > 1e-6) { uvRestored = false; break; }
  }
  check('  and every UV is back to its pristine value', uvRestored);

  DMx.sync(uvB, uvCube.object);
  check('  without repairing again on a clean frame',
    DMx.stateOf(uvB).uvRepairCount === 1, String(DMx.stateOf(uvB).uvRepairCount));

  /* --- the fallback pattern set is gone ------------------------------------ */
  // A behavior that declares no pattern properties at all must still produce a usable recipe from
  // its own defaults. If a "fallback" set ever comes back, this is the test that should fail.
  const bare = tintedCube(1, 1, 1);
  const bareProps = quiet({ DisplacementMode: 'Hybrid', PatternDepth: 0.08, PatternRaise: 0.02 });
  delete bareProps.PatternType;
  delete bareProps.ScaleX; delete bareProps.ScaleY;
  delete bareProps.GapWidth; delete bareProps.EdgeSoftness;
  const bareB = makeBehavior(bareProps);
  DMx.sync(bareB, bare.object);
  const bareParams = DMx.readParams(bareB);
  check('Removed fallback properties are absent from readParams',
    bareParams.fallbackPattern === undefined && bareParams.fallbackScaleX === undefined &&
    bareParams.fallbackScaleY === undefined && bareParams.fallbackGapWidth === undefined &&
    bareParams.fallbackEdgeSoftness === undefined);
  check('Pattern displacement still resolves with no pattern properties declared',
    DMx.stateOf(bareB).state === 'Ready' && bareParams.patternType === 'Brick' &&
    bareParams.scaleX === 8 && bareParams.gapWidth === 0.06,
    `${bareParams.patternType} ${bareParams.scaleX} ${bareParams.gapWidth}`);

  /* --- resize triggers a rebuild ------------------------------------------- */
  const sized = tintedCube(0, 0, 1);
  const sizedB = makeBehavior(quiet({ Inflate: 0.1 }));
  DMx.sync(sizedB, sized.object);
  const rebuildsBefore = DMx.stateOf(sizedB).rebuildCount;
  DMx.sync(sizedB, sized.object);
  check('A steady object does not rebuild every frame',
    DMx.stateOf(sizedB).rebuildCount === rebuildsBefore, String(DMx.stateOf(sizedB).rebuildCount));

  sized.mesh.matrixWorld.elements[0] = 400; // the object got wider
  DMx.sync(sizedB, sized.object);
  check('Resizing the object rebuilds the displacement',
    DMx.stateOf(sizedB).rebuildCount === rebuildsBefore + 1, String(DMx.stateOf(sizedB).rebuildCount));

  MB.clear();
}

console.log(`\n${'='.repeat(46)}`);
console.log(` ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail ? 1 : 0);
