'use strict';

/**
 * Builds the portable WGLEXE Packager application.
 *
 * The tool is assembled exactly the way it assembles games: copy an Electron
 * distribution, drop the app into resources/app/, rename the executable. No
 * electron-builder, no packaging framework — the same eight steps, so if this
 * works the pipeline works.
 *
 *   node build-portable.js [--out <dir>]
 *
 * Output is a folder you can copy anywhere and double-click. Nothing is
 * installed, and nothing is written outside it.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const APP_NAME = 'WGLEXE Packager';
const EXE_NAME = 'WGLEXEPackager.exe';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (skip(source, entry)) continue;
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target, skip);
    else fs.copyFileSync(source, target);
  }
}

function findRuntime() {
  const runtimeDir = path.join(ROOT, 'runtime');
  if (!fs.existsSync(runtimeDir)) return null;
  const candidate = fs
    .readdirSync(runtimeDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && fs.existsSync(path.join(runtimeDir, entry.name, 'electron.exe')));
  return candidate ? path.join(runtimeDir, candidate.name) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out || path.join(ROOT, 'dist', APP_NAME));

  const runtime = findRuntime();
  if (!runtime) {
    console.error(
      'No Electron runtime found in runtime/. See runtime/README.md — the same\n' +
        'distribution is used both to run this tool and as the template it ships.'
    );
    process.exit(1);
  }
  console.log(`Runtime:  ${runtime}`);
  console.log(`Output:   ${outDir}\n`);

  // 1 — Electron distribution ------------------------------------------------
  console.log('> Copy Electron distribution');
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  copyDir(runtime, outDir, (_, entry) => entry.name === 'resources');
  copyDir(path.join(runtime, 'resources'), path.join(outDir, 'resources'), (_, entry) =>
    ['app', 'app.asar', 'app.asar.unpacked', 'default_app.asar'].includes(entry.name)
  );

  // Record exactly which files came from Electron, before the app is copied in.
  // This is what lets the packaged tool use its own distribution as the ship
  // template instead of carrying a second 180 MB copy — safely, because it never
  // has to guess which files at the root are Electron's and which are ours.
  const electronFiles = listFiles(outDir).filter(
    (relative) => !relative.startsWith(`resources${path.sep}app${path.sep}`)
  );

  // 2 — The application itself -----------------------------------------------
  console.log('> Copy application');
  const appOut = path.join(outDir, 'resources', 'app');
  copyDir(path.join(ROOT, 'packager'), appOut, (_, entry) => {
    // electron is a build-time dependency of the tool, not part of it: the host
    // Electron is the distribution we just copied.
    if (entry.name === 'node_modules') return true;
    if (entry.name === 'package-lock.json') return true;
    // The browser preview harness is a development aid, not part of the app.
    return ['preview.html', 'preview-stub.js', 'dev-server.js'].includes(entry.name);
  });

  // 3 — Portable data folders ------------------------------------------------
  // `runtime/` is deliberately not carried: the app's own Electron distribution
  // is the template, via the manifest written above. Pass --with-runtime to ship
  // a separate template as well, which is only needed when games should run on a
  // different Electron than the tool does (plan §5.4).
  console.log('> Copy data folders');
  const folders = ['patches', 'presets', 'vendor', 'tools'];
  if (args['with-runtime'] !== undefined) folders.push('runtime');

  const carried = [];
  for (const folder of folders) {
    const from = path.join(ROOT, folder);
    if (!fs.existsSync(from)) continue;
    copyDir(from, path.join(outDir, folder));
    carried.push(folder);
  }
  console.log(`    ${carried.join(', ')}`);

  if (args['with-runtime'] === undefined) {
    fs.writeFileSync(
      path.join(outDir, 'electron-manifest.json'),
      JSON.stringify(
        {
          note: 'Files belonging to the Electron distribution, used as the ship template.',
          electronVersion: path.basename(runtime),
          // Recorded under the name the file has *after* branding: the tool's
          // own executable is the Electron binary it copies into the game.
          files: electronFiles
            .map((relative) => (relative === 'electron.exe' ? EXE_NAME : relative))
            .map((relative) => relative.split(path.sep).join('/')),
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`    electron-manifest.json (${electronFiles.length} files)`);
  }
  for (const doc of ['README.md', 'ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md']) {
    if (fs.existsSync(path.join(ROOT, doc))) {
      fs.copyFileSync(path.join(ROOT, doc), path.join(outDir, doc));
    }
  }

  // 4 — Brand ----------------------------------------------------------------
  console.log('> Brand executable');
  fs.renameSync(path.join(outDir, 'electron.exe'), path.join(outDir, EXE_NAME));

  const rcedit = path.join(ROOT, 'tools', 'rcedit.exe');
  if (fs.existsSync(rcedit)) {
    const version = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'packager', 'package.json'), 'utf8')
    ).version;
    try {
      execFileSync(rcedit, [
        path.join(outDir, EXE_NAME),
        '--set-version-string', 'ProductName', APP_NAME,
        '--set-version-string', 'FileDescription', APP_NAME,
        '--set-file-version', version,
        '--set-product-version', version,
      ]);
      console.log('    version stamped');
    } catch (error) {
      console.log(`    rcedit failed: ${error.message}`);
    }
  } else {
    console.log('    tools/rcedit.exe absent — keeping Electron default icon and strings');
  }

  const size = folderSize(outDir);
  console.log(`\nDone: ${path.join(outDir, EXE_NAME)}`);
  console.log(`Size: ${(size / 1024 / 1024).toFixed(0)} MB`);
  console.log('\nCopy the whole folder anywhere and run the executable. Nothing is installed.');
}

/** Every file under `dir`, as paths relative to it. */
function listFiles(dir, base = dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(target, base));
    else found.push(path.relative(base, target));
  }
  return found;
}

function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(target) : fs.statSync(target).size;
  }
  return total;
}

main();
