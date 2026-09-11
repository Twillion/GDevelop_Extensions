/**
 * Static GLSL sanity check for the WeatherFX2D distortion shader.
 *
 * WHY THIS EXISTS
 * ---------------
 * `test-runtime.mjs` mocks PIXI.Filter as an object that stores the shader string, so no GLSL is
 * ever compiled and `build-extension.mjs` only parses JavaScript. A shader that cannot compile
 * therefore passes the entire suite - and a PIXI filter whose program fails to link renders the
 * layer untouched, with no error anywhere the author will look.
 *
 * This does not replace running it on a GPU. It catches the cheap mistakes:
 *   1. a uniform used but never declared,
 *   2. a uniform declared but never supplied by the JS side (and vice versa),
 *   3. unbalanced braces or parens,
 *   4. a function called but never defined and not a GLSL ES builtin,
 *   5. GLSL ES 1.00 loop rules - the bound must be a constant expression,
 *   6. mediump precision, which silently quantises the world coordinates this shader relies on,
 *   7. gl_FragColor never being written.
 *
 * Run: node WeatherFX2D/check-shaders.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, 'WeatherFX2D.runtime.js'), 'utf8');

/* ---------------------------------------------------------------- Extract the shader */

// The shader is built as an array of lines joined with newlines, and the array contains string
// concatenation for the ripple count - so it is evaluated rather than sliced out textually.
const start = runtimeSource.indexOf('var DISTORTION_FRAGMENT_SHADER = [');
if (start === -1) {
  console.error('\nDISTORTION_FRAGMENT_SHADER not found in the runtime.\n');
  process.exit(1);
}
const open = runtimeSource.indexOf('[', start);
let depth = 0;
let end = -1;
for (let i = open; i < runtimeSource.length; i++) {
  if (runtimeSource[i] === '[') depth += 1;
  else if (runtimeSource[i] === ']') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
const arrayLiteral = runtimeSource.slice(open, end);

const maxRipplesMatch = runtimeSource.match(/var MAX_RIPPLES = (\d+);/);
if (!maxRipplesMatch) {
  console.error('\nMAX_RIPPLES not found in the runtime.\n');
  process.exit(1);
}
const MAX_RIPPLES = Number(maxRipplesMatch[1]);

// eslint-disable-next-line no-new-func
const shader = new Function('MAX_RIPPLES', `return (${arrayLiteral}).join('\\n');`)(MAX_RIPPLES);

const problems = [];
const report = (message) => problems.push(message);

/* ---------------------------------------------------------------- 1. Balance */

const counts = { '{': 0, '}': 0, '(': 0, ')': 0 };
for (const character of shader) {
  if (counts[character] !== undefined) counts[character] += 1;
}
if (counts['{'] !== counts['}']) {
  report(`braces unbalanced: ${counts['{']} "{" vs ${counts['}']} "}"`);
}
if (counts['('] !== counts[')']) {
  report(`parens unbalanced: ${counts['(']} "(" vs ${counts[')']} ")"`);
}

/* ---------------------------------------------------------------- 2. Precision */

if (/precision\s+mediump\s+float/.test(shader)) {
  report('shader declares mediump float. It works in world pixel coordinates, whose exact range '
    + 'under mediump ends around 2048 - a screen or two from the origin - and the result is visible '
    + 'stair-stepping. Use highp.');
}
if (!/precision\s+highp\s+float/.test(shader)) {
  report('no "precision highp float" declaration found.');
}

/* ---------------------------------------------------------------- 3. Uniforms */

const declaredUniforms = new Map();
for (const match of shader.matchAll(/uniform\s+(\w+)\s+(\w+)\s*(\[\s*\d+\s*\])?\s*;/g)) {
  const [, type, name, array] = match;
  if (declaredUniforms.has(name) && declaredUniforms.get(name) !== type) {
    report(`uniform ${name} is declared twice with different types `
      + `(${declaredUniforms.get(name)} and ${type}).`);
  }
  declaredUniforms.set(name, type + (array ? '[]' : ''));
}

// PIXI injects these into every filter program whether the author declares them or not.
const PIXI_AUTOMATIC = new Set(['uSampler', 'inputSize', 'outputFrame', 'inputClamp',
  'inputPixel', 'filterArea', 'filterClamp', 'resolution']);

const uniformsSuppliedMatch = runtimeSource.match(
  /new PIXI\.Filter\(undefined, DISTORTION_FRAGMENT_SHADER, \{([\s\S]*?)\n    \}\);/);
if (!uniformsSuppliedMatch) {
  report('could not find the PIXI.Filter uniforms object in the runtime.');
} else {
  const supplied = new Set(
    [...uniformsSuppliedMatch[1].matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]));

  for (const [name] of declaredUniforms) {
    if (PIXI_AUTOMATIC.has(name)) continue;
    if (!supplied.has(name)) {
      report(`uniform ${name} is declared in the shader but never supplied by the filter. `
        + 'It will read as zero, and the effect will silently do nothing.');
    }
  }
  for (const name of supplied) {
    if (!declaredUniforms.has(name)) {
      report(`the filter supplies "${name}" but the shader never declares it.`);
    }
  }
}

/* ---------------------------------------------------------------- 4. Identifier use */

const GLSL_BUILTINS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt',
  'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp', 'mix',
  'step', 'smoothstep', 'length', 'distance', 'dot', 'cross', 'normalize', 'reflect', 'refract',
  'texture2D', 'texture2DProj', 'textureCube', 'radians', 'degrees', 'matrixCompMult',
  'lessThan', 'greaterThan', 'equal', 'notEqual', 'any', 'all', 'not',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4',
  'mat2', 'mat3', 'mat4', 'float', 'int', 'bool', 'main',
]);

const definedFunctions = new Set(['main']);
for (const match of shader.matchAll(/^\s*(?:\w+)\s+(\w+)\s*\([^)]*\)\s*\{/gm)) {
  definedFunctions.add(match[1]);
}

for (const match of shader.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
  const name = match[1];
  if (GLSL_BUILTINS.has(name) || definedFunctions.has(name)) continue;
  if (['if', 'for', 'while', 'return'].includes(name)) continue;
  report(`function ${name}() is called but never defined in this shader. `
    + 'GLSL does not link across shaders.');
}

/* ---------------------------------------------------------------- 5. Loop rules */

for (const match of shader.matchAll(/for\s*\(([^)]*)\)/g)) {
  const header = match[1];
  const condition = header.split(';')[1] || '';
  const bound = condition.split(/[<>]=?/)[1];
  if (!bound) {
    report(`for-loop condition "${condition.trim()}" has no comparison. `
      + 'GLSL ES 1.00 requires the index be compared against a constant expression.');
    continue;
  }
  if (!/^\s*\d+\s*$/.test(bound)) {
    report(`for-loop bound "${bound.trim()}" is not a literal constant. `
      + 'GLSL ES 1.00 will not compile a loop whose bound is a uniform or a variable.');
  }
}

/* ---------------------------------------------------------------- 6. Output */

if (!/gl_FragColor\s*=/.test(shader)) {
  report('gl_FragColor is never written - the fragment shader produces no output.');
}

/* ---------------------------------------------------------------- 7. Correctness guards */

// The two mistakes this whole extension exists to avoid. Both compile perfectly.
if (!shader.includes('vTextureCoord * inputSize.xy + outputFrame.xy')) {
  report('screen pixels are not recovered from inputSize/outputFrame. vTextureCoord ranges over '
    + '0..outputFrame.zw/inputSize.xy, which is 0..1 ONLY when PIXI happened to allocate an '
    + 'exact-fit screen texture - so anything derived from its range snaps when it does not.');
}
if (/clamp\s*\(\s*uv\s*,\s*0\.0\s*,\s*1\.0\s*\)/.test(shader)) {
  report('uv is clamped to 0..1. On a power-of-two filter texture everything past inputClamp is '
    + 'dead padding, so this smears garbage along the edges. Clamp to inputClamp.xy/.zw instead.');
}

/* ---------------------------------------------------------------- Result */

const lineCount = shader.split('\n').length;
if (problems.length) {
  console.error(`\nDISTORTION_FRAGMENT_SHADER (${lineCount} lines): ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error('  - ' + problem);
  console.error('');
  process.exit(1);
}

console.log(`\nDISTORTION_FRAGMENT_SHADER (${lineCount} lines) passed all static checks`);
console.log(`  ${declaredUniforms.size} uniforms declared, all supplied`);
console.log(`  ${MAX_RIPPLES} ripple slots, loop bound is a literal constant`);
console.log('  highp precision, screen pixels from inputSize/outputFrame, clamped to inputClamp');
console.log('\n  NOTE: this does not compile GLSL. Verify visually in GDevelop.\n');
