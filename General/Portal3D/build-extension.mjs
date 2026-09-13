/**
 * Builds Portal3D.json from the runtime engine + declarations.
 *
 * Run: node Portal3D/build-extension.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'Portal3D.runtime.js'), 'utf8');

const NS = 'gdjs.__portal3D';

/* ------------------------------------------------------------- parameters */

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
const bool = (name, description, value = '') => ({
  name, type: 'yesorno', description, ...(value ? { defaultValue: value } : {}),
});
const col = (name, description, value = '') => ({
  name, type: 'color', description, ...(value ? { defaultValue: value } : {}),
});
const choice = (name, description, options) => ({
  name, type: 'stringWithSelector', description,
  supplementaryInformation: JSON.stringify(options),
});
const objectRef = (name, description) => ({
  name, type: 'objectList', description,
});

/* -------------------------------------------------------------- constants */

const RESOLUTIONS = ['Tiny', 'Low', 'Standard', 'SD', 'HD', 'MatchScreen', 'Custom'];
const FACES = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom'];
const SHAPES = ['Oval', 'Rectangle'];
const AXES = ['+Z', '-Z', '+X', '-X', '+Y', '-Y'];

/* ---------------------------------------------------------------- helpers */

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const evFree = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
}];

const preamble = (varName) => `const __portalObjects = eventsFunctionContext.getObjects("Object");
const object = __portalObjects.length ? __portalObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const ${varName} = ${NS};
`;

const PREAMBLE = preamble('PORTAL');

const fn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  ...(opts.sentence ? { sentence: opts.sentence } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const freeFn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  ...(opts.sentence ? { sentence: opts.sentence } : {}),
  private: false,
  parameters,
  events: evFree(code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

/* ========================================================== Portal3D ===== */

const P_SETUP = 'Setup';
const P_CONTROL = 'Control';

const PORTAL_OPTIONS = `{
  tag: behavior._getTag ? behavior._getTag() : 'Blue',
  linkedTag: behavior._getLinkedTag ? behavior._getLinkedTag() : 'Orange',
  face: behavior._getFace ? behavior._getFace() : 'Front',
  shape: behavior._getShape ? behavior._getShape() : 'Oval',
  borderColor: behavior._getBorderColor ? behavior._getBorderColor() : '#00a2ff',
  borderWidth: behavior._getBorderWidth ? behavior._getBorderWidth() : 0.08,
  preset: behavior._getResolution ? behavior._getResolution() : 'Standard',
  customW: behavior._getCustomWidth ? behavior._getCustomWidth() : 512,
  customH: behavior._getCustomHeight ? behavior._getCustomHeight() : 512,
  obliqueClipping: behavior._getObliqueClipping ? behavior._getObliqueClipping() : true,
  forwardAxis: behavior._getForwardAxis ? behavior._getForwardAxis() : '+Z',
  isOpen: behavior._getIsOpen ? behavior._getIsOpen() : true
}`;

const portalLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.registerPortal(runtimeScene, object, behavior, ${PORTAL_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.registerPortal(runtimeScene, object, behavior, ${PORTAL_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.disposePortal(runtimeScene, behavior);
`),
  },
];

const portalActions = [
  fn('SetOpen', 'Open or close the portal',
    'Set portal _PARAM0_ open: _PARAM2_', 'Action',
    [bool('Open', 'Open')],
    `const open = !!eventsFunctionContext.getArgument("Open");
if (behavior._setIsOpen) behavior._setIsOpen(open);
const p = PORTAL.portalOf(behavior);
if (p) p.isOpen = open;
`, { group: P_CONTROL }),

  fn('LinkToPortal', 'Link to another portal object',
    'Link portal _PARAM0_ to portal _PARAM2_', 'Action',
    [objectRef('TargetPortal', 'Target portal object')],
    `const targetList = eventsFunctionContext.getObjects("TargetPortal");
const targetObj = targetList.length ? targetList[0] : null;
if (!targetObj) return;
PORTAL.linkPortals(runtimeScene, object, targetObj);
`, { group: P_CONTROL }),

  fn('SetBorderColor', 'Set portal border color',
    'Set portal _PARAM0_ border color to _PARAM2_', 'Action',
    [col('Color', 'Hex color code', '#00a2ff')],
    `const color = eventsFunctionContext.getArgument("Color");
if (behavior._setBorderColor) behavior._setBorderColor(color);
const p = PORTAL.portalOf(behavior);
if (p) p.borderColor = color;
`, { group: P_SETUP }),

  fn('SetBorderWidth', 'Set portal border width',
    'Set portal _PARAM0_ border width to _PARAM2_', 'Action',
    [num('Width', 'Border width ratio (0 to 0.5)', '0.08')],
    `const w = eventsFunctionContext.getArgument("Width");
if (behavior._setBorderWidth) behavior._setBorderWidth(w);
const p = PORTAL.portalOf(behavior);
if (p) p.borderWidth = w;
`, { group: P_SETUP }),

  fn('SetResolution', 'Set portal camera resolution preset',
    'Set portal _PARAM0_ resolution to _PARAM2_', 'Action',
    [choice('Resolution', 'Resolution preset', RESOLUTIONS)],
    `const preset = eventsFunctionContext.getArgument("Resolution");
if (behavior._setResolution) behavior._setResolution(preset);
const p = PORTAL.portalOf(behavior);
if (p) p.preset = preset;
`, { group: P_SETUP }),

  fn('SetCustomResolution', 'Set portal custom resolution',
    'Set portal _PARAM0_ resolution to _PARAM2_ x _PARAM3_ pixels', 'Action',
    [num('Width', 'Width in pixels', '512'), num('Height', 'Height in pixels', '512')],
    `const w = eventsFunctionContext.getArgument("Width");
const h = eventsFunctionContext.getArgument("Height");
if (behavior._setResolution) behavior._setResolution('Custom');
if (behavior._setCustomWidth) behavior._setCustomWidth(w);
if (behavior._setCustomHeight) behavior._setCustomHeight(h);
const p = PORTAL.portalOf(behavior);
if (p) { p.preset = 'Custom'; p.customW = w; p.customH = h; }
`, { group: P_SETUP }),
];

const portalConditions = [
  fn('IsOpen', 'Check if portal is open',
    'Portal _PARAM0_ is open', 'Condition',
    [],
    `const p = PORTAL.portalOf(behavior);
eventsFunctionContext.returnValue = p ? !!p.isOpen : false;
`, { group: P_CONTROL }),

  fn('IsLinked', 'Check if portal is linked to another portal',
    'Portal _PARAM0_ is linked to a destination portal', 'Condition',
    [],
    `const p = PORTAL.portalOf(behavior);
eventsFunctionContext.returnValue = p ? !!(p.linkedPortalRecord || p.linkedTag) : false;
`, { group: P_CONTROL }),
];

const portalExpressions = [
  fn('LinkedPortalTag', 'Linked portal tag',
    'Linked portal tag', 'Expression',
    [],
    `const p = PORTAL.portalOf(behavior);
eventsFunctionContext.returnValue = p ? (p.linkedTag || '') : '';
`, { group: P_CONTROL, expressionType: 'string' }),

  fn('BorderColor', 'Border color',
    'Border color', 'Expression',
    [],
    `const p = PORTAL.portalOf(behavior);
eventsFunctionContext.returnValue = p ? (p.borderColor || '#00a2ff') : '#00a2ff';
`, { group: P_SETUP, expressionType: 'string' }),
];

const portalProperties = [
  prop('Tag', 'string', 'Portal tag (ID)',
    'Unique tag identifying this portal (e.g. Blue, Orange, PortalA)', 'Blue'),
  prop('LinkedTag', 'string', 'Linked portal tag',
    'Tag of the destination portal this portal connects to', 'Orange'),
  prop('Face', 'choice', 'Face',
    'Face of the 3D Box used as the portal opening', 'Front',
    { extraInformation: FACES }),
  prop('Shape', 'choice', 'Portal frame shape',
    'Visual frame style: Oval aperture ring or Rectangular box frame', 'Oval',
    { extraInformation: SHAPES }),
  prop('BorderColor', 'color', 'Border ring color',
    'Color of the energetic portal rim glow (e.g. #00a2ff for Blue, #ff7700 for Orange)', '#00a2ff'),
  prop('BorderWidth', 'number', 'Border ring thickness',
    'Relative thickness of the border ring (0.01 to 0.3)', '0.08'),
  prop('Resolution', 'choice', 'Resolution',
    'Resolution preset for the offscreen portal render target', 'Standard',
    { extraInformation: RESOLUTIONS }),
  prop('CustomWidth', 'number', 'Custom width',
    'Target texture width when Resolution is Custom', '512'),
  prop('CustomHeight', 'number', 'Custom height',
    'Target texture height when Resolution is Custom', '512'),
  prop('ObliqueClipping', 'boolean', 'Oblique near-plane clipping',
    'When enabled, modifies projection matrix near plane to cull geometry behind the exit portal', 'true'),
  prop('ForwardAxis', 'choice', 'Forward axis (outward normal)',
    'Local axis perpendicular to the portal face pointing outward into the room', '+Z',
    { extraInformation: AXES }),
  prop('IsOpen', 'boolean', 'Is open / active',
    'Whether the portal is currently open and rendering its destination feed', 'true'),
];

/* ============================================== PortalTraversable3D ====== */

const T_CONTROL = 'Traversal';

const TRAV_OPTIONS = `{
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,
  teleportCooldown: behavior._getTeleportCooldown ? behavior._getTeleportCooldown() : 0.15,
  redirectVelocity: behavior._getRedirectVelocity ? behavior._getRedirectVelocity() : true,
  redirectCamera: behavior._getRedirectCamera ? behavior._getRedirectCamera() : true,
  exitOffset: behavior._getExitOffset ? behavior._getExitOffset() : 20.0
}`;

const traversableLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.registerTraversable(runtimeScene, object, behavior, ${TRAV_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.registerTraversable(runtimeScene, object, behavior, ${TRAV_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(PREAMBLE + `PORTAL.disposeTraversable(runtimeScene, behavior);
`),
  },
];

const traversableActions = [
  fn('SetEnabled', 'Enable or disable portal traversal',
    'Set portal traversal for _PARAM0_: _PARAM2_', 'Action',
    [bool('Enabled', 'Enabled')],
    `const en = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(en);
const t = PORTAL.traversableOf(behavior);
if (t) t.enabled = en;
`, { group: T_CONTROL }),

  fn('SetTeleportCooldown', 'Set teleport cooldown',
    'Set teleport cooldown for _PARAM0_ to _PARAM2_ seconds', 'Action',
    [num('Seconds', 'Cooldown in seconds', '0.15')],
    `const s = eventsFunctionContext.getArgument("Seconds");
if (behavior._setTeleportCooldown) behavior._setTeleportCooldown(s);
const t = PORTAL.traversableOf(behavior);
if (t) t.teleportCooldown = s;
`, { group: T_CONTROL }),

  fn('SetExitOffset', 'Set exit nudge offset',
    'Set exit offset for _PARAM0_ to _PARAM2_', 'Action',
    [num('Offset', 'Distance to push entity along exit normal', '20')],
    `const off = eventsFunctionContext.getArgument("Offset");
if (behavior._setExitOffset) behavior._setExitOffset(off);
const t = PORTAL.traversableOf(behavior);
if (t) t.exitOffset = off;
`, { group: T_CONTROL }),
];

const traversableConditions = [
  fn('JustTeleported', 'Check if entity just teleported this frame',
    '_PARAM0_ just passed through a portal', 'Condition',
    [],
    `const t = PORTAL.traversableOf(behavior);
eventsFunctionContext.returnValue = t ? !!t.justTeleported : false;
`, { group: T_CONTROL }),

  fn('IsEnabled', 'Check if portal traversal is enabled',
    'Portal traversal is enabled for _PARAM0_', 'Condition',
    [],
    `const t = PORTAL.traversableOf(behavior);
eventsFunctionContext.returnValue = t ? !!t.enabled : false;
`, { group: T_CONTROL }),
];

const traversableExpressions = [
  fn('LastPortalTag', 'Last portal tag traversed',
    'Last portal tag traversed', 'Expression',
    [],
    `const t = PORTAL.traversableOf(behavior);
eventsFunctionContext.returnValue = t ? (t.lastPortalTag || '') : '';
`, { group: T_CONTROL, expressionType: 'string' }),
];

const traversableProperties = [
  prop('Enabled', 'boolean', 'Traversable enabled',
    'Whether this object can physically teleport through active portals', 'true'),
  prop('TeleportCooldown', 'number', 'Teleport cooldown (seconds)',
    'Minimum delay between consecutive teleports to prevent ping-pong oscillation', '0.15'),
  prop('RedirectVelocity', 'boolean', 'Redirect velocity & momentum',
    'Rotates linear velocity vectors to match exit portal orientation while preserving speed', 'true'),
  prop('RedirectCamera', 'boolean', 'Redirect camera / object rotation',
    'Rotates object and camera yaw/pitch to face outwards from destination portal', 'true'),
  prop('ExitOffset', 'number', 'Exit normal offset distance',
    'Units to nudge object forward along destination portal normal upon emergence', '20'),
];

/* ==================================================== Free Instructions == */

const freeActions = [
  freeFn('TeleportObjectThrough', 'Manually teleport an object through portals',
    'Teleport _PARAM0_ from _PARAM1_ through portal _PARAM2_ (redirect velocity: _PARAM3_)',
    'Action',
    [
      objectRef('Object', 'Object to teleport'),
      objectRef('EntryPortal', 'Entry portal object'),
      objectRef('ExitPortal', 'Exit portal object'),
      bool('RedirectVelocity', 'Redirect velocity', 'true')
    ],
    `if (!${NS}) return;
const objList = eventsFunctionContext.getObjects("Object");
const entryList = eventsFunctionContext.getObjects("EntryPortal");
const exitList = eventsFunctionContext.getObjects("ExitPortal");
if (!objList.length || !entryList.length || !exitList.length) return;
const redirectVel = !!eventsFunctionContext.getArgument("RedirectVelocity");
${NS}.teleportObjectManual(runtimeScene, objList[0], entryList[0], exitList[0], redirectVel);
`, { group: 'Portal Utilities' })
];

/* ===================================================== Assembly & Lint === */

const portalBehavior = {
  name: 'Portal3D',
  fullName: 'Portal (3D)',
  description: 'Turns a 3D Box face or surface into an interactive visual portal linked to another portal.',
  objectType: '',
  propertyDescriptors: portalProperties,
  eventsFunctions: [
    ...portalLifecycle,
    ...portalActions,
    ...portalConditions,
    ...portalExpressions,
  ],
};

const traversableBehavior = {
  name: 'PortalTraversable3D',
  fullName: 'Portal Traversable (3D)',
  description: 'Allows characters and physics objects to pass seamlessly through 3D portals with momentum redirection.',
  objectType: '',
  propertyDescriptors: traversableProperties,
  eventsFunctions: [
    ...traversableLifecycle,
    ...traversableActions,
    ...traversableConditions,
    ...traversableExpressions,
  ],
};

const extension = {
  name: 'Portal3D',
  fullName: 'Portal 3D (Valve-style Visual & Physical Portals)',
  version: '1.0.0',
  description: 'Real-time perspective-matched visual portals and seamless physical/momentum teleportation inspired by Valve\'s Portal series.',
  shortDescription: 'Valve-style visual and physical portals in 3D.',
  author: 'Twillion',
  category: 'General',
  extensionNamespace: '',
  tags: ['3d', 'portal', 'camera', 'teleport', 'physics', 'render-to-texture'],
  behaviors: [portalBehavior, traversableBehavior],
  eventsFunctions: [...freeActions],
};

/* ----------------------------------------------------------------- Linting */

let blocks = 0;
const walkEvents = (fns, where) => {
  for (const f of fns) {
    for (const e of f.events || []) {
      if (e.type !== 'BuiltinCommonInstructions::JsCode') continue;
      blocks++;
      try {
        new Function('runtimeScene', 'eventsFunctionContext', e.inlineCode);
      } catch (err) {
        console.error(`\nSyntax error in ${where}.${f.name}:\n  ${err.message}\n`);
        process.exit(1);
      }
      const body = e.inlineCode.startsWith(runtime)
        ? e.inlineCode.slice(runtime.length)
        : e.inlineCode;
      for (const [ident, usage] of [
        ['PORTAL', /(^|[^\w.$])PORTAL\b/],
        ['object', /(^|[^\w.$])object\.\w/],
        ['behavior', /(^|[^\w.$])behavior\.\w/],
      ]) {
        const declared = new RegExp(`(?:const|let|var)\\s+${ident}\\b`).test(body);
        if (usage.test(body) && !declared) {
          console.error(
            `\n${where}.${f.name} uses "${ident}" but never declares it.`
          );
          process.exit(1);
        }
      }
    }
  }
};
walkEvents(portalBehavior.eventsFunctions, portalBehavior.name);
walkEvents(traversableBehavior.eventsFunctions, traversableBehavior.name);
walkEvents(extension.eventsFunctions, 'free');

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
  'stringWithSelector', 'color', 'layer',
]);
const allFns = [
  ...portalBehavior.eventsFunctions,
  ...traversableBehavior.eventsFunctions,
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

// Object parameter rule: Only parameter 0 of behavior function can be "object", all others "objectList"
const checkObjectParams = (fns, where, isBehavior) => {
  for (const f of fns) {
    f.parameters.forEach((p, i) => {
      if (p.type !== 'object') return;
      if (isBehavior && i === 0 && p.name === 'Object') return;
      console.error(
        `\n${where}.${f.name}: parameter "${p.name}" (index ${i}) is type "object". Use "objectList".\n`
      );
      process.exit(1);
    });
  }
};
checkObjectParams(portalBehavior.eventsFunctions, portalBehavior.name, true);
checkObjectParams(traversableBehavior.eventsFunctions, traversableBehavior.name, true);
checkObjectParams(extension.eventsFunctions, 'free', false);

// Check resolution presets agreement with runtime
for (const name of RESOLUTIONS) {
  if (name === 'Custom') continue;
  if (!runtime.includes(name + ':')) {
    console.error(`\nResolution preset "${name}" is offered in editor but absent from runtime.\n`);
    process.exit(1);
  }
}

const out = path.join(here, 'Portal3D.json');
fs.writeFileSync(out, json, 'utf8');

console.log(`Wrote ${path.basename(out)}  (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${blocks} JS blocks parsed clean`);
