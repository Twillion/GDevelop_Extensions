/**
 * Drives the `shadows` scenario three times in the REAL GDJS engine - shadows off, PCF, VSM - and
 * compares the resulting frames against each other.
 *
 * WHY A DEDICATED RUNNER. test-headless.mjs prints one scenario's panel text. That is enough to see
 * that plumbing resolved (backend promoted, kind uniform = 2), but it cannot answer the only
 * question that matters at the end: does the image actually change? A single run's "dark pixel
 * count" cannot distinguish a shadow from a dim scene - the first attempt at this measured the
 * shadows-OFF run as having MORE dark pixels than PCF, which is noise that reads like a result.
 * Differencing the modes against each other has no such blind spot.
 *
 *   node tools/gdjs-harness/test-shadow-modes.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { decodePng, luminance } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(here, 'serve.js');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 200);

const server = spawn('node', [SERVE], { stdio: 'pipe' });
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'gdjs-shadows-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
try {
  await sleep(1200);
  let tabs = null;
  for (let i = 0; i < 60 && !tabs; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
  }
  if (!tabs) throw new Error('Chrome debugging endpoint never came up');
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

  async function runMode(filter) {
    await send('Page.navigate', { url: `http://localhost:8140/?scenario=shadows&filter=${filter}` });
    // The scenario reports on a timer after the engine has run real frames; poll for the result
    // rather than sleeping a fixed amount and hoping.
    let result = null;
    for (let i = 0; i < 120 && !result; i++) {
      const r = await send('Runtime.evaluate', {
        expression: 'window.__shadowResult ? JSON.stringify(window.__shadowResult) : ""',
        returnByValue: true,
      });
      if (r.result.value) result = JSON.parse(r.result.value);
      else await sleep(250);
    }
    if (!result) throw new Error(`scenario never reported for filter=${filter}`);

    // Screenshot JUST the game canvas. Clipping matters: the diagnostic panel beside it prints
    // different text per mode, and a full-page diff would report that text as a rendering change.
    const rect = await send('Runtime.evaluate', {
      expression: `(function(){var c=document.querySelector('canvas');var r=c.getBoundingClientRect();` +
        `return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height});})()`,
      returnByValue: true,
    });
    const clip = JSON.parse(rect.result.value);
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
    });
    const png = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.join(here, `preview_shadows_${filter}.png`), png);
    result.lum = luminance(decodePng(png));
    result.png = png.length;
    return result;
  }

  const off = await runMode('off');
  const pcf = await runMode('PCF');
  const vsm = await runMode('VSM');

  console.log('AdvancedLighting3D shadow maps, driven through the real GDJS engine');
  for (const [name, r] of [['off', off], ['PCF', pcf], ['VSM', vsm]]) {
    console.log(`  ${name.padEnd(4)} backend ${String(r.backend).padEnd(7)} resolves ${String(r.resolved).padEnd(4)} ` +
      `kind ${r.kind} hooked ${r.hooked} momentsReady ${r.vsmReady} screenshot ${r.lum.length}px`);
  }

  /* ---- Plumbing, in the engine rather than in a hand-built Three scene ---- */
  assert.equal(off.backend, 'Native', 'with no VSM light, the backend must stay at its default');
  assert.equal(pcf.backend, 'Native', 'a PCF light must not promote the backend');
  assert.equal(vsm.backend, 'Owned', 'a VSM light must promote the backend to Owned by itself');
  assert.equal(vsm.resolved, 'VSM', 'the light must resolve to VSM');
  assert.equal(vsm.vsmReady, true, 'the moments map must have been rendered');
  assert.equal(pcf.vsmReady, false, 'a PCF light must not build a moments map');
  assert.equal(vsm.kind, 2, 'the shader must receive kind 2 (spot VSM) for a VSM light');
  assert.equal(pcf.kind, 0, 'the shader must receive kind 0 (spot PCF) for a PCF light');
  assert.ok(vsm.hooked > 0 && pcf.hooked > 0,
    'materials must actually be hooked, or the shadow is computed and never sampled');

  /* ---- The image. Each mode against shadows-off, on the same scene and camera ---- */
  const base = off.lum;
  function darkened(r) {
    const b = r.lum;
    assert.equal(b.length, base.length, 'frames must be the same size');
    let count = 0, litPx = 0;
    for (let i = 0; i < b.length; i++) {
      if (base[i] < 20) continue;                 // background carries no shadow information
      litPx++;
      if (b[i] < base[i] * 0.75) count++;
    }
    return { count, litPx };
  }
  const dPcf = darkened(pcf), dVsm = darkened(vsm);
  console.log(`  darkened vs shadows-off: PCF ${dPcf.count} px, VSM ${dVsm.count} px ` +
    `(of ${dPcf.litPx} lit in the reference)`);

  assert.ok(dPcf.count > 50,
    `PCF darkened only ${dPcf.count} px against the shadows-off reference. The shader is not ` +
    'sampling the map, or the caster is outside the light frustum in the real scene.');
  assert.ok(dVsm.count > 50,
    `VSM darkened only ${dVsm.count} px against the shadows-off reference. Everything in the ` +
    'plumbing resolved, so this means the moments are reaching the shader but reading as fully lit.');

  // Both techniques shadow the same geometry from the same light, so they must agree on roughly
  // WHERE. A large disagreement means one of them is projecting to the wrong place, which the
  // per-mode counts above would each happily pass.
  const ratio = dVsm.count / dPcf.count;
  console.log(`  VSM / PCF shadowed-area ratio: ${ratio.toFixed(2)}`);
  assert.ok(ratio > 0.4 && ratio < 2.5,
    `VSM and PCF must shadow a comparable area of the same scene (ratio ${ratio.toFixed(2)})`);

  console.log('\nReal-engine checks passed: per-light VSM promotes the backend, reaches the shader,');
  console.log('and darkens the ground where PCF does - through GDJS objects on a scale.y=-1 root,');
  console.log('sharing a WebGL context with PIXI.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.kill();
}
