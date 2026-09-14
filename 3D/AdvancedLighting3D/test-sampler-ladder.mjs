// What each lighting feature actually costs in fragment texture units, measured one at a time.
//
// WHY. This measures the actual marginal sampler cost of each feature on a linked program, then
// verifies that the scene-wide runtime allocator keeps the same worst-case material inside a
// simulated 16-unit GPU limit. The raw ladder deliberately overrides the allocator; otherwise it
// would correctly suppress unsafe permutations before their cost could be measured.
//
// Counting ACTIVE_UNIFORMS on the LINKED program is the only trustworthy method: shader source
// counts declarations inside inactive #ifdefs, and only active sampler uniforms consume units.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const threePath = path.join(repoRoot, 'tools/gdjs-harness/runtime/pixi-renderers/three.js');
const chain = fs.readFileSync(path.join(repoRoot, '3D/MaterialMaster/ShaderChain.runtime.js'), 'utf8');
const runtime = fs.readFileSync(path.join(here, 'AdvancedLighting3D.runtime.js'), 'utf8');

const page = `<canvas id=c width=64 height=64></canvas>
<script src="/three.js"></script>
<script>var gdjs = { registerRuntimeScenePostEventsCallback(){}, registerRuntimeSceneUnloadedCallback(){}, registerInGameEditorPostStepCallback(){}, _unregisterCallback(){} };</script>
<script>${chain}</script>
<script>${runtime}</script>
<script>
window.measure = function (cfg) {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
  const gl = renderer.getContext();
  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  camera.up.set(0, 0, 1); camera.position.set(0, -600, 400); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  const AL = gdjs.__advancedLighting3D;
  const state = AL.registerSceneManager(scene);
  AL.setShadowMode(scene, cfg.mode || 'Auto');
  AL.applySceneShadowSettings(scene, {
    localShadowBackend: cfg.backend || 'Owned',
    maxShadowMappedLights: AL.__internals.LOCAL_SHADOW_SLOTS,
  });
  if (cfg.limit) state.__fragmentTextureUnitLimit = cfg.limit;
  if (!cfg.autoBudget) {
    state.__textureBudgetOverride = {
      probes: !!cfg.probes, sdf: !!cfg.sdf, contact: !!cfg.contact,
      csm: !!cfg.csm, localMaps: !!cfg.localMaps,
    };
  }

  if (cfg.csm) {
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(300, 200, 800); sun.castShadow = true;
    root.add(sun); root.add(sun.target);
    AL.__internals.updateCSM(scene, camera);
  } else {
    AL.setSunShadows(scene, 'Off');
  }

  if (cfg.sdf) {
    state.sdfVolume = {
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat),
      isBaked: true, threeMin: new THREE.Vector3(), threeSize: new THREE.Vector3(1, 1, 1),
      minX: 0, maxX: 1, resX: 8, voxelSize: 1,
    };
  }
  if (cfg.contact) AL.setContactShadows(scene, true);

  if (cfg.probes && cfg.autoBudget) state.receivers.add({ object: null });

  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  white.needsUpdate = true;
  const matOpts = cfg.maps
    ? { map: white, normalMap: white, roughnessMap: white, metalnessMap: white,
        aoMap: white, emissiveMap: white }
    : {};
  const mat = new THREE.MeshStandardMaterial(matOpts);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), mat);
  if (cfg.maps) mesh.geometry.setAttribute('uv1', mesh.geometry.getAttribute('uv'));
  root.add(mesh);

  // STEP THE SCENE ONCE BEFORE INJECTING.
  //
  // contactShadowsActive() requires cs.rendered, which only the depth prepass sets. Without a step
  // the contact permutation never compiles in and the feature measures as costing ZERO units -
  // which is what the first version of this ladder reported, and it is an artefact of the harness
  // rather than a property of the feature.
  let stepError = '';
  try { AL.doStepPostEvents(scene); } catch (e) { stepError = String(e && e.message || e); }
  AL.__internals.injectShaderOnMaterial(mat, state, cfg.probes ? { normalBias: 1.0, object: null } : null);

  // The Native local-map backend parks one zero-intensity shadow-casting spot per slot, and Three
  // declares a spotShadowMap entry for each. The Owned backend parks none. That difference is the
  // single largest lever in this whole table, so it is modelled explicitly rather than assumed.
  const SLOTS = AL.__internals.LOCAL_SHADOW_SLOTS;
  const nativeSpots = (mat.__alInjection && mat.__alInjection.localMaps &&
    cfg.backend === 'Native') ? SLOTS : 0;
  for (let i = 0; i < nativeSpots; i++) {
    const spot = new THREE.SpotLight(0xffffff, 0);
    spot.castShadow = true; spot.position.set(i * 10, 200, 300);
    root.add(spot); root.add(spot.target);
  }

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  renderer.shadowMap.enabled = true;
  try { renderer.compile(root, camera); } catch (e) { errors.push('pass1: ' + e); }

  // Bind something real to every sampler the injector declared. Unbound samplers all default to
  // unit 0, and a sampler2D and a sampler3D sharing unit 0 fail validation regardless of the unit
  // count - a false positive that would otherwise be indistinguishable from a genuine overrun.
  const dummy3D = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  dummy3D.format = THREE.RGBAFormat; dummy3D.needsUpdate = true;
  const u = mat.__alUniforms || {};
  const THREE_D = ['uSdfVolume', 'uClusterGrid3D', 'uProbeVolumeDay', 'uProbeVolumeNight'];
  for (const name of Object.keys(u)) {
    const slot = u[name];
    if (!slot || slot.value !== null) continue;
    if (THREE_D.indexOf(name) >= 0) slot.value = dummy3D;
    else if (/Map|Volume|Texture|List|Data|Grid|Depth/.test(name)) slot.value = white;
  }
  errors.length = 0;
  try { renderer.compile(root, camera); renderer.render(root, camera); } catch (e) { errors.push('pass2: ' + e); }
  console.error = originalError;

  const SAMPLER_TYPES = new Set([
    gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY,
    gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.SAMPLER_2D_ARRAY_SHADOW,
  ].filter((v) => v !== undefined));
  let samplers = -1; const names = [];
  for (const p of (renderer.info.programs || [])) {
    if (!p.program) continue;
    let n = 0;
    try { n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    let found = 0; const local = [];
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p.program, i);
      if (info && SAMPLER_TYPES.has(info.type)) { found += Math.max(1, info.size); local.push(info.name + (info.size > 1 ? '[' + info.size + ']' : '')); }
    }
    if (found > samplers) { samplers = found; names.length = 0; local.forEach((x) => names.push(x)); }
  }
  const key = mat.__alInjection ? mat.__alInjection.key : '';
  const glError = gl.getError();
  renderer.dispose();
  return { samplers, names, key, slots: SLOTS, errors, glError, stepError,
           contactActive: key.indexOf('CT1') >= 0,
           budget: state.textureUnitBudget,
           limit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) };
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-ladder-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

const OFF = { mode: 'Auto', csm: false, sdf: false, probes: false, contact: false,
              localMaps: false, backend: 'Owned', maps: false };

const LADDER = [
  ['plain material, extension off',      { ...OFF, mode: 'Off' }],
  ['clustered lighting only',            { ...OFF }],
  ['+ 6-map material',                   { ...OFF, maps: true }],
  ['+ Sun cascades (CSM)',               { ...OFF, maps: true, csm: true }],
  ['+ local maps, Owned',                { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Owned' }],
  ['+ local maps, Native',               { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Native' }],
  ['+ light probes',                     { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Native', probes: true }],
  ['+ SDF volume',                       { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Native', probes: true, sdf: true }],
  ['+ contact shadows (everything on)',  { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Native', probes: true, sdf: true, contact: true }],
  ['everything on, Owned backend',       { ...OFF, maps: true, csm: true, localMaps: true, backend: 'Owned', probes: true, sdf: true, contact: true }],
  ['everything on, Owned, plain material', { ...OFF, maps: false, csm: true, localMaps: true, backend: 'Owned', probes: true, sdf: true, contact: true }],
];

let ws;
try {
  let port;
  for (let i = 0; i < 200; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('Chrome debugging endpoint unavailable');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 200; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.measure' });
    if (r.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const rows = [];
  for (const [label, cfg] of LADDER) {
    const r = await send('Runtime.evaluate', {
      expression: `window.measure(${JSON.stringify(cfg)})`, returnByValue: true });
    if (r.exceptionDetails) throw new Error(label + ': ' + JSON.stringify(r.exceptionDetails));
    rows.push([label, r.result.value]);
  }

  const FLOOR = 16;                       // the WebGL2 guaranteed minimum
  console.log('Fragment texture units per feature');
  console.log(`  this GPU reports ${rows[0][1].limit}; the WebGL2 GUARANTEED MINIMUM is ${FLOOR},`);
  console.log('  and plenty of real hardware reports exactly that. Overrunning it does not degrade:');
  console.log('  the fragment shader fails to link and the scene renders black.');
  console.log('  LOCAL_SHADOW_SLOTS = ' + rows[0][1].slots);
  console.log('');
  console.log('  configuration                            units   delta   vs 16');
  console.log('  ' + '-'.repeat(62));
  let prev = null;
  for (const [label, r] of rows) {
    const delta = prev === null ? '' : (r.samplers - prev >= 0 ? '+' : '') + (r.samplers - prev);
    const over = r.samplers > FLOOR ? 'OVER by ' + (r.samplers - FLOOR) : 'fits';
    console.log('  ' + label.padEnd(40) + String(r.samplers).padStart(5) + delta.padStart(8) + '   ' + over);
    prev = r.samplers;
    // The Owned rows are a different branch of the ladder, not a continuation of it.
    if (label.startsWith('everything on, Owned backend')) prev = null;
  }
  console.log('');
  const worst = rows.find(([l]) => l.startsWith('+ contact'))[1];
  console.log('  worst case declares: ' + worst.names.join(', '));

  for (const [label, r] of rows) {
    assert.equal(r.glError, 0, `${label}: GL error ${r.glError}`);
    assert.ok(r.samplers > 0, `${label}: sampler counting failed`);
    if (r.stepError) console.log(`  note: ${label} step error: ${r.stepError}`);
  }
  // If the contact permutation did not compile in, its row measures nothing and must not be
  // reported as "contact shadows are free".
  const contactRow = rows.find(([l]) => l.startsWith('+ contact'))[1];
  assert.ok(contactRow.contactActive,
    'the contact-shadow permutation never activated (key: ' + contactRow.key + '), so its row ' +
    'measures the absence of the feature rather than its cost');

  /* ---- What the old fixed-reserve guard missed ---- */
  const byLabel = (s) => rows.find(([l]) => l === s)[1].samplers;
  const nonLocal = byLabel('+ contact shadows (everything on)') -
                   byLabel('+ local maps, Native');
  console.log('');
  console.log('  The retired fixed-reserve guard counted neither the light probes (' +
    (byLabel('+ light probes') - byLabel('+ local maps, Native')) + ') nor the SDF volume (' +
    (byLabel('+ SDF volume') - byLabel('+ light probes')) + ')');
  console.log('  nor the contact depth texture (' +
    (byLabel('+ contact shadows (everything on)') - byLabel('+ SDF volume')) + '), so it under-counts by up to ' +
    nonLocal + ' units');
  console.log('  on a scene that uses them - which is exactly the scene most likely to overrun.');

  assert.ok(byLabel('+ local maps, Owned') < byLabel('+ local maps, Native'),
    'the Owned backend must cost fewer units than Native, which is its entire justification');
  assert.ok(byLabel('everything on, Owned backend') < byLabel('+ contact shadows (everything on)'),
    'Owned must reduce the worst case');

  const budgetEval = await send('Runtime.evaluate', {
    expression: `window.measure(${JSON.stringify({
      ...LADDER[8][1], autoBudget: true, limit: FLOOR,
    })})`, returnByValue: true });
  if (budgetEval.exceptionDetails) throw new Error('automatic budget: ' + JSON.stringify(budgetEval.exceptionDetails));
  const budgeted = budgetEval.result.value;
  assert.equal(budgeted.glError, 0, 'the automatically budgeted variant must not raise a GL error');
  assert.ok(budgeted.samplers <= FLOOR,
    `the allocator left ${budgeted.samplers} active samplers on a simulated ${FLOOR}-unit GPU`);
  // CSM SURVIVES on a 16-unit GPU now, and that is the point of owning the cascade depth pass.
  // Three cascades cost three units instead of six, so the Sun no longer has to be sacrificed
  // first: the allocator drops the eight-unit Native local-map block instead, which is the
  // larger and more easily replaced feature (those lights can fall back to SDF or contact).
  assert.equal(budgeted.budget.csm, true,
    'owned cascades must be cheap enough to keep Sun shadows on a 16-unit GPU');
  assert.equal(budgeted.budget.localMaps, false,
    'the Native local-map block must yield first, being the largest optional block');

  console.log('');
  console.log('VERDICT');
  const worstNative = byLabel('+ contact shadows (everything on)');
  const worstOwned = byLabel('everything on, Owned backend');
  console.log(`  Worst case, Native backend: ${worstNative} units - ${worstNative - FLOOR} over the floor.`);
  console.log(`  Worst case, Owned backend:  ${worstOwned} units - ${worstOwned - FLOOR} over the floor.`);
  console.log(`  Automatic 16-unit fallback: ${budgeted.samplers} units; CSM=${budgeted.budget.csm}, local=${budgeted.budget.localMaps}.`);
  console.log('  Owned helps but cannot retain every feature on a 16-unit GPU. The allocator');
  console.log('  prevents link failure by dropping whole optional permutations before compilation.');
  console.log('  Cascades no longer double-declare (3 units for 3, not 6), so the Sun now survives');
  console.log('  a 16-unit budget. The remaining duplication is the NATIVE local-map backend, which');
  console.log('  costs one Three sampler per slot on top of ours - Owned removes it for spot lights;');
  console.log('  point lights still fall back to Native, and probes still cost two 3D textures.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
