'use strict';

const fs = require('fs');
const path = require('path');
const { get } = require('./schema');

/**
 * Anchored insertion, driven entirely by patches/*.json.
 *
 * The rule this file exists to enforce: never regenerate GDevelop's main.js.
 * It carries fixes we depend on (the Steam Input workaround above all), and
 * regenerating it would silently drop whatever GDevelop adds next.
 */

class PatchError extends Error {}

function loadSpec(patchesDir, id) {
  const specPath = path.join(patchesDir, `${id}.json`);
  if (!fs.existsSync(specPath)) {
    throw new PatchError(`No patch spec at ${specPath}`);
  }
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

function loadTemplate(patchesDir, name) {
  const templatePath = path.join(patchesDir, 'templates', name);
  if (!fs.existsSync(templatePath)) {
    throw new PatchError(`No template at ${templatePath}`);
  }
  return fs.readFileSync(templatePath, 'utf8');
}

function conditionMet(operation, settings) {
  if (!operation.when) return true;
  return get(settings, operation.when.path) === operation.when.equals;
}

/** Checks the target really is what the spec expects, before touching anything. */
function check(spec, source) {
  const problems = [];
  for (const rule of spec.requires || []) {
    if (!source.includes(rule.contains)) problems.push(rule.message);
  }
  for (const rule of spec.refuseIfPresent || []) {
    if (source.includes(rule.contains)) problems.push(rule.message);
  }
  return problems;
}

function apply(spec, source, settings, patchesDir) {
  const problems = check(spec, source);
  if (problems.length) throw new PatchError(problems.join('\n'));

  let result = source;
  const applied = [];

  for (const operation of spec.operations) {
    if (!conditionMet(operation, settings)) continue;

    const text =
      operation.text !== undefined
        ? operation.text
        : loadTemplate(patchesDir, operation.templateFile);

    if (operation.type === 'replace') {
      if (!result.includes(operation.find)) {
        throw new PatchError(
          `Operation "${operation.name}": text to replace not found:\n  ${operation.find}`
        );
      }
      result = result.replace(operation.find, text);
    } else if (operation.type === 'insertAfter' || operation.type === 'insertBefore') {
      const index = result.indexOf(operation.anchor);
      if (index === -1) {
        throw new PatchError(
          `Operation "${operation.name}": anchor not found:\n  ${operation.anchor}`
        );
      }
      const at = operation.type === 'insertAfter' ? index + operation.anchor.length : index;
      result = result.slice(0, at) + text + result.slice(at);
    } else {
      throw new PatchError(`Unknown operation type "${operation.type}"`);
    }

    applied.push(operation.name);
  }

  return { source: result, applied };
}

module.exports = { loadSpec, loadTemplate, check, apply, PatchError };
