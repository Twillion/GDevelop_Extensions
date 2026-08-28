/**
 * build-extension.mjs
 * Compiles ClusteredLightManager3D.json from the runtime engine + behavior & function declarations.
 *
 * Run: node ClusteredLightManager3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'ClusteredLightManager3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__clusteredLightManager3D';

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

const BEHAVIOR_PREAMBLE = `const __clmObjects = eventsFunctionContext.getObjects("Object");
const object = __clmObjects.length ? __clmObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const CLM = ${NS};
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
  events: evFree((opts.withRuntime ? runtime + '\n' : '') + `if (!${NS}) return;\nconst CLM = ${NS};\n` + code, opts),
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
  flickerMode: behavior._getFlickerMode ? behavior._getFlickerMode() : 'None',
  flickerSpeed: behavior._getFlickerSpeed ? behavior._getFlickerSpeed() : 8.0,
  flickerIntensityVariation: behavior._getFlickerIntensityVariation ? behavior._getFlickerIntensityVariation() : 0.25
}`;

const lightLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `CLM.registerLight(runtimeScene, object, behavior, ${LIGHT_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `CLM.stepLight(runtimeScene, object, behavior);\n`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `CLM.destroyLight(runtimeScene, behavior);\n`),
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
CLM.updateLight(runtimeScene, object, behavior, { intensity: val });
`, { group: G_LIGHT_PROP }),

  fn('SetRadius', 'Set light radius',
    'Set light attenuation radius on _PARAM0_ to _PARAM2_',
    'Change maximum attenuation radius in meters (smoothly reaches 0 at boundary).', 'Action',
    [num('Radius', 'Maximum radius in meters', '12.0')],
    `const val = eventsFunctionContext.getArgument("Radius");
if (behavior._setRadius) behavior._setRadius(val);
CLM.updateLight(runtimeScene, object, behavior, { radius: val });
`, { group: G_LIGHT_PROP }),

  fn('SetLightType', 'Set light emission type',
    'Set light emission type on _PARAM0_ to _PARAM2_',
    'Set the geometry type of the light: Point, Spot, or AreaCapsule.', 'Action',
    [choice('LightType', 'Emission geometry', ['Point', 'Spot', 'AreaCapsule'])],
    `const val = eventsFunctionContext.getArgument("LightType");
if (behavior._setLightType) behavior._setLightType(val);
CLM.updateLight(runtimeScene, object, behavior, { lightType: val });
`, { group: G_LIGHT_PROP }),

  fn('SetColorTemperature', 'Set color temperature (Kelvin)',
    'Set light color temperature in Kelvin on _PARAM0_ to _PARAM2_',
    'Set blackbody temperature in Kelvin (1000K candle flame to 12000K blue sky).', 'Action',
    [num('Kelvin', 'Color temperature in Kelvin (e.g. 2200 for torch, 6500 for daylight)', '2200')],
    `const val = eventsFunctionContext.getArgument("Kelvin");
if (behavior._setColorTemperature) behavior._setColorTemperature(val);
CLM.updateLight(runtimeScene, object, behavior, { colorTemperature: val, colorMode: 'Kelvin' });
`, { group: G_LIGHT_COLOR }),

  fn('SetLightColor', 'Set RGB light color',
    'Set light RGB color on _PARAM0_ to _PARAM2_',
    'Set custom light RGB color string.', 'Action',
    [col('Color', 'Light RGB color', '255;180;100')],
    `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setLightColor) behavior._setLightColor(val);
CLM.updateLight(runtimeScene, object, behavior, { lightColor: val, colorMode: 'RGB' });
`, { group: G_LIGHT_COLOR }),

  fn('SetColorMode', 'Set color mode',
    'Set color mode on _PARAM0_ to _PARAM2_',
    'Switch between Kelvin physical blackbody temperature and direct RGB color.', 'Action',
    [choice('Mode', 'Color definition method', ['Kelvin', 'RGB'])],
    `const val = eventsFunctionContext.getArgument("Mode");
if (behavior._setColorMode) behavior._setColorMode(val);
CLM.updateLight(runtimeScene, object, behavior, { colorMode: val });
`, { group: G_LIGHT_COLOR }),

  fn('SetEmissiveBoost', 'Set emissive boost',
    'Set emissive color boost on _PARAM0_ to _PARAM2_',
    'Over-bright intensity multiplier for glow, post-processing bloom, and neon reflections.', 'Action',
    [num('Boost', 'Emissive boost multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("Boost");
if (behavior._setEmissiveBoost) behavior._setEmissiveBoost(val);
CLM.updateLight(runtimeScene, object, behavior, { emissiveBoost: val });
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
CLM.updateLight(runtimeScene, object, behavior, { spotInnerAngle: inner, spotOuterAngle: outer });
`, { group: G_LIGHT_SPOT }),

  fn('SetCapsuleLength', 'Set area capsule length',
    'Set area capsule length on _PARAM0_ to _PARAM2_',
    'Set neon tube / fluorescent bar length in meters.', 'Action',
    [num('Length', 'Capsule tube length in meters', '2.0')],
    `const val = eventsFunctionContext.getArgument("Length");
if (behavior._setCapsuleLength) behavior._setCapsuleLength(val);
CLM.updateLight(runtimeScene, object, behavior, { capsuleLength: val });
`, { group: G_LIGHT_SPOT }),

  fn('SetIESProfile', 'Set IES photometric profile',
    'Set IES photometric profile on _PARAM0_ to _PARAM2_',
    'Set architectural photometric light distribution curve.', 'Action',
    [choice('Profile', 'IES distribution profile', ['None', 'WallSconce', 'StreetLamp', 'Downlight', 'Searchlight'])],
    `const val = eventsFunctionContext.getArgument("Profile");
if (behavior._setIESProfile) behavior._setIESProfile(val);
CLM.updateLight(runtimeScene, object, behavior, { iesProfile: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetCastContactShadows', 'Enable contact micro-shadows',
    'Enable contact micro-shadows on _PARAM0_: _PARAM2_',
    'Toggle screen-space contact micro-shadow raymarching for this light.', 'Action',
    [bool('Enable', 'Enable contact micro-shadows')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setCastContactShadows) behavior._setCastContactShadows(val);
CLM.updateLight(runtimeScene, object, behavior, { castContactShadows: val });
`, { group: G_LIGHT_SHADOW }),

  fn('SetShadowBias', 'Set shadow bias',
    'Set shadow bias on _PARAM0_ to _PARAM2_',
    'Set normal offset bias to prevent self-shadow acne.', 'Action',
    [num('Bias', 'Shadow bias offset', '0.02')],
    `const val = eventsFunctionContext.getArgument("Bias");
if (behavior._setShadowBias) behavior._setShadowBias(val);
CLM.updateLight(runtimeScene, object, behavior, { shadowBias: val });
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
CLM.updateLight(runtimeScene, object, behavior, {
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
const light = behavior.__clmLight;
if (light) CLM.triggerMuzzleFlash(light, dur);
`, { group: G_LIGHT_FX }),
];

const lightConditions = [
  fn('IsActive', 'Is clustered light active',
    '_PARAM0_ clustered light is active',
    'Check if the clustered light is actively emitting in the scene.', 'Condition',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = !!(light && light.active && light.currentIntensity > 0.0001);
`, { group: G_LIGHT_PROP }),

  fn('IsInFrustum', 'Is light within camera view frustum',
    '_PARAM0_ light is within camera view frustum',
    'Check if the light bounding sphere intersects the active camera frustum.', 'Condition',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = !!(light && light.isInFrustum);
`, { group: G_LIGHT_PROP }),

  fn('IsFlickerActive', 'Is procedural flicker active',
    '_PARAM0_ light procedural flicker is active',
    'Check if procedural flicker or strobe modulation is active.', 'Condition',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = !!(light && light.flickerMode !== 'None' && light.flickerIntensityVariation > 0);
`, { group: G_LIGHT_FX }),
];

const lightExpressions = [
  fn('Intensity', 'Current intensity',
    '', 'Return the active radiant intensity (including flicker/flash offsets).', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.currentIntensity : 0.0;
`, { group: G_LIGHT_PROP, expressionType: 'number' }),

  fn('Radius', 'Attenuation radius',
    '', 'Return the maximum attenuation radius in meters.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.radius : 0.0;
`, { group: G_LIGHT_PROP, expressionType: 'number' }),

  fn('ColorTemperature', 'Color temperature in Kelvin',
    '', 'Return the blackbody color temperature in Kelvin.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.colorTemperature : 2200;
`, { group: G_LIGHT_COLOR, expressionType: 'number' }),

  fn('EmissiveBoost', 'Emissive boost multiplier',
    '', 'Return the emissive color multiplier.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.emissiveBoost : 1.0;
`, { group: G_LIGHT_COLOR, expressionType: 'number' }),

  fn('CapsuleLength', 'Area capsule length',
    '', 'Return the neon tube/bar length in meters.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.capsuleLength : 0.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('SpotInnerAngle', 'Spotlight inner angle',
    '', 'Return the inner cone focus angle in degrees.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.spotInnerAngle : 25.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('SpotOuterAngle', 'Spotlight outer angle',
    '', 'Return the outer cone soft penumbra angle in degrees.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.spotOuterAngle : 45.0;
`, { group: G_LIGHT_SPOT, expressionType: 'number' }),

  fn('ShadowBias', 'Shadow bias offset',
    '', 'Return the normal offset bias.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.shadowBias : 0.02;
`, { group: G_LIGHT_SHADOW, expressionType: 'number' }),

  fn('FlickerSpeed', 'Flicker frequency in Hz',
    '', 'Return the animation oscillation speed.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.flickerSpeed : 8.0;
`, { group: G_LIGHT_FX, expressionType: 'number' }),

  fn('FlickerIntensityVariation', 'Flicker variation amplitude',
    '', 'Return the random flicker amplitude.', 'Expression',
    [],
    `const light = behavior.__clmLight;
eventsFunctionContext.returnValue = light ? light.flickerIntensityVariation : 0.25;
`, { group: G_LIGHT_FX, expressionType: 'number' }),

  fn('ViewDistance', 'Distance to active camera',
    '', 'Return the distance from the active camera to the light in meters.', 'Expression',
    [],
    `const light = behavior.__clmLight;
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
    prop('Radius', 'Number', 'Attenuation Radius', 'Maximum attenuation distance in meters.', '12.0'),
    prop('CapsuleLength', 'Number', 'Capsule Length', 'Length of neon tube / area bar in meters (AreaCapsule only).', '2.0'),
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
const G_SCENE_ATMOSPHERE = 'Clustered Lighting — Atmospheric Fog';
const G_SCENE_DIAGNOSTICS = 'Clustered Lighting — Diagnostics';

const freeActions = [
  freeFn('SetGlobalIntensity', 'Set global clustered light intensity',
    'Set global clustered light intensity to _PARAM0_',
    'Master brightness multiplier for all dynamic clustered lights in the scene.', 'Action',
    [num('Intensity', 'Master brightness multiplier', '1.0')],
    `CLM.setGlobalIntensity(runtimeScene, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('SetMaxLights', 'Set maximum active dynamic lights',
    'Set maximum active streamed dynamic lights to _PARAM0_',
    'Configure the maximum dynamic lights streamed to GPU simultaneously (64 - 512).', 'Action',
    [num('MaxLights', 'Maximum active lights (64 - 512)', '256')],
    `CLM.setMaxLights(runtimeScene, eventsFunctionContext.getArgument("MaxLights"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('SetVolumetricFogEnabled', 'Enable volumetric atmospheric fog',
    'Enable clustered volumetric atmospheric fog in scene: _PARAM0_',
    'Toggle clustered atmospheric light scattering and god rays.', 'Action',
    [bool('Enable', 'Enable volumetric fog')],
    `CLM.setVolumetricFogEnabled(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SCENE_ATMOSPHERE, withRuntime: true }),

  freeFn('SetVolumetricFogDensity', 'Set volumetric atmospheric fog density',
    'Set volumetric atmospheric fog density to _PARAM0_',
    'Configure scene-wide clustered atmospheric light scattering and god ray density.', 'Action',
    [num('Density', 'Atmospheric medium density (e.g. 0.02)', '0.02')],
    `CLM.setVolumetricFogDensity(runtimeScene, eventsFunctionContext.getArgument("Density"));\n`,
    { group: G_SCENE_ATMOSPHERE, withRuntime: true }),

  freeFn('SetVolumetricAnisotropy', 'Set volumetric forward scattering anisotropy',
    'Set volumetric fog forward scattering anisotropy to _PARAM0_',
    'Adjust god ray directional bias (g factor between 0.0 and 0.9).', 'Action',
    [num('Anisotropy', 'Henyey-Greenstein forward scattering factor (0.0 to 0.9)', '0.4')],
    `CLM.setVolumetricAnisotropy(runtimeScene, eventsFunctionContext.getArgument("Anisotropy"));\n`,
    { group: G_SCENE_ATMOSPHERE, withRuntime: true }),

  freeFn('EnableContactShadows', 'Enable clustered contact micro-shadows',
    'Enable clustered contact micro-shadows: _PARAM0_',
    'Toggle screen-space contact micro-shadowing (SSCS) globally across all clustered lights.', 'Action',
    [bool('Enable', 'Enable screen-space contact micro-shadows')],
    `CLM.enableContactShadows(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('ToggleDebugVisualizer', 'Show / hide debug visualizer',
    'Set clustered lighting debug visualizer enabled: _PARAM0_',
    'Toggle debug display of light sources in preview and runtime.', 'Action',
    [bool('Enable', 'Show debug visualizer')],
    `CLM.toggleDebugVisualizer(runtimeScene, !!eventsFunctionContext.getArgument("Enable"));\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true }),
];

const freeConditions = [
  freeFn('IsSupported', 'Clustered lighting is supported (WebGL2)',
    'Clustered lighting is supported on current context (WebGL2)',
    'Check if WebGL2 texture streaming is available on the current device.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = CLM.isWebGL2Available(runtimeScene);\n`,
    { group: G_SCENE_CONTROL, withRuntime: true }),

  freeFn('IsVolumetricFogEnabled', 'Volumetric fog is enabled in scene',
    'Volumetric fog is enabled in scene',
    'Check if atmospheric clustered light scattering is active.', 'Condition',
    [],
    `const s = CLM.stateOf(runtimeScene);
eventsFunctionContext.returnValue = !!(s && s.enableVolumetricFog);
`, { group: G_SCENE_ATMOSPHERE, withRuntime: true }),
];

const freeExpressions = [
  freeFn('ActiveLightCount', 'Active rendered light count',
    '', 'Total number of clustered lights rendered in the active frame.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = CLM.getActiveLightCount(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('MaxLightsInSingleCluster', 'Max lights in single cluster',
    '', 'Peak light count inside the densest spatial cluster (for performance monitoring).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = CLM.getMaxLightsInSingleCluster(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('CPUBroadphaseTimeMs', 'CPU broadphase execution time (ms)',
    '', 'Execution time in milliseconds for CPU light binning in the current frame.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = CLM.getCPUBroadphaseTimeMs(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('TotalClusterCount', 'Total spatial cluster count',
    '', 'Total number of spatial cluster voxels (3,456).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = CLM.getTotalClusterCount(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),

  freeFn('ClusterVRAMBytes', 'GPU texture VRAM memory (bytes)',
    '', 'Total VRAM allocated for clustered lighting buffers in bytes (< 60 KB).', 'Expression',
    [],
    `eventsFunctionContext.returnValue = CLM.getClusterVRAMBytes(runtimeScene);\n`,
    { group: G_SCENE_DIAGNOSTICS, withRuntime: true, expressionType: 'number' }),
];

/* ========================================================= Extension Manifest */

const extension = {
  name: 'ClusteredLightManager3D',
  fullName: 'Clustered Light Manager 3D',
  version: '1.0.0',
  description: 'High-Fidelity Clustered Forward Dynamic Multi-Lighting system for GDevelop 5 (Three.js WebGL2). Scales scenes to 500+ active dynamic lights (Point, Spot, Area Capsule) with flat 60 FPS performance, zero shader recompilation stutter, Karis representative point area specular reflections, blackbody Kelvin color temperatures, IES photometric distributions, Frostbite windowed attenuation, procedural flicker waveforms, and volumetric god rays.',
  shortDescription: 'Clustered Forward Multi-Lighting (500+ lights, Karis area specular, Kelvin blackbody, volumetric fog).',
  category: '3D',
  author: 'Twillion',
  previewIconUrl: iconUrl,
  iconUrl: iconUrl,
  helpPath: '',
  tags: ['3d', 'light', 'lighting', 'clustered', 'forward', 'pbr', 'specular', 'volumetric', 'fog', 'pointlight', 'spotlight', 'area light'],
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
    clusteredLightBehavior,
  ],
};

/* ========================================================= Pre-build Safety Checks */

console.log('Running pre-build safety assertions for ClusteredLightManager3D...');

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
walkEvents(clusteredLightBehavior.eventsFunctions, clusteredLightBehavior.name);
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
checkNamesAndSentences(clusteredLightBehavior.eventsFunctions, clusteredLightBehavior.name);
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
  ...clusteredLightBehavior.eventsFunctions,
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
checkObjectParams(clusteredLightBehavior.eventsFunctions, clusteredLightBehavior.name, true);
checkObjectParams(extension.eventsFunctions, 'freeFunctions', false);

// Write output JSON
const outPath = path.join(here, 'ClusteredLightManager3D.json');
fs.writeFileSync(outPath, json, 'utf8');

const counts = allFns.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\nSuccessfully built ${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
