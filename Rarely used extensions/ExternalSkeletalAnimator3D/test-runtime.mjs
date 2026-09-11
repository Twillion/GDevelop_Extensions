/**
 * test-runtime.mjs
 * Unit suite for ExternalSkeletalAnimator3D.
 *
 * Run: node "Rarely used extensions/ExternalSkeletalAnimator3D/test-runtime.mjs"
 *
 * What this suite is for. Almost everything that makes this extension work is a
 * pure function of names and numbers -- bone-name normalization, namespace
 * stripping, clip selection, root-motion filtering, stride measurement, socket
 * anchoring -- and every one of them fails SILENTLY in the engine: a wrong pose,
 * a weapon beside the hand, or the wrong animation entirely. None of that throws,
 * so none of it surfaces as an error. Here it can at least be pinned down.
 *
 * What this suite cannot do: it never renders anything, never loads a real .glb,
 * and never compiles the extension inside GDevelop. A green run here is NOT
 * in-engine verification -- see the status banner in README.md for what has and
 * has not been looked at in the editor.
 *
 * The THREE mock does real vector, quaternion and euler math. Stubbing it out
 * with no-ops would make the stride and socket-orientation tests pass vacuously,
 * which is worse than not having them at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------- THREE mock */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    this.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    this.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    this.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    return this;
  }
}

class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new MockQuaternion(this.x, this.y, this.z, this.w); }
  setFromAxisAngle(axis, angle) {
    const h = angle / 2;
    const s = Math.sin(h);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(h);
    return this;
  }
  multiply(q) {
    const { x: ax, y: ay, z: az, w: aw } = this;
    const { x: bx, y: by, z: bz, w: bw } = q;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
}

/** Euler extraction in Three's 'ZYX' order — the order GDevelop's 3D renderer uses. */
class MockEuler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
  setFromQuaternion(q, order) {
    this.order = order || this.order;
    if (this.order !== 'ZYX') throw new Error('mock only implements ZYX');
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const m11 = 1 - (yy + zz), m12 = xy - wz;
    const m21 = xy + wz, m22 = 1 - (xx + zz);
    const m31 = xz - wy, m32 = yz + wx, m33 = 1 - (xx + yy);
    this.y = Math.asin(-clamp(m31, -1, 1));
    if (Math.abs(m31) < 0.9999999) {
      this.x = Math.atan2(m32, m33);
      this.z = Math.atan2(m21, m11);
    } else {
      this.x = 0;
      this.z = Math.atan2(-m12, m22);
    }
    return this;
  }
}

/** A keyframe track: `times` plus flat `values`, exactly as Three stores them. */
const track = (name, times, values) => ({
  name,
  times,
  values,
  clone() { return track(name, times.slice(), values.slice()); },
});

const clip = (name, duration, tracks) => ({
  name,
  duration,
  tracks,
  clone() { return clip(name, duration, tracks.map((t) => t.clone())); },
});

globalThis.THREE = {
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  Euler: MockEuler,
  LoopRepeat: 2201,
  LoopOnce: 2200,
  AnimationClip: {
    findByName: (clips, name) => clips.find((c) => c.name === name) || null,
  },
};

globalThis.gdjs = { toRad: (d) => (d * Math.PI) / 180 };

const runtimeSrc = fs.readFileSync(path.join(here, 'ExternalSkeletalAnimator3D.runtime.js'), 'utf8');
new Function(runtimeSrc)();

const ESA = globalThis.gdjs.__externalSkeletalAnimator3D;
assert.ok(ESA, 'the runtime should install itself on gdjs.__externalSkeletalAnimator3D');

/* ----------------------------------------------------------------- harness */

/** A Three-like node: enough of the interface for inspectRig and the sockets. */
class MockNode {
  constructor(name, position = [0, 0, 0]) {
    this.name = name;
    this.position = new MockVector3(position[0], position[1], position[2]);
    this.children = [];
    this.worldPosition = new MockVector3(0, 0, 0);
    this.worldQuaternion = new MockQuaternion();
    this.worldUpdates = 0;
  }
  add(child) { this.children.push(child); return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  getObjectByName(name) {
    let found = null;
    this.traverse((n) => { if (!found && n.name === name) found = n; });
    return found;
  }
  updateWorldMatrix() { this.worldUpdates++; }
  getWorldPosition(v) { return v.copy(this.worldPosition); }
  getWorldQuaternion(q) { return q.copy(this.worldQuaternion); }
}

/**
 * A stand-in for a Model3D renderer: a bone hierarchy, a skinned mesh pointing at
 * it, the borrowed mixer, and a pristine `_originalModel` for the rest pose.
 */
function makeRenderer(boneSpecs, opts = {}) {
  const root = new MockNode('Scene');
  const bones = boneSpecs.map(([name, pos]) => new MockNode(name, pos));
  let parent = root;
  for (const b of bones) { parent.add(b); if (opts.chained) parent = b; }
  const skinned = new MockNode('Body');
  skinned.isSkinnedMesh = true;
  skinned.skeleton = { bones, update() { this.updates = (this.updates || 0) + 1; } };
  root.add(skinned);

  const pristine = new MockNode('Scene');
  for (const [name, pos] of boneSpecs) pristine.add(new MockNode(name, pos));

  const actions = [];
  return {
    _threeObject: root,
    _originalModel: { scene: pristine },
    _action: opts.engineAction || null,
    _animationMixer: {
      actions,
      clipAction(c) {
        let a = actions.find((x) => x.clip === c);
        if (!a) {
          a = {
            clip: c,
            enabled: false,
            paused: false,
            time: 0,
            timeScale: 1,
            loop: null,
            repetitions: 0,
            clampWhenFinished: false,
            running: false,
            reset() { this.time = 0; return this; },
            setLoop(l, r) { this.loop = l; this.repetitions = r; return this; },
            play() { this.running = true; return this; },
            stop() { this.running = false; return this; },
            isRunning() { return this.running; },
            getClip() { return this.clip; },
            crossFadeFrom(other, d) { this.fadedFrom = other; this.fadeDuration = d; return this; },
          };
          actions.push(a);
        }
        return a;
      },
      update() { this.updated = (this.updated || 0) + 1; },
      uncacheRoot() { this.uncached = true; },
    },
  };
}

function makeObject(renderer, overrides = {}) {
  const s = { x: 0, y: 0, z: 0, angle: 0 };
  return {
    s,
    getRenderer: () => renderer,
    getX: () => s.x,
    getY: () => s.y,
    getZ: () => s.z,
    setX(v) { s.x = v; },
    setY(v) { s.y = v; },
    setZ(v) { s.z = v; },
    getAngle: () => s.angle,
    ...overrides,
  };
}

/** A scene whose Model3D manager serves the given file -> gltf map. */
function makeScene(files) {
  return {
    getGame: () => ({
      getModel3DManager: () => ({ getModel: (file) => files[file] || null }),
    }),
  };
}

const behaviorStub = (props = {}) => ({
  _getRootMotionMode: () => props.rootMotion || 'In-place (lock X/Z)',
  _getAutoCleanBoneNames: () => props.autoClean !== false,
  _getAdaptToProportions: () => props.proportional !== false,
});

let phases = 0;
const pass = (msg) => console.log('  ' + String.fromCharCode(10003) + ' ' + msg);
const phase = (title) => { phases++; console.log('\n' + phases + '. ' + title); };

console.log('\n--- ExternalSkeletalAnimator3D verification suite ---');

/* ----------------------------------------------------- 1. name normalization */

phase('Bone-name normalization');

assert.strictEqual(ESA.normalize('mixamorig:Hips'), 'hips');
assert.strictEqual(ESA.normalize('Left_Arm'), 'leftarm');
assert.strictEqual(ESA.normalize('Left Arm'), 'leftarm');
assert.strictEqual(ESA.normalize('Bip01 L-Hand'), 'bip01lhand');
assert.strictEqual(ESA.normalize('Armature|Walk'), 'walk', 'a pipe is a namespace separator too');
assert.strictEqual(ESA.normalize(null), '');
assert.strictEqual(ESA.normalize(undefined), '');
pass('namespaces, separators and case are stripped; null is not a crash');

// The case the whole matcher exists for: GLTFLoader has already deleted the
// colon, so the namespace arrives fused onto the bone name, numbered per export.
assert.ok(ESA.keyVariants('mixamorigHips', null).includes('hips'));
assert.ok(ESA.keyVariants('mixamorig7Hips', null).includes('hips'));
assert.ok(ESA.keyVariants('mixamorig7LeftHand', null).includes('lefthand'));
assert.strictEqual(ESA.keyVariants('mixamorigHips', null)[0], 'mixamorighips',
  'the exact name must stay the FIRST, most specific variant');
pass('mixamorig / mixamorig7 fusion resolves to the same key');

// Two files of the same rig disagreeing only by that digit must agree here.
const fromFileA = ESA.keyVariants('mixamorigLeftFoot', null);
const fromFileB = ESA.keyVariants('mixamorig7LeftFoot', null);
assert.ok(fromFileA.some((v) => fromFileB.includes(v)),
  'two exports of one rig must share at least one key');
pass('two exports of the same rig share a key');

/* ------------------------------------------------------- 2. unknown prefixes */

phase('Unknown-namespace detection (commonPrefix)');

assert.strictEqual(ESA.commonPrefix(['ACME_Hips', 'ACME_Spine', 'ACME_Head']), 'ACME_');
assert.strictEqual(ESA.commonPrefix(['Hips', 'Spine']), '',
  'fewer than three names is not evidence of a namespace');
assert.strictEqual(ESA.commonPrefix(['Hips', 'Hips', 'Hips']), '',
  'a prefix that swallows a whole name must be refused');
assert.strictEqual(ESA.commonPrefix(['Hips', 'Spine', 'Head']), '',
  'unrelated names share no prefix');
assert.strictEqual(
  ESA.commonPrefix(['AVeryLongNamespaceIndeedWhichIsTooLong_A',
    'AVeryLongNamespaceIndeedWhichIsTooLong_B',
    'AVeryLongNamespaceIndeedWhichIsTooLong_C']), '',
  'a prefix over 24 chars is more likely a real bone name than a namespace');
pass('a shared prefix is found, and the three false positives are refused');

assert.ok(ESA.keyVariants('ACME_LeftHand', 'ACME_').includes('lefthand'));
pass('a detected prefix is applied as a key variant');

/* ---------------------------------------------------------- 3. rig inspection */

const MIXAMO = [
  ['mixamorig7Hips', [0, 95, 0]],
  ['mixamorig7Spine', [0, 10, 0]],
  ['mixamorig7LeftUpLeg', [8, -5, 0]],
  ['mixamorig7LeftLeg', [0, -40, 0]],
  ['mixamorig7LeftFoot', [0, -38, 0]],
  ['mixamorig7RightUpLeg', [-8, -5, 0]],
  ['mixamorig7RightLeg', [0, -40, 0]],
  ['mixamorig7RightFoot', [0, -38, 0]],
  ['mixamorig7RightHand', [0, -25, 0]],
];

phase('Rig inspection');

const renderer = makeRenderer(MIXAMO);
const rig = ESA.inspectRig(makeObject(renderer));
assert.ok(rig, 'a renderer with a mixer and a skinned mesh is a usable rig');
assert.strictEqual(rig.rootBone, 'mixamorig7Hips', 'Hips must win over bones[0] ordering');
assert.strictEqual(ESA.matchBone(rig, 'Hips'), 'mixamorig7Hips');
assert.strictEqual(ESA.matchBone(rig, 'mixamorig:Hips'), 'mixamorig7Hips');
assert.strictEqual(ESA.matchBone(rig, 'RightHand'), 'mixamorig7RightHand');
assert.strictEqual(ESA.matchBone(rig, 'Tail'), null,
  'an absent bone must not match something else');
pass('root bone found, and user-written bone names resolve with or without a namespace');

assert.strictEqual(ESA.inspectRig(makeObject({ _threeObject: null, _animationMixer: null })), null);
assert.strictEqual(ESA.inspectRig({ getRenderer: () => null }), null);
pass('a renderer that is not ready yields null rather than throwing');

const rigB = ESA.inspectRig(makeObject(makeRenderer(MIXAMO)));
assert.strictEqual(rig.signature, rigB.signature, 'same bone names must share a signature');
const rigC = ESA.inspectRig(makeObject(makeRenderer(MIXAMO.slice(0, 5))));
assert.notStrictEqual(rig.signature, rigC.signature, 'different skeletons must not share one');
pass('rig signatures identify the skeleton, which is what the clip cache is keyed on');

/* ------------------------------------------------------------- 4. up axis */

phase('Up-axis detection');

assert.strictEqual(ESA.detectUpAxis(new Map([['hips', [0.2, 95, 0.1]]])), 1, 'Y-up glTF');
assert.strictEqual(ESA.detectUpAxis(new Map([['hips', [0.274, -0.254, -93.471]]])), 2,
  'a Blender round-trip puts hip height on Z (measured on a real file)');
// A CMU/BVH root sits AT the origin, so the hips say nothing and the leg chain
// has to answer instead.
assert.strictEqual(ESA.detectUpAxis(new Map([
  ['hips', [0, 0, 0]],
  ['leftupleg', [0, 0, -40]],
  ['leftleg', [0, 0, -38]],
])), 2, 'a zero-offset root falls back to the leg chain');
assert.strictEqual(ESA.detectUpAxis(new Map()), 1,
  'with nothing to read, glTF Y-up is the default');
pass('Y-up, a Z-up Blender round-trip, a BVH zero root, and the empty case');

/* ------------------------------------------- 5. clip selection (regression) */

phase('Clip selection by name and by index');

// The pack that broke the old build: three Mixamo downloads merged into one file,
// so all three clips carry Mixamo's single hardcoded name.
const pack = {
  animations: [
    clip('mixamo.com', 1, [track('Hips.position', [0], [0, 0, 0])]),
    clip('mixamo.com', 2, [track('Hips.position', [0], [1, 1, 1])]),
    clip('mixamo.com', 3, [track('Hips.position', [0], [2, 2, 2])]),
  ],
};
const named = {
  animations: [clip('Idle', 1, []), clip('Walk', 2, []), clip('Run', 3, [])],
};
const scene = makeScene({ 'Pack.glb': pack, 'Named.glb': named, 'Empty.glb': { animations: [] } });

const st = {};
for (let i = 0; i < 3; i++) {
  const got = ESA.resolveSourceClip(scene, 'Pack.glb', { index: i }, st);
  assert.strictEqual(got, pack.animations[i],
    `index ${i} must return animations[${i}], not the first same-named clip`);
}
pass('every index in a pack of identically named Mixamo clips resolves distinctly');

assert.strictEqual(ESA.resolveSourceClip(scene, 'Named.glb', 'Walk', st), named.animations[1]);
assert.strictEqual(ESA.resolveSourceClip(scene, 'Named.glb', '', st), named.animations[0],
  'a blank selector means the first clip');
pass('name selection, and a blank selector, are unchanged');

st.error = '';
assert.strictEqual(ESA.resolveSourceClip(scene, 'Pack.glb', { index: 7 }, st), null);
assert.match(st.error, /index 7 is out of range/);
assert.match(st.error, /3 clip\(s\)/, 'the error must say how many clips there actually are');
st.error = '';
assert.strictEqual(ESA.resolveSourceClip(scene, 'Pack.glb', { index: -1 }, st), null);
assert.match(st.error, /out of range/, 'a negative index is out of range, not a silent clip 0');
st.error = '';
assert.strictEqual(ESA.resolveSourceClip(scene, 'Named.glb', 'walk', st), null,
  'lookup is an exact match: case matters');
assert.match(st.error, /Available: Idle, Walk, Run/, 'a miss must list what is available');
st.error = '';
assert.strictEqual(ESA.resolveSourceClip(scene, 'Empty.glb', '', st), null);
assert.match(st.error, /No animations in "Empty.glb"/);
st.error = '';
assert.strictEqual(ESA.resolveSourceClip(scene, 'Missing.glb', '', st), null);
assert.match(st.error, /may not be loaded yet/,
  'an unloaded file must say so, not fail blankly');
pass('every failure path reports a diagnosable error');

// A name and an index must never share a cache entry, or one hands back the other's clip.
assert.notStrictEqual(ESA.clipSelectorKey('3'), ESA.clipSelectorKey({ index: 3 }));
assert.strictEqual(ESA.clipSelectorKey({ index: 2.7 }), ESA.clipSelectorKey({ index: 2 }),
  'a fractional index is floored, and keys with the clip it actually resolves to');
assert.strictEqual(ESA.clipSelectorKey(''), ESA.clipSelectorKey(null));
pass('cache keys separate names from positions');

assert.strictEqual(ESA.clipLabel('Pack.glb', { index: 1 }, 'mixamo.com'), 'Pack.glb#mixamo.com');
assert.strictEqual(ESA.clipLabel('A.glb', 'Walk', 'Walk'), 'A.glb#Walk');
assert.strictEqual(ESA.clipLabel('A.glb', '', 'Idle'), 'A.glb',
  'an unnamed first clip keeps reporting the bare file, as aliases are matched on that');
pass('CurrentAnimation() labels are stable across both addressing modes');

/* ------------------------------------------------- 6. clip preparation */

phase('Clip preparation: retargeting, proportions, root motion');

/** A clip in the source rig's namespace, with the track kinds Mixamo exports. */
const sourceClip = clip('mixamo.com', 1, [
  track('mixamorigHips.position', [0, 0.5, 1], [0, 90, 0, 3, 94, 5, 6, 90, 10]),
  track('mixamorigHips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  track('mixamorigSpine.position', [0], [0, 12, 0]),
  track('mixamorigSpine.quaternion', [0], [0, 0, 0, 1]),
  track('mixamorigSpine.scale', [0], [1, 1, 1]),
  track('mixamorigTail.quaternion', [0], [0, 0, 0, 1]),
]);

const prepared = ESA.prepareClip(sourceClip, rig, true, 'visual', {});
const names = prepared.clip.tracks.map((t) => t.name);
assert.ok(names.includes('mixamorig7Hips.position'), 'tracks are rewritten onto the target rig');
assert.ok(names.includes('mixamorig7Spine.quaternion'));
assert.ok(!names.some((n) => n.includes('.scale')),
  'scale tracks are the source character’s shape, not its motion');
assert.ok(!names.includes('mixamorig7Spine.position'),
  'a non-root translation is bone LENGTH and must be dropped');
assert.deepStrictEqual(prepared.unmatched, ['mixamorigTail'],
  'a bone the target does not have is reported, not silently dropped');
assert.strictEqual(sourceClip.tracks.length, 6, 'the SHARED source clip must never be mutated');
assert.strictEqual(sourceClip.tracks[0].values[3], 3, 'nor its values');
pass('tracks retargeted, proportions preserved, source clip untouched');

const raw = ESA.prepareClip(sourceClip, rig, true, 'visual', { proportional: false });
const rawNames = raw.clip.tracks.map((t) => t.name);
assert.ok(rawNames.includes('mixamorig7Spine.position'),
  'opting out replays the clip as authored');
assert.ok(rawNames.some((n) => n.includes('.scale')));
pass('"adapt to proportions" off keeps the source rig’s lengths');

const scaled = ESA.prepareClip(sourceClip, rig, true, 'visual', { hipScale: 0.5 });
const rootTrack = scaled.clip.tracks.find((t) => t.name === 'mixamorig7Hips.position');
assert.strictEqual(rootTrack.values[1], 45,
  'root motion is rescaled by the height ratio (90 -> 45)');
pass('root translation is rescaled to the target’s height');

// lockxz keeps the vertical bounce; lockall freezes translation outright.
const locked = ESA.prepareClip(sourceClip, rig, true, 'lockxz', {});
const lockedRoot = locked.clip.tracks.find((t) => t.name === 'mixamorig7Hips.position');
assert.deepStrictEqual(Array.from(lockedRoot.values), [0, 90, 0, 0, 94, 0, 0, 90, 0],
  'X and Z pinned to frame 0, Y (here the detected vertical) still moving');
const frozen = ESA.prepareClip(sourceClip, rig, true, 'lockall', {});
const frozenRoot = frozen.clip.tracks.find((t) => t.name === 'mixamorig7Hips.position');
assert.deepStrictEqual(Array.from(frozenRoot.values), [0, 90, 0, 0, 90, 0, 0, 90, 0]);
pass('in-place locking pins the ground plane and, on request, the bounce too');

// The vertical is detected per clip, not assumed to be Y.
const zUpClip = clip('z', 1, [
  track('mixamorigHips.position', [0, 1], [0.274, -0.254, -93.471, 12, -0.3, -93.2]),
]);
const zLocked = ESA.prepareClip(zUpClip, rig, true, 'lockxz', {});
const zRoot = zLocked.clip.tracks.find((t) => t.name === 'mixamorig7Hips.position');
assert.strictEqual(zRoot.values[3], 0.274, 'X pinned');
assert.strictEqual(zRoot.values[5], -93.2, 'Z left free: it is this clip’s vertical');
pass('a Z-up root bone locks X/Y and keeps its bounce on Z');

const driven = ESA.prepareClip(sourceClip, rig, true, 'drive', {});
assert.ok(driven.rootTrack, 'drive mode snapshots the root track before locking it');
assert.deepStrictEqual(Array.from(driven.rootTrack.values).slice(0, 3), [0, 90, 0]);
const drivenRoot = driven.clip.tracks.find((t) => t.name === 'mixamorig7Hips.position');
assert.deepStrictEqual(Array.from(drivenRoot.values), [0, 90, 0, 0, 90, 0, 0, 90, 0],
  'drive mode must freeze the mesh entirely; the OBJECT moves instead');
pass('drive mode snapshots the root path and locks the mesh');

const mask = ESA.subtreeNames(rig, 'Spine');
const upper = ESA.prepareClip(sourceClip, rig, true, 'visual', { mask, maskExcludes: false });
const lower = ESA.prepareClip(sourceClip, rig, true, 'visual', { mask, maskExcludes: true });
const upperNames = new Set(upper.clip.tracks.map((t) => t.name));
const lowerNames = new Set(lower.clip.tracks.map((t) => t.name));
assert.ok(upperNames.has('mixamorig7Spine.quaternion'));
assert.ok(!lowerNames.has('mixamorig7Spine.quaternion'));
for (const n of upperNames) {
  assert.ok(!lowerNames.has(n),
    'layers MUST be disjoint: Three averages two actions that share a bone');
}
pass('layer masks partition the skeleton with no overlap');

assert.strictEqual(ESA.prepareClip(sourceClip, rig, false, 'visual', {}).matched, 0,
  'with auto-clean off, a namespaced clip matches nothing');
pass('auto-clean off is honoured');

/* --------------------------------------------------------- 7. root motion key */

phase('Root-motion mode parsing');

assert.strictEqual(ESA.rootMotionKey('In-place (lock X/Z)'), 'lockxz');
assert.strictEqual(ESA.rootMotionKey('In-place (lock all)'), 'lockall');
assert.strictEqual(ESA.rootMotionKey('Visual root motion'), 'visual');
assert.strictEqual(ESA.rootMotionKey('Drive object'), 'drive');
assert.strictEqual(ESA.rootMotionKey(''), 'lockxz', 'the default is in-place');
assert.strictEqual(ESA.rootMotionKey(null), 'lockxz');
assert.strictEqual(ESA.rootMotionKey('DRIVE OBJECT'), 'drive', 'matching is case-insensitive');
pass('all four property choices, plus the empty and odd-case cases');

/* -------------------------------------------------------------- 8. stride */

phase('Stride measurement');

const offsets = ESA.restOffsets(renderer._originalModel.scene);
assert.deepStrictEqual(offsets.get('leftupleg'), [8, -5, 0], 'rest offsets are read by clean name');

/** A leg swinging about X by +/- `amp`, sampled as `keys` keyframes. */
const legClip = (amp, duration, keys = 8) => {
  const times = [];
  const values = [];
  const q = new MockQuaternion();
  const axis = new MockVector3(1, 0, 0);
  for (let i = 0; i < keys; i++) {
    const t = (i / (keys - 1)) * duration;
    times.push(t);
    q.setFromAxisAngle(axis, Math.sin((i / (keys - 1)) * Math.PI * 2) * amp);
    values.push(q.x, q.y, q.z, q.w);
  }
  return clip('walk', duration, [
    track('mixamorigLeftUpLeg.quaternion', times, values.slice()),
    track('mixamorigRightUpLeg.quaternion', times, values.slice()),
  ]);
};

const stride = ESA.measureStride(legClip(0.5, 1), rig, 1);
assert.ok(stride > 0, 'a leg that sweeps has a measurable ground speed');
const wider = ESA.measureStride(legClip(0.9, 1), rig, 1);
assert.ok(wider > stride, 'a bigger sweep implies a faster walk');
const slower = ESA.measureStride(legClip(0.5, 2), rig, 1);
assert.ok(Math.abs(slower - stride / 2) < stride * 0.02,
  'the same sweep over twice the time is half the speed');
assert.strictEqual(ESA.measureStride(clip('still', 1, []), rig, 1), 0,
  'a clip with no leg tracks has no stride, and must not fake one');
assert.strictEqual(ESA.measureStride(legClip(0.5, 0), rig, 1), 0,
  'a zero-length clip is not a divide');
assert.strictEqual(ESA.measureStride(legClip(0.5, 1), { restOffsets: new Map() }, 1), 0,
  'a rig with no rest offsets cannot be measured');
pass('stride scales with sweep and duration, and degenerate cases return 0');

/* ------------------------------------------------- 9. sockets (regression) */

phase('Bone sockets');

/**
 * A socket target. `anchor` is the renderer's convention: Cube3D puts the mesh at
 * `position + size / 2`, while a default Model3D puts it exactly at `position`.
 */
function makeTarget(anchor, size = [20, 20, 100]) {
  const s = { x: 0, y: 0, z: 0, rx: 0, ry: 0, angle: 0 };
  const three = { position: new MockVector3(0, 0, 0) };
  const target = {
    s,
    three,
    getWidth: () => size[0],
    getHeight: () => size[1],
    getDepth: () => size[2],
    getX: () => s.x,
    getY: () => s.y,
    getZ: () => s.z,
    setX(v) { s.x = v; this.sync(); },
    setY(v) { s.y = v; this.sync(); },
    setZ(v) { s.z = v; this.sync(); },
    setRotationX(v) { s.rx = v; },
    setRotationY(v) { s.ry = v; },
    setAngle(v) { s.angle = v; },
    sync() { three.position.set(s.x + anchor[0], s.y + anchor[1], s.z + anchor[2]); },
    getRenderer: () => ({
      get3DRendererObject: () => three,
      updatePosition: () => target.sync(),
    }),
  };
  target.sync();
  return target;
}

const hand = rig.root.getObjectByName('mixamorig7RightHand');
hand.worldPosition.set(300, 400, 120);

// Cube3D: the mesh sits half a bounding box past the stored position, so writing
// the bone position straight into setX/Y/Z leaves the sword hanging beside the hand.
const cubeSword = makeTarget([10, 10, 50]);
let state = {
  sockets: [{ object: cubeSword, bone: 'RightHand', node: null, dx: 0, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
assert.deepStrictEqual(
  [cubeSword.three.position.x, cubeSword.three.position.y, cubeSword.three.position.z],
  [300, 400, 120], 'a Cube3D attachment’s MESH must land on the bone');
assert.deepStrictEqual([cubeSword.s.x, cubeSword.s.y, cubeSword.s.z], [290, 390, 70],
  'which means its stored position is offset by half its size');
pass('a corner-anchored object (Cube3D) is placed by its mesh, not its corner');

// Model3D with default origin/center: no correction, and none must be invented.
const modelSword = makeTarget([0, 0, 0]);
state = {
  sockets: [{ object: modelSword, bone: 'RightHand', node: null, dx: 0, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
assert.deepStrictEqual([modelSword.s.x, modelSword.s.y, modelSword.s.z], [300, 400, 120],
  'a default Model3D already anchors at its origin point');
pass('an origin-anchored object (Model3D) is left alone');

// The offset is in the BONE's frame: a turned wrist must carry it round.
const offsetSword = makeTarget([0, 0, 0]);
hand.worldQuaternion.setFromAxisAngle(new MockVector3(0, 0, 1), Math.PI / 2);
state = {
  sockets: [{ object: offsetSword, bone: 'RightHand', node: null, dx: 10, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
assert.ok(Math.abs(offsetSword.s.x - 300) < 1e-6, 'a 90 degree turn sends a +X offset along +Y');
assert.ok(Math.abs(offsetSword.s.y - 410) < 1e-6);
assert.ok(Math.abs(offsetSword.s.angle - 90) < 1e-6,
  'orientation is copied too, in the ZYX order GDevelop’s renderer applies');
pass('offsets rotate with the bone, and orientation transfers as degrees');

hand.worldQuaternion.set(0, 0, 0, 1);
const sizeChanged = makeTarget([10, 10, 50]);
state = {
  sockets: [{ object: sizeChanged, bone: 'RightHand', node: null, dx: 0, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
const firstX = sizeChanged.s.x;
// An instance's real size only lands after creation, so a cached anchor has to
// notice when it changes.
sizeChanged.getWidth = () => 200;
sizeChanged.sync = function () {
  this.three.position.set(this.s.x + 100, this.s.y + 10, this.s.z + 50);
};
ESA.updateSockets(state);
assert.notStrictEqual(sizeChanged.s.x, firstX, 'a resized instance must be re-anchored');
assert.strictEqual(sizeChanged.three.position.x, 300, 'and still land on the bone');
pass('the cached anchor is re-measured when the instance is resized');

const destroyed = makeTarget([0, 0, 0]);
destroyed._livingOnScene = false;
state = {
  sockets: [{ object: destroyed, bone: 'RightHand', node: null, dx: 0, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
assert.strictEqual(state.sockets.length, 0,
  'a destroyed attachment is dropped from the socket list');
state = {
  sockets: [{ object: makeTarget([0, 0, 0]), bone: 'NoSuchBone', node: null, dx: 0, dy: 0, dz: 0 }],
  rig,
};
ESA.updateSockets(state);
assert.strictEqual(state.sockets.length, 1, 'an unresolvable bone is a no-op, not a crash');
ESA.updateSockets({ sockets: [], rig: null });
pass('destroyed objects, unknown bones and an absent rig are all handled');

/* ------------------------------------------------------------- 10. playback */

phase('Playback, state and disposal');

const behavior = behaviorStub();
const model = makeObject(renderer);
const pState = ESA.getState(behavior);

assert.strictEqual(
  ESA.play(scene, model, behavior, 'Named.glb', 'Walk', true, 1, 0, 'Visual root motion'),
  false, 'a clip whose tracks match no bone must fail loudly');
assert.match(pState.error, /matched a bone|No track/);
pass('a rig mismatch is refused rather than rendered as a wrong pose');

const walk = clip('Walk', 1, [
  track('mixamorigHips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  track('mixamorigLeftUpLeg.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
]);
const lib = { animations: [walk, clip('Run', 1, walk.tracks.map((t) => t.clone()))] };
const libScene = makeScene({ 'Lib.glb': lib });

assert.strictEqual(
  ESA.play(libScene, model, behavior, 'Lib.glb', 'Walk', true, 1, 0, 'Visual root motion'),
  true);
assert.strictEqual(pState.error, '', 'a clean play clears the previous error');
assert.strictEqual(pState.label, 'Lib.glb#Walk');
assert.ok(pState.action.isRunning());
assert.strictEqual(pState.action.loop, 2201, 'a looping clip uses LoopRepeat');
assert.strictEqual(ESA.isFinished(pState), false, 'a looping clip never reports finished');
pass('a matching clip plays, labels itself and clears the error');

const first = pState.action;
assert.strictEqual(
  ESA.play(libScene, model, behavior, 'Lib.glb', 'Run', false, 1, 0.25, 'Visual root motion'),
  true);
assert.notStrictEqual(pState.action, first, 'a different clip is a different action');
assert.strictEqual(pState.action.fadedFrom, first, 'and crossfades from the one it replaces');
assert.strictEqual(pState.action.fadeDuration, 0.25);
assert.strictEqual(pState.action.loop, 2200, 'a non-looping clip uses LoopOnce');
assert.strictEqual(pState.action.clampWhenFinished, true, 'and holds its last pose');
pass('switching clips crossfades and honours the loop flag');

pState.action.running = false;
assert.strictEqual(ESA.isFinished(pState), true, 'a stopped non-looping clip has finished');
pState.action.time = 0.5;
assert.strictEqual(ESA.progress(pState), 0.5);
pState.action.time = 99;
assert.strictEqual(ESA.progress(pState), 1, 'progress is clamped to 1');
assert.strictEqual(ESA.progress({ action: null }), 0);
pass('finished and progress report sensibly, including past the end');

// Addressing the same file by index and by name must not collide in the cache.
assert.strictEqual(
  ESA.play(libScene, model, behavior, 'Lib.glb', { index: 1 }, true, 1, 0, 'Visual root motion'),
  true);
assert.strictEqual(pState.label, 'Lib.glb#Run', 'an index reports the name it resolved to');
pass('index addressing plays and labels correctly end to end');

ESA.dispose(behavior);
assert.strictEqual(behavior.__esaState.action, null);
assert.strictEqual(behavior.__esaState.rig, null);
assert.strictEqual(behavior.__esaState.sockets.length, 0);
assert.ok(renderer._animationMixer.uncached, 'disposal releases this object’s bindings');
pass('disposal clears per-object state and releases the mixer bindings');

/* --------------------------------------------------------------- 11. schema */

phase('Built extension schema');

const jsonPath = path.join(here, 'ExternalSkeletalAnimator3D.json');
const rawJson = fs.readFileSync(jsonPath, 'utf8');
const built = JSON.parse(rawJson);
const beh = built.eventsBasedBehaviors[0];

assert.strictEqual(built.version, '0.3.1');
assert.ok(Array.isArray(beh.propertyDescriptors),
  'behaviours serialize propertyDescriptors; "properties" is silently ignored by the engine');
assert.strictEqual(beh.objectType, 'Scene3D::Model3DObject');
assert.strictEqual(beh.propertyDescriptors.length, 8);

for (let i = 0; i < rawJson.length; i++) {
  const c = rawJson.charCodeAt(i);
  assert.ok(!(c < 9 || c === 11 || c === 12 || (c >= 14 && c < 32)),
    `control character at ${i} would truncate a JsCode block inside GDevelop`);
}
pass('schema keys and the built file are clean');

const acts = beh.eventsFunctions.filter((f) => f.functionType === 'Action' && !f.private);
const conds = beh.eventsFunctions.filter((f) => f.functionType === 'Condition');
const exprs = beh.eventsFunctions.filter((f) => f.functionType.endsWith('Expression'));
assert.strictEqual(acts.length, 16, `expected 16 actions, found ${acts.length}`);
assert.strictEqual(conds.length, 7, `expected 7 conditions, found ${conds.length}`);
assert.strictEqual(exprs.length, 12, `expected 12 expressions, found ${exprs.length}`);
for (const name of ['onCreated', 'doStepPreEvents', 'onDestroy']) {
  assert.ok(beh.eventsFunctions.some((f) => f.name === name && f.private),
    `the ${name} lifecycle hook must be present and private`);
}
pass('16 actions, 7 conditions, 12 expressions and 3 lifecycle hooks');

// Every ESA.x() an event calls has to exist, or the action fails only at runtime.
for (const f of beh.eventsFunctions) {
  for (const e of f.events) {
    for (const call of e.inlineCode.match(/\bESA\.([A-Za-z0-9_]+)\(/g) || []) {
      const fnName = call.slice(4, -1);
      assert.ok(typeof ESA[fnName] === 'function',
        `${f.name} calls ESA.${fnName}(), which the runtime does not export`);
    }
  }
}
pass('every ACE reaches a function the runtime actually exports');

// Each property the code reads must be declared, and each declared one read.
const declared = beh.propertyDescriptors.map((p) => p.name);
const allCode = beh.eventsFunctions.flatMap((f) => f.events.map((e) => e.inlineCode)).join('\n');
for (const call of new Set(allCode.match(/_get([A-Za-z0-9_]+)\(/g) || [])) {
  const propName = call.slice(4, -1);
  assert.ok(declared.includes(propName),
    `code reads _get${propName}() but no such property is declared`);
}
for (const name of declared) {
  assert.ok(allCode.includes('_get' + name + '('),
    `property "${name}" is declared but nothing reads it`);
}
pass('every behavior property is both declared and read');

const embeds = (rawJson.match(/__externalSkeletalAnimator3D = \(function/g) || []).length;
assert.strictEqual(embeds, 2,
  `the runtime should be embedded once per lifecycle entry point, found ${embeds}`);
pass('the runtime is embedded exactly twice, not once per function');

console.log('\n========================================');
console.log(' ALL ' + phases + ' PHASES PASSED');
console.log('========================================\n');
