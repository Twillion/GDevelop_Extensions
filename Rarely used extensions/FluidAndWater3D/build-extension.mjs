/**
 * build-extension.mjs
 * Compiles FluidAndWater3D.json from the runtime engine + behavior & function declarations.
 *
 * Run: node FluidAndWater3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every rung of the maritime scale. The six the runtime authors by hand are anchors; the rest are
// interpolated between them, so the dropdown is a continuous scale rather than seven separate looks.
const BEAUFORT_RUNG_NAMES = [
  'Calm', 'Light Air', 'Light Breeze', 'Gentle Breeze', 'Moderate Breeze', 'Fresh Breeze',
  'Strong Breeze', 'Near Gale', 'Gale', 'Strong Gale', 'Storm', 'Violent Storm', 'Hurricane',
];
const BEAUFORT_CHOICES = ['Custom'].concat(
  BEAUFORT_RUNG_NAMES.map((n, i) => 'Beaufort ' + i + ' - ' + n));
const ANISOTROPY_CHOICES = ['1 (Off)', '2x', '4x', '8x', '16x'];



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
  waterType: behavior._getArtWaterType ? behavior._getArtWaterType() : 'Ocean',
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
  fullName: 'Gerstner Water 1 (WaterBody3D)',
  description: 'Attach to a 3D Box or Plane to create sizable ocean volumes, lakes, rivers, or swimming pools with Gerstner waves, Beer-Lambert depth absorption, foam, and underwater camera transitions.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ArtWaterType', 'Choice', 'Water Type', 'Palette and optics profile: colour, optical depth, caustics, crest and shore foam, and refraction. Choosing a named type OVERRIDES the colour, foam and optics properties below - set this to Custom to author them yourself. It does not touch the wave settings.', 'Ocean', {
      extraInformation: ['Ocean', 'Lake', 'River', 'Swimming Pool', 'Custom']
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
  maxSubmersionDepth: behavior._getMaxSubmersionDepth ? behavior._getMaxSubmersionDepth() : 0.0,
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
    prop('MaxSubmersionDepth', 'Number', 'Max Submersion Depth', 'Depth in scene units at which buoyant force reaches its maximum. Leave at 0 to scale it to the hull depth of this object - full lift once the hull is half under - which is right at almost any project scale. A value here is in PIXELS, not metres.', '0'),
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
  fluidPreset: behavior._getArtFluidPreset ? behavior._getArtFluidPreset() : 'Magic Potion',
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
    'Apply a fluid profile, setting viscosity, surface tension, density, droplet size and colour together.', 'Action',
    [choice('Preset', 'Fluid preset profile', ['Water', 'Magic Potion', 'Honey Syrup', 'Green Slime', 'Acid Poison', 'Lava Magma'])],
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
    prop('ArtFluidPreset', 'Choice', 'Fluid Preset Profile', 'Preset physical behavior and appearance.', 'Magic Potion', {
      extraInformation: ['Water', 'Magic Potion', 'Honey Syrup', 'Green Slime', 'Acid Poison', 'Lava Magma', 'Custom']
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


/* ========================================================= 4b. OceanWaveWorks3D Behavior */

const WAVEWORKS_OPTIONS = `{
  beaufortScale: behavior._getBeaufortScale ? behavior._getBeaufortScale() : 'Beaufort 4 - Moderate Breeze',
  persistentFoam: behavior._getPersistentFoam ? behavior._getPersistentFoam() : false,
  sunHeading: behavior._getSunHeading ? behavior._getSunHeading() : 75.0,
  sunElevation: behavior._getSunElevation ? behavior._getSunElevation() : 18.0,
  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 7.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  swellAngle: behavior._getSwellAngle ? behavior._getSwellAngle() : 60.0,
  swellWeight: behavior._getSwellWeight ? behavior._getSwellWeight() : 0.55,
  waveHeightScale: behavior._getWaveHeightScale ? behavior._getWaveHeightScale() : 1.0,
  choppiness: behavior._getChoppiness ? behavior._getChoppiness() : 0.9,
  cascadeScale: behavior._getCascadeScale ? behavior._getCascadeScale() : 0.25,
  cascadeWeight: behavior._getCascadeWeight ? behavior._getCascadeWeight() : 0.60,
  opacity: behavior._getOpacity ? behavior._getOpacity() : 0.85,
  microDetail: behavior._getMicroDetail ? behavior._getMicroDetail() : 0.55,
  resolution: behavior._getResolution ? behavior._getResolution() : 64,
  gridSubdivisions: behavior._getGridSubdivisions ? behavior._getGridSubdivisions() : 64,
  tileSize: behavior._getTileSize ? behavior._getTileSize() : 0,
  seed: behavior._getSeed ? behavior._getSeed() : 1337,
  unitsPerMetre: behavior._getUnitsPerMetre ? behavior._getUnitsPerMetre() : 100.0,
  wavelengthScale: behavior._getWavelengthScale ? behavior._getWavelengthScale() : 0,
  peakWavelength: behavior._getPeakWavelength ? behavior._getPeakWavelength() : 0,
  shallowColor: behavior._getShallowColor ? behavior._getShallowColor() : '64;224;208',
  deepColor: behavior._getDeepColor ? behavior._getDeepColor() : '10;45;90',
  extinctionDepth: behavior._getExtinctionDepth ? behavior._getExtinctionDepth() : 150.0,
  foamIntensity: behavior._getFoamIntensity ? behavior._getFoamIntensity() : 0.55,
  maskUnderEdges: behavior._getMaskUnderEdges ? behavior._getMaskUnderEdges() : true,
  foamCoverage: behavior._getFoamCoverage ? behavior._getFoamCoverage() : 0.25,
  enableCaustics: behavior._getEnableCaustics ? behavior._getEnableCaustics() : true,
  enableUnderwaterFX: behavior._getEnableUnderwaterFX ? behavior._getEnableUnderwaterFX() : false,
  underwaterFogColor: behavior._getUnderwaterFogColor ? behavior._getUnderwaterFogColor() : '15;65;110',
  underwaterFogDensity: behavior._getUnderwaterFogDensity ? behavior._getUnderwaterFogDensity() : 0.0005,
  enableBodyInteractions: behavior._getEnableBodyInteractions ? behavior._getEnableBodyInteractions() : true,
  interactionStrength: behavior._getInteractionStrength ? behavior._getInteractionStrength() : 14.0,
  interactionRadius: behavior._getInteractionRadius ? behavior._getInteractionRadius() : 180.0,
  interactionSpeedThreshold: behavior._getInteractionSpeedThreshold ? behavior._getInteractionSpeedThreshold() : 35.0,
  textureAnisotropy: behavior._getTextureAnisotropy ? behavior._getTextureAnisotropy() : '4x'
}`;

const G_WW_SEA = 'Sea State & Wind';
const G_WW_LOOK = 'Color, Foam & Optics';

const oceanWaveWorksBehavior = {
  name: 'OceanWaveWorks3D',
  fullName: 'Ocean WaveWorks 3D (Multi-Cascade FFT)',
  description:
    'Multi-cascade cinematic ocean simulation inspired by NVIDIA WaveWorks. Evaluates dual-cascade spectral FFTs '
    + 'simultaneously (macro deep ocean gravity swells + fine high-frequency choppy wind ripples) to eliminate visible '
    + 'tile repetition and achieve horizon-to-shore realism. Includes international Beaufort wind scale presets '
    + '(Beaufort 0 to 12), multi-frequency Jacobian whitecap folding, backlit crest subsurface scattering (SSS), '
    + 'and seamless Buoyancy3D and WaterEdge3D compatibility.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('SwellWeight', 'Number', 'Cross-Swell Strength',
      'How much of the sea is the second, cross-running swell. This is a full sea of its own at the '
      + 'same wavelength as the primary - not ripples on it - which is what lets two comparable '
      + 'crests actually meet and throw water up. Measured hard collisions at Beaufort 9: 0.44% '
      + 'with no cross swell, 1.44% at 0.55, 2.91% at 1.0. Set to 0 to disable it entirely, which '
      + 'also skips its FFTs.',
      '0.55'),
    prop('SwellAngle', 'Number', 'Cross-Swell Angle',
      'Degrees between the two wave trains. The wave spectrum concentrates energy along the wind '
      + 'and cuts waves running against it to 7%, so with a single direction every crest travels '
      + 'the same way and they can never meet - the sea marches instead of colliding. A real sea '
      + 'crosses because swell from a distant storm runs at an angle to the local wind. Around 48 '
      + 'degrees onward gives the most collisions; below about 30 the two seas are too aligned to '
      + 'meet. This is what drives crest-collision spray. Set to 0 for a single-direction sea.',
      '60'),
    prop('BeaufortScale', 'Choice', 'Beaufort Scale Preset',
      'Maritime Beaufort sea scale preset, from Beaufort 0 (mirror calm) to Beaufort 12 (hurricane). Wave height follows the wind speed of the chosen scale rather than being authored directly. Choosing a named preset OVERRIDES the individual colour, foam and sea-state properties below - set this to Custom to author those yourself. For colour, sun and foam styling attach WaterDetailing3D.',
      'Beaufort 4 - Moderate Breeze', { extraInformation: BEAUFORT_CHOICES }),
    prop('PersistentFoam', 'Boolean', 'Persistent Foam (experimental)',
      'Keeps foam in a render target that is blurred with feedback each frame, so whitecaps streak behind the crest and disperse instead of vanishing with it - the way Sea of Thieves does it. How long foam survives comes from the WaterDetailing3D Sub-style: about 3.85s in salt water against 2.54s in fresh. OFF by default: it is the one part of the water that needs a real GPU to verify, and it falls back to the ordinary crest foam if the render target is unusable.',
      'false'),
    prop('WindSpeed', 'Number', 'Wind Speed (m/s)',
      'Wind speed driving the primary spectrum (Hs = 0.21 x V^2 / g).', '7'),
    prop('WindDirection', 'Number', 'Wind Direction', 'Direction waves travel in degrees (0 - 360).', '45'),
    prop('CascadeScale', 'Number', 'Cascade Frequency Scale',
      'Spatial tile ratio of the high-frequency cascade relative to macro swells (default 0.25 = 4x tighter frequency domain).', '0.25'),
    prop('CascadeWeight', 'Number', 'Cascade Blend Weight',
      'Blending strength of the high-frequency cascade displacement and normals (0.0 to 1.5).', '0.60'),
    prop('PeakWavelength', 'Number', 'Wave Length (crest to crest)',
      'Distance from crest to crest in scene units (0 = auto-fit to volume).', '0'),
    prop('WavelengthScale', 'Number', 'Wavelength Scale',
      'Wavelength scale multiplier (0 = auto-fit).', '0'),
    prop('WaveHeightScale', 'Number', 'Wave Height Scale',
      'Art-direction multiplier on top of physical wave height.', '1'),
    prop('Choppiness', 'Number', 'Choppiness',
      'Horizontal displacement sharpness (0 = rounded, 1 = sharp crests, >1.5 = folding).', '0.9'),
    prop('Resolution', 'Number', 'Spectrum Resolution',
      'FFT grid size per cascade, power of two from 16 to 128 (default 64).', '64'),
    prop('GridSubdivisions', 'Number', 'Mesh Grid Subdivisions',
      'Mesh surface vertex subdivisions (16 to 256).', '64'),
    prop('TileSize', 'Number', 'Tile Size',
      'Spatial repetition period in scene units (0 = water volume size).', '0'),
    prop('Seed', 'Number', 'Random Seed', 'Deterministic phase seed.', '1337'),
    prop('UnitsPerMetre', 'Number', 'Units Per Metre', 'Scene units per real-world metre.', '100'),
    prop('Opacity', 'Number', 'Opacity', 'Water transparency (0.0 = clear glass, 1.0 = fully opaque).', '0.85'),
    prop('MicroDetail', 'Number', 'Micro Ripples Detail',
      'Procedural wind-aligned capillary normal ripple strength (0.0 = mirror smooth).', '0.55'),
    prop('ShallowColor', 'Color', 'Shallow Water Color', 'Tropical shallow / shoreline tint.', '64;224;208'),
    prop('DeepColor', 'Color', 'Deep Ocean Color', 'Deep oceanic water tint.', '10;45;90'),
    prop('ExtinctionDepth', 'Number', 'Extinction Depth', 'Beer-Lambert depth absorption scale in scene units.', '150'),
    prop('TextureAnisotropy', 'Choice', 'Anisotropic Filtering',
      'Requested anisotropic filtering level for ocean detail at grazing angles. Uses mipmaps on supported devices and falls back to 1x when unavailable. Does not change wave geometry.',
      '4x', { extraInformation: ANISOTROPY_CHOICES }),
    prop('FoamIntensity', 'Number', 'Foam Intensity', 'Whitecap froth and shoreline foam brightness.', '0.55'),
    prop('FoamCoverage', 'Number', 'Foam Coverage', 'Wave crest folding threshold where whitecaps break.', '0.25'),
    prop('MaskUnderEdges', 'Boolean', 'Mask Under Edges', 'Cut water surface beneath WaterEdge3D land.', 'true'),
    prop('EnableCaustics', 'Boolean', 'Enable Caustics', 'Render animated Voronoi seabed light caustics.', 'true'),
    prop('SunHeading', 'Number', 'Sun Heading (Azimuth)',
      'Sun horizontal direction in degrees (0 = East, 90 = North, 180 = West, 270 = South). Automatically follows scene Directional Light if present unless manually configured.', '75.0'),
    prop('SunElevation', 'Number', 'Sun Elevation (Altitude)',
      'Sun altitude angle above horizon in degrees (0 = horizon, 90 = zenith noon). Low angles (15-25°) produce the golden-hour specular trail.', '18.0'),
    prop('EnableUnderwaterFX', 'Boolean', 'Enable Underwater Fog', 'Automatic underwater fog when camera dives.', 'false'),
    prop('UnderwaterFogColor', 'Color', 'Underwater Fog Color', 'Tint for submerged camera view.', '15;65;110'),
    prop('UnderwaterFogDensity', 'Number', 'Underwater Fog Density', 'Underwater visibility decay.', '0.0005'),
    prop('EnableBodyInteractions', 'Boolean', 'Body Interactions', 'Moving Physics3D bodies cause splashes and wakes.', 'true'),
    prop('InteractionStrength', 'Number', 'Splash Strength', 'Height of wake ripples generated by moving bodies.', '14'),
    prop('InteractionRadius', 'Number', 'Splash Radius', 'Travel distance of wake ripples.', '180'),
    prop('InteractionSpeedThreshold', 'Number', 'Splash Speed Threshold', 'Minimum velocity required to make a splash.', '35')
  ],
  eventsFunctions: [
    {
      name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.registerWaveWorksOcean(runtimeScene, object, behavior, ${WAVEWORKS_OPTIONS});\n`, { withRuntime: true }),
    },
    {
      name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.stepWaveWorksOcean(runtimeScene, object, behavior);\n`),
    },
    {
      name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.disposeWaveWorksOcean(runtimeScene, behavior);\n`),
    },

    fn('LogDiagnostics', 'Log ocean diagnostics to the console',
      'Log ocean diagnostics for _PARAM0_',
      'Prints the live sea state to the browser console: tile size, significant wave height, wavelength, mesh scale, and a warning with exact fix numbers if the waves are too big for this water body. The same block is printed once at scene start, but that is BEFORE any "Set Beaufort scale" action runs - call this afterwards to see the sea you are actually showing.',
      'Action', [],
      `FW.logWaveWorksDiagnostics(runtimeScene, behavior);`),

    fn('WaveSteepness', 'Wave steepness', '',
      'Significant wave height divided by the tile the spectrum repeats across - the one number that decides whether a sea reads as water. Real wind waves sit near 0.04. Water physically cannot stand up past about 0.10; beyond that the surface folds everywhere, foams everywhere, and displaces outside its own volume, which looks like snow-capped mountains rather than sea.',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaveWorksSteepness(runtimeScene, behavior);`),

    fn('SetBeaufortScale', 'Set Beaufort scale preset',
      'Set Beaufort scale preset on _PARAM0_ to _PARAM2_ over _PARAM3_ seconds',
      'Sets the sea state from the maritime Beaufort scale. Wave height follows the wind speed of the chosen scale. Adjacent rungs differ by 38-92% in wave height - the scale is roughly cubic - so an instant change is a visible pop: give it a transition time in seconds and the sea grows or calms smoothly through every rung in between. 0 is instant, which is the old behaviour.',
      'Action',
      [choice('Scale', 'Beaufort Scale', BEAUFORT_CHOICES),
        num('Seconds', 'Transition time in seconds (0 = instant)', '0')],
      `const s = eventsFunctionContext.getArgument("Scale");
const seconds = Number(eventsFunctionContext.getArgument("Seconds")) || 0;
if (behavior._setBeaufortScale) behavior._setBeaufortScale(s);
FW.setWaveWorksBeaufort(runtimeScene, behavior, s, seconds);
`, { group: G_WW_SEA }),

    fn('BeaufortScale', 'Beaufort scale preset name', '', 'Current Beaufort scale preset name.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaveWorksBeaufort(runtimeScene, behavior);
`, { group: G_WW_SEA, expressionType: 'string' }),

    fn('SetCascadeWeight', 'Set cascade blend weight',
      'Set cascade blend weight on _PARAM0_ to _PARAM2_',
      'Controls blending strength of the high-frequency cascade (0.0 = only macro swells, 1.0 = full chop and wavelets).',
      'Action',
      [num('Weight', 'Weight (0.0 to 1.5)', '0.60')],
      `const val = eventsFunctionContext.getArgument("Weight");
if (behavior._setCascadeWeight) behavior._setCascadeWeight(val);
FW.setWaveWorksCascadeWeight(runtimeScene, behavior, val);
`, { group: G_WW_SEA }),

    fn('CascadeWeight', 'Cascade blend weight', '', 'Current high-frequency cascade blend weight.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaveWorksCascadeWeight(runtimeScene, behavior);
`, { group: G_WW_SEA, expressionType: 'number' }),

    fn('SetOpacity', 'Set water opacity',
      'Set water opacity on _PARAM0_ to _PARAM2_',
      'Controls overall water transparency (0.0 = completely transparent, 1.0 = normal opacity).',
      'Action',
      [num('Opacity', 'Opacity (0.0 to 1.0)', '0.85')],
      `const val = eventsFunctionContext.getArgument("Opacity");
if (behavior._setOpacity) behavior._setOpacity(val);
FW.setWaveWorksOpacity(runtimeScene, behavior, val);
`, { group: G_WW_LOOK }),

    fn('Opacity', 'Water opacity', '', 'Current water opacity (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaveWorksOpacity(runtimeScene, behavior);
`, { group: G_WW_LOOK, expressionType: 'number' }),

    fn('SetMicroDetail', 'Set micro-wave ripples detail',
      'Set micro-wave ripples detail on _PARAM0_ to _PARAM2_',
      'Controls the procedural wind-aligned capillary ripple normal strength (0.0 = mirror smooth).',
      'Action',
      [num('MicroDetail', 'Detail strength (0.0 to 2.0)', '0.55')],
      `const val = eventsFunctionContext.getArgument("MicroDetail");
if (behavior._setMicroDetail) behavior._setMicroDetail(val);
FW.setWaveWorksMicroDetail(runtimeScene, behavior, val);
`, { group: G_WW_LOOK }),

    fn('SetTextureAnisotropy', 'Set ocean texture anisotropic filtering',
      'Set ocean texture anisotropic filtering on _PARAM0_ to _PARAM2_x',
      'Sets the hardware anisotropic filtering level (1 to 16x) for ocean displacement and slope textures.',
      'Action',
      [choice('Anisotropy', 'Anisotropic Filtering', ANISOTROPY_CHOICES)],
      `const a = eventsFunctionContext.getArgument("Anisotropy");
if (behavior._setTextureAnisotropy) behavior._setTextureAnisotropy(a);
FW.setOceanAnisotropy(runtimeScene, behavior, a);
`, { group: G_WW_LOOK }),

    fn('TextureAnisotropy', 'Ocean texture anisotropic filtering level', '',
      'Effective anisotropic filtering level of the ocean slope textures after device and texture-format limits (1 when unavailable).',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getOceanAnisotropy(runtimeScene, behavior);
`, { group: G_WW_LOOK, expressionType: 'number' }),

    fn('SetSunDirection', 'Set sun direction',
      'Set sun direction on _PARAM0_ to heading _PARAM2_ deg, elevation _PARAM3_ deg',
      'Updates the sun angle driving specular highlights, crest translucency (SSS), and sky reflections.',
      'Action',
      [num('SunHeading', 'Heading in degrees (0 - 360)', '75'), num('SunElevation', 'Elevation above horizon in degrees (0 - 90)', '18')],
      `const sh = eventsFunctionContext.getArgument("SunHeading");
const se = eventsFunctionContext.getArgument("SunElevation");
if (behavior._setSunHeading) behavior._setSunHeading(sh);
if (behavior._setSunElevation) behavior._setSunElevation(se);
FW.setOceanSunDirection(runtimeScene, behavior, sh, se);
`, { group: G_WW_LOOK }),

    fn('SetSunColor', 'Set sun light color',
      'Set sun light color on _PARAM0_ to _PARAM2_',
      'Sets the sun tint driving specular glints and crest light.',
      'Action',
      [col('SunColor', 'Sun light color', '255;245;225')],
      `const col = eventsFunctionContext.getArgument("SunColor");
if (behavior._setSunColor) behavior._setSunColor(col);
FW.setOceanSunColor(runtimeScene, behavior, col);
`, { group: G_WW_LOOK }),

    fn('SunHeading', 'Sun heading', '', 'Current sun azimuth heading in degrees.', 'Expression', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o && o.sunHeading !== undefined ? o.sunHeading : 75.0;
`, { group: G_WW_LOOK, expressionType: 'number' }),

    fn('SunElevation', 'Sun elevation', '', 'Current sun altitude elevation above horizon in degrees.', 'Expression', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o && o.sunElevation !== undefined ? o.sunElevation : 18.0;
`, { group: G_WW_LOOK, expressionType: 'number' }),


    fn('MicroDetail', 'Micro-wave ripples detail', '', 'Current micro-wave ripple intensity.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaveWorksMicroDetail(runtimeScene, behavior);
`, { group: G_WW_LOOK, expressionType: 'number' }),

    fn('SetWind', 'Set wind speed and direction',
      'Set wind on _PARAM0_ to _PARAM2_ m/s heading _PARAM3_ degrees',
      'Changes the sea state. Rebuilds the wave spectrum, so call it on change rather than every frame.',
      'Action',
      [num('WindSpeed', 'Wind speed in m/s', '7'), num('WindDirection', 'Heading in degrees', '45')],
      `const ws = eventsFunctionContext.getArgument("WindSpeed");
const wd = eventsFunctionContext.getArgument("WindDirection");
if (behavior._setWindSpeed) behavior._setWindSpeed(ws);
if (behavior._setWindDirection) behavior._setWindDirection(wd);
FW.setOceanWind(runtimeScene, behavior, ws, wd);
`, { group: G_WW_SEA }),

    fn('SetChoppiness', 'Set choppiness',
      'Set ocean choppiness on _PARAM0_ to _PARAM2_',
      'Horizontal displacement strength. Higher values sharpen crests and produce more breaking foam.',
      'Action',
      [num('Choppiness', 'Choppiness (0 - 1.5)', '0.9')],
      `const val = eventsFunctionContext.getArgument("Choppiness");
if (behavior._setChoppiness) behavior._setChoppiness(val);
FW.setOceanChoppiness(runtimeScene, behavior, val);
`, { group: G_WW_SEA }),

    fn('SetPeakWavelength', 'Set wave length',
      'Set wave length (crest to crest) on _PARAM0_ to _PARAM2_ units',
      'Distance between wave crests in scene units. 0 fits automatically to the volume.', 'Action',
      [num('PeakWavelength', 'Crest-to-crest distance in scene units (0 = auto)', '0')],
      `const val = eventsFunctionContext.getArgument("PeakWavelength");
if (behavior._setPeakWavelength) behavior._setPeakWavelength(val);
const o = FW.oceanOf(runtimeScene, behavior);
if (o) { o.peakWavelengthOption = val; FW.setOceanWind(runtimeScene, behavior, o.windSpeed, o.windDirection); }
`, { group: G_WW_SEA }),

    fn('SetWavelengthScale', 'Set wavelength scale',
      'Set wave length scale on _PARAM0_ to _PARAM2_',
      'How long the waves are, independent of height. 0 refits automatically to the water volume.',
      'Action',
      [num('WavelengthScale', 'Scale (0 = auto)', '0')],
      `const val = eventsFunctionContext.getArgument("WavelengthScale");
if (behavior._setWavelengthScale) behavior._setWavelengthScale(val);
const o = FW.oceanOf(runtimeScene, behavior);
if (o) { o.wavelengthScaleOption = val; FW.setOceanWind(runtimeScene, behavior, o.windSpeed, o.windDirection); }
`, { group: G_WW_SEA }),

    fn('IsCameraUnderwater', 'Is camera underwater',
      'Camera is submerged in _PARAM0_',
      'True when the active camera is below the ocean surface.', 'Condition', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o ? !!o.isCameraUnderwater : false;
`, { group: G_WW_LOOK }),

    fn('WaveHeightAt', 'Wave height at position', '',
      'Wave displacement Z at world (X, Y), from the dual-cascade field.',
      'Expression',
      [num('X', 'World X', '0'), num('Y', 'World Y', '0')],
      `eventsFunctionContext.returnValue = FW.getOceanWaveHeightAt(runtimeScene, behavior,
  eventsFunctionContext.getArgument("X"), eventsFunctionContext.getArgument("Y"));
`, { group: G_WW_SEA, expressionType: 'number' }),

    fn('SurfaceZ', 'Water surface altitude at position', '',
      'Absolute surface altitude Z at world (X, Y), including dual-cascade waves.', 'Expression',
      [num('X', 'World X', '0'), num('Y', 'World Y', '0')],
      `eventsFunctionContext.returnValue = FW.getOceanSurfaceZ(runtimeScene, behavior,
  eventsFunctionContext.getArgument("X"), eventsFunctionContext.getArgument("Y"));
`, { group: G_WW_SEA, expressionType: 'number' }),

    fn('SignificantWaveHeight', 'Significant wave height', '',
      'Significant wave height in scene units, derived from wind speed (Hs = 0.21 V^2 / g).',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getSignificantWaveHeight(runtimeScene, behavior);
`, { group: G_WW_SEA, expressionType: 'number' }),

    fn('WindSpeed', 'Wind speed', '', 'Current wind speed in m/s.', 'Expression', [],
      `const o = FW.oceanOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = o ? o.windSpeed : 0;
`, { group: G_WW_SEA, expressionType: 'number' }),
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

/* ========================================================= 5b. WaterDetailing3D Behavior */

const WATER_DETAILING_OPTIONS = `{
  style: behavior._getArtStyle ? behavior._getArtStyle() : 'Sea of Thieves',
  waterLook: behavior._getArtWaterLook ? behavior._getArtWaterLook() : 'Clear',
  subStyle: behavior._getArtSubStyle ? behavior._getArtSubStyle() : 'Salt Water',
  foamStyle: behavior._getArtFoamStyle ? behavior._getArtFoamStyle() : 'Sea of Thieves',
  lighting: behavior._getArtLighting ? behavior._getArtLighting() : 'Golden Hour',
  sunHeading: behavior._getSunHeading ? behavior._getSunHeading() : 75.0,
  sunElevation: behavior._getSunElevation ? behavior._getSunElevation() : 18.0,
  sunColor: behavior._getSunColor ? behavior._getSunColor() : '255;245;225',
  sunSpecularIntensity: behavior._getSunSpecularIntensity ? behavior._getSunSpecularIntensity() : 2.8,
  sunSpecularRoughness: behavior._getSunSpecularRoughness ? behavior._getSunSpecularRoughness() : 160.0,
  waveContrast: behavior._getWaveContrast ? behavior._getWaveContrast() : 0.55,
  shallowColor: behavior._getShallowColor ? behavior._getShallowColor() : '35;220;200',
  deepColor: behavior._getDeepColor ? behavior._getDeepColor() : '4;22;48',
  extinctionDepth: behavior._getExtinctionDepth ? behavior._getExtinctionDepth() : 260.0,
  translucencyColor: behavior._getTranslucencyColor ? behavior._getTranslucencyColor() : '40;255;220',
  translucencyIntensity: behavior._getTranslucencyIntensity ? behavior._getTranslucencyIntensity() : 1.60,
  translucencyPower: behavior._getTranslucencyPower ? behavior._getTranslucencyPower() : 2.8,
  foamColor: behavior._getFoamColor ? behavior._getFoamColor() : '248;252;255',
  foamIntensity: behavior._getFoamIntensity ? behavior._getFoamIntensity() : 0.75,
  foamCoverage: behavior._getFoamCoverage ? behavior._getFoamCoverage() : 0.35,
  microDetail: behavior._getMicroDetail ? behavior._getMicroDetail() : 0.35,
  microFrequency: behavior._getMicroFrequency ? behavior._getMicroFrequency() : 1.0,
  opacity: behavior._getOpacity ? behavior._getOpacity() : 0.78,
  sprayEnabled: behavior._getSprayEnabled ? behavior._getSprayEnabled() : false,
  sprayAmount: behavior._getSprayAmount ? behavior._getSprayAmount() : 0.5,
  sprayHeight: behavior._getSprayHeight ? behavior._getSprayHeight() : 1.0,
  sprayThreshold: behavior._getSprayThreshold ? behavior._getSprayThreshold() : 0.5,
  textureAnisotropy: behavior._getTextureAnisotropy ? behavior._getTextureAnisotropy() : '4x'
}`;

const G_DET_PRESET = 'Water Detailing — Preset & Lighting';
const G_DET_SUN = 'Water Detailing — Sun Direction & Specular';
const G_DET_PALETTE = 'Water Detailing — Water Palette & Depth Contrast';
const G_DET_SSS = 'Water Detailing — Subsurface Scattering (SSS)';
const G_DET_FOAM = 'Water Detailing — Foam & Crest Shading';
const G_DET_RIPPLES = 'Water Detailing — Micro-Ripples & Surface';

const waterDetailingBehavior = {
  name: 'WaterDetailing3D',
  fullName: 'Water Detailing 3D (Shaders, Foam & Lighting)',
  description:
    'Visual polish companion behavior for OceanWaveWorks3D and WaterBody3D. '
    + 'Provides Sea of Thieves tier visual fidelity: directional sun azimuth/elevation controls, dual-lobe specular highlights, '
    + 'anti-aliased micro-ripples that eliminate moiré diamond patterns, optical wave depth contrast that prevents washed-out cyan, '
    + 'backlight-aligned subsurface scattering (SSS), and whitecap foam coloring. All parameters are fully editable via actions for in-game settings menus.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ArtStyle', 'Choice', 'Style (how it is drawn)',
      'The rendering method, and the effect modules that come with it. There is no single "stylized" switch, because each stylized look is its own method: Sea of Thieves draws caustics across the whole surface with a strong backlit crest glow, Realistic fades them out with optical depth so open water goes dark, Swimming Pool removes whitecaps entirely and lets caustics dominate, Toon posterises the surface into flat bands with hard foam edges, and Painterly smears everything soft. A style carries no colours of its own - it shapes whatever Sub-style and Water Type you pick.',
      'Sea of Thieves', {
        extraInformation: ['Sea of Thieves', 'Realistic', 'Swimming Pool', 'Toon', 'Painterly', 'Custom']
      }),
    prop('ArtFoamStyle', 'Choice', 'Foam (what the whitecaps look like)',
      'What the foam itself looks like, which none of the other selectors decide. Style is the '
      + 'rendering method, Sub-style is the liquid, Water Type is the condition - a North Sea gale '
      + 'and a reef break can share all three and still have completely different whitecaps. These '
      + 'are not coverage sliders under new names: each one moves cell size, how far the wind draws '
      + 'the foam out, the contrast of the break-up, and how much is left hanging behind the crest. '
      + 'Sea of Thieves is big soft sheets that trail; Whitecaps is sparse and high-contrast with '
      + 'clean water between; Storm Streaks drags everything into long parallel bands; Surf is fine '
      + 'aerated bubbles that linger; Painted is hard-edged flat shapes; Minimal keeps it quiet. '
      + 'Natural is the physically sparse open-ocean foam, and matches versions before 4.1.0.',
      'Sea of Thieves', {
        extraInformation: ['Sea of Thieves', 'Natural', 'Whitecaps', 'Storm Streaks', 'Surf',
          'Painted', 'Minimal', 'Custom']
      }),
    prop('ArtSubStyle', 'Choice', 'Sub-style (what liquid it is)',
      'The medium. This is not a colour choice: electrolytes in seawater stop bubbles merging, so '
      + 'salt water whitecaps readily and its foam lingers (~3.85 s) while fresh water rarely '
      + 'whitecaps at all and its foam collapses in ~2.54 s. Pool water is chlorinated and barely '
      + 'foams. The medium also sets base clarity and colour cast.',
      'Salt Water', {
        extraInformation: ['Salt Water', 'Fresh Water', 'Pool Water', 'Custom']
      }),
    prop('ArtWaterLook', 'Choice', 'Water Type (what it is)',
      'The condition the water is in, which owns the colour palette and optics. It layers on the Sub-style: "murky" means something different in a lake than in the open sea. Combined with Style: "Sea of Thieves + Salt Water + Murky" is stylized murky seawater, "Realistic + Fresh Water + Murky" is a silty lake drawn physically. Set any selector to Custom to author the properties below yourself.',
      'Clear', {
        extraInformation: ['Clear', 'Tropical', 'Calm', 'Choppy', 'Murky', 'Stormy', 'Custom']
      }),
    prop('ArtLighting', 'Choice', 'Lighting (what hour it is)',
      'The sun: heading, elevation, colour and the specular lobe it casts. It owns nothing else, so the same water in the same style can be shot at any hour. Set to Custom to drive the sun from the Sun Heading / Elevation / Color properties below, or from a scene DirectionalLight.',
      'Golden Hour', {
        extraInformation: ['Golden Hour', 'Midday', 'Custom']
      }),
    prop('SunHeading', 'Number', 'Sun Heading (Azimuth)',
      'Sun horizontal direction in degrees (0 = East, 90 = North, 180 = West, 270 = South). Low sun angles directly opposite the camera create dramatic specular trails.', '75.0'),
    prop('SunElevation', 'Number', 'Sun Elevation (Altitude)',
      'Sun altitude angle above horizon in degrees (0 = horizon sunrise/sunset, 90 = zenith noon). Low elevations (15-25°) produce the Sea of Thieves golden-hour trail.', '18.0'),
    prop('SunColor', 'Color', 'Sun Light Color',
      'Sun and specular glint tint color (warm amber/gold for sunset, bright pale yellow/white for midday).', '255;245;225'),
    prop('SunSpecularIntensity', 'Number', 'Sun Specular Intensity',
      'Brightness of the solar disk reflection and wide ocean glint trail.', '2.8'),
    prop('SunSpecularRoughness', 'Number', 'Sun Specular Sharpness',
      'Shininess / specular exponent (32 = broad soft sheen, 160 = crisp sun glint trail, 512 = intense mirror reflection).', '160.0'),
    prop('WaveContrast', 'Number', 'Wave Depth Contrast',
      'Modulates optical water depth between wave crests and wave troughs. Eliminates washed-out flat cyan by deepening troughs into oceanic navy while keeping crests luminous.', '0.55'),
    prop('ShallowColor', 'Color', 'Shallow Water Color',
      'Color of shallow water, wave crests, and sunlit peaks.', '35;220;200'),
    prop('DeepColor', 'Color', 'Deep Ocean Color',
      'Color of deep ocean water and shaded wave troughs.', '4;22;48'),
    prop('ExtinctionDepth', 'Number', 'Extinction Depth',
      'Beer-Lambert optical depth in pixels where water shifts from translucent turquoise to deep oceanic navy.', '260.0'),
    prop('TranslucencyColor', 'Color', 'Translucency / SSS Color',
      'Subsurface scattering inner glow color when looking toward the sun through wave crests.', '40;255;220'),
    prop('TranslucencyIntensity', 'Number', 'Translucency Intensity',
      'Brightness multiplier for wave crest translucency and backlight scattering.', '1.60'),
    prop('TranslucencyPower', 'Number', 'Translucency Falloff Power',
      'Sharpness of the directional backlight alignment cone for SSS (higher = narrower forward scatter).', '2.8'),
    prop('FoamColor', 'Color', 'Foam Color',
      'Tint color of wave whitecaps and crest foam (bright seafoam white).', '248;252;255'),
    prop('FoamIntensity', 'Number', 'Foam Brightness / Opacity',
      'Brightness multiplier for wave crest whitecaps and edge foam.', '0.75'),
    prop('FoamCoverage', 'Number', 'Foam Coverage Threshold',
      'Surface threshold for whitecap foam coverage (0.0 = rare foam on highest peaks, 1.0 = heavy foam across all crests).', '0.35'),
    prop('SprayEnabled', 'Boolean', 'Enable Wave-Collision Spray',
      'Spawn upward droplet spray when ocean wave crests collide (converging eigenvalues in the displacement gradient tensor).', 'false'),
    prop('SprayAmount', 'Number', 'Spray Spawn Rate',
      'Emission rate multiplier for wave-collision spray droplets (0.0 = none, 1.0 = heavy plumes).', '0.5'),
    prop('SprayHeight', 'Number', 'Spray Launch Height',
      'Velocity and height multiplier for upward wave spray droplets.', '1.0'),
    prop('SprayThreshold', 'Number', 'Spray Trigger Threshold',
      'Sensitivity threshold for wave collisions (lower = easier to trigger spray, higher = only violent head-on collisions spurt).', '0.5'),
    prop('MicroDetail', 'Number', 'Micro-Wave Ripples Detail',
      'Strength of anti-aliased capillary micro-ripples and surface perturbation.', '0.35'),
    prop('MicroFrequency', 'Number', 'Micro-Wave Ripples Frequency',
      'Spatial frequency scale for capillary micro-ripples (0.5 = broad gentle swells, 1.0 = crisp clear ripples, 2.0+ = fine surface disturbance).', '1.0'),
    prop('Opacity', 'Number', 'Water Surface Opacity',
      'Overall water transparency (0.0 = clear glass, 1.0 = opaque oceanic surface).', '0.78'),
    prop('TextureAnisotropy', 'Choice', 'Anisotropic Filtering (Water Detail)',
      'Requested anisotropic filtering level for ocean detail and persistent foam at grazing angles. Uses mipmaps, clamps to device and texture-format support, and preserves foam history when changed.',
      '4x', { extraInformation: ANISOTROPY_CHOICES }),
  ],
  eventsFunctions: [
    {
      name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.registerWaterDetailing(runtimeScene, object, behavior, ${WATER_DETAILING_OPTIONS});\n`, { withRuntime: true }),
    },
    {
      name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.stepWaterDetailing(runtimeScene, object, behavior);\n`),
    },
    {
      name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.disposeWaterDetailing(runtimeScene, behavior);\n`),
    },

    // 1. Presets
    fn('SetPreset', 'Set detailing preset',
      'Set water detailing preset on _PARAM0_ to _PARAM2_',
      'Changes the visual profile: sun path, lighting, colour palette, subsurface scattering and foam.',
      'Action',
      [choice('Preset', 'Detailing preset', ['Sea of Thieves - Golden Hour', 'Sea of Thieves - Midday', 'Stormy - Dark', 'Crystal Clear Tropical'])],
      `const val = eventsFunctionContext.getArgument("Preset");
if (behavior._setPreset) behavior._setPreset(val);
FW.setWaterDetailingPreset(runtimeScene, behavior, val);
`, { group: G_DET_PRESET }),

    fn('Preset', 'Detailing preset name', '', 'Current water detailing preset name.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingPreset(runtimeScene, behavior);
`, { group: G_DET_PRESET, expressionType: 'string' }),

    // 2. Sun Lighting
    fn('SetSunHeading', 'Set sun heading (azimuth)',
      'Set sun heading on _PARAM0_ to _PARAM2_ degrees',
      'Change the horizontal sun angle (0 to 360 degrees).', 'Action',
      [num('Heading', 'Sun heading angle in degrees (0 - 360)', '75')],
      `const val = eventsFunctionContext.getArgument("Heading");
if (behavior._setSunHeading) behavior._setSunHeading(val);
FW.setWaterDetailingSunHeading(runtimeScene, behavior, val);
`, { group: G_DET_SUN }),

    fn('SunHeading', 'Sun heading angle', '', 'Sun heading angle in degrees (0 - 360).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSunHeading(runtimeScene, behavior);
`, { group: G_DET_SUN }),

    fn('SetSunElevation', 'Set sun elevation (altitude)',
      'Set sun elevation on _PARAM0_ to _PARAM2_ degrees',
      'Change the sun altitude angle above horizon (0 to 90 degrees).', 'Action',
      [num('Elevation', 'Sun elevation angle in degrees (0 - 90)', '18')],
      `const val = eventsFunctionContext.getArgument("Elevation");
if (behavior._setSunElevation) behavior._setSunElevation(val);
FW.setWaterDetailingSunElevation(runtimeScene, behavior, val);
`, { group: G_DET_SUN }),

    fn('SunElevation', 'Sun elevation angle', '', 'Sun elevation angle above horizon in degrees (0 - 90).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSunElevation(runtimeScene, behavior);
`, { group: G_DET_SUN }),

    fn('SetSunColor', 'Set sun light color',
      'Set sun color on _PARAM0_ to _PARAM2_',
      'Change the sun light and specular glint tint color.', 'Action',
      [col('Color', 'Sun light color')],
      `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setSunColor) behavior._setSunColor(val);
FW.setWaterDetailingSunColor(runtimeScene, behavior, val);
`, { group: G_DET_SUN }),

    fn('SunColor', 'Sun color', '', 'Sun light and specular glint tint color (R;G;B).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSunColor(runtimeScene, behavior);
`, { group: G_DET_SUN, expressionType: 'string' }),

    fn('SetSunSpecularIntensity', 'Set sun specular intensity',
      'Set sun specular intensity on _PARAM0_ to _PARAM2_',
      'Change the brightness multiplier of the sun reflection glint trail.', 'Action',
      [num('Intensity', 'Specular intensity multiplier', '2.8')],
      `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setSunSpecularIntensity) behavior._setSunSpecularIntensity(val);
FW.setWaterDetailingSunSpecularIntensity(runtimeScene, behavior, val);
`, { group: G_DET_SUN }),

    fn('SunSpecularIntensity', 'Sun specular intensity', '', 'Sun specular intensity multiplier.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSunSpecularIntensity(runtimeScene, behavior);
`, { group: G_DET_SUN }),

    fn('SetSunSpecularRoughness', 'Set sun specular sharpness',
      'Set sun specular sharpness on _PARAM0_ to _PARAM2_',
      'Change specular exponent / sharpness (32 to 512).', 'Action',
      [num('Roughness', 'Specular sharpness / exponent', '160')],
      `const val = eventsFunctionContext.getArgument("Roughness");
if (behavior._setSunSpecularRoughness) behavior._setSunSpecularRoughness(val);
FW.setWaterDetailingSunSpecularRoughness(runtimeScene, behavior, val);
`, { group: G_DET_SUN }),

    fn('SunSpecularRoughness', 'Sun specular sharpness', '', 'Sun specular sharpness / exponent.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSunSpecularRoughness(runtimeScene, behavior);
`, { group: G_DET_SUN }),

    fn('SetSunLighting', 'Set complete sun lighting',
      'Set sun lighting on _PARAM0_: heading _PARAM2_°, elevation _PARAM3_°, color _PARAM4_, specular _PARAM5_, sharpness _PARAM6_',
      'Set all sun lighting parameters in a single action.', 'Action',
      [
        num('Heading', 'Heading angle in degrees (0 - 360)', '75'),
        num('Elevation', 'Elevation angle in degrees (0 - 90)', '18'),
        col('Color', 'Sun light color'),
        num('SpecularIntensity', 'Specular intensity multiplier', '2.8'),
        num('SpecularRoughness', 'Specular sharpness / exponent', '160')
      ],
      `const h = eventsFunctionContext.getArgument("Heading");
const el = eventsFunctionContext.getArgument("Elevation");
const c = eventsFunctionContext.getArgument("Color");
const si = eventsFunctionContext.getArgument("SpecularIntensity");
const sr = eventsFunctionContext.getArgument("SpecularRoughness");
if (behavior._setSunHeading) behavior._setSunHeading(h);
if (behavior._setSunElevation) behavior._setSunElevation(el);
if (behavior._setSunColor) behavior._setSunColor(c);
if (behavior._setSunSpecularIntensity) behavior._setSunSpecularIntensity(si);
if (behavior._setSunSpecularRoughness) behavior._setSunSpecularRoughness(sr);
FW.setWaterDetailingSunLighting(runtimeScene, behavior, h, el, c, si, sr);
`, { group: G_DET_SUN }),

    // 3. Palette & Depth Contrast
    fn('SetShallowColor', 'Set shallow water color',
      'Set shallow water color on _PARAM0_ to _PARAM2_',
      'Change color at shallow depths and wave crests.', 'Action',
      [col('Color', 'Shallow water color tint')],
      `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setShallowColor) behavior._setShallowColor(val);
FW.setWaterDetailingShallowColor(runtimeScene, behavior, val);
`, { group: G_DET_PALETTE }),

    fn('ShallowColor', 'Shallow water color', '', 'Shallow water color tint (R;G;B).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingShallowColor(runtimeScene, behavior);
`, { group: G_DET_PALETTE, expressionType: 'string' }),

    fn('SetDeepColor', 'Set deep ocean color',
      'Set deep ocean color on _PARAM0_ to _PARAM2_',
      'Change color in deeper ocean water and wave troughs.', 'Action',
      [col('Color', 'Deep ocean water color tint')],
      `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setDeepColor) behavior._setDeepColor(val);
FW.setWaterDetailingDeepColor(runtimeScene, behavior, val);
`, { group: G_DET_PALETTE }),

    fn('DeepColor', 'Deep ocean color', '', 'Deep ocean water color tint (R;G;B).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingDeepColor(runtimeScene, behavior);
`, { group: G_DET_PALETTE, expressionType: 'string' }),

    fn('SetWaveContrast', 'Set wave depth contrast',
      'Set wave depth contrast on _PARAM0_ to _PARAM2_',
      'Modulate optical water depth between crests and troughs (0.0 to 1.0).', 'Action',
      [num('Contrast', 'Wave depth contrast factor (0.0 to 1.0)', '0.55')],
      `const val = eventsFunctionContext.getArgument("Contrast");
if (behavior._setWaveContrast) behavior._setWaveContrast(val);
FW.setWaterDetailingWaveContrast(runtimeScene, behavior, val);
`, { group: G_DET_PALETTE }),

    fn('WaveContrast', 'Wave depth contrast', '', 'Wave depth contrast factor (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingWaveContrast(runtimeScene, behavior);
`, { group: G_DET_PALETTE }),

    fn('SetExtinctionDepth', 'Set extinction depth',
      'Set extinction depth on _PARAM0_ to _PARAM2_ pixels',
      'Change Beer-Lambert optical transition depth in pixels.', 'Action',
      [num('Depth', 'Extinction depth in pixels', '260')],
      `const val = eventsFunctionContext.getArgument("Depth");
if (behavior._setExtinctionDepth) behavior._setExtinctionDepth(val);
FW.setWaterDetailingExtinctionDepth(runtimeScene, behavior, val);
`, { group: G_DET_PALETTE }),

    fn('ExtinctionDepth', 'Extinction depth', '', 'Extinction depth in pixels.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingExtinctionDepth(runtimeScene, behavior);
`, { group: G_DET_PALETTE }),

    fn('SetWaterPalette', 'Set water palette & contrast',
      'Set water palette on _PARAM0_: shallow _PARAM2_, deep _PARAM3_, contrast _PARAM4_, extinction _PARAM5_ px',
      'Set all water color palette and contrast settings in a single action.', 'Action',
      [
        col('ShallowColor', 'Shallow water color'),
        col('DeepColor', 'Deep ocean color'),
        num('WaveContrast', 'Wave depth contrast (0.0 to 1.0)', '0.55'),
        num('ExtinctionDepth', 'Extinction depth in pixels', '260')
      ],
      `const sc = eventsFunctionContext.getArgument("ShallowColor");
const dc = eventsFunctionContext.getArgument("DeepColor");
const wc = eventsFunctionContext.getArgument("WaveContrast");
const ed = eventsFunctionContext.getArgument("ExtinctionDepth");
if (behavior._setShallowColor) behavior._setShallowColor(sc);
if (behavior._setDeepColor) behavior._setDeepColor(dc);
if (behavior._setWaveContrast) behavior._setWaveContrast(wc);
if (behavior._setExtinctionDepth) behavior._setExtinctionDepth(ed);
FW.setWaterDetailingPalette(runtimeScene, behavior, sc, dc, wc, ed);
`, { group: G_DET_PALETTE }),

    // 4. Subsurface Scattering (SSS)
    fn('SetTranslucencyColor', 'Set translucency / SSS color',
      'Set translucency color on _PARAM0_ to _PARAM2_',
      'Change subsurface scattering inner glow color tint.', 'Action',
      [col('Color', 'Subsurface scattering inner glow color')],
      `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setTranslucencyColor) behavior._setTranslucencyColor(val);
FW.setWaterDetailingTranslucencyColor(runtimeScene, behavior, val);
`, { group: G_DET_SSS }),

    fn('TranslucencyColor', 'Translucency color', '', 'Translucency inner glow color (R;G;B).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingTranslucencyColor(runtimeScene, behavior);
`, { group: G_DET_SSS, expressionType: 'string' }),

    fn('SetTranslucencyIntensity', 'Set translucency intensity',
      'Set translucency intensity on _PARAM0_ to _PARAM2_',
      'Change brightness multiplier for wave crest translucency glow.', 'Action',
      [num('Intensity', 'Translucency brightness multiplier', '1.6')],
      `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setTranslucencyIntensity) behavior._setTranslucencyIntensity(val);
FW.setWaterDetailingTranslucencyIntensity(runtimeScene, behavior, val);
`, { group: G_DET_SSS }),

    fn('TranslucencyIntensity', 'Translucency intensity', '', 'Translucency brightness multiplier.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingTranslucencyIntensity(runtimeScene, behavior);
`, { group: G_DET_SSS }),

    fn('SetTranslucencyPower', 'Set translucency falloff power',
      'Set translucency falloff power on _PARAM0_ to _PARAM2_',
      'Change sharpness of the directional backlight alignment cone for SSS.', 'Action',
      [num('Power', 'Translucency falloff power (0.5 to 16.0)', '2.8')],
      `const val = eventsFunctionContext.getArgument("Power");
if (behavior._setTranslucencyPower) behavior._setTranslucencyPower(val);
FW.setWaterDetailingTranslucencyPower(runtimeScene, behavior, val);
`, { group: G_DET_SSS }),

    fn('TranslucencyPower', 'Translucency falloff power', '', 'Translucency falloff power.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingTranslucencyPower(runtimeScene, behavior);
`, { group: G_DET_SSS }),

    fn('SetTranslucency', 'Set complete translucency / SSS',
      'Set translucency on _PARAM0_: color _PARAM2_, intensity _PARAM3_, falloff power _PARAM4_',
      'Set all subsurface scattering parameters in a single action.', 'Action',
      [
        col('Color', 'Inner glow color'),
        num('Intensity', 'Glow intensity multiplier', '1.6'),
        num('Power', 'Falloff power', '2.8')
      ],
      `const c = eventsFunctionContext.getArgument("Color");
const i = eventsFunctionContext.getArgument("Intensity");
const p = eventsFunctionContext.getArgument("Power");
if (behavior._setTranslucencyColor) behavior._setTranslucencyColor(c);
if (behavior._setTranslucencyIntensity) behavior._setTranslucencyIntensity(i);
if (behavior._setTranslucencyPower) behavior._setTranslucencyPower(p);
FW.setWaterDetailingTranslucency(runtimeScene, behavior, c, i, p);
`, { group: G_DET_SSS }),

    // 5. Foam & Crest Shading
    fn('SetFoamColor', 'Set foam color',
      'Set foam color on _PARAM0_ to _PARAM2_',
      'Change tint color of wave whitecaps and crest foam.', 'Action',
      [col('Color', 'Foam color tint')],
      `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setFoamColor) behavior._setFoamColor(val);
FW.setWaterDetailingFoamColor(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('FoamColor', 'Foam color', '', 'Foam color tint (R;G;B).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingFoamColor(runtimeScene, behavior);
`, { group: G_DET_FOAM, expressionType: 'string' }),

    fn('SetFoamIntensity', 'Set foam brightness',
      'Set foam brightness on _PARAM0_ to _PARAM2_',
      'Change foam brightness multiplier for crest whitecaps.', 'Action',
      [num('Intensity', 'Foam brightness multiplier', '0.75')],
      `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setFoamIntensity) behavior._setFoamIntensity(val);
FW.setWaterDetailingFoamIntensity(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('FoamIntensity', 'Foam brightness', '', 'Foam brightness multiplier.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingFoamIntensity(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    fn('SetFoamCoverage', 'Set foam coverage threshold',
      'Set foam coverage threshold on _PARAM0_ to _PARAM2_',
      'Change surface threshold for whitecap foam coverage (0.0 to 1.0).', 'Action',
      [num('Coverage', 'Foam coverage threshold (0.0 to 1.0)', '0.35')],
      `const val = eventsFunctionContext.getArgument("Coverage");
if (behavior._setFoamCoverage) behavior._setFoamCoverage(val);
FW.setWaterDetailingFoamCoverage(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('FoamCoverage', 'Foam coverage threshold', '', 'Foam coverage threshold (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingFoamCoverage(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    fn('SetFoam', 'Set complete foam parameters',
      'Set foam on _PARAM0_: color _PARAM2_, brightness _PARAM3_, coverage _PARAM4_',
      'Set all foam parameters in a single action.', 'Action',
      [
        col('Color', 'Foam color tint'),
        num('Intensity', 'Foam brightness multiplier', '0.75'),
        num('Coverage', 'Foam coverage threshold', '0.35')
      ],
      `const c = eventsFunctionContext.getArgument("Color");
const i = eventsFunctionContext.getArgument("Intensity");
const cv = eventsFunctionContext.getArgument("Coverage");
if (behavior._setFoamColor) behavior._setFoamColor(c);
if (behavior._setFoamIntensity) behavior._setFoamIntensity(i);
if (behavior._setFoamCoverage) behavior._setFoamCoverage(cv);
FW.setWaterDetailingFoam(runtimeScene, behavior, c, i, cv);
`, { group: G_DET_FOAM }),

    fn('SetFoamStyle', 'Set foam look',
      'Set foam look on _PARAM0_ to _PARAM2_',
      'Switches what the whitecaps look like without touching the palette, the medium or the sea state. Changes cell size, wind streaking, break-up contrast and how much foam trails behind the crest.',
      'Action',
      [choice('Foam', 'Foam look', ['Natural', 'Sea of Thieves', 'Whitecaps', 'Storm Streaks',
        'Surf', 'Painted', 'Minimal'])],
      `const f = eventsFunctionContext.getArgument("Foam");
if (behavior._setArtFoamStyle) behavior._setArtFoamStyle(f);
FW.setWaterDetailingFoamStyle(runtimeScene, behavior, f);
`, { group: G_DET_FOAM }),

    fn('FoamStyle', 'Foam look name', '', 'Current foam look name.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingFoamStyle(runtimeScene, behavior);
`, { expressionType: 'string', group: G_DET_FOAM }),

    fn('SetSprayEnabled', 'Enable wave-collision spray',
      'Set wave-collision spray on _PARAM0_ to _PARAM2_',
      'Enable or disable droplet spray spawning at wave collision sites.', 'Action',
      [bool('Enabled', 'Enable spray')],
      `const val = eventsFunctionContext.getArgument("Enabled");
if (behavior._setSprayEnabled) behavior._setSprayEnabled(val);
FW.setWaterDetailingSprayEnabled(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('IsSprayEnabled', 'Is spray enabled',
      'Spray is enabled on _PARAM0_',
      'Check if wave-collision spray droplets are currently enabled.', 'Condition', [],
      `eventsFunctionContext.returnValue = FW.isWaterDetailingSprayEnabled(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    fn('SetSprayAmount', 'Set spray spawn rate',
      'Set wave spray amount on _PARAM0_ to _PARAM2_',
      'Change spray droplet emission rate multiplier (0.0 to 1.0).', 'Action',
      [num('Amount', 'Spray rate (0.0 to 1.0)', '0.5')],
      `const val = eventsFunctionContext.getArgument("Amount");
if (behavior._setSprayAmount) behavior._setSprayAmount(val);
FW.setWaterDetailingSprayAmount(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('SprayAmount', 'Spray spawn rate', '', 'Spray droplet emission rate multiplier (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSprayAmount(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    fn('SetSprayHeight', 'Set spray launch height',
      'Set wave spray launch height on _PARAM0_ to _PARAM2_',
      'Change upward launch velocity and height multiplier for spray droplets.', 'Action',
      [num('Height', 'Launch height multiplier', '1.0')],
      `const val = eventsFunctionContext.getArgument("Height");
if (behavior._setSprayHeight) behavior._setSprayHeight(val);
FW.setWaterDetailingSprayHeight(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('SprayHeight', 'Spray launch height', '', 'Spray droplet upward launch height multiplier.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSprayHeight(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    fn('SetSprayThreshold', 'Set spray trigger threshold',
      'Set wave spray collision threshold on _PARAM0_ to _PARAM2_',
      'Change sensitivity threshold for wave collisions (0.0 to 1.0).', 'Action',
      [num('Threshold', 'Collision threshold (0.0 to 1.0)', '0.5')],
      `const val = eventsFunctionContext.getArgument("Threshold");
if (behavior._setSprayThreshold) behavior._setSprayThreshold(val);
FW.setWaterDetailingSprayThreshold(runtimeScene, behavior, val);
`, { group: G_DET_FOAM }),

    fn('SprayThreshold', 'Spray trigger threshold', '', 'Spray collision sensitivity threshold (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingSprayThreshold(runtimeScene, behavior);
`, { group: G_DET_FOAM }),

    // 6. Micro-Ripples & Surface
    fn('SetMicroDetail', 'Set micro-ripples detail',
      'Set micro-ripples detail on _PARAM0_ to _PARAM2_',
      'Change strength of anti-aliased capillary micro-ripples.', 'Action',
      [num('Detail', 'Micro-ripples amplitude (0.0 to 2.0)', '0.35')],
      `const val = eventsFunctionContext.getArgument("Detail");
if (behavior._setMicroDetail) behavior._setMicroDetail(val);
FW.setWaterDetailingMicroDetail(runtimeScene, behavior, val);
`, { group: G_DET_RIPPLES }),

    fn('MicroDetail', 'Micro-ripples detail', '', 'Micro-ripples amplitude.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingMicroDetail(runtimeScene, behavior);
`, { group: G_DET_RIPPLES }),

    fn('SetMicroFrequency', 'Set micro-ripples frequency',
      'Set micro-ripples frequency on _PARAM0_ to _PARAM2_',
      'Change spatial frequency scale for capillary micro-ripples.', 'Action',
      [num('Frequency', 'Micro-ripples frequency multiplier (0.1 to 5.0)', '1.0')],
      `const val = eventsFunctionContext.getArgument("Frequency");
if (behavior._setMicroFrequency) behavior._setMicroFrequency(val);
FW.setWaterDetailingMicroFrequency(runtimeScene, behavior, val);
`, { group: G_DET_RIPPLES }),

    fn('MicroFrequency', 'Micro-ripples frequency', '', 'Micro-ripples frequency multiplier.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingMicroFrequency(runtimeScene, behavior);
`, { group: G_DET_RIPPLES }),

    fn('SetMicroRipples', 'Set micro-ripples detail & frequency',
      'Set micro-ripples on _PARAM0_: detail _PARAM2_, frequency _PARAM3_',
      'Set micro-ripples strength and frequency in a single action.', 'Action',
      [
        num('Detail', 'Micro-ripples amplitude', '0.35'),
        num('Frequency', 'Frequency multiplier', '1.0')
      ],
      `const d = eventsFunctionContext.getArgument("Detail");
const f = eventsFunctionContext.getArgument("Frequency");
if (behavior._setMicroDetail) behavior._setMicroDetail(d);
if (behavior._setMicroFrequency) behavior._setMicroFrequency(f);
FW.setWaterDetailingMicroRipples(runtimeScene, behavior, d, f);
`, { group: G_DET_RIPPLES }),

    fn('SetOpacity', 'Set water surface opacity',
      'Set water surface opacity on _PARAM0_ to _PARAM2_',
      'Change water surface opacity (0.0 = clear glass, 1.0 = solid sea).', 'Action',
      [num('Opacity', 'Water surface opacity (0.0 to 1.0)', '0.78')],
      `const val = eventsFunctionContext.getArgument("Opacity");
if (behavior._setOpacity) behavior._setOpacity(val);
FW.setWaterDetailingOpacity(runtimeScene, behavior, val);
`, { group: G_DET_RIPPLES }),

    fn('Opacity', 'Water surface opacity', '', 'Water surface opacity (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingOpacity(runtimeScene, behavior);
`, { group: G_DET_RIPPLES }),

    fn('SetTextureAnisotropy', 'Set texture anisotropic filtering',
      'Set texture anisotropic filtering on _PARAM0_ to _PARAM2_x',
      'Sets the hardware anisotropic filtering level (1 to 16x) for water detail, slope, and foam textures.',
      'Action',
      [choice('Anisotropy', 'Anisotropic Filtering', ANISOTROPY_CHOICES)],
      `const a = eventsFunctionContext.getArgument("Anisotropy");
if (behavior._setTextureAnisotropy) behavior._setTextureAnisotropy(a);
FW.setWaterDetailingAnisotropy(runtimeScene, behavior, a);
`, { group: G_DET_RIPPLES }),

    fn('IsTextureAnisotropyEnabled', 'Is texture anisotropic filtering enabled',
      'Texture anisotropic filtering is enabled on _PARAM0_',
      'Check if anisotropic filtering is active on the companion ocean slope textures (> 1x after device and texture-format limits).',
      'Condition', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingAnisotropy(runtimeScene, behavior) > 1;
`, { group: G_DET_RIPPLES }),

    fn('TextureAnisotropy', 'Texture anisotropic filtering level', '',
      'Effective anisotropic filtering level of the companion ocean slope textures (1 when no compatible ocean is bound).',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingAnisotropy(runtimeScene, behavior);
`, { group: G_DET_RIPPLES, expressionType: 'number' }),

    fn('MaxDeviceAnisotropy', 'Maximum device anisotropic filtering', '',
      'Maximum hardware anisotropic filtering level supported by the current device GPU (1 to 16).',
      'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterDetailingMaxDeviceAnisotropy(runtimeScene);
`, { group: G_DET_RIPPLES, expressionType: 'number' }),
  ],
};

/* ========================================================= 5c. WaterStrengthSlider3D Behavior */

const WATER_STRENGTH_SLIDER_OPTIONS = `{
  scaleMode: behavior._getScaleMode ? behavior._getScaleMode() : 'Beaufort (0 - 12)',
  strength: behavior._getStrength ? behavior._getStrength() : 4.0,
  smoothDamping: behavior._getSmoothDamping ? behavior._getSmoothDamping() : 0.0,
  targetWaterBody: behavior._getTargetWaterBody ? behavior._getTargetWaterBody() : ''
}`;

const G_SLIDER_CONTROL = 'Water Strength — Control & Damping';

const waterStrengthSliderBehavior = {
  name: 'WaterStrengthSlider3D',
  fullName: 'Water Strength Slider 3D',
  description:
    'Dedicated runtime sea-state controller for OceanWaveWorks3D and WaterBody3D. '
    + 'Provides a single continuous strength value (0 - 12 Beaufort or 0 - 1 normalized) with optional smooth damping '
    + 'to drive storm transitions, weather changes, or gameplay intensity smoothly.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ScaleMode', 'Choice', 'Scale Mode',
      'Scale mode used by default for strength actions and expressions: 0 - 12 (Beaufort maritime scale) or 0 - 1 (normalized).',
      'Beaufort (0 - 12)', { extraInformation: ['Beaufort (0 - 12)', 'Normalized (0 - 1)'] }),
    prop('SmoothDamping', 'Number', 'Smooth Transition Damping (seconds)',
      'Time in seconds to smoothly transition to a new strength target (0.0 = instant change, >0 = smooth exponential damping).', '0.0'),
    prop('Strength', 'Number', 'Initial Water Strength',
      'Starting water strength (0 to 12 if Beaufort mode, 0.0 to 1.0 if Normalized mode).', '4.0'),
    prop('TargetWaterBody', 'String', 'Target Water Body Object Name',
      'Optional name of a specific water body object to control. If left empty, automatically controls the water body on the same object, or the first active ocean in the scene.', ''),
  ],
  eventsFunctions: [
    {
      name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.registerWaterStrengthSlider(runtimeScene, object, behavior, ${WATER_STRENGTH_SLIDER_OPTIONS});\n`, { withRuntime: true }),
    },
    {
      name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.stepWaterStrengthSlider(runtimeScene, object, behavior);\n`),
    },
    {
      name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
      private: true, parameters: [...OB],
      events: ev(BEHAVIOR_PREAMBLE + `FW.disposeWaterStrengthSlider(runtimeScene, behavior);\n`),
    },

    // Actions
    fn('SetStrength', 'Set water strength',
      'Set water strength on _PARAM0_ to _PARAM2_',
      'Set water strength value (0 to 12 in Beaufort mode, or 0.0 to 1.0 in Normalized mode).', 'Action',
      [num('Strength', 'Target strength value', '4.0')],
      `const val = eventsFunctionContext.getArgument("Strength");
if (behavior._setStrength) behavior._setStrength(val);
FW.setWaterStrength(runtimeScene, behavior, val);
`, { group: G_SLIDER_CONTROL }),

    fn('SetNormalizedStrength', 'Set normalized water strength (0 - 1)',
      'Set normalized water strength on _PARAM0_ to _PARAM2_',
      'Set normalized water strength (0.0 = calm/mirror, 1.0 = hurricane). Automatically converts to Beaufort if in Beaufort mode.', 'Action',
      [num('NormalizedStrength', 'Target normalized strength (0.0 to 1.0)', '0.333')],
      `const val = eventsFunctionContext.getArgument("NormalizedStrength");
FW.setWaterStrengthNormalized(runtimeScene, behavior, val);
`, { group: G_SLIDER_CONTROL }),

    fn('SetSmoothDamping', 'Set transition damping',
      'Set strength transition damping on _PARAM0_ to _PARAM2_ seconds',
      'Set smooth transition damping time in seconds (0.0 = instant change).', 'Action',
      [num('Damping', 'Transition damping in seconds', '0.0')],
      `const val = eventsFunctionContext.getArgument("Damping");
if (behavior._setSmoothDamping) behavior._setSmoothDamping(val);
FW.setWaterStrengthDamping(runtimeScene, behavior, val);
`, { group: G_SLIDER_CONTROL }),

    fn('SetTargetWaterBody', 'Set target water body',
      'Set target water body on _PARAM0_ to _PARAM2_',
      'Set the object name of the water body to control.', 'Action',
      [str('TargetWaterBody', 'Target water body object name', '')],
      `const val = eventsFunctionContext.getArgument("TargetWaterBody");
if (behavior._setTargetWaterBody) behavior._setTargetWaterBody(val);
FW.setWaterStrengthTargetBody(runtimeScene, behavior, val);
`, { group: 'Behavior' }),

    // Conditions
    fn('IsCalm', 'Is water calm',
      'Water on _PARAM0_ is calm',
      'Check if water strength is currently calm (Beaufort < 1).', 'Condition', [],
      `eventsFunctionContext.returnValue = FW.isWaterStrengthCalm(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),

    fn('IsStormy', 'Is water stormy',
      'Water on _PARAM0_ is stormy',
      'Check if water strength is currently stormy (Beaufort >= 8, Gale to Hurricane).', 'Condition', [],
      `eventsFunctionContext.returnValue = FW.isWaterStrengthStormy(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),

    // Expressions
    fn('Strength', 'Current water strength', '', 'Current water strength according to scale mode.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrength(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),

    fn('NormalizedStrength', 'Current normalized water strength', '', 'Current normalized water strength (0.0 to 1.0).', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthNormalized(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),

    fn('SmoothDamping', 'Smooth transition damping', '', 'Smooth transition damping in seconds.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthDamping(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),

    fn('TargetWaterBody', 'Target water body object name', '', 'Object name of target water body.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthTargetBody(runtimeScene, behavior);
`, { group: 'Behavior', expressionType: 'string' }),

    fn('BeaufortLabel', 'Beaufort formatted label', '', 'Formatted Beaufort scale label (e.g. "Beaufort 4.2 - Moderate Breeze").', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthBeaufortLabel(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL, expressionType: 'string' }),

    fn('BeaufortRungName', 'Beaufort rung name', '', 'Name of closest Beaufort integer rung (e.g. "Moderate Breeze").', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthBeaufortRungName(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL, expressionType: 'string' }),

    fn('WindSpeed', 'Equivalent wind speed', '', 'Equivalent wind speed in m/s according to the continuous Beaufort scale.', 'Expression', [],
      `eventsFunctionContext.returnValue = FW.getWaterStrengthWindSpeed(runtimeScene, behavior);
`, { group: G_SLIDER_CONTROL }),
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


/* ------------------------------------------------------- Property Groups (panel layout) */

/**
 * GDevelop buckets a behavior's properties panel by group, in the order the groups are first
 * encountered. Every property is assigned one so nothing falls into the unnamed bucket, and the
 * preset selectors are declared first so their section lands at the top of the panel.
 *
 * A property missing from this map is a build error rather than a silent stray at the bottom.
 */
const G_PRESET = 'Presets — start here';
const G_WAVES = 'Waves & Wind';
const G_MESH = 'Mesh & Spectrum';
const G_OPTICS = 'Colour & Optics';
const G_FOAM = 'Foam & Caustics';
const G_SUN = 'Sun & Lighting';
const G_SHORE = 'Shoreline';
const G_UNDER = 'Underwater';
const G_INTERACT = 'Body Interactions';

const PROPERTY_GROUPS = {
  WaterBody3D: {
    ArtWaterType: G_PRESET,
    WaveHeight: G_WAVES, WaveChoppiness: G_WAVES, WaveSpeed: G_WAVES, WindDirection: G_WAVES,
    WaveTiling: G_WAVES, DirectionalSpread: G_WAVES, PhaseSeed: G_WAVES, WaveIrregularity: G_WAVES,
    WaveScaleMode: G_WAVES, GridSubdivisions: G_WAVES,
    MaterialSource: G_OPTICS, ShallowColor: G_OPTICS, DeepColor: G_OPTICS,
    ExtinctionDepth: G_OPTICS, RefractionScale: G_OPTICS,
    ShoreFoamIntensity: G_FOAM, CrestFoamIntensity: G_FOAM, EnableCaustics: G_FOAM,
    MaskUnderEdges: G_SHORE,
    EnableUnderwaterFX: G_UNDER, UnderwaterFogColor: G_UNDER, UnderwaterFogDensity: G_UNDER,
    EnableBodyInteractions: G_INTERACT, InteractionStrength: G_INTERACT,
    InteractionRadius: G_INTERACT, InteractionSpeedThreshold: G_INTERACT,
  },
  OceanWaveWorks3D: {
    BeaufortScale: G_PRESET,
    SwellAngle: G_WW_SEA,
    SwellWeight: G_WW_SEA,
    WindSpeed: G_WAVES, WindDirection: G_WAVES, CascadeScale: G_WAVES, CascadeWeight: G_WAVES,
    PeakWavelength: G_WAVES, WavelengthScale: G_WAVES, WaveHeightScale: G_WAVES, Choppiness: G_WAVES,
    Resolution: G_MESH, GridSubdivisions: G_MESH, TileSize: G_MESH, Seed: G_MESH, UnitsPerMetre: G_MESH,
    Opacity: G_OPTICS, MicroDetail: G_OPTICS, ShallowColor: G_OPTICS, DeepColor: G_OPTICS,
    ExtinctionDepth: G_OPTICS, TextureAnisotropy: G_OPTICS,
    FoamIntensity: G_FOAM, FoamCoverage: G_FOAM, EnableCaustics: G_FOAM,
    PersistentFoam: G_FOAM,
    SunHeading: G_SUN, SunElevation: G_SUN,
    MaskUnderEdges: G_SHORE,
    EnableUnderwaterFX: G_UNDER, UnderwaterFogColor: G_UNDER, UnderwaterFogDensity: G_UNDER,
    EnableBodyInteractions: G_INTERACT, InteractionStrength: G_INTERACT,
    InteractionRadius: G_INTERACT, InteractionSpeedThreshold: G_INTERACT,
  },
  WaterDetailing3D: {
    ArtStyle: G_PRESET, ArtSubStyle: G_PRESET, ArtWaterLook: G_PRESET, ArtLighting: G_PRESET,
    ArtFoamStyle: G_PRESET,
    SunHeading: G_SUN, SunElevation: G_SUN, SunColor: G_SUN,
    SunSpecularIntensity: G_SUN, SunSpecularRoughness: G_SUN,
    WaveContrast: G_OPTICS, ShallowColor: G_OPTICS, DeepColor: G_OPTICS, ExtinctionDepth: G_OPTICS,
    TranslucencyColor: G_OPTICS, TranslucencyIntensity: G_OPTICS, TranslucencyPower: G_OPTICS,
    MicroDetail: G_OPTICS, MicroFrequency: G_OPTICS, Opacity: G_OPTICS, TextureAnisotropy: G_OPTICS,
    FoamColor: G_FOAM, FoamIntensity: G_FOAM, FoamCoverage: G_FOAM,
    SprayAmount: G_FOAM, SprayEnabled: G_FOAM, SprayHeight: G_FOAM, SprayThreshold: G_FOAM,
  },
  WaterStrengthSlider3D: {
    ScaleMode: G_PRESET,
    SmoothDamping: G_WAVES,
    Strength: G_WAVES,
    TargetWaterBody: 'Behavior',
  },
  WaterEdge3D: {
    FoamWidth: G_SHORE, ShallowWidth: G_SHORE,
    Enabled: 'Behavior', HideSourceObject: 'Behavior',
  },
  Buoyancy3D: {
    Physics3D: 'Physics body',
    BuoyancyFactor: 'Buoyancy', HullProbeCount: 'Buoyancy', FluidDrag: 'Buoyancy',
    MaxSubmersionDepth: 'Buoyancy',
    WaveInfluence: 'Stability', StabilityStrength: 'Stability', StabilityDamping: 'Stability',
    TargetWaterBody: 'Behavior', Enabled: 'Behavior',
  },
  PourableLiquid3D: {
    ArtFluidPreset: G_PRESET,
    MaxDroplets: 'Emitter', FlowRate: 'Emitter', PourTiltThreshold: 'Emitter',
    AutoPourOnTilt: 'Emitter', DropletRadius: 'Emitter',
    Viscosity: 'Fluid physics', SurfaceTension: 'Fluid physics', RestDensity: 'Fluid physics',
    LiquidColor: 'Appearance', LiquidOpacity: 'Appearance', LiquidRoughness: 'Appearance',
    ContainerCapacity: 'Container',
  },
};

function applyPropertyGroups(behaviors) {
  for (const behavior of behaviors) {
    const map = PROPERTY_GROUPS[behavior.name];
    if (!map) throw new Error('No property group map for behavior ' + behavior.name);

    const properties = behavior.propertyDescriptors || [];
    for (const property of properties) {
      const group = map[property.name];
      if (!group) {
        throw new Error('Property ' + behavior.name + '.' + property.name +
          ' has no group. Add it to PROPERTY_GROUPS, or it lands in an unnamed bucket below every ' +
          'named section in the editor panel.');
      }
      property.group = group;
    }

    // The editor ignores this order entirely (see the assertions below), but keeping each group
    // contiguous in the built JSON makes the file readable and diffable.
    const groupOrder = [];
    for (const property of properties) {
      if (!groupOrder.includes(property.group)) groupOrder.push(property.group);
    }
    properties.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
  }
}

/* ============================================================== Extension Object */

const extension = {
  name: 'FluidAndWater3D',
  fullName: 'Fluid and Water 3D',
  description: 'Water and stylized fluid toolkit for GDevelop 5 (Three.js WebGL2 backend). Features Gerstner water volumes, Tessendorf spectral oceans, approximate depth absorption and shoreline foam, underwater fog, multi-probe boat buoyancy, and pourable SPH droplets with container fill tracking.',
  shortDescription: 'Gerstner and FFT oceans, underwater fog, boat buoyancy, and pourable SPH droplets.',
  category: '3D',
  author: 'Twillion',
  license: 'MIT',
  version: '4.6.0',
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
    oceanWaveWorksBehavior,
    edgeBehavior,
    waterDetailingBehavior,
    waterStrengthSliderBehavior,
    buoyancyBehavior,
    pourableLiquidBehavior,
  ],
};

applyPropertyGroups(extension.eventsBasedBehaviors);

/* ============================================================== Pre-build Safety Checks */

/**
 * The properties panel is bucketed by group, in the order each group is first met. Two things have
 * to stay true or the selectors stop being the first thing you see:
 *   1. every behavior that HAS a preset selector opens with the Presets group,
 *   2. no property name is declared twice (a duplicate renders as two identical rows that fight
 *      over the same stored value - OceanWaveWorks3D shipped a duplicated SunHeading/SunElevation
 *      pair exactly this way).
 */
for (const behavior of extension.eventsBasedBehaviors) {
  const properties = behavior.propertyDescriptors || [];

  const names = new Set();
  for (const property of properties) {
    if (names.has(property.name)) {
      throw new Error('Duplicate property ' + behavior.name + '.' + property.name +
        ' - it would show as two identical rows bound to one value.');
    }
    names.add(property.name);
  }

  // GDevelop walks the properties alphabetically by NAME (they come from a sorted
  // gd::MapStringPropertyDescriptor) and opens each group the first time it meets one. Replicate
  // that to know which section really lands at the top - declaration order has no effect.
  const asPanelOrders = [...properties].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const groupsInOrder = [];
  for (const property of asPanelOrders) {
    if (!groupsInOrder.includes(property.group)) groupsInOrder.push(property.group);
  }
  if (groupsInOrder.includes(G_PRESET) && groupsInOrder[0] !== G_PRESET) {
    const firstOfPreset = asPanelOrders.find((p) => p.group === G_PRESET).name;
    throw new Error(behavior.name + ' has preset selectors but its panel opens with "' +
      groupsInOrder[0] + '" instead. The panel is ordered alphabetically by property NAME, so "' +
      firstOfPreset + '" must sort before "' + asPanelOrders[0].name + '" for the preset section ' +
      'to be at the top.');
  }
}

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


// A JS block can reference a parameter it never fetched. That parses perfectly - it is only a bare
// identifier - and the extension builds "clean", but the action throws ReferenceError the first
// time it runs in a real game. This is exactly how "Set Beaufort scale" shipped with an undeclared
// `seconds`: the parameter existed, the argument was simply never read out of the context.
const checkParamsAreFetched = (fns, ownerName) => {
  for (const f of fns || []) {
    const code = (f.events || []).map((e) => e.inlineCode || '').join('\n');
    // Strip strings and comments so a parameter NAME appearing in prose is not a reference.
    const bare = code
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    const declared = new Set();
    for (const m of bare.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

    for (const p of f.parameters || []) {
      const name = p.name;
      if (!name || p.type === 'object' || p.type === 'behavior') continue;
      // The obvious identifiers a author reaches for: the name, and its lower-camel form.
      const candidates = new Set([name, name.charAt(0).toLowerCase() + name.slice(1)]);
      for (const id of candidates) {
        // Not preceded by a dot (that is a property) and not followed by a colon (that is an
        // object key): `FW.update(..., { waveHeight: val })` names a parameter without using it.
        // Parameter names are plain identifiers, so no regex escaping is needed here.
        const used = new RegExp('(?:^|[^A-Za-z0-9_$.])' + id + '(?![A-Za-z0-9_$])(?![ 	]*:)').test(bare);
        if (used && !declared.has(id)) {
          console.error(
            '\n' + ownerName + '.' + f.name + ' uses "' + id + '" but never declares it.\n' +
            'A parameter is not a variable: read it with\n' +
            '  const ' + id + ' = eventsFunctionContext.getArgument("' + name + '");\n' +
            'Otherwise this throws ReferenceError the first time the action runs.\n'
          );
          process.exit(1);
        }
      }
    }
  }
};
for (const behavior of extension.eventsBasedBehaviors) {
  checkParamsAreFetched(behavior.eventsFunctions, behavior.name);
}
checkParamsAreFetched(extension.eventsFunctions, 'freeFunctions');

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
