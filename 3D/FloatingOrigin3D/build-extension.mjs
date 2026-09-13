/**
 * build-extension.mjs
 * Builds FloatingOrigin3D.json from the runtime engine + declarations.
 *
 * Run: node "Multi extension work space folder/FloatingOrigin3D/build-extension.mjs"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const runtime = fs.readFileSync(path.join(here, 'FloatingOrigin3D.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const NS = 'gdjs.__floatingOrigin3D';

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });

const PREAMBLE = `const __foObjects = eventsFunctionContext.getObjects("Object");
const object = __foObjects.length ? __foObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const FO = ${NS};
const state = FO.getState(behavior);
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
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

const lifecycle = [
  {
    name: 'onCreated',
    fullName: 'On Created',
    sentence: '',
    description: 'Initializes the Floating Origin 3D tracker on the object.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
${NS}.getState(behavior);
`, { withRuntime: true }),
  },
  {
    name: 'doStepPostEvents',
    fullName: 'Post-events step',
    sentence: '',
    description: 'Checks distance threshold and applies silent origin recentering if exceeded.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
const state = ${NS}.getState(behavior);
if (state) state.step(runtimeScene);
`),
  },
  {
    name: 'onDestroy',
    fullName: 'On Destroyed',
    sentence: '',
    description: 'Cleans up Floating Origin 3D tracking resources.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`// Clean up state
`),
  },
];

const actions = [
  fn(
    'ManualShiftOrigin',
    'Manually trigger origin shift',
    'Manually trigger origin shift on _PARAM0_',
    'Forces an immediate scene and physics origin re-centering based on the object position.',
    'Action',
    [],
    `const posX = typeof object.getX === 'function' ? object.getX() : 0.0;
const posY = typeof object.getY === 'function' ? object.getY() : 0.0;
const posZ = typeof object.getZ === 'function' ? object.getZ() : 0.0;
state.applyOriginShift(runtimeScene, posX, posY, posZ);
`,
    { group: 'Origin Control' }
  ),
  fn(
    'SetShiftThreshold',
    'Set shift threshold distance',
    'Set origin shift threshold distance on _PARAM0_ to _PARAM1_ meters',
    'Updates the threshold distance in meters before origin shifting occurs.',
    'Action',
    [num('Threshold', 'Shift threshold in meters (e.g. 1000.0)')],
    `const val = eventsFunctionContext.getArgument("Threshold");
state.shiftThreshold = Number(val) > 0 ? Number(val) : 1000.0;
`,
    { group: 'Origin Control' }
  ),
];

const conditions = [
  fn(
    'HasOriginShifted',
    'Has origin recently shifted',
    'Has origin recently shifted on _PARAM0_',
    'Returns true during the single frame when a Floating Origin shift occurs.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = state ? state.hasRecentlyShifted : false;
`,
    { group: 'Origin Control' }
  ),
];

const expressions = [
  fn(
    'OriginWorldX',
    'Origin World X',
    'Get true 64-bit world origin X coordinate on _PARAM0_',
    'Returns the true cumulative 64-bit world origin X coordinate in meters.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.originWorldX : 0.0;
`,
    { group: 'Coordinates' }
  ),
  fn(
    'OriginWorldY',
    'Origin World Y',
    'Get true 64-bit world origin Y coordinate on _PARAM0_',
    'Returns the true cumulative 64-bit world origin Y coordinate in meters.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.originWorldY : 0.0;
`,
    { group: 'Coordinates' }
  ),
  fn(
    'OriginWorldZ',
    'Origin World Z',
    'Get true 64-bit world origin Z coordinate on _PARAM0_',
    'Returns the true cumulative 64-bit world origin Z coordinate in meters.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.originWorldZ : 0.0;
`,
    { group: 'Coordinates' }
  ),
  fn(
    'TruePlayerWorldX',
    'True Player World X',
    'Get full double-precision Player X coordinate on _PARAM0_',
    'Returns the full double-precision Player X coordinate (OriginWorldX + LocalX).',
    'Expression',
    [],
    `const posX = typeof object.getX === 'function' ? object.getX() : 0.0;
eventsFunctionContext.returnValue = state ? state.getTruePlayerWorldX(posX) : posX;
`,
    { group: 'Coordinates' }
  ),
  fn(
    'TruePlayerWorldY',
    'True Player World Y',
    'Get full double-precision Player Y coordinate on _PARAM0_',
    'Returns the full double-precision Player Y coordinate (OriginWorldY + LocalY).',
    'Expression',
    [],
    `const posY = typeof object.getY === 'function' ? object.getY() : 0.0;
eventsFunctionContext.returnValue = state ? state.getTruePlayerWorldY(posY) : posY;
`,
    { group: 'Coordinates' }
  ),
  fn(
    'TruePlayerWorldZ',
    'True Player World Z',
    'Get full double-precision Player Z coordinate on _PARAM0_',
    'Returns the full double-precision Player Z coordinate (OriginWorldZ + LocalZ).',
    'Expression',
    [],
    `const posZ = typeof object.getZ === 'function' ? object.getZ() : 0.0;
eventsFunctionContext.returnValue = state ? state.getTruePlayerWorldZ(posZ) : posZ;
`,
    { group: 'Coordinates' }
  ),
];

const extension = {
  $schema: 'https://raw.githubusercontent.com/4ian/GDevelop/master/newIDE/app/src/fixtures/extension-schema.json',
  name: 'FloatingOrigin3D',
  version: '1.0.0',
  author: 'Twillion',
  shortDescription: '64-bit double precision coordinates and atomic Jolt Physics / Three.js origin shifting for massive open worlds.',
  description: 'Eliminates 32-bit floating-point vertex jitter on 50km+ open worlds by accumulating double-precision world coordinates and atomically re-centering the Three.js scene and Jolt 3D physics worlds every 1km without visual hitching.',
  category: '3D',
  tags: '3d,open-world,coordinates,physics,origin-shift,threejs,jolt,precision',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  eventsBasedBehaviors: [
    {
      name: 'FloatingOrigin3D',
      fullName: 'Floating Origin 3D (Large World Coordinates)',
      description: 'Coordinates 64-bit double precision tracking and atomic origin shifts for the player camera and physics world.',
      objectType: '',
      propertyDescriptors: [
        {
          name: 'ShiftThreshold',
          label: 'Shift Threshold (Meters)',
          description: 'Distance in meters from local origin before triggering a silent re-centering shift.',
          type: 'Number',
          value: '1000.0',
          group: 'Origin Shift Settings',
        },
        {
          name: 'StepSize',
          label: 'Quantized Step Size (Meters)',
          description: 'Quantized snap distance in meters for origin shifts.',
          type: 'Number',
          value: '1000.0',
          group: 'Origin Shift Settings',
        },
        {
          name: 'EnablePhysicsShift',
          label: 'Enable Jolt Physics Shift',
          description: 'Automatically shifts Jolt 3D Physics simulation bodies synchronously with the scene.',
          type: 'Boolean',
          value: 'true',
          group: 'Origin Shift Settings',
        },
      ],
      eventsFunctions: [
        ...lifecycle,
        ...actions,
        ...conditions,
        ...expressions,
      ],
    },
  ],
  eventsFunctions: [],
  globalVariables: [],
  sceneVariables: [],
};

const outputPath = path.join(here, 'FloatingOrigin3D.json');
fs.writeFileSync(outputPath, JSON.stringify(extension, null, 2), 'utf8');
console.log(`Successfully generated ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
