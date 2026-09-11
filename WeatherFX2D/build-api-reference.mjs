/**
 * Generates API_REFERENCE.md from the built WeatherFX2D.json.
 *
 * The reference is derived rather than written so it cannot drift from the extension: every
 * property, parameter and default shown is the one that actually ships.
 *
 * Run: node WeatherFX2D/build-api-reference.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = JSON.parse(fs.readFileSync(path.join(here, 'WeatherFX2D.json'), 'utf8'));

const PARAM_TYPE = {
  expression: 'number', string: 'string', yesorno: 'yes/no',
  color: 'colour', layer: 'layer', stringWithSelector: 'choice',
};

const escapePipes = (text) => String(text).replace(/\|/g, '\\|');

const out = [];
const w = (line = '') => out.push(line);

w(`# Weather FX 2D — API reference`);
w();
w(`Generated from \`WeatherFX2D.json\` v${extension.version} by \`build-api-reference.mjs\`.`);
w(`Do not edit by hand — rerun the generator instead.`);
w();
w(extension.shortDescription);
w();
w('---');
w();

function parameterTable(fn, isBehaviorFunction) {
  let rows = fn.parameters || [];
  if (isBehaviorFunction) {
    rows = rows.filter((p) => p.type !== 'object' && p.type !== 'behavior');
  }
  if (!rows.length) {
    w('*No parameters.*');
    w();
    return;
  }
  w('| Parameter | Type | Description |');
  w('| :--- | :--- | :--- |');
  for (const p of rows) {
    let type = PARAM_TYPE[p.type] || p.type;
    if (p.type === 'stringWithSelector') {
      const options = JSON.parse(p.supplementaryInformation || '[]');
      type = 'choice: ' + options.map((o) => `\`${o}\``).join(', ');
    }
    let description = p.description || '';
    if (p.defaultValue) description += ` (default \`${p.defaultValue}\`)`;
    w(`| \`${p.name}\` | ${type} | ${escapePipes(description)} |`);
  }
  w();
}

function emitFunctions(functions, isBehaviorFunction, expressionPrefix) {
  const byKind = new Map();
  for (const fn of functions) {
    if (fn.private) continue;
    if (!byKind.has(fn.functionType)) byKind.set(fn.functionType, []);
    byKind.get(fn.functionType).push(fn);
  }
  for (const kind of ['Action', 'Condition', 'Expression']) {
    const group = byKind.get(kind);
    if (!group) continue;
    w(`#### ${kind}s`);
    w();
    for (const fn of group) {
      w(`##### ${fn.fullName}`);
      w();
      if (fn.sentence) {
        w(`> ${fn.sentence}`);
        w();
      }
      w(fn.description);
      w();
      if (kind === 'Expression') {
        w(`Returns a **${fn.expressionType || 'number'}**. `
          + `Call as \`${expressionPrefix}${fn.name}(...)\`.`);
        w();
      }
      parameterTable(fn, isBehaviorFunction);
    }
  }
}

w('## Behaviors');
w();
for (const behavior of extension.eventsBasedBehaviors) {
  w(`### ${behavior.fullName}`);
  w();
  w(`Internal name: \`${behavior.name}\``);
  w();
  w(behavior.description);
  w();
  w('#### Properties');
  w();

  // GDevelop sorts properties alphabetically by name and opens each group the first time it meets
  // one, so this is the order they really appear in the editor panel.
  const sorted = [...behavior.propertyDescriptors].sort((a, b) => (a.name < b.name ? -1 : 1));
  const groupOrder = [];
  for (const property of sorted) {
    if (!groupOrder.includes(property.group)) groupOrder.push(property.group);
  }

  for (const group of groupOrder) {
    w(`**${group}**`);
    w();
    w('| Property | Type | Default | Description |');
    w('| :--- | :--- | :--- | :--- |');
    for (const property of sorted.filter((p) => p.group === group)) {
      let type = property.type;
      if (type === 'Choice') {
        type = 'choice: ' + (property.extraInformation || []).map((o) => `\`${o}\``).join(', ');
      }
      w(`| ${property.label} | ${type} | \`${property.value}\` | ${escapePipes(property.description)} |`);
    }
    w();
  }

  emitFunctions(behavior.eventsFunctions, true, 'Object.Behavior::');
  w('---');
  w();
}

w('## Free functions (no behavior needed)');
w();
emitFunctions(extension.eventsFunctions, false, `${extension.name}::`);

const markdown = out.join('\n');
const outPath = path.join(here, 'API_REFERENCE.md');

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing !== markdown) {
    console.error('\nAPI_REFERENCE.md is stale. Run node WeatherFX2D/build-api-reference.mjs\n');
    process.exit(1);
  }
  console.log(`\nVerified API_REFERENCE.md (${(markdown.length / 1024).toFixed(1)} KB)`);
} else {
  fs.writeFileSync(outPath, markdown, 'utf8');
  console.log(`\nBuilt API_REFERENCE.md (${(markdown.length / 1024).toFixed(1)} KB)`);
}
