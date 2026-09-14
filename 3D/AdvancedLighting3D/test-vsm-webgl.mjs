// Variance shadow maps, compiled and rendered on a real GL context.
//
// This test exists because a Node test CANNOT catch what goes wrong here. Every failure mode of
// this feature is a GLSL or a GL-state failure: a helper that references unpackRGBATo2Half before
// <packing> declares it, a sqrt of a negative that turns a flat floor into NaN black, a moments
// target left on NearestFilter so the blur does nothing, a texture bound to the wrong sampler. All
// of those pass a unit test and render a scene that is silently wrong.
//
// So the gate is the IMAGE, and specifically the thing VSM is for: a shadow that is genuinely
// SOFTER than PCF, in the same place, for no extra texture unit. A VSM path that merely produces
// "a shadow" has achieved nothing - PCF already did that, more cheaply to set up.

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
// mode: 'none' | 'pcf' | 'vsm'
window.run = function (mode, softness, bleed) {
  const AL = gdjs.__advancedLighting3D;
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(${W}, ${H}, false);
  renderer.shadowMap.enabled = true;

  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  // Away from the origin, so a matrix that quietly assumes it looks right at 0,0,0 and wrong here.
  const CX = 1800, CY = 700;
  camera.position.set(CX + 250, -CY - 450, 430);
  camera.lookAt(CX, -CY, 40);
  camera.updateMatrixWorld(true);
  renderer.setClearColor(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  floor.position.set(CX, CY, 0); floor.receiveShadow = true; root.add(floor);

  const box = new THREE.Mesh(new THREE.BoxGeometry(90, 90, 140),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  box.position.set(CX, CY, 70); box.castShadow = true; box.receiveShadow = true; root.add(box);

  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');
  AL.applySceneShadowSettings(scene, { localShadowBackend: 'Owned' });
  if (mode === 'vsm') {
    AL.setLocalShadowFilter(scene, 'VSM');
    AL.setVsmSoftness(scene, softness);
    AL.setVsmLightBleed(scene, bleed);
  } else {
    AL.setLocalShadowFilter(scene, 'PCF');
  }

  const LX = CX - 320, LY = CY - 300, LZ = 420;
  const lightObj = { getX: () => LX, getY: () => LY, getZ: () => LZ,
    getWidth: () => 1, getHeight: () => 1, getDepth: () => 1, getRenderer: () => null,
    getAABB: () => ({ min: [LX, LY, LZ], max: [LX, LY, LZ] }) };
  AL.registerLight(scene, lightObj, {}, {
    lightType: 'Spot', intensity: 60, radius: 14, colorMode: 'RGB', lightColor: '255;255;255',
    spotInnerAngle: 38, spotOuterAngle: 60, flickerMode: 'None',
    castShadow: mode !== 'none', shadowTechnique: 'ShadowMap', shadowMapSize: 512,
  });

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  // The renderer's viewport and render target after the extension's step, BEFORE the main render.
  // An unrestored viewport here is what made the owned backend diverge from the native one by 85%
  // of lit pixels, and VSM adds two more passes that set their own - so it is asserted, not hoped.
  let viewportAfterStep = null, targetAfterStep = 'unset';
  let scissorAfterStep = null, scissorTestAfterStep = true;
  // THE GDEVELOP SCENE EDITOR draws the view into a sub-rectangle of a shared canvas, which means
  // a scissor rect and scissor test are ACTIVE while our passes run. Every off-screen pass here
  // disabled the scissor test and never restored it: invisible in an exported game, because
  // nothing else uses scissor, but in the editor the surrounding clear then covers the whole
  // canvas while the scene still draws only inside its viewport - so everything outside the view
  // goes black. Setting a scissor here reproduces the editor's state exactly.
  const SCISSOR = [12, 20, 140, 90];
  renderer.setScissor(SCISSOR[0], SCISSOR[1], SCISSOR[2], SCISSOR[3]);
  renderer.setScissorTest(true);

  // AND the editor renders into its OWN TARGET, not the canvas. That distinction is the whole bug:
  // setViewport writes the renderer's persistent, canvas-relative viewport, while a bound target
  // carries its own. Restoring the target BEFORE the viewport overwrites the target's correct
  // viewport with a canvas-derived one, so the next frame draws squashed into part of the pane -
  // while input, which never consults the renderer, keeps using the full rectangle.
  const editorTarget = new THREE.WebGLRenderTarget(${W * 2}, ${H}, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  let targetViewportAfterStep = null;
  const draw = () => {
    // Bind the editor-like target before the step, exactly as the editor would have it bound.
    renderer.setRenderTarget(editorTarget);
    AL.doStepPostEvents(scene);
    // The ACTIVE viewport, read from GL rather than from the renderer. renderer.getViewport()
    // returns the PERSISTENT canvas-relative viewport, which is a different number and is
    // supposed to stay at the canvas size - reading it here measured nothing. gl.VIEWPORT is what
    // actually decides where pixels land.
    const gv = renderer.getContext().getParameter(renderer.getContext().VIEWPORT);
    const active = [gv[0], gv[1], gv[2], gv[3]];
    if (!targetViewportAfterStep || String(active) !== String([0, 0, ${W * 2}, ${H}])) {
      targetViewportAfterStep = active;
    }
    renderer.setRenderTarget(null);
    viewportAfterStep = renderer.getViewport(new THREE.Vector4()).toArray();
    targetAfterStep = renderer.getRenderTarget() === null ? 'null' : 'LEAKED';
    // ACCUMULATED over every frame, not sampled on the last one. A shadow map re-renders only
    // while it is dirty, so by the final frame no pass runs at all and the corrupted state has
    // already been papered over - which is exactly how the first version of this check passed
    // against the very bug it was written for.
    const st = renderer.getScissorTest();
    const sc = renderer.getScissor(new THREE.Vector4()).toArray();
    if (scissorTestAfterStep !== false) scissorTestAfterStep = st;
    if (!scissorAfterStep || String(sc) !== String(SCISSOR)) scissorAfterStep = sc;
    renderer.setScissorTest(false);          // do not clip the readback below
    renderer.render(root, camera);
    renderer.setScissorTest(true);
  };
  for (let i = 0; i < 6; i++) draw();
  console.error = originalError;

  const gl = renderer.getContext();
  const px = new Uint8Array(${W} * ${H} * 4);
  gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const SAMPLER_TYPES = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D,
    gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW].filter((v) => v !== undefined));
  let samplers = 0;
  for (const p of (renderer.info.programs || [])) {
    if (!p.program) continue;
    let count = 0, active = 0;
    try { active = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    for (let i = 0; i < active; i++) {
      const info = gl.getActiveUniform(p.program, i);
      if (info && SAMPLER_TYPES.has(info.type)) count += Math.max(1, info.size);
    }
    if (count > samplers) samplers = count;
  }

  const st = AL.__internals.localShadowStateOf(scene);
  const slot0 = st.slots[0] || {};

  // Read the moments map itself. "The shadow looks soft" can come from many places; proving the
  // moments map holds a real distribution proves the blur ran and wrote something meaningful.
  let moments = null;
  if (slot0.vsm) {
    const S = slot0.vsm.width;
    const buf = new Uint8Array(S * S * 4);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(slot0.vsm);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    renderer.setRenderTarget(prev);
    // unpackRGBATo2Half: x = r + g/255, y = b + a/255. Only the high bytes are needed here.
    let minMean = 255, maxMean = 0, nonZeroDev = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] < minMean) minMean = buf[i];
      if (buf[i] > maxMean) maxMean = buf[i];
      if (buf[i + 2] > 1) nonZeroDev++;          // a texel whose neighbourhood is not flat
    }
    moments = { size: S, minMean, maxMean, nonZeroDev, total: S * S };
  }

  const glError = gl.getError();
  const filter = st.filter, backend = st.backend;
  renderer.dispose();
  return {
    pixels: Array.from(px), samplers, errors, glError, filter, backend,
    owned: !!slot0.owned, vsmReady: !!slot0.vsmReady, hasVsmTarget: !!slot0.vsm,
    moments, viewportAfterStep, targetAfterStep, scissorAfterStep, scissorTestAfterStep,
    expectedScissor: SCISSOR, targetViewportAfterStep, expectedTargetViewport: [0, 0, ${W * 2}, ${H}],
  };
};

// Two spot lights in ONE scene with DIFFERENT filters, while the scene default stays PCF.
// This is the case per-light selection exists for, and the case a scene-wide flag cannot express.
window.runMixed = function () {
  const W_ = ${W}, H_ = ${H};
  const AL = gdjs.__advancedLighting3D;
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(W_, H_, false);
  renderer.shadowMap.enabled = true;

  const root = new THREE.Scene(); root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  const CX = 1800, CY = 700;
  camera.position.set(CX + 250, -CY - 450, 430);
  camera.lookAt(CX, -CY, 40);
  camera.updateMatrixWorld(true);
  renderer.setClearColor(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  floor.position.set(CX, CY, 0); floor.receiveShadow = true; root.add(floor);
  const box = new THREE.Mesh(new THREE.BoxGeometry(90, 90, 140),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  box.position.set(CX, CY, 70); box.castShadow = true; box.receiveShadow = true; root.add(box);

  const scene = {
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeCamera: () => camera }) }),
  };
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');
  // Deliberately left at the defaults: Native backend, PCF scene filter. A light asking for VSM
  // has to promote the backend by itself, or per-light selection is unusable without also
  // knowing to change two unrelated scene settings first.

  function addLight(x, y, filter) {
    const obj = { getX: () => x, getY: () => y, getZ: () => 420,
      getWidth: () => 1, getHeight: () => 1, getDepth: () => 1, getRenderer: () => null,
      getAABB: () => ({ min: [x, y, 420], max: [x, y, 420] }) };
    AL.registerLight(scene, obj, {}, {
      lightType: 'Spot', intensity: 60, radius: 14, colorMode: 'RGB', lightColor: '255;255;255',
      spotInnerAngle: 38, spotOuterAngle: 60, flickerMode: 'None',
      castShadow: true, shadowTechnique: 'ShadowMap', shadowMapSize: 512, shadowMapFilter: filter,
    });
  }
  addLight(CX - 320, CY - 300, 'VSM');
  addLight(CX + 320, CY - 300, 'PCF');

  const errors = [];
  const originalError = console.error;
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  let viewportAfterStep = null;
  for (let i = 0; i < 6; i++) {
    AL.doStepPostEvents(scene);
    viewportAfterStep = renderer.getViewport(new THREE.Vector4()).toArray();
    renderer.render(root, camera);
  }
  console.error = originalError;

  const gl = renderer.getContext();
  const SAMPLER_TYPES = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D,
    gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW].filter((v) => v !== undefined));
  let samplers = 0;
  for (const p of (renderer.info.programs || [])) {
    if (!p.program) continue;
    let count = 0, active = 0;
    try { active = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) || 0; } catch (e) { continue; }
    for (let i = 0; i < active; i++) {
      const info = gl.getActiveUniform(p.program, i);
      if (info && SAMPLER_TYPES.has(info.type)) count += Math.max(1, info.size);
    }
    if (count > samplers) samplers = count;
  }

  const st = AL.__internals.localShadowStateOf(scene);
  // kind.x is what the shader branches on: 0 spot PCF, 1 point, 2 spot VSM. Reading the UNIFORM
  // rather than the JS state is the point - a slot can believe it is VSM while the value the
  // shader actually receives says otherwise, and only the uniform decides what gets drawn.
  let kinds = null;
  const anyMat = Array.from(AL.stateOf(scene).hookedMaterials || [])[0];
  if (anyMat && anyMat.__alUniforms && anyMat.__alUniforms.uAlLocalKind) {
    kinds = anyMat.__alUniforms.uAlLocalKind.value.map((v) => v.x);
  }
  const slots = st.slots.map((sl) => ({
    live: !!(sl && sl.live), owned: !!(sl && sl.owned),
    hasVsm: !!(sl && sl.vsm), vsmReady: !!(sl && sl.vsmReady),
  }));
  const glError = gl.getError();
  const out = { samplers, errors, glError, filter: st.filter, backend: st.backend,
                slots, kinds, mapped: st.mappedCount, viewportAfterStep };
  renderer.dispose();
  return out;
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-vsm-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

const luma = (p, i) => p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;

/**
 * Per-pixel shadow factor, measured against the SAME scene with the shadow switched off.
 *
 * Comparing absolute luminance across configurations cannot separate "softer" from "dimmer": a
 * uniformly darker render fills the mid-tone band just as a real penumbra does. Dividing by the
 * unshadowed render removes the lighting entirely and leaves only what the shadow did.
 */
function shadowFactors(shaded, control) {
  const out = [];
  for (let i = 0; i < control.length; i += 4) {
    const base = luma(control, i);
    if (base < 20) continue;                       // unlit background carries no information
    out.push(Math.min(1, luma(shaded, i) / base));
  }
  return out;
}
const band = (f, lo, hi) => f.filter((v) => v > lo && v < hi).length;

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
  const run = async (mode, softness = 4, bleed = 0.15) => {
    const r = await send('Runtime.evaluate', {
      expression: `window.run(${JSON.stringify(mode)}, ${softness}, ${bleed})`, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // The shipped defaults, plus the two ends of each control. Every claim below is a COMPARISON
  // between these runs, never an absolute pixel count: absolute counts depend on the scene, the
  // map size and the light angle, and would make this a snapshot test rather than a check.
  const sendRunMixed = async () => {
    const r = await send('Runtime.evaluate', { expression: 'window.runMixed()', returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const control  = await run('none');
  const pcf      = await run('pcf');
  const vsmDef   = await run('vsm', 4, 0.15);   // the defaults a project actually gets
  const vsmRaw   = await run('vsm', 4, 0.0);    // the technique with nothing traded away
  const vsmWide  = await run('vsm', 8, 0.0);    // does softness follow the radius?
  const vsmCrush = await run('vsm', 4, 0.6);    // does bleed reduction trade it back?

  const runs = [['control', control], ['pcf', pcf], ['vsm default', vsmDef],
                ['vsm raw', vsmRaw], ['vsm wide', vsmWide], ['vsm crushed', vsmCrush]];

  console.log('Variance shadow maps');
  for (const [name, r] of runs) {
    assert.equal(r.glError, 0, `${name}: GL error ${r.glError}`);
    // A shader that fails to link logs through console.error and then draws nothing. Without this
    // the softness comparisons below would happily 'pass' on two blank frames.
    assert.equal(r.errors.length, 0, `${name}: shader/link errors - ${r.errors.join(' | ')}`);
    assert.deepEqual(r.viewportAfterStep, [0, 0, W, H],
      `${name}: the extension left the viewport at ${JSON.stringify(r.viewportAfterStep)}. The main ` +
      'render would then draw into part of the canvas. This is exactly the defect that made the ' +
      'owned backend diverge from the native one across 85% of lit pixels, and VSM adds two more ' +
      'passes that set their own viewport.');
    assert.equal(r.targetAfterStep, 'null',
      `${name}: the extension left a render target bound; the main render would draw into it`);
    assert.equal(r.scissorTestAfterStep, true,
      `${name}: the extension disabled the scissor test and did not restore it. In an exported ` +
      'game nothing notices; in the GDevelop scene editor, which draws the view into a ' +
      'sub-rectangle of a shared canvas, the surrounding clear then blacks out everything ' +
      'outside the view.');
    assert.deepEqual(r.scissorAfterStep, r.expectedScissor,
      `${name}: the extension changed the scissor rectangle to ` +
      `${JSON.stringify(r.scissorAfterStep)} and did not restore it`);
    assert.deepEqual(r.targetViewportAfterStep, r.expectedTargetViewport,
      `${name}: with a render target bound - as the GDevelop scene editor has - the active ` +
      `viewport after the step was ${JSON.stringify(r.targetViewportAfterStep)} instead of the ` +
      `target's own ${JSON.stringify(r.expectedTargetViewport)}. The editor's next frame draws ` +
      'squashed into part of its pane while input keeps using the full rectangle.');
  }

  /* ---- 1. Selecting VSM must actually select it, and must bring Owned with it ---- */
  assert.equal(vsmDef.filter, 'VSM', 'the VSM filter must be selected');
  assert.equal(vsmDef.backend, 'Owned', 'VSM must force the Owned depth backend, which produces the maps');
  assert.equal(vsmDef.owned, true, 'slot 0 must be an owned slot under VSM');
  assert.ok(vsmDef.hasVsmTarget && vsmDef.vsmReady,
    'the moments target must exist AND have been written - an allocated-but-unwritten target reads ' +
    'as zeros, which means fully occluded, and would black the scene out');
  assert.equal(pcf.filter, 'PCF', 'PCF must stay PCF');
  assert.equal(pcf.hasVsmTarget, false, 'PCF must not allocate a moments target it never reads');

  /* ---- 2. No extra texture unit. This is the constraint the whole extension lives under ---- */
  console.log(`  samplers: pcf ${pcf.samplers}, vsm ${vsmDef.samplers}`);
  assert.equal(vsmDef.samplers, pcf.samplers,
    `VSM must cost the same number of texture units as PCF (pcf ${pcf.samplers}, vsm ${vsmDef.samplers}). ` +
    'It binds moments to the same uAlLocalMap sampler; a higher count means an extra sampler leaked ' +
    'into the program, and on 16-unit hardware that is a black screen.');

  /* ---- 3. The moments map must hold a real distribution over LINEAR depth ---- */
  console.log(`  moments map: ${JSON.stringify(vsmDef.moments)}`);
  assert.ok(vsmDef.moments, 'the moments map must be readable');
  // Taken over projected depth this range measured 234..255: a perspective buffer puts every
  // surface a spot light can reach into the top 8% of [0,1], the variance collapses below what
  // 16 bits can hold, and Chebyshev degenerates to a hard step. Linearising is what fixes it, and
  // a narrow range here is the signature of that having been undone.
  assert.ok(vsmDef.moments.maxMean - vsmDef.moments.minMean > 100,
    `the moments span only ${vsmDef.moments.minMean}..${vsmDef.moments.maxMean} of 255. Depth is not ` +
    'being linearised before the moments are taken, so the variance is too small to soften anything.');
  assert.ok(vsmDef.moments.nonZeroDev > 100,
    `only ${vsmDef.moments.nonZeroDev} texels have a non-zero standard deviation. The blur did not run: ` +
    'with no variance anywhere, Chebyshev degenerates to a hard step and VSM is a slower PCF.');
  // Variance belongs at depth discontinuities and nowhere else. A map where most texels carry
  // spread is a map that blurred something other than an edge.
  assert.ok(vsmDef.moments.nonZeroDev < vsmDef.moments.total * 0.2,
    `${vsmDef.moments.nonZeroDev} of ${vsmDef.moments.total} texels carry variance; it should be ` +
    'confined to silhouette edges');

  /* ---- 4. Same shadow, comparable area ---- */
  const f = (r) => shadowFactors(r.pixels, control.pixels);
  const fPcf = f(pcf), fDef = f(vsmDef), fRaw = f(vsmRaw), fWide = f(vsmWide), fCrush = f(vsmCrush);
  assert.equal(fPcf.length, fDef.length, 'the same pixels must be compared');

  const shadowed = (x) => x.filter((v) => v < 0.75).length;
  console.log(`  shadowed px of ${fPcf.length} lit: pcf ${shadowed(fPcf)}, vsm default ${shadowed(fDef)}, ` +
    `raw ${shadowed(fRaw)}, wide ${shadowed(fWide)}`);
  assert.ok(shadowed(fPcf) > 200, `the PCF baseline must cast a shadow (got ${shadowed(fPcf)})`);
  assert.ok(shadowed(fDef) > 200, `VSM must cast a shadow (got ${shadowed(fDef)})`);
  const areaRatio = shadowed(fDef) / shadowed(fPcf);
  console.log(`  shadow area, vsm default / pcf: ${areaRatio.toFixed(2)}`);
  // Chebyshev returns an UPPER bound on the lit fraction, so VSM always errs bright and the shadow
  // erodes as the blur widens. Some erosion is the technique; half the shadow vanishing is a bug.
  assert.ok(areaRatio > 0.6 && areaRatio < 1.6,
    `VSM must shadow a comparable area to PCF at the shipped defaults (ratio ${areaRatio.toFixed(2)})`);

  /* ---- 5. THE POINT: genuinely softer, and both controls do what they claim ---- */
  const pen = (x) => band(x, 0.1, 0.9);
  console.log(`  penumbra px: pcf ${pen(fPcf)} | vsm raw ${pen(fRaw)}, wide ${pen(fWide)}, ` +
    `default ${pen(fDef)}, crushed ${pen(fCrush)}`);
  assert.ok(pen(fRaw) > pen(fPcf),
    `with nothing traded away, VSM must produce a softer edge than a 3x3 PCF kernel ` +
    `(${pen(fRaw)} px vs ${pen(fPcf)} px). If it does not, the moments are being read as a hard ` +
    'depth comparison and the technique is doing nothing at all.');
  assert.ok(pen(fWide) > pen(fRaw),
    `a wider blur must widen the penumbra (radius 8 gave ${pen(fWide)} px, radius 4 gave ${pen(fRaw)} px). ` +
    'If softness does not track the radius, the blur uniform is not reaching the pass.');
  assert.ok(pen(fCrush) < pen(fDef),
    `light-bleed reduction must harden the edge (0.6 gave ${pen(fCrush)} px, 0.15 gave ${pen(fDef)} px). ` +
    'If it does not, uAlVsmBleed is not reaching the shader.');
  // HONEST LIMIT, asserted so it stays true rather than being rediscovered later: at the shipped
  // default the bleed reduction has already spent most of VSM's softness advantage over PCF. VSM
  // is chosen here for ONE tap instead of nine, and for softness that costs nothing to widen -
  // not because it looks softer out of the box. Raise VSM softness, or lower light bleed
  // reduction, to actually see the difference.
  assert.ok(pen(fDef) < pen(fRaw),
    'the shipped default must sit between the extremes, not at one of them');

  /* ---- 6. No NaN. sqrt of a negative variance blacks a texel out permanently ---- */
  // A flat floor is where E[d^2] - E[d]^2 cancels to a few ULP below zero. Those pixels come back
  // as hard black inside an area PCF leaves fully lit, so that is precisely what is counted.
  let nanLike = 0;
  for (let i = 0; i < fDef.length; i++) if (fPcf[i] > 0.9 && fDef[i] < 0.05) nanLike++;
  console.log(`  black under VSM but fully lit under PCF: ${nanLike} px`);
  assert.ok(nanLike < fPcf.length * 0.01,
    `${nanLike} pixels are black under VSM but fully lit under PCF. That is the NaN signature from ` +
    'sqrt(negative variance) over a flat surface, not a shadow.');

  /* ---- 7. Lit areas must stay as bright. VSM must not dim the scene ---- */
  const meanOf = (x) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
  const litVsm = fDef.filter((v, i) => fPcf[i] > 0.9);
  console.log(`  mean factor where PCF is fully lit: vsm ${meanOf(litVsm).toFixed(3)}`);
  assert.ok(meanOf(litVsm) > 0.9,
    `VSM dims the unshadowed floor to ${meanOf(litVsm).toFixed(3)} of its unshadowed value. The ` +
    'light-bleed rescale is eating fully lit pixels, which darkens the whole scene rather than ' +
    'shadowing part of it.');

  console.log('');
  console.log('VSM checks passed: same texture-unit cost as PCF, moments over linearised depth,');
  console.log('softer than PCF untraded, softness tracks the radius, bleed reduction trades it back.');

  /* ---- 8. PER-LIGHT selection: two lights, two filters, one scene ---- */
  const mixed = await sendRunMixed();
  console.log('');
  console.log('Per-light filter, two spot lights in one scene');
  assert.equal(mixed.glError, 0, `mixed: GL error ${mixed.glError}`);
  assert.equal(mixed.errors.length, 0, `mixed: shader/link errors - ${mixed.errors.join(' | ')}`);
  assert.deepEqual(mixed.viewportAfterStep, [0, 0, W, H], 'mixed: viewport not restored');
  console.log(`  scene filter ${mixed.filter}, backend ${mixed.backend}, mapped ${mixed.mapped}`);
  console.log(`  uAlLocalKind.x per slot: ${JSON.stringify(mixed.kinds)}   (0 = spot PCF, 2 = spot VSM)`);
  console.log(`  slots: ${JSON.stringify(mixed.slots)}`);

  // The scene default must NOT have been rewritten by a light overriding it.
  assert.equal(mixed.filter, 'PCF',
    'a light choosing VSM must not change the scene default other lights inherit');
  // ...but the backend must have been promoted, or the VSM light silently gets no moments.
  assert.equal(mixed.backend, 'Owned',
    'a light asking for VSM must promote the depth backend to Owned by itself. Without this, ' +
    'per-light VSM would require the user to also know to change an unrelated scene setting.');
  assert.equal(mixed.mapped, 2, 'both lights must hold a shadow-map slot');

  // THE CLAIM per-light selection is for: exactly ONE slot carries moments.
  const vsmSlots = mixed.slots.filter((x) => x.hasVsm).length;
  const readySlots = mixed.slots.filter((x) => x.vsmReady).length;
  console.log(`  slots holding a moments target: ${vsmSlots} of ${mixed.mapped} mapped`);
  assert.equal(vsmSlots, 1,
    `${vsmSlots} slots allocated a moments target; exactly one light asked for VSM. A PCF light ` +
    'holding one wastes 1 MB at 512 and 4 MB at 1024, and pays two blur passes it never reads.');
  assert.equal(readySlots, 1, 'exactly one slot should have run the moment passes');

  // And the uniform the SHADER reads must agree. Two live slots, one marked VSM, one PCF.
  assert.ok(mixed.kinds, 'the kind uniform must be readable');
  const vsmKinds = mixed.kinds.filter((k) => k > 1.5).length;
  const pcfKinds = mixed.kinds.filter((k) => k < 0.5).length;
  assert.equal(vsmKinds, 1,
    `${vsmKinds} slots reach the shader flagged as VSM; exactly one should. The slot state and the ` +
    'uniform have diverged, so the shader is sampling moments as packed depth or vice versa.');
  assert.ok(pcfKinds >= 1, 'the PCF light must reach the shader flagged as PCF');

  console.log('  per-light filter verified: one scene, one VSM light, one PCF light, one moments target.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
