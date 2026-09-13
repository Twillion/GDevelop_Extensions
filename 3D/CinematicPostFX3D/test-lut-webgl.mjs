// Phase 3 acceptance, per docs/RENDERER-MODERNIZATION-PLAN.md section 3.
//
// TWO tests, because one is not enough:
//
//   1. Identity LUT round-trips to within 1/255. This validates axis order, orientation and texel
//      centres — and nothing else. An identity table round-trips correctly in ANY colour space, so
//      it cannot catch the error that matters most.
//   2. Known-response LUT. A table with a predictable non-identity response, checked against the
//      value the documented pipeline must produce, AND against the value the WRONG pipeline would
//      produce. This is the test that catches a wrong colour space.
//
// Real GL, via headless Chrome with SwiftShader: Node tests never compile GLSL, so a broken shader
// passes every unit test while the surface silently renders nothing.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not pathname: the repo path contains spaces, which arrive percent-encoded.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// The shipped shader source, not a copy.
const runtimeSrc = fs.readFileSync(path.join(here, 'CinematicPostFX3D.runtime.js'), 'utf8');
const lutGlslMatch = runtimeSrc.match(/var LUT_GLSL = \[([\s\S]*?)\]\.join\('\\n'\);/);
assert.ok(lutGlslMatch, 'LUT_GLSL must be extractable from the runtime — the tests compile what ships');
const LUT_GLSL = lutGlslMatch[1]
  .split('\n').map(l => l.trim()).filter(l => l.startsWith("'"))
  .map(l => l.replace(/^'/, '').replace(/',?$/, ''))
  .join('\n');
assert.ok(LUT_GLSL.includes('vec3 sampleLut'), 'extracted GLSL must contain sampleLut');
assert.ok(LUT_GLSL.includes('lutOETF') && LUT_GLSL.includes('lutEOTF'), 'must contain both transfer functions');

const N = 32;                       // 1024x32 strip
const srgbEncode = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const srgbDecode = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/**
 * Build an N-tile LUT strip as raw RGBA bytes.
 * Layout: tile index = blue, within-tile x = red, within-tile y = green (green DOWNWARD).
 * `fn` maps an encoded-domain rgb triple to an encoded-domain rgb triple.
 */
function buildStrip(fn) {
  const w = N * N, h = N;
  const data = new Uint8Array(w * h * 4);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const out = fn(r / (N - 1), g / (N - 1), b / (N - 1));
        const x = b * N + r, y = g;
        const i = (y * w + x) * 4;
        data[i] = Math.round(Math.max(0, Math.min(1, out[0])) * 255);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, out[1])) * 255);
        data[i + 2] = Math.round(Math.max(0, Math.min(1, out[2])) * 255);
        data[i + 3] = 255;
      }
    }
  }
  return data;
}

const identityStrip = buildStrip((r, g, b) => [r, g, b]);
// An affine lift/gain in the ENCODED domain: out = in * 0.6 + 0.2. A realistic grade, monotonic,
// and — unlike a power law — it gives a WIDELY different answer depending on which domain it is
// applied in. A gamma table was the first choice here and was a bad one: encode-pow-decode and a
// plain pow are numerically close, and the two curves actually cross, so some probe always showed
// near-zero separation and the test could not discriminate at all.
const LIFT = 0.2, GAIN = 0.6;
const grade = (v) => v * GAIN + LIFT;
const gradeStrip = buildStrip((r, g, b) => [grade(r), grade(g), grade(b)]);

// Linear, tone-mapped, display-referred inputs — the values that reach the LUT in the real chain.
const PROBES = [0.05, 0.2, 0.5, 0.75, 0.9];

const page = `<canvas id=c width=${PROBES.length} height=1></canvas><script>
const LUT_GLSL = ${JSON.stringify(LUT_GLSL)};
const PROBES = ${JSON.stringify(PROBES)};
const N = ${N};
window.run = function (stripBytes, mode) {
  const gl = document.getElementById('c').getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { error: 'no webgl' };
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return { error: 'vs: ' + gl.getShaderInfoLog(vs) };

  // mode 0 = the documented pipeline: encode, sample, decode.
  // mode 1 = the WRONG pipeline: sample linear values directly, no transfer functions.
  const body = mode === 0
    ? 'vec3 graded = lutEOTF(sampleLut(lutOETF(linearIn)));'
    : 'vec3 graded = sampleLut(linearIn);';
  const fsSrc = [
    'precision highp float;',
    'uniform sampler2D tLut;',
    'uniform float uLutSize;',
    'uniform float uProbes[' + PROBES.length + '];',
    LUT_GLSL,
    'void main() {',
    '  int idx = int(floor(gl_FragCoord.x));',
    '  float v = 0.0;',
    // GLSL ES 1.00 forbids dynamic indexing of a uniform array, so select by loop.
    '  for (int i = 0; i < ' + PROBES.length + '; i++) { if (i == idx) v = uProbes[i]; }',
    '  vec3 linearIn = vec3(v);',
    '  ' + body,
    '  gl_FragColor = vec4(graded, 1.0);',
    '}',
  ].join('\\n');
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return { error: 'fs: ' + gl.getShaderInfoLog(fs) };

  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: 'link: ' + gl.getProgramInfoLog(prog) };
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // LINEAR, matching the shipped configuration exactly. A 32-step table with NEAREST would
  // quantise every input to 32 levels and defeat the interpolation the LUT depends on - and it
  // would also skip right past the slice-bleed hazard this strip layout has to defend against,
  // which is precisely what these probes need to exercise.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N * N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(stripBytes));
  gl.uniform1i(gl.getUniformLocation(prog, 'tLut'), 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'uLutSize'), N);
  gl.uniform1fv(gl.getUniformLocation(prog, 'uProbes'), new Float32Array(PROBES));

  gl.viewport(0, 0, PROBES.length, 1);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(PROBES.length * 4);
  gl.readPixels(0, 0, PROBES.length, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const err = gl.getError();
  return { pixels: Array.from(px), glError: err };
};
</script>`;

const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(page); });
await new Promise(r => server.listen(0, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cfx-lut-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('Chrome debugging endpoint unavailable');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.run' });
    if (r.result.value === 'function') break;
    await new Promise(r => setTimeout(r, 100));
  }
  const runShader = async (strip, mode) => {
    const expr = `window.run(${JSON.stringify(Array.from(strip))}, ${mode})`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    if (r.result.value.error) throw new Error(r.result.value.error);
    return r.result.value;
  };

  /* ---- Test 1: identity LUT must round-trip within 1/255 ---- */
  const identity = await runShader(identityStrip, 0);
  assert.equal(identity.glError, 0, 'identity pass must produce no GL error');
  let worstIdentity = 0;
  PROBES.forEach((linear, i) => {
    const got = identity.pixels[i * 4] / 255;
    worstIdentity = Math.max(worstIdentity, Math.abs(got - linear));
  });
  assert.ok(worstIdentity <= 1 / 255 + 1e-6,
    `identity LUT must round-trip within 1/255, worst error was ${(worstIdentity * 255).toFixed(3)}/255`);

  /* ---- Test 2: known-response LUT. THIS is the colour-space test. ---- */
  const graded = await runShader(gradeStrip, 0);
  assert.equal(graded.glError, 0, 'graded pass must produce no GL error');

  let worstGraded = 0, maxSeparation = 0;
  PROBES.forEach((linear, i) => {
    const got = graded.pixels[i * 4] / 255;
    // The documented pipeline: linear -> OETF -> table -> EOTF -> linear.
    const expected = srgbDecode(grade(srgbEncode(linear)));
    // What a wrong implementation would give: the table applied straight to linear values.
    const wrong = grade(linear);
    worstGraded = Math.max(worstGraded, Math.abs(got - expected));
    // MAX, not min: the two domains agree at whatever value the curves happen to cross, so a
    // minimum across probes measures that crossing rather than the test's discriminating power.
    maxSeparation = Math.max(maxSeparation, Math.abs(expected - wrong));
  });
  // 2/255 absorbs the table's own 8-bit quantisation on top of the readback's.
  assert.ok(worstGraded <= 2 / 255,
    `known-response LUT must match the documented sRGB-domain pipeline within 2/255, worst was ${(worstGraded * 255).toFixed(2)}/255`);
  // If the two pipelines were not clearly separated, the test above would pass under either and
  // prove nothing. Assert the discrimination itself.
  assert.ok(maxSeparation > 8 / 255,
    `the test probes must separate the correct and wrong colour spaces by a wide margin, got ${(maxSeparation * 255).toFixed(1)}/255`);

  /* ---- Test 3: the wrong pipeline must actually FAIL the same check ---- */
  const wrongDomain = await runShader(gradeStrip, 1);
  let worstWrong = 0;
  PROBES.forEach((linear, i) => {
    const got = wrongDomain.pixels[i * 4] / 255;
    const expected = srgbDecode(grade(srgbEncode(linear)));
    worstWrong = Math.max(worstWrong, Math.abs(got - expected));
  });
  assert.ok(worstWrong > 8 / 255,
    'sampling the LUT in the linear domain must visibly diverge from the documented pipeline — ' +
    'if it does not, test 2 cannot be catching a colour-space error');

  console.log('LUT acceptance passed:');
  console.log(`  identity round-trip      worst ${(worstIdentity * 255).toFixed(3)}/255 (limit 1)`);
  console.log(`  known-response match     worst ${(worstGraded * 255).toFixed(2)}/255 (limit 2)`);
  console.log(`  correct vs wrong domain  separated by up to ${(maxSeparation * 255).toFixed(1)}/255`);
  console.log(`  wrong domain rejected    off by ${(worstWrong * 255).toFixed(1)}/255`);
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.close();
}
