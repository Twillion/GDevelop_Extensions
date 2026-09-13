// Phase 0 rendering harness: boots headless Chrome with SwiftShader, builds a named scene, and
// renders single frames along a scripted camera path at a requested resolution.
//
// Frames come back ONE AT A TIME as base64 luminance. The whole sequence at reference resolution is
// tens of megabytes, and the alternative — downsampling in the browser — would put untested code in
// the measurement path. Node owns every metric, using the functions unit-tested in test-metrics.mjs.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const threePath = path.join(repoRoot, 'tools/gdjs-harness/runtime/pixi-renderers/three.js');
const materialMaster = path.join(repoRoot, '3D/MaterialMaster');

export const SCENES = fs.readFileSync(path.join(here, 'scenes.js'), 'utf8');

function buildPage() {
  const chain = fs.readFileSync(path.join(materialMaster, 'ShaderChain.runtime.js'), 'utf8');
  const specAA = fs.readFileSync(path.join(materialMaster, 'SpecularAA3D.runtime.js'), 'utf8');
  return `<canvas id=c></canvas>
<script src="/three.js"></script>
<script>var gdjs = {};</script>
<script>${chain}</script>
<script>${specAA}</script>
<script>${SCENES}</script>`;
}

export async function openHarness() {
  const page = buildPage();
  const server = http.createServer((req, res) => {
    if (req.url === '/three.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(threePath)); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(page); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-bench-'));
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
     '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
     '--no-default-browser-check', '--max-old-space-size=4096', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });

  let port;
  for (let i = 0; i < 200; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!port) { chrome.kill(); server.close(); throw new Error('Chrome debugging endpoint unavailable'); }

  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  let ready = false;
  for (let i = 0; i < 200; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.benchBuild' });
    if (r.result.value === 'function') { ready = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) { ws.close(); chrome.kill(); server.close(); throw new Error('bench page never became ready: ' + errors.join(' | ')); }

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  return {
    errors,
    /** Build a scene at a resolution. Returns diagnostic info including timer-query availability. */
    build: (scene, size, options = {}) =>
      evaluate(`window.benchBuild(${JSON.stringify(scene)}, ${size}, ${JSON.stringify(options)})`),
    /** Render one frame of the scripted path; returns base64 luminance, one byte per pixel. */
    frame: async (index, total) => {
      const b64 = await evaluate(`window.benchFrame(${index}, ${total})`);
      return Buffer.from(b64, 'base64');
    },
    /** Timing samples in ms for the current scene, with the method that produced them. */
    time: (frames) => evaluate(`window.benchTime(${frames})`),
    close: () => { try { ws.close(); } catch (e) {} chrome.kill(); server.close(); },
  };
}
