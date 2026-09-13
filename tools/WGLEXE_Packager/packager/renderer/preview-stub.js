'use strict';

/**
 * Development-only stub of the window.wglexe bridge, for preview.html.
 *
 * It mirrors core/schema.js closely enough to exercise the Settings screen and
 * the warning interlocks in a plain browser. It is never loaded by the app —
 * index.html uses the real preload instead.
 *
 * Keep the shape in step with preload.js: this doubles as the written contract
 * that any replacement shell (C#, C++) has to satisfy.
 */

const STUB_GROUPS = [
  {
    id: 'steam',
    title: 'Steam',
    fields: [
      { key: 'steam.enabled', label: 'Build for Steam', type: 'boolean', help: 'Adds steam_api64.dll and applies the Steam-specific defaults below.' },
      { key: 'steam.appId', label: 'App ID', type: 'string', placeholder: '480', help: 'Must also be set in GDevelop under Game Properties → Steamworks.' },
      { key: 'steam.overlayCompat', label: 'Steam overlay support', type: 'boolean', help: 'Adds --in-process-gpu.', warning: 'Turning this off means the Steam overlay, screenshots and the on-screen keyboard will not appear over your game.', warnWhen: false },
      { key: 'steam.disableDirectComposition', label: 'Also disable direct composition', type: 'boolean', help: 'Only needed if the overlay flickers. Try overlay support alone first.' },
      { key: 'steam.stripSteamAppIdTxt', label: 'Strip steam_appid.txt from output', type: 'boolean', help: 'That file is for local development only and must not reach the depot.', warning: 'Shipping steam_appid.txt to a depot can break the build for players.', warnWhen: false },
    ],
  },
  {
    id: 'performance',
    title: 'Performance',
    fields: [
      { key: 'security.sharedArrayBuffer', label: 'SharedArrayBuffer', type: 'enum', options: [ { value: 'flag', label: 'Flag (recommended)' }, { value: 'isolation', label: 'Cross-origin isolation' }, { value: 'off', label: 'Off' } ], help: '"Flag" keeps the file:// origin and changes nothing else. "Cross-origin isolation" serves the game from game:// with COOP/COEP.', warning: 'Cross-origin isolation disables GDevelop player authentication and leaderboards, and blocks any cross-origin asset without a CORP header.', warnWhen: 'isolation' },
      { key: 'gpu.disableVsync', label: 'Uncap frame rate', type: 'boolean', help: 'Adds --disable-gpu-vsync and --disable-frame-rate-limit.', warning: 'Disables v-sync. Causes visible screen tearing.', warnWhen: true },
      { key: 'gpu.ignoreGpuBlocklist', label: 'Ignore GPU blocklist', type: 'boolean', help: 'Prevents Chromium falling back to software rendering.', warning: 'The blocklist exists because those driver and GPU combinations crash. This turns a software fallback into a crash on affected machines.', warnWhen: true },
      { key: 'gpu.enableDraftExtensions', label: 'WebGL draft extensions', type: 'boolean', help: 'Not needed for 3D batching — WEBGL_multi_draw is already ratified.' },
      { key: 'gpu.angleBackend', label: 'Graphics backend', type: 'enum', options: [ { value: 'default', label: 'Automatic (recommended)' }, { value: 'd3d11', label: 'Direct3D 11' }, { value: 'd3d11on12', label: 'Direct3D 11on12' }, { value: 'vulkan', label: 'Vulkan' }, { value: 'gl', label: 'OpenGL' }, { value: 'gles', label: 'OpenGL ES' } ], help: 'Automatic is already Direct3D 11 on Windows.', warning: 'Forcing a backend removes Chromium’s own fallback logic and can leave some machines with a black screen.', warnWhen: '!default' },
    ],
  },
  {
    id: 'window',
    title: 'Window',
    fields: [
      { key: 'window.title', label: 'Title', type: 'string' },
      { key: 'window.width', label: 'Width', type: 'number' },
      { key: 'window.height', label: 'Height', type: 'number' },
      { key: 'window.minWidth', label: 'Minimum width', type: 'number' },
      { key: 'window.minHeight', label: 'Minimum height', type: 'number' },
      { key: 'window.resizable', label: 'Resizable', type: 'boolean' },
      { key: 'window.fullscreen', label: 'Start fullscreen', type: 'boolean' },
      { key: 'window.borderless', label: 'Borderless', type: 'boolean', help: 'Removes the title bar and window frame.' },
      { key: 'window.backgroundThrottling', label: 'Keep running when unfocused', type: 'boolean', help: 'Stops Chromium throttling timers when the window loses focus.' },
    ],
  },
  {
    id: 'output',
    title: 'Output',
    fields: [
      { key: 'appName', label: 'Application name', type: 'string' },
      { key: 'version', label: 'Version', type: 'string' },
      { key: 'executableName', label: 'Executable name', type: 'string' },
      { key: 'icon', label: 'Icon (.ico)', type: 'path', help: 'Leave blank to keep the default Electron icon.' },
      { key: 'build.asar', label: 'Pack game into app.asar', type: 'boolean', help: 'Slightly faster startup and tidier output. Makes the game harder to inspect, not secure.' },
      { key: 'build.verify', label: 'Verify after packaging', type: 'boolean', help: 'Launches the assembled build once and checks the result before reporting success.' },
    ],
  },
  {
    id: 'native',
    title: 'Native (advanced)',
    fields: [
      { key: 'security.nativeBridge', label: 'Native compute addon', type: 'boolean', help: 'Requires a wglexe.node built against this exact Electron version.' },
      { key: 'native.addon', label: 'Addon path (.node)', type: 'path' },
    ],
  },
];

const STUB_SETTINGS = {
  appName: 'GDevelopGame',
  version: '1.0.0',
  executableName: 'Game.exe',
  icon: '',
  window: { title: '', width: 1280, height: 720, minWidth: 640, minHeight: 480, resizable: true, fullscreen: false, borderless: false, backgroundThrottling: false },
  gpu: { angleBackend: 'default', ignoreGpuBlocklist: false, disableVsync: false, enableDraftExtensions: false },
  security: { sharedArrayBuffer: 'flag', nativeBridge: false },
  steam: { enabled: true, appId: '', overlayCompat: true, disableDirectComposition: false, stripSteamAppIdTxt: true },
  native: { addon: '' },
  build: { asar: false, verify: true },
};

const read = (object, dotted) =>
  dotted.split('.').reduce((current, key) => (current == null ? undefined : current[key]), object);

window.wglexe = {
  boot: async () => ({
    groups: STUB_GROUPS.map((group) => ({
      ...group,
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
    state: { settings: STUB_SETTINGS, lastSource: '', lastOutput: '', activePreset: 'Steam (default)' },
    presets: [
      { file: 'Steam (default).json', name: 'Steam (default)' },
      { file: 'Browser build.json', name: 'Browser build' },
    ],
    paths: {},
    runtime: { ok: true, problems: [] },
  }),

  warnings: async (settings) => {
    const warnings = [];
    for (const group of STUB_GROUPS) {
      for (const field of group.fields) {
        if (!field.warning) continue;
        const value = read(settings, field.key);
        const triggered =
          field.warnWhen === '!default' ? value !== 'default' : value === field.warnWhen;
        if (triggered) warnings.push({ key: field.key, label: field.label, text: field.warning });
      }
    }
    return warnings;
  },

  validateSource: async (dir) => ({
    ok: true,
    problems: [],
    info: { productName: 'Preview Game', version: '1.0.0', electronVersion: '32.3.3' },
  }),
  pickFolder: async () => 'C:\\preview\\folder',
  pickIcon: async () => 'C:\\preview\\icon.ico',
  saveState: async () => ({}),
  loadPreset: async () => JSON.parse(JSON.stringify(STUB_SETTINGS)),
  savePreset: async () => [{ file: 'Steam (default).json', name: 'Steam (default)' }],
  reveal: async () => {},
  package: async () => ({ ok: true, exePath: 'C:\\preview\\Game.exe', checks: [] }),
  onLog: () => {},
};
