'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Finds the Electron distribution the packager assembles games from.
 *
 * Two sources, in order:
 *
 *  1. `runtime/<dist>/` — an explicit template. Use this when the game should
 *     ship on a different Electron than the tool itself runs on (see plan §5.4,
 *     the Electron bump).
 *
 *  2. The portable app's own distribution. The tool is itself an Electron 32.3.3
 *     application, so its own binaries are exactly the template it needs — which
 *     is why the portable build does not carry a second 180 MB copy.
 *
 * Self-hosting is only safe because the build writes `electron-manifest.json`
 * listing precisely which files came from the Electron distribution. Without it
 * we would have to guess which files at the app root are Electron's and which
 * are the tool's, and a wrong guess means shipping the packager's own settings
 * and presets inside someone's game.
 */

const MANIFEST = 'electron-manifest.json';

function firstDistribution(runtimeDir) {
  if (!fs.existsSync(runtimeDir)) return null;
  const candidate = fs
    .readdirSync(runtimeDir, { withFileTypes: true })
    .find(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(runtimeDir, entry.name, 'electron.exe'))
    );
  return candidate ? path.join(runtimeDir, candidate.name) : null;
}

function resolve(paths, execPath) {
  const explicit = firstDistribution(paths.runtimeDir);
  if (explicit) {
    return { dir: explicit, exe: 'electron.exe', manifest: null, source: 'runtime/' };
  }

  const manifestPath = path.join(paths.root, MANIFEST);
  if (execPath && fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(manifest.files) && manifest.files.length) {
        return {
          dir: paths.root,
          exe: path.basename(execPath),
          manifest: manifest.files,
          source: 'the application itself',
        };
      }
    } catch {
      /* fall through to "not found" */
    }
  }

  return null;
}

function describe(template) {
  if (!template) return 'no Electron runtime found';
  return `${template.source} (${template.exe})`;
}

module.exports = { resolve, firstDistribution, describe, MANIFEST };
