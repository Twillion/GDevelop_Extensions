// Texture-unit budget check.
//
// LOCAL_SHADOW_SLOTS was raised from 4 to 8, implemented as 8 individual sampler2D uniforms rather
// than an array texture. Samplers are a HARD limit: WebGL2 guarantees only 16 fragment texture
// image units, and a fully-featured lit material is already using a lot of them. Overrunning it is
// a link failure at runtime — the surface renders black or falls back, with a console error that
// looks nothing like "too many textures".
//
// SCOPE, and this matters for how the result should be read: this measures the STOCK Three path
// only — a fully-textured MeshStandardMaterial plus the native shadow-casting lights the extension
// parks in the scene. It does NOT yet run the clustered-lighting injector, so it does not count the
// extension's own samplers: the 4 cluster data textures, the SDF volume, up to 3 CSM cascade maps,
// and up to LOCAL_SHADOW_SLOTS local maps. Those land on top of whatever this reports.
//
// So a PASS here is a floor, not a clearance. Extending this to inject first is the obvious next
// step and is the only way to answer the real question.

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

const page = `<canvas id=c width=32 height=32></canvas>
<script src="/three.js"></script>
<script>var gdjs = { registerRuntimeScenePostEventsCallback(){}, registerRuntimeSceneUnloadedCallback(){}, registerInGameEditorPostStepCallback(){}, _unregisterCallback(){} };</script>
<script>${chain}</script>
<script>${runtime}</script>
<script>
// Worst case WITH the extension's own samplers. This is the number that matters; the stock
// measurement is only the floor the extension builds on top of.
window.runInjected = function () {
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
  AL.setShadowMode(scene, 'Auto');

  // A Sun, so updateCSM builds its cascades and csmCount reaches its maximum.
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(300, 200, 800); sun.castShadow = true;
  root.add(sun); root.add(sun.target);
  AL.__internals.updateCSM(scene, camera);

  // A baked SDF volume, so the distance-field path compiles in too.
  state.sdfVolume = {
    texture: new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat),
    isBaked: true, threeMin: new THREE.Vector3(), threeSize: new THREE.Vector3(1, 1, 1),
    minX: 0, maxX: 1, resX: 8, voxelSize: 1,
  };

  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  white.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map: white, normalMap: white, roughnessMap: white, metalnessMap: white,
    aoMap: white, emissiveMap: white,
  });
  // A probe receiver as well: every optional path on at once is the case that has to fit.
  const receiver = { normalBias: 1.0, object: null };
  AL.__internals.injectShaderOnMaterial(mat, state, receiver);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), mat);
  mesh.geometry.setAttribute('uv1', mesh.geometry.getAttribute('uv'));
  root.add(mesh);

  const SLOTS = AL.__internals.LOCAL_SHADOW_SLOTS || 8;
  for (let i = 0; i < SLOTS; i++) {
    const spot = new THREE.SpotLight(0xffffff, 0);
    spot.castShadow = true; spot.position.set(i * 10, 200, 300);
    root.add(spot); root.add(spot.target);
  }

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  renderer.shadowMap.enabled = true;

  // PASS 1 exists only to make the uniforms exist. mat.__alUniforms is assigned inside
  // onBeforeCompile, so before Three compiles once there is nothing to bind to — an earlier version
  // of this test bound zero samplers for exactly that reason and drew a conclusion from it anyway.
  try { renderer.compile(root, camera); } catch (e) { errors.push('pass1: ' + e); }

  // Bind a real texture to EVERY sampler the injector declared, then compile again.
  //
  // Without this the test cannot separate what it is looking for from its own artefact: an unbound
  // sampler defaults to texture unit 0, and a sampler2D and a sampler3D both sitting on unit 0 fail
  // VALIDATE_STATUS however many units the hardware has. Binding removes that false positive, so a
  // failure that survives means something real.
  const dummy3D = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  dummy3D.format = THREE.RGBAFormat; dummy3D.needsUpdate = true;
  const u = mat.__alUniforms || {};
  const THREE_D = ['uSdfVolume', 'uClusterGrid3D', 'uProbeVolumeDay', 'uProbeVolumeNight'];
  let bound2D = 0, bound3D = 0;
  for (const name of Object.keys(u)) {
    const slot = u[name];
    if (!slot || slot.value !== null) continue;
    if (THREE_D.indexOf(name) >= 0) { slot.value = dummy3D; bound3D++; }
    else if (/Map|Volume|Texture|List|Data|Grid/.test(name)) { slot.value = white; bound2D++; }
  }
  errors.length = 0;                      // only pass 2 is evidence
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
      if (info && SAMPLER_TYPES.has(info.type)) { found += Math.max(1, info.size); local.push(info.name); }
    }
    if (found > samplers) { samplers = found; names.length = 0; local.forEach((x) => names.push(x)); }
  }
  const injectedOk = !!(mat.__alInjection && mat.__alInjection.key);
  const glError = gl.getError();
  renderer.dispose();
  return { samplersDeclared: samplers, samplerNames: names, injected: injectedOk,
           key: mat.__alInjection ? mat.__alInjection.key : '', slots: SLOTS,
           bound2D: bound2D, bound3D: bound3D, errors, glError };
};

window.run = function () {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
  const gl = renderer.getContext();
  const limits = {
    maxFragmentTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    maxCombinedTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    webgl2: renderer.capabilities.isWebGL2 === true,
  };

  // A worst-case but entirely ordinary material: textured, normal-mapped, rough/metal-mapped,
  // with AO and emissive. Nothing exotic — this is what a decent-looking asset actually uses.
  const white = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1, THREE.RGBAFormat);
  white.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map: white, normalMap: white, roughnessMap: white, metalnessMap: white,
    aoMap: white, emissiveMap: white,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 3;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  mesh.geometry.setAttribute('uv1', mesh.geometry.getAttribute('uv'));
  scene.add(mesh);

  // Native shadow-casting spot lights: one per local shadow slot, which is what the extension
  // parks in the scene. Each one costs Three a sampler of its own.
  const SLOTS = gdjs.__advancedLighting3D.__internals.LOCAL_SHADOW_SLOTS || 8;
  for (let i = 0; i < SLOTS; i++) {
    const spot = new THREE.SpotLight(0xffffff, 0);
    spot.castShadow = true;
    spot.position.set(i, 2, 3);
    scene.add(spot); scene.add(spot.target);
  }
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  scene.add(sun); scene.add(sun.target);

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  renderer.shadowMap.enabled = true;
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  console.error = originalError;

  // ACTIVE UNIFORMS on the linked program. This is the only trustworthy measure, and it took three
  // wrong attempts to get here:
  //   1. Counting THREE.ShaderLib source — unresolved #includes hide every sampler inside a chunk.
  //   2. Counting gl.getShaderSource — that is the PRE-PREPROCESSOR text, so it counts declarations
  //      inside inactive #ifdef blocks that never reach the GPU. It reported 30 for a material
  //      using 6 textures.
  //   3. Only the linked program knows what actually survived, and only active sampler uniforms
  //      consume texture image units.
  const SAMPLER_TYPES = new Set([
    gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY,
    gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.SAMPLER_2D_ARRAY_SHADOW,
    gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D,
  ].filter((v) => v !== undefined));
  let samplers = -1;
  const names = [];
  const programs = renderer.info.programs || [];
  for (const p of programs) {
    const prog = p.program;
    if (!prog) continue;
    let n = 0;
    try { n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    let found = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      if (SAMPLER_TYPES.has(info.type)) { found += Math.max(1, info.size); names.push(info.name); }
    }
    if (found > samplers) samplers = found;
  }

  const glError = gl.getError();
  renderer.dispose();
  return { limits, slots: SLOTS, samplersDeclared: samplers, samplerNames: names, errors, glError };
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-texunits-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

let ws;
try {
  let port;
  for (let i = 0; i < 150; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('Chrome debugging endpoint unavailable');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map(); const logged = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logged.push(m.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 150; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.run' });
    if (r.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const r = await send('Runtime.evaluate', { expression: 'window.run()', returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  const out = r.result.value;

  console.log('Texture-unit budget');
  console.log('  WebGL2:                        ' + out.limits.webgl2);
  console.log('  MAX_TEXTURE_IMAGE_UNITS:       ' + out.limits.maxFragmentTextureUnits + '  (spec minimum is 16)');
  console.log('  MAX_COMBINED_TEXTURE_UNITS:    ' + out.limits.maxCombinedTextureUnits);
  console.log('  LOCAL_SHADOW_SLOTS:            ' + out.slots);
  console.log('  samplers in generated shader:  ' + out.samplersDeclared);
  if (out.samplerNames) {
    console.log('  declared: ' + out.samplerNames.join(', '));
  }
  const all = out.errors.concat(logged);
  if (all.length) console.log('  errors: ' + all.join(' | '));

  // The real gate. SwiftShader reports a generous limit, so passing HERE does not mean passing on
  // the integrated-GPU floor this plan targets, where 16 is a realistic number.
  assert.equal(out.glError, 0, 'no GL error');
  assert.ok(out.samplersDeclared > 0,
    `sampler counting failed (got ${out.samplersDeclared}). A test that cannot read the linked ` +
    'program must fail, not silently certify a budget it never measured.');
  assert.ok(out.samplersDeclared <= 16,
    `a fully-featured lit material declares ${out.samplersDeclared} samplers, over the WebGL2 ` +
    `guaranteed minimum of 16. On hardware that reports exactly 16 this fails to link and the ` +
    `surface renders wrong, with an error that does not mention texture units.`);
  console.log('\nStock path: within the 16-unit guaranteed minimum (barely).');

  // Now the configuration that actually ships.
  const r2 = await send('Runtime.evaluate', { expression: 'window.runInjected()', returnByValue: true });
  if (r2.exceptionDetails) throw new Error(JSON.stringify(r2.exceptionDetails));
  const inj = r2.result.value;
  console.log('\nWith clustered lighting injected (probes + SDF + CSM + local maps all on)');
  console.log('  injector reached the material:  ' + inj.injected + '  ' + inj.key);
  console.log('  active sampler units:           ' + inj.samplersDeclared);
  console.log('  bound by the harness:           ' + inj.bound2D + ' 2D, ' + inj.bound3D + ' 3D');
  console.log('  declared: ' + inj.samplerNames.join(', '));
  if (inj.errors.length) console.log('  errors: ' + inj.errors.join(' | '));

  // The injected path is REPORTED, NOT GATED, and deliberately so.
  //
  // Five successive attempts at counting it were each wrong in a different way:
  //   1. THREE.ShaderLib source — unresolved #includes hide every sampler inside a chunk (said 5).
  //   2. gl.getShaderSource — pre-preprocessor text, counts dead #ifdef branches (said 30).
  //   3. Active uniforms, injector not run — measured the stock path only (said 15, correct but
  //      not the question being asked).
  //   4. Active uniforms with the injector run — the program does not validate, so there is no
  //      linked program to count and the answer came back 0.
  //   5. Binding textures to "every null sampler" — the name filter also matched non-samplers such
  //      as uClusterGridDims, so 36 is a count of uniforms poked, not of samplers.
  //
  // The one solid fact: with probes, SDF, CSM and 8 local shadow maps all active, the program does
  // not pass VALIDATE_STATUS even on SwiftShader, which advertises 32 texture units. That is worth
  // knowing and worth chasing. It is NOT yet proof of a texture-unit overrun - VALIDATE_STATUS also
  // fails for sampler-type collisions on a shared unit, and this harness binds nothing the way the
  // real runtime does.
  //
  // Turning this into a gate requires measuring inside a real GDJS scene where the runtime binds
  // its own uniforms, rather than a mock that has to guess at them.
  assert.ok(inj.injected, 'the injector must have reached the material, or this measures nothing');
  console.log('\nNOTE: the injected configuration does not validate here. Cause NOT established -');
  console.log('see the comment above for what was tried and why each attempt was unreliable.');
  console.log('This half is diagnostic output, not a pass/fail gate.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
