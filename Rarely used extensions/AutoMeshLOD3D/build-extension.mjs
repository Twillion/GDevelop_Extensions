/**
 * build-extension.mjs
 * Builds AutoMeshLOD3D.json from the runtime engine + worker + declarations.
 *
 * Run: node AutoMeshLOD3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Read worker, runtime, and icon
const workerSrc = fs.readFileSync(path.join(here, 'AutoMeshLOD3D.worker.js'), 'utf8');
const rawRuntime = fs.readFileSync(path.join(here, 'AutoMeshLOD3D.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

// Inject worker source code into runtime
const runtime = `${workerSrc}\nconst __AUTOMESH_WORKER_CODE__ = ${JSON.stringify(workerSrc)};\n${rawRuntime}`;

const NS = 'gdjs.__autoMeshLOD3D';

/** Object + Behavior are always the first two parameters of a behavior function. */
const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });

/** Standard preamble for behavior actions/conditions/expressions */
const PREAMBLE = `const __amlObjects = eventsFunctionContext.getObjects("Object");
const object = __amlObjects.length ? __amlObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const AML = ${NS};
const state = AML.getState(behavior);
`;

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const fn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

/* ------------------------------------------------------------------ Lifecycle */

const lifecycle = [
  {
    name: 'onCreated',
    fullName: 'onCreated',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OB],
    events: ev(`${runtime}
const __amlObjects = eventsFunctionContext.getObjects("Object");
const object = __amlObjects.length ? __amlObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${NS}.initialize(object, behavior);
`),
  },
  {
    name: 'doStepPreEvents',
    fullName: 'doStepPreEvents',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OB],
    events: ev(`${runtime}
const __amlObjects = eventsFunctionContext.getObjects("Object");
const object = __amlObjects.length ? __amlObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${NS}.step(runtimeScene, object, behavior);
`),
  },
  {
    name: 'onDestroy',
    fullName: 'onDestroy',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OB],
    events: ev(`const __amlObjects = eventsFunctionContext.getObjects("Object");
const object = __amlObjects.length ? __amlObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${NS}.dispose(behavior);
`),
  },
];

/* ------------------------------------------------------------------ Actions */

const G_SETTINGS = 'LOD Settings';
const G_OVERRIDE = 'LOD Overrides';

const actions = [
  fn('SetLOD1Distance', 'Set LOD 1 distance',
    'Set LOD 1 distance on _PARAM0_ to _PARAM2_',
    'Dynamically adjust the camera distance threshold for Level 1 mesh simplification.',
    'Action', [num('Distance', 'LOD 1 distance in meters', '25')],
    `state.lod1Distance = Math.max(0.1, eventsFunctionContext.getArgument("Distance"));\n`,
    { group: G_SETTINGS }),

  fn('SetLOD2Distance', 'Set LOD 2 distance',
    'Set LOD 2 distance on _PARAM0_ to _PARAM2_',
    'Dynamically adjust the camera distance threshold for Level 2 mesh simplification.',
    'Action', [num('Distance', 'LOD 2 distance in meters', '60')],
    `state.lod2Distance = Math.max(state.lod1Distance, eventsFunctionContext.getArgument("Distance"));\n`,
    { group: G_SETTINGS }),

  fn('SetShadowCutoffDistance', 'Set shadow cutoff distance',
    'Set shadow cutoff distance on _PARAM0_ to _PARAM2_',
    'Dynamically adjust the distance threshold beyond which real-time shadow casting is disabled.',
    'Action', [num('Distance', 'Shadow cutoff distance in meters', '40')],
    `state.shadowCutoffDistance = Math.max(0.1, eventsFunctionContext.getArgument("Distance"));\n`,
    { group: G_SETTINGS }),

  fn('ForceLODLevel', 'Force LOD level',
    'Force LOD Level on _PARAM0_ to _PARAM2_ (-1 = Auto, 0 = Full, 1 = Med, 2 = Low)',
    'Manually lock the mesh to a specific LOD tier (0 = Full, 1 = Med, 2 = Low, -1 = Auto/Dynamic).',
    'Action', [num('Level', 'Target LOD Level (-1 for Auto, 0 = Full, 1 = Med, 2 = Low)', '-1')],
    `state.forcedLOD = Math.floor(eventsFunctionContext.getArgument("Level"));\n`,
    { group: G_OVERRIDE }),

  fn('SetEnabled', 'Enable / Disable AutoMeshLOD',
    'Enable AutoMeshLOD evaluation on _PARAM0_: _PARAM2_',
    'Enable or disable dynamic LOD decimation and throttling on this object instance.',
    'Action', [bool('Enabled', 'Enable dynamic LOD evaluation')],
    `state.enabled = !!eventsFunctionContext.getArgument("Enabled");\n`,
    { group: G_SETTINGS }),

  fn('SetDebugLogs', 'Enable debug console logging',
    'Enable debug console logging on _PARAM0_: _PARAM2_',
    'Enable or disable real-time LOD transition and face count logging in the developer console.',
    'Action', [bool('Enabled', 'Enable console logs')],
    `state.debugLogs = !!eventsFunctionContext.getArgument("Enabled");\n`,
    { group: G_SETTINGS }),
];

/* ------------------------------------------------------------------ Conditions */

const G_CONDITIONS = 'LOD State';

const conditions = [
  fn('CurrentLODIs', 'Current LOD level is',
    'Current LOD level of _PARAM0_ is _PARAM2_',
    'Checks if the object is currently rendering at the specified LOD tier (0, 1, or 2).',
    'Condition', [num('Level', 'LOD Level (0 = Full, 1 = Med, 2 = Low)', '0')],
    `eventsFunctionContext.returnValue = (state.currentLOD === Math.floor(eventsFunctionContext.getArgument("Level")));\n`,
    { group: G_CONDITIONS }),

  fn('IsDecimationReady', 'Is mesh decimation ready',
    'Mesh decimation is ready on _PARAM0_',
    'Returns true if the background worker has finished computing the simplified index buffers for this object.',
    'Condition', [],
    `eventsFunctionContext.returnValue = !!state.decimationReady;\n`,
    { group: G_CONDITIONS }),

  fn('IsCastingShadow', 'Is casting shadow',
    '_PARAM0_ is currently casting shadow',
    'Returns true if the object is within shadow casting distance and has active shadows.',
    'Condition', [],
    `eventsFunctionContext.returnValue = !!state.isCastingShadow;\n`,
    { group: G_CONDITIONS }),

  fn('IsEnabled', 'Is AutoMeshLOD enabled',
    'AutoMeshLOD is enabled on _PARAM0_',
    'Returns true if dynamic LOD evaluation is currently active on this instance.',
    'Condition', [],
    `eventsFunctionContext.returnValue = !!state.enabled;\n`,
    { group: G_CONDITIONS }),

  fn('IsDebugLogsEnabled', 'Is debug logging enabled',
    'Debug console logging is enabled on _PARAM0_',
    'Returns true if debug console logging is active for this instance.',
    'Condition', [],
    `eventsFunctionContext.returnValue = !!state.debugLogs;\n`,
    { group: G_CONDITIONS }),
];

/* ------------------------------------------------------------------ Expressions */

const G_EXPRESSIONS = 'LOD Metrics';

const expressions = [
  fn('CurrentLOD', 'Current LOD level', '',
    'Returns the active integer LOD tier (0 = Full, 1 = Med, 2 = Low).',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.currentLOD || 0;\n`,
    { group: G_EXPRESSIONS }),

  fn('ActiveTriangleCount', 'Active triangle count', '',
    'Returns the exact number of triangles currently being rendered for this instance.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.activeTriangles || 0;\n`,
    { group: G_EXPRESSIONS }),

  fn('OriginalTriangleCount', 'Original triangle count', '',
    'Returns the base high-poly triangle count for this instance.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.originalTriangles || 0;\n`,
    { group: G_EXPRESSIONS }),

  fn('CameraDistance', 'Camera distance', '',
    'Returns current Euclidean distance from the active 3D camera.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.cameraDistance || 0;\n`,
    { group: G_EXPRESSIONS }),

  fn('LOD1Distance', 'LOD 1 distance', '',
    'Returns the LOD 1 distance threshold in meters.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.lod1Distance || 25;\n`,
    { group: G_EXPRESSIONS }),

  fn('LOD2Distance', 'LOD 2 distance', '',
    'Returns the LOD 2 distance threshold in meters.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.lod2Distance || 60;\n`,
    { group: G_EXPRESSIONS }),

  fn('ShadowCutoffDistance', 'Shadow cutoff distance', '',
    'Returns the shadow cutoff distance threshold in meters.',
    'Expression', [],
    `eventsFunctionContext.returnValue = state.shadowCutoffDistance || 40;\n`,
    { group: G_EXPRESSIONS }),

  fn('LastError', 'Last error', '',
    'Returns the last decimation or runtime error reported by this behavior.',
    'StringExpression', [],
    `eventsFunctionContext.returnValue = state.lastError || '';\n`,
    { group: G_EXPRESSIONS }),
];

/* ------------------------------------------------------------------ Behavior Definition */

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const behavior = {
  name: 'AutoMeshLOD3D',
  fullName: 'Auto Mesh LOD 3D',
  description:
    'Automated runtime single-mesh Level of Detail (LOD) decimation and multi-tier throttling for GDevelop 3D models. ' +
    'Generates low-poly index buffers in background Web Workers while sharing GPU vertex memory.',
  objectType: 'Scene3D::Model3DObject',
  propertyDescriptors: [
    prop('Enabled', 'Boolean', 'Enabled',
      'Enable or disable dynamic LOD evaluation.', 'true'),
    prop('LOD1Distance', 'Number', 'LOD 1 Distance (m)',
      'Camera distance (in meters) to trigger Level 1 simplification.', '25'),
    prop('LOD1Ratio', 'Number', 'LOD 1 Triangle Ratio',
      'Target triangle ratio for LOD 1 (0.5 = 50% of original triangles).', '0.5'),
    prop('LOD2Distance', 'Number', 'LOD 2 Distance (m)',
      'Camera distance (in meters) to trigger Level 2 simplification.', '60'),
    prop('LOD2Ratio', 'Number', 'LOD 2 Triangle Ratio',
      'Target triangle ratio for LOD 2 (0.2 = 20% of original triangles).', '0.2'),
    prop('ShadowCutoffDistance', 'Number', 'Shadow Cutoff Distance (m)',
      'Distance beyond which real-time shadow casting (castShadow) is disabled.', '40'),
    prop('EvaluationMode', 'Choice', 'Evaluation Mode',
      'Evaluation method: Linear Euclidean Distance or Projected Screen Pixel Coverage.', 'Distance',
      { extraInformation: ['Distance', 'ScreenCoverage'] }),
    prop('ThrottleAnimation', 'Boolean', 'Throttle Skeletal Animation',
      'Throttle skeletal rig matrix updates for distant animated models (LOD1: 30 FPS, LOD2: 15 FPS).', 'true'),
    prop('PreserveSeams', 'Boolean', 'Preserve UV & Boundary Seams',
      'Strictly preserve UV and material seam boundaries during edge collapse.', 'true'),
    prop('DebugLogs', 'Boolean', 'Debug Console Logs',
      'Log real-time LOD tier transitions, face counts, and decimation benchmarks to the browser/GDevelop developer console.', 'true'),
  ],
  eventsFunctions: [...lifecycle, ...actions, ...conditions, ...expressions],
};

/* ------------------------------------------------------------------ Global Functions */

const globalFunctions = [
  {
    name: 'onFirstSceneLoaded',
    functionType: 'Action',
    private: true,
    events: [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode: runtime }],
    parameters: [],
  },
  {
    name: 'SetGlobalLODBias',
    functionType: 'Action',
    fullName: 'Set global LOD bias',
    sentence: 'Set global 3D LOD distance bias to _PARAM0_',
    description: 'Multiplies all LOD distances across the scene by a global bias (e.g. 1.5 for high-end PCs, 0.7 for mobile).',
    group: 'AutoMesh Global',
    parameters: [num('Bias', 'Global LOD bias multiplier (e.g. 1.0)', '1.0')],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `if (${NS}) ${NS}.setGlobalLODBias(eventsFunctionContext.getArgument("Bias"));\n`,
    }],
  },
  {
    name: 'PrecomputeLOD',
    functionType: 'Action',
    fullName: 'Precompute LOD for object',
    sentence: 'Precompute AutoMesh LOD index buffers for _PARAM0_',
    description: 'Immediately extracts and submits object geometry to the worker queue at level start.',
    group: 'AutoMesh Global',
    parameters: [{ name: 'Object', type: 'object', description: '3D object' }],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `if (!${NS}) return;
const objects = eventsFunctionContext.getObjects("Object");
for (let i = 0; i < objects.length; i++) {
  const obj = objects[i];
  if (obj && typeof obj.getBehavior === 'function') {
    const beh = obj.getBehavior("AutoMeshLOD3D") || obj.getBehavior("AutoMeshLOD");
    if (beh) ${NS}.precomputeLOD(obj, beh);
  }
}
`,
    }],
  },
  {
    name: 'ClearLODCache',
    functionType: 'Action',
    fullName: 'Clear LOD geometry cache',
    sentence: 'Clear AutoMesh LOD shared geometry cache',
    description: 'Clears the in-memory shared index buffer cache to free RAM.',
    group: 'AutoMesh Global',
    parameters: [],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `if (${NS}) ${NS}.clearLODCache();\n`,
    }],
  },
  {
    name: 'GetPendingJobCount',
    functionType: 'Expression',
    fullName: 'Get pending decimation job count',
    description: 'Returns the number of mesh decimation tasks currently queued in the background worker pool.',
    group: 'AutoMesh Global',
    parameters: [],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `eventsFunctionContext.returnValue = ${NS} ? ${NS}.getPendingJobCount() : 0;\n`,
    }],
  },
  {
    name: 'GetTotalTrianglesSaved',
    functionType: 'Expression',
    fullName: 'Get total triangles saved',
    description: 'Returns the real-time sum of triangles saved across all active AutoMeshLOD3D instances in the scene.',
    group: 'AutoMesh Global',
    parameters: [],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `eventsFunctionContext.returnValue = ${NS} ? ${NS}.getTotalTrianglesSaved() : 0;\n`,
    }],
  },
  {
    name: 'GetGlobalLODBias',
    functionType: 'Expression',
    fullName: 'Get global LOD bias',
    description: 'Returns the current global LOD distance bias multiplier.',
    group: 'AutoMesh Global',
    parameters: [],
    events: [{
      type: 'BuiltinCommonInstructions::JsCode',
      inlineCode: `eventsFunctionContext.returnValue = ${NS} ? ${NS}.getGlobalLODBias() : 1.0;\n`,
    }],
  },
];

/* ------------------------------------------------------------------ Extension Manifest */

const extension = {
  author: 'Twillion',
  category: '3D',
  extensionNamespace: '',
  fullName: 'Auto Mesh LOD 3D',
  name: 'AutoMeshLOD3D',
  version: '1.0.0',
  shortDescription: 'Automated runtime single-mesh Level of Detail (LOD) simplification and throttling with Web Worker decimation and shared GPU vertex memory.',
  description: `**AutoMeshLOD3D** is an automated Level of Detail (LOD) extension for **GDevelop 5 (WebGL2 / Three.js backend)**.

Instead of requiring 3D artists to manually create, decimate, and export multiple .glb models in Blender, AutoMeshLOD3D takes a single 3D model and automatically generates optimized lower-polygon index buffers in the background at runtime.

### Key Highlights:
- **1 Single Model In → Multi-Tier LOD Out:** No manual multi-asset authoring required.
- **Shared Vertex Memory:** All LOD levels share the original vertex positions, UV coordinates, normals, and skeletal bone weights—saving up to 70% VRAM compared to traditional multi-mesh LOD.
- **Asynchronous Web Worker Processing:** Quadric Error Metric (QEM) edge collapse decimation runs in background worker threads with zero 60 FPS frame drops during scene loading.
- **Skeletal Rig Preservation:** Simplifies animated characters without breaking skin weights or bone bindings.
- **Unified Multi-Throttling:** Automatically couples geometry decimation with shadow cutoff and distant skeletal animation tick throttling.
- **Sniper & FOV-Proof:** Supports projected screen-pixel coverage evaluation so zoomed-in models never look low-poly.`,
  helpPath: '',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  tags: [
    '3D', 'LOD', 'mesh', 'decimation', 'optimization', 'performance',
    'quadric', 'QEM', 'shadow', 'throttling', 'model', 'glTF', 'glb'
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: globalFunctions,
  eventsFunctionsFolderStructure: {
    folderName: '__ROOT',
    children: [],
  },
  eventsBasedBehaviors: [behavior],
  eventsBasedObjects: [],
};

/* ------------------------------------------------------------------ Validation & Export */

const isForbiddenCode = (code) =>
  code < 9 || code === 11 || code === 12 || (code >= 14 && code < 32);

const findControlChar = (text) => {
  for (let i = 0; i < text.length; i++) {
    if (isForbiddenCode(text.charCodeAt(i))) return i;
  }
  return -1;
};

const checkControlChars = (text, where) => {
  const at = findControlChar(text);
  if (at < 0) return;
  const upto = text.slice(0, at);
  const line = upto.split('\n').length;
  const col = at - upto.lastIndexOf('\n');
  const code = text.charCodeAt(at).toString(16).padStart(4, '0');
  console.error(
    `\nControl character U+${code} in ${where} at line ${line}, column ${col}.\n`
  );
  process.exit(1);
};

checkControlChars(workerSrc, 'AutoMeshLOD3D.worker.js');
checkControlChars(rawRuntime, 'AutoMeshLOD3D.runtime.js');

let blocks = 0;
const walkEvents = (fns, where) => {
  for (const f of fns) {
    for (const e of f.events) {
      blocks++;
      checkControlChars(e.inlineCode, `${where}.${f.name} inlineCode`);
      try {
        new Function('runtimeScene', 'eventsFunctionContext', e.inlineCode);
      } catch (err) {
        console.error(`\nSyntax error in ${where}.${f.name}:\n  ${err.message}\n`);
        process.exit(1);
      }
    }
  }
};

walkEvents(behavior.eventsFunctions, behavior.name);
walkEvents(extension.eventsFunctions, 'extension.eventsFunctions');

const json = JSON.stringify(extension, null, 2);

const BAD_KEYS = [
  ['"properties"', 'behaviors serialize "propertyDescriptors", not "properties"'],
  ['"extraInfo"', 'properties use "extraInformation"; parameters use "supplementaryInformation"'],
  ['"type": "resource"', '"resource" is not a registered parameter type; use model3DResource'],
];
for (const [needle, why] of BAD_KEYS) {
  if (json.includes(needle)) {
    console.error(`\nSchema lint failed: found ${needle} — ${why}\n`);
    process.exit(1);
  }
}

const VALID_PARAM_TYPES = new Set([
  'object', 'behavior', 'objectList', 'expression', 'string', 'yesorno',
  'model3DResource', 'imageResource', 'stringWithSelector', 'color', 'layer',
]);

for (const f of behavior.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on behavior ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

for (const f of extension.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on global ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

const out = path.join(here, 'AutoMeshLOD3D.json');
fs.writeFileSync(out, json, 'utf8');

const behaviorCounts = behavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const globalCounts = extension.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\n========================================`);
console.log(` Successfully built ${path.basename(out)}`);
console.log(` Output size: ${(json.length / 1024).toFixed(1)} KB`);
console.log(` Validated: ${blocks} JavaScript blocks parsed clean`);
console.log(` Behavior functions: ${JSON.stringify(behaviorCounts)}`);
console.log(` Global functions:   ${JSON.stringify(globalCounts)}`);
console.log(`========================================\n`);
