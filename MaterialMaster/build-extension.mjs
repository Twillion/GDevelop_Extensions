/**
 * build-extension.mjs
 * Builds MaterialMaster.json from MaterialMaster.runtime.js + the declarations below.
 *
 * Run: node MaterialMaster/build-extension.mjs
 *
 * MaterialMaster is the consolidation of three earlier extensions:
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

const rawRuntime = fs.readFileSync(path.join(here, 'MaterialMaster.runtime.js'), 'utf8');
const rawBrdfRuntime = fs.readFileSync(path.join(here, 'BRDFMaterial.runtime.js'), 'utf8');
const rawChainRuntime = fs.readFileSync(path.join(here, 'ShaderChain.runtime.js'), 'utf8');
const rawControllerRuntime = fs.readFileSync(path.join(here, 'MaterialController3D.runtime.js'), 'utf8');
const rawPhysicalRuntime = fs.readFileSync(path.join(here, 'PhysicalMaterial3D.runtime.js'), 'utf8');
const rawWetRuntime = fs.readFileSync(path.join(here, 'WetMaterial3D.runtime.js'), 'utf8');
const rawAnimatedRuntime = fs.readFileSync(path.join(here, 'AnimatedMaterial3D.runtime.js'), 'utf8');
const rawPatternRuntime = fs.readFileSync(path.join(here, 'PatternMaterial3D.runtime.js'), 'utf8');
const rawPatternMathRuntime = fs.readFileSync(path.join(here, 'PatternMath3D.runtime.js'), 'utf8');
const rawGeometryControllerRuntime = fs.readFileSync(path.join(here, 'GeometryController3D.runtime.js'), 'utf8');
const rawMeshBlendRuntime = fs.readFileSync(path.join(here, 'MeshBlend3D.runtime.js'), 'utf8');
const rawDisplacedRuntime = fs.readFileSync(path.join(here, 'DisplacedMesh3D.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const runtime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawRuntime;
const brdfRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawBrdfRuntime;
const physicalRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawPhysicalRuntime;
const wetRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawWetRuntime;
const animatedRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawAnimatedRuntime;
const patternRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawPatternMathRuntime + '\n' + rawPatternRuntime;
const displacedRuntime = rawChainRuntime + '\n' + rawControllerRuntime + '\n' + rawGeometryControllerRuntime + '\n' + rawMeshBlendRuntime + '\n' + rawPatternMathRuntime + '\n' + rawDisplacedRuntime;
const NS = 'gdjs.__material3D';

const EXTENSION_NAME = 'MaterialMaster';
const BEHAVIOR_NAME = 'MaterialCore3D';

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
const ANISOTROPY_MODES = ['16x', 'Max', '8x', '4x', '2x', '1 (Off)', 'Keep Original'];
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
const MATERIAL_PRESETS = [
  'Custom',
  'Default (Standard PBR)',
  'Matte Plastic',
  'Glossy Plastic',
  'Metal / Chrome',
  'Brushed Metal',
  'Gold',
  'Glass / Window',
  'Mirror',
  'Rubber',
  'Emissive Glow',
];
const PATTERN_PRESETS = [
  'Custom',
  'Red Brick',
  'Subway Tiles',
  'Herringbone Wood',
  'Hexagon Mosaic',
  'Checkerboard',
  'Cobblestone',
  'Noise Weathering',
  'Vertical Stripes',
];
const PHYSICAL_PRESETS = [
  'Custom',
  'Clear Glass',
  'Frosted Glass',
  'Tinted Glass',
  'Car Lacquer',
  'Velvet Fabric',
  'Satin / Silk',
  'Soap Bubble',
  'Brushed Metal',
];

/* ================================================================= Function groups */

const G_LIFECYCLE = '';
const G_CONTROL = 'Apply & Control';
const G_PRESETS = 'Presets & Material Class';
const G_TARGET = 'Targeting';
const G_SURFACE = 'Surface & Colour';
const G_PHYSICAL = 'Glass & Clearcoat';
const G_TEX = 'Textures';
const G_UV = 'UV Animation';
const G_FLIP = 'Flipbook & Video';
const G_RENDER = 'Render State';
const G_DIAG = 'Diagnostics';
const G_SHEEN = 'Sheen, Iridescence & Anisotropy';
const G_WET = 'Wetness';

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
    `if (root) {\n` +
    `  M3.restoreOriginalMaterials(state, M3.collectMeshRecords(root, true), root);\n` +
    `  if (gdjs.__materialController3D) gdjs.__materialController3D.clear(root);\n` +
    `}\n`,
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
    `if (root) M3.restoreOriginalMaterials(state, M3.collectMeshRecords(root, true), root);\n`,
    { group: G_CONTROL }),

  /* ---------------------------------------------------------------- Presets & Class */
  setter('Preset', 'Set material preset', 'Set _PARAM0_ material preset to _PARAM2_',
    'Apply a material preset profile. Rebuilds the material.', 'choice', G_PRESETS,
    { choices: MATERIAL_PRESETS, heavy: true }),
  cond('IsPreset', 'Material preset is', '_PARAM0_ material preset is _PARAM2_',
    'Check active material preset.', [choiceParam('Preset', 'Preset', MATERIAL_PRESETS)],
    `eventsFunctionContext.returnValue = (M3.getPreset(behavior) === eventsFunctionContext.getArgument("Preset"));\n`,
    G_PRESETS),
  strExpr('Preset', 'Material preset name', 'Active material preset name.',
    `M3.getPreset(behavior)`, G_PRESETS),
  setter('ShaderType', 'Set shader type', 'Set _PARAM0_ shader type to _PARAM2_',
    'Material class to build. Changing this rebuilds the material.', 'choice', G_PRESETS,
    { choices: SHADER_TYPES, heavy: true }),

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

  /* ---------------------------------------------------------------- Surface & colour */
  setter('BaseColor', 'Set base colour', 'Set _PARAM0_ base colour to _PARAM2_',
    'Base (albedo) colour. Requires "Use Base Color" to be on.', 'color', G_SURFACE),
  setter('UseBaseColor', 'Enable base colour override', 'Set _PARAM0_ base colour override to _PARAM2_',
    'Whether the base colour property overrides the model\'s own colour.', 'bool', G_SURFACE),
  setter('UseRoughness', 'Enable roughness override', 'Set _PARAM0_ roughness override to _PARAM2_',
    'Whether the roughness property overrides the model\'s baked roughness.', 'bool', G_SURFACE),
  setter('Roughness', 'Set roughness', 'Set _PARAM0_ roughness to _PARAM2_',
    'Surface roughness, 0 (mirror) to 1 (fully diffuse).', 'number', G_SURFACE),
  setter('UseMetalness', 'Enable metalness override', 'Set _PARAM0_ metalness override to _PARAM2_',
    'Whether the metalness property overrides the model\'s baked metalness.', 'bool', G_SURFACE),
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
  setter('AnisotropicFiltering', 'Set anisotropic filtering', 'Set _PARAM0_ anisotropic filtering to _PARAM2_',
    'Control texture sharpness at oblique angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).',
    'choice', G_RENDER, { choices: ANISOTROPY_MODES }),
  fn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_',
    'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Anisotropy', 'Max anisotropy level (1 to 16)', '16')],
    `M3.setOverride(behavior, "AnisotropicFiltering", String(eventsFunctionContext.getArgument("Anisotropy")));\n`,
    { group: G_RENDER }),

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
  numExpr('TextureAnisotropy', 'Texture anisotropy', 'Current resolved texture anisotropy level (1 to 16).',
    `M3.getTextureAnisotropy(behavior)`, G_RENDER),
  strExpr('AnisotropicFiltering', 'Anisotropic filtering mode', 'Current configured anisotropic filtering mode.',
    `M3.getAnisotropicFiltering(behavior)`, G_RENDER),
  cond('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled',
    'Whether anisotropic filtering is active (anisotropy > 1).', [],
    `M3.getTextureAnisotropy(behavior) > 1`, G_RENDER),

  /* ---------------------------------------------------------------- Sheen / iridescence / anisotropy */
  setter('Sheen', 'Set sheen', 'Set _PARAM0_ sheen to _PARAM2_',
    'Velvet and satin back-scatter, 0 to 1. Needs the Physical material class.', 'number', G_SHEEN),
  setter('SheenColor', 'Set sheen colour', 'Set _PARAM0_ sheen colour to _PARAM2_',
    'Colour of the sheen highlight.', 'color', G_SHEEN),
  setter('SheenRoughness', 'Set sheen roughness', 'Set _PARAM0_ sheen roughness to _PARAM2_',
    'How tight the sheen highlight is, 0 to 1.', 'number', G_SHEEN),
  setter('Iridescence', 'Set iridescence', 'Set _PARAM0_ iridescence to _PARAM2_',
    'Thin-film interference, 0 to 1. Needs the Physical material class.', 'number', G_SHEEN),
  setter('IridescenceIOR', 'Set iridescence IOR', 'Set _PARAM0_ iridescence IOR to _PARAM2_',
    'Refractive index of the thin film, 1 to 2.5.', 'number', G_SHEEN),
  setter('Anisotropy', 'Set anisotropy', 'Set _PARAM0_ anisotropy to _PARAM2_',
    'Directional stretched specular, 0 to 1. Needs the Physical material class.', 'number', G_SHEEN),
  setter('AnisotropyRotation', 'Set anisotropy rotation', 'Set _PARAM0_ anisotropy rotation to _PARAM2_',
    'Direction of the stretch, in degrees.', 'number', G_SHEEN),

  /* ---------------------------------------------------------------- Wetness */
  setter('Wetness', 'Set wetness', 'Set _PARAM0_ wetness to _PARAM2_',
    'How wet the surface is, 0 to 1.', 'number', G_WET),
  setter('Porosity', 'Set porosity', 'Set _PARAM0_ porosity to _PARAM2_',
    'How much the surface darkens when wet. Metal is 0.', 'number', G_WET),

  cond('IsWet', 'Surface is wet', '_PARAM0_ surface is wet',
    'Wetness is above zero.', [], `M3.getWetness(behavior) > 0`, G_WET),
  numExpr('WetnessLevel', 'Wetness', 'Current wetness, 0 to 1.', `M3.getWetness(behavior)`, G_WET),

  /* ---------------------------------------------------------------- Shader chain diagnostics
   *
   * onBeforeCompile is shared between this behavior, BRDF Material, and every planned v3.5 module.
   * These report what actually reached the compiler, which is otherwise unknowable: a failed
   * injection renders a plausible surface and logs nothing. */
  cond('HasShaderInjector', 'Shader injector is active', '_PARAM0_ has shader injector _PARAM2_ active',
    'Whether the named injector ran at the last shader compile. Empty until the object first renders.',
    [str('InjectorId', 'Injector id, for example "brdf"')],
    `M3.hasShaderInjector(behavior, eventsFunctionContext.getArgument("InjectorId"))`, G_DIAG),
  strExpr('ShaderInjectors', 'Active shader injectors',
    'Comma-separated ids of the injectors that ran at the last compile.',
    `M3.getShaderInjectors(behavior).join(",")`, G_DIAG),
];

/* ================================================================= Behavior properties */

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const P_PRESETS = 'Presets & Material Class';
const P_SURFACE = 'Surface & Colour';
const P_MAPS = 'Texture Maps';
const P_PHYS = 'Glass & Clearcoat';
const P_UV = 'UV Transform';
const P_SCROLL = 'UV Scrolling';
const P_FLIP = 'Flipbook';
const P_RENDER = 'Render State';
const P_SHEEN = 'Sheen, Iridescence & Anisotropy';
const P_WET = 'Wetness';
const P_APPLY = 'Apply & Targeting';

const properties = [
  /* Presets & Material Class (TOP OF THE PANEL) */
  prop('Preset', 'Choice', 'Material preset',
    'Choose a 1-click material preset profile. Leave on "Custom" to author properties manually.',
    'Custom', { extraInformation: MATERIAL_PRESETS, group: P_PRESETS }),
  prop('ShaderType', 'Choice', 'Material class',
    'Which Three.js material to build. "Auto" uses Physical only when transmission or clearcoat is in use, and Standard otherwise.',
    'Auto', { extraInformation: SHADER_TYPES, group: P_PRESETS }),

  /* Surface & colour */
  prop('UseBaseColor', 'Boolean', 'Override base colour',
    'Apply the base colour below instead of keeping the model\'s own.', 'false', { group: P_SURFACE }),
  prop('BaseColor', 'Color', 'Base colour', 'Albedo tint.', '255;255;255', { group: P_SURFACE }),
  prop('UseRoughness', 'Boolean', 'Override roughness',
    'Apply the roughness below instead of keeping the model\'s baked roughness.', 'false', { group: P_SURFACE }),
  prop('Roughness', 'Number', 'Roughness', '0 is mirror-smooth, 1 is fully diffuse.', '0.5', { group: P_SURFACE }),
  prop('UseMetalness', 'Boolean', 'Override metalness',
    'Apply the metalness below instead of keeping the model\'s baked metalness.', 'false', { group: P_SURFACE }),
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
  prop('AnisotropicFiltering', 'Choice', 'Anisotropic filtering',
    'Improves texture clarity at oblique viewing angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).', '16x',
    { extraInformation: ANISOTROPY_MODES, group: P_UV }),
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

  /* Sheen, iridescence and anisotropy are native MeshPhysicalMaterial fields in Three.js r160 —
   * plain assignments, like transmission and clearcoat, with no shader injection. They only exist
   * on the Physical class, so set Material class to Physical (or raise transmission/clearcoat and
   * let Auto pick it) or these do nothing. */
  prop('Sheen', 'Number', 'Sheen',
    'Micro-fibre back-scatter for velvet, satin and brushed fabric, 0 to 1.', '0', { group: P_SHEEN }),
  prop('SheenColor', 'Color', 'Sheen colour', 'Colour of the sheen highlight.', '255;255;255', { group: P_SHEEN }),
  prop('SheenRoughness', 'Number', 'Sheen roughness', 'How tight the sheen highlight is, 0 to 1.', '1', { group: P_SHEEN }),
  prop('Iridescence', 'Number', 'Iridescence',
    'Thin-film interference for soap bubbles, oil slicks and beetle shells, 0 to 1.', '0', { group: P_SHEEN }),
  prop('IridescenceIOR', 'Number', 'Iridescence IOR', 'Refractive index of the thin film, 1 to 2.5.', '1.3', { group: P_SHEEN }),
  prop('IridescenceThicknessMin', 'Number', 'Iridescence thickness min (nm)',
    'Thin-film thickness at the low end, in nanometres.', '100', { group: P_SHEEN }),
  prop('IridescenceThicknessMax', 'Number', 'Iridescence thickness max (nm)',
    'Thin-film thickness at the high end, in nanometres.', '400', { group: P_SHEEN }),
  prop('Anisotropy', 'Number', 'Anisotropy',
    'Directional stretched specular for brushed metal, vinyl and hair, 0 to 1.', '0', { group: P_SHEEN }),
  prop('AnisotropyRotation', 'Number', 'Anisotropy rotation (degrees)',
    'Direction of the stretch.', '0', { group: P_SHEEN }),

  /* Wetness is computed on the CPU — two field assignments, no shader and no recompile. Animated
   * rain ripples are a separate module and do need one. */
  prop('Wetness', 'Number', 'Wetness',
    'How wet the surface is, 0 to 1. Darkens porous albedo and drives roughness toward mirror.', '0', { group: P_WET }),
  prop('Porosity', 'Number', 'Porosity',
    'How much the surface darkens when wet, 0 to 1. Stone and fabric are high; metal is 0.', '0.5', { group: P_WET }),

  /* Apply & targeting (BOTTOM OF THE PANEL) */
  prop('TargetMode', 'Choice', 'Target mode',
    'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: P_APPLY }),
  prop('MaterialIndex', 'Number', 'Material index',
    'Slot to target when Target Mode is "Material index".', '0', { group: P_APPLY }),
  prop('MaterialName', 'String', 'Material name',
    'Name to match when Target Mode is "Material name".', '', { group: P_APPLY }),
  prop('MeshName', 'String', 'Mesh name',
    'Name to match when Target Mode is "Mesh name".', '', { group: P_APPLY }),
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
];

const EXTRACTED_PROPERTY_NAMES = new Set([
  'Transmission','IOR','Thickness','Clearcoat','ClearcoatRoughness','Sheen','SheenColor','SheenRoughness',
  'Iridescence','IridescenceIOR','IridescenceThicknessMin','IridescenceThicknessMax','Anisotropy','AnisotropyRotation',
  'TilingX','TilingY','OffsetX','OffsetY','RotationAngle','RotationCenterX','RotationCenterY','EnableScroll',
  'ScrollSpeedX','ScrollSpeedY','ScrollRotationSpeed','EnableFlipbook','FlipbookColumns','FlipbookRows',
  'FlipbookFPS','FlipbookLoop','FlipbookTotalFrames','Wetness','Porosity'
]);
const coreProperties = properties.filter((p) => !EXTRACTED_PROPERTY_NAMES.has(p.name));
const EXTRACTED_FUNCTION_NAMES = new Set([
  ...Array.from(EXTRACTED_PROPERTY_NAMES, (name) => `Set${name}`),
  'SetTiling','SetUVOffset','SetUVRotation','SetScrollSpeed','EnableScrolling','SetFlipbookConfig',
  'SetFlipbookFrame','PlayFlipbook','PauseFlipbook','SetVideoTexture','PlayVideo','PauseVideo',
  'IsFlipbookPlaying','IsFlipbookFinished','IsScrollingEnabled','CurrentFrame','TotalFrames',
  'ScrollOffsetX','ScrollOffsetY','ScrollRotation','IsWet','WetnessLevel'
]);
const coreFunctions = behaviorFunctions.filter((f) => !EXTRACTED_FUNCTION_NAMES.has(f.name));

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

  brdfSetter('Roughness', 'Set BRDF roughness', 'Set _PARAM0_ BRDF roughness to _PARAM2_',
    'Roughness fed to the diffuse model, 0 to 1. Ignored while Follow material roughness is on.', C01),

  bfn('SetFollowMaterialRoughness', 'Set follow material roughness',
    'Set _PARAM0_ follow material roughness to _PARAM2_',
    'When on, the diffuse model uses the Material 3D roughness so the two agree.', 'Action',
    [bool('Value', 'Follow material roughness')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var v = eventsFunctionContext.getArgument("Value");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  b._setFollowMaterialRoughness(v);\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'BRDF' }),
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
    `if (${BRDF_NS} && objs.length) result = ${BRDF_NS}.isPatchActive(objs[0]);\n` +
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

  bfn('SetAnisotropicFiltering', 'Set anisotropic filtering', 'Set _PARAM0_ anisotropic filtering to _PARAM2_',
    'Control texture sharpness at oblique angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).', 'Action',
    [choiceParam('Value', 'Anisotropic filtering', ANISOTROPY_MODES)],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var v = eventsFunctionContext.getArgument("Value");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setAnisotropicFiltering) b._setAnisotropicFiltering(v);\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'BRDF' }),

  bfn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_',
    'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Value', 'Anisotropy level (1 to 16)', '16')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var v = String(eventsFunctionContext.getArgument("Value"));\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setAnisotropicFiltering) b._setAnisotropicFiltering(v);\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'BRDF' }),

  bfn('AnisotropicFiltering', 'Anisotropic filtering mode', '', 'The active anisotropic filtering mode.',
    'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `var out = "16x";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(behaviorName); if (b && b._getAnisotropicFiltering) out = String(b._getAnisotropicFiltering()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'BRDF' }),

  bfn('TextureAnisotropy', 'Texture anisotropy', '', 'Current resolved texture anisotropy level (1 to 16).',
    'Expression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = 1;\n` +
    `if (objs.length && gdjs.__materialController3D) { var root = objs[0].get3DRendererObject ? objs[0].get3DRendererObject() : null; if (root) out = gdjs.__materialController3D.getObjectAnisotropy(root); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'BRDF' }),

  bfn('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled',
    'Whether anisotropic filtering is active (anisotropy > 1).', 'Condition', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = false;\n` +
    `if (objs.length && gdjs.__materialController3D) { var root = objs[0].get3DRendererObject ? objs[0].get3DRendererObject() : null; if (root) out = gdjs.__materialController3D.getObjectAnisotropy(root) > 1; }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'BRDF' }),
  bfn('SetTargetMode', 'Set target mode', 'Set _PARAM0_ target mode to _PARAM2_', 'Which materials to drive.', 'Action',
    [choiceParam('Value', 'Target mode', TARGET_MODES)],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setTargetMode) b._setTargetMode(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'Targeting' }),
  bfn('SetMaterialIndex', 'Set material index', 'Set _PARAM0_ material index to _PARAM2_', 'Slot to target when Target Mode is "Material index".', 'Action',
    [num('Value', 'Material index')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMaterialIndex) b._setMaterialIndex(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'Targeting' }),
  bfn('SetMaterialName', 'Set material name', 'Set _PARAM0_ material name to _PARAM2_', 'Name to match when Target Mode is "Material name".', 'Action',
    [str('Value', 'Material name')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMaterialName) b._setMaterialName(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'Targeting' }),
  bfn('SetMeshName', 'Set mesh name', 'Set _PARAM0_ mesh name to _PARAM2_', 'Name to match when Target Mode is "Mesh name".', 'Action',
    [str('Value', 'Mesh name')],
    `if (!${BRDF_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMeshName) b._setMeshName(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${BRDF_NS}.apply(objs[i], ${BRDF_NS}.readParams(b));\n` +
    `}\n`, { group: 'Targeting' }),
  bfn('TargetMode', 'Target mode', '', 'Active targeting mode.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = "All materials";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getTargetMode) out = String(b._getTargetMode()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  bfn('MaterialIndex', 'Target material index', '', 'Target slot index.', 'Expression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = 0;\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMaterialIndex) out = Number(b._getMaterialIndex()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  bfn('MaterialName', 'Target material name', '', 'Target material name.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMaterialName) out = String(b._getMaterialName()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  bfn('MeshName', 'Target mesh name', '', 'Target mesh name.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var out = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMeshName) out = String(b._getMeshName()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
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
    brdfProp('BRDFModel', 'Choice', 'BRDF model',
      'Which diffuse lighting model replaces GDevelop\'s built-in Lambert. '
      + 'lambert: the stock look. burley: softer, film-like skin and plastic. '
      + 'oren-nayar: rough matte — clay, concrete, unfinished wood. '
      + 'minnaert: dusty, backlit — moons, powder, old fabric. '
      + 'toon: hard bands for cel-shaded and anime looks. '
      + 'callisto: the fully tunable one — skin and cloth, driven by the Callisto parameters below. '
      + 'half-lambert / wrap: soft wraparound light that never goes fully black, good for stylised characters. '
      + 'lommel-seeliger: dark porous surfaces — asteroids, ash, charcoal. '
      + 'velvet: fabric that catches light at grazing angles. '
      + 'ashikhmin-shirley / fresnel-diffuse: physically-flavoured falloff at edges. '
      + 'kajiya-kay: strand shading for hair and fur.',
      'lambert',
      { extraInformation: BRDF_MODELS, group: G_BRDF_MODEL }),
    // ColorR/G/B were removed in 3.2.0. They were read from the behavior and never reached the
    // shader — brdfCustom receives `material.diffuseColor`, and no colour uniform ever existed.
    // Surface colour comes from Material 3D's Base colour, which is what it always actually did.
    brdfProp('FollowMaterialRoughness', 'Boolean', 'Follow material roughness',
      'Use the Material 3D roughness for the diffuse model instead of the value below. On by default, '
      + 'so the diffuse and the specular highlight agree — and so Wetness affects both.',
      'true', { group: G_BRDF_MODEL }),
    brdfProp('Roughness', 'Number', 'Roughness (0-1)',
      'Roughness fed to the diffuse model. Ignored while "Follow material roughness" is on.',
      '0.5', { group: G_BRDF_MODEL }),
    brdfProp('DiffuseFresnel', 'Number', 'Diffuse Fresnel', 'Callisto only. 0-256; 1 is neutral (Lambert).', '1', { group: G_BRDF_CALLISTO }),
    brdfProp('DiffuseFresnelFalloff', 'Number', 'Diffuse Fresnel falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('DiffuseFresnelTangentFalloff', 'Number', 'Diffuse Fresnel tangent falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflection', 'Number', 'Retroreflection', 'Callisto only. 0-256; 1 is neutral.', '1', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflectionFalloff', 'Number', 'Retroreflection falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('RetroReflectionTangentFalloff', 'Number', 'Retroreflection tangent falloff', 'Callisto only, 0-1.', '0.75', { group: G_BRDF_CALLISTO }),
    brdfProp('SmoothTerminator', 'Number', 'Smooth terminator', 'Callisto only, -1 to 1. Positive softens the terminator.', '0', { group: G_BRDF_CALLISTO }),
    brdfProp('SmoothTerminatorLength', 'Number', 'Smooth terminator length', 'Callisto only, 0-1.', '0.5', { group: G_BRDF_CALLISTO }),
    brdfProp('TargetMode', 'Choice', 'Target mode', 'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: 'Targeting' }),
    brdfProp('MaterialIndex', 'Number', 'Material index', 'Slot to target when Target Mode is "Material index".', '0', { group: 'Targeting' }),
    brdfProp('MaterialName', 'String', 'Material name', 'Name to match when Target Mode is "Material name".', '', { group: 'Targeting' }),
    brdfProp('MeshName', 'String', 'Mesh name', 'Name to match when Target Mode is "Mesh name".', '', { group: 'Targeting' }),
    brdfProp('AnisotropicFiltering', 'Choice', 'Anisotropic filtering',
      'Texture sharpness at oblique viewing angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).',
      '16x',
      { extraInformation: ANISOTROPY_MODES, group: 'Targeting' }),
  ],
  eventsFunctions: brdfFunctions,
};

/* ================================================================= Physical Material behavior */

const PHYSICAL_BEHAVIOR_NAME = 'PhysicalMaterial3D';
const PHYSICAL_BEHAVIOR_TYPE = `${EXTENSION_NAME}::${PHYSICAL_BEHAVIOR_NAME}`;
const PHYSICAL_NS = 'gdjs.__physicalMaterial3D';
const PHYSICAL_OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: PHYSICAL_BEHAVIOR_TYPE },
];
const pfn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, sentence, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: opts.private === true,
  parameters: [...PHYSICAL_OB, ...parameters],
  events: [{
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (opts.withRuntime ? physicalRuntime + '\n' : '') + code,
    parameterObjects: 'Object',
  }],
});
const physicalSetter = (prop, fullName, description, type = 'number') => pfn(
  `Set${prop}`, fullName, `Set _PARAM0_ ${fullName.toLowerCase()} to _PARAM2_`, description,
  'Action', [type === 'color' ? color('Value', description) : num('Value', description)],
  `if (!${PHYSICAL_NS}) return;\n` +
  `var objs = eventsFunctionContext.getObjects("Object");\n` +
  `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
  `for (var i = 0; i < objs.length; i++) {\n` +
  `  var b = objs[i].getBehavior(behaviorName);\n` +
  `  if (!b) continue;\n` +
  `  b._set${prop}(eventsFunctionContext.getArgument("Value"));\n` +
  `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
  `}\n`, { group: 'Physical Surface' });

const physicalFunctions = [
  pfn('doStepPreEvents', 'doStepPreEvents', '', '', 'Action', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `if (!objs.length) return;\n` +
    `var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));\n` +
    `if (b && ${PHYSICAL_NS}) ${PHYSICAL_NS}.tick(b, objs[0]);\n`,
    { withRuntime: true, private: true }),
  pfn('onDestroy', 'onDestroy', '', '', 'Action', [],
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `if (!objs.length || !${PHYSICAL_NS}) return;\n` +
    `var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));\n` +
    `if (b) ${PHYSICAL_NS}.dispose(b);\n`, { private: true }),
  physicalSetter('Transmission', 'Transmission', 'Glass-like transmission, 0 to 1.'),
  physicalSetter('IOR', 'Index of refraction', 'Index of refraction, 1 to 2.333.'),
  physicalSetter('Thickness', 'Thickness', 'Volume thickness behind the surface.'),
  physicalSetter('Clearcoat', 'Clearcoat', 'Clear lacquer layer, 0 to 1.'),
  physicalSetter('ClearcoatRoughness', 'Clearcoat roughness', 'Roughness of the clearcoat, 0 to 1.'),
  physicalSetter('Sheen', 'Sheen', 'Micro-fibre back-scatter, 0 to 1.'),
  physicalSetter('SheenColor', 'Sheen colour', 'Colour of the sheen highlight.', 'color'),
  physicalSetter('SheenRoughness', 'Sheen roughness', 'Sheen highlight roughness, 0 to 1.'),
  physicalSetter('Iridescence', 'Iridescence', 'Thin-film interference strength, 0 to 1.'),
  physicalSetter('IridescenceIOR', 'Iridescence IOR', 'Thin-film refractive index, 1 to 2.5.'),
  physicalSetter('IridescenceThicknessMin', 'Iridescence thickness minimum', 'Minimum film thickness in nanometres.'),
  physicalSetter('IridescenceThicknessMax', 'Iridescence thickness maximum', 'Maximum film thickness in nanometres.'),
  physicalSetter('Anisotropy', 'Anisotropy', 'Directional specular stretch, 0 to 1.'),
  physicalSetter('AnisotropyRotation', 'Anisotropy rotation', 'Stretch direction in degrees.'),
  pfn('IsReady', 'Physical material is ready', '_PARAM0_ physical material is ready',
    'The contributor is attached to Core-owned live materials.', 'Condition', [],
    `var objs=eventsFunctionContext.getObjects("Object"), result=false;\n` +
    `if(objs.length&&${PHYSICAL_NS}){var b=objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));result=!!b&&${PHYSICAL_NS}.stateOf(b).state==="Ready";}\n` +
    `eventsFunctionContext.returnValue=result;\n`, { group: 'Diagnostics' }),
  pfn('RequiresPhysicalMaterial', 'Requires Physical material', '_PARAM0_ requires a Physical material',
    'Whether an enabled field requires MeshPhysicalMaterial.', 'Condition', [],
    `var objs=eventsFunctionContext.getObjects("Object"), result=false;\n` +
    `if(objs.length&&${PHYSICAL_NS}){var b=objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));result=!!b&&${PHYSICAL_NS}.requiresPhysical(${PHYSICAL_NS}.read(b));}\n` +
    `eventsFunctionContext.returnValue=result;\n`, { group: 'Diagnostics' }),
  pfn('State', 'Physical material state', '', 'Ready, WaitingForCore, or Uninitialized.',
    'StringExpression', [],
    `var objs=eventsFunctionContext.getObjects("Object"), out="Uninitialized";\n` +
    `if(objs.length&&${PHYSICAL_NS}){var b=objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)out=${PHYSICAL_NS}.stateOf(b).state;}\n` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  pfn('LastError', 'Physical material last error', '', 'Why the contributor is waiting or failed.',
    'StringExpression', [],
    `var objs=eventsFunctionContext.getObjects("Object"), out="";\n` +
    `if(objs.length&&${PHYSICAL_NS}){var b=objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)out=${PHYSICAL_NS}.stateOf(b).error;}\n` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  pfn('SetAnisotropicFiltering', 'Set anisotropic filtering', 'Set _PARAM0_ anisotropic filtering to _PARAM2_',
    'Texture sharpness at oblique angles.', 'Action',
    [choiceParam('Value', 'Anisotropic filtering', ANISOTROPY_MODES)],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setAnisotropicFiltering) b._setAnisotropicFiltering(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Texture' }),
  pfn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_',
    'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Value', 'Anisotropy level (1 to 16)', '16')],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setAnisotropicFiltering) b._setAnisotropicFiltering(String(eventsFunctionContext.getArgument("Value")));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Texture' }),
  pfn('AnisotropicFiltering', 'Anisotropic filtering mode', '', 'Active anisotropic filtering mode.',
    'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = "16x";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getAnisotropicFiltering) out = String(b._getAnisotropicFiltering()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('TextureAnisotropy', 'Texture anisotropy', '', 'Current resolved texture anisotropy level (1 to 16).',
    'Expression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = 1;\n` +
    `if (objs.length && gdjs.__materialController3D) { var root = objs[0].get3DRendererObject ? objs[0].get3DRendererObject() : null; if (root) out = gdjs.__materialController3D.getObjectAnisotropy(root); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled',
    'Whether anisotropic filtering is active (anisotropy > 1).', 'Condition', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = false;\n` +
    `if (objs.length && gdjs.__materialController3D) { var root = objs[0].get3DRendererObject ? objs[0].get3DRendererObject() : null; if (root) out = gdjs.__materialController3D.getObjectAnisotropy(root) > 1; }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('SetTargetMode', 'Set target mode', 'Set _PARAM0_ target mode to _PARAM2_', 'Which materials to drive.', 'Action',
    [choiceParam('Value', 'Target mode', TARGET_MODES)],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setTargetMode) b._setTargetMode(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Targeting' }),
  pfn('SetMaterialIndex', 'Set material index', 'Set _PARAM0_ material index to _PARAM2_', 'Slot to target when Target Mode is "Material index".', 'Action',
    [num('Value', 'Material index')],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMaterialIndex) b._setMaterialIndex(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Targeting' }),
  pfn('SetMaterialName', 'Set material name', 'Set _PARAM0_ material name to _PARAM2_', 'Name to match when Target Mode is "Material name".', 'Action',
    [str('Value', 'Material name')],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMaterialName) b._setMaterialName(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Targeting' }),
  pfn('SetMeshName', 'Set mesh name', 'Set _PARAM0_ mesh name to _PARAM2_', 'Name to match when Target Mode is "Mesh name".', 'Action',
    [str('Value', 'Mesh name')],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setMeshName) b._setMeshName(eventsFunctionContext.getArgument("Value"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Targeting' }),
  pfn('TargetMode', 'Target mode', '', 'Active targeting mode.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = "All materials";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getTargetMode) out = String(b._getTargetMode()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('MaterialIndex', 'Target material index', '', 'Target slot index.', 'Expression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = 0;\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMaterialIndex) out = Number(b._getMaterialIndex()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('MaterialName', 'Target material name', '', 'Target material name.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMaterialName) out = String(b._getMaterialName()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('MeshName', 'Target mesh name', '', 'Target mesh name.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), out = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getMeshName) out = String(b._getMeshName()); }\n` +
    `eventsFunctionContext.returnValue = out;\n`, { group: 'Diagnostics' }),
  pfn('SetPreset', 'Set physical preset', 'Set _PARAM0_ physical preset to _PARAM2_', 'Switch physical surface preset.', 'Action',
    [choiceParam('Preset', 'Preset', PHYSICAL_PRESETS)],
    `if (!${PHYSICAL_NS}) return;\n` +
    `var objs = eventsFunctionContext.getObjects("Object");\n` +
    `var behaviorName = eventsFunctionContext.getBehaviorName("Behavior");\n` +
    `for (var i = 0; i < objs.length; i++) {\n` +
    `  var b = objs[i].getBehavior(behaviorName);\n` +
    `  if (!b) continue;\n` +
    `  if (b._setPreset) b._setPreset(eventsFunctionContext.getArgument("Preset"));\n` +
    `  ${PHYSICAL_NS}.sync(b, objs[i]);\n` +
    `}\n`, { group: 'Presets & Glass' }),
  pfn('IsPreset', 'Physical preset is', '_PARAM0_ physical preset is _PARAM2_', 'Check active physical preset.', 'Condition',
    [choiceParam('Preset', 'Preset', PHYSICAL_PRESETS)],
    `var objs = eventsFunctionContext.getObjects("Object"), res = false;\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getPreset) res = String(b._getPreset()) === String(eventsFunctionContext.getArgument("Preset")); }\n` +
    `eventsFunctionContext.returnValue = res;\n`, { group: 'Presets & Glass' }),
  pfn('Preset', 'Physical preset name', '', 'Current physical preset name.', 'StringExpression', [],
    `var objs = eventsFunctionContext.getObjects("Object"), res = "";\n` +
    `if (objs.length) { var b = objs[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")); if (b && b._getPreset) res = String(b._getPreset()); }\n` +
    `eventsFunctionContext.returnValue = res;\n`, { group: 'Presets & Glass' }),
];

const physicalBehavior = {
  name: PHYSICAL_BEHAVIOR_NAME,
  fullName: 'Physical Material 3D',
  description: 'Adds glass, clearcoat, sheen, iridescence and anisotropy to Material 3D Core without owning or replacing the material.',
  objectType: '',
  propertyDescriptors: [
    brdfProp('Preset', 'Choice', 'Physical preset', 'Choose a preset for glass, lacquer, sheen or thin films.', 'Custom', { extraInformation: PHYSICAL_PRESETS, group: 'Presets & Glass' }),
    brdfProp('Transmission', 'Number', 'Transmission', 'Glass-like transmission, 0 to 1.', '0', { group: 'Glass & Clearcoat' }),
    brdfProp('IOR', 'Number', 'Index of refraction', 'Glass is approximately 1.5.', '1.5', { group: 'Glass & Clearcoat' }),
    brdfProp('Thickness', 'Number', 'Thickness', 'Volume thickness behind the surface.', '0.1', { group: 'Glass & Clearcoat' }),
    brdfProp('Clearcoat', 'Number', 'Clearcoat', 'Clear lacquer layer, 0 to 1.', '0', { group: 'Glass & Clearcoat' }),
    brdfProp('ClearcoatRoughness', 'Number', 'Clearcoat roughness', 'Clearcoat roughness, 0 to 1.', '0', { group: 'Glass & Clearcoat' }),
    brdfProp('Sheen', 'Number', 'Sheen', 'Micro-fibre back-scatter, 0 to 1.', '0', { group: 'Sheen' }),
    brdfProp('SheenColor', 'Color', 'Sheen colour', 'Colour of the sheen highlight.', '255;255;255', { group: 'Sheen' }),
    brdfProp('SheenRoughness', 'Number', 'Sheen roughness', 'Sheen highlight roughness, 0 to 1.', '1', { group: 'Sheen' }),
    brdfProp('Iridescence', 'Number', 'Iridescence', 'Thin-film interference strength, 0 to 1.', '0', { group: 'Iridescence' }),
    brdfProp('IridescenceIOR', 'Number', 'Iridescence IOR', 'Thin-film refractive index, 1 to 2.5.', '1.3', { group: 'Iridescence' }),
    brdfProp('IridescenceThicknessMin', 'Number', 'Thickness minimum (nm)', 'Minimum film thickness.', '100', { group: 'Iridescence' }),
    brdfProp('IridescenceThicknessMax', 'Number', 'Thickness maximum (nm)', 'Maximum film thickness.', '400', { group: 'Iridescence' }),
    brdfProp('Anisotropy', 'Number', 'Anisotropy', 'Directional specular stretch, 0 to 1.', '0', { group: 'Anisotropy' }),
    brdfProp('AnisotropyRotation', 'Number', 'Anisotropy rotation', 'Stretch direction in degrees.', '0', { group: 'Anisotropy' }),
    brdfProp('AnisotropicFiltering', 'Choice', 'Anisotropic filtering',
      'Texture sharpness at oblique viewing angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).',
      '16x', { extraInformation: ANISOTROPY_MODES, group: 'Texture' }),
    brdfProp('TargetMode', 'Choice', 'Target mode', 'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: 'Targeting' }),
    brdfProp('MaterialIndex', 'Number', 'Material index', 'Slot to target when Target Mode is "Material index".', '0', { group: 'Targeting' }),
    brdfProp('MaterialName', 'String', 'Material name', 'Name to match when Target Mode is "Material name".', '', { group: 'Targeting' }),
    brdfProp('MeshName', 'String', 'Mesh name', 'Name to match when Target Mode is "Mesh name".', '', { group: 'Targeting' }),
  ],
  eventsFunctions: physicalFunctions,
};

/* ================================================================= Wet Material behavior */

const WET_BEHAVIOR_NAME = 'WetMaterial3D';
const WET_BEHAVIOR_TYPE = `${EXTENSION_NAME}::${WET_BEHAVIOR_NAME}`;
const WET_NS = 'gdjs.__wetMaterial3D';
const WET_OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: WET_BEHAVIOR_TYPE },
];
const wfn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, sentence, description, functionType,
  ...(opts.group ? { group: opts.group } : {}), private: opts.private === true,
  parameters: [...WET_OB, ...parameters],
  events: [{ type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (opts.withRuntime ? wetRuntime + '\n' : '') + code, parameterObjects: 'Object' }],
});
const wetSetter = (prop, label, description) => wfn(
  `Set${prop}`, `Set ${label}`, `Set _PARAM0_ ${label} to _PARAM2_`, description, 'Action',
  [num('Value', description)],
  `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
  `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){b._set${prop}(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
  { group: 'Wet Surface' });
const wetFunctions = [
  wfn('doStepPreEvents', 'doStepPreEvents', '', '', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(!o.length)return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&${WET_NS})${WET_NS}.tick(b,o[0]);\n`,
    { withRuntime: true, private: true }),
  wfn('onDestroy', 'onDestroy', '', '', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(!o.length||!${WET_NS})return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${WET_NS}.dispose(b);\n`,
    { private: true }),
  wetSetter('Wetness', 'wetness', 'Wetness amount, 0 to 1.'),
  wetSetter('Porosity', 'porosity', 'How strongly the surface darkens, 0 to 1.'),
  wetSetter('WetRoughness', 'wet roughness', 'Roughness at full wetness, 0 to 1.'),
  wetSetter('DarkeningStrength', 'darkening strength', 'Maximum porous-surface darkening, 0 to 1.'),
  wfn('IsWet', 'Surface is wet', '_PARAM0_ surface is wet', 'Wetness is above zero.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${WET_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${WET_NS}.read(b).wetness>0;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  wfn('IsReady', 'Wet material is ready', '_PARAM0_ wet material is ready', 'The contributor is attached to Core.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${WET_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${WET_NS}.stateOf(b).state==="Ready";}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  wfn('WetnessLevel', 'Wetness level', '', 'Current clamped wetness.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${WET_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${WET_NS}.read(b).wetness;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  wfn('State', 'Wet material state', '', 'Ready, WaitingForCore, or Uninitialized.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="Uninitialized";if(o.length&&${WET_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${WET_NS}.stateOf(b).state;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  wfn('SetAnisotropicFiltering', 'Set anisotropic filtering', 'Set _PARAM0_ anisotropic filtering to _PARAM2_',
    'Texture sharpness at oblique angles.', 'Action',
    [choiceParam('Value', 'Anisotropic filtering', ANISOTROPY_MODES)],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Wet Surface' }),
  wfn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_',
    'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Value', 'Anisotropy level (1 to 16)', '16')],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(String(eventsFunctionContext.getArgument("Value")));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Wet Surface' }),
  wfn('AnisotropicFiltering', 'Anisotropic filtering mode', '', 'Active anisotropic filtering mode.',
    'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out="16x";` +
    `if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getAnisotropicFiltering)out=String(b._getAnisotropicFiltering());}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('TextureAnisotropy', 'Texture anisotropy', '', 'Current resolved texture anisotropy level (1 to 16).',
    'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out=1;` +
    `if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)out=gdjs.__materialController3D.getObjectAnisotropy(root);}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled',
    'Whether anisotropic filtering is active (anisotropy > 1).', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),out=false;` +
    `if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)out=gdjs.__materialController3D.getObjectAnisotropy(root)>1;}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('SetTargetMode', 'Set target mode', 'Set _PARAM0_ target mode to _PARAM2_', 'Which materials to drive.', 'Action',
    [choiceParam('Value', 'Target mode', TARGET_MODES)],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setTargetMode)b._setTargetMode(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  wfn('SetMaterialIndex', 'Set material index', 'Set _PARAM0_ material index to _PARAM2_', 'Slot to target when Target Mode is "Material index".', 'Action',
    [num('Value', 'Material index')],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialIndex)b._setMaterialIndex(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  wfn('SetMaterialName', 'Set material name', 'Set _PARAM0_ material name to _PARAM2_', 'Name to match when Target Mode is "Material name".', 'Action',
    [str('Value', 'Material name')],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialName)b._setMaterialName(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  wfn('SetMeshName', 'Set mesh name', 'Set _PARAM0_ mesh name to _PARAM2_', 'Name to match when Target Mode is "Mesh name".', 'Action',
    [str('Value', 'Mesh name')],
    `if(!${WET_NS})return;var o=eventsFunctionContext.getObjects("Object");var n=eventsFunctionContext.getBehaviorName("Behavior");` +
    `for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMeshName)b._setMeshName(eventsFunctionContext.getArgument("Value"));${WET_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  wfn('TargetMode', 'Target mode', '', 'Active targeting mode.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out="All materials";` +
    `if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getTargetMode)out=String(b._getTargetMode());}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('MaterialIndex', 'Target material index', '', 'Target slot index.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out=0;` +
    `if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialIndex)out=Number(b._getMaterialIndex());}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('MaterialName', 'Target material name', '', 'Target material name.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out="";` +
    `if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialName)out=String(b._getMaterialName());}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
  wfn('MeshName', 'Target mesh name', '', 'Target mesh name.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),out="";` +
    `if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMeshName)out=String(b._getMeshName());}` +
    `eventsFunctionContext.returnValue=out;\n`, { group: 'Diagnostics' }),
];
const wetBehavior = {
  name: WET_BEHAVIOR_NAME, fullName: 'Wet Material 3D',
  description: 'Adds non-compounding wet darkening and roughness to Material 3D Core without replacing materials.',
  objectType: '',
  propertyDescriptors: [
    brdfProp('Wetness', 'Number', 'Wetness', 'Wetness amount, 0 to 1.', '0', { group: 'Wet Surface' }),
    brdfProp('Porosity', 'Number', 'Porosity', 'How strongly the surface darkens, 0 to 1.', '0.5', { group: 'Wet Surface' }),
    brdfProp('WetRoughness', 'Number', 'Wet roughness', 'Roughness at full wetness.', '0.02', { group: 'Wet Surface' }),
    brdfProp('DarkeningStrength', 'Number', 'Darkening strength', 'Maximum porous darkening.', '0.35', { group: 'Wet Surface' }),
    brdfProp('AnisotropicFiltering', 'Choice', 'Anisotropic filtering',
      'Texture sharpness at oblique viewing angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).',
      '16x', { extraInformation: ANISOTROPY_MODES, group: 'Wet Surface' }),
    brdfProp('TargetMode', 'Choice', 'Target mode', 'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: 'Targeting' }),
    brdfProp('MaterialIndex', 'Number', 'Material index', 'Slot to target when Target Mode is "Material index".', '0', { group: 'Targeting' }),
    brdfProp('MaterialName', 'String', 'Material name', 'Name to match when Target Mode is "Material name".', '', { group: 'Targeting' }),
    brdfProp('MeshName', 'String', 'Mesh name', 'Name to match when Target Mode is "Mesh name".', '', { group: 'Targeting' }),
  ],
  eventsFunctions: wetFunctions,
};

/* ================================================================= Animated Material behavior */
const ANIMATED_BEHAVIOR_NAME='AnimatedMaterial3D', ANIMATED_BEHAVIOR_TYPE=`${EXTENSION_NAME}::${ANIMATED_BEHAVIOR_NAME}`, ANIMATED_NS='gdjs.__animatedMaterial3D';
const ANIMATED_OB=[{name:'Object',type:'object',description:'Object'},{name:'Behavior',type:'behavior',description:'Behavior',supplementaryInformation:ANIMATED_BEHAVIOR_TYPE}];
const afn=(name,fullName,sentence,description,functionType,parameters,code,opts={})=>({name,fullName,sentence,description,functionType,...(opts.group?{group:opts.group}:{}),private:opts.private===true,parameters:[...ANIMATED_OB,...parameters],events:[{type:'BuiltinCommonInstructions::JsCode',inlineCode:(opts.withRuntime?animatedRuntime+'\n':'')+code,parameterObjects:'Object'}]});
const animatedSet=(prop,label,type='number')=>afn(`Set${prop}`,`Set ${label}`,`Set _PARAM0_ ${label} to _PARAM2_`,`Change ${label}.`,'Action',[type==='bool'?bool('Value',label):num('Value',label)],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){b._set${prop}(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'Animation'});
const animatedFunctions=[
 afn('doStepPreEvents','doStepPreEvents','','','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(!o.length)return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&${ANIMATED_NS})${ANIMATED_NS}.tick(b,o[0],runtimeScene.getTimeManager().getElapsedTime()/1000);\n`,{withRuntime:true,private:true}),
 afn('onDestroy','onDestroy','','','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(!o.length||!${ANIMATED_NS})return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${ANIMATED_NS}.dispose(b);\n`,{private:true}),
 ...[['TilingX','tiling X'],['TilingY','tiling Y'],['OffsetX','offset X'],['OffsetY','offset Y'],['RotationAngle','rotation'],['RotationCenterX','rotation centre X'],['RotationCenterY','rotation centre Y'],['ScrollSpeedX','scroll speed X'],['ScrollSpeedY','scroll speed Y'],['ScrollRotationSpeed','scroll rotation speed'],['FlipbookColumns','flipbook columns'],['FlipbookRows','flipbook rows'],['FlipbookFPS','flipbook FPS'],['FlipbookTotalFrames','flipbook frame count']].map(x=>animatedSet(x[0],x[1])),
 animatedSet('EnableScroll','UV scrolling','bool'),animatedSet('EnableFlipbook','flipbook','bool'),animatedSet('FlipbookLoop','flipbook looping','bool'),
 afn('PlayFlipbook','Play flipbook','Play _PARAM0_ flipbook','Resume flipbook playback.','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){var s=${ANIMATED_NS}.stateOf(b);s.playing=true;s.finished=false;}}\n`,{group:'Playback'}),
 afn('PauseFlipbook','Pause flipbook','Pause _PARAM0_ flipbook','Pause flipbook playback.','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${ANIMATED_NS}.stateOf(b).playing=false;}\n`,{group:'Playback'}),
 afn('SetFrame','Set flipbook frame','Set _PARAM0_ frame to _PARAM2_','Set current zero-based frame.','Action',[num('Frame','Frame index')],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){var s=${ANIMATED_NS}.stateOf(b);s.frame=Math.max(0,Math.floor(eventsFunctionContext.getArgument("Frame")));${ANIMATED_NS}.transform(s);}}\n`,{group:'Playback'}),
 afn('SetVideoTexture','Set video texture','Set _PARAM0_ video texture to _PARAM2_','Use a video URL as the albedo map.','Action',[str('URL','Video URL'),bool('Loop','Loop video'),bool('Muted','Mute video')],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${ANIMATED_NS}.setVideo(b,o[0],eventsFunctionContext.getArgument("URL"),eventsFunctionContext.getArgument("Loop"),eventsFunctionContext.getArgument("Muted"));}\n`,{group:'Video'}),
 afn('PlayVideo','Play video texture','Play _PARAM0_ video texture','Resume the current video texture.','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${ANIMATED_NS}.playVideo(b);}\n`,{group:'Video'}),
 afn('PauseVideo','Pause video texture','Pause _PARAM0_ video texture','Pause the current video texture.','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${ANIMATED_NS}.pauseVideo(b);}\n`,{group:'Video'}),
 afn('IsReady','Animated material is ready','_PARAM0_ animated material is ready','Contributor is attached to Core.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${ANIMATED_NS}.stateOf(b).state==="Ready";}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 afn('IsFlipbookPlaying','Flipbook is playing','_PARAM0_ flipbook is playing','Flipbook is advancing.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${ANIMATED_NS}.stateOf(b).playing;}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 afn('CurrentFrame','Current frame','','Current zero-based frame.','Expression',[],`var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${ANIMATED_NS}.stateOf(b).frame;}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 afn('State','Animated material state','','Ready, WaitingForCore, or Uninitialized.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),r="Uninitialized";if(o.length&&${ANIMATED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${ANIMATED_NS}.stateOf(b).state;}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 afn('SetAnisotropicFiltering','Set anisotropic filtering','Set _PARAM0_ anisotropic filtering to _PARAM2_','Texture sharpness at oblique angles.','Action',[choiceParam('Value','Anisotropic filtering',ANISOTROPY_MODES)],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'UV Transform'}),
 afn('SetTextureAnisotropy','Set texture anisotropy','Set _PARAM0_ texture anisotropy to _PARAM2_','Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).','Action',[num('Value','Anisotropy level (1 to 16)','16')],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(String(eventsFunctionContext.getArgument("Value")));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'UV Transform'}),
 afn('AnisotropicFiltering','Anisotropic filtering mode','','Active anisotropic filtering mode.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),out="16x";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getAnisotropicFiltering)out=String(b._getAnisotropicFiltering());}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('TextureAnisotropy','Texture anisotropy','','Current resolved texture anisotropy level (1 to 16).','Expression',[],`var o=eventsFunctionContext.getObjects("Object"),out=1;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)out=gdjs.__materialController3D.getObjectAnisotropy(root);}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('IsAnisotropicFilteringEnabled','Anisotropic filtering is enabled','_PARAM0_ anisotropic filtering is enabled','Whether anisotropic filtering is active (anisotropy > 1).','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),out=false;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)out=gdjs.__materialController3D.getObjectAnisotropy(root)>1;}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('SetTargetMode','Set target mode','Set _PARAM0_ target mode to _PARAM2_','Which materials to drive.','Action',[choiceParam('Value','Target mode',TARGET_MODES)],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setTargetMode)b._setTargetMode(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'Targeting'}),
  afn('SetMaterialIndex','Set material index','Set _PARAM0_ material index to _PARAM2_','Slot to target when Target Mode is "Material index".','Action',[num('Value','Material index')],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialIndex)b._setMaterialIndex(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'Targeting'}),
  afn('SetMaterialName','Set material name','Set _PARAM0_ material name to _PARAM2_','Name to match when Target Mode is "Material name".','Action',[str('Value','Material name')],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialName)b._setMaterialName(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'Targeting'}),
  afn('SetMeshName','Set mesh name','Set _PARAM0_ mesh name to _PARAM2_','Name to match when Target Mode is "Mesh name".','Action',[str('Value','Mesh name')],`if(!${ANIMATED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMeshName)b._setMeshName(eventsFunctionContext.getArgument("Value"));${ANIMATED_NS}.sync(b,o[i]);}}\n`,{group:'Targeting'}),
  afn('TargetMode','Target mode','','Active targeting mode.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),out="All materials";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getTargetMode)out=String(b._getTargetMode());}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('MaterialIndex','Target material index','','Target slot index.','Expression',[],`var o=eventsFunctionContext.getObjects("Object"),out=0;if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialIndex)out=Number(b._getMaterialIndex());}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('MaterialName','Target material name','','Target material name.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),out="";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialName)out=String(b._getMaterialName());}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'}),
  afn('MeshName','Target mesh name','','Target mesh name.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),out="";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMeshName)out=String(b._getMeshName());}eventsFunctionContext.returnValue=out;\n`,{group:'Diagnostics'})
];
const animatedBehavior={name:ANIMATED_BEHAVIOR_NAME,fullName:'Animated Material 3D',description:'Adds independent UV transforms, scrolling, flipbooks and video to Material 3D Core.',objectType:'',propertyDescriptors:[
 ...[['TilingX','Tiling X','1'],['TilingY','Tiling Y','1'],['OffsetX','Offset X','0'],['OffsetY','Offset Y','0'],['RotationAngle','Rotation (degrees)','0'],['RotationCenterX','Rotation centre X','0.5'],['RotationCenterY','Rotation centre Y','0.5'],['ScrollSpeedX','Scroll speed X','0'],['ScrollSpeedY','Scroll speed Y','0'],['ScrollRotationSpeed','Scroll rotation speed','0'],['FlipbookColumns','Flipbook columns','1'],['FlipbookRows','Flipbook rows','1'],['FlipbookFPS','Flipbook FPS','12'],['FlipbookTotalFrames','Flipbook frames','0']].map(x=>brdfProp(x[0],'Number',x[1],x[1],x[2],{group:x[0].startsWith('Flipbook')?'Flipbook':'UV Transform'})),
 brdfProp('EnableScroll','Boolean','Enable scrolling','Continuously scroll UV coordinates.','false',{group:'UV Scrolling'}),
 brdfProp('EnableFlipbook','Boolean','Enable flipbook','Animate a texture atlas.','false',{group:'Flipbook'}),
 brdfProp('FlipbookLoop','Boolean','Loop flipbook','Loop at the final frame.','true',{group:'Flipbook'}),
 brdfProp('AnisotropicFiltering','Choice','Anisotropic filtering','Texture sharpness at oblique viewing angles (16x, Max, 8x, 4x, 2x, 1 (Off), Keep Original).','16x',{extraInformation:ANISOTROPY_MODES,group:'UV Transform'}),
 brdfProp('TargetMode', 'Choice', 'Target mode', 'Which materials to drive.', 'All materials', { extraInformation: TARGET_MODES, group: 'Targeting' }),
 brdfProp('MaterialIndex', 'Number', 'Material index', 'Slot to target when Target Mode is "Material index".', '0', { group: 'Targeting' }),
 brdfProp('MaterialName', 'String', 'Material name', 'Name to match when Target Mode is "Material name".', '', { group: 'Targeting' }),
 brdfProp('MeshName', 'String', 'Mesh name', 'Name to match when Target Mode is "Mesh name".', '', { group: 'Targeting' }),
],eventsFunctions:animatedFunctions};

/* ================================================================= Pattern Material behavior */
const PATTERN_BEHAVIOR_NAME='TiledCustomPatternMaterial3D',PATTERN_BEHAVIOR_TYPE=`${EXTENSION_NAME}::${PATTERN_BEHAVIOR_NAME}`,PATTERN_NS='gdjs.__patternMaterial3D';
const PATTERN_OB=[{name:'Object',type:'object',description:'Object'},{name:'Behavior',type:'behavior',description:'Behavior',supplementaryInformation:PATTERN_BEHAVIOR_TYPE}];
const patternFn=(name,fullName,sentence,description,functionType,parameters,code,opts={})=>({name,fullName,sentence,description,functionType,...(opts.group?{group:opts.group}:{}),private:opts.private===true,parameters:[...PATTERN_OB,...parameters],events:[{type:'BuiltinCommonInstructions::JsCode',inlineCode:(opts.withRuntime?patternRuntime+'\n':'')+code,parameterObjects:'Object'}]});
const patternSet=(prop,label,type='number',choices=[])=>patternFn(`Set${prop}`,`Set ${label}`,`Set _PARAM0_ ${label} to _PARAM2_`,`Change ${label}.`,'Action',[type==='bool'?bool('Value',label):type==='color'?color('Value',label):type==='choice'?choiceParam('Value',label,choices):num('Value',label)],`if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){b._set${prop}(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,{group:'Recipe'});
const PATTERN_TYPES=['Solid','Grid','Brick','Checker','Stripes','Dots','Hexagons','Voronoi','Herringbone','Basketweave','WoodPlanks'];
const patternFields=[['Enabled','enabled','bool'],['PatternType','pattern type','choice'],['ScaleX','scale X'],['ScaleY','scale Y'],['RotationAngle','rotation angle'],['Seed','seed'],['GapWidth','gap width'],['EdgeSoftness','edge softness'],['PrimaryColor','primary colour','color'],['SecondaryColor','secondary colour','color'],['BorderColor','border colour','color'],['TextureOverlayColor','texture overlay colour','color'],['Saturation','saturation'],['ColorVariation','colour variation'],['NoiseScale','noise scale'],['NoiseStrength','noise strength'],['SurfaceRoughness','surface roughness'],['BorderRoughness','border roughness'],['Metalness','metalness'],['Strength','strength'],['OverwriteTexture','overwrite texture','bool'],['AutoTiling','auto tiling','bool']];
const patternFunctions=[
 patternFn('doStepPreEvents','doStepPreEvents','','','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(!o.length)return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&${PATTERN_NS})${PATTERN_NS}.tick(b,o[0]);\n`,{withRuntime:true,private:true}),
 patternFn('onDestroy','onDestroy','','','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(!o.length||!${PATTERN_NS})return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${PATTERN_NS}.dispose(b);\n`,{private:true}),
 patternFn('SetPreset', 'Set pattern preset', 'Set _PARAM0_ pattern preset to _PARAM2_', 'Choose a procedural pattern preset.', 'Action',
   [choiceParam('Value', 'Pattern preset', PATTERN_PRESETS)],
   `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setPreset)b._setPreset(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
   { group: 'Presets & Pattern' }),
 patternFn('IsPreset', 'Pattern preset is active', '_PARAM0_ pattern preset is _PARAM2_', 'Check whether a pattern preset is active.', 'Condition',
   [choiceParam('Value', 'Pattern preset', PATTERN_PRESETS)],
   `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=String(${PATTERN_NS}.read(b).preset||"Custom")===String(eventsFunctionContext.getArgument("Value"));}eventsFunctionContext.returnValue=r;\n`,
   { group: 'Presets & Pattern' }),
 patternFn('Preset', 'Pattern preset name', '', 'Current pattern preset name.', 'StringExpression', [],
   `var o=eventsFunctionContext.getObjects("Object"),r="Custom";if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=String(${PATTERN_NS}.read(b).preset||"Custom");}eventsFunctionContext.returnValue=r;\n`,
   { group: 'Presets & Pattern' }),
 ...patternFields.map(x=>patternSet(x[0],x[1],x[2],x[0]==='PatternType'?PATTERN_TYPES:[])),
 patternFn('RandomizeSeed','Randomize recipe seed','Randomize _PARAM0_ recipe seed','Assign a new stable random seed.','Action',[],`var o=eventsFunctionContext.getObjects("Object");if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){b._setSeed(Math.floor(Math.random()*2147483647));${PATTERN_NS}.sync(b,o[0]);}}\n`,{group:'Recipe'}),
 patternFn('IsReady','Pattern material is ready','_PARAM0_ pattern material is ready','Contributor is attached to Core.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${PATTERN_NS}.stateOf(b).state==="Ready";}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 patternFn('IsShaderActive','Pattern shader is active','_PARAM0_ pattern shader is active','The injector reached the compiled shader.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&gdjs.__materialController3D&&gdjs.__m3dShaderChain){var root=o[0].get3DRendererObject();var t=gdjs.__materialController3D.getTargets(root);r=t.length>0&&gdjs.__m3dShaderChain.hasInjector(t[0].material,"pattern-material");}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
 patternFn('IsOverwriteTexture','Overwrite texture is enabled','_PARAM0_ is overwriting texture','Whether the underlying texture is being overwritten by pattern colors.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=!!${PATTERN_NS}.read(b).overwriteTexture;}eventsFunctionContext.returnValue=r;\n`,{group:'Recipe'}),
 patternFn('IsAutoTiling','Auto tiling is enabled','_PARAM0_ auto tiling is enabled','Whether auto tiling scales pattern repetition proportionally with object dimensions.','Condition',[],`var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=!!${PATTERN_NS}.read(b).autoTiling;}eventsFunctionContext.returnValue=r;\n`,{group:'Structure'}),
 patternFn('RecipeSeed','Recipe seed','','Current deterministic seed.','Expression',[],`var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${PATTERN_NS}.read(b).seed;}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
  patternFn('PatternType','Pattern type','','Current pattern type.','StringExpression',[],`var o=eventsFunctionContext.getObjects("Object"),r="";if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${PATTERN_NS}.read(b).type;}eventsFunctionContext.returnValue=r;\n`,{group:'Diagnostics'}),
  patternFn('RotationAngle','Pattern rotation angle','','Current pattern rotation angle in degrees.','Expression',[],`var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${PATTERN_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getRotationAngle)r=Number(b._getRotationAngle());}eventsFunctionContext.returnValue=r;\n`,{group:'Structure'}),
  patternFn('SetAnisotropicFiltering', 'Set anisotropic filtering', 'Set _PARAM0_ anisotropic filtering to _PARAM2_',
    'Texture sharpness at oblique angles.', 'Action',
    [choiceParam('Value', 'Anisotropic filtering', ANISOTROPY_MODES)],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Surface' }),
  patternFn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_',
    'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Value', 'Anisotropy level (1 to 16)', '16')],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(String(eventsFunctionContext.getArgument("Value")));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Surface' }),
  patternFn('AnisotropicFiltering', 'Anisotropic filtering mode', '', 'Active anisotropic filtering mode.',
    'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="16x";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getAnisotropicFiltering)r=String(b._getAnisotropicFiltering());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('TextureAnisotropy', 'Texture anisotropy', '', 'Current resolved texture anisotropy level (1 to 16).',
    'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=1;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)r=gdjs.__materialController3D.getObjectAnisotropy(root);}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled',
    'Whether anisotropic filtering is active (anisotropy > 1).', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)r=gdjs.__materialController3D.getObjectAnisotropy(root)>1;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('SetTargetMode', 'Set target mode', 'Set _PARAM0_ target mode to _PARAM2_', 'Which materials to drive.', 'Action',
    [choiceParam('Value', 'Target mode', TARGET_MODES)],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setTargetMode)b._setTargetMode(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  patternFn('SetMaterialIndex', 'Set material index', 'Set _PARAM0_ material index to _PARAM2_', 'Slot to target when Target Mode is "Material index".', 'Action',
    [num('Value', 'Material index')],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialIndex)b._setMaterialIndex(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  patternFn('SetMaterialName', 'Set material name', 'Set _PARAM0_ material name to _PARAM2_', 'Name to match when Target Mode is "Material name".', 'Action',
    [str('Value', 'Material name')],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMaterialName)b._setMaterialName(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  patternFn('SetMeshName', 'Set mesh name', 'Set _PARAM0_ mesh name to _PARAM2_', 'Name to match when Target Mode is "Mesh name".', 'Action',
    [str('Value', 'Mesh name')],
    `if(!${PATTERN_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setMeshName)b._setMeshName(eventsFunctionContext.getArgument("Value"));${PATTERN_NS}.sync(b,o[i]);}}\n`,
    { group: 'Targeting' }),
  patternFn('TargetMode', 'Target mode', '', 'Active targeting mode.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="All materials";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getTargetMode)r=String(b._getTargetMode());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('MaterialIndex', 'Target material index', '', 'Target slot index.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialIndex)r=Number(b._getMaterialIndex());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('MaterialName', 'Target material name', '', 'Target material name.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMaterialName)r=String(b._getMaterialName());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }),
  patternFn('MeshName', 'Target mesh name', '', 'Target mesh name.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getMeshName)r=String(b._getMeshName());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' })
];
const pd=(name,type,label,value,group='Recipe',extra={})=>brdfProp(name,type,label,label,value,{group,...extra});
const patternBehavior={name:PATTERN_BEHAVIOR_NAME,fullName:'Tiled Custom Pattern Material 3D',description:'Synthesizes repeatable shapes, seeded variation, noise, colour and PBR response with no required image textures.',objectType:'',propertyDescriptors:[
 pd('Preset','Choice','Pattern preset','Custom','Presets & Pattern',{extraInformation:PATTERN_PRESETS}),
 pd('PatternType','Choice','Pattern type','Brick','Presets & Pattern',{extraInformation:PATTERN_TYPES}),
 pd('Enabled','Boolean','Enabled','true','Presets & Pattern'),
 pd('ScaleX','Number','Scale X','8','Structure'),
 pd('ScaleY','Number','Scale Y','8','Structure'),
 pd('RotationAngle','Number','Rotation angle','0','Structure'),
 pd('AutoTiling','Boolean','Auto tiling','true','Structure'),
 pd('GapWidth','Number','Gap width','0.06','Structure'),
 pd('EdgeSoftness','Number','Edge softness','0.02','Structure'),
 pd('PrimaryColor','Color','Primary colour','180;180;180','Palette'),
 pd('SecondaryColor','Color','Secondary colour','130;130;130','Palette'),
 pd('BorderColor','Color','Border colour','45;45;45','Palette'),
 pd('ColorVariation','Number','Colour variation','0.15','Palette'),
 pd('SurfaceRoughness','Number','Surface roughness','0.6','Surface'),
 pd('BorderRoughness','Number','Border roughness','0.9','Surface'),
 pd('Metalness','Number','Metalness','0','Surface'),
 pd('Strength','Number','Effect strength','1','Surface'),
 pd('NoiseScale','Number','Noise scale','2','Weathering'),
 pd('NoiseStrength','Number','Noise strength','0.15','Weathering'),
 pd('TextureOverlayColor','Color','Texture overlay colour','255;255;255','Texture Overlay'),
 pd('Saturation','Number','Saturation','1','Texture Overlay'),
 pd('OverwriteTexture','Boolean','Overwrite texture','true','Texture Overlay'),
 pd('Seed','Number','Seed','1','Recipe'),
 pd('AnisotropicFiltering', 'Choice', 'Anisotropic filtering', '16x', 'Surface', { extraInformation: ANISOTROPY_MODES }),
 pd('TargetMode','Choice','Target mode','All materials','Targeting',{extraInformation:TARGET_MODES}),
 pd('MaterialIndex','Number','Material index','0','Targeting'),
 pd('MaterialName','String','Material name','','Targeting'),
 pd('MeshName','String','Mesh name','','Targeting')
],eventsFunctions:patternFunctions};

/* ================================================================= Displaced Mesh behavior */
const DISPLACED_BEHAVIOR_NAME = 'DisplacedMesh3D';
const DISPLACED_BEHAVIOR_TYPE = `${EXTENSION_NAME}::${DISPLACED_BEHAVIOR_NAME}`;
const DISPLACED_NS = 'gdjs.__displacedMesh3D';
const DISPLACED_OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior', supplementaryInformation: DISPLACED_BEHAVIOR_TYPE },
];
const displacedFn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, sentence, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: opts.private === true,
  parameters: [...DISPLACED_OB, ...parameters],
  events: [{
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (opts.withRuntime ? displacedRuntime + '\n' : '') + code,
    parameterObjects: 'Object',
  }],
});
const displacedSet = (prop, label, type = 'number', choices = [], group = 'Displacement') =>
  displacedFn(`Set${prop}`, `Set ${label}`, `Set _PARAM0_ ${label} to _PARAM2_`, `Change ${label}.`, 'Action',
    [type === 'bool' ? bool('Value', label) : type === 'choice' ? choiceParam('Value', label, choices) : type === 'string' ? str('Value', label) : num('Value', label)],
    `if(!${DISPLACED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){b._set${prop}(eventsFunctionContext.getArgument("Value"));${DISPLACED_NS}.markDirty(b,o[i]);}}\n`,
    { group: group }
  );

const DISPLACEMENT_MODES = ['Hybrid', 'Pattern Driven', 'Geological Weathering', 'Custom Noise'];
const DISPLACED_UPDATE_MODES = ['On creation', 'On property change', 'Manual'];

const displacedFields = [
  ['DisplacementMode', 'displacement mode', 'choice', DISPLACEMENT_MODES, 'Displacement & Mode'],
  ['Enabled', 'enabled', 'bool', [], 'Displacement & Mode'],
  ['UpdateMode', 'update mode', 'choice', DISPLACED_UPDATE_MODES, 'General'],
  ['IncludeChildren', 'include children', 'bool', [], 'General'],
  ['Seed', 'seed', 'number', [], 'General'],
  ['AnisotropicFiltering', 'anisotropic filtering', 'choice', ANISOTROPY_MODES, 'General'],

  ['SubdivideCubes', 'subdivide cubes', 'bool', [], 'Geometry Budget'],
  ['Subdivision', 'subdivision', 'number', [], 'Geometry Budget'],
  ['MaxVerticesPerObject', 'max vertices per object', 'number', [], 'Geometry Budget'],
  ['PreserveSharpEdges', 'preserve sharp edges', 'bool', [], 'Geometry Budget'],
  ['BridgeSeams', 'bridge seams', 'bool', [], 'Geometry Budget'],

  ['UseRelativeUnits', 'use relative units', 'bool', [], 'Surface Expansion'],
  ['Inflate', 'inflate', 'number', [], 'Surface Expansion'],
  ['EdgeSeal', 'edge seal', 'number', [], 'Surface Expansion'],
  ['EdgeSealWidth', 'edge seal width', 'number', [], 'Surface Expansion'],

  ['BlendNeighbors', 'blend with neighbours', 'bool', [], 'Neighbour Blending'],
  ['BlendGroup', 'blend group', 'string', [], 'Neighbour Blending'],
  ['BlendRadius', 'blend radius', 'number', [], 'Neighbour Blending'],
  ['BlendCornerRadius', 'blend corner radius', 'number', [], 'Neighbour Blending'],

  ['AutoTiling', 'auto tiling', 'bool', [], 'Pattern Displacement'],
  ['PatternDepth', 'pattern depth', 'number', [], 'Pattern Displacement'],
  ['PatternRaise', 'pattern raise', 'number', [], 'Pattern Displacement'],
  ['PatternBevel', 'pattern bevel', 'number', [], 'Pattern Displacement'],
  ['PatternHeightVariance', 'pattern height variance', 'number', [], 'Pattern Displacement'],
  ['PatternSurfaceNoise', 'pattern surface noise', 'number', [], 'Pattern Displacement'],
  ['UseDirectPattern', 'use direct pattern', 'bool', [], 'Pattern Displacement'],
  ['PatternType', 'pattern type', 'choice', PATTERN_TYPES, 'Pattern Displacement'],
  ['ScaleX', 'scale X', 'number', [], 'Pattern Displacement'],
  ['ScaleY', 'scale Y', 'number', [], 'Pattern Displacement'],
  ['GapWidth', 'gap width', 'number', [], 'Pattern Displacement'],
  ['EdgeSoftness', 'edge softness', 'number', [], 'Pattern Displacement'],
  ['PatternTiltStrength', 'pattern tilt strength', 'number', [], 'Pattern Displacement'],
  ['BrickAspectRatio', 'brick aspect ratio', 'number', [], 'Pattern Displacement'],

  ['RoughnessStrength', 'roughness strength', 'number', [], 'Geological Displacement'],
  ['NoiseFrequency', 'noise frequency', 'number', [], 'Geological Displacement'],
  ['NoiseOctaves', 'noise octaves', 'number', [], 'Geological Displacement'],
  ['NoisePersistence', 'noise persistence', 'number', [], 'Geological Displacement'],
  ['NoiseLacunarity', 'noise lacunarity', 'number', [], 'Geological Displacement'],
  ['TerraceLayers', 'terrace layers', 'number', [], 'Geological Displacement'],
  ['TerraceSharpness', 'terrace sharpness', 'number', [], 'Geological Displacement'],
  ['CornerErosion', 'corner erosion', 'number', [], 'Geological Displacement'],
  ['MicroPitting', 'micro pitting', 'number', [], 'Geological Displacement'],
  ['CreviceShading', 'crevice shading', 'number', [], 'Crevice Shading'],
];

const displacedFunctions = [
  displacedFn('doStepPreEvents', 'doStepPreEvents', '', '', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(!o.length)return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&${DISPLACED_NS})${DISPLACED_NS}.sync(b,o[0]);\n`,
    { withRuntime: true, private: true }
  ),
  displacedFn('onDestroy', 'onDestroy', '', '', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(!o.length||!${DISPLACED_NS})return;var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${DISPLACED_NS}.dispose(b,o[0]);\n`,
    { private: true }
  ),
  ...displacedFields.map((f) => displacedSet(f[0], f[1], f[2], f[3], f[4])),
  displacedFn('RandomizeSeed', 'Randomize seed', 'Randomize _PARAM0_ displacement seed', 'Assign a random stable seed and mark dirty.', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){b._setSeed(Math.floor(Math.random()*2147483647));${DISPLACED_NS}.markDirty(b,o[0]);}}\n`,
    { group: 'General' }
  ),
  displacedFn('RebuildMesh', 'Rebuild displaced mesh', 'Rebuild displaced mesh on _PARAM0_', 'Forces an immediate geometry rebuild.', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${DISPLACED_NS}.rebuildMesh(b,o[0]);}\n`,
    { group: 'General' }
  ),
  displacedFn('CaptureCurrentAsBase', 'Capture current mesh as base', 'Capture current deformed mesh on _PARAM0_ as new base', 'Freezes current displacement as the baseline geometry.', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${DISPLACED_NS}.captureCurrentAsBase(b,o[0]);}\n`,
    { group: 'General' }
  ),
  displacedFn('ResetToOriginal', 'Reset to original geometry', 'Reset _PARAM0_ to pristine original geometry', 'Reverts geometry and releases ownership.', 'Action', [],
    `var o=eventsFunctionContext.getObjects("Object");if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)${DISPLACED_NS}.dispose(b,o[0]);}\n`,
    { group: 'General' }
  ),
  displacedFn('IsReady', 'Displaced mesh is ready', '_PARAM0_ displaced mesh is ready', 'Behavior is initialized and geometry is ready.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).state==="Ready";}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsMeshDisplaced', 'Mesh is displaced', '_PARAM0_ mesh is displaced', 'True if at least one mesh has been deformed.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).affectedMeshCount>0;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsBridgeSeams', 'Bridge seams is enabled', '_PARAM0_ bridge seams is enabled', 'True if seam bridging is enabled to prevent holes between faces.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.readParams(b).bridgeSeams;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Geometry Budget' }
  ),
  displacedFn('IsAutoTiling', 'Auto tiling is enabled', '_PARAM0_ auto tiling is enabled', 'True if auto tiling is enabled.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.readParams(b).autoTiling;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Pattern Displacement' }
  ),
  displacedFn('HasPendingRebuild', 'Has pending rebuild', '_PARAM0_ has pending rebuild', 'True if properties changed and rebuild has not yet executed.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).hasPendingRebuild;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsBudgetExceeded', 'Vertex budget is exceeded', '_PARAM0_ vertex budget is exceeded', 'True if subdivision exceeds MaxVerticesPerObject budget.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).isBudgetExceeded;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('HasUnsupportedMeshes', 'Has unsupported meshes', '_PARAM0_ has unsupported meshes', 'True if any child mesh was skipped (e.g. skinned or missing attributes).', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).hasUnsupportedMeshes;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('State', 'Displaced mesh state', '', 'Current behavior lifecycle state.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="Uninitialized";if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).state;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('LastError', 'Displaced mesh last error', '', 'Last diagnostic error message.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="";if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).error;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('Seed', 'Displacement seed', '', 'Current stable displacement seed.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).seed;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('Subdivision', 'Cube subdivision', '', 'Configured subdivision segments per cube face.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).subdivision;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('AffectedMeshCount', 'Affected mesh count', '', 'Number of meshes currently deformed.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).affectedMeshCount;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('SkippedMeshCount', 'Skipped mesh count', '', 'Number of unsupported meshes skipped.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).skippedMeshCount;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('VertexCount', 'Total displaced vertices', '', 'Total vertices across affected meshes.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).vertexCount;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('TriangleCount', 'Total displaced triangles', '', 'Total triangles across affected meshes.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).triangleCount;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('EstimatedGeometryBytes', 'Estimated geometry bytes', '', 'Estimated buffer byte size of working geometries.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).estimatedBytes;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('GeometryRebuildCount', 'Geometry rebuild count', '', 'Number of geometry rebuild attempts for this behavior instance.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).rebuildCount;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('LastRebuildMilliseconds', 'Last rebuild milliseconds', '', 'Measured duration of the last successful geometry rebuild.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).lastRebuildMilliseconds;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('SetTextureAnisotropy', 'Set texture anisotropy', 'Set _PARAM0_ texture anisotropy to _PARAM2_', 'Set maximum texture anisotropy level (e.g. 16, 8, 4, 2, 1).', 'Action',
    [num('Value', 'Anisotropy level (1 to 16)', '16')],
    `if(!${DISPLACED_NS})return;var o=eventsFunctionContext.getObjects("Object"),n=eventsFunctionContext.getBehaviorName("Behavior");for(var i=0;i<o.length;i++){var b=o[i].getBehavior(n);if(b){if(b._setAnisotropicFiltering)b._setAnisotropicFiltering(String(eventsFunctionContext.getArgument("Value")));${DISPLACED_NS}.sync(b,o[i]);}}\n`,
    { group: 'General' }
  ),
  displacedFn('AnisotropicFiltering', 'Anisotropic filtering mode', '', 'Active anisotropic filtering mode.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="16x";if(o.length){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b&&b._getAnisotropicFiltering)r=String(b._getAnisotropicFiltering());}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('TextureAnisotropy', 'Texture anisotropy', '', 'Current resolved texture anisotropy level (1 to 16).', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=1;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)r=gdjs.__materialController3D.getObjectAnisotropy(root);}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsAnisotropicFilteringEnabled', 'Anisotropic filtering is enabled', '_PARAM0_ anisotropic filtering is enabled', 'Whether anisotropic filtering is active (anisotropy > 1).', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&gdjs.__materialController3D){var root=o[0].get3DRendererObject?o[0].get3DRendererObject():null;if(root)r=gdjs.__materialController3D.getObjectAnisotropy(root)>1;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsDirectPatternUsed', 'Direct pattern is enabled', '_PARAM0_ direct pattern is enabled', 'True if direct pattern properties drive displacement.', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=!!${DISPLACED_NS}.readParams(b).useDirectPattern;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Pattern Displacement' }
  ),
  displacedFn('PatternTiltStrength', 'Pattern tilt strength', '', 'Current pattern tilt strength.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).patternTiltStrength;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('UVRepairCount', 'UV repair count', '', 'How many times the engine 24-vertex Cube3D UV remap had to be undone on this object. Rises when the object is resized or a face texture changes; a texture tear you can see means this is not rising.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).uvRepairCount||0;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
  displacedFn('IsBlendingNeighbors', 'Blending with neighbours', '_PARAM0_ is blending with neighbours', 'True only when blending is on AND at least one matching neighbour was actually found. Use this rather than the property to tell "switched on" from "working".', 'Condition', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=false;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));r=!!b&&${DISPLACED_NS}.stateOf(b).blendNeighborCount>0;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Neighbour Blending' }
  ),
  displacedFn('BlendNeighborCount', 'Blended neighbour count', '', 'How many neighbouring objects the last rebuild blended this one into.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.stateOf(b).blendNeighborCount||0;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Neighbour Blending' }
  ),
  displacedFn('BlendParticipantCount', 'Blend participant count', '', 'Total objects currently published to the scene-wide blend registry.', 'Expression', [],
    `var r=0;if(gdjs.__meshBlend3D)r=gdjs.__meshBlend3D.count();eventsFunctionContext.returnValue=r;\n`,
    { group: 'Neighbour Blending' }
  ),
  displacedFn('RecommendedBlendRadius', 'Recommended blend radius', '', 'A blend radius that reads well for this object, in whatever unit mode is active. Use it as a starting value.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0.25;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){var p=${DISPLACED_NS}.readParams(b);if(p.useRelativeUnits)r=0.25;else{var w=o[0].getWidth?o[0].getWidth():1,h=o[0].getHeight?o[0].getHeight():1,d=o[0].getDepth?o[0].getDepth():1;r=0.25*Math.min(w,Math.min(h,d));}}}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Neighbour Blending' }
  ),
  displacedFn('RecommendedEdgeSealWidth', 'Recommended edge seal width', '', 'The narrowest seal that still closes the gap between packed blocks: a little over one subdivision grid step. Wider only trims more relief off the face.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0.15;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b){var seg=${DISPLACED_NS}.readParams(b).subdivision;if(seg>0)r=Math.min(0.5,1.1/seg);}}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Surface Expansion' }
  ),
  displacedFn('Inflate', 'Inflate amount', '', 'Current inflate amount.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=0;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).inflate;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Surface Expansion' }
  ),
  displacedFn('BlendGroup', 'Blend group', '', 'Current blend group. Empty blends with any participating neighbour.', 'StringExpression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r="";if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).blendGroup;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Neighbour Blending' }
  ),
  displacedFn('BrickAspectRatio', 'Brick aspect ratio', '', 'Current brick aspect ratio.', 'Expression', [],
    `var o=eventsFunctionContext.getObjects("Object"),r=2.85;if(o.length&&${DISPLACED_NS}){var b=o[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));if(b)r=${DISPLACED_NS}.readParams(b).brickAspectRatio;}eventsFunctionContext.returnValue=r;\n`,
    { group: 'Diagnostics' }
  ),
];

const dProp = (name, type, label, value, group = 'General', extra = {}) =>
  brdfProp(name, type, label, label, value, { group, ...extra });

const displacedBehavior = {
  name: DISPLACED_BEHAVIOR_NAME,
  fullName: 'Displaced Mesh 3D',
  description: 'Physical mesh displacement, cube subdivision, pattern relief and geological surface weathering.',
  objectType: '',
  propertyDescriptors: [
    dProp('DisplacementMode', 'Choice', 'Displacement mode', 'Hybrid', 'Displacement & Mode', { extraInformation: DISPLACEMENT_MODES }),
    dProp('Enabled', 'Boolean', 'Enabled', 'true', 'Displacement & Mode'),

    dProp('SubdivideCubes', 'Boolean', 'Subdivide cubes', 'true', 'Geometry Budget'),
    dProp('Subdivision', 'Number', 'Subdivision', '12', 'Geometry Budget'),
    dProp('MaxVerticesPerObject', 'Number', 'Max vertices per object', '20000', 'Geometry Budget'),
    dProp('PreserveSharpEdges', 'Boolean', 'Preserve sharp edges', 'true', 'Geometry Budget'),
    dProp('BridgeSeams', 'Boolean', 'Bridge seams', 'true', 'Geometry Budget'),

    // Inflate and Blend radius are fractions of the object's smallest world dimension while
    // "Use relative units" is on, so one value reads the same on a 1-unit and a 500-unit cube.
    // Turn it off to author both in raw world units instead.
    dProp('UseRelativeUnits', 'Boolean', 'Use relative units', 'true', 'Surface Expansion'),
    dProp('Inflate', 'Number', 'Inflate', '0', 'Surface Expansion'),
    dProp('EdgeSeal', 'Number', 'Edge seal', '0', 'Surface Expansion'),
    dProp('EdgeSealWidth', 'Number', 'Edge seal width', '0.15', 'Surface Expansion'),

    dProp('BlendNeighbors', 'Boolean', 'Blend with neighbours', 'false', 'Neighbour Blending'),
    dProp('BlendGroup', 'String', 'Blend group', '', 'Neighbour Blending'),
    dProp('BlendRadius', 'Number', 'Blend radius', '0.25', 'Neighbour Blending'),
    dProp('BlendCornerRadius', 'Number', 'Blend corner radius', '0.15', 'Neighbour Blending'),

    dProp('AutoTiling', 'Boolean', 'Auto tiling', 'true', 'Pattern Displacement'),
    dProp('PatternDepth', 'Number', 'Pattern depth', '0.08', 'Pattern Displacement'),
    dProp('PatternRaise', 'Number', 'Pattern raise', '0.02', 'Pattern Displacement'),
    dProp('PatternBevel', 'Number', 'Pattern bevel', '0.5', 'Pattern Displacement'),
    dProp('PatternHeightVariance', 'Number', 'Pattern height variance', '0.25', 'Pattern Displacement'),
    dProp('PatternSurfaceNoise', 'Number', 'Pattern surface noise', '0.15', 'Pattern Displacement'),
    dProp('UseDirectPattern', 'Boolean', 'Use direct pattern', 'false', 'Pattern Displacement'),
    dProp('PatternType', 'Choice', 'Pattern type', 'Brick', 'Pattern Displacement', { extraInformation: PATTERN_TYPES }),
    dProp('ScaleX', 'Number', 'Scale X', '8', 'Pattern Displacement'),
    dProp('ScaleY', 'Number', 'Scale Y', '8', 'Pattern Displacement'),
    dProp('GapWidth', 'Number', 'Gap width', '0.06', 'Pattern Displacement'),
    dProp('EdgeSoftness', 'Number', 'Edge softness', '0.02', 'Pattern Displacement'),
    dProp('PatternTiltStrength', 'Number', 'Pattern tilt strength', '0.15', 'Pattern Displacement'),
    dProp('BrickAspectRatio', 'Number', 'Brick aspect ratio', '2.85', 'Pattern Displacement'),

    dProp('RoughnessStrength', 'Number', 'Roughness strength', '0.15', 'Geological Displacement'),
    dProp('NoiseFrequency', 'Number', 'Noise frequency', '2', 'Geological Displacement'),
    dProp('NoiseOctaves', 'Number', 'Noise octaves', '4', 'Geological Displacement'),
    dProp('NoisePersistence', 'Number', 'Noise persistence', '0.5', 'Geological Displacement'),
    dProp('NoiseLacunarity', 'Number', 'Noise lacunarity', '2', 'Geological Displacement'),
    dProp('TerraceLayers', 'Number', 'Terrace layers', '4', 'Geological Displacement'),
    dProp('TerraceSharpness', 'Number', 'Terrace sharpness', '0.6', 'Geological Displacement'),
    dProp('CornerErosion', 'Number', 'Corner erosion', '0.35', 'Geological Displacement'),
    dProp('MicroPitting', 'Number', 'Micro pitting', '0.05', 'Geological Displacement'),
    dProp('CreviceShading', 'Number', 'Crevice shading', '0.5', 'Crevice Shading'),

    dProp('UpdateMode', 'Choice', 'Update mode', 'On creation', 'General', { extraInformation: DISPLACED_UPDATE_MODES }),
    dProp('IncludeChildren', 'Boolean', 'Include children', 'true', 'General'),
    dProp('Seed', 'Number', 'Seed', '1', 'General'),
    dProp('AnisotropicFiltering', 'Choice', 'Anisotropic filtering', '16x', 'General', { extraInformation: ANISOTROPY_MODES }),
  ],
  eventsFunctions: displacedFunctions,
};

const behavior = {
  name: BEHAVIOR_NAME,
  fullName: 'Material 3D Core',
  description:
    'The sole material owner for the Material 3D behavior family: targeting, common PBR maps and fields, render state, restoration and diagnostics.',
  objectType: '',
  propertyDescriptors: coreProperties,
  eventsFunctions: coreFunctions,
};

/* ================================================================= Extension manifest */

const extension = {
  author: 'Christopher Monhollen (Twillion)',
  category: '3D',
  extensionNamespace: '',
  fullName: 'Material 3D',
  name: EXTENSION_NAME,
  version: '4.0.0',
  shortDescription:
    'Composable 3D material behaviors for PBR maps, physical surfaces, animation, procedural patterns, wetness and custom lighting.',
  description: `**Material3D v4** is a family of focused, composable behaviors for GDevelop 3D objects.

### What it does
- **Material 3D Core** exclusively owns targeting, material lifetime, common PBR maps and render state.
- **Physical Material 3D** adds glass, clearcoat, sheen, iridescence and anisotropy.
- **Animated Material 3D** adds UV transforms, scrolling, flipbooks and video.
- **Tiled Custom Pattern Material 3D** synthesizes repeated shapes, seeded noise, colour, roughness and metalness.
- **Wet Material 3D** adds configurable non-compounding wetness.
- **BRDF Material** swaps the diffuse lighting model through the shared shader chain.
- **Displaced Mesh 3D** creates physical vertex deformation, cube face subdivision, pattern relief and geological weathering.

Contributors attach to Core's exact selected material slots and never replace materials.

### Defaults changed from the extensions this replaces
**Alpha Mode** and **Rendered Side** now default to **Preserve**. Previously attaching the behavior silently flattened transparency on models that shipped with it.`,
  helpPath: '',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  tags: [
    '3D', 'material', 'PBR', 'shader', 'Three.js', 'roughness', 'metalness',
    'emissive', 'transmission', 'clearcoat', 'glass', 'texture', 'UV', 'scroll',
    'flipbook', 'video', 'normal map', 'procedural', 'pattern', 'noise',
    'displacement', 'weathering', 'geometry', 'erosion',
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
  eventsBasedBehaviors: [behavior, physicalBehavior, animatedBehavior, patternBehavior, wetBehavior, brdfBehavior, displacedBehavior],
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

checkControlChars(rawRuntime, 'MaterialMaster.runtime.js');
checkControlChars(rawBrdfRuntime, 'BRDFMaterial.runtime.js');
checkControlChars(rawChainRuntime, 'ShaderChain.runtime.js');
checkControlChars(rawControllerRuntime, 'MaterialController3D.runtime.js');
checkControlChars(rawPhysicalRuntime, 'PhysicalMaterial3D.runtime.js');
checkControlChars(rawWetRuntime, 'WetMaterial3D.runtime.js');
checkControlChars(rawAnimatedRuntime, 'AnimatedMaterial3D.runtime.js');
checkControlChars(rawPatternRuntime, 'PatternMaterial3D.runtime.js');
checkControlChars(rawPatternMathRuntime, 'PatternMath3D.runtime.js');
checkControlChars(rawGeometryControllerRuntime, 'GeometryController3D.runtime.js');
checkControlChars(rawMeshBlendRuntime, 'MeshBlend3D.runtime.js');
checkControlChars(rawDisplacedRuntime, 'DisplacedMesh3D.runtime.js');

/* The house rule the shader chain depends on: onBeforeCompile is ONE function property, so any
 * runtime that assigns it directly silently disables every other injector on that material — and
 * gets silently disabled by the next one to try. Only ShaderChain.runtime.js may own it.
 * This is the cheapest possible guard against re-introducing that bug in a future module. */
for (const [src, name] of [[rawRuntime, 'MaterialMaster.runtime.js'], [rawPhysicalRuntime, 'PhysicalMaterial3D.runtime.js'], [rawAnimatedRuntime, 'AnimatedMaterial3D.runtime.js'], [rawPatternRuntime, 'PatternMaterial3D.runtime.js'], [rawWetRuntime, 'WetMaterial3D.runtime.js'], [rawBrdfRuntime, 'BRDFMaterial.runtime.js']]) {
  const offenders = [...src.matchAll(/^(?!\s*(?:\/\/|\*)).*\.onBeforeCompile\s*=/gm)];
  if (offenders.length) {
    const line = src.slice(0, offenders[0].index).split('\n').length;
    console.error(
      `\n${name}:${line} assigns onBeforeCompile directly.\n` +
      `Only ShaderChain.runtime.js may own that hook — register an injector instead, or every\n` +
      `other injector on the material stops working with no error. See ShaderChain.runtime.js.\n`
    );
    process.exit(1);
  }
}

/* Each injector names the Three.js shader chunk it edits. Two injectors editing the same chunk is
 * allowed but must be deliberate, so the declared chunks are surfaced at build time rather than
 * discovered when two modules quietly fight over one region of the fragment shader. */
const declaredChunks = [...rawRuntime.matchAll(/id:\s*'([^']+)',\s*\n?\s*chunk:\s*'([^']+)'/g),
                        ...rawBrdfRuntime.matchAll(/id:\s*'([^']+)',\s*\n?\s*chunk:\s*'([^']+)'/g)]
  .map((m) => ({ id: m[1], chunk: m[2] }));
const byChunk = {};
for (const d of declaredChunks) (byChunk[d.chunk] ||= []).push(d.id);
const contested = Object.entries(byChunk).filter(([, ids]) => ids.length > 1);
if (contested.length) {
  console.log('\nNote: shader chunks claimed by more than one injector —');
  for (const [chunk, ids] of contested) console.log(`  ${chunk}: ${ids.join(', ')}`);
  console.log('  Confirm their declared order makes the interaction deliberate.\n');
}

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
walkEvents(physicalBehavior.eventsFunctions, physicalBehavior.name);
walkEvents(wetBehavior.eventsFunctions, wetBehavior.name);
walkEvents(animatedBehavior.eventsFunctions, animatedBehavior.name);
walkEvents(patternBehavior.eventsFunctions, patternBehavior.name);
walkEvents(brdfBehavior.eventsFunctions, brdfBehavior.name);
walkEvents(displacedBehavior.eventsFunctions, displacedBehavior.name);
walkEvents(extension.eventsFunctions, 'extension.eventsFunctions');

/* A condition that uses a bare `return` silently evaluates to false — the value is discarded. */
for (const f of [...behavior.eventsFunctions, ...physicalBehavior.eventsFunctions, ...animatedBehavior.eventsFunctions, ...patternBehavior.eventsFunctions, ...wetBehavior.eventsFunctions, ...brdfBehavior.eventsFunctions, ...displacedBehavior.eventsFunctions]) {
  if (f.functionType !== 'Condition') continue;
  const code = f.events[0].inlineCode;
  if (!code.includes('eventsFunctionContext.returnValue')) {
    console.error(`\nCondition ${f.name} never assigns eventsFunctionContext.returnValue.\n`);
    process.exit(1);
  }
}

/* Every property named by a Set<Name> action must actually exist, or the override writes into
 * a field nothing reads and the action appears to do nothing. */
const propNames = new Set(coreProperties.map((p) => p.name));
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
for (const [bh, expectedType] of [[behavior, BEHAVIOR_TYPE], [physicalBehavior, PHYSICAL_BEHAVIOR_TYPE], [animatedBehavior, ANIMATED_BEHAVIOR_TYPE], [patternBehavior, PATTERN_BEHAVIOR_TYPE], [wetBehavior, WET_BEHAVIOR_TYPE], [brdfBehavior, BRDF_BEHAVIOR_TYPE], [displacedBehavior, DISPLACED_BEHAVIOR_TYPE]]) {
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

for (const bh of [behavior, physicalBehavior, animatedBehavior, patternBehavior, wetBehavior, brdfBehavior, displacedBehavior]) {
  const dupes = bh.eventsFunctions.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) {
    console.error(`\nDuplicate function names in ${bh.name}: ${[...new Set(dupes)].join(', ')}\n`);
    process.exit(1);
  }
}

// Contributor behavior runtimes may modify material fields but must not take ownership by assigning
// mesh.material. Only the current Core runtime is allowed to do that during the split.
for (const [src, name] of [[rawPhysicalRuntime, 'PhysicalMaterial3D.runtime.js'], [rawAnimatedRuntime, 'AnimatedMaterial3D.runtime.js'], [rawPatternRuntime, 'PatternMaterial3D.runtime.js'], [rawWetRuntime, 'WetMaterial3D.runtime.js'], [rawDisplacedRuntime, 'DisplacedMesh3D.runtime.js']]) {
  if (/\.material\s*=/.test(src)) {
    console.error(`\n${name} assigns .material directly. Contributor behaviors must use MaterialController3D.\n`);
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
const allowedShared = new Set(['Roughness', 'AnisotropicFiltering', 'TargetMode', 'MaterialIndex', 'MaterialName', 'MeshName']);
const isExpectedShared = sharedProps.length === allowedShared.size && sharedProps.every((n) => allowedShared.has(n));
if (!isExpectedShared) {
  console.error(
    `\nBehaviors now share these property names: ${sharedProps.join(', ') || '(none)'}.\n` +
    `Only "Roughness", "AnisotropicFiltering", "TargetMode", "MaterialIndex", "MaterialName", "MeshName" are known, intentional overlaps. Confirm the new one before shipping.\n`
  );
  process.exit(1);
}

const out = path.join(here, 'MaterialMaster.json');
fs.writeFileSync(out, json, 'utf8');

const brdfCounts = brdfBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const physicalCounts = physicalBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const wetCounts = wetBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const animatedCounts = animatedBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const patternCounts = patternBehavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const displacedCounts = displacedBehavior.eventsFunctions.reduce((acc, f) => {
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
console.log(` MaterialCore3D:     ${coreProperties.length} props, ${JSON.stringify(counts)}`);
console.log(` PhysicalMaterial3D: ${physicalBehavior.propertyDescriptors.length} props, ${JSON.stringify(physicalCounts)}`);
console.log(` WetMaterial3D:      ${wetBehavior.propertyDescriptors.length} props, ${JSON.stringify(wetCounts)}`);
console.log(` AnimatedMaterial3D: ${animatedBehavior.propertyDescriptors.length} props, ${JSON.stringify(animatedCounts)}`);
console.log(` TiledCustomPattern: ${patternBehavior.propertyDescriptors.length} props, ${JSON.stringify(patternCounts)}`);
console.log(` BRDFMaterial:       ${brdfBehavior.propertyDescriptors.length} props, ${JSON.stringify(brdfCounts)}`);
console.log(` DisplacedMesh3D:    ${displacedBehavior.propertyDescriptors.length} props, ${JSON.stringify(displacedCounts)}`);
console.log(`========================================\n`);
