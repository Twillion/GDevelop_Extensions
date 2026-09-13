// The SDF volume must not draw its own bounds.
//
// Reported symptom: a hard-edged quad on the ground exactly matching the SDFVolume3D box, visible
// inside an otherwise smooth spotlight pool. It disappears when shadow ownership is set to Off, so
// it is produced by the shadow path and not by scene geometry.
//
// This isolates it with NO CASTER AT ALL. A volume containing nothing but flat floor must be
// invisible: every ray should reach the light unobstructed whether it starts inside the box or
// outside it. Any brightness step across the boundary is the bug, and its size is the measurement.

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

const W = 320, H = 320;

const page = `<canvas id=c width=${W} height=${H}></canvas>
<script src="/three.js"></script>
<script>var gdjs = { registerRuntimeScenePostEventsCallback(){}, registerRuntimeSceneUnloadedCallback(){}, registerInGameEditorPostStepCallback(){}, _unregisterCallback(){} };</script>
<script>${chain}</script>
<script>${runtime}</script>
<script>
window.run = async function (useVolume, withCaster) {
  const AL = gdjs.__advancedLighting3D;
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(${W}, ${H}, false);
  renderer.setClearColor(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;

  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
  camera.up.set(0, 0, 1);
  // Straight down, so the ground fills the frame and the volume footprint is an axis-aligned
  // square in screen space — which makes "inside" and "outside" trivial to sample.
  camera.position.set(0, 0, 1500); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // Floor far larger than the volume, so the lit pool spans the boundary on all sides.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  floor.position.set(0, 0, 0); floor.receiveShadow = true; root.add(floor);

  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');

  // One spot directly overhead, wide enough that its pool covers well beyond the volume.
  const LX = withCaster === 'edge' ? -650 : 0;
  AL.registerLight(scene, {
    getX: () => LX, getY: () => 0, getZ: () => 900,
    getWidth: () => 1, getHeight: () => 1, getDepth: () => 1, getRenderer: () => null,
    getAABB: () => ({ min: [LX, 0, 900], max: [LX, 0, 900] }),
  }, {}, {
    lightType: 'Spot', intensity: 80, radius: 30, colorMode: 'RGB', lightColor: '255;255;255',
    spotInnerAngle: 55, spotOuterAngle: 70, flickerMode: 'None',
    castShadow: true, shadowTechnique: 'SDF', shadowBias: 0.02,
  });

  // A real occluder, for the half of this test that checks a REAL shadow still appears. Added
  // BEFORE the bake so it is actually in the field. The boundary half runs without it, because a
  // volume containing nothing must be invisible.
  if (withCaster) {
    // 'edge' puts the caster near the volume boundary, with the light thrown from the far side, so
    // the shadow must fall on floor WELL OUTSIDE the box. That is the question that decides whether
    // a huge light needs a huge volume, or only a volume around the occluders.
    const bx = withCaster === 'edge' ? 380 : 180;
    const box = new THREE.Mesh(new THREE.BoxGeometry(160, 160, 260),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    box.position.set(bx, 0, 130); box.castShadow = true; box.receiveShadow = true; root.add(box);
  }

  const draw = () => { AL.doStepPostEvents(scene); renderer.render(root, camera); };

  if (useVolume) {
    // A volume covering only the middle of the floor. It contains nothing but flat ground.
    AL.registerSDFVolume(scene, { getRenderer: () => null }, {}, { resX: 64, resY: 64, resZ: 32 });
    AL.setSDFVolumeBounds(scene, -500, -500, -50, 500, 500, 450);
    AL.startSDFBake(scene);
    let steps = 0;
    while (AL.isSDFBakeInProgress(scene) && steps++ < 4000) draw();
  }
  for (let i = 0; i < 4; i++) draw();

  const gl = renderer.getContext();
  const px = new Uint8Array(${W} * ${H} * 4);
  gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const st = AL.stateOf(scene);
  const vol = st.sdfVolume;

  // Is the OCCLUDER actually in the baked field? Decode the half-float grid and report how much of
  // it reads as near-surface. A field that is uniformly 'far' means the bake never saw the box, and
  // no amount of marching will find it.
  let field = null;
  if (vol && vol.data) {
    const half = (h) => {
      const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
      if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
      if (e === 31) return m ? NaN : s * Infinity;
      return s * Math.pow(2, e - 15) * (1 + m / 1024);
    };
    let near = 0, mid = 0, far = 0, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < vol.data.length; i++) {
      const v = half(vol.data[i]);
      if (v < minV) minV = v;
      if (v > maxV && isFinite(v)) maxV = v;
      if (v < 1) near++; else if (v < 200) mid++; else far++;
    }
    // The box centre, in grid coordinates.
    const gx = Math.floor(((180 - vol.minX) / (vol.maxX - vol.minX)) * vol.resX);
    const gy = Math.floor(((0 - vol.minY) / (vol.maxY - vol.minY)) * vol.resY);
    const gz = Math.floor(((130 - vol.minZ) / (vol.maxZ - vol.minZ)) * vol.resZ);
    const idx = (gz * vol.resY + gy) * vol.resX + gx;
    field = { total: vol.data.length, near, mid, far,
              min: +minV.toFixed(2), max: +maxV.toFixed(2),
              atBoxCentre: +half(vol.data[idx] || 0).toFixed(2), gx, gy, gz };
  }
  const out = {
    pixels: Array.from(px),
    baked: !!(vol && vol.isBaked),
    bounds: vol ? [vol.minX, vol.minY, vol.minZ, vol.maxX, vol.maxY, vol.maxZ] : null,
    field: field,
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-sdfbound-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

const luma = (p, i) => p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;

/** Mean luminance of a horizontal run of pixels on row y. */
function rowMean(px, y, x0, x1) {
  let sum = 0, n = 0;
  for (let x = x0; x < x1; x++) { sum += luma(px, (y * W + x) * 4); n++; }
  return n ? sum / n : 0;
}

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
  const run = async (useVolume, withCaster) => {
    // JSON.stringify, not !!: the flag carries a MODE ('edge'), and coercing it to a boolean is how
    // the edge variant silently rendered the plain scene twice and reported a meaningless 0.
    const r = await send('Runtime.evaluate', { expression: `window.run(${useVolume}, ${JSON.stringify(withCaster || false)})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const without = await run(false);
  const withVol = await run(true);
  assert.equal(withVol.baked, true, 'the volume must finish baking, or this measures nothing');

  // The camera is straight down from 1500 with a 50 degree fov, so the visible ground half-width is
  // 1500 * tan(25) ~= 700 units across 160 px. The volume half-width is 500 units, so its edge
  // lands about 114 px from centre.
  const halfSpan = 1500 * Math.tan(25 * Math.PI / 180);
  const edgePx = Math.round((500 / halfSpan) * (W / 2));
  const mid = Math.round(H / 2);
  const inside = rowMean(withVol.pixels, mid, W / 2 - edgePx + 12, W / 2 - 12);
  const outside = rowMean(withVol.pixels, mid, W / 2 - edgePx - 26, W / 2 - edgePx - 6);
  const baseInside = rowMean(without.pixels, mid, W / 2 - edgePx + 12, W / 2 - 12);
  const baseOutside = rowMean(without.pixels, mid, W / 2 - edgePx - 26, W / 2 - edgePx - 6);

  console.log('SDF volume boundary (no caster anywhere in the scene)');
  console.log(`  volume edge at ~${edgePx}px from centre; bounds ${JSON.stringify(withVol.bounds)}`);
  console.log(`  no volume : inside ${baseInside.toFixed(1)}  outside ${baseOutside.toFixed(1)}  step ${(baseInside - baseOutside).toFixed(1)}`);
  console.log(`  volume    : inside ${inside.toFixed(1)}  outside ${outside.toFixed(1)}  step ${(inside - outside).toFixed(1)}`);

  // The no-volume run is the control: whatever natural falloff exists across the boundary shows up
  // in BOTH runs, so the bug is the extra step the volume introduces on top of it.
  const naturalStep = baseInside - baseOutside;
  const volumeStep = inside - outside;
  const artefact = Math.abs(volumeStep - naturalStep);
  console.log(`  artefact introduced by the volume: ${artefact.toFixed(1)} luminance`);

  assert.ok(withVol.bounds, 'the volume must exist');
  assert.ok(baseInside > 20, `the control frame must actually be lit (got ${baseInside.toFixed(1)})`);
  assert.ok(artefact < 6,
    `a volume containing nothing but flat floor must be INVISIBLE. It shifts luminance by ` +
    `${artefact.toFixed(1)} across its own boundary, which draws the box outline the report shows. ` +
    `Rays that start inside the box self-occlude against the floor they sit on, while rays outside ` +
    `it return unshadowed immediately.`);

  // The other half: removing the artefact must not remove the SHADOW. A fix that makes the volume
  // invisible by making it do nothing is not a fix.
  const casterNoVol = await run(false, true);
  const casterVol = await run(true, true);
  let darker = 0, lit = 0;
  for (let i = 0; i < casterNoVol.pixels.length; i += 4) {
    const a = luma(casterNoVol.pixels, i), b = luma(casterVol.pixels, i);
    if (a > 20) { lit++; if (b < a * 0.7) darker++; }
  }
  const pct = lit ? (100 * darker / lit) : 0;
  console.log(`  with a caster: ${darker} of ${lit} lit px darkened by the volume (${pct.toFixed(1)}%)`);
  if (casterVol.field) console.log(`  baked field: ${JSON.stringify(casterVol.field)}`);
  // REPORTED, NOT GATED — and this records a defect, not a passing feature.
  //
  // With the ray origin clear of the solid band, a real 160x160x260 occluder sitting inside the
  // volume darkens ZERO pixels. The local-light SDF march is not finding occluders at all.
  //
  // What the earlier tests were measuring instead: below the dilation threshold the ray starts in
  // solid space and returns a hit on its FIRST sample, so the whole lit area reads as shadowed.
  // test-local-sdf-shadow-webgl.mjs asserted "some region darkened" and passed on exactly that —
  // 72.5% of the frame, identical at every shadow bias, which is the signature of a constant rather
  // than a shadow. Sweeping the offset multiplier gives a cliff, not a curve: 72.5% at 0.10, 0.25
  // and 0.50, then 0% at 1.05. A real shadow would shrink gradually; a self-occlusion band switches
  // off all at once.
  //
  // So local SDF shadows have very likely never cast from an occluder, and the tests that appeared
  // to prove otherwise were measuring the artefact. Use shadow maps for local lights until this is
  // diagnosed. The Sun's SDF path is not exercised by this file and is not implicated.
  // Both halves are gated. Removing the artefact must not remove the SHADOW — a fix that makes the
  // volume invisible by making it do nothing is not a fix. And the shadowed fraction has an UPPER
  // bound too, because the failure this replaced was 72.5% of the frame reading as shadowed, and a
  // bare "something darkened" assertion passed on that for this feature's whole life.
  assert.ok(darker > 150,
    `the volume must cast a real shadow from a real occluder (only ${darker}px darkened)`);
  assert.ok(pct < 40,
    `a single box must not shadow ${pct.toFixed(1)}% of the lit area — that is self-occlusion, not ` +
    'a shadow, and it is exactly what the old assertion could not tell apart');

  // Does a compact volume shadow onto floor OUTSIDE itself? If it does, the volume only has to
  // contain the occluders, and a huge light does NOT require a huge volume — which is the whole
  // question of whether SDF is usable at all with metre-scale light radii.
  const edgeNoVol = await run(false, 'edge');
  const edgeVol = await run(true, 'edge');
  const halfSpanPx = (500 / halfSpan) * (W / 2);
  let outsideDark = 0, outsideLit = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx2 = x - W / 2, dy2 = y - H / 2;
      if (Math.max(Math.abs(dx2), Math.abs(dy2)) < halfSpanPx + 4) continue;   // skip inside the box
      const i = (y * W + x) * 4;
      const a4 = luma(edgeNoVol.pixels, i), b4 = luma(edgeVol.pixels, i);
      if (a4 > 20) { outsideLit++; if (b4 < a4 * 0.7) outsideDark++; }
    }
  }
  // Also count darkened pixels ANYWHERE, and their spread in x, so a wrongly-placed exclusion mask
  // cannot be mistaken for "no shadow".
  let anyDark = 0, minX = 1e9, maxX = -1e9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a5 = luma(edgeNoVol.pixels, i), b5 = luma(edgeVol.pixels, i);
      if (a5 > 20 && b5 < a5 * 0.7) { anyDark++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  const edgePxX = W / 2 + halfSpanPx;
  console.log(`  edge case: ${anyDark}px darkened anywhere, x span ${minX}..${maxX}; ` +
    `volume edge at x=${edgePxX.toFixed(0)}`);
  console.log(`  shadow cast ONTO FLOOR OUTSIDE the volume: ${outsideDark} of ${outsideLit} lit px ` +
    `(${(100 * outsideDark / Math.max(1, outsideLit)).toFixed(1)}%)`);
  if (outsideDark > 100) {
    console.log('  => a compact volume shadows beyond its own bounds: it must contain the OCCLUDERS,');
    console.log('     not the light reach, so a huge light does not need a huge volume.');
  } else {
    console.log('  => nothing lands outside the volume, so it must also cover the RECEIVING area.');
    console.log('     That makes SDF impractical for large lights.');
  }

  console.log('\nSDF boundary check passed: the volume no longer draws its own bounds.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
