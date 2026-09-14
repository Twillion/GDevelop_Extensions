// Contact shadows: a depth prepass marched in screen space, shared by every light.
//
// Two things must hold, and the second is the whole reason the feature exists:
//   1. It darkens where geometry meets — a real occluder produces a real contact shadow.
//   2. Its texture cost does NOT grow with light count. A shadow map costs one unit per light and
//      runs out at four on 16-unit hardware; this costs one unit for any number of lights. If
//      adding lights adds samplers, the feature has achieved nothing.

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

const W = 256, H = 256;

const page = `<canvas id=c width=${W} height=${H}></canvas>
<script src="/three.js"></script>
<script>var gdjs = { registerRuntimeScenePostEventsCallback(){}, registerRuntimeSceneUnloadedCallback(){}, registerInGameEditorPostStepCallback(){}, _unregisterCallback(){} };</script>
<script>${chain}</script>
<script>${runtime}</script>
<script>
window.run = function (contactOn, lightCount, withBox, grazing) {
  if (withBox === undefined) withBox = true;
  const AL = gdjs.__advancedLighting3D;
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(${W}, ${H}, false);
  renderer.setClearColor(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;

  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  // Low and close, so the join between box and floor fills a good part of the frame — that seam
  // is where a contact shadow lives, and a top-down view would barely show it.
  if (grazing) { camera.position.set(0, -900, 90); camera.lookAt(0, 0, 0); }
  else { camera.position.set(0, -620, 230); camera.lookAt(0, 0, 60); }
  camera.updateMatrixWorld(true);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  floor.receiveShadow = true; root.add(floor);

  if (withBox) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(150, 150, 150),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    box.position.set(0, 0, 75); box.castShadow = true; box.receiveShadow = true; root.add(box);
  }

  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');
  AL.applySceneShadowSettings(scene, {
    contactShadows: !!contactOn, contactStrength: 1.0, contactDistance: 160,
    contactSteps: 16, contactThickness: 60,
    // Shadow maps off, so anything measured here is the contact term and nothing else.
    maxShadowMappedLights: 0,
  });

  for (let i = 0; i < lightCount; i++) {
    const ang = (i / Math.max(1, lightCount)) * Math.PI * 2;
    const lx = Math.cos(ang) * 300, ly = Math.sin(ang) * 300;
    AL.registerLight(scene, {
      getX: () => lx, getY: () => ly, getZ: () => grazing ? 90 : 260,
      getWidth: () => 1, getHeight: () => 1, getDepth: () => 1, getRenderer: () => null,
      getAABB: () => ({ min: [lx, ly, grazing ? 90 : 260], max: [lx, ly, grazing ? 90 : 260] }),
    }, {}, {
      lightType: 'Point', intensity: 40 / Math.max(1, lightCount), radius: 14,
      colorMode: 'RGB', lightColor: '255;255;255', flickerMode: 'None',
      castShadow: true, shadowTechnique: 'None',
    });
  }

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  const draw = () => { AL.doStepPostEvents(scene); renderer.render(root, camera); };
  for (let i = 0; i < 5; i++) draw();
  console.error = originalError;

  const gl = renderer.getContext();
  const px = new Uint8Array(${W} * ${H} * 4);
  gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const SAMPLER_TYPES = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D,
    gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW].filter((v) => v !== undefined));
  let samplers = 0;
  for (const p of (renderer.info.programs || [])) {
    if (!p.program) continue;
    let n = 0;
    try { n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    let found = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p.program, i);
      if (info && SAMPLER_TYPES.has(info.type)) found += Math.max(1, info.size);
    }
    if (found > samplers) samplers = found;
  }

  const names = [];
  for (const p of (renderer.info.programs || [])) {
    if (!p.program) continue;
    let n = 0;
    try { n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p.program, i);
      if (info && SAMPLER_TYPES.has(info.type)) names.push(info.name + ':' + info.type);
    }
  }
  const anyMat = Array.from(AL.stateOf(scene).hookedMaterials || [])[0];
  const bound = anyMat && anyMat.__alUniforms
    ? { depth: !!(anyMat.__alUniforms.uAlSceneDepth && anyMat.__alUniforms.uAlSceneDepth.value),
        proj: !!(anyMat.__alUniforms.uAlProjection && anyMat.__alUniforms.uAlProjection.value),
        invProj: !!(anyMat.__alUniforms.uAlProjectionInverse && anyMat.__alUniforms.uAlProjectionInverse.value),
        key: anyMat.__alInjection ? anyMat.__alInjection.key : null }
    : null;

  const cs = AL.contactStateOf(scene);
  const out = {
    pixels: Array.from(px), samplers: samplers,
    active: AL.isContactShadowsActive(scene),
    prepassRendered: !!cs.rendered,
    prepassSize: cs.target ? [cs.target.width, cs.target.height] : null,
    errors: errors, glError: gl.getError(), samplerNames: names, bound: bound,
  };
  renderer.dispose();
  return out;
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-contact-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

const luma = (p, i) => p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;

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
    const r = await send('Runtime.evaluate', { expression: 'typeof window.run' });
    if (r.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const run = async (on, lights, withBox = true, grazing = false) => {
    const r = await send('Runtime.evaluate', {
      expression: `window.run(${!!on}, ${lights}, ${!!withBox}, ${!!grazing})`, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const off1 = await run(false, 1);
  const on1 = await run(true, 1);
  const contactShot = await send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  });
  fs.writeFileSync(path.join(here, 'contact-shadow-validation.png'),
    Buffer.from(contactShot.data, 'base64'));
  const on4 = await run(true, 4);
  const off4 = await run(false, 4);
  const grazingOff = await run(false, 1, false, true);
  const grazingOn = await run(true, 1, false, true);

  // Print before asserting: a bare glError number says nothing, and the shader log is the only
  // thing that identifies which identifier failed to resolve.
  for (const [name, r] of [['off/1', off1], ['on/1', on1], ['on/4', on4]]) {
    if (r.errors.length) console.log(`  ${name} shader log: ${r.errors.join(' | ').slice(0, 2500)}`);
    if (r.glError) console.log(`  ${name} glError ${r.glError}`);
    console.log(`  ${name} samplers: ${(r.samplerNames||[]).join(', ')}`);
    console.log(`  ${name} bound: ${JSON.stringify(r.bound)}`);
  }
  for (const [name, r] of [['off/1', off1], ['on/1', on1], ['on/4', on4]]) {
    assert.equal(r.glError, 0, `${name}: GL error ${r.glError}`);
    assert.equal(r.errors.length, 0, `${name}: shader errors — ${r.errors.join(' | ')}`);
  }
  assert.equal(on1.active, true, 'contact shadows must report active once the prepass has rendered');
  assert.equal(on1.prepassRendered, true, 'the depth prepass must have run');
  assert.equal(on1.bound.invProj, true, 'the receiver-plane rejection needs the inverse projection matrix');
  assert.equal(off1.active, false, 'disabled must not report active');

  console.log('Contact shadows');
  console.log(`  prepass target: ${JSON.stringify(on1.prepassSize)} (full ${W}x${H} resolution)`);
  assert.deepEqual(on1.prepassSize, [W, H],
    'a reduced nearest-filter depth target recreates grazing-angle contact shadows as horizontal bars');

  // 1. It must darken something, and only near the geometry it touches.
  let darker = 0, softened = 0, lit = 0;
  for (let i = 0; i < off1.pixels.length; i += 4) {
    const a = luma(off1.pixels, i), b = luma(on1.pixels, i);
    if (a > 12) {
      lit++;
      if (b < a * 0.85) darker++;
      if (b > a * 0.10 && b < a * 0.85) softened++;
    }
  }
  const pct = 100 * darker / Math.max(1, lit);
  console.log(`  darkened ${darker} of ${lit} lit px (${pct.toFixed(1)}%); softened ${softened}px`);
  assert.ok(darker > 60, `contact shadows must actually darken the scene (only ${darker}px)`);
  assert.ok(pct < 70,
    `${pct.toFixed(1)}% of the lit area darkened — that is a global dimming, not a contact shadow. ` +
    'The most likely cause is the march starting at the surface and reading it as its own occluder.');
  assert.ok(softened > 100,
    `only ${softened}px have a partial contact factor — the binary march-step bands have returned`);

  // With no caster, a flat floor must not shadow itself. This is the exact grazing-angle failure
  // that appears as detached horizontal bars on a large ground plane.
  let grazingLit = 0, grazingFalse = 0;
  for (let i = 0; i < grazingOff.pixels.length; i += 4) {
    const a = luma(grazingOff.pixels, i), b = luma(grazingOn.pixels, i);
    if (a > 12) { grazingLit++; if (b < a * 0.90) grazingFalse++; }
  }
  const grazingFalsePct = 100 * grazingFalse / Math.max(1, grazingLit);
  console.log(`  caster-free grazing floor falsely darkened: ${grazingFalse}/${grazingLit} (${grazingFalsePct.toFixed(2)}%)`);
  assert.ok(grazingFalsePct < 0.5,
    `${grazingFalsePct.toFixed(2)}% of a caster-free floor self-shadowed at a grazing angle`);

  // 2. THE POINT: the sampler count must not grow with light count.
  console.log(`  samplers: 1 light ${on1.samplers}, 4 lights ${on4.samplers} (contact off, 4 lights: ${off4.samplers})`);
  assert.equal(on4.samplers, on1.samplers,
    `texture units grew from ${on1.samplers} to ${on4.samplers} when light count went 1 -> 4. ` +
    'Contact shadows exist precisely because their cost is independent of light count; if that ' +
    'does not hold they are strictly worse than shadow maps.');
  assert.ok(on1.samplers - off4.samplers <= 1,
    `contact shadows must cost at most ONE extra texture unit in total ` +
    `(off ${off4.samplers} -> on ${on1.samplers})`);

  console.log('\nContact shadow checks passed: real darkening, and cost independent of light count.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
