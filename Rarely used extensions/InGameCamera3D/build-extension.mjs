/**
 * Builds InGameCamera3D.json from the runtime engine + declarations.
 *
 * Run: node InGameCamera3D/build-extension.mjs
 *
 * Guards run before anything is written, because each class of bug has
 * shipped from this repo before (see AnimatedPBR3D/REVIEW.md, and the
 * NUL-byte post-mortem in ExternalSkeletalAnimator3D):
 *   1. the raw text is scanned for control characters, by char code
 *   2. every generated inlineCode block is parsed with `new Function`
 *   3. the output is linted for wrong schema keys and parameter types
 *   4. the Cube3D face table is asserted against the installed runtime
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'InGameCamera3D.runtime.js'), 'utf8');

const NS = 'gdjs.__inGameCamera3D';

/* ------------------------------------------------------------- parameters */

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
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
/**
 * An EXTRA object parameter must be `objectList`, not `object`.
 *
 * `object` is the type used for parameter 0 of a behavior function, which
 * GDevelop supplies from the owner and strips from the generated signature.
 * Declaring a second one as `object` makes the editor drop it: the call site
 * is emitted with the remaining arguments shifted up by one, and the function
 * receives a string where it expects a Hashtable —
 *   TypeError: e.values is not a function   (in gdjs.objectsListsToArray)
 * ExternalSkeletalAnimator3D::AttachObjectToBone uses `objectList` for the
 * same reason.
 *
 * No paired `behavior` parameter: the runtime finds the camera by scanning the
 * object's behaviors for its own marker, which also survives the behavior
 * being renamed on that object.
 */
const cameraObject = () => ([
  { name: 'CameraObject', type: 'objectList', description: 'Camera object' },
]);

/* -------------------------------------------------------------- constants */

const RESOLUTIONS = ['Tiny', 'Low', 'Standard', 'SD', 'HD', 'Custom'];
const FACES = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom'];
const FILTERING = ['Linear', 'Nearest'];
const SHADOW_MODES = ['Reuse', 'PerPass'];
const AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
const FITS = ['Stretch', 'Uniform', 'None'];


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

/** `object` / `behavior` are NOT in scope inside a JsCode block. */
const preamble = (varName) => `const __igcObjects = eventsFunctionContext.getObjects("Object");
const object = __igcObjects.length ? __igcObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const ${varName} = ${NS};
`;

const PREAMBLE = preamble('IGC');
const CAM = PREAMBLE;
const SCR = PREAMBLE;

/**
 * Every behavior function body gets the preamble: `object`, `behavior` and
 * `IGC` are NOT in scope inside a JsCode block, and a body that assumes they
 * are fails with "ReferenceError: IGC is not defined" at the call, not at
 * build time.
 */
const fn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  ...(opts.sentence ? { sentence: opts.sentence } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

const freeFn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters,
  events: evFree(code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

/* =========================================================== Camera3D ==== */

const CAM_SETUP = 'Setup';
const CAM_CONTROL = 'Control';

/** Read every behavior property into the options object the runtime expects. */
const CAM_OPTIONS = `{
  preset: behavior._getResolution ? behavior._getResolution() : 'Standard',
  customW: behavior._getWidth ? behavior._getWidth() : 512,
  customH: behavior._getHeight ? behavior._getHeight() : 512,
  filtering: behavior._getFiltering ? behavior._getFiltering() : 'Linear',
  samples: behavior._getAntialiasing ? behavior._getAntialiasing() : 0,
  fov: behavior._getFOV ? behavior._getFOV() : 60,
  near: behavior._getNear ? behavior._getNear() : 3,
  far: behavior._getFar ? behavior._getFar() : 2000,
  fpsCap: behavior._getFPSCap ? behavior._getFPSCap() : 0,
  enabled: behavior._getEnabled ? behavior._getEnabled() : true,
  shadowMode: behavior._getShadowMode ? behavior._getShadowMode() : 'Reuse',
  forwardAxis: behavior._getForwardAxis ? behavior._getForwardAxis() : '+X'
}`;

const cameraLifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(CAM + `IGC.registerCamera(runtimeScene, object, behavior, ${CAM_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    // Re-registering each step is what lets the editor's property panel and a
    // mid-game layer change both take effect without any extra plumbing (C18).
    events: ev(CAM + `IGC.registerCamera(runtimeScene, object, behavior, ${CAM_OPTIONS});
`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(CAM + `IGC.disposeCamera(runtimeScene, behavior);
`),
  },
];

const cameraActions = [
  fn('SetEnabled', 'Turn the camera on or off',
    'Turn camera _PARAM0_ on: _PARAM2_', 'Action',
    [bool('Enabled', 'Enabled')],
    `const cam = IGC.cameraOf(behavior);
if (cam) cam.enabled = !!eventsFunctionContext.getArgument("Enabled");
if (behavior._setEnabled) behavior._setEnabled(!!eventsFunctionContext.getArgument("Enabled"));
`, { group: CAM_CONTROL }),

  fn('SetResolution', 'Set the camera resolution',
    'Set the resolution of camera _PARAM0_ to _PARAM2_', 'Action',
    [choice('Resolution', 'Resolution', RESOLUTIONS)],
    `const preset = eventsFunctionContext.getArgument("Resolution");
if (behavior._setResolution) behavior._setResolution(preset);
const cam = IGC.cameraOf(behavior);
if (cam) cam.preset = preset;
`, { group: CAM_SETUP }),

  fn('SetCustomResolution', 'Set a custom camera resolution',
    'Set the resolution of camera _PARAM0_ to _PARAM2_ x _PARAM3_ pixels', 'Action',
    [num('Width', 'Width in pixels', '512'), num('Height', 'Height in pixels', '512')],
    `const w = eventsFunctionContext.getArgument("Width");
const h = eventsFunctionContext.getArgument("Height");
if (behavior._setResolution) behavior._setResolution('Custom');
if (behavior._setWidth) behavior._setWidth(w);
if (behavior._setHeight) behavior._setHeight(h);
const cam = IGC.cameraOf(behavior);
if (cam) { cam.preset = 'Custom'; cam.customW = w; cam.customH = h; }
`, { group: CAM_SETUP }),

  fn('SetFiltering', 'Set the camera filtering',
    'Set the filtering of camera _PARAM0_ to _PARAM2_', 'Action',
    [choice('Filtering', 'Filtering', FILTERING)],
    `const mode = eventsFunctionContext.getArgument("Filtering");
if (behavior._setFiltering) behavior._setFiltering(mode);
const cam = IGC.cameraOf(behavior);
if (cam) cam.filtering = mode;
`, { group: CAM_SETUP }),

  fn('SetFOV', 'Set the camera field of view',
    'Set the field of view of camera _PARAM0_ to _PARAM2_', 'Action',
    [num('FOV', 'Field of view, in degrees', '60')],
    `const fov = eventsFunctionContext.getArgument("FOV");
if (behavior._setFOV) behavior._setFOV(fov);
const cam = IGC.cameraOf(behavior);
if (cam) cam.fov = fov;
`, { group: CAM_CONTROL }),

  fn('SetClipping', 'Set the camera clipping planes',
    'Set the clipping planes of camera _PARAM0_ to near _PARAM2_, far _PARAM3_', 'Action',
    [num('Near', 'Near plane distance', '3'), num('Far', 'Far plane distance', '2000')],
    `const near = eventsFunctionContext.getArgument("Near");
const far = eventsFunctionContext.getArgument("Far");
if (behavior._setNear) behavior._setNear(near);
if (behavior._setFar) behavior._setFar(far);
const cam = IGC.cameraOf(behavior);
if (cam) { cam.near = near; cam.far = far; }
`, { group: CAM_CONTROL }),

  fn('SetFPSCap', 'Cap the camera frame rate',
    'Cap camera _PARAM0_ to _PARAM2_ frames per second', 'Action',
    [num('FPS', 'Frames per second (0 = every frame)', '15')],
    `const fps = eventsFunctionContext.getArgument("FPS");
if (behavior._setFPSCap) behavior._setFPSCap(fps);
const cam = IGC.cameraOf(behavior);
if (cam) cam.fpsCap = fps;
`, { group: CAM_CONTROL }),

  fn('SetForwardAxis', 'Set which way the camera looks',
    'Make camera _PARAM0_ look along its _PARAM2_ axis', 'Action',
    [choice('Axis', 'Local axis the camera looks along', AXES)],
    `const axis = eventsFunctionContext.getArgument("Axis");
if (behavior._setForwardAxis) behavior._setForwardAxis(axis);
const cam = IGC.cameraOf(behavior);
if (cam) cam.forwardAxis = axis;
`, { group: CAM_SETUP }),
];

const cameraConditions = [
  fn('IsEnabled', 'Camera is on', 'Camera _PARAM0_ is on', 'Condition', [],
    `const cam = IGC.cameraOf(behavior);
eventsFunctionContext.returnValue = !!(cam && cam.enabled);
`, { group: CAM_CONTROL }),
];

const cameraExpressions = [
  fn('TargetWidth', 'Camera texture width', 'Width of this camera’s texture, in pixels.',
    'Expression', [],
    `const cam = IGC.cameraOf(behavior);
eventsFunctionContext.returnValue = cam && cam.target ? cam.target.width : 0;
`, { group: CAM_SETUP }),

  fn('TargetHeight', 'Camera texture height', 'Height of this camera’s texture, in pixels.',
    'Expression', [],
    `const cam = IGC.cameraOf(behavior);
eventsFunctionContext.returnValue = cam && cam.target ? cam.target.height : 0;
`, { group: CAM_SETUP }),

  fn('FOV', 'Camera field of view', 'Field of view of this camera, in degrees.',
    'Expression', [],
    `const cam = IGC.cameraOf(behavior);
eventsFunctionContext.returnValue = cam ? cam.fov : 0;
`, { group: CAM_CONTROL }),
];

const cameraBehavior = {
  name: 'Camera3D',
  fullName: 'In-game camera (3D)',
  description:
    'Turns this object into a camera. It films the 3D layer it sits on, from wherever ' +
    'you put it, and the result can be shown on any screen carrying the "Live screen" ' +
    'behavior. Aim it by moving and rotating the object — with a tween, a behavior, or ' +
    'by hand. The camera never appears in its own picture.',
  objectType: '',
  propertyDescriptors: [
    prop('Resolution', 'Choice', 'Resolution',
      'Size of this camera’s texture. It sets the shape of the shot as well as the ' +
      'detail — SD is 4:3, HD is 16:9 — so changing it re-frames the picture. Lower ' +
      'costs less and gives a genuinely low-resolution image rather than a filter.',
      'Standard',
      { extraInformation: RESOLUTIONS }),
    prop('Width', 'Number', 'Custom width', 'Used only when Resolution is Custom.', '512'),
    prop('Height', 'Number', 'Custom height', 'Used only when Resolution is Custom.', '512'),
    prop('Filtering', 'Choice', 'Filtering',
      'Nearest keeps a crisp pixel grid at low resolutions. Linear smooths it. ' +
      'Low resolution with Nearest is the classic security-camera look.', 'Linear',
      { extraInformation: FILTERING }),
    prop('FOV', 'Number', 'Field of view', 'In degrees.', '60'),
    prop('Near', 'Number', 'Near plane',
      'Anything closer to the camera than this is not filmed.', '3'),
    prop('Far', 'Number', 'Far plane',
      'Anything further from the camera than this is not filmed.', '2000'),
    prop('FPSCap', 'Number', 'Frame rate cap',
      'How often this camera re-renders, in frames per second. 0 means every frame. ' +
      'Lowering it is the single biggest saving available, and 10 to 15 also gives an ' +
      'authentic surveillance judder.', '0'),
    prop('Enabled', 'Boolean', 'On',
      'When off, the camera stops rendering and its screens keep the last frame they ' +
      'were given — so a switched-off camera still looks like a working monitor.',
      'true'),
    prop('ShadowMode', 'Choice', 'Shadows',
      'Reuse borrows the shadows already computed for the player’s view. It is much ' +
      'faster, and it is why this is the default, but shadows can look stale somewhere ' +
      'the player has never looked. PerPass recomputes them at full cost.',
      'Reuse', { extraInformation: SHADOW_MODES }),
    prop('Antialiasing', 'Number', 'Antialiasing samples',
      'Smooths jagged edges in the camera picture. 0 is off. Leave it off at low ' +
      'resolutions — it softens the very pixel grid those presets exist to show. ' +
      'Worth turning on only for HD screens the player gets close to.', '0'),
    prop('ForwardAxis', 'Choice', 'Films along',
      'Which of this object’s own axes the camera looks down. +X means an angle of 0 ' +
      'faces right, the same as a 2D sprite. Change it if you put this behavior on a ' +
      'camera model that points a different way.',
      '+X', { extraInformation: AXES }),
  ],
  eventsFunctions: [
    ...cameraLifecycle, ...cameraActions, ...cameraConditions, ...cameraExpressions,
  ],
};

/* ========================================================= LiveScreen ==== */

const SCR_BIND = 'Screen';

const SCREEN_SPEC = `{
  materialMode: behavior._getMaterialMode ? behavior._getMaterialMode() : 'Unlit',
  doubleSided: behavior._getDoubleSided ? behavior._getDoubleSided() : false
}`;

const screenLifecycle = [
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(SCR + `IGC.unbind(runtimeScene, behavior);
`),
  },
];

const screenActions = [
  fn('BindToCubeFace', 'Show a camera on a 3D Box face',
    'Show camera _PARAM2_ on the _PARAM3_ face of _PARAM0_', 'Action',
    [...cameraObject(), choice('Face', 'Face', FACES)],
    `const camObjects = eventsFunctionContext.getObjects("CameraObject");
const camObject = camObjects.length ? camObjects[0] : null;
if (!camObject) return;
const cam = IGC.findCamera(camObject);
if (!cam) {
  console.warn('[InGameCamera3D] "' + camObject.getName() +
    '" has no In-game camera behavior, so there is nothing to show.');
  return;
}
const spec = ${SCREEN_SPEC};
spec.kind = 'cube';
spec.faceName = eventsFunctionContext.getArgument("Face");
IGC.bind(runtimeScene, object, behavior, cam, spec);
`, { group: SCR_BIND }),

  fn('BindLayerViewToCubeFace', 'Show a 3D layer on a 3D Box face',
    'Show the view of 3D layer _PARAM2_ on the _PARAM3_ face of _PARAM0_', 'Action',
    [layer('Layer', '3D layer to film'), choice('Face', 'Face', FACES)],
    `const layerName = eventsFunctionContext.getArgument("Layer");
// Binding a screen to a layer plainly means "film this layer", so start
// filming it if nothing has yet. Requiring a separate "Film a layer" action
// first made this a silent no-op, which is indistinguishable from a bug.
let cam = IGC.layerView(runtimeScene, layerName);
if (!cam) cam = IGC.enableLayerView(runtimeScene, layerName, {});
if (!cam) return;
const spec = ${SCREEN_SPEC};
spec.kind = 'cube';
spec.faceName = eventsFunctionContext.getArgument("Face");
IGC.bind(runtimeScene, object, behavior, cam, spec);
`, { group: SCR_BIND }),

  fn('Bind2DLayerToCubeFace', 'Show a 2D layer on a 3D Box face',
    'Show 2D layer _PARAM2_ on the _PARAM3_ face of _PARAM0_', 'Action',
    [layer('Layer', '2D layer to capture'), choice('Face', 'Face', FACES)],
    `const layerName = eventsFunctionContext.getArgument("Layer");
let cam = IGC.layerCapture(runtimeScene, layerName);
if (!cam) cam = IGC.enable2DLayer(runtimeScene, layerName, {});
if (!cam) return;
const spec = ${SCREEN_SPEC};
spec.kind = 'cube';
spec.faceName = eventsFunctionContext.getArgument("Face");
IGC.bind(runtimeScene, object, behavior, cam, spec);
`, { group: SCR_BIND }),

  fn('Unbind', 'Stop showing a feed', 'Stop showing a feed on _PARAM0_', 'Action', [],
    `IGC.unbind(runtimeScene, behavior);
`, { group: SCR_BIND }),
];

const screenConditions = [
  fn('IsBound', 'Screen is showing a feed', '_PARAM0_ is showing a live feed',
    'Condition', [],
    `const b = IGC.bindingOf(behavior);
eventsFunctionContext.returnValue = !!(b && b.slots && b.camera);
`, { group: SCR_BIND }),
];

const screenExpressions = [];

const screenBehavior = {
  name: 'LiveScreen',
  fullName: 'Live screen (3D)',
  description:
    'Shows a live feed on a face of this 3D Box. The feed can come from an in-game ' +
    'camera, from a whole 3D layer, or straight from a 2D layer — useful for arcade ' +
    'cabinets and computer screens.',
  objectType: '',
  propertyDescriptors: [
    prop('MaterialMode', 'Choice', 'Screen lighting',
      'Unlit keeps the screen at full brightness, like a real monitor. Lit lets the ' +
      'scene’s lighting dim it. Neither makes the screen light up the room — add a ' +
      'light for that.', 'Unlit',
      { extraInformation: ['Unlit', 'Lit'] }),
    prop('DoubleSided', 'Boolean', 'Visible from both sides',
      'Draw the screen from behind as well as in front.', 'false'),
  ],
  eventsFunctions: [
    ...screenLifecycle, ...screenActions, ...screenConditions, ...screenExpressions,
  ],
};

/* ====================================================== free functions ==== */

const LAYER_GROUP = '3D layer view';
const LAYER2D_GROUP = '2D layer capture';

const freeFunctions = [
  freeFn('EnableLayerViewCamera', 'Film a 3D layer',
    'Start filming 3D layer _PARAM0_ at _PARAM1_ resolution, capped to _PARAM2_ FPS',
    'Action',
    [
      layer('Layer', '3D layer to film'),
      choice('Resolution', 'Resolution', RESOLUTIONS),
      num('FPS', 'Frame rate cap (0 = every frame)', '0'),
    ],
    `if (!${NS}) return;
${NS}.enableLayerView(runtimeScene, eventsFunctionContext.getArgument("Layer"), {
  preset: eventsFunctionContext.getArgument("Resolution"),
  fpsCap: eventsFunctionContext.getArgument("FPS"),
  enabled: true
});
`, { group: LAYER_GROUP, withRuntime: true }),

  freeFn('DisableLayerViewCamera', 'Stop filming a 3D layer',
    'Stop filming 3D layer _PARAM0_', 'Action',
    [layer('Layer', 'Layer')],
    `if (!${NS}) return;
${NS}.disableLayerView(runtimeScene, eventsFunctionContext.getArgument("Layer"));
`, { group: LAYER_GROUP }),

  freeFn('SetLayerViewFPSCap', 'Set the frame rate of a 3D layer view',
    'Set the frame rate of the 3D layer _PARAM0_ view to _PARAM1_ FPS', 'Action',
    [layer('Layer', 'Layer'), num('FPS', 'Frames per second (0 = every frame)', '15')],
    `if (!${NS}) return;
const cam = ${NS}.layerView(runtimeScene, eventsFunctionContext.getArgument("Layer"));
if (cam) cam.fpsCap = eventsFunctionContext.getArgument("FPS");
`, { group: LAYER_GROUP }),

  freeFn('SetLayerViewResolution', 'Set the resolution of a 3D layer view',
    'Set the resolution of the 3D layer _PARAM0_ view to _PARAM1_', 'Action',
    [layer('Layer', 'Layer'), choice('Resolution', 'Resolution', RESOLUTIONS)],
    `if (!${NS}) return;
const cam = ${NS}.layerView(runtimeScene, eventsFunctionContext.getArgument("Layer"));
if (cam) cam.preset = eventsFunctionContext.getArgument("Resolution");
`, { group: LAYER_GROUP }),

  freeFn('IsFilmingLayer', 'A 3D layer is being filmed',
    '3D layer _PARAM0_ is being filmed',
    'Condition', [layer('Layer', 'Layer')],
    `if (!${NS}) { eventsFunctionContext.returnValue = false; return; }
const cam = ${NS}.layerView(runtimeScene, eventsFunctionContext.getArgument("Layer"));
eventsFunctionContext.returnValue = !!(cam && cam.enabled);
`, { group: LAYER_GROUP }),

  freeFn('Enable2DLayerCapture', 'Capture a 2D layer',
    'Start capturing 2D layer _PARAM0_ at _PARAM1_ resolution, scaling _PARAM2_, capped to _PARAM3_ FPS',
    'Action',
    [
      layer('Layer', '2D layer to capture'),
      choice('Resolution', 'Resolution', RESOLUTIONS),
      choice('Fit', 'How the layer fills the texture', FITS),
      num('FPS', 'Frame rate cap (0 = every frame)', '0'),
    ],
    `if (!${NS}) return;
${NS}.enable2DLayer(runtimeScene, eventsFunctionContext.getArgument("Layer"), {
  preset: eventsFunctionContext.getArgument("Resolution"),
  fit: eventsFunctionContext.getArgument("Fit"),
  fpsCap: eventsFunctionContext.getArgument("FPS"),
  enabled: true
});
`, { group: LAYER2D_GROUP, withRuntime: true }),

  freeFn('Disable2DLayerCapture', 'Stop capturing a 2D layer',
    'Stop capturing 2D layer _PARAM0_', 'Action',
    [layer('Layer', 'Layer')],
    `if (!${NS}) return;
${NS}.disable2DLayer(runtimeScene, eventsFunctionContext.getArgument("Layer"));
`, { group: LAYER2D_GROUP }),

  freeFn('Set2DLayerCaptureFPSCap', 'Set the frame rate of a 2D layer capture',
    'Set the frame rate of the 2D layer _PARAM0_ capture to _PARAM1_ FPS', 'Action',
    [layer('Layer', 'Layer'), num('FPS', 'Frames per second (0 = every frame)', '30')],
    `if (!${NS}) return;
const cam = ${NS}.layerCapture(runtimeScene, eventsFunctionContext.getArgument("Layer"));
if (cam) cam.fpsCap = eventsFunctionContext.getArgument("FPS");
`, { group: LAYER2D_GROUP }),

  freeFn('IsCapturing2DLayer', 'A 2D layer is being captured',
    '2D layer _PARAM0_ is being captured', 'Condition',
    [layer('Layer', 'Layer')],
    `if (!${NS}) { eventsFunctionContext.returnValue = false; return; }
const cam = ${NS}.layerCapture(runtimeScene, eventsFunctionContext.getArgument("Layer"));
eventsFunctionContext.returnValue = !!(cam && cam.enabled);
`, { group: LAYER2D_GROUP }),

  freeFn('TotalTextureMemoryMB', 'Live feed texture memory (MB)',
    'Approximate GPU memory used by every live feed in this scene, in megabytes.',
    'Expression', [],
    `if (!${NS}) { eventsFunctionContext.returnValue = 0; return; }
eventsFunctionContext.returnValue = ${NS}.textureMemoryMB(runtimeScene);
`, { group: 'Diagnostics' }),
];

/* ------------------------------------------------------------- extension */

const extension = {
  author: 'Twillion',
  category: '3D',
  extensionNamespace: '',
  fullName: 'In-Game Camera 3D',
  name: 'InGameCamera3D',
  version: '0.3.0',
  description:
    'Put a live picture on a screen inside your game: security monitors, television ' +
    'sets, rear-view mirrors, arcade cabinets and computer terminals. ' +
    'Add the "In-game camera" behavior to any 3D object and it films the layer it ' +
    'sits on from wherever you place it, so aiming a camera is just moving an object. ' +
    'You can also show a whole 3D layer through its own camera, or take a 2D layer ' +
    'straight onto a screen — a hidden 2D layer keeps running, so a minigame on an ' +
    'arcade cabinet is genuinely playable rather than a recording. ' +
    'Show any of them on a face of a 3D Box with the "Live screen" behavior. ' +
    'Also known as render to texture, or a render target.',
  shortDescription:
    'Show a live camera, a 3D layer or a 2D layer on a screen inside your 3D game.',
  helpPath: '',
  iconUrl: '',
  previewIconUrl: '',
  tags: ['3D', 'camera', 'CCTV', 'security camera', 'render texture',
         'render to texture', 'render target', 'screen', 'monitor', 'TV',
         'arcade', 'minigame', 'mirror', 'minimap', 'picture in picture'],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: freeFunctions,
  eventsBasedBehaviors: [cameraBehavior, screenBehavior],
  eventsBasedObjects: [],
};

/* ---------------------------------------------------------------- guards */

/**
 * GDevelop's serializer is C++-backed, so a NUL byte terminates the string and
 * SILENTLY DROPS THE REST OF THE BLOCK. The truncated function then fails to
 * parse, the whole extension file fails to load, `gdjs.registerBehavior` never
 * runs, and every object falls back to the base RuntimeBehavior -- which
 * surfaces only as "<YourAction> is not a function" at runtime, nowhere near
 * the actual cause.
 *
 * `node --check` does NOT catch this: a NUL is legal inside a comment or a
 * string literal, and JSON round-trips it as \u0000.
 *
 * Written with char codes rather than a regex literal: a regex character class
 * for control characters is itself a place where a stray control byte hides.
 */
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
    `\nControl character U+${code} in ${where} at line ${line}, column ${col}.` +
    `\n  context: ${JSON.stringify(text.slice(Math.max(0, at - 40), at + 20))}` +
    `\nGDevelop truncates the block at this byte, which breaks the whole` +
    ` extension. A NUL here is almost always a space that got mangled.\n`
  );
  process.exit(1);
};

checkControlChars(runtime, 'InGameCamera3D.runtime.js');

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
      /**
       * A JsCode block is a bare function body: nothing is in scope except
       * `runtimeScene` and `eventsFunctionContext`. Using `IGC`, `object` or
       * `behavior` without the preamble that declares them is a
       * ReferenceError at the call site, which `new Function` above cannot
       * see because the name might have come from an outer scope.
       */
      // Check the body only. The embedded runtime has its own locals named
      // `object`, which are none of this check's business.
      const body = e.inlineCode.startsWith(runtime)
        ? e.inlineCode.slice(runtime.length)
        : e.inlineCode;
      for (const [ident, usage] of [
        ['IGC', /(^|[^\w.$])IGC\b/],
        ['object', /(^|[^\w.$])object\.\w/],
        ['behavior', /(^|[^\w.$])behavior\.\w/],
      ]) {
        const declared = new RegExp(`(?:const|let|var)\\s+${ident}\\b`).test(body);
        if (usage.test(body) && !declared) {
          console.error(
            `\n${where}.${f.name} uses "${ident}" but never declares it.` +
            `\nA JsCode block has only runtimeScene and eventsFunctionContext in scope;` +
            `\nit needs the preamble. Symptom at runtime:` +
            ` "ReferenceError: ${ident} is not defined".\n`
          );
          process.exit(1);
        }
      }
    }
  }
};
walkEvents(cameraBehavior.eventsFunctions, cameraBehavior.name);
walkEvents(screenBehavior.eventsFunctions, screenBehavior.name);
walkEvents(extension.eventsFunctions, 'free');

/**
 * Two failures that produce no error, just wrong behaviour in the editor:
 * a duplicate function name silently shadows the earlier one, and a
 * `_PARAM<n>_` past the end of the parameter list renders as broken text in
 * the events sheet.
 */
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
checkNamesAndSentences(cameraBehavior.eventsFunctions, cameraBehavior.name);
checkNamesAndSentences(screenBehavior.eventsFunctions, screenBehavior.name);
checkNamesAndSentences(extension.eventsFunctions, 'free');

/**
 * The Cube3D face permutation is read out of the installed engine rather than
 * trusted from a comment. If a GDevelop update repermutes the faces, this
 * fails the build instead of shipping a feed on the wrong side of the box.
 */
const RUNTIME_DIR =
  'C:/Users/chris/AppData/Local/Programs/GDevelop/resources/GDJS/Runtime';
const cubePath = path.join(RUNTIME_DIR, 'Extensions/3D/Cube3DRuntimeObjectPixiRenderer.js');
if (fs.existsSync(cubePath)) {
  const src = fs.readFileSync(cubePath, 'utf8');
  // The renderer opens with `const g={3:0,2:1,5:2,4:3,0:4,1:5}`: face -> slot.
  const m = src.match(/\{\s*3:\s*0\s*,\s*2:\s*1\s*,\s*5:\s*2\s*,\s*4:\s*3\s*,\s*0:\s*4\s*,\s*1:\s*5\s*\}/);
  if (!m) {
    console.error(
      '\nCube3D face->material-slot table not found in the installed runtime.' +
      '\n  Checked: ' + cubePath +
      '\n  InGameCamera3D.runtime.js hardcodes {0:4,1:5,2:1,3:0,4:3,5:2}. If GDevelop' +
      '\n  changed this, "Front" now lands on a different face. Verify before shipping.\n'
    );
    process.exit(1);
  }
  console.log('  Cube3D face table matches the installed runtime');
} else {
  console.warn('  ! GDevelop runtime not found; skipped the Cube3D face-table check');
}

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
const allFns = [
  ...cameraBehavior.eventsFunctions,
  ...screenBehavior.eventsFunctions,
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

/**
 * `object` is only ever parameter 0 of a behavior function — the owner, which
 * GDevelop supplies and strips from the signature. A second `object` parameter
 * is silently dropped by the editor: the generated call shifts its remaining
 * arguments up by one and the function receives a string where it expects a
 * Hashtable, surfacing as "TypeError: e.values is not a function" inside
 * gdjs.objectsListsToArray, several frames away from the declaration.
 * Any other object parameter must be `objectList`.
 */
const checkObjectParams = (fns, where, isBehavior) => {
  for (const f of fns) {
    f.parameters.forEach((p, i) => {
      if (p.type !== 'object') return;
      if (isBehavior && i === 0 && p.name === 'Object') return;
      console.error(
        `\n${where}.${f.name}: parameter "${p.name}" (index ${i}) is type "object".` +
        `\nOnly parameter 0 of a behavior function may be "object". Use "objectList"` +
        `\nfor any other object parameter, or the editor drops it and the arguments` +
        `\nshift — "TypeError: e.values is not a function" at runtime.\n`
      );
      process.exit(1);
    });
  }
};
checkObjectParams(cameraBehavior.eventsFunctions, cameraBehavior.name, true);
checkObjectParams(screenBehavior.eventsFunctions, screenBehavior.name, true);
checkObjectParams(extension.eventsFunctions, 'free', false);

// The runtime and the dropdowns must agree on the preset names, or a user
// picks "HD" and silently gets the fallback.
for (const name of RESOLUTIONS) {
  if (name === 'Custom') continue;
  if (!runtime.includes(name + ':')) {
    console.error(`\nResolution preset "${name}" is offered in the editor but absent` +
      ` from PRESETS in the runtime.\n`);
    process.exit(1);
  }
}

const out = path.join(here, 'InGameCamera3D.json');
fs.writeFileSync(out, json, 'utf8');

const counts = allFns.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${path.basename(out)}  (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${blocks} JS blocks parsed clean`);
console.log(`  ${JSON.stringify(counts)}`);
