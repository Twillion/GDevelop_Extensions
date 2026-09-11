'use strict';

/**
 * Headless entry point. Runs on plain Node — no Electron needed — so the core
 * pipeline can be exercised and tested without the GUI. The GUI calls exactly
 * the same modules.
 *
 *   node packager/cli.js check   --source <dir>
 *   node packager/cli.js patch   --source <dir> [--out <file>]
 *   node packager/cli.js package --source <dir> --output <dir> [--preset <file>]
 */

const fs = require('fs');
const path = require('path');

const schema = require('./core/schema');
const store = require('./core/settings');
const patcher = require('./core/patcher');
const { validateSource, validateRuntime } = require('./core/validate');
const runtime = require('./core/runtime');
const { assemble } = require('./core/assembler');
const verify = require('./core/verify');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function resolveSettings(args) {
  const state = store.load();
  let settings = state.settings;
  if (args.preset) settings = store.loadPreset(args.preset);
  if (args.settings) {
    settings = schema.normalise(JSON.parse(fs.readFileSync(args.settings, 'utf8')));
  }
  return settings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  const paths = store.paths();

  if (command === 'check') {
    const source = validateSource(args.source);
    const template = resolveTemplate(paths, args.runtime);
    const runtimeCheck = validateRuntime(template);
    console.log('Project:', source.ok ? 'OK' : 'FAILED');
    source.problems.forEach((problem) => console.log('  -', problem));
    if (source.ok) console.log('  ', JSON.stringify(source.info));
    console.log('Runtime:', runtimeCheck.ok ? 'OK' : 'FAILED');
    if (runtimeCheck.ok) console.log('  ', runtime.describe(template));
    runtimeCheck.problems.forEach((problem) => console.log('  -', problem));
    process.exit(source.ok ? 0 : 1);
  }

  if (command === 'patch') {
    // Dry run: patch main.js and print or write the result. Touches nothing else.
    const settings = resolveSettings(args);
    const spec = patcher.loadSpec(paths.patchesDir, 'gdevelop-5-electron-main');
    const mainPath = path.join(args.source, 'main.js');
    const original = fs.readFileSync(mainPath, 'utf8');
    const result = patcher.apply(spec, original, settings, paths.patchesDir);
    if (args.out) {
      fs.writeFileSync(args.out, result.source, 'utf8');
      console.log(`Wrote ${args.out} (operations: ${result.applied.join(', ')})`);
    } else {
      process.stdout.write(result.source);
    }
    return;
  }

  if (command === 'package') {
    const settings = resolveSettings(args);
    for (const warning of schema.activeWarnings(settings)) {
      console.log(`! ${warning.label}: ${warning.text}`);
    }
    const result = await assemble({
      sourceDir: path.resolve(args.source),
      outputDir: path.resolve(args.output),
      template: requireTemplate(paths, args.runtime),
      patchesDir: paths.patchesDir,
      toolsDir: paths.toolsDir,
      vendorDir: paths.vendorDir,
      settings,
      onLog: (entry) =>
        console.log(entry.level === 'step' ? `\n> ${entry.text}` : `    ${entry.text}`),
    });

    if (settings.build.verify) {
      console.log('\n> Verify');
      const run = await verify.runBuild(result.exePath);
      if (!run.ok) {
        console.log(`    FAILED: ${run.error}`);
        process.exit(1);
      }
      const assessment = verify.assess(run.report, settings);
      for (const check of assessment.checks) {
        console.log(`    [${check.ok ? 'pass' : 'FAIL'}] ${check.label} — ${check.detail}`);
      }
      process.exit(assessment.ok ? 0 : 1);
    }
    console.log(`\nDone: ${result.exePath}`);
    return;
  }

  console.log(
    [
      'WGLEXE Packager (headless)',
      '',
      '  node packager/cli.js check   --source <dir> [--runtime <dir>]',
      '  node packager/cli.js patch   --source <dir> [--out <file>] [--preset <name.json>]',
      '  node packager/cli.js package --source <dir> --output <dir> [--runtime <dir>]',
      '',
      'Settings come from settings.json, or --preset <name.json>, or --settings <file>.',
    ].join('\n')
  );
}

/** An explicit --runtime wins; otherwise fall back to core/runtime.js. */
function resolveTemplate(paths, explicit) {
  if (explicit) {
    const dir = path.resolve(explicit);
    return { dir, exe: 'electron.exe', manifest: null, source: dir };
  }
  return runtime.resolve(paths, process.execPath);
}

function requireTemplate(paths, explicit) {
  const template = resolveTemplate(paths, explicit);
  const check = validateRuntime(template);
  if (!check.ok) throw new Error(check.problems.join('\n'));
  return template;
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
