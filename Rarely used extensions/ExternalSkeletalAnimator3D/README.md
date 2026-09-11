# External Skeletal Animator 3D — 0.3.1

Play skeletal animation clips stored in **other** `.glb` files on a GDevelop **3D Model** object,
without baking every animation into the character file.

A single `.glb` normally holds **many** clips. This extension lets you reach into any animation file,
pick one clip by name or index, and drive the skeleton of the model carrying the behavior with it.

> **Status.** Verified in the GDevelop editor as of 0.2.0: clip-level addressing, the borrowed
> mixer, bone-name matching across Mixamo namespace variants, proportional adaptation, root-motion
> locking, and stride measurement.
>
> **Not verified in-engine:** bone sockets, `Drive object` root motion, and skeleton layers. These
> are covered by `test-runtime.mjs`, but a Node test cannot tell you whether a sword looks right in
> a hand — nobody has watched one yet.
>
> **Fixed in 0.3.1, not yet seen in the editor:**
> - **Play animation by index** addressed clips by resolving the index to a clip *name*. Mixamo names
>   every clip it exports `mixamo.com`, so in a pack merged from Mixamo downloads every index played
>   clip 0. Indices now address `animations[]` directly.
> - **Bone sockets** wrote the bone's world position straight into the attached object's position.
>   That is correct for a Model3D at its default origin, and half a bounding box off for a Cube3D
>   (measured: a 20×20×100 placeholder sword sat 10, 10, 50 out of the hand). The socket now aims
>   the object's *mesh* at the bone whatever anchoring its renderer uses.
> - **Default crossfade** was declared as a property and read by nothing. It now blends out of the
>   model's own built-in animation when the default animation starts.
>
> **Not implemented:** rest-pose retargeting (`SkeletonUtils.retargetClip`), per-layer blend weights,
> IK foot planting, and the ragdoll subsystem in `PLAN.md` §14. See the notes at the end for why each
> is out of scope for now.

---

## Install

1. `node build-extension.mjs` from this folder (already done — the JSON is committed).
2. In GDevelop: **Project Manager → Extensions → Import extension → from file**, pick
   `ExternalSkeletalAnimator3D.json`.
3. Add the behavior **External Skeletal Animator 3D** to a **3D Model** object.
   It will not be offered on other object types — that is deliberate, since the behavior needs a
   skeleton.

---

## The 10-minute test

### Assets you need

- A rigged character `.glb` — the model object itself. Mixamo's own "Y Bot" / "X Bot" works.
- One or more animation `.glb` files. Either shape works:
  - **Mixamo.** Mixamo does **not** export glTF — you get FBX or Collada — and GDevelop's 3D
    objects only load `.gltf`/`.glb`. So a conversion step is unavoidable. Download with
    **Skin: Without Skin** (drops the mesh, keeps the armature — a much smaller file), then either
    import to Blender and export GLB, or batch-convert with a CLI tool such as `FBX2glTF`.
    See **Asset pipeline** below.
  - **A pack GLB with many clips** — Quaternius / Kenney character packs, or a Blender NLA export.

Add every animation file to **Project Manager → Resources** as a 3D model resource.

### Test 1 — a clip out of a multi-clip file (the headline feature)

If you have a pack GLB, first find out what's inside it. In an event sheet:

```
Conditions: (none)  — Trigger once
Actions:    Console: Character.ExternalSkeletalAnimator3D::ClipCount("Pack.glb")
            Console: Character.ExternalSkeletalAnimator3D::ClipNameAt("Pack.glb", 0)
            Console: Character.ExternalSkeletalAnimator3D::ClipNameAt("Pack.glb", 1)
```

GDevelop's animation dropdown only ever lists the *object's own* model, never a separate file, so
these two expressions are the only way to see a pack's contents from inside the editor.

Then play one of them by name:

```
Trigger once → Play animation from a file:
    Object:         Character
    Animation file: Pack.glb
    Clip name:      Walk
    Loop:           yes
    Speed:          1
    Crossfade:      0
```

Leave **Clip name** empty to get the first clip in the file — which is all you need for
one-animation-per-file Mixamo downloads.

### Test 2 — speed sanity check (this is the important one)

Play any looping animation and watch it. **It must run at natural speed.**

If it runs at roughly **double speed**, the extension is ticking the animation mixer that the engine
already ticks. That is the single failure this design is built to avoid, and it's the first thing
I'd want to hear about.

### Test 3 — crossfade between two different files

```
Key "1" pressed → Play animation from a file: Idle.glb  / (clip empty) / loop / 1 / 0.25
Key "2" pressed → Play animation from a file: Walk.glb  / (clip empty) / loop / 1 / 0.25
Key "3" pressed → Play animation from a file: Pack.glb  / "Attack"     / no loop / 1 / 0.15
```

All three land on the same mixer bound to the same skeleton, so blending between clips that came
from *different files* should be as smooth as blending within one file.

### Test 4 — aliases

Repeating file+clip in a dozen event branches gets old fast. Register once, then play by short name:

```
At the beginning of the scene →
    Register an animation alias:  "idle"   / Idle.glb / (empty)
    Register an animation alias:  "walk"   / Walk.glb / (empty)
    Register an animation alias:  "attack" / Pack.glb / "Attack"

Key "2" pressed → Play a registered animation: "walk" / loop / 1 / 0.25
```

### Test 5 — errors are visible, not silent

Deliberately misspell a clip name, then:

```
Condition: Character has an error
Action:    Console: Character.ExternalSkeletalAnimator3D::LastError()
```

You should get the real clip list back:

```
Clip "Walkk" not found in "Pack.glb". Available: Idle, Walk, Run, Attack, Death
```

### Test 6 — bone socket

```
At the beginning of the scene → Attach an object to a bone:
    Object: Character, Object to attach: Sword,
    Bone name: RightHand,   Offset: 0, 0, 0
```

Namespaces are optional — `RightHand`, `mixamorig:RightHand` and `Right_Hand` all resolve to the same
bone. During a fast swing the sword should sit in the hand with **no one-frame lag**.

### Test 7 — root motion

With the default **In-place (lock X/Z)**, a walk animation should march on the spot with the hips
still bobbing vertically, and the character should not slide away from the GDevelop object's
position. Switch the property to **In-place (lock all)** to freeze the vertical bounce too.

---

## What it does

**Actions (16)** — grouped as *Playback*, *Bone sockets*, *Loading*:
Play animation from a file · Play animation by index · Register an animation alias ·
Play a registered animation · Play animation on part of the skeleton · Stop a skeleton layer ·
Match animation speed to movement · Pause · Resume · Stop · Set animation speed ·
Set animation time · Set animation progress · Attach an object to a bone ·
Detach an object from its bone · Preload an animation file

**Conditions (7):** Is playing · Is paused · Animation has finished · Current animation is ·
Skeleton layer is playing · Animation file is ready · Has an error

**Expressions (12):** `CurrentTime()` · `Duration()` · `Progress()` · `Speed()` · `StrideSpeed()` ·
`ClipCount(file)` · `BonePositionX/Y/Z(bone)` · `CurrentAnimation()` · `ClipNameAt(file, index)` ·
`LastError()`

**Behavior properties (8):** default animation file + clip, loop, speed, crossfade, root motion mode,
auto-clean bone names, adapt to this model's proportions.

---

## Asset pipeline

GDevelop's 3D objects load `.gltf`/`.glb` only, and Mixamo exports FBX/Collada, so **every Mixamo
animation needs one conversion step.** There is no way around it; the question is only how much of it
you do by hand.

**Per-animation (what most people start with).** Mixamo → download FBX (Without Skin) → import to
Blender → File ▸ Export ▸ glTF 2.0 (.glb). One file, one clip, blank `ClipName` plays it.

**Batched (worth it past a handful).** Import several Mixamo FBX files into one Blender scene so each
animation becomes an action, then export once. You get a single `.glb` holding every clip, selected by
name — one download at runtime instead of twelve.

> The trap: Blender's glTF exporter includes **every action in the file** by default. That is exactly
> how a `KICK.glb` ends up containing a flying animation as clip 0. Either curate the actions
> deliberately, or check what actually shipped with `ClipCount()` / `ClipNameAt()` before wiring
> events to it.

**Scripted.** `FBX2glTF` converts without opening Blender, so a folder of Mixamo downloads becomes a
folder of `.glb` in one command. Best option once the library is real.

### Blender export settings that matter

| Setting | Use | Why |
|---|---|---|
| **Animation ▸ Actions** | curate deliberately | Exporting all actions is the stray-clip trap above |
| **Armature ▸ Export Deformation Bones only** | **keep consistent** | Changing the bone set changes the rig signature. Apply it to the character but not the animations (or vice versa) and the two skeletons stop matching |
| **Include ▸ Limit to Selected** | on | Keeps stray scene objects out of the file |

The last one is the quiet killer for this extension: the character and its animations must agree on
the bone set. Export them with the same armature settings and they will.

## Movement: driven by code, not by animation

The intended setup. Your events move the object; the animation only has to look right while it does.

Set every animation **In Place** at the Mixamo download screen so the clip has no baked travel, and
leave `Root motion` on its default `In-place (lock X/Z)`. A clip that *does* travel is pinned by that
default anyway, so nothing breaks — but locking travel after the fact makes the feet skate, and
ticking In Place costs nothing.

To keep the feet planted, tell the behavior how fast the object is actually moving:

```
Every frame -> Match animation speed to movement:  Player.Speed()
```

`StrideSpeed()` reports the speed at which the current clip plays at 1.0 on **this** character,
measured on its own bone lengths. Match your movement speed to that number and the animation needs no
correction at all; diverge from it and the action rescales the cadence to compensate.

> `StrideSpeed()` returns a number for **any** clip with leg motion, not just walks and runs. A kick
> or a fly clip will report something meaningless. There is no reliable way to auto-detect a
> locomotion clip — measured on real files, a kick is as left/right symmetric as a run (1.08x for
> both) — so deciding which clips are locomotion is yours, not the extension's.

`Drive object` root motion exists for the opposite style, where the animation moves the character.
If your movement is code-driven, ignore it.

## Mixing animations (skeleton layers)

Run with the legs while swinging with the arms. Split the skeleton at a bone, give each half its own
layer, and play a different clip on each:

```
Play animation on part of the skeleton:
    Layer: "legs"   File: Run.glb     Clip: (empty)
    Split bone: "Spine1"   Part: everything else        Loop: yes

Play animation on part of the skeleton:
    Layer: "arms"   File: Attack.glb  Clip: (empty)
    Split bone: "Spine1"   Part: this bone and below    Loop: no
```

`Spine1` on a Mixamo rig splits 53 bones above / 12 below, with no overlap. `Spine` gives 54/11 —
lower split point, more of the torso follows the arms.

**Use the same split bone for both layers**, with opposite `Part` values. That is not a style
preference, it is a correctness requirement: Three's mixer takes a weighted *average* when two actions
touch one bone, so overlapping layers produce a 50/50 blend of both poses rather than one overriding
the other. Complementary masks give each bone exactly one owner.

Stop a layer with **Stop a skeleton layer**; check one with **Skeleton layer is playing**. Playing a
normal full-body animation clears every layer automatically, since a full-body clip owns all the bones
and would otherwise be averaged against them.

## Things worth knowing before you file a bug

**It takes over from the built-in animations.** The object's own *Set animation* actions run on the
same mixer. Once this behavior plays an external clip, it crossfades the built-in action out and
keeps control. Don't drive both at once and expect a sensible result.

**Mixamo names every clip `mixamo.com`.** Ten downloads give ten files whose single clip has the same
useless name. That is why animations are addressed as *(file, clip)* and not by clip name alone, and
why `CurrentAnimation()` reports `file#clip` rather than the bare clip name.

**Clip lookup is an exact string match.** No trimming, no case folding — `walk` ≠ `Walk` ≠ `"Walk "`.
Every miss goes to `LastError()` with the file's real clip list.

**Bone matching is by name, and that is not full retargeting.** Track names are rewritten onto your
model's bones, ignoring namespaces (`mixamorig:`), separators and case. That works when both rigs
share a hierarchy — Mixamo to Mixamo, or one Blender rig to itself. Two genuinely different rigs, or
the same rig in A-pose vs T-pose, will look wrong. Rest-pose retargeting is planned, not shipped.

**Mixamo numbers its namespace per export, and Three deletes the colon.** Two downloads of the same
character can come back as `mixamorig:Hips` and `mixamorig7:Hips`. Worse, Three's `GLTFLoader` runs
every name through `sanitizeNodeName`, which strips `[ ] . : /` — so by the time the rig reaches the
engine those are `mixamorigHips` and `mixamorig7Hips`, with the namespace fused onto the bone name
and no separator left to split on. The matcher handles this three ways, in order: exact name, a
known-namespace list (`mixamorig<n>`, `armature`, `bip<n>`, `character<n>`, `rig`, `root`), and
finally the longest prefix that *all* bones in that file share — which catches namespaces nobody has
heard of. If matching still fails, `LastError()` prints what the animation asked for next to what the
model actually has:

```
No track in "mixamo.com" (Untitled.glb) matched a bone on this model.
  Animation wants: mixamorigHips, mixamorigSpine, ...
  Model has:       mixamorig7Hips, mixamorig7Spine, ...
```

**Proportional adaptation** (`Adapt to this model's proportions`, on by default). A Mixamo clip
carries a translation *and* a scale track for all 65 bones, and a non-root bone's translation is not
motion — it is that bone's **length in the rig the clip was authored for**. Replaying it rewrites
your character's skeleton into the source character's shape. Measured between two real Mixamo
characters: shin **+8.1%**, upper arm **−22.7%**, head **+35.2%**, mean **13.3%**.

With the property on, the extension keeps each character's own bone lengths and takes only the
rotations — which is what the animation actually is, and which is proportion-independent. The root
bone's translation *is* motion, so it is kept and rescaled by the height ratio between the two rigs
(read from both models' pristine rest poses), or a clip authored for a tall character leaves a short
one floating.

Turn it off only if you want a clip replayed exactly as authored, including its original skeleton
proportions.

Not handled: **foot sliding**. Keeping your character's leg lengths while replaying someone else's
rotations means the feet do not land exactly where the source's did. Fixing that needs IK foot
planting, which this extension does not do.

**Loading.** If an animation file isn't loaded when you first play it, nothing happens and
`LastError()` says so. The default animation retries for about two seconds on scene start. Use
**Preload an animation file** during a loading screen, and **Animation file is ready** to check.
Whether a `Resource` behavior property is enough to make GDevelop preload the file automatically is
the one thing I could not determine by reading the engine — please note what you observe.

**Many files means many downloads.** Twelve Mixamo files is twelve fetches; one pack GLB is one.
Iterate with separate files, consolidate for shipping.

**Addressing a clip by index reads the file's clip order**, not its clip names, which matters because
Mixamo gives every clip the same name. `ClipCount()` and `ClipNameAt()` list what a file holds;
`Play animation by index` takes a position in that list. An out-of-range index goes to `LastError()`
with the real count.

**Bone sockets place the attached object's *mesh* on the bone.** GDevelop anchors different 3D object
types differently — a Cube3D stores the corner of its box, a Model3D stores its model origin point —
so the offset between the two is read off the object's own renderer rather than assumed. Your offsets
are measured from the bone, in the bone's own frame, whichever kind of object you attach. The anchor
is re-measured if the instance is resized.

**`Default crossfade` applies once, at creation.** It blends from the model's own built-in animation
into the behaviour's default animation. Every later change of animation carries its own crossfade
field on the Play action.

**`Drive object` moves along the ground only.** The root bone's two horizontal components are turned
into object X/Y movement, rotated by the object's angle; its vertical component is dropped. A jump
clip in this mode will not lift the object off the ground — drive the Z yourself, or use
`Visual root motion` for clips that leave the floor.

---

## Ragdoll physics — designed, not built

**None of this exists in the extension yet.** There is no ragdoll code in the runtime, no Jolt
dependency, and no `EnableRagdoll` action — an earlier draft of this README described the design in
the present tense, which was wrong.

The design is written up in `PLAN.md` §14: an animation-to-physics handover that snapshots live bone
world transforms, anatomical joint limits (1-DOF hinges for knees and elbows, swing-twist cones for
shoulders and hips), sockets that keep tracking bones while the body tumbles, and a get-up blend once
the ragdoll settles. It is sequenced there as **1.2**, after rest-pose retargeting.

---

## Files

| File | What it is |
|---|---|
| `PLAN.md` | The design, with everything verified against the installed runtime marked |
| `ExternalSkeletalAnimator3D.runtime.js` | The engine — readable, lintable, `node --check`-able on its own |
| `build-extension.mjs` | Inlines the runtime and emits the JSON; fails the build on a JS syntax error or a bad schema key |
| `ExternalSkeletalAnimator3D.json` | The importable extension |
| `test-runtime.mjs` | 11 phases over the pure logic: name matching, clip selection, root-motion filtering, stride, socket anchoring, and the built JSON's schema |

Rebuild with:

```bash
node build-extension.mjs
```

Test with:

```bash
node test-runtime.mjs
```

The suite reads the committed JSON as well as the runtime, so run the build first if you have edited
declarations. Green here means the logic holds; it is not a substitute for importing the extension
and looking at it.
