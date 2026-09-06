# CameraTweens3D 1.0.0 — maintainer review

> **Status: all 20 defects below are fixed in 1.1.0**, plus D21 and D22. U1, U2, U7, U10 and U11
> were implemented as part of the fixes; **U3–U6, U8, U9 and U12 are still open.** Each fix has a
> named regression test in `test-cameratweens.mjs`, which now runs 11 phases against a THREE mock
> that does real quaternion and vector math. See "What changed in 1.1.0" at the end.
>
> **D22 (1.1.1) — FATAL, and present in 1.0.0. Found by running it, not by reading it.** Every
> `behavior` parameter was declared without `supplementaryInformation`, so GDevelop had nothing to
> bind the field to and the code generator emitted `getBehavior("")`:
>
> ```js
> gdjs.Untitled_32sceneCode.GDPlayer_9595cameraObjects1[i].getBehavior("").SetStrafeTiltProfile(…)
> // TypeError: Cannot read properties of undefined (reading 'SetStrafeTiltProfile')
> ```
>
> `getBehavior("")` returns undefined, so **every one of the 59 actions, conditions and expressions
> threw on first use.** The lifecycle hooks were unaffected — the engine calls those with the
> behavior directly — which is exactly why the behavior looked like it was working right up until
> the first event was added. The parameter now carries `"CameraTweens3D::CameraTweens3D"`, the build
> fails if it ever does not, and the test suite asserts it on every function.
>
> This is a blind spot in the static review above: it validated parameter *types* against the set
> GDevelop accepts, but never checked that a parameter was actually *bound* to anything. Compare
> D15/D16 in the AnimatedPBR3D review — same shape of miss, same lesson.
>
> Still not verified in the engine: the sign of the strafe lean and turn bank on a real rig, and the
> yaw-source auto-detection. Both are invertible from events if they come out backwards.

Verified against the installed GDevelop (`C:\Users\chris\AppData\Local\Programs\GDevelop\resources\GDJS\Runtime\`):
Three **r160**, layer camera behaviour read out of `pixi-renderers/layer-pixi-renderer.js` and `layer.js`.
`node build-extension.mjs` reproduces `CameraTweens3D.json` byte-for-byte (md5 `84d9539…`), all inline JS
blocks parse clean, and `node test-cameratweens.mjs` passes all 7 phases. Findings marked *(measured)* were
reproduced by driving the real `CameraTweens3D.runtime.js` in a Node harness.

---

## What is already right

Worth stating, because these are the things that killed AnimatedPBR3D 1.0.0 and they are handled here:

- The JsCode preamble derives `object`/`behavior` from `eventsFunctionContext` instead of assuming they
  are in scope, and sets `parameterObjects: "Object"`. This is the validated idiom.
- Conditions and expressions assign `eventsFunctionContext.returnValue`; none of them `return` a value.
- Properties are under `propertyDescriptors`, and the `behavior._get<Name>()` accessor names match the
  declared property names.
- The build script lints for control characters (the NUL-byte truncation class) and `new Function`s every
  block before writing.

The additive-delta architecture is also sound, and for a non-obvious reason worth recording: `updatePosition()`
— the only thing that writes the Three camera's position and roll from the layer — is **push-based**. It is
called from `layer.js` inside `setCameraX/Y/Z/Zoom/Rotation`, and never per frame from
`runtimescene-pixi-renderer.js`'s `render()`. So a write made in `doStepPostEvents` does survive to the draw
call. See D7 for the flip side of that.

---

## Confirmed defects

### D1 — CRITICAL. Every translation amplitude is authored in metres. GDevelop 3D units are pixels.

The whole positional half of the effect is roughly **100x too small to see**.

GDevelop's 3D world uses the same units as its 2D world. `layer.js` derives the default camera distance as
`0.5 * height / zoom / tan(fov/2)` — for a 600 px viewport at the default 45° FOV that is a camera Z of ~724
world units, and a default Cube3D is 100 units on a side. The runtime's constants are metric:

| Constant | Ships as | Reads as | Actually is |
| :-- | --: | :-- | :-- |
| `bobVerticalWeight` | `0.06` | 6 cm of head bob | 0.06 px |
| `bobHorizontalWeight` | `0.04` | 4 cm of sway | 0.04 px |
| `maxShakePosition` | `0.2` | 20 cm explosion throw | 0.2 px |
| `manualLeanOffset` | `0.35` | 35 cm corner peek | 0.35 px |
| `recoilKickbackZ` | `0.04` | 4 cm kickback | 0.04 px |
| `landingMinFallSpeed` | `2.5` | 2.5 m/s | 2.5 px/s — always exceeded |
| stride ref speed | `4.0` / `7.0` | walk / sprint m/s | 4 px/s — always exceeded |

*(measured)* Walking at 300 units/s — an ordinary GDevelop 3D walk speed — peak head-bob Y is **0.108 world
units**, i.e. a tenth of a pixel.

The rotational half (degrees) is correctly scaled, which is why the extension appears to work: you see the
tilts and the FOV, and none of the translation. Fix: introduce a `WorldUnitsPerMeter` property (default
`100`, or derived from the owner's height) and multiply every length-valued constant and clamp by it.

### D2 — CRITICAL. `configure()` overwrites the preset and the shake dropdown with the property defaults.

`NS.configure` applies the preset (step 1), then the modular dropdowns (step 2), then does this:

```js
for (var k in options) {
  if (options.hasOwnProperty(k) && options[k] !== undefined && state.hasOwnProperty(k)) {
    state[k] = options[k];      // <- blindly re-applies masterMotionScale / masterShakeScale /
  }                             //    motionSicknessMode / baseFOV, which steps 1-2 just set
}
```

The options object built at `onCreated` always carries `masterMotionScale`, `masterShakeScale` and
`motionSicknessMode` from the behavior properties, whose declared defaults are `1.0`, `1.0`, `false`.

*(measured)* Loading with `PresetProfile = "Accessibility & Comfort (Zero Motion Sickness)"` and
`ShakeProfile = "Cinematic Heavy (1.5x)"`:

```
motionSicknessMode = false   (preset asks for true)
masterMotionScale  = 1       (preset asks for 0.5)
masterShakeScale   = 1       (preset asks 0.5, dropdown asks 1.5)
```

Two consequences: **the `ShakeProfile` dropdown is inert at load** — it is the only writer of
`masterShakeScale` in step 2, and step 3 always clobbers it; and **the accessibility preset does not turn on
comfort mode**, which is the one preset where silent failure actually hurts someone. Only the runtime
`Apply camera preset` action works, because it bypasses `configure`.

Fix: apply the direct options *before* the preset and profiles, or give the three master properties an
explicit "Default for Preset" sentinel so an untouched property does not overwrite.

### D3 — CRITICAL. `BaseFOV` defaults to 75° and silently overrides the project's layer FOV.

`layer.js`: `this._initialCamera3DFieldOfView = e.camera3DFieldOfView || 45`. GDevelop's default 3D FOV is
**45°**. The behavior's `BaseFOV` property defaults to **75°**, and `applyDeltasToCamera` forces
`camera.fov = deltas.targetFOV` every frame. Merely adding the behavior with untouched properties widens the
game's field of view by 30° on frame one, with nothing in the UI saying so.

Fix: treat `BaseFOV = 0` (or a new "Auto" choice) as "keep the layer's FOV", and seed `state.baseFOV` from
`layer.getCamera3DFieldOfView()` at `onCreated`.

### D4 — MAJOR. Landing impact is blind to how far you fell.

*(measured)* A 60 u/s drop and a 900 u/s drop produce **identical** impulses:

```
fall  60 u/s : [{"f":15,"dY":"-4.37","dPitch":"91.1"}]
fall 900 u/s : [{"f":15,"dY":"-4.37","dPitch":"91.1"}]
```

Two independent causes:

1. The clamps in `triggerLandingImpact` are metric and saturate immediately in world units —
   `clamp(speed * 0.04 * …, 0, 0.4)` maxes out above 10 u/s of fall, `clamp(speed * 0.6 * …, 0, 10)` above
   ~5 u/s. Every landing is the maximum landing. (Same root cause as D1.)
2. `fallSpeed` is sampled as `Math.abs(vz)` **on the contact frame**, where a character controller has
   already zeroed vertical velocity. It then hits `fallSpeed || 5.0` and uses the hardcoded 5.0.

Fix: track peak `|vz|` while airborne and consume it on touchdown; better, read `getCurrentFallSpeed()` off
the character behavior (see U1). Rescale the two clamps by units-per-metre.

### D5 — MAJOR. The grounded-edge test is off by one frame and can fire twice.

```js
if (!state.wasGrounded && groundDetected) { /* landed */ }
state.wasGrounded = state.isGrounded;   // <- the value from TWO frames ago
state.isGrounded  = groundDetected;
```

`wasGrounded` lags `groundDetected` by two frames, so the rising edge tests true on two consecutive frames.
Today the second fire is masked only because `fallSpeed` is ~0 on the follow-up frame; on stairs, slopes or a
moving platform — anywhere vertical motion continues after contact — it double-impulses.

Fix: drop `wasGrounded` entirely and test `if (!state.isGrounded && groundDetected)` before the assignment.

### D6 — MAJOR. "Off" does not switch three of the eight modules off.

*(measured)* After selecting `Off` on the landing, strafe and recoil dropdowns:

| Dropdown | What it zeroes | What it leaves running |
| :-- | :-- | :-- |
| Landing `Off (Disabled)` | `landingShockIntensity` → 0 | `landingPitchDip` stays `3.0` → still injects `landingPitchVel = 150` |
| Strafe `Off (0° Flat)` | `strafeTiltMaxAngle` → 0 | `turnBankingAngle` stays `1.5` → still banks on every turn |
| Recoil `Off (Disabled)` | `recoilPitchMultiplier` → 0 | `applyRecoil` gates only pitch → `yawVel = 12.16`, `zVel = 0.4` |

Each profile writes exactly one scalar; the modules have two or three each. Fix: make each profile entry a
bundle (as `RECOIL_PROFILES` already is) that sets every member of its module, and gate `applyRecoil`'s yaw
and Z on the same multiplier as pitch.

### D7 — MAJOR. The restore-by-subtraction window lets the camera drift away permanently.

Restore runs in `doStepPreEvents`, apply in `doStepPostEvents`. Anything that calls
`layer.setCameraX/Y/Z/Rotation` in between triggers `updatePosition()`, which writes
`_threeCamera.position.x/y/z` **absolutely** — the applied delta is gone. The next frame's
`restorePreviousDelta` still subtracts it, and the camera walks off by one delta per frame.

This is reachable: any other object's camera-follow behavior whose `doStepPostEvents` runs after this one, or
a `centerCamera` call from a post-event. Note also that `updatePosition()` rewrites `rotation.z` only, so a
roll delta gets wiped while pitch and yaw survive — asymmetric corruption on the next restore.

Fix: move the restore to the top of `doStepPostEvents`, immediately before recomputing, so nothing can run in
the gap. Snapshotting the base transform and restoring by assignment is more robust still.

### D8 — MODERATE. Two behaviors on one layer corrupt the camera rotation.

Rotation is restored with `cam.quaternion.multiply(inv(lastDeltaQuat))` — a right-multiply, which only cancels
if that delta was the *last* one applied. With two instances A and B the camera holds `base·A·B`; A restores
first and leaves `base·A·B·A⁻¹`, which is not `base·B`. Quaternion multiplication does not commute. Position
restore is a world-space vector subtract and is fine; FOV also fights (each instance computes its delta
against the other's already-written value). The README tells users to add the behavior to their player
character **or** camera anchor object, so both is a plausible mistake. Either collapse to one shared per-layer
accumulator, or refuse to initialise a second instance on the same layer with a clear `console.warn`.

### D9 — MODERATE. Speed ratio is pinned at its ceiling whenever the player moves.

`refSpeed` is `4.0` walking / `7.0` sprinting; `currentSpeedRatio = clamp(planarSpeed / refSpeed, 0, 1.8)`.
*(measured)* At 300 units/s the ratio is exactly **1.8**. Bob amplitude and stride frequency therefore never
modulate with speed — walking and sprinting differ only by the x1.4 sprint frequency multiplier, and the
"speed ratio drives stride frequency" model in `IMPLEMENTATION_PLAN.md` §2A never engages. Fix with D1's unit
factor, or derive the reference from `getForwardSpeedMax()` when a character behavior is present.

### D10 — MODERATE. Acceleration pitch inertia is second-difference noise.

`forwardAccel` is a finite difference of `forwardSpeed`, itself a finite difference of position. In world
units real accelerations are hundreds of u/s², so `clamp(forwardAccel / 10.0, -1, 1)` sits at ±1 and flips
sign on frame-to-frame position jitter — a constant ±1.2°/±1.5° pitch chatter. Low-pass it, rescale it, or
differentiate `getCurrentForwardSpeed()` instead.

### D11 — MODERATE. Turn banking reads the object's angle, which most FPS rigs never change.

`state.yawAngularVelocity` comes from `object.getAngle()`. In the standard GDevelop 3D first-person setup the
camera yaw lives on the layer (`gdjs.scene3d.camera.setCameraRotationY`) and the player object is often never
rotated at all — so `turnBankingAngle` silently does nothing. Read the layer camera's yaw and differentiate
that; fall back to the object angle only when the layer yaw is static.

### D12 — MODERATE. Ground-state detection is fragile and re-scanned every frame.

`updateKinematics` walks `object._behaviors` each frame and lets the *last* behavior exposing
`isOnFloor`/`isGrounded` win; any behavior exposing `isFalling()` can independently force
`groundDetected = false`. With no character behavior at all, `groundDetected` is `true` forever and the
landing module can never fire. Resolve the provider once at `onCreated`, cache it, and expose an explicit
"ground state source" property for rigs the auto-detection misses.

### D13 — MODERATE. No `onActivate` / `onDeActivate`; a disabled behavior leaves its delta baked in.

Restore only runs from `doStepPreEvents`. Deactivate the behavior (or destroy the object mid-shake on a paused
scene) and the last frame's position, rotation and FOV offset stay on the camera permanently. Add
`onDeActivate` → `restorePreviousDelta`. `state.enabled` is declared and never written by anything — wire it
up or delete it.

### D14 — MINOR. FOV is written straight to `camera.fov` instead of through the layer.

`layer.setCamera3DFieldOfView()` exists and sets `_threeCameraDirty`. Bypassing it means the built-in
"Camera field of view" expression reports the *shaken* value to the rest of the project, and if anything calls
`setCameraZoom()`, `updatePosition()` recomputes `position.z = getCameraZ(this._threeCamera.fov)` from the
perturbed FOV and dollies the camera.

### D15 — MINOR. `tweenFOV` permanently redefines the resting FOV.

On completion it assigns `state.baseFOV = targetFOV`, so a temporary cinematic zoom silently becomes the new
default and there is no way to tween back to the original. It also ignores ADS/sprint while active and then
hands over with a snap. Keep `baseFOV` and add an explicit "restore base FOV", or an absolute/additive flag.

### D16 — MINOR. Noise and phase accumulators.

- `noise1D` is Perlin (`X = xi & 255`), so the lattice repeats every 256 units — at
  `shakeNoiseFrequency = 25` the shake pattern loops every **10.2 s**. Fine for explosions, visible on a
  sustained rumble. `IMPLEMENTATION_PLAN.md` §2D calls it Simplex; it isn't.
- `noise3D` is computed, exported, and never used.
- `bobPhase`, `breathPhase` and `shakeTime` grow without bound; over a long session float precision visibly
  quantises the oscillators. Wrap them (mod 2π, mod 256).
- All instances share one permutation table with no per-instance seed, so two shaking objects shake in
  lockstep.

### D17 — MINOR. `HeadBobY()` reports a number the camera never used.

The expression recomputes the bob from `state.currentSpeedRatio` raw, without the airborne/crouch damping and
grounded gating that `stepProceduralDeltas` applies. It disagrees with the actual applied offset whenever the
player is airborne or crouching. Cache the solved value in the state and read it back.

### D18 — MINOR. `IsRecoilActive` ignores yaw.

`Math.abs(recoilPitch) > 0.01 || Math.abs(recoilZ) > 0.001` — a pure-yaw recoil reads as inactive.

### D19 — MINOR. The runtime is embedded four times; the JSON is ~160 KB of duplicate.

*(measured)* `CameraTweens3D.json` is 264 KB and contains **4 copies** of the 41 KB runtime — inlined into
`onFirstSceneLoaded`, `onCreated`, `doStepPreEvents` and `doStepPostEvents`. The
`if (gdjs.__cameraTweens3D) return;` guard makes it harmless at runtime, but it bloats the project file and
every preview reload. `onFirstSceneLoaded` alone suffices; keep at most one more in `onCreated` as a safety
net and drop it from the two per-frame hooks.

### D20 — MINOR. README preset table contradicts the shipped presets in 8 places.

`IMPLEMENTATION_PLAN.md`'s `applyPreset` snippet matches the runtime; the README table does not.

| Preset | README says | Runtime ships |
| :-- | :-- | :-- |
| Tactical Military | Bob `Standard (1.0x)` | `0.8` |
| Tactical Military | Breathing `Standard (1.0x)` | `0.6` |
| Tactical Military | Sprint FOV `Standard (+10°)` | `8.0` |
| Immersive Horror | Bob `Heavy (1.5x)` | `1.4` |
| Immersive Horror | Strafe `Heavy (3.5°)` | `2.5` |
| Fast Arcade Shooter | Bob `Subtle (0.5x)` | `0.3` |
| Fast Arcade Shooter | Sprint FOV `Extreme (+18°)` | `15.0` |
| Accessibility & Comfort | Landing `Soft (0.4x)` | `0.2` |

Also: both the README and `API_REFERENCE.md` claim comfort mode "zeroes roll tilt, flattens horizontal sway".
Roll is genuinely gated, but `bobX` (horizontal head bob) is not touched at all and breathing is damped x0.3
rather than flattened. And `manualLeanAngle` (the ±12° clamp on `Set manual lean angle`) is documented as the
range but is not exposed as a property or an action — it cannot be changed.

---

## Upgrades worth building

### U1 — Read real kinematics off the character behavior instead of finite-differencing position. *(highest value)*

`Extensions/Physics3DBehavior/PhysicsCharacter3DRuntimeBehavior.js` already exposes exactly what this
extension is trying to reconstruct:

```
getCurrentForwardSpeed()   getCurrentSidewaysSpeed()   getCurrentFallSpeed()   getCurrentJumpSpeed()
getForwardSpeedMax()       getSidewaysSpeedMax()       getMaxFallingSpeed()    getStairHeightMax()
isOnFloor()  isJumping()  isFalling()  isFallingWithoutJumping()  isMovingEvenALittle()
```

`PhysicsCar3DRuntimeBehavior` has `isOnFloor()` too, for vehicle rigs. Adopting these fixes **D4, D9, D10 and
D12 at once**: correct fall speed on the contact frame, an auto-normalising speed ratio (`current / max`
instead of a hardcoded 4.0), a clean forward acceleration, and reliable ground state. Keep the current
finite-difference path as the fallback for objects with no character behavior.

### U2 — A `WorldUnitsPerMeter` property, or scale from the owner's height.

The one change that makes the positional half of the extension visible (D1, and half of D4). Default `100`;
optionally offer "Auto (from object height ÷ 1.8 m)".

### U3 — Footstep events.

A `Footstep triggered` condition firing at each bob-phase zero crossing, plus a `FootstepSide()` expression
(L/R). Cheap to add — the phase is already there — and it is the single most common thing people wire a head
bob to. Audio driven by the same curve that moves the camera always lands better than a separate timer.

### U4 — Positional trauma: `Add trauma from position (x, y, z, radius, power)`.

Distance falloff plus a directional bias so the shake throws away from the blast, instead of the current
isotropic scalar. This is the most-requested explosion API in every camera-shake package.

### U5 — Named, layered shake sources.

Replace the single `trauma` scalar with a small list of concurrent sources, each with its own amplitude,
frequency, decay and optional infinite duration: `Start shake "engine" (…)` / `Stop shake "engine"`. Lets
engine rumble, a low-health pulse and an explosion coexist without fighting over one number. Seed each source
separately (D16).

### U6 — Recoil patterns and recentre.

Today each shot is an independent random impulse. Add per-shot accumulation with a spray pattern (an array or
a comma string of pitch/yaw offsets), a shot index that resets after a configurable idle time, and a
"recoil recentre" that pulls aim back toward the pre-fire direction on release. That is what makes weapon
recoil feel authored rather than noisy.

### U7 — One `ADS motion damping` factor applied to everything.

ADS currently damps breathing only. Bob, strafe tilt, stair jitter and trauma all run at full amplitude while
aiming, which no shooter does. A single `ADSMotionDamping` (default ~0.25) multiplied into every module while
`isADS` is the standard fix, and it is three lines.

### U8 — Rig modes: First person / Third person / Vehicle.

Every term is currently head-relative. A third-person rig wants boom-arm lag and a spring follow; a vehicle
wants suspension pitch/roll from lateral and longitudinal acceleration and no head bob at all. The README
already promises third-person, top-down and vehicle rigs — right now those setups get FPS head bob applied to
an orbit camera.

### U9 — Cinematic one-shots.

`Shake once (amplitude, frequency, duration, falloff)`, `Punch (direction, magnitude)`, an always-on
low-frequency `Handheld drift` (very cheap, disproportionately effective for cutscenes), and a dolly zoom —
GDevelop makes the last one easy, since `getCameraZ(fov)` already relates FOV to camera distance.

### U10 — Group the properties in the editor.

`propertyDescriptors` supports a `group` key — 3DCRT+ uses it on all 51 of its properties. CameraTweens3D uses
it on none, so its 14 properties render as one flat list. This is Phase 3 of its own implementation plan and
it was never done. Free polish, and it makes room to expose the ~20 tuning constants currently locked in the
runtime (`strideFrequency`, `crouchDamping`, `traumaExponent`, `shakeNoiseFrequency`, `manualLeanAngle`, …).

### U11 — Auto-respect the OS reduced-motion setting.

`window.matchMedia('(prefers-reduced-motion: reduce)').matches` at `onCreated` → default comfort mode on.
One line, and it makes the accessibility claim in the README real rather than opt-in.

### U12 — Ship it.

`CameraTweens3D.json` is not in `Twillion-s-Extensions/extensions/` yet, and there is no example scene. An
example project matters more than usual here, because most of the defects above (D1, D3, D4, D9) are ones a
static read passes and a single run catches.

---

---

## What changed in 1.1.0

| # | Fix | Regression test |
| :-- | :-- | :-- |
| D1, U2 | The model stays metric; a `WorldUnitsPerMeter` scale (100, or auto from object depth) converts speeds in and offsets out. Every user-facing number is now world units. | phase 5 |
| D2 | `configure()` applies the plain properties **first**, then the preset, then the module profiles — and no field is written by more than one pass. `shakeIntensity` (preset + dropdown) was split from `masterShakeScale` (the player's slider) so the two compose instead of overwriting. | phase 3 |
| D3 | `BaseFOV` defaults to `0` = inherit the layer's FOV; `ADSFOVTarget` `0` = two thirds of base. | phase 7 |
| D4 | Landing uses the **peak** airborne fall speed, read from `getCurrentFallSpeed()` where available, and the clamps are scaled by units so they no longer saturate. | phase 6 |
| D5 | `wasGrounded` is gone; the edge is tested against last frame's value before it is overwritten. | phase 6 |
| D6 | Every profile is a full patch for its module. Strafe `Off` zeroes turn banking, landing `Off` zeroes the pitch dip, recoil `Off` gates yaw and kickback. | phase 4 |
| D7 | Restore is by assignment and only when the camera still holds exactly what was written, so an externally re-based camera is left alone instead of drifting. | phase 8 |
| D8 | One shared channel per layer captures the base once per frame and writes `base + sum`; rotation composes from a single base. | phase 8 |
| D9 | Reference speed comes from `getForwardSpeedMax()`, or a `WalkSpeedReference` property, or 250 u/s. | phase 5 |
| D10 | Acceleration is normalised against the reference speed rather than a fixed 10, and low-passed. | — |
| D11 | Yaw is taken from the first channel observed to move (layer camera angle → 3D camera Y → object angle); banking and strafe tilt now accept negative values to invert. | — |
| D12 | Motion and ground sources are resolved once and cached, character controllers preferred; an `is on the ground` condition exposes what was detected. | phase 6 |
| D13 | `onActivate` / `onDeActivate` added; deactivating releases the camera. | phase 8 |
| D14 | FOV goes through `layer.setCamera3DFieldOfView()` when available. | — |
| D15 | `tweenFOV` holds its target without overwriting `baseFOV`; `Release FOV tween` eases back. | phase 7 |
| D16 | Shake clock wraps on an exact multiple of the 256 lattice period; bob/breath/jitter phases wrap; per-instance seed from the object id. | phase 1 |
| D17 | Applied offsets are cached at solve time and read back by the expressions. | phase 9 |
| D18 | `IsRecoilActive` includes yaw. | phase 9 |
| D19 | Runtime embedded twice (`onFirstSceneLoaded`, `onCreated`) instead of four times, and never in a per-frame hook. JSON 264 KB → 228 KB despite the runtime itself growing 44%. | phase 11 |
| D20 | README preset table regenerated from the shipped values; comfort mode now really does flatten horizontal sway; `manualLeanMaxAngle` is settable. | phase 10 |
| D21 | `applyPreset` resets to `DEFAULT_TUNING` before patching, so a field zeroed by one preset does not leak into the next. | phase 3 |
| D22 | Behavior parameters carry `supplementaryInformation: "CameraTweens3D::CameraTweens3D"`; the build refuses to emit an unbound one, and the first two parameters are checked to be `(object, behavior)`. | phase 11 |
| U7 | One `ADSMotionDamping` (0.35) scales every module while aiming, not just breathing. | — |
| U10 | All 16 properties carry editor `group`s. | phase 11 |
| U11 | Comfort mode is a dropdown with `Auto (follow system setting)`, reading `prefers-reduced-motion`. | phase 10 |

Breaking changes are listed under "Upgrading from 1.0.0" in the README.

---

## Still open

**U3** footstep events · **U4** positional trauma from a blast origin · **U5** named layered shake
sources · **U6** recoil patterns and recentre · **U8** third-person and vehicle rig modes ·
**U9** cinematic one-shots (punch, handheld drift, dolly zoom) · **U12** an example scene, and
publishing the JSON into `Twillion-s-Extensions/extensions/`.

Suggested order once 1.1.0 has been run in the engine: **U3, U4, U7** have the best
effort-to-feel ratio; **U8** is the one that makes the README's third-person and vehicle claims true.
