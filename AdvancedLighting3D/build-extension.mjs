/**
 * build-extension.mjs
 * Compiles AdvancedLighting3D.json from the runtime engine + behavior & function declarations.
 *
 * Run: node AdvancedLighting3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'AdvancedLighting3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__advancedLighting3D';

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

const BEHAVIOR_PREAMBLE = `const __alObjects = eventsFunctionContext.getObjects("Object");
const object = __alObjects.length ? __alObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const AL = ${NS};
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
  // No embedded runtime. `onSceneLoaded` below installs the singleton once per scene,
  // before any user event runs, and each behavior's onCreated carries a copy as a
  // fallback. Embedding the ~95 KB runtime in every block instead is what pushed the
  // generated JSON past 7 MB.
  events: evFree(`if (!${NS}) return;\nconst AL = ${NS};\n` + code),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* ========================================================= ClusteredLight3D Behavior */

const LIGHT_OPTIONS = `{
  lightType: behavior._getLightType ? behavior._getLightType() : 'Point',
  intensity: behavior._getIntensity ? behavior._getIntensity() : 1.0,
  radius: behavior._getRadius ? behavior._getRadius() : 12.0,
  capsuleLength: behavior._getCapsuleLength ? behavior._getCapsuleLength() : 2.0,
  spotInnerAngle: behavior._getSpotInnerAngle ? behavior._getSpotInnerAngle() : 25.0,
  spotOuterAngle: behavior._getSpotOuterAngle ? behavior._getSpotOuterAngle() : 45.0,
  colorMode: behavior._getColorMode ? behavior._getColorMode() : 'Kelvin',
  colorTemperature: behavior._getColorTemperature ? behavior._getColorTemperature() : 2200,
  lightColor: behavior._getLightColor ? behavior._getLightColor() : '255;180;100',
  emissiveBoost: behavior._getEmissiveBoost ? behavior._getEmissiveBoost() : 1.0,
  iesProfile: behavior._getIESProfile ? behavior._getIESProfile() : 'None',
  castContactShadows: behavior._getCastContactShadows ? behavior._getCastContactShadows() : true,
  shadowBias: behavior._getShadowBias ? behavior._getShadowBias() : 0.02,
  castShadow: behavior._getCastShadows ? behavior._getCastShadows() : false,
  sourceRadius: behavior._getSourceRadius ? behavior._getSourceRadius() : 0.0,
  flickerMode: behavior._getFlickerMode ? behavior._getFlickerMode() : 'None',
  flickerSpeed: behavior._getFlickerSpeed ? behavior._getFlickerSpeed() : 8.0,
  flickerIntensityVariation: behavior._getFlickerIntensityVariation ? behavior._getFlickerIntensityVariation() : 0.25
}`;

const lightLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.registerLight(runtimeScene, object, behavior, ${LIGHT_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.stepLight(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.destroyLight(runtimeScene, behavior);\n`),
  },
];

const G_LIGHT_PROP = 'Light Properties';
const G_LIGHT_COLOR = 'Color & Temperature';
const G_LIGHT_SPOT = 'Spotlight & Area Light';
const G_LIGHT_FX = 'Animation & Flicker';
const G_LIGHT_SHADOW = 'Shadows & IES Profiles';

const lightActions = [
  fn('SetIntensity', 'Set light intensity',
    'Set light intensity on _PARAM0_ to _PARAM2_',
    'Change the base radiant intensity multiplier of the light.', 'Action',
    [num('Intensity', 'Base radiant intensity', '1.0')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setIntensity) behavior._setIntensity(val);
AL.updateLight(runtimeScene, object, behavior, { intensity: val });
`, { group: G_LIGHT_PROP }),

  fn('SetRadius', 'Set light radius',
    'Set light attenuation radius on _PARAM0_ to _PARAM2_',
    'Change maximum attenuation radius in meters (smoothly reaches 0 at boundary).', 'Action',
    [num('Radius', 'Maximum radius in meters', '12.0')],
    `const val = eventsFunctionContext.getArgument("Radius");
if (behavior._setRadius) behavior._setRadius(val);
AL.updateLight(runtimeScene, object, behavior, { radius: val });
`, { group: G_LIGHT_PROP }),

  fn('SetLightType', 'Set light emission type',
    'Set light emission type on _PARAM0_ to _PARAM2_',
    'Set the geometry type of the light: Point, Spot, or AreaCapsule.', 'Action',
    [choice('LightType', 'Emission geometry', ['Point', 'Spot', 'AreaCapsule'])],
    `const val = eventsFunctionContext.getArgument("LightType");
if (behavior._setLightType) behavior._setLightType(val);
AL.updateLight(runtimeScene, object, behavior, { lightType: val });
`, { group: G_LIGHT_PROP }),

  fn('SetColorTemperature', 'Set color temperature (Kelvin)',
    'Set light color temperature in Kelvin on _PARAM0_ to _PARAM2_',
    'Set blackbody temperature in Kelvin (1000K candle flame to 12000K blue sky).', 'Action',
    [num('Kelvin', 'Color temperature in Kelvin (e.g. 2200 for torch, 6500 for daylight)', '2200')],
    `const val = eventsFunctionContext.getArgument("Kelvin");
if (behavior._setColorTemperature) behavior._setColorTemperature(val);
AL.updateLight(runtimeScene, object, behavior, { colorTemperature: val, colorMode: 'Kelvin' });
`, { group: G_LIGHT_COLOR }),

  fn('SetLightColor', 'Set RGB light color',
    'Set light RGB color on _PARAM0_ to _PARAM2_',
    'Set custom light RGB color string.', 'Action',
    [col('Color', 'Light RGB color', '255;180;100')],
    `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setLightColor) behavior._setLightColor(val);
AL.updateLight(runtimeScene, object, behavior, { lightColor: val, colorMode: 'RGB' });
`, { group: G_LIGHT_COLOR }),

  fn('SetColorMode', 'Set color mode',
    'Set color mode on _PARAM0_ to _PARAM2_',
    'Switch between Kelvin physical blackbody temperature and direct RGB color.', 'Action',
    [choice('Mode', 'Color definition method', ['Kelvin', 'RGB'])],
    `const val = eventsFunctionContext.getArgument("Mode");
if (behavior._setColorMode) behavior._setColorMode(val);
AL.updateLight(runtimeScene, object, behavior, { colorMode: val });
`, { group: G_LIGHT_COLOR }),

  fn('SetEmissiveBoost', 'Set emissive boost',
    'Set emissive color boost on _PARAM0_ to _PARAM2_',
    'Over-bright intensity multiplier for glow, post-processing bloom, and neon reflections.', 'Action',
    [num('Boost', 'Emissive boost multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("Boost");
if (behavior._setEmissiveBoost) behavior._setEmissiveBoost(val);
AL.updateLight(runtimeScene, object, behavior, { emissiveBoost: val });
`, { group: G_LIGHT_COLOR }),

  fn('SetSpotAngles', 'Set spotlight angles',
    'Set spotlight angles on _PARAM0_ (Inner: _PARAM2_, Outer: _PARAM3_)',
    'Set spotlight cone inner cutoff and outer penumbra angles in degrees.', 'Action',
    [
      num('InnerAngle', 'Inner cone focus angle in degrees', '25.0'),
      num('OuterAngle', 'Outer cone soft penumbra angle in degrees', '45.0')
    ],
    `const inner = eventsFunctionContext.getArgument("InnerAngle");
const outer = eventsFunctionContext.getArgument("OuterAngle");
if (behavior._setSpotInnerAngle) behavior._setSpotInnerAngle(inner);
if (behavior._setSpotOuterAngle) behavior._setSpotOuterAngle(outer);
AL.updateLight(runtimeScene, object, behavior, { spotInnerAngle: inner, spotOuterAngle: outer });
`, { group: G_LIGHT_SPOT }),

  fn('SetCapsuleLength', 'Set area capsule length',
    'Set area capsule length on _PARAM0_ to _PARAM2_',
    'Set neon tube / fluorescent bar length in meters.', 'Action',
    [num('Length', 'Capsule tube length in meters', '2.0')],
    `const val = eventsFunctionContext.getArgument("Length");
if (behavior._setCapsuleLength) behavior._setCapsuleLength(val);
AL.updateLight(runtimeScene, object, behavior, { capsuleLength: val });
`, { group: G_LIGHT_SPOT }),

  fn('SetIESProfile', 'Set IES photometric profile',
    'Set IES photometric profile on _PARAM0_ to _PARAM2_',
    'Set architectural photometric light distribution curve.', 'Action',
    [choice('Profile', 'IES distribution profile', ['None', 'WallSconce', 'StreetLamp', 'Downlight', 'Searchlight'])],
    `const val = eventsFunctionContext.getArgument("Profile");
if (behavior._setIESProfile) behavior._setIESProfile(val);
AL.updateLight(runtimeScene, object, behavior, { iesProfile: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetCastContactShadows', 'Enable contact micro-shadows',
    'Enable contact micro-shadows on _PARAM0_: _PARAM2_',
    'Toggle screen-space contact micro-shadow raymarching for this light.', 'Action',
    [bool('Enable', 'Enable contact micro-shadows')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setCastContactShadows) behavior._setCastContactShadows(val);
AL.updateLight(runtimeScene, object, behavior, { castContactShadows: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetCastShadows', 'Enable SDF soft shadows',
    'Enable SDF soft shadows on _PARAM0_: _PARAM2_',
    'Toggle Signed Distance Field raymarched soft shadows for this light.', 'Action',
    [bool('Enable', 'Enable SDF shadows')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setCastShadows) behavior._setCastShadows(val);
AL.updateLight(runtimeScene, object, behavior, { castShadow: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetSourceRadius', 'Set light source radius',
    'Set light source radius on _PARAM0_ to _PARAM2_',
    'Set physical light source radius for penumbra calculation (in world units; 0 uses 5% of light radius).', 'Action',
    [num('SourceRadius', 'Physical source radius in world units', '0.0')],
    `const val = eventsFunctionContext.getArgument("SourceRadius");
if (behavior._setSourceRadius) behavior._setSourceRadius(val);
AL.updateLight(runtimeScene, object, behavior, { sourceRadius: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetShadowBias', 'Set shadow bias',
    'Set shadow bias on _PARAM0_ to _PARAM2_',
    'Set normal offset bias to prevent self-shadow acne.', 'Action',
    [num('Bias', 'Shadow bias offset', '0.02')],
    `const val = eventsFunctionContext.getArgument("Bias");
if (behavior._setShadowBias) behavior._setShadowBias(val);
AL.updateLight(runtimeScene, object, behavior, { shadowBias: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetProceduralFlicker', 'Set procedural flicker',
    'Set procedural flicker on _PARAM0_ (Mode: _PARAM2_, Speed: _PARAM3_, Variation: _PARAM4_)',
    'Configure flame flicker, fluorescent hum, or siren strobe animations.', 'Action',
    [
      choice('Mode', 'Flicker pattern', ['None', 'FireFlicker', 'FluorescentHum', 'SirenStrobe', 'PulseWave']),
      num('Speed', 'Flicker frequency in Hz', '8.0'),
      num('Variation', 'Amplitude variation (0.0 to 1.0)', '0.25')
    ],
    `const mode = eventsFunctionContext.getArgument("Mode");
const spd = eventsFunctionContext.getArgument("Speed");
const vari = eventsFunctionContext.getArgument("Variation");
if (behavior._setFlickerMode) behavior._setFlickerMode(mode);
if (behavior._setFlickerSpeed) behavior._setFlickerSpeed(spd);
if (behavior._setFlickerIntensityVariation) behavior._setFlickerIntensityVariation(vari);
AL.updateLight(runtimeScene, object, behavior, {
  flickerMode: mode,
  flickerSpeed: spd,
  flickerIntensityVariation: vari
});
`, { group: G_LIGHT_FX }),

  fn('TriggerMuzzleFlash', 'Trigger muzzle flash burst',
    'Trigger muzzle flash burst on _PARAM0_ with duration _PARAM2_ seconds',
    'Trigger a single-shot high-intensity decay burst (e.g. for gunshots, spell impacts).', 'Action',
    [num('Duration', 'Burst duration in seconds', '0.05')],
    `const dur = eventsFunctionContext.getArgument("Duration");
const light = behavior.__alLight;
if (light) AL.triggerMuzzleFlash(light, dur);
`, { group: G_LIGHT_FX }),
];

const lightConditions = [
  fn('IsActive', 'Is clustered light active',
    '_PARAM0_ clustered light is active',
    'Check if the clustered light is actively emitting in the scene.', 'Condition',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = !!(light && light.active && light.currentIntensity > 0.0001);
`, { group: G_LIGHT_PROP }),

  fn('IsInFrustum', 'Is light within camera view frustum',
    '_PARAM0_ light is within camera view frustum',
    'Check if the light bounding sphere intersects the active camera frustum.', 'Condition',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = !!(light && light.isInFrustum);
`, { group: G_LIGHT_PROP }),

  fn('IsFlickerActive', 'Is procedural flicker active',
    '_PARAM0_ light procedural flicker is active',
    'Check if procedural flicker or strobe modulation is active.', 'Condition',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = !!(light && light.flickerMode !== 'None' && light.flickerIntensityVariation > 0);
`, { group: G_LIGHT_FX }),

  fn('CastsShadows', 'Clustered light casts SDF shadows',
    '_PARAM0_ clustered light casts SDF shadows',
    'Check if the clustered light is configured to cast SDF shadows.', 'Condition',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = !!(light && light.castShadow);
`, { group: G_LIGHT_SHADOW }),
];

const lightExpressions = [
  fn('Intensity', 'Current intensity',
    '', 'Return the active radiant intensity (including flicker/flash offsets).', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.currentIntensity : 0.0;
`, { group: G_LIGHT_PROP, expressionType: 'number' }),

  fn('Radius', 'Attenuation radius',
    '', 'Return the maximum attenuation radius in meters.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.radius : 0.0;
`, { group: G_LIGHT_PROP, expressionType: 'number' }),

  fn('ColorTemperature', 'Color temperature in Kelvin',
    '', 'Return the blackbody color temperature in Kelvin.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.colorTemperature : 2200;
`, { group: G_LIGHT_COLOR, expressionType: 'number' }),

  fn('EmissiveBoost', 'Emissive boost multiplier',
    '', 'Return the emissive color multiplier.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.emissiveBoost : 1.0;
`, { group: G_LIGHT_COLOR, expressionType: 'number' }),

  fn('CapsuleLength', 'Area capsule length',
    '', 'Return the neon tube/bar length in meters.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.capsuleLength : 0.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('SpotInnerAngle', 'Spotlight inner angle',
    '', 'Return the inner cone focus angle in degrees.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.spotInnerAngle : 25.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('SpotOuterAngle', 'Spotlight outer angle',
    '', 'Return the outer cone soft penumbra angle in degrees.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.spotOuterAngle : 45.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('ShadowBias', 'Shadow bias offset',
    '', 'Return the normal offset bias.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.shadowBias : 0.02;
`, { group: G_LIGHT_SHADOW, expressionType: 'number' }),

  fn('SourceRadius', 'Light source radius',
    '', 'Return the physical source radius for penumbra calculations in world units.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? (light.sourceRadius || 0.0) : 0.0;
`, { group: G_LIGHT_SHADOW, expressionType: 'number' }),

  fn('FlickerSpeed', 'Flicker frequency in Hz',
    '', 'Return the animation oscillation speed.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.flickerSpeed : 8.0;
`, { group: G_LIGHT_FX, expressionType: 'number' }),

  fn('FlickerIntensityVariation', 'Flicker variation amplitude',
    '', 'Return the random flicker amplitude.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.flickerIntensityVariation : 0.25;
`, { group: G_LIGHT_FX, expressionType: 'number' }),

  fn('ViewDistance', 'Distance to active camera',
    '', 'Return the distance from the active camera to the light in meters.', 'Expression',
    [],
    `const light = behavior.__alLight;
eventsFunctionContext.returnValue = light ? light.viewDistance : 0.0;
`, { group: G_LIGHT_PROP, expressionType: 'number' }),
];

const clusteredLightBehavior = {
  name: 'ClusteredLight3D',
  fullName: 'Clustered Light 3D',
  description: 'Adds high-performance clustered dynamic lighting to a 3D object (Point, Spot, or Area Capsule) with Karis area specular, Frostbite falloff, blackbody Kelvin temperature, IES photometric profiles, and procedural flicker.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('LightType', 'Choice', 'Light Type', 'Emission geometry: Point, Spot, or AreaCapsule.', 'Point', {
      extraInformation: ['Point', 'Spot', 'AreaCapsule']
    }),
    prop('Intensity', 'Number', 'Base Intensity', 'Base radiant intensity multiplier.', '1.0'),
    prop('Radius', 'Number', 'Attenuation Radius', 'Maximum reach in METRES; the runtime converts at 100 world units per metre, so 12 m is 1200 units. Attenuation hits exactly zero at this distance, so anything beyond it is unlit. Lowering it is the main performance lever (see the README), but raise it rather than lose the light.', '12.0'),
    prop('CapsuleLength', 'Number', 'Capsule Length', 'Length of the neon tube / area bar in METRES (AreaCapsule only). 2 m is 200 world units.', '2.0'),
    prop('SpotInnerAngle', 'Number', 'Spot Inner Angle', 'Inner cone cutoff in degrees (Spot only).', '25.0'),
    prop('SpotOuterAngle', 'Number', 'Spot Outer Angle', 'Outer cone soft penumbra in degrees (Spot only).', '45.0'),
    prop('ColorMode', 'Choice', 'Color Mode', 'Color definition method: Kelvin or RGB.', 'Kelvin', {
      extraInformation: ['Kelvin', 'RGB']
    }),
    prop('ColorTemperature', 'Number', 'Color Temperature (K)', 'Blackbody temperature in Kelvin (1000K - 12000K).', '2200'),
    prop('LightColor', 'Color', 'Light Color (RGB)', 'Direct RGB color when Color Mode is RGB.', '255;180;100'),
    prop('EmissiveBoost', 'Number', 'Emissive Boost', 'Over-bright multiplier for glow/bloom.', '1.0'),
    prop('IESProfile', 'Choice', 'IES Profile', 'Architectural photometric profile.', 'None', {
      extraInformation: ['None', 'WallSconce', 'StreetLamp', 'Downlight', 'Searchlight']
    }),
    prop('CastContactShadows', 'Boolean', 'Cast Contact Micro-Shadows', 'Enable screen-space contact micro-shadows.', 'true'),
    prop('CastShadows', 'Boolean', 'Cast SDF Shadows', 'Cast raymarched soft shadows from the static scene Signed Distance Field volume.', 'false'),
    prop('SourceRadius', 'Number', 'Light Source Radius', 'Physical light source radius for penumbra calculation (in world units, 0 uses 5% of light radius).', '0.0'),
    prop('ShadowBias', 'Number', 'Shadow Bias', 'Normal offset bias to prevent self-shadow acne.', '0.02'),
    prop('FlickerMode', 'Choice', 'Flicker Mode', 'Procedural animation pattern.', 'None', {
      extraInformation: ['None', 'FireFlicker', 'FluorescentHum', 'SirenStrobe', 'PulseWave']
    }),
    prop('FlickerSpeed', 'Number', 'Flicker Speed (Hz)', 'Oscillation / noise frequency.', '8.0'),
    prop('FlickerIntensityVariation', 'Number', 'Flicker Variation', 'Amplitude of random flicker brightness (0.0 to 1.0).', '0.25'),
  ],
  eventsFunctions: [
    ...lightLifecycle,
    ...lightActions,
    ...lightConditions,
    ...lightExpressions,
  ],
};

/* ========================================================= Global / Scene Manager Functions */

const G_SCENE_CONTROL = 'Clustered Lighting — Scene Controls';
const G_SCENE_DIAGNOSTICS = 'Clustered Lighting — Diagnostics';

const freeActions = [
  freeFn('SetGlobalIntensity', 'Set global clustered light intensity',
    'Set global clustered light intensity to _PARAM0_',
    'Master brightness multiplier for all dynamic clustered lights in the scene.', 'Action',
    [num('Intensity', 'Master brightness multiplier', '1.0')],
    `AL.setGlobalIntensity(runtimeScene, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('SetMaxLights', 'Set maximum active dynamic lights',
    'Set maximum active streamed dynamic lights to _PARAM0_',
    'Configure the maximum dynamic lights streamed to GPU simultaneously (64 - 512).', 'Action',
    [num('MaxLights', 'Maximum active lights (64 - 512)', '256')],
    `AL.setMaxLights(runtimeScene, eventsFunctionContext.getArgument("MaxLights"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('EnableContactShadows', 'Enable clustered contact micro-shadows',
    'Enable clustered contact micro-shadows: _PARAM0_',
    'Toggle screen-space contact micro-shadowing (SSCS) globally across all clustered lights.', 'Action',
    [bool('Enable', 'Enable screen-space contact micro-shadows')],
    `AL.enableContactShadows(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('ToggleDebugVisualizer', 'Show / hide debug visualizer',
    'Set clustered lighting debug visualizer enabled: _PARAM0_',
    'Toggle debug display of light sources in preview and runtime.', 'Action',
    [bool('Enable', 'Show debug visualizer')],
    `AL.toggleDebugVisualizer(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true }),
];

const freeConditions = [
  freeFn('IsSupported', 'Clustered lighting is supported (WebGL2)',
    'Clustered lighting is supported on current context (WebGL2)',
    'Check if WebGL2 texture streaming is available on the current device.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isWebGL2Available(runtimeScene);\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),
];

const freeExpressions = [
  freeFn('ActiveLightCount', 'Active rendered light count',
    '', 'Total number of clustered lights rendered in the active frame.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getActiveLightCount(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('MaxLightsInSingleCluster', 'Max lights in single cluster',
    '', 'Peak light count inside the densest spatial cluster (for performance monitoring).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getMaxLightsInSingleCluster(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('CPUBroadphaseTimeMs', 'CPU broadphase execution time (ms)',
    '', 'Execution time in milliseconds for CPU light binning in the current frame.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getCPUBroadphaseTimeMs(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('TotalClusterCount', 'Total spatial cluster count',
    '', 'Total number of spatial cluster voxels (3,456).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getTotalClusterCount(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ClusterVRAMBytes', 'GPU texture VRAM memory (bytes)',
    '', 'Total VRAM allocated for clustered lighting buffers in bytes (< 60 KB).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getClusterVRAMBytes(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),
];

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
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.registerVolume(runtimeScene, object, behavior, ${VOL_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.updateVolume(runtimeScene, object, behavior, ${VOL_OPTIONS});\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.disposeVolume(runtimeScene, behavior);\n`),
  },
];

const G_VOL_CONFIG = 'Probe Volume — Configuration';
const G_VOL_DEBUG = 'Probe Volume — Debug';

const volumeActions = [
  fn('SetSkyColor', 'Set sky color',
    'Set sky ambient color of _PARAM0_ to _PARAM2_',
    'Ambient colour arriving from above (+Z). Takes effect on the next bake.', 'Action',
    [col('Color', 'Sky ambient color arriving from +Z', '160;200;255')],
    `if (behavior._setSkyColor) behavior._setSkyColor(eventsFunctionContext.getArgument("Color"));
const vol = AL.volumeOf(behavior);
if (vol) AL.updateVolume(runtimeScene, object, behavior, { skyColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetGroundColor', 'Set ground color',
    'Set ground bounce color of _PARAM0_ to _PARAM2_',
    'Ambient bounce colour arriving from below (-Z). Takes effect on the next bake.', 'Action',
    [col('Color', 'Ground bounce color arriving from -Z', '80;120;50')],
    `if (behavior._setGroundColor) behavior._setGroundColor(eventsFunctionContext.getArgument("Color"));
const vol = AL.volumeOf(behavior);
if (vol) AL.updateVolume(runtimeScene, object, behavior, { groundColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetHorizonColor', 'Set horizon color',
    'Set horizon color of _PARAM0_ to _PARAM2_',
    'Ambient colour at the horizon. Takes effect on the next bake.', 'Action',
    [col('Color', 'Ambient color at the horizon', '200;220;240')],
    `if (behavior._setHorizonColor) behavior._setHorizonColor(eventsFunctionContext.getArgument("Color"));
const vol = AL.volumeOf(behavior);
if (vol) AL.updateVolume(runtimeScene, object, behavior, { horizonColor: eventsFunctionContext.getArgument("Color") });
`, { group: G_VOL_CONFIG }),

  fn('SetVolumeIntensity', 'Set volume intensity',
    'Set probe volume intensity of _PARAM0_ to _PARAM2_',
    'Ambient intensity scale for this volume. Applies immediately, no rebake needed.', 'Action',
    [num('Intensity', 'Ambient intensity scale for this volume', '1.0')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setVolumeIntensity) behavior._setVolumeIntensity(val);
const vol = AL.volumeOf(behavior);
if (vol) vol.volumeIntensity = val;
`, { group: G_VOL_CONFIG }),

  fn('SetAutoBakeOnStart', 'Enable / disable auto-bake on start',
    'Enable auto-bake on start on probe volume _PARAM0_: _PARAM2_',
    'Automatically start baking scene ambient probes when the scene starts.', 'Action',
    [bool('AutoBake', 'Automatically bake probes when scene starts')],
    `const auto = !!eventsFunctionContext.getArgument("AutoBake");
if (behavior._setAutoBakeOnStart) behavior._setAutoBakeOnStart(auto);
const vol = AL.volumeOf(behavior);
if (vol) vol.autoBakeOnStart = auto;
`, { group: G_VOL_CONFIG }),

  fn('SetShowDebugSpheres', 'Show / hide debug probe spheres',
    'Show debug probe spheres on probe volume _PARAM0_: _PARAM2_',
    'Draw one instanced sphere per probe, tinted by its sampled colour. Preview and runtime only.', 'Action',
    [bool('Show', 'Show debug probe spheres')],
    `const show = !!eventsFunctionContext.getArgument("Show");
if (behavior._setShowDebugSpheres) behavior._setShowDebugSpheres(show);
const vol = AL.volumeOf(behavior);
if (vol) {
  vol.showDebugSpheres = show;
  AL.toggleProbeDebugVisualizer(runtimeScene, show);
}
`, { group: G_VOL_DEBUG }),
];

const volumeConditions = [
  fn('IsDebugVisualizerEnabled', 'Debug probe spheres are visible',
    'Debug probe spheres are visible on probe volume _PARAM0_',
    'True while the instanced probe spheres are being drawn.', 'Condition',
    [],
    `const vol = AL.volumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.showDebugSpheres);
`, { group: G_VOL_DEBUG }),

  fn('IsAutoBakeOnStart', 'Auto-bake on start is enabled',
    'Auto-bake on start is enabled on probe volume _PARAM0_',
    'True if this volume bakes itself when the scene starts.', 'Condition',
    [],
    `const vol = AL.volumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.autoBakeOnStart);
`, { group: G_VOL_CONFIG }),

  fn('IsVolumeBaked', 'Probe volume holds baked data',
    'Probe volume _PARAM0_ holds baked data',
    'True once a bake has completed or probe data has been loaded from a file. False while the ' +
    'volume is still showing the pre-bake altitude gradient.', 'Condition',
    [],
    `const vol = AL.volumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.isBaked);
`, { group: G_VOL_CONFIG }),
];

const volumeExpressions = [
  fn('VolumeIntensity', 'Probe volume intensity',
    '', 'Ambient intensity scale currently applied to this volume.', 'Expression',
    [],
    `const vol = AL.volumeOf(behavior);
eventsFunctionContext.returnValue = vol ? vol.volumeIntensity : 1.0;
`, { group: G_VOL_CONFIG, expressionType: 'number' }),

  fn('ProbeCount', 'Total probe count',
    '', 'Probes in this volume: ResolutionX * ResolutionY * ResolutionZ.', 'Expression',
    [],
    `const vol = AL.volumeOf(behavior);
eventsFunctionContext.returnValue = vol ? (vol.resX * vol.resY * vol.resZ) : 0;
`, { group: G_VOL_CONFIG, expressionType: 'number' }),
];

const volumeBehavior = {
  name: 'LightProbeVolume3D',
  fullName: 'Light Probe Volume 3D',
  description: 'Attach to a 3D Box (Cube3D) to define the spatial bounds, resolution and ambient ' +
    'colours of the scene\'s light probe grid. The box transform sets the volume bounds; the box ' +
    'itself is hidden at runtime. One volume per scene.',
  // Restricted to Cube3D: the volume reads getZ/getDepth off the object, and an
  // unrestricted behavior can be dropped on a Sprite where those do not exist.
  objectType: 'Scene3D::Cube3DObject',
  private: false,
  propertyDescriptors: [
    prop('ResolutionX', 'Number', 'Resolution X', 'Probes along world X. Clamped to [2, 64].', '16'),
    prop('ResolutionY', 'Number', 'Resolution Y', 'Probes along world Y. Clamped to [2, 64].', '16'),
    prop('ResolutionZ', 'Number', 'Resolution Z (Height)', 'Probes along world Z (the height axis). Clamped to [2, 64].', '4'),
    prop('SkyColor', 'Color', 'Sky Color', 'Ambient colour arriving from above (+Z).', '160;200;255'),
    prop('GroundColor', 'Color', 'Ground Color', 'Ambient bounce colour arriving from below (-Z).', '80;120;50'),
    prop('HorizonColor', 'Color', 'Horizon Color', 'Ambient colour at the horizon.', '200;220;240'),
    prop('VolumeIntensity', 'Number', 'Volume Intensity', 'Global ambient scale for this volume.', '1.0'),
    prop('DayNightMode', 'Boolean', 'Day / Night Mode', 'Allocate and blend a second night volume.', 'false'),
    prop('AutoBakeOnStart', 'Boolean', 'Auto-Bake On Start', 'Automatically bake scene ambient probes when the scene starts.', 'false'),
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
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.registerReceiver(runtimeScene, object, behavior, ${REC_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.stepReceiver(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.disposeReceiver(runtimeScene, behavior);\n`),
  },
];

const G_REC_SETTINGS = 'Probe Receiver — Settings';

const receiverActions = [
  fn('SetIntensityMultiplier', 'Set probe intensity multiplier',
    'Set probe intensity multiplier on _PARAM0_ to _PARAM2_',
    'Per-instance multiplier on the indirect light this object receives from the probe volume.', 'Action',
    [num('Multiplier', 'Per-instance multiplier on indirect light', '1.0')],
    `const val = eventsFunctionContext.getArgument("Multiplier");
if (behavior._setIntensityMultiplier) behavior._setIntensityMultiplier(val);
const rec = AL.receiverOf(behavior);
if (rec) rec.intensityMultiplier = val;
`, { group: G_REC_SETTINGS }),

  fn('SetNormalBiasOffset', 'Set probe normal bias offset',
    'Set probe normal bias offset on _PARAM0_ to _PARAM2_ world units',
    'Offset the probe sample position along the surface normal, in world units (pixels). ' +
    'Raise it if surfaces pick up the ambient of the wall behind them.', 'Action',
    [num('Offset', 'Offset along surface normal in world units (pixels)', '15.0')],
    `const val = eventsFunctionContext.getArgument("Offset");
if (behavior._setNormalBiasOffset) behavior._setNormalBiasOffset(val);
const rec = AL.receiverOf(behavior);
if (rec) rec.normalBias = val;
`, { group: G_REC_SETTINGS }),

  fn('SetEnabled', 'Enable / disable receiving light probes',
    'Enable receiving light probes on _PARAM0_: _PARAM2_',
    'Turn probe sampling on or off for this instance. Disabling drives its probe ' +
    'contribution to zero without recompiling the shader.', 'Action',
    [bool('Enabled', 'Enable probe sampling on this instance')],
    `const val = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(val);
const rec = AL.receiverOf(behavior);
if (rec) rec.enabled = val;
`, { group: G_REC_SETTINGS }),
];

const receiverConditions = [
  fn('IsReceiving', 'Is receiving light probes',
    '_PARAM0_ is receiving light probes',
    'True only when this instance is enabled, WebGL2 is available and a probe volume is loaded.', 'Condition',
    [],
    `const rec = AL.receiverOf(behavior);
eventsFunctionContext.returnValue = !!(rec && rec.enabled && AL.isSupported(runtimeScene) && AL.isProbeVolumeLoaded(runtimeScene));
`, { group: G_REC_SETTINGS }),

  fn('IsEnabled', 'Light probe sampling is enabled',
    'Light probe sampling is enabled on _PARAM0_',
    'True if probe sampling is switched on for this instance, regardless of scene state.', 'Condition',
    [],
    `const rec = AL.receiverOf(behavior);
eventsFunctionContext.returnValue = !!(rec && rec.enabled);
`, { group: G_REC_SETTINGS }),
];

const receiverExpressions = [
  fn('ProbeIntensity', 'Probe intensity multiplier',
    '', 'Per-instance multiplier on received indirect light.', 'Expression',
    [],
    `const rec = AL.receiverOf(behavior);
eventsFunctionContext.returnValue = rec ? rec.intensityMultiplier : 1.0;
`, { group: G_REC_SETTINGS, expressionType: 'number' }),

  fn('ProbeNormalBias', 'Probe normal bias offset',
    '', 'Sample offset along the surface normal, in world units (pixels).', 'Expression',
    [],
    `const rec = AL.receiverOf(behavior);
eventsFunctionContext.returnValue = rec ? rec.normalBias : 15.0;
`, { group: G_REC_SETTINGS, expressionType: 'number' }),
];

const receiverBehavior = {
  name: 'ReceiveLightProbes',
  fullName: 'Receive Light Probes 3D',
  description: 'Attach to any lit 3D object (Model3D, Cube3D) to sample the scene\'s light probe ' +
    'volume per fragment, so the object picks up the indirect ambient colour of wherever it is ' +
    'standing. Objects with this behavior also receive clustered dynamic lights.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('IntensityMultiplier', 'Number', 'Intensity Multiplier', 'Per-instance multiplier on received indirect light.', '1.0'),
    prop('NormalBiasOffset', 'Number', 'Normal Bias Offset', 'Offset along the surface normal in world units (pixels).', '15.0'),
    prop('UpdateFrequency', 'Choice', 'Update Frequency', 'Continuous (every frame) or Throttled (every 5 frames).', 'Continuous', {
      extraInformation: ['Continuous', 'Throttled']
    }),
    prop('Enabled', 'Boolean', 'Enabled', 'Whether probe sampling is active on this instance.', 'true'),
  ],
  eventsFunctions: [
    ...receiverLifecycle,
    ...receiverActions,
    ...receiverConditions,
    ...receiverExpressions,
  ],
};

/* ========================================================= SDFVolume3D Behavior */

const SDF_VOL_OPTIONS = `{
  resX: behavior._getResolutionX ? behavior._getResolutionX() : 128,
  resY: behavior._getResolutionY ? behavior._getResolutionY() : 128,
  resZ: behavior._getResolutionZ ? behavior._getResolutionZ() : 32,
  autoBakeOnStart: behavior._getAutoBakeOnStart ? behavior._getAutoBakeOnStart() : false
}`;

const sdfVolumeLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.registerSDFVolume(runtimeScene, object, behavior, ${SDF_VOL_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.updateSDFVolume(runtimeScene, object, behavior, ${SDF_VOL_OPTIONS});\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AL.disposeSDFVolume(runtimeScene, behavior);\n`),
  },
];

const G_SDF_VOL_CONFIG = 'SDF Volume — Configuration';

const sdfVolumeActions = [
  fn('SetAutoBakeOnStart', 'Enable / disable auto-bake on start',
    'Enable auto-bake on start on SDF volume _PARAM0_: _PARAM2_',
    'Automatically start baking Signed Distance Field when the scene starts.', 'Action',
    [bool('AutoBake', 'Automatically bake SDF when scene starts')],
    `const auto = !!eventsFunctionContext.getArgument("AutoBake");
if (behavior._setAutoBakeOnStart) behavior._setAutoBakeOnStart(auto);
const vol = AL.sdfVolumeOf(behavior);
if (vol) vol.autoBakeOnStart = auto;
`, { group: G_SDF_VOL_CONFIG }),
];

const sdfVolumeConditions = [
  fn('IsAutoBakeOnStart', 'Auto-bake on start is enabled',
    'Auto-bake on start is enabled on SDF volume _PARAM0_',
    'True if this volume bakes itself when the scene starts.', 'Condition',
    [],
    `const vol = AL.sdfVolumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.autoBakeOnStart);
`, { group: G_SDF_VOL_CONFIG }),

  fn('IsVolumeBaked', 'SDF volume holds baked data',
    'SDF volume _PARAM0_ holds baked data',
    'True once an SDF bake has completed or SDF data has been loaded from a file.', 'Condition',
    [],
    `const vol = AL.sdfVolumeOf(behavior);
eventsFunctionContext.returnValue = !!(vol && vol.isBaked);
`, { group: G_SDF_VOL_CONFIG }),
];

const sdfVolumeExpressions = [
  fn('VoxelCount', 'Total voxel count',
    '', 'Total voxels in this SDF volume: ResolutionX * ResolutionY * ResolutionZ.', 'Expression',
    [],
    `const vol = AL.sdfVolumeOf(behavior);
eventsFunctionContext.returnValue = vol ? (vol.resX * vol.resY * vol.resZ) : 0;
`, { group: G_SDF_VOL_CONFIG, expressionType: 'number' }),

  fn('VoxelSize', 'Voxel world size',
    '', 'Size of one voxel in world units.', 'Expression',
    [],
    `const vol = AL.sdfVolumeOf(behavior);
eventsFunctionContext.returnValue = vol ? (vol.voxelSize || 0) : 0;
`, { group: G_SDF_VOL_CONFIG, expressionType: 'number' }),
];

const sdfVolumeBehavior = {
  name: 'SDFVolume3D',
  fullName: 'Signed Distance Field Volume 3D',
  description: 'Attach to a 3D Box (Cube3D) to define the spatial bounds and voxel resolution for static scene Signed Distance Field (SDF) soft shadows. The box transform sets the volume bounds; the box itself is hidden at runtime. One SDF volume per scene.',
  objectType: 'Scene3D::Cube3DObject',
  private: false,
  propertyDescriptors: [
    prop('ResolutionX', 'Number', 'Resolution X', 'Voxel grid resolution along world X. Clamped to [8, 256].', '128'),
    prop('ResolutionY', 'Number', 'Resolution Y', 'Voxel grid resolution along world Y. Clamped to [8, 256].', '128'),
    prop('ResolutionZ', 'Number', 'Resolution Z (Height)', 'Voxel grid resolution along world Z (height axis). Clamped to [4, 128].', '32'),
    prop('AutoBakeOnStart', 'Boolean', 'Auto-Bake On Start', 'Automatically bake scene SDF when the scene starts.', 'false'),
  ],
  eventsFunctions: [
    ...sdfVolumeLifecycle,
    ...sdfVolumeActions,
    ...sdfVolumeConditions,
    ...sdfVolumeExpressions,
  ],
};

/* ================================================= Light Probe Free Functions ======== */

const G_PROBE_CONTROL = 'Light Probes — Scene Controls';
const G_PROBE_BAKE = 'Light Probes — Baking';
const G_PROBE_METRICS = 'Light Probes — Metrics';

const probeFreeActions = [
  freeFn('SetProbeVolumeBounds', 'Set probe volume bounds',
    'Set light probe grid bounds to Min: (_PARAM0_, _PARAM1_, _PARAM2_), Max: (_PARAM3_, _PARAM4_, _PARAM5_)',
    'Set the probe volume bounds explicitly, in GDevelop world coordinates. From this point on ' +
    'the authoring cube no longer controls the volume.', 'Action',
    [
      num('MinX', 'Minimum X in GDevelop coordinates', '0'),
      num('MinY', 'Minimum Y in GDevelop coordinates', '0'),
      num('MinZ', 'Minimum Z in GDevelop coordinates', '0'),
      num('MaxX', 'Maximum X in GDevelop coordinates', '1000'),
      num('MaxY', 'Maximum Y in GDevelop coordinates', '1000'),
      num('MaxZ', 'Maximum Z in GDevelop coordinates', '500'),
    ],
    `AL.setProbeBounds(
  runtimeScene,
  eventsFunctionContext.getArgument("MinX"),
  eventsFunctionContext.getArgument("MinY"),
  eventsFunctionContext.getArgument("MinZ"),
  eventsFunctionContext.getArgument("MaxX"),
  eventsFunctionContext.getArgument("MaxY"),
  eventsFunctionContext.getArgument("MaxZ")
);
`, { group: G_PROBE_CONTROL, withRuntime: true }),

  freeFn('SetDayNightBlend', 'Set probe day / night blend factor',
    'Set light probe day/night blend to _PARAM0_ (0.0 = day, 1.0 = night)',
    'Blend between the baked day and night probe volumes on the GPU. No rebake, no CPU cost.', 'Action',
    [num('Blend', 'Day to night interpolation factor (0.0 to 1.0)', '0.0')],
    `AL.setDayNightBlend(runtimeScene, eventsFunctionContext.getArgument("Blend"));\n`,
    { group: G_PROBE_CONTROL, withRuntime: true }),

  freeFn('SetProbeGlobalIntensity', 'Set global probe intensity',
    'Set global light probe intensity to _PARAM0_',
    'Master multiplier on the indirect ambient light every receiver picks up.', 'Action',
    [num('Intensity', 'Global intensity multiplier across all probe receivers', '1.0')],
    `AL.setProbeGlobalIntensity(runtimeScene, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_PROBE_CONTROL, withRuntime: true }),

  freeFn('ToggleProbeDebugVisualizer', 'Show / hide probe debug visualizer',
    'Set light probe debug visualizer enabled: _PARAM0_',
    'Draw one instanced sphere per probe, tinted by its sampled colour. One draw call.', 'Action',
    [bool('Enable', 'Show debug probe spheres')],
    `AL.toggleProbeDebugVisualizer(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_PROBE_CONTROL, withRuntime: true }),

  freeFn('StartProbeBake', 'Start probe baking',
    'Start baking scene light probes',
    'Begin the amortised raycast bake. This is the step that produces cave shadowing and ' +
    'coloured bounce; before it runs you have a sky/ground gradient and nothing more. ' +
    'Poll ProbeBakeProgress() for progress.', 'Action',
    [],
    `AL.startBake(runtimeScene);\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('CancelProbeBake', 'Cancel probe baking',
    'Cancel the in-progress light probe bake',
    'Abandon an in-progress bake. The volume keeps whatever data it had before the bake started.', 'Action',
    [],
    `AL.cancelBake(runtimeScene);\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('SetProbeBakeBudgetMs', 'Set probe bake per-frame budget',
    'Set light probe bake per-frame budget to _PARAM0_ ms',
    'Maximum milliseconds spent baking each frame. The bake is amortised across frames so the ' +
    'game stays responsive.', 'Action',
    [num('BudgetMs', 'Maximum milliseconds to spend baking per frame', '8.0')],
    `AL.setBakeBudgetMs(runtimeScene, eventsFunctionContext.getArgument("BudgetMs"));\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('ExportProbeData', 'Export probe data to file',
    'Export light probe data to binary file _PARAM0_',
    'Download the baked volume as a .lpg.bin file so shipping builds load the result instead ' +
    'of rebaking. Browser contexts only.', 'Action',
    [str('FileName', 'File name for the exported .lpg.bin', 'probes.lpg.bin')],
    `AL.exportProbeData(runtimeScene, eventsFunctionContext.getArgument("FileName"));\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('LoadProbeDataFromFile', 'Load probe data from file',
    'Load light probe data from file _PARAM0_',
    'Fetch a .lpg.bin and apply it to the active volume. The file\'s bounds win over the ' +
    'authoring cube from that point on.', 'Action',
    [str('FilePath', 'URL or path to the .lpg.bin file', 'probes.lpg.bin')],
    `AL.loadProbeDataFromFile(runtimeScene, eventsFunctionContext.getArgument("FilePath"));\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),
];

const probeFreeConditions = [
  freeFn('IsProbeVolumeLoaded', 'Probe volume is loaded',
    'Light probe volume is loaded and active',
    'True once a LightProbeVolume3D exists in the scene and its 3D texture is allocated.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isProbeVolumeLoaded(runtimeScene);\n`,
    { group: G_PROBE_CONTROL, withRuntime: true }),

  freeFn('IsProbeBakeInProgress', 'Probe bake is in progress',
    'Light probe bake is currently in progress',
    'True while the amortised bake is still consuming its per-frame budget.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isBakeInProgress(runtimeScene);\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('IsProbeBakeComplete', 'Probe bake is complete',
    'Light probe bake has completed',
    'True once a bake has finished and its results are in the volume texture.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isBakeComplete(runtimeScene);\n`,
    { group: G_PROBE_BAKE, withRuntime: true }),

  freeFn('IsDayNightModeEnabled', 'Probe day/night mode is enabled',
    'Light probe day/night mode is enabled',
    'True if the active volume allocates a second night texture to blend against.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isDayNightModeEnabled(runtimeScene);\n`,
    { group: G_PROBE_CONTROL, withRuntime: true }),
];

const probeFreeExpressions = [
  freeFn('DayNightBlend', 'Probe day/night blend factor',
    '', 'Current day-to-night interpolation factor (0.0 = day, 1.0 = night).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getDayNightBlend(runtimeScene);\n`,
    { group: G_PROBE_CONTROL, withRuntime: true, expressionType: 'number' }),

  freeFn('ActiveProbeCount', 'Active probe count',
    '', 'Probes in the active volume: ResolutionX * ResolutionY * ResolutionZ.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getActiveProbeCount(runtimeScene);\n`,
    { group: G_PROBE_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ProbeSpacingX', 'Probe spacing along X',
    '', 'Distance between adjacent probes along world X, in world units (pixels).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getProbeSpacingX(runtimeScene);\n`,
    { group: G_PROBE_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ProbeSpacingY', 'Probe spacing along Y',
    '', 'Distance between adjacent probes along world Y, in world units (pixels).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getProbeSpacingY(runtimeScene);\n`,
    { group: G_PROBE_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ProbeSpacingZ', 'Probe spacing along Z (height)',
    '', 'Distance between adjacent probes along world Z, the height axis, in world units (pixels).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getProbeSpacingZ(runtimeScene);\n`,
    { group: G_PROBE_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ProbeBakeProgress', 'Probe bake progress (0.0 to 1.0)',
    '', 'Fraction of probes baked so far. 1.0 once the bake has completed.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getBakeProgress(runtimeScene);\n`,
    { group: G_PROBE_BAKE, withRuntime: true, expressionType: 'number' }),

  freeFn('ProbeVRAMBytes', 'Probe texture VRAM bytes',
    '', 'Bytes of GPU memory held by the probe volume textures (RGBA16F, 8 bytes per probe, ' +
    'doubled in day/night mode).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getProbeVRAMBytes(runtimeScene);\n`,
    { group: G_PROBE_METRICS, withRuntime: true, expressionType: 'number' }),
];

/* ================================================= SDF Shadows Free Functions ======== */

const G_SDF_CONTROL = 'SDF Shadows — Scene Controls';
const G_SDF_BAKE = 'SDF Shadows — Baking';
const G_SDF_METRICS = 'SDF Shadows — Metrics';

const sdfFreeActions = [
  freeFn('SetSDFShadowsEnabled', 'Enable SDF soft shadows',
    'Enable Signed Distance Field raymarched soft shadows in scene: _PARAM0_',
    'Globally enable or disable Signed Distance Field soft shadows.', 'Action',
    [bool('Enable', 'Enable SDF shadows')],
    `AL.setSDFShadowsEnabled(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetMaxShadowedLights', 'Set maximum SDF shadowed lights',
    'Set maximum SDF shadowed dynamic lights to _PARAM0_',
    'Configure the maximum number of dynamic lights casting SDF shadows per fragment.', 'Action',
    [num('Count', 'Maximum shadowed lights (e.g. 4)', '4')],
    `AL.setMaxShadowedLights(runtimeScene, eventsFunctionContext.getArgument("Count"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetPointShadowDistance', 'Set point light shadow distance',
    'Set point light shadow trace distance to _PARAM0_',
    'Maximum distance in world units for tracing shadows from point and spot lights.', 'Action',
    [num('Distance', 'Trace distance in world units', '800.0')],
    `AL.setPointShadowDistance(runtimeScene, eventsFunctionContext.getArgument("Distance"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetSDFSunSoftness', 'Set directional sun shadow softness',
    'Set directional sun shadow angular diameter to _PARAM0_ degrees',
    'Angular diameter in degrees (larger values yield softer penumbras).', 'Action',
    [num('Degrees', 'Sun angular diameter in degrees (e.g. 1.8)', '1.8')],
    `AL.setSDFSunSoftness(runtimeScene, eventsFunctionContext.getArgument("Degrees"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetSDFHitEps', 'Set SDF raymarch surface hit threshold',
    'Set SDF raymarch surface hit threshold to _PARAM0_',
    'Relative fraction of voxel size below which a ray is considered hitting the surface.', 'Action',
    [num('Epsilon', 'Surface hit threshold fraction (e.g. 0.05)', '0.05')],
    `AL.setSDFHitEps(runtimeScene, eventsFunctionContext.getArgument("Epsilon"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetSDFNormalBias', 'Set SDF shadow normal bias',
    'Set SDF shadow normal offset bias to _PARAM0_',
    'Multiplier on voxel size along the surface normal to avoid self-shadow acne.', 'Action',
    [num('Bias', 'Normal bias multiplier (e.g. 1.0)', '1.0')],
    `AL.setSDFNormalBias(runtimeScene, eventsFunctionContext.getArgument("Bias"));\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('SetSDFVolumeBounds', 'Set SDF volume bounds',
    'Set SDF volume bounds to Min: (_PARAM0_, _PARAM1_, _PARAM2_), Max: (_PARAM3_, _PARAM4_, _PARAM5_)',
    'Set the SDF volume bounds explicitly in GDevelop world coordinates. From this point on the authoring cube no longer controls the volume.', 'Action',
    [
      num('MinX', 'Minimum X in GDevelop coordinates', '0'),
      num('MinY', 'Minimum Y in GDevelop coordinates', '0'),
      num('MinZ', 'Minimum Z in GDevelop coordinates', '0'),
      num('MaxX', 'Maximum X in GDevelop coordinates', '2000'),
      num('MaxY', 'Maximum Y in GDevelop coordinates', '2000'),
      num('MaxZ', 'Maximum Z in GDevelop coordinates', '500'),
    ],
    `AL.setSDFVolumeBounds(
  runtimeScene,
  eventsFunctionContext.getArgument("MinX"),
  eventsFunctionContext.getArgument("MinY"),
  eventsFunctionContext.getArgument("MinZ"),
  eventsFunctionContext.getArgument("MaxX"),
  eventsFunctionContext.getArgument("MaxY"),
  eventsFunctionContext.getArgument("MaxZ")
);
`, { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('StartSDFBake', 'Start SDF volume bake',
    'Start baking scene Signed Distance Field volume',
    'Extracts triangles from static scene geometry and bakes exact Euclidean distance transform into a 3D texture.', 'Action',
    [],
    `AL.startSDFBake(runtimeScene);\n`,
    { group: G_SDF_BAKE, withRuntime: true }),

  freeFn('CancelSDFBake', 'Cancel SDF volume bake',
    'Cancel the in-progress SDF bake',
    'Abandon an in-progress SDF bake.', 'Action',
    [],
    `AL.cancelSDFBake(runtimeScene);\n`,
    { group: G_SDF_BAKE, withRuntime: true }),

  freeFn('SetSDFBakeBudgetMs', 'Set SDF bake per-frame budget',
    'Set SDF bake per-frame budget to _PARAM0_ ms',
    'Maximum milliseconds spent baking each frame so gameplay stays smooth.', 'Action',
    [num('BudgetMs', 'Maximum milliseconds to spend baking per frame', '8.0')],
    `AL.setSDFBakeBudgetMs(runtimeScene, eventsFunctionContext.getArgument("BudgetMs"));\n`,
    { group: G_SDF_BAKE, withRuntime: true }),

  freeFn('ExportSDFData', 'Export SDF data to file',
    'Export SDF data to binary file _PARAM0_',
    'Download the baked SDF volume as a .sdf.bin file for instant loading in production. Browser contexts only.', 'Action',
    [str('FileName', 'File name for exported .sdf.bin', 'scene.sdf.bin')],
    `AL.exportSDFData(runtimeScene, eventsFunctionContext.getArgument("FileName"));\n`,
    { group: G_SDF_BAKE, withRuntime: true }),

  freeFn('LoadSDFDataFromFile', 'Load SDF data from file',
    'Load SDF data from file _PARAM0_',
    'Fetch a .sdf.bin file and apply it to the active volume. The file bounds win over the authoring cube from that point on.', 'Action',
    [str('FilePath', 'URL or path to the .sdf.bin file', 'scene.sdf.bin')],
    `AL.loadSDFDataFromFile(runtimeScene, eventsFunctionContext.getArgument("FilePath"));\n`,
    { group: G_SDF_BAKE, withRuntime: true }),
];

const sdfFreeConditions = [
  freeFn('IsSDFShadowsEnabled', 'SDF soft shadows are enabled',
    'SDF soft shadows are enabled in scene',
    'Check if Signed Distance Field soft shadows are enabled.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isSDFShadowsEnabled(runtimeScene);\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('IsSDFVolumeLoaded', 'SDF volume is loaded',
    'SDF volume is loaded and active',
    'True once an SDFVolume3D exists in the scene and its 3D texture is allocated.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isSDFVolumeLoaded(runtimeScene);\n`,
    { group: G_SDF_CONTROL, withRuntime: true }),

  freeFn('IsSDFBakeInProgress', 'SDF bake is in progress',
    'SDF bake is currently in progress',
    'True while the amortised SDF bake is still running.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isSDFBakeInProgress(runtimeScene);\n`,
    { group: G_SDF_BAKE, withRuntime: true }),

  freeFn('IsSDFBakeComplete', 'SDF bake is complete',
    'SDF bake has completed',
    'True once an SDF bake has finished and the results are uploaded to the 3D texture.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = AL.isSDFBakeComplete(runtimeScene);\n`,
    { group: G_SDF_BAKE, withRuntime: true }),
];

const sdfFreeExpressions = [
  freeFn('SDFBakeProgress', 'SDF bake progress (0.0 to 1.0)',
    '', 'Fraction of SDF bake completed (0.0 to 1.0).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getSDFBakeProgress(runtimeScene);\n`,
    { group: G_SDF_BAKE, withRuntime: true, expressionType: 'number' }),

  freeFn('SDFVRAMBytes', 'SDF texture VRAM bytes',
    '', 'Bytes of GPU memory held by the SDF 3D texture (R16F, 2 bytes per voxel).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getSDFVRAMBytes(runtimeScene);\n`,
    { group: G_SDF_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('SDFVoxelCount', 'Total SDF voxel count',
    '', 'Total voxels in the active SDF volume: ResolutionX * ResolutionY * ResolutionZ.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getSDFVoxelCount(runtimeScene);\n`,
    { group: G_SDF_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('SDFVoxelSize', 'SDF voxel world size',
    '', 'Physical size of an SDF voxel in world units.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getSDFVoxelSize(runtimeScene);\n`,
    { group: G_SDF_METRICS, withRuntime: true, expressionType: 'number' }),

  freeFn('MaxShadowedLights', 'Max SDF shadowed lights count',
    '', 'Current maximum number of dynamic lights casting SDF shadows.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getMaxShadowedLights(runtimeScene);\n`,
    { group: G_SDF_CONTROL, withRuntime: true, expressionType: 'number' }),

  freeFn('PointShadowDistance', 'Point light shadow distance',
    '', 'Current point light shadow trace distance in world units.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getPointShadowDistance(runtimeScene);\n`,
    { group: G_SDF_CONTROL, withRuntime: true, expressionType: 'number' }),

  freeFn('SDFSunSoftness', 'Directional sun shadow softness (deg)',
    '', 'Current directional sun angular diameter in degrees.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AL.getSDFSunSoftness(runtimeScene);\n`,
    { group: G_SDF_CONTROL, withRuntime: true, expressionType: 'number' }),
];

/* ================================================= Extension Lifecycle Installer ==== */

// GDevelop recognises `onSceneLoaded` as an extension lifecycle function and calls it on
// every scene load, ahead of the scene's own events. Installing the runtime singleton here
// means exactly one copy of it has to live in the generated JSON for the free functions,
// rather than one per block. The runtime guards itself with
// `if (gdjs.__advancedLighting3D) return;`, so a second install is a no-op.
const installerFunction = {
  name: 'onSceneLoaded',
  fullName: 'onSceneLoaded',
  description: '',
  functionType: 'Action',
  private: true,
  parameters: [],
  events: evFree('', { withRuntime: true }),
};

/* ========================================================= Extension Manifest */

const extension = {
  name: 'AdvancedLighting3D',
  fullName: 'Advanced Lighting 3D',
  version: '2.0.0',
  description: 'High-fidelity clustered forward dynamic multi-lighting, baked indirect light-probe GI, AND Signed Distance Field (SDF) raymarched soft shadows for GDevelop 5 (Three.js WebGL2). Scales scenes to 500+ active dynamic lights (Point, Spot, Area Capsule) with flat 60 FPS performance, zero shader recompilation stutter, Karis representative point area specular reflections, blackbody Kelvin colour temperatures, IES photometric distributions, Frostbite windowed attenuation, and procedural flicker waveforms. A LightProbeVolume3D bakes the scene ambient into a 3D texture that ReceiveLightProbes objects sample per fragment. An SDFVolume3D bakes the static scene into a distance volume for Quilez-penumbra contact and soft shadows. All features share one shader injection and one program cache key.',
  shortDescription: 'Clustered forward multi-lighting (500+ lights, Karis area specular), baked light-probe indirect GI, and static SDF soft shadows.',
  category: '3D',
  author: 'Twillion',
  previewIconUrl: iconUrl,
  iconUrl: iconUrl,
  helpPath: '',
  tags: ['3d', 'light', 'lighting', 'clustered', 'forward', 'pbr', 'specular', 'sdf', 'shadows', 'soft shadows', 'pointlight', 'spotlight', 'area light', 'probe', 'light probe', 'gi', 'global illumination', 'ambient', 'indirect', 'bake'],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [
    installerFunction,
    ...freeActions,
    ...freeConditions,
    ...freeExpressions,
    ...probeFreeActions,
    ...probeFreeConditions,
    ...probeFreeExpressions,
    ...sdfFreeActions,
    ...sdfFreeConditions,
    ...sdfFreeExpressions,
  ],
  eventsBasedBehaviors: [
    clusteredLightBehavior,
    volumeBehavior,
    receiverBehavior,
    sdfVolumeBehavior,
  ],
};

// Every behavior in this extension, for the pre-build checks below.
const ALL_BEHAVIORS = extension.eventsBasedBehaviors;

/* ========================================================= Pre-build Safety Checks */

console.log('Running pre-build safety assertions for AdvancedLighting3D...');

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
for (const b of ALL_BEHAVIORS) walkEvents(b.eventsFunctions, b.name);
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
for (const b of ALL_BEHAVIORS) checkNamesAndSentences(b.eventsFunctions, b.name);
checkNamesAndSentences(extension.eventsFunctions, 'freeFunctions');

// 2b. Behavior names must be unique too — two behaviors sharing a name silently
// shadow each other in the editor.
const behaviorNames = new Set();
for (const b of ALL_BEHAVIORS) {
  if (behaviorNames.has(b.name)) {
    console.error(`
Duplicate behavior name ${b.name}
`);
    process.exit(1);
  }
  behaviorNames.add(b.name);
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
  ...ALL_BEHAVIORS.flatMap((b) => b.eventsFunctions),
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
for (const b of ALL_BEHAVIORS) checkObjectParams(b.eventsFunctions, b.name, true);
checkObjectParams(extension.eventsFunctions, 'freeFunctions', false);

// Write output JSON
const outPath = path.join(here, 'AdvancedLighting3D.json');
fs.writeFileSync(outPath, json, 'utf8');

const counts = allFns.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\nSuccessfully built ${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
