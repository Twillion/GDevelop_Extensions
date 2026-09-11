# CameraTweens3D — API Reference & Specification

Complete specification of Behavior properties, dropdown Choice profiles, Actions, Conditions, and Expressions (ACEs) for **CameraTweens3D 1.3.0**.

> **Units.** The procedural model is solved in metres and metres per second; the scene is not.
> Everything you type in and everything you read back is in **world units** (GDevelop 3D uses the
> same units as 2D — a default Cube3D is 100 units on a side), converted through the
> `WorldUnitsPerMeter` property. Angles are always degrees.

---

## 1. `CameraTweens3D` Behavior Properties

17 properties, grouped in the editor.

### Genre Preset
| Property | Type | Default | Options / Description |
| :--- | :--- | :---: | :--- |
| **`PresetProfile`** | Choice | `Tactical Military (COD / Tarkov)` | 1-Click game feel profile: `Tactical Military (COD / Tarkov)`, `Immersive Horror (Outlast / RE7)`, `Fast Arcade Shooter (DOOM / Quake)`, `Accessibility & Comfort (Zero Motion Sickness)`, `Custom`. Applying a preset resets every tuning value it does not itself set. |

### Motion Modules
Each dropdown is a complete patch for its module: `Off` switches the whole module off, side channels included.

| Property | Type | Default | Options / Description |
| :--- | :--- | :---: | :--- |
| **`BobProfile`** | Choice | `Default for Preset` | `Off (Disabled)`, `Subtle (0.5x)`, `Standard (1.0x)`, `Heavy (1.5x)`, `Intense (2.0x)`. |
| **`LeanProfile`**<br/>*Run/Walk Lean Intensity* | Choice | `Default for Preset` | `Off (0° Flat)`, `Subtle (1.0°)`, `Standard (2.0°)`, `Heavy (3.5°)`, `Intense (5.0°)`. Roll from sideways movement **and** banking into turns, so `Off` is genuinely flat. |
| **`LandingImpactProfile`** | Choice | `Default for Preset` | `Off (Disabled)`, `Soft (0.4x)`, `Standard (1.0x)`, `Heavy (1.8x)`, `Deep Impact (2.5x)`. Scales the compression *and* the pitch dip. |
| **`BreathingProfile`** | Choice | `Default for Preset` | `Off (Disabled)`, `Subtle (0.4x)`, `Standard (1.0x)`, `Deep Breathing (1.5x)`. |
| **`RecoilProfile`** | Choice | `Default for Preset` | `Off (Disabled)`, `Subtle Kick`, `Standard FPS`, `Heavy Kick`, `Crisp Boomer Shooter`. Gates pitch, yaw and kickback together. |
| **`ShakeProfile`** | Choice | `Default for Preset` | `Off (Disabled)`, `Soft (0.5x)`, `Standard (1.0x)`, `Cinematic Heavy (1.5x)`. Independent of `MasterShakeScale`. |
| **`SpeedRushFOVProfile`** | Choice | `Default for Preset` | `Off (0° Locked)`, `Subtle (+5°)`, `Standard (+10°)`, `Extreme (+18°)`. |
| **`TerrainMicroJitterIntensity`** | Number | `0` | Noisy vertical motion in metres while grounded and moving. `0` disables it; `0.015` reproduces the original effect. |

### Field of View
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`BaseFOV`** | Number | `0` | Resting Field of View in degrees. **0 inherits the 3D layer's own FOV**, so adding the behavior does not change how the game looks. |
| **`ADSFOVTarget`** | Number | `0` | Zoomed-in FOV when aiming down sights. **0 means two thirds of the base FOV.** |

### Comfort & Master Scales
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`MasterMotionScale`** | Number | `1.0` | Global multiplier for all procedural motion (0.0 = disabled). Never written by a preset — this is the player's slider. |
| **`MasterShakeScale`** | Number | `1.0` | Global multiplier for all trauma shakes. Never written by a preset. |
| **`MotionSicknessMode`** | Choice | `Default for Preset` | `Default for Preset`, `Off`, `On`, `Auto (follow system setting)`. Zeroes roll tilt and horizontal sway, and locks the sprint FOV. `Auto` reads the OS reduced-motion preference. |

### Scene Scale & Target
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`WorldUnitsPerMeter`** | Number | `100` | How many scene units make one metre. **0 estimates it from the object's height.** |
| **`WalkSpeedReference`** | Number | `0` | The speed, in world units per second, that counts as a full-amplitude walk. **0 reads it from the character behavior**, falling back to 250. |
| **`Layer`** | String | `""` | Target 3D layer name (leave empty for the Base layer). |

---

## 2. Actions (36)

### Master & Presets
* **`Apply camera preset _PARAM2_ on _PARAM0_`** — apply a built-in profile from a dropdown selector.
* **`Set master motion scale on _PARAM0_ to _PARAM2_`** — global motion multiplier.
* **`Set master shake scale on _PARAM0_ to _PARAM2_`** — global trauma shake multiplier.
* **`Set motion sickness mode on _PARAM0_: _PARAM2_`** — enable or disable anti-nausea comfort mode.

### Combat, Trauma & Impacts
* **`Add trauma to _PARAM0_ by _PARAM2_`** — shake trauma from an explosion or hit (0.0 – 1.0).
* **`Apply weapon recoil to _PARAM0_ (Pitch: _PARAM2_, Yaw: _PARAM3_, KickbackZ: _PARAM4_)`** — pitch and yaw in degrees, kickback in **world units** (4 at the default scale). Up to 1.2.1 this argument was read as metres while `RecoilKickbackZ()` reported world units; see *Upgrading* in the README.
* **`Apply damage flinch to _PARAM0_ (Angle: _PARAM2_, Force: _PARAM3_)`** — directional flinch away from damage.
* **`Trigger landing impact on _PARAM0_ with fall speed _PARAM2_`** — fall speed in **world units per second**; the dip depth scales with it.
* **`Stop all camera shakes on _PARAM0_`** — resets trauma to 0.

### FOV & Sights
* **`Set Aim Down Sights (ADS) on _PARAM0_: _PARAM2_`** — transitions FOV and damps all procedural motion by `ADS motion damping`.
* **`Set sprinting state on _PARAM0_: _PARAM2_`** — sprint FOV rush and stride frequency boost.
* **`Tween camera FOV on _PARAM0_ to _PARAM2_ over _PARAM3_ seconds`** — holds the target; does **not** overwrite the resting FOV.
* **`Release FOV tween on _PARAM0_ over _PARAM2_ seconds`** — eases back to the automatic value and hands control back.
* **`Set base resting FOV on _PARAM0_ to _PARAM2_ degrees`**.
* **`Set ADS zoom FOV on _PARAM0_ to _PARAM2_ degrees`** — per-weapon scope zoom.

### Kinematics & Leaning
* **`Set crouching state on _PARAM0_: _PARAM2_`** — crouch head bob damping.
* **`Set manual lean angle on _PARAM0_ to _PARAM2_ degrees`** — corner peek (e.g. `-12` for Q, `+12` for E).
* **`Set manual lean max angle on _PARAM0_ to _PARAM2_ degrees`** — the clamp the above is held to.

### Modular Profile Switchers
* **`Set head bob style / run/walk lean intensity / landing impact style / breathing style / recoil feel / shake power / speed rush FOV boost on _PARAM0_ to _PARAM2_`** — the same dropdowns as the properties, at runtime.

### Granular Runtime Tuning
* **`Set head bob intensity on _PARAM0_ to _PARAM2_`**
* **`Set breathing intensity on _PARAM0_ to _PARAM2_`**
* **`Set terrain micro-jitter intensity on _PARAM0_ to _PARAM2_ metres`** — 0 disables grounded movement noise.
* **`Set run/walk lean max angle on _PARAM0_ to _PARAM2_ degrees`** — the lean at full sideways speed; negative values invert it.
* **`Set turn lean angle on _PARAM0_ to _PARAM2_ degrees`** — the bank into turns, expressed as **degrees of roll per 100°/s of yaw**: at the `Standard (2.0°)` value of 1.5 an ordinary 60°/s turn banks 0.9°, and a 180°/s whip banks 2.7° (the yaw rate is clamped there). Negative values invert it.
* **`Set landing shock intensity on _PARAM0_ to _PARAM2_`**
* **`Set recoil pitch multiplier on _PARAM0_ to _PARAM2_`** — pitch only; use the recoil profile for the whole module.
* **`Set ADS motion damping on _PARAM0_ to _PARAM2_`** — 0.0 = perfectly still while aiming, 1.0 = no damping.
* **`Set trauma decay rate on _PARAM0_ to _PARAM2_ per second`**
* **`Set world units per meter on _PARAM0_ to _PARAM2_`**
* **`Set target 3D layer for _PARAM0_ to _PARAM2_`**

---

## 3. Conditions (7)

* **`_PARAM0_ is Aiming Down Sights (ADS)`**
* **`_PARAM0_ is in sprinting rush FOV`**
* **`_PARAM0_ is crouching`**
* **`Trauma shake is active on _PARAM0_`** — trauma > 0.01.
* **`Weapon recoil spring is active on _PARAM0_`** — pitch, yaw or kickback still in motion.
* **`Motion sickness comfort mode is active on _PARAM0_`**
* **`_PARAM0_ is detected as being on the ground`** — the ground state the camera is actually using. Useful for confirming your character behavior was detected.

---

## 4. Expressions (18)

### Offsets (world units)
* **`Object.CameraTweens3D::HeadBobY()`** — the vertical head bob applied this frame.
* **`Object.CameraTweens3D::HeadBobX()`** — the horizontal head sway applied this frame.
* **`Object.CameraTweens3D::LandingDipY()`** — the landing compression applied this frame.
* **`Object.CameraTweens3D::RecoilKickbackZ()`** — the recoil kickback applied this frame.

These report what was written to the camera, damping and comfort mode included — not a separate recomputation.

### Angles (degrees)
* **`Object.CameraTweens3D::RollOffset()`** — live procedural roll delta (run/walk lean + turn lean + manual peek).
* **`Object.CameraTweens3D::RecoilPitch()`**, **`RecoilYaw()`**
* **`Object.CameraTweens3D::ManualLeanAngle()`** — current corner-peek angle.

### States & Metrics
* **`Object.CameraTweens3D::CurrentFOV()`** — live interpolated Field of View.
* **`Object.CameraTweens3D::BaseFOV()`** — resolved resting Field of View (the layer's, if inherited).
* **`Object.CameraTweens3D::TraumaLevel()`** — 0.0 – 1.0.
* **`Object.CameraTweens3D::MovementSpeedRatio()`** — normalised speed driving stride frequency (0 – 1.8).
* **`Object.CameraTweens3D::MasterMotionScale()`**, **`MasterShakeScale()`**
* **`Object.CameraTweens3D::BobIntensity()`**, **`BreathingIntensity()`**
* **`Object.CameraTweens3D::TerrainMicroJitterIntensity()`** — configured grounded movement micro-jitter amplitude in metres.
* **`Object.CameraTweens3D::WorldUnitsPerMeter()`** — the scale actually in use, after auto-detection.

---

## 5. Motion sources

At the first frame the behavior resolves where its kinematics come from, once, and caches it:

| Source | Used for | Requires |
| :--- | :--- | :--- |
| **Physics Character 3D** | ground state, fall speed, forward and sideways speed, reference max speed | `isOnFloor()` + `getCurrentFallSpeed()` + `getCurrentForwardSpeed()` on the same object |
| **Any behavior with `isOnFloor()` / `isGrounded()`** | ground state only | e.g. the Platformer behavior, **and Physics Car 3D** |
| **Position differencing** | everything else, as a fallback | nothing |

> **Physics Car 3D is a ground source only.** It exposes `isOnFloor()`, but its only speed getter is
> `getEngineSpeed()`, which reports engine **RPM** rather than a linear velocity. So a car gets its
> ground state from the behavior and every speed — forward, sideways and fall — from position
> differencing, using the object's own angle as its heading. That is the correct result for a car,
> whose angle really is its facing; it just means `WalkSpeedReference` is worth setting explicitly,
> because there is no `getForwardSpeedMax()` to read a reference from.

Fall speed is tracked as the **peak** reached while airborne, so the impact still scales correctly on the contact frame — where a character controller has already zeroed its vertical velocity.
