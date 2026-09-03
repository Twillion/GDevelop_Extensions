/** Run every FluidAndWater3D validation entry point and stop at the first failure. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const scripts = [
  'test-runtime.mjs',
  'test-ocean.mjs',
  'test-gpufft.mjs',
  'test-sph.mjs',
  'build-extension.mjs',
];

for (const script of scripts) {
  const args = [fileURLToPath(new URL(script, here))];
  if (script === 'build-extension.mjs') args.push('--check');
  console.log(`\n=== ${script}${args.length > 1 ? ' --check' : ''} ===\n`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nALL FLUIDANDWATER3D CHECKS PASSED');
