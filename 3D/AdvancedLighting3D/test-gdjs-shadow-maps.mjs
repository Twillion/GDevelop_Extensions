/**
 * test-gdjs-shadow-maps.mjs — shadow maps inside the REAL GDevelop runtime.
 *
 * Every other WebGL test here builds its scene from raw THREE.Mesh objects. That is not what a
 * GDevelop game renders. A Cube3DObject carries an ARRAY OF SIX materials (one per face), gets its
 * material from the engine's image manager with `forceBasicMaterial` decided by the object's
 * Material type, is parented to a layer renderer whose Three scene is mirrored on Y, and only
 * learns its real instance size after the first step.
 *
 * So this boots an actual `gdjs.RuntimeGame` from the harness's copy of the GDJS runtime, with real
 * `Scene3D::Cube3DObject` instances shaped like the reported project:
 *
 *   Ground      4909 x 5313, Material type "React to lights"  (StandardWithoutMetalness)
 *   GrassBlock  50 x 50 x 40, React to lights, casts shadows  — the caster
 *   New3DBox    100 cube,     Material type "No lighting effect" (Basic) — holds the light
 *
 * then drives AdvancedLighting3D exactly as the compiled behaviors would, sets shadow mode to
 * Maps, and measures whether a shadow appears.
 *
 * NOTE ON LOAD ORDER: ShaderChain must be served BEFORE AdvancedLighting3D. The band-100 injector
 * registers at module load, and the shipped extension JSON concatenates them in that order. The
 * shared gdjs-harness/index.html currently loads them the other way round, which silently leaves
 * the injector unregistered — worth fixing there too.
 *
 * Run: node AdvancedLighting3D/test-gdjs-shadow-maps.mjs
 * Needs Chrome (or CHROME_PATH) and the harness runtime (gdjs-harness/setup.mjs).
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const repo = path.resolve(decodeURIComponent(here), '../..');
const harness = path.join(repo, 'tools', 'gdjs-harness');
const runtimeDir = path.join(harness, 'runtime');

if (!fs.existsSync(path.join(runtimeDir, 'FILES.json'))) {
  console.error('Harness runtime missing. Run: node "tools/gdjs-harness/setup.mjs"');
  process.exit(2);
}
const RUNTIME_FILES = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'FILES.json'), 'utf8'));

const cube = (w, h, d, matType, tint) => ({
  width: w, height: h, depth: d,
  enableTextureOnFaceFront: false, enableTextureOnFaceBack: false,
  enableTextureOnFaceLeft: false, enableTextureOnFaceRight: false,
  enableTextureOnFaceTop: false, enableTextureOnFaceBottom: false,
  faceUpTexture: '', faceDownTexture: '', faceLeftTexture: '',
  faceRightTexture: '', faceFrontTexture: '', faceBackTexture: '',
  backFaceUpThroughWhichAxisRotation: 'X', facesOrientation: 'Y',
  // Face VISIBILITY is separate from face textures, and it is not optional: Cube3D hands an
  // invisible face a transparent MeshBasicMaterial placeholder instead of a real one. Leave these
  // out and every face of every cube is an unlit stub, so nothing renders and nothing is injected.
  frontFaceVisible: true, backFaceVisible: true, leftFaceVisible: true,
  rightFaceVisible: true, topFaceVisible: true, bottomFaceVisible: true,
  materialType: matType, tint: tint || '255;255;255',
  isCastingShadow: true, isReceivingShadow: true,
});

const projectData = {
  firstLayout: 'Scene',
  gdVersion: { build: 0, major: 5, minor: 0, revision: 0 },
  properties: {
    adaptGameResolutionAtRuntime: false, folderProject: false, orientation: 'landscape',
    packageName: 'com.harness.shadowmaps', projectFile: '', scaleMode: 'linear',
    pixelsRounding: false, antialiasingMode: 'none', antialisingEnabledOnMobile: false,
    sizeOnStartupMode: '', version: '1.0.0', name: 'Shadow map check', author: '',
    authorIds: [], authorUsernames: [], windowWidth: 640, windowHeight: 400,
    latestCompilationDirectory: '', maxFPS: 60, minFPS: 10, verticalSync: false,
    loadingScreen: { showGDevelopSplash: false, gdevelopLogoStyle: 'light',
      backgroundImageResourceName: '', backgroundColor: 0, backgroundFadeInDuration: 0,
      minDuration: 0, logoAndProgressFadeInDuration: 0, logoAndProgressLogoFadeInDelay: 0,
      showProgressBar: false, progressBarMinWidth: 0, progressBarMaxWidth: 0,
      progressBarWidthPercent: 0, progressBarHeight: 0, progressBarColor: 16777215 },
    watermark: { showWatermark: false, placement: 'bottom-left' },
    useDeprecatedZeroAsDefaultZOrder: false, projectUuid: 'harness', extensionProperties: [],
  },
  resources: { resources: [] },
  usedResources: [],
  objects: [],
  variables: [],
  layouts: [{
    name: 'Scene', mangledName: 'Scene', r: 0, v: 0, b: 0,
    stopSoundsOnStartup: true, title: '', variables: [], instances: [],
    usedResources: [],
    objectsGroups: [], events: [], behaviorsSharedData: [],
    layers: [{
      name: '',
      // Without renderingType '3d' the layer renderer builds no Three scene or camera at all,
      // and getThreeCamera() comes back null.
      renderingType: '3d',
      cameraType: 'perspective',
      visibility: true,
      cameras: [{ defaultSize: true, defaultViewport: true, height: 0,
        viewportBottom: 1, viewportLeft: 0, viewportRight: 1, viewportTop: 0, width: 0 }],
      effects: [],
      // Low ambient so the clustered light, and the hole its shadow leaves, are what we measure.
      ambientLightColorR: 24, ambientLightColorG: 24, ambientLightColorB: 24,
      camera3DFieldOfView: 45,
      camera3DFarPlaneDistance: 300000,
      camera3DNearPlaneDistance: 3,
      isLightingLayer: false, followBaseLayerCamera: false,
    }],
    objects: [
      { name: 'Ground', type: 'Scene3D::Cube3DObject', variables: [], behaviors: [], effects: [],
        content: cube(1000, 1000, 40, 'StandardWithoutMetalness', '200;200;200') },
      { name: 'GrassBlock', type: 'Scene3D::Cube3DObject', variables: [], behaviors: [], effects: [],
        content: cube(60, 60, 150, 'StandardWithoutMetalness', '255;255;255') },
      { name: 'New3DBox', type: 'Scene3D::Cube3DObject', variables: [], behaviors: [], effects: [],
        content: cube(100, 100, 100, 'Basic', '255;255;255') },
    ],
  }],
  externalLayouts: [], eventsFunctionsExtensions: [], externalSourceFiles: [],
};
// Instances mirror the reported project's placement, keeping the same light-to-caster geometry.
projectData.layouts[0].instances = [
  { name: 'Ground', x: 1300, y: 200, z: -62, angle: 0, rotationX: 0, rotationY: 0,
    zOrder: 0, layer: '', customSize: true, width: 1200, height: 1200, depth: 40,
    numberProperties: [], stringProperties: [], initialVariables: [] },
  { name: 'GrassBlock', x: 1766, y: 710, z: -22, angle: 0, rotationX: 0, rotationY: 0,
    zOrder: 1, layer: '', customSize: true, width: 60, height: 60, depth: 150,
    numberProperties: [], stringProperties: [], initialVariables: [] },
  { name: 'New3DBox', x: 1500, y: 450, z: 180, angle: 0, rotationX: 180, rotationY: 0,
    zOrder: 2, layer: '', customSize: true, width: 100, height: 100, depth: 100,
    numberProperties: [], stringProperties: [], initialVariables: [] },
];

const page = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0"><div id="host"></div>
<script>window.__projectData = ${JSON.stringify(projectData)};</script>
<script>var gdjs = gdjs || {};</script>
${RUNTIME_FILES.map((f) => `<script src="/runtime/${f}"></script>`).join('\n')}
<script src="/ext/3D/MaterialMaster/ShaderChain.runtime.js"></script>
<script src="/ext/3D/AdvancedLighting3D/AdvancedLighting3D.runtime.js"></script>
<script>
gdjs.projectData = window.__projectData;
window.__result = null;
window.boot = function () {
  // Fail fast rather than hang: if loadAllAssets never calls back, or a runtime file is missing,
  // a silent stall is far worse to debug than a named error.
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (v) { if (!done) { done = true; resolve(v); } };
    setTimeout(function () { finish({ fatal: 'boot timed out after 25s', stage: window.__stage }); }, 25000);
    try {
      window.__stage = 'new RuntimeGame';
      var game = new gdjs.RuntimeGame(gdjs.projectData, {});
      window.__stage = 'createStandardCanvas';
      game.getRenderer().createStandardCanvas(document.getElementById('host'));
      window.__stage = 'loadAllAssets';
      game.loadAllAssets(function () {
        try {
          window.__stage = 'startGameLoop';
          game.startGameLoop();
          setTimeout(function () {
            try { window.__stage = 'runChecks'; finish(runChecks(game)); }
            catch (e) { finish({ fatal: e.message, stack: String(e.stack).slice(0, 900), stage: window.__stage }); }
          }, 300);
        } catch (e) { finish({ fatal: e.message, stack: String(e.stack).slice(0, 900), stage: window.__stage }); }
      });
    } catch (e) { finish({ fatal: e.message, stack: String(e.stack).slice(0, 900), stage: window.__stage }); }
  });
};

function runChecks(game) {
  var out = { steps: [] };
  var scene = game.getSceneStack().getCurrentScene();
  if (!scene) return { fatal: 'no current scene' };
  var AL = gdjs.__advancedLighting3D;
  out.chainPresent = !!gdjs.__m3dShaderChain;
  out.injectorRegistered = !!(gdjs.__m3dShaderChain &&
    gdjs.__m3dShaderChain.registeredIds().indexOf('advlight3d') >= 0);

  var layer = scene.getLayer('');
  var lr = layer.getRenderer();
  var three = lr.getThreeScene();
  var renderer = game.getRenderer().getThreeRenderer();
  var camera = lr.getThreeCamera();
  out.mirroredY = three ? three.scale.y : null;

  // Real engine objects, with real instance sizes.
  var ground = scene.getObjects('Ground')[0];
  var block = scene.getObjects('GrassBlock')[0];
  var lightObj = scene.getObjects('New3DBox')[0];
  out.groundSize = [ground.getWidth(), ground.getHeight(), ground.getDepth()];
  out.blockSize = [block.getWidth(), block.getHeight(), block.getDepth()];
  out.blockPos = [block.getX(), block.getY(), block.getZ()];
  out.lightPos = [lightObj.getX(), lightObj.getY(), lightObj.getZ()];

  // A Cube3D is SIX materials, not one. This is the shape no synthetic test exercised.
  var groundMesh = ground.getRenderer().get3DRendererObject();
  out.groundMaterialCount = Array.isArray(groundMesh.material) ? groundMesh.material.length : 1;
  out.groundMaterialType = (Array.isArray(groundMesh.material) ? groundMesh.material[0] : groundMesh.material).type;
  var lightMesh = lightObj.getRenderer().get3DRendererObject();
  out.lightHolderMaterialType = (Array.isArray(lightMesh.material) ? lightMesh.material[0] : lightMesh.material).type;

  // Point the camera at the block from a low angle. Camera lives in world space; the scene root
  // is mirrored on Y, so a GDevelop y of 710 renders at world y = -710.
  camera.position.set(2350, -1150, 330);
  camera.up.set(0, 0, 1);
  camera.lookAt(1880, -820, 10);
  camera.updateMatrixWorld(true);

  AL.registerSceneManager(scene, { maxLights: 64 });
  var lightBeh = {};
  var LIGHT = { lightType: 'Spot', intensity: 55, radius: 12, colorMode: 'RGB',
    lightColor: '255;255;255', spotInnerAngle: 50, spotOuterAngle: 75, flickerMode: 'None',
    shadowTechnique: 'ShadowMap', shadowMapSize: 1024 };
  AL.registerLight(scene, lightObj, lightBeh, Object.assign({}, LIGHT, { castShadow: false }));
  AL.setShadowMode(scene, 'Maps');

  var W = renderer.domElement.width, H = renderer.domElement.height;
  function frames(n) { for (var i = 0; i < n; i++) { AL.doStepPostEvents(scene); renderer.render(three, camera); } }
  function pixels() {
    var gl = renderer.getContext(), p = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p;
  }
  var luma = function (p, i) { return p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; };

  frames(8);
  var base = pixels();
  out.litPixels = (function () { var n = 0; for (var i = 0; i < base.length; i += 4) if (luma(base, i) > 12) n++; return n; })();

  // STAGE A: does merely adding a zero-intensity native SpotLight black the scene out?
  // Adding one changes Three's NUM_SPOT_LIGHTS, which recompiles every material program. If the
  // clustered uniforms do not survive that, the scene goes dark with no shadow involved at all.
  var probe = new THREE.SpotLight(0xffffff, 0);
  probe.castShadow = false;
  probe.position.set(0, 0, 500);
  three.add(probe); three.add(probe.target);
  frames(6);
  var probeBuf = pixels();
  var litProbe = 0;
  for (var pq = 0; pq < probeBuf.length; pq += 4) if (luma(probeBuf, pq) > 12) litProbe++;
  out.litWithBareNativeSpot = litProbe;

  // STAGE B: same, but the native light now casts. This is what our slot actually creates.
  probe.castShadow = true;
  frames(6);
  var castBuf = pixels();
  var litCast = 0;
  for (var cq = 0; cq < castBuf.length; cq += 4) if (luma(castBuf, cq) > 12) litCast++;
  out.litWithCastingNativeSpot = litCast;
  three.remove(probe); three.remove(probe.target);
  frames(4);

  // Isolate the two things that change when castShadow flips on: a native SpotLight appears in the
  // scene, and our sampler starts running. Measure them separately.
  AL.updateLight(scene, lightObj, lightBeh,
    Object.assign({}, LIGHT, { castShadow: true, shadowTechnique: 'None' }));
  frames(8);
  var noneBuf = pixels();
  var litNone = 0;
  for (var q = 0; q < noneBuf.length; q += 4) if (luma(noneBuf, q) > 12) litNone++;
  out.litWithTechniqueNone = litNone;
  out.slotsWithTechniqueNone = AL.getShadowMappedLightCount(scene);

  AL.updateLight(scene, lightObj, lightBeh, Object.assign({}, LIGHT, { castShadow: true }));
  frames(8);
  var shadowed = pixels();
  var litAfter = 0;
  for (var q2 = 0; q2 < shadowed.length; q2 += 4) if (luma(shadowed, q2) > 12) litAfter++;
  out.litWithShadowMap = litAfter;
  var darker = 0;
  for (var i = 0; i < base.length; i += 4) {
    var a = luma(base, i), b = luma(shadowed, i);
    if (a > 12 && a - b > 10) darker++;
  }
  out.darkened = darker;
  out.mapped = AL.getShadowMappedLightCount(scene);

  // Slot-level truth: did the map render, and what is the shader actually being told?
  var ls = AL.__internals.localShadowStateOf(scene);
  var s0 = ls.slots[0];
  out.slot = s0 ? {
    live: !!s0.live, everRendered: !!s0.everRendered, requested: !!s0.requested,
    isPoint: !!s0.isPoint,
    needsUpdate: s0.light ? s0.light.shadow.needsUpdate : null,
    hasMap: !!(s0.light && s0.light.shadow.map),
    mapSize: (s0.light && s0.light.shadow.map) ? [s0.light.shadow.map.width, s0.light.shadow.map.height] : null
  } : null;
  // Read the depth target directly: all-zero means nothing was ever drawn into it.
  if (s0 && s0.light && s0.light.shadow.map) {
    try {
      var M = s0.light.shadow.map, mb = new Uint8Array(M.width * M.height * 4);
      renderer.readRenderTargetPixels(M, 0, 0, M.width, M.height, mb);
      var zero = 0, white = 0, other = 0;
      for (var mi = 0; mi < mb.length; mi += 4) {
        if (mb[mi] === 0 && mb[mi+1] === 0 && mb[mi+2] === 0) zero++;
        else if (mb[mi] === 255 && mb[mi+1] === 255 && mb[mi+2] === 255) white++;
        else other++;
      }
      out.shadowMapContent = { zero: zero, white: white, other: other };
    } catch (e) { out.shadowMapContent = 'read failed: ' + e.message; }
  }
  out.rendererShadowEnabled = renderer.shadowMap.enabled;

  // Replicate the shader's lookup in JS for known world points. The ground sits at world
  // (x, -y, top-of-ground); the block is at GDevelop (1766,710) so world (1766,-710).
  if (s0 && s0.light) {
    var mtx = s0.light.shadow.matrix;
    var probePts = [
      ['ground under block', 1791, -735, -22],
      ['ground far side',    2100, -735, -22],
      ['block top',          1791, -735,  85],
      ['light position',     s0.light.getWorldPosition(new THREE.Vector3()).x,
                             s0.light.getWorldPosition(new THREE.Vector3()).y,
                             s0.light.getWorldPosition(new THREE.Vector3()).z]
    ];
    out.shadowCoords = probePts.map(function (pt) {
      var v = new THREE.Vector4(pt[1], pt[2], pt[3], 1).applyMatrix4(mtx);
      var inv = v.w !== 0 ? 1 / v.w : 0;
      return { at: pt[0], world: [pt[1], pt[2], pt[3]],
               uv: [+(v.x * inv).toFixed(4), +(v.y * inv).toFixed(4)],
               z: +(v.z * inv).toFixed(5), w: +v.w.toFixed(2) };
    });
    out.shadowCam = {
      near: s0.light.shadow.camera.near, far: s0.light.shadow.camera.far,
      fov: +s0.light.shadow.camera.fov.toFixed(1),
      worldPos: s0.light.getWorldPosition(new THREE.Vector3()).toArray().map(function (n) { return +n.toFixed(1); }),
      localPos: s0.light.position.toArray().map(function (n) { return +n.toFixed(1); }),
      targetWorld: s0.light.target.getWorldPosition(new THREE.Vector3()).toArray().map(function (n) { return +n.toFixed(1); })
    };
  }

  // What the injection actually did to a real Cube3D face material.
  var inj = null;
  three.traverse(function (o) {
    if (inj || !o.isMesh || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var m = 0; m < mats.length; m++) {
      if (mats[m].__alInjection) {
        inj = { type: mats[m].type, key: mats[m].__alInjection.key,
                localMaps: !!mats[m].__alInjection.localMaps,
                define: !!(mats[m].defines && mats[m].defines.AL_LOCAL_SHADOW_MAPS),
                paramsW: mats[m].__alUniforms && mats[m].__alUniforms.uAlLocalParams
                  ? mats[m].__alUniforms.uAlLocalParams.value[0].w : null };
        break;
      }
    }
  });
  out.injected = inj;
  var enc = function (buf) {
    var raw = '', CH = 8192;
    for (var q = 0; q < buf.length; q += CH) {
      raw += String.fromCharCode.apply(null, buf.subarray(q, Math.min(q + CH, buf.length)));
    }
    return btoa(raw);
  };
  out.rgbaOff = enc(base);        // castShadow off
  out.rgbaOn = enc(shadowed);     // castShadow on - the difference IS the shadow
  out.w = W; out.h = H;
  out.glError = renderer.getContext().getError();
  return out;
}
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const send = (file, type) => {
    try { res.setHeader('Content-Type', type); res.end(fs.readFileSync(file)); }
    catch { res.statusCode = 404; res.end(''); }
  };
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  if (url.startsWith('/runtime/')) return send(path.join(runtimeDir, url.slice('/runtime/'.length)), 'text/javascript');
  if (url.startsWith('/ext/')) return send(path.join(repo, url.slice('/ext/'.length)), 'text/javascript');
  res.statusCode = 204; res.end();
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-gdjs-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ -1; };

let ws, failed = 0;
try {
  let dport;
  for (let i = 0; i < 150; i++) {
    try { dport = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!dport) throw Error('Chrome debugging endpoint unavailable');
  const tabs = await (await fetch('http://127.0.0.1:' + dport + '/json')).json();
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(m.error); else p.resolve(m.result); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const t = m.params.args.map((a) => a.value || a.description).join(' ');
      if (!/wasm|WebAssembly|ArrayBuffer instantiation/i.test(t)) errors.push(t);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception || {}));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 150; i++) { const r = await send('Runtime.evaluate', { expression: 'typeof window.boot' }); if (r.result.value === 'function') break; await new Promise((r) => setTimeout(r, 100)); }
  const out = await send('Runtime.evaluate', { expression: 'window.boot()', awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw Error(JSON.stringify(out.exceptionDetails));
  const d = out.result.value;
  if (d.fatal) {
    console.error('FATAL at stage "' + d.stage + '": ' + d.fatal);
    if (d.stack) console.error(d.stack);
    console.error('console errors:', JSON.stringify(errors.slice(0, 3), null, 1));
    process.exitCode = 1;
  }
  const rgbaOff = d.rgbaOff, rgbaOn = d.rgbaOn, RW = d.w, RH = d.h;
  delete d.rgbaOff; delete d.rgbaOn;
  if (rgbaOn) {
    const b = Buffer.from(rgbaOn, 'base64');
    let mx = 0, sum = 0, nonZero = 0;
    for (let i = 0; i < b.length; i += 4) {
      const L = b[i] * 0.299 + b[i+1] * 0.587 + b[i+2] * 0.114;
      if (L > mx) mx = L; sum += L; if (L > 4) nonZero++;
    }
    console.log('buffer check: bytes=' + b.length + ' expected=' + (RW*RH*4) +
      ' maxLuma=' + mx.toFixed(1) + ' meanLuma=' + (sum/(b.length/4)).toFixed(2) +
      ' pixels>4=' + nonZero);
  }
  console.log(JSON.stringify({ ...d, errors: errors.slice(0, 4) }, null, 2));
  if (rgbaOn) {
    // Compose the two frames side by side: shadows OFF on the left, ON on the right, with a
    // divider. A single frame proves nothing on its own — the shadow is the DIFFERENCE.
    const off = Buffer.from(rgbaOff, 'base64');
    const on = Buffer.from(rgbaOn, 'base64');
    const GAP = 8;
    const OW = RW * 2 + GAP, OH = RH;
    const stride = OW * 4;
    const rows = Buffer.alloc((stride + 1) * OH);
    for (let y = 0; y < OH; y++) {
      const base = (stride + 1) * y;
      rows[base] = 0;                                   // filter type 0
      const srcRow = (RH - 1 - y) * RW * 4;             // readPixels is bottom-up
      off.copy(rows, base + 1, srcRow, srcRow + RW * 4);
      for (let g = 0; g < GAP; g++) {
        const o = base + 1 + (RW + g) * 4;
        rows[o] = 90; rows[o + 1] = 90; rows[o + 2] = 110; rows[o + 3] = 255;
      }
      on.copy(rows, base + 1 + (RW + GAP) * 4, srcRow, srcRow + RW * 4);
    }
    const zlib = await import('node:zlib');
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OH, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(path.join(repo, '3D/AdvancedLighting3D/gdjs-shadow-maps.png'), png);
  }

  const check = (label, cond, detail) => {
    if (cond) console.log('  ok   ' + label);
    else { failed++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
  };
  console.log('');
  check('ShaderChain present', d.chainPresent === true);
  check('the band-100 injector registered', d.injectorRegistered === true);
  check('the scene root is Y-mirrored', d.mirroredY === -1, `scale.y=${d.mirroredY}`);
  check('a Cube3D really carries six face materials', d.groundMaterialCount === 6, `count=${d.groundMaterialCount}`);
  check('"React to lights" gives a lit material', d.groundMaterialType === 'MeshStandardMaterial', d.groundMaterialType);
  check('"No lighting effect" gives an unlit material', d.lightHolderMaterialType === 'MeshBasicMaterial', d.lightHolderMaterialType);
  check('a real Cube3D face material got injected', !!d.injected, JSON.stringify(d.injected));
  check('  with local maps enabled in its key', !!(d.injected && d.injected.localMaps && d.injected.define),
    JSON.stringify(d.injected));
  check('the light got a shadow map', d.mapped === 1, `mapped=${d.mapped}`);
  check('the scene is lit', d.litPixels > 2000, `lit=${d.litPixels}`);
  // A shadow darkens PART of the lit area. Darkening all of it is the catastrophic failure - an
  // unrendered map reads as depth 0, which the comparison treats as "occluded everywhere" and
  // blacks the scene out. The first version of this assertion only checked `> 200` and passed
  // happily on a completely black frame.
  const frac = d.litPixels ? d.darkened / d.litPixels : 0;
  check('A SHADOW RENDERS IN THE REAL ENGINE', d.darkened > 200, `darkened=${d.darkened}`);
  check('  and it shadows PART of the lit area, not all of it',
    frac > 0.01 && frac < 0.9, `${(frac * 100).toFixed(1)}% of lit pixels darkened`);
  check('no GL errors', d.glError === 0 && errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  console.log('');
  console.log(failed ? `${failed} FAILED` : 'SHADOW MAPS WORK INSIDE THE REAL GDEVELOP RUNTIME.');
} finally { if (ws) ws.close(); chrome.kill(); server.close(); }
process.exitCode = failed ? 1 : 0;
