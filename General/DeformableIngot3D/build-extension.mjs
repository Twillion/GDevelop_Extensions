/**
 * build-extension.mjs
 * Compiles DeformableIngot3D.json manifest for GDevelop 5.
 *
 * Run: node DeformableIngot3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'DeformableIngot3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const OBJ_PARAM = [
  {
    name: 'Object',
    type: 'object',
    description: '3D Deformable Ingot',
    supplementaryInformation: 'DeformableIngot3D::DeformableIngot3D',
  },
];

const num = (name, description, value = '') => ({
  name,
  type: 'expression',
  description,
  ...(value ? { defaultValue: value } : {}),
});
const str = (name, description, value = '') => ({
  name,
  type: 'string',
  description,
  ...(value ? { defaultValue: value } : {}),
});
const bool = (name, description) => ({ name, type: 'yesorno', description });
const col = (name, description, value = '') => ({
  name,
  type: 'color',
  description,
  ...(value ? { defaultValue: value } : {}),
});
const choice = (name, description, options) => ({
  name,
  type: 'stringWithSelector',
  description,
  supplementaryInformation: JSON.stringify(options),
});

const prop = (name, type, label, description, value, group = 'General', extraInformation = []) => ({
  name,
  type,
  value,
  label,
  description,
  group,
  ...(extraInformation && extraInformation.length > 0 ? { extraInformation } : {}),
});

const ev = (inlineCode, { withRuntime = false, parameterObjects = 'Object' } = {}) => [
  {
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
    parameterObjects,
    useStrict: true,
    eventsSheetExpanded: true,
  },
];

const OBJECT_PREAMBLE = `const object = objects[0];
if (!object) return;
`;

const objFn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OBJ_PARAM, ...parameters],
  events: ev(OBJECT_PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: { type: opts.expressionType } } : {}),
});

/* ========================================================= Groups */
const G_RAYCAST = 'Camera & Raycast Vertex Detection';
const G_DEFORM = 'Deformation & Hammering';
const G_REMESH = 'Dynamic Remeshing';
const G_THERMAL = 'Thermal & Blacksmithing';
const G_APPEARANCE = 'Appearance & Shading';

/* ========================================================= Custom Object Properties */
const customObjectProperties = [
  prop('SubdivisionsX', 'Number', 'Subdivisions along X', 'Grid resolution along width (X-axis)', '16', G_REMESH),
  prop('SubdivisionsY', 'Number', 'Subdivisions along Y', 'Grid resolution along height/depth (Y-axis)', '8', G_REMESH),
  prop('SubdivisionsZ', 'Number', 'Subdivisions along Z', 'Grid resolution along thickness (Z-axis)', '8', G_REMESH),
  prop('Tint', 'Color', 'Base Metal Color', 'RGB tint for the ingot surface', '200;200;210', G_APPEARANCE),
  prop('Metalness', 'Number', 'Metalness', 'PBR Metalness factor (0.0 - 1.0)', '0.85', G_APPEARANCE),
  prop('Roughness', 'Number', 'Roughness', 'PBR Roughness factor (0.0 - 1.0)', '0.35', G_APPEARANCE),
  prop('EnableThermal', 'Boolean', 'Enable Thermal Simulation', 'Track vertex temperature and heat glow', 'true', G_THERMAL),
  prop('InitialTemperature', 'Number', 'Initial Temperature (°C)', 'Starting ambient temperature in Celsius', '20.0', G_THERMAL),
  prop('AmbientTemperature', 'Number', 'Ambient Temperature (°C)', 'Temperature approached during passive cooling', '20.0', G_THERMAL),
  prop('HeatDiffusion', 'Number', 'Heat Diffusion', 'Rate at which heat equalizes across welded surface vertices', '1.5', G_THERMAL),
  prop('AirCooling', 'Number', 'Air Cooling', 'Passive cooling coefficient per second', '0.08', G_THERMAL),
  prop('ForgingTemperature', 'Number', 'Minimum Forging Temperature (°C)', 'Metal below this temperature resists forge strikes', '650', G_THERMAL),
  prop('IdealForgingTemperature', 'Number', 'Ideal Forging Temperature (°C)', 'Temperature at which full plasticity is reached', '950', G_THERMAL),
  prop('AnvilEnabled', 'Boolean', 'Enable Anvil Constraint', 'Prevent the workpiece from passing below the local anvil plane', 'true', G_DEFORM),
  prop('AnvilLocalZ', 'Number', 'Anvil Local Z', 'Normalized local Z position of the anvil plane', '-0.5', G_DEFORM),
];

/* ========================================================= Actions, Conditions, Expressions */
const functions = [];

// 1. Raycast & Screen Pointer Deformation Actions
functions.push(
  objFn(
    'DeformAtScreenPoint',
    'Deform mesh at screen pointer',
    'Deform _PARAM0_ at screen pointer (_PARAM1_, _PARAM2_) on layer _PARAM3_ (Brush: _PARAM4_, Radius: _PARAM5_, Strength: _PARAM6_, Falloff: _PARAM7_)',
    'Uses camera raycasting from screen coordinates to detect hit vertices on the 3D ingot and apply deformation (Push, Pull, HammerBlow, Smooth, Flatten).',
    'Action',
    [
      num('ScreenX', 'Screen X position in pixels', 'MouseX()'),
      num('ScreenY', 'Screen Y position in pixels', 'MouseY()'),
      str('Layer', 'Layer containing the 3D camera', '""'),
      choice('BrushType', 'Deformation brush type', ['Push', 'Pull', 'HammerBlow', 'Flatten']),
      num('Radius', 'Deformation radius in world units', '25'),
      num('Strength', 'Deformation depth/force in world units', '5'),
      choice('Falloff', 'Falloff curve', ['Smoothstep', 'Gaussian', 'Linear', 'Sharp']),
    ],
    `object.deformAtScreenPoint(
      eventsFunctionContext.getArgument("ScreenX"),
      eventsFunctionContext.getArgument("ScreenY"),
      eventsFunctionContext.getArgument("Layer"),
      eventsFunctionContext.getArgument("BrushType"),
      eventsFunctionContext.getArgument("Radius"),
      eventsFunctionContext.getArgument("Strength"),
      eventsFunctionContext.getArgument("Falloff")
    );`,
    { group: G_RAYCAST, withRuntime: true }
  )
);

functions.push(
  objFn(
    'DeformAtWorldRay',
    'Deform mesh along 3D ray',
    'Deform _PARAM0_ along ray from (_PARAM1_, _PARAM2_, _PARAM3_) in dir (_PARAM4_, _PARAM5_, _PARAM6_) (Brush: _PARAM7_, Radius: _PARAM8_, Strength: _PARAM9_, Falloff: _PARAM10_)',
    'Casts a 3D ray from world origin/direction to intersect the mesh and apply deformation.',
    'Action',
    [
      num('OriginX', 'Ray origin X'),
      num('OriginY', 'Ray origin Y'),
      num('OriginZ', 'Ray origin Z'),
      num('DirX', 'Ray direction X'),
      num('DirY', 'Ray direction Y'),
      num('DirZ', 'Ray direction Z'),
      choice('BrushType', 'Deformation brush type', ['Push', 'Pull', 'HammerBlow', 'Flatten']),
      num('Radius', 'Deformation radius in world units', '25'),
      num('Strength', 'Deformation strength', '5'),
      choice('Falloff', 'Falloff curve', ['Smoothstep', 'Gaussian', 'Linear', 'Sharp']),
    ],
    `object.deformAtWorldRay(
      eventsFunctionContext.getArgument("OriginX"),
      eventsFunctionContext.getArgument("OriginY"),
      eventsFunctionContext.getArgument("OriginZ"),
      eventsFunctionContext.getArgument("DirX"),
      eventsFunctionContext.getArgument("DirY"),
      eventsFunctionContext.getArgument("DirZ"),
      eventsFunctionContext.getArgument("BrushType"),
      eventsFunctionContext.getArgument("Radius"),
      eventsFunctionContext.getArgument("Strength"),
      eventsFunctionContext.getArgument("Falloff")
    );`,
    { group: G_RAYCAST, withRuntime: true }
  )
);

functions.push(
  objFn(
    'RaycastFromScreen',
    'Cast ray from screen pointer',
    'Raycast from screen point (_PARAM1_, _PARAM2_) on layer _PARAM3_ against _PARAM0_',
    'Casts a ray from screen coordinates through the 3D camera to test intersection and cache hit coordinates.',
    'Action',
    [
      num('ScreenX', 'Screen X position in pixels', 'MouseX()'),
      num('ScreenY', 'Screen Y position in pixels', 'MouseY()'),
      str('Layer', 'Target layer', '""'),
    ],
    `object.raycastFromCamera(
      eventsFunctionContext.getArgument("ScreenX"),
      eventsFunctionContext.getArgument("ScreenY"),
      eventsFunctionContext.getArgument("Layer")
    );`,
    { group: G_RAYCAST, withRuntime: true }
  )
);

// Raycast Conditions & Expressions
functions.push(
  objFn(
    'HasRaycastHit',
    'Has raycast hit',
    '_PARAM0_ has a valid raycast hit',
    'Returns true if the last raycast intersected this 3D mesh.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = !!object.hasRaycastHit();`,
    { group: G_RAYCAST }
  )
);

functions.push(
  objFn(
    'RaycastHitX',
    'Raycast hit X position',
    'the last raycast hit X position on _PARAM0_',
    'Returns the world X position of the last raycast intersection.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitX();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'RaycastHitY',
    'Raycast hit Y position',
    'the last raycast hit Y position on _PARAM0_',
    'Returns the world Y position of the last raycast intersection.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitY();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'RaycastHitZ',
    'Raycast hit Z position',
    'the last raycast hit Z position on _PARAM0_',
    'Returns the world Z position of the last raycast intersection.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitZ();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'RaycastHitNormalX',
    'Raycast hit normal X',
    'the last raycast hit normal X on _PARAM0_',
    'Returns the world surface normal X at the hit point.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitNormalX();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'RaycastHitNormalY',
    'Raycast hit normal Y',
    'the last raycast hit normal Y on _PARAM0_',
    'Returns the world surface normal Y at the hit point.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitNormalY();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'RaycastHitNormalZ',
    'Raycast hit normal Z',
    'the last raycast hit normal Z on _PARAM0_',
    'Returns the world surface normal Z at the hit point.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getRaycastHitNormalZ();`,
    { group: G_RAYCAST, expressionType: 'number' }
  )
);

// 2. Remeshing & Reset Actions
functions.push(
  objFn(
    'SetSubdivisions',
    'Set subdivisions / Remesh on the fly',
    'Remesh _PARAM0_ with subdivisions (_PARAM1_, _PARAM2_, _PARAM3_) (Preserve deformation: _PARAM4_)',
    'Dynamically tessellates or coarsens the 3D mesh on the fly. When preserve is true, existing surface offsets are retained.',
    'Action',
    [
      num('SubX', 'Subdivisions along width (X)', '16'),
      num('SubY', 'Subdivisions along height (Y)', '8'),
      num('SubZ', 'Subdivisions along depth (Z)', '8'),
      bool('Preserve', 'Preserve existing deformation'),
    ],
    `object.setSubdivisions(
      eventsFunctionContext.getArgument("SubX"),
      eventsFunctionContext.getArgument("SubY"),
      eventsFunctionContext.getArgument("SubZ"),
      eventsFunctionContext.getArgument("Preserve")
    );`,
    { group: G_REMESH, withRuntime: true }
  )
);

functions.push(
  objFn(
    'ResetDeformation',
    'Reset mesh deformation',
    'Reset _PARAM0_ to original un-deformed ingot shape',
    'Restores the pristine un-deformed geometry.',
    'Action',
    [],
    `object.resetDeformation();`,
    { group: G_DEFORM }
  )
);

functions.push(
  objFn(
    'SmoothRegion',
    'Smooth mesh region',
    'Smooth _PARAM0_ at local point (_PARAM1_, _PARAM2_, _PARAM3_) with radius _PARAM4_ (Strength: _PARAM5_, Iterations: _PARAM6_)',
    'Applies Laplacian relaxation across vertices in the specified radius.',
    'Action',
    [
      num('CenterX', 'Local center X'),
      num('CenterY', 'Local center Y'),
      num('CenterZ', 'Local center Z'),
      num('Radius', 'Smoothing radius', '20'),
      num('Strength', 'Smoothing strength (0.0 - 1.0)', '0.5'),
      num('Iterations', 'Iteration count (1 - 5)', '2'),
    ],
    `object.smoothRegion(
      eventsFunctionContext.getArgument("CenterX"),
      eventsFunctionContext.getArgument("CenterY"),
      eventsFunctionContext.getArgument("CenterZ"),
      eventsFunctionContext.getArgument("Radius"),
      eventsFunctionContext.getArgument("Strength"),
      eventsFunctionContext.getArgument("Iterations")
    );`,
    { group: G_DEFORM }
  )
);

// Remesh Expressions
functions.push(
  objFn(
    'VertexCount',
    'Total vertex count',
    'the total vertex count of _PARAM0_',
    'Returns the number of vertices in the procedural 3D mesh.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getVertexCount();`,
    { group: G_REMESH, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'TriangleCount',
    'Total triangle count',
    'the total triangle count of _PARAM0_',
    'Returns the number of triangles in the procedural 3D mesh.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getTriangleCount();`,
    { group: G_REMESH, expressionType: 'number' }
  )
);

functions.push(
  objFn(
    'IsDeformed',
    'Is mesh deformed',
    '_PARAM0_ has been modified / deformed',
    'Returns true if the mesh differs from its pristine un-deformed state.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = !!object.isDeformed();`,
    { group: G_DEFORM }
  )
);

// 3. Thermal Blacksmithing
functions.push(
  objFn(
    'ForgeAtCameraOffset',
    'Forge from camera center',
    'Strike _PARAM0_ from camera center offset (_PARAM1_, _PARAM2_) on layer _PARAM3_ (Face radius: _PARAM4_, Impact velocity: _PARAM5_)',
    'Raycasts from the center of the camera with a pixel offset, then applies a temperature-aware hammer strike. The visible hammer can be any separate 3D object.',
    'Action',
    [
      num('OffsetX', 'Horizontal offset from camera center in pixels', '0'),
      num('OffsetY', 'Vertical offset from camera center in pixels', '0'),
      str('Layer', 'Layer containing the 3D camera', '""'),
      num('FaceRadius', 'Hammer face radius in world units', '20'),
      num('ImpactVelocity', 'Hammer impact velocity in world units per second', '300'),
    ],
    `object.forgeAtCameraOffset(
      eventsFunctionContext.getArgument("OffsetX"),
      eventsFunctionContext.getArgument("OffsetY"),
      eventsFunctionContext.getArgument("Layer"),
      eventsFunctionContext.getArgument("FaceRadius"),
      eventsFunctionContext.getArgument("ImpactVelocity")
    );`,
    { group: G_DEFORM, withRuntime: true }
  )
);

functions.push({
  name: 'CombinePart',
  fullName: 'Combine part into tool or prop',
  sentence: 'Combine _PARAM1_ into _PARAM0_ at local position (_PARAM2_, _PARAM3_, _PARAM4_) and rotation (_PARAM5_, _PARAM6_, _PARAM7_)',
  description: 'Parents a second 3D object to the deformable workpiece render root to create a combined tool or prop.',
  functionType: 'Action',
  group: G_DEFORM,
  private: false,
  parameters: [
    ...OBJ_PARAM,
    { name: 'Part', type: 'object', description: '3D part to attach' },
    num('LocalX', 'Local attachment X', '0'), num('LocalY', 'Local attachment Y', '0'), num('LocalZ', 'Local attachment Z', '0'),
    num('RotationX', 'Local rotation X in degrees', '0'), num('RotationY', 'Local rotation Y in degrees', '0'), num('RotationZ', 'Local rotation Z in degrees', '0'),
  ],
  events: ev(`${OBJECT_PREAMBLE}const part = objects[1];
if (!part) return;
object.combinePart(part,
  eventsFunctionContext.getArgument("LocalX"), eventsFunctionContext.getArgument("LocalY"), eventsFunctionContext.getArgument("LocalZ"),
  eventsFunctionContext.getArgument("RotationX"), eventsFunctionContext.getArgument("RotationY"), eventsFunctionContext.getArgument("RotationZ")
);`, { withRuntime: true, parameterObjects: 'Object,Part' }),
});

functions.push(
  objFn(
    'StartPoseTween',
    'Tween assembled prop pose',
    'Tween _PARAM0_ to position (_PARAM1_, _PARAM2_, _PARAM3_) rotation (_PARAM4_, _PARAM5_, _PARAM6_) over _PARAM7_ seconds using _PARAM8_',
    'Starts a math-driven movement for an assembled tool or prop without an animation clip.',
    'Action',
    [
      num('TargetX', 'Target X'), num('TargetY', 'Target Y'), num('TargetZ', 'Target Z'),
      num('RotationX', 'Target rotation X'), num('RotationY', 'Target rotation Y'), num('Angle', 'Target Z angle'),
      num('Duration', 'Duration in seconds', '0.25'),
      choice('Easing', 'Mathematical easing curve', ['Smoothstep', 'Linear', 'EaseIn', 'EaseOut']),
    ],
    `object.startPoseTween(
      eventsFunctionContext.getArgument("TargetX"), eventsFunctionContext.getArgument("TargetY"), eventsFunctionContext.getArgument("TargetZ"),
      eventsFunctionContext.getArgument("RotationX"), eventsFunctionContext.getArgument("RotationY"), eventsFunctionContext.getArgument("Angle"),
      eventsFunctionContext.getArgument("Duration"), eventsFunctionContext.getArgument("Easing")
    );`,
    { group: G_DEFORM, withRuntime: true }
  )
);

functions.push(
  objFn(
    'StepPoseTween',
    'Advance assembled prop tween',
    'Advance the pose tween of _PARAM0_ by _PARAM1_ seconds',
    'Advances the current code-driven position and rotation tween.',
    'Action',
    [num('DeltaSeconds', 'Elapsed time in seconds', 'TimeDelta()')],
    `object.stepPoseTween(eventsFunctionContext.getArgument("DeltaSeconds"));`,
    { group: G_DEFORM }
  )
);

functions.push(
  objFn(
    'SplitMeshByPlane',
    'Break mesh along plane',
    'Split _PARAM0_ along local plane normal (_PARAM1_, _PARAM2_, _PARAM3_) at offset _PARAM4_',
    'Partitions triangles into a second render mesh. The initial MVP cut is not capped.',
    'Action',
    [
      num('NormalX', 'Local cut-plane normal X', '1'),
      num('NormalY', 'Local cut-plane normal Y', '0'),
      num('NormalZ', 'Local cut-plane normal Z', '0'),
      num('PlaneOffset', 'Plane offset in normalized local coordinates', '0'),
    ],
    `object.splitMeshByPlane(
      eventsFunctionContext.getArgument("NormalX"),
      eventsFunctionContext.getArgument("NormalY"),
      eventsFunctionContext.getArgument("NormalZ"),
      eventsFunctionContext.getArgument("PlaneOffset")
    );`,
    { group: G_DEFORM, withRuntime: true }
  )
);

functions.push(
  objFn(
    'StepThermal',
    'Advance heat simulation',
    'Advance heat diffusion and air cooling for _PARAM0_ by _PARAM1_ seconds',
    'Advances localized heat diffusion and passive cooling using an explicit frame-independent duration.',
    'Action',
    [num('DeltaSeconds', 'Elapsed time in seconds', 'TimeDelta()')],
    `object.stepThermal(eventsFunctionContext.getArgument("DeltaSeconds"));`,
    { group: G_THERMAL }
  )
);

functions.push(
  objFn(
    'HeatMeshRegion',
    'Heat mesh region in forge',
    'Heat _PARAM0_ at point (_PARAM1_, _PARAM2_, _PARAM3_) with radius _PARAM4_ (Rate: _PARAM5_ °C/s, Max: _PARAM6_ °C)',
    'Increases vertex temperature for forging.',
    'Action',
    [
      num('CenterX', 'Center X', '0'),
      num('CenterY', 'Center Y', '0'),
      num('CenterZ', 'Center Z', '0'),
      num('Radius', 'Heating radius', '50'),
      num('HeatRate', 'Heating rate in °C/sec', '150'),
      num('MaxTemp', 'Maximum temperature in °C', '1150'),
    ],
    `object.heatMeshRegion(
      eventsFunctionContext.getArgument("CenterX"),
      eventsFunctionContext.getArgument("CenterY"),
      eventsFunctionContext.getArgument("CenterZ"),
      eventsFunctionContext.getArgument("Radius"),
      eventsFunctionContext.getArgument("HeatRate"),
      eventsFunctionContext.getArgument("MaxTemp")
    );`,
    { group: G_THERMAL }
  )
);

functions.push(
  objFn(
    'QuenchMesh',
    'Quench mesh in water trough',
    'Quench _PARAM0_ in water (Cooling rate: _PARAM1_ °C/s)',
    'Cools the hot metal rapidly.',
    'Action',
    [num('CoolRate', 'Cooling rate in °C/sec', '350')],
    `object.quenchMesh(eventsFunctionContext.getArgument("CoolRate"));`,
    { group: G_THERMAL }
  )
);

functions.push(
  objFn(
    'AverageTemperature',
    'Average temperature',
    'the average temperature (°C) of _PARAM0_',
    'Returns the current metal temperature in Celsius.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = object.getAverageTemperature();`,
    { group: G_THERMAL, expressionType: 'number' }
  )
);

for (const [name, fullName, sentence, description, getter, group] of [
  ['LastStrikeEfficiency', 'Last strike efficiency', 'the last forge strike efficiency of _PARAM0_', 'Returns 0 to 1 based on heat, work hardening, and contact falloff.', 'getLastStrikeEfficiency', G_DEFORM],
  ['LastStrikeAffectedVertices', 'Last strike affected vertices', 'the vertices affected by the last forge strike on _PARAM0_', 'Returns the number of vertices plastically moved by the last forge strike.', 'getLastStrikeAffectedVertices', G_DEFORM],
  ['FragmentCount', 'Fragment count', 'the number of broken-off fragments from _PARAM0_', 'Returns the number of secondary render meshes created by fracture.', 'getFragmentCount', G_DEFORM],
  ['AssembledPartCount', 'Assembled part count', 'the number of parts combined into _PARAM0_', 'Returns the number of 3D objects attached to this tool or prop.', 'getAssembledPartCount', G_DEFORM],
  ['ShapeLength', 'Forged shape length', 'the current forged length of _PARAM0_', 'Current world-space X extent.', 'getShapeLength', G_DEFORM],
  ['ShapeWidth', 'Forged shape width', 'the current forged width of _PARAM0_', 'Current world-space Y extent.', 'getShapeWidth', G_DEFORM],
  ['ShapeThickness', 'Forged shape thickness', 'the current forged thickness of _PARAM0_', 'Current world-space Z extent.', 'getShapeThickness', G_DEFORM],
]) {
  functions.push(objFn(name, fullName, sentence, description, 'Expression', [],
    `eventsFunctionContext.returnValue = object.${getter}();`,
    { group, expressionType: 'number' }
  ));
}

functions.push(objFn(
  'IsPoseTweening', 'Is prop pose tweening', '_PARAM0_ is running a pose tween',
  'True while the code-driven position and rotation tween is active.', 'Condition', [],
  `eventsFunctionContext.returnValue = !!object.isPoseTweening();`, { group: G_DEFORM }
));

/* ========================================================= Manifest Assembly */
const manifest = {
  $schema: 'https://raw.githubusercontent.com/4ian/GDevelop/master/GDevelop.js/types/Extension.d.ts',
  name: 'DeformableIngot3D',
  version: '1.0.0',
  description:
    'Procedural Dynamic 3D Ingot / Mesh Object for GDevelop with camera raycast vertex detection, on-the-fly dynamic remeshing, real-time vertex deformation (Push, Pull, Hammer Strike, Smooth, Flatten), and thermal simulation.',
  shortDescription: 'Procedural deformable 3D ingot with on-the-fly remeshing & camera raycasting.',
  author: 'Twillion',
  tags: ['3d', 'mesh', 'procedural', 'deformation', 'smithing', 'blacksmith', 'raycast', 'hammer', 'remesh'],
  category: 'General',
  previewIconUrl: iconUrl,
  iconUrl: iconUrl,
  helpPath: '',
  allInOneScript: runtime,
  customObjectTypes: [
    {
      name: 'DeformableIngot3D',
      fullName: '3D Deformable Ingot / Mesh',
      description: 'Procedural 3D deformable ingot object with camera raycasting and on-the-fly remeshing.',
      defaultName: 'DeformableIngot3D',
      category: '3D',
      isRenderedIn3D: true,
      iconUrl: iconUrl,
      properties: customObjectProperties,
      eventsBasedBehaviors: [],
      eventsBasedObjects: [],
    },
  ],
  eventsBasedBehaviors: [],
  eventsFunctions: functions,
};

fs.writeFileSync(path.join(here, 'DeformableIngot3D.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('✅ Built DeformableIngot3D.json successfully!');
