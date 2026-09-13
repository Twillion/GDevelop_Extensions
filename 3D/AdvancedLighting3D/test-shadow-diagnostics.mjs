// The diagnostic must DISCRIMINATE, not merely return a string. Each case below is a scene that
// was genuinely mis-set in some specific way, and the evaluator has to name that specific way.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = new URL('.', import.meta.url);
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} }, performance: { now: () => 0 },
  gdjs: { registerRuntimeSceneUnloadedCallback: () => {} } });
vm.runInContext(fs.readFileSync(new URL('../../tools/gdjs-harness/runtime/pixi-renderers/three.js', here), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../MaterialMaster/ShaderChain.runtime.js', here), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('AdvancedLighting3D.runtime.js', here), 'utf8'), ctx);
const { THREE: T, gdjs } = ctx, AL = gdjs.__advancedLighting3D;

const WORLD_PER_METRE = 100;

// A fresh scene each time: these tests are about first-failure ordering, so leaked state from a
// previous case would silently make a later assertion pass for the wrong reason.
function makeScene() {
  const root = new T.Scene(); root.scale.y = -1;
  const camera = new T.PerspectiveCamera(61, 1.7, 2, 8000);
  camera.up.set(0, 0, 1); camera.position.set(0, -800, 600); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const renderer = { capabilities: { isWebGL2: true }, shadowMap: { enabled: false, type: T.BasicShadowMap, autoUpdate: false } };
  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');
  return { scene, root };
}

// A clustered light at the origin, reaching `radius` metres.
function addLight(scene, opts = {}) {
  const x = opts.x ?? 0, y = opts.y ?? 0, z = opts.z ?? 400;
  const object = {
    getName: () => opts.name || 'TestLight',
    getX: () => x, getY: () => y, getZ: () => z,
    getWidth: () => 1, getHeight: () => 1, getDepth: () => 1,
    getRenderer: () => null,
    getAABB: () => ({ min: [x, y, z], max: [x, y, z] }),
  };
  const behavior = {};
  AL.registerLight(scene, object, behavior, {
    lightType: opts.lightType || 'Point', intensity: opts.intensity ?? 5,
    radius: opts.radius ?? 10, colorMode: 'RGB', lightColor: '255;255;255',
    castShadow: opts.castShadow ?? true, shadowTechnique: opts.shadowTechnique || 'Auto',
  });
  // worldPosition/worldDirection are normally refreshed by the broadphase each frame; these tests
  // never render, so seed them directly. Y is negated: the GDevelop scene root is Y-mirrored.
  const light = behavior.__alLight;
  light.worldPosition.set(x, -y, z);
  light.worldDirection.set(0, 0, -1);
  return { behavior, light };
}

function addBox(root, { x = 0, y = 0, z = 0, size = 100, cast = false, receive = false }) {
  const mesh = new T.Mesh(new T.BoxGeometry(size, size, size), new T.MeshStandardMaterial());
  mesh.position.set(x, -y, z);
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  root.add(mesh);
  return mesh;
}

const reason = (scene, behavior) => AL.lightShadowReason(scene, behavior);
let checked = 0;
function expect(label, code, actual) {
  assert.equal(actual, code, `${label}: expected ${code}, got ${actual}`);
  checked++;
}

/* 1. The authoring mistakes, in first-failure order. Each case fixes the previous one, so the
      evaluator has to move to the NEXT complaint rather than repeating itself. */
{
  const { scene, root } = makeScene();
  const { behavior } = addLight(scene, { castShadow: false });
  expect('cast shadows off', 'CAST_SHADOWS_OFF', reason(scene, behavior));

  AL.updateLight(scene, behavior.__alLight.object, behavior, { castShadow: true });
  expect('empty scene', 'NO_CASTER_IN_RANGE', reason(scene, behavior));

  // A caster, but nothing to land on — the exact mistake in the real project.
  addBox(root, { z: 200, size: 100, cast: true });
  expect('caster but no receiver', 'NO_RECEIVER_IN_RANGE', reason(scene, behavior));

  addBox(root, { z: 0, size: 600, receive: true });
  // Now it is well-formed, and with no volume it must land on the shadow-map path.
  const ok = AL.diagnoseLightShadow(scene, behavior);
  assert.ok(['OK_SHADOW_MAP','MAP_BUDGET_FULL','NO_SDF_VOLUME','SDF_AUTO_PENDING'].includes(ok.code),
    'a well-formed scene must move past the authoring complaints, got ' + ok.code);
  checked++;
}

/* 2. Range is REAL geometry, not a formality: radius is in metres, and a caster just outside it
      must be reported as out of range rather than silently accepted. */
{
  const { scene, root } = makeScene();
  const { behavior } = addLight(scene, { radius: 2, z: 0 });   // 2 m = 200 world units
  addBox(root, { x: 5000, size: 50, cast: true });
  addBox(root, { x: 5000, z: -100, size: 600, receive: true });
  expect('caster far outside radius', 'NO_CASTER_IN_RANGE', reason(scene, behavior));
}

/* 3. A spot pointing AWAY from the caster must fail on the cone, not merely on distance. The
      caster here is well inside the radius — only the cone test can reject it. */
{
  const { scene, root } = makeScene();
  const { behavior, light } = addLight(scene, { lightType: 'Spot', radius: 30, z: 400 });
  light.spotOuterAngle = 20;
  light.worldDirection.set(0, 0, 1);            // aimed up, away from the box below
  addBox(root, { z: 0, size: 100, cast: true });
  addBox(root, { z: -200, size: 900, receive: true });
  expect('spot aimed away', 'NO_CASTER_IN_RANGE', reason(scene, behavior));

  light.worldDirection.set(0, 0, -1);           // aimed at it
  assert.notEqual(reason(scene, behavior), 'NO_CASTER_IN_RANGE',
    'the same caster must be found once the spot points at it');
  checked++;
}

/* 4. The light's own holder cube must never satisfy the caster check. It encloses the light, so a
      naive radius test always finds it and reports a healthy scene that casts nothing. */
{
  const { scene, root } = makeScene();
  const holder = new T.Mesh(new T.BoxGeometry(50, 50, 50), new T.MeshStandardMaterial());
  holder.castShadow = true; holder.receiveShadow = true; holder.position.set(0, 0, 400);
  root.add(holder);
  const object = {
    getName: () => 'HolderLight', getX: () => 0, getY: () => 0, getZ: () => 400,
    getWidth: () => 50, getHeight: () => 50, getDepth: () => 50,
    getRenderer: () => ({ get3DRendererObject: () => holder }),
    getAABB: () => ({ min: [0, 0, 400], max: [50, 50, 450] }),
  };
  const behavior = {};
  AL.registerLight(scene, object, behavior, { lightType: 'Point', intensity: 5, radius: 10,
    colorMode: 'RGB', lightColor: '255;255;255', castShadow: true });
  behavior.__alLight.worldPosition.set(0, 0, 400);
  expect('holder cube excluded', 'NO_CASTER_IN_RANGE', reason(scene, behavior));
}

/* 5. Scene ownership outranks everything below it, and says which setting to change. */
{
  const { scene, root } = makeScene();
  const { behavior } = addLight(scene);
  addBox(root, { z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });
  AL.setShadowMode(scene, 'Native');
  expect('native ownership', 'SCENE_SHADOWS_NATIVE', reason(scene, behavior));
  AL.setShadowMode(scene, 'Off');
  expect('shadows off', 'SCENE_SHADOWS_OFF', reason(scene, behavior));
  AL.setShadowMode(scene, 'Auto');
  assert.ok(!reason(scene, behavior).startsWith('SCENE_'), 'Auto must clear the ownership complaint');
  checked++;
}

/* 6. An SDF-forced light reports the volume lifecycle precisely: absent, then unbaked. These were
      two separate silent failures in the real project. */
{
  const { scene, root } = makeScene();
  // Explicit: this case is about the hand-placed volume lifecycle, so switch the automatic fit off
  // or it would supply a volume before the first assertion could observe its absence.
  AL.applySceneShadowSettings(scene, { sdfBoundsMode: 'Explicit' });
  const { behavior } = addLight(scene, { shadowTechnique: 'SDF', radius: 100 });
  const nearCaster = addBox(root, { z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });
  expect('SDF forced, no volume', 'NO_SDF_VOLUME', reason(scene, behavior));

  const volBeh = {};
  AL.registerSDFVolume(scene, { getRenderer: () => null }, volBeh, { resX: 8, resY: 8, resZ: 4 });
  AL.setSDFVolumeBounds(scene, -400, -400, -200, 400, 400, 400);
  expect('volume present, never baked', 'SDF_NOT_BAKED', reason(scene, behavior));

  // Baked, but the only caster sits outside the bounds. Remove the near one BY REFERENCE: a
  // search for "some mesh that casts" is exactly how a test ends up asserting about the wrong
  // object. The light radius is 100 m = 10000 units, so the stray is still lit - only the volume
  // bounds can reject it, which is the whole point of this case.
  AL.stateOf(scene).sdfVolume.isBaked = true;
  root.remove(nearCaster);
  addBox(root, { x: 9000, z: 200, size: 100, cast: true });
  expect('caster outside the baked volume', 'CASTER_OUTSIDE_SDF', reason(scene, behavior));
}

/* 7. A zero budget is reported as a budget problem, not as a missing volume. */
{
  const { scene, root } = makeScene();
  AL.applySceneShadowSettings(scene, { sdfBoundsMode: 'Explicit' });
  const { behavior } = addLight(scene, { shadowTechnique: 'ShadowMap' });
  addBox(root, { z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });
  AL.setMaxShadowMappedLights(scene, 0);
  expect('zero map budget', 'MAP_BUDGET_ZERO', reason(scene, behavior));
}

/* 8. The whole-scene report must name every light and count only the genuinely casting ones. */
{
  const { scene, root } = makeScene();
  addLight(scene, { name: 'Good' });
  addLight(scene, { name: 'Dark', x: 3000, intensity: 0 });
  addBox(root, { z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });
  const report = AL.explainAllShadows(scene);
  assert.ok(report.includes('Dark'), 'the report must name the failing light');
  assert.ok(/LIGHT_DARK/.test(report), 'a zero-intensity light must be reported as such');
  const diag = AL.diagnoseAllLights(scene);
  assert.equal(diag.length, 2, 'every registered light must appear exactly once');
  checked += 3;
}

/* 9. Codes are a contract: events branch on them, so they must be stable strings and every
      message must be non-empty. */
{
  const { scene, root } = makeScene();
  const { behavior } = addLight(scene);
  addBox(root, { z: 200, size: 100, cast: true });
  for (const d of [AL.diagnoseLightShadow(scene, behavior)]) {
    assert.match(d.code, /^[A-Z][A-Z0-9_]*$/, 'codes must be SCREAMING_SNAKE constants');
    assert.ok(d.message.length > 20, 'every code must carry an actionable message');
    assert.equal(typeof d.ok, 'boolean');
  }
  checked += 3;
}

/* 10. AutoScene must actually fit a volume around the geometry, so SDF shadows work with no box
       placed by hand — the whole point of the feature. */
{
  const { scene, root } = makeScene();
  // AutoScene is opt-in now: it defaulted on, created a volume in a project that had none, and took
  // that scene over MAX_TEXTURE_IMAGE_UNITS(16). Tests for it must ask for it.
  AL.applySceneShadowSettings(scene, { sdfBoundsMode: 'AutoScene' });
  const { behavior } = addLight(scene, { shadowTechnique: 'SDF', radius: 100 });
  addBox(root, { z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });
  expect('before any fit', 'SDF_AUTO_PENDING', reason(scene, behavior));

  assert.equal(AL.ensureAutoSceneSDFVolume(scene), true, 'AutoScene must fit a volume');
  const vol = AL.stateOf(scene).sdfVolume;
  assert.ok(vol && vol.implicit, 'the fitted volume must be the implicit one');
  assert.ok(vol.threeSize.x > 600 && vol.threeSize.z > 200,
    'bounds must enclose both caster and receiver, plus padding');
  // Padding is 200 either side, and the receiver is 600 wide, so 1000 is the floor.
  assert.ok(vol.threeSize.x >= 1000, 'padding must be applied, got ' + vol.threeSize.x);
  assert.ok(vol.voxelSize > 0 && isFinite(vol.voxelSize), 'a usable voxel size must be derived');
  checked += 5;

  // And the caster it fitted around must, by construction, be inside it.
  vol.isBaked = true;
  assert.notEqual(reason(scene, behavior), 'CASTER_OUTSIDE_SDF',
    'geometry the bounds were fitted around cannot be outside them');
  checked++;
}

/* 11. The guard has to actually refuse. Casters spread past the extent limit produce voxels bigger
       than the props, which is worse than no shadow — and refusing SILENTLY would recreate exactly
       the failure this whole diagnostic exists to kill. */
{
  const { scene, root } = makeScene();
  AL.applySceneShadowSettings(scene, { sdfBoundsMode: 'AutoScene', sdfMaxExtent: 5000 });
  const { behavior } = addLight(scene, { shadowTechnique: 'SDF', radius: 1000 });
  addBox(root, { x: -20000, z: 200, size: 100, cast: true });
  addBox(root, { x: 20000, z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });

  assert.equal(AL.ensureAutoSceneSDFVolume(scene), false, 'an over-large fit must be refused');
  assert.equal(AL.stateOf(scene).sdfVolume, null, 'nothing useless may be baked');
  expect('refused fit is reported', 'SDF_AUTO_REFUSED', reason(scene, behavior));
  assert.ok(/ShadowMap|SDFVolume3D/.test(AL.diagnoseLightShadow(scene, behavior).message),
    'the refusal must name a way out, not just state the problem');
  checked += 3;
}

/* 12. The guard that actually matters is VOXEL SIZE, not extent. A box can sit well inside the
       extent limit and still produce voxels so coarse that the bake's conservative dilation treats
       the ground itself as solid - which renders a black square exactly matching the bounds inside
       an otherwise lit area. Gating on extent alone let exactly that ship. */
{
  const { scene, root } = makeScene();
  AL.applySceneShadowSettings(scene, { sdfBoundsMode: 'AutoScene', sdfMaxExtent: 20000 });
  const { behavior } = addLight(scene, { shadowTechnique: 'SDF', radius: 200 });
  // ~9600 units across: inside the 20000 extent limit, but 9600/128 = 75-unit voxels.
  addBox(root, { x: -4700, z: 200, size: 100, cast: true });
  addBox(root, { x: 4700, z: 200, size: 100, cast: true });
  addBox(root, { z: 0, size: 600, receive: true });

  assert.equal(AL.ensureAutoSceneSDFVolume(scene), false,
    'a fit that passes the extent limit but yields useless voxels must still be refused');
  assert.equal(AL.stateOf(scene).sdfVolume, null, 'nothing that coarse may be baked');
  const d = AL.diagnoseLightShadow(scene, behavior);
  assert.ok(/ShadowMap|SDFVolume3D/.test(d.message),
    'the refusal must name a way out, not just state the problem');
  checked += 3;
}

console.log(`Shadow diagnostics: ${checked} assertions passed — first-failure ordering, metric radius, ` +
  `spot cone, holder-cube exclusion, ownership precedence, SDF volume lifecycle, budget, scene report, AutoScene fit and its refusal guard.`);
