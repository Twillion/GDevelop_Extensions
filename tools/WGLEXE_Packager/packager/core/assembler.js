'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const schema = require('./schema');
const patcher = require('./patcher');
const { validateSource, validateRuntime } = require('./validate');

/**
 * The eight-step pipeline. No Node, npm or electron-builder is required on the
 * machine running the *output* — and none is required here either. We copy a
 * prebuilt Electron distribution and patch it, which is what electron-builder
 * does underneath anyway, minus the toolchain.
 */

const PATCH_ID = 'gdevelop-5-electron-main';

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (skip(source, entry)) continue;
    if (entry.isDirectory()) copyDir(source, target, skip);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target);
    else fs.copyFileSync(source, target);
  }
}

function rimraf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

async function assemble(options) {
  const { sourceDir, outputDir, patchesDir, toolsDir } = options;
  // `template` describes the Electron distribution to build on: where it is,
  // what its executable is called, and — when self-hosting — exactly which
  // files belong to it. See core/runtime.js.
  const template = options.template;
  const runtimeDir = template.dir;
  const settings = schema.normalise(options.settings);
  const log = options.onLog || (() => {});
  const steps = [];

  const step = (name, fn) => {
    log({ level: 'step', text: name });
    try {
      const detail = fn();
      steps.push({ name, ok: true, detail });
      if (detail) log({ level: 'detail', text: detail });
      return detail;
    } catch (error) {
      steps.push({ name, ok: false, detail: error.message });
      throw error;
    }
  };

  // 1 — Validate ------------------------------------------------------------
  step('Validate project', () => {
    const source = validateSource(sourceDir);
    if (!source.ok) throw new Error(source.problems.join('\n'));
    if (source.info.unsubstituted) {
      throw new Error(
        'This folder is GDevelop\'s runtime template, not an export — its ' +
          'GDJS_ placeholders are still unsubstituted. Export the game first.'
      );
    }
    const runtime = validateRuntime(template);
    if (!runtime.ok) throw new Error(runtime.problems.join('\n'));
    return `${source.info.productName || 'game'} ${source.info.version || ''}`.trim();
  });

  // Patch in memory first, so a missing anchor fails before anything is written.
  const spec = patcher.loadSpec(patchesDir, PATCH_ID);
  const originalMain = fs.readFileSync(path.join(sourceDir, 'main.js'), 'utf8');
  let patched;
  step('Patch main.js', () => {
    patched = patcher.apply(spec, originalMain, settings, patchesDir);
    return `applied: ${patched.applied.join(', ')}`;
  });

  // 2 — Copy the Electron template -----------------------------------------
  const appRoot = path.join(outputDir, 'resources', 'app');
  step('Copy Electron runtime', () => {
    rimraf(outputDir);

    if (template.manifest) {
      // Self-hosting: copy exactly the files the build recorded as Electron's,
      // and nothing else. Never guess here — a wrong guess ships the packager's
      // own settings and presets inside someone's game.
      for (const relative of template.manifest) {
        const source = path.join(runtimeDir, relative);
        if (!fs.existsSync(source)) continue;
        const target = path.join(outputDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
      return `${template.manifest.length} files from ${template.source}`;
    }

    // Never carry the template's own application across — ours replaces it.
    const templateApps = new Set(['app', 'app.asar', 'app.asar.unpacked', 'default_app.asar']);
    copyDir(runtimeDir, outputDir, (_, entry) => entry.name === 'resources');
    copyDir(path.join(runtimeDir, 'resources'), path.join(outputDir, 'resources'), (_, entry) =>
      templateApps.has(entry.name)
    );
    return outputDir;
  });

  // 3 — Place the game ------------------------------------------------------
  step('Place game files', () => {
    copyDir(sourceDir, appRoot, (source, entry) => entry.name === 'node_modules');
    return appRoot;
  });

  // 3b — Supply runtime dependencies ----------------------------------------
  // GDevelop's local export contains no node_modules: its online build service
  // runs npm install. main.js requires @electron/remote unconditionally, so
  // without this the build starts and dies immediately.
  step('Supply runtime dependencies', () => {
    const required = [{ id: '@electron/remote', why: 'required by GDevelop\'s main.js' }];
    if (settings.steam.enabled) {
      required.push({ id: 'steamworks.js', why: 'required by GDevelop\'s Steamworks extension' });
    }

    const notes = [];
    const missing = [];
    for (const dependency of required) {
      const target = path.join(appRoot, 'node_modules', dependency.id);
      if (fs.existsSync(target)) {
        notes.push(`${dependency.id}: already in the export`);
        continue;
      }
      const vendored = path.join(options.vendorDir, dependency.id);
      if (fs.existsSync(vendored)) {
        copyDir(vendored, target);
        notes.push(`${dependency.id}: supplied from vendor/`);
      } else {
        missing.push(`${dependency.id} (${dependency.why}) — expected at ${vendored}`);
      }
    }

    if (missing.length) {
      throw new Error(
        'Missing runtime dependencies. The export has no node_modules and the ' +
          'packager has nothing vendored to supply:\n  ' +
          missing.join('\n  ') +
          '\nSee vendor/README.md.'
      );
    }
    return notes.join('; ');
  });

  // 4 — Write the patched main.js -------------------------------------------
  step('Write patched main.js', () => {
    fs.writeFileSync(path.join(appRoot, 'main.js'), patched.source, 'utf8');
    return `${patched.applied.length} operations`;
  });

  // 5 — Runtime config ------------------------------------------------------
  step('Write wglexe.runtime.json', () => {
    const runtimeConfig = schema.runtimeConfig(settings);
    fs.writeFileSync(
      path.join(appRoot, 'wglexe.runtime.json'),
      JSON.stringify(runtimeConfig, null, 2) + '\n',
      'utf8'
    );
    // Keep the manifest's identity in step with the settings.
    const manifestPath = path.join(appRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.productName = settings.appName || manifest.productName;
    manifest.version = settings.version || manifest.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return `sharedArrayBuffer=${settings.security.sharedArrayBuffer}`;
  });

  // 6 — Brand the executable ------------------------------------------------
  const exeName = settings.executableName || 'Game.exe';
  const exePath = path.join(outputDir, exeName);
  step('Brand executable', () => {
    // The template says which binary is Electron's, so we never have to guess
    // and never rename the wrong one into a build that cannot start.
    const from = path.join(outputDir, template.exe);
    if (!fs.existsSync(from)) {
      const found = fs.readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith('.exe'));
      throw new Error(
        `Expected ${template.exe} in the copied runtime but found ${
          found.length ? found.join(', ') : 'no .exe at all'
        }.`
      );
    }
    if (path.resolve(from) !== path.resolve(exePath)) fs.renameSync(from, exePath);
    return `${template.exe} → ${exeName}`;
  });

  const iconResult = await stampResources({
    exePath,
    settings,
    toolsDir,
    sourceDir,
    log,
  });
  steps.push({ name: 'Stamp icon and version', ok: iconResult.ok, detail: iconResult.detail });
  log({ level: iconResult.ok ? 'detail' : 'warn', text: iconResult.detail });

  // 7 — Steam files ---------------------------------------------------------
  step('Steam files', () => {
    const notes = [];
    if (settings.steam.stripSteamAppIdTxt) {
      for (const candidate of [
        path.join(outputDir, 'steam_appid.txt'),
        path.join(appRoot, 'steam_appid.txt'),
        path.join(appRoot, 'app', 'steam_appid.txt'),
      ]) {
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
          notes.push(`removed ${path.relative(outputDir, candidate)}`);
        }
      }
    }
    if (settings.steam.enabled) {
      const dll = findSteamDll(sourceDir, appRoot);
      if (dll) {
        fs.copyFileSync(dll, path.join(outputDir, 'steam_api64.dll'));
        notes.push('steam_api64.dll copied');
      } else {
        notes.push('steam_api64.dll NOT found — copy it beside the exe before uploading');
      }
    }
    return notes.length ? notes.join('; ') : 'nothing to do';
  });

  return { ok: true, steps, outputDir, exePath, settings };
}

/**
 * steam_api64.dll must sit beside the executable. steamworks.js ships it, so
 * once that dependency is in place we can lift it from there rather than making
 * the user hunt for it in the Steamworks SDK.
 */
function findSteamDll(sourceDir, appRoot) {
  const relative = path.join('node_modules', 'steamworks.js', 'dist', 'win64', 'steam_api64.dll');
  const candidates = [
    path.join(sourceDir, 'steam_api64.dll'),
    path.join(sourceDir, 'app', 'steam_api64.dll'),
    path.join(sourceDir, relative),
    path.join(appRoot, relative),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Icon and version stamping. This is the one step that needs real Win32 work
 * (BeginUpdateResource / UpdateResource). The Electron build shells out to a
 * bundled rcedit.exe — the same thing electron-builder does internally. A C#
 * port would call UpdateResource directly and drop tools/ entirely.
 */
function stampResources({ exePath, settings, toolsDir }) {
  const rcedit = path.join(toolsDir, 'rcedit.exe');
  const args = [
    exePath,
    '--set-version-string', 'ProductName', settings.appName || 'Game',
    '--set-version-string', 'FileDescription', settings.appName || 'Game',
    '--set-file-version', settings.version || '1.0.0',
    '--set-product-version', settings.version || '1.0.0',
  ];
  if (settings.icon && fs.existsSync(settings.icon)) {
    args.push('--set-icon', settings.icon);
  }

  if (!fs.existsSync(rcedit)) {
    return Promise.resolve({
      ok: false,
      detail:
        'Skipped — tools/rcedit.exe not present. The build still runs; it keeps ' +
        'the default Electron icon and version strings. See tools/README.md.',
    });
  }

  return new Promise((resolve) => {
    const child = spawn(rcedit, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) =>
      resolve({ ok: false, detail: `rcedit failed to start: ${error.message}` })
    );
    child.on('close', (code) =>
      resolve(
        code === 0
          ? { ok: true, detail: settings.icon ? 'icon and version stamped' : 'version stamped' }
          : { ok: false, detail: `rcedit exited ${code}: ${stderr.trim()}` }
      )
    );
  });
}

module.exports = { assemble, copyDir };
