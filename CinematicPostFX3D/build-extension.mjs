/**
 * build-extension.mjs
 * Compiles CinematicPostFX3D.json from the runtime engine + behavior & function declarations.
 *
 * Run: node CinematicPostFX3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'CinematicPostFX3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__cinematicPostFX3D';

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

const BEHAVIOR_PREAMBLE = `const __fxObjects = eventsFunctionContext.getObjects("Object");
const object = __fxObjects.length ? __fxObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const FX = ${NS};
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
  events: evFree((opts.withRuntime ? runtime + '\n' : '') + `if (!${NS}) return;\nconst FX = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* ========================================================= CinematicPostFX3D Behavior */

const fxLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FX.registerBehavior(runtimeScene, object, behavior);\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
try {
  FX.syncBehaviorProperties(runtimeScene, object, behavior);
  FX.stepBehavior(runtimeScene, object, behavior);
} catch (e) {}
`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `FX.destroyBehavior(runtimeScene, behavior);\n`),
  },
];

const G_MASTER = 'Master & Presets';
const G_GTAO = 'Ambient Occlusion (GTAO)';
const G_SSR = 'Screen-Space Reflections (SSR)';
const G_BLOOM = 'Bloom & Anamorphic Flares';
const G_DOF = 'Depth of Field (DOF)';
const G_OPTICS = 'Motion Blur & Optical FX';

const fxActions = [
  // Master & Presets
  fn('ApplyPreset', 'Apply cinematic preset',
    'Apply cinematic preset _PARAM2_ on _PARAM0_',
    'Apply 1-click genre post-processing preset (CyberpunkNeon, CinematicMovie, HorrorGrim, CleanRealistic, PerformanceLite).', 'Action',
    [choice('Preset', 'Genre preset', ['CyberpunkNeon', 'CinematicMovie', 'HorrorGrim', 'CleanRealistic', 'PerformanceLite'])],
    `const val = eventsFunctionContext.getArgument("Preset");
FX.applyPreset(runtimeScene, behavior, val);
`, { group: G_MASTER }),

  fn('SetMasterIntensity', 'Set master post-processing intensity',
    'Set master post-processing intensity on _PARAM0_ to _PARAM2_',
    'Crossfade between the untouched scene and the fully graded result. 0.0 is a true bypass.', 'Action',
    [num('Intensity', 'Master intensity scale', '1.0')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setMasterIntensity) behavior._setMasterIntensity(val);
FX.updateSettings(runtimeScene, behavior, { masterIntensity: val });
`, { group: G_MASTER }),

  fn('SetEffectQuality', 'Set effect buffer quality',
    'Set effect buffer quality on _PARAM0_ to _PARAM2_',
    'Resolution of the ambient occlusion, reflection and reflectivity-mask buffers: ' +
    'Full, Half or Quarter. Changing this reallocates those buffers.', 'Action',
    [choice('Quality', 'Buffer resolution', ['Full', 'Half', 'Quarter'])],
    `const val = eventsFunctionContext.getArgument("Quality");
if (behavior._setEffectQuality) behavior._setEffectQuality(val);
FX.updateSettings(runtimeScene, behavior, { effectQuality: val });
`, { group: G_MASTER }),

  fn('SetToneMapping', 'Set tone mapping mode',
    'Set tone mapping mode on _PARAM0_ to _PARAM2_',
    'Set filmic color grading tone mapping curve: ACESFilmic, Reinhard, Cineon, or Linear.', 'Action',
    [choice('Mode', 'Tone mapping curve', ['ACESFilmic', 'Reinhard', 'Cineon', 'Linear'])],
    `const val = eventsFunctionContext.getArgument("Mode");
if (behavior._setToneMapping) behavior._setToneMapping(val);
FX.updateSettings(runtimeScene, behavior, { toneMapping: val });
`, { group: G_MASTER }),

  // GTAO
  fn('SetGTAOEnabled', 'Enable Ground Truth Ambient Occlusion (GTAO)',
    'Enable Ground Truth Ambient Occlusion (GTAO) on _PARAM0_: _PARAM2_',
    'Toggle high-precision horizon-based ambient occlusion in crevices and corners.', 'Action',
    [bool('Enable', 'Enable GTAO')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableGTAO) behavior._setEnableGTAO(val);
FX.updateSettings(runtimeScene, behavior, { enableGTAO: val });
`, { group: G_GTAO }),

  fn('SetGTAORadius', 'Set GTAO radius',
    'Set GTAO radius on _PARAM0_ to _PARAM2_ world units',
    'Occlusion search radius in GDevelop world units. Scene scale, not metres: a default 3D ' +
    'layer puts the camera around 724 units back, so useful values are in the tens.', 'Action',
    [num('Radius', 'Search radius in world units', '50')],
    `const val = eventsFunctionContext.getArgument("Radius");
if (behavior._setGTAORadius) behavior._setGTAORadius(val);
FX.updateSettings(runtimeScene, behavior, { gtaoRadius: val });
`, { group: G_GTAO }),

  fn('SetGTAOIntensity', 'Set GTAO intensity',
    'Set GTAO intensity on _PARAM0_ to _PARAM2_',
    'Adjust darkness and contrast of contact ambient occlusion (0.0 to 3.0).', 'Action',
    [num('Intensity', 'Occlusion darkness multiplier', '1.0')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setGTAOIntensity) behavior._setGTAOIntensity(val);
FX.updateSettings(runtimeScene, behavior, { gtaoIntensity: val });
`, { group: G_GTAO }),

  fn('SetGTAOMultiBounce', 'Enable GTAO multi-bounce approximation',
    'Enable GTAO multi-bounce approximation on _PARAM0_: _PARAM2_',
    'Approximates colored multi-bounce to prevent dark crevices from losing albedo.', 'Action',
    [bool('Enable', 'Enable multi-bounce')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setGTAOMultiBounce) behavior._setGTAOMultiBounce(val);
FX.updateSettings(runtimeScene, behavior, { gtaoMultiBounce: val });
`, { group: G_GTAO }),

  // SSR
  fn('SetSSREnabled', 'Enable Screen-Space Reflections (SSR)',
    'Enable Screen-Space Reflections (SSR) on _PARAM0_: _PARAM2_',
    'Toggle real-time raymarched reflections of dynamic objects on shiny/wet surfaces.', 'Action',
    [bool('Enable', 'Enable SSR')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableSSR) behavior._setEnableSSR(val);
FX.updateSettings(runtimeScene, behavior, { enableSSR: val });
`, { group: G_SSR }),

  fn('SetSSRIntensity', 'Set SSR reflection intensity',
    'Set SSR reflection intensity on _PARAM0_ to _PARAM2_',
    'Adjust reflection brightness and blend opacity (0.0 to 1.0).', 'Action',
    [num('Intensity', 'Reflection opacity', '0.75')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setSSRIntensity) behavior._setSSRIntensity(val);
FX.updateSettings(runtimeScene, behavior, { ssrIntensity: val });
`, { group: G_SSR }),

  fn('SetSSRMaxDistance', 'Set SSR maximum ray distance',
    'Set SSR maximum ray distance on _PARAM0_ to _PARAM2_ world units',
    'How far a reflection ray may travel, in GDevelop world units. Longer rays catch more ' +
    'distant reflections at proportionally more cost.', 'Action',
    [num('Distance', 'Maximum ray distance in world units', '400')],
    `const val = eventsFunctionContext.getArgument("Distance");
if (behavior._setSSRMaxDistance) behavior._setSSRMaxDistance(val);
FX.updateSettings(runtimeScene, behavior, { ssrMaxDistance: val });
`, { group: G_SSR }),

  fn('SetSSRFresnel', 'Set SSR Fresnel falloff',
    'Set SSR Fresnel falloff on _PARAM0_ to _PARAM2_',
    'How strongly reflections favour grazing angles. 0 = uniform mirror everywhere, ' +
    '1 = pure Schlick Fresnel so only glancing surfaces reflect.', 'Action',
    [num('Fresnel', 'Fresnel falloff amount (0 to 1)', '0.6')],
    `const val = eventsFunctionContext.getArgument("Fresnel");
if (behavior._setSSRFresnel) behavior._setSSRFresnel(val);
FX.updateSettings(runtimeScene, behavior, { ssrFresnel: val });
`, { group: G_SSR }),

  fn('SetSSRSurfaces', 'Set which surfaces reflect (SSR)',
    'Set which surfaces reflect on _PARAM0_ to _PARAM2_',
    'MaterialBased: only smooth or metallic materials reflect, driven by a per-pixel ' +
    'reflectivity mask. Everything: mirror the scene onto every surface.', 'Action',
    [choice('Mode', 'Reflective surface mode', ['MaterialBased', 'Everything'])],
    `const val = eventsFunctionContext.getArgument("Mode");
if (behavior._setSSRSurfaces) behavior._setSSRSurfaces(val);
FX.updateSettings(runtimeScene, behavior, { ssrSurfaces: val });
`, { group: G_SSR }),

  fn('SetSSRRaySteps', 'Set SSR ray step count',
    'Set SSR ray step count on _PARAM0_ to _PARAM2_',
    'Raymarching step quality count: 16 (Fast), 32 (Balanced), 64 (High).', 'Action',
    [choice('Steps', 'Step count', ['16', '32', '64'])],
    `const val = eventsFunctionContext.getArgument("Steps");
const steps = parseInt(val, 10) || 32;
if (behavior._setSSRRaySteps) behavior._setSSRRaySteps(steps);
FX.updateSettings(runtimeScene, behavior, { ssrRaySteps: steps });
`, { group: G_SSR }),

  // Bloom & Flares
  fn('SetBloomEnabled', 'Enable Bloom',
    'Enable Bloom on _PARAM0_: _PARAM2_',
    'Toggle 13-tap progressive downsample/upsample Karis HDR bloom.', 'Action',
    [bool('Enable', 'Enable Bloom')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableBloom) behavior._setEnableBloom(val);
FX.updateSettings(runtimeScene, behavior, { enableBloom: val });
`, { group: G_BLOOM }),

  fn('SetBloomIntensity', 'Set Bloom intensity',
    'Set Bloom intensity on _PARAM0_ to _PARAM2_',
    'Adjust glow brightness multiplier (0.0 to 3.0).', 'Action',
    [num('Intensity', 'Glow power multiplier', '0.8')],
    `const val = eventsFunctionContext.getArgument("Intensity");
if (behavior._setBloomIntensity) behavior._setBloomIntensity(val);
FX.updateSettings(runtimeScene, behavior, { bloomIntensity: val });
`, { group: G_BLOOM }),

  fn('SetBloomThreshold', 'Set Bloom luminance threshold',
    'Set Bloom luminance threshold on _PARAM0_ to _PARAM2_',
    'Minimum luminance required for surfaces to emit bloom (0.5 to 2.0).', 'Action',
    [num('Threshold', 'Luminance cutoff threshold', '0.9')],
    `const val = eventsFunctionContext.getArgument("Threshold");
if (behavior._setBloomThreshold) behavior._setBloomThreshold(val);
FX.updateSettings(runtimeScene, behavior, { bloomThreshold: val });
`, { group: G_BLOOM }),

  fn('SetAnamorphicFlares', 'Set Anamorphic flare streak strength',
    'Set Anamorphic flare streak strength on _PARAM0_ to _PARAM2_',
    'Horizontal cinema streak flare strength (0.0 to 1.0).', 'Action',
    [num('Strength', 'Horizontal flare strength', '0.3')],
    `const val = eventsFunctionContext.getArgument("Strength");
if (behavior._setAnamorphicFlares) behavior._setAnamorphicFlares(val);
FX.updateSettings(runtimeScene, behavior, { anamorphicFlares: val });
`, { group: G_BLOOM }),

  fn('SetFlareTintColor', 'Set Flare tint color',
    'Set Flare tint color on _PARAM0_ to _PARAM2_',
    'Set color tint for anamorphic lens streaks (e.g. sci-fi blue).', 'Action',
    [col('Color', 'Flare RGB tint', '100;180;255')],
    `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setFlareTintColor) behavior._setFlareTintColor(val);
FX.updateSettings(runtimeScene, behavior, { flareTintColor: val });
`, { group: G_BLOOM }),

  // Depth of Field (DOF)
  fn('SetDOFEnabled', 'Enable Depth of Field (DOF)',
    'Enable Depth of Field on _PARAM0_: _PARAM2_',
    'Toggle optical bokeh Circle of Confusion lens blur.', 'Action',
    [bool('Enable', 'Enable DOF')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableDOF) behavior._setEnableDOF(val);
FX.updateSettings(runtimeScene, behavior, { enableDOF: val });
`, { group: G_DOF }),

  fn('SetAutofocus', 'Set DOF autofocus mode',
    'Set DOF autofocus mode on _PARAM0_: _PARAM2_',
    'Automatically raycast the centre of the screen and ease the focus plane onto whatever ' +
    'it hits. Falls back to the manual focus distance when nothing is in front of the camera.', 'Action',
    [bool('Enable', 'Enable Autofocus')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setAutofocus) behavior._setAutofocus(val);
FX.updateSettings(runtimeScene, behavior, { autofocus: val });
`, { group: G_DOF }),

  fn('SetManualFocusDistance', 'Set DOF manual focus distance',
    'Set DOF manual focus distance on _PARAM0_ to _PARAM2_ world units',
    'Position the focus plane, in GDevelop world units, when autofocus is off. A default 3D ' +
    'layer puts the camera about 724 units from the z=0 plane.', 'Action',
    [num('Distance', 'Focus distance in world units', '700')],
    `const val = eventsFunctionContext.getArgument("Distance");
if (behavior._setManualFocusDistance) behavior._setManualFocusDistance(val);
FX.updateSettings(runtimeScene, behavior, { manualFocusDistance: val });
`, { group: G_DOF }),

  fn('SetApertureFStop', 'Set DOF camera aperture f-stop',
    'Set DOF camera aperture f-stop on _PARAM0_ to _PARAM2_',
    'Adjust lens aperture (f/1.4 for heavy bokeh, f/16.0 for deep focus).', 'Action',
    [num('FStop', 'Lens aperture f-stop', '2.8')],
    `const val = eventsFunctionContext.getArgument("FStop");
if (behavior._setApertureFStop) behavior._setApertureFStop(val);
FX.updateSettings(runtimeScene, behavior, { apertureFStop: val });
`, { group: G_DOF }),

  fn('SetMaxBokehRadius', 'Set DOF maximum bokeh blur radius',
    'Set DOF maximum bokeh blur radius on _PARAM0_ to _PARAM2_',
    'Maximum pixel blur radius for out-of-focus highlights.', 'Action',
    [num('Radius', 'Maximum bokeh blur radius in pixels', '12.0')],
    `const val = eventsFunctionContext.getArgument("Radius");
if (behavior._setMaxBokehRadius) behavior._setMaxBokehRadius(val);
FX.updateSettings(runtimeScene, behavior, { maxBokehRadius: val });
`, { group: G_DOF }),

  // Motion Blur & Optical Distortion
  fn('SetMotionBlurEnabled', 'Enable Motion Blur',
    'Enable Motion Blur on _PARAM0_: _PARAM2_',
    'Toggle velocity vector motion blur for camera and dynamic objects.', 'Action',
    [bool('Enable', 'Enable Motion Blur')],
    `const val = !!eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableMotionBlur) behavior._setEnableMotionBlur(val);
FX.updateSettings(runtimeScene, behavior, { enableMotionBlur: val });
`, { group: G_OPTICS }),

  fn('SetMotionBlurStrength', 'Set Motion Blur strength',
    'Set Motion Blur strength on _PARAM0_ to _PARAM2_',
    'Adjust velocity blur streak length (0.0 to 1.0).', 'Action',
    [num('Strength', 'Motion blur scale', '0.5')],
    `const val = eventsFunctionContext.getArgument("Strength");
if (behavior._setMotionBlurStrength) behavior._setMotionBlurStrength(val);
FX.updateSettings(runtimeScene, behavior, { motionBlurStrength: val });
`, { group: G_OPTICS }),

  fn('SetChromaticAberration', 'Set Chromatic Aberration strength',
    'Set Chromatic Aberration strength on _PARAM0_ to _PARAM2_',
    'Adjust optical lens color fringing at screen edges (0.0 to 0.02).', 'Action',
    [num('Strength', 'Color fringing offset', '0.003')],
    `const val = eventsFunctionContext.getArgument("Strength");
if (behavior._setChromaticAberration) behavior._setChromaticAberration(val);
FX.updateSettings(runtimeScene, behavior, { chromaticAberration: val });
`, { group: G_OPTICS }),
];

const fxConditions = [
  fn('IsActive', 'Post-processing pass is active',
    'Post-processing pass is active on _PARAM0_',
    'Check if the master post-processing pipeline is currently active.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FX.isPassActive(runtimeScene, behavior);\n`,
    { group: G_MASTER }),

  fn('IsSSREnabled', 'Screen-Space Reflections (SSR) is enabled',
    'Screen-Space Reflections (SSR) is enabled on _PARAM0_',
    'Check if Screen-Space Reflections pass is currently enabled.', 'Condition',
    [],
    `const s = FX.getSettings(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(s && s.enableSSR && s.ssrIntensity > 0.0);
`, { group: G_SSR }),

  fn('IsDepthAvailable', 'Depth buffer is available',
    'Depth buffer is available on _PARAM0_',
    'True when a depth texture was successfully attached to the layer composer. GTAO, SSR, ' +
    'Depth of Field and Motion Blur all need this; without it they are skipped.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FX.isDepthAvailable(runtimeScene, behavior);\n`,
    { group: G_MASTER }),

  fn('IsGTAOEnabled', 'Ground Truth Ambient Occlusion (GTAO) is enabled',
    'Ground Truth Ambient Occlusion (GTAO) is enabled on _PARAM0_',
    'Check if Ground Truth Ambient Occlusion pass is currently enabled.', 'Condition',
    [],
    `const s = FX.getSettings(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(s && s.enableGTAO && s.gtaoIntensity > 0.0);
`, { group: G_GTAO }),

  fn('IsBloomEnabled', 'Bloom is enabled',
    'Bloom is enabled on _PARAM0_',
    'Check if 13-tap Karis HDR Bloom pass is active.', 'Condition',
    [],
    `const s = FX.getSettings(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(s && s.enableBloom && s.bloomIntensity > 0.0);
`, { group: G_BLOOM }),

  fn('IsDOFEnabled', 'Depth of Field (DOF) is active',
    'Depth of Field (DOF) is active on _PARAM0_',
    'Check if optical bokeh Depth of Field blur is active.', 'Condition',
    [],
    `const s = FX.getSettings(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(s && s.enableDOF);
`, { group: G_DOF }),

  fn('IsAutofocusTracking', 'Autofocus is currently tracking a target',
    'Autofocus is currently tracking a target on _PARAM0_',
    'Check if center crosshair raycaster has locked onto a 3D surface.', 'Condition',
    [],
    `eventsFunctionContext.returnValue = FX.isAutofocusTracking(runtimeScene, behavior);\n`,
    { group: G_DOF }),

  fn('IsMotionBlurEnabled', 'Motion Blur is enabled',
    'Motion Blur is enabled on _PARAM0_',
    'Check if per-pixel velocity motion blur is active.', 'Condition',
    [],
    `const s = FX.getSettings(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(s && s.enableMotionBlur && s.motionBlurStrength > 0.001);
`, { group: G_OPTICS }),
];

const fxExpressions = [
  // Focus & Distances
  fn('CurrentFocusDistance', 'Current autofocus distance',
    '', 'Live focus plane distance in world units. Follows the autofocus raycast when ' +
    'autofocus is on, otherwise reports the manual focus distance.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getCurrentFocusDistance(runtimeScene, behavior);\n`,
    { group: G_DOF, expressionType: 'number' }),

  fn('ApertureFStop', 'Lens aperture f-stop',
    '', 'Current camera lens aperture f-stop value.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "apertureFStop", 2.8);\n`,
    { group: G_DOF, expressionType: 'number' }),

  fn('ManualFocusDistance', 'Manual focus distance',
    '', 'Current manual focus plane distance in world units.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "manualFocusDistance", 700);\n`,
    { group: G_DOF, expressionType: 'number' }),

  fn('MaxBokehRadius', 'Max bokeh blur radius',
    '', 'Current maximum bokeh blur radius in pixels.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "maxBokehRadius", 12.0);\n`,
    { group: G_DOF, expressionType: 'number' }),

  // Intensities & Scales
  fn('MasterIntensity', 'Master effect intensity',
    '', 'Global post-processing effect multiplier.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "masterIntensity", 1.0);\n`,
    { group: G_MASTER, expressionType: 'number' }),

  fn('BloomIntensity', 'Bloom glow intensity',
    '', 'Current Karis HDR bloom brightness multiplier.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "bloomIntensity", 0.8);\n`,
    { group: G_BLOOM, expressionType: 'number' }),

  fn('BloomThreshold', 'Bloom luminance threshold',
    '', 'Current bloom luminance cutoff threshold.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "bloomThreshold", 0.9);\n`,
    { group: G_BLOOM, expressionType: 'number' }),

  fn('GTAOIntensity', 'GTAO ambient occlusion intensity',
    '', 'Current ambient occlusion shadow darkness.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "gtaoIntensity", 1.0);\n`,
    { group: G_GTAO, expressionType: 'number' }),

  fn('GTAORadius', 'GTAO search radius',
    '', 'Current ambient occlusion search radius in world units.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "gtaoRadius", 50);\n`,
    { group: G_GTAO, expressionType: 'number' }),

  fn('SSRIntensity', 'SSR reflection intensity',
    '', 'Current raymarched reflection brightness.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "ssrIntensity", 0.6);\n`,
    { group: G_SSR, expressionType: 'number' }),

  fn('SSRMaxDistance', 'SSR maximum ray distance',
    '', 'Current SSR maximum ray distance in world units.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "ssrMaxDistance", 400);\n`,
    { group: G_SSR, expressionType: 'number' }),

  fn('SSRFresnel', 'SSR Fresnel falloff',
    '', 'Current SSR grazing-angle Fresnel falloff amount.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "ssrFresnel", 0.6);\n`,
    { group: G_SSR, expressionType: 'number' }),

  fn('MotionBlurStrength', 'Motion Blur strength',
    '', 'Current velocity motion blur strength scale.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "motionBlurStrength", 0.5);\n`,
    { group: G_OPTICS, expressionType: 'number' }),

  fn('ChromaticAberration', 'Chromatic aberration strength',
    '', 'Current lens optical color fringing offset.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "chromaticAberration", 0.003);\n`,
    { group: G_OPTICS, expressionType: 'number' }),

  fn('AnamorphicFlares', 'Anamorphic flare strength',
    '', 'Current horizontal cinema flare streak strength.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = FX.getSetting(runtimeScene, behavior, "anamorphicFlares", 0.3);\n`,
    { group: G_BLOOM, expressionType: 'number' }),
];

/* ------------------------------------------------------------- Behavior Definition */

const cinematicPostFXBehavior = {
  name: 'CinematicPostFX3D',
  fullName: 'Cinematic Post-Processing 3D',
  description: 'Consolidated post-processing pipeline: Screen-Space Reflections (SSR), Ground Truth Ambient Occlusion (GTAO), 13-Tap Karis HDR Bloom, Bokeh Depth of Field with centre-screen autofocus, camera-velocity Motion Blur, and ACES Filmic Tone Mapping. Attaches a depth texture to the layer composer so the depth-dependent passes have real data to work with.',
  objectType: '',
  defaultName: 'CinematicPostFX3D',
  propertyDescriptors: [
    // Master & Presets
    prop('Preset', 'Choice', 'Preset Profile',
      'Applied once when the behavior is created, overwriting the properties below with the ' +
      'preset values. Leave on "Custom" to use the values you set here as-is.',
      'Custom',
      {
        group: G_MASTER,
        extraInformation: ['Custom', 'CyberpunkNeon', 'CinematicMovie', 'HorrorGrim', 'CleanRealistic', 'PerformanceLite']
      }),
    prop('MasterIntensity', 'Number', 'Master Intensity',
      'Crossfade between the untouched scene and the fully graded result. 0.0 is a true bypass.',
      '1.0',
      { group: G_MASTER }),
    prop('ToneMapping', 'Choice', 'Tone Mapping',
      'Color grading curve: ACESFilmic, Reinhard, Cineon, Linear.',
      'ACESFilmic',
      {
        group: G_MASTER,
        extraInformation: ['ACESFilmic', 'Reinhard', 'Cineon', 'Linear']
      }),
    prop('EffectQuality', 'Choice', 'Effect Buffer Quality',
      'Resolution of the ambient occlusion, reflection and reflectivity-mask buffers. ' +
      '"Half" is the sensible default; "Full" sharpens AO and reflections at roughly four ' +
      'times the cost; "Quarter" is for low-end hardware. Bloom, depth of field and the ' +
      'composite always run at full resolution.',
      'Half',
      {
        group: G_MASTER,
        extraInformation: ['Full', 'Half', 'Quarter']
      }),
    prop('TargetLayer', 'String', 'Target Layer',
      'Name of the 3D layer to post-process. Leave empty for the base layer. The layer must be ' +
      'rendering in 3D, otherwise it has no effect composer to attach to.',
      '',
      { group: G_MASTER }),
    prop('Diagnostics', 'Boolean', 'Log Diagnostics',
      'Print one console line at startup: composer found, depth texture attached, camera ' +
      'near/far and distance. Use this first when an effect appears to do nothing.',
      'false',
      { group: G_MASTER }),

    // GTAO
    prop('EnableGTAO', 'Boolean', 'Enable GTAO',
      'Horizon-based ambient occlusion in crevices and contact points. Needs the depth buffer.',
      'false',
      { group: G_GTAO }),
    prop('GTAORadius', 'Number', 'GTAO Radius (world units)',
      'Occlusion search radius in GDevelop world units — scene scale, not metres. A default 3D ' +
      'layer puts the camera around 724 units back, so useful values are in the tens.',
      '50',
      { group: G_GTAO }),
    prop('GTAOIntensity', 'Number', 'GTAO Intensity',
      'Occlusion contrast. Applied as an exponent, so 1.0 is neutral and higher is darker.',
      '1.0',
      { group: G_GTAO }),
    prop('GTAOMultiBounce', 'Boolean', 'GTAO Multi-Bounce',
      'Polynomial multi-bounce fit so coloured crevices keep their bounce light instead of ' +
      'going black.',
      'true',
      { group: G_GTAO }),

    // SSR
    prop('EnableSSR', 'Boolean', 'Enable SSR',
      'Raymarched reflections of on-screen geometry. Needs the depth buffer.',
      'false',
      { group: G_SSR }),
    prop('SSRIntensity', 'Number', 'SSR Intensity',
      'Reflection brightness and blend opacity (0.0 to 1.0).',
      '0.6',
      { group: G_SSR }),
    prop('SSRMaxDistance', 'Number', 'SSR Max Distance (world units)',
      'How far a reflection ray may travel, in GDevelop world units.',
      '400',
      { group: G_SSR }),
    prop('SSRFresnel', 'Number', 'SSR Fresnel Falloff',
      'How strongly reflections favour grazing angles. 0 = uniform mirror everywhere, ' +
      '1 = pure Schlick Fresnel so only glancing surfaces reflect.',
      '0.6',
      { group: G_SSR }),
    prop('SSRSurfaces', 'Choice', 'SSR Reflective Surfaces',
      'Which surfaces reflect. "MaterialBased" renders a reflectivity mask from each ' +
      'material\'s roughness and metalness, so only smooth or metallic surfaces reflect — ' +
      'GDevelop\'s default material is fully rough, so nothing reflects until you make it ' +
      'shiny. "Everything" mirrors the scene onto every surface, which is rarely what you want.',
      'MaterialBased',
      {
        group: G_SSR,
        extraInformation: ['MaterialBased', 'Everything']
      }),
    prop('SSRRaySteps', 'Choice', 'SSR Ray Steps',
      'Quality step count: 16 (Fast), 32 (Balanced), 64 (High).',
      '32',
      {
        group: G_SSR,
        extraInformation: ['16', '32', '64']
      }),

    // Bloom & Flares
    prop('EnableBloom', 'Boolean', 'Enable Bloom',
      '13-tap Karis HDR bloom with additive mip recombination. Works without the depth buffer.',
      'false',
      { group: G_BLOOM }),
    prop('BloomIntensity', 'Number', 'Bloom Intensity',
      'Glow brightness multiplier (0.0 to 3.0).',
      '0.8',
      { group: G_BLOOM }),
    prop('BloomThreshold', 'Number', 'Bloom Threshold',
      'Minimum luminance required to emit bloom (0.5 to 2.0).',
      '0.9',
      { group: G_BLOOM }),
    prop('AnamorphicFlares', 'Number', 'Anamorphic Flares',
      'Horizontal cinema streak flare strength (0.0 to 1.0).',
      '0.3',
      { group: G_BLOOM }),
    prop('FlareTintColor', 'Color', 'Flare Tint Color',
      'Color tint for anamorphic lens streaks (e.g. sci-fi blue).',
      '100;180;255',
      { group: G_BLOOM }),

    // Depth of Field (DOF)
    prop('EnableDOF', 'Boolean', 'Enable DOF',
      'Circle of Confusion bokeh lens defocus. Needs the depth buffer.',
      'false',
      { group: G_DOF }),
    prop('Autofocus', 'Boolean', 'Autofocus Mode',
      'Raycast the centre of the screen and ease the focus plane onto whatever it hits. ' +
      'Falls back to the manual focus distance when nothing is in front of the camera.',
      'true',
      { group: G_DOF }),
    prop('ManualFocusDistance', 'Number', 'Manual Focus Distance (world units)',
      'Focus plane position in GDevelop world units, used when autofocus is off. A default 3D ' +
      'layer puts the camera about 724 units from the z=0 plane.',
      '700',
      { group: G_DOF }),
    prop('ApertureFStop', 'Number', 'Aperture F-Stop',
      'Lens aperture (f/1.4 heavy blur, f/16.0 deep focus). Defocus is measured relative to ' +
      'the focus distance, so the same value looks the same at any scene scale.',
      '2.8',
      { group: G_DOF }),
    prop('MaxBokehRadius', 'Number', 'Max Bokeh Radius (px)',
      'Maximum pixel blur radius for out-of-focus highlights.',
      '12.0',
      { group: G_DOF }),

    // Motion Blur & Optical Distortion
    prop('EnableMotionBlur', 'Boolean', 'Enable Motion Blur',
      'Camera-velocity motion blur reconstructed from depth. Needs the depth buffer.',
      'false',
      { group: G_OPTICS }),
    prop('MotionBlurStrength', 'Number', 'Motion Blur Strength',
      'Velocity streak length scale (0.0 to 1.0).',
      '0.5',
      { group: G_OPTICS }),
    prop('ChromaticAberration', 'Number', 'Chromatic Aberration',
      'Optical lens color fringing at screen edges (0.0 to 0.02). Works without the depth buffer.',
      '0.003',
      { group: G_OPTICS }),
  ],
  eventsFunctions: [
    ...fxLifecycle,
    ...fxActions,
    ...fxConditions,
    ...fxExpressions,
  ],
};

/* ========================================================= Extension Manifest */

const extension = {
  name: 'CinematicPostFX3D',
  fullName: 'Cinematic Post-Processing 3D',
  version: '2.2.0',
  description: 'Consolidated post-processing suite for GDevelop 5 3D layers: Screen-Space Reflections, Ground Truth Ambient Occlusion, 13-Tap Karis HDR Bloom with anamorphic flares, Bokeh Depth of Field with centre-screen autofocus, camera-velocity Motion Blur, Chromatic Aberration, ACES/Reinhard/Cineon tone mapping and 5 genre presets. All world-space settings are in GDevelop world units.',
  shortDescription: 'Post-processing suite for 3D layers: SSR, GTAO, Karis Bloom, Bokeh DOF & presets.',
  category: '3D',
  author: 'Twillion',
  previewIconUrl: iconUrl,
  iconUrl: iconUrl,
  helpPath: '',
  tags: [
    '3d',
    'post-processing',
    'ssr',
    'screen space reflections',
    'gtao',
    'ambient occlusion',
    'bloom',
    'bokeh',
    'depth of field',
    'dof',
    'motion blur',
    'aces',
    'tone mapping',
    'cinematic',
    'camera',
    'optics',
    'shader'
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [],
  eventsBasedBehaviors: [
    cinematicPostFXBehavior,
  ],
};

/* ========================================================= Pre-build Safety Checks */

console.log('Running pre-build safety assertions for CinematicPostFX3D...');

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
walkEvents(cinematicPostFXBehavior.eventsFunctions, cinematicPostFXBehavior.name);

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
checkNamesAndSentences(cinematicPostFXBehavior.eventsFunctions, cinematicPostFXBehavior.name);

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
for (const f of cinematicPostFXBehavior.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

// 4. Object parameters check
const checkObjectParams = (fns, where) => {
  for (const f of fns) {
    f.parameters.forEach((p, i) => {
      if (p.type !== 'object') return;
      if (i === 0 && p.name === 'Object') return;
      console.error(
        `\n${where}.${f.name}: parameter "${p.name}" (index ${i}) is type "object".` +
        `\nOnly parameter 0 of a behavior function may be "object". Use "objectList"` +
        `\nfor any other object parameter.\n`
      );
      process.exit(1);
    });
  }
};
checkObjectParams(cinematicPostFXBehavior.eventsFunctions, cinematicPostFXBehavior.name);


// 5. Static GLSL checks: balanced delimiters, no undeclared identifiers, and no uniform
//    that is uploaded every frame but never read by the shader.
try {
  execFileSync(process.execPath, [path.join(here, 'check-shaders.mjs')], {
    cwd: here,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('\nShader static checks failed.\n');
  process.exit(1);
}

// 6. The runtime must be embedded exactly once. Embedding it in every lifecycle function
//    doubled the extension file for no benefit; embedding it zero times breaks everything.
const runtimeSignature = 'gdjs.__cinematicPostFX3D = {';
let runtimeCopies = 0;
for (const f of cinematicPostFXBehavior.eventsFunctions) {
  for (const evItem of f.events || []) {
    if (evItem.inlineCode && evItem.inlineCode.includes(runtimeSignature)) runtimeCopies++;
  }
}
if (runtimeCopies !== 1) {
  console.error(`\nExpected the runtime to be embedded exactly once, found ${runtimeCopies} copies.\n`);
  process.exit(1);
}

// 7. Every property must have a matching getter in the runtime's PROPERTY_MAP, or the
//    inspector value will silently never reach the pipeline.
for (const prop of cinematicPostFXBehavior.propertyDescriptors) {
  if (prop.name === 'Preset') continue; // handled separately at registration
  const getter = '_get' + prop.name;
  if (!runtime.includes("'" + getter + "'")) {
    console.error(`\nProperty "${prop.name}" has no ${getter} entry in the runtime PROPERTY_MAP.\n`);
    process.exit(1);
  }
}

// Write output JSON
const outPath = path.join(here, 'CinematicPostFX3D.json');
fs.writeFileSync(outPath, json, 'utf8');

const counts = cinematicPostFXBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\nSuccessfully built ${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
