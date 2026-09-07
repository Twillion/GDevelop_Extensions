/** Actual Three.js/WebGL regressions. Requires the local gdjs-harness runtime and Chrome. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const threePath = path.resolve(here, '../../gdjs-harness/runtime/pixi-renderers/three.js');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert.ok(fs.existsSync(threePath), 'Run node gdjs-harness/setup.mjs to install the local engine runtime');
assert.ok(fs.existsSync(chromePath), 'Set CHROME_PATH to a Chrome executable');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluid-webgl-'));
const server = http.createServer((req, res) => {
  if (req.url === '/three.js' || req.url === '/runtime.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(fs.readFileSync(req.url === '/three.js' ? threePath : path.join(here, 'FluidAndWater3D.runtime.js')));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><script>window.gdjs={};</script><script src="/three.js"></script><script src="/runtime.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', url,
], { stdio: 'ignore', windowsHide: true });
const closed = new Promise(resolve => chrome.once('exit', resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
  assert.ok(fs.existsSync(portFile), 'Chrome must start its private debugging endpoint');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(p => p.type === 'page' && p.url === url);
  assert.ok(page, 'The isolated test page must exist');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  function cdp(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
      pending.set(id, msg => { clearTimeout(timeout); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  for (let i = 0; i < 100; i++) {
    const ready = await cdp('Runtime.evaluate', { expression: '!!(window.THREE && gdjs.__fluidAndWater3D)' });
    if (ready.result.value) break;
    await delay(100);
  }
  const result = await cdp('Runtime.evaluate', {
    expression: `(${browserChecks.toString()})()`, returnByValue: true,
  });
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || 'Browser evaluation failed');
  assert.deepEqual(result.result.value.failures, [], JSON.stringify(result.result.value, null, 2));
  console.log('REAL WEBGL CHECKS PASSED', JSON.stringify(result.result.value));
} finally {
  if (ws) ws.close();
  chrome.kill();
  await Promise.race([closed, delay(3000)]);
  await new Promise(resolve => server.close(resolve));
  // Only remove the unique profile created by this run inside the OS temporary directory.
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(profile).startsWith('fluid-webgl-'));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function browserChecks() {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const FW = gdjs.__fluidAndWater3D;
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  const gl = renderer.getContext();
  const ext = renderer.extensions.get('EXT_texture_filter_anisotropic');
  check(!!ext, 'Test renderer must support anisotropy');
  const maxA = renderer.capabilities.getMaxAnisotropy();
  check(maxA >= 4, 'Test renderer must expose at least 4x AF');
  const root = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(2500, 8000, 1800);
  camera.lookAt(2500, 2500, 300);
  const scene = {
    getElapsedTime: () => 16,
    getGame: () => ({ getRenderer: () => ({ getThreeRenderer: () => renderer }) }),
    getLayer: () => ({ getRenderer: () => ({ getThreeScene: () => root, getThreeGroup: () => root, getThreeCamera: () => camera }) }),
  };
  const group = new THREE.Group(); root.add(group);
  const object = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 5000, getHeight: () => 5000, getDepth: () => 300,
    getLayer: () => '', getName: () => 'WebGLOcean', get3DRendererObject: () => group,
  };
  const behavior = {};
  const ocean = FW.registerWaveWorksOcean(scene, object, behavior, {
    resolution: 32, gridSubdivisions: 32, persistentFoam: true, textureAnisotropy: 4,
  });
  renderer.render(root, camera);
  function sampler(texture) {
    const old = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, renderer.properties.get(texture).__webglTexture);
    const value = gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT);
    const min = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
    gl.bindTexture(gl.TEXTURE_2D, old);
    return { value, min };
  }
  const initial = [ocean.texture, ocean.cascadeTexture, ocean.slopeTexture, ocean.cascadeSlopeTexture]
    .map(texture => { renderer.initTexture(texture); return sampler(texture); });
  check(initial.every(s => s.value === 4 && s.min === gl.LINEAR_MIPMAP_LINEAR), 'Ocean textures must activate AF in GL, not just in JavaScript');
  check(!!ocean.foamRT && !ocean.foamRT.failed, 'Persistent foam must initialize');
  const foam = ocean.foamRT;
  const fillScene = new THREE.Scene();
  const fillMaterial = new THREE.ShaderMaterial({
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: 'uniform float value; void main(){gl_FragColor=vec4(value,0.0,0.0,1.0);}',
    uniforms: { value: { value: 0.25 } }, depthTest: false, depthWrite: false,
  });
  const fillQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fillMaterial);
  fillScene.add(fillQuad);
  const fillCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const before = [];
  for (let i = 0; i < 2; i++) {
    fillMaterial.uniforms.value.value = 0.25 + i * 0.25;
    renderer.setRenderTarget(foam.targets[i]);
    renderer.render(fillScene, fillCamera);
    const pixels = new Uint8Array(4);
    renderer.readRenderTargetPixels(foam.targets[i], 0, 0, 1, 1, pixels);
    before.push([...pixels]);
  }
  renderer.setRenderTarget(null);
  for (const requested of [8, 1, 4]) {
    FW.setOceanAnisotropy(scene, behavior, requested);
    renderer.render(root, camera);
    for (let i = 0; i < 2; i++) {
      const actual = sampler(foam.targets[i].texture);
      check(actual.value === Math.min(requested, maxA), 'Foam GL sampler must update to ' + requested);
      const pixels = new Uint8Array(4);
      renderer.readRenderTargetPixels(foam.targets[i], 0, 0, 1, 1, pixels);
      check(pixels.every((v, j) => v === before[i][j]), 'Changing AF must preserve both foam histories');
    }
    renderer.initTexture(ocean.slopeTexture);
    check(sampler(ocean.slopeTexture).value === Math.min(requested, maxA), 'Data texture AF must change at runtime');
  }
  FW.updateOceanField(ocean, 1);
  renderer.render(root, camera);
  check(!foam.failed, 'Foam continues updating after filter changes');
  check(gl.getError() === gl.NO_ERROR, 'Rendering, mip generation and filter changes must not produce WebGL errors');
  const programs = renderer.info.programs || [];
  check(programs.every(p => !p.diagnostics || p.diagnostics.runnable !== false), 'All ocean and foam shaders must compile and link');
  fillQuad.geometry.dispose(); fillMaterial.dispose();
  FW.disposeWaveWorksOcean(scene, behavior);
  renderer.dispose();
  return { threeRevision: THREE.REVISION, maxAnisotropy: maxA, initialSamplers: initial, failures };
}
