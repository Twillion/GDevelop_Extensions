/**
 * Builds LightProbeGrid3D.json from the runtime engine + declarations.
 *
 * Run: node LightProbeGrid3D/build-extension.mjs
 *
 * Includes pre-build safety assertions:
 *   1. JS code blocks parsed with `new Function`
 *   2. Schema linting (propertyDescriptors, parameter types)
 *   3. Sentence parameter index bounds checking
 *   4. Duplicate function name detection
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'LightProbeGrid3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__lightProbeGrid3D';

/* ------------------------------------------------------------- Parameters */

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description, value = '') => ({
  name, type: 'string', description, ...(value ? { defaultValue: value } : {}),
});
const bool = (name, description) => ({ name, type: 'yesorno', description });
const col = (name, description, value = '') => ({
  name, type: 'color', description, ...(value ? { defaultValue: value } : {}),
});
const choice = (name, description, options) => ({
  name, type: 'stringWithSelector', description,
  supplementaryInformation: JSON.stringify(options),
});

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

/* ------------------------------------------------------------- Preambles & Code Generators */

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const evFree = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
}];

const BEHAVIOR_PREAMBLE = `const __lpgObjects = eventsFunctionContext.getObjects("Object");
const object = __lpgObjects.length ? __lpgObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const LPG = ${NS};
`;

const fn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  ...(opts.sentence ? { sentence: opts.sentence } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(BEHAVIOR_PREAMBLE + code, opts),
});

const freeFn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  ...(opts.sentence ? { sentence: opts.sentence } : {}),
  private: false,
  parameters,
  // evFree already prepends the runtime when opts.withRuntime is set. Prepending it
  // here too embedded a second, inert copy in every free function and doubled the
  // size of the generated JSON.
  events: evFree(`if (!${NS}) return;\nconst LPG = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* ========================================================= LightProbeVolume3D Behavior */

const VOL_OPTIONS = `{
  resX: behavior._getResolutionX ? behavior._getResolutionX() : 16,
  resY: behavior._getResolutionY ? behavior._getResolutionY() : 16,
  resZ: behavior._getResolutionZ ? behavior._getResolutionZ() : 4,
  skyColor: behavior._getSkyColor ? behavior._getSkyColor() : '160;200;255',
  groundColor: behavior._getGroundColor ? behavior._getGroundColor() : '80;120;50',
  horizonColor: behavior._getHorizonColor ? behavior._getHorizonColor() : '200;220;240',
  volumeIntensity: behavior._getVolumeIntensity ? behavior._getVolumeIntensity() : 1.0,
  dayNightMode: behavior._getDayNightMode ? behavior._getDayNightMode() : false,
  showDebugSpheres: behavior._getShowDebugSpheres ? behavior._getShowDebugSpheres() : false,
  autoBakeOnStart: behavior._getAutoBakeOnStart ? behavior._getAutoBakeOnStart() : false
}`;

const volumeLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.registerVolume(runtimeScene, object, behavior, ${VOL_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.updateVolume(runtimeScene, object, behavior, ${VOL_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.disposeVolume(runtimeScene, behavior);\n`),
  },
];

const G_VOL_CONFIG = 'Volume Configuration';
const G_VOL_DEBUG = 'Volume Debug';

const volumeActions = [
  fn('SetSkyColor', 'Set sky color',
    'Set sky ambient color of _PARAM0_ to _PARAM2_', 'Action',
    [col('Color', 'Sky ambient color arriving from +Z', '160;200;255')],
    `if (behavior._setSkyColor) behavior._setSkyColor(eventsFunctionContext.getArgument("Color"));
const vol = LPG.volumeOf(behavior);
if (vol) LPG.updateVolume(runtimeScene, object, behavior, { skyColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetGroundColor', 'Set ground color',
    'Set ground bounce color of _PARAM0_ to _PARAM2_', 'Action',
    [col('Color', 'Ground bounce color arriving from -Z', '80;120;50')],
    `if (behavior._setGroundColor) behavior._setGroundColor(eventsFunctionContext.getArgument("Color"));
const vol = LPG.volumeOf(behavior);
if (vol) LPG.updateVolume(runtimeScene, object, behavior, { groundColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetHorizonColor', 'Set horizon color',
    'Set horizon color of _PARAM0_ to _PARAM2_', 'Action',
    [col('Color', 'Ambient color at the horizon', '200;220;240')],
    `if (behavior._setHorizonColor) behavior._setHorizonColor(eventsFunctionContext.getArgument("Color"));
const vol = LPG.volumeOf(behavior);
if (vol) LPG.updateVolume(runtimeScene, object, behavior, { horizonColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetVolumeIntensity', 'Set volume intensity',
    'Set volume intensity of _PARAM0_ to _PARAM2_', 'Action',
    [num('Intensity', 'Ambient intensity scale for this volume', '1.0')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setVolumeIntensity) behavior._setVolumeIntensity(val);
const vol = LPG.volumeOf(behavior);
if (vol) vol.volumeIntensity = val;
`, { group: G_VOL_CONFIG }),

  fn('SetAutoBakeOnStart', 'Enable / disable auto-bake on start',
    'Enable auto-bake on start on volume _PARAM0_: _PARAM2_', 'Action',
    [bool('AutoBake', 'Automatically bake probes when scene starts')],
    `const auto = !!eventsFunctionContext.getArgument("AutoBake");
if (behavior._setAutoBakeOnStart) behavior._setAutoBakeOnStart(auto);
const vol = LPG.volumeOf(behavior);
if (vol) vol.autoBakeOnStart = auto;
`, { group: G_VOL_CONFIG }),

  fn('SetShowDebugSpheres', 'Show / hide debug probe spheres',
    'Show debug probe spheres on volume _PARAM0_: _PARAM2_', 'Action',
    [bool('Show', 'Show debug probe spheres')],
    `const show = !!eventsFunctionContext.getArgument("Show");
if (behavior._setShowDebugSpheres) behavior._setShowDebugSpheres(show);
const vol = LPG.volumeOf(behavior);
if (vol) {
  vol.showDebugSpheres = show;
  LPG.toggleDebugVisualizer(runtimeScene, show);
}
`, { group: G_VOL_DEBUG }),
];

const volumeConditions = [
  fn('IsDebugVisualizerEnabled', 'Debug probe spheres are visible',
    'Debug probe spheres are visible on volume _PARAM0_', 'Condition',
    [],
    `const vol = LPG.volumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.showDebugSpheres);
`, { group: G_VOL_DEBUG }),

  fn('IsAutoBakeOnStart', 'Auto-bake on start is enabled',
    'Auto-bake on start is enabled on volume _PARAM0_', 'Condition',
    [],
    `const vol = LPG.volumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.autoBakeOnStart);
`, { group: G_VOL_CONFIG }),
];

const volumeExpressions = [
  fn('VolumeIntensity', 'Volume intensity',
    '', 'Expression',
    [],
    `const vol = LPG.volumeOf(behavior);
eventsFunctionContext.returnValue = vol ? vol.volumeIntensity : 1.0;
`, { group: G_VOL_CONFIG }),

  fn('ProbeCount', 'Total probe count',
    '', 'Expression',
    [],
    `const vol = LPG.volumeOf(behavior);
eventsFunctionContext.returnValue = vol ? (vol.resX * vol.resY * vol.resZ) : 0;
`, { group: G_VOL_CONFIG }),
];

const volumeBehavior = {
  name: 'LightProbeVolume3D',
  fullName: 'Light Probe Volume 3D',
  description: 'Attach to a 3D Box (Cube3D) to define the spatial bounds, resolution, and ambient colors of a light probe grid. The box transform sets the volume bounds.',
  // Restricted to Cube3D: the volume reads getZ/getDepth off the object, and an
  // unrestricted behavior can be dropped on a Sprite where those do not exist.
  objectType: 'Scene3D::Cube3DObject',
  private: false,
  propertyDescriptors: [
    prop('ResolutionX', 'Number', 'Resolution X', 'Probes along world X. Clamped to [2, 64].', '16'),
    prop('ResolutionY', 'Number', 'Resolution Y', 'Probes along world Y. Clamped to [2, 64].', '16'),
    prop('ResolutionZ', 'Number', 'Resolution Z (Height)', 'Probes along world Z (Height axis). Clamped to [2, 64].', '4'),
    prop('SkyColor', 'Color', 'Sky Color', 'Ambient colour arriving from above (+Z).', '160;200;255'),
    prop('GroundColor', 'Color', 'Ground Color', 'Ambient bounce colour arriving from below (-Z).', '80;120;50'),
    prop('HorizonColor', 'Color', 'Horizon Color', 'Ambient colour at the horizon.', '200;220;240'),
    prop('VolumeIntensity', 'Number', 'Volume Intensity', 'Global ambient scale for this volume.', '1.0'),
    prop('DayNightMode', 'Boolean', 'Day / Night Mode', 'Allocate and blend a second night volume.', 'false'),
    prop('AutoBakeOnStart', 'Boolean', 'Auto-Bake On Start', 'Automatically bake scene ambient probes when scene starts.', 'false'),
    prop('ShowDebugSpheres', 'Boolean', 'Show Debug Spheres', 'Draw probe spheres in preview and runtime.', 'false'),
  ],
  eventsFunctions: [
    ...volumeLifecycle,
    ...volumeActions,
    ...volumeConditions,
    ...volumeExpressions,
  ],
};

/* ======================================================= ReceiveLightProbes Behavior */

const REC_OPTIONS = `{
  intensityMultiplier: behavior._getIntensityMultiplier ? behavior._getIntensityMultiplier() : 1.0,
  normalBias: behavior._getNormalBiasOffset ? behavior._getNormalBiasOffset() : 15.0,
  updateFrequency: behavior._getUpdateFrequency ? behavior._getUpdateFrequency() : 'Continuous',
  enabled: behavior._getEnabled ? behavior._getEnabled() : true
}`;

const receiverLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.registerReceiver(runtimeScene, object, behavior, ${REC_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.stepReceiver(runtimeScene, object, behavior);\n`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `LPG.disposeReceiver(runtimeScene, behavior);\n`),
  },
];

const G_REC_SETTINGS = 'Receiver Settings';

const receiverActions = [
  fn('SetIntensityMultiplier', 'Set intensity multiplier',
    'Set probe intensity multiplier on _PARAM0_ to _PARAM2_', 'Action',
    [num('Multiplier', 'Per-instance multiplier on indirect light', '1.0')],
    `const val = eventsFunctionContext.getArgument("Multiplier");
if (behavior._setIntensityMultiplier) behavior._setIntensityMultiplier(val);
const rec = LPG.receiverOf(behavior);
if (rec) rec.intensityMultiplier = val;
`, { group: G_REC_SETTINGS }),

  fn('SetNormalBiasOffset', 'Set normal bias offset',
    'Set normal bias offset on _PARAM0_ to _PARAM2_ world units', 'Action',
    [num('Offset', 'Offset along surface normal in world units (pixels)', '15.0')],
    `const val = eventsFunctionContext.getArgument("Offset");
if (behavior._setNormalBiasOffset) behavior._setNormalBiasOffset(val);
const rec = LPG.receiverOf(behavior);
if (rec) rec.normalBias = val;
`, { group: G_REC_SETTINGS }),

  fn('SetEnabled', 'Enable / Disable receiving light probes',
    'Enable receiving light probes on _PARAM0_: _PARAM2_', 'Action',
    [bool('Enabled', 'Enable probe sampling on this instance')],
    `const val = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(val);
const rec = LPG.receiverOf(behavior);
if (rec) rec.enabled = val;
`, { group: G_REC_SETTINGS }),
];

const receiverConditions = [
  fn('IsReceiving', 'Is receiving light probes',
    '_PARAM0_ is receiving light probes', 'Condition',
    [],
    `const rec = LPG.receiverOf(behavior);
eventsFunctionContext.returnValue = !!(rec && rec.enabled && LPG.isSupported(runtimeScene) && LPG.isProbeVolumeLoaded(runtimeScene));
`, { group: G_REC_SETTINGS }),

  fn('IsEnabled', 'Light probe sampling is enabled',
    'Light probe sampling is enabled on _PARAM0_', 'Condition',
    [],
    `const rec = LPG.receiverOf(behavior);
eventsFunctionContext.returnValue = !!(rec && rec.enabled);
`, { group: G_REC_SETTINGS }),
];

const receiverExpressions = [
  fn('Intensity', 'Intensity multiplier',
    '', 'Expression',
    [],
    `const rec = LPG.receiverOf(behavior);
eventsFunctionContext.returnValue = rec ? rec.intensityMultiplier : 1.0;
`, { group: G_REC_SETTINGS }),

  fn('NormalBias', 'Normal bias offset',
    '', 'Expression',
    [],
    `const rec = LPG.receiverOf(behavior);
eventsFunctionContext.returnValue = rec ? rec.normalBias : 15.0;
`, { group: G_REC_SETTINGS }),
];

const receiverBehavior = {
  name: 'ReceiveLightProbes',
  fullName: 'Receive Light Probes 3D',
  description: 'Attach to any lit 3D object (Model3D, Cube3D) to sample the active light probe volume per fragment.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('IntensityMultiplier', 'Number', 'Intensity Multiplier', 'Per-instance multiplier on received indirect light.', '1.0'),
    prop('NormalBiasOffset', 'Number', 'Normal Bias Offset', 'Offset along the surface normal in world units (pixels).', '15.0'),
    prop('UpdateFrequency', 'Choice', 'Update Frequency', 'Continuous (every frame) or Throttled (every 5 frames).', 'Continuous', {
      extraInformation: ['Continuous', 'Throttled']
    }),
    prop('Enabled', 'Boolean', 'Enabled', 'Whether sampling is active on this instance.', 'true'),
  ],
  eventsFunctions: [
    ...receiverLifecycle,
    ...receiverActions,
    ...receiverConditions,
    ...receiverExpressions,
  ],
};

/* ========================================================= Global / Free Functions */

const G_GLOBAL_CONTROL = 'Light Probe Grid — Control';
const G_GLOBAL_BAKE = 'Light Probe Grid — Baking';
const G_GLOBAL_METRICS = 'Light Probe Grid — Metrics';

const freeActions = [
  freeFn('SetBounds', 'Set volume bounds',
    'Set light probe grid bounds to Min: (_PARAM0_, _PARAM1_, _PARAM2_), Max: (_PARAM3_, _PARAM4_, _PARAM5_)',
    'Action',
    [
      num('MinX', 'Minimum X in GDevelop coordinates', '0'),
      num('MinY', 'Minimum Y in GDevelop coordinates', '0'),
      num('MinZ', 'Minimum Z in GDevelop coordinates', '0'),
      num('MaxX', 'Maximum X in GDevelop coordinates', '1000'),
      num('MaxY', 'Maximum Y in GDevelop coordinates', '1000'),
      num('MaxZ', 'Maximum Z in GDevelop coordinates', '500'),
    ],
    `LPG.setBounds(
  runtimeScene,
  eventsFunctionContext.getArgument("MinX"),
  eventsFunctionContext.getArgument("MinY"),
  eventsFunctionContext.getArgument("MinZ"),
  eventsFunctionContext.getArgument("MaxX"),
  eventsFunctionContext.getArgument("MaxY"),
  eventsFunctionContext.getArgument("MaxZ")
);
`, { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('SetDayNightBlend', 'Set day / night blend factor',
    'Set light probe day/night blend to _PARAM0_ (0.0 = day, 1.0 = night)',
    'Action',
    [num('Blend', 'Day to night interpolation factor (0.0 to 1.0)', '0.0')],
    `LPG.setDayNightBlend(runtimeScene, eventsFunctionContext.getArgument("Blend"));\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('SetGlobalIntensity', 'Set global probe intensity',
    'Set global light probe intensity to _PARAM0_',
    'Action',
    [num('Intensity', 'Global intensity multiplier across all probe volumes', '1.0')],
    `LPG.setGlobalIntensity(runtimeScene, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('StartBake', 'Start probe baking',
    'Start baking scene light probes',
    'Action',
    [],
    `LPG.startBake(runtimeScene);\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('CancelBake', 'Cancel probe baking',
    'Cancel in-progress light probe bake',
    'Action',
    [],
    `LPG.cancelBake(runtimeScene);\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('SetBakeBudgetMs', 'Set bake per-frame budget',
    'Set light probe bake per-frame budget to _PARAM0_ ms',
    'Action',
    [num('BudgetMs', 'Maximum milliseconds to spend baking per frame', '8.0')],
    `LPG.setBakeBudgetMs(runtimeScene, eventsFunctionContext.getArgument("BudgetMs"));\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('ExportProbeData', 'Export probe data to file',
    'Export light probe data to binary file _PARAM0_',
    'Action',
    [str('FileName', 'File name for exported .lpg.bin', 'probes.lpg.bin')],
    `LPG.exportProbeData(runtimeScene, eventsFunctionContext.getArgument("FileName"));\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('LoadProbeDataFromFile', 'Load probe data from file',
    'Load light probe data from file _PARAM0_',
    'Action',
    [str('FilePath', 'URL or path to .lpg.bin file', 'probes.lpg.bin')],
    `LPG.loadProbeDataFromFile(runtimeScene, eventsFunctionContext.getArgument("FilePath"));\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('ToggleDebugVisualizer', 'Show / hide debug visualizer',
    'Set light probe debug visualizer enabled: _PARAM0_',
    'Action',
    [bool('Enable', 'Show debug probe spheres')],
    `LPG.toggleDebugVisualizer(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),
];

const freeConditions = [
  freeFn('IsSupported', 'Light probes are supported (WebGL2)',
    'Light probe grid is supported on current context',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = LPG.isSupported(runtimeScene);\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('IsProbeVolumeLoaded', 'Probe volume is loaded',
    'Light probe volume is loaded and active',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = LPG.isProbeVolumeLoaded(runtimeScene);\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('IsBakeInProgress', 'Probe bake is in progress',
    'Light probe bake is currently in progress',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = LPG.isBakeInProgress(runtimeScene);\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('IsBakeComplete', 'Probe bake is complete',
    'Light probe bake has completed',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = LPG.isBakeComplete(runtimeScene);\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('IsDayNightModeEnabled', 'Day/night mode is enabled',
    'Light probe day/night mode is enabled',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = LPG.isDayNightModeEnabled(runtimeScene);\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),
];

const freeExpressions = [
  freeFn('GetDayNightBlend', 'Day/night blend factor',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getDayNightBlend(runtimeScene);\n`,
    { group: G_GLOBAL_CONTROL, withRuntime: true }),

  freeFn('GetActiveProbeCount', 'Active probe count',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getActiveProbeCount(runtimeScene);\n`,
    { group: G_GLOBAL_METRICS, withRuntime: true }),

  freeFn('GetProbeSpacingX', 'Probe spacing along X',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getProbeSpacingX(runtimeScene);\n`,
    { group: G_GLOBAL_METRICS, withRuntime: true }),

  freeFn('GetProbeSpacingY', 'Probe spacing along Y',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getProbeSpacingY(runtimeScene);\n`,
    { group: G_GLOBAL_METRICS, withRuntime: true }),

  freeFn('GetProbeSpacingZ', 'Probe spacing along Z',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getProbeSpacingZ(runtimeScene);\n`,
    { group: G_GLOBAL_METRICS, withRuntime: true }),

  freeFn('GetBakeProgress', 'Bake progress (0.0 to 1.0)',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getBakeProgress(runtimeScene);\n`,
    { group: G_GLOBAL_BAKE, withRuntime: true }),

  freeFn('GetVRAMBytes', 'Probe texture VRAM bytes',
    '', 'Expression',
    [],
    `eventsFunctionContext.returnValue = LPG.getVRAMBytes(runtimeScene);\n`,
    { group: G_GLOBAL_METRICS, withRuntime: true }),
];

/* ============================================================== Extension Object */

const extension = {
  name: 'LightProbeGrid3D',
  fullName: 'Light Probe Grid 3D',
  description: 'Spatially-varying indirect ambient light for dynamic 3D objects in GDevelop. Samples a 3D irradiance volume texture per fragment so characters walking into caves, under overhangs, or through colored corridors smoothly pick up local ambient lighting without extra draw calls.',
  shortDescription: 'Spatially-varying 3D light probe grid for dynamic indirect ambient lighting.',
  category: '3D',
  author: 'Twillion',
  license: 'MIT',
  version: '1.0.0',
  iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  tags: [
    '3D',
    'lighting',
    'light probe',
    'irradiance',
    'volume',
    'ambient',
    'bake',
    'indirect light',
    'GI',
    'shader'
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [
    ...freeActions,
    ...freeConditions,
    ...freeExpressions,
  ],
  eventsBasedBehaviors: [
    volumeBehavior,
    receiverBehavior,
  ],
};

/* ============================================================== Pre-build Safety Checks */

console.log('Running pre-build safety assertions...');

// 1. Parse all JS blocks using new Function to ensure syntactical correctness
let parsedBlocks = 0;
const walkEvents = (fns, where) => {
  for (const f of fns) {
    if (f.events) {
      for (const evItem of f.events) {
        if (evItem.type === 'BuiltinCommonInstructions::JsCode' && evItem.inlineCode) {
          try {
            new Function('eventsFunctionContext', 'runtimeScene', 'objects', evItem.inlineCode);
            parsedBlocks++;
          } catch (err) {
            console.error(`\nJS parse error in ${where}.${f.name}: ${err.message}\n`);
            process.exit(1);
          }
        }
      }
    }
  }
};
walkEvents(volumeBehavior.eventsFunctions, volumeBehavior.name);
walkEvents(receiverBehavior.eventsFunctions, receiverBehavior.name);
walkEvents(extension.eventsFunctions, 'freeFunctions');

// 2. Check duplicate function names and sentence tokens
const checkNamesAndSentences = (fns, where) => {
  const seen = new Set();
  for (const f of fns) {
    if (seen.has(f.name)) {
      console.error(`\nDuplicate function name ${where}.${f.name}\n`);
      process.exit(1);
    }
    seen.add(f.name);
    const count = (f.parameters || []).length;
    const text = `${f.description || ''} ${f.sentence || ''}`;
    for (const m of text.matchAll(/_PARAM(\d+)_/g)) {
      if (Number(m[1]) >= count) {
        console.error(
          `\n${where}.${f.name} refers to _PARAM${m[1]}_ but declares ${count} parameters.\n`
        );
        process.exit(1);
      }
    }
  }
};
checkNamesAndSentences(volumeBehavior.eventsFunctions, volumeBehavior.name);
checkNamesAndSentences(receiverBehavior.eventsFunctions, receiverBehavior.name);
checkNamesAndSentences(extension.eventsFunctions, 'freeFunctions');

// 3. Schema Linting
const json = JSON.stringify(extension, null, 2);

const BAD_KEYS = [
  ['"properties"', 'behaviors serialize "propertyDescriptors", not "properties"'],
  ['"extraInfo"', 'properties use "extraInformation"; parameters use "supplementaryInformation"'],
  ['"type": "resource"', '"resource" is not a registered parameter type'],
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
const allFns = [
  ...volumeBehavior.eventsFunctions,
  ...receiverBehavior.eventsFunctions,
  ...extension.eventsFunctions,
];
for (const f of allFns) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

// 4. Object parameters check
const checkObjectParams = (fns, where, isBehavior) => {
  for (const f of fns) {
    f.parameters.forEach((p, i) => {
      if (p.type !== 'object') return;
      if (isBehavior && i === 0 && p.name === 'Object') return;
      console.error(
        `\n${where}.${f.name}: parameter "${p.name}" (index ${i}) is type "object".` +
        `\nOnly parameter 0 of a behavior function may be "object". Use "objectList"` +
        `\nfor any other object parameter.\n`
      );
      process.exit(1);
    });
  }
};
checkObjectParams(volumeBehavior.eventsFunctions, volumeBehavior.name, true);
checkObjectParams(receiverBehavior.eventsFunctions, receiverBehavior.name, true);
checkObjectParams(extension.eventsFunctions, 'freeFunctions', false);

// Write output JSON
const outPath = path.join(here, 'LightProbeGrid3D.json');
fs.writeFileSync(outPath, json, 'utf8');

const counts = allFns.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\nSuccessfully built ${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
