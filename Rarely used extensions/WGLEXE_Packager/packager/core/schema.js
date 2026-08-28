'use strict';

/**
 * The settings schema. This drives three things at once: the defaults, the
 * validation, and the Settings screen the GUI renders. Adding a toggle here is
 * the only edit needed to make it appear in the UI.
 *
 * Every field that trades stability for speed carries a `warning`, which the UI
 * is required to show inline. That is the whole discipline of this tool.
 */

const GROUPS = [
  {
    id: 'steam',
    title: 'Steam',
    fields: [
      {
        key: 'steam.enabled',
        label: 'Build for Steam',
        type: 'boolean',
        default: true,
        help: 'Adds steam_api64.dll and applies the Steam-specific defaults below.',
      },
      {
        key: 'steam.appId',
        label: 'App ID',
        type: 'string',
        default: '',
        placeholder: '480',
        help: 'Must also be set in GDevelop under Game Properties → Steamworks.',
      },
      {
        key: 'steam.overlayCompat',
        label: 'Steam overlay support',
        type: 'boolean',
        default: true,
        help: 'Adds --in-process-gpu.',
        warning:
          'Turning this off means the Steam overlay, screenshots and the on-screen ' +
          'keyboard will not appear over your game.',
        warnWhen: false,
      },
      {
        key: 'steam.disableDirectComposition',
        label: 'Also disable direct composition',
        type: 'boolean',
        default: false,
        help: 'Only needed if the overlay flickers. Try overlay support alone first.',
      },
      {
        key: 'steam.stripSteamAppIdTxt',
        label: 'Strip steam_appid.txt from output',
        type: 'boolean',
        default: true,
        help: 'That file is for local development only and must not reach the depot.',
        warning: 'Shipping steam_appid.txt to a depot can break the build for players.',
        warnWhen: false,
      },
    ],
  },
  {
    id: 'performance',
    title: 'Performance',
    fields: [
      {
        key: 'security.sharedArrayBuffer',
        label: 'SharedArrayBuffer',
        type: 'enum',
        default: 'flag',
        options: [
          { value: 'flag', label: 'Flag (recommended)' },
          { value: 'isolation', label: 'Cross-origin isolation' },
          { value: 'off', label: 'Off' },
        ],
        help:
          '"Flag" keeps the file:// origin and changes nothing else. ' +
          '"Cross-origin isolation" serves the game from game:// with COOP/COEP.',
        warning:
          'Cross-origin isolation disables GDevelop player authentication and ' +
          'leaderboards, and blocks any cross-origin asset without a CORP header.',
        warnWhen: 'isolation',
      },
      {
        key: 'gpu.disableVsync',
        label: 'Uncap frame rate',
        type: 'boolean',
        default: false,
        help: 'Adds --disable-gpu-vsync and --disable-frame-rate-limit.',
        warning: 'Disables v-sync. Causes visible screen tearing.',
        warnWhen: true,
      },
      {
        key: 'gpu.ignoreGpuBlocklist',
        label: 'Ignore GPU blocklist',
        type: 'boolean',
        default: false,
        help: 'Prevents Chromium falling back to software rendering.',
        warning:
          'The blocklist exists because those driver and GPU combinations crash. ' +
          'This turns a software fallback into a crash on affected machines.',
        warnWhen: true,
      },
      {
        key: 'gpu.enableDraftExtensions',
        label: 'WebGL draft extensions',
        type: 'boolean',
        default: false,
        help: 'Not needed for 3D batching — WEBGL_multi_draw is already ratified.',
      },
      {
        key: 'gpu.angleBackend',
        label: 'Graphics backend',
        type: 'enum',
        default: 'default',
        options: [
          { value: 'default', label: 'Automatic (recommended)' },
          { value: 'd3d11', label: 'Direct3D 11' },
          { value: 'd3d11on12', label: 'Direct3D 11on12' },
          { value: 'vulkan', label: 'Vulkan' },
          { value: 'gl', label: 'OpenGL' },
          { value: 'gles', label: 'OpenGL ES' },
        ],
        help: 'Automatic is already Direct3D 11 on Windows.',
        warning:
          'Forcing a backend removes Chromium’s own fallback logic and can leave ' +
          'some machines with a black screen.',
        warnWhen: (value) => value !== 'default',
      },
    ],
  },
  {
    id: 'window',
    title: 'Window',
    fields: [
      { key: 'window.title', label: 'Title', type: 'string', default: '' },
      { key: 'window.width', label: 'Width', type: 'number', default: 1280, min: 320 },
      { key: 'window.height', label: 'Height', type: 'number', default: 720, min: 240 },
      { key: 'window.minWidth', label: 'Minimum width', type: 'number', default: 640, min: 0 },
      { key: 'window.minHeight', label: 'Minimum height', type: 'number', default: 480, min: 0 },
      { key: 'window.resizable', label: 'Resizable', type: 'boolean', default: true },
      { key: 'window.fullscreen', label: 'Start fullscreen', type: 'boolean', default: false },
      {
        key: 'window.borderless',
        label: 'Borderless',
        type: 'boolean',
        default: false,
        help: 'Removes the title bar and window frame.',
      },
      {
        key: 'window.backgroundThrottling',
        label: 'Keep running when unfocused',
        type: 'boolean',
        default: false,
        invert: true,
        help: 'Stops Chromium throttling timers when the window loses focus.',
      },
    ],
  },
  {
    id: 'output',
    title: 'Output',
    fields: [
      { key: 'appName', label: 'Application name', type: 'string', default: 'GDevelopGame' },
      { key: 'version', label: 'Version', type: 'string', default: '1.0.0' },
      { key: 'executableName', label: 'Executable name', type: 'string', default: 'Game.exe' },
      {
        key: 'icon',
        label: 'Icon (.ico)',
        type: 'path',
        default: '',
        help: 'Leave blank to keep the default Electron icon.',
      },
      {
        key: 'build.asar',
        label: 'Pack game into app.asar',
        type: 'boolean',
        default: false,
        help: 'Slightly faster startup and tidier output. Makes the game harder to inspect, not secure.',
      },
      {
        key: 'build.verify',
        label: 'Verify after packaging',
        type: 'boolean',
        default: true,
        help: 'Launches the assembled build once and checks the result before reporting success.',
      },
    ],
  },
  {
    id: 'native',
    title: 'Native (advanced)',
    fields: [
      {
        key: 'security.nativeBridge',
        label: 'Native compute addon',
        type: 'boolean',
        default: false,
        help: 'Requires a wglexe.node built against this exact Electron version.',
      },
      { key: 'native.addon', label: 'Addon path (.node)', type: 'path', default: '' },
    ],
  },
];

function get(object, dottedPath) {
  return dottedPath
    .split('.')
    .reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function set(object, dottedPath, value) {
  const keys = dottedPath.split('.');
  const last = keys.pop();
  let cursor = object;
  for (const key of keys) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
  return object;
}

function allFields() {
  return GROUPS.flatMap((group) => group.fields);
}

function defaults() {
  const result = {};
  for (const field of allFields()) set(result, field.key, field.default);
  return result;
}

/** Fills in anything missing and coerces types, so a hand-edited file still loads. */
function normalise(settings) {
  const result = defaults();
  for (const field of allFields()) {
    const value = get(settings || {}, field.key);
    if (value === undefined || value === null) continue;
    if (field.type === 'number') {
      const number = Number(value);
      if (Number.isFinite(number)) set(result, field.key, number);
    } else if (field.type === 'boolean') {
      set(result, field.key, Boolean(value));
    } else if (field.type === 'enum') {
      if (field.options.some((option) => option.value === value)) {
        set(result, field.key, value);
      }
    } else {
      set(result, field.key, String(value));
    }
  }
  return result;
}

/** Warnings the UI must show for the current selection. Never silently swallowed. */
function activeWarnings(settings) {
  const warnings = [];
  for (const field of allFields()) {
    if (!field.warning) continue;
    const value = get(settings, field.key);
    const triggered =
      typeof field.warnWhen === 'function'
        ? field.warnWhen(value)
        : value === field.warnWhen;
    if (triggered) warnings.push({ key: field.key, label: field.label, text: field.warning });
  }
  return warnings;
}

/** The subset written next to main.js and read by the injected code. */
function runtimeConfig(settings) {
  return {
    window: settings.window,
    gpu: settings.gpu,
    security: { sharedArrayBuffer: settings.security.sharedArrayBuffer },
    steam: {
      enabled: settings.steam.enabled,
      overlayCompat: settings.steam.overlayCompat,
      disableDirectComposition: settings.steam.disableDirectComposition,
    },
  };
}

module.exports = { GROUPS, allFields, defaults, normalise, activeWarnings, runtimeConfig, get, set };
