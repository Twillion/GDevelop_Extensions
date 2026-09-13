'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Answers "is this folder a GDevelop Electron export?" — and when it isn't, says
 * which file was missing rather than "invalid project".
 */

const REQUIRED = [
  { file: 'main.js', why: 'the Electron entry point GDevelop emits' },
  { file: 'package.json', why: 'the Electron project manifest' },
  { file: path.join('app', 'index.html'), why: 'the exported game itself' },
];

function validateSource(sourceDir) {
  const problems = [];

  if (!sourceDir) {
    return { ok: false, problems: ['No project folder selected.'], info: {} };
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return { ok: false, problems: [`${sourceDir} is not a folder.`], info: {} };
  }

  for (const entry of REQUIRED) {
    if (!fs.existsSync(path.join(sourceDir, entry.file))) {
      problems.push(`Missing ${entry.file} — ${entry.why}.`);
    }
  }

  const info = {};
  if (problems.length === 0) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8')
      );
      info.productName = manifest.productName || manifest.name || '';
      info.version = manifest.version || '';
      info.electronVersion =
        (manifest.devDependencies && manifest.devDependencies.electron) || '';
    } catch (error) {
      problems.push(`package.json could not be parsed: ${error.message}`);
    }

    // GDevelop substitutes these during export. If they are still present the
    // user picked the runtime template rather than an actual export.
    const main = fs.readFileSync(path.join(sourceDir, 'main.js'), 'utf8');
    if (main.includes('GDJS_GAME_NAME') || main.includes('/*GDJS_WINDOW_WIDTH*/')) {
      info.unsubstituted = true;
    }
  }

  return { ok: problems.length === 0, problems, info };
}

/** Checks the resolved Electron template is usable. */
function validateRuntime(template) {
  if (!template) {
    return {
      ok: false,
      problems: [
        'No Electron runtime found. Either populate runtime/ (see runtime/README.md) ' +
          'or run the portable build, which uses its own Electron distribution.',
      ],
      info: {},
    };
  }
  const problems = [];
  if (!fs.existsSync(path.join(template.dir, template.exe))) {
    problems.push(`${template.exe} is missing from ${template.dir}.`);
  }
  if (!template.manifest && !fs.existsSync(path.join(template.dir, 'resources'))) {
    problems.push(`No resources/ folder in ${template.dir} — this is not an Electron distribution.`);
  }
  return { ok: problems.length === 0, problems, info: { exe: template.exe, source: template.source } };
}

module.exports = { validateSource, validateRuntime, REQUIRED };
