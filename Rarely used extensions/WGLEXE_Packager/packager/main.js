'use strict';

/**
 * The packager's own Electron main process. This is the GUI shell only — all
 * packaging logic lives in core/, driven by patches/*.json and the settings
 * schema, so a future C# or C++ shell can replace this file without touching
 * anything that took thought.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const schema = require('./core/schema');
const store = require('./core/settings');
const { validateSource, validateRuntime } = require('./core/validate');
const runtimeResolver = require('./core/runtime');
const { assemble } = require('./core/assembler');
const verify = require('./core/verify');

let mainWindow = null;
let state = store.load();

// Portable means portable. By default Electron puts its Chromium profile in
// %APPDATA%\<productName>; redirect it inside our own folder so running the tool
// leaves nothing behind anywhere else on the machine. Must happen before ready.
app.setPath('userData', path.join(store.paths().root, 'data'));

function createWindow() {
  const bounds = state.windowBounds || {};
  mainWindow = new BrowserWindow({
    width: bounds.width || 1020,
    height: bounds.height || 760,
    x: bounds.x,
    y: bounds.y,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#12141a',
    title: 'WGLEXE Packager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', () => {
    state.windowBounds = mainWindow.getBounds();
    store.save(state);
  });

  // Smoke test: `WGLEXE_SELFTEST=<file> electron .` reports what the window
  // actually rendered and exits. Same file handshake as core/verify.js, and for
  // the same reason — Electron on Windows has no usable stdout when spawned.
  if (process.env.WGLEXE_SELFTEST) selfTest(mainWindow, process.env.WGLEXE_SELFTEST);
}

function selfTest(win, reportPath) {
  win.webContents.once('did-finish-load', async () => {
    let report;
    try {
      report = await win.webContents.executeJavaScript(
        `(async () => {
           await new Promise((r) => setTimeout(r, 400));
           const settings = [...document.querySelectorAll('.setting')];
           const named = (t) => settings.find((s) => s.querySelector('.name')?.textContent === t);
           const box = (t) => named(t)?.querySelector('input[type=checkbox]');
           const visible = () => [...document.querySelectorAll('.setting .warning')]
             .filter((w) => !w.hidden).map((w) => w.dataset.for);
           const before = visible();
           box('Ignore GPU blocklist').click();
           await new Promise((r) => setTimeout(r, 250));
           const after = visible();
           box('Ignore GPU blocklist').click();
           return {
             title: document.title,
             groups: [...document.querySelectorAll('.group h3')].map((h) => h.textContent),
             settingCount: settings.length,
             checkboxCount: document.querySelectorAll('.setting input[type=checkbox]').length,
             presets: [...document.querySelectorAll('#preset-select option')].map((o) => o.textContent),
             warningsAtDefaults: before,
             warningsAfterRiskyToggle: after,
             packageDisabledWithNoProject: document.querySelector('#package-button').disabled,
           };
         })()`
      );
    } catch (error) {
      report = { error: String(error) };
    }
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
    } catch {
      /* the caller will report a timeout */
    }
    app.exit(0);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function currentTemplate() {
  return runtimeResolver.resolve(store.paths(), process.execPath);
}

// --- IPC -------------------------------------------------------------------

ipcMain.handle('boot', () => ({
  groups: schema.GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    fields: group.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      help: field.help || '',
      warning: field.warning || '',
      options: field.options || null,
      placeholder: field.placeholder || '',
    })),
  })),
  state,
  presets: store.listPresets(),
  paths: store.paths(),
  runtime: { ...validateRuntime(currentTemplate()), description: runtimeResolver.describe(currentTemplate()) },
}));

ipcMain.handle('validate-source', (_event, dir) => validateSource(dir));

ipcMain.handle('warnings', (_event, settings) =>
  schema.activeWarnings(schema.normalise(settings))
);

ipcMain.handle('pick-folder', async (_event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('pick-icon', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an icon',
    filters: [{ name: 'Icon', extensions: ['ico'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-state', (_event, next) => {
  state = { ...state, ...next, settings: schema.normalise(next.settings || state.settings) };
  return store.save(state);
});

ipcMain.handle('load-preset', (_event, file) => store.loadPreset(file));

ipcMain.handle('save-preset', (_event, { name, settings }) => {
  store.savePreset(name, settings);
  return store.listPresets();
});

ipcMain.handle('reveal', (_event, target) => shell.showItemInFolder(target));

ipcMain.handle('package', async (_event, payload) => {
  const settings = schema.normalise(payload.settings);
  try {
    const result = await assemble({
      sourceDir: payload.sourceDir,
      outputDir: payload.outputDir,
      template: currentTemplate(),
      patchesDir: store.paths().patchesDir,
      toolsDir: store.paths().toolsDir,
      vendorDir: store.paths().vendorDir,
      settings,
      onLog: (entry) => send('log', entry),
    });

    if (!settings.build.verify) {
      return { ok: true, exePath: result.exePath, checks: null };
    }

    send('log', { level: 'step', text: 'Verify' });
    const run = await verify.runBuild(result.exePath);
    if (!run.ok) {
      send('log', { level: 'error', text: run.error });
      return { ok: false, exePath: result.exePath, error: run.error, checks: null };
    }
    const assessment = verify.assess(run.report, settings);
    return { ok: assessment.ok, exePath: result.exePath, checks: assessment.checks };
  } catch (error) {
    send('log', { level: 'error', text: error.message });
    return { ok: false, error: error.message, checks: null };
  }
});
