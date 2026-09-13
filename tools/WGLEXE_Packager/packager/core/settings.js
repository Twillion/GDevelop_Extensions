'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema');

/**
 * Portable persistence. Everything lives beside the executable: nothing is
 * written to the registry, %APPDATA%, or anywhere else. Copy the folder to a
 * USB stick and it works, with its settings, on another machine.
 */

function rootDir() {
  if (process.env.WGLEXE_ROOT) return process.env.WGLEXE_ROOT;

  // Packaged: this file lives under <app>/resources/app/, so the portable root
  // is the folder holding the executable. Detected by location rather than by
  // the presence of settings.json, which does not exist on a first run.
  if (process.resourcesPath && __dirname.startsWith(process.resourcesPath)) {
    return path.resolve(process.resourcesPath, '..');
  }

  // Development, and plain-node use of cli.js: walk up from packager/core.
  return path.resolve(__dirname, '..', '..');
}

const paths = () => {
  const root = rootDir();
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    presetsDir: path.join(root, 'presets'),
    patchesDir: path.join(root, 'patches'),
    runtimeDir: path.join(root, 'runtime'),
    toolsDir: path.join(root, 'tools'),
    vendorDir: path.join(root, 'vendor', 'node_modules'),
  };
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function load() {
  const { settingsFile } = paths();
  const raw = readJson(settingsFile, {});
  return {
    settings: schema.normalise(raw.settings || raw),
    recent: Array.isArray(raw.recent) ? raw.recent : [],
    lastSource: raw.lastSource || '',
    lastOutput: raw.lastOutput || '',
    activePreset: raw.activePreset || 'Steam (default)',
    windowBounds: raw.windowBounds || null,
  };
}

function save(state) {
  const { settingsFile } = paths();
  const payload = {
    settings: schema.normalise(state.settings),
    recent: (state.recent || []).slice(0, 10),
    lastSource: state.lastSource || '',
    lastOutput: state.lastOutput || '',
    activePreset: state.activePreset || '',
    windowBounds: state.windowBounds || null,
  };
  fs.writeFileSync(settingsFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

function listPresets() {
  const { presetsDir } = paths();
  if (!fs.existsSync(presetsDir)) return [];
  return fs
    .readdirSync(presetsDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => {
      const data = readJson(path.join(presetsDir, name), {});
      return { file: name, name: data.name || path.basename(name, '.json') };
    });
}

function loadPreset(file) {
  const { presetsDir } = paths();
  const data = readJson(path.join(presetsDir, file), null);
  if (!data) throw new Error(`Preset ${file} could not be read.`);
  return schema.normalise(data.settings || {});
}

function savePreset(name, settings) {
  const { presetsDir } = paths();
  if (!fs.existsSync(presetsDir)) fs.mkdirSync(presetsDir, { recursive: true });
  const file = `${name.replace(/[^\w .()-]/g, '_')}.json`;
  fs.writeFileSync(
    path.join(presetsDir, file),
    JSON.stringify({ name, settings: schema.normalise(settings) }, null, 2) + '\n',
    'utf8'
  );
  return file;
}

module.exports = { paths, load, save, listPresets, loadPreset, savePreset };
