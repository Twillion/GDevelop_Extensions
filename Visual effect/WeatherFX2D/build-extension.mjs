/**
 * build-extension.mjs
 * Compiles WeatherFX2D.json from the runtime engine + behavior & function declarations.
 *
 * Run:   node WeatherFX2D/build-extension.mjs
 * Check: node WeatherFX2D/build-extension.mjs --check   (fails if the committed JSON is stale)
 */

import fs from 'node:fs';
import { effectActions } from './effect-actions.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'WeatherFX2D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__weatherFX2D';

const EFFECT_TYPES = ['Snow', 'Rain', 'Fog', 'Embers', 'Ripples'];
const DISTORTION_MODES = ['Heat Haze', 'Underwater', 'Ripples Only',
  'Heat Shimmer', 'Tear Lines', 'Magnifier Band'];
const ANCHORING = ['World', 'Screen'];

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
const layerParam = (name, description) => ({
  name, type: 'layer', description: description.replace(/ \(leave empty for the base layer\)/i, '')
    + ' (empty = base layer)',
});
const choice = (name, description, options) => ({
  name, type: 'stringWithSelector', description, defaultValue: options[0],
  supplementaryInformation: JSON.stringify(options),
});

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});
const choiceProp = (name, label, description, value, options) =>
  prop(name, 'Choice', label, description, value, { extraInformation: options });

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

const BEHAVIOR_PREAMBLE = `const __wfxObjects = eventsFunctionContext.getObjects("Object");
const object = __wfxObjects.length ? __wfxObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const WFX = ${NS};
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
  // GDevelop reserves parameter 0 for the scene in free functions.
  // Declarations use array indices; serialize the engine's one-based sentence slots.
  sentence: sentence.replace(/_PARAM(\d+)_/g, (_, index) => `_PARAM${Number(index) + 1}_`),
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters,
  events: evFree(`if (!${NS}) return;\nconst WFX = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const lifecycle = (name, code, opts = {}) => ({
  name, fullName: name, description: '', functionType: 'Action',
  private: true, parameters: [...OB],
  events: ev(BEHAVIOR_PREAMBLE + code, opts),
});

/* ========================================================= 1. WeatherEmitter2D Behavior */

/**
 * The options object every emitter entry point builds.
 *
 * `EffectUseTypeDefaults` is the whole ergonomic story of this behavior. When it is on, every
 * look-and-motion getter is skipped and `undefined` is sent instead - and the runtime's
 * `normalizeEmitterOptions` falls back to the preset for exactly those fields. So switching Effect
 * Type from Snow to Rain in the panel actually produces rain, rather than snow-shaped numbers with
 * a rain label. Turn it off and every number below becomes live.
 *
 * The five fields above the `read()` calls are read unconditionally: which layer, on or off, how
 * much, where it draws. Those are meaningful whichever mode you are in, and having to disable the
 * presets just to thin the snow out would be a silly tax.
 */
const EMITTER_OPTIONS = `(function () {
  const useTypeDefaults = behavior._getEffectUseTypeDefaults
    ? behavior._getEffectUseTypeDefaults() : true;
  const read = function (propertyName, fallback) {
    if (useTypeDefaults) return undefined;
    const getter = behavior['_get' + propertyName];
    return typeof getter === 'function' ? getter.call(behavior) : fallback;
  };
  const always = function (propertyName, fallback) {
    const getter = behavior['_get' + propertyName];
    return typeof getter === 'function' ? getter.call(behavior) : fallback;
  };
  return {
    type: always('EffectType', 'Snow'),
    layerName: always('EffectLayer', ''),
    enabled: always('EffectEnabled', true),
    intensity: always('EffectIntensity', 1),
    anchoring: always('PlacementAnchoring', 'World'),
    zOrder: always('PlacementDrawOrder', 1000),
    pixelSnap: always('PlacementPixelSnap', false),

    color: read('LookColor', '255;255;255'),
    opacity: read('LookOpacity', 210),
    additive: read('LookAdditive', false),
    softness: read('LookSoftness', 0),

    minSpeed: read('MotionMinSpeed', 35),
    maxSpeed: read('MotionMaxSpeed', 95),
    windAngle: read('MotionWindAngle', 90),
    windSpread: read('MotionWindSpread', 14),
    gustStrength: read('MotionGustStrength', 0.3),
    swayAmount: read('MotionSwayAmount', 16),
    swaySpeed: read('MotionSwaySpeed', 55),

    density: read('ParticleDensity', 220),
    minSize: read('ParticleMinSize', 2),
    maxSize: read('ParticleMaxSize', 5),
    depthVariation: read('ParticleDepthVariation', 0.6),

    streakWidth: read('RainStreakWidth', 2),
    streakLength: read('RainStreakLength', 0),

    splashAmount: read('RingSpawnRate', 26),
    splashMinRadius: read('RingMinRadius', 5),
    splashMaxRadius: read('RingMaxRadius', 13),
    splashLife: read('RingLifetime', 0.45)
  };
})()`;

const G_EM_EFFECT = 'Effect | Start here';
const G_EM_LOOK = 'Look | Custom settings';
const G_EM_MOTION = 'Motion | Custom settings';
const G_EM_PARTICLES = 'Particles | Custom settings';
const G_EM_PLACEMENT = 'Placement';
const G_EM_RAIN = 'Rain streaks | Custom settings';
const G_EM_RINGS = 'Water rings & rain splashes | Custom settings';

const emitterBehavior = {
  name: 'WeatherEmitter2D',
  fullName: 'Weather Emitter 2D',
  description:
    'Fills the view with weather particles that stay put in the world while the camera moves, at any '
    + 'position on the map and at any zoom. Attach it to any one object - the object is only a home '
    + 'for the settings and is never drawn as weather - then pick an Effect Type and press play. '
    + 'Sizes are in screen pixels and speeds in screen pixels per second, so the look holds through a '
    + 'zoom change.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    choiceProp('EffectType', 'Effect type',
      'Which weather to draw. Each type carries a complete built-in look, so this alone is enough to '
      + 'get a good result. Ripples is the odd one out: nothing falls, and the effect is expanding '
      + 'rings drawn on the water - use it for a pond surface, or put it on your player and spawn '
      + 'rings by hand as they wade.', 'Snow', EFFECT_TYPES),
    prop('EffectUseTypeDefaults', 'Boolean', 'Use built-in settings for this type',
      'ON (default): every Look, Motion, Particles and Rain setting below is ignored, and the built-in '
      + 'look for the chosen Effect Type is used instead - so switching Effect Type just works. '
      + 'Turn this OFF to author those numbers yourself. Effect layer, Enabled, Intensity and the '
      + 'whole Placement group always apply either way.', 'true'),
    prop('EffectLayer', 'String', 'Effect layer',
      'Name of the layer to draw the weather on. Leave EMPTY for the base layer. The weather is drawn '
      + 'inside that layer, so it scrolls, zooms and rotates with it.', ''),
    prop('EffectEnabled', 'Boolean', 'Enabled',
      'Turn the weather off without removing the behavior. Particles are hidden, not destroyed, so '
      + 'switching back on is instant.', 'true'),
    prop('EffectIntensity', 'Number', 'Intensity',
      'Multiplies how many particles are drawn. 1 = the normal amount, 0.5 = half, 0 = none. This is '
      + 'the setting to animate for a storm building or dying down - it works whether or not the '
      + 'built-in settings are in use.', '1'),

    prop('LookColor', 'Color', 'Colour', 'Tint applied to every particle.', '255;255;255'),
    prop('LookOpacity', 'Number', 'Opacity (0-255)',
      'Overall opacity of the whole field. Individual particles also vary slightly around this.', '210'),
    prop('LookAdditive', 'Boolean', 'Additive blending',
      'Blend particles by adding light instead of covering what is behind. Right for embers, sparks '
      + 'and fireflies; wrong for snow, which should hide what it passes in front of.', 'false'),
    prop('LookSoftness', 'Number', 'Softness (0-1)',
      '0 draws a crisp square - the correct choice for pixel art, and the cheapest to draw. Raise it '
      + 'toward 1 for a soft round particle with a faded edge.', '0'),

    prop('MotionMinSpeed', 'Number', 'Minimum speed (px/s)',
      'Slowest particle, in SCREEN pixels per second.', '35'),
    prop('MotionMaxSpeed', 'Number', 'Maximum speed (px/s)',
      'Fastest particle, in SCREEN pixels per second.', '95'),
    prop('MotionWindAngle', 'Number', 'Wind angle (degrees)',
      'Direction of travel, in GDevelop angles: 0 is right, 90 is straight down, 270 is straight up.', '90'),
    prop('MotionWindSpread', 'Number', 'Wind spread (degrees)',
      'How far individual particles may deviate from the wind angle. 0 makes every particle travel on '
      + 'exactly the same line, which reads as artificial.', '14'),
    prop('MotionGustStrength', 'Number', 'Gust strength (0-1)',
      'Slow wandering of the wind direction over time. Two rates that do not divide into each other '
      + 'are mixed, so the gust never settles into an audible loop.', '0.3'),
    prop('MotionSwayAmount', 'Number', 'Sway distance (px)',
      'How far a particle drifts from side to side across its direction of travel. This is what makes '
      + 'snow read as snow rather than as falling dots.', '16'),
    prop('MotionSwaySpeed', 'Number', 'Sway speed',
      'How quickly each particle sways. Every particle gets its own slight variation on this.', '55'),

    prop('ParticleDensity', 'Number', 'Density (particles on screen)',
      'How many particles are visible on one screenful. The stored count is scaled up automatically '
      + 'to cover the off-screen margin, so this number means the same thing at any resolution or zoom.', '220'),
    prop('ParticleMinSize', 'Number', 'Minimum size (px)',
      'Smallest particle, in SCREEN pixels.', '2'),
    prop('ParticleMaxSize', 'Number', 'Maximum size (px)',
      'Largest particle, in SCREEN pixels.', '5'),
    prop('ParticleDepthVariation', 'Number', 'Depth variation (0-1)',
      'How strongly distant particles are made smaller, slower AND fainter together. One number '
      + 'driving all three is what reads as depth; varying them separately just reads as noise.', '0.6'),

    choiceProp('PlacementAnchoring', 'Anchoring',
      'World (default): particles hold their place on the map, so moving the camera moves past them - '
      + 'this is what makes weather feel part of the scene. Screen: particles hold their place on the '
      + 'display and travel with the camera, like a HUD overlay. Water rings and rain splashes always remain at their world positions.', 'World', ANCHORING),
    prop('PlacementDrawOrder', 'Number', 'Draw order (Z order)',
      'Z order of the weather within its layer. Higher draws in front. The default of 1000 puts it in '
      + 'front of ordinary scene objects.', '1000'),
    prop('PlacementPixelSnap', 'Boolean', 'Snap to whole pixels',
      'Round every particle to a whole screen pixel. Keeps a pixel-art game crisp, but slow particles '
      + 'will visibly step rather than glide.', 'false'),

    prop('RainStreakWidth', 'Number', 'Rain streak width (px)',
      'Thickness of a raindrop. Only used when Effect Type is Rain.', '2'),
    prop('RainStreakLength', 'Number', 'Rain streak length (px)',
      'Length of a raindrop. Leave at 0 to derive it from each drop\'s own speed, so fast drops streak '
      + 'longer than slow ones. Only used when Effect Type is Rain.', '0'),
    prop('RingSpawnRate', 'Number', 'Rings per second',
      'Expanding rings seeded across the visible area each second. These are rain splashes when '
      + 'Effect Type is Rain, and the whole effect when it is Ripples. Set to 0 for none - you can '
      + 'still spawn rings on demand with the actions.', '26'),
    prop('RingMinRadius', 'Number', 'Ring minimum radius (px)',
      'Smallest a ring grows to before it fades out.', '5'),
    prop('RingMaxRadius', 'Number', 'Ring maximum radius (px)',
      'Largest a ring grows to before it fades out.', '13'),
    prop('RingLifetime', 'Number', 'Ring lifetime (seconds)',
      'How long a ring takes to expand and fade away.', '0.45'),
  ],
  eventsFunctions: [
    lifecycle('onCreated', `WFX.registerEmitter(runtimeScene, behavior, ${EMITTER_OPTIONS});\n`,
      { withRuntime: true }),
    lifecycle('doStepPreEvents', `WFX.stepEmitter(runtimeScene, behavior, ${EMITTER_OPTIONS});\n`),
    lifecycle('onDestroy', `WFX.disposeEmitter(runtimeScene, behavior);\n`),

    fn('SetEnabled', 'Enable / disable this weather',
      'Set weather on _PARAM0_ enabled: _PARAM2_',
      'Turn this emitter on or off. Particles are hidden rather than destroyed, so turning it back on '
      + 'is instant and the field does not have to refill.', 'Action',
      [bool('Enabled', 'Enabled')],
      `const enabled = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEffectEnabled) behavior._setEffectEnabled(enabled);
`, { group: 'Weather Emitter' }),

    fn('SetIntensity', 'Set weather intensity',
      'Set weather intensity of _PARAM0_ to _PARAM2_',
      'Set how much weather is drawn, as a multiplier of the density. 0 is none, 1 is normal. Tween '
      + 'this to build a storm up or let it die away.', 'Action',
      [num('Intensity', 'Intensity multiplier (0 = none, 1 = normal)', '1')],
      `const intensity = eventsFunctionContext.getArgument("Intensity");
if (behavior._setEffectIntensity) behavior._setEffectIntensity(intensity);
`, { group: 'Weather Emitter' }),

    fn('SetWind', 'Set wind',
      'Set wind of _PARAM0_ to angle _PARAM2_ degrees, spread _PARAM3_',
      'Set the direction particles travel and how far individual particles may deviate from it. '
      + 'Angles follow GDevelop: 0 is right, 90 is straight down. This needs "Use built-in settings '
      + 'for this type" switched OFF, otherwise the built-in wind is used instead.', 'Action',
      [num('Angle', 'Wind angle in degrees (0 = right, 90 = down)', '90'),
        num('Spread', 'Spread in degrees', '14')],
      `const angle = eventsFunctionContext.getArgument("Angle");
const spread = eventsFunctionContext.getArgument("Spread");
if (behavior._setMotionWindAngle) behavior._setMotionWindAngle(angle);
if (behavior._setMotionWindSpread) behavior._setMotionWindSpread(spread);
`, { group: 'Weather Emitter' }),

    fn('ApplyTypePreset', 'Copy a built-in look into the settings',
      'Configure _PARAM0_ with built-in settings: _PARAM2_',
      'Writes the built-in numbers for one effect type into this behavior\'s own Look, Motion, '
      + 'Particles and Rain properties, and switches "Use built-in settings" OFF. Use it as a starting '
      + 'point you then edit, instead of authoring 15 numbers from scratch. Runtime only - the values '
      + 'shown in the editor panel do not change.', 'Action',
      [choice('Type', 'Effect type to copy from', EFFECT_TYPES)],
      `const typeName = eventsFunctionContext.getArgument("Type");
const preset = WFX.getPreset(typeName);
if (behavior._setEffectType) behavior._setEffectType(typeName);
if (behavior._setEffectUseTypeDefaults) behavior._setEffectUseTypeDefaults(false);
if (behavior._setLookOpacity) behavior._setLookOpacity(preset.opacity);
if (behavior._setLookAdditive) behavior._setLookAdditive(preset.additive);
if (behavior._setLookSoftness) behavior._setLookSoftness(preset.softness);
if (behavior._setMotionMinSpeed) behavior._setMotionMinSpeed(preset.minSpeed);
if (behavior._setMotionMaxSpeed) behavior._setMotionMaxSpeed(preset.maxSpeed);
if (behavior._setMotionWindAngle) behavior._setMotionWindAngle(preset.windAngle);
if (behavior._setMotionWindSpread) behavior._setMotionWindSpread(preset.windSpread);
if (behavior._setMotionGustStrength) behavior._setMotionGustStrength(preset.gustStrength);
if (behavior._setMotionSwayAmount) behavior._setMotionSwayAmount(preset.swayAmount);
if (behavior._setMotionSwaySpeed) behavior._setMotionSwaySpeed(preset.swaySpeed);
if (behavior._setParticleDensity) behavior._setParticleDensity(preset.density);
if (behavior._setParticleMinSize) behavior._setParticleMinSize(preset.minSize);
if (behavior._setParticleMaxSize) behavior._setParticleMaxSize(preset.maxSize);
if (behavior._setParticleDepthVariation) behavior._setParticleDepthVariation(preset.depthVariation);
if (behavior._setRainStreakWidth) behavior._setRainStreakWidth(preset.streakWidth);
if (behavior._setRainStreakLength) behavior._setRainStreakLength(preset.streakLength);
if (behavior._setRingSpawnRate) behavior._setRingSpawnRate(preset.splashAmount);
if (behavior._setRingMinRadius) behavior._setRingMinRadius(preset.splashMinRadius);
if (behavior._setRingMaxRadius) behavior._setRingMaxRadius(preset.splashMaxRadius);
if (behavior._setRingLifetime) behavior._setRingLifetime(preset.splashLife);
`, { group: 'Weather Emitter' }),

    fn('SpawnRingHere', 'Spawn a water ring at this object',
      'Spawn a water ring on _PARAM0_ at its own position; size: _PARAM2_',
      'Draw one expanding ring centred on the object carrying this behavior. This is the drawn-ring '
      + 'kind, sitting on top of the water - not the shader kind that bends the image. Put the '
      + 'behavior on your player and call this as each footstep lands in shallow water.', 'Action',
      [num('Size', 'Size multiplier (1 = the configured radius)', '1')],
      `const ringSize = eventsFunctionContext.getArgument("Size");
WFX.spawnParticleRipple(runtimeScene, behavior,
  object.getCenterXInScene(), object.getCenterYInScene(), ringSize);
`, { group: 'Weather Emitter' }),

    fn('SpawnRingAt', 'Spawn a water ring at a position',
      'Spawn a water ring on _PARAM0_ at _PARAM2_ ; _PARAM3_ with size _PARAM4_',
      'Draw one expanding ring at a point in SCENE coordinates - the same numbers Object.X() and '
      + 'CursorX() give you. The ring stays over that spot on the map while the camera moves.',
      'Action',
      [num('X', 'Scene X coordinate', '0'), num('Y', 'Scene Y coordinate', '0'),
        num('Size', 'Size multiplier (1 = the configured radius)', '1')],
      `const ringX = eventsFunctionContext.getArgument("X");
const ringY = eventsFunctionContext.getArgument("Y");
const ringSize = eventsFunctionContext.getArgument("Size");
WFX.spawnParticleRipple(runtimeScene, behavior, ringX, ringY, ringSize);
`, { group: 'Weather Emitter' }),

    fn('IsEnabled', 'Weather is enabled',
      'Weather on _PARAM0_ is enabled',
      'Check whether this emitter is currently drawing.', 'Condition',
      [],
      `eventsFunctionContext.returnValue = behavior._getEffectEnabled
  ? !!behavior._getEffectEnabled() : false;
`, { group: 'Weather Emitter' }),

    fn('ParticleCount', 'Live particle count',
      '', 'Number of particles this emitter currently holds, including the off-screen margin. Useful '
      + 'for checking the cost of a density setting.', 'Expression',
      [],
      `eventsFunctionContext.returnValue = WFX.getParticleCount(runtimeScene, behavior);
`, { group: 'Weather Emitter', expressionType: 'number' }),
  ],
};

/* ========================================================= 2. ScreenDistortion2D Behavior */

const DISTORTION_OPTIONS = `(function () {
  const useModeDefaults = behavior._getEffectUseModeDefaults
    ? behavior._getEffectUseModeDefaults() : true;
  const read = function (propertyName, fallback) {
    if (useModeDefaults) return undefined;
    const getter = behavior['_get' + propertyName];
    return typeof getter === 'function' ? getter.call(behavior) : fallback;
  };
  const always = function (propertyName, fallback) {
    const getter = behavior['_get' + propertyName];
    return typeof getter === 'function' ? getter.call(behavior) : fallback;
  };
  return {
    mode: always('EffectMode', 'Heat Haze'),
    layerName: always('EffectLayer', ''),
    enabled: always('EffectEnabled', true),
    intensity: always('EffectIntensity', 1),
    worldFollow: always('PlacementWorldFollow', 1),

    strength: read('WaveStrength', 4),
    wavelengthX: read('WaveLengthX', 160),
    wavelengthY: read('WaveLengthY', 55),
    speed: read('WaveSpeed', 1.1),
    detail: read('WaveDetail', 0.4),

    riseSpeed: read('HeatRiseSpeed', 1.6),
    horizonFade: read('HeatHorizonFade', 0.55),

    rippleStrength: read('RippleStrength', 8),
    rippleSpeed: read('RippleSpeed', 260),
    rippleLife: read('RippleLife', 1.6),
    rippleWidth: read('RippleWidth', 30),

    tearStrength: read('TearStrength', 7),
    tearWidth: read('TearWidth', 0.35),
    tearStripHeight: read('TearStripHeight', 4),

    magnification: read('MagnifierAmount', 1.35),
    bandWidth: read('MagnifierBandWidth', 70)
  };
})()`;

const G_DI_EFFECT = 'Effect | Start here';
const G_DI_HEAT = 'Heat haze only | Custom settings';
const G_DI_PLACEMENT = 'Placement';
const G_DI_RIPPLES = 'Ripples | Custom settings';
const G_DI_WAVE = 'Wave | Custom settings';
const G_DI_TEAR = 'Tear lines only | Custom settings';
const G_DI_MAG = 'Magnifier band only | Custom settings';

const distortionBehavior = {
  name: 'ScreenDistortion2D',
  fullName: 'Screen Distortion 2D (heat haze / underwater / ripples)',
  description:
    'Bends the whole layer with a shader - rising heat shimmer, an underwater wobble, or expanding '
    + 'ripples you spawn where something hits the water. Attach it to any one object; the object is '
    + 'only a home for the settings. Strength and wavelength are in real screen pixels and stay that '
    + 'way regardless of what is on the layer, which is what stops the effect jumping in size as you '
    + 'move around the map.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    choiceProp('EffectMode', 'Mode',
      'Heat Haze shimmers sideways in short fast waves and fades toward the top of the screen. '
      + 'Underwater swims slowly on both axes with a long wavelength. Heat Shimmer is the turbulent '
      + 'cousin of Heat Haze, built from fractal noise instead of a sine, and reads as real rising '
      + 'air. Tear Lines slices the screen into hard-edged strips that jump sideways, which suits '
      + 'pixel art and glitch effects. Magnifier Band scrolls a lens down the screen that stretches '
      + 'whatever passes through it. Ripples Only leaves the standing wave off entirely, so nothing '
      + 'moves until you spawn a ripple.', 'Heat Haze', DISTORTION_MODES),
    prop('EffectUseModeDefaults', 'Boolean', 'Use built-in settings for this mode',
      'ON (default): every Wave, Heat haze and Ripple setting below is ignored and the built-in look '
      + 'for the chosen Mode is used, so switching Mode just works. Turn this OFF to author the numbers '
      + 'yourself. Effect layer, Enabled, Intensity and Anchoring always apply either way.', 'true'),
    prop('EffectLayer', 'String', 'Effect layer',
      'Name of the layer to distort. Leave EMPTY for the base layer. Everything drawn on that layer is '
      + 'bent, including objects; anything on another layer is untouched.', ''),
    prop('EffectEnabled', 'Boolean', 'Enabled',
      'Turn the distortion off without removing it. The shader stays attached and stops running, so '
      + 'switching back on costs nothing.', 'true'),
    prop('EffectIntensity', 'Number', 'Intensity',
      'Multiplies the displacement. 0 is completely flat, 1 is the normal amount. This is the setting '
      + 'to tween when the player enters or leaves water.', '1'),

    prop('HeatRiseSpeed', 'Number', 'Heat rise speed',
      'How fast the shimmer scrolls upward. Only used in Heat Haze mode.', '1.6'),
    prop('HeatHorizonFade', 'Number', 'Fade toward top (0-1)',
      '0 shimmers evenly over the whole screen. 1 shimmers only along the bottom and fades out '
      + 'completely at the top, which reads as heat coming off the ground. Only used in Heat Haze mode.', '0.55'),

    prop('PlacementWorldFollow', 'Number', 'World anchoring (0-1)',
      '1 (default) anchors the distortion pattern to the map as the camera moves. '
      + '0 attaches it to the screen. Intermediate values give partial camera following. '
      + 'Spawned ripple centres always stay at their world positions.', '1'),

    prop('RippleStrength', 'Number', 'Ripple strength (px)',
      'How far a ripple pushes the image outward at the ring, in screen pixels.', '8'),
    prop('RippleSpeed', 'Number', 'Ripple expansion speed (px/s)',
      'How fast a ripple ring grows outward from where it was spawned.', '260'),
    prop('RippleLife', 'Number', 'Ripple lifetime (seconds)',
      'How long a ripple lasts before it has faded to nothing.', '1.6'),
    prop('RippleWidth', 'Number', 'Ripple ring thickness (px)',
      'Thickness of the moving ring. Wider is softer and more like a swell; narrower is sharper and '
      + 'more like a raindrop.', '30'),

    prop('WaveStrength', 'Number', 'Wave strength (px)',
      'Maximum displacement of the standing wave, in SCREEN pixels. This is a real pixel count and '
      + 'stays a real pixel count no matter what is on the layer.', '4'),
    prop('WaveLengthX', 'Number', 'Wavelength across (px)',
      'Distance in screen pixels between wave crests measured horizontally.', '160'),
    prop('WaveLengthY', 'Number', 'Wavelength down (px)',
      'Distance in screen pixels between wave crests measured vertically. Short values here make the '
      + 'tight horizontal banding that reads as heat. In Tear Lines mode this is the distance between '
      + 'tears; in Magnifier Band mode it is the distance between passes of the lens.', '55'),
    prop('WaveSpeed', 'Number', 'Wave speed',
      'How fast the wave animates. Each harmonic keeps its own phase, folded to one turn, so this can '
      + 'run for hours without drifting or popping.', '1.1'),
    prop('WaveDetail', 'Number', 'Secondary detail (0-1)',
      'Strength of a second, faster wave mixed on top so the motion does not look like one mechanical '
      + 'wobble. In Heat Shimmer mode this is how much each row is offset from its neighbours '
      + 'instead, which is what stops the noise sliding as one flat sheet.', '0.4'),

    prop('TearStrength', 'Number', 'Tear line offset (px)',
      'How far a strip jumps sideways, in screen pixels. This is a hard jump, not a gradient - the '
      + 'whole strip moves together. Only used in Tear Lines mode.', '7'),
    prop('TearWidth', 'Number', 'Tear line coverage (0-1)',
      'What fraction of each cycle is inside a tear. 0.5 means half the screen is offset at any '
      + 'moment; small values give occasional thin slices. Only used in Tear Lines mode.', '0.35'),
    prop('TearStripHeight', 'Number', 'Tear strip height (px)',
      'Quantises tear edges into strips this tall, so they stair-step like pixel art instead of '
      + 'cutting on a smooth line. Set to 0 for smooth edges. Only used in Tear Lines mode.', '4'),

    prop('MagnifierAmount', 'Number', 'Magnification',
      'How much the band stretches what passes through it. 1 is no change, 1.35 is a gentle bulge, '
      + '2 is a strong lens. Below 1 pinches instead. Only used in Magnifier Band mode.', '1.35'),
    prop('MagnifierBandWidth', 'Number', 'Band thickness (px)',
      'How tall the lens band is. The magnification falls off smoothly to nothing at this distance '
      + 'from the band centre. Only used in Magnifier Band mode.', '70'),
  ],
  eventsFunctions: [
    lifecycle('onCreated', `WFX.registerDistortion(runtimeScene, behavior, ${DISTORTION_OPTIONS});\n`,
      { withRuntime: true }),
    lifecycle('doStepPreEvents', `WFX.stepDistortion(runtimeScene, behavior, ${DISTORTION_OPTIONS});\n`),
    lifecycle('onDestroy', `WFX.disposeDistortion(runtimeScene, behavior);\n`),

    fn('SetEnabled', 'Enable / disable this distortion',
      'Set distortion on _PARAM0_ enabled: _PARAM2_',
      'Turn the distortion on or off. The shader stays attached while off and costs nothing.', 'Action',
      [bool('Enabled', 'Enabled')],
      `const enabled = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEffectEnabled) behavior._setEffectEnabled(enabled);
`, { group: 'Screen Distortion' }),

    fn('SetIntensity', 'Set distortion intensity',
      'Set distortion intensity of _PARAM0_ to _PARAM2_',
      'Set how strongly the image is bent, as a multiplier. 0 is flat, 1 is normal. Tween this when '
      + 'the player enters or leaves water.', 'Action',
      [num('Intensity', 'Intensity multiplier (0 = flat, 1 = normal)', '1')],
      `const intensity = eventsFunctionContext.getArgument("Intensity");
if (behavior._setEffectIntensity) behavior._setEffectIntensity(intensity);
`, { group: 'Screen Distortion' }),

    fn('SpawnRippleHere', 'Spawn a ripple at this object',
      'Spawn a ripple on _PARAM0_ at its own position',
      'Start an expanding ripple centred on the object carrying this behavior. Good for footsteps in '
      + 'shallow water: put the behavior on the player and call this each time a step lands.', 'Action',
      [],
      `WFX.spawnRipple(runtimeScene, behavior, object.getCenterXInScene(), object.getCenterYInScene(), 1);
`, { group: 'Screen Distortion' }),

    fn('SpawnRippleAt', 'Spawn a ripple at a position',
      'Spawn a ripple on _PARAM0_ at _PARAM2_ ; _PARAM3_',
      'Start distortion on this layer first. Spawn an expanding ripple at scene coordinates - the same numbers Object.X() and '
      + 'CursorX() give you. The ripple stays over that spot on the map while the camera moves. Up to '
      + '12 can run at once; a thirteenth replaces the oldest.', 'Action',
      [num('X', 'Scene X coordinate', '0'), num('Y', 'Scene Y coordinate', '0')],
      `const rippleX = eventsFunctionContext.getArgument("X");
const rippleY = eventsFunctionContext.getArgument("Y");
WFX.spawnRipple(runtimeScene, behavior, rippleX, rippleY, 1);
`, { group: 'Screen Distortion' }),

    fn('ApplyModePreset', 'Copy a built-in look into the settings',
      'Configure _PARAM0_ with built-in settings: _PARAM2_',
      'Writes the built-in numbers for one mode into this behavior\'s own Wave, Heat haze and Ripple '
      + 'properties, and switches "Use built-in settings" OFF, so you have a working starting point to '
      + 'edit. Runtime only - the values shown in the editor panel do not change.', 'Action',
      [choice('Mode', 'Mode to copy from', DISTORTION_MODES)],
      `const modeName = eventsFunctionContext.getArgument("Mode");
const preset = WFX.getDistortionPreset(modeName);
if (behavior._setEffectMode) behavior._setEffectMode(modeName);
if (behavior._setEffectUseModeDefaults) behavior._setEffectUseModeDefaults(false);
if (behavior._setWaveStrength) behavior._setWaveStrength(preset.strength);
if (behavior._setWaveLengthX) behavior._setWaveLengthX(preset.wavelengthX);
if (behavior._setWaveLengthY) behavior._setWaveLengthY(preset.wavelengthY);
if (behavior._setWaveSpeed) behavior._setWaveSpeed(preset.speed);
if (behavior._setWaveDetail) behavior._setWaveDetail(preset.detail);
if (behavior._setHeatRiseSpeed) behavior._setHeatRiseSpeed(preset.riseSpeed);
if (behavior._setHeatHorizonFade) behavior._setHeatHorizonFade(preset.horizonFade);
if (behavior._setRippleStrength) behavior._setRippleStrength(preset.rippleStrength);
if (behavior._setRippleSpeed) behavior._setRippleSpeed(preset.rippleSpeed);
if (behavior._setRippleLife) behavior._setRippleLife(preset.rippleLife);
if (behavior._setRippleWidth) behavior._setRippleWidth(preset.rippleWidth);
if (behavior._setTearStrength) behavior._setTearStrength(preset.tearStrength);
if (behavior._setTearWidth) behavior._setTearWidth(preset.tearWidth);
if (behavior._setTearStripHeight) behavior._setTearStripHeight(preset.tearStripHeight);
if (behavior._setMagnifierAmount) behavior._setMagnifierAmount(preset.magnification);
if (behavior._setMagnifierBandWidth) behavior._setMagnifierBandWidth(preset.bandWidth);
`, { group: 'Screen Distortion' }),

    fn('IsEnabled', 'Distortion is enabled',
      'Distortion on _PARAM0_ is enabled',
      'Check whether this distortion is currently running.', 'Condition',
      [],
      `eventsFunctionContext.returnValue = behavior._getEffectEnabled
  ? !!behavior._getEffectEnabled() : false;
`, { group: 'Screen Distortion' }),

    fn('RippleCount', 'Live ripple count',
      '', 'How many ripples are currently animating on this distortion, out of a maximum of 12.',
      'Expression', [],
      `eventsFunctionContext.returnValue = WFX.getRippleCount(runtimeScene, behavior);
`, { group: 'Screen Distortion', expressionType: 'number' }),
  ],
};

/* ========================================================= 3. Free functions */

/**
 * GDevelop calls this by name on every scene load, ahead of that scene's own events. Installing the
 * runtime once here rather than prepending a copy to every JsCode block is the difference between a
 * ~1.5 MB extension and a ~250 KB one. Each behavior's onCreated keeps a copy as a fallback for the
 * case where an object is created before the scene's first frame; the runtime IIFE self-guards on
 * gdjs.__weatherFX2D, so the later installs are no-ops.
 */
const runtimeInstaller = {
  name: 'onSceneLoaded',
  fullName: '',
  description: 'Installs the WeatherFX2D runtime engine (internal).',
  sentence: '',
  functionType: 'Action',
  private: true,
  parameters: [],
  events: evFree('', { withRuntime: true }),
};

const G_WEATHER = 'Advanced / Shared weather controls';
const G_DISTORT = 'Advanced / Shared distortion controls';
const G_GLOBAL = 'Global';

// Keep the event selectors in sync with the runtime's supported settings.
const settingLabels = (mapName) => {
  const block = runtime.match(new RegExp(String.raw`var ${mapName} = \{([\s\S]*?)\n  \};`));
  if (!block) throw new Error('Missing runtime settings map: ' + mapName);
  return [...block[1].matchAll(/'([^']+)':/g)].map((match) => match[1]);
};

const freeActions = [
  freeFn('StartWeather', 'Start weather on a layer',
    'Start weather on layer _PARAM0_; type: _PARAM1_; intensity: _PARAM2_',
    'Start snow, rain, fog, embers or water rings with a built-in look. No object or behavior is needed. Once started it '
    + 'keeps running on its own - there is no "update every frame" action to remember. Calling it '
    + 'again on the same layer changes the running weather rather than stacking a second one.',
    'Action',
    [layerParam('Layer', 'Layer to draw the weather on (leave empty for the base layer)'),
      choice('Type', 'Weather type', EFFECT_TYPES),
      num('Intensity', 'Intensity multiplier (0 = none, 1 = normal)', '1')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const type = eventsFunctionContext.getArgument("Type");
const intensity = eventsFunctionContext.getArgument("Intensity");
WFX.startWeather(runtimeScene, layerName, {
  layerName: layerName,
  type: type,
  intensity: intensity,
  enabled: true
});
`, { group: G_WEATHER, withRuntime: true }),

  freeFn('SetWeatherIntensity', 'Set weather intensity on a layer',
    'Set weather intensity on layer _PARAM0_ to _PARAM1_',
    'Change how much weather is drawn without restarting it. 0 is none, 1 is normal. Tween this to '
    + 'build a storm up or let it fade out.', 'Action',
    [layerParam('Layer', 'Layer the weather is on'),
      num('Intensity', 'Intensity (0 = hidden, 1 = full effect)', '1')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const intensity = eventsFunctionContext.getArgument("Intensity");
WFX.startWeather(runtimeScene, layerName, { layerName: layerName, intensity: intensity });
`, { group: G_WEATHER }),

  freeFn('SetWeatherWind', 'Set weather wind on a layer',
    'Set wind on layer _PARAM0_ to angle _PARAM1_ degrees, spread _PARAM2_',
    'Change the direction the weather travels. Angles follow GDevelop: 0 is right, 90 is straight '
    + 'down, 270 is straight up.', 'Action',
    [layerParam('Layer', 'Layer the weather is on'),
      num('Angle', 'Wind angle in degrees (0 = right, 90 = down)', '90'),
      num('Spread', 'Spread in degrees', '14')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const angle = eventsFunctionContext.getArgument("Angle");
const spread = eventsFunctionContext.getArgument("Spread");
WFX.startWeather(runtimeScene, layerName, {
  layerName: layerName, windAngle: angle, windSpread: spread
});
`, { group: G_WEATHER }),

  freeFn('SetWeatherColor', 'Set weather colour on a layer',
    'Set weather on layer _PARAM0_ to colour _PARAM1_ with opacity _PARAM2_',
    'Tint the weather and set how solid it is. Opacity runs 0 to 255.', 'Action',
    [layerParam('Layer', 'Layer the weather is on'),
      col('Color', 'Particle colour', '255;255;255'),
      num('Opacity', 'Opacity from 0 to 255', '210')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const color = eventsFunctionContext.getArgument("Color");
const opacity = eventsFunctionContext.getArgument("Opacity");
WFX.startWeather(runtimeScene, layerName, {
  layerName: layerName, color: color, opacity: opacity
});
`, { group: G_WEATHER }),

  freeFn('SpawnWaterRing', 'Spawn a water ring on a layer',
    'Spawn a water ring on layer _PARAM0_ at _PARAM1_ ; _PARAM2_ with size _PARAM3_',
    'Draw one expanding ring at a point in SCENE coordinates. This is the drawn-ring kind that sits '
    + 'on top of the water, not the shader kind that bends the image. Needs weather started on that '
    + 'layer first - the Ripples type is the natural one, but any type will draw rings.', 'Action',
    [layerParam('Layer', 'Layer the weather is on'),
      num('X', 'Scene X coordinate', '0'), num('Y', 'Scene Y coordinate', '0'),
      num('Size', 'Size multiplier (1 = the configured radius)', '1')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const ringX = eventsFunctionContext.getArgument("X");
const ringY = eventsFunctionContext.getArgument("Y");
const ringSize = eventsFunctionContext.getArgument("Size");
WFX.spawnParticleRipple(runtimeScene, layerName, ringX, ringY, ringSize);
`, { group: G_WEATHER }),

  freeFn('StopWeather', 'Stop weather on a layer',
    'Stop weather on layer _PARAM0_',
    'Remove the weather from a layer completely and free its particles. To turn it off temporarily, '
    + 'set the intensity to 0 instead - that keeps the field alive so restarting is instant.', 'Action',
    [layerParam('Layer', 'Layer the weather is on')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
WFX.disposeEmitter(runtimeScene, layerName);
`, { group: G_WEATHER }),

  freeFn('StartDistortion', 'Start distortion on a layer',
    'Start distortion on layer _PARAM0_; mode: _PARAM1_; intensity: _PARAM2_',
    'Start heat haze, heat shimmer, underwater, tear lines, a magnifier band or ripples only. '
    + 'No object or behavior is needed. Once started it keeps running on its own. Calling it again on the same layer changes the '
    + 'running distortion rather than stacking a second shader.', 'Action',
    [layerParam('Layer', 'Layer to distort (leave empty for the base layer)'),
      choice('Mode', 'Distortion mode', DISTORTION_MODES),
      num('Intensity', 'Intensity multiplier (0 = flat, 1 = normal)', '1')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const mode = eventsFunctionContext.getArgument("Mode");
const intensity = eventsFunctionContext.getArgument("Intensity");
WFX.startDistortion(runtimeScene, layerName, {
  layerName: layerName, mode: mode, intensity: intensity, enabled: true
});
`, { group: G_DISTORT, withRuntime: true }),

  freeFn('SetDistortionIntensity', 'Set distortion intensity on a layer',
    'Set distortion intensity on layer _PARAM0_ to _PARAM1_',
    'Change how strongly the layer is bent without restarting the shader. 0 is flat, 1 is normal.',
    'Action',
    [layerParam('Layer', 'Layer the distortion is on'),
      num('Intensity', 'Intensity (0 = hidden, 1 = full effect)', '1')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const intensity = eventsFunctionContext.getArgument("Intensity");
WFX.startDistortion(runtimeScene, layerName, { layerName: layerName, intensity: intensity });
`, { group: G_DISTORT }),

  freeFn('SpawnRipple', 'Spawn a distortion ripple on a layer',
    'Spawn a ripple on layer _PARAM0_ at _PARAM1_ ; _PARAM2_',
    'Start distortion on this layer first. Spawn an expanding ripple at scene coordinates - the same numbers Object.X() and '
    + 'CursorX() give you. The ripple stays over that spot on the map while the camera moves. Up to '
    + '12 can run at once; a thirteenth replaces the oldest.', 'Action',
    [layerParam('Layer', 'Layer the distortion is on'),
      num('X', 'Scene X coordinate', '0'), num('Y', 'Scene Y coordinate', '0')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const rippleX = eventsFunctionContext.getArgument("X");
const rippleY = eventsFunctionContext.getArgument("Y");
WFX.spawnRipple(runtimeScene, layerName, rippleX, rippleY, 1);
`, { group: G_DISTORT }),

  freeFn('StopDistortion', 'Stop distortion on a layer',
    'Stop distortion on layer _PARAM0_',
    'Remove the distortion shader from a layer completely. To flatten it temporarily, set the '
    + 'intensity to 0 instead.', 'Action',
    [layerParam('Layer', 'Layer the distortion is on')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
WFX.disposeDistortion(runtimeScene, layerName);
`, { group: G_DISTORT }),

  freeFn('SetGlobalIntensity', 'Set global weather intensity',
    'Set global WeatherFX intensity to _PARAM0_',
    'Scale every weather emitter and distortion in the scene at once, on top of their own intensity '
    + 'settings. One dial for "how bad is the weather right now", or for an accessibility option that '
    + 'turns all screen motion down.', 'Action',
    [num('Intensity', 'Global multiplier from 0 to 1', '1')],
    `WFX.setGlobalIntensity(runtimeScene, eventsFunctionContext.getArgument("Intensity"));
`, { group: G_GLOBAL }),

  freeFn('PauseAll', 'Pause / resume all WeatherFX effects',
    'Set all WeatherFX effects paused: _PARAM0_',
    'Pause animation and hide all weather and distortion effects. Resume to show them again and continue animation.', 'Action',
    [bool('Paused', 'Paused')],
    `WFX.setPaused(runtimeScene, !!eventsFunctionContext.getArgument("Paused"));
`, { group: G_GLOBAL }),
];

for (const [kind, group, numberMap, flagMap] of [
  ['Weather', G_WEATHER, 'WEATHER_NUMBER_FIELDS', 'WEATHER_FLAG_FIELDS'],
  ['Distortion', G_DISTORT, 'DISTORTION_NUMBER_FIELDS', 'DISTORTION_FLAG_FIELDS'],
]) {
  for (const [suffix, map, valueParam] of [
    ['Setting', numberMap, num('Value', 'New value', '1')],
    ['Flag', flagMap, bool('Value', 'Turn this option on')],
  ]) {
    freeActions.push(freeFn(`Set${kind}${suffix}`, `Set ${kind.toLowerCase()} ${suffix === 'Flag' ? 'option' : 'numeric setting'} on a layer`,
      `Set ${kind.toLowerCase()} on layer _PARAM0_; setting: _PARAM1_; value: _PARAM2_`,
      (suffix === 'Flag'
        ? 'Turn the selected option on or off. Start the effect on this layer first.'
        : 'Adjust one setting. Sizes and distances use screen pixels; movement uses pixels per second. Intensity: 0 = hidden, 1 = normal. Opacity: 0-255. Start the effect first.'), 'Action',
      [layerParam('Layer', 'Effect layer'), choice('Setting', 'Setting', settingLabels(map)), valueParam],
      `WFX.set${kind}${suffix}(runtimeScene, eventsFunctionContext.getArgument("Layer") || "",
        eventsFunctionContext.getArgument("Setting"), eventsFunctionContext.getArgument("Value"));`,
      { group }));
  }
}
for (const [name, title, options, group] of [
  ['WeatherType', 'weather type', EFFECT_TYPES, G_WEATHER],
  ['WeatherAnchoring', 'weather anchoring', ANCHORING, G_WEATHER],
  ['DistortionMode', 'distortion mode', DISTORTION_MODES, G_DISTORT],
]) {
  freeActions.push(freeFn(`Set${name}`, `Set ${title} on a layer`,
    `Set ${title} on layer _PARAM0_ to _PARAM1_`,
    name === 'WeatherAnchoring'
      ? 'World keeps particles on the map as the camera moves. Screen keeps falling particles attached to the view. Water rings and rain splashes always stay at their world positions. Start weather on this layer first.'
      : 'Switch to a built-in look and reset its custom appearance and motion settings. Keeps intensity and placement. Start the effect on this layer first.',
    'Action', [layerParam('Layer', 'Effect layer'), choice('Value', title, options)],
    `WFX.set${name}(runtimeScene, eventsFunctionContext.getArgument("Layer") || "", eventsFunctionContext.getArgument("Value"));`,
    { group }));
}

// The distortion flag selector has only one option. Keep its signature for saved events,
// but offer a direct toggle for new events.
const legacyDistortionFlag = freeActions.find(f => f.name === 'SetDistortionFlag');
legacyDistortionFlag.fullName = 'Set distortion option (legacy)';
legacyDistortionFlag.group = 'Advanced / Legacy controls';
legacyDistortionFlag.description = 'For existing events. Use Enable / disable distortion on a layer for a direct toggle.';
freeActions.push(freeFn('SetDistortionEnabled', 'Enable / disable distortion on a layer',
  'Set distortion on layer _PARAM0_ enabled: _PARAM1_',
  'Show or hide the distortion already started on this layer. Turning it off keeps its settings. Start distortion on this layer first.',
  'Action', [layerParam('Layer', 'Effect layer'), bool('Enabled', 'Enabled')],
  `WFX.setDistortionFlag(runtimeScene, eventsFunctionContext.getArgument("Layer") || "",
    "Enabled", !!eventsFunctionContext.getArgument("Enabled"));`,
  { group: G_DISTORT }));

const dedicatedActions = effectActions({ runtime, freeFn, num, col, layerParam, choice, bool });

const freeConditions = [
  freeFn('IsWeatherActive', 'Weather or distortion exists on a layer',
    'Weather or distortion exists on layer _PARAM0_',
    'True when standalone weather or distortion has been started on this layer, including hidden or paused effects. False after both effects are stopped.',
    'Condition',
    [layerParam('Layer', 'Layer to check')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
eventsFunctionContext.returnValue = WFX.isActive(runtimeScene, layerName);
`, { group: G_WEATHER }),

  freeFn('IsPaused', 'All WeatherFX effects are paused',
    'All WeatherFX effects are paused',
    'Check whether the scene-wide pause is currently on.', 'Condition', [],
    `eventsFunctionContext.returnValue = WFX.isPaused(runtimeScene);
`, { group: G_GLOBAL }),

  freeFn('IsSupported', 'WeatherFX 2D is supported',
    'WeatherFX 2D is supported on this device',
    'Check that the game is running on WebGL. The distortion shader needs it; on a canvas fallback '
    + 'the particles still work but the distortion does nothing.', 'Condition', [],
    `eventsFunctionContext.returnValue = WFX.isSupported(runtimeScene);
`, { group: G_GLOBAL }),
];

const freeExpressions = [
  freeFn('ParticleCountOnLayer', 'Particle count on a layer',
    '', 'How many particles the weather on a layer currently holds, including the off-screen margin.',
    'Expression',
    [layerParam('Layer', 'Layer the weather is on')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
eventsFunctionContext.returnValue = WFX.getParticleCount(runtimeScene, layerName);
`, { group: G_WEATHER, expressionType: 'number' }),

  freeFn('RippleCountOnLayer', 'Ripple count on a layer',
    '', 'How many ripples are currently animating on a layer, out of a maximum of 12.', 'Expression',
    [layerParam('Layer', 'Layer the distortion is on')],
    `const layerName = eventsFunctionContext.getArgument("Layer") || "";
eventsFunctionContext.returnValue = WFX.getRippleCount(runtimeScene, layerName);
`, { group: G_DISTORT, expressionType: 'number' }),

  freeFn('GlobalIntensity', 'Global weather intensity',
    '', 'The current scene-wide intensity multiplier.', 'Expression', [],
    `eventsFunctionContext.returnValue = WFX.getGlobalIntensity(runtimeScene);
`, { group: G_GLOBAL, expressionType: 'number' }),
];

for (const [kind, group, map] of [
  ['Weather', G_WEATHER, 'WEATHER_NUMBER_FIELDS'],
  ['Distortion', G_DISTORT, 'DISTORTION_NUMBER_FIELDS'],
]) {
  freeExpressions.push(freeFn(`${kind}Setting`, `${kind} setting on a layer`, '',
    'Read a numeric setting, including built-in defaults. Returns 0 when no effect is running.',
    'Expression', [layerParam('Layer', 'Effect layer'), choice('Setting', 'Setting', settingLabels(map))],
    `eventsFunctionContext.returnValue = WFX.get${kind}Setting(runtimeScene,
      eventsFunctionContext.getArgument("Layer") || "", eventsFunctionContext.getArgument("Setting"));`,
    { group, expressionType: 'number' }));
}

/* ------------------------------------------------------- Property groups (panel layout) */

const PROPERTY_GROUPS = {
  WeatherEmitter2D: {
    EffectType: G_EM_EFFECT,
    EffectUseTypeDefaults: G_EM_EFFECT,
    EffectLayer: G_EM_EFFECT,
    EffectEnabled: G_EM_EFFECT,
    EffectIntensity: G_EM_EFFECT,
    LookColor: G_EM_LOOK,
    LookOpacity: G_EM_LOOK,
    LookAdditive: G_EM_LOOK,
    LookSoftness: G_EM_LOOK,
    MotionMinSpeed: G_EM_MOTION,
    MotionMaxSpeed: G_EM_MOTION,
    MotionWindAngle: G_EM_MOTION,
    MotionWindSpread: G_EM_MOTION,
    MotionGustStrength: G_EM_MOTION,
    MotionSwayAmount: G_EM_MOTION,
    MotionSwaySpeed: G_EM_MOTION,
    ParticleDensity: G_EM_PARTICLES,
    ParticleMinSize: G_EM_PARTICLES,
    ParticleMaxSize: G_EM_PARTICLES,
    ParticleDepthVariation: G_EM_PARTICLES,
    PlacementAnchoring: G_EM_PLACEMENT,
    PlacementDrawOrder: G_EM_PLACEMENT,
    PlacementPixelSnap: G_EM_PLACEMENT,
    RainStreakWidth: G_EM_RAIN,
    RainStreakLength: G_EM_RAIN,
    RingSpawnRate: G_EM_RINGS,
    RingMinRadius: G_EM_RINGS,
    RingMaxRadius: G_EM_RINGS,
    RingLifetime: G_EM_RINGS,
  },
  ScreenDistortion2D: {
    EffectMode: G_DI_EFFECT,
    EffectUseModeDefaults: G_DI_EFFECT,
    EffectLayer: G_DI_EFFECT,
    EffectEnabled: G_DI_EFFECT,
    EffectIntensity: G_DI_EFFECT,
    HeatRiseSpeed: G_DI_HEAT,
    HeatHorizonFade: G_DI_HEAT,
    PlacementWorldFollow: G_DI_PLACEMENT,
    RippleStrength: G_DI_RIPPLES,
    RippleSpeed: G_DI_RIPPLES,
    RippleLife: G_DI_RIPPLES,
    RippleWidth: G_DI_RIPPLES,
    WaveStrength: G_DI_WAVE,
    WaveLengthX: G_DI_WAVE,
    WaveLengthY: G_DI_WAVE,
    WaveSpeed: G_DI_WAVE,
    WaveDetail: G_DI_WAVE,
    TearStrength: G_DI_TEAR,
    TearWidth: G_DI_TEAR,
    TearStripHeight: G_DI_TEAR,
    MagnifierAmount: G_DI_MAG,
    MagnifierBandWidth: G_DI_MAG,
  },
};

/* ============================================================== Extension Object */

const extension = {
  name: 'WeatherFX2D',
  fullName: 'Weather FX 2D',
  description:
    'Add snow, rain, fog, embers, water rings and six screen distortion modes to a 2D scene. '
    + 'Start effects on a layer with one action; no object, behavior or per-frame update is required. '
    + 'Adjust intensity, wind, colour and advanced settings from events. Optional behaviors provide '
    + 'object-based settings and ripple placement. Effects follow the camera across the map and keep '
    + 'their apparent size through zoom and resolution changes.',
  shortDescription: 'Weather and screen distortion in one action. No behavior required.',
  category: 'Visual effect',
  author: 'Twillion',
  license: 'MIT',
  version: '1.5.0',
  iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  tags: [
    '2D', 'weather', 'snow', 'rain', 'fog', 'embers', 'particles',
    'heat haze', 'heat shimmer', 'underwater', 'ripple', 'shader', 'distortion',
    'tear lines', 'mirage', 'magnifier', 'glitch', 'water',
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [
    runtimeInstaller,
    ...dedicatedActions,
    ...freeActions,
    ...freeConditions,
    ...freeExpressions,
  ],
  eventsBasedBehaviors: [
    emitterBehavior,
    distortionBehavior,
  ],
};

/* ============================================================== Pre-build Safety Checks */

const fail = (message) => {
  console.error('\n' + message + '\n');
  process.exit(1);
};

// 1. Every property must carry a group, or it lands in an unnamed bucket below every named section.
for (const behavior of extension.eventsBasedBehaviors) {
  const map = PROPERTY_GROUPS[behavior.name];
  if (!map) fail(`No PROPERTY_GROUPS entry for behavior ${behavior.name}.`);

  const seen = new Set();
  for (const property of behavior.propertyDescriptors) {
    if (seen.has(property.name)) {
      fail(`Duplicate property ${behavior.name}.${property.name} - it would render as two identical `
        + `rows fighting over one stored value.`);
    }
    seen.add(property.name);

    const group = map[property.name];
    if (!group) {
      fail(`Property ${behavior.name}.${property.name} has no group. Add it to PROPERTY_GROUPS.`);
    }
    property.group = group;
  }

  for (const name of Object.keys(map)) {
    if (!seen.has(name)) fail(`PROPERTY_GROUPS lists ${behavior.name}.${name}, which does not exist.`);
  }
}

/**
 * 2. GDevelop walks a behavior's properties alphabetically by NAME - they arrive from a sorted
 * gd::MapStringPropertyDescriptor - and opens each group the first time it meets one. Declaration
 * order has no effect at all. Replicating that here is the only way to know which section actually
 * lands at the top of the panel, and the Effect group has to be it: it holds the type selector and
 * the "use built-in settings" switch, which are the two things a first-time user must find.
 */
for (const behavior of extension.eventsBasedBehaviors) {
  const sorted = [...behavior.propertyDescriptors].sort((a, b) => (a.name < b.name ? -1 : 1));
  const groupsInPanelOrder = [];
  for (const property of sorted) {
    if (!groupsInPanelOrder.includes(property.group)) groupsInPanelOrder.push(property.group);
  }
  if (!groupsInPanelOrder[0].startsWith('Effect')) {
    fail(`${behavior.name}: the panel would open with "${groupsInPanelOrder[0]}", not the Effect `
      + `group.\nProperties sort alphabetically by name, so rename whichever property now sorts `
      + `first.\nPanel order would be: ${groupsInPanelOrder.join(' | ')}`);
  }
}

// 3. Behavior functions may only take "object" as parameter 0.
const checkObjectParams = (functions, ownerName, isBehavior) => {
  for (const f of functions || []) {
    (f.parameters || []).forEach((parameter, index) => {
      const allowed = isBehavior && index === 0;
      if (parameter.type === 'object' && !allowed) {
        fail(`${ownerName}.${f.name} parameter ${index} ("${parameter.name}") is type "object".\n`
          + `Only parameter 0 of a behavior function may be "object".`);
      }
    });
  }
};
for (const behavior of extension.eventsBasedBehaviors) {
  checkObjectParams(behavior.eventsFunctions, behavior.name, true);
}
checkObjectParams(extension.eventsFunctions, 'freeFunctions', false);

/**
 * 4. A JS block can reference a parameter it never fetched. That parses perfectly - it is only a
 * bare identifier - and the extension builds clean, but the action throws ReferenceError the first
 * time it runs in a real game.
 */
const checkParamsAreFetched = (functions, ownerName) => {
  for (const f of functions || []) {
    const code = (f.events || []).map((e) => {
      const body = e.inlineCode || '';
      // Embedded runtime has its own lexical scope and no event parameters.
      return body.startsWith(runtime) ? body.slice(runtime.length) : body;
    }).join('\n');
    const bare = code
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    const declared = new Set();
    for (const m of bare.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

    for (const parameter of f.parameters || []) {
      if (!parameter.name || parameter.type === 'object' || parameter.type === 'behavior') continue;
      const candidates = new Set([
        parameter.name,
        parameter.name.charAt(0).toLowerCase() + parameter.name.slice(1),
      ]);
      for (const id of candidates) {
        const used = new RegExp('(?:^|[^A-Za-z0-9_$.])' + id + '(?![A-Za-z0-9_$])(?![ \t]*:)').test(bare);
        if (used && !declared.has(id)) {
          fail(`${ownerName}.${f.name} uses "${id}" but never declares it.\n`
            + `A parameter is not a variable - read it with\n`
            + `  const ${id} = eventsFunctionContext.getArgument("${parameter.name}");`);
        }
      }
    }
  }
};
for (const behavior of extension.eventsBasedBehaviors) {
  checkParamsAreFetched(behavior.eventsFunctions, behavior.name);
}
checkParamsAreFetched(extension.eventsFunctions, 'freeFunctions');

// 5. Every JsCode block must parse, and must contain no NUL byte. A NUL truncates the block silently
//    when GDevelop writes it out, and the symptom is "<Action> is not a function" at runtime with
//    nothing wrong on screen - node --check never sees it because the file on disk is fine.
let parsedBlocks = 0;
const allFunctions = [
  ...extension.eventsFunctions,
  ...extension.eventsBasedBehaviors.flatMap((b) => b.eventsFunctions),
];
for (const f of allFunctions) {
  for (const event of f.events || []) {
    const code = event.inlineCode || '';
    if (code.indexOf('\u0000') !== -1) {
      fail(`${f.name}: JsCode contains a NUL byte, which truncates the block when GDevelop saves it.`);
    }
    try {
      // eslint-disable-next-line no-new-func
      new Function('runtimeScene', 'eventsFunctionContext', code);
      parsedBlocks += 1;
    } catch (error) {
      fail(`${f.name}: JsCode does not parse.\n${error.message}`);
    }
  }
}

// 6. Every function the JsCode calls on WFX must actually exist on the runtime's public surface.
const surfaceMatch = runtime.match(/gdjs\.__weatherFX2D = \{([\s\S]*?)\n  \};/);
if (!surfaceMatch) fail('Could not find the public surface block in WeatherFX2D.runtime.js.');
const exported = new Set([...surfaceMatch[1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
for (const f of allFunctions) {
  for (const event of f.events || []) {
    const body = (event.inlineCode || '').slice(event.inlineCode.indexOf('const WFX'));
    for (const m of body.matchAll(/\bWFX\.(\w+)\s*\(/g)) {
      if (!exported.has(m[1])) {
        fail(`${f.name}: calls WFX.${m[1]}(), which the runtime does not export.\n`
          + `Exported: ${[...exported].sort().join(', ')}`);
      }
    }
  }
}

// The event sentence must expose every editable field in the same order as the form.
// Behavior selection is handled by GDevelop alongside the object, so it has no inline slot.
for (const f of allFunctions) {
  if (f.private || f.functionType === 'Expression' || f.functionType === 'StringExpression') continue;
  const shown = [...f.sentence.matchAll(/_PARAM(\d+)_/g)].map(match => Number(match[1]));
  const offset = extension.eventsFunctions.includes(f) ? 1 : 0;
  const expected = f.parameters.flatMap((parameter, index) => parameter.type === 'behavior' ? [] : [index + offset]);
  if (JSON.stringify(shown) !== JSON.stringify(expected)) {
    fail(`${f.name}: event sentence fields ${shown} do not match editor field order ${expected}.`);
  }
}

const json = JSON.stringify(extension, null, 2);

const outPath = path.join(here, 'WeatherFX2D.json');
if (process.argv.includes('--check')) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing !== json) {
    fail(`${path.basename(outPath)} is stale. Run node WeatherFX2D/build-extension.mjs and commit it.`);
  }
} else {
  fs.writeFileSync(outPath, json, 'utf8');
}

const counts = allFunctions.reduce((acc, f) => {
  const key = f.private ? 'lifecycle' : f.functionType;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const propertyCount = extension.eventsBasedBehaviors
  .reduce((total, b) => total + b.propertyDescriptors.length, 0);

console.log(`\n${process.argv.includes('--check') ? 'Verified' : 'Built'} `
  + `${path.basename(outPath)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${parsedBlocks} JS blocks parsed clean`);
console.log(`  ${extension.eventsBasedBehaviors.length} behaviors, ${propertyCount} properties`);
console.log(`  Summary: ${JSON.stringify(counts)}`);
