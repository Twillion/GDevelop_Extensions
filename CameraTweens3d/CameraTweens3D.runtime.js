/**
 * CameraTweens3D — Procedural Camera Motion, Shakes & Tweening for GDevelop 5.
 *
 * Additive procedural camera delta pipeline for Three.js 3D layers.
 * Provides:
 *  - Dual-octave Lissajous head bobbing (horizontal sway, vertical bounce, footstep roll)
 *  - Kinematic strafe leaning, centripetal turn banking, and acceleration/braking pitch inertia
 *  - Critically damped harmonic landing impact shock & pitch dip
 *  - Idle breathing oscillation
 *  - Damped spring weapon recoil kickback & snappy recovery
 *  - Directional damage flinch
 *  - Non-linear trauma screen shakes (T^p) with continuous Perlin noise
 *  - Dynamic FOV transitions (Sprinting rush, ADS zoom, custom tweens)
 *  - 4 Genre Presets: ImmersiveHorror, FastArcadeShooter, TacticalMilitary, AccessibilityComfort
 *  - Master scaling and Anti-Nausea / Motion Sickness Mode
 *
 * UNITS. The procedural model is solved in metres and metres/second. GDevelop's 3D world is
 * measured in the same units as its 2D world (a default Cube3D is 100 units on a side, and a
 * 600px-tall viewport puts the default camera ~724 units away), so every length crossing the
 * boundary is converted through `state.unitScale` — world units per metre, 100 by default.
 * Everything a user types or reads back is in world units; everything inside is metric.
 *
 * CAMERA OWNERSHIP. Deltas are not written per-behavior. Every behavior targeting the same 3D
 * layer contributes into a shared per-layer channel, which captures the untouched base transform
 * once per frame and writes base+sum. Restoring is by assignment and is skipped if something else
 * re-based the camera in the meantime, so a delta can never be subtracted from a transform it was
 * never added to.
 *
 * Author: Twillion
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__cameraTweens3D) return;

  var THREE_OK = typeof THREE !== 'undefined';

  var TWO_PI = Math.PI * 2;
  var BOB_PHASE_PERIOD = TWO_PI * 2; // bob reads cos(phase/2), so it repeats every 4pi
  var NOISE_PERIOD = 256; // the permutation lattice repeats exactly every 256 units

  /* ------------------------------------------------------------- 1D/3D Noise Generator */

  // Permutation table for smooth gradient noise (zero external dependencies)
  var PERM = new Uint8Array([
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
    8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
    35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
    134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
    55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
    18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
    250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
    189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
    172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
    228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
    107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
    138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
  ]);

  var P = new Uint8Array(512);
  for (var i = 0; i < 256; i++) {
    P[i] = PERM[i];
    P[256 + i] = PERM[i];
  }

  // Quintic smooth interpolation: 6t^5 - 15t^4 + 10t^3
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function grad1(hash, x) {
    var h = hash & 15;
    var grad = 1.0 + (h & 7);
    if ((h & 8) !== 0) grad = -grad;
    return grad * x;
  }

  function noise1D(x) {
    var xi = Math.floor(x);
    var xf = x - xi;
    var X = xi & 255;
    var u = fade(xf);
    var g0 = grad1(P[X], xf);
    var g1 = grad1(P[X + 1], xf - 1.0);
    return (g0 + u * (g1 - g0)) * 0.25;
  }

  function grad3(hash, x, y, z) {
    var h = hash & 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function noise3D(x, y, z) {
    var xi = Math.floor(x) & 255;
    var yi = Math.floor(y) & 255;
    var zi = Math.floor(z) & 255;
    var xf = x - Math.floor(x);
    var yf = y - Math.floor(y);
    var zf = z - Math.floor(z);
    var u = fade(xf);
    var v = fade(yf);
    var w = fade(zf);

    var A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi;
    var B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;

    var gAA = grad3(P[AA], xf, yf, zf);
    var gBA = grad3(P[BA], xf - 1, yf, zf);
    var gAB = grad3(P[AB], xf, yf - 1, zf);
    var gBB = grad3(P[BB], xf - 1, yf - 1, zf);
    var gAA1 = grad3(P[AA + 1], xf, yf, zf - 1);
    var gBA1 = grad3(P[BA + 1], xf - 1, yf, zf - 1);
    var gAB1 = grad3(P[AB + 1], xf, yf - 1, zf - 1);
    var gBB1 = grad3(P[BB + 1], xf - 1, yf - 1, zf - 1);

    var x1 = gAA + u * (gBA - gAA);
    var x2 = gAB + u * (gBB - gAB);
    var y1 = x1 + v * (x2 - x1);

    var x3 = gAA1 + u * (gBA1 - gAA1);
    var x4 = gAB1 + u * (gBB1 - gAB1);
    var y2 = x3 + v * (x4 - x3);

    return y1 + w * (y2 - y1);
  }

  /* ------------------------------------------------------------- Critically Damped Spring Solver */

  /**
   * Exact analytic solution for critically damped harmonic oscillator (zeta = 1.0).
   * Unconditionally stable for any dt > 0.
   */
  function solveCriticallyDampedSpring(pos, vel, targetPos, stiffness, dt) {
    if (dt <= 0) return { pos: pos, vel: vel };
    var x0 = pos - targetPos;
    var omega = stiffness;
    var exp = Math.exp(-omega * dt);
    var c1 = x0;
    var c2 = vel + omega * x0;
    var newPos = (c1 + c2 * dt) * exp + targetPos;
    var newVel = (vel - omega * c2 * dt) * exp;
    return { pos: newPos, vel: newVel };
  }

  /* ------------------------------------------------------------- Helpers */

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0.0, 1.0);
  }

  /**
   * Bound a physical magnitude without flattening it.
   *
   * A hard `clamp(x, 0, cap)` makes every input past `cap` produce the identical output, which is
   * how 1.0.0 ended up giving a 60 u/s drop and a 900 u/s drop the same landing impulse. Scaling
   * the cap into world units moved the ceiling but did not remove it: at the shipped constants the
   * pitch dip still flattened above a ~5.5 m/s fall, which is a drop of less than two metres.
   *
   * `cap * tanh(x / cap)` is the same curve for small `x` (tanh x = x - x^3/3 + ..., so it is
   * within 1% of linear while x stays under a fifth of the cap), stays strictly monotonic for
   * every input, and approaches `cap` asymptotically instead of hitting it. A fall twice as far
   * always lands harder than the shallower one, however far you fell.
   */
  function softSaturate(x, cap) {
    if (!(cap > 0)) return 0;
    var v = Math.max(0, x);
    return cap * Math.tanh(v / cap);
  }

  function degToRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  function assignPatch(target, patch) {
    if (!patch) return;
    for (var k in patch) {
      if (patch.hasOwnProperty(k)) target[k] = patch[k];
    }
  }

  function wrapAngleDeg(d) {
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  /* ------------------------------------------------------------- Tuning Defaults & Presets */

  /**
   * Every value a preset or a module profile is allowed to touch. `applyPreset` resets to this
   * first, so switching from a preset that zeroes a field to one that never mentions it cannot
   * leave the zero behind.
   */
  var DEFAULT_TUNING = {
    // Head bobbing & stride dynamics (metres)
    bobIntensity: 1.0,
    bobHorizontalWeight: 0.04,
    bobVerticalWeight: 0.06,
    bobRollWeight: 0.8,
    strideFrequency: 1.8,
    sprintFrequencyMultiplier: 1.4,
    crouchDamping: 0.35,
    airborneDamping: 0.0,

    // Kinematic tilt & inertia (degrees)
    leanMaxAngle: 2.0,
    leanSmoothing: 8.0,
    turnLeanAngle: 1.5,
    accelPitchInertia: 1.2,
    brakePitchInertia: 1.5,
    manualLeanMaxAngle: 12.0,
    manualLeanOffset: 0.35,

    // Jump, fall & impacts (metres, metres/second)
    landingShockIntensity: 1.0,
    landingPitchDip: 3.0,
    landingMinFallSpeed: 2.5,
    landingSpringStiffness: 14.0,
    // Opt-in: fine contact noise can read as camera instability in smooth FPS controllers.
    stairJitterIntensity: 0.0,

    // Breathing & idle
    breathingIntensity: 1.0,
    breathingSpeed: 0.35,
    adsBreathingDamping: 0.1,

    // Weapon recoil & combat
    recoilScale: 1.0,
    recoilPitchMultiplier: 1.0,
    recoilYawRandomness: 0.5,
    recoilKickbackZ: 0.04,
    recoilRecoverySpeed: 16.0,
    damageFlinchScale: 1.0,

    // Trauma & screen shake
    shakeIntensity: 1.0,
    traumaDecayRate: 1.2,
    traumaExponent: 2.0,
    maxShakePosition: 0.2,
    maxShakeAngle: 4.5,
    shakeNoiseFrequency: 25.0,

    // Dynamic FOV
    sprintFOVBonus: 10.0,
    fovTweenSpeed: 10.0,
    adsMotionDamping: 0.35,

    // Comfort
    motionSicknessMode: false
  };

  var PRESETS = {
    ImmersiveHorror: {
      bobIntensity: 1.4,
      bobHorizontalWeight: 0.05,
      bobVerticalWeight: 0.08,
      bobRollWeight: 1.2,
      leanMaxAngle: 2.5,
      turnLeanAngle: 1.8,
      landingShockIntensity: 1.8,
      landingPitchDip: 4.5,
      breathingIntensity: 1.5,
      breathingSpeed: 0.3,
      sprintFOVBonus: 5.0,
      shakeIntensity: 1.2,
      recoilScale: 1.0,
      motionSicknessMode: false
    },
    FastArcadeShooter: {
      bobIntensity: 0.3,
      bobHorizontalWeight: 0.02,
      bobVerticalWeight: 0.03,
      bobRollWeight: 0.4,
      leanMaxAngle: 1.0,
      turnLeanAngle: 0.75,
      landingShockIntensity: 0.4,
      landingPitchDip: 1.5,
      breathingIntensity: 0.0,
      breathingSpeed: 0.0,
      sprintFOVBonus: 15.0,
      shakeIntensity: 1.0,
      recoilScale: 0.8,
      recoilRecoverySpeed: 24.0,
      motionSicknessMode: false
    },
    TacticalMilitary: {
      bobIntensity: 0.8,
      bobHorizontalWeight: 0.04,
      bobVerticalWeight: 0.06,
      bobRollWeight: 0.8,
      leanMaxAngle: 2.0,
      turnLeanAngle: 1.5,
      landingShockIntensity: 1.0,
      landingPitchDip: 3.0,
      breathingIntensity: 0.6,
      breathingSpeed: 0.35,
      sprintFOVBonus: 8.0,
      shakeIntensity: 1.0,
      recoilScale: 1.0,
      motionSicknessMode: false
    },
    AccessibilityComfort: {
      bobIntensity: 0.0,
      bobHorizontalWeight: 0.0,
      bobVerticalWeight: 0.0,
      bobRollWeight: 0.0,
      leanMaxAngle: 0.0,
      turnLeanAngle: 0.0,
      accelPitchInertia: 0.0,
      brakePitchInertia: 0.0,
      stairJitterIntensity: 0.0,
      landingShockIntensity: 0.2,
      landingPitchDip: 0.5,
      breathingIntensity: 0.0,
      breathingSpeed: 0.0,
      sprintFOVBonus: 0.0,
      shakeIntensity: 0.5,
      recoilScale: 0.5,
      motionSicknessMode: true
    }
  };

  var PRESET_ALIASES = {
    'Tactical Military': 'TacticalMilitary',
    'Tactical Military (COD / Tarkov)': 'TacticalMilitary',
    'TacticalMilitary': 'TacticalMilitary',

    'Immersive Horror': 'ImmersiveHorror',
    'Immersive Horror (Outlast / RE7)': 'ImmersiveHorror',
    'ImmersiveHorror': 'ImmersiveHorror',

    'Fast Arcade Shooter': 'FastArcadeShooter',
    'Fast Arcade Shooter (DOOM / Quake)': 'FastArcadeShooter',
    'FastArcadeShooter': 'FastArcadeShooter',

    'Accessibility & Comfort': 'AccessibilityComfort',
    'Accessibility & Comfort (Zero Motion Sickness)': 'AccessibilityComfort',
    'AccessibilityComfort': 'AccessibilityComfort',
    'Accessibility / Comfort': 'AccessibilityComfort',
    'Accessibility': 'AccessibilityComfort'
  };

  /* ------------------------------------------------------------- Module Profiles
   *
   * Each profile is a full patch for its module, not a single scalar. "Off" has to switch every
   * term of its module off, or the module keeps running through the side channel the scalar
   * never covered (a landing with no compression but a full pitch dip, a "flat" strafe setting
   * that still banks through turns, a disabled recoil that still yaws and kicks back).
   */

  var BOB_PROFILES = {
    'Default for Preset': null,
    'Off (Disabled)': { bobIntensity: 0.0 },
    'Subtle (0.5x)': { bobIntensity: 0.5 },
    'Standard (1.0x)': { bobIntensity: 1.0 },
    'Heavy (1.5x)': { bobIntensity: 1.5 },
    'Intense (2.0x)': { bobIntensity: 2.0 }
  };
  BOB_PROFILES['Off'] = BOB_PROFILES['Off (Disabled)'];
  BOB_PROFILES['Subtle'] = BOB_PROFILES['Subtle (0.5x)'];
  BOB_PROFILES['Standard'] = BOB_PROFILES['Standard (1.0x)'];
  BOB_PROFILES['Heavy'] = BOB_PROFILES['Heavy (1.5x)'];
  BOB_PROFILES['Intense'] = BOB_PROFILES['Intense (2.0x)'];

  var LEAN_PROFILES = {
    'Default for Preset': null,
    'Off (0° Flat)': { leanMaxAngle: 0.0, turnLeanAngle: 0.0 },
    'Subtle (1.0°)': { leanMaxAngle: 1.0, turnLeanAngle: 0.75 },
    'Standard (2.0°)': { leanMaxAngle: 2.0, turnLeanAngle: 1.5 },
    'Heavy (3.5°)': { leanMaxAngle: 3.5, turnLeanAngle: 2.6 },
    'Intense (5.0°)': { leanMaxAngle: 5.0, turnLeanAngle: 3.75 }
  };
  LEAN_PROFILES['Off'] = LEAN_PROFILES['Off (0° Flat)'];
  LEAN_PROFILES['Subtle'] = LEAN_PROFILES['Subtle (1.0°)'];
  LEAN_PROFILES['Standard'] = LEAN_PROFILES['Standard (2.0°)'];
  LEAN_PROFILES['Heavy'] = LEAN_PROFILES['Heavy (3.5°)'];
  LEAN_PROFILES['Intense'] = LEAN_PROFILES['Intense (5.0°)'];

  var LANDING_PROFILES = {
    'Default for Preset': null,
    'Off (Disabled)': { landingShockIntensity: 0.0 },
    'Soft (0.4x)': { landingShockIntensity: 0.4 },
    'Standard (1.0x)': { landingShockIntensity: 1.0 },
    'Heavy (1.8x)': { landingShockIntensity: 1.8 },
    'Deep Impact (2.5x)': { landingShockIntensity: 2.5 }
  };
  LANDING_PROFILES['Off'] = LANDING_PROFILES['Off (Disabled)'];
  LANDING_PROFILES['Soft'] = LANDING_PROFILES['Soft (0.4x)'];
  LANDING_PROFILES['Standard'] = LANDING_PROFILES['Standard (1.0x)'];
  LANDING_PROFILES['Heavy'] = LANDING_PROFILES['Heavy (1.8x)'];
  LANDING_PROFILES['Deep Impact'] = LANDING_PROFILES['Deep Impact (2.5x)'];

  var BREATHING_PROFILES = {
    'Default for Preset': null,
    'Off (Disabled)': { breathingIntensity: 0.0, breathingSpeed: 0.0 },
    'Subtle (0.4x)': { breathingIntensity: 0.4, breathingSpeed: 0.3 },
    'Standard (1.0x)': { breathingIntensity: 1.0, breathingSpeed: 0.35 },
    'Deep Breathing (1.5x)': { breathingIntensity: 1.5, breathingSpeed: 0.3 }
  };
  BREATHING_PROFILES['Off'] = BREATHING_PROFILES['Off (Disabled)'];
  BREATHING_PROFILES['Subtle'] = BREATHING_PROFILES['Subtle (0.4x)'];
  BREATHING_PROFILES['Standard'] = BREATHING_PROFILES['Standard (1.0x)'];
  BREATHING_PROFILES['Deep Breathing'] = BREATHING_PROFILES['Deep Breathing (1.5x)'];

  var RECOIL_PROFILES = {
    'Default for Preset': null,
    'Off (Disabled)': { recoilScale: 0.0, recoilRecoverySpeed: 16.0 },
    'Subtle Kick': { recoilScale: 0.6, recoilRecoverySpeed: 18.0 },
    'Standard FPS': { recoilScale: 1.0, recoilRecoverySpeed: 16.0 },
    'Heavy Kick': { recoilScale: 1.6, recoilRecoverySpeed: 12.0 },
    'Crisp Boomer Shooter': { recoilScale: 0.8, recoilRecoverySpeed: 24.0 }
  };

  var SHAKE_PROFILES = {
    'Default for Preset': null,
    'Off (Disabled)': { shakeIntensity: 0.0 },
    'Soft (0.5x)': { shakeIntensity: 0.5 },
    'Standard (1.0x)': { shakeIntensity: 1.0 },
    'Cinematic Heavy (1.5x)': { shakeIntensity: 1.5 }
  };
  SHAKE_PROFILES['Off'] = SHAKE_PROFILES['Off (Disabled)'];
  SHAKE_PROFILES['Soft'] = SHAKE_PROFILES['Soft (0.5x)'];
  SHAKE_PROFILES['Standard'] = SHAKE_PROFILES['Standard (1.0x)'];
  SHAKE_PROFILES['Cinematic Heavy'] = SHAKE_PROFILES['Cinematic Heavy (1.5x)'];

  var SPEED_FOV_PROFILES = {
    'Default for Preset': null,
    'Off (0° Locked)': { sprintFOVBonus: 0.0 },
    'Subtle (+5°)': { sprintFOVBonus: 5.0 },
    'Standard (+10°)': { sprintFOVBonus: 10.0 },
    'Extreme (+18°)': { sprintFOVBonus: 18.0 }
  };
  SPEED_FOV_PROFILES['Off'] = SPEED_FOV_PROFILES['Off (0° Locked)'];
  SPEED_FOV_PROFILES['Subtle'] = SPEED_FOV_PROFILES['Subtle (+5°)'];
  SPEED_FOV_PROFILES['Standard'] = SPEED_FOV_PROFILES['Standard (+10°)'];
  SPEED_FOV_PROFILES['Extreme'] = SPEED_FOV_PROFILES['Extreme (+18°)'];

  var COMFORT_CHOICES = {
    'Default for Preset': null,
    'Off': false,
    'On': true,
    'Auto (follow system setting)': 'auto',
    // Accepted so that a project saved against 1.0.0, where this was a Boolean property,
    // still reads back as something meaningful after the upgrade.
    'false': false,
    'true': true
  };

  function prefersReducedMotion() {
    try {
      return typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------- State Registry */

  var instances = new WeakMap();

  function stateOf(behavior) {
    return instances.get(behavior) || null;
  }

  function getLayer(runtimeScene, layerName) {
    try {
      return runtimeScene.getLayer(layerName || '');
    } catch (e) {
      return null;
    }
  }

  function getThreeCameraOf(layer) {
    if (!THREE_OK || !layer) return null;
    try {
      var lr = layer.getRenderer && layer.getRenderer();
      return lr && typeof lr.getThreeCamera === 'function' ? lr.getThreeCamera() : null;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------- Shared Camera Channels
   *
   * One channel per (scene, layer). Behaviors contribute deltas into it; the channel owns the
   * base transform and is the only thing that writes the Three camera.
   */

  var sceneChannels = new WeakMap();
  var EPS = 1e-6;

  function channelFor(runtimeScene, layerName, camera) {
    var byLayer = sceneChannels.get(runtimeScene);
    if (!byLayer) {
      byLayer = new Map();
      sceneChannels.set(runtimeScene, byLayer);
    }
    var key = layerName || '';
    var ch = byLayer.get(key);
    if (!ch || ch.camera !== camera) {
      ch = {
        camera: camera,
        active: false,
        basePos: { x: 0, y: 0, z: 0 },
        baseQuat: THREE_OK ? new THREE.Quaternion() : null,
        baseFov: 0,
        wrotePos: { x: 0, y: 0, z: 0 },
        wroteQuat: THREE_OK ? new THREE.Quaternion() : null,
        wroteFov: 0,
        accPos: { x: 0, y: 0, z: 0 },
        accQuat: THREE_OK ? new THREE.Quaternion() : null,
        accFov: 0
      };
      byLayer.set(key, ch);
    }
    return ch;
  }

  function quatMatches(q, ref) {
    return Math.abs(q.x - ref.x) < EPS && Math.abs(q.y - ref.y) < EPS &&
      Math.abs(q.z - ref.z) < EPS && Math.abs(q.w - ref.w) < EPS;
  }

  /**
   * Put the camera back the way we found it. Each component is restored only if it still holds
   * exactly what we wrote — if anything re-based the camera in between (a `setCameraX` from a
   * later behavior, a layer resize), that component is left alone rather than having a stale
   * delta subtracted out of it.
   */
  function channelRelease(ch) {
    if (!ch || !ch.active || !ch.camera) return;
    var cam = ch.camera;

    if (Math.abs(cam.position.x - ch.wrotePos.x) < EPS &&
        Math.abs(cam.position.y - ch.wrotePos.y) < EPS &&
        Math.abs(cam.position.z - ch.wrotePos.z) < EPS) {
      cam.position.x = ch.basePos.x;
      cam.position.y = ch.basePos.y;
      cam.position.z = ch.basePos.z;
    }

    if (ch.wroteQuat && quatMatches(cam.quaternion, ch.wroteQuat)) {
      cam.quaternion.copy(ch.baseQuat);
    }

    if (cam.isPerspectiveCamera && Math.abs(cam.fov - ch.wroteFov) < 1e-4) {
      cam.fov = ch.baseFov;
      cam.updateProjectionMatrix();
    }

    ch.active = false;
  }

  var _scratchV3 = null;
  var _scratchEuler = null;
  var _scratchQuat = null;

  function ensureScratch() {
    if (!THREE_OK || _scratchV3) return;
    _scratchV3 = new THREE.Vector3();
    _scratchEuler = new THREE.Euler();
    _scratchQuat = new THREE.Quaternion();
  }

  function channelContribute(ch, layer, deltas) {
    if (!THREE_OK || !ch || !ch.camera) return;
    ensureScratch();
    var cam = ch.camera;

    if (!ch.active) {
      // First contributor this frame: the camera is clean, so this is the base.
      ch.basePos.x = cam.position.x;
      ch.basePos.y = cam.position.y;
      ch.basePos.z = cam.position.z;
      ch.baseQuat.copy(cam.quaternion);
      ch.baseFov = cam.isPerspectiveCamera ? cam.fov : 0;
      ch.accPos.x = ch.accPos.y = ch.accPos.z = 0;
      ch.accQuat.set(0, 0, 0, 1);
      ch.accFov = 0;
      ch.active = true;
    }

    // Position: local camera-frame offset, rotated by the *base* orientation so that
    // contributors cannot rotate each other's translations.
    _scratchV3.set(deltas.localPos.x, deltas.localPos.y, deltas.localPos.z);
    _scratchV3.applyQuaternion(ch.baseQuat);
    ch.accPos.x += _scratchV3.x;
    ch.accPos.y += _scratchV3.y;
    ch.accPos.z += _scratchV3.z;

    // Rotation: compose into the shared accumulator, never onto the live camera.
    _scratchEuler.set(
      degToRad(deltas.rotDeg.pitch),
      degToRad(deltas.rotDeg.yaw),
      degToRad(deltas.rotDeg.roll),
      'YXZ'
    );
    _scratchQuat.setFromEuler(_scratchEuler);
    ch.accQuat.multiply(_scratchQuat);

    if (deltas.fovDeltaValid) ch.accFov += deltas.targetFOV - ch.baseFov;

    // Write base + accumulated.
    cam.position.x = ch.basePos.x + ch.accPos.x;
    cam.position.y = ch.basePos.y + ch.accPos.y;
    cam.position.z = ch.basePos.z + ch.accPos.z;
    ch.wrotePos.x = cam.position.x;
    ch.wrotePos.y = cam.position.y;
    ch.wrotePos.z = cam.position.z;

    cam.quaternion.copy(ch.baseQuat).multiply(ch.accQuat);
    ch.wroteQuat.copy(cam.quaternion);

    if (cam.isPerspectiveCamera) {
      var fov = clamp(ch.baseFov + ch.accFov, 1.0, 179.0);
      if (Math.abs(fov - cam.fov) > 1e-4) {
        // Prefer the layer setter so GDevelop's own dirty flag and clamping stay in sync.
        if (layer && typeof layer.setCamera3DFieldOfView === 'function') {
          layer.setCamera3DFieldOfView(fov);
        } else {
          cam.fov = fov;
        }
        cam.updateProjectionMatrix();
      }
      ch.wroteFov = cam.fov;
    }
  }

  /* ------------------------------------------------------------- Behavior State */

  function createBehaviorState(object, behavior) {
    var state = {
      object: object,
      behavior: behavior,
      layerName: '',

      // Unit + reference-speed resolution (0 = auto)
      worldUnitsPerMeterOption: 0,
      unitScale: 100,
      walkSpeedReferenceOption: 0,
      referenceWalkSpeed: 4.0, // metres/second

      // Master controls (only ever written by the user, never by a preset or profile)
      masterMotionScale: 1.0,
      masterShakeScale: 1.0,

      // FOV configuration (0 = inherit from the layer)
      baseFOVOption: 0,
      adsFOVOption: 0,
      baseFOV: 0,
      adsFOVTarget: 0,
      fovResolved: false,

      // Live runtime states
      trauma: 0.0,
      isADS: false,
      isSprinting: false,
      isCrouching: false,
      isGrounded: true,
      peakFallSpeed: 0.0,

      // Springs & oscillators
      recoilPitch: 0.0, recoilPitchVel: 0.0,
      recoilYaw: 0.0, recoilYawVel: 0.0,
      recoilZ: 0.0, recoilZVel: 0.0,

      landingY: 0.0, landingYVel: 0.0,
      landingPitch: 0.0, landingPitchVel: 0.0,

      flinchPitch: 0.0, flinchPitchVel: 0.0,
      flinchYaw: 0.0, flinchYawVel: 0.0,
      flinchRoll: 0.0, flinchRollVel: 0.0,

      bobPhase: 0.0,
      breathPhase: 0.0,
      jitterPhase: 0.0,
      shakeTime: 0.0,
      shakeSeed: 0.0,

      leanRollCurrent: 0.0,
      accelPitchCurrent: 0.0,
      manualLeanTargetAngle: 0.0,
      manualLeanCurrentAngle: 0.0,

      currentFOV: 0.0,
      fovInitialized: false,
      fovOverride: null, // { active, startFOV, targetFOV, duration, elapsed, releasing }

      // Kinematic tracking
      sourcesResolved: false,
      motionSource: null,
      groundSource: null,
      yawSource: '', // '', 'cameraRotation', 'cameraRotationY', 'objectAngle'
      prevX: object && object.getX ? object.getX() : 0,
      prevY: object && object.getY ? object.getY() : 0,
      prevZ: object && object.getZ ? object.getZ() : 0,
      prevYaw: 0,
      prevYawInit: false,
      currentSpeed: 0.0,
      currentSpeedRatio: 0.0,
      forwardSpeed: 0.0,
      lateralSpeed: 0.0,
      verticalSpeed: 0.0,
      forwardAccel: 0.0,
      yawAngularVelocity: 0.0,

      // Last solved offsets, in world units, exactly as applied (read back by expressions)
      appliedBobY: 0.0,
      appliedBobX: 0.0,
      appliedLandingY: 0.0,
      appliedRecoilZ: 0.0,

      enabled: true
    };

    assignPatch(state, DEFAULT_TUNING);

    if (object && typeof object.id === 'number') {
      // Decorrelate concurrent shakes without needing an explicit seed action.
      state.shakeSeed = (object.id * 37.137) % NOISE_PERIOD;
    }

    instances.set(behavior, state);
    return state;
  }

  function resolveUnitScale(state, object) {
    if (state.worldUnitsPerMeterOption > 0) {
      state.unitScale = state.worldUnitsPerMeterOption;
      return;
    }
    // Auto: assume the owner is roughly human-height (1.8 m) if it has a 3D depth.
    var depth = object && typeof object.getDepth === 'function' ? object.getDepth() : 0;
    state.unitScale = depth > 0 ? depth / 1.8 : 100;
    if (!isFinite(state.unitScale) || state.unitScale <= 0) state.unitScale = 100;
  }

  function resolveSources(state, object) {
    state.sourcesResolved = true;
    state.motionSource = null;
    state.groundSource = null;

    var list = object && object._behaviors ? object._behaviors : [];
    for (var b = 0; b < list.length; b++) {
      var beh = list[b];
      if (!beh) continue;

      // A full character controller (Physics Character 3D / Physics Car 3D) reports its own
      // velocities, which beats differentiating position twice.
      if (!state.motionSource &&
          typeof beh.getCurrentFallSpeed === 'function' &&
          typeof beh.getCurrentForwardSpeed === 'function' &&
          typeof beh.isOnFloor === 'function') {
        state.motionSource = beh;
        state.groundSource = beh;
        continue;
      }
      // `isOnFloor` covers Physics Character 3D, Physics Car 3D and the Platformer behavior.
      // Nothing in stock GDJS defines `isGrounded`; it is here for hand-written behaviors.
      if (!state.groundSource) {
        if (typeof beh.isOnFloor === 'function') state.groundSource = beh;
        else if (typeof beh.isGrounded === 'function') state.groundSource = beh;
      }
    }
  }

  /** Pick whichever yaw channel is actually moving; the first one seen to change wins. */
  function readYaw(state, layer, object, channel) {
    // `getCameraRotationY` reads the live Three camera, so it would feed our own roll/pitch delta
    // straight back into turn banking if another contributor has already written this frame.
    var cameraDirty = !!(channel && channel.active);
    if (cameraDirty && state.yawSource === 'cameraRotationY') return state.prevYaw;

    var candidates = [];
    if (layer && typeof layer.getCameraRotation === 'function') {
      candidates.push(['cameraRotation', layer.getCameraRotation()]);
    }
    if (!cameraDirty && layer && typeof layer.getCameraRotationY === 'function') {
      candidates.push(['cameraRotationY', layer.getCameraRotationY()]);
    }
    if (object && typeof object.getAngle === 'function') {
      candidates.push(['objectAngle', object.getAngle()]);
    }
    if (!candidates.length) return 0;

    if (state.yawSource) {
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i][0] === state.yawSource) return candidates[i][1];
      }
      return candidates[0][1];
    }

    // Not locked in yet: remember every reading, and lock to the first that moves.
    if (!state._yawProbe) state._yawProbe = {};
    for (var j = 0; j < candidates.length; j++) {
      var name = candidates[j][0];
      var val = candidates[j][1];
      if (state._yawProbe[name] === undefined) {
        state._yawProbe[name] = val;
      } else if (Math.abs(wrapAngleDeg(val - state._yawProbe[name])) > 0.01) {
        state.yawSource = name;
        return val;
      }
    }
    // Nothing has moved yet — the camera's own angle is the best default.
    return candidates[0][1];
  }

  /* ------------------------------------------------------------- Kinematic Tracker */

  function updateKinematics(state, object, layer, channel, dt) {
    if (dt <= 0.0001) return;
    var U = state.unitScale;

    if (!state.sourcesResolved) resolveSources(state, object);

    // ---- Ground state ----
    var grounded = true;
    if (state.groundSource) {
      grounded = typeof state.groundSource.isOnFloor === 'function'
        ? !!state.groundSource.isOnFloor()
        : !!state.groundSource.isGrounded();
    }

    // ---- Velocities, in metres/second ----
    var curX = object.getX ? object.getX() : 0;
    var curY = object.getY ? object.getY() : 0;
    var curZ = object.getZ ? object.getZ() : 0;

    var fwd, lat, fallSpeed;

    if (state.motionSource) {
      fwd = state.motionSource.getCurrentForwardSpeed() / U;
      lat = typeof state.motionSource.getCurrentSidewaysSpeed === 'function'
        ? state.motionSource.getCurrentSidewaysSpeed() / U
        : 0;
      // getCurrentFallSpeed is clamped to [0, maxFallingSpeed]: a positive downward magnitude.
      fallSpeed = Math.max(0, state.motionSource.getCurrentFallSpeed()) / U;
      state.verticalSpeed = -fallSpeed;
    } else {
      var vx = (curX - state.prevX) / dt / U;
      var vy = (curY - state.prevY) / dt / U;
      var vz = (curZ - state.prevZ) / dt / U;
      // GDevelop's angle convention is clockwise in a Y-down plane, so this is the object's
      // own forward / right pair in that same frame.
      var rad = degToRad(object.getAngle ? object.getAngle() : 0);
      var cosA = Math.cos(rad);
      var sinA = Math.sin(rad);
      fwd = vx * cosA + vy * sinA;
      lat = -vx * sinA + vy * cosA;
      fallSpeed = Math.max(0, -vz);
      state.verticalSpeed = vz;
    }

    state.forwardAccel = (fwd - state.forwardSpeed) / dt;
    state.forwardSpeed = fwd;
    state.lateralSpeed = lat;

    var planarSpeed = Math.sqrt(fwd * fwd + lat * lat);
    state.currentSpeed = planarSpeed;

    // ---- Reference walking speed ----
    var refSpeed = state.referenceWalkSpeed;
    if (state.walkSpeedReferenceOption > 0) {
      refSpeed = state.walkSpeedReferenceOption / U;
    } else if (state.motionSource && typeof state.motionSource.getForwardSpeedMax === 'function') {
      var maxFwd = state.motionSource.getForwardSpeedMax() / U;
      var maxLat = typeof state.motionSource.getSidewaysSpeedMax === 'function'
        ? state.motionSource.getSidewaysSpeedMax() / U
        : 0;
      refSpeed = Math.max(maxFwd, maxLat);
    } else {
      refSpeed = 250 / U; // a plain GDevelop walk, with nothing better to go on
    }
    state.referenceWalkSpeed = Math.max(0.25, refSpeed);
    state.currentSpeedRatio = clamp(planarSpeed / state.referenceWalkSpeed, 0.0, 1.8);

    // ---- Yaw rate ----
    var yaw = readYaw(state, layer, object, channel);
    if (!state.prevYawInit) {
      state.prevYaw = yaw;
      state.prevYawInit = true;
    }
    state.yawAngularVelocity = wrapAngleDeg(yaw - state.prevYaw) / dt;
    state.prevYaw = yaw;

    // ---- Landing edge ----
    if (!grounded) {
      state.peakFallSpeed = Math.max(state.peakFallSpeed, fallSpeed);
    } else if (!state.isGrounded) {
      // Rising edge, tested against last frame's value — not one two frames old.
      var impactSpeed = Math.max(state.peakFallSpeed, fallSpeed);
      if (impactSpeed > state.landingMinFallSpeed) {
        applyLandingImpact(state, impactSpeed);
      }
      state.peakFallSpeed = 0;
    }
    state.isGrounded = grounded;

    state.prevX = curX;
    state.prevY = curY;
    state.prevZ = curZ;
  }

  /** fallSpeedMps: positive downward magnitude, in metres/second. */
  function applyLandingImpact(state, fallSpeedMps) {
    var speed = Math.max(0, fallSpeedMps);
    var shock = state.landingShockIntensity;
    if (shock <= 0) return; // "Off" means off — pitch dip included.

    // The caps sit far enough above the plausible gameplay range (a hard landing is 7-8 m/s, a
    // long fall 15, a death fall 30) that ordinary landings stay within ~1% of the old linear
    // response, while an enormous fall converges instead of clipping. 1.0.0's hard clamps were
    // 0.4 and 10, reached at 10 m/s and 5.5 m/s respectively.
    var master = shock * state.masterMotionScale;
    var compression = softSaturate(speed * 0.04 * master, 1.6);
    var pitchDip = softSaturate(speed * 0.6 * state.landingPitchDip * master, 60.0);

    state.landingYVel -= compression * 18.0;
    state.landingPitchVel += pitchDip * 15.0;
  }

  /* ------------------------------------------------------------- Procedural Solvers */

  var _scratchDeltas = {
    localPos: { x: 0, y: 0, z: 0 },
    rotDeg: { pitch: 0, yaw: 0, roll: 0 },
    targetFOV: 75,
    fovDeltaValid: false
  };

  function resolveFOV(state, layer, channel) {
    if (state.fovResolved) return;
    var layerFOV = 0;
    if (channel && channel.active) {
      // Someone already wrote this frame: the channel's captured base is the untouched value.
      layerFOV = channel.baseFov || 0;
    } else if (layer && typeof layer.getCamera3DFieldOfView === 'function') {
      layerFOV = layer.getCamera3DFieldOfView() || 0;
    }
    state.baseFOV = state.baseFOVOption > 0
      ? state.baseFOVOption
      : (layerFOV > 0 ? layerFOV : 45);
    state.adsFOVTarget = state.adsFOVOption > 0
      ? state.adsFOVOption
      : state.baseFOV * 0.66;
    state.fovResolved = true;
  }

  function stepProceduralDeltas(state, dt) {
    var masterM = state.masterMotionScale;
    var masterS = state.masterShakeScale * state.shakeIntensity;
    var antiNausea = state.motionSicknessMode;
    var adsDamp = state.isADS ? clamp(state.adsMotionDamping, 0.0, 1.0) : 1.0;
    var motion = masterM * adsDamp;

    // 1. Decay trauma
    if (state.trauma > 0) {
      state.trauma = Math.max(0.0, state.trauma - state.traumaDecayRate * dt);
    }
    state.shakeTime += dt;
    // Wrap on an exact multiple of the noise lattice period so the shake stays continuous.
    var noisePeriodSeconds = NOISE_PERIOD / Math.max(0.001, state.shakeNoiseFrequency);
    while (state.shakeTime > noisePeriodSeconds * 4) state.shakeTime -= noisePeriodSeconds;

    // 2. Head bobbing Lissajous curve
    var speedRatio = state.currentSpeedRatio;
    if (!state.isGrounded) speedRatio *= state.airborneDamping;
    if (state.isCrouching) speedRatio *= state.crouchDamping;

    var freq = state.strideFrequency * (state.isSprinting ? state.sprintFrequencyMultiplier : 1.0);
    var phaseStep = TWO_PI * freq * speedRatio * dt;
    state.bobPhase += phaseStep;
    while (state.bobPhase > BOB_PHASE_PERIOD) state.bobPhase -= BOB_PHASE_PERIOD;
    state.jitterPhase += phaseStep * 3.5;
    while (state.jitterPhase > NOISE_PERIOD) state.jitterPhase -= NOISE_PERIOD;

    var bobX = 0, bobY = 0, bobRoll = 0;
    if (motion > 0 && speedRatio > 0.01) {
      var halfPhase = state.bobPhase * 0.5;
      bobX = Math.cos(halfPhase) * state.bobHorizontalWeight * speedRatio * state.bobIntensity * motion;
      bobY = -Math.abs(Math.sin(halfPhase)) * state.bobVerticalWeight * speedRatio * state.bobIntensity * motion;
      if (antiNausea) bobX = 0; // comfort mode really does flatten the horizontal sway
      else bobRoll = Math.cos(halfPhase) * state.bobRollWeight * speedRatio * state.bobIntensity * motion;
    }

    // 3. Idle breathing sway
    state.breathPhase += TWO_PI * state.breathingSpeed * dt;
    while (state.breathPhase > BOB_PHASE_PERIOD) state.breathPhase -= BOB_PHASE_PERIOD;

    var breathWeight = (1.0 - clamp(speedRatio * 0.8, 0.0, 0.9)) * state.breathingIntensity * masterM;
    if (state.isADS) breathWeight *= state.adsBreathingDamping;
    if (antiNausea) breathWeight *= 0.3;

    var breathX = antiNausea ? 0 : Math.cos(state.breathPhase * 0.5) * 0.008 * breathWeight;
    var breathY = Math.sin(state.breathPhase) * 0.015 * breathWeight;
    var breathPitch = Math.sin(state.breathPhase + 0.3) * 0.3 * breathWeight;

    // 4. Strafe leaning, turn banking & inertia
    var targetLeanRoll = 0.0;
    if (!antiNausea && motion > 0) {
      var latRatio = clamp(state.lateralSpeed / Math.max(0.25, state.referenceWalkSpeed), -1.5, 1.5);
      targetLeanRoll = -latRatio * state.leanMaxAngle * motion;

      var turnRoll = -clamp(state.yawAngularVelocity, -180, 180) * 0.01 * state.turnLeanAngle * motion;
      targetLeanRoll += turnRoll;
    }

    // Manual lean (Q/E peeking)
    if (!antiNausea) {
      state.manualLeanCurrentAngle = lerp(
        state.manualLeanCurrentAngle,
        state.manualLeanTargetAngle,
        1.0 - Math.exp(-12.0 * dt)
      );
      targetLeanRoll += state.manualLeanCurrentAngle;
    } else {
      state.manualLeanCurrentAngle = 0.0;
    }

    var leanAlpha = 1.0 - Math.exp(-state.leanSmoothing * dt);
    state.leanRollCurrent = lerp(state.leanRollCurrent, targetLeanRoll, leanAlpha);

    // Acceleration pitch inertia. The raw acceleration is a second difference and is noisy even
    // when it comes from a character controller, so it is low-passed before it drives anything.
    var targetAccelPitch = 0.0;
    if (motion > 0) {
      var accelRef = Math.max(1.0, state.referenceWalkSpeed * 4.0);
      var aNorm = clamp(state.forwardAccel / accelRef, -1.0, 1.0);
      targetAccelPitch = -aNorm * (aNorm > 0 ? state.accelPitchInertia : state.brakePitchInertia) * motion;
    }
    state.accelPitchCurrent = lerp(state.accelPitchCurrent, targetAccelPitch, 1.0 - Math.exp(-6.0 * dt));

    // 5. Landing shock spring
    var landSpring = solveCriticallyDampedSpring(state.landingY, state.landingYVel, 0.0, state.landingSpringStiffness, dt);
    state.landingY = landSpring.pos;
    state.landingYVel = landSpring.vel;

    var landPitchSpring = solveCriticallyDampedSpring(state.landingPitch, state.landingPitchVel, 0.0, state.landingSpringStiffness, dt);
    state.landingPitch = landPitchSpring.pos;
    state.landingPitchVel = landPitchSpring.vel;

    // 6. Recoil spring solver
    var recK = state.recoilRecoverySpeed;
    var rPitch = solveCriticallyDampedSpring(state.recoilPitch, state.recoilPitchVel, 0.0, recK, dt);
    state.recoilPitch = rPitch.pos;
    state.recoilPitchVel = rPitch.vel;

    var rYaw = solveCriticallyDampedSpring(state.recoilYaw, state.recoilYawVel, 0.0, recK, dt);
    state.recoilYaw = rYaw.pos;
    state.recoilYawVel = rYaw.vel;

    var rZ = solveCriticallyDampedSpring(state.recoilZ, state.recoilZVel, 0.0, recK, dt);
    state.recoilZ = rZ.pos;
    state.recoilZVel = rZ.vel;

    // 7. Damage flinch spring
    var fP = solveCriticallyDampedSpring(state.flinchPitch, state.flinchPitchVel, 0.0, 14.0, dt);
    state.flinchPitch = fP.pos;
    state.flinchPitchVel = fP.vel;

    var fY = solveCriticallyDampedSpring(state.flinchYaw, state.flinchYawVel, 0.0, 14.0, dt);
    state.flinchYaw = fY.pos;
    state.flinchYawVel = fY.vel;

    var fR = solveCriticallyDampedSpring(state.flinchRoll, state.flinchRollVel, 0.0, 14.0, dt);
    state.flinchRoll = fR.pos;
    state.flinchRollVel = fR.vel;

    // 8. Non-linear trauma shake (T^p)
    var shakeX = 0, shakeY = 0, shakeZ = 0;
    var shakePitch = 0, shakeYaw = 0, shakeRoll = 0;

    if (state.trauma > 0.001 && masterS > 0) {
      var power = Math.pow(state.trauma, state.traumaExponent) * masterS;
      var tN = state.shakeTime * state.shakeNoiseFrequency + state.shakeSeed;

      shakeX = power * state.maxShakePosition * noise1D(tN);
      shakeY = power * state.maxShakePosition * noise1D(tN + 107.3);
      shakeZ = power * state.maxShakePosition * 0.5 * noise1D(tN + 219.7);

      shakePitch = power * state.maxShakeAngle * noise1D(tN + 331.1);
      shakeYaw = power * state.maxShakeAngle * noise1D(tN + 443.5);
      if (!antiNausea) {
        shakeRoll = power * state.maxShakeAngle * noise1D(tN + 557.9);
      }
    }

    // 9. Dynamic FOV
    var autoFOV = state.baseFOV;
    if (state.isADS) {
      autoFOV = state.adsFOVTarget;
    } else if (state.isSprinting && !antiNausea) {
      autoFOV = state.baseFOV + state.sprintFOVBonus;
    }

    var tween = state.fovOverride;
    if (tween && tween.active) {
      tween.elapsed += dt;
      var fovT = clamp(tween.elapsed / Math.max(0.001, tween.duration), 0.0, 1.0);
      var smoothT = fovT * fovT * (3.0 - 2.0 * fovT); // smoothstep
      var endFOV = tween.releasing ? autoFOV : tween.targetFOV;
      state.currentFOV = lerp(tween.startFOV, endFOV, smoothT);
      if (fovT >= 1.0) {
        tween.active = false;
        if (tween.releasing) state.fovOverride = null; // hand control back; baseFOV untouched
      }
    } else if (tween) {
      // Tween finished and is being held. `baseFOV` is deliberately never overwritten, so
      // "Release FOV tween" can always get back to the automatic value.
      state.currentFOV = tween.targetFOV;
    } else if (!state.fovInitialized) {
      state.currentFOV = autoFOV;
      state.fovInitialized = true;
    } else {
      state.currentFOV = lerp(state.currentFOV, autoFOV, 1.0 - Math.exp(-state.fovTweenSpeed * dt));
    }

    // Stair & terrain contact micro-jitter
    var stairJitterY = 0;
    if (motion > 0 && state.isGrounded && speedRatio > 0.05 && state.stairJitterIntensity > 0) {
      stairJitterY = noise1D(state.jitterPhase + state.shakeSeed) * state.stairJitterIntensity * speedRatio * motion;
    }

    var manualLeanEyeX = (state.manualLeanCurrentAngle / Math.max(0.001, state.manualLeanMaxAngle)) * state.manualLeanOffset;

    // --- Sum totals in the local camera frame (metres), then convert to world units ---
    // Three.js camera convention: +X = right, +Y = up, +Z = backward (toward the viewer).
    var U = state.unitScale;
    var localDeltaX = (bobX + breathX + manualLeanEyeX + shakeX) * U;
    var localDeltaY = (bobY + breathY + state.landingY + stairJitterY + shakeY) * U;
    var localDeltaZ = (state.recoilZ + shakeZ) * U;

    var totalPitch = state.recoilPitch + state.landingPitch + breathPitch + state.accelPitchCurrent + state.flinchPitch + shakePitch;
    var totalYaw = state.recoilYaw + state.flinchYaw + shakeYaw;
    var totalRoll = state.leanRollCurrent + bobRoll + state.flinchRoll + shakeRoll;

    // Record what was actually applied, so the expressions cannot disagree with the camera.
    state.appliedBobX = bobX * U;
    state.appliedBobY = bobY * U;
    state.appliedLandingY = state.landingY * U;
    state.appliedRecoilZ = state.recoilZ * U;

    _scratchDeltas.localPos.x = localDeltaX;
    _scratchDeltas.localPos.y = localDeltaY;
    _scratchDeltas.localPos.z = localDeltaZ;
    _scratchDeltas.rotDeg.pitch = totalPitch;
    _scratchDeltas.rotDeg.yaw = totalYaw;
    _scratchDeltas.rotDeg.roll = totalRoll;
    _scratchDeltas.targetFOV = state.currentFOV;
    _scratchDeltas.fovDeltaValid = state.currentFOV > 0;

    return _scratchDeltas;
  }

  /* ------------------------------------------------------------- Public Runtime Engine */

  function applyProfile(state, table, name) {
    if (!name) return;
    var patch = table[name];
    if (patch) assignPatch(state, patch);
  }

  var NS = {
    PRESETS: PRESETS,
    DEFAULT_TUNING: DEFAULT_TUNING,
    noise1D: noise1D,
    noise3D: noise3D,
    solveCriticallyDampedSpring: solveCriticallyDampedSpring,

    initialize: function (object, behavior, options) {
      var state = stateOf(behavior);
      if (!state) {
        state = createBehaviorState(object, behavior);
      }
      if (options) {
        NS.configure(state, options);
      }
      resolveUnitScale(state, object);
      return state;
    },

    /**
     * Order matters, and it is the opposite of what it looks like it should be.
     *
     * The plain numeric/string properties are applied FIRST, because they are settings the preset
     * and the module profiles have no business owning (units, target layer, FOV, and the two
     * user-facing master multipliers). Presets and profiles then write only their own fields.
     * Nothing writes the same field twice, so an untouched property default can no longer
     * silently undo the preset the user actually picked.
     */
    configure: function (state, options) {
      if (!state || !options) return;

      if (options.worldUnitsPerMeter !== undefined) {
        state.worldUnitsPerMeterOption = Math.max(0, options.worldUnitsPerMeter || 0);
      }
      if (options.walkSpeedReference !== undefined) {
        state.walkSpeedReferenceOption = Math.max(0, options.walkSpeedReference || 0);
      }
      if (options.layerName !== undefined) state.layerName = options.layerName || '';
      if (options.baseFOV !== undefined) state.baseFOVOption = Math.max(0, options.baseFOV || 0);
      if (options.adsFOVTarget !== undefined) state.adsFOVOption = Math.max(0, options.adsFOVTarget || 0);
      if (options.masterMotionScale !== undefined) {
        state.masterMotionScale = Math.max(0, options.masterMotionScale);
      }
      if (options.masterShakeScale !== undefined) {
        state.masterShakeScale = Math.max(0, options.masterShakeScale);
      }

      if (options.presetProfile) NS.applyPreset(state.behavior, options.presetProfile);

      applyProfile(state, BOB_PROFILES, options.bobProfile);
      applyProfile(state, LEAN_PROFILES, options.leanProfile);
      applyProfile(state, LANDING_PROFILES, options.landingImpactProfile);
      applyProfile(state, BREATHING_PROFILES, options.breathingProfile);
      applyProfile(state, RECOIL_PROFILES, options.recoilProfile);
      applyProfile(state, SHAKE_PROFILES, options.shakeProfile);
      applyProfile(state, SPEED_FOV_PROFILES, options.speedRushFOVProfile);

      // This explicit property is applied after the genre preset so the editor value always wins.
      if (options.terrainMicroJitterIntensity !== undefined) {
        state.stairJitterIntensity = Math.max(0, options.terrainMicroJitterIntensity);
      }

      if (options.motionSicknessMode !== undefined) {
        NS.setComfortChoice(state, options.motionSicknessMode);
      }
    },

    setComfortChoice: function (state, choice) {
      if (!state) return;
      if (typeof choice === 'boolean') {
        state.motionSicknessMode = choice;
        return;
      }
      if (!(choice in COMFORT_CHOICES)) return;
      var v = COMFORT_CHOICES[choice];
      if (v === null) return; // 'Default for Preset' — leave whatever the preset chose
      state.motionSicknessMode = v === 'auto' ? prefersReducedMotion() : v;
    },

    getState: function (behavior) {
      return stateOf(behavior);
    },

    doStepPreEvents: function (runtimeScene, object, behavior) {
      var state = stateOf(behavior);
      if (!state) return;
      NS.releaseCamera(runtimeScene, state);
    },

    doStepPostEvents: function (runtimeScene, object, behavior) {
      var state = stateOf(behavior);
      if (!state) return;

      if (!state.enabled) {
        NS.releaseCamera(runtimeScene, state);
        return;
      }

      var rawDt = runtimeScene.getElapsedTime() / 1000;
      if (rawDt <= 0) return;
      var dt = clamp(rawDt, 0.0001, 0.1);

      var layer = getLayer(runtimeScene, state.layerName);
      var cam = getThreeCameraOf(layer);
      var channel = cam ? channelFor(runtimeScene, state.layerName, cam) : null;

      resolveUnitScale(state, object);
      resolveFOV(state, layer, channel);
      updateKinematics(state, object, layer, channel, dt);

      var deltas = stepProceduralDeltas(state, dt);

      if (channel) channelContribute(channel, layer, deltas);
    },

    releaseCamera: function (runtimeScene, state) {
      if (!state) return;
      var layer = getLayer(runtimeScene, state.layerName);
      var cam = getThreeCameraOf(layer);
      if (!cam) return;
      channelRelease(channelFor(runtimeScene, state.layerName, cam));
    },

    onActivate: function (runtimeScene, object, behavior) {
      var state = stateOf(behavior);
      if (state) state.enabled = true;
    },

    onDeActivate: function (runtimeScene, object, behavior) {
      var state = stateOf(behavior);
      if (!state) return;
      state.enabled = false;
      NS.releaseCamera(runtimeScene, state);
    },

    dispose: function (runtimeScene, behavior) {
      var state = stateOf(behavior);
      if (!state) return;
      if (runtimeScene) NS.releaseCamera(runtimeScene, state);
      instances.delete(behavior);
    },

    /* ---- Presets ---- */

    applyPreset: function (behavior, presetName) {
      var state = stateOf(behavior);
      if (!state || !presetName) return;
      var canonical = PRESET_ALIASES[presetName] || presetName;
      var p = PRESETS[canonical];
      if (!p) {
        if (presetName !== 'Custom' && presetName !== 'Custom (Manual Tuning)') {
          console.warn('[CameraTweens3D] Unknown preset: "' + presetName + '"');
        }
        return;
      }
      // Reset to defaults first: otherwise a field a previous preset zeroed but this one never
      // mentions (turn banking, stair jitter, pitch inertia) stays zeroed forever.
      assignPatch(state, DEFAULT_TUNING);
      assignPatch(state, p);
    },

    /* ---- Profile Setters ---- */

    setBobProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, BOB_PROFILES, profile);
    },
    setLeanProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, LEAN_PROFILES, profile);
    },
    setLandingImpactProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, LANDING_PROFILES, profile);
    },
    setBreathingProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, BREATHING_PROFILES, profile);
    },
    setRecoilProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, RECOIL_PROFILES, profile);
    },
    setShakeProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, SHAKE_PROFILES, profile);
    },
    setSpeedRushFOVProfile: function (behavior, profile) {
      var s = stateOf(behavior); if (s) applyProfile(s, SPEED_FOV_PROFILES, profile);
    },

    /* ---- Actions ---- */

    setMasterMotionScale: function (behavior, scale) {
      var state = stateOf(behavior);
      if (state) state.masterMotionScale = Math.max(0.0, scale);
    },

    setMasterShakeScale: function (behavior, scale) {
      var state = stateOf(behavior);
      if (state) state.masterShakeScale = Math.max(0.0, scale);
    },

    setMotionSicknessMode: function (behavior, enabled) {
      var state = stateOf(behavior);
      if (state) state.motionSicknessMode = !!enabled;
    },

    setWorldUnitsPerMeter: function (behavior, units) {
      var state = stateOf(behavior);
      if (!state) return;
      state.worldUnitsPerMeterOption = Math.max(0, units || 0);
      resolveUnitScale(state, state.object);
    },

    addTrauma: function (behavior, amount) {
      var state = stateOf(behavior);
      if (state) {
        state.trauma = clamp(state.trauma + Math.max(0.0, amount), 0.0, 1.0);
      }
    },

    /**
     * pitch and yaw are degrees; kickbackZ is **world units**, like every other length the user
     * types or reads back. Up to 1.2.1 this one argument was the sole exception — it was taken as
     * metres while `RecoilKickbackZ()` reported world units, so feeding the expression back into
     * the action overshot by a factor of `WorldUnitsPerMeter`.
     */
    applyRecoil: function (behavior, pitch, yaw, kickbackZ) {
      var state = stateOf(behavior);
      if (!state) return;
      var scale = state.recoilScale * state.masterMotionScale;
      if (scale <= 0) return; // "Off" gates yaw and kickback too, not just pitch.

      var p = (pitch !== undefined ? pitch : 2.0) * state.recoilPitchMultiplier * scale;
      var yRand = (Math.random() - 0.5) * 2.0 * state.recoilYawRandomness;
      var y = ((yaw !== undefined ? yaw : 0.0) + yRand) * scale;
      var kickMetres = kickbackZ !== undefined
        ? kickbackZ / Math.max(0.0001, state.unitScale)
        : state.recoilKickbackZ;
      var z = kickMetres * scale;

      state.recoilPitchVel += p * 15.0;
      state.recoilYawVel += y * 15.0;
      state.recoilZVel += z * 10.0;
    },

    applyDamageFlinch: function (behavior, directionAngle, force) {
      var state = stateOf(behavior);
      if (!state) return;
      var f = Math.max(0.1, force || 1.0) * state.damageFlinchScale * state.masterMotionScale;
      var rad = degToRad(directionAngle || 0);
      var pitchImpulse = -Math.cos(rad) * f * 6.0;
      var yawImpulse = Math.sin(rad) * f * 6.0;
      var rollImpulse = (state.motionSicknessMode ? 0 : Math.sin(rad) * f * 4.0);

      state.flinchPitchVel += pitchImpulse * 12.0;
      state.flinchYawVel += yawImpulse * 12.0;
      state.flinchRollVel += rollImpulse * 12.0;
    },

    /** fallSpeed is in world units per second, the same units the user sees everywhere else. */
    triggerLandingImpact: function (behavior, fallSpeed) {
      var state = stateOf(behavior);
      if (!state) return;
      var mps = Math.abs(fallSpeed || 0) / state.unitScale;
      if (mps <= 0) mps = state.landingMinFallSpeed * 2;
      applyLandingImpact(state, mps);
    },

    stopAllShakes: function (behavior) {
      var state = stateOf(behavior);
      if (state) state.trauma = 0.0;
    },

    setADS: function (behavior, enabled) {
      var state = stateOf(behavior);
      if (state) state.isADS = !!enabled;
    },

    setSprinting: function (behavior, enabled) {
      var state = stateOf(behavior);
      if (state) state.isSprinting = !!enabled;
    },

    setCrouching: function (behavior, enabled) {
      var state = stateOf(behavior);
      if (state) state.isCrouching = !!enabled;
    },

    tweenFOV: function (behavior, targetFOV, duration) {
      var state = stateOf(behavior);
      if (!state) return;
      state.fovOverride = {
        active: true,
        releasing: false,
        startFOV: state.fovInitialized ? state.currentFOV : state.baseFOV,
        targetFOV: clamp(targetFOV, 1.0, 179.0),
        duration: Math.max(0.01, duration),
        elapsed: 0.0
      };
      state.fovInitialized = true;
    },

    /** Hand FOV control back to base / ADS / sprint, easing out over `duration`. */
    releaseFOVTween: function (behavior, duration) {
      var state = stateOf(behavior);
      if (!state || !state.fovOverride) return;
      state.fovOverride = {
        active: true,
        releasing: true,
        startFOV: state.currentFOV,
        targetFOV: state.currentFOV,
        duration: Math.max(0.01, duration),
        elapsed: 0.0
      };
    },

    setManualLeanAngle: function (behavior, angle) {
      var state = stateOf(behavior);
      if (state) state.manualLeanTargetAngle = clamp(angle, -state.manualLeanMaxAngle, state.manualLeanMaxAngle);
    },

    setManualLeanMaxAngle: function (behavior, angle) {
      var state = stateOf(behavior);
      if (!state) return;
      state.manualLeanMaxAngle = Math.max(0.0, angle);
      state.manualLeanTargetAngle = clamp(state.manualLeanTargetAngle, -state.manualLeanMaxAngle, state.manualLeanMaxAngle);
    },

    setBaseFOV: function (behavior, fov) {
      var state = stateOf(behavior);
      if (!state) return;
      state.baseFOV = clamp(fov, 10.0, 160.0);
      state.baseFOVOption = state.baseFOV;
      if (state.adsFOVOption <= 0) state.adsFOVTarget = state.baseFOV * 0.66;
      state.fovResolved = true;
    },

    setADSFOVTarget: function (behavior, fov) {
      var state = stateOf(behavior);
      if (!state) return;
      state.adsFOVTarget = clamp(fov, 10.0, 160.0);
      state.adsFOVOption = state.adsFOVTarget;
    },

    setBobIntensity: function (behavior, intensity) {
      var state = stateOf(behavior);
      if (state) state.bobIntensity = Math.max(0.0, intensity);
    },

    setBreathingIntensity: function (behavior, intensity) {
      var state = stateOf(behavior);
      if (state) state.breathingIntensity = Math.max(0.0, intensity);
    },

    setTerrainMicroJitterIntensity: function (behavior, intensity) {
      var state = stateOf(behavior);
      if (state) state.stairJitterIntensity = Math.max(0.0, intensity);
    },

    /** Negative values invert the lean, for rigs whose sideways axis runs the other way. */
    setLeanMaxAngle: function (behavior, angle) {
      var state = stateOf(behavior);
      if (state) state.leanMaxAngle = angle;
    },

    setTurnLeanAngle: function (behavior, angle) {
      var state = stateOf(behavior);
      if (state) state.turnLeanAngle = angle;
    },

    setLandingShockIntensity: function (behavior, intensity) {
      var state = stateOf(behavior);
      if (state) state.landingShockIntensity = Math.max(0.0, intensity);
    },

    setRecoilPitchMultiplier: function (behavior, mult) {
      var state = stateOf(behavior);
      if (state) state.recoilPitchMultiplier = Math.max(0.0, mult);
    },

    setADSMotionDamping: function (behavior, damping) {
      var state = stateOf(behavior);
      if (state) state.adsMotionDamping = clamp(damping, 0.0, 1.0);
    },

    setTraumaDecayRate: function (behavior, rate) {
      var state = stateOf(behavior);
      if (state) state.traumaDecayRate = Math.max(0.01, rate);
    },

    setTargetLayer: function (behavior, layerName) {
      var state = stateOf(behavior);
      if (state) state.layerName = layerName || '';
    },

    /* ---- Conditions ---- */

    isADS: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.isADS);
    },

    isSprinting: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.isSprinting);
    },

    isCrouching: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.isCrouching);
    },

    isTraumaShakeActive: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.trauma > 0.01);
    },

    isRecoilActive: function (behavior) {
      var state = stateOf(behavior);
      if (!state) return false;
      return Math.abs(state.recoilPitch) > 0.01 ||
        Math.abs(state.recoilYaw) > 0.01 ||
        Math.abs(state.recoilZ) > 0.0005;
    },

    isMotionSicknessMode: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.motionSicknessMode);
    },

    isGrounded: function (behavior) {
      var state = stateOf(behavior);
      return !!(state && state.isGrounded);
    },

    /* ---- Expressions ----
     * Offsets are reported in world units, matching what was actually written to the camera.
     */

    getRollOffset: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.leanRollCurrent : 0.0;
    },

    getHeadBobY: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.appliedBobY : 0.0;
    },

    getHeadBobX: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.appliedBobX : 0.0;
    },

    getLandingDipY: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.appliedLandingY : 0.0;
    },

    getRecoilPitch: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.recoilPitch : 0.0;
    },

    getRecoilYaw: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.recoilYaw : 0.0;
    },

    getRecoilKickbackZ: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.appliedRecoilZ : 0.0;
    },

    getCurrentFOV: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.currentFOV : 0.0;
    },

    getTraumaLevel: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.trauma : 0.0;
    },

    getMovementSpeedRatio: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.currentSpeedRatio : 0.0;
    },

    getMasterMotionScale: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.masterMotionScale : 1.0;
    },

    getMasterShakeScale: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.masterShakeScale : 1.0;
    },

    getBobIntensity: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.bobIntensity : 1.0;
    },

    getBreathingIntensity: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.breathingIntensity : 1.0;
    },

    getTerrainMicroJitterIntensity: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.stairJitterIntensity : 0.0;
    },

    getBaseFOV: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.baseFOV : 0.0;
    },

    getManualLeanAngle: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.manualLeanCurrentAngle : 0.0;
    },

    getWorldUnitsPerMeter: function (behavior) {
      var state = stateOf(behavior);
      return state ? state.unitScale : 100;
    }
  };

  gdjs.__cameraTweens3D = NS;
})();
