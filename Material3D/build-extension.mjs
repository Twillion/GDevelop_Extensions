/**
 * build-extension.mjs
 * Builds Material3D.json from Material3D.runtime.js + the declarations below.
 *
 * Run: node Material3D/build-extension.mjs
 *
 * Material3D is the consolidation of three earlier extensions:
 *   AnimatedPBR3D      v2.0.0  — the base. Texture maps, UV animation, flipbook, video.
 *   AdvancedMaterials  v1.3.1  — transmission / IOR / thickness / clearcoat (reimplemented,
 *                                not copied; that extension is authored by Antigravity).
 *   Advanced3DMaterial v1.0.0  — the diagnostics, runtime retargeting and per-property setters.
 *
 * BRDFMaterials is deliberately NOT merged. It patches the existing material's shader through
 * onBeforeCompile rather than replacing the material, so it composes with this extension instead
 * of competing with it. See MATERIAL-CONSOLIDATION-PLAN.md §1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const rawRuntime = fs.readFileSync(path.join(here, 'Material3D.runtime.js'), 'utf8');
const rawBrdfRuntime = fs.readFileSync(path.join(here, 'BRDFMaterial.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const runtime = rawRuntime;
const brdfRuntime = rawBrdfRuntime;
const NS = 'gdjs.__material3D';

const EXTENSION_NAME = 'Material3D';
const BEHAVIOR_NAME = 'Material3D';

/**
 * A `behavior` parameter MUST carry the behavior's fully qualified type in
 * `supplementaryInformation`. Without it the code generator emits `getBehavior("")`, which
 * returns undefined, so every ACE throws on first call while lifecycle hooks still appear to work.
 */
const BEHAVIOR_TYPE = `${EXTENSION_NAME}::${BEHAVIOR_NAME}`;

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: BEHAVIOR_TYPE },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });
const color = (name, description) => ({ name, type: 'color', description });
const image = (name, description) => ({ name, type: 'imageResource', description });
const choiceParam = (name, description, options) => ({
  name, type: 'stringWithSelector', description,
  supplementaryInformation: JSON.stringify(options),
});

/**
 * The validated preamble. A JsCode block receives only (runtimeScene, eventsFunctionContext) —
 * there is no `object` and no `behavior` in scope, which is the trap that made AnimatedPBR3D 1.0.0
 * throw on frame 1 for every object. Both are derived from eventsFunctionContext here.
 */
const PREAMBLE = `const __m3dObjects = eventsFunctionContext.getObjects("Object");
const object = __m3dObjects.length ? __m3dObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const M3 = ${NS};
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
  private: opts.private === true,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

/* ================================================================= Choice vocabularies */

const TARGET_MODES = ['All materials', 'First material', 'Material index', 'Material name', 'Mesh name'];
const FILTER_MODES = ['Keep Original', 'Nearest', 'Linear'];
const ALPHA_MODES = ['Preserve', 'Opaque', 'Blend', 'Cutout', 'Additive', 'Multiply'];
const SIDE_MODES = ['Preserve', 'Front', 'Double', 'Back'];
const UPDATE_MODES = ['Apply once', 'Every frame', 'Manual'];
const SHADER_TYPES = [
  'Auto',
  'Keep Original',
  'Basic (unlit)',
  'Standard (PBR)',
  'Physical (transmission, clearcoat)',
];

/* ================================================================= Function groups */

const G_LIFECYCLE = '';
const G_CONTROL = 'Apply & Control';
const G_TARGET = 'Targeting';
const G_SURFACE = 'Surface & Colour';
const G_PHYSICAL = 'Glass & Clearcoat';
const G_TEX = 'Textures';
const G_UV = 'UV Animation';
const G_FLIP = 'Flipbook & Video';
const G_RENDER = 'Render State';
const G_DIAG = 'Diagnostics';

/* ================================================================= Setter generator
 *
 * Every setter writes a runtime override through M3.setOverride and lets UpdateMode decide when
 * it lands. That is the whole mechanism: the runtime's property getters consult the override map
 * before the editor property, so one generic path covers all 57 properties without a bespoke
 * runtime function per field.
 *
 * `heavy: true` forces a full re-apply instead. Needed when the change cannot be expressed by
 * re-running applyMaterialSettings over the existing materials — a different material class, or a
 * different set of target meshes.
 */
const setter = (prop, fullName, sentence, description, paramType, group, opts = {}) => {
  const param =
    paramType === 'number' ? num('Value', description)
    : paramType === 'bool' ? bool('Value', description)
    : paramType === 'color' ? color('Value', description)
    : paramType === 'choice' ? choiceParam('Value', description, opts.choices)
    : str('Value', description);

  const read =
    paramType === 'number' ? 'eventsFunctionContext.getArgument("Value")'
    : paramType === 'bool' ? 'eventsFunctionContext.getArgument("Value")'
    : 'eventsFunctionContext.getArgument("Value")';

  const body = opts.heavy
    ? `M3.setOverride(behavior, ${JSON.stringify(prop)}, ${read});\n` +
      `M3.reapply(behavior, object, runtimeScene.getGame());\n`
    : `M3.setOverride(behavior, ${JSON.stringify(prop)}, ${read});\n`;

  return fn(`Set${prop}`, fullName, sentence, description, 'Action', [param], body, { group });
};

/** Number expression reading a live material field via the behavior's own getters. */
const numExpr = (name, fullName, description, expr, group) =>
  fn(name, fullName, '', description, 'Expression', [],
    `eventsFunctionContext.returnValue = ${expr};\n`, { group });

/** String expression. GDevelop distinguishes these from number expressions by functionType. */
const strExpr = (name, fullName, description, expr, group) =>
  fn(name, fullName, '', description, 'StringExpression', [],
    `eventsFunctionContext.returnValue = ${expr};\n`, { group });

/** Condition. A bare `return` is discarded — conditions must assign returnValue. */
const cond = (name, fullName, sentence, description, params, expr, group) =>
  fn(name, fullName, sentence, description, 'Condition', params,
    `eventsFunctionContext.returnValue = ${expr};\n`, { group });

/* ================================================================= Behavior functions */

const behaviorFunctions = [
  /* ---------------------------------------------------------------- Lifecycle */
  fn('doStepPreEvents', 'doStepPreEvents', '', '', 'Action', [],
    `M3.tick(behavior, object, runtimeScene);\n`,
    { withRuntime: true, private: true }),

  fn('onDestroy', 'onDestroy', '', '', 'Action', [],
    `const state = M3.getBehaviorState(behavior);\n` +
    `const root = M3.getRootObject3D(object);\n` +
    `if (root) M3.restoreOriginalMaterials(state, M3.collectMeshRecords(root, true));\n`,
    { private: true }),

  /* ---------------------------------------------------------------- Apply & control */
  fn('ApplyMaterial', 'Apply material now', 'Apply _PARAM0_ material settings',
    'Build and apply the configured material immediately, without waiting for the next frame.',
    'Action', [],
    `M3.applyToBehavior(behavior, object, runtimeScene.getGame());\n`, { group: G_CONTROL }),

  fn('ReapplyMaterial', 'Reapply material', 'Reapply _PARAM0_ material',
    'Rebuild the material from scratch. Use after changing targeting or shader type, or when Update Mode is Manual.',
    'Action', [],
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_CONTROL }),

  fn('MarkSettingsChanged', 'Mark settings as changed', 'Mark _PARAM0_ material settings as changed',
    'Flag the material as needing a settings refresh on the next frame. Cheaper than a full reapply.',
    'Action', [],
    `M3.markDirty(behavior);\n`, { group: G_CONTROL }),

  fn('RefreshSettings', 'Refresh settings now', 'Refresh _PARAM0_ material settings',
    'Re-read every property and re-apply it to the existing materials immediately, without rebuilding them.',
    'Action', [],
    `M3.refreshSettings(behavior);\n`, { group: G_CONTROL }),

  fn('RestoreMaterials', 'Restore original materials', 'Restore _PARAM0_ original materials',
    'Put back the materials the object shipped with and drop everything this behavior created, including runtime overrides.',
    'Action', [],
    `const state = M3.getBehaviorState(behavior);\n` +
    `const root = M3.getRootObject3D(object);\n` +
    `if (root) M3.restoreOriginalMaterials(state, M3.collectMeshRecords(root, true));\n`,
    { group: G_CONTROL }),

  /* ---------------------------------------------------------------- Targeting (heavy) */
  setter('TargetMode', 'Set target mode', 'Set _PARAM0_ target mode to _PARAM2_',
    'Which materials this behavior drives. Rebuilds the material set.', 'choice', G_TARGET,
    { choices: TARGET_MODES, heavy: true }),
  setter('MaterialIndex', 'Set material index', 'Set _PARAM0_ target material index to _PARAM2_',
    'Material slot to target when Target Mode is "Material index".', 'number', G_TARGET, { heavy: true }),
  setter('MaterialName', 'Set material name', 'Set _PARAM0_ target material name to _PARAM2_',
    'Material name to target when Target Mode is "Material name".', 'string', G_TARGET, { heavy: true }),
  setter('MeshName', 'Set mesh name', 'Set _PARAM0_ target mesh name to _PARAM2_',
    'Mesh name to target when Target Mode is "Mesh name".', 'string', G_TARGET, { heavy: true }),
  setter('ShaderType', 'Set shader type', 'Set _PARAM0_ shader type to _PARAM2_',
    'Material class to build. Changing this rebuilds the material.', 'choice', G_TARGET,
    { choices: SHADER_TYPES, heavy: true }),

  /* ---------------------------------------------------------------- Surface & colour */
  setter('BaseColor', 'Set base colour', 'Set _PARAM0_ base colour to _PARAM2_',
    'Base (albedo) colour. Requires "Use Base Color" to be on.', 'color', G_SURFACE),
  setter('UseBaseColor', 'Enable base colour override', 'Set _PARAM0_ base colour override to _PARAM2_',
    'Whether the base colour property overrides the model\'s own colour.', 'bool', G_SURFACE),
  setter('Roughness', 'Set roughness', 'Set _PARAM0_ roughness to _PARAM2_',
    'Surface roughness, 0 (mirror) to 1 (fully diffuse).', 'number', G_SURFACE),
  setter('Metalness', 'Set metalness', 'Set _PARAM0_ metalness to _PARAM2_',
    'How metallic the surface is, 0 (dielectric) to 1 (metal).', 'number', G_SURFACE),
  setter('UseEmissive', 'Enable emissive', 'Set _PARAM0_ emissive to _PARAM2_',
    'Whether the emissive colour and strength are applied at all.', 'bool', G_SURFACE),
  setter('EmissiveColor', 'Set emissive colour', 'Set _PARAM0_ emissive colour to _PARAM2_',
    'Glow colour. Requires "Use Emissive" to be on.', 'color', G_SURFACE),
  setter('EmissiveStrength', 'Set emissive strength', 'Set _PARAM0_ emissive strength to _PARAM2_',
    'Glow intensity multiplier.', 'number', G_SURFACE),

  /* ---------------------------------------------------------------- Physical */
  setter('Transmission', 'Set transmission', 'Set _PARAM0_ transmission to _PARAM2_',
    'Glass-like light transmission, 0 to 1. Above 0 forces the Physical material class.',
    'number', G_PHYSICAL),
  setter('IOR', 'Set index of refraction', 'Set _PARAM0_ IOR to _PARAM2_',
    'Index of refraction, 1.0 to 2.333. Glass is about 1.5.', 'number', G_PHYSICAL),
  setter('Thickness', 'Set thickness', 'Set _PARAM0_ thickness to _PARAM2_',
    'Volume thickness behind the surface, for refraction.', 'number', G_PHYSICAL),
  setter('Clearcoat', 'Set clearcoat', 'Set _PARAM0_ clearcoat to _PARAM2_',
    'Clear lacquer layer strength, 0 to 1. Above 0 forces the Physical material class.',
    'number', G_PHYSICAL),
  setter('ClearcoatRoughness', 'Set clearcoat roughness', 'Set _PARAM0_ clearcoat roughness to _PARAM2_',
    'Roughness of the clearcoat layer, 0 to 1.', 'number', G_PHYSICAL),

  /* ---------------------------------------------------------------- Render state */
  setter('AlphaMode', 'Set alpha mode', 'Set _PARAM0_ alpha mode to _PARAM2_',
    'How transparency is handled. "Preserve" leaves the model as authored.',
    'choice', G_RENDER, { choices: ALPHA_MODES }),
  setter('Alpha', 'Set alpha', 'Set _PARAM0_ alpha to _PARAM2_',
    'Opacity, 0 to 1. Applies in Blend, Additive and Multiply modes.', 'number', G_RENDER),
  setter('AlphaCutoff', 'Set alpha cutoff', 'Set _PARAM0_ alpha cutoff to _PARAM2_',
    'Discard threshold in Cutout mode, 0 to 1.', 'number', G_RENDER),
  setter('DepthWrite', 'Set depth write', 'Set _PARAM0_ depth write to _PARAM2_',
    'Whether the surface writes to the depth buffer.', 'bool', G_RENDER),
  setter('MaterialSide', 'Set material side', 'Set _PARAM0_ rendered side to _PARAM2_',
    'Which faces are drawn. "Preserve" leaves the model as authored.',
    'choice', G_RENDER, { choices: SIDE_MODES }),
  setter('Wireframe', 'Set wireframe', 'Set _PARAM0_ wireframe to _PARAM2_',
    'Draw the mesh as edges only.', 'bool', G_RENDER),
  setter('Fog', 'Set fog', 'Set _PARAM0_ fog to _PARAM2_',
    'Whether scene fog affects this surface.', 'bool', G_RENDER),
  setter('CastShadow', 'Set cast shadow', 'Set _PARAM0_ cast shadow to _PARAM2_',
    'Whether the mesh casts shadows.', 'bool', G_RENDER),
  setter('ReceiveShadow', 'Set receive shadow', 'Set _PARAM0_ receive shadow to _PARAM2_',
    'Whether the mesh receives shadows.', 'bool', G_RENDER),
  setter('RenderOrder', 'Set render order', 'Set _PARAM0_ render order to _PARAM2_',
    'Draw order override. Higher draws later; useful for sorting transparency.', 'number', G_RENDER),
  setter('TextureFiltering', 'Set texture filtering', 'Set _PARAM0_ texture filtering to _PARAM2_',
    'Nearest for pixel art, Linear for smooth.', 'choice', G_RENDER, { choices: FILTER_MODES }),

  /* ---------------------------------------------------------------- Textures */
  fn('SetAlbedoTexture', 'Set albedo / base texture', 'Set _PARAM0_ albedo texture to _PARAM2_',
    'Replace the base colour map.', 'Action', [image('ResourceName', 'Image resource')],
    `M3.setOverride(behavior, "AlbedoMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  fn('SetNormalTexture', 'Set normal map texture', 'Set _PARAM0_ normal map to _PARAM2_ (scale _PARAM3_)',
    'Replace the normal map and its scale.', 'Action',
    [image('ResourceName', 'Image resource'), num('Scale', 'Normal scale', '1')],
    `M3.setOverride(behavior, "NormalMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.setOverride(behavior, "NormalScale", eventsFunctionContext.getArgument("Scale"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  fn('SetRoughnessTexture', 'Set roughness map & factor', 'Set _PARAM0_ roughness map to _PARAM2_ (factor _PARAM3_)',
    'Replace the roughness map and factor.', 'Action',
    [image('ResourceName', 'Image resource'), num('Roughness', 'Roughness factor', '0.5')],
    `M3.setOverride(behavior, "RoughnessMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.setOverride(behavior, "Roughness", eventsFunctionContext.getArgument("Roughness"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  fn('SetMetalnessTexture', 'Set metalness map & factor', 'Set _PARAM0_ metalness map to _PARAM2_ (factor _PARAM3_)',
    'Replace the metalness map and factor.', 'Action',
    [image('ResourceName', 'Image resource'), num('Metalness', 'Metalness factor', '0')],
    `M3.setOverride(behavior, "MetalnessMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.setOverride(behavior, "Metalness", eventsFunctionContext.getArgument("Metalness"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  fn('SetAOTexture', 'Set ambient occlusion map', 'Set _PARAM0_ AO map to _PARAM2_ (intensity _PARAM3_)',
    'Replace the ambient occlusion map and its intensity.', 'Action',
    [image('ResourceName', 'Image resource'), num('Intensity', 'AO intensity', '1')],
    `M3.setOverride(behavior, "AOMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.setOverride(behavior, "AOIntensity", eventsFunctionContext.getArgument("Intensity"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  fn('SetEmissiveTexture', 'Set emissive map & glow', 'Set _PARAM0_ emissive map to _PARAM2_',
    'Replace the emissive map, colour and strength in one action.', 'Action',
    [image('ResourceName', 'Image resource'), num('Red', 'Red (0-255)', '255'),
     num('Green', 'Green (0-255)', '255'), num('Blue', 'Blue (0-255)', '255'),
     num('Strength', 'Emissive strength', '1')],
    `const r = eventsFunctionContext.getArgument("Red");\n` +
    `const g = eventsFunctionContext.getArgument("Green");\n` +
    `const b = eventsFunctionContext.getArgument("Blue");\n` +
    `M3.setOverride(behavior, "EmissiveMap", eventsFunctionContext.getArgument("ResourceName"));\n` +
    `M3.setOverride(behavior, "UseEmissive", true);\n` +
    `M3.setOverride(behavior, "EmissiveColor", r + ";" + g + ";" + b);\n` +
    `M3.setOverride(behavior, "EmissiveStrength", eventsFunctionContext.getArgument("Strength"));\n` +
    `M3.reapply(behavior, object, runtimeScene.getGame());\n`, { group: G_TEX }),

  /* ---------------------------------------------------------------- UV animation */
  fn('SetTiling', 'Set texture tiling / repeat', 'Set _PARAM0_ tiling to _PARAM2_ x _PARAM3_',
    'How many times the texture repeats across the surface.', 'Action',
    [num('TilingX', 'Tiling X', '1'), num('TilingY', 'Tiling Y', '1')],
    `const state = M3.getBehaviorState(behavior);\n` +
    `state.baseTilingX = eventsFunctionContext.getArgument("TilingX");\n` +
    `state.baseTilingY = eventsFunctionContext.getArgument("TilingY");\n` +
    `M3.applyUVTransform(state);\n`, { group: G_UV }),

  fn('SetUVOffset', 'Set texture offset', 'Set _PARAM0_ UV offset to _PARAM2_, _PARAM3_',
    'Shift the texture across the surface.', 'Action',
    [num('OffsetX', 'Offset X', '0'), num('OffsetY', 'Offset Y', '0')],
    `const state = M3.getBehaviorState(behavior);\n` +
    `state.baseOffsetX = eventsFunctionContext.getArgument("OffsetX");\n` +
    `state.baseOffsetY = eventsFunctionContext.getArgument("OffsetY");\n` +
    `M3.applyUVTransform(state);\n`, { group: G_UV }),

  fn('SetUVRotation', 'Set texture rotation', 'Set _PARAM0_ UV rotation to _PARAM2_ degrees',
    'Rotate the texture on the surface.', 'Action', [num('Angle', 'Angle in degrees', '0')],
    `const state = M3.getBehaviorState(behavior);\n` +
    `state.baseRotation = eventsFunctionContext.getArgument("Angle");\n` +
    `M3.applyUVTransform(state);\n`, { group: G_UV }),

  fn('SetScrollSpeed', 'Set UV scroll speed', 'Set _PARAM0_ scroll speed to _PARAM2_, _PARAM3_ (rot _PARAM4_)',
    'Continuous UV scrolling, in UV units per second.', 'Action',
    [num('SpeedX', 'Speed X', '0'), num('SpeedY', 'Speed Y', '0'), num('RotSpeed', 'Rotation speed (deg/s)', '0')],
    `const state = M3.getBehaviorState(behavior);\n` +
    `state.scrollSpeedX = eventsFunctionContext.getArgument("SpeedX");\n` +
    `state.scrollSpeedY = eventsFunctionContext.getArgument("SpeedY");\n` +
    `state.scrollRotSpeed = eventsFunctionContext.getArgument("RotSpeed");\n`, { group: G_UV }),

  fn('EnableScrolling', 'Enable/disable UV scrolling', 'Set _PARAM0_ UV scrolling to _PARAM2_',
    'Turn continuous UV scrolling on or off.', 'Action', [bool('Enable', 'Enable scrolling')],
    `M3.getBehaviorState(behavior).isScrolling = eventsFunctionContext.getArgument("Enable");\n`,
    { group: G_UV }),

  /* ---------------------------------------------------------------- Flipbook & video */
  fn('SetFlipbookConfig', 'Configure flipbook spritesheet', 'Configure _PARAM0_ flipbook: _PARAM2_ x _PARAM3_ at _PARAM4_ FPS',
    'Set the spritesheet grid, playback rate and looping.', 'Action',
    [num('Columns', 'Columns', '1'), num('Rows', 'Rows', '1'),
     num('FPS', 'Frames per second', '12'), bool('Loop', 'Loop')],
    `const fb = M3.getBehaviorState(behavior).flipbook;\n` +
    `fb.columns = Math.max(1, Math.floor(eventsFunctionContext.getArgument("Columns")));\n` +
    `fb.rows = Math.max(1, Math.floor(eventsFunctionContext.getArgument("Rows")));\n` +
    `fb.fps = Math.max(0.01, eventsFunctionContext.getArgument("FPS"));\n` +
    `fb.loop = eventsFunctionContext.getArgument("Loop");\n` +
    `fb.totalFrames = fb.columns * fb.rows;\n` +
    `fb.enabled = true;\n` +
    `fb.isFinished = false;\n`, { group: G_FLIP }),

  fn('SetFlipbookFrame', 'Set flipbook frame', 'Set _PARAM0_ flipbook frame to _PARAM2_',
    'Jump to a specific frame.', 'Action', [num('FrameIndex', 'Frame index (0-based)', '0')],
    `const state = M3.getBehaviorState(behavior);\n` +
    `const fb = state.flipbook;\n` +
    `const i = Math.floor(eventsFunctionContext.getArgument("FrameIndex"));\n` +
    `fb.currentFrame = Math.max(0, Math.min(fb.totalFrames - 1, i));\n` +
    `fb.timer = 0;\n` +
    `fb.isFinished = false;\n` +
    `M3.applyUVTransform(state);\n`, { group: G_FLIP }),

  fn('PlayFlipbook', 'Play flipbook animation', 'Play _PARAM0_ flipbook', 'Resume flipbook playback.',
    'Action', [],
    `const fb = M3.getBehaviorState(behavior).flipbook;\n` +
    `fb.isPlaying = true;\n` +
    `fb.isFinished = false;\n`, { group: G_FLIP }),

  fn('PauseFlipbook', 'Pause flipbook animation', 'Pause _PARAM0_ flipbook', 'Pause flipbook playback.',
    'Action', [],
    `M3.getBehaviorState(behavior).flipbook.isPlaying = false;\n`, { group: G_FLIP }),

  fn('SetVideoTexture', 'Set video texture (from URL)', 'Set _PARAM0_ video texture to _PARAM2_',
    'Play a video on the surface from a URL.', 'Action',
    [str('VideoURL', 'Video URL'), bool('Loop', 'Loop'), bool('Muted', 'Muted')],
    `M3.setVideo(behavior, object, runtimeScene.getGame(), eventsFunctionContext.getArgument("VideoURL"), eventsFunctionContext.getArgument("Loop"), eventsFunctionContext.getArgument("Muted"));\n`,
    { group: G_FLIP }),

  fn('PlayVideo', 'Play video texture', 'Play _PARAM0_ video', 'Resume video playback.', 'Action', [],
    `const state = M3.getBehaviorState(behavior);\n` +
    `if (state.videoElement) { try { state.videoElement.play(); } catch(e) {} }\n`, { group: G_FLIP }),

  fn('PauseVideo', 'Pause video texture', 'Pause _PARAM0_ video', 'Pause video playback.', 'Action', [],
    `const state = M3.getBehaviorState(behavior);\n` +
    `if (state.videoElement) { try { state.videoElement.pause(); } catch(e) {} }\n`, { group: G_FLIP }),

  /* ---------------------------------------------------------------- Diagnostics: conditions
   *
   * 3D material work in GDevelop fails silently — a wrong mesh name, a renderer that was not
   * ready, a material that was not cloned, all render as "nothing happened" with a clean console.
   * These are the merged-in Advanced3DMaterial layer that makes that visible from events.
   */
  cond('IsReady', 'Material is ready', '_PARAM0_ material is ready',
    'The material was built and applied successfully.', [],
    `M3.getStateName(behavior) === 'Ready'`, G_DIAG),

  cond('IsSuccess', 'Material application succeeded', '_PARAM0_ material application succeeded',
    'Same as "is ready" — the material is applied and in use.', [],
    `M3.getStateName(behavior) === 'Ready'`, G_DIAG),

  cond('IsWaiting', 'Material is waiting for renderer', '_PARAM0_ material is waiting for the renderer',
    'The 3D renderer was not available yet; the behavior is retrying.', [],
    `M3.getStateName(behavior) === 'WaitingForRenderer' || M3.getStateName(behavior) === 'Uninitialized'`, G_DIAG),

  cond('IsFailed', 'Material application failed', '_PARAM0_ material application failed',
    'The material could not be applied. Read the reason with the LastError expression.', [],
    `M3.getStateName(behavior) === 'Failed'`, G_DIAG),

  cond('IsIdle', 'Material is idle', '_PARAM0_ material is idle',
    'Apply On Creation is off and no apply has been requested yet.', [],
    `M3.getStateName(behavior) === 'Idle'`, G_DIAG),

  cond('HasMatchingMaterials', 'Has matching materials', '_PARAM0_ has matching materials',
    'The targeting matched at least one material. If this is false, check Target Mode and the name fields.',
    [], `M3.getMaterialCount(behavior) > 0`, G_DIAG),

  cond('HasMatchingMeshes', 'Has matching meshes', '_PARAM0_ has matching meshes',
    'The targeting matched at least one mesh.', [], `M3.getMeshCount(behavior) > 0`, G_DIAG),

  cond('IsUsingShaderType', 'Is using shader type', '_PARAM0_ is using shader type _PARAM2_',
    'Check which material class was actually built. Useful when Shader Type is "Auto".',
    [choiceParam('Type', 'Material class', ['Basic', 'Standard', 'Physical'])],
    `M3.getMaterialClassName(behavior) === eventsFunctionContext.getArgument("Type")`, G_DIAG),

  cond('IsDirty', 'Has pending changes', '_PARAM0_ has pending material changes',
    'A setter ran but the change has not been applied yet (Update Mode is Manual).', [],
    `M3.isDirty(behavior)`, G_DIAG),

  cond('IsFlipbookPlaying', 'Is flipbook playing', '_PARAM0_ flipbook is playing',
    'The flipbook animation is advancing.', [],
    `M3.getBehaviorState(behavior).flipbook.isPlaying === true`, G_FLIP),

  cond('IsFlipbookFinished', 'Is flipbook finished', '_PARAM0_ flipbook is finished',
    'A non-looping flipbook reached its last frame.', [],
    `M3.getBehaviorState(behavior).flipbook.isFinished === true`, G_FLIP),

  cond('IsScrollingEnabled', 'Is UV scrolling enabled', '_PARAM0_ UV scrolling is enabled',
    'Continuous UV scrolling is on.', [],
    `M3.getBehaviorState(behavior).isScrolling === true`, G_UV),

  /* ---------------------------------------------------------------- Diagnostics: expressions */
  numExpr('MatchingMaterialCount', 'Matching material count',
    'How many materials the targeting matched.', `M3.getMaterialCount(behavior)`, G_DIAG),
  numExpr('MatchingMeshCount', 'Matching mesh count',
    'How many meshes the targeting matched.', `M3.getMeshCount(behavior)`, G_DIAG),
  numExpr('RetryCount', 'Retry count',
    'How many times the behavior retried waiting for the renderer.', `M3.getRetryCount(behavior)`, G_DIAG),
  strExpr('State', 'Material state',
    'Uninitialized, WaitingForRenderer, Idle, Ready or Failed.', `M3.getStateName(behavior)`, G_DIAG),
  strExpr('LastError', 'Last error',
    'Why the last material application failed, or an empty string.', `M3.getError(behavior)`, G_DIAG),
  strExpr('MaterialClass', 'Material class',
    'Which Three.js material class was built: Basic, Standard or Physical.',
    `M3.getMaterialClassName(behavior)`, G_DIAG),

  numExpr('CurrentFrame', 'Current flipbook frame', 'The frame the flipbook is showing.',
    `M3.getBehaviorState(behavior).flipbook.currentFrame`, G_FLIP),
  numExpr('TotalFrames', 'Total flipbook frames', 'How many frames the flipbook has.',
    `M3.getBehaviorState(behavior).flipbook.totalFrames`, G_FLIP),
  numExpr('ScrollOffsetX', 'Scroll UV offset X', 'Current accumulated UV scroll offset, X.',
    `M3.getBehaviorState(behavior).uvOffset.x`, G_UV),
  numExpr('ScrollOffsetY', 'Scroll UV offset Y', 'Current accumulated UV scroll offset, Y.',
    `M3.getBehaviorState(behavior).uvOffset.y`, G_UV),
  numExpr('ScrollRotation', 'Scroll UV rotation', 'Current accumulated UV scroll rotation, degrees.',
    `M3.getBehaviorState(behavior).uvRotation`, G_UV),
];

/* ================================================================= Behavior properties */

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const P_APPLY = 'Apply & Targeting';
const P_CLASS = 'Material Class';
const P_SURFACE = 'Surface & Colour';
const P_MAPS = 'Texture Maps';
const P_PHYS = 'Glass & Clearcoat';
const P_UV = 'UV Transform';
const P_SCROLL = 'UV Scrolling';
const P_FLIP = 'Flipbook';
const P_RENDER = 'Render State';

const properties = [
  /* Apply & targeting */
  prop('ApplyOnCreation', 'Boolean', 'Apply on creation',
    'Build and apply the material as soon as the object exists.', 'true', { group: P_APPLY }),
  prop('UpdateMode', 'Choice', 'Update mode',
    'When property changes take effect. "Every frame" re-reads every property each frame; "Manual" waits for the Reapply action.',
    'Apply once', { extraInformation: UPDATE_MODES, group: P_APPLY }),
  prop('CloneMaterials', 'Boolean', 'Clone materials',
    'Give this object its own copy of the material. Off means edits affect every object sharing it.',
    'true', { group: P_APPLY }),
  prop('IncludeChildren', 'Boolean', 'Include child meshes',
    'Walk the whole model tree, not just the root mesh.', 'true', { group: P_APPLY }),
  prop('TargetMode', 'Choice', 'Target mode',
    'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: P_APPLY }),
  prop('MaterialIndex', 'Number', 'Material index',
    'Slot to target when Target Mode is "Material index".', '0', { group: P_APPLY }),
  prop('MaterialName', 'String', 'Material name',
    'Name to match when Target Mode is "Material name".', '', { group: P_APPLY }),
  prop('MeshName', 'String', 'Mesh name',
    'Name to match when Target Mode is "Mesh name".', '', { group: P_APPLY }),

  /* Material class */
  prop('ShaderType', 'Choice', 'Material class',
    'Which Three.js material to build. "Auto" uses Physical only when transmission or clearcoat is in use, and Standard otherwise.',
    'Auto', { extraInformation: SHADER_TYPES, group: P_CLASS }),

  /* Surface & colour */
  prop('UseBaseColor', 'Boolean', 'Override base colour',
    'Apply the base colour below instead of keeping the model\'s own.', 'false', { group: P_SURFACE }),
  prop('BaseColor', 'Color', 'Base colour', 'Albedo tint.', '255;255;255', { group: P_SURFACE }),
  prop('Roughness', 'Number', 'Roughness', '0 is mirror-smooth, 1 is fully diffuse.', '0.5', { group: P_SURFACE }),
  prop('Metalness', 'Number', 'Metalness', '0 is dielectric, 1 is metal.', '0', { group: P_SURFACE }),
  prop('UseEmissive', 'Boolean', 'Override emissive',
    'Apply the emissive colour and strength below. Off leaves the model\'s own glow alone.',
    'false', { group: P_SURFACE }),
  prop('EmissiveColor', 'Color', 'Emissive colour', 'Glow colour.', '0;0;0', { group: P_SURFACE }),
  prop('EmissiveStrength', 'Number', 'Emissive strength', 'Glow intensity.', '1', { group: P_SURFACE }),

  /* Texture maps */
  prop('AlbedoMap', 'Resource', 'Albedo / base colour map', 'Base colour texture.', '',
    { extraInformation: ['image'], group: P_MAPS }),
  prop('NormalMap', 'Resource', 'Normal map', 'Tangent-space normal texture.', '',
    { extraInformation: ['image'], group: P_MAPS }),
  prop('NormalScale', 'Number', 'Normal scale', 'Strength of the normal map.', '1', { group: P_MAPS }),
  prop('RoughnessMap', 'Resource', 'Roughness map', 'Per-pixel roughness.', '',
    { extraInformation: ['image'], group: P_MAPS }),
  prop('MetalnessMap', 'Resource', 'Metalness map', 'Per-pixel metalness.', '',
    { extraInformation: ['image'], group: P_MAPS }),
  prop('AOMap', 'Resource', 'Ambient occlusion map', 'Baked occlusion. Needs a second UV set.', '',
    { extraInformation: ['image'], group: P_MAPS }),
  prop('AOIntensity', 'Number', 'AO intensity', 'How strongly the AO map darkens.', '1', { group: P_MAPS }),
  prop('EmissiveMap', 'Resource', 'Emissive map', 'Glow texture.', '',
    { extraInformation: ['image'], group: P_MAPS }),

  /* Physical */
  prop('Transmission', 'Number', 'Transmission',
    'Glass-like transmission, 0 to 1. Above 0 forces the Physical material class.', '0', { group: P_PHYS }),
  prop('IOR', 'Number', 'Index of refraction', 'Glass is about 1.5. Range 1 to 2.333.', '1.5', { group: P_PHYS }),
  prop('Thickness', 'Number', 'Thickness', 'Volume behind the surface, for refraction.', '0.1', { group: P_PHYS }),
  prop('Clearcoat', 'Number', 'Clearcoat',
    'Clear lacquer layer, 0 to 1. Above 0 forces the Physical material class.', '0', { group: P_PHYS }),
  prop('ClearcoatRoughness', 'Number', 'Clearcoat roughness', 'Roughness of the lacquer layer.', '0', { group: P_PHYS }),

  /* UV transform */
  prop('TextureFiltering', 'Choice', 'Texture filtering',
    'Nearest for pixel art, Linear for smooth.', 'Keep Original',
    { extraInformation: FILTER_MODES, group: P_UV }),
  prop('TilingX', 'Number', 'Tiling X', 'Texture repeats across X.', '1', { group: P_UV }),
  prop('TilingY', 'Number', 'Tiling Y', 'Texture repeats across Y.', '1', { group: P_UV }),
  prop('OffsetX', 'Number', 'Offset X', 'Texture shift along X.', '0', { group: P_UV }),
  prop('OffsetY', 'Number', 'Offset Y', 'Texture shift along Y.', '0', { group: P_UV }),
  prop('RotationAngle', 'Number', 'Rotation (degrees)', 'Texture rotation.', '0', { group: P_UV }),
  prop('RotationCenterX', 'Number', 'Rotation centre X', 'Pivot for texture rotation.', '0.5', { group: P_UV }),
  prop('RotationCenterY', 'Number', 'Rotation centre Y', 'Pivot for texture rotation.', '0.5', { group: P_UV }),

  /* Scrolling */
  prop('EnableScroll', 'Boolean', 'Enable UV scrolling', 'Scroll the texture continuously.', 'false', { group: P_SCROLL }),
  prop('ScrollSpeedX', 'Number', 'Scroll speed X', 'UV units per second.', '0', { group: P_SCROLL }),
  prop('ScrollSpeedY', 'Number', 'Scroll speed Y', 'UV units per second.', '0', { group: P_SCROLL }),
  prop('ScrollRotationSpeed', 'Number', 'Scroll rotation speed', 'Degrees per second.', '0', { group: P_SCROLL }),

  /* Flipbook */
  prop('EnableFlipbook', 'Boolean', 'Enable flipbook', 'Animate a spritesheet across the surface.', 'false', { group: P_FLIP }),
  prop('FlipbookColumns', 'Number', 'Flipbook columns', 'Spritesheet grid width.', '1', { group: P_FLIP }),
  prop('FlipbookRows', 'Number', 'Flipbook rows', 'Spritesheet grid height.', '1', { group: P_FLIP }),
  prop('FlipbookFPS', 'Number', 'Flipbook FPS', 'Playback rate.', '12', { group: P_FLIP }),
  prop('FlipbookLoop', 'Boolean', 'Flipbook loops', 'Restart at the end.', 'true', { group: P_FLIP }),
  prop('FlipbookTotalFrames', 'Number', 'Flipbook frame count',
    'Frames to use. 0 means columns x rows.', '0', { group: P_FLIP }),

  /* Render state */
  prop('AlphaMode', 'Choice', 'Alpha mode',
    'How transparency is handled. "Preserve" leaves the model exactly as authored — the safe default.',
    'Preserve', { extraInformation: ALPHA_MODES, group: P_RENDER }),
  prop('Alpha', 'Number', 'Alpha', 'Opacity in Blend, Additive and Multiply modes.', '1', { group: P_RENDER }),
  prop('AlphaCutoff', 'Number', 'Alpha cutoff', 'Discard threshold in Cutout mode.', '0.1', { group: P_RENDER }),
  prop('DepthWrite', 'Boolean', 'Depth write', 'Write to the depth buffer.', 'true', { group: P_RENDER }),
  prop('MaterialSide', 'Choice', 'Rendered side',
    'Which faces are drawn. "Preserve" leaves the model as authored.', 'Preserve',
    { extraInformation: SIDE_MODES, group: P_RENDER }),
  prop('Wireframe', 'Boolean', 'Wireframe', 'Draw edges only.', 'false', { group: P_RENDER }),
  prop('Fog', 'Boolean', 'Affected by fog', 'Scene fog affects this surface.', 'true', { group: P_RENDER }),
  prop('CastShadow', 'Boolean', 'Casts shadows', 'The mesh casts shadows.', 'true', { group: P_RENDER }),
  prop('ReceiveShadow', 'Boolean', 'Receives shadows', 'The mesh receives shadows.', 'true', { group: P_RENDER }),
  prop('RenderOrder', 'Number', 'Render order', 'Higher draws later. Useful for sorting transparency.', '0', { group: P_RENDER }),
];

/* ================================================================= BRDF behavior
 *
 * A second, independent behavior in the same extension. It is NOT merged into Material3D
 * because it does a categorically different thing: it patches the existing material's shader
 * through onBeforeCompile to swap the diffuse lighting model, rather than setting material
 * fields. Merging them would give one behavior where half the properties are inert in either
 * mode. Shipping them together means one install, and lets Material3D call
 * gdjs.__brdfMaterial3D.reapplyIfPatched() after a material swap so the patch survives.
 *
 * This behavior keeps its own idiom — writing behavior._set<Name>() and re-reading through
 * readParams() — rather than Material3D's override map. It works, it is self-consistent, and
 * converting it would add risk for no gain.
 */

const BRDF_BEHAVIOR_NAME = 'BRDFMaterial';
const BRDF_BEHAVIOR_TYPE = `${EXTENSION_NAME}::${BRDF_BEHAVIOR_NAME}`;
const BRDF_NS = 'gdjs.__brdfMaterial3D';

const BRDF_MODELS = [
  'lambert', 'burley', 'oren-nayar', 'minnaert', 'toon', 'callisto',
  'half-lambert', 'wrap', 'lommel-seeliger', 'velvet', 'ashikhmin-shirley',
  'fresnel-diffuse', 'kajiya-kay',
];

const BRDF_OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: BRDF_BEHAVIOR_TYPE },
];

const bfn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, sentence, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: opts.private === true,
  parameters: [...BRDF_OB, ...parameters],
  events: [{
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (opts.withRuntime ? brdfRuntime + '\n' : '') + code,
    parameterObjects: 'Object',
  }],
});

/** Every BRDF setter has the same shape: clamp, write the property, resync the uniforms. */
const brdfSetter = (prop, fullName, sentence, description, clamp) => bfn(
  `Set${prop}`, fullName, sentence, description, 'Action',
  [num('Value', description)],
  `if (!${BRDF_NS}) return;\n` +
  `var objs = eventsFunctionContext.getObjects("Object");\n` +
  `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
  `var value = ${clamp};\n` +
  `for (var i = 0; i < objs.length; i++) {\n` +
  `  var b = objs[i].getBehavior(behaviorName);\n` +
  `  if (!b) continue;\n` +
  `  b._set${prop}(value);\n` +
  `  ${BRDF_NS}.updateUniforms(objs[i], ${BRDF_NS}.readParams(b));\n` +
  `}\n`,
  { group: 'BRDF' }
);

const C01 = 'Math.max(0, Math.min(1, Number(eventsFunctionContext.getArgument("Value"))))';
const C0256 = 'Math.max(0, Math.min(256, Number(eventsFunctionContext.getArgument("Value"))))';
const CN11 = 'Math.max(-1, Math.min(1, Number(eventsFunctionContext.getArgument("Value"))))';

const brdfFunctions = [
  bfn('onCreated', 'onCreated', '', '', 'Action', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `if (objs.length === 0) return;\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`,
    { withRuntime: true, private: true }),

  bfn('onDestroy', 'onDestroy', '', '', 'Action', [],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `for (var i = 0; i < objs.length; i++) ${BRDF_NS}.dispose(objs[i]);\n`,
    { private: true }),

  bfn('SetBRDFModel', 'Set BRDF model', 'Set _PARAM0_ BRDF model to _PARAM2_',
    'Switch the diffuse lighting model.', 'Action',
    [choiceParam('Model', 'BRDF model', BRDF_MODELS)],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var model = String(eventsFunctionContext.getArgument("Model")).toLowerCase();\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  b._setBRDFModel(model);\n` +
    `  ${BRDF_NS}.updateUniforms(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'BRDF' }),

  bfn('SetColor', 'Set BRDF base colour (RGB 0-1)', 'Set _PARAM0_ BRDF colour to _PARAM2_, _PARAM3_, _PARAM4_',
    'Base colour fed to the diffuse model, as three 0-1 channels.', 'Action',
    [num('R', 'Red (0-1)', '0.8'), num('G', 'Green (0-1)', '0.8'), num('B', 'Blue (0-1)', '0.8')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var cl = function(v) { return Math.max(0, Math.min(1, Number(v))); };\n` +
    `var r = cl(eventsFunctionContext.getArgument("R"));\n` +
    `var g = cl(eventsFunctionContext.getArgument("G"));\n` +
    `var b2 = cl(eventsFunctionContext.getArgument("B"));\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  b._setColorR(r); b._setColorG(g); b._setColorB(b2);\n` +
    `  ${BRDF_NS}.updateUniforms(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'BRDF' }),

  brdfSetter('Roughness', 'Set BRDF roughness', 'Set _PARAM0_ BRDF roughness to _PARAM2_',
    'Roughness fed to the diffuse model, 0 to 1.', C01),
  brdfSetter('DiffuseFresnel', 'Set diffuse Fresnel (Callisto)', 'Set _PARAM0_ diffuse Fresnel to _PARAM2_',
    'Callisto diffuse Fresnel, 0 to 256. 1 is neutral.', C0256),
  brdfSetter('DiffuseFresnelFalloff', 'Set diffuse Fresnel falloff (Callisto)', 'Set _PARAM0_ diffuse Fresnel falloff to _PARAM2_',
    'Callisto diffuse Fresnel falloff, 0 to 1.', C01),
  brdfSetter('DiffuseFresnelTangentFalloff', 'Set diffuse Fresnel tangent falloff (Callisto)', 'Set _PARAM0_ diffuse Fresnel tangent falloff to _PARAM2_',
    'Callisto diffuse Fresnel tangent falloff, 0 to 1.', C01),
  brdfSetter('RetroReflection', 'Set retroreflection (Callisto)', 'Set _PARAM0_ retroreflection to _PARAM2_',
    'Callisto retroreflection, 0 to 256. 1 is neutral.', C0256),
  brdfSetter('RetroReflectionFalloff', 'Set retroreflection falloff (Callisto)', 'Set _PARAM0_ retroreflection falloff to _PARAM2_',
    'Callisto retroreflection falloff, 0 to 1.', C01),
  brdfSetter('RetroReflectionTangentFalloff', 'Set retroreflection tangent falloff (Callisto)', 'Set _PARAM0_ retroreflection tangent falloff to _PARAM2_',
    'Callisto retroreflection tangent falloff, 0 to 1.', C01),
  brdfSetter('SmoothTerminator', 'Set smooth terminator (Callisto)', 'Set _PARAM0_ smooth terminator to _PARAM2_',
    'Callisto terminator softening, -1 to 1. Positive softens.', CN11),
  brdfSetter('SmoothTerminatorLength', 'Set smooth terminator length (Callisto)', 'Set _PARAM0_ smooth terminator length to _PARAM2_',
    'Callisto terminator softening width, 0 to 1.', C01),

  bfn('IsBRDFModel', 'BRDF model is', '_PARAM0_ BRDF model is _PARAM2_',
    'Check which diffuse model is active.', 'Condition',
    [choiceParam('Model', 'BRDF model', BRDF_MODELS)],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var mode = String(eventsFunctionContext.getArgument("Model")).toLowerCase();\n` +
    `var result = false;\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (b && String(b._getBRDFModel()).toLowerCase() === mode) { result = true; break; }\n` +
    `}\n` +
    `eventsFunctionContext.returnValue = result;\n`, { group: 'BRDF' }),

  bfn('IsPatchActive', 'BRDF patch is active', '_PARAM0_ BRDF patch is active',
    'Whether the shader patch is currently installed. If this is false the surface is rendering with the stock diffuse model.',
    'Condition', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var result = false;\n` +
    `if (${BRDF_NS} && objs.length) {\n` +
    `  var root = ${BRDF_NS}.getThreeObject(objs[0]);\n` +
    `  result = !!(root && root.userData && root.userData.__brdf);\n` +
    `}\n` +
    `eventsFunctionContext.returnValue = result;\n`, { group: 'BRDF' }),

  bfn('CurrentBRDFModel', 'Current BRDF model', '', 'The active diffuse model name.',
    'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var out = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(behaviorName); if (b) out = String(b._getBRDFModel()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'BRDF' }),

  bfn('CurrentRoughness', 'Current BRDF roughness', '', 'The roughness fed to the diffuse model.',
    'Expression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var out = 0;\n` +
    `if (objs.length) { var b = objs[0].getBehavior(behaviorName); if (b) out = Number(b._getRoughness()) || 0; }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'BRDF' }),
];

const brdfProp = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const G_BRDF_MODEL = 'Model';
const G_BRDF_CALLISTO = 'Callisto Parameters';

const brdfBehavior = {
  name: BRDF_BEHAVIOR_NAME,
  fullName: 'BRDF Material',
  description:
    'Applies a custom diffuse BRDF (Lambert, Burley, Oren-Nayar, Minnaert, Toon, Callisto and seven more) by patching ' +
    'the material shader through onBeforeCompile, preserving GDevelop lights, shadows and PBR specular. ' +
    'Composes on top of Material 3D rather than replacing it.',
  objectType: '',
  propertyDescriptors: [
    brdfProp('BRDFModel', 'Choice', 'BRDF model', 'Which diffuse lighting model to use.', 'lambert',
      { extraInformation: BRDF_MODELS, group: G_BRDF_MODEL }),
    brdfProp('ColorR', 'Number', 'Base colour R (0-1)', 'Red channel fed to the diffuse model.', '0.8', { group: G_BRDF_MODEL }),
    brdfProp('ColorG', 'Number', 'Base colour G (0-1)', 'Green channel fed to the diffuse model.', '0.8', { group: G_BRDF_MODEL }),
    brdfProp('ColorB', 'Number', 'Base colour B (0-1)', 'Blue channel fed to the diffuse model.', '0.8', { group: G_BRDF_MODEL }),
    brdfProp('Roughness', 'Number', 'Roughness (0-1)', 'Roughness fed to the diffuse model.', '0.5', { group: G_BRDF_MODEL }),
    brdfProp('DiffuseFresnel', 'Number', 'Diffuse Fresnel', 'Callisto only. 0-256; 1 is neutral (Lambert).', '1', { group: G_BRDF_CALLISTO }),
    brdfProp('DiffuseFresnelFalloff', 'Number', 'Diffuse Fresnel falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('DiffuseFresnelTangentFalloff', 'Number', 'Diffuse Fresnel tangent falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflection', 'Number', 'Retroreflection', 'Callisto only. 0-256; 1 is neutral.', '1', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflectionFalloff', 'Number', 'Retroreflection falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflectionTangentFalloff', 'Number', 'Retroreflection tangent falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('SmoothTerminator', 'Number', 'Smooth terminator', 'Callisto only, -1 to 1. Positive softens the terminator.', '0', { group: G_BRDF_CALLISTO }),
    brdfProp('SmoothTerminatorLength', 'Number', 'Smooth terminator length', 'Callisto only, 0-1.', '0.5', { group: G_BRDF_CALLISTO }),
  ],
  eventsFunctions: brdfFunctions,
};

const behavior = {
  name: BEHAVIOR_NAME,
  fullName: 'Material 3D',
  description:
    'Unified 3D material behavior: PBR texture maps, UV scrolling, flipbook and video surfaces, glass and clearcoat, ' +
    'full runtime control over every property, and diagnostics that report whether the material actually applied.',
  objectType: '',
  propertyDescriptors: properties,
  eventsFunctions: behaviorFunctions,
};

/* ================================================================= Extension manifest */

const extension = {
  author: 'Christopher Monhollen (Twillion)',
  category: '3D',
  extensionNamespace: '',
  fullName: 'Material 3D',
  name: EXTENSION_NAME,
  version: '3.0.0',
  shortDescription:
    'Unified 3D material behavior — PBR maps, UV scrolling, flipbook and video, glass and clearcoat, full runtime control, and diagnostics that tell you whether it applied.',
  description: `**Material3D** is the single material behavior for GDevelop 3D objects. It replaces three earlier extensions: **Animated & Custom PBR Material 3D**, **Advanced Materials** and **Advanced 3D Material**.

### What it does
- **PBR texture maps** — albedo, normal, roughness, metalness, ambient occlusion and emissive, assigned from project resources.
- **Animated surfaces** — UV scrolling, spritesheet flipbooks and video playback on any 3D surface.
- **Glass and clearcoat** — transmission, index of refraction, thickness and clearcoat, on an opt-in \`MeshPhysicalMaterial\` path.
- **Three material classes** — Basic (unlit), Standard (PBR) and Physical, chosen explicitly or automatically.
- **Everything settable at runtime** — all 57 properties have setter actions, including which mesh or material slot is targeted.
- **Diagnostics** — conditions and expressions reporting whether the material applied, to how many meshes, and why it failed. 3D material work otherwise fails silently.

### Not included: BRDF Materials
**BRDF Materials** is deliberately a separate extension. It rewrites the lighting model through a shader patch rather than setting material fields, so the two compose: apply Material3D first, then BRDF Materials on top.

### Defaults changed from the extensions this replaces
**Alpha Mode** and **Rendered Side** now default to **Preserve**. Previously attaching the behavior silently flattened transparency on models that shipped with it.`,
  helpPath: '',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  tags: [
    '3D', 'material', 'PBR', 'shader', 'Three.js', 'roughness', 'metalness',
    'emissive', 'transmission', 'clearcoat', 'glass', 'texture', 'UV', 'scroll',
    'flipbook', 'video', 'normal map',
  ],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [
    {
      name: 'onFirstSceneLoaded',
      fullName: 'onFirstSceneLoaded',
      description: '',
      sentence: '',
      functionType: 'Action',
      private: true,
      events: [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode: runtime }],
      parameters: [],
    },
  ],
  eventsFunctionsFolderStructure: { folderName: '__ROOT', children: [] },
  eventsBasedBehaviors: [behavior, brdfBehavior],
  eventsBasedObjects: [],
};

/* ================================================================= Validation & export */

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
  console.error(`\nControl character U+${code} in ${where} at line ${line}, column ${col}.\n`);
  process.exit(1);
};

checkControlChars(rawRuntime, 'Material3D.runtime.js');
checkControlChars(rawBrdfRuntime, 'BRDFMaterial.runtime.js');

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
walkEvents(brdfBehavior.eventsFunctions, brdfBehavior.name);
walkEvents(extension.eventsFunctions, 'extension.eventsFunctions');

/* A condition that uses a bare `return` silently evaluates to false — the value is discarded. */
for (const f of [...behavior.eventsFunctions, ...brdfBehavior.eventsFunctions]) {
  if (f.functionType !== 'Condition') continue;
  const code = f.events[0].inlineCode;
  if (!code.includes('eventsFunctionContext.returnValue')) {
    console.error(`\nCondition ${f.name} never assigns eventsFunctionContext.returnValue.\n`);
    process.exit(1);
  }
}

/* Every property named by a Set<Name> action must actually exist, or the override writes into
 * a field nothing reads and the action appears to do nothing. */
const propNames = new Set(properties.map((p) => p.name));
for (const f of behavior.eventsFunctions) {
  const m = /^Set([A-Z]\w*)$/.exec(f.name);
  if (!m) continue;
  const code = f.events[0].inlineCode;
  for (const om of code.matchAll(/setOverride\(behavior,\s*"([^"]+)"/g)) {
    if (!propNames.has(om[1])) {
      console.error(`\n${f.name} overrides "${om[1]}", which is not a declared property.\n`);
      process.exit(1);
    }
  }
}

const json = JSON.stringify(extension, null, 2);

const BAD_KEYS = [
  ['"properties"', 'behaviors serialize "propertyDescriptors", not "properties"'],
  ['"extraInfo"', 'properties use "extraInformation"; parameters use "supplementaryInformation"'],
  ['"type": "resource"', '"resource" is not a registered parameter type; use imageResource'],
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

// Each behavior's `behavior` parameters must bind to THAT behavior's type. Cross-binding them
// generates getBehavior() against the wrong name and every ACE on the mis-bound behavior throws.
for (const [bh, expectedType] of [[behavior, BEHAVIOR_TYPE], [brdfBehavior, BRDF_BEHAVIOR_TYPE]]) {
  for (const f of bh.eventsFunctions) {
    for (const p of f.parameters) {
      if (!VALID_PARAM_TYPES.has(p.type)) {
        console.error(`\nUnknown parameter type "${p.type}" on ${bh.name}.${f.name}.${p.name}\n`);
        process.exit(1);
      }
      if (p.type === 'behavior' && p.supplementaryInformation !== expectedType) {
        console.error(
          `\nBehavior parameter ${bh.name}.${f.name}.${p.name} must carry supplementaryInformation ` +
          `"${expectedType}" (found ${JSON.stringify(p.supplementaryInformation)}).\n`
        );
        process.exit(1);
      }
    }
    if (f.parameters[0]?.type !== 'object' || f.parameters[1]?.type !== 'behavior') {
      console.error(`\nBehavior function ${bh.name}.${f.name} must start with (object, behavior) parameters.\n`);
      process.exit(1);
    }
  }
}

if (extension.name !== EXTENSION_NAME || behavior.name !== BEHAVIOR_NAME) {
  console.error(`\nBEHAVIOR_TYPE "${BEHAVIOR_TYPE}" does not match ${extension.name}::${behavior.name}.\n`);
  process.exit(1);
}

for (const bh of [behavior, brdfBehavior]) {
  const dupes = bh.eventsFunctions.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) {
    console.error(`\nDuplicate function names in ${bh.name}: ${[...new Set(dupes)].join(', ')}\n`);
    process.exit(1);
  }
}

/* Both behaviors declare a Roughness property and a SetRoughness action. That is fine — they are
 * scoped per behavior — but the two are NOT the same value: Material3D's drives
 * material.roughness, BRDF's is fed to the diffuse model. Assert the collision stays intentional
 * so it is never "fixed" by renaming one of them into the other's meaning. */
const sharedProps = brdfBehavior.propertyDescriptors
  .map((p) => p.name)
  .filter((n) => propNames.has(n));
if (sharedProps.join(',') !== 'Roughness') {
  console.error(
    `\nBehaviors now share these property names: ${sharedProps.join(', ') || '(none)'}.\n` +
    `Only "Roughness" is a known, intentional overlap. Confirm the new one before shipping.\n`
  );
  process.exit(1);
}

const out = path.join(here, 'Material3D.json');
fs.writeFileSync(out, json, 'utf8');

const brdfCounts = brdfBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const counts = behavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\n========================================`);
console.log(` Successfully built ${path.basename(out)}`);
console.log(` Output size:        ${(json.length / 1024).toFixed(1)} KB`);
console.log(` Validated:          ${blocks} JavaScript blocks parsed clean`);
console.log(` Material3D:         ${properties.length} props, ${JSON.stringify(counts)}`);
console.log(` BRDFMaterial:       ${brdfBehavior.propertyDescriptors.length} props, ${JSON.stringify(brdfCounts)}`);
console.log(`========================================\n`);
