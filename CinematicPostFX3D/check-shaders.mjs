// Static sanity check on the assembled GLSL: balanced delimiters, no undeclared u*/t*
// identifiers, and no uniform that is uploaded every frame but never actually read.
// The last one is what let `uMultiBounce` and `uMaxRoughness` sit dead in the old shaders.
import fs from 'node:fs';

let src = fs.readFileSync('CinematicPostFX3D.runtime.js', 'utf8');
src = src.replace(
  'gdjs.__cinematicPostFX3D = {',
  'gdjs.__shaders = {gtao: gtaoFragmentShader, ssr: ssrFragmentShader, dof: bokehDOFFragmentShader,' +
  ' blur: bilateralBlurFragmentShader, comp: masterCompositeFragmentShader,' +
  ' karis: karisDownsampleFragmentShader, tent: tentUpsampleFragmentShader,' +
  ' ssrblur: ssrBlurFragmentShader, merge: mergeFragmentShader, streak: anamorphicStreakFragmentShader,' +
  ' vert: commonVertexShader};\ngdjs.__cinematicPostFX3D = {'
);
globalThis.gdjs = { registerRuntimeSceneUnloadedCallback() {} };
new Function(src)();

const count = (haystack, word) => {
  let n = 0;
  for (const tok of haystack.split(/[^A-Za-z0-9_]+/)) if (tok === word) n++;
  return n;
};

let failures = 0;
for (const [name, glsl] of Object.entries(gdjs.__shaders)) {
  const problems = [];

  const open = (glsl.match(/\{/g) || []).length;
  const close = (glsl.match(/\}/g) || []).length;
  const lp = (glsl.match(/\(/g) || []).length;
  const rp = (glsl.match(/\)/g) || []).length;
  if (open !== close) problems.push(`braces ${open}/${close}`);
  if (lp !== rp) problems.push(`parens ${lp}/${rp}`);
  if (glsl.includes('undefined') || glsl.includes('[object'))
    problems.push('string assembly leaked a JS value');

  const declared = [...glsl.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
  const declaredSet = new Set(declared);

  // Anything matching the u*/t* naming convention that is not declared is a typo.
  const used = new Set([...glsl.matchAll(/\b([ut][A-Z]\w*)\b/g)].map((m) => m[1]));
  const undeclared = [...used].filter((u) => !declaredSet.has(u));
  if (undeclared.length) problems.push('undeclared: ' + undeclared.join(', '));

  // Comments stripped so a name mentioned only in prose does not count as a read.
  const code = glsl.replace(/\/\/[^\n]*/g, '');
  const dead = declared.filter((u) => count(code, u) <= 1);
  if (dead.length) problems.push('declared but never read: ' + dead.join(', '));

  if (problems.length) {
    failures++;
    console.error(`  ${name}: ${problems.join('; ')}`);
  } else {
    console.log(`  ${name.padEnd(6)} ${String(glsl.split('\n').length).padStart(4)} lines, ${declared.length} uniforms, all read`);
  }
}

if (failures) {
  console.error(`\n${failures} shader(s) failed static checks.\n`);
  process.exit(1);
}
console.log('\nAll shaders pass static checks.');
