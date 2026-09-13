/**
 * build-extension.mjs
 * Compiles AdvancedWeather3D.json from the runtime engine + behavior & function declarations.
 *
 * Exposes modular, dedicated behaviors for each weather type:
 * 1. RainVolume3D - Dedicated 3D Rain with velocity-aligned streaks, wind pitch, and floor splashes.
 * 2. SnowVolume3D - Dedicated 3D Snow with fluttering flakes and brownian sway.
 * 3. ClusteredFogVolume3D - Dedicated Clustered Volumetric Fog with Beer-Lambert extinction and Henyey-Greenstein scattering.
 * 4. HailVolume3D - Dedicated 3D Hail pellets with bounce splashes.
 * 5. EmbersVolume3D - Dedicated 3D Fiery Embers & Ash with upward thermal draft.
 * 6. DustVolume3D - Dedicated wind-driven dust and sand with volumetric haze.
 * 7. WeatherVolume3D - Universal multi-weather behavior with runtime preset switching.
 * 8. WeatherShelter3D - Roof and canopy occlusion.
 *
 * Run: node AdvancedWeather3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'AdvancedWeather3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__advancedWeather3D';

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

const BEHAVIOR_PREAMBLE = `const __awObjects = eventsFunctionContext.getObjects("Object");
const object = __awObjects.length ? __awObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const AW = ${NS};
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
  events: evFree(`if (!${NS}) return;\nconst AW = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const makeLifecycle = (optionsCode) => [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.registerWeatherVolume(runtimeScene, object, behavior, ${optionsCode});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.stepWeatherVolume(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.disposeWeatherVolume(runtimeScene, behavior);\n`),
  },
];

/* ------------------------------------------------------------- Common Actions, Conditions, Expressions */

const G_VOL_COMMON = 'Volume State & Visibility';
const G_VOL_WIND = 'Wind & 3D Motion';
const G_VOL_PARTICLES = 'Particles & Streaks';
const G_VOL_SPLASH = 'Floor & Roof Splashes';
const G_VOL_LIGHTNING = 'Thunder & Lightning';
const G_VOL_FOG = 'Clustered Volumetric Fog';
const G_VOL_TYPE = 'Weather Preset & Mode';

// Common State Actions
const aSetVolumeMode = fn('SetVolumeMode', 'Set volume mode',
  'Set volume mode on _PARAM0_ to _PARAM2_',
  'Switch between BoundedBox (confined inside the 3D cube) and FollowCamera (a camera-centered emitter window with world-anchored particles and ripples).', 'Action',
  [choice('VolumeMode', 'Volume mode', ['BoundedBox', 'FollowCamera'])],
  `const val = eventsFunctionContext.getArgument("VolumeMode");
if (behavior._setVolumeMode) behavior._setVolumeMode(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { volumeMode: val });
`, { group: G_VOL_COMMON });

const aSetEnabled = fn('SetEnabled', 'Set weather volume enabled',
  'Set weather volume on _PARAM0_ enabled: _PARAM2_',
  'Turn the weather simulation on or off.', 'Action',
  [bool('Enable', 'Enable weather volume')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setEnabled) behavior._setEnabled(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { enabled: val });
`, { group: G_VOL_COMMON });

const aSetDebugBounds = fn('SetDebugBounds', 'Show volume debug wireframe',
  'Set debug wireframe on _PARAM0_: _PARAM2_',
  'Show a bounding wireframe cage around the simulation volume for visual debugging.', 'Action',
  [bool('Enable', 'Show debug wireframe')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setDebugBounds) behavior._setDebugBounds(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { debugBounds: val });
`, { group: G_VOL_COMMON });

// Common Wind Actions
const aSetWindSpeed = fn('SetWindSpeed', 'Set wind speed',
  'Set wind speed on _PARAM0_ to _PARAM2_ units/sec',
  'Change the wind velocity force.', 'Action',
  [num('WindSpeed', 'Wind speed in units/second', '60')],
  `const val = eventsFunctionContext.getArgument("WindSpeed");
if (behavior._setWindSpeed) behavior._setWindSpeed(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { windSpeed: val });
`, { group: G_VOL_WIND });

const aSetWindDirection = fn('SetWindDirection', 'Set wind azimuth direction',
  'Set wind direction on _PARAM0_ to _PARAM2_ degrees',
  'Change the horizontal wind azimuth compass angle in degrees (0 = right, 90 = forward).', 'Action',
  [num('WindDirection', 'Wind azimuth angle in degrees (0 - 360)', '45')],
  `const val = eventsFunctionContext.getArgument("WindDirection");
if (behavior._setWindDirection) behavior._setWindDirection(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { windDirection: val });
`, { group: G_VOL_WIND });

const aSetWindPitch = fn('SetWindPitch', 'Set wind vertical pitch / tilt',
  'Set wind vertical pitch on _PARAM0_ to _PARAM2_ degrees',
  'Change the vertical 3D tilt of the wind (-85 = downward gale, 0 = horizontal, +85 = updraft).', 'Action',
  [num('WindPitch', 'Wind pitch angle in degrees (-85 to +85)', '0')],
  `const val = eventsFunctionContext.getArgument("WindPitch");
if (behavior._setWindPitch) behavior._setWindPitch(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { windPitch: val });
`, { group: G_VOL_WIND });

const aSetWindTurbulence = fn('SetWindTurbulence', 'Set wind turbulence',
  'Set wind turbulence on _PARAM0_ to _PARAM2_',
  'Change gustiness and turbulence fluctuation strength (0.0 = steady, 1.0 = heavy gusts).', 'Action',
  [num('Turbulence', 'Turbulence strength (0.0 to 1.0)', '0.3')],
  `const val = eventsFunctionContext.getArgument("Turbulence");
if (behavior._setWindTurbulence) behavior._setWindTurbulence(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { windTurbulence: val });
`, { group: G_VOL_WIND });

const aSetSway = fn('SetSway', 'Set particle sway / swing',
  'Set particle sway on _PARAM0_ (Amount: _PARAM2_ units, Speed: _PARAM3_ Hz)',
  'Configure sinusoidal fluttering and swaying motion for snowflakes, embers, and dust.', 'Action',
  [
    num('Amount', 'Sway lateral amplitude in scene units', '2'),
    num('Speed', 'Sway frequency in Hz', '1')
  ],
  `const amt = eventsFunctionContext.getArgument("Amount");
const spd = eventsFunctionContext.getArgument("Speed");
if (behavior._setSwayAmount) behavior._setSwayAmount(amt);
if (behavior._setSwaySpeed) behavior._setSwaySpeed(spd);
AW.updateWeatherVolume(runtimeScene, object, behavior, { swayAmount: amt, swaySpeed: spd });
`, { group: G_VOL_WIND });

// Common Particle Actions
const aSetParticleDensity = fn('SetParticleDensity', 'Set particle count / density',
  'Set particle count on _PARAM0_ to _PARAM2_',
  'Set the number of particles simulated in the 3D volume.', 'Action',
  [num('ParticleDensity', 'Particle density / count', '800')],
  `const val = eventsFunctionContext.getArgument("ParticleDensity");
if (behavior._setParticleDensity) behavior._setParticleDensity(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { particleDensity: val });
`, { group: G_VOL_PARTICLES });

const aSetParticleSpeed = fn('SetParticleSpeed', 'Set particle fall speed',
  'Set particle fall speed on _PARAM0_ to _PARAM2_ units/sec',
  'Set downward terminal fall speed (or upward rising speed if negative).', 'Action',
  [num('ParticleSpeed', 'Fall speed in units/second', '520')],
  `const val = eventsFunctionContext.getArgument("ParticleSpeed");
if (behavior._setParticleSpeed) behavior._setParticleSpeed(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { particleSpeed: val });
`, { group: G_VOL_PARTICLES });

const aSetParticleSize = fn('SetParticleSize', 'Set particle size',
  'Set particle size on _PARAM0_ to _PARAM2_ units',
  'Set the particle radius or streak cross-section.', 'Action',
  [num('ParticleSize', 'Size in scene units', '2.2')],
  `const val = eventsFunctionContext.getArgument("ParticleSize");
if (behavior._setParticleSize) behavior._setParticleSize(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { particleSize: val });
`, { group: G_VOL_PARTICLES });

const aSetStreakLength = fn('SetStreakLength', 'Set streak length',
  'Set streak length on _PARAM0_ to _PARAM2_ units',
  'Set the velocity-aligned rain streak length (0 for round flakes or dots).', 'Action',
  [num('StreakLength', 'Streak elongation length', '22')],
  `const val = eventsFunctionContext.getArgument("StreakLength");
if (behavior._setStreakLength) behavior._setStreakLength(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { streakLength: val });
`, { group: G_VOL_PARTICLES });

const aSetStreakThickness = fn('SetStreakThickness', 'Set streak thickness / cross-section',
  'Set streak thickness on _PARAM0_ to _PARAM2_ units',
  'Set the physical cross-section width of rain streaks and particles.', 'Action',
  [num('Thickness', 'Thickness in scene units', '2.2')],
  `const val = eventsFunctionContext.getArgument("Thickness");
if (behavior._setStreakThickness) behavior._setStreakThickness(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { streakThickness: val });
`, { group: G_VOL_PARTICLES });

const aSetParticleColor = fn('SetParticleColor', 'Set particle color',
  'Set particle color on _PARAM0_ to _PARAM2_',
  'Change the RGB color tint of the falling weather particles.', 'Action',
  [col('Color', 'Particle color tint', '190;220;255')],
  `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setParticleColor) behavior._setParticleColor(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { particleColor: val });
`, { group: G_VOL_PARTICLES });

const aSetParticleOpacity = fn('SetParticleOpacity', 'Set particle opacity',
  'Set particle opacity on _PARAM0_ to _PARAM2_',
  'Change transparency of the weather particles (0.0 = invisible, 1.0 = solid).', 'Action',
  [num('Opacity', 'Opacity factor (0.0 to 1.0)', '0.75')],
  `const val = eventsFunctionContext.getArgument("Opacity");
if (behavior._setParticleOpacity) behavior._setParticleOpacity(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { particleOpacity: val });
`, { group: G_VOL_PARTICLES });

// Common Splash Actions
const aSetFloorSplashesEnabled = fn('SetFloorSplashesEnabled', 'Enable floor splashes',
  'Enable floor splashes on _PARAM0_: _PARAM2_',
  'Toggle expanding splash rings when raindrops or hail hit the ground or shelter roofs.', 'Action',
  [bool('Enable', 'Enable splash rings')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableFloorSplashes) behavior._setEnableFloorSplashes(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { enableFloorSplashes: val });
`, { group: G_VOL_SPLASH });

const aSetSplashParams = fn('SetSplashParams', 'Configure splash rings',
  'Configure splashes on _PARAM0_ (Size: _PARAM2_, Lifetime: _PARAM3_ sec, Density: _PARAM4_)',
  'Set splash radius, fade duration, and chance of impact spawn.', 'Action',
  [
    num('Size', 'Maximum ripple radius in scene units', '14'),
    num('Lifetime', 'Splash lifetime in seconds', '0.35'),
    num('Density', 'Spawn chance ratio (0.0 to 1.0)', '0.8')
  ],
  `const sz = eventsFunctionContext.getArgument("Size");
const lt = eventsFunctionContext.getArgument("Lifetime");
const dn = eventsFunctionContext.getArgument("Density");
if (behavior._setSplashSize) behavior._setSplashSize(sz);
if (behavior._setSplashLifetime) behavior._setSplashLifetime(lt);
if (behavior._setSplashDensity) behavior._setSplashDensity(dn);
AW.updateWeatherVolume(runtimeScene, object, behavior, { splashSize: sz, splashLifetime: lt, splashDensity: dn });
`, { group: G_VOL_SPLASH });

const aSetRippleStyle = fn('SetRippleStyle', 'Set impact ripple style',
  'Set ripple style on _PARAM0_ to _PARAM2_',
  'Choose a single ring, concentric double ring, or raised splash crown for floor and roof impacts.', 'Action',
  [choice('Style', 'Impact ripple style', ['Ring', 'DoubleRing', 'Crown'])],
  `const val = eventsFunctionContext.getArgument("Style");
if (behavior._setRippleStyle) behavior._setRippleStyle(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { splashStyle: val });
`, { group: G_VOL_SPLASH });

// Common Lightning Actions
const aSetLightningEnabled = fn('SetLightningEnabled', 'Enable lightning',
  'Enable lightning on _PARAM0_: _PARAM2_',
  'Toggle autonomous periodic thunderstorm lightning flashes.', 'Action',
  [bool('Enable', 'Enable lightning')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableLightning) behavior._setEnableLightning(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { enableLightning: val });
`, { group: G_VOL_LIGHTNING });

const aSetLightningInterval = fn('SetLightningInterval', 'Set lightning strike interval',
  'Set lightning interval on _PARAM0_ between _PARAM2_ and _PARAM3_ seconds',
  'Set the random delay range between automatic lightning flashes.', 'Action',
  [
    num('Min', 'Minimum delay in seconds', '8'),
    num('Max', 'Maximum delay in seconds', '22')
  ],
  `const min = eventsFunctionContext.getArgument("Min");
const max = eventsFunctionContext.getArgument("Max");
if (behavior._setLightningIntervalMin) behavior._setLightningIntervalMin(min);
if (behavior._setLightningIntervalMax) behavior._setLightningIntervalMax(max);
AW.updateWeatherVolume(runtimeScene, object, behavior, { lightningIntervalMin: min, lightningIntervalMax: max });
`, { group: G_VOL_LIGHTNING });

const aTriggerLightningFlash = fn('TriggerLightningFlash', 'Trigger lightning flash',
  'Trigger a lightning flash immediately on _PARAM0_',
  'Trigger an immediate multi-peak lightning flash sequence and illumination pulse.', 'Action',
  [],
  `AW.triggerLightningFlash(runtimeScene, behavior);
`, { group: G_VOL_LIGHTNING });

// Common Clustered Fog Actions
const aSetClusteredFogEnabled = fn('SetClusteredFogEnabled', 'Enable clustered volumetric fog',
  'Enable clustered fog on _PARAM0_: _PARAM2_',
  'Toggle 3D raymarched volumetric clustered fog within this weather volume.', 'Action',
  [bool('Enable', 'Enable clustered fog')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableClusteredFog) behavior._setEnableClusteredFog(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { enableClusteredFog: val });
`, { group: G_VOL_FOG });

const aSetFogThickness = fn('SetFogThickness', 'Set fog optical thickness / density',
  'Set fog thickness on _PARAM0_ to _PARAM2_',
  'Change the physical optical extinction thickness of the volumetric fog.', 'Action',
  [num('Thickness', 'Optical thickness (0.01 to 0.5)', '0.04')],
  `const val = eventsFunctionContext.getArgument("Thickness");
if (behavior._setFogThickness) behavior._setFogThickness(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogThickness: val });
`, { group: G_VOL_FOG });

const aSetFogHeightFalloff = fn('SetFogHeightFalloff', 'Set fog height falloff',
  'Set fog height falloff on _PARAM0_ to _PARAM2_',
  'Control exponential ground fog accumulation (0.0 = uniform, 2.0+ = thick ground fog clinging to floor).', 'Action',
  [num('Falloff', 'Height falloff rate', '1.5')],
  `const val = eventsFunctionContext.getArgument("Falloff");
if (behavior._setFogHeightFalloff) behavior._setFogHeightFalloff(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogHeightFalloff: val });
`, { group: G_VOL_FOG });

const aSetFogAnisotropy = fn('SetFogAnisotropy', 'Set fog phase anisotropy (god rays)',
  'Set fog anisotropy on _PARAM0_ to _PARAM2_',
  'Set the Henyey-Greenstein scattering phase g factor (-0.8 to +0.8). Higher values produce strong forward sunbeams / god rays.', 'Action',
  [num('Anisotropy', 'Anisotropy g factor (-0.8 to 0.8)', '0.4')],
  `const val = eventsFunctionContext.getArgument("Anisotropy");
if (behavior._setFogAnisotropy) behavior._setFogAnisotropy(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogAnisotropy: val });
`, { group: G_VOL_FOG });

const aSetFogColor = fn('SetFogColor', 'Set fog color',
  'Set fog color on _PARAM0_ to _PARAM2_',
  'Change the RGB albedo color tint of the volumetric fog.', 'Action',
  [col('Color', 'Fog color', '200;215;230')],
  `const val = eventsFunctionContext.getArgument("Color");
if (behavior._setFogColor) behavior._setFogColor(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogColor: val });
`, { group: G_VOL_FOG });

const aSetFogNoiseScale = fn('SetFogNoiseScale', 'Set fog cluster noise scale',
  'Set fog noise scale on _PARAM0_ to _PARAM2_',
  'Set the frequency scale of the 3D procedural noise swirling through the clusters.', 'Action',
  [num('Scale', 'Noise scale multiplier', '1.0')],
  `const val = eventsFunctionContext.getArgument("Scale");
if (behavior._setFogNoiseScale) behavior._setFogNoiseScale(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogNoiseScale: val });
`, { group: G_VOL_FOG });

const aSetFogQuality = fn('SetFogQuality', 'Set volumetric fog quality',
  'Set fog quality on _PARAM0_ to _PARAM2_',
  'Choose the raymarch sample count: Low (12), Medium (24), High (40), or Ultra (64).', 'Action',
  [choice('Quality', 'Volumetric fog quality', ['Low', 'Medium', 'High', 'Ultra'])],
  `const val = eventsFunctionContext.getArgument("Quality");
if (behavior._setFogQuality) behavior._setFogQuality(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { fogQuality: val });
`, { group: G_VOL_FOG });

// Common Conditions
const cIsWeatherActive = fn('IsWeatherActive', 'Is weather volume active',
  '_PARAM0_ is active and simulating',
  'Returns true if the weather volume is enabled and visible.', 'Condition',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(vol && vol.enabled);
`, { group: G_VOL_COMMON });

const cIsLightningFlashing = fn('IsLightningFlashing', 'Is lightning flashing',
  'Lightning is currently flashing on _PARAM0_',
  'Returns true while an active lightning flash sequence is illuminating the volume.', 'Condition',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(vol && vol.lightningActive);
`, { group: G_VOL_LIGHTNING });

const cIsPointInsideVolume = fn('IsPointInsideVolume', 'Is point inside weather volume',
  'Point (_PARAM2_, _PARAM3_, _PARAM4_) is inside _PARAM0_',
  'Check if a 3D coordinate (X, Y, Z) lies within this weather simulation volume.', 'Condition',
  [
    num('X', 'World X coordinate', '0'),
    num('Y', 'World Y coordinate', '0'),
    num('Z', 'World Z coordinate', '0')
  ],
  `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
eventsFunctionContext.returnValue = AW.isPointInsideVolume(runtimeScene, behavior, x, y, z);
`, { group: G_VOL_COMMON });

const cIsObjectInsideVolume = fn('IsObjectInsideVolume', 'Is object inside weather volume',
  'Object _PARAM2_ is inside _PARAM0_',
  'Check if another 3D object is currently inside this weather simulation volume.', 'Condition',
  [{ name: 'TargetObject', type: 'object', description: 'Target 3D object' }],
  `const targets = eventsFunctionContext.getObjects("TargetObject");
const target = targets.length ? targets[0] : null;
eventsFunctionContext.returnValue = AW.isObjectInsideVolume(runtimeScene, behavior, target);
`, { group: G_VOL_COMMON });

// Common Expressions
const eParticleDensity = fn('ParticleDensity', 'Particle density',
  '', 'Returns the simulated particle count.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.particleDensity : 800;
`, { group: G_VOL_PARTICLES, expressionType: 'number' });

const eParticleSpeed = fn('ParticleSpeed', 'Particle fall speed',
  '', 'Returns the fall speed in scene units/second.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.particleSpeed : 520;
`, { group: G_VOL_PARTICLES, expressionType: 'number' });

const eStreakThickness = fn('StreakThickness', 'Streak thickness',
  '', 'Returns the rain streak or particle cross-section thickness in scene units.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.streakThickness : 2.2;
`, { group: G_VOL_PARTICLES, expressionType: 'number' });

const eWindSpeed = fn('WindSpeed', 'Wind speed',
  '', 'Returns the wind speed in scene units/second.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.windSpeed : 60;
`, { group: G_VOL_WIND, expressionType: 'number' });

const eWindDirection = fn('WindDirection', 'Wind azimuth direction',
  '', 'Returns the wind azimuth angle in degrees (0 - 360).', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.windDirection : 45;
`, { group: G_VOL_WIND, expressionType: 'number' });

const eWindPitch = fn('WindPitch', 'Wind vertical pitch / tilt',
  '', 'Returns the wind vertical pitch angle in degrees (-85 to +85).', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.windPitch : 0.0;
`, { group: G_VOL_WIND, expressionType: 'number' });

const eFogThickness = fn('FogThickness', 'Fog optical thickness',
  '', 'Returns the optical thickness of the clustered volumetric fog.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.fogThickness : 0.04;
`, { group: G_VOL_FOG, expressionType: 'number' });

const eFogDensityAt = fn('FogDensityAt', 'Fog density at 3D position',
  '', 'Returns the evaluated volumetric fog density at world coordinates (X, Y, Z).', 'Expression',
  [
    num('X', 'World X coordinate', '0'),
    num('Y', 'World Y coordinate', '0'),
    num('Z', 'World Z coordinate', '0')
  ],
  `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
eventsFunctionContext.returnValue = AW.getFogDensityAt(runtimeScene, behavior, x, y, z);
`, { group: G_VOL_FOG, expressionType: 'number' });

const eLightningBrightness = fn('LightningBrightness', 'Lightning flash brightness',
  '', 'Returns current lightning illumination intensity (0.0 = dark, 1.0 = peak flash).', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.lightningBrightness : 0.0;
`, { group: G_VOL_LIGHTNING, expressionType: 'number' });

const eTimeSinceLastLightning = fn('TimeSinceLastLightning', 'Time since last lightning flash',
  '', 'Returns the elapsed seconds since the most recent lightning flash.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.timeSinceLastLightning : 999.0;
`, { group: G_VOL_LIGHTNING, expressionType: 'number' });

const eVolumeWidth = fn('VolumeWidth', 'Volume width',
  '', 'Returns the volume width in scene units.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.bounds.width : 1000;
`, { group: G_VOL_COMMON, expressionType: 'number' });

const eVolumeHeight = fn('VolumeHeight', 'Volume height',
  '', 'Returns the volume height in scene units.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.bounds.height : 1000;
`, { group: G_VOL_COMMON, expressionType: 'number' });

const eVolumeDepth = fn('VolumeDepth', 'Volume depth / height elevation',
  '', 'Returns the volume vertical depth in scene units.', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.bounds.depth : 600;
`, { group: G_VOL_COMMON, expressionType: 'number' });

/* ========================================================= 1. RainVolume3D Behavior */

const RAIN_OPTIONS = `{
  weatherType: 'Rain',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 800,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : 520.0,
  particleSpeedVariation: behavior._getParticleSpeedVariation ? behavior._getParticleSpeedVariation() : 0.25,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 2.2,
  streakLength: behavior._getStreakLength ? behavior._getStreakLength() : 22.0,
  streakThickness: behavior._getStreakThickness ? behavior._getStreakThickness() : 2.2,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '190;220;255',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.75,

  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 60.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 0.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.3,

  enableFloorSplashes: behavior._getEnableFloorSplashes ? behavior._getEnableFloorSplashes() : true,
  splashSize: behavior._getSplashSize ? behavior._getSplashSize() : 14.0,
  splashLifetime: behavior._getSplashLifetime ? behavior._getSplashLifetime() : 0.35,
  splashDensity: behavior._getSplashDensity ? behavior._getSplashDensity() : 0.8,
  splashStyle: behavior._getRippleStyle ? behavior._getRippleStyle() : 'Ring',

  enableLightning: behavior._getEnableLightning ? behavior._getEnableLightning() : false,
  lightningIntervalMin: behavior._getLightningIntervalMin ? behavior._getLightningIntervalMin() : 8.0,
  lightningIntervalMax: behavior._getLightningIntervalMax ? behavior._getLightningIntervalMax() : 22.0,
  lightningFlashColor: behavior._getLightningFlashColor ? behavior._getLightningFlashColor() : '220;235;255',
  lightningIntensity: behavior._getLightningIntensity ? behavior._getLightningIntensity() : 1.5
}`;

const rainVolumeBehavior = {
  name: 'RainVolume3D',
  fullName: 'Rain Volume 3D',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Sizing the cube defines a 3D rain zone with velocity-aligned streaks, 3D wind pitch, floor splash ripples, and lightning.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox: strictly confined inside 3D cube. FollowCamera: camera-centered emitter with world-anchored particles and ripples.', 'BoundedBox', {
      extraInformation: ['BoundedBox', 'FollowCamera']
    }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage around the volume.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable rain simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Drop Count / Density', 'Number of raindrops simulated in the volume.', '800'),
    prop('ParticleSpeed', 'Number', 'Fall Speed', 'Terminal downward fall speed in units/second.', '520.0'),
    prop('ParticleSpeedVariation', 'Number', 'Speed Variation', 'Random fall speed variance (0.0 = uniform, 1.0 = high variation).', '0.25'),
    prop('StreakLength', 'Number', 'Streak Length', 'Rain streak elongation length along velocity vector.', '22.0'),
    prop('StreakThickness', 'Number', 'Streak Thickness', 'Raindrop streak cross-section width in scene units.', '2.2'),
    prop('ParticleColor', 'Color', 'Rain Color', 'Color tint of raindrops.', '190;220;255'),
    prop('ParticleOpacity', 'Number', 'Rain Opacity', 'Opacity factor (0.0 = invisible, 1.0 = solid).', '0.75'),

    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind velocity force in scene units/second.', '60.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal compass angle in degrees (0 = right, 90 = forward).', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical tilt of wind in degrees (-85 = downward gale, 0 = horizontal, +85 = updraft).', '0.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness and turbulence fluctuation factor.', '0.3'),

    prop('EnableFloorSplashes', 'Boolean', 'Enable Floor Splashes', 'Spawn expanding ripple rings when raindrops hit the floor or shelter roofs.', 'true'),
    prop('SplashSize', 'Number', 'Splash Max Radius', 'Maximum ripple radius in scene units.', '14.0'),
    prop('SplashLifetime', 'Number', 'Splash Lifetime', 'Duration of splash ring expansion and fade in seconds.', '0.35'),
    prop('SplashDensity', 'Number', 'Splash Spawn Ratio', 'Probability ratio that an impact spawns a splash (0.0 to 1.0).', '0.8'),
    prop('RippleStyle', 'Choice', 'Impact Ripple Style', 'Ring, DoubleRing, or Crown impact mesh.', 'Ring', {
      extraInformation: ['Ring', 'DoubleRing', 'Crown']
    }),

    prop('EnableLightning', 'Boolean', 'Enable Thunder & Lightning', 'Enable autonomous thunderstorm lightning illumination flashes.', 'false'),
    prop('LightningIntervalMin', 'Number', 'Lightning Min Interval', 'Minimum seconds between lightning strikes.', '8.0'),
    prop('LightningIntervalMax', 'Number', 'Lightning Max Interval', 'Maximum seconds between lightning strikes.', '22.0'),
    prop('LightningFlashColor', 'Color', 'Lightning Flash Color', 'Illumination color of lightning flash.', '220;235;255'),
    prop('LightningIntensity', 'Number', 'Lightning Intensity', 'Brightness multiplier for lightning flash.', '1.5')
  ],
  eventsFunctions: [
    ...makeLifecycle(RAIN_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetStreakLength, aSetStreakThickness, aSetParticleColor, aSetParticleOpacity,
    aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence,
    aSetFloorSplashesEnabled, aSetSplashParams, aSetRippleStyle,
    aSetLightningEnabled, aSetLightningInterval, aTriggerLightningFlash,
    cIsWeatherActive, cIsLightningFlashing, cIsPointInsideVolume, cIsObjectInsideVolume,
    eParticleDensity, eParticleSpeed, eStreakThickness, eWindSpeed, eWindDirection, eWindPitch,
    eLightningBrightness, eTimeSinceLastLightning, eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 2. SnowVolume3D Behavior */

const SNOW_OPTIONS = `{
  weatherType: 'Snow',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 600,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : 85.0,
  particleSpeedVariation: behavior._getParticleSpeedVariation ? behavior._getParticleSpeedVariation() : 0.45,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 4.5,
  streakLength: 0.0,
  streakThickness: behavior._getParticleSize ? behavior._getParticleSize() : 4.5,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '245;250;255',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.90,

  swayAmount: behavior._getSwayAmount ? behavior._getSwayAmount() : 28.0,
  swaySpeed: behavior._getSwaySpeed ? behavior._getSwaySpeed() : 2.2,
  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 40.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 0.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.3,

  enableFloorSplashes: false
}`;

const snowVolumeBehavior = {
  name: 'SnowVolume3D',
  fullName: 'Snow Volume 3D',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Sizing the cube defines a 3D snow zone with fluttering snowflakes, brownian sway, and wind drift.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox: strictly confined inside 3D cube. FollowCamera: camera-centered emitter with world-anchored particles.', 'BoundedBox', {
      extraInformation: ['BoundedBox', 'FollowCamera']
    }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage around the volume.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable snow simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Flake Count / Density', 'Number of snowflakes simulated in the volume.', '600'),
    prop('ParticleSpeed', 'Number', 'Fall Speed', 'Gentle downward fall speed in units/second.', '85.0'),
    prop('ParticleSpeedVariation', 'Number', 'Speed Variation', 'Random fall speed variance.', '0.45'),
    prop('ParticleSize', 'Number', 'Flake Size', 'Snowflake diameter in scene units.', '4.5'),
    prop('ParticleColor', 'Color', 'Snow Color', 'Color tint of snowflakes.', '245;250;255'),
    prop('ParticleOpacity', 'Number', 'Snow Opacity', 'Opacity factor (0.0 to 1.0).', '0.90'),

    prop('SwayAmount', 'Number', 'Sway Amplitude', 'Lateral fluttering swing distance in scene units.', '28.0'),
    prop('SwaySpeed', 'Number', 'Flutter Frequency', 'Fluttering oscillation frequency in Hz.', '2.2'),
    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind velocity force in units/second.', '40.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal wind azimuth in degrees (0 - 360).', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical tilt of wind in degrees (-85 to +85).', '0.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness and turbulence fluctuation factor.', '0.3')
  ],
  eventsFunctions: [
    ...makeLifecycle(SNOW_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetParticleSize, aSetParticleColor, aSetParticleOpacity,
    aSetSway, aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence,
    cIsWeatherActive, cIsPointInsideVolume, cIsObjectInsideVolume,
    eParticleDensity, eParticleSpeed, eWindSpeed, eWindDirection, eWindPitch,
    eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 3. ClusteredFogVolume3D Behavior */

const FOG_OPTIONS = `{
  weatherType: 'Fog',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getMistParticleCount ? behavior._getMistParticleCount() : 0,
  enableClusteredFog: true,
  fogThickness: behavior._getFogThickness ? behavior._getFogThickness() : 0.05,
  fogHeightFalloff: behavior._getFogHeightFalloff ? behavior._getFogHeightFalloff() : 1.5,
  fogAnisotropy: behavior._getFogAnisotropy ? behavior._getFogAnisotropy() : 0.4,
  fogColor: behavior._getFogColor ? behavior._getFogColor() : '200;215;230',
  fogNoiseScale: behavior._getFogNoiseScale ? behavior._getFogNoiseScale() : 1.0,
  fogQuality: behavior._getFogQuality ? behavior._getFogQuality() : 'Medium',

  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 40.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 0.0,

  enableLightning: behavior._getEnableLightning ? behavior._getEnableLightning() : false,
  lightningIntervalMin: behavior._getLightningIntervalMin ? behavior._getLightningIntervalMin() : 8.0,
  lightningIntervalMax: behavior._getLightningIntervalMax ? behavior._getLightningIntervalMax() : 22.0,
  lightningFlashColor: behavior._getLightningFlashColor ? behavior._getLightningFlashColor() : '220;235;255',
  lightningIntensity: behavior._getLightningIntensity ? behavior._getLightningIntensity() : 1.5
}`;

const clusteredFogVolumeBehavior = {
  name: 'ClusteredFogVolume3D',
  fullName: 'Clustered Fog Volume 3D',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Renders 3D raymarched volumetric clustered fog with Beer-Lambert extinction, Henyey-Greenstein solar scattering (god rays), ground height falloff, and wind advection.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox: strictly confined inside 3D cube. FollowCamera: camera-centered emitter with world-anchored particles.', 'BoundedBox', {
      extraInformation: ['BoundedBox', 'FollowCamera']
    }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage around the volume.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable volumetric fog.', 'true'),

    prop('FogThickness', 'Number', 'Fog Optical Thickness', 'Physical light extinction and opacity per meter (0.005 to 0.5).', '0.05'),
    prop('FogHeightFalloff', 'Number', 'Fog Height Falloff', 'Ground fog concentration (0.0 = uniform, 1.5+ = thick ground fog).', '1.5'),
    prop('FogAnisotropy', 'Number', 'Solar Phase Anisotropy', 'Henyey-Greenstein scattering phase g (-0.8 to 0.8) for forward sunbeams / god rays.', '0.4'),
    prop('FogColor', 'Color', 'Fog Color', 'Albedo color tint of the volumetric fog.', '200;215;230'),
    prop('FogNoiseScale', 'Number', 'Cluster Noise Scale', 'Frequency scale of the 3D procedural noise swirling through the clusters.', '1.0'),
    prop('FogQuality', 'Choice', 'Fog Quality', 'Raymarch quality: Low (12), Medium (24), High (40), or Ultra (64) samples.', 'Medium', {
      extraInformation: ['Low', 'Medium', 'High', 'Ultra']
    }),

    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind velocity force advecting the fog through the clusters.', '40.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal wind azimuth in degrees (0 - 360).', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical tilt of wind in degrees (-85 to +85).', '0.0'),

    prop('MistParticleCount', 'Number', 'Ambient Mist Particles', 'Optional count of floating atmospheric dust/mist puffs.', '0'),
    prop('EnableLightning', 'Boolean', 'Lightning In-Scattering', 'Enable autonomous lightning illumination, or stack this behavior with a lightning-enabled rain volume.', 'false'),
    prop('LightningIntervalMin', 'Number', 'Lightning Min Interval', 'Minimum seconds between autonomous flashes.', '8.0'),
    prop('LightningIntervalMax', 'Number', 'Lightning Max Interval', 'Maximum seconds between autonomous flashes.', '22.0'),
    prop('LightningFlashColor', 'Color', 'Lightning Flash Color', 'Internal flash illumination color.', '220;235;255'),
    prop('LightningIntensity', 'Number', 'Lightning Intensity', 'Internal flash brightness multiplier.', '1.5')
  ],
  eventsFunctions: [
    ...makeLifecycle(FOG_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetFogThickness, aSetFogHeightFalloff, aSetFogAnisotropy, aSetFogColor, aSetFogNoiseScale, aSetFogQuality,
    aSetWindSpeed, aSetWindDirection, aSetWindPitch,
    aSetLightningEnabled, aSetLightningInterval, aTriggerLightningFlash,
    cIsWeatherActive, cIsLightningFlashing, cIsPointInsideVolume, cIsObjectInsideVolume,
    eFogThickness, eFogDensityAt, eWindSpeed, eWindDirection, eWindPitch,
    eLightningBrightness, eTimeSinceLastLightning, eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 4. HailVolume3D Behavior */

const HAIL_OPTIONS = `{
  weatherType: 'Hail',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 400,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : 650.0,
  particleSpeedVariation: behavior._getParticleSpeedVariation ? behavior._getParticleSpeedVariation() : 0.20,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 3.8,
  streakLength: behavior._getStreakLength ? behavior._getStreakLength() : 4.0,
  streakThickness: behavior._getStreakThickness ? behavior._getStreakThickness() : 3.8,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '225;242;255',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.85,

  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 70.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : -15.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.35,

  enableFloorSplashes: behavior._getEnableFloorSplashes ? behavior._getEnableFloorSplashes() : true,
  splashSize: behavior._getSplashSize ? behavior._getSplashSize() : 8.0,
  splashLifetime: behavior._getSplashLifetime ? behavior._getSplashLifetime() : 0.25,
  splashDensity: behavior._getSplashDensity ? behavior._getSplashDensity() : 0.9,
  splashStyle: behavior._getRippleStyle ? behavior._getRippleStyle() : 'Crown',

  enableLightning: behavior._getEnableLightning ? behavior._getEnableLightning() : false,
  lightningIntervalMin: behavior._getLightningIntervalMin ? behavior._getLightningIntervalMin() : 8.0,
  lightningIntervalMax: behavior._getLightningIntervalMax ? behavior._getLightningIntervalMax() : 22.0,
  lightningFlashColor: behavior._getLightningFlashColor ? behavior._getLightningFlashColor() : '220;235;255',
  lightningIntensity: behavior._getLightningIntensity ? behavior._getLightningIntensity() : 1.5
}`;

const hailVolumeBehavior = {
  name: 'HailVolume3D',
  fullName: 'Hail Volume 3D',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Creates high-speed falling icy hail pellets with ground bounce splashes and wind drift.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox or a camera-centered FollowCamera emitter with world-anchored particles and impacts.', 'BoundedBox', { extraInformation: ['BoundedBox', 'FollowCamera'] }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable hail simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Pellet Count', 'Number of hail pellets simulated.', '400'),
    prop('ParticleSpeed', 'Number', 'Fall Speed', 'Terminal downward speed in units/second.', '650.0'),
    prop('ParticleSpeedVariation', 'Number', 'Speed Variation', 'Random fall-speed variance.', '0.20'),
    prop('ParticleSize', 'Number', 'Pellet Size', 'Pellet diameter in scene units.', '3.8'),
    prop('StreakLength', 'Number', 'Motion Stretch', 'Velocity-aligned pellet stretch.', '4.0'),
    prop('StreakThickness', 'Number', 'Pellet Thickness', 'Cross-section width in scene units.', '3.8'),
    prop('ParticleColor', 'Color', 'Hail Color', 'Color tint of hail pellets.', '225;242;255'),
    prop('ParticleOpacity', 'Number', 'Hail Opacity', 'Opacity factor (0.0 to 1.0).', '0.85'),

    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind velocity force in units/second.', '70.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal wind azimuth in degrees.', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical tilt of wind in degrees.', '-15.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness factor.', '0.35'),

    prop('EnableFloorSplashes', 'Boolean', 'Enable Impact Ripples', 'Spawn rings where hail strikes floors and roofs.', 'true'),
    prop('SplashSize', 'Number', 'Impact Ring Radius', 'Maximum impact ring radius.', '8.0'),
    prop('SplashLifetime', 'Number', 'Impact Ring Lifetime', 'Impact ring duration in seconds.', '0.25'),
    prop('SplashDensity', 'Number', 'Impact Ring Ratio', 'Chance that an impact creates a ring.', '0.9'),
    prop('RippleStyle', 'Choice', 'Impact Ripple Style', 'Ring, DoubleRing, or Crown impact mesh.', 'Crown', {
      extraInformation: ['Ring', 'DoubleRing', 'Crown']
    }),

    prop('EnableLightning', 'Boolean', 'Enable Lightning', 'Thunderstorm lightning flashes.', 'false'),
    prop('LightningIntervalMin', 'Number', 'Lightning Min Interval', 'Minimum seconds between flashes.', '8.0'),
    prop('LightningIntervalMax', 'Number', 'Lightning Max Interval', 'Maximum seconds between flashes.', '22.0'),
    prop('LightningFlashColor', 'Color', 'Lightning Flash Color', 'Flash illumination color.', '220;235;255'),
    prop('LightningIntensity', 'Number', 'Lightning Intensity', 'Flash brightness multiplier.', '1.5')
  ],
  eventsFunctions: [
    ...makeLifecycle(HAIL_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetParticleSize, aSetStreakLength, aSetStreakThickness,
    aSetParticleColor, aSetParticleOpacity,
    aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence,
    aSetFloorSplashesEnabled, aSetSplashParams, aSetRippleStyle,
    aSetLightningEnabled, aSetLightningInterval, aTriggerLightningFlash,
    cIsWeatherActive, cIsLightningFlashing, cIsPointInsideVolume, cIsObjectInsideVolume,
    eParticleDensity, eParticleSpeed, eStreakThickness, eWindSpeed, eWindDirection, eWindPitch,
    eLightningBrightness, eTimeSinceLastLightning,
    eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 5. EmbersVolume3D Behavior */

const EMBERS_OPTIONS = `{
  weatherType: 'Embers',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 350,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : -55.0,
  particleSpeedVariation: 0.50,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 3.2,
  streakLength: behavior._getStreakLength ? behavior._getStreakLength() : 2.5,
  streakThickness: behavior._getStreakThickness ? behavior._getStreakThickness() : 3.2,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '255;125;35',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.88,

  swayAmount: behavior._getSwayAmount ? behavior._getSwayAmount() : 35.0,
  swaySpeed: behavior._getSwaySpeed ? behavior._getSwaySpeed() : 3.0,
  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 35.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 10.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.4
}`;

const embersVolumeBehavior = {
  name: 'EmbersVolume3D',
  fullName: 'Embers & Ash Volume 3D',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Creates floating fiery embers and glowing sparks with upward thermal draft and size flicker.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox or a camera-centered FollowCamera emitter with world-anchored particles and impacts.', 'BoundedBox', { extraInformation: ['BoundedBox', 'FollowCamera'] }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable embers simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Spark Count', 'Number of fiery embers simulated.', '350'),
    prop('ParticleSpeed', 'Number', 'Thermal Rise Speed', 'Upward vertical speed (negative values rise).', '-55.0'),
    prop('ParticleSize', 'Number', 'Spark Size', 'Ember diameter in scene units.', '3.2'),
    prop('StreakLength', 'Number', 'Spark Trail Length', 'Velocity-aligned ember trail length.', '2.5'),
    prop('StreakThickness', 'Number', 'Spark Thickness', 'Spark cross-section width.', '3.2'),
    prop('ParticleColor', 'Color', 'Ember Color', 'Fiery glow color.', '255;125;35'),
    prop('ParticleOpacity', 'Number', 'Ember Opacity', 'Opacity factor (0.0 to 1.0).', '0.88'),

    prop('SwayAmount', 'Number', 'Thermal Sway', 'Lateral thermal drift distance.', '35.0'),
    prop('SwaySpeed', 'Number', 'Flicker Speed', 'Thermal drift and flicker frequency.', '3.0'),
    prop('WindSpeed', 'Number', 'Wind Speed', 'Horizontal wind draft force in units/second.', '35.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal wind azimuth in degrees.', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical wind tilt in degrees.', '10.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness factor.', '0.4')
  ],
  eventsFunctions: [
    ...makeLifecycle(EMBERS_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetParticleSize, aSetStreakLength, aSetStreakThickness,
    aSetParticleColor, aSetParticleOpacity, aSetSway,
    aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence,
    cIsWeatherActive, cIsPointInsideVolume, cIsObjectInsideVolume,
    eParticleDensity, eParticleSpeed, eStreakThickness, eWindSpeed, eWindDirection, eWindPitch,
    eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 6. DustVolume3D Behavior */

const DUST_OPTIONS = `{
  weatherType: 'Dust',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 500,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : 30.0,
  particleSpeedVariation: behavior._getParticleSpeedVariation ? behavior._getParticleSpeedVariation() : 0.60,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 2.8,
  streakLength: 0.0,
  streakThickness: behavior._getParticleSize ? behavior._getParticleSize() : 2.8,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '210;185;145',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.55,

  swayAmount: behavior._getSwayAmount ? behavior._getSwayAmount() : 45.0,
  swaySpeed: behavior._getSwaySpeed ? behavior._getSwaySpeed() : 1.5,
  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 80.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 20.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 4.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.5,

  enableClusteredFog: behavior._getEnableDustHaze ? behavior._getEnableDustHaze() : true,
  fogThickness: behavior._getFogThickness ? behavior._getFogThickness() : 0.05,
  fogHeightFalloff: behavior._getFogHeightFalloff ? behavior._getFogHeightFalloff() : 0.8,
  fogAnisotropy: behavior._getFogAnisotropy ? behavior._getFogAnisotropy() : 0.2,
  fogColor: behavior._getFogColor ? behavior._getFogColor() : '210;185;145',
  fogNoiseScale: behavior._getFogNoiseScale ? behavior._getFogNoiseScale() : 1.25,
  fogQuality: behavior._getFogQuality ? behavior._getFogQuality() : 'Medium'
}`;

const aSetDustHazeEnabled = fn('SetDustHazeEnabled', 'Enable volumetric dust haze',
  'Enable volumetric dust haze on _PARAM0_: _PARAM2_',
  'Toggle the raymarched volumetric haze behind the dust or sand particles.', 'Action',
  [bool('Enable', 'Enable volumetric dust haze')],
  `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setEnableDustHaze) behavior._setEnableDustHaze(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { enableClusteredFog: val });
`, { group: G_VOL_FOG });

const dustVolumeBehavior = {
  name: 'DustVolume3D',
  fullName: 'Dust & Sand Volume 3D',
  description: 'Attach to a 3D Box or 3D Object. Creates wind-driven dust motes or sandstorm particles with a matching volumetric haze.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox or a camera-centered FollowCamera emitter with world-anchored particles and impacts.', 'BoundedBox', { extraInformation: ['BoundedBox', 'FollowCamera'] }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides the 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable dust simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Dust Mote Count', 'Number of dust or sand particles simulated.', '500'),
    prop('ParticleSpeed', 'Number', 'Settling Speed', 'Downward settling speed in units/second.', '30.0'),
    prop('ParticleSpeedVariation', 'Number', 'Speed Variation', 'Random settling-speed variance.', '0.60'),
    prop('ParticleSize', 'Number', 'Mote Size', 'Dust mote size in scene units.', '2.8'),
    prop('ParticleColor', 'Color', 'Dust Color', 'Color tint of dust particles.', '210;185;145'),
    prop('ParticleOpacity', 'Number', 'Dust Opacity', 'Opacity factor (0.0 to 1.0).', '0.55'),

    prop('SwayAmount', 'Number', 'Turbulent Drift', 'Lateral drifting distance.', '45.0'),
    prop('SwaySpeed', 'Number', 'Drift Frequency', 'Drift oscillation frequency.', '1.5'),
    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind force in units/second.', '80.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal wind azimuth in degrees.', '20.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical wind tilt in degrees.', '4.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness factor.', '0.5'),

    prop('EnableDustHaze', 'Boolean', 'Enable Volumetric Haze', 'Render volumetric haze behind the dust motes.', 'true'),
    prop('FogThickness', 'Number', 'Haze Optical Thickness', 'Optical thickness of the dust haze.', '0.05'),
    prop('FogHeightFalloff', 'Number', 'Haze Height Falloff', 'Concentrate dust near the ground.', '0.8'),
    prop('FogAnisotropy', 'Number', 'Solar Anisotropy', 'Forward-scattering strength for sunlit dust.', '0.2'),
    prop('FogColor', 'Color', 'Haze Color', 'Color tint of the volumetric dust haze.', '210;185;145'),
    prop('FogNoiseScale', 'Number', 'Haze Noise Scale', 'Frequency of the turbulent haze pattern.', '1.25'),
    prop('FogQuality', 'Choice', 'Fog Quality', 'Raymarch quality: Low, Medium, High, or Ultra.', 'Medium', {
      extraInformation: ['Low', 'Medium', 'High', 'Ultra']
    })
  ],
  eventsFunctions: [
    ...makeLifecycle(DUST_OPTIONS),
    aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetParticleSize, aSetParticleColor, aSetParticleOpacity,
    aSetSway, aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence,
    aSetDustHazeEnabled, aSetFogThickness, aSetFogHeightFalloff, aSetFogAnisotropy,
    aSetFogColor, aSetFogNoiseScale, aSetFogQuality,
    cIsWeatherActive, cIsPointInsideVolume, cIsObjectInsideVolume,
    eParticleDensity, eParticleSpeed, eWindSpeed, eWindDirection, eWindPitch,
    eFogThickness, eFogDensityAt, eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 7. WeatherVolume3D (Universal Behavior) */

const WEATHER_OPTIONS = `{
  weatherType: behavior._getWeatherType ? behavior._getWeatherType() : 'Rain',
  volumeMode: behavior._getVolumeMode ? behavior._getVolumeMode() : 'BoundedBox',
  hideHostMesh: behavior._getHideHostMesh ? behavior._getHideHostMesh() : true,
  debugBounds: behavior._getDebugBounds ? behavior._getDebugBounds() : false,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,

  particleDensity: behavior._getParticleDensity ? behavior._getParticleDensity() : 800,
  particleSpeed: behavior._getParticleSpeed ? behavior._getParticleSpeed() : 520.0,
  particleSpeedVariation: behavior._getParticleSpeedVariation ? behavior._getParticleSpeedVariation() : 0.25,
  particleSize: behavior._getParticleSize ? behavior._getParticleSize() : 2.2,
  streakLength: behavior._getStreakLength ? behavior._getStreakLength() : 22.0,
  streakThickness: behavior._getStreakThickness ? behavior._getStreakThickness() : 2.2,
  particleColor: behavior._getParticleColor ? behavior._getParticleColor() : '190;220;255',
  particleOpacity: behavior._getParticleOpacity ? behavior._getParticleOpacity() : 0.75,

  windSpeed: behavior._getWindSpeed ? behavior._getWindSpeed() : 60.0,
  windDirection: behavior._getWindDirection ? behavior._getWindDirection() : 45.0,
  windPitch: behavior._getWindPitch ? behavior._getWindPitch() : 0.0,
  windTurbulence: behavior._getWindTurbulence ? behavior._getWindTurbulence() : 0.3,
  swayAmount: behavior._getSwayAmount ? behavior._getSwayAmount() : 2.0,
  swaySpeed: behavior._getSwaySpeed ? behavior._getSwaySpeed() : 1.0,

  enableFloorSplashes: behavior._getEnableFloorSplashes ? behavior._getEnableFloorSplashes() : true,
  splashSize: behavior._getSplashSize ? behavior._getSplashSize() : 14.0,
  splashLifetime: behavior._getSplashLifetime ? behavior._getSplashLifetime() : 0.35,
  splashDensity: behavior._getSplashDensity ? behavior._getSplashDensity() : 0.8,
  splashStyle: behavior._getRippleStyle ? behavior._getRippleStyle() : 'Ring',

  enableClusteredFog: behavior._getEnableClusteredFog ? behavior._getEnableClusteredFog() : false,
  fogThickness: behavior._getFogThickness ? behavior._getFogThickness() : 0.04,
  fogHeightFalloff: behavior._getFogHeightFalloff ? behavior._getFogHeightFalloff() : 1.5,
  fogAnisotropy: behavior._getFogAnisotropy ? behavior._getFogAnisotropy() : 0.4,
  fogColor: behavior._getFogColor ? behavior._getFogColor() : '200;215;230',
  fogNoiseScale: behavior._getFogNoiseScale ? behavior._getFogNoiseScale() : 1.0,
  fogQuality: behavior._getFogQuality ? behavior._getFogQuality() : 'Medium',

  enableLightning: behavior._getEnableLightning ? behavior._getEnableLightning() : false,
  lightningIntervalMin: behavior._getLightningIntervalMin ? behavior._getLightningIntervalMin() : 8.0,
  lightningIntervalMax: behavior._getLightningIntervalMax ? behavior._getLightningIntervalMax() : 22.0,
  lightningFlashColor: behavior._getLightningFlashColor ? behavior._getLightningFlashColor() : '220;235;255',
  lightningIntensity: behavior._getLightningIntensity ? behavior._getLightningIntensity() : 1.5,

  mistDensity: behavior._getMistDensity ? behavior._getMistDensity() : 0.0,
  mistColor: behavior._getMistColor ? behavior._getMistColor() : '160;180;200'
}`;

const aSetWeatherType = fn('SetWeatherType', 'Set weather type',
  'Set weather type on _PARAM0_ to _PARAM2_',
  'Change the active simulation preset (Rain, Snow, Hail, Dust, Embers, Fog, or Custom).', 'Action',
  [choice('WeatherType', 'Weather preset', ['Rain', 'Snow', 'Hail', 'Dust', 'Embers', 'Fog', 'Custom'])],
  `const val = eventsFunctionContext.getArgument("WeatherType");
if (behavior._setWeatherType) behavior._setWeatherType(val);
AW.updateWeatherVolume(runtimeScene, object, behavior, { weatherType: val });
`, { group: G_VOL_TYPE });

const cWeatherTypeIs = fn('WeatherTypeIs', 'Weather type is',
  'Weather type of _PARAM0_ is _PARAM2_',
  'Check if the volume is currently using a specific weather preset.', 'Condition',
  [choice('WeatherType', 'Weather preset', ['Rain', 'Snow', 'Hail', 'Dust', 'Embers', 'Fog', 'Custom'])],
  `const val = eventsFunctionContext.getArgument("WeatherType");
const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = (vol && vol.weatherType === val);
`, { group: G_VOL_TYPE });

const eWeatherType = fn('WeatherType', 'Weather type',
  '', 'Returns the active weather type name (e.g. "Rain", "Snow").', 'Expression',
  [],
  `const vol = AW.volumeOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = vol ? vol.weatherType : 'Rain';
`, { group: G_VOL_TYPE, expressionType: 'string' });

const universalWeatherVolumeBehavior = {
  name: 'WeatherVolume3D',
  fullName: 'Weather Volume 3D (Universal)',
  description: 'Attach to a 3D Box (Cube) or 3D Object. Master all-in-one behavior for dynamic weather switching (Rain, Snow, Hail, Dust, Embers, Fog, Custom) and Clustered Volumetric Fog.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('WeatherType', 'Choice', 'Weather Type', 'Active weather simulation preset.', 'Rain', {
      extraInformation: ['Rain', 'Snow', 'Hail', 'Dust', 'Embers', 'Fog', 'Custom']
    }),
    prop('VolumeMode', 'Choice', 'Volume Mode', 'BoundedBox or a camera-centered FollowCamera emitter with world-anchored particles and impacts.', 'BoundedBox', {
      extraInformation: ['BoundedBox', 'FollowCamera']
    }),
    prop('HideHostMesh', 'Boolean', 'Hide Host Cube Mesh', 'Automatically hides 3D box renderer mesh at runtime.', 'true'),
    prop('DebugBounds', 'Boolean', 'Show Debug Wireframe', 'Draw a bounding wireframe cage.', 'false'),
    prop('Enabled', 'Boolean', 'Enabled', 'Enable simulation.', 'true'),

    prop('ParticleDensity', 'Number', 'Particle Density', 'Number of particles simulated.', '800'),
    prop('ParticleSpeed', 'Number', 'Fall Speed', 'Terminal fall speed in units/second.', '520.0'),
    prop('ParticleSpeedVariation', 'Number', 'Speed Variation', 'Random speed variance.', '0.25'),
    prop('ParticleSize', 'Number', 'Particle Size', 'Particle radius or streak cross-section.', '2.2'),
    prop('StreakLength', 'Number', 'Streak Length', 'Rain streak elongation length.', '22.0'),
    prop('StreakThickness', 'Number', 'Streak Thickness', 'Streak cross-section width.', '2.2'),
    prop('ParticleColor', 'Color', 'Particle Color', 'Color tint of particles.', '190;220;255'),
    prop('ParticleOpacity', 'Number', 'Particle Opacity', 'Opacity factor (0.0 to 1.0).', '0.75'),

    prop('WindSpeed', 'Number', 'Wind Speed', 'Wind velocity force.', '60.0'),
    prop('WindDirection', 'Number', 'Wind Azimuth Direction', 'Horizontal azimuth angle in degrees (0 - 360).', '45.0'),
    prop('WindPitch', 'Number', 'Wind Vertical Pitch', 'Vertical tilt of wind in degrees (-85 to +85).', '0.0'),
    prop('WindTurbulence', 'Number', 'Wind Turbulence', 'Gustiness and turbulence factor.', '0.3'),
    prop('SwayAmount', 'Number', 'Sway Amount', 'Lateral fluttering swing distance.', '2.0'),
    prop('SwaySpeed', 'Number', 'Sway Speed', 'Flutter oscillation frequency in Hz.', '1.0'),

    prop('EnableFloorSplashes', 'Boolean', 'Enable Floor Splashes', 'Spawn expanding ripple rings on impact.', 'true'),
    prop('SplashSize', 'Number', 'Splash Max Radius', 'Maximum ripple radius.', '14.0'),
    prop('SplashLifetime', 'Number', 'Splash Lifetime', 'Splash duration in seconds.', '0.35'),
    prop('SplashDensity', 'Number', 'Splash Spawn Ratio', 'Spawn probability ratio.', '0.8'),
    prop('RippleStyle', 'Choice', 'Impact Ripple Style', 'Ring, DoubleRing, or Crown impact mesh.', 'Ring', {
      extraInformation: ['Ring', 'DoubleRing', 'Crown']
    }),

    prop('EnableClusteredFog', 'Boolean', 'Enable Clustered Fog', 'Render 3D raymarched volumetric clustered fog.', 'false'),
    prop('FogThickness', 'Number', 'Fog Optical Thickness', 'Physical light extinction per meter.', '0.04'),
    prop('FogHeightFalloff', 'Number', 'Fog Height Falloff', 'Ground fog accumulation factor.', '1.5'),
    prop('FogAnisotropy', 'Number', 'Fog Phase Anisotropy', 'Henyey-Greenstein scattering g factor.', '0.4'),
    prop('FogColor', 'Color', 'Fog Color', 'Albedo color tint of fog.', '200;215;230'),
    prop('FogNoiseScale', 'Number', 'Fog Noise Scale', 'Cluster noise frequency scale.', '1.0'),
    prop('FogQuality', 'Choice', 'Fog Quality', 'Raymarch quality: Low (12), Medium (24), High (40), or Ultra (64) samples.', 'Medium', {
      extraInformation: ['Low', 'Medium', 'High', 'Ultra']
    }),

    prop('EnableLightning', 'Boolean', 'Enable Thunder & Lightning', 'Thunderstorm lightning flashes.', 'false'),
    prop('LightningIntervalMin', 'Number', 'Lightning Min Interval', 'Minimum delay between strikes.', '8.0'),
    prop('LightningIntervalMax', 'Number', 'Lightning Max Interval', 'Maximum delay between strikes.', '22.0'),
    prop('LightningFlashColor', 'Color', 'Lightning Flash Color', 'Flash illumination color.', '220;235;255'),
    prop('LightningIntensity', 'Number', 'Lightning Intensity', 'Flash brightness multiplier.', '1.5'),

    prop('MistDensity', 'Number', 'Mist Density', 'Atmospheric volumetric mist density.', '0.0'),
    prop('MistColor', 'Color', 'Mist Color', 'Mist color tint.', '160;180;200')
  ],
  eventsFunctions: [
    ...makeLifecycle(WEATHER_OPTIONS),
    aSetWeatherType, aSetVolumeMode, aSetEnabled, aSetDebugBounds,
    aSetParticleDensity, aSetParticleSpeed, aSetParticleSize, aSetStreakLength, aSetStreakThickness, aSetParticleColor, aSetParticleOpacity,
    aSetWindSpeed, aSetWindDirection, aSetWindPitch, aSetWindTurbulence, aSetSway,
    aSetFloorSplashesEnabled, aSetSplashParams, aSetRippleStyle,
    aSetClusteredFogEnabled, aSetFogThickness, aSetFogHeightFalloff, aSetFogAnisotropy, aSetFogColor, aSetFogNoiseScale, aSetFogQuality,
    aSetLightningEnabled, aSetLightningInterval, aTriggerLightningFlash,
    cIsWeatherActive, cIsLightningFlashing, cIsPointInsideVolume, cIsObjectInsideVolume, cWeatherTypeIs,
    eWeatherType, eParticleDensity, eParticleSpeed, eStreakThickness, eWindSpeed, eWindDirection, eWindPitch,
    eFogThickness, eFogDensityAt, eLightningBrightness, eTimeSinceLastLightning,
    eVolumeWidth, eVolumeHeight, eVolumeDepth
  ],
};

/* ========================================================= 7. WeatherShelter3D Behavior */

const SHELTER_OPTIONS = `{
  enabled: behavior._getShelterEnabled ? behavior._getShelterEnabled() : true,
  splashOnRoof: behavior._getSplashOnRoof ? behavior._getSplashOnRoof() : true
}`;

const shelterLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.registerShelter(runtimeScene, object, behavior, ${SHELTER_OPTIONS});\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.stepShelter(runtimeScene, object, behavior);\n`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `AW.disposeShelter(runtimeScene, behavior);\n`),
  },
];

const G_SHELTER = 'Shelter Controls';

const shelterActions = [
  fn('SetShelterEnabled', 'Enable weather shelter',
    'Set weather shelter on _PARAM0_ enabled: _PARAM2_',
    'Turn weather occlusion on or off for this roof/canopy.', 'Action',
    [bool('Enable', 'Enable shelter occlusion')],
    `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setShelterEnabled) behavior._setShelterEnabled(val);
AW.updateShelter(runtimeScene, behavior, { enabled: val });
`, { group: G_SHELTER }),

  fn('SetSplashOnRoof', 'Enable roof splashes',
    'Set roof splashes on _PARAM0_: _PARAM2_',
    'Toggle whether raindrops splash on top of this shelter roof.', 'Action',
    [bool('Enable', 'Enable roof splashes')],
    `const val = eventsFunctionContext.getArgument("Enable");
if (behavior._setSplashOnRoof) behavior._setSplashOnRoof(val);
AW.updateShelter(runtimeScene, behavior, { splashOnRoof: val });
`, { group: G_SHELTER }),
];

const shelterConditions = [
  fn('IsShelterEnabled', 'Is shelter enabled',
    '_PARAM0_ is actively shielding weather',
    'Returns true if this shelter is actively blocking precipitation.', 'Condition',
    [],
    `const shelter = AW.shelterOf(runtimeScene, behavior);
eventsFunctionContext.returnValue = !!(shelter && shelter.enabled);
`, { group: G_SHELTER }),
];

const weatherShelterBehavior = {
  name: 'WeatherShelter3D',
  fullName: 'Weather Shelter 3D (Roof & Canopy Occlusion)',
  description: 'Attach to any 3D Object (roof, ceiling, bridge, tent, umbrella). Blocks weather precipitation above it so raindrops and snow do not pass into dry interior spaces.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ShelterEnabled', 'Boolean', 'Shelter Enabled', 'Actively blocks falling precipitation.', 'true'),
    prop('SplashOnRoof', 'Boolean', 'Splash on Roof', 'Spawn rain splashes on the roof surface upon impact.', 'true'),
  ],
  eventsFunctions: [
    ...shelterLifecycle,
    ...shelterActions,
    ...shelterConditions,
  ],
};

/* ========================================================= 8. Global Free Functions */

const G_GLOBAL = 'Global Weather Controls';

const globalFunctions = [
  freeFn('SetGlobalWind', 'Set global wind',
    'Set global weather wind (Speed: _PARAM0_, Direction: _PARAM1_ degrees)',
    'Set global wind speed and direction affecting all weather volumes in the scene.', 'Action',
    [
      num('Speed', 'Global wind speed', '0'),
      num('Direction', 'Global wind direction in degrees', '45')
    ],
    `const spd = eventsFunctionContext.getArgument("Speed");
const dir = eventsFunctionContext.getArgument("Direction");
AW.setGlobalWind(runtimeScene, spd, dir);
`, { group: G_GLOBAL }),

  freeFn('SetGlobalSpeedMultiplier', 'Set global weather simulation speed',
    'Set global weather simulation speed multiplier to _PARAM0_',
    'Speed up, slow down, or freeze weather simulation across all volumes (1.0 = normal, 0.0 = pause).', 'Action',
    [num('Multiplier', 'Speed multiplier factor', '1.0')],
    `const mult = eventsFunctionContext.getArgument("Multiplier");
AW.setGlobalSpeedMultiplier(runtimeScene, mult);
`, { group: G_GLOBAL }),

  freeFn('GlobalWindSpeed', 'Global wind speed',
    '', 'Returns the global wind speed offset.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AW.getGlobalWindSpeed(runtimeScene);
`, { group: G_GLOBAL, expressionType: 'number' }),

  freeFn('GlobalWindDirection', 'Global wind direction',
    '', 'Returns the global wind direction in degrees.', 'Expression',
    [],
    `eventsFunctionContext.returnValue = AW.getGlobalWindDirection(runtimeScene);
`, { group: G_GLOBAL, expressionType: 'number' }),
];

/* ========================================================= Extension Output */

const extension = {
  name: 'AdvancedWeather3D',
  fullName: 'Advanced Weather 3D',
  version: '1.3.0',
  author: 'Twillion',
  category: 'Visual effect',
  shortDescription: 'Modular 3D rain, snow, fog, hail, embers, dust and shelter effects for bounded or follow-camera weather zones.',
  description: 'Attach dedicated RainVolume3D, SnowVolume3D, ClusteredFogVolume3D, HailVolume3D, EmbersVolume3D, DustVolume3D, or universal WeatherVolume3D behaviors to a 3D Box or 3D Object. Features velocity-aligned streaks, vector-combined local/global wind, floor and roof splashes, hail rebounds, fluttering snow, raymarched volumetric fog with adjustable quality, shared lightning illumination, and WeatherShelter3D roof occlusion.',
  iconUrl,
  tags: ['3D', 'weather', 'rain', 'snow', 'hail', 'storm', 'particles', 'lightning', 'fog', 'volumetric', 'embers', 'dust', 'sand'],
  eventsFunctions: [...globalFunctions],
  eventsBasedBehaviors: [
    rainVolumeBehavior,
    snowVolumeBehavior,
    clusteredFogVolumeBehavior,
    hailVolumeBehavior,
    embersVolumeBehavior,
    dustVolumeBehavior,
    universalWeatherVolumeBehavior,
    weatherShelterBehavior,
  ],
};

const outputPath = path.join(here, 'AdvancedWeather3D.json');
fs.writeFileSync(outputPath, JSON.stringify(extension, null, 2), 'utf8');

console.log(`Successfully compiled ${outputPath} with 8 modular behaviors!`);
