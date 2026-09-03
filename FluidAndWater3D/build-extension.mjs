/**
 * build-extension.mjs
 * Compiles FluidAndWater3D.json from the runtime engine + behavior & function declarations.
 *
 * Run: node FluidAndWater3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'FluidAndWater3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__fluidAndWater3D';

/* ------------------------------------------------------------- Parameters & Helpers */

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

const BEHAVIOR_PREAMBLE = `const __fwObjects = eventsFunctionContext.getObjects("Object");
const object = __fwObjects.length ? __fwObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const FW = ${NS};
`;

const fn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(BEHAVIOR_PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const freeFn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters,
  // NOTE: evFree already prepends the runtime when opts.withRuntime is set. Prepending it here too
  // embedded a second full copy in every free function (123 KB each).
  events: evFree(`if (!${NS}) return;\nconst FW = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* ========================================================= 1. WaterBody3D Behavior */

const WATER_OPTIONS = `{
  waterType: behavior._getWaterType ? behavior._getWaterType() : 'Ocean',
  waveHeight: behavior._getWaveHeight ? behavior._getWaveHeight() : 18.0,
  waveChoppiness: behavior._getWaveChoppiness ? behavior._getWaveChoppiness() : 0.75,
  waveSpeed: behavior._getWaveSpeed ? behavior._getWaveSpeed() : 1.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  waveTiling: behavior._getWaveTiling ? behavior._getWaveTiling() : 1.0,
  materialSource: behavior._getMaterialSource ? behavior._getMaterialSource() : 'Builtin',
  shallowColor: behavior._getShallowColor ? behavior._getShallowColor() : '64;224;208',
  deepColor: behavior._getDeepColor ? behavior._getDeepColor() : '10;45;90',
  extinctionDepth: behavior._getExtinctionDepth ? behavior._getExtinctionDepth() : 150.0,
  refractionScale: behavior._getRefractionScale ? behavior._getRefractionScale() : 0.02,
  shoreFoamIntensity: behavior._getShoreFoamIntensity ? behavior._getShoreFoamIntensity() : 0.85,
  maskUnderEdges: behavior._getMaskUnderEdges ? behavior._getMaskUnderEdges() : true,
  crestFoamIntensity: behavior._getCrestFoamIntensity ? behavior._getCrestFoamIntensity() : 0.60,
  enableCaustics: behavior._getEnableCaustics ? behavior._getEnableCaustics() : true,
  enableUnderwaterFX: behavior._getEnableUnderwaterFX ? behavior._getEnableUnderwaterFX() : false,
  underwaterFogColor: behavior._getUnderwaterFogColor ? behavior._getUnderwaterFogColor() : '15;65;110',
  underwaterFogDensity: behavior._getUnderwaterFogDensity ? behavior._getUnderwaterFogDensity() : 0.0005,
  gridSubdivisions: behavior._getGridSubdivisions ? behavior._getGridSubdivisions() : 48,
  waveScaleMode: behavior._getWaveScaleMode ? behavior._getWaveScaleMode() : 'Absolute',
  directionalSpread: behavior._getDirectionalSpread ? behavior._getDirectionalSpread() : 45.0,
  phaseSeed: behavior._getPhaseSeed ? behavior._getPhaseSeed() : 0.0,
  waveIrregularity: behavior._getWaveIrregularity ? behavior._getWaveIrregularity() : 0.4,
  enableBodyInteractions: behavior._getEnableBodyInteractions ? behavior._getEnableBodyInteractions() : true,
  interactionStrength: behavior._getInteractionStrength ? behavior._getInteractionStrength() : 14.0,
  interactionRadius: behavior._getInteractionRadius ? behavior._getInteractionRadius() : 180.0,
  interactionSpeedThreshold: behavior._getInteractionSpeedThreshold ? behavior._getInteractionSpeedThreshold() : 35.0
}`;

const waterLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.registerWaterBody(runtimeScene, object, behavior, ${WATER_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.stepWaterBody(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.disposeWaterBody(runtimeScene, behavior);\n`),
  },
];

const G_WATER_WAVES = 'Waves & Wind';
const G_WATER_OPTICS = 'Color & Optics';
const G_WATER_FOAM = 'Foam & Caustics';
const G_WATER_UNDER = 'Underwater Submersion';

const waterActions = [
  fn('SetWaveHeight', 'Set wave height',
    'Set wave height on _PARAM0_ to _PARAM2_ scene units',
    'Change the Gerstner-wave displacement amplitude in scene units.', 'Action',
    [num('WaveHeight', 'Wave height in scene units', '18')],
    `const val = eventsFunctionContext.getArgument("WaveHeight");
if (behavior._setWaveHeight) behavior._setWaveHeight(val);
FW.updateWaterBody(runtimeScene, object, behavior, { waveHeight: val });
`, { group: G_WATER_WAVES }),

  fn('SetWaveChoppiness', 'Set wave choppiness',
    'Set wave choppiness on _PARAM0_ to _PARAM2_',
    'Change Gerstner wave peak sharpness (0.0 = smooth sine, 1.0 = sharp crests).', 'Action',
    [num('WaveChoppiness', 'Choppiness factor (0.0 to 1.0)', '0.75')],
    `const val = eventsFunctionContext.getArgument("WaveChoppiness");
if (behavior._setWaveChoppiness) behavior._setWaveChoppiness(val);
FW.updateWaterBody(runtimeScene, object, behavior, { waveChoppiness: val });
`, { group: G_WATER_WAVES }),

  fn('SetWaveSpeed', 'Set wave speed',
    'Set wave speed multiplier on _PARAM0_ to _PARAM2_',
    'Adjust time propagation speed for waves.', 'Action',
    [num('WaveSpeed', 'Wave speed multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("WaveSpeed");
if (behavior._setWaveSpeed) behavior._setWaveSpeed(val);
FW.updateWaterBody(runtimeScene, object, behavior, { waveSpeed: val });
`, { group: G_WATER_WAVES }),

  fn('SetDirectionalSpread', 'Set directional spread',
    'Set wave directional spread on _PARAM0_ to _PARAM2_ degrees',
    'How widely waves fan out from the wind. 0 = rolling swell all one way, 45 = normal wind sea, '
    + '90 = confused choppy sea.', 'Action',
    [num('DirectionalSpread', 'Spread in degrees (0 - 90)', '45')],
    `const val = eventsFunctionContext.getArgument("DirectionalSpread");
if (behavior._setDirectionalSpread) behavior._setDirectionalSpread(val);
FW.updateWaterBody(runtimeScene, object, behavior, { directionalSpread: val });
`, { group: G_WATER_WAVES }),

  fn('SetPhaseSeed', 'Set wave phase seed',
    'Set wave phase seed on _PARAM0_ to _PARAM2_',
    'Rearranges the crests without changing the sea state. Same value, same surface.', 'Action',
    [num('PhaseSeed', 'Any number', '0')],
    `const val = eventsFunctionContext.getArgument("PhaseSeed");
if (behavior._setPhaseSeed) behavior._setPhaseSeed(val);
FW.updateWaterBody(runtimeScene, object, behavior, { phaseSeed: val });
`, { group: G_WATER_WAVES }),

  fn('SetWaveIrregularity', 'Set wave irregularity',
    'Set wave irregularity on _PARAM0_ to _PARAM2_',
    'Bends and slowly evolves crest lines without adding random frame noise. 0 is straight and regular; 1 is strongly confused.', 'Action',
    [num('Irregularity', 'Irregularity (0 - 1)', '0.4')],
    `const val = eventsFunctionContext.getArgument("Irregularity");
if (behavior._setWaveIrregularity) behavior._setWaveIrregularity(val);
FW.updateWaterBody(runtimeScene, object, behavior, { waveIrregularity: val });
`, { group: G_WATER_WAVES }),

  fn('SetWindDirection', 'Set wind direction',
    'Set wind direction on _PARAM0_ to _PARAM2_ degrees',
    'Rotate ocean swell and wave propagation direction in degrees (0 - 360).', 'Action',
    [num('WindDirection', 'Wind direction in degrees', '45.0')],
    `const val = eventsFunctionContext.getArgument("WindDirection");
if (behavior._setWindDirection) behavior._setWindDirection(val);
FW.updateWaterBody(runtimeScene, object, behavior, { windDirection: val });
`, { group: G_WATER_WAVES }),

  fn('SetWaveTiling', 'Set wave tiling / frequency',
    'Set wave tiling frequency on _PARAM0_ to _PARAM2_',
    'Adjust wave repetition density across world space (1.0 = standard, 2.0+ = denser tiled ripples).', 'Action',
    [num('WaveTiling', 'Wave tiling frequency multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("WaveTiling");
if (behavior._setWaveTiling) behavior._setWaveTiling(val);
FW.updateWaterBody(runtimeScene, object, behavior, { waveTiling: val });
`, { group: G_WATER_WAVES }),

  fn('SetWaterColors', 'Set water colors',
    'Set water colors on _PARAM0_ (Shallow: _PARAM2_, Deep: _PARAM3_)',
    'Update shallow water turquoise and deep oceanic navy colors.', 'Action',
    [
      col('ShallowColor', 'Color at shallow depths', '64;224;208'),
      col('DeepColor', 'Color in deep trenches', '10;45;90'),
    ],
    `const sc = eventsFunctionContext.getArgument("ShallowColor");
const dc = eventsFunctionContext.getArgument("DeepColor");
if (behavior._setShallowColor) behavior._setShallowColor(sc);
if (behavior._setDeepColor) behavior._setDeepColor(dc);
FW.updateWaterBody(runtimeScene, object, behavior, { shallowColor: sc, deepColor: dc });
`, { group: G_WATER_OPTICS }),

  fn('SetExtinctionDepth', 'Set extinction depth',
    'Set extinction depth on _PARAM0_ to _PARAM2_ meters',
    'Depth at which light is fully absorbed transitioning into deep water color.', 'Action',
    [num('Depth', 'Extinction depth in meters', '8.0')],
    `const val = eventsFunctionContext.getArgument("Depth");
if (behavior._setExtinctionDepth) behavior._setExtinctionDepth(val);
FW.updateWaterBody(runtimeScene, object, behavior, { extinctionDepth: val });
`, { group: G_WATER_OPTICS }),

  fn('SetRefractionScale', 'Set refraction scale',
    'Set refraction distortion scale on _PARAM0_ to _PARAM2_',
    'Distortion strength of underwater scene geometry seen through waves.', 'Action',
    [num('Scale', 'Refraction distortion scale', '0.02')],
    `const val = eventsFunctionContext.getArgument("Scale");
if (behavior._setRefractionScale) behavior._setRefractionScale(val);
FW.updateWaterBody(runtimeScene, object, behavior, { refractionScale: val });
`, { group: G_WATER_OPTICS }),

  fn('SetShoreFoamIntensity', 'Set shore foam intensity',
    'Set shore foam intensity on _PARAM0_ to _PARAM2_',
    'Foam opacity where waves intersect beaches, rocks, and boat hulls.', 'Action',
    [num('Intensity', 'Shore foam intensity (0.0 to 1.0)', '0.85')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setShoreFoamIntensity) behavior._setShoreFoamIntensity(val);
FW.updateWaterBody(runtimeScene, object, behavior, { shoreFoamIntensity: val });
`, { group: G_WATER_FOAM }),

  fn('SetCrestFoamIntensity', 'Set crest foam intensity',
    'Set wave crest whitecap foam intensity on _PARAM0_ to _PARAM2_',
    'Whitecap foam opacity generated on steep wave peaks.', 'Action',
    [num('Intensity', 'Crest foam intensity (0.0 to 1.0)', '0.60')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setCrestFoamIntensity) behavior._setCrestFoamIntensity(val);
FW.updateWaterBody(runtimeScene, object, behavior, { crestFoamIntensity: val });
`, { group: G_WATER_FOAM }),

  fn('SetUnderwaterFog', 'Set underwater fog',
    'Set underwater fog on _PARAM0_ (Color: _PARAM2_, Density: _PARAM3_)',
    'Set volumetric fog color tint and falloff density when camera dives.', 'Action',
    [
      col('FogColor', 'Underwater fog color', '15;65;110'),
      num('FogDensity', 'Underwater fog density', '0.15')
    ],
    `const col = eventsFunctionContext.getArgument("FogColor");
const den = eventsFunctionContext.getArgument("FogDensity");
if (behavior._setUnderwaterFogColor) behavior._setUnderwaterFogColor(col);
if (behavior._setUnderwaterFogDensity) behavior._setUnderwaterFogDensity(den);
FW.updateWaterBody(runtimeScene, object, behavior, { underwaterFogColor: col, underwaterFogDensity: den });
`, { group: G_WATER_UNDER }),

  fn('SetUnderwaterFXEnabled', 'Enable underwater camera FX',
    'Enable underwater camera FX on _PARAM0_: _PARAM2_',
    'Enable or disable automatic underwater fog transition when camera submerges.', 'Action',
    [bool('Enabled', 'Enable underwater camera FX')],
    `const val = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnableUnderwaterFX) behavior._setEnableUnderwaterFX(val);
FW.updateWaterBody(runtimeScene, object, behavior, { enableUnderwaterFX: val });
`, { group: G_WATER_UNDER }),
];

const waterConditions = [
  fn('IsCameraUnderwater', 'Is camera underwater',
    'Camera is submerged underwater inside _PARAM0_',
    'Check if the active scene camera has submerged below the wave surface of this water volume.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FW.isCameraUnderwater(runtimeScene, behavior);
`, { group: G_WATER_UNDER }),

  fn('IsPositionUnderwater', 'Is world position underwater',
    'World position (_PARAM2_, _PARAM3_, _PARAM4_) is underwater in _PARAM0_',
    'Check if specific world coordinates (X, Y, Z) are below the wave surface.', 'Condition',
    [
      num('X', 'World X coordinate', '0'),
      num('Y', 'World Y coordinate', '0'),
      num('Z', 'World Z altitude', '0')
    ],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
eventsFunctionContext.returnValue = FW.isPositionUnderwater(runtimeScene, behavior, x, y, z);
`, { group: G_WATER_WAVES }),
];

const waterExpressions = [
  fn('WaveDetailPercent', 'Renderable wave detail percentage',
    '', 'Percentage of the configured wave amplitude this surface mesh can actually draw (0 - 100). '
    + '100 means every wave octave is resolved. 0 means the water renders FLAT because every octave is '
    + 'shorter than the mesh vertex spacing can represent - raise Grid Subdivisions, or set Wave Scale '
    + 'Mode to RelativeToVolume.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getWaveDetailPercent(runtimeScene, behavior);
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WaveHeightAt', 'Wave height at position',
    '', 'Returns the vertical wave displacement at specific (X, Y) world coordinates.', 'Expression',
    [num('X', 'World X coordinate', '0'), num('Y', 'World Y coordinate', '0')],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
eventsFunctionContext.returnValue = FW.getWaveHeightAt(runtimeScene, behavior, x, y);
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WaterSurfaceZ', 'Water surface altitude at position',
    '', 'Returns the exact top water altitude Z (base altitude + wave displacement) at (X, Y).', 'Expression',
    [num('X', 'World X coordinate', '0'), num('Y', 'World Y coordinate', '0')],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
eventsFunctionContext.returnValue = FW.getWaterSurfaceZ(runtimeScene, behavior, x, y);
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WaveHeight', 'Wave height',
    '', 'Returns the master wave height amplitude in meters.', 'Expression',
    [],
    `const body = FW.waterBodyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = body ? body.waveHeight : 1.2;
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WaveSpeed', 'Wave speed',
    '', 'Returns the wave speed multiplier.', 'Expression',
    [],
    `const body = FW.waterBodyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = body ? body.waveSpeed : 1.0;
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WindDirection', 'Wind direction',
    '', 'Returns the wind direction in degrees.', 'Expression',
    [],
    `const body = FW.waterBodyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = body ? body.windDirection : 45.0;
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('WaveTiling', 'Wave tiling frequency',
    '', 'Returns the wave tiling frequency multiplier.', 'Expression',
    [],
    `const body = FW.waterBodyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = body ? (body.waveTiling || 1.0) : 1.0;
`, { group: G_WATER_WAVES, expressionType: 'number' }),

  fn('ExtinctionDepth', 'Extinction depth',
    '', 'Returns the optical extinction depth in meters.', 'Expression',
    [],
    `const body = FW.waterBodyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = body ? body.extinctionDepth : 8.0;
`, { group: G_WATER_OPTICS, expressionType: 'number' }),
];

const waterBodyBehavior = {
  name: 'WaterBody3D',
  fullName: 'Water Body 3D (Ocean, Lake, Pool)',
  description: 'Attach to a 3D Box or Plane to create sizable ocean volumes, lakes, rivers, or swimming pools with Gerstner waves, Beer-Lambert depth absorption, foam, and underwater camera transitions.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('WaterType', 'Choice', 'Water Type', 'Environment preset profile.', 'Ocean', {
      extraInformation: ['Ocean', 'Lake', 'River', 'SwimmingPool', 'Custom']
    }),
    prop('WaveHeight', 'Number', 'Wave Height', 'Master wave amplitude in pixels.', '18.0'),
    prop('WaveChoppiness', 'Number', 'Wave Choppiness', 'Gerstner crest sharpness (0.0 = sine, 1.0 = sharp crests).', '0.75'),
    prop('WaveSpeed', 'Number', 'Wave Speed', 'Time frequency multiplier for wave propagation.', '1.0'),
    prop('WindDirection', 'Number', 'Wind Direction', 'Wave travel direction in degrees (0 - 360).', '45.0'),
    prop('WaveTiling', 'Number', 'Wave Tiling / Frequency', 'Divides the base wavelength. Higher values tile more, smaller waves across the surface without stretching them.', '1.0'),
    prop('DirectionalSpread', 'Number', 'Directional Spread',
      'How widely the waves fan out from the wind direction, in degrees. 0 puts every wave on the '
      + 'wind for clean rolling swell that all travels one way. 45 is a normal wind sea. 70-90 gives '
      + 'a confused, choppy sea with crests running in many directions. If the surface looks like '
      + 'parallel ridges all marching the same way, raise this.', '45'),
    prop('PhaseSeed', 'Number', 'Wave Phase Seed',
      'Shifts every wave octave by a different amount, giving a completely different arrangement of '
      + 'crests from the same settings. Change it if the pattern happens to look wrong where your '
      + 'camera sits. Any number; the same value always rebuilds the same surface.', '0'),
    prop('WaveIrregularity', 'Number', 'Wave Irregularity',
      'Deterministically bends and evolves crest lines so the Gerstner pattern feels less tiled. '
      + '0 keeps perfectly straight authored waves; 0.4 is natural; 1 is strongly confused. The '
      + 'CPU height queries and GPU surface use the same calculation.', '0.4'),
    prop('WaveScaleMode', 'Choice', 'Wave Scale Mode',
      'Absolute: wavelength is a fixed 300 units regardless of the volume size, so waves stay world-space and adjacent water bodies tile seamlessly (oceans). '
      + 'RelativeToVolume: one base wave spans the shorter horizontal side of this volume at Wave Tiling 1, so waves stay proportional to the object (pools, ponds, lakes).',
      'Absolute', { extraInformation: ['Absolute', 'RelativeToVolume'] }),
    prop('MaterialSource', 'Choice', 'Material Source', 'Reserved for future Material3D delegation. The current renderer always uses Builtin colors.', 'Builtin', {
      extraInformation: ['Builtin', 'Material3D']
    }),
    prop('ShallowColor', 'Color', 'Shallow Water Color', 'Color at shallow water depths (Turquoise).', '64;224;208'),
    prop('DeepColor', 'Color', 'Deep Ocean Color', 'Color in deep oceanic trenches (Dark Navy).', '10;45;90'),
    prop('ExtinctionDepth', 'Number', 'Extinction Depth', 'Depth in pixels at which water fully transitions to deep color.', '150.0'),
    prop('RefractionScale', 'Number', 'Caustic Distortion Scale', 'Wave-normal distortion applied to caustics; this does not refract the scene color buffer.', '0.02'),
    prop('ShoreFoamIntensity', 'Number', 'Shore Foam Intensity', 'Foam opacity near the water volume boundary.', '0.85'),
    prop('CrestFoamIntensity', 'Number', 'Crest Foam Intensity', 'Whitecap foam opacity on steep wave crests.', '0.60'),
    prop('MaskUnderEdges', 'Boolean', 'Cut Water Under Edges', 'Cut the water away wherever a WaterEdge3D volume covers it. That volume is an axis-aligned BOX, so a large or irregular piece of land removes a rectangle of water, not its real outline - if the water looks sliced off in a straight line where it meets your coast, turn this OFF. The edge still produces foam and shallows; your actual 3D land hides the water by itself.', 'true'),
    prop('EnableCaustics', 'Boolean', 'Enable Caustics', 'Project animated caustic patterns on underwater seabeds.', 'true'),
    prop('EnableUnderwaterFX', 'Boolean', 'Enable Underwater FX', 'Apply scene fog when the camera is inside and below this water surface.', 'false'),
    prop('UnderwaterFogColor', 'Color', 'Underwater Fog Color', 'Volumetric color tint when swimming underwater.', '15;65;110'),
    prop('UnderwaterFogDensity', 'Number', 'Underwater Fog Density', 'Visibility falloff density underwater.', '0.0005'),
    prop('GridSubdivisions', 'Number', 'Grid Subdivisions', 'Surface mesh resolution (8 - 256). Sets the shortest wave that can be drawn at all: octaves shorter than 4x the vertex spacing (volume size / this) are filtered out. Raise it on large volumes.', '48'),
    prop('EnableBodyInteractions', 'Boolean', 'Physics Body Ripples',
      'Automatically detect moving Physics3D/Jolt bodies intersecting this water volume and create wakes and splash rings. The moving object does not need Buoyancy3D.', 'true'),
    prop('InteractionStrength', 'Number', 'Splash Strength',
      'Maximum vertical displacement, in scene units, produced by a fast moving body.', '14'),
    prop('InteractionRadius', 'Number', 'Splash Radius',
      'Maximum radius, in scene units, reached by each movement ripple.', '180'),
    prop('InteractionSpeedThreshold', 'Number', 'Splash Speed Threshold',
      'Minimum Physics3D or measured movement speed, in scene units per second, before a wake is emitted.', '35'),
  ],
  eventsFunctions: [
    ...waterLifecycle,
    ...waterActions,
    ...waterConditions,
    ...waterExpressions,
  ],
};

/* ========================================================= 2. Buoyancy3D Behavior */

const BUOY_OPTIONS = `{
  physics3D: behavior._getPhysics3D ? behavior._getPhysics3D() : 'Physics3D',
  buoyancyFactor: behavior._getBuoyancyFactor ? behavior._getBuoyancyFactor() : 1.0,
  hullProbeCount: behavior._getHullProbeCount ? behavior._getHullProbeCount() : '4-Corners',
  fluidDrag: behavior._getFluidDrag ? behavior._getFluidDrag() : 2.0,
  waveInfluence: behavior._getWaveInfluence ? behavior._getWaveInfluence() : 0.8,
  stabilityStrength: behavior._getStabilityStrength ? behavior._getStabilityStrength() : 0.65,
  stabilityDamping: behavior._getStabilityDamping ? behavior._getStabilityDamping() : 1.5,
  maxSubmersionDepth: behavior._getMaxSubmersionDepth ? behavior._getMaxSubmersionDepth() : 2.0,
  targetWaterBody: behavior._getTargetWaterBody ? behavior._getTargetWaterBody() : '',
  enabled: behavior._getEnabled ? behavior._getEnabled() : true
}`;

const buoyLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.registerBuoyancy(runtimeScene, object, behavior, ${BUOY_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.stepBuoyancy(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.disposeBuoyancy(runtimeScene, behavior);\n`),
  },
];

const G_BUOY_CONFIG = 'Buoyancy Physics';

const buoyActions = [
  fn('SetBuoyancyFactor', 'Set buoyancy factor',
    'Set buoyancy factor on _PARAM0_ to _PARAM2_',
    'Multiplier on Archimedes upward buoyant force.', 'Action',
    [num('Factor', 'Buoyancy multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("Factor");
if (behavior._setBuoyancyFactor) behavior._setBuoyancyFactor(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.buoyancyFactor = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetFluidDrag', 'Set fluid drag',
    'Set fluid hydrodynamic drag on _PARAM0_ to _PARAM2_',
    'Linear and angular damping applied while submerged in water.', 'Action',
    [num('Drag', 'Fluid drag coefficient', '2.0')],
    `const val = eventsFunctionContext.getArgument("Drag");
if (behavior._setFluidDrag) behavior._setFluidDrag(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.fluidDrag = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetWaveInfluence', 'Set wave influence',
    'Set wave rocking influence on _PARAM0_ to _PARAM2_',
    'Scale of wave normal alignment for pitch and roll rocking.', 'Action',
    [num('Influence', 'Wave influence scale (0.0 to 1.0)', '0.8')],
    `const val = eventsFunctionContext.getArgument("Influence");
if (behavior._setWaveInfluence) behavior._setWaveInfluence(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.waveInfluence = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetStabilityStrength', 'Set ship stability',
    'Set ship righting strength on _PARAM0_ to _PARAM2_',
    'Apply a restoring roll and pitch torque through the hull probes. Set to 0 to disable.', 'Action',
    [num('Strength', 'Righting strength (0 disables, 0.65 is a stable default)', '0.65')],
    `const val = Math.max(0, eventsFunctionContext.getArgument("Strength"));
if (behavior._setStabilityStrength) behavior._setStabilityStrength(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.stabilityStrength = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetStabilityDamping', 'Set ship stability damping',
    'Set ship roll and pitch damping on _PARAM0_ to _PARAM2_',
    'Damp angular rocking while the hull is touching water.', 'Action',
    [num('Damping', 'Angular stability damping', '1.5')],
    `const val = Math.max(0, eventsFunctionContext.getArgument("Damping"));
if (behavior._setStabilityDamping) behavior._setStabilityDamping(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.stabilityDamping = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetMaxSubmersionDepth', 'Set max submersion depth',
    'Set max submersion depth on _PARAM0_ to _PARAM2_',
    'Depth at which buoyancy force reaches maximum.', 'Action',
    [num('Depth', 'Submersion depth in scene units', '50.0')],
    `const val = eventsFunctionContext.getArgument("Depth");
if (behavior._setMaxSubmersionDepth) behavior._setMaxSubmersionDepth(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) b.maxSubmersionDepth = val;
`, { group: G_BUOY_CONFIG }),

  fn('SetEnabled', 'Enable / Disable buoyancy',
    'Enable buoyancy simulation on _PARAM0_: _PARAM2_',
    'Turn floating buoyancy physics on or off.', 'Action',
    [bool('Enabled', 'Enable buoyancy')],
    `const val = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(val);
const b = FW.buoyancyOf(runtimeScene, behavior);
if (b) {
  b.enabled = val;
  if (!val) FW.resetBuoyancyState(b);
}
`, { group: G_BUOY_CONFIG }),
];

const buoyConditions = [
  fn('IsFloating', 'Is floating on water',
    '_PARAM0_ is currently floating on water waves',
    'Check if any hull probe of this object is in contact with water.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FW.isFloating(runtimeScene, behavior);
`, { group: G_BUOY_CONFIG }),

  fn('IsSubmerged', 'Is fully submerged',
    '_PARAM0_ is fully submerged underwater',
    'Check if the object is deeply submerged below water surface.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FW.isSubmerged(runtimeScene, behavior);
`, { group: G_BUOY_CONFIG }),
];

const buoyExpressions = [
  fn('SubmersionDepth', 'Submersion depth',
    '', 'Returns the current depth in meters this object is submerged in water.', 'Expression',
    [],
    `const b = FW.buoyancyOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = b ? b.submersionDepth : 0.0;
`, { group: G_BUOY_CONFIG, expressionType: 'number' }),

  fn('BuoyancyForce', 'Last buoyant force',
    '', 'Returns the latest Archimedes buoyant lift force applied to this object.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getBuoyancyForce(runtimeScene, behavior);
`, { group: G_BUOY_CONFIG, expressionType: 'number' }),
];

const buoyancyBehavior = {
  name: 'Buoyancy3D',
  fullName: 'Buoyancy 3D (Wave Float & Physics)',
  description: 'Attach to boats, rafts, crates, or floating bodies. Integrates directly with Jolt 3D Physics (Physics3D) applying continuous multi-probe buoyant lift, righting torque, and hydrodynamic damping across waves.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('Physics3D', 'Behavior', 'Physics 3D behavior', 'The Physics 3D behavior on this object (leave as Physics3D for automatic detection).', 'Physics3D', {
      extraInformation: ['Physics3D::Physics3DBehavior']
    }),
    prop('BuoyancyFactor', 'Number', 'Buoyancy Factor', 'Multiplier on Archimedes upward buoyant force.', '1.0'),
    prop('HullProbeCount', 'Choice', 'Hull Probe Count', 'Number of probe points sampled across the object hull.', '4-Corners', {
      extraInformation: ['1-Center', '4-Corners', '8-HullBox']
    }),
    prop('FluidDrag', 'Number', 'Fluid Drag', 'Hydrodynamic damping applied to velocity and rotation in water.', '2.0'),
    prop('WaveInfluence', 'Number', 'Wave Influence', 'Strength of wave normal alignment rocking.', '0.8'),
    prop('StabilityStrength', 'Number', 'Ship Stability', 'Restoring roll and pitch strength. 0 disables stabilization; 0.65 is a stable ship default.', '0.65'),
    prop('StabilityDamping', 'Number', 'Stability Damping', 'Damps roll and pitch angular velocity while the hull touches water.', '1.5'),
    prop('MaxSubmersionDepth', 'Number', 'Max Submersion Depth', 'Depth in scene units where buoyancy force reaches maximum.', '2.0'),
    prop('TargetWaterBody', 'String', 'Target Water Body', 'Specific water body name (leave blank for nearest active water).', ''),
    prop('Enabled', 'Boolean', 'Enabled', 'Whether buoyancy simulation is active.', 'true'),
  ],
  eventsFunctions: [
    ...buoyLifecycle,
    ...buoyActions,
    ...buoyConditions,
    ...buoyExpressions,
  ],
};

/* ========================================================= 3. PourableLiquid3D Behavior */

const POUR_OPTIONS = `{
  fluidPreset: behavior._getFluidPreset ? behavior._getFluidPreset() : 'MagicPotion',
  maxDroplets: behavior._getMaxDroplets ? behavior._getMaxDroplets() : 1500,
  flowRate: behavior._getFlowRate ? behavior._getFlowRate() : 60.0,
  pourTiltThreshold: behavior._getPourTiltThreshold ? behavior._getPourTiltThreshold() : 45.0,
  dropletRadius: behavior._getDropletRadius ? behavior._getDropletRadius() : 0.02,
  viscosity: behavior._getViscosity ? behavior._getViscosity() : 1.0,
  surfaceTension: behavior._getSurfaceTension ? behavior._getSurfaceTension() : 0.8,
  restDensity: behavior._getRestDensity ? behavior._getRestDensity() : 1000.0,
  liquidColor: behavior._getLiquidColor ? behavior._getLiquidColor() : '220;30;120',
  liquidOpacity: behavior._getLiquidOpacity ? behavior._getLiquidOpacity() : 0.85,
  liquidRoughness: behavior._getLiquidRoughness ? behavior._getLiquidRoughness() : 0.05,
  containerCapacity: behavior._getContainerCapacity ? behavior._getContainerCapacity() : 1.0,
  autoPourOnTilt: behavior._getAutoPourOnTilt ? behavior._getAutoPourOnTilt() : true
}`;

const pourLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.registerPourableLiquid(runtimeScene, object, behavior, ${POUR_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.stepPourableLiquid(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FW.disposePourableLiquid(runtimeScene, behavior);\n`),
  },
];

const G_POUR_EMIT = 'Pouring & Emitter';
const G_POUR_PHYSICS = 'SPH Fluid Physics';
const G_POUR_CONTAINER = 'Container Volume & Fill';

const pourActions = [
  fn('StartPouring', 'Start pouring liquid',
    'Start pouring liquid from _PARAM0_ at flow rate _PARAM2_',
    'Manually trigger liquid emission from bottle spout or tap.', 'Action',
    [num('FlowRate', 'Droplets spawned per second (0 to use default)', '60.0')],
    `const rate = eventsFunctionContext.getArgument("FlowRate");
FW.startPouring(runtimeScene, behavior, rate);
`, { group: G_POUR_EMIT }),

  fn('StopPouring', 'Stop pouring liquid',
    'Stop pouring liquid from _PARAM0_',
    'Halt liquid stream emission.', 'Action',
    [],
    `FW.stopPouring(runtimeScene, behavior);
`, { group: G_POUR_EMIT }),

  fn('SetFluidPreset', 'Set fluid preset profile',
    'Set fluid preset profile on _PARAM0_ to _PARAM2_',
    'Apply fluid profile (Water, MagicPotion, HoneySyrup, GreenSlime, AcidPoison, LavaMagma).', 'Action',
    [choice('Preset', 'Fluid preset profile', ['Water', 'MagicPotion', 'HoneySyrup', 'GreenSlime', 'AcidPoison', 'LavaMagma'])],
    `const preset = eventsFunctionContext.getArgument("Preset");
if (behavior._setFluidPreset) behavior._setFluidPreset(preset);
FW.setFluidPreset(runtimeScene, behavior, preset);
`, { group: G_POUR_PHYSICS }),

  fn('SetViscosity', 'Set liquid viscosity',
    'Set liquid viscosity on _PARAM0_ to _PARAM2_',
    'Adjust fluid thickness (0.1 = water, 15.0 = honey, 35.0 = thick slime).', 'Action',
    [num('Viscosity', 'Fluid viscosity parameter', '1.0')],
    `const val = eventsFunctionContext.getArgument("Viscosity");
if (behavior._setViscosity) behavior._setViscosity(val);
const p = FW.pourableOf(runtimeScene, behavior);
if (p) p.viscosity = val;
`, { group: G_POUR_PHYSICS }),

  fn('SetSurfaceTension', 'Set surface tension',
    'Set liquid surface tension on _PARAM0_ to _PARAM2_',
    'Adjust cohesion force holding fluid stream together.', 'Action',
    [num('SurfaceTension', 'Surface tension parameter', '0.8')],
    `const val = eventsFunctionContext.getArgument("SurfaceTension");
if (behavior._setSurfaceTension) behavior._setSurfaceTension(val);
const p = FW.pourableOf(runtimeScene, behavior);
if (p) p.surfaceTension = val;
`, { group: G_POUR_PHYSICS }),

  fn('SetContainerCapacity', 'Set container capacity',
    'Set container liquid capacity on _PARAM0_ to _PARAM2_ liters',
    'Set maximum liquid volume capacity for filling cups, flasks, or cauldrons.', 'Action',
    [num('Capacity', 'Capacity in liters', '1.0')],
    `const val = eventsFunctionContext.getArgument("Capacity");
if (behavior._setContainerCapacity) behavior._setContainerCapacity(val);
const p = FW.pourableOf(runtimeScene, behavior);
if (p) p.containerCapacity = val;
`, { group: G_POUR_CONTAINER }),

  fn('AddLiquidVolume', 'Add liquid volume',
    'Add _PARAM2_ liters of liquid to container _PARAM0_',
    'Add or subtract liquid volume inside container.', 'Action',
    [num('Volume', 'Liquid volume in liters', '0.1')],
    `const val = eventsFunctionContext.getArgument("Volume");
const p = FW.pourableOf(runtimeScene, behavior);
if (p) p.currentVolume = Math.max(0.0, Math.min(p.containerCapacity, p.currentVolume + val));
`, { group: G_POUR_CONTAINER }),

  fn('EmptyContainer', 'Empty container volume',
    'Empty all liquid volume inside container _PARAM0_',
    'Reset container fill volume to 0.', 'Action',
    [],
    `FW.emptyContainer(runtimeScene, behavior);
`, { group: G_POUR_CONTAINER }),

  fn('ClearAllDroplets', 'Clear all active droplets',
    'Clear all active simulated fluid droplets from _PARAM0_',
    'Instantly remove all active fluid particles from the world.', 'Action',
    [],
    `FW.clearAllDroplets(runtimeScene);
`, { group: G_POUR_PHYSICS }),
];

const pourConditions = [
  fn('IsPouring', 'Is bottle currently pouring',
    '_PARAM0_ is currently pouring liquid droplets',
    'Check if bottle is currently streaming liquid droplets.', 'Condition',
    [],
    `const p = FW.pourableOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(p && p.isPouring);
`, { group: G_POUR_EMIT }),

  fn('IsContainerFull', 'Is container full',
    'Container _PARAM0_ is 100% full',
    'Check if container has reached its maximum volume capacity.', 'Condition',
    [],
    `const p = FW.pourableOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(p && p.currentVolume >= p.containerCapacity && p.containerCapacity > 0);
`, { group: G_POUR_CONTAINER }),

  fn('IsContainerEmpty', 'Is container empty',
    'Container _PARAM0_ is empty',
    'Check if container has zero liquid volume.', 'Condition',
    [],
    `const p = FW.pourableOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !p || p.currentVolume <= 0.0001;
`, { group: G_POUR_CONTAINER }),

  fn('IsFillLevelGreater', 'Is container fill level greater than',
    'Container _PARAM0_ fill level is greater than _PARAM2_ percent',
    'Check if container fill percentage exceeds a specific threshold (0 - 100%).', 'Condition',
    [num('Percent', 'Fill level threshold percentage (0 - 100)', '50.0')],
    `const threshold = eventsFunctionContext.getArgument("Percent");
const level = FW.getFillLevelPercent(runtimeScene, behavior);
eventsFunctionContext.returnValue = level >= threshold;
`, { group: G_POUR_CONTAINER }),
];

const pourExpressions = [
  fn('FillLevelPercent', 'Container fill level percentage',
    '', 'Returns container fill level as a percentage from 0.0 to 100.0%.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getFillLevelPercent(runtimeScene, behavior);
`, { group: G_POUR_CONTAINER, expressionType: 'number' }),

  fn('CurrentLiquidVolume', 'Current liquid volume',
    '', 'Returns fluid volume accumulated in liters.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getCurrentLiquidVolume(runtimeScene, behavior);
`, { group: G_POUR_CONTAINER, expressionType: 'number' }),

  fn('ActiveDropletCount', 'Active fluid droplet count',
    '', 'Returns the number of live fluid particles currently in the world simulation.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getActiveDropletCount(runtimeScene, behavior);
`, { group: G_POUR_PHYSICS, expressionType: 'number' }),

  fn('Viscosity', 'Liquid viscosity',
    '', 'Returns current fluid viscosity parameter.', 'Expression',
    [],
    `const p = FW.pourableOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = p ? p.viscosity : 1.0;
`, { group: G_POUR_PHYSICS, expressionType: 'number' }),

  fn('SurfaceTension', 'Surface tension',
    '', 'Returns current fluid surface tension parameter.', 'Expression',
    [],
    `const p = FW.pourableOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = p ? p.surfaceTension : 0.8;
`, { group: G_POUR_PHYSICS, expressionType: 'number' }),
];

const pourableLiquidBehavior = {
  name: 'PourableLiquid3D',
  fullName: 'Pourable Liquid 3D (SPH Fluid)',
  description: 'Attach to potion bottles, flasks, cauldrons, or taps for SPH droplet pouring, per-fluid viscosity, AABB container filling, and instanced-sphere rendering.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('FluidPreset', 'Choice', 'Fluid Preset Profile', 'Preset physical behavior and appearance.', 'MagicPotion', {
      extraInformation: ['Water', 'MagicPotion', 'HoneySyrup', 'GreenSlime', 'AcidPoison', 'LavaMagma', 'Custom']
    }),
    prop('MaxDroplets', 'Number', 'Max Active Droplets', 'Maximum live droplets from this emitter. The scene-wide solver holds 3000.', '1500'),
    prop('FlowRate', 'Number', 'Flow Rate', 'Droplets spawned per second when pouring.', '60.0'),
    prop('PourTiltThreshold', 'Number', 'Pour Tilt Threshold', 'Bottle pitch/tilt angle in degrees that starts pouring.', '45.0'),
    prop('DropletRadius', 'Number', 'Droplet Radius', 'Physics radius of individual liquid particles in meters.', '0.02'),
    prop('Viscosity', 'Number', 'Viscosity', 'Fluid thickness (0.1 = Water, 15.0 = Honey, 35.0 = Slime).', '1.0'),
    prop('SurfaceTension', 'Number', 'Surface Tension', 'Clumping cohesion force holding liquid stream together.', '0.8'),
    prop('RestDensity', 'Number', 'Rest Density', 'SPH target fluid density (kg/m3).', '1000.0'),
    prop('LiquidColor', 'Color', 'Liquid Tint Color', 'Albedo color tint of liquid stream.', '220;30;120'),
    prop('LiquidOpacity', 'Number', 'Liquid Opacity', 'Surface opacity (0.0 = Clear water, 1.0 = Opaque paint).', '0.85'),
    prop('LiquidRoughness', 'Number', 'Liquid Roughness', 'Reserved appearance value; the current unlit droplet renderer does not use it.', '0.05'),
    prop('ContainerCapacity', 'Number', 'Container Capacity', 'Maximum liquid volume capacity in liters.', '1.0'),
    prop('AutoPourOnTilt', 'Boolean', 'Auto-Pour On Tilt', 'Automatically pour when object is tilted past threshold.', 'true'),
  ],
  eventsFunctions: [
    ...pourLifecycle,
    ...pourActions,
    ...pourConditions,
    ...pourExpressions,
  ],
};


/* ========================================================= 4. OceanFFT3D Behavior */

const OCEAN_OPTIONS = `{
  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 12.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  waveHeightScale: behavior._getWaveHeightScale ? behavior._getWaveHeightScale() : 1.0,
  choppiness: behavior._getChoppiness ? behavior._getChoppiness() : 1.0,
  resolution: behavior._getResolution ? behavior._getResolution() : 64,
  gpuResolution: behavior._getGpuResolution ? behavior._getGpuResolution() : 256,
  gridSubdivisions: behavior._getGridSubdivisions ? behavior._getGridSubdivisions() : 64,
  tileSize: behavior._getTileSize ? behavior._getTileSize() : 0,
  seed: behavior._getSeed ? behavior._getSeed() : 1337,
  unitsPerMetre: behavior._getUnitsPerMetre ? behavior._getUnitsPerMetre() : 100.0,
  wavelengthScale: behavior._getWavelengthScale ? behavior._getWavelengthScale() : 0,
  peakWavelength: behavior._getPeakWavelength ? behavior._getPeakWavelength() : 0,
  shallowColor: behavior._getShallowColor ? behavior._getShallowColor() : '64;224;208',
  deepColor: behavior._getDeepColor ? behavior._getDeepColor() : '10;45;90',
  extinctionDepth: behavior._getExtinctionDepth ? behavior._getExtinctionDepth() : 150.0,
  foamIntensity: behavior._getFoamIntensity ? behavior._getFoamIntensity() : 0.8,
  maskUnderEdges: behavior._getMaskUnderEdges ? behavior._getMaskUnderEdges() : true,
  foamCoverage: behavior._getFoamCoverage ? behavior._getFoamCoverage() : 0.35,
  enableCaustics: behavior._getEnableCaustics ? behavior._getEnableCaustics() : true,
  enableUnderwaterFX: behavior._getEnableUnderwaterFX ? behavior._getEnableUnderwaterFX() : false,
  underwaterFogColor: behavior._getUnderwaterFogColor ? behavior._getUnderwaterFogColor() : '15;65;110',
  underwaterFogDensity: behavior._getUnderwaterFogDensity ? behavior._getUnderwaterFogDensity() : 0.0005,
  enableBodyInteractions: behavior._getEnableBodyInteractions ? behavior._getEnableBodyInteractions() : true,
  interactionStrength: behavior._getInteractionStrength ? behavior._getInteractionStrength() : 14.0,
  interactionRadius: behavior._getInteractionRadius ? behavior._getInteractionRadius() : 180.0,
  interactionSpeedThreshold: behavior._getInteractionSpeedThreshold ? behavior._getInteractionSpeedThreshold() : 35.0
}`;

const G_OCEAN_SEA = 'Sea State & Wind';
const G_OCEAN_LOOK = 'Color, Foam & Optics';

const oceanBehavior = {
  name: 'OceanFFT3D',
  fullName: 'Ocean FFT 3D (Tessendorf)',
  description:
    'Spectral ocean surface using the FFT method of Tessendorf 2001 — the model behind Sea of Thieves. '
    + 'Wave amplitude comes from a Phillips spectrum driven by WIND SPEED rather than an authored height, '
    + 'and the field carries thousands of wave components, so the surface does not repeat the way a sum of '
    + 'a few Gerstner octaves does. Buoyancy3D samples the exact same field the surface is displaced from. '
    + 'Attach to a 3D Box sized to your body of water. For lakes, pools and rivers, WaterBody3D is cheaper.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('WindSpeed', 'Number', 'Wind Speed (m/s)',
      'Drives the whole sea state. Significant wave height follows Hs = 0.21 x V^2 / g, so 6 m/s is a '
      + 'moderate breeze (~0.8 m), 14 m/s a near gale (~4 m), 24 m/s a severe gale (~12 m).', '12'),
    prop('WindDirection', 'Number', 'Wind Direction', 'Direction the sea runs, in degrees (0 - 360).', '45'),
    prop('PeakWavelength', 'Number', 'Wave Length (crest to crest)',
      'Distance from one wave crest to the next, in SCENE UNITS. This is the setting that decides '
      + 'how big the water feels next to the player: at 100 units per metre, 1400 is a 14 m swell a '
      + 'person could not see over, while 300 is choppy 3 m water. Leave at 0 to fit automatically '
      + 'to the water volume (about 2-3 waves across it).', '0'),
    prop('WavelengthScale', 'Number', 'Wavelength Scale (advanced)',
      'How LONG the waves are, independent of how tall. Leave at 0 to fit automatically to the '
      + 'water volume, which is almost always what you want: a real sea at 12 m/s has waves 92 m '
      + 'long, so on anything smaller the physically correct result is one swell spanning the whole '
      + 'surface, which looks flat. Auto-fit puts about 3-4 waves across the body at any size. Set a '
      + 'value below 1 for shorter, choppier waves; above 1 for longer swell.', '0'),
    prop('WaveHeightScale', 'Number', 'Wave Height Scale',
      'Art-direction multiplier on top of the physically derived wave height. 1.0 is physical.', '1'),
    prop('Choppiness', 'Number', 'Choppiness',
      'Horizontal displacement strength. 0 gives rounded swell, 1 sharpens crests and broadens troughs, '
      + 'above ~1.5 the surface starts to fold through itself.', '1'),
    prop('Resolution', 'Number', 'Spectrum Resolution',
      'FFT grid size, a power of two from 16 to 128. Higher resolves finer waves but costs CPU each '
      + 'frame: 32 is about 0.2 ms, 64 about 1.1 ms, 128 about 4 ms. 64 is a good default.', '64'),
    prop('GpuResolution', 'Number', 'GPU Spectrum Resolution',
      'Runs a second, higher-resolution spectrum entirely on the GPU (a ping-pong butterfly FFT), '
      + 'giving roughly 4x the wave detail for almost no CPU cost. A power of two up to 512, or 0 to '
      + 'disable. Must exceed Spectrum Resolution to take effect. Buoyancy keeps sampling the CPU '
      + 'field, which is the same spectrum low-passed, so hulls stay in phase with the swell. Falls '
      + 'back automatically if the device cannot render to float textures.', '256'),
    prop('GridSubdivisions', 'Number', 'Mesh Subdivisions',
      'Surface mesh resolution (8 - 256). Match it to Spectrum Resolution or higher; below it the mesh '
      + 'cannot show the waves the spectrum contains.', '64'),
    prop('TileSize', 'Number', 'Tile Size',
      'Period at which the wave field repeats, in scene units. 0 uses the volume size, which puts exactly '
      + 'one tile across the water so it never visibly repeats.', '0'),
    prop('Seed', 'Number', 'Random Seed', 'Changes which ocean you get. The same seed always rebuilds the same sea.', '1337'),
    prop('UnitsPerMetre', 'Number', 'Units Per Metre',
      'How many scene units make one real metre. This is what ties wind speed to a wave size you can see, '
      + 'so set it to match your world, not to 100 by habit: divide your character\'s height in scene units by '
      + 'their height in metres. A 1000-unit character who reads as a normal adult means about 550. '
      + '100 is the Physics3D default and only correct if your scene is actually built at that scale.', '100'),
    prop('ShallowColor', 'Color', 'Shallow Water Color', 'Color where the water is shallow (near a WaterEdge3D).', '64;224;208'),
    prop('DeepColor', 'Color', 'Deep Ocean Color', 'Color in deep water.', '10;45;90'),
    prop('ExtinctionDepth', 'Number', 'Extinction Depth', 'Beer-Lambert scale length, in scene units.', '150'),
    prop('FoamIntensity', 'Number', 'Foam Intensity', 'Opacity of whitecap and shoreline foam.', '0.8'),
    prop('FoamCoverage', 'Number', 'Foam Coverage',
      'How much of the surface breaks. Foam appears where the surface folds (the displacement Jacobian), '
      + 'so raising Choppiness produces more of it naturally.', '0.35'),
    prop('MaskUnderEdges', 'Boolean', 'Cut Water Under Edges', 'Cut the water away wherever a WaterEdge3D volume covers it. That volume is an axis-aligned BOX, so a large or irregular piece of land removes a rectangle of water, not its real outline - if the water looks sliced off in a straight line where it meets your coast, turn this OFF. The edge still produces foam and shallows; your actual 3D land hides the water by itself.', 'true'),
    prop('EnableCaustics', 'Boolean', 'Enable Caustics', 'Animated caustic light patterns in shallow water.', 'true'),
    prop('EnableUnderwaterFX', 'Boolean', 'Enable Underwater FX', 'Fog and tint when the camera submerges.', 'false'),
    prop('UnderwaterFogColor', 'Color', 'Underwater Fog Color', 'Tint when submerged.', '15;65;110'),
    prop('UnderwaterFogDensity', 'Number', 'Underwater Fog Density', 'Visibility falloff underwater.', '0.0005'),
    prop('EnableBodyInteractions', 'Boolean', 'Physics Body Ripples',
      'Automatically detect moving Physics3D/Jolt bodies intersecting this ocean volume and create wakes and splash rings. The moving object does not need Buoyancy3D.', 'true'),
    prop('InteractionStrength', 'Number', 'Splash Strength',
      'Maximum vertical displacement, in scene units, produced by a fast moving body.', '14'),
    prop('InteractionRadius', 'Number', 'Splash Radius',
      'Maximum radius, in scene units, reached by each movement ripple.', '180'),
    prop('InteractionSpeedThreshold', 'Number', 'Splash Speed Threshold',
      'Minimum Physics3D or measured movement speed, in scene units per second, before a wake is emitted.', '35'),
  ],
  eventsFunctions: [
    {
      name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.registerOcean(runtimeScene, object, behavior, ${OCEAN_OPTIONS});\n`, { withRuntime: true }),
    },
    {
      name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.stepOcean(runtimeScene, object, behavior);\n`),
    },
    {
      name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.disposeOcean(runtimeScene, behavior);\n`),
    },

    fn('SetWind', 'Set wind speed and direction',
      'Set wind on _PARAM0_ to _PARAM2_ m/s heading _PARAM3_ degrees',
      'Changes the sea state. Rebuilds the wave spectrum, so call it on change rather than every frame.',
      'Action',
      [num('WindSpeed', 'Wind speed in m/s', '12'), num('WindDirection', 'Heading in degrees', '45')],
      `const ws = eventsFunctionContext.getArgument("WindSpeed");
const wd = eventsFunctionContext.getArgument("WindDirection");
if (behavior._setWindSpeed) behavior._setWindSpeed(ws);
if (behavior._setWindDirection) behavior._setWindDirection(wd);
FW.setOceanWind(runtimeScene, behavior, ws, wd);
`, { group: G_OCEAN_SEA }),

    fn('SetPeakWavelength', 'Set wave length',
    'Set wave length (crest to crest) on _PARAM0_ to _PARAM2_ units',
    'Distance between wave crests in scene units - the most direct way to control how big the '
    + 'water feels. 0 fits automatically to the volume.', 'Action',
    [num('PeakWavelength', 'Crest-to-crest distance in scene units (0 = auto)', '0')],
    `const val = eventsFunctionContext.getArgument("PeakWavelength");
if (behavior._setPeakWavelength) behavior._setPeakWavelength(val);
const o = FW.oceanOf(runtimeScene, behavior);
if (o) { o.peakWavelengthOption = val; FW.setOceanWind(runtimeScene, behavior, o.windSpeed, o.windDirection); }
`, { group: G_OCEAN_SEA }),

  fn('SetWavelengthScale', 'Set wavelength scale',
    'Set wave length scale on _PARAM0_ to _PARAM2_',
    'How long the waves are, independent of height. 0 refits automatically to the water volume.',
    'Action',
    [num('WavelengthScale', 'Scale (0 = auto)', '0')],
    `const val = eventsFunctionContext.getArgument("WavelengthScale");
if (behavior._setWavelengthScale) behavior._setWavelengthScale(val);
const o = FW.oceanOf(runtimeScene, behavior);
if (o) { o.wavelengthScaleOption = val; FW.setOceanWind(runtimeScene, behavior, o.windSpeed, o.windDirection); }
`, { group: G_OCEAN_SEA }),

  fn('SetChoppiness', 'Set choppiness',
      'Set ocean choppiness on _PARAM0_ to _PARAM2_',
      'Horizontal displacement strength. Higher values sharpen crests and produce more breaking foam.',
      'Action',
      [num('Choppiness', 'Choppiness (0 - 1.5)', '1')],
      `const val = eventsFunctionContext.getArgument("Choppiness");
if (behavior._setChoppiness) behavior._setChoppiness(val);
FW.setOceanChoppiness(runtimeScene, behavior, val);
`, { group: G_OCEAN_SEA }),

    fn('IsCameraUnderwater', 'Is camera underwater',
      'Camera is submerged in _PARAM0_',
      'True when the active camera is below the ocean surface.', 'Condition', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o ? !!o.isCameraUnderwater : false;
`, { group: G_OCEAN_LOOK }),

    fn('WaveHeightAt', 'Wave height at position', '',
      'Wave displacement Z at world (X, Y), from the same field the surface is rendered from.',
      'Expression',
      [num('X', 'World X', '0'), num('Y', 'World Y', '0')],
      `eventsFunctionContext.returnValue = FW.getOceanWaveHeightAt(runtimeScene, behavior,
  eventsFunctionContext.getArgument("X"), eventsFunctionContext.getArgument("Y"));
`, { group: G_OCEAN_SEA, expressionType: 'number' }),

    fn('SurfaceZ', 'Water surface altitude at position', '',
      'Absolute surface altitude Z at world (X, Y), including the wave.', 'Expression',
      [num('X', 'World X', '0'), num('Y', 'World Y', '0')],
      `eventsFunctionContext.returnValue = FW.getOceanSurfaceZ(runtimeScene, behavior,
  eventsFunctionContext.getArgument("X"), eventsFunctionContext.getArgument("Y"));
`, { group: G_OCEAN_SEA, expressionType: 'number' }),

    fn('SignificantWaveHeight', 'Significant wave height', '',
      'Significant wave height in scene units, derived from wind speed (Hs = 0.21 V^2 / g).',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getSignificantWaveHeight(runtimeScene, behavior);
`, { group: G_OCEAN_SEA, expressionType: 'number' }),

    fn('WindSpeed', 'Wind speed', '', 'Current wind speed in m/s.', 'Expression', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o ? o.windSpeed : 0;
`, { group: G_OCEAN_SEA, expressionType: 'number' }),
  ],
};

/* ========================================================= 5. WaterEdge3D Behavior */

const EDGE_OPTIONS = `{
  foamWidth: behavior._getFoamWidth ? behavior._getFoamWidth() : 120.0,
  shallowWidth: behavior._getShallowWidth ? behavior._getShallowWidth() : 400.0,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,
  hideSourceObject: behavior._getHideSourceObject ? behavior._getHideSourceObject() : false
}`;

const edgeBehavior = {
  name: 'WaterEdge3D',
  fullName: 'Water Edge 3D (Coastline)',
  description:
    'Marks an axis-aligned beach, cliff, rock or harbour volume as a water edge. WaterBody3D and OceanFFT3D surfaces mask beneath it, foam along it, '
    + 'and shallows out toward it, so the coastline drives the water rather than the water being a plain '
    + 'rectangle. Attach to a 3D Box covering the land, or to a 3D Model. Up to 8 edges affect a given '
    + 'water body at once, chosen nearest-first — cover a long coast with a few large volumes rather than '
    + 'many small ones.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('FoamWidth', 'Number', 'Foam Band Width',
      'How far the surf reaches out from this edge, in SCENE UNITS. Leave at 0 to size it against the '
      + 'water body automatically (about 8% of its short side) - useful on a very large bay where a '
      + 'fixed width reads as a hairline, but it widens the surf, so it is opt-in.', '120'),
    prop('ShallowWidth', 'Number', 'Shallow Water Width',
      'How far the shallow-water color reaches out from this edge, in SCENE UNITS. Leave at 0 for three '
      + 'times the foam band width. Raising this widens the pale shallow-water tint, not just the foam.', '400'),
    prop('Enabled', 'Boolean', 'Enabled', 'Whether this edge currently affects the water.', 'true'),
    prop('HideSourceObject', 'Boolean', 'Hide Helper Object',
      'Hide the object at runtime when it is only a helper volume. Leave disabled when the object is visible land.', 'false'),
  ],
  eventsFunctions: [
    {
      name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.registerWaterEdge(runtimeScene, object, behavior, ${EDGE_OPTIONS});\n`, { withRuntime: true }),
    },
    {
      name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.stepWaterEdge(runtimeScene, object, behavior,
  behavior._getHideSourceObject ? behavior._getHideSourceObject() : false);
`),
    },
    {
      name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.disposeWaterEdge(runtimeScene, behavior);\n`),
    },

    fn('SetEnabled', 'Enable / disable this water edge',
      'Set water edge _PARAM0_ enabled: _PARAM2_',
      'Turn this edge on or off without destroying the object.', 'Action',
      [bool('Enabled', 'Enabled')],
      `const val = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(val);
FW.setWaterEdgeEnabled(runtimeScene, behavior, val);
`, { group: 'Water Edge' }),
  ],
};

/* ========================================================= 6. Global Free Functions */


const G_GLOBAL_FLUID = 'Fluid & Water — Global Controls';

// GDevelop recognises a set of extension lifecycle free functions by name and calls them on every
// scene load, ahead of that scene's own events. Installing the runtime here once, instead of
// prepending a copy to every JsCode block, is the difference between a ~1.4 MB extension and a
// ~140 KB one. Each behavior's onCreated keeps a copy as a fallback; the runtime IIFE self-guards
// on gdjs.__fluidAndWater3D, so a second install is a no-op.
const runtimeInstaller = {
  name: 'onSceneLoaded',
  fullName: '',
  description: 'Installs the FluidAndWater3D runtime engine (internal).',
  sentence: '',
  functionType: 'Action',
  private: true,
  parameters: [],
  events: evFree('', { withRuntime: true }),
};

const freeActions = [
  freeFn('SetDropletFloorZ', 'Set droplet floor altitude',
    'Set poured droplet floor altitude to _PARAM0_',
    'Altitude (Z) that poured droplets pile up on. Set this to your ground or table height so '
    + 'liquid does not stop in mid-air. Defaults to 0.', 'Action',
    [num('FloorZ', 'Floor altitude Z in scene units', '0')],
    `FW.setDropletFloorZ(runtimeScene, eventsFunctionContext.getArgument("FloorZ"));
`, { group: G_GLOBAL_FLUID }),

  freeFn('SetGlobalFluidTimeScale', 'Set fluid simulation time scale',
    'Set global fluid simulation time scale to _PARAM0_',
    'Scale simulation speed for slow-motion or fast fluid pouring.', 'Action',
    [num('TimeScale', 'Simulation time scale multiplier (1.0 = normal speed)', '1.0')],
    `FW.setGlobalFluidTimeScale(runtimeScene, eventsFunctionContext.getArgument("TimeScale"));
`, { group: G_GLOBAL_FLUID }),

  freeFn('PauseAllFluids', 'Pause / Resume all fluids',
    'Set fluid and water simulation paused: _PARAM0_',
    'Pause all wave animations and fluid particle calculations.', 'Action',
    [bool('Pause', 'Pause fluid simulation')],
    `FW.pauseAllFluids(runtimeScene, !!eventsFunctionContext.getArgument("Pause"));
`, { group: G_GLOBAL_FLUID }),

  freeFn('ClearAllGlobalDroplets', 'Clear all active droplets in scene',
    'Clear all active fluid droplets from the entire scene',
    'Instantly remove all active SPH fluid particles in the scene.', 'Action',
    [],
    `FW.clearAllDroplets(runtimeScene);
`, { group: G_GLOBAL_FLUID }),
];

const freeConditions = [
  freeFn('IsCameraUnderwaterAny', 'Is camera underwater in any water body',
    'Active camera is submerged in any active water body',
    'Check if scene camera is currently submerged below any water body surface.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FW.isCameraUnderwaterAny(runtimeScene);
`, { group: G_GLOBAL_FLUID }),

  freeFn('IsSupported', 'Fluid & Water 3D is supported (WebGL2)',
    'Fluid & Water 3D is supported on current device',
    'Check if WebGL2 3D rendering is available.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FW.isSupported(runtimeScene);
`, { group: G_GLOBAL_FLUID }),
];

const freeExpressions = [
  freeFn('GetTotalActiveDroplets', 'Total active droplets in scene',
    '', 'Returns total count of all active simulated SPH fluid droplets.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FW.getTotalActiveDropletCount(runtimeScene);
`, { group: G_GLOBAL_FLUID, expressionType: 'number' }),

  freeFn('GetGlobalWaterSurfaceZ', 'Global water surface altitude at position',
    '', 'Returns top water surface altitude Z at world coordinates (X, Y).', 'Expression',
    [num('X', 'World X coordinate', '0'), num('Y', 'World Y coordinate', '0')],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
eventsFunctionContext.returnValue = FW.getGlobalWaterSurfaceZ(runtimeScene, x, y);
`, { group: G_GLOBAL_FLUID, expressionType: 'number' }),
];

/* ============================================================== Extension Object */

const extension = {
  name: 'FluidAndWater3D',
  fullName: 'Fluid and Water 3D',
  description: 'Water and stylized fluid toolkit for GDevelop 5 (Three.js WebGL2 backend). Features Gerstner water volumes, Tessendorf spectral oceans, approximate depth absorption and shoreline foam, underwater fog, multi-probe boat buoyancy, and pourable SPH droplets with container fill tracking.',
  shortDescription: 'Gerstner and FFT oceans, underwater fog, boat buoyancy, and pourable SPH droplets.',
  category: '3D',
  author: 'Twillion',
  license: 'MIT',
  version: '2.11.1',
  iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  tags: [
    '3D',
    'water',
    'ocean',
    'fluid',
    'sph',
    'gerstner',
    'waves',
    'buoyancy',
    'pouring',
    'potion',
    'shader',
    'physics'
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [
    runtimeInstaller,
    ...freeActions,
    ...freeConditions,
    ...freeExpressions,
  ],
  eventsBasedBehaviors: [
    waterBodyBehavior,
    oceanBehavior,
    edgeBehavior,
    buoyancyBehavior,
    pourableLiquidBehavior,
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
// Walk the extension itself rather than a hardcoded list: naming the behaviors individually meant
// a newly added behavior shipped completely unvalidated, which is exactly what happened when
// OceanFFT3D and WaterEdge3D were added.
for (const b of extension.eventsBasedBehaviors) walkEvents(b.eventsFunctions, b.name);
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
for (const b of extension.eventsBasedBehaviors) checkNamesAndSentences(b.eventsFunctions, b.name);
checkNamesAndSentences(extension.eventsFunctions, 'freeFunctions');

// 2b. Every behavior property a runtime options block reads must actually exist, or the generated
// `behavior._getX ? behavior._getX() : default` silently falls through to the default forever.
for (const b of extension.eventsBasedBehaviors) {
  const declared = new Set((b.propertyDescriptors || []).map((p) => p.name));
  const code = JSON.stringify(b.eventsFunctions);
  for (const m of code.matchAll(/behavior\._get([A-Za-z0-9_]+) \?/g)) {
    if (!declared.has(m[1])) {
      console.error(`
${b.name} reads property "${m[1]}" but never declares it.
`);
      process.exit(1);
    }
  }
}

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
  ...extension.eventsBasedBehaviors.flatMap((behavior) => behavior.eventsFunctions),
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
for (const behavior of extension.eventsBasedBehaviors) {
  checkObjectParams(behavior.eventsFunctions, behavior.name, true);
}
checkObjectParams(extension.eventsFunctions, 'freeFunctions', false);

// Write output JSON, or verify that the checked-in artifact is current.
const outPath = path.join(here, 'FluidAndWater3D.json');
const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing !== json) {
    console.error(`\n${path.basename(outPath)} is stale. Run node FluidAndWater3D/build-extension.mjs and commit the result.\n`);
    process.exit(1);
  }
} else {
  fs.writeFileSync(outPath, json, 'utf8');
}

const counts = allFns.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\n${checkOnly ? 'Verified' : 'Successfully built'} ${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
