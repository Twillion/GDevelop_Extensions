/**
 * build-extension.mjs
 * Builds CameraTweens3D.json from the runtime engine + declarations.
 *
 * Run: node CameraTweens3d/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Read runtime and icon
const rawRuntime = fs.readFileSync(path.join(here, 'CameraTweens3D.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const runtime = rawRuntime;
const NS = 'gdjs.__cameraTweens3D';

const EXTENSION_NAME = 'CameraTweens3D';
const BEHAVIOR_NAME = 'CameraTweens3D';
/**
 * A `behavior` parameter MUST carry the behavior's fully qualified type in
 * `supplementaryInformation`. Without it the editor has nothing to bind the field to, and the code
 * generator emits `getBehavior("")` — which returns undefined, so every action, condition and
 * expression throws on its first call. Lifecycle hooks still work (the engine calls those with the
 * behavior directly), which is why the behavior appears to function until the first ACE is used.
 */
const BEHAVIOR_TYPE = `${EXTENSION_NAME}::${BEHAVIOR_NAME}`;

/** Object + Behavior are always the first two parameters of a behavior function. */
const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: BEHAVIOR_TYPE },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });
const layer = (name, description) => ({ name, type: 'layer', description });
const choice = (name, description, options) => ({
  name, type: 'stringWithSelector', description,
  supplementaryInformation: JSON.stringify(options),
});

/** Standard preamble for behavior actions/conditions/expressions */
const PREAMBLE = `const __ctObjects = eventsFunctionContext.getObjects("Object");
const object = __ctObjects.length ? __ctObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const CT = ${NS};
const state = CT.getState(behavior);
`;

/**
 * The runtime IIFE is self-guarding, so embedding it more than once is harmless — but each copy
 * is 40+ KB of the project file, and the two per-frame hooks re-enter it every single frame for
 * every instance. It is embedded exactly twice: once in the extension's `onFirstSceneLoaded`,
 * and once in the behavior's `onCreated` in case a behavior is attached before that ever runs.
 */
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

/* ------------------------------------------------------------------ Presets & Profiles */

const PRESET_CHOICES = [
  'Tactical Military (COD / Tarkov)',
  'Immersive Horror (Outlast / RE7)',
  'Fast Arcade Shooter (DOOM / Quake)',
  'Accessibility & Comfort (Zero Motion Sickness)',
  'Custom',
];

const BOB_CHOICES = [
  'Default for Preset',
  'Off (Disabled)',
  'Subtle (0.5x)',
  'Standard (1.0x)',
  'Heavy (1.5x)',
  'Intense (2.0x)',
];

const LEAN_CHOICES = [
  'Default for Preset',
  'Off (0° Flat)',
  'Subtle (1.0°)',
  'Standard (2.0°)',
  'Heavy (3.5°)',
  'Intense (5.0°)',
];

const LANDING_CHOICES = [
  'Default for Preset',
  'Off (Disabled)',
  'Soft (0.4x)',
  'Standard (1.0x)',
  'Heavy (1.8x)',
  'Deep Impact (2.5x)',
];

const BREATHING_CHOICES = [
  'Default for Preset',
  'Off (Disabled)',
  'Subtle (0.4x)',
  'Standard (1.0x)',
  'Deep Breathing (1.5x)',
];

const RECOIL_CHOICES = [
  'Default for Preset',
  'Off (Disabled)',
  'Subtle Kick',
  'Standard FPS',
  'Heavy Kick',
  'Crisp Boomer Shooter',
];

const SHAKE_CHOICES = [
  'Default for Preset',
  'Off (Disabled)',
  'Soft (0.5x)',
  'Standard (1.0x)',
  'Cinematic Heavy (1.5x)',
];

const SPEED_FOV_CHOICES = [
  'Default for Preset',
  'Off (0° Locked)',
  'Subtle (+5°)',
  'Standard (+10°)',
  'Extreme (+18°)',
];

const COMFORT_CHOICES = [
  'Default for Preset',
  'Off',
  'On',
  'Auto (follow system setting)',
];

/* ------------------------------------------------------------------ Options */

const BEHAVIOR_OPTIONS = `{
  presetProfile: behavior._getPresetProfile ? behavior._getPresetProfile() : 'Tactical Military (COD / Tarkov)',
  bobProfile: behavior._getBobProfile ? behavior._getBobProfile() : 'Default for Preset',
  leanProfile: behavior._getLeanProfile ? behavior._getLeanProfile() : 'Default for Preset',
  landingImpactProfile: behavior._getLandingImpactProfile ? behavior._getLandingImpactProfile() : 'Default for Preset',
  breathingProfile: behavior._getBreathingProfile ? behavior._getBreathingProfile() : 'Default for Preset',
  recoilProfile: behavior._getRecoilProfile ? behavior._getRecoilProfile() : 'Default for Preset',
  shakeProfile: behavior._getShakeProfile ? behavior._getShakeProfile() : 'Default for Preset',
  speedRushFOVProfile: behavior._getSpeedRushFOVProfile ? behavior._getSpeedRushFOVProfile() : 'Default for Preset',
  baseFOV: behavior._getBaseFOV ? behavior._getBaseFOV() : 0,
  adsFOVTarget: behavior._getADSFOVTarget ? behavior._getADSFOVTarget() : 0,
  masterMotionScale: behavior._getMasterMotionScale ? behavior._getMasterMotionScale() : 1.0,
  masterShakeScale: behavior._getMasterShakeScale ? behavior._getMasterShakeScale() : 1.0,
  motionSicknessMode: behavior._getMotionSicknessMode ? behavior._getMotionSicknessMode() : 'Default for Preset',
  worldUnitsPerMeter: behavior._getWorldUnitsPerMeter ? behavior._getWorldUnitsPerMeter() : 0,
  walkSpeedReference: behavior._getWalkSpeedReference ? behavior._getWalkSpeedReference() : 0,
  layerName: behavior._getLayer ? behavior._getLayer() : ''
}`;

/* ------------------------------------------------------------------ Lifecycle */

/** A private lifecycle function carrying no copy of the runtime — see the note on `ev`. */
const lifecycleHook = (name, body) => ({
  name,
  fullName: name,
  description: '',
  functionType: 'Action',
  private: true,
  parameters: [...OB],
  events: ev(`const __ctObjects = eventsFunctionContext.getObjects("Object");
const object = __ctObjects.length ? __ctObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${body}
`),
});

const lifecycle = [
  {
    name: 'onCreated',
    fullName: 'onCreated',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OB],
    events: ev(`${runtime}
const __ctObjects = eventsFunctionContext.getObjects("Object");
const object = __ctObjects.length ? __ctObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${NS}.initialize(object, behavior, ${BEHAVIOR_OPTIONS});
`),
  },
  lifecycleHook('doStepPreEvents', `${NS}.doStepPreEvents(runtimeScene, object, behavior);`),
  lifecycleHook('doStepPostEvents', `${NS}.doStepPostEvents(runtimeScene, object, behavior);`),
  lifecycleHook('onActivate', `${NS}.onActivate(runtimeScene, object, behavior);`),
  // Deactivating must hand the camera back, or the last frame's offset stays baked in forever.
  lifecycleHook('onDeActivate', `${NS}.onDeActivate(runtimeScene, object, behavior);`),
  lifecycleHook('onDestroy', `${NS}.dispose(runtimeScene, behavior);`),
];

/* ------------------------------------------------------------------ Actions */

const G_MASTER = 'Master & Presets';
const G_COMBAT = 'Combat & Trauma';
const G_FOV = 'Dynamic FOV';
const G_LEAN = 'Kinematics & Leaning';
const G_TUNING = 'Runtime Tuning';

const actions = [
  fn('ApplyPreset', 'Apply camera preset',
    'Apply camera preset _PARAM2_ on _PARAM0_',
    'Applies a built-in genre tuning profile (Tactical Military, Immersive Horror, Fast Arcade Shooter, Accessibility & Comfort).',
    'Action', [choice('Preset', 'Preset profile to apply', PRESET_CHOICES)],
    `CT.applyPreset(behavior, eventsFunctionContext.getArgument("Preset"));\n`,
    { group: G_MASTER }),

  fn('SetBobProfile', 'Set head bob style',
    'Set head bob style on _PARAM0_ to _PARAM2_',
    'Sets the head bob style (Off, Subtle, Standard, Heavy, Intense).',
    'Action', [choice('Profile', 'Head bob profile', BOB_CHOICES)],
    `CT.setBobProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  // Display text only — the function name stays `SetLeanProfile` so existing event sheets
  // and saved projects keep working. Same for the `LeanProfile` property below.
  fn('SetLeanProfile', 'Set run/walk lean intensity',
    'Set run/walk lean intensity on _PARAM0_ to _PARAM2_',
    'How far the camera leans while moving: roll when running or walking sideways, plus banking into turns. "Off" disables both.',
    'Action', [choice('Profile', 'Lean intensity', LEAN_CHOICES)],
    `CT.setLeanProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetLandingImpactProfile', 'Set landing impact style',
    'Set landing impact style on _PARAM0_ to _PARAM2_',
    'Sets landing shock compression profile (Off, Soft, Standard, Heavy, Deep Impact).',
    'Action', [choice('Profile', 'Landing profile', LANDING_CHOICES)],
    `CT.setLandingImpactProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetBreathingProfile', 'Set breathing style',
    'Set breathing style on _PARAM0_ to _PARAM2_',
    'Sets idle breathing sway profile (Off, Subtle, Standard, Deep Breathing).',
    'Action', [choice('Profile', 'Breathing profile', BREATHING_CHOICES)],
    `CT.setBreathingProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetRecoilProfile', 'Set recoil feel',
    'Set recoil feel on _PARAM0_ to _PARAM2_',
    'Sets weapon recoil feel (Off, Subtle Kick, Standard FPS, Heavy Kick, Crisp Boomer Shooter).',
    'Action', [choice('Profile', 'Recoil profile', RECOIL_CHOICES)],
    `CT.setRecoilProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetShakeProfile', 'Set shake power',
    'Set shake power on _PARAM0_ to _PARAM2_',
    'Sets trauma shake power (Off, Soft, Standard, Cinematic Heavy).',
    'Action', [choice('Profile', 'Shake profile', SHAKE_CHOICES)],
    `CT.setShakeProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetSpeedRushFOVProfile', 'Set speed rush FOV boost',
    'Set speed rush FOV boost on _PARAM0_ to _PARAM2_',
    'Sets sprinting FOV rush profile (Off, Subtle, Standard, Extreme).',
    'Action', [choice('Profile', 'Speed rush FOV profile', SPEED_FOV_CHOICES)],
    `CT.setSpeedRushFOVProfile(behavior, eventsFunctionContext.getArgument("Profile"));\n`,
    { group: G_TUNING }),

  fn('SetMasterMotionScale', 'Set master motion scale',
    'Set master motion scale on _PARAM0_ to _PARAM2_',
    'Multiplies all procedural motions (bob, breathing, tilt) by a global scale (0.0 = disabled).',
    'Action', [num('Scale', 'Global motion scale (0.0 to 2.0)', '1.0')],
    `CT.setMasterMotionScale(behavior, eventsFunctionContext.getArgument("Scale"));\n`,
    { group: G_MASTER }),

  fn('SetMasterShakeScale', 'Set master shake scale',
    'Set master shake scale on _PARAM0_ to _PARAM2_',
    'Multiplies all trauma and explosion camera shakes by a global scale.',
    'Action', [num('Scale', 'Global shake scale (0.0 to 2.0)', '1.0')],
    `CT.setMasterShakeScale(behavior, eventsFunctionContext.getArgument("Scale"));\n`,
    { group: G_MASTER }),

  fn('SetMotionSicknessMode', 'Set motion sickness / comfort mode',
    'Set motion sickness mode on _PARAM0_: _PARAM2_',
    'Enables or disables anti-nausea comfort mode (holds the horizon flat and stops horizontal sway).',
    'Action', [bool('Enabled', 'Enable anti-nausea comfort mode')],
    `CT.setMotionSicknessMode(behavior, eventsFunctionContext.getArgument("Enabled"));\n`,
    { group: G_MASTER }),

  fn('AddTrauma', 'Add trauma shake',
    'Add trauma to _PARAM0_ by _PARAM2_',
    'Adds shake trauma from an explosion, impact, or hit (0.0 to 1.0). Trauma decays smoothly over time.',
    'Action', [num('Amount', 'Trauma amount to add (0.0 to 1.0)', '0.5')],
    `CT.addTrauma(behavior, eventsFunctionContext.getArgument("Amount"));\n`,
    { group: G_COMBAT }),

  fn('ApplyRecoil', 'Apply weapon recoil impulse',
    'Apply weapon recoil to _PARAM0_ (Pitch: _PARAM2_, Yaw: _PARAM3_, KickbackZ: _PARAM4_)',
    'Fires a high-stiffness spring recoil impulse that kicks the camera up, applies random spread, and shoves backward along view axis.',
    'Action', [
      num('Pitch', 'Upward pitch kick in degrees', '3.0'),
      num('Yaw', 'Horizontal yaw kick in degrees', '0.5'),
      num('KickbackZ', 'Backward kickback displacement in meters', '0.04'),
    ],
    `CT.applyRecoil(behavior, eventsFunctionContext.getArgument("Pitch"), eventsFunctionContext.getArgument("Yaw"), eventsFunctionContext.getArgument("KickbackZ"));\n`,
    { group: G_COMBAT }),

  fn('ApplyDamageFlinch', 'Apply directional damage flinch',
    'Apply damage flinch to _PARAM0_ (Angle: _PARAM2_, Force: _PARAM3_)',
    'Applies a directional flinch jerk away from incoming bullet or melee damage.',
    'Action', [
      num('Angle', 'Direction angle of incoming damage in degrees', '0.0'),
      num('Force', 'Impact force multiplier', '1.0'),
    ],
    `CT.applyDamageFlinch(behavior, eventsFunctionContext.getArgument("Angle"), eventsFunctionContext.getArgument("Force"));\n`,
    { group: G_COMBAT }),

  fn('TriggerLandingImpact', 'Trigger landing impact shock',
    'Trigger landing impact on _PARAM0_ with fall speed _PARAM2_',
    'Forces a vertical compression dip and forward pitch jerk as if landing from a fall. The depth scales with the fall speed you pass in.',
    'Action', [num('FallSpeed', 'Downward speed in world units per second', '500')],
    `CT.triggerLandingImpact(behavior, eventsFunctionContext.getArgument("FallSpeed"));\n`,
    { group: G_COMBAT }),

  fn('StopAllShakes', 'Stop all camera shakes',
    'Stop all camera shakes on _PARAM0_',
    'Instantly resets trauma to 0.0, halting all explosion shakes.',
    'Action', [],
    `CT.stopAllShakes(behavior);\n`,
    { group: G_COMBAT }),

  fn('SetADS', 'Set Aim Down Sights (ADS)',
    'Set Aim Down Sights (ADS) on _PARAM0_: _PARAM2_',
    'Smoothly transitions camera FOV and damping into or out of weapon aiming mode.',
    'Action', [bool('Enabled', 'Enable ADS aiming mode')],
    `CT.setADS(behavior, eventsFunctionContext.getArgument("Enabled"));\n`,
    { group: G_FOV }),

  fn('SetSprinting', 'Set sprinting state',
    'Set sprinting state on _PARAM0_: _PARAM2_',
    'Transitions into or out of sprint speed rush FOV and stride frequency boost.',
    'Action', [bool('Enabled', 'Enable sprinting state')],
    `CT.setSprinting(behavior, eventsFunctionContext.getArgument("Enabled"));\n`,
    { group: G_FOV }),

  fn('SetCrouching', 'Set crouching state',
    'Set crouching state on _PARAM0_: _PARAM2_',
    'Applies sneaking/crouch damping to reduce head bobbing amplitude.',
    'Action', [bool('Enabled', 'Enable crouching state')],
    `CT.setCrouching(behavior, eventsFunctionContext.getArgument("Enabled"));\n`,
    { group: G_LEAN }),

  fn('TweenFOV', 'Tween camera FOV',
    'Tween camera FOV on _PARAM0_ to _PARAM2_ over _PARAM3_ seconds',
    'Smoothly transitions the camera Field of View to a target degree, then holds it. The resting FOV is not overwritten — use "Release FOV tween" to hand control back to base / ADS / sprint.',
    'Action', [
      num('TargetFOV', 'Target Field of View in degrees', '60.0'),
      num('Duration', 'Transition duration in seconds', '0.3'),
    ],
    `CT.tweenFOV(behavior, eventsFunctionContext.getArgument("TargetFOV"), eventsFunctionContext.getArgument("Duration"));\n`,
    { group: G_FOV }),

  fn('ReleaseFOVTween', 'Release FOV tween',
    'Release FOV tween on _PARAM0_ over _PARAM2_ seconds',
    'Eases the Field of View back from a held tween to the automatic value (base, ADS or sprint) and hands control back.',
    'Action', [num('Duration', 'Transition duration in seconds', '0.3')],
    `CT.releaseFOVTween(behavior, eventsFunctionContext.getArgument("Duration"));\n`,
    { group: G_FOV }),

  fn('SetADSFOVTarget', 'Set ADS zoom FOV',
    'Set ADS zoom FOV on _PARAM0_ to _PARAM2_ degrees',
    'Adjusts the zoomed-in Field of View used while aiming down sights (e.g. per weapon scope).',
    'Action', [num('FOV', 'ADS Field of View in degrees', '35.0')],
    `CT.setADSFOVTarget(behavior, eventsFunctionContext.getArgument("FOV"));\n`,
    { group: G_FOV }),

  fn('SetManualLeanAngle', 'Set manual lean angle (Q / E)',
    'Set manual lean angle on _PARAM0_ to _PARAM2_ degrees',
    'Sets corner peeking roll tilt angle (e.g. -12.0 for left Q peek, +12.0 for right E peek, 0.0 to return to center).',
    'Action', [num('Angle', 'Lean angle in degrees (-12 to +12)', '0.0')],
    `CT.setManualLeanAngle(behavior, eventsFunctionContext.getArgument("Angle"));\n`,
    { group: G_LEAN }),

  fn('SetBaseFOV', 'Set base FOV',
    'Set base resting FOV on _PARAM0_ to _PARAM2_ degrees',
    'Adjusts resting Field of View (e.g. from user FOV slider settings).',
    'Action', [num('FOV', 'Base Field of View in degrees', '75.0')],
    `CT.setBaseFOV(behavior, eventsFunctionContext.getArgument("FOV"));\n`,
    { group: G_FOV }),

  fn('SetBobIntensity', 'Set head bob intensity',
    'Set head bob intensity on _PARAM0_ to _PARAM2_',
    'Dynamically adjusts walking and running head bob amplitude multiplier.',
    'Action', [num('Intensity', 'Bob intensity multiplier', '1.0')],
    `CT.setBobIntensity(behavior, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_TUNING }),

  fn('SetBreathingIntensity', 'Set breathing intensity',
    'Set breathing intensity on _PARAM0_ to _PARAM2_',
    'Dynamically adjusts idle breathing sway amplitude multiplier.',
    'Action', [num('Intensity', 'Breathing intensity multiplier', '1.0')],
    `CT.setBreathingIntensity(behavior, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_TUNING }),

  fn('SetTargetLayer', 'Set target 3D layer',
    'Set target 3D layer for _PARAM0_ to _PARAM2_',
    'Sets the 3D layer name that contains the camera to modify (empty for base layer).',
    'Action', [layer('Layer', 'Target 3D Layer')],
    `CT.setTargetLayer(behavior, eventsFunctionContext.getArgument("Layer"));\n`,
    { group: G_TUNING }),

  fn('SetLeanMaxAngle', 'Set run/walk lean max angle',
    'Set run/walk lean max angle on _PARAM0_ to _PARAM2_ degrees',
    'The furthest the camera leans when moving at full speed sideways. Use a negative value if the lean tilts the wrong way for your rig.',
    'Action', [num('Angle', 'Max lean angle in degrees (negative inverts)', '2.0')],
    `CT.setLeanMaxAngle(behavior, eventsFunctionContext.getArgument("Angle"));\n`,
    { group: G_TUNING }),

  fn('SetTurnLeanAngle', 'Set turn lean angle',
    'Set turn lean angle on _PARAM0_ to _PARAM2_ degrees',
    'How far the camera banks into a turn, on top of the run/walk lean. Use a negative value to invert the direction.',
    'Action', [num('Angle', 'Turn lean angle in degrees (negative inverts)', '1.5')],
    `CT.setTurnLeanAngle(behavior, eventsFunctionContext.getArgument("Angle"));\n`,
    { group: G_TUNING }),

  fn('SetADSMotionDamping', 'Set ADS motion damping',
    'Set ADS motion damping on _PARAM0_ to _PARAM2_',
    'How much all procedural motion is scaled down while aiming down sights (0.0 = perfectly still, 1.0 = no damping).',
    'Action', [num('Damping', 'Motion scale while aiming (0.0 to 1.0)', '0.35')],
    `CT.setADSMotionDamping(behavior, eventsFunctionContext.getArgument("Damping"));\n`,
    { group: G_TUNING }),

  fn('SetManualLeanMaxAngle', 'Set manual lean max angle',
    'Set manual lean max angle on _PARAM0_ to _PARAM2_ degrees',
    'Sets the limit that "Set manual lean angle" is clamped to, and the angle at which the full sideways eye offset is reached.',
    'Action', [num('Angle', 'Maximum peek angle in degrees', '12.0')],
    `CT.setManualLeanMaxAngle(behavior, eventsFunctionContext.getArgument("Angle"));\n`,
    { group: G_LEAN }),

  fn('SetWorldUnitsPerMeter', 'Set world units per meter',
    'Set world units per meter on _PARAM0_ to _PARAM2_',
    'Sets the scale used to convert the internal physical model into your scene. 100 suits a default GDevelop 3D project; 0 auto-detects from the object height.',
    'Action', [num('Units', 'World units in one meter (0 = auto)', '100')],
    `CT.setWorldUnitsPerMeter(behavior, eventsFunctionContext.getArgument("Units"));\n`,
    { group: G_TUNING }),

  fn('SetLandingShockIntensity', 'Set landing shock intensity',
    'Set landing shock intensity on _PARAM0_ to _PARAM2_',
    'Dynamically adjusts vertical landing impact compression multiplier.',
    'Action', [num('Intensity', 'Landing shock intensity multiplier', '1.0')],
    `CT.setLandingShockIntensity(behavior, eventsFunctionContext.getArgument("Intensity"));\n`,
    { group: G_TUNING }),

  fn('SetRecoilPitchMultiplier', 'Set recoil pitch multiplier',
    'Set recoil pitch multiplier on _PARAM0_ to _PARAM2_',
    'Dynamically scales weapon upward kick (e.g. reduced when attaching a weapon grip or compensator).',
    'Action', [num('Multiplier', 'Recoil pitch multiplier', '1.0')],
    `CT.setRecoilPitchMultiplier(behavior, eventsFunctionContext.getArgument("Multiplier"));\n`,
    { group: G_TUNING }),

  fn('SetTraumaDecayRate', 'Set trauma decay rate',
    'Set trauma decay rate on _PARAM0_ to _PARAM2_ per second',
    'Adjusts how fast explosion and impact camera shake fades per second.',
    'Action', [num('Rate', 'Trauma decay per second', '1.2')],
    `CT.setTraumaDecayRate(behavior, eventsFunctionContext.getArgument("Rate"));\n`,
    { group: G_TUNING }),
];

/* ------------------------------------------------------------------ Conditions */

const G_CONDITIONS = 'Camera State';

const conditions = [
  fn('IsADS', 'Is Aiming Down Sights (ADS)',
    '_PARAM0_ is Aiming Down Sights (ADS)',
    'Checks if the camera is currently in ADS aiming mode.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isADS(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsSprinting', 'Is sprinting FOV active',
    '_PARAM0_ is in sprinting rush FOV',
    'Checks if sprint rush FOV and stride boost are active.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isSprinting(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsCrouching', 'Is crouching active',
    '_PARAM0_ is crouching',
    'Checks if sneak/crouch damping is currently active.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isCrouching(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsTraumaShakeActive', 'Is trauma shake active',
    'Trauma shake is active on _PARAM0_',
    'Returns true if explosion shake trauma is greater than 0.01.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isTraumaShakeActive(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsRecoilActive', 'Is weapon recoil active',
    'Weapon recoil spring is active on _PARAM0_',
    'Returns true if weapon recoil spring is currently in motion.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isRecoilActive(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsMotionSicknessMode', 'Is motion sickness mode enabled',
    'Motion sickness comfort mode is active on _PARAM0_',
    'Returns true if anti-nausea comfort mode is enabled.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isMotionSicknessMode(behavior);\n`,
    { group: G_CONDITIONS }),

  fn('IsGrounded', 'Is on the ground',
    '_PARAM0_ is detected as being on the ground',
    'Returns true if the ground state the camera is using reports the object as standing on the floor. Useful for checking that the character behavior was detected at all.',
    'Condition', [],
    `eventsFunctionContext.returnValue = CT.isGrounded(behavior);\n`,
    { group: G_CONDITIONS }),
];

/* ------------------------------------------------------------------ Expressions */

const G_EXPRESSIONS = 'Camera Metrics';

const expressions = [
  fn('RollOffset', 'Roll offset angle', '',
    'Returns the live procedural roll delta applied to the camera in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getRollOffset(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('HeadBobY', 'Head bob Y offset', '',
    'Returns the vertical head bob offset actually applied to the camera this frame, in world units.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getHeadBobY(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('HeadBobX', 'Head bob X offset', '',
    'Returns the horizontal head sway offset actually applied to the camera this frame, in world units.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getHeadBobX(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('LandingDipY', 'Landing dip Y offset', '',
    'Returns the vertical landing compression offset applied this frame, in world units.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getLandingDipY(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('RecoilPitch', 'Recoil pitch offset', '',
    'Returns current weapon recoil pitch displacement in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getRecoilPitch(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('RecoilYaw', 'Recoil yaw offset', '',
    'Returns current weapon recoil yaw displacement in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getRecoilYaw(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('RecoilKickbackZ', 'Recoil kickback Z offset', '',
    'Returns the weapon recoil backward translation applied this frame, in world units.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getRecoilKickbackZ(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('WorldUnitsPerMeter', 'World units per meter', '',
    'Returns the scale in use for converting the internal physical model into scene units.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getWorldUnitsPerMeter(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('CurrentFOV', 'Current live FOV', '',
    'Returns the actual live interpolated Field of View in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getCurrentFOV(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('TraumaLevel', 'Trauma shake level', '',
    'Returns current trauma level (0.0 to 1.0).',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getTraumaLevel(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('MovementSpeedRatio', 'Movement speed ratio', '',
    'Returns current normalized movement speed ratio driving stride frequency.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getMovementSpeedRatio(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('MasterMotionScale', 'Master motion scale', '',
    'Returns the master motion scale multiplier.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getMasterMotionScale(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('MasterShakeScale', 'Master shake scale', '',
    'Returns the master shake scale multiplier.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getMasterShakeScale(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('BobIntensity', 'Bob intensity', '',
    'Returns the current head bob intensity multiplier.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getBobIntensity(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('BreathingIntensity', 'Breathing intensity', '',
    'Returns the current idle breathing sway intensity multiplier.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getBreathingIntensity(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('BaseFOV', 'Base Field of View', '',
    'Returns the baseline resting Field of View in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getBaseFOV(behavior);\n`,
    { group: G_EXPRESSIONS }),

  fn('ManualLeanAngle', 'Manual lean angle', '',
    'Returns the current corner peeking manual lean angle in degrees.',
    'Expression', [],
    `eventsFunctionContext.returnValue = CT.getManualLeanAngle(behavior);\n`,
    { group: G_EXPRESSIONS }),
];

/* ------------------------------------------------------------------ Behavior Properties */

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const G_P_PRESET = 'Genre Preset';
const G_P_MODULES = 'Motion Modules';
const G_P_FOV = 'Field of View';
const G_P_MASTER = 'Comfort & Master Scales';
const G_P_SCALE = 'Scene Scale & Target';

const behavior = {
  name: BEHAVIOR_NAME,
  fullName: 'Camera Tweens 3D',
  description:
    'Modular procedural camera modifier for GDevelop 3D. Adds dual-octave Lissajous head bobbing, run/walk leaning, ' +
    'jump landing shocks, critically damped weapon recoil, non-linear trauma shakes (T^2), dynamic FOV transitions, and anti-nausea comfort mode.',
  objectType: '',
  propertyDescriptors: [
    // 1. Preset Profile Dropdown
    prop('PresetProfile', 'Choice', 'Genre Preset Profile',
      '1-Click camera feel profile for your game genre.',
      'Tactical Military (COD / Tarkov)',
      { extraInformation: PRESET_CHOICES, group: G_P_PRESET }),

    // 2. Modular Dropdown Styles
    prop('BobProfile', 'Choice', 'Head Bob Style',
      'Walking and sprinting head bobbing motion style.',
      'Default for Preset',
      { extraInformation: BOB_CHOICES, group: G_P_MODULES }),

    prop('LeanProfile', 'Choice', 'Run/Walk Lean Intensity',
      'How far the camera leans while moving: roll when running or walking sideways, plus banking into turns. "Off" disables both.',
      'Default for Preset',
      { extraInformation: LEAN_CHOICES, group: G_P_MODULES }),

    prop('LandingImpactProfile', 'Choice', 'Landing Impact Feel',
      'Vertical compression and pitch dip when hitting the ground, scaled by how fast you fell.',
      'Default for Preset',
      { extraInformation: LANDING_CHOICES, group: G_P_MODULES }),

    prop('BreathingProfile', 'Choice', 'Idle Breathing Sway',
      'Subtle idle camera breathing oscillation.',
      'Default for Preset',
      { extraInformation: BREATHING_CHOICES, group: G_P_MODULES }),

    prop('RecoilProfile', 'Choice', 'Weapon Recoil Feel',
      'Upward weapon kickback and spring snap return. "Off" also disables recoil yaw and kickback.',
      'Default for Preset',
      { extraInformation: RECOIL_CHOICES, group: G_P_MODULES }),

    prop('ShakeProfile', 'Choice', 'Explosion Shake Power',
      'Trauma screen shake magnitude for explosions and hits.',
      'Default for Preset',
      { extraInformation: SHAKE_CHOICES, group: G_P_MODULES }),

    prop('SpeedRushFOVProfile', 'Choice', 'Sprint Speed FOV Boost',
      'Dynamic FOV expansion when sprinting.',
      'Default for Preset',
      { extraInformation: SPEED_FOV_CHOICES, group: G_P_MODULES }),

    // 3. High-level FOV & Masters
    prop('BaseFOV', 'Number', 'Base Field of View (°, 0 = keep layer FOV)',
      'Baseline resting Field of View in degrees. Leave at 0 to inherit whatever the 3D layer is already set to, so adding this behavior does not change how your game looks.',
      '0', { group: G_P_FOV }),

    prop('ADSFOVTarget', 'Number', 'ADS Zoom FOV (°, 0 = auto)',
      'Zoomed-in Field of View when aiming down sights. Leave at 0 for two thirds of the base FOV.',
      '0', { group: G_P_FOV }),

    prop('MasterMotionScale', 'Number', 'Master Motion Scale',
      'Global multiplier for all motions (0.0 = disabled, 1.0 = normal). Wire this to a player settings slider.',
      '1.0', { group: G_P_MASTER }),

    prop('MasterShakeScale', 'Number', 'Master Shake Scale',
      'Global multiplier for all trauma and explosion shakes. Wire this to a player settings slider.',
      '1.0', { group: G_P_MASTER }),

    prop('MotionSicknessMode', 'Choice', 'Motion Sickness / Comfort Mode',
      'Holds the horizon flat: no run/walk lean, no turn lean, no horizontal sway, and the sprint FOV stays locked. "Auto" follows the operating system’s reduced-motion setting.',
      'Default for Preset',
      { extraInformation: COMFORT_CHOICES, group: G_P_MASTER }),

    // 4. Scene scale — the physical model is metric, the scene is not
    prop('WorldUnitsPerMeter', 'Number', 'World Units per Meter (0 = auto)',
      'How many scene units make one meter. GDevelop 3D uses the same units as 2D, so 100 suits most projects. Leave at 0 to estimate it from the object height.',
      '100', { group: G_P_SCALE }),

    prop('WalkSpeedReference', 'Number', 'Walk Speed Reference (0 = auto)',
      'The movement speed, in world units per second, that counts as a full-amplitude walk. Leave at 0 to read it from the character behavior.',
      '0', { group: G_P_SCALE }),

    prop('Layer', 'String', 'Target 3D Layer',
      'Name of the 3D layer containing the camera (leave empty for Base layer).', '',
      { group: G_P_SCALE })
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
];

/* ------------------------------------------------------------------ Extension Manifest */

const extension = {
  author: 'Twillion',
  category: '3D',
  extensionNamespace: '',
  fullName: 'Camera Tweens 3D',
  name: EXTENSION_NAME,
  version: '1.2.0',
  shortDescription: 'Procedural camera motion: head bobbing, run/walk leaning, critically damped weapon recoil, jump landing shocks, trauma shakes (T^2), dynamic FOV, and anti-nausea comfort mode.',
  description: `**CameraTweens3D** is a modular, high-polish procedural camera modifier and tweening extension for **GDevelop 5 (Three.js backend)**.

Instead of replacing your existing camera, **CameraTweens3D** acts as a plug-and-play procedural effect layer that sits on top of **any** 3D camera (GDevelop's built-in First Person 3D camera, Third-Person camera, top-down view, or vehicle rigs)—instantly giving your game AAA-grade physical weight, dynamic head bobbing, run/walk leaning, jump landing shocks, trauma-based screen shakes, weapon recoil kicks, and smooth FOV transitions.

### Key Highlights:
- **Universal Camera Compatibility:** Works seamlessly with GDevelop's built-in First Person camera, Third Person camera, custom rigs, and vehicle cameras without control conflicts.
- **8 Modular Tuning Categories:** Granular control over Head Bobbing, Run/Walk Leaning, Jump Landing Shocks, Breathing Sway, Weapon Recoil, Explosion Trauma ($T^2$), Dynamic FOV, and Master Accessibility Scales.
- **4 One-Click Genre Presets:** Instantly apply pre-configured camera profiles (\`ImmersiveHorror\`, \`FastArcadeShooter\`, \`TacticalMilitary\`, \`AccessibilityComfort\`).
- **Full In-Game Options Menu Support:** Global multiplier actions allow hooking player settings sliders directly into camera shake and motion scales.
- **Motion Sickness / Anti-Nausea Mode:** Instantly zero out roll tilt, horizontal sway, and harsh FOV changes with a single action.`,
  helpPath: '',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  tags: [
    '3D', 'camera', 'tween', 'shake', 'recoil', 'bobbing', 'trauma', 'lean',
    'fov', 'fps', 'third-person', 'immersion', 'polish', 'tilt', 'landing'
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

checkControlChars(rawRuntime, 'CameraTweens3D.runtime.js');

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
    // An unbound behavior parameter generates getBehavior("") and throws at runtime.
    if (p.type === 'behavior' && p.supplementaryInformation !== BEHAVIOR_TYPE) {
      console.error(
        `\nBehavior parameter ${f.name}.${p.name} must carry supplementaryInformation ` +
        `"${BEHAVIOR_TYPE}" (found ${JSON.stringify(p.supplementaryInformation)}).\n`
      );
      process.exit(1);
    }
  }
  // Every behavior function is called as object.getBehavior(name).<Function>(...), so the first
  // two parameters have to be the object and the behavior, in that order.
  if (f.parameters[0]?.type !== 'object' || f.parameters[1]?.type !== 'behavior') {
    console.error(`\nBehavior function ${f.name} must start with (object, behavior) parameters.\n`);
    process.exit(1);
  }
}

if (extension.name !== EXTENSION_NAME || behavior.name !== BEHAVIOR_NAME) {
  console.error(
    `\nBEHAVIOR_TYPE "${BEHAVIOR_TYPE}" does not match the declared ` +
    `${extension.name}::${behavior.name}. Behavior parameters would bind to nothing.\n`
  );
  process.exit(1);
}

for (const f of extension.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on global ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

const out = path.join(here, 'CameraTweens3D.json');
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
