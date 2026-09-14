// What the scene-wide texture-unit allocator costs to keep current, per frame.
//
// WHY. refreshTextureUnitBudget() runs unconditionally from doStepPostEvents, and it calls
// scanSceneSamplerPressure(), which traverses the ENTIRE Three scene graph and inspects every
// material of every mesh. That is correct - the verdict has to stay current, because a material
// swapped in by another extension changes the answer - but it is also a third full-scene traversal
// per frame, alongside collectMovedCasters() and hookObjectMaterials().
//
// An extension whose whole purpose is to make many lights affordable should not pay an unbounded
// per-frame cost that scales with SCENE SIZE rather than light count. This measures the actual
// slope so the decision to throttle (or not) is made on a number rather than a hunch.

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
window.measure = function (meshCount, iterations) {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  camera.up.set(0, 0, 1); camera.position.set(0, -900, 600); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  const AL = gdjs.__advancedLighting3D;
  const state = AL.registerSceneManager(scene);

  // A realistic prop: a textured, normal/rough/metal-mapped standard material. Materials are
  // SHARED across the meshes, exactly as GDevelop shares them, so this measures traversal cost
  // rather than material-construction cost.
  const white = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1, THREE.RGBAFormat);
  white.needsUpdate = true;
  const shared = new THREE.MeshStandardMaterial({
    map: white, normalMap: white, roughnessMap: white, metalnessMap: white,
    aoMap: white, emissiveMap: white,
  });
  const geo = new THREE.BoxGeometry(10, 10, 10);
  for (let i = 0; i < meshCount; i++) {
    const m = new THREE.Mesh(geo, shared);
    m.position.set((i % 50) * 20 - 500, Math.floor(i / 50) * 20 - 500, 0);
    root.add(m);
  }

  const scan = AL.__internals.scanSceneSamplerPressure;
  scan(scene);                                   // warm the paths before timing
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) scan(scene);
  const perScan = (performance.now() - t0) / iterations;

  // And the whole refresh, which adds the light walk and the admit() chain on top of the scan.
  AL.__internals.refreshTextureUnitBudget(state, scene);
  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) AL.__internals.refreshTextureUnitBudget(state, scene);
  const perRefresh = (performance.now() - t1) / iterations;

  const pressure = scan(scene);
  renderer.dispose();
  return { meshCount, perScan, perRefresh, material: pressure.material };
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-scan-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

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

  const COUNTS = [50, 200, 800, 2000];
  const rows = [];
  for (const n of COUNTS) {
    const r = await send('Runtime.evaluate', {
      expression: `window.measure(${n}, 200)`, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    rows.push(r.result.value);
  }

  console.log('Texture-unit budget: cost of keeping the verdict current');
  console.log('  (SwiftShader host CPU; this is plain JS traversal, so the shape is meaningful');
  console.log('   even though the absolute numbers are not a GPU measurement)');
  console.log('');
  console.log('  meshes   scan ms   full refresh ms   material units seen');
  console.log('  ' + '-'.repeat(56));
  for (const r of rows) {
    console.log('  ' + String(r.meshCount).padStart(6) + r.perScan.toFixed(4).padStart(10) +
      r.perRefresh.toFixed(4).padStart(18) + String(r.material).padStart(18));
  }

  for (const r of rows) {
    assert.ok(r.perScan >= 0, 'timing must be readable');
    assert.equal(r.material, 6, 'the shared 6-map material must be detected at every scene size');
  }

  const small = rows[0], large = rows[rows.length - 1];
  const perMesh = (large.perScan - small.perScan) / (large.meshCount - small.meshCount);
  const slope = perMesh * 1000;
  console.log('');
  console.log(`  marginal cost: ${slope.toFixed(3)} microseconds per mesh per frame`);
  console.log(`  at 2000 meshes the scan alone is ${large.perScan.toFixed(3)} ms EVERY frame,`);
  console.log(`  which is ${(large.perScan / 16.67 * 100).toFixed(1)}% of a 60 FPS frame budget.`);
  console.log('');
  console.log('  This is a THIRD full-scene traversal per frame, alongside collectMovedCasters()');
  console.log('  and hookObjectMaterials(). The verdict genuinely has to stay current - another');
  console.log('  extension swapping a material changes the answer - but it only changes when the');
  console.log('  scene graph or the material set changes, not every frame. Throttling it (every');
  console.log('  N frames, or on a scene-graph version counter) would remove the whole slope.');

  // Guard the property that matters: cost must scale with SCENE SIZE, which is the thing worth
  // knowing. If a future change made this constant-time, this assertion should be deleted, not
  // weakened - it exists to document that the slope is real.
  assert.ok(large.perScan > small.perScan,
    'the scan must measurably scale with mesh count, or this test is measuring nothing');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
