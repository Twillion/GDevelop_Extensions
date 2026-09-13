'use strict';

/**
 * The Settings screen is generated from the schema the main process sends, so
 * adding a toggle means editing core/schema.js only. Two rules are enforced
 * here and must survive any redesign:
 *
 *   1. Every field with a `warning` shows it inline when triggered.
 *   2. Nothing in this UI can disable GDevelop's Steam Input gamepad fix — it
 *      is not in the schema at all, so it cannot be rendered as a toggle.
 */

const $ = (selector) => document.querySelector(selector);

let boot = null;
let settings = {};
let sourceDir = '';
let outputDir = '';
let lastExePath = '';

const get = (object, dotted) =>
  dotted.split('.').reduce((current, key) => (current == null ? undefined : current[key]), object);

function set(object, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  let cursor = object;
  for (const key of keys) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
}

// --- Settings screen -------------------------------------------------------

function buildSettingsUI() {
  const host = $('#settings-groups');
  host.textContent = '';

  for (const group of boot.groups) {
    const section = document.createElement('section');
    section.className = 'group';

    const heading = document.createElement('h3');
    heading.textContent = group.title;
    section.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'group-body';

    for (const field of group.fields) {
      body.appendChild(buildField(field));
    }
    section.appendChild(body);
    host.appendChild(section);
  }
  refreshWarnings();
}

function buildField(field) {
  const row = document.createElement('div');
  row.className = 'setting';

  const main = document.createElement('div');
  main.className = 'setting-main';

  const label = document.createElement('label');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = field.label;

  let input;
  if (field.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(get(settings, field.key));
    label.append(input, name);
    main.appendChild(label);
  } else if (field.type === 'enum') {
    input = document.createElement('select');
    for (const option of field.options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      input.appendChild(element);
    }
    input.value = get(settings, field.key);
    label.appendChild(name);
    main.append(label, input);
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : 'text';
    input.value = get(settings, field.key) ?? '';
    if (field.placeholder) input.placeholder = field.placeholder;
    label.appendChild(name);
    main.append(label, input);
    if (field.type === 'path') {
      const browse = document.createElement('button');
      browse.textContent = 'Browse…';
      browse.addEventListener('click', async () => {
        const picked = await window.wglexe.pickIcon();
        if (picked) {
          input.value = picked;
          input.dispatchEvent(new Event('change'));
        }
      });
      main.appendChild(browse);
    }
  }

  row.appendChild(main);

  if (field.help) {
    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = field.help;
    row.appendChild(help);
  }

  if (field.warning) {
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.dataset.for = field.key;
    warning.textContent = field.warning;
    warning.hidden = true;
    row.appendChild(warning);
  }

  const onChange = () => {
    let value;
    if (field.type === 'boolean') value = input.checked;
    else if (field.type === 'number') value = Number(input.value);
    else value = input.value;
    set(settings, field.key, value);
    persist();
    refreshWarnings();
  };
  input.addEventListener('change', onChange);
  if (input.type === 'text' || input.type === 'number') input.addEventListener('input', onChange);

  return row;
}

async function refreshWarnings() {
  const warnings = await window.wglexe.warnings(settings);
  const active = new Set(warnings.map((warning) => warning.key));

  for (const element of document.querySelectorAll('.setting .warning')) {
    element.hidden = !active.has(element.dataset.for);
  }

  const strip = $('#warning-strip');
  strip.textContent = '';
  if (warnings.length === 0) {
    strip.hidden = true;
  } else {
    strip.hidden = false;
    for (const warning of warnings) {
      const paragraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${warning.label}: `;
      paragraph.append(strong, document.createTextNode(warning.text));
      strip.appendChild(paragraph);
    }
  }
}

// --- Package screen --------------------------------------------------------

function log(entry) {
  const line = document.createElement('div');
  line.className = entry.level;
  line.textContent = entry.level === 'step' ? `> ${entry.text}` : entry.text;
  const host = $('#log');
  host.appendChild(line);
  host.scrollTop = host.scrollHeight;
}

async function setSource(dir) {
  sourceDir = dir || '';
  $('#source-dir').value = sourceDir;
  const status = $('#source-status');
  if (!sourceDir) {
    status.textContent = '';
    status.className = 'status';
  } else {
    const result = await window.wglexe.validateSource(sourceDir);
    if (result.ok && result.info.unsubstituted) {
      status.className = 'status bad';
      status.textContent =
        'This is GDevelop\'s runtime template, not an export — its GDJS_ placeholders ' +
        'are still in place. Export the game from GDevelop first.';
    } else if (result.ok) {
      status.className = 'status good';
      const info = result.info;
      status.textContent =
        `GDevelop Electron export: ${info.productName || '(unnamed)'} ${info.version || ''}` +
        (info.electronVersion ? ` — electron ${info.electronVersion}` : '');
    } else {
      status.className = 'status bad';
      status.textContent = result.problems.join('\n');
    }
  }
  persist();
  updatePackageButton();
}

function updatePackageButton() {
  const sourceOk = $('#source-status').classList.contains('good');
  const runtimeOk = boot && boot.runtime.ok;
  $('#package-button').disabled = !(sourceOk && runtimeOk && outputDir);
}

async function persist() {
  await window.wglexe.saveState({
    settings,
    lastSource: sourceDir,
    lastOutput: outputDir,
    activePreset: $('#preset-select').value || '',
  });
}

async function runPackage() {
  $('#log').textContent = '';
  $('#checks').textContent = '';
  $('#checks').hidden = true;
  $('#checks-heading').hidden = true;
  $('#reveal-button').hidden = true;
  $('#package-button').disabled = true;
  $('#package-status').className = 'status';
  $('#package-status').textContent = 'Packaging…';

  const result = await window.wglexe.package({ sourceDir, outputDir, settings });

  lastExePath = result.exePath || '';
  if (result.checks) {
    const list = $('#checks');
    for (const check of result.checks) {
      const item = document.createElement('li');
      item.className = check.ok ? 'pass' : 'fail';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = check.ok ? 'pass' : 'FAIL';
      const label = document.createElement('span');
      label.textContent = check.label;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = check.detail;
      item.append(mark, label, detail);
      list.appendChild(item);
    }
    list.hidden = false;
    $('#checks-heading').hidden = false;
  }

  const status = $('#package-status');
  if (result.ok) {
    status.className = 'status good';
    status.textContent = 'Packaged and verified.';
    $('#reveal-button').hidden = !lastExePath;
  } else {
    status.className = 'status bad';
    status.textContent = result.error || 'Packaging failed — see the log and checks above.';
  }
  updatePackageButton();
}

// --- Wiring ----------------------------------------------------------------

async function init() {
  boot = await window.wglexe.boot();
  settings = boot.state.settings;
  sourceDir = boot.state.lastSource || '';
  outputDir = boot.state.lastOutput || '';
  $('#output-dir').value = outputDir;

  const presetSelect = $('#preset-select');
  for (const preset of boot.presets) {
    const option = document.createElement('option');
    option.value = preset.file;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
  presetSelect.value =
    (boot.presets.find((preset) => preset.name === boot.state.activePreset) || {}).file || '';
  $('#preset-label').textContent = presetSelect.selectedOptions.length
    ? `Preset: ${presetSelect.selectedOptions[0].textContent}`
    : '';

  const runtimeStatus = $('#runtime-status');
  if (boot.runtime.ok) {
    runtimeStatus.className = 'status';
    runtimeStatus.textContent = 'Electron runtime template: ready.';
  } else {
    runtimeStatus.className = 'status bad';
    runtimeStatus.textContent = boot.runtime.problems.join('\n');
  }

  buildSettingsUI();
  if (sourceDir) await setSource(sourceDir);
  updatePackageButton();

  window.wglexe.onLog(log);

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((other) => other.classList.remove('is-active'));
      document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('is-active'));
      tab.classList.add('is-active');
      $(`#screen-${tab.dataset.screen}`).classList.add('is-active');
    });
  }

  $('#browse-source').addEventListener('click', async () => {
    const picked = await window.wglexe.pickFolder('Choose the exported GDevelop project');
    if (picked) await setSource(picked);
  });

  $('#browse-output').addEventListener('click', async () => {
    const picked = await window.wglexe.pickFolder('Choose the output folder');
    if (picked) {
      outputDir = picked;
      $('#output-dir').value = picked;
      persist();
      updatePackageButton();
    }
  });

  $('#output-dir').addEventListener('input', (event) => {
    outputDir = event.target.value;
    updatePackageButton();
  });

  $('#package-button').addEventListener('click', runPackage);
  $('#reveal-button').addEventListener('click', () => window.wglexe.reveal(lastExePath));

  presetSelect.addEventListener('change', async () => {
    if (!presetSelect.value) return;
    settings = await window.wglexe.loadPreset(presetSelect.value);
    buildSettingsUI();
    persist();
    $('#preset-label').textContent = `Preset: ${presetSelect.selectedOptions[0].textContent}`;
  });

  $('#save-preset').addEventListener('click', async () => {
    const name = prompt('Preset name');
    if (!name) return;
    const presets = await window.wglexe.savePreset(name, settings);
    presetSelect.textContent = '';
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.file;
      option.textContent = preset.name;
      presetSelect.appendChild(option);
    }
  });

  const drop = $('#drop-zone');
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', async (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer.files[0];
    if (file && file.path) await setSource(file.path);
  });
}

init();
