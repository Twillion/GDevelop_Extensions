/** Audit the packaged editor metadata independently of the declaration helpers. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const extension = JSON.parse(fs.readFileSync(new URL('./WeatherFX2D.json', import.meta.url), 'utf8'));
let functions = 0, parameters = 0, selectors = 0;
for (const owner of [extension, ...extension.eventsBasedBehaviors]) {
  const ids = new Set();
  const titles = new Set();
  for (const fn of owner.eventsFunctions) {
    const context = `${owner.name}.${fn.name}`;
    assert.ok(!ids.has(fn.name), `Duplicate ID: ${context}`);
    ids.add(fn.name);
    if (fn.private) continue;
    functions++;
    assert.ok(fn.fullName && fn.description, `Missing label/help: ${context}`);
    const titleKey = `${fn.group}/${fn.fullName}`;
    assert.ok(!titles.has(titleKey), `Indistinguishable actions: ${context}`);
    titles.add(titleKey);
    const names = new Set(), labels = new Set();
    for (const p of fn.parameters) {
      parameters++;
      assert.ok(!names.has(p.name), `Duplicate parameter: ${context}.${p.name}`);
      names.add(p.name);
      assert.ok(p.description, `Unlabelled field: ${context}.${p.name}`);
      assert.ok(!labels.has(p.description), `Duplicate field label: ${context}.${p.name}`);
      labels.add(p.description);
      if (p.type === 'stringWithSelector') {
        selectors++;
        const options = JSON.parse(p.supplementaryInformation);
        assert.equal(new Set(options).size, options.length, `Repeated choices: ${context}`);
        assert.ok(options.includes(p.defaultValue), `Invalid default: ${context}.${p.name}`);
        if (fn.name === 'SetDistortionFlag' && owner === extension) {
          assert.equal(fn.group, 'Advanced / Legacy controls');
          assert.match(fn.description, /Enable \/ disable distortion/);
        } else {
          assert.ok(options.length > 1, `Redundant selector: ${context}.${p.name}`);
        }
      }
      if (p.type === 'expression') {
        assert.ok(p.defaultValue !== undefined && p.defaultValue !== '' && Number.isFinite(Number(p.defaultValue)),
          `Invalid numeric default: ${context}.${p.name}`);
      }
      if (p.type === 'color') {
        assert.match(p.defaultValue, /^\d+;\d+;\d+$/, `Invalid colour: ${context}`);
        assert.ok(p.defaultValue.split(';').every(v => Number(v) <= 255));
      }
      if (p.type === 'yesorno' && p.defaultValue !== undefined) {
        assert.ok(['true', 'false'].includes(p.defaultValue), `Invalid toggle default: ${context}`);
      }
    }
    if (fn.functionType === 'Expression') continue;
    const offset = owner === extension ? 1 : 0;
    const slots = [...fn.sentence.matchAll(/_PARAM(\d+)_/g)].map(m => Number(m[1]));
    const expected = fn.parameters.flatMap((p, i) => p.type === 'behavior' ? [] : [i + offset]);
    assert.deepEqual(slots, expected, `Wrong sentence field mapping: ${context}`);
    // Substitute distinct values, including the hidden scene slot, as the event sheet does.
    const args = Array.from({ length: fn.parameters.length + offset }, (_, i) => `[[FIELD_${i}]]`);
    const rendered = fn.sentence.replace(/_PARAM(\d+)_/g, (_, index) => args[Number(index)]);
    assert.ok(!rendered.includes('undefined'), `Out-of-range field: ${context}`);
    assert.deepEqual([...rendered.matchAll(/\[\[FIELD_(\d+)\]\]/g)].map(m => Number(m[1])), expected);
  }
}
console.log(`UI audit passed: ${functions} public functions, ${parameters} parameters, ${selectors} selectors.`);
console.log('Only exception: the saved-event-compatible SetDistortionFlag in Legacy controls.');
