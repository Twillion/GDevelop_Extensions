
// --- wglexe:switches (injected by WGLEXE Packager — do not edit by hand) ---
const __wglexe = require('./wglexe.runtime.json');

// Chromium switch values are REPLACED, not appended, when appendSwitch is called
// twice with the same key. GDevelop already sets --disable-features above, so every
// feature-list entry is accumulated here and written exactly once.
const __wglexeFeatures = { 'enable-features': [], 'disable-features': [] };

// Preserve GDevelop's Steam Input workaround. Without it, games launched through
// Steam see no gamepad at all, including on Steam Deck. Never remove this.
if (process.platform === 'win32') {
  __wglexeFeatures['disable-features'].push('EnableWindowsGamingInputDataFetcher');
}

const __wglexeSteam = __wglexe.steam || {};
if (__wglexeSteam.enabled !== false && __wglexeSteam.overlayCompat !== false) {
  // The Steam overlay hooks the presenting process; Electron presents from a
  // separate GPU process, so without this the overlay never appears.
  app.commandLine.appendSwitch('in-process-gpu');
  if (__wglexeSteam.disableDirectComposition) {
    app.commandLine.appendSwitch('disable-direct-composition');
  }
}

const __wglexeSecurity = __wglexe.security || {};
if (__wglexeSecurity.sharedArrayBuffer === 'flag') {
  __wglexeFeatures['enable-features'].push('SharedArrayBuffer');
}

const __wglexeGpu = __wglexe.gpu || {};
if (__wglexeGpu.angleBackend && __wglexeGpu.angleBackend !== 'default') {
  app.commandLine.appendSwitch('use-angle', __wglexeGpu.angleBackend);
}
if (__wglexeGpu.ignoreGpuBlocklist) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
if (__wglexeGpu.disableVsync) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}
if (__wglexeGpu.enableDraftExtensions) {
  app.commandLine.appendSwitch('enable-webgl-draft-extensions');
}

for (const __wglexeKey of Object.keys(__wglexeFeatures)) {
  if (__wglexeFeatures[__wglexeKey].length) {
    app.commandLine.appendSwitch(__wglexeKey, __wglexeFeatures[__wglexeKey].join(','));
  }
}

// Window options are spread into the BrowserWindow constructor, overriding the
// values GDevelop's exporter substituted in.
global.__wglexeWindowOptions = (function () {
  const w = __wglexe.window || {};
  const options = {};
  if (w.width) options.width = w.width;
  if (w.height) options.height = w.height;
  if (w.minWidth) options.minWidth = w.minWidth;
  if (w.minHeight) options.minHeight = w.minHeight;
  if (typeof w.title === 'string' && w.title) options.title = w.title;
  if (typeof w.resizable === 'boolean') options.resizable = w.resizable;
  if (typeof w.fullscreen === 'boolean') options.fullscreen = w.fullscreen;
  if (w.borderless) options.frame = false;
  return options;
})();

function __wglexeAfterCreate(win) {
  const w = __wglexe.window || {};
  if (w.backgroundThrottling === false && win.webContents.setBackgroundThrottling) {
    win.webContents.setBackgroundThrottling(false);
  }
  const reportPath = process.env.WGLEXE_VERIFY;
  if (!reportPath) return;

  // Verification mode: the packager launches the assembled build with
  // WGLEXE_VERIFY set to a file path, reads the JSON written there, and the
  // build exits. Inert in shipped builds.
  //
  // A file, not stdout: Electron on Windows is a GUI-subsystem binary, so its
  // stdout is not connected when spawned by another process.
  const __wglexeReport = (result) => {
    result.switches = {
      disableFeatures: app.commandLine.getSwitchValue('disable-features'),
      enableFeatures: app.commandLine.getSwitchValue('enable-features'),
      inProcessGpu: app.commandLine.hasSwitch('in-process-gpu'),
      useAngle: app.commandLine.getSwitchValue('use-angle'),
    };
    try {
      require('fs').writeFileSync(reportPath, JSON.stringify(result), 'utf8');
    } catch (error) {
      /* nothing useful to do — the packager will report a timeout */
    }
    app.exit(0);
  };

  win.webContents.on('did-fail-load', (_event, code, description, url) =>
    __wglexeReport({ error: `did-fail-load ${code} ${description} (${url})` })
  );

  win.webContents.once('did-finish-load', async () => {
    let result;
    try {
      result = await win.webContents.executeJavaScript(
        '({ sharedArrayBuffer: typeof SharedArrayBuffer === "function",' +
        '   crossOriginIsolated: self.crossOriginIsolated === true,' +
        '   href: String(location.href),' +
        '   hardwareConcurrency: navigator.hardwareConcurrency || 0 })'
      );
    } catch (error) {
      result = { error: String(error) };
    }
    __wglexeReport(result);
  });
}

// Startup failures must reach the packager too, not just vanish into a GUI
// process with no console.
process.on('uncaughtException', (error) => {
  if (!process.env.WGLEXE_VERIFY) throw error;
  try {
    require('fs').writeFileSync(
      process.env.WGLEXE_VERIFY,
      JSON.stringify({ error: `uncaught: ${error && error.message}` }),
      'utf8'
    );
  } catch {
    /* give up */
  }
  app.exit(1);
});
// --- /wglexe:switches ---
