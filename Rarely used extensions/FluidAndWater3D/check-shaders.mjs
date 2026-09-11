/**
 * Static GLSL sanity check for every FluidAndWater3D shader.
 *
 * WHY THIS EXISTS
 * ---------------
 * `test-runtime.mjs` mocks `THREE.ShaderMaterial` as a plain object that stores the shader strings,
 * so no GLSL is ever compiled, and `build-extension.mjs --check` only parses JavaScript. A shader
 * that cannot compile therefore passes every test in the suite — and a water surface whose program
 * fails to link is simply never drawn, with no error anywhere the author will see.
 *
 * That is exactly how `float wRad = radians(u_WindDir);` shipped into OCEAN_FRAGMENT_SHADER and
 * WAVEWORKS_FRAGMENT_SHADER. The line was correct in the Gerstner shader, where `u_WindDir` is a
 * `float` heading in degrees, but in the two ocean shaders the same uniform name is a `vec2`
 * direction vector, so it is a dimension mismatch and both oceans rendered nothing at all.
 *
 * This does not replace compiling the shaders on a GPU — verify visually in GDevelop. It catches
 * the mistakes that are cheap to catch:
 *   1. a `u_*` used but never declared,
 *   2. a scalar initialised straight from a vector-typed uniform,
 *   3. a uniform declared with conflicting types inside one shader,
 *   4. a function called but never defined IN THAT SHADER (GLSL does not link across shaders),
 *   5. a local variable that shadows a helper function's name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(here, 'FluidAndWater3D.runtime.js');

const SHADERS = [
  'WAVEWORKS_VERTEX_SHADER', 'WAVEWORKS_FRAGMENT_SHADER',
  'WATER_VERTEX_SHADER', 'WATER_FRAGMENT_SHADER',
];

const src = fs.readFileSync(RUNTIME, 'utf8');

/**
 * Evaluates a shader's whole right-hand side, not just its first array literal. Two of these are
 * built as `[...].concat(OCTAVES.map(...)).concat([...])`, and stopping at the first `]` truncates
 * them mid-main(), which reads as a bogus syntax error.
 */
function extract(name) {
  const decl = '  var ' + name + ' = ';
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(name + ' not found in the runtime');
  let i = start + decl.length;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    // Only a semicolon at depth 0 ends the statement; the .map() callbacks contain their own.
    else if (c === ';' && depth === 0) break;
  }
  const expr = src.slice(start + decl.length, i);
  const scope = {
    GERSTNER_OCTAVES: null,
    GERSTNER2_WAVES: null,
    MAX_WATER_INTERACTIONS: 16,
  };
  // The real octave tables, so the shaders are assembled exactly as they are at run time.
  if (name !== 'GERSTNER_OCTAVES' && name !== 'GERSTNER2_WAVES') {
    scope.GERSTNER_OCTAVES = extract('GERSTNER_OCTAVES');
    scope.GERSTNER2_WAVES = extract('GERSTNER2_WAVES');
  }
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(scope), 'return ' + expr)(...Object.values(scope));
}

let problems = 0;

for (const name of SHADERS) {
  let glsl;
  try {
    glsl = extract(name);
  } catch (e) {
    console.log('BROKEN ' + name + ' — could not be extracted: ' + e.message);
    problems++;
    continue;
  }
  if (typeof glsl !== 'string') {
    console.log('BROKEN ' + name + ' — did not evaluate to a string');
    problems++;
    continue;
  }

  const types = new Map();
  const conflicts = [];
  let m;
  const declRe = /uniform\s+(\w+)\s+(u_[A-Za-z0-9_]+)/g;
  while ((m = declRe.exec(glsl)) !== null) {
    if (types.has(m[2]) && types.get(m[2]) !== m[1]) {
      conflicts.push(m[2] + ' declared as both ' + types.get(m[2]) + ' and ' + m[1]);
    }
    types.set(m[2], m[1]);
  }

  const used = new Set();
  const useRe = /\b(u_[A-Za-z0-9_]+)\b/g;
  while ((m = useRe.exec(glsl)) !== null) used.add(m[1]);
  const undeclared = [...used].filter((u) => !types.has(u));

  // A scalar taken straight from a vector uniform, with nothing that reduces it to one component.
  const badScalar = [];
  const lines = glsl.split('\n');
  lines.forEach((line, idx) => {
    const sm = line.match(/^\s*float\s+\w+\s*=\s*(.+);\s*$/);
    if (!sm) return;
    const rhs = sm[1];
    if (/\b(dot|length|distance)\s*\(/.test(rhs)) return;
    for (const [uni, t] of types) {
      if (!/^vec[234]$/.test(t)) continue;
      if (new RegExp('\\b' + uni + '\\b(?!\\s*\\.)').test(rhs)) {
        badScalar.push('line ' + (idx + 1) + ': ' + line.trim() + '   [' + uni + ' is ' + t + ']');
      }
    }
  });

  // Functions this shader defines, and the ones it calls. GLSL has no linker across shaders, so
  // every helper must be present in the very shader that uses it. A shader once called foamNoise()
  // with the definition sitting in a different shader entirely.
  const GLSL_BUILTINS = new Set([
    'abs', 'acos', 'all', 'any', 'asin', 'atan', 'ceil', 'clamp', 'cos', 'cross', 'degrees',
    'dFdx', 'dFdy', 'distance', 'dot', 'equal', 'exp', 'exp2', 'faceforward', 'floor', 'fract',
    'fwidth', 'greaterThan', 'greaterThanEqual', 'inversesqrt', 'length', 'lessThan',
    'lessThanEqual', 'log', 'log2', 'matrixCompMult', 'max', 'min', 'mix', 'mod', 'normalize',
    'not', 'notEqual', 'pow', 'radians', 'reflect', 'refract', 'sign', 'sin', 'smoothstep',
    'sqrt', 'step', 'tan', 'texture2D', 'texture2DProj', 'textureCube', 'transpose',
    'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4',
    'mat2', 'mat3', 'mat4', 'float', 'int', 'bool', 'if', 'for', 'while', 'return', 'discard',
  ]);
  // Builtins that exist in some GLSL dialect but NOT in the one these shaders actually compile
  // under. three feeds a raw ShaderMaterial through its GLSL1 path and rewrites a fixed set of
  // names for WebGL2 (texture2D -> texture, and friends). Anything outside that set fails to
  // compile, and a failed vertex shader does not throw - the surface silently never draws.
  const BANNED_BUILTINS = {
    texture2DLod: 'three has no GLSL1 mapping for it on WebGL2; use texture2D (a vertex fetch\n' +
      '          has no derivatives, so it is already lod 0)',
    texture2DProjLod: 'same: no GLSL1 mapping on WebGL2',
    textureLod: 'GLSL ES 3.00 only; these shaders are GLSL1',
    texelFetch: 'GLSL ES 3.00 only; these shaders are GLSL1',
    textureGrad: 'GLSL ES 3.00 only; these shaders are GLSL1',
  };

  // Comments first: prose like "Scattering (Ang 2018)" otherwise reads as a call to Scattering().
  const code = glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const defined = new Set();
  const defRe = /^\s*(?:float|int|bool|void|vec[234]|ivec[234]|bvec[234]|mat[234])\s+(\w+)\s*\(/gm;
  while ((m = defRe.exec(code)) !== null) defined.add(m[1]);

  const called = new Set();
  const callRe = /\b(\w+)\s*\(/g;
  while ((m = callRe.exec(code)) !== null) called.add(m[1]);
  const missingFns = [...called].filter((f) => !defined.has(f) && !GLSL_BUILTINS.has(f));

  const banned = [...called].filter((f) => Object.prototype.hasOwnProperty.call(BANNED_BUILTINS, f));

  // A local variable sharing a helper's name shadows it, which several drivers reject outright.
  const shadowed = [...defined].filter((f) => {
    const asVar = new RegExp('^\\s*(?:float|int|bool|vec[234]|mat[234])\\s+' + f + '\\s*=', 'm');
    return asVar.test(code);
  });

  const bad = undeclared.length || badScalar.length || conflicts.length
    || missingFns.length || shadowed.length || banned.length;
  if (bad) problems++;
  console.log((bad ? 'BROKEN ' : 'ok     ') + name.padEnd(26) +
    ' lines=' + String(lines.length).padStart(4) + '  uniforms=' + types.size);
  if (undeclared.length) console.log('        used but never declared: ' + undeclared.join(', '));
  for (const c of conflicts) console.log('        conflicting declaration: ' + c);
  for (const b of badScalar) console.log('        scalar from vector uniform: ' + b);
  if (missingFns.length) {
    console.log('        called but never defined in this shader: ' + missingFns.join(', '));
  }
  for (const f of shadowed) {
    console.log('        local variable shadows the function "' + f + '"');
  }
  for (const f of banned) {
    console.log('        "' + f + '" will not compile here: ' + BANNED_BUILTINS[f]);
  }
}

if (problems) {
  console.log('\n' + problems + ' SHADER(S) WOULD FAIL TO COMPILE — the water will not render.');
  process.exit(1);
}
console.log('\nALL FLUIDANDWATER3D SHADERS PASS THE STATIC CHECK');
