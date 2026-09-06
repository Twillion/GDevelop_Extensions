/**
 * build-extension.mjs
 * Compiles Polygon3D.json containing the HexBipyramid3D custom 3D object.
 *
 * Run: node Polygon3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'Polygon3D.runtime.js'), 'utf8');

/* The eight honeycomb expressions are pure math and must not drag the whole
 * Three.js renderer into their inline code: that inlined ~41 KB apiece and made
 * every expression evaluation re-run the installer. Slice the grid math out of
 * the runtime instead, so there is still exactly one source of truth for it. */
const GRID_START = '/* @grid-math-start */';
const GRID_END = '/* @grid-math-end */';
const gridStart = runtime.indexOf(GRID_START);
const gridEnd = runtime.indexOf(GRID_END);
if (gridStart < 0 || gridEnd < 0) {
  throw new Error(
    'Polygon3D.runtime.js is missing the ' + GRID_START + ' / ' + GRID_END +
      ' markers around the honeycomb grid math.'
  );
}
const GRID_MATH_PRELUDE =
  'const SQRT3 = Math.sqrt(3);\nconst NS = {};\n' +
  runtime.slice(gridStart + GRID_START.length, gridEnd).trim() +
  '\n/* Prefer the installed runtime once an object has put it on gdjs, so a scene\n' +
  ' * mixing objects and bare grid expressions cannot drift apart. */\n' +
  "const Hex = (typeof gdjs !== 'undefined' && gdjs.__polygon3D && gdjs.__polygon3D.__installed)\n" +
  '  ? gdjs.__polygon3D\n' +
  '  : NS;\n';

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const OBJ_PARAM = [
  { name: 'Object', type: 'object', description: '3D Hexagonal Bipyramid', supplementaryInformation: 'Polygon3D::HexBipyramid3D' },
];
const RHOMBIC_OBJ_PARAM = [
  { name: 'Object', type: 'object', description: '3D Rhombic Dodecahedron', supplementaryInformation: 'Polygon3D::RhombicDodecahedron3D' },
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
const imageRes = (name, description, value = '') => ({
  name,
  type: 'imageResource',
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

const ev = (inlineCode, { withRuntime = false } = {}) => [
  {
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
    parameterObjects: 'Object',
    useStrict: true,
    eventsSheetExpanded: true,
  },
];

const evFree = (inlineCode, { withRuntime = false } = {}) => [
  {
    type: 'BuiltinCommonInstructions::JsCode',
    inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
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

const rhombicObjFn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...RHOMBIC_OBJ_PARAM, ...parameters],
  events: ev(OBJECT_PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: { type: opts.expressionType } } : {}),
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
  events: evFree((opts.gridMath ? GRID_MATH_PRELUDE : `if (!gdjs.__polygon3D) return;\nconst Hex = gdjs.__polygon3D;\n`) + code, opts),
  ...(opts.expressionType ? { expressionType: { type: opts.expressionType } } : {}),
});

/* ========================================================= Properties Setup */

const G_GEOM = 'Geometry';
const G_STATE = 'Slicing';
const G_CAPS = 'Top & Bottom Caps';
const G_UPPER = 'Upper Facets (Top 6)';
const G_LOWER = 'Lower Facets (Bottom 6)';
const G_CUT = 'Middle Cut Face';
const G_MAT = 'General Materials & Shading';
const G_GRID = 'Honeycomb Grid Math';

const ALL_FACE_NAMES = [
  'TopCap', 'BottomCap',
  'UpperFace0', 'UpperFace1', 'UpperFace2', 'UpperFace3', 'UpperFace4', 'UpperFace5',
  'LowerFace0', 'LowerFace1', 'LowerFace2', 'LowerFace3', 'LowerFace4', 'LowerFace5',
  'MiddleCutFace'
];

const customObjectProperties = [
  // Geometry
  prop('EquatorRadius', 'Number', 'Equator radius (Req)', 'Radius of the middle hexagonal ring at y = 0', '50', G_GEOM),
  prop('CapRadius', 'Number', 'Cap radius (Rcap)', 'Radius of the top and bottom flat hexagonal caps', '25', G_GEOM),
  prop('TotalHeight', 'Number', 'Total height (H)', 'Total vertical height of the full bipyramid block', '80', G_GEOM),

  // Slicing
  prop('BlockState', 'Choice', 'Block slicing state', 'Slicing state: Full, Bottom Half, or Top Half', 'Full', G_STATE, [
    'Full', 'Bottom Half', 'Top Half',
  ]),

  // Top & Bottom Caps
  prop('TopCapResourceName', 'Resource', 'Top cap texture', 'Texture image for the top flat hexagonal cap (leave blank for GDevelop default texture)', '', G_CAPS, ['image']),
  prop('TopCapVisible', 'Boolean', 'Top cap visible', 'Show or hide the top flat hexagonal cap', 'true', G_CAPS),
  prop('TopCapResourceRepeat', 'Boolean', 'Top cap tile', 'Tile and repeat the texture across the top cap', 'false', G_CAPS),

  prop('BottomCapResourceName', 'Resource', 'Bottom cap texture', 'Texture image for the bottom flat hexagonal cap (leave blank for GDevelop default texture)', '', G_CAPS, ['image']),
  prop('BottomCapVisible', 'Boolean', 'Bottom cap visible', 'Show or hide the bottom flat hexagonal cap', 'true', G_CAPS),
  prop('BottomCapResourceRepeat', 'Boolean', 'Bottom cap tile', 'Tile and repeat the texture across the bottom cap', 'false', G_CAPS),

  // Upper Facets (Top 6)
  prop('UpperFacesResourceName', 'Resource', 'All upper facets texture', 'Master fallback texture image for all 6 upper sloped facets', '', G_UPPER, ['image']),
  
  prop('UpperFace0ResourceName', 'Resource', 'Upper facet 0 texture', 'Texture for upper facet 0 (overrides all upper facets texture)', '', G_UPPER, ['image']),
  prop('UpperFace0Visible', 'Boolean', 'Upper facet 0 visible', 'Show or hide upper facet 0', 'true', G_UPPER),
  prop('UpperFace0ResourceRepeat', 'Boolean', 'Upper facet 0 tile', 'Tile and repeat texture on upper facet 0', 'false', G_UPPER),

  prop('UpperFace1ResourceName', 'Resource', 'Upper facet 1 texture', 'Texture for upper facet 1', '', G_UPPER, ['image']),
  prop('UpperFace1Visible', 'Boolean', 'Upper facet 1 visible', 'Show or hide upper facet 1', 'true', G_UPPER),
  prop('UpperFace1ResourceRepeat', 'Boolean', 'Upper facet 1 tile', 'Tile and repeat texture on upper facet 1', 'false', G_UPPER),

  prop('UpperFace2ResourceName', 'Resource', 'Upper facet 2 texture', 'Texture for upper facet 2', '', G_UPPER, ['image']),
  prop('UpperFace2Visible', 'Boolean', 'Upper facet 2 visible', 'Show or hide upper facet 2', 'true', G_UPPER),
  prop('UpperFace2ResourceRepeat', 'Boolean', 'Upper facet 2 tile', 'Tile and repeat texture on upper facet 2', 'false', G_UPPER),

  prop('UpperFace3ResourceName', 'Resource', 'Upper facet 3 texture', 'Texture for upper facet 3', '', G_UPPER, ['image']),
  prop('UpperFace3Visible', 'Boolean', 'Upper facet 3 visible', 'Show or hide upper facet 3', 'true', G_UPPER),
  prop('UpperFace3ResourceRepeat', 'Boolean', 'Upper facet 3 tile', 'Tile and repeat texture on upper facet 3', 'false', G_UPPER),

  prop('UpperFace4ResourceName', 'Resource', 'Upper facet 4 texture', 'Texture for upper facet 4', '', G_UPPER, ['image']),
  prop('UpperFace4Visible', 'Boolean', 'Upper facet 4 visible', 'Show or hide upper facet 4', 'true', G_UPPER),
  prop('UpperFace4ResourceRepeat', 'Boolean', 'Upper facet 4 tile', 'Tile and repeat texture on upper facet 4', 'false', G_UPPER),

  prop('UpperFace5ResourceName', 'Resource', 'Upper facet 5 texture', 'Texture for upper facet 5', '', G_UPPER, ['image']),
  prop('UpperFace5Visible', 'Boolean', 'Upper facet 5 visible', 'Show or hide upper facet 5', 'true', G_UPPER),
  prop('UpperFace5ResourceRepeat', 'Boolean', 'Upper facet 5 tile', 'Tile and repeat texture on upper facet 5', 'false', G_UPPER),

  // Lower Facets (Bottom 6)
  prop('LowerFacesResourceName', 'Resource', 'All lower facets texture', 'Master fallback texture image for all 6 lower sloped facets', '', G_LOWER, ['image']),

  prop('LowerFace0ResourceName', 'Resource', 'Lower facet 0 texture', 'Texture for lower facet 0 (overrides all lower facets texture)', '', G_LOWER, ['image']),
  prop('LowerFace0Visible', 'Boolean', 'Lower facet 0 visible', 'Show or hide lower facet 0', 'true', G_LOWER),
  prop('LowerFace0ResourceRepeat', 'Boolean', 'Lower facet 0 tile', 'Tile and repeat texture on lower facet 0', 'false', G_LOWER),

  prop('LowerFace1ResourceName', 'Resource', 'Lower facet 1 texture', 'Texture for lower facet 1', '', G_LOWER, ['image']),
  prop('LowerFace1Visible', 'Boolean', 'Lower facet 1 visible', 'Show or hide lower facet 1', 'true', G_LOWER),
  prop('LowerFace1ResourceRepeat', 'Boolean', 'Lower facet 1 tile', 'Tile and repeat texture on lower facet 1', 'false', G_LOWER),

  prop('LowerFace2ResourceName', 'Resource', 'Lower facet 2 texture', 'Texture for lower facet 2', '', G_LOWER, ['image']),
  prop('LowerFace2Visible', 'Boolean', 'Lower facet 2 visible', 'Show or hide lower facet 2', 'true', G_LOWER),
  prop('LowerFace2ResourceRepeat', 'Boolean', 'Lower facet 2 tile', 'Tile and repeat texture on lower facet 2', 'false', G_LOWER),

  prop('LowerFace3ResourceName', 'Resource', 'Lower facet 3 texture', 'Texture for lower facet 3', '', G_LOWER, ['image']),
  prop('LowerFace3Visible', 'Boolean', 'Lower facet 3 visible', 'Show or hide lower facet 3', 'true', G_LOWER),
  prop('LowerFace3ResourceRepeat', 'Boolean', 'Lower facet 3 tile', 'Tile and repeat texture on lower facet 3', 'false', G_LOWER),

  prop('LowerFace4ResourceName', 'Resource', 'Lower facet 4 texture', 'Texture for lower facet 4', '', G_LOWER, ['image']),
  prop('LowerFace4Visible', 'Boolean', 'Lower facet 4 visible', 'Show or hide lower facet 4', 'true', G_LOWER),
  prop('LowerFace4ResourceRepeat', 'Boolean', 'Lower facet 4 tile', 'Tile and repeat texture on lower facet 4', 'false', G_LOWER),

  prop('LowerFace5ResourceName', 'Resource', 'Lower facet 5 texture', 'Texture for lower facet 5', '', G_LOWER, ['image']),
  prop('LowerFace5Visible', 'Boolean', 'Lower facet 5 visible', 'Show or hide lower facet 5', 'true', G_LOWER),
  prop('LowerFace5ResourceRepeat', 'Boolean', 'Lower facet 5 tile', 'Tile and repeat texture on lower facet 5', 'false', G_LOWER),

  // Middle Cut Face
  prop('MiddleCutFaceResourceName', 'Resource', 'Middle cut face texture', 'Texture image for the internal horizontal cut face at y = 0', '', G_CUT, ['image']),
  prop('MiddleCutFaceVisible', 'Boolean', 'Middle cut face visible', 'Show or hide the internal cut face', 'true', G_CUT),
  prop('MiddleCutFaceResourceRepeat', 'Boolean', 'Middle cut face tile', 'Tile and repeat texture on the internal cut face', 'false', G_CUT),

  // General Material & Shading
  prop('DefaultTextureResourceName', 'Resource', 'Default block texture', 'Master fallback texture image for untextured faces (leave empty for GDevelop default texture)', '', G_MAT, ['image']),
  prop('MaterialType', 'Choice', 'Material type', 'Shading model: StandardWithoutMetalness (PBR) or Basic (unlit)', 'StandardWithoutMetalness', G_MAT, [
    'StandardWithoutMetalness', 'Basic',
  ]),
  prop('EnableTextureTransparency', 'Boolean', 'Enable texture transparency', 'Render textures with transparency (alpha channel)', 'true', G_MAT),
  prop('TileScale', 'Number', 'Tile scale', 'Scale factor when tiling repeating textures (default = 1)', '1', G_MAT),
  prop('Tint', 'Color', 'Tint color', 'Color tint multiplied with vertex colors and textures', '255;255;255', G_MAT),
  prop('CastShadow', 'Boolean', 'Cast shadows', 'Whether the 3D polygon casts shadows', 'true', G_MAT),
  prop('ReceiveShadow', 'Boolean', 'Receive shadows', 'Whether the 3D polygon receives shadows', 'true', G_MAT),
];

const customObjectPropertiesFolderStructure = {
  folderName: '__ROOT',
  children: [
    {
      folderName: 'Geometry',
      children: [
        { propertyName: 'EquatorRadius' },
        { propertyName: 'CapRadius' },
        { propertyName: 'TotalHeight' },
      ],
    },
    {
      folderName: 'Slicing',
      children: [{ propertyName: 'BlockState' }],
    },
    {
      folderName: 'Top & Bottom Caps',
      children: [
        {
          folderName: 'Top Cap',
          children: [
            { propertyName: 'TopCapResourceName' },
            { propertyName: 'TopCapVisible' },
            { propertyName: 'TopCapResourceRepeat' },
          ],
        },
        {
          folderName: 'Bottom Cap',
          children: [
            { propertyName: 'BottomCapResourceName' },
            { propertyName: 'BottomCapVisible' },
            { propertyName: 'BottomCapResourceRepeat' },
          ],
        },
      ],
    },
    {
      folderName: 'Upper Facets (Top 6)',
      children: [
        { propertyName: 'UpperFacesResourceName' },
        {
          folderName: 'Upper Facet 0',
          children: [
            { propertyName: 'UpperFace0ResourceName' },
            { propertyName: 'UpperFace0Visible' },
            { propertyName: 'UpperFace0ResourceRepeat' },
          ],
        },
        {
          folderName: 'Upper Facet 1',
          children: [
            { propertyName: 'UpperFace1ResourceName' },
            { propertyName: 'UpperFace1Visible' },
            { propertyName: 'UpperFace1ResourceRepeat' },
          ],
        },
        {
          folderName: 'Upper Facet 2',
          children: [
            { propertyName: 'UpperFace2ResourceName' },
            { propertyName: 'UpperFace2Visible' },
            { propertyName: 'UpperFace2ResourceRepeat' },
          ],
        },
        {
          folderName: 'Upper Facet 3',
          children: [
            { propertyName: 'UpperFace3ResourceName' },
            { propertyName: 'UpperFace3Visible' },
            { propertyName: 'UpperFace3ResourceRepeat' },
          ],
        },
        {
          folderName: 'Upper Facet 4',
          children: [
            { propertyName: 'UpperFace4ResourceName' },
            { propertyName: 'UpperFace4Visible' },
            { propertyName: 'UpperFace4ResourceRepeat' },
          ],
        },
        {
          folderName: 'Upper Facet 5',
          children: [
            { propertyName: 'UpperFace5ResourceName' },
            { propertyName: 'UpperFace5Visible' },
            { propertyName: 'UpperFace5ResourceRepeat' },
          ],
        },
      ],
    },
    {
      folderName: 'Lower Facets (Bottom 6)',
      children: [
        { propertyName: 'LowerFacesResourceName' },
        {
          folderName: 'Lower Facet 0',
          children: [
            { propertyName: 'LowerFace0ResourceName' },
            { propertyName: 'LowerFace0Visible' },
            { propertyName: 'LowerFace0ResourceRepeat' },
          ],
        },
        {
          folderName: 'Lower Facet 1',
          children: [
            { propertyName: 'LowerFace1ResourceName' },
            { propertyName: 'LowerFace1Visible' },
            { propertyName: 'LowerFace1ResourceRepeat' },
          ],
        },
        {
          folderName: 'Lower Facet 2',
          children: [
            { propertyName: 'LowerFace2ResourceName' },
            { propertyName: 'LowerFace2Visible' },
            { propertyName: 'LowerFace2ResourceRepeat' },
          ],
        },
        {
          folderName: 'Lower Facet 3',
          children: [
            { propertyName: 'LowerFace3ResourceName' },
            { propertyName: 'LowerFace3Visible' },
            { propertyName: 'LowerFace3ResourceRepeat' },
          ],
        },
        {
          folderName: 'Lower Facet 4',
          children: [
            { propertyName: 'LowerFace4ResourceName' },
            { propertyName: 'LowerFace4Visible' },
            { propertyName: 'LowerFace4ResourceRepeat' },
          ],
        },
        {
          folderName: 'Lower Facet 5',
          children: [
            { propertyName: 'LowerFace5ResourceName' },
            { propertyName: 'LowerFace5Visible' },
            { propertyName: 'LowerFace5ResourceRepeat' },
          ],
        },
      ],
    },
    {
      folderName: 'Middle Cut Face',
      children: [
        { propertyName: 'MiddleCutFaceResourceName' },
        { propertyName: 'MiddleCutFaceVisible' },
        { propertyName: 'MiddleCutFaceResourceRepeat' },
      ],
    },
    {
      folderName: 'General Materials & Shading',
      children: [
        { propertyName: 'DefaultTextureResourceName' },
        { propertyName: 'MaterialType' },
        { propertyName: 'EnableTextureTransparency' },
        { propertyName: 'TileScale' },
        { propertyName: 'Tint' },
        { propertyName: 'CastShadow' },
        { propertyName: 'ReceiveShadow' },
      ],
    },
  ],
};

/* ========================================================= Object Lifecycle */

const objectLifecycle = [
  {
    name: 'onCreated',
    fullName: '',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OBJ_PARAM],
    events: ev(
      OBJECT_PREAMBLE +
        `if (gdjs.__polygon3D && gdjs.__polygon3D.syncAllProperties) {
  gdjs.__polygon3D.syncAllProperties(object, eventsFunctionContext);
}
`,
      { withRuntime: true }
    ),
  },
  {
    name: 'doStepPreEvents',
    fullName: '',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OBJ_PARAM],
    events: ev(
      OBJECT_PREAMBLE +
        `if (gdjs.__polygon3D) {
  const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
  if (state && state.getRenderer()) {
    state.getRenderer().updatePosition();
    state.getRenderer().updateRotation();
    state.getRenderer().updateSize();
    state.getRenderer().updateVisibility();
  }
}
`
    ),
  },
  {
    name: 'onDestroy',
    fullName: '',
    description: '',
    functionType: 'Action',
    private: true,
    parameters: [...OBJ_PARAM],
    events: ev(
      OBJECT_PREAMBLE +
        `if (gdjs.__polygon3D && gdjs.__polygon3D.destroyState) {
  gdjs.__polygon3D.destroyState(object);
}
`
    ),
  },
];

/* ========================================================= Custom Object Actions */

const customObjectActions = [
  // Slicing State
  objFn(
    'SetBlockState',
    'Set block slicing state',
    'Set block slicing state of _PARAM0_ to _PARAM1_',
    'Change the slicing display state to Full, Bottom Half, or Top Half. Automatically updates materials, 3D bounds, and colliders.',
    'Action',
    [choice('State', 'Slicing State', ['Full', 'Bottom Half', 'Top Half'])],
    `const val = eventsFunctionContext.getArgument("State");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setBlockState === "function") state.setBlockState(val);
`,
    { group: G_STATE }
  ),

  // Per-Face Visibility
  objFn(
    'SetFaceVisibility',
    'Set individual face visibility',
    'Set visibility of face _PARAM1_ on _PARAM0_ to _PARAM2_',
    'Show or hide any individual face of the 14-face bipyramid or the internal cut face.',
    'Action',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES), bool('Visible', 'Show face')],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const visible = !!eventsFunctionContext.getArgument("Visible");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setFaceVisibility === "function") state.setFaceVisibility(faceName, visible);
`,
    { group: 'Per-Face Controls' }
  ),

  // Per-Face Texture
  objFn(
    'SetFaceTexture',
    'Set individual face texture',
    'Set texture of face _PARAM1_ on _PARAM0_ to _PARAM2_',
    'Set or change the image texture resource for any individual face (or leave empty to reset to default GDevelop texture).',
    'Action',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES), imageRes('TextureResource', 'Texture image resource name')],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const resName = eventsFunctionContext.getArgument("TextureResource");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setFaceResourceName === "function") state.setFaceResourceName(faceName, resName);
`,
    { group: 'Per-Face Controls' }
  ),

  // Per-Face Texture Repeat
  objFn(
    'SetRepeatTextureOnFace',
    'Set repeat texture on face',
    'Set repeat texture on face _PARAM1_ of _PARAM0_ to _PARAM2_',
    'Enable or disable texture tiling and repetition across a specific face.',
    'Action',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES), bool('Repeat', 'Enable repeat')],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const repeat = !!eventsFunctionContext.getArgument("Repeat");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setRepeatTextureOnFace === "function") state.setRepeatTextureOnFace(faceName, repeat);
`,
    { group: 'Per-Face Controls' }
  ),

  // Geometry
  objFn(
    'SetEquatorRadius',
    'Set equator radius',
    'Set equator radius of _PARAM0_ to _PARAM1_',
    'Change the middle hexagonal equator radius (Req) and rebuild procedural geometry.',
    'Action',
    [num('Radius', 'Equator radius', '50')],
    `const val = eventsFunctionContext.getArgument("Radius");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setEquatorRadius === "function") state.setEquatorRadius(val);
`,
    { group: G_GEOM }
  ),

  objFn(
    'SetCapRadius',
    'Set cap radius',
    'Set cap radius of _PARAM0_ to _PARAM1_',
    'Change the top and bottom flat hexagonal cap radius (Rcap) and rebuild procedural geometry.',
    'Action',
    [num('Radius', 'Cap radius', '25')],
    `const val = eventsFunctionContext.getArgument("Radius");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setCapRadius === "function") state.setCapRadius(val);
`,
    { group: G_GEOM }
  ),

  objFn(
    'SetTotalHeight',
    'Set total height',
    'Set total height of _PARAM0_ to _PARAM1_',
    'Change the full block height (H) and rebuild procedural geometry.',
    'Action',
    [num('Height', 'Total height', '80')],
    `const val = eventsFunctionContext.getArgument("Height");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setTotalHeight === "function") state.setTotalHeight(val);
`,
    { group: G_GEOM }
  ),

  objFn(
    'SetTint',
    'Set tint color',
    'Set tint color of _PARAM0_ to _PARAM1_',
    'Change the color tint of the polygon material.',
    'Action',
    [col('Color', 'Color tint', '255;255;255')],
    `const val = eventsFunctionContext.getArgument("Color");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setColor === "function") state.setColor(val);
`,
    { group: G_MAT }
  ),

  objFn(
    'SetTileScale',
    'Set texture tile scale',
    'Set tile scale of _PARAM0_ to _PARAM1_',
    'Change the tile scale factor for repeating textures.',
    'Action',
    [num('TileScale', 'Tile scale factor', '1')],
    `const val = eventsFunctionContext.getArgument("TileScale");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.setTileScale === "function") state.setTileScale(val);
`,
    { group: G_MAT }
  ),

  objFn(
    'SnapToHexGrid',
    'Snap object to honeycomb hex grid',
    'Snap _PARAM0_ to honeycomb grid with equator radius _PARAM1_',
    'Snaps the object (X, Z) position to the nearest gapless hexagonal honeycomb grid center.',
    'Action',
    [num('EquatorRadius', 'Equator radius', '50')],
    `const r = eventsFunctionContext.getArgument("EquatorRadius");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
if (state && typeof state.snapToHexGrid === "function") state.snapToHexGrid(r);
`,
    { group: G_GRID }
  ),
];

/* ========================================================= Custom Object Conditions */

const customObjectConditions = [
  objFn(
    'IsBlockState',
    'Check block state',
    'Block state of _PARAM0_ is _PARAM1_',
    'Check if the bipyramid is in the specified slicing state (Full, Bottom Half, or Top Half).',
    'Condition',
    [choice('State', 'Slicing State', ['Full', 'Bottom Half', 'Top Half'])],
    `const val = eventsFunctionContext.getArgument("State");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.isBlockState === "function" ? state.isBlockState(val) : false;
`,
    { group: G_STATE }
  ),

  objFn(
    'IsFaceVisible',
    'Check if face is visible',
    'Face _PARAM1_ of _PARAM0_ is visible',
    'Check if a specific face of the bipyramid is currently visible.',
    'Condition',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES)],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.isFaceVisible === "function" ? state.isFaceVisible(faceName) : false;
`,
    { group: 'Per-Face Controls' }
  ),

  objFn(
    'ShouldRepeatTextureOnFace',
    'Check if face repeats texture',
    'Face _PARAM1_ of _PARAM0_ repeats texture',
    'Check if a specific face has texture repeating enabled.',
    'Condition',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES)],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
const idx = HexBipyramid3DRuntimeObject.getFaceIndex ? HexBipyramid3DRuntimeObject.getFaceIndex(faceName) : -1;
eventsFunctionContext.returnValue = idx !== -1 && state && typeof state.shouldRepeatTextureOnFaceAtIndex === "function" ? state.shouldRepeatTextureOnFaceAtIndex(idx) : false;
`,
    { group: 'Per-Face Controls' }
  ),

  objFn(
    'IsFull',
    'Is full block',
    '_PARAM0_ is a full block',
    'Check if the diamond block is in the Full state.',
    'Condition',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.isFull === "function" ? state.isFull() : true;
`,
    { group: G_STATE }
  ),

  objFn(
    'IsHalfBlock',
    'Is half block',
    '_PARAM0_ is sliced (half block)',
    'Check if the block is currently sliced into a half-block (Bottom Half or Top Half).',
    'Condition',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.isHalfBlock === "function" ? state.isHalfBlock() : false;
`,
    { group: G_STATE }
  ),
];

/* ========================================================= Custom Object Expressions */

const customObjectExpressions = [
  objFn(
    'BlockState',
    'Current block state',
    'Get block state of _PARAM0_',
    'Returns the current block slicing state ("Full", "Bottom Half", or "Top Half").',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getBlockState === "function" ? state.getBlockState() : "Full";
`,
    { group: G_STATE, expressionType: 'string' }
  ),

  objFn(
    'FaceTexture',
    'Face texture resource name',
    'Get texture resource of face _PARAM1_ on _PARAM0_',
    'Returns the texture resource name assigned to a specific face.',
    'Expression',
    [choice('FaceName', 'Face Name', ALL_FACE_NAMES)],
    `const faceName = eventsFunctionContext.getArgument("FaceName");
const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getFaceResourceName === "function" ? state.getFaceResourceName(faceName) : "";
`,
    { group: 'Per-Face Controls', expressionType: 'string' }
  ),

  objFn(
    'TileScale',
    'Texture tile scale',
    'Get texture tile scale of _PARAM0_',
    'Returns the texture tile scale factor.',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getTileScale === "function" ? state.getTileScale() : 1;
`,
    { group: G_MAT, expressionType: 'number' }
  ),

  objFn(
    'SurfaceY',
    'Walkable surface Y elevation (deprecated name)',
    'Get top surface elevation of _PARAM0_',
    'Deprecated: use SurfaceZ. The block is Z-up, so this elevation is along Z despite the name. Returns the top walkable surface elevation in world coordinates (0 for Bottom Half).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getSurfaceY === "function" ? state.getSurfaceY() : 0;
`,
    { group: G_STATE, expressionType: 'number' }
  ),

  objFn(
    'EquatorRadius',
    'Equator radius',
    'Get equator radius of _PARAM0_',
    'Returns the middle hexagonal equator radius (Req).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getEquatorRadius === "function" ? state.getEquatorRadius() : 50;
`,
    { group: G_GEOM, expressionType: 'number' }
  ),

  objFn(
    'CapRadius',
    'Cap radius',
    'Get cap radius of _PARAM0_',
    'Returns the top and bottom cap radius (Rcap).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getCapRadius === "function" ? state.getCapRadius() : 25;
`,
    { group: G_GEOM, expressionType: 'number' }
  ),

  objFn(
    'TotalHeight',
    'Total height',
    'Get total height of _PARAM0_',
    'Returns the total height (H) of the full bipyramid block.',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getTotalHeight === "function" ? state.getTotalHeight() : 80;
`,
    { group: G_GEOM, expressionType: 'number' }
  ),

  objFn(
    'EffectiveHeight',
    'Effective height',
    'Get active sliced height of _PARAM0_',
    'Returns the active collision height of the block (H for Full, H/2 for half blocks).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getEffectiveHeight === "function" ? state.getEffectiveHeight() : 80;
`,
    { group: G_STATE, expressionType: 'number' }
  ),

  objFn(
    'CenterOffsetY',
    'Vertical center offset (deprecated name)',
    'Get vertical center offset of _PARAM0_',
    'Deprecated: use CenterOffsetZ. The block is Z-up, so this offset runs along Z despite the name. Returns 0 for Full, -H/4 for Bottom Half, +H/4 for Top Half.',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getCenterOffsetY === "function" ? state.getCenterOffsetY() : 0;
`,
    { group: G_STATE, expressionType: 'number' }
  ),

  /* The block is Z-up in GDevelop, so the up axis is Z. These are the correctly
   * named expressions; SurfaceY / CenterOffsetY remain as deprecated aliases
   * returning the same values, so existing event sheets keep working. */
  objFn(
    'SurfaceZ',
    'Walkable surface Z elevation',
    'Get top surface Z elevation of _PARAM0_',
    'Returns the top walkable surface Z elevation in world coordinates (0 for Bottom Half).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getSurfaceY === "function" ? state.getSurfaceY() : 0;
`,
    { group: G_STATE, expressionType: 'number' }
  ),

  objFn(
    'CenterOffsetZ',
    'Vertical center offset Z',
    'Get vertical center offset Z of _PARAM0_',
    'Returns the vertical center offset along Z (0 for Full, -H/4 for Bottom Half, +H/4 for Top Half).',
    'Expression',
    [],
    `const state = gdjs.__polygon3D.getOrCreateState(object, eventsFunctionContext);
eventsFunctionContext.returnValue = state && typeof state.getCenterOffsetY === "function" ? state.getCenterOffsetY() : 0;
`,
    { group: G_STATE, expressionType: 'number' }
  ),
];

/* ========================================================= Free Functions (Grid Math) */

const freeFunctions = [
  freeFn(
    'DeltaX',
    'Honeycomb column spacing (Delta X)',
    'DeltaX(_PARAM0_)',
    'Returns the lateral column offset Delta X = sqrt(3) * Req for seamless gapless honeycomb tiling.',
    'Expression',
    [num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const r = eventsFunctionContext.getArgument("EquatorRadius");
eventsFunctionContext.returnValue = Hex.getDeltaX(r);
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'DeltaZ',
    'Honeycomb row spacing (Delta Z)',
    'DeltaZ(_PARAM0_)',
    'Returns the longitudinal row offset Delta Z = 1.5 * Req for seamless gapless honeycomb tiling.',
    'Expression',
    [num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const r = eventsFunctionContext.getArgument("EquatorRadius");
eventsFunctionContext.returnValue = Hex.getDeltaZ(r);
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'HexToWorldX',
    'Hex grid to world X',
    'HexToWorldX(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Converts hexagonal grid (Col, Row) to world X coordinate with odd-row staggering.',
    'Expression',
    [num('Col', 'Grid column', '0'), num('Row', 'Grid row', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const col = eventsFunctionContext.getArgument("Col");
const row = eventsFunctionContext.getArgument("Row");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const world = Hex.hexToWorld(col, row, r);
eventsFunctionContext.returnValue = world.x;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'HexToWorldZ',
    'Hex grid to world Z',
    'HexToWorldZ(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Converts hexagonal grid (Col, Row) to world Z coordinate.',
    'Expression',
    [num('Col', 'Grid column', '0'), num('Row', 'Grid row', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const col = eventsFunctionContext.getArgument("Col");
const row = eventsFunctionContext.getArgument("Row");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const world = Hex.hexToWorld(col, row, r);
eventsFunctionContext.returnValue = world.z;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'WorldToHexCol',
    'World X, Z to hex grid Col',
    'WorldToHexCol(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Converts 3D world (X, Z) to nearest hexagonal grid column.',
    'Expression',
    [num('X', 'World X', '0'), num('Z', 'World Z', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const x = eventsFunctionContext.getArgument("X");
const z = eventsFunctionContext.getArgument("Z");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const hex = Hex.worldToHex(x, z, r);
eventsFunctionContext.returnValue = hex.col;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'WorldToHexRow',
    'World X, Z to hex grid Row',
    'WorldToHexRow(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Converts 3D world (X, Z) to nearest hexagonal grid row.',
    'Expression',
    [num('X', 'World X', '0'), num('Z', 'World Z', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const x = eventsFunctionContext.getArgument("X");
const z = eventsFunctionContext.getArgument("Z");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const hex = Hex.worldToHex(x, z, r);
eventsFunctionContext.returnValue = hex.row;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'SnapX',
    'Snap world X to honeycomb grid',
    'SnapX(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Returns the snapped world X coordinate on the hexagonal honeycomb grid.',
    'Expression',
    [num('X', 'World X', '0'), num('Z', 'World Z', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const x = eventsFunctionContext.getArgument("X");
const z = eventsFunctionContext.getArgument("Z");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const snapped = Hex.snapToHexGrid(x, z, r);
eventsFunctionContext.returnValue = snapped.x;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),

  freeFn(
    'SnapZ',
    'Snap world Z to honeycomb grid',
    'SnapZ(_PARAM0_, _PARAM1_, _PARAM2_)',
    'Returns the snapped world Z coordinate on the hexagonal honeycomb grid.',
    'Expression',
    [num('X', 'World X', '0'), num('Z', 'World Z', '0'), num('EquatorRadius', 'Equator radius (Req)', '50')],
    `const x = eventsFunctionContext.getArgument("X");
const z = eventsFunctionContext.getArgument("Z");
const r = eventsFunctionContext.getArgument("EquatorRadius");
const snapped = Hex.snapToHexGrid(x, z, r);
eventsFunctionContext.returnValue = snapped.z;
`,
    { group: G_GRID, expressionType: 'number', gridMath: true }
  ),
];

/* ============================================= Rhombic Dodecahedron Object */

const R_G_STATE = 'Slicing & Radial Faces';
const R_G_RHOMBI = 'Rhombus Faces (12)';
const R_G_CUT = 'Middle Cut Face';
const R_G_RADIAL = 'Radial Half-Faces (6)';
const R_G_MAT = 'General Materials & Shading';
const RHOMBIC_FACE_NAMES = [
  ...Array.from({ length: 12 }, (_, i) => 'UpperRhombusFace' + i),
  ...Array.from({ length: 12 }, (_, i) => 'LowerRhombusFace' + i),
  'MiddleCutFace',
  ...Array.from({ length: 6 }, (_, i) => 'UpperRadialFace' + i + 'Left'),
  ...Array.from({ length: 6 }, (_, i) => 'UpperRadialFace' + i + 'Right'),
  ...Array.from({ length: 6 }, (_, i) => 'LowerRadialFace' + i + 'Left'),
  ...Array.from({ length: 6 }, (_, i) => 'LowerRadialFace' + i + 'Right'),
];

const rhombicProperties = [
  prop('UpperHalfVisible', 'Boolean', 'Upper half visible', 'Show all 12 upper rhombus face groups', 'true', R_G_STATE),
  prop('LowerHalfVisible', 'Boolean', 'Lower half visible', 'Show all 12 lower rhombus face groups', 'true', R_G_STATE),
  prop('RadialFaceMask', 'Number', 'Radial half-face mask', 'Six-bit mask enabling radial half-faces 0 through 5 (0 to 63)', '0', R_G_STATE),
  prop('DirectedHalfDirection', 'Number', 'Directed radial half', 'Direction 0 to 5 for a symmetrical radial half, or -1 for the full shell', '-1', R_G_STATE),
  prop('RhombusFacesResourceName', 'Resource', 'All rhombus faces texture', 'Fallback texture for all 12 exterior rhombus faces', '', R_G_RHOMBI, ['image']),
  ...Array.from({ length: 12 }, (_, i) => [
    prop('UpperRhombusFace' + i + 'ResourceName', 'Resource', 'Upper rhombus ' + i + ' texture', 'Texture override for upper rhombus section ' + i, '', R_G_RHOMBI, ['image']),
    prop('UpperRhombusFace' + i + 'Visible', 'Boolean', 'Upper rhombus ' + i + ' visible', 'Show or hide upper rhombus section ' + i, 'true', R_G_RHOMBI),
    prop('UpperRhombusFace' + i + 'ResourceRepeat', 'Boolean', 'Upper rhombus ' + i + ' tile', 'Repeat its texture', 'false', R_G_RHOMBI),
    prop('LowerRhombusFace' + i + 'ResourceName', 'Resource', 'Lower rhombus ' + i + ' texture', 'Texture override for lower rhombus section ' + i, '', R_G_RHOMBI, ['image']),
    prop('LowerRhombusFace' + i + 'Visible', 'Boolean', 'Lower rhombus ' + i + ' visible', 'Show or hide lower rhombus section ' + i, 'true', R_G_RHOMBI),
    prop('LowerRhombusFace' + i + 'ResourceRepeat', 'Boolean', 'Lower rhombus ' + i + ' tile', 'Repeat its texture', 'false', R_G_RHOMBI),
  ]).flat(),
  prop('MiddleCutFaceResourceName', 'Resource', 'Middle cut texture', 'Texture for the sealed horizontal hexagonal center cut', '', R_G_CUT, ['image']),
  prop('MiddleCutFaceVisible', 'Boolean', 'Middle cut visible', 'Show the sealed horizontal center face', 'false', R_G_CUT),
  prop('MiddleCutFaceResourceRepeat', 'Boolean', 'Middle cut tile', 'Repeat the middle cut texture', 'false', R_G_CUT),
  prop('RadialFacesResourceName', 'Resource', 'All radial faces texture', 'Fallback texture for all six radial half-faces', '', R_G_RADIAL, ['image']),
  ...Array.from({ length: 6 }, (_, i) => [
    ...['Upper', 'Lower'].flatMap((half) => ['Left', 'Right'].flatMap((side) => [
      prop(half + 'RadialFace' + i + side + 'ResourceName', 'Resource', half + ' radial ' + i + ' ' + side.toLowerCase() + ' texture', 'Texture for the ' + side.toLowerCase() + '-facing side', '', R_G_RADIAL, ['image']),
      prop(half + 'RadialFace' + i + side + 'Visible', 'Boolean', half + ' radial ' + i + ' ' + side.toLowerCase() + ' visible', 'Show this independently wound wall side', 'true', R_G_RADIAL),
      prop(half + 'RadialFace' + i + side + 'ResourceRepeat', 'Boolean', half + ' radial ' + i + ' ' + side.toLowerCase() + ' tile', 'Repeat its texture', 'false', R_G_RADIAL),
    ])),
  ]).flat(),
  prop('MasterTextureResourceName', 'Resource', 'Master wrapping texture', 'When non-empty, overrides every per-face texture while cylindrical UVs wrap continuously around the exterior shell', '', R_G_MAT, ['image']),
  prop('DefaultTextureResourceName', 'Resource', 'Default shape texture', 'Fallback texture for every unassigned face', '', R_G_MAT, ['image']),
  prop('MaterialType', 'Choice', 'Material type', 'StandardWithoutMetalness or Basic', 'StandardWithoutMetalness', R_G_MAT, ['StandardWithoutMetalness', 'Basic']),
  prop('EnableTextureTransparency', 'Boolean', 'Enable texture transparency', 'Render texture alpha channels', 'true', R_G_MAT),
  prop('TileScale', 'Number', 'Tile scale', 'Texture repetition scale', '1', R_G_MAT),
  prop('Tint', 'Color', 'Tint color', 'Color tint multiplied with textures', '255;255;255', R_G_MAT),
  prop('CastShadow', 'Boolean', 'Cast shadows', 'Whether the shape casts shadows', 'true', R_G_MAT),
  prop('ReceiveShadow', 'Boolean', 'Receive shadows', 'Whether the shape receives shadows', 'true', R_G_MAT),
];

const rhombicPropertiesFolderStructure = {
  folderName: '__ROOT',
  children: [R_G_STATE, R_G_RHOMBI, R_G_CUT, R_G_RADIAL, R_G_MAT].map((folderName) => ({
    folderName,
    children: rhombicProperties.filter((p) => p.group === folderName).map((p) => ({ propertyName: p.name })),
  })),
};

const rhombicLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action', private: true,
    parameters: [...RHOMBIC_OBJ_PARAM],
    events: ev(OBJECT_PREAMBLE + `if (gdjs.__polygon3D && gdjs.__polygon3D.syncRhombicProperties) gdjs.__polygon3D.syncRhombicProperties(object, eventsFunctionContext);\n`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action', private: true,
    parameters: [...RHOMBIC_OBJ_PARAM],
    events: ev(OBJECT_PREAMBLE + `const state = gdjs.__polygon3D && gdjs.__polygon3D.getOrCreateRhombicState(object, eventsFunctionContext);\nif (state && state.getRenderer()) { const r = state.getRenderer(); r.updatePosition(); r.updateRotation(); r.updateSize(); r.updateVisibility(); }\n`),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action', private: true,
    parameters: [...RHOMBIC_OBJ_PARAM],
    events: ev(OBJECT_PREAMBLE + `if (gdjs.__polygon3D && gdjs.__polygon3D.destroyRhombicState) {\n  gdjs.__polygon3D.destroyRhombicState(object);\n}\n`),
  },
];

const rhombicActions = [
  rhombicObjFn('SetDirectedHalf', 'Set directed radial half', 'Set _PARAM0_ to symmetrical radial half _PARAM1_', 'Retain one of six symmetrical radial halves by shell-fragment visibility and expose its complete center cut face.', 'Action', [num('Direction', 'Direction 0 to 5', '0')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setDirectedHalfDirection(eventsFunctionContext.getArgument("Direction"));`, { group: R_G_STATE }),
  rhombicObjFn('ClearDirectedHalf', 'Clear directed radial half', 'Restore the full radial shell of _PARAM0_', 'Disable directed-half filtering without rebuilding geometry.', 'Action', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.clearDirectedHalf();`, { group: R_G_STATE }),
  rhombicObjFn('SetUpperHalfVisibility', 'Set upper-half visibility', 'Set upper half of _PARAM0_ visible to _PARAM1_', 'Toggle all upper shell and enabled upper radial material groups without rebuilding geometry.', 'Action', [bool('Visible', 'Visible')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setUpperHalfVisibility(!!eventsFunctionContext.getArgument("Visible"));`, { group: R_G_STATE }),
  rhombicObjFn('SetLowerHalfVisibility', 'Set lower-half visibility', 'Set lower half of _PARAM0_ visible to _PARAM1_', 'Toggle all lower shell and enabled lower radial material groups without rebuilding geometry.', 'Action', [bool('Visible', 'Visible')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setLowerHalfVisibility(!!eventsFunctionContext.getArgument("Visible"));`, { group: R_G_STATE }),
  rhombicObjFn('SetRadialFaceEnabled', 'Enable radial half-face', 'Set radial direction _PARAM1_ of _PARAM0_ enabled to _PARAM2_', 'Enable one of six center-to-edge radial half-faces.', 'Action', [num('Direction', 'Direction 0 to 5', '0'), bool('Enabled', 'Enabled')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setRadialFaceEnabled(eventsFunctionContext.getArgument("Direction"),!!eventsFunctionContext.getArgument("Enabled"));`, { group: R_G_RADIAL }),
  rhombicObjFn('SetRadialFaceMask', 'Set radial face mask', 'Set radial mask of _PARAM0_ to _PARAM1_', 'Set all six radial directions with a bit mask from 0 to 63.', 'Action', [num('Mask', 'Six-bit mask', '0')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setRadialFaceMask(eventsFunctionContext.getArgument("Mask"));`, { group: R_G_RADIAL }),
  rhombicObjFn('SetFaceVisibility', 'Set face visibility', 'Set face _PARAM1_ of _PARAM0_ visible to _PARAM2_', 'Show or hide any rhombus, cut, or radial face.', 'Action', [choice('FaceName', 'Face', RHOMBIC_FACE_NAMES), bool('Visible', 'Visible')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setFaceVisibility(eventsFunctionContext.getArgument("FaceName"),!!eventsFunctionContext.getArgument("Visible"));`, { group: 'Per-Face Controls' }),
  rhombicObjFn('SetFaceTexture', 'Set face texture', 'Set face _PARAM1_ texture of _PARAM0_ to _PARAM2_', 'Assign a texture to any face.', 'Action', [choice('FaceName', 'Face', RHOMBIC_FACE_NAMES), imageRes('TextureResource', 'Texture resource')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setFaceResourceName(eventsFunctionContext.getArgument("FaceName"),eventsFunctionContext.getArgument("TextureResource"));`, { group: 'Per-Face Controls' }),
  rhombicObjFn('SetRepeatTextureOnFace', 'Set face texture repetition', 'Set face _PARAM1_ texture repetition of _PARAM0_ to _PARAM2_', 'Enable texture tiling on a face.', 'Action', [choice('FaceName', 'Face', RHOMBIC_FACE_NAMES), bool('Repeat', 'Repeat')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setRepeatTextureOnFace(eventsFunctionContext.getArgument("FaceName"),!!eventsFunctionContext.getArgument("Repeat"));`, { group: 'Per-Face Controls' }),
  rhombicObjFn('SetMasterTexture', 'Set master wrapping texture', 'Set master wrapping texture of _PARAM0_ to _PARAM1_', 'A non-empty texture overrides every per-face texture and uses continuous exterior shell UV wrapping. Clear it to restore stored per-face textures.', 'Action', [imageRes('TextureResource', 'Master texture resource')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setMasterTextureResourceName(eventsFunctionContext.getArgument("TextureResource"));`, { group: R_G_MAT }),
  rhombicObjFn('SetTint', 'Set tint', 'Set tint of _PARAM0_ to _PARAM1_', 'Set the shape tint.', 'Action', [col('Color', 'Tint color', '255;255;255')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);if(state)state.setColor(eventsFunctionContext.getArgument("Color"));`, { group: R_G_MAT }),
];

const rhombicConditions = [
  rhombicObjFn('IsDirectedHalfActive', 'Directed radial half is active', '_PARAM0_ uses a directed radial half', 'Check whether shell sector filtering is active.', 'Condition', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=!!state&&state.isDirectedHalfActive();`, { group: R_G_STATE }),
  rhombicObjFn('IsUpperHalfVisible', 'Upper half is visible', 'Upper half of _PARAM0_ is visible', 'Check whether any upper shell face is visible.', 'Condition', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=!!state&&state.isUpperHalfVisible();`, { group: R_G_STATE }),
  rhombicObjFn('IsLowerHalfVisible', 'Lower half is visible', 'Lower half of _PARAM0_ is visible', 'Check whether any lower shell face is visible.', 'Condition', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=!!state&&state.isLowerHalfVisible();`, { group: R_G_STATE }),
  rhombicObjFn('IsRadialFaceEnabled', 'Radial face is enabled', 'Radial direction _PARAM1_ of _PARAM0_ is enabled', 'Check a radial direction bit.', 'Condition', [num('Direction', 'Direction 0 to 5', '0')], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=!!state&&state.isRadialFaceEnabled(eventsFunctionContext.getArgument("Direction"));`, { group: R_G_RADIAL }),
  rhombicObjFn('IsFaceVisible', 'Face is visible', 'Face _PARAM1_ of _PARAM0_ is visible', 'Check face visibility.', 'Condition', [choice('FaceName', 'Face', RHOMBIC_FACE_NAMES)], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=!!state&&state.isFaceVisible(eventsFunctionContext.getArgument("FaceName"));`, { group: 'Per-Face Controls' }),
];

const rhombicExpressions = [
  rhombicObjFn('DirectedHalfDirection', 'Directed radial half', '_PARAM0_.DirectedHalfDirection()', 'Return direction 0 to 5, or -1 when the full shell is active.', 'Expression', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=state?state.getDirectedHalfDirection():-1;`, { group: R_G_STATE, expressionType: 'number' }),
  rhombicObjFn('RadialFaceMask', 'Radial face mask', '_PARAM0_.RadialFaceMask()', 'Return the six-bit radial mask.', 'Expression', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=state?state.getRadialFaceMask():0;`, { group: R_G_RADIAL, expressionType: 'number' }),
  rhombicObjFn('MasterTexture', 'Master wrapping texture', '_PARAM0_.MasterTexture()', 'Return the active master texture resource, or an empty string when per-face textures are active.', 'Expression', [], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=state?state.getMasterTextureResourceName():"";`, { group: R_G_MAT, expressionType: 'string' }),
  rhombicObjFn('FaceTexture', 'Face texture', '_PARAM0_.FaceTexture(_PARAM1_)', 'Return a face texture resource name.', 'Expression', [choice('FaceName', 'Face', RHOMBIC_FACE_NAMES)], `const state=gdjs.__polygon3D.getOrCreateRhombicState(object,eventsFunctionContext);eventsFunctionContext.returnValue=state?state.getFaceResourceName(eventsFunctionContext.getArgument("FaceName")):"";`, { group: 'Per-Face Controls', expressionType: 'string' }),
];

const rhombicObjectFunctions = [...rhombicLifecycle, ...rhombicActions, ...rhombicConditions, ...rhombicExpressions];
const rhombicFunctionsFolderStructure = { folderName: '__ROOT', children: rhombicObjectFunctions.map((f) => ({ functionName: f.name })) };

/* ========================================================= Extension Assembly */

const allObjectFunctions = [
  ...objectLifecycle,
  ...customObjectActions,
  ...customObjectConditions,
  ...customObjectExpressions,
];

const eventsFunctionsFolderStructure = {
  folderName: '__ROOT',
  children: allObjectFunctions.map((f) => ({ functionName: f.name })),
};

const custom3DObject = {
  name: 'HexBipyramid3D',
  fullName: '3D Hexagonal Bipyramid',
  description: 'A 14-face beveled diamond block with canonical isometric orientation, uniform proportions, native texture uploading, dynamic half-block slicing, and collision support.',
  defaultName: 'HexBipyramid',
  is3D: true,
  isAnimatable: false,
  // Procedural mesh is attached to the generated CustomRuntimeObject3D root.
  // Keep the definition childless: a Cube3D child would render as a cube and
  // introduce a second transform hierarchy. Runtime bounds are seeded by the
  // JS lifecycle before initial-instance sizing.
  isUsingLegacyInstancesRenderer: true,
  areaMinX: 0,
  areaMaxX: 100,
  areaMinY: 0,
  areaMaxY: 100,
  areaMinZ: 0,
  areaMaxZ: 80,
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  objects: [],
  objectsFolderStructure: { folderName: '__ROOT' },
  objectsGroups: [],
  layers: [
    {
      ambientLightColorB: 200,
      ambientLightColorG: 200,
      ambientLightColorR: 200,
      camera2DPlaneMaxDrawingDistance: 5000,
      camera3DFarPlaneDistance: 10000,
      camera3DFieldOfView: 45,
      camera3DNearPlaneDistance: 3,
      cameraType: '',
      followBaseLayerCamera: false,
      isLightingLayer: false,
      isLocked: false,
      name: '',
      renderingType: '',
      visibility: true,
      cameras: [
        {
          defaultSize: true,
          defaultViewport: true,
          height: 0,
          viewportBottom: 1,
          viewportLeft: 0,
          viewportRight: 1,
          viewportTop: 0,
          width: 0,
        },
      ],
      effects: [],
    },
  ],
  instances: [],
  editionSettings: [],
  propertyDescriptors: customObjectProperties,
  propertiesFolderStructure: customObjectPropertiesFolderStructure,
  eventsFunctions: allObjectFunctions,
  eventsFunctionsFolderStructure: eventsFunctionsFolderStructure,
};

const rhombicDodecahedron3DObject = {
  name: 'RhombicDodecahedron3D',
  fullName: '3D Rhombic Dodecahedron',
  description: 'A space-filling 12-rhombus solid oriented with (1,1,1) upward, split into fixed upper/lower material groups with a horizontal center cap and six radial directions.',
  defaultName: 'RhombicDodecahedron',
  is3D: true,
  isAnimatable: false,
  // The procedural mesh is attached directly to GDevelop's CustomRuntimeObject3D
  // renderer at runtime. A Cube3D child makes the scene editor display a cube
  // and gives the custom object a second transform hierarchy, so keep this
  // first-class object childless like other procedural 3D custom objects.
  isUsingLegacyInstancesRenderer: true,
  areaMinX: 0,
  areaMaxX: 100,
  areaMinY: 0,
  areaMaxY: 100,
  areaMinZ: 0,
  areaMaxZ: 100,
  iconUrl,
  previewIconUrl: iconUrl,
  objects: [],
  objectsFolderStructure: { folderName: '__ROOT' },
  objectsGroups: [],
  layers: custom3DObject.layers,
  instances: [],
  editionSettings: [],
  propertyDescriptors: rhombicProperties,
  propertiesFolderStructure: rhombicPropertiesFolderStructure,
  eventsFunctions: rhombicObjectFunctions,
  eventsFunctionsFolderStructure: rhombicFunctionsFolderStructure,
};

const manifest = {
  $schema: 'https://raw.githubusercontent.com/4ian/GDevelop/master/newIDE/app/src/fixtures/extension-validator/extension-schema.json',
  name: 'Polygon3D',
  fullName: 'Polygon 3D',
  version: '1.8.0',
  shortDescription: 'Procedural 3D polygon objects with native per-face textures, slicing, and optional internal faces.',
  description:
    'Custom procedural 3D Object Extension suite for GDevelop. Includes HexBipyramid3D and RhombicDodecahedron3D with per-face textures and visibility, fixed upper/lower face groups, horizontal center faces, internal radial geometry, and Three.js BufferGeometry material grouping.',
  author: 'Twillion',
  license: 'MIT',
  category: '3D',
  tags: ['3d', 'procedural', 'geometry', 'polygon', 'diamond', 'bipyramid', 'hexagon', 'rhombic dodecahedron', 'fcc', 'voxel', 'threejs', 'texture'],
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  eventsBasedObjects: [custom3DObject, rhombicDodecahedron3DObject],
  eventsFunctions: freeFunctions,
};

const outputPath = path.join(here, 'Polygon3D.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');

console.log(`✨ Successfully generated Custom 3D Object Extension: ${outputPath}`);
console.log(`   - 2 Custom 3D Objects (HexBipyramid3D and RhombicDodecahedron3D)`);
console.log(`   - Uniform proportions (default 100x100x80 bounding box)`);
console.log(`   - ${customObjectProperties.length} Properties organized per-face`);
console.log(`   - ${rhombicProperties.length} RhombicDodecahedron3D properties across 49 material slots`);
console.log(`   - ${customObjectActions.length} Actions`);
console.log(`   - ${customObjectConditions.length} Conditions`);
console.log(`   - ${customObjectExpressions.length} Object Expressions`);
console.log(`   - ${freeFunctions.length} Free Grid Math Expressions`);
