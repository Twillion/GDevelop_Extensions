/**
 * Builds ExternalSkeletalAnimator3D.json from the runtime engine + declarations.
 *
 * Run: node ExternalSkeletalAnimator3D/build-extension.mjs
 *
 * Two guards run before anything is written, because both classes of bug have
 * shipped from this repo before (see AnimatedPBR3D/REVIEW.md D1, D14, D15, D16):
 *   1. every generated inlineCode block is parsed with `new Function`
 *   2. the output is linted for the wrong schema keys
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'ExternalSkeletalAnimator3D.runtime.js'), 'utf8');

// Kept as a real .svg on disk so it can be opened and edited, and inlined as a
// data URI here because that is what GDevelop's extension list renders.
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const NS = 'gdjs.__externalSkeletalAnimator3D';

/** Object + Behavior are always the first two parameters of a behavior function. */
const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description) => ({ name, type: 'string', description });
const bool = (name, description) => ({ name, type: 'yesorno', description });
const modelRes = (name, description) => ({
  name, type: 'model3DResource', description, supplementaryInformation: 'model3D',
});

/** The preamble every JsCode block needs: `object`/`behavior` are NOT in scope. */
const PREAMBLE = `const __esaObjects = eventsFunctionContext.getObjects("Object");
const object = __esaObjects.length ? __esaObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const ESA = ${NS};
const state = ESA.getState(behavior);
`;

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const fn = (name, fullName, description, functionType, parameters, code, opts = {}) => ({
  name, fullName, description, functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

/* ------------------------------------------------------------------ lifecycle */

const lifecycle = [
  {
    name: 'onCreated', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(`${runtime}
const __esaObjects = eventsFunctionContext.getObjects("Object");
const object = __esaObjects.length ? __esaObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
const ESA = ${NS};
const state = ESA.getState(behavior);
state.pendingDefault = true;
`),
  },
  {
    name: 'doStepPreEvents', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(`${runtime}
const __esaObjects = eventsFunctionContext.getObjects("Object");
const object = __esaObjects.length ? __esaObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
const ESA = ${NS};
const state = ESA.getState(behavior);

// The renderer is not always ready on the creation frame, so the default
// animation is started from the first step where the rig actually resolves.
if (state.pendingDefault) {
  const file = behavior._getDefaultAnimation ? behavior._getDefaultAnimation() : '';
  if (!file) {
    state.pendingDefault = false;
  } else if (ESA.refreshRig(object, state)) {
    const clip = behavior._getDefaultClip ? behavior._getDefaultClip() : '';
    const loop = behavior._getDefaultLoop ? behavior._getDefaultLoop() : true;
    const speed = behavior._getDefaultSpeed ? behavior._getDefaultSpeed() : 1;
    const mode = behavior._getRootMotionMode ? behavior._getRootMotionMode() : '';
    // A Model3D with its own clips is already playing animation 0 by now, so the
    // default animation has something to blend out of. This is where the
    // "Default crossfade" property applies.
    const fade = behavior._getDefaultCrossfade ? behavior._getDefaultCrossfade() : 0;
    if (ESA.play(runtimeScene, object, behavior, file, clip, loop, speed,
                 Number.isFinite(fade) && fade > 0 ? fade : 0, mode)) {
      state.pendingDefault = false;
    } else if (!state.__defaultRetries || state.__defaultRetries < 120) {
      // Keep retrying for ~2s so a lazily-loaded resource still gets a chance.
      state.__defaultRetries = (state.__defaultRetries || 0) + 1;
    } else {
      state.pendingDefault = false;
    }
  }
}

ESA.step(object, behavior);
`),
  },
  {
    name: 'onDestroy', fullName: '', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(`const __esaObjects = eventsFunctionContext.getObjects("Object");
const object = __esaObjects.length ? __esaObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
${NS}.dispose(behavior);
`),
  },
];

/* -------------------------------------------------------------------- actions */

const PLAYBACK = 'Playback';
const SOCKETS = 'Bone sockets';
const LOADING = 'Loading';

const actions = [
  fn('PlayAnimation', 'Play animation from a file',
    'Play clip _PARAM3_ from the animation file _PARAM2_ on _PARAM0_ (loop: _PARAM4_, speed: _PARAM5_, crossfade: _PARAM6_s)',
    'Action',
    [
      modelRes('AnimationFile', 'Animation file (.glb)'),
      str('ClipName', 'Clip name inside that file (leave empty for the first clip)'),
      bool('Loop', 'Loop'),
      num('Speed', 'Speed scale', '1'),
      num('Crossfade', 'Crossfade duration in seconds', '0.2'),
    ],
    `const mode = behavior._getRootMotionMode ? behavior._getRootMotionMode() : '';
const speed = eventsFunctionContext.getArgument("Speed");
const fade = eventsFunctionContext.getArgument("Crossfade");
ESA.play(
  runtimeScene, object, behavior,
  eventsFunctionContext.getArgument("AnimationFile"),
  eventsFunctionContext.getArgument("ClipName"),
  !!eventsFunctionContext.getArgument("Loop"),
  Number.isFinite(speed) && speed !== 0 ? speed : 1,
  Number.isFinite(fade) && fade > 0 ? fade : 0,
  mode
);
`, { group: PLAYBACK }),

  fn('PlayAnimationByIndex', 'Play animation by index',
    'Play clip number _PARAM3_ from the animation file _PARAM2_ on _PARAM0_ (loop: _PARAM4_, speed: _PARAM5_, crossfade: _PARAM6_s)',
    'Action',
    [
      modelRes('AnimationFile', 'Animation file (.glb)'),
      num('ClipIndex', 'Clip index (0 = first clip in the file)', '0'),
      bool('Loop', 'Loop'),
      num('Speed', 'Speed scale', '1'),
      num('Crossfade', 'Crossfade duration in seconds', '0.2'),
    ],
    `const file = eventsFunctionContext.getArgument("AnimationFile");
const raw = eventsFunctionContext.getArgument("ClipIndex");
const mode = behavior._getRootMotionMode ? behavior._getRootMotionMode() : '';
const speed = eventsFunctionContext.getArgument("Speed");
const fade = eventsFunctionContext.getArgument("Crossfade");
// Passed as a POSITION, not resolved to a name here. Mixamo names every clip it
// exports "mixamo.com", so in a pack merged from Mixamo downloads a name lookup
// collapses every index onto clip 0. The runtime indexes animations[] directly
// and reports an out-of-range index through LastError().
ESA.play(
  runtimeScene, object, behavior, file,
  { index: Number.isFinite(raw) ? Math.floor(raw) : 0 },
  !!eventsFunctionContext.getArgument("Loop"),
  Number.isFinite(speed) && speed !== 0 ? speed : 1,
  Number.isFinite(fade) && fade > 0 ? fade : 0,
  mode
);
`, { group: PLAYBACK }),

  fn('RegisterAnimation', 'Register an animation alias',
    'Register _PARAM2_ on _PARAM0_ as clip _PARAM4_ of file _PARAM3_',
    'Action',
    [
      str('Alias', 'Short name to use later'),
      modelRes('AnimationFile', 'Animation file (.glb)'),
      str('ClipName', 'Clip name inside that file (leave empty for the first clip)'),
    ],
    `const alias = eventsFunctionContext.getArgument("Alias");
if (alias) {
  state.aliases.set(alias, {
    file: eventsFunctionContext.getArgument("AnimationFile"),
    clip: eventsFunctionContext.getArgument("ClipName")
  });
}
`, { group: PLAYBACK }),

  fn('PlayAlias', 'Play a registered animation',
    'Play the registered animation _PARAM2_ on _PARAM0_ (loop: _PARAM3_, speed: _PARAM4_, crossfade: _PARAM5_s)',
    'Action',
    [
      str('Alias', 'Registered alias'),
      bool('Loop', 'Loop'),
      num('Speed', 'Speed scale', '1'),
      num('Crossfade', 'Crossfade duration in seconds', '0.2'),
    ],
    `const alias = eventsFunctionContext.getArgument("Alias");
const entry = state.aliases.get(alias);
if (!entry) {
  const known = Array.from(state.aliases.keys());
  state.error = 'No animation registered as "' + alias + '".' +
    (known.length ? ' Registered: ' + known.join(', ') : ' Nothing is registered yet.');
} else {
  const mode = behavior._getRootMotionMode ? behavior._getRootMotionMode() : '';
  const speed = eventsFunctionContext.getArgument("Speed");
  const fade = eventsFunctionContext.getArgument("Crossfade");
  ESA.play(
    runtimeScene, object, behavior, entry.file, entry.clip,
    !!eventsFunctionContext.getArgument("Loop"),
    Number.isFinite(speed) && speed !== 0 ? speed : 1,
    Number.isFinite(fade) && fade > 0 ? fade : 0,
    mode
  );
}
`, { group: PLAYBACK }),

  fn('PauseAnimation', 'Pause animation', 'Pause the external animation on _PARAM0_',
    'Action', [], `if (state.action) state.action.paused = true;\n`, { group: PLAYBACK }),

  fn('ResumeAnimation', 'Resume animation', 'Resume the external animation on _PARAM0_',
    'Action', [], `if (state.action) state.action.paused = false;\n`, { group: PLAYBACK }),

  fn('StopAnimation', 'Stop animation', 'Stop the external animation on _PARAM0_',
    'Action', [],
    `if (state.action) { state.action.stop(); }
state.action = null;
state.label = '';
state.started = false;
`, { group: PLAYBACK }),

  fn('SetAnimationSpeed', 'Set animation speed', 'Set the animation speed of _PARAM0_ to _PARAM2_',
    'Action', [num('Speed', 'Speed scale', '1')],
    `const speed = eventsFunctionContext.getArgument("Speed");
if (Number.isFinite(speed)) {
  state.speed = speed;
  if (state.action) state.action.timeScale = speed;
}
`, { group: PLAYBACK }),

  fn('SetAnimationTime', 'Set animation time', 'Set the animation time of _PARAM0_ to _PARAM2_ seconds',
    'Action', [num('Time', 'Time in seconds', '0')],
    `const t = eventsFunctionContext.getArgument("Time");
if (state.action && Number.isFinite(t)) {
  state.action.time = Math.max(0, Math.min(t, state.action.getClip().duration));
}
`, { group: PLAYBACK }),

  fn('SetAnimationProgress', 'Set animation progress',
    'Set the animation progress of _PARAM0_ to _PARAM2_ (0 to 1)',
    'Action', [num('Progress', 'Progress from 0 to 1', '0')],
    `const p = eventsFunctionContext.getArgument("Progress");
if (state.action && Number.isFinite(p)) {
  const d = state.action.getClip().duration;
  state.action.time = Math.max(0, Math.min(1, p)) * d;
}
`, { group: PLAYBACK }),

  fn('AttachObjectToBone', 'Attach an object to a bone',
    'Attach _PARAM2_ to bone _PARAM3_ of _PARAM0_ with offset (_PARAM4_, _PARAM5_, _PARAM6_)',
    'Action',
    [
      { name: 'TargetObject', type: 'objectList', description: 'Object to attach' },
      str('BoneName', 'Bone name (namespaces like "mixamorig:" may be omitted)'),
      num('OffsetX', 'Offset X', '0'),
      num('OffsetY', 'Offset Y', '0'),
      num('OffsetZ', 'Offset Z', '0'),
    ],
    `const targets = eventsFunctionContext.getObjects("TargetObject");
const boneName = eventsFunctionContext.getArgument("BoneName");
const dx = eventsFunctionContext.getArgument("OffsetX") || 0;
const dy = eventsFunctionContext.getArgument("OffsetY") || 0;
const dz = eventsFunctionContext.getArgument("OffsetZ") || 0;
ESA.refreshRig(object, state);
if (state.rig && !ESA.findNode(state.rig, boneName)) {
  state.error = 'Bone "' + boneName + '" not found on this model.';
}
for (let i = 0; i < targets.length; i++) {
  const existing = state.sockets.findIndex(function (s) { return s.object === targets[i]; });
  if (existing >= 0) state.sockets.splice(existing, 1);
  state.sockets.push({ object: targets[i], bone: boneName, node: null, dx: dx, dy: dy, dz: dz });
}
`, { group: SOCKETS }),

  fn('DetachObjectFromBone', 'Detach an object from its bone',
    'Detach _PARAM2_ from the bones of _PARAM0_',
    'Action',
    [{ name: 'TargetObject', type: 'objectList', description: 'Object to detach' }],
    `const targets = eventsFunctionContext.getObjects("TargetObject");
for (let i = 0; i < targets.length; i++) {
  const at = state.sockets.findIndex(function (s) { return s.object === targets[i]; });
  if (at >= 0) state.sockets.splice(at, 1);
}
`, { group: SOCKETS }),

  fn('PlayAnimationOnMask', 'Play animation on part of the skeleton',
    'Layer _PARAM2_ of _PARAM0_: play clip _PARAM4_ of _PARAM3_ on _PARAM6_ bone _PARAM5_ (loop: _PARAM7_, speed: _PARAM8_, crossfade: _PARAM9_s)',
    'Action',
    [
      str('Layer', 'Layer name (use different names for upper and lower)'),
      modelRes('AnimationFile', 'Animation file (.glb)'),
      str('ClipName', 'Clip name (leave empty for the first clip)'),
      str('SplitBone', 'Bone to split the skeleton at, e.g. "Spine1"'),
      { name: 'Part', type: 'stringWithSelector',
        description: 'Which half this layer drives',
        supplementaryInformation: JSON.stringify(['this bone and below', 'everything else']) },
      bool('Loop', 'Loop'),
      num('Speed', 'Speed scale', '1'),
      num('Crossfade', 'Crossfade duration in seconds', '0.2'),
    ],
    `const mode = behavior._getRootMotionMode ? behavior._getRootMotionMode() : '';
const speed = eventsFunctionContext.getArgument("Speed");
const fade = eventsFunctionContext.getArgument("Crossfade");
const part = String(eventsFunctionContext.getArgument("Part") || '');
ESA.play(
  runtimeScene, object, behavior,
  eventsFunctionContext.getArgument("AnimationFile"),
  eventsFunctionContext.getArgument("ClipName"),
  !!eventsFunctionContext.getArgument("Loop"),
  Number.isFinite(speed) && speed !== 0 ? speed : 1,
  Number.isFinite(fade) && fade > 0 ? fade : 0,
  mode,
  {
    name: eventsFunctionContext.getArgument("Layer") || 'layer',
    splitBone: eventsFunctionContext.getArgument("SplitBone"),
    // "everything else" masks OUT the subtree, leaving the rest of the body.
    excludes: part.indexOf('else') >= 0
  }
);
`, { group: PLAYBACK }),

  fn('StopMaskLayer', 'Stop a skeleton layer', 'Stop layer _PARAM2_ on _PARAM0_',
    'Action', [str('Layer', 'Layer name')],
    `ESA.stopLayer(state, eventsFunctionContext.getArgument("Layer"));
`, { group: PLAYBACK }),

  fn('MatchSpeedToMovement', 'Match animation speed to movement',
    'Match the animation speed of _PARAM0_ to a ground speed of _PARAM2_',
    'Action', [num('GroundSpeed', 'Ground speed in world units per second', '0')],
    `const wanted = eventsFunctionContext.getArgument("GroundSpeed");
if (!state.action) {
  // nothing playing
} else if (!state.stride || state.stride <= 0) {
  state.error = 'This clip has no measurable stride, so its speed cannot be matched ' +
    'to movement. Use it only on walk/run cycles.';
} else if (Number.isFinite(wanted)) {
  // The clip's own ground speed was measured on THIS character's bone lengths,
  // so the ratio already accounts for its proportions.
  const scale = Math.abs(wanted) / state.stride;
  state.speed = scale;
  state.action.timeScale = scale;
}
`, { group: PLAYBACK }),

  fn('PreloadAnimation', 'Preload an animation file',
    'Preload the animation file _PARAM2_ for _PARAM0_',
    'Action', [modelRes('AnimationFile', 'Animation file (.glb)')],
    `const file = eventsFunctionContext.getArgument("AnimationFile");
const loader = runtimeScene.getGame().getResourceLoader();
if (file && loader) {
  Promise.resolve(loader.loadResource(file))
    .then(function () { return loader.processResource(file); })
    .catch(function (e) { state.error = 'Could not load "' + file + '": ' + e; });
}
`, { group: LOADING }),
];

/* ----------------------------------------------------------------- conditions */

const ret = (expr) => `eventsFunctionContext.returnValue = ${expr};\n`;

const conditions = [
  fn('IsPlaying', 'Is playing', 'An external animation is playing on _PARAM0_', 'Condition', [],
    ret(`!!state.action && state.action.isRunning()`), { group: PLAYBACK }),

  fn('IsPaused', 'Is paused', 'The external animation on _PARAM0_ is paused', 'Condition', [],
    ret(`!!state.action && state.action.paused === true`), { group: PLAYBACK }),

  fn('HasFinished', 'Animation has finished',
    'The non-looping external animation on _PARAM0_ has finished', 'Condition', [],
    ret(`ESA.isFinished(state)`), { group: PLAYBACK }),

  fn('CurrentAnimationIs', 'Current animation is',
    'The current external animation of _PARAM0_ is _PARAM2_', 'Condition',
    [str('Name', 'Alias, or "file#clip"')],
    `const wanted = eventsFunctionContext.getArgument("Name");
let label = state.label;
state.aliases.forEach(function (entry, alias) {
  const composed = entry.clip ? entry.file + '#' + entry.clip : entry.file;
  if (composed === state.label && alias === wanted) label = alias;
});
eventsFunctionContext.returnValue = label === wanted;
`, { group: PLAYBACK }),

  fn('IsMaskLayerPlaying', 'Skeleton layer is playing',
    'Layer _PARAM2_ is playing on _PARAM0_', 'Condition', [str('Layer', 'Layer name')],
    `const slot = state.layers.get(eventsFunctionContext.getArgument("Layer"));
eventsFunctionContext.returnValue = !!(slot && slot.action && slot.action.isRunning());
`, { group: PLAYBACK }),

  fn('IsAnimationReady', 'Animation file is ready',
    'The animation file _PARAM2_ is loaded and has at least one clip', 'Condition',
    [modelRes('AnimationFile', 'Animation file (.glb)')],
    `const gltf = ESA.getGltf(runtimeScene, eventsFunctionContext.getArgument("AnimationFile"));
eventsFunctionContext.returnValue = !!(gltf && gltf.animations && gltf.animations.length > 0);
`, { group: LOADING }),

  fn('HasError', 'Has an error', '_PARAM0_ reported an animation error', 'Condition', [],
    ret(`!!state.error`), { group: LOADING }),
];

/* ---------------------------------------------------------------- expressions */

const expressions = [
  fn('CurrentTime', '', 'Current playback time in seconds', 'Expression', [],
    ret(`state.action ? state.action.time : 0`), { group: PLAYBACK }),

  fn('Duration', '', 'Duration of the current clip in seconds', 'Expression', [],
    ret(`state.action ? state.action.getClip().duration : 0`), { group: PLAYBACK }),

  fn('Progress', '', 'Progress of the current clip, from 0 to 1', 'Expression', [],
    ret(`ESA.progress(state)`), { group: PLAYBACK }),

  fn('Speed', '', 'Current speed scale', 'Expression', [],
    ret(`state.action ? state.action.timeScale : state.speed`), { group: PLAYBACK }),

  fn('StrideSpeed', '',
    'Ground speed this walk/run clip implies for this character, in units per second. Only meaningful for locomotion clips - it returns a number for any clip with leg motion',
    'Expression', [], ret(`state.stride || 0`), { group: PLAYBACK }),

  fn('ClipCount', '', 'Number of clips inside an animation file', 'Expression',
    [modelRes('AnimationFile', 'Animation file (.glb)')],
    `const gltf = ESA.getGltf(runtimeScene, eventsFunctionContext.getArgument("AnimationFile"));
eventsFunctionContext.returnValue = gltf && gltf.animations ? gltf.animations.length : 0;
`, { group: LOADING }),

  fn('BonePositionX', '', 'World X of a bone', 'Expression', [str('BoneName', 'Bone name')],
    `eventsFunctionContext.returnValue = bonePos(0);\n`, { group: SOCKETS }),
  fn('BonePositionY', '', 'World Y of a bone', 'Expression', [str('BoneName', 'Bone name')],
    `eventsFunctionContext.returnValue = bonePos(1);\n`, { group: SOCKETS }),
  fn('BonePositionZ', '', 'World Z of a bone', 'Expression', [str('BoneName', 'Bone name')],
    `eventsFunctionContext.returnValue = bonePos(2);\n`, { group: SOCKETS }),

  fn('CurrentAnimation', '', 'Name of the current animation ("file#clip", or its alias)',
    'StringExpression', [],
    `let label = state.label;
state.aliases.forEach(function (entry, alias) {
  const composed = entry.clip ? entry.file + '#' + entry.clip : entry.file;
  if (composed === state.label) label = alias;
});
eventsFunctionContext.returnValue = label || '';
`, { group: PLAYBACK }),

  fn('ClipNameAt', '', 'Name of the clip at a given index inside an animation file',
    'StringExpression',
    [modelRes('AnimationFile', 'Animation file (.glb)'), num('Index', 'Clip index', '0')],
    `const names = ESA.listClipNames(ESA.getGltf(runtimeScene, eventsFunctionContext.getArgument("AnimationFile")));
const raw = eventsFunctionContext.getArgument("Index");
const i = Number.isFinite(raw) ? Math.floor(raw) : 0;
eventsFunctionContext.returnValue = (i >= 0 && i < names.length) ? names[i] : '';
`, { group: LOADING }),

  fn('LastError', '', 'The last error reported by this behavior', 'StringExpression', [],
    ret(`state.error || ''`), { group: LOADING }),
];

// The three bone-position expressions share one helper, injected after the preamble.
const BONE_HELPER = `function bonePos(axis) {
  ESA.refreshRig(object, state);
  const bone = state.rig ? ESA.findNode(state.rig, eventsFunctionContext.getArgument("BoneName")) : null;
  if (!bone) {
    state.error = 'Bone "' + eventsFunctionContext.getArgument("BoneName") + '" not found on this model.';
    return 0;
  }
  bone.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  return axis === 0 ? v.x : (axis === 1 ? v.y : v.z);
}
`;
for (const e of expressions) {
  if (e.name.startsWith('BonePosition')) {
    e.events[0].inlineCode = e.events[0].inlineCode.replace(PREAMBLE, PREAMBLE + BONE_HELPER);
  }
}

/* ------------------------------------------------------------------ behavior */

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

const behavior = {
  name: 'ExternalSkeletalAnimator3D',
  fullName: 'External Skeletal Animator 3D',
  description:
    'Play animation clips from other .glb files on this model’s skeleton. One file can hold ' +
    'many clips, addressed as (file, clip name). Clips adapt to this character’s proportions.',
  objectType: 'Scene3D::Model3DObject',
  propertyDescriptors: [
    prop('DefaultAnimation', 'Resource', 'Default animation file',
      'Animation .glb played when the object is created. Leave empty for none.', '',
      { extraInformation: ['model3D'] }),
    prop('DefaultClip', 'String', 'Default clip name',
      'Clip inside the default file. Leave empty to use the first clip.', ''),
    prop('DefaultLoop', 'Boolean', 'Loop by default', 'Loop the default animation.', 'true'),
    prop('DefaultSpeed', 'Number', 'Default speed', 'Playback speed scale.', '1'),
    prop('DefaultCrossfade', 'Number', 'Default crossfade (s)',
      'Seconds to blend from the model’s own built-in animation into the default ' +
      'animation above, when the object is created. Each Play action carries its own ' +
      'crossfade field for every later change.', '0.2'),
    prop('RootMotionMode', 'Choice', 'Root motion',
      'How the root bone’s translation is handled.', 'In-place (lock X/Z)',
      { extraInformation: ['In-place (lock X/Z)', 'In-place (lock all)',
                           'Visual root motion', 'Drive object'] }),
    prop('AutoCleanBoneNames', 'Boolean', 'Auto-clean bone names',
      'Ignore rig namespaces such as "mixamorig:" when matching bones.', 'true'),
    prop('AdaptToProportions', 'Boolean', 'Adapt to this model’s proportions',
      'Keep this character’s own bone lengths and rescale root motion to its height, ' +
      'instead of taking the proportions of whoever the animation was made for. ' +
      'Turn off only to replay a clip exactly as authored.', 'true'),
  ],
  eventsFunctions: [...lifecycle, ...actions, ...conditions, ...expressions],
};

const extension = {
  author: 'Twillion',
  category: '3D',
  extensionNamespace: '',
  fullName: 'External Skeletal Animator 3D',
  name: 'ExternalSkeletalAnimator3D',
  version: '0.3.1',
  shortDescription: `Play skeletal animations from separate .glb files on any rigged 3D Model, so one animation library can drive many different characters.`,
  description: `Animate a rigged 3D Model with clips that live in OTHER .glb files, instead of baking every animation into every character.

Build one animation library and point every character at it. Clips are matched onto each model's own skeleton by bone name, ignoring rig namespaces such as "mixamorig:" and the per-export numbering Mixamo adds, so characters rigged separately still share animations.

Characters keep their own proportions. A clip authored for a taller character does not stretch a shorter one: bone lengths stay the target's, root motion is rescaled to its height, and only the rotations - the part that is actually the animation - are transferred.

One .glb can hold many clips; pick one by name or index. Split the skeleton into layers to run with the legs while swinging with the arms. Pin objects to bones, with orientation, for weapons and effects. Match animation speed to how fast the character is really moving so the feet stay planted.

Runs on the animation mixer the engine already owns, so it crossfades with - and takes over from - the object's built-in animations at no extra cost.`,
  helpPath: '',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  tags: ['3D', 'animation', 'skeleton', 'skeletal', 'rig', 'bone', 'glTF', 'glb', 'mixamo',
         'retarget', 'animation layer', 'bone attachment', 'socket', 'root motion',
         'character', 'model'],
  authorIds: [],
  dependencies: [],
  globalVariables: [],
  sceneVariables: [],
  eventsFunctions: [],
  eventsBasedBehaviors: [behavior],
  eventsBasedObjects: [],
};

/* ---------------------------------------------------------------- validation */

/**
 * GDevelop's serializer is C++-backed, so a NUL byte terminates the string and
 * SILENTLY DROPS THE REST OF THE BLOCK. The truncated function then fails to
 * parse, the whole extension file fails to load, `gdjs.registerBehavior` never
 * runs, and every object falls back to the base RuntimeBehavior -- which
 * surfaces only as "<YourAction> is not a function" at runtime, nowhere near
 * the actual cause.
 *
 * `node --check` does NOT catch this: a NUL is legal inside a comment or a
 * string literal. JSON hides it too, encoding it as a backslash-u escape that
 * round-trips perfectly. So it has to be checked for explicitly, on the raw
 * text, before anything else.
 *
 * Deliberately written with char codes rather than a regex literal: a regex
 * character class for control characters is itself a place where a stray
 * control byte can hide.
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

checkControlChars(runtime, 'ExternalSkeletalAnimator3D.runtime.js');

let blocks = 0;
const walkEvents = (fns, where) => {
  for (const f of fns) {
    for (const e of f.events) {
      blocks++;
      checkControlChars(e.inlineCode, `${where}.${f.name} inlineCode`);
      try {
        // The generated wrapper is a plain function body, so this is the same
        // parse GDevelop will do at codegen time.
        new Function('runtimeScene', 'eventsFunctionContext', e.inlineCode);
      } catch (err) {
        console.error(`\nSyntax error in ${where}.${f.name}:\n  ${err.message}\n`);
        process.exit(1);
      }
    }
  }
};
walkEvents(behavior.eventsFunctions, behavior.name);

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
  'model3DResource', 'imageResource', 'stringWithSelector', 'color',
]);
for (const f of behavior.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

const out = path.join(here, 'ExternalSkeletalAnimator3D.json');
fs.writeFileSync(out, json, 'utf8');

const counts = behavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${path.basename(out)}  (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  ${blocks} JS blocks parsed clean`);
console.log(`  ${JSON.stringify(counts)}`);
