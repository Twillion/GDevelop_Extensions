/**
 * ExternalSkeletalAnimator3D — runtime engine.
 *
 * Plays animation clips taken from OTHER .glb files on the skeleton of the
 * 3D Model object carrying this behavior.
 *
 * Design notes (verified against GDevelop 5.6.279 / Three r160):
 *  - We BORROW `renderer._animationMixer`. The engine constructs it in
 *    `_updateModel()` and ticks it every frame in `Model3DRuntimeObject.update()`.
 *    We must never construct a second one (they fight over the same bones) and
 *    never call `.update()` on it (that double-advances the clock -> 2x speed).
 *  - `Model3DManager.getModel()` returns the SHARED cached GLTF, so every clip
 *    is `.clone()`d before its tracks are touched.
 *  - A single .glb holds an `animations[]` ARRAY. Clips are addressed as
 *    (file, selector), where the selector is a clip name ('' = the first clip)
 *    or a position, `{ index: n }`. See `resolveSourceClip`.
 */
if (!gdjs.__externalSkeletalAnimator3D) {
  gdjs.__externalSkeletalAnimator3D = (function () {
    const TRACK_PROP = /\.(position|quaternion|scale|rotation|morphTargetInfluences.*)$/;
    const ROOT_CANDIDATES = ['hips', 'pelvis', 'root', 'bip01pelvis'];

    /**
     * Known rig namespaces, matched AFTER punctuation has been removed.
     *
     * This matters more than it looks. Three's GLTFLoader runs every node name
     * through `PropertyBinding.sanitizeNodeName`, which deletes `[ ] . : /`
     * outright (r160: `t.replace(/\s/g,"_").replace(/[\[\]\.:\/]/g,"")`). So a
     * bone authored as "mixamorig:Hips" arrives as "mixamorigHips" — the colon
     * we would have split on is already gone. Mixamo also suffixes the
     * namespace per export ("mixamorig7:Hips"), so two files of the same rig
     * disagree by a digit buried mid-name. Both have to be stripped here.
     */
    const RIG_PREFIX = /^(mixamorig\d*|armature|rig\d*|bip\d*|biped|character\d*|root)/;

    /**
     * Prepared clips, shared across every object in the game.
     *
     * A prepared clip is a function of (source clip, target bone names, root
     * motion mode) and nothing else, so two characters with the same skeleton
     * -- which, for Mixamo, means almost any two characters -- can share one.
     * Holding this per behavior instance instead would deep-clone all 195 tracks
     * per character per animation: fifty NPCs sharing twenty animations would
     * build a thousand identical clips rather than twenty.
     */
    const preparedCache = new Map();
    const PREPARED_CACHE_LIMIT = 512;

    /** Strip rig namespaces and punctuation so "mixamorig7:Left_Arm" == "LeftArm". */
    function normalize(name) {
      let n = String(name || '');
      const colon = n.lastIndexOf(':');
      if (colon >= 0) n = n.slice(colon + 1);
      const bar = n.lastIndexOf('|');
      if (bar >= 0) n = n.slice(bar + 1);
      return n.toLowerCase().replace(/[\s_.\-]/g, '');
    }

    /** Longest common prefix of a list of names — an unknown namespace, usually. */
    function commonPrefix(names) {
      if (names.length < 3) return '';
      let prefix = names[0];
      for (let i = 1; i < names.length && prefix; i++) {
        const other = names[i];
        let j = 0;
        while (j < prefix.length && j < other.length && prefix[j] === other[j]) j++;
        prefix = prefix.slice(0, j);
      }
      // Refuse a prefix that would swallow a whole name, or that looks like a
      // real bone name rather than a namespace.
      if (!prefix || prefix.length > 24) return '';
      for (let i = 0; i < names.length; i++) {
        if (names[i].length <= prefix.length) return '';
      }
      return prefix;
    }

    /**
     * Every key a node name might be matched under, most specific first:
     * the normalized name, the name minus a known rig namespace, and the name
     * minus whatever prefix this particular rig happens to share.
     */
    function keyVariants(name, prefix) {
      const base = normalize(name);
      const out = [base];
      const noRig = base.replace(RIG_PREFIX, '');
      if (noRig && noRig !== base && out.indexOf(noRig) < 0) out.push(noRig);
      if (prefix) {
        const p = normalize(prefix);
        if (p && base.length > p.length && base.slice(0, p.length) === p) {
          const cut = base.slice(p.length);
          if (cut && out.indexOf(cut) < 0) out.push(cut);
        }
      }
      return out;
    }

    function splitTrackName(trackName) {
      const m = TRACK_PROP.exec(trackName);
      if (!m) return null;
      return { node: trackName.slice(0, m.index), prop: m[0] };
    }

    /* ------------------------------------------------------------------ rig */

    /**
     * Reads the target rig out of the Model3D renderer. Returns null when the
     * object is not a 3D Model or its renderer is not ready yet.
     */
    function inspectRig(object) {
      const renderer = object && object.getRenderer ? object.getRenderer() : null;
      if (!renderer) return null;
      const root = renderer._threeObject;
      const mixer = renderer._animationMixer;
      if (!root || !mixer || typeof mixer.clipAction !== 'function') return null;

      const names = new Set();
      const nameList = [];
      let skinned = null;
      root.traverse(function (n) {
        if (n.name) {
          names.add(n.name);
          nameList.push(n.name);
        }
        if (!skinned && n.isSkinnedMesh) skinned = n;
      });

      let rootBone = null;
      const bones = skinned && skinned.skeleton ? skinned.skeleton.bones : null;
      const boneNames = bones ? bones.map(function (b) { return b.name; }) : nameList;
      const prefix = commonPrefix(boneNames);

      // Later variants are less specific, so an earlier bone always wins a key.
      const byKey = new Map();
      for (let i = 0; i < nameList.length; i++) {
        const variants = keyVariants(nameList[i], prefix);
        for (let v = 0; v < variants.length; v++) {
          if (!byKey.has(variants[v])) byKey.set(variants[v], nameList[i]);
        }
      }

      if (bones && bones.length) {
        for (let i = 0; i < bones.length && !rootBone; i++) {
          if (ROOT_CANDIDATES.indexOf(normalize(bones[i].name).replace(RIG_PREFIX, '')) >= 0) {
            rootBone = bones[i].name;
          }
        }
        if (!rootBone) rootBone = bones[0].name;
      }

      const original = renderer._originalModel;
      const offsets = restOffsets(original && original.scene);
      const upAxis = detectUpAxis(offsets);

      return { renderer: renderer, root: root, mixer: mixer, names: names,
               byKey: byKey, prefix: prefix, boneNames: boneNames,
               signature: rigSignature(boneNames), restOffsets: offsets, upAxis: upAxis,
               skinned: skinned, rootBone: rootBone };
    }

    /**
     * Which axis points up, in the root bone's frame.
     *
     * Usually the root's own rest offset gives it away -- a hip sits about a
     * metre above the origin with its other two components near zero. But BVH
     * roots routinely sit AT the origin (CMU mocap files declare
     * `ROOT Hips { OFFSET 0.00000 0.00000 0.00000 }`), which leaves nothing to
     * read. Falling back to the leg chain works for any humanoid: summing a
     * leg's rest offsets points along the body's vertical whatever the rig's
     * naming or axis convention.
     */
    function detectUpAxis(offsets) {
      const pick = function (v) {
        const a = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
        const m = Math.max(a[0], a[1], a[2]);
        return m > 1e-6 ? a.indexOf(m) : -1;
      };

      const hip = offsets.get('hips') || offsets.get('pelvis') || offsets.get('root');
      if (hip) {
        const fromHip = pick(hip);
        if (fromHip >= 0) return fromHip;
      }

      const sum = [0, 0, 0];
      const chain = ['leftupleg', 'leftleg', 'leftfoot',
                     'lefthip', 'leftknee', 'leftankle'];
      for (let i = 0; i < chain.length; i++) {
        const o = offsets.get(chain[i]);
        if (o) { sum[0] += Math.abs(o[0]); sum[1] += Math.abs(o[1]); sum[2] += Math.abs(o[2]); }
      }
      const fromLeg = pick(sum);
      return fromLeg >= 0 ? fromLeg : 1;   // glTF is Y-up by convention
    }

    /**
     * Identifies a rig by its bone-name set. A prepared clip depends on nothing
     * else about the target, so every character sharing this signature can share
     * one prepared clip -- which is the whole point when fifty townspeople of a
     * dozen different body types all run off one animation library.
     */
    function rigSignature(boneNames) {
      const joined = boneNames.join(',');
      let h = 5381;
      for (let i = 0; i < joined.length; i++) {
        h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
      }
      return boneNames.length + '.' + (h >>> 0).toString(36);
    }

    /**
     * Length of the root bone's rest offset, read from a PRISTINE gltf scene
     * (never posed by a mixer). For a Mixamo rig this is hip height, so the
     * ratio between two of them is the height ratio between two characters.
     */
    function restRootLength(scene) {
      if (!scene || !scene.traverse) return 0;
      let found = 0;
      scene.traverse(function (n) {
        if (found || !n.name) return;
        if (ROOT_CANDIDATES.indexOf(normalize(n.name).replace(RIG_PREFIX, '')) >= 0) {
          found = n.position.length();
        }
      });
      return found;
    }

    /** Multiplies every value of one named track in place. */
    function scaleTrack(clip, trackName, factor) {
      for (let i = 0; i < clip.tracks.length; i++) {
        if (clip.tracks[i].name !== trackName) continue;
        const v = clip.tracks[i].values;
        for (let k = 0; k < v.length; k++) v[k] *= factor;
      }
    }

    /* ------------------------------------------------------------ bone masks */

    /**
     * Names of a bone and everything under it, for splitting a skeleton in two.
     *
     * Masking is how animation layering works here, and it has to produce
     * DISJOINT track sets. Three's PropertyMixer.accumulate() takes a weighted
     * AVERAGE when two actions touch the same bone -- two actions at weight 1
     * give a 50/50 blend of both poses, not an override. And apply() blends back
     * toward the bone's saved original whenever total weight is under 1. So each
     * bone must have exactly one owning layer at full weight: upper and lower
     * partition the skeleton, and neither overlaps.
     */
    function subtreeNames(rig, splitBoneName) {
      const out = new Set();
      const matched = matchBone(rig, splitBoneName);
      if (!matched) return out;
      const node = rig.root.getObjectByName(matched);
      if (!node) return out;
      node.traverse(function (n) { if (n.name) out.add(n.name); });
      return out;
    }

    /* ------------------------------------------------------- stride measure */

    const LEG_CHAINS = [
      ['leftupleg', 'leftleg', 'leftfoot'],
      ['rightupleg', 'rightleg', 'rightfoot'],
    ];

    /** Rest-pose local offsets, keyed by normalized bone name, from a pristine scene. */
    function restOffsets(scene) {
      const out = new Map();
      if (!scene || !scene.traverse) return out;
      scene.traverse(function (n) {
        if (!n.name) return;
        const k = normalize(n.name).replace(RIG_PREFIX, '');
        if (!out.has(k)) out.set(k, [n.position.x, n.position.y, n.position.z]);
      });
      return out;
    }

    /** Nearest-keyframe sample of a quaternion track. Clips here are 20-80 keys. */
    function sampleQuat(track, t, out) {
      const times = track.times;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < times.length; i++) {
        const d = Math.abs(times[i] - t);
        if (d < bestD) { bestD = d; best = i; }
      }
      const v = track.values;
      out.set(v[best * 4], v[best * 4 + 1], v[best * 4 + 2], v[best * 4 + 3]);
      return out;
    }

    /**
     * Ground speed the clip implies, measured on THIS rig.
     *
     * An in-place locomotion clip never moves its root, but the feet still sweep
     * backwards under the body at exactly the speed the animator intended. Walk
     * the leg chain with forward kinematics -- the clip's rotations, but the
     * TARGET's bone lengths -- and the sweep comes out in the target's units.
     *
     * Measuring here rather than scaling a source-rig number matters: between two
     * real Mixamo characters the leg-length ratio was 0.9347 while the hip-height
     * ratio was 0.9552. They are not the same character scaled; no single factor
     * is right for both.
     */
    function measureStride(clip, rig, upAxis) {
      if (!rig.restOffsets || !clip.duration) return 0;
      const q = new THREE.Quaternion();
      const rot = new THREE.Quaternion();
      const off = new THREE.Vector3();
      const pos = new THREE.Vector3();

      const byName = new Map();
      for (let i = 0; i < clip.tracks.length; i++) {
        const parts = splitTrackName(clip.tracks[i].name);
        if (parts && parts.prop === '.quaternion') {
          byName.set(normalize(parts.node).replace(RIG_PREFIX, ''), clip.tracks[i]);
        }
      }

      const axes = [0, 1, 2].filter(function (a) { return a !== upAxis; });
      const SAMPLES = 24;
      let widest = 0;

      for (let c = 0; c < LEG_CHAINS.length; c++) {
        const chain = LEG_CHAINS[c];
        const lo = [Infinity, Infinity];
        const hi = [-Infinity, -Infinity];
        let usable = true;

        for (let s = 0; s < SAMPLES && usable; s++) {
          const t = (s / SAMPLES) * clip.duration;
          rot.set(0, 0, 0, 1);
          pos.set(0, 0, 0);
          for (let b = 0; b < chain.length; b++) {
            const rest = rig.restOffsets.get(chain[b]);
            if (!rest) { usable = false; break; }
            off.set(rest[0], rest[1], rest[2]).applyQuaternion(rot);
            pos.add(off);
            const track = byName.get(chain[b]);
            if (track) rot.multiply(sampleQuat(track, t, q));
          }
          if (!usable) break;
          const p = [pos.x, pos.y, pos.z];
          for (let a = 0; a < 2; a++) {
            const v = p[axes[a]];
            if (v < lo[a]) lo[a] = v;
            if (v > hi[a]) hi[a] = v;
          }
        }
        if (!usable) continue;
        for (let a = 0; a < 2; a++) {
          const span = hi[a] - lo[a];
          if (span > widest) widest = span;
        }
      }

      // One gait cycle is two steps, so the body advances twice the sweep.
      return widest > 0 ? (widest * 2) / clip.duration : 0;
    }

    /** Resolves a user-supplied or clip-supplied bone name onto this rig. */
    function matchBone(rig, name) {
      if (!rig) return null;
      if (rig.names.has(name)) return name;
      const variants = keyVariants(name, null);
      for (let i = 0; i < variants.length; i++) {
        const hit = rig.byKey.get(variants[i]);
        if (hit) return hit;
      }
      return null;
    }

    function findNode(rig, boneName) {
      const matched = matchBone(rig, boneName);
      return matched ? rig.root.getObjectByName(matched) : null;
    }

    /* ----------------------------------------------------------- clip prep */

    /**
     * Clones a source clip and rewrites its tracks onto the target rig's bone
     * names, then applies the root-motion filter. Never mutates the source.
     */
    function prepareClip(sourceClip, rig, cleanNames, rootMotionMode, opts) {
      const proportional = !opts || opts.proportional !== false;
      const hipScale = opts && opts.hipScale ? opts.hipScale : 1;
      const mask = opts && opts.mask ? opts.mask : null;
      const maskExcludes = !!(opts && opts.maskExcludes);
      const clip = sourceClip.clone();
      const kept = [];
      const unmatched = [];
      const matchedNodes = [];
      let matched = 0;

      // The source rig's own namespace has to come from the clip's own track
      // names — the animation file's node hierarchy is not otherwise available.
      const sourceNodes = [];
      for (let i = 0; i < clip.tracks.length; i++) {
        const parts = splitTrackName(clip.tracks[i].name);
        if (parts) sourceNodes.push(parts.node);
      }
      const sourcePrefix = commonPrefix(sourceNodes);

      for (let i = 0; i < clip.tracks.length; i++) {
        const track = clip.tracks[i];
        const parts = splitTrackName(track.name);
        if (!parts) continue;

        let target = null;
        if (rig.names.has(parts.node)) {
          target = parts.node;
        } else if (cleanNames) {
          const variants = keyVariants(parts.node, sourcePrefix);
          for (let v = 0; v < variants.length && !target; v++) {
            target = rig.byKey.get(variants[v]) || null;
          }
        }

        if (!target) {
          if (unmatched.indexOf(parts.node) < 0) unmatched.push(parts.node);
          continue;
        }
        // Counted before the mask/proportional filters, so a masked layer is not
        // mistaken for a bad rig match.
        if (matchedNodes.indexOf(parts.node) < 0) matchedNodes.push(parts.node);

        // Proportional adaptation. A Mixamo clip carries a translation AND a
        // scale track for every bone, and a non-root bone's translation is not
        // motion -- it is that bone's length in the rig the clip was authored
        // for. Replaying it rewrites the target's skeleton into the source
        // character's proportions (measured on real files: shin +8%, upper arm
        // -23%, head +35%). Dropping them keeps each character its own shape;
        // rotations, which are what the animation actually is, are unaffected.
        if (proportional) {
          if (parts.prop === '.scale') continue;
          if (parts.prop === '.position' && target !== rig.rootBone) continue;
        }

        // Layer mask: keep only the half of the skeleton this layer owns.
        if (mask) {
          const inMask = mask.has(target);
          if (inMask === maskExcludes) continue;
        }

        track.name = target + parts.prop;
        matched++;
        kept.push(track);
      }
      clip.tracks = kept;

      // The root's translation IS motion, so it is kept -- but it is expressed
      // in the source character's units. Rescale it by the height ratio, or a
      // tall rig's animation leaves a short character floating.
      if (proportional && hipScale !== 1 && rig.rootBone) {
        scaleTrack(clip, rig.rootBone + '.position', hipScale);
      }

      // Snapshot the root translation before it is locked: 'drive' mode replays
      // this as movement of the GDevelop object instead of the mesh.
      let rootTrack = null;
      for (let i = 0; i < clip.tracks.length && rig.rootBone; i++) {
        if (clip.tracks[i].name !== rig.rootBone + '.position') continue;
        rootTrack = {
          times: Array.prototype.slice.call(clip.tracks[i].times),
          values: Array.prototype.slice.call(clip.tracks[i].values),
        };
      }

      if (rootMotionMode !== 'visual' && rig.rootBone) {
        applyRootMotionFilter(clip, rig.rootBone,
          rootMotionMode === 'drive' ? 'lockall' : rootMotionMode);
      }
      return { clip: clip, matched: matched, unmatched: unmatched,
               matchedNodes: matchedNodes, rootTrack: rootTrack };
    }

    /**
     * Pins the root bone's translation to its first keyframe. "lockxz" keeps the
     * vertical bounce; "lockall" freezes translation entirely.
     *
     * The vertical axis is DETECTED, not assumed. glTF is nominally Y-up, but a
     * root bone's translation is expressed in its parent's space, and Mixamo rigs
     * round-tripped through Blender routinely land with the hip height on Z --
     * measured on a real file: Hips.translation = [0.274, -0.254, -93.471], where
     * 93.47 is plainly the hip height in centimetres. Hardcoding Y there would
     * pin the bounce and let the character slide sideways instead, which is the
     * exact opposite of what "in-place" means.
     *
     * At rest the root bone sits above the origin with its other two components
     * near zero, so the largest absolute component identifies the vertical.
     */
    function applyRootMotionFilter(clip, rootBoneName, mode) {
      for (let i = 0; i < clip.tracks.length; i++) {
        const track = clip.tracks[i];
        if (track.name !== rootBoneName + '.position') continue;
        const v = track.values;
        if (v.length < 3) continue;

        let up = 1;
        let best = Math.abs(v[1]);
        if (Math.abs(v[0]) > best) { up = 0; best = Math.abs(v[0]); }
        if (Math.abs(v[2]) > best) { up = 2; }

        const first = [v[0], v[1], v[2]];
        for (let k = 0; k < v.length; k += 3) {
          for (let axis = 0; axis < 3; axis++) {
            if (mode === 'lockall' || axis !== up) v[k + axis] = first[axis];
          }
        }
      }
    }

    function rootMotionKey(mode) {
      const m = String(mode || '').toLowerCase();
      if (m.indexOf('drive') >= 0) return 'drive';
      if (m.indexOf('all') >= 0) return 'lockall';
      if (m.indexOf('visual') >= 0 || m.indexOf('preserve') >= 0) return 'visual';
      return 'lockxz';
    }

    /* ---------------------------------------------------------------- state */

    function getState(behavior) {
      if (!behavior.__esaState) {
        behavior.__esaState = {
          mixer: null,
          rig: null,
          aliases: new Map(),    // alias -> { file, clip }
          action: null,
          label: '',
          speed: 1,
          stride: 0,
          layers: new Map(),   // layer name -> { action, label }
          error: '',
          started: false,
          sockets: []
        };
      }
      return behavior.__esaState;
    }

    /**
     * Re-reads the rig and forgets the current action if the engine swapped the
     * mixer (it does this in `_updateModel`, reached on hot reload). The shared
     * clip cache survives: the clips are keyed by rig signature, not by mixer.
     */
    function refreshRig(object, state) {
      const rig = inspectRig(object);
      if (!rig) return null;
      if (state.mixer !== rig.mixer) {
        state.mixer = rig.mixer;
        state.action = null;
        // The old bone objects belong to a detached hierarchy now; re-resolve
        // them or every socket silently freezes where it last stood.
        for (let i = 0; i < state.sockets.length; i++) state.sockets[i].node = null;
        state.label = '';
      }
      state.rig = rig;
      return rig;
    }

    /* --------------------------------------------------------------- lookup */

    function getGltf(runtimeScene, file) {
      const game = runtimeScene.getGame();
      const manager = game.getModel3DManager ? game.getModel3DManager() : null;
      if (!manager) return null;
      return manager.getModel(file);
    }

    function listClipNames(gltf) {
      if (!gltf || !gltf.animations) return [];
      return gltf.animations.map(function (a) { return a.name; });
    }

    /**
     * A clip selector is either a NAME (a string; '' means "first clip in the
     * file") or a POSITION (`{ index: n }`).
     *
     * The two cannot be collapsed into one by looking the index up and passing
     * the name along, which is what an earlier build did. Mixamo names every
     * clip it exports `mixamo.com`, so a pack assembled from a dozen Mixamo
     * downloads holds a dozen identically named clips -- and
     * `AnimationClip.findByName` returns the FIRST match. Every index in that
     * pack would resolve to clip 0: "play animation by index" would silently
     * play the wrong animation in exactly the case it exists to serve.
     */
    function isIndexSelector(sel) {
      return !!sel && typeof sel === 'object' && typeof sel.index === 'number';
    }

    /**
     * Cache identity for a selector. The two forms are prefixed rather than
     * stringified so a clip genuinely named "3" cannot share an entry with
     * index 3 -- a collision there would hand back the wrong clip.
     */
    function clipSelectorKey(sel) {
      return isIndexSelector(sel) ? 'idx:' + Math.floor(sel.index) : 'name:' + (sel || '');
    }

    /** Resolves (file, selector) to a source clip, recording why it failed. */
    function resolveSourceClip(runtimeScene, file, sel, state) {
      const gltf = getGltf(runtimeScene, file);
      if (!gltf || !gltf.animations || gltf.animations.length === 0) {
        state.error = 'No animations in "' + file +
          '". The file may not be loaded yet (use "Preload animation file"), ' +
          'may not exist, or may contain no clips.';
        return null;
      }
      const clips = gltf.animations;

      if (isIndexSelector(sel)) {
        const i = Math.floor(sel.index);
        if (!(i >= 0 && i < clips.length)) {
          state.error = 'Clip index ' + i + ' is out of range for "' + file +
            '" (' + clips.length + ' clip(s): ' + listClipNames(gltf).join(', ') + ').';
          return null;
        }
        return clips[i];
      }

      if (!sel) return clips[0];
      const found = THREE.AnimationClip.findByName(clips, sel);
      if (!found) {
        state.error = 'Clip "' + sel + '" not found in "' + file +
          '". Available: ' + listClipNames(gltf).join(', ');
        return null;
      }
      return found;
    }

    /**
     * The label `CurrentAnimation()` reports, and the string aliases are matched
     * against: "file#clip", or just the file when the first clip was taken
     * unnamed. An index selector reports the name it resolved to, so the label
     * means the same thing however the clip was addressed.
     */
    function clipLabel(file, sel, resolvedName) {
      if (isIndexSelector(sel)) return resolvedName ? file + '#' + resolvedName : file;
      return sel ? file + '#' + sel : file;
    }

    /* ----------------------------------------------------------------- play */

    function play(runtimeScene, object, behavior, file, clipSel, loop, speed, fade, mode, layer) {
      const state = getState(behavior);
      const rig = refreshRig(object, state);
      if (!rig) {
        state.error = 'No 3D Model renderer with a skeleton on this object.';
        return false;
      }

      const modeKey = rootMotionKey(mode);
      const proportional = behavior._getAdaptToProportions
        ? behavior._getAdaptToProportions() !== false
        : true;

      // Height ratio between this character and the one the clip was authored
      // for. Both read from pristine gltf scenes: the engine keeps the target's
      // original in `renderer._originalModel` and only ever animates a clone.
      let hipScale = 1;
      if (proportional) {
        const srcGltf = getGltf(runtimeScene, file);
        const tgtGltf = rig.renderer._originalModel;
        const srcLen = restRootLength(srcGltf && srcGltf.scene);
        const tgtLen = restRootLength(tgtGltf && tgtGltf.scene);
        if (srcLen > 1e-6 && tgtLen > 1e-6) hipScale = tgtLen / srcLen;
      }

      // A masked layer prepares its own variant of the clip, so the mask is part
      // of the cache identity.
      let mask = null;
      let maskExcludes = false;
      let maskKey = 'full';
      if (layer && layer.splitBone) {
        mask = subtreeNames(rig, layer.splitBone);
        if (!mask.size) {
          state.error = 'Split bone "' + layer.splitBone + '" not found on this model.';
          return false;
        }
        maskExcludes = !!layer.excludes;
        maskKey = (maskExcludes ? 'below:' : 'above:') + layer.splitBone;
      }

      const cacheKey = rig.signature + ' ' + file + ' ' + clipSelectorKey(clipSel) + ' ' + modeKey +
        ' ' + (proportional ? 'p' + hipScale.toFixed(4) : 'raw') + ' ' + maskKey;
      let entry = preparedCache.get(cacheKey);

      if (!entry) {
        const source = resolveSourceClip(runtimeScene, file, clipSel, state);
        if (!source) return false;
        const cleanNames = behavior._getAutoCleanBoneNames
          ? behavior._getAutoCleanBoneNames() !== false
          : true;
        const result = prepareClip(source, rig, cleanNames, modeKey,
          { proportional: proportional, hipScale: hipScale,
            mask: mask, maskExcludes: maskExcludes });
        if (result.matched === 0) {
          if (!rig.skinned) {
            state.error = 'This 3D Model has no skinned mesh, so it has no skeleton to ' +
              'animate. Attach the behavior to the rigged character model.';
          } else {
            state.error = 'No track in "' + source.name + '" (' + file + ') matched a bone ' +
              'on this model.' +
              '\n  Animation wants: ' + result.unmatched.slice(0, 4).join(', ') +
              '\n  Model has:       ' + rig.boneNames.slice(0, 4).join(', ') +
              '\n  These are different rigs, or a namespace this build does not know.';
          }
          return false;
        }
        let mismatch = '';
        const resolved = result.matchedNodes.length;
        const total = resolved + result.unmatched.length;
        if (total > 0 && resolved / total < 0.6) {
          // A partial match does not fail loudly -- it renders a plausible-looking
          // wrong pose, which is harder to diagnose than no pose at all. CMU mocap
          // onto a Mixamo rig matches about 5 of 31 bones, and two of those five
          // mean different joints in the two rigs.
          const nl = String.fromCharCode(10);
          mismatch = 'Only ' + resolved + ' of ' + total + ' bones in "' + file +
            '" matched this model, so the pose will be wrong.' +
            nl + '  Unmatched: ' + result.unmatched.slice(0, 6).join(', ') +
            nl + '  Model has: ' + rig.boneNames.slice(0, 6).join(', ') +
            nl + '  These are different rig families. Retarget onto this skeleton in' +
            ' your 3D tool before exporting.';
          if (mismatch !== state.lastLoggedMismatch) {
            state.lastLoggedMismatch = mismatch;
            console.warn('[ExternalSkeletalAnimator3D] ' + mismatch);
          }
        }

        entry = {
          clip: result.clip,
          // What an index selector resolved to. Kept on the entry because a
          // cache hit never calls resolveSourceClip() and so never sees it.
          clipName: source.name,
          // Measured once per (clip, rig, mode) and shared by every character
          // built on that rig -- the expensive part is paid once, not per NPC.
          stride: measureStride(result.clip, rig, rig.upAxis),
          rootTrack: result.rootTrack,
          mismatch: mismatch,
        };
        if (preparedCache.size >= PREPARED_CACHE_LIMIT) {
          // Oldest-first eviction; Map preserves insertion order.
          preparedCache.delete(preparedCache.keys().next().value);
        }
        preparedCache.set(cacheKey, entry);
      }
      const clip = entry.clip;

      const slot = layer && layer.name ? state.layers.get(layer.name) : null;
      const previous = layer && layer.name ? (slot ? slot.action : null) : state.action;
      const action = state.mixer.clipAction(clip);
      action.enabled = true;
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce,
                     loop ? Number.POSITIVE_INFINITY : 1);
      action.clampWhenFinished = !loop;
      action.timeScale = speed;

      // The object's own built-in animation lives on this same mixer, so it has
      // to be faded out too or it keeps writing the same bones underneath us.
      const engineAction = rig.renderer._action;
      const fadeFrom = (previous && previous !== action && previous.isRunning())
        ? previous
        : (engineAction && engineAction !== action && engineAction.isRunning() ? engineAction : null);

      if (fadeFrom && fade > 0) action.crossFadeFrom(fadeFrom, fade, false);
      else if (fadeFrom) fadeFrom.stop();

      action.play();
      state.mixer.update(0);

      if (layer && layer.name) {
        state.layers.set(layer.name, { action: action, label: clipLabel(file, clipSel, entry.clipName) });
        state.error = '';
        return true;
      }

      // A full-body clip only conflicts with layers it actually shares bones
      // with. That distinction matters for extra bones the humanoid animations
      // never touch -- a hand-animated tail on a Mixamo-rigged character has no
      // tracks in common with any Mixamo clip, so its layer keeps running while
      // the body animation changes underneath it.
      const newNames = new Set();
      for (let i = 0; i < clip.tracks.length; i++) newNames.add(clip.tracks[i].name);
      state.layers.forEach(function (l, key) {
        if (!l.action) { state.layers.delete(key); return; }
        const layerClip = l.action.getClip();
        let overlaps = false;
        for (let i = 0; i < layerClip.tracks.length && !overlaps; i++) {
          if (newNames.has(layerClip.tracks[i].name)) overlaps = true;
        }
        if (overlaps) {
          l.action.stop();
          state.layers.delete(key);
        }
      });

      state.action = action;
      state.label = clipLabel(file, clipSel, entry.clipName);
      state.speed = speed;
      state.stride = entry.stride;
      state.rootTrack = modeKey === 'drive' ? entry.rootTrack : null;
      state.lastRootTime = -1;
      // Keep a rig-mismatch warning visible; it survives caching and replays.
      state.error = entry.mismatch || '';
      state.started = true;
      return true;
    }

    /* -------------------------------------------------------------- sockets */

    const RAD2DEG = 180 / Math.PI;

    /**
     * Pins attached objects to bones, matching both position AND orientation.
     *
     * Orientation is the whole point for a weapon: a sword that tracks the hand
     * but never rotates just floats through it. GDevelop stores rotation in
     * degrees and its renderer applies them as
     * `rotation.set(toRad(rotationX), toRad(rotationY), toRad(angle))` with
     * order "ZYX", so the bone's world quaternion decomposes straight onto those
     * three properties.
     *
     * The offset is applied in the BONE's frame, not world axes -- "5 units down
     * the palm" has to stay down the palm when the wrist turns.
     */
    /**
     * How far an attached object's MESH sits from the position GDevelop stores
     * for that object. Every 3D object type answers this differently, and the
     * difference is the whole of the bug it fixes:
     *
     *  - Cube3D, and anything else left on the base `RuntimeObject3DRenderer`,
     *    anchors its CORNER: `updatePosition()` puts the mesh at
     *    `position + size / 2`.
     *  - Model3D anchors its model ORIGIN POINT:
     *    `position - size * (origin - center)`. That is exactly `position` while
     *    both points sit at their defaults, and is not once either is moved.
     *
     * So writing a bone's world position straight into `setX/Y/Z` lands on the
     * bone for a default Model3D and misses by half a bounding box for a Cube3D
     * -- the usual placeholder weapon hovers beside the hand instead of in it.
     *
     * The offset is read off the live renderer instead of re-deriving each
     * renderer's convention here, so an object type this build has never heard
     * of is still placed correctly. It is measured once per size: a custom 3D
     * object updates its container lazily, and re-reading a possibly stale
     * transform every frame would feed the object's own motion back into its
     * own offset.
     */
    function socketAnchor(socket, target) {
      const w = target.getWidth ? target.getWidth() : 0;
      const h = target.getHeight ? target.getHeight() : 0;
      const d = target.getDepth ? target.getDepth() : 0;
      if (socket.anchor && socket.anchorW === w && socket.anchorH === h && socket.anchorD === d) {
        return socket.anchor;
      }

      const anchor = [0, 0, 0];
      const renderer = target.getRenderer ? target.getRenderer() : null;
      const three = renderer && renderer.get3DRendererObject
        ? renderer.get3DRendererObject() : null;
      if (three && three.position) {
        // Never read a transform the renderer has not caught up with.
        if (renderer.updatePosition) renderer.updatePosition();
        anchor[0] = three.position.x - target.getX();
        anchor[1] = three.position.y - target.getY();
        anchor[2] = three.position.z - (target.getZ ? target.getZ() : 0);
        for (let a = 0; a < 3; a++) {
          if (!isFinite(anchor[a])) anchor[a] = 0;
        }
      }

      socket.anchor = anchor;
      socket.anchorW = w;
      socket.anchorH = h;
      socket.anchorD = d;
      return anchor;
    }

    function updateSockets(state) {
      if (!state.sockets.length || !state.rig) return;
      const v = updateSockets._v || (updateSockets._v = new THREE.Vector3());
      const q = updateSockets._q || (updateSockets._q = new THREE.Quaternion());
      const e = updateSockets._e || (updateSockets._e = new THREE.Euler());
      const o = updateSockets._o || (updateSockets._o = new THREE.Vector3());

      for (let i = state.sockets.length - 1; i >= 0; i--) {
        const socket = state.sockets[i];
        const target = socket.object;
        if (!target || target._livingOnScene === false) {
          state.sockets.splice(i, 1);
          continue;
        }
        const bone = socket.node || (socket.node = findNode(state.rig, socket.bone));
        if (!bone) continue;

        // Bone world matrices are only refreshed at render time, which happens
        // after events -- force this one so the socket is not a frame behind.
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(v);
        bone.getWorldQuaternion(q);

        o.set(socket.dx, socket.dy, socket.dz).applyQuaternion(q);

        // Aim the object's MESH at the bone, not the corner GDevelop stores.
        const anchor = socketAnchor(socket, target);
        target.setX(v.x + o.x - anchor[0]);
        target.setY(v.y + o.y - anchor[1]);
        if (target.setZ) target.setZ(v.z + o.z - anchor[2]);

        if (socket.orient !== false) {
          e.setFromQuaternion(q, 'ZYX');
          if (target.setRotationX) {
            target.setRotationX(e.x * RAD2DEG);
            target.setRotationY(e.y * RAD2DEG);
            target.setAngle(e.z * RAD2DEG);
          } else if (target.setAngle) {
            target.setAngle(e.z * RAD2DEG);
          }
        }
      }
    }

    /** Nearest-keyframe sample of a 3-component track. */
    function sampleVec3(track, t, out) {
      const times = track.times;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < times.length; i++) {
        const d = Math.abs(times[i] - t);
        if (d < bestD) { bestD = d; best = i; }
      }
      out[0] = track.values[best * 3];
      out[1] = track.values[best * 3 + 1];
      out[2] = track.values[best * 3 + 2];
      return out;
    }

    /**
     * 'Drive object' root motion: the root track was stripped from the clip, so
     * replay its per-frame delta as movement of the GDevelop object. Movement is
     * then exactly what the animation does, which is the only way to get zero
     * foot sliding without IK.
     */
    function driveRootMotion(object, state) {
      const track = state.rootTrack;
      const action = state.action;
      if (!track || !action || !action.isRunning()) return;

      const now = action.time;
      const sample = driveRootMotion._s || (driveRootMotion._s = [0, 0, 0]);
      const previous = driveRootMotion._p || (driveRootMotion._p = [0, 0, 0]);

      if (state.lastRootTime < 0 || now < state.lastRootTime) {
        // First frame, or the clip just looped -- take no delta across the seam.
        state.lastRootTime = now;
        sampleVec3(track, now, sample);
        state.lastRootValue = [sample[0], sample[1], sample[2]];
        return;
      }

      sampleVec3(track, now, sample);
      const last = state.lastRootValue || sample;
      const up = state.rig ? state.rig.upAxis : 1;
      const d = [sample[0] - last[0], sample[1] - last[1], sample[2] - last[2]];

      // The rig's vertical is the object's Z in GDevelop's frame; the other two
      // axes are the ground plane, rotated by wherever the object is facing.
      const ground = [0, 1, 2].filter(function (a) { return a !== up; });
      const angle = gdjs.toRad(object.getAngle ? object.getAngle() : 0);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const gx = d[ground[0]];
      const gy = d[ground[1]];

      object.setX(object.getX() + gx * cos - gy * sin);
      object.setY(object.getY() + gx * sin + gy * cos);

      state.lastRootTime = now;
      state.lastRootValue = [sample[0], sample[1], sample[2]];
    }

    /* --------------------------------------------------------------- public */

    return {
      normalize: normalize,
      subtreeNames: subtreeNames,
      clipSelectorKey: clipSelectorKey,
      clipLabel: clipLabel,
      socketAnchor: socketAnchor,

      stopLayer: function (state, name) {
        const slot = state.layers.get(name);
        if (slot && slot.action) slot.action.stop();
        state.layers.delete(name);
      },
      keyVariants: keyVariants,
      commonPrefix: commonPrefix,
      inspectRig: inspectRig,
      detectUpAxis: detectUpAxis,
      prepareClip: prepareClip,
      measureStride: measureStride,
      restOffsets: restOffsets,
      matchBone: matchBone,
      findNode: findNode,
      getState: getState,
      refreshRig: refreshRig,
      getGltf: getGltf,
      listClipNames: listClipNames,
      resolveSourceClip: resolveSourceClip,
      play: play,
      updateSockets: updateSockets,
      rootMotionKey: rootMotionKey,

      /** Frame tick. Deliberately does NOT touch the mixer — the engine ticks it. */
      step: function (object, behavior) {
        const state = getState(behavior);
        refreshRig(object, state);
        driveRootMotion(object, state);
        updateSockets(state);
      },

      isFinished: function (state) {
        const a = state.action;
        if (!a || !state.started) return false;
        if (a.loop === THREE.LoopRepeat) return false;
        return !a.isRunning();
      },

      progress: function (state) {
        const a = state.action;
        if (!a) return 0;
        const d = a.getClip().duration;
        return d > 0 ? Math.min(1, Math.max(0, a.time / d)) : 0;
      },

      dispose: function (behavior) {
        const state = behavior.__esaState;
        if (!state) return;
        // Release this object's bindings and actions, but NOT the prepared
        // clips -- those are shared with every other character on the same rig.
        if (state.mixer && state.rig && state.mixer.uncacheRoot) {
          try { state.mixer.uncacheRoot(state.rig.root); } catch (e) { /* already gone */ }
        }
        state.layers.forEach(function (l) { if (l.action) { try { l.action.stop(); } catch (e) {} } });
        state.layers.clear();
        state.aliases.clear();
        state.sockets.length = 0;
        state.action = null;
        state.rig = null;
        state.mixer = null;
      }
    };
  })();
}
