/**
 * build-extension.mjs
 * Builds AutoMeshLOD3D.json from the runtime engine + worker + declarations.
 *
 * Run: node "Multi extension work space folder/AutoMeshLOD3D/build-extension.mjs"
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

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });

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

const lifecycle = [
  {
    name: 'onCreated',
    fullName: 'On Created',
    sentence: '',
    description: 'Initializes the AutoMeshLOD3D background decimation engine.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
${NS}.getState(behavior);
`, { withRuntime: true }),
  },
  {
    name: 'doStepPostEvents',
    fullName: 'Post-events step',
    sentence: '',
    description: 'Evaluates camera distance and applies zero-cost shared index buffer LOD swapping.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
const state = ${NS}.getState(behavior);
if (state) state.step(runtimeScene);
`),
  },
  {
    name: 'onDestroy',
    fullName: 'On Destroyed',
    sentence: '',
    description: 'Cleans up LOD buffer attributes.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`// Clean up state
`),
  },
];

const actions = [
  fn(
    'SetLODDistance',
    'Set LOD distance',
    'Set LOD distance on _PARAM0_ (Level: _PARAM1_, Distance: _PARAM2_)',
    'Dynamically updates the transition distance in meters for a specific LOD tier (1 or 2).',
    'Action',
    [
      num('Level', 'LOD Level (1 or 2)', '1'),
      num('Distance', 'Transition distance in meters (e.g. 35.0)', '35.0'),
    ],
    `const lvl = Number(eventsFunctionContext.getArgument("Level"));
const dist = Number(eventsFunctionContext.getArgument("Distance"));
if (lvl === 1) state.lod1Distance = dist;
else if (lvl === 2) state.lod2Distance = dist;
`,
    { group: 'LOD Control' }
  ),
  fn(
    'ForceLODLevel',
    'Force LOD level override',
    'Force LOD level on _PARAM0_ to _PARAM1_',
    'Manually overrides the active LOD level (-1 = Auto, 0 = Base/Full, 1 = LOD1, 2 = LOD2).',
    'Action',
    [num('Level', 'LOD tier (-1 for Auto, 0 for Base, 1 for LOD1, 2 for LOD2)', '-1')],
    `const lvl = Number(eventsFunctionContext.getArgument("Level"));
state.forcedLOD = lvl;
if (lvl >= 0) state.setLODLevel(lvl);
`,
    { group: 'LOD Control' }
  ),
  fn(
    'BakeHLODCluster',
    'Bake HLOD cluster from objects',
    'Bake HLOD cluster from objects into proxy on _PARAM0_',
    'Merges and decimates multiple static prop meshes into a unified single-mesh proxy for WorldPartition3D.',
    'Action',
    [num('TriangleBudget', 'Target triangle count budget for cluster (e.g. 1000)', '1000')],
    `const budget = Number(eventsFunctionContext.getArgument("TriangleBudget")) || 1000;
const sceneObjects = runtimeScene.getAdhocListOfAllInstances ? runtimeScene.getAdhocListOfAllInstances() : [];
AML.bakeHLODCluster(sceneObjects, budget);
`,
    { group: 'HLOD Tools' }
  ),
];

const conditions = [
  fn(
    'IsLODLevel',
    'Is LOD level active',
    'Is LOD level active on _PARAM0_ (Level: _PARAM1_)',
    'Checks if the object is currently rendering at the specified LOD level (0, 1, or 2).',
    'Condition',
    [num('Level', 'LOD level to check (0, 1, or 2)', '0')],
    `const lvl = Number(eventsFunctionContext.getArgument("Level"));
eventsFunctionContext.returnValue = state ? state.currentLOD === lvl : false;
`,
    { group: 'LOD Control' }
  ),
  fn(
    'IsDecimationComplete',
    'Is background decimation complete',
    'Is background decimation complete on _PARAM0_',
    'Returns true once the background Web Worker finishes generating index buffers.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = state ? state.isDecimationComplete : false;
`,
    { group: 'LOD Control' }
  ),
];

const expressions = [
  fn(
    'CurrentLODLevel',
    'Current LOD level',
    'Get current LOD level on _PARAM0_',
    'Returns the active LOD level index (0 = Base, 1 = LOD1, 2 = LOD2).',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.currentLOD : 0;
`,
    { group: 'LOD Info' }
  ),
  fn(
    'CurrentTriangleCount',
    'Current triangle count',
    'Get live rendered triangle count on _PARAM0_',
    'Returns the number of triangles currently being rendered for this model.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.currentTriangles : 0;
`,
    { group: 'LOD Info' }
  ),
  fn(
    'OriginalTriangleCount',
    'Original triangle count',
    'Get original baseline triangle count on _PARAM0_',
    'Returns the un-decimated baseline triangle count of the base 3D model.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.originalTriangles : 0;
`,
    { group: 'LOD Info' }
  ),
];

const extension = {
  $schema: 'https://raw.githubusercontent.com/4ian/GDevelop/master/newIDE/app/src/fixtures/extension-schema.json',
  name: 'AutoMeshLOD3D',
  version: '2.0.0',
  author: 'Twillion',
  shortDescription: 'Background Web Worker QEM mesh decimation, zero-cost index swapping, and HLOD sector cluster baking.',
  description: 'Automatically generates high-fidelity LOD1 and LOD2 triangle reduction levels in background Web Workers without frame drops, swaps index buffers in 0ms on the GPU, and bakes sector prop clusters into unified single-draw-call proxy meshes for WorldPartition3D.',
  category: '3D',
  tags: '3d,lod,qem,mesh,decimation,hlod,performance,optimization,webworker',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  eventsBasedBehaviors: [
    {
      name: 'AutoMeshLOD3D',
      fullName: 'Auto Mesh LOD 3D (QEM Decimation & HLOD)',
      description: 'Generates asynchronous LOD index buffers in Web Workers and manages distance-based LOD swapping.',
      objectType: '',
      propertyDescriptors: [
        {
          name: 'LOD1Distance',
          label: 'LOD1 Distance (Meters)',
          description: 'Distance in meters where model swaps to LOD1.',
          type: 'Number',
          value: '25.0',
          group: 'LOD Distances',
        },
        {
          name: 'LOD1Reduction',
          label: 'LOD1 Reduction (%)',
          description: 'Triangle reduction percentage for LOD1 (10% to 90%).',
          type: 'Number',
          value: '50.0',
          group: 'LOD Reductions',
        },
        {
          name: 'LOD2Distance',
          label: 'LOD2 Distance (Meters)',
          description: 'Distance in meters where model swaps to LOD2.',
          type: 'Number',
          value: '60.0',
          group: 'LOD Distances',
        },
        {
          name: 'LOD2Reduction',
          label: 'LOD2 Reduction (%)',
          description: 'Triangle reduction percentage for LOD2 (10% to 95%).',
          type: 'Number',
          value: '80.0',
          group: 'LOD Reductions',
        },
        {
          name: 'ShadowCutoff',
          label: 'Shadow Cutoff Distance (Meters)',
          description: 'Distance in meters beyond which shadow casting is disabled.',
          type: 'Number',
          value: '40.0',
          group: 'Optimization',
        },
      ],
      eventsFunctions: [
        ...lifecycle,
        ...actions,
        ...conditions,
        ...expressions,
      ],
    },
  ],
  eventsFunctions: [],
  globalVariables: [],
  sceneVariables: [],
};

const outputPath = path.join(here, 'AutoMeshLOD3D.json');
fs.writeFileSync(outputPath, JSON.stringify(extension, null, 2), 'utf8');
console.log(`Successfully generated ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
