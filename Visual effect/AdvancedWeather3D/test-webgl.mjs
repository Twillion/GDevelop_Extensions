import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const root = path.resolve(decodeURIComponent(here), '../..');
const runtimePath = path.join(root, 'Visual effect/AdvancedWeather3D/AdvancedWeather3D.runtime.js');
const threePath = path.join(root, 'tools/gdjs-harness/runtime/pixi-renderers/three.js');

const html = `<!doctype html><canvas id="c" width="384" height="256"></canvas>
<script src="/three.js"></script><script>var gdjs={};</script><script src="/runtime.js"></script>
<script>
window.run = async function () {
  const AW = gdjs.__advancedWeather3D;
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });
  renderer.setSize(384, 256);
  renderer.setClearColor(0x020408, 1);
  renderer.toneMapping = THREE.NoToneMapping;

  const root = new THREE.Scene();
  root.scale.y = -1;
  const camera = new THREE.PerspectiveCamera(55, 384 / 256, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(300, -700, 230);
  camera.lookAt(300, -200, 150);
  camera.updateMatrixWorld(true);

  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(600, 400, 300),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  placeholder.position.set(300, 200, 150);
  root.add(placeholder);

  const object = {
    getX: () => 0, getY: () => 0, getZ: () => 0,
    getWidth: () => 600, getHeight: () => 400, getDepth: () => 300,
    getLayer: () => '', isHidden: () => false,
    get3DRendererObject: () => placeholder
  };
  const scene = {
    getElapsedTime: () => 16.6667,
    getLayer: () => ({ getRenderer: () => ({
      getThreeGroup: () => root,
      getThreeCamera: () => camera
    }) })
  };

  const readPixels = () => {
    const gl = renderer.getContext();
    const pixels = new Uint8Array(384 * 256 * 4);
    gl.readPixels(0, 0, 384, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const changedPixels = (a, b, threshold) => {
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (delta > threshold) changed++;
    }
    return changed;
  };

  placeholder.visible = false;
  renderer.render(root, camera);
  const clear = readPixels();

  const fogBehavior = {};
  const fog = AW.registerWeatherVolume(scene, object, fogBehavior, {
    weatherType: 'Fog', particleDensity: 0, enableClusteredFog: true,
    fogThickness: 0.12, fogHeightFalloff: 1.2, fogQuality: 'Low', windSpeed: 0
  });
  AW.stepWeatherVolume(scene, object, fogBehavior);
  renderer.render(root, camera);
  const fogPixels = readPixels();

  AW.updateWeatherVolume(scene, object, fogBehavior, { fogQuality: 'Ultra' });
  AW.stepWeatherVolume(scene, object, fogBehavior);

  const rainBehavior = {};
  const rain = AW.registerWeatherVolume(scene, object, rainBehavior, {
    weatherType: 'Rain', particleDensity: 600, particleSpeed: 0,
    particleSize: 2.5, streakThickness: 2.5, streakLength: 28,
    windSpeed: 0, windTurbulence: 0, swayAmount: 0,
    particleColor: '210;230;255', particleOpacity: 0.9
  });
  renderer.render(root, camera);
  const startupRainPixels = readPixels();

  AW.stepWeatherVolume(scene, object, rainBehavior);
  renderer.render(root, camera);
  const weatherPixels = readPixels();

  const gl = renderer.getContext();
  return {
    revision: THREE.REVISION,
    fogChangedPixels: changedPixels(clear, fogPixels, 4),
    rainChangedPixels: changedPixels(fogPixels, weatherPixels, 8),
    fogStepCount: fog.fogMaterial.uniforms.u_StepCount.value,
    fogMinY: fog.fogMaterial.uniforms.u_BoxMin.value.y,
    fogMaxY: fog.fogMaterial.uniforms.u_BoxMax.value.y,
    startupRainChangedPixels: changedPixels(fogPixels, startupRainPixels, 8),
    startupToSteppedChangedPixels: changedPixels(startupRainPixels, weatherPixels, 8),
    rainInstances: rain.mesh.count,
    programs: renderer.info.programs.length,
    glError: gl.getError()
  };
};
</script>`;

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/' ? 'text/html' : 'text/javascript');
  if (request.url === '/') response.end(html);
  else if (request.url === '/three.js') response.end(fs.readFileSync(threePath));
  else if (request.url === '/runtime.js') response.end(fs.readFileSync(runtimePath, 'utf8'));
  else { response.statusCode = 204; response.end(); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'advanced-weather-webgl-'));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });

let websocket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!port) throw new Error('Chrome debugging endpoint unavailable');

  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  websocket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => { websocket.onopen = resolve; });

  let id = 0;
  const pending = new Map();
  const browserErrors = [];
  websocket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(message.error);
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      browserErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    websocket.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', { expression: 'typeof window.run' });
    if (ready.result.value === 'function') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = await send('Runtime.evaluate', {
    expression: 'window.run()', awaitPromise: true, returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const data = result.result.value;
  console.log(JSON.stringify({ ...data, browserErrors }, null, 2));

  assert.deepEqual(browserErrors, []);
  assert.equal(data.glError, 0);
  assert.ok(data.programs >= 2, 'Particle and fog shaders compiled');
  assert.ok(data.fogChangedPixels > 500, 'Volumetric fog visibly changes the frame');
  assert.ok(data.startupRainChangedPixels > 20, 'Rain is fully visible before its first simulation step');
  assert.ok(data.startupToSteppedChangedPixels < 20, 'First simulation step does not replace a small startup effect');
  assert.ok(data.rainChangedPixels > 20, 'Instanced rain visibly changes the fog frame');
  assert.equal(data.fogStepCount, 64);
  assert.equal(data.fogMinY, -400);
  assert.equal(data.fogMaxY, 0);
  assert.equal(data.rainInstances, 600);
} finally {
  if (websocket) websocket.close();
  chrome.kill();
  server.close();
}
