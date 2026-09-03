/**
 * FluidAndWater3D — Water Volumes, Spectral Oceans, Buoyancy & Pourable SPH Droplets for GDevelop 5
 *
 * Dual-Mode Water & Fluid Architecture:
 *   1. WaterBody3D: Macro water volumes (oceans, rivers, lakes, pools) with multi-octave Gerstner waves,
 *      world-space wave tiling, approximated Beer-Lambert extinction, shore and crest foam, caustics,
 *      and an underwater fog transition.
 *   2. Buoyancy3D: Multi-probe Archimedes buoyancy solver with Jolt Physics integration for realistic boat/crate rocking and wave surfing.
 *   3. PourableLiquid3D: Micro SPH fluid solver (Navier-Stokes) for pouring potions, container fill level tracking,
 *      six fluid presets, and efficient instanced-sphere droplet rendering.
 *   4. OceanFFT3D: Tessendorf/Phillips spectral water with a GPU FFT path and verified CPU fallback.
 *
 * Deliberate current limits: no scene-colour refraction, SSFR surface reconstruction, arbitrary-mesh
 * droplet collisions, or Material3D delegation. See API_REFERENCE.md for the complete list.
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__fluidAndWater3D) return; // Singleton installation

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------- Math & Helpers */

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function saturate(val) {
    return Math.max(0.0, Math.min(1.0, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function parseColor(input, fallback) {
    if (Array.isArray(input)) return input;
    if (typeof input === 'number') {
      return [(input >> 16) & 255, (input >> 8) & 255, input & 255];
    }
    if (typeof input === 'string') {
      var parts = input.split(';').map(function (v) { return parseFloat(v.trim()); });
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return [parts[0], parts[1], parts[2]];
      }
      if (input.startsWith('#') && typeof gdjs.hexToRGBColor === 'function') {
        return gdjs.hexToRGBColor(input);
      }
    }
    return fallback || [64, 224, 208];
  }

  function getRootObject3D(object) {
    if (!object) return null;
    if (typeof object.get3DRendererObject === 'function') {
      try {
        var obj = object.get3DRendererObject();
        if (obj) return obj;
      } catch (e) {}
    }
    if (typeof object.getRendererObject === 'function') {
      try {
        var obj2 = object.getRendererObject();
        if (obj2) return obj2;
      } catch (e) {}
    }
    if (object.getRenderer && typeof object.getRenderer === 'function') {
      var r = object.getRenderer();
      if (r) {
        if (typeof r.get3DRendererObject === 'function') {
          try { return r.get3DRendererObject(); } catch (e) {}
        }
        if (r._threeObject) return r._threeObject;
      }
    }
    return null;
  }

  /**
   * Returns the three.js container that GDevelop parents its own 3D objects to for `layerName`
   * (`layer-pixi-renderer.add3DRendererObject` uses `_threeGroup`). Falls back to the scene root on
   * older runtimes. Anything added here inherits the scene's `scale.y = -1`, exactly like every
   * built-in 3D object, so GDevelop coordinates can be assigned to `position` directly.
   */
  function getLayerThreeRoot(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    if (!renderer) return null;
    if (typeof renderer.getThreeGroup === 'function') {
      var group = renderer.getThreeGroup();
      if (group && typeof group.add === 'function') return group;
    }
    if (typeof renderer.getThreeScene === 'function') {
      var scene = renderer.getThreeScene();
      if (scene && typeof scene.add === 'function') return scene;
    }
    return null;
  }

  function getLayerThreeScene(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    return renderer && typeof renderer.getThreeScene === 'function' ? renderer.getThreeScene() : null;
  }

  function getLayerThreeCamera(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    return renderer && typeof renderer.getThreeCamera === 'function' ? renderer.getThreeCamera() : null;
  }

  function objectLayerName(object) {
    return (object && typeof object.getLayer === 'function') ? object.getLayer() : '';
  }

  /** Seconds elapsed since the previous frame, from the engine rather than a hardcoded 60 Hz guess. */
  function getDeltaSeconds(runtimeScene) {
    var ms = 16.6667;
    if (runtimeScene && typeof runtimeScene.getElapsedTime === 'function') {
      var v = runtimeScene.getElapsedTime();
      if (typeof v === 'number' && isFinite(v) && v > 0) ms = v;
    }
    // Clamp so a paused tab or a breakpoint cannot blow up the SPH integrator.
    return Math.min(ms / 1000.0, 0.1);
  }

  /* ------------------------------------------------------------- Fluid Presets */

  var FLUID_PRESETS = {
    Water: {
      viscosity: 0.2,
      surfaceTension: 0.5,
      restDensity: 1000.0,
      opacity: 0.30,
      roughness: 0.02,
      color: [64, 180, 240],
      dropletRadius: 0.02,
      flowRate: 60.0
    },
    MagicPotion: {
      viscosity: 0.8,
      surfaceTension: 1.2,
      restDensity: 1050.0,
      opacity: 0.85,
      roughness: 0.05,
      color: [220, 30, 120],
      dropletRadius: 0.022,
      flowRate: 50.0
    },
    HoneySyrup: {
      viscosity: 15.0,
      surfaceTension: 2.5,
      restDensity: 1400.0,
      opacity: 0.90,
      roughness: 0.08,
      color: [230, 160, 20],
      dropletRadius: 0.028,
      flowRate: 35.0
    },
    GreenSlime: {
      viscosity: 35.0,
      surfaceTension: 3.0,
      restDensity: 1200.0,
      opacity: 0.95,
      roughness: 0.15,
      color: [40, 210, 45],
      dropletRadius: 0.032,
      flowRate: 25.0
    },
    AcidPoison: {
      viscosity: 0.3,
      surfaceTension: 0.6,
      restDensity: 1100.0,
      opacity: 0.70,
      roughness: 0.02,
      color: [140, 240, 20],
      dropletRadius: 0.02,
      flowRate: 55.0
    },
    LavaMagma: {
      viscosity: 20.0,
      surfaceTension: 2.0,
      restDensity: 2500.0,
      opacity: 1.00,
      roughness: 0.35,
      color: [255, 70, 10],
      dropletRadius: 0.035,
      flowRate: 20.0
    },
    Custom: {
      viscosity: 1.0,
      surfaceTension: 0.8,
      restDensity: 1000.0,
      opacity: 0.85,
      roughness: 0.05,
      color: [220, 30, 120],
      dropletRadius: 0.02,
      flowRate: 50.0
    }
  };

  /* ------------------------------------------------------------- Multi-Octave Gerstner Wave Core */

  /**
   * Wave octaves for the Gerstner surface. Ten components, chosen against the ways a small sum of
   * sinusoids stops looking like water:
   *
   *   1. Frequency ratios sit near 1.6 and no two steps are equal. Harmonically related components
   *      share a period and phase-lock into a repeating lattice.
   *   2. Each octave carries its own phase, so they do not all crest together at the origin.
   *   3. Directions STRADDLE the wind and their spread WIDENS as the wavelength shortens: long
   *      swell runs with the wind, short chop fans out to ~50 degrees. A uniformly wide spread
   *      gives a crosshatch; a narrow one-sided cone gives parallel ridges that all march the same
   *      way when viewed at an angle. Frequency-dependent spreading is what real wind seas do and
   *      it avoids both.
   *   4. Amplitudes are weighted by cos^2(theta/2) off the wind and fall off near k^-1, rather than
   *      over-weighting the fine detail as a flat falloff does.
   *   5. `speedMul` is 1.0 throughout, so phase speed is left to the dispersion relation
   *      sqrt(g/k) — short waves are genuinely slower than long ones. Pushing the short octaves to
   *      2x, as an earlier table did, made the whole surface march in lockstep.
   *
   * Measured against a Tessendorf field of matched wave height (see `_dirsearch` notes in
   * IMPLEMENTATION_PLAN.md): ridge-orientation isotropy 0.643 vs 0.635, crest-height variation
   * 0.672 vs 0.732. The previous eight-octave table scored 0.338 isotropy — ridges all aligned.
   *
   * `ampRatio` values sum to 1.0, which `vWaveCrest` and the foam normalisation both rely on.
   */
  var GERSTNER_OCTAVES = [
    { dirOffset:  13.1, lenRatio: 1.00000, ampRatio: 0.4227, steepness: 0.75, speedMul: 1.0, phase: 3.5018 },
    { dirOffset: -27.2, lenRatio: 0.68417, ampRatio: 0.2563, steepness: 0.71, speedMul: 1.0, phase: 4.9985 },
    { dirOffset:  25.0, lenRatio: 0.42980, ampRatio: 0.1477, steepness: 0.67, speedMul: 1.0, phase: 1.3619 },
    { dirOffset: -40.1, lenRatio: 0.26838, ampRatio: 0.0776, steepness: 0.63, speedMul: 1.0, phase: 3.6933 },
    { dirOffset:  39.3, lenRatio: 0.16489, ampRatio: 0.0434, steepness: 0.59, speedMul: 1.0, phase: 1.3340 },
    { dirOffset: -50.9, lenRatio: 0.10602, ampRatio: 0.0234, steepness: 0.55, speedMul: 1.0, phase: 1.5099 },
    { dirOffset:  41.6, lenRatio: 0.06450, ampRatio: 0.0138, steepness: 0.51, speedMul: 1.0, phase: 0.5159 },
    { dirOffset: -43.2, lenRatio: 0.04027, ampRatio: 0.0078, steepness: 0.47, speedMul: 1.0, phase: 4.2335 },
    { dirOffset:  37.0, lenRatio: 0.02615, ampRatio: 0.0048, steepness: 0.43, speedMul: 1.0, phase: 2.2377 },
    { dirOffset: -38.3, lenRatio: 0.01521, ampRatio: 0.0025, steepness: 0.39, speedMul: 1.0, phase: 5.4084 }
  ];


  var GRAVITY = 9.81;

  /**
   * The SPH solver runs in metres so its kernel radius and gravity are physically meaningful,
   * while GDevelop scenes are in pixels. 100 px = 1 m, matching Physics3D's default world scale.
   */
  var SPH_WORLD_SCALE = 0.01;
  var SPH_WORLD_INV_SCALE = 1.0 / SPH_WORLD_SCALE;

  /** Volume of one spherical droplet, in litres — the unit ContainerCapacity is expressed in. */
  function dropletVolumeLitres(radiusMetres) {
    var r = radiusMetres > 0 ? radiusMetres : 0.02;
    return (4.0 / 3.0) * Math.PI * r * r * r * 1000.0;
  }

  var DEFAULT_BASE_WAVELENGTH = 300.0;

  /**
   * Resolves the per-octave parameters shared by the CPU solver and the GLSL vertex shader. Both
   * MUST derive them the same way or buoyancy drifts out of phase with the surface you can see.
   *
   * `minWavelength` is the shortest wave the water mesh can actually represent, derived from its
   * vertex spacing. Octaves below it are faded out rather than drawn: a Gerstner wave sampled at
   * fewer than a handful of vertices per wavelength does not read as a wave, it reads as a
   * crosshatch of sampling noise.
   */
  function octaveFade(wavelength, minWavelength) {
    if (!(minWavelength > 0)) return 1.0;
    var lo = minWavelength * 0.5;
    var hi = minWavelength;
    if (wavelength <= lo) return 0.0;
    if (wavelength >= hi) return 1.0;
    var t = (wavelength - lo) / (hi - lo);
    return t * t * (3.0 - 2.0 * t); // smoothstep
  }

  function resolveWaveParams(cfg) {
    var waveTiling = (cfg.waveTiling !== undefined && cfg.waveTiling > 0) ? cfg.waveTiling : 1.0;
    return {
      baseAmp: (cfg.waveHeight !== undefined ? cfg.waveHeight : 18.0) * 0.5,
      choppiness: cfg.waveChoppiness !== undefined ? cfg.waveChoppiness : 0.75,
      speed: cfg.waveSpeed !== undefined ? cfg.waveSpeed : 1.0,
      windRad: ((cfg.windDirection !== undefined ? cfg.windDirection : 45.0) * Math.PI) / 180.0,
      baseWavelength: (cfg.baseWavelength > 0 ? cfg.baseWavelength : DEFAULT_BASE_WAVELENGTH) / waveTiling,
      minWavelength: cfg.minWavelength > 0 ? cfg.minWavelength : 0.0,
      // The octave table's directions are authored around a 45 degree fan; this rescales them.
      // 0 collapses every wave onto the wind for pure rolling swell, 90 doubles the spread.
      dirSpread: (cfg.directionalSpread !== undefined ? cfg.directionalSpread : 45.0) / 45.0,
      phaseSeed: cfg.phaseSeed || 0.0,
      // Warps each crest along its perpendicular axis. This breaks the last visible straight,
      // repeating Gerstner bands without introducing frame-to-frame noise or CPU/GPU disagreement.
      irregularity: clamp(cfg.waveIrregularity !== undefined ? cfg.waveIrregularity : 0.4, 0.0, 1.0)
    };
  }

  function evaluateGerstnerDisplacement(x, y, time, cfg, outPos) {
    var P = resolveWaveParams(cfg);

    var dx = 0.0;
    var dy = 0.0;
    var dz = 0.0;

    var count = GERSTNER_OCTAVES.length;
    for (var i = 0; i < count; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;
      var q = Math.min((P.choppiness * oct.steepness) / (k * a * count + 0.0001), 1.0);

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var sinP = Math.sin(phase);
      var cosP = Math.cos(phase);

      dx -= q * a * dirX * sinP;
      dy -= q * a * dirY * sinP;
      dz += a * cosP;
    }

    if (outPos) {
      outPos.x = x + dx;
      outPos.y = y + dy;
      outPos.z = (cfg.baseZ || 0) + dz;
      return outPos;
    }
    return dz;
  }

  function evaluateGerstnerNormal(x, y, time, cfg, outNormal) {
    var P = resolveWaveParams(cfg);

    var nx = 0.0;
    var ny = 0.0;
    var nz = 1.0;

    var count = GERSTNER_OCTAVES.length;
    for (var i = 0; i < count; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;
      var q = Math.min((P.choppiness * oct.steepness) / (k * a * count + 0.0001), 1.0);

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var sinP = Math.sin(phase);
      var cosP = Math.cos(phase);

      var wa = w * a;
      nx -= dirX * wa * sinP;
      ny -= dirY * wa * sinP;
      nz -= q * wa * cosP;
    }

    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
    if (outNormal) {
      outNormal.x = nx / len;
      outNormal.y = ny / len;
      outNormal.z = nz / len;
      return outNormal;
    }
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  function evaluateWaveVelocity(x, y, time, cfg) {
    var P = resolveWaveParams(cfg);

    var vx = 0.0;
    var vy = 0.0;
    var vz = 0.0;

    for (var i = 0; i < GERSTNER_OCTAVES.length; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var phaseSpeed = w - P.irregularity * 0.55 * wanderRate * Math.cos(wanderArg);
      var cosP = Math.cos(phase);
      var sinP = Math.sin(phase);

      vx += dirX * (phaseSpeed * a) * cosP;
      vy += dirY * (phaseSpeed * a) * cosP;
      vz += (phaseSpeed * a) * sinP;
    }

    return { x: vx, y: vy, z: vz };
  }

  /**
   * Base wavelength for a water body, before `WaveTiling` divides it.
   *
   *  - `Absolute`          — a fixed 300 scene units regardless of the volume's size. Waves stay
   *                          world-space, so adjacent water bodies tile seamlessly and the surface
   *                          does not slide when the object moves. Right for oceans.
   *  - `RelativeToVolume`  — the volume's shorter horizontal side, so one base wave spans the body
   *                          at `WaveTiling` 1. Right for a pool, pond or lake that is one object.
   */
  /**
   * Wavelength scale that puts a sensible number of waves across a body of `tileSize`.
   *
   * The Phillips spectrum peaks at k = sqrt(2)/L, so the peak wavelength is about 4.44 L. A fully
   * developed sea's L is huge — 12 m/s of wind peaks near 92 m — so on anything smaller the
   * physically correct result is a single swell spanning the whole surface, which reads as dead
   * flat with a little chop on top. Targeting a peak of tile/TARGET_WAVES_ACROSS gives a surface
   * that looks like water at any scale, and the wave HEIGHT still comes from the wind.
   */
  // How many waves land across the water body by default.
  //
  // Too many and every wave is small next to the camera, so the player reads as a giant looking at
  // a puddle. Too few and the surface flattens out. Around 2.5 keeps waves large enough to feel
  // like real water at eye level while still showing structure across the body.
  var MIN_WAVES_ACROSS = 2.5;
  var MAX_WAVES_ACROSS = 9.0;

  /**
   * One scale factor applied to BOTH wavelength and height, so the sea keeps its physical shape.
   *
   * A fully developed sea has a fixed steepness: Hs/peak = 0.21/4.44 = 0.047, whatever the wind.
   * Wind sets the SCALE, not the shape. So fitting a body means choosing that scale — and wind
   * still decides how many waves land across it: a light breeze gives many small ones, a gale a
   * few large ones. Clamping that count keeps the surface readable at any body size.
   */
  function autoWavelengthScale(tileSize, windSpeed, unitsPerMetre) {
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 100;
    var naturalPeak = 4.44 * ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm;
    if (!(naturalPeak > 0) || !(tileSize > 0)) return 1.0;
    var wavesAcross = clamp(tileSize / naturalPeak, MIN_WAVES_ACROSS, MAX_WAVES_ACROSS);
    return (tileSize / wavesAcross) / naturalPeak;
  }

  /** Applies the authored WavelengthScale, or fits one to the volume when it is left at 0. */
  function resolveWavelengthScale(ocean) {
    // An explicit peak wavelength wins: it is the one setting that maps directly onto what the
    // player sees, since it is a distance in the same units as everything else in the scene.
    if (ocean.peakWavelengthOption > 0) {
      var upm = ocean.unitsPerMetre > 0 ? ocean.unitsPerMetre : 100;
      var naturalPeak = 4.44 * ((ocean.windSpeed * ocean.windSpeed) / OCEAN_GRAVITY) * upm;
      ocean.wavelengthScale = naturalPeak > 0 ? (ocean.peakWavelengthOption / naturalPeak) : 1.0;
    } else if (ocean.wavelengthScaleOption > 0) {
      ocean.wavelengthScale = ocean.wavelengthScaleOption;
    } else {
      ocean.wavelengthScale = autoWavelengthScale(ocean.tileSize, ocean.windSpeed, ocean.unitsPerMetre);
    }
    return ocean.wavelengthScale;
  }

  function computeBaseWavelength(mode, width, height) {
    if (mode === 'RelativeToVolume') {
      var shortSide = Math.min(width > 0 ? width : 0, height > 0 ? height : 0);
      if (shortSide > 0) return shortSide;
    }
    return DEFAULT_BASE_WAVELENGTH;
  }

  /**
   * Shortest wave the surface mesh can resolve, from its vertex spacing. Four vertices per
   * wavelength is the practical floor for a Gerstner crest; below that the octave is faded out.
   */
  function computeMinWavelength(width, height, subdivisions) {
    var subs = subdivisions > 0 ? subdivisions : 48;
    var spacing = Math.max((width > 0 ? width : 0) / subs, (height > 0 ? height : 0) / subs);
    return spacing * 4.0;
  }

  /**
   * Fraction of the authored wave amplitude the surface mesh can actually represent, 0..1.
   * (The six octave amplitude ratios sum to exactly 1.0, so this is a direct fraction.)
   *
   * A value of 0 means every octave is shorter than the mesh can resolve and the water renders
   * perfectly flat — which looks identical to a broken shader, so it is worth reporting loudly.
   */
  function retainedAmplitudeFraction(baseWavelength, waveTiling, minWavelength) {
    var base = (baseWavelength > 0 ? baseWavelength : DEFAULT_BASE_WAVELENGTH) /
      (waveTiling > 0 ? waveTiling : 1.0);
    var sum = 0.0;
    for (var i = 0; i < GERSTNER_OCTAVES.length; i++) {
      var oct = GERSTNER_OCTAVES[i];
      sum += oct.ampRatio * octaveFade(base * oct.lenRatio, minWavelength);
    }
    return sum;
  }

  /**
   * Recomputes the detail diagnostic and, when the mesh cannot represent a single octave, explains
   * it once with the numbers that matter. Re-warns only if the configuration actually changes.
   */
  function refreshWaveResolution(body, width, height, subs) {
    body.waveDetailFraction = retainedAmplitudeFraction(
      body.baseWavelength, body.waveTiling, body.minWavelength
    );

    var key = [body.waveScaleMode, body.waveTiling, subs, Math.round(width), Math.round(height)].join('|');
    if (key === body._waveResolutionKey) return;
    body._waveResolutionKey = key;

    if (body.waveDetailFraction > 0.01) return;
    if (typeof console === 'undefined' || !console.warn) return;

    var longest = (body.baseWavelength / (body.waveTiling > 0 ? body.waveTiling : 1.0)) *
      GERSTNER_OCTAVES[0].lenRatio;
    var spacing = body.minWavelength / 4.0;
    // The base octave needs four vertices per wavelength to survive the fade.
    var subsNeeded = Math.ceil(Math.max(width, height) / Math.max(longest / 4.0, 0.0001));
    var relative = retainedAmplitudeFraction(
      computeBaseWavelength('RelativeToVolume', width, height), body.waveTiling, body.minWavelength
    );

    console.warn(
      '[FluidAndWater3D] This water body renders FLAT: none of its wave octaves are long enough ' +
      'for its surface mesh to represent.\n' +
      '  volume ' + Math.round(width) + ' x ' + Math.round(height) + ' units, GridSubdivisions ' + subs +
      ' -> ' + spacing.toFixed(1) + ' units between vertices (shortest renderable wave ' +
      body.minWavelength.toFixed(0) + ').\n' +
      '  WaveScaleMode "' + body.waveScaleMode + '" with WaveTiling ' + body.waveTiling +
      ' gives a longest octave of only ' + longest.toFixed(0) + ' units.\n' +
      '  Fix by either:\n' +
      '    - setting WaveScaleMode to "RelativeToVolume" (would retain ' +
      Math.round(relative * 100) + '% of the wave amplitude here), or\n' +
      '    - raising GridSubdivisions to at least ' + subsNeeded +
      (subsNeeded > 256 ? ' (above the 256 maximum, so this alone will not be enough)' : '') + '.\n' +
      '  Note WaveTiling makes this worse, not better: it shortens every wavelength.'
    );
  }

  /** Fixed-size uniform arrays for the WaterEdge3D volumes the shader can carry. */
  function makeEdgeBoundsArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_EDGES; i++) {
      arr.push(THREE_OK && typeof THREE.Vector4 === 'function' ? new THREE.Vector4(0, 0, 0, 0) : { x: 0, y: 0, z: 0, w: 0, set: function () {} });
    }
    return arr;
  }

  function makeEdgeParamsArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_EDGES; i++) {
      arr.push(THREE_OK && typeof THREE.Vector2 === 'function' ? new THREE.Vector2(0, 0) : { x: 0, y: 0, set: function () {} });
    }
    return arr;
  }

  /**
   * A behavior number property, or `fallback` when it is not a usable number.
   *
   * `!== undefined` is not enough. GDevelop hands these straight from event expressions, so a
   * division by zero or a failed string conversion arrives as NaN, sails through an undefined
   * check and lands in a uniform. NaN in u_WaveHeight makes every vertex NaN, and a mesh whose
   * positions are NaN is not rasterised at all: the water vanishes with nothing logged.
   */
  function num(value, fallback) {
    return (typeof value === 'number' && isFinite(value)) ? value : fallback;
  }

  /** Slack, in scene units, on the WaterEdge3D vertical test. */
  var EDGE_Z_TOLERANCE = 1e-3;

  /**
   * Surf-zone width when FoamWidth is left at 0, as a fraction of the water body's short side.
   *
   * A fixed default cannot work here: the same 120 units that read as a wide beach on a 1000-unit
   * pond is a 3% hairline on a 3500-unit bay, and invisible on anything larger. Foam has to be
   * sized against the water it borders.
   */
  var AUTO_FOAM_FRACTION = 0.08;
  var AUTO_SHALLOW_MULTIPLE = 3.0;
  var AUTO_FOAM_MIN = 40.0;

  /**
   * The foam band an edge would use against a water body of this span. Pure, so the diagnostics
   * can report the same number the shader is handed without depending on upload order: the report
   * runs in doStepPreEvents while uploadWaterEdges runs post-events, so on the frame the report is
   * emitted the edge record still holds its registration default.
   */
  function foamWidthFor(edge, waterSpan) {
    if (edge.foamWidthOption > 0) return edge.foamWidthOption;
    // isFinite matters as much as the > 0 test: the callers derive the span with Math.min over
    // Infinity placeholders, so a water object reporting no size yet yields Infinity, which is
    // both a number and greater than zero and would put Infinity into the shader uniform.
    var span = (typeof waterSpan === 'number' && isFinite(waterSpan) && waterSpan > 0) ? waterSpan : 0;
    return span > 0 ? Math.max(span * AUTO_FOAM_FRACTION, AUTO_FOAM_MIN) : 120.0;
  }

  /** Companion to foamWidthFor. Also pure. */
  function shallowWidthFor(edge, waterSpan) {
    if (edge.shallowWidthOption > 0) return edge.shallowWidthOption;
    return foamWidthFor(edge, waterSpan) * AUTO_SHALLOW_MULTIPLE;
  }

  /**
   * The reference dimension a water body sizes its shore effects against: its short side.
   *
   * Deriving this in one place matters. Both callers previously built it inline with
   * Math.min over Infinity placeholders, so a water object reporting no size produced Infinity,
   * which is a number and is greater than zero and sailed through the guards into a uniform.
   */
  function waterSpanOf(water) {
    var o = water && water.object;
    if (!o) return 0;
    var w = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
    var h = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
    if (w > 0 && h > 0) return Math.min(w, h);
    return w > 0 ? w : h;
  }

  /**
   * Is this WaterEdge3D volume vertically relevant to a water surface at `waterTopZ`?
   *
   * Shore foam is a property of the water SURFACE, so the land has to reach that surface: the
   * waterline must fall inside the edge volume's Z span. A block resting on the seabed far below
   * is a reef, not a coastline, and land floating above the waterline is not one either.
   *
   * A looser rule — overlapping the whole water VOLUME — was tried and is wrong: a deep body makes
   * every seabed feature a coastline. The cost of this stricter rule is that land whose Z range
   * misses the waterline is ignored, which looks like the behavior doing nothing at all, so
   * uploadWaterEdges reports that case rather than failing silently.
   *
   * An edge with no depth set is a flat footprint marker and is accepted at any height.
   */
  function edgeReachesWater(o, waterTopZ) {
    if (typeof waterTopZ !== 'number' || !isFinite(waterTopZ)) return true;
    var edgeBottom = (o && o.getZ) ? o.getZ() : 0;
    if (!isFinite(edgeBottom)) return true;
    var edgeDepth = (o && o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0;
    if (edgeDepth <= 0) return true;
    return waterTopZ >= edgeBottom - EDGE_Z_TOLERANCE &&
      waterTopZ <= edgeBottom + edgeDepth + EDGE_Z_TOLERANCE;
  }

  /** CPU counterpart of the shaders' signed WaterEdge3D distance and shore attenuation. */
  function waterEdgeInfluenceAt(state, x, y, layerName, waterZ, waterSpan) {
    var best = Infinity;
    var shallowWidth = 0.0;
    if (!state || !state.waterEdges) {
      return { signedDistance: best, attenuation: 1.0, inside: false };
    }
    for (var i = 0; i < state.waterEdges.length; i++) {
      var edge = state.waterEdges[i];
      var o = edge && edge.object;
      if (!edge || !edge.enabled || !o) continue;
      if (layerName !== undefined && objectLayerName(o) !== layerName) continue;
      var w = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
      var h = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
      if (w <= 0 || h <= 0) continue;
      if (!edgeReachesWater(o, waterZ)) continue;
      var minX = o.getX ? o.getX() : 0;
      var minY = o.getY ? o.getY() : 0;
      var maxX = minX + w;
      var maxY = minY + h;
      var qx = Math.abs(x - (minX + maxX) * 0.5) - w * 0.5;
      var qy = Math.abs(y - (minY + maxY) * 0.5) - h * 0.5;
      var outsideX = Math.max(qx, 0.0);
      var outsideY = Math.max(qy, 0.0);
      var signed = Math.sqrt(outsideX * outsideX + outsideY * outsideY) +
        Math.min(Math.max(qx, qy), 0.0);
      if (signed < best) {
        best = signed;
        shallowWidth = shallowWidthFor(edge, waterSpan);
      }
    }
    if (!isFinite(best)) return { signedDistance: best, attenuation: 1.0, inside: false };
    var attenuation = shallowWidth > 0 ? saturate(Math.max(best, 0.0) / shallowWidth) : 1.0;
    attenuation = attenuation * attenuation * (3.0 - 2.0 * attenuation); // smoothstep
    return { signedDistance: best, attenuation: attenuation, inside: best < 0.0 };
  }

  /**
   * Blanks the top face of the source 3D box so the water surface mesh reads through it, leaving
   * the sides and bottom as the visible water volume. Materials are assigned as a fresh array
   * rather than mutated: GDevelop memoises Cube3D materials game-wide, so writing to one would
   * repaint every object sharing that texture.
   */
  function hideVolumeTopFace(object, holder) {
    if (!THREE_OK || typeof THREE.MeshBasicMaterial !== 'function') return;
    var root = getRootObject3D(object);
    if (!root) return;

    if (!holder.boxMaterials) {
      var side = new THREE.MeshBasicMaterial({
        color: new THREE.Color(holder.shallowColor[0], holder.shallowColor[1], holder.shallowColor[2]),
        transparent: true, opacity: 0.55, depthWrite: true, side: THREE.DoubleSide
      });
      var top = new THREE.MeshBasicMaterial({ visible: false });
      var bottom = new THREE.MeshBasicMaterial({
        color: new THREE.Color(holder.deepColor[0], holder.deepColor[1], holder.deepColor[2]),
        transparent: true, opacity: 0.65, depthWrite: true, side: THREE.DoubleSide
      });
      holder.boxMaterials = [side, side, side, side, top, bottom];
    }

    root.visible = true;
    if (root.isMesh && root.material !== holder.boxMaterials) root.material = holder.boxMaterials;
    if (typeof root.traverse === 'function') {
      root.traverse(function (child) {
        if (child && child.isMesh && child !== holder.mesh && child.material !== holder.boxMaterials) {
          child.material = holder.boxMaterials;
        }
      });
    }
  }

  /** Single source of truth for the wave config, so every CPU query matches the shader. */
  function waveConfigOf(body, baseZ) {
    return {
      waveHeight: body.waveHeight,
      waveChoppiness: body.waveChoppiness,
      waveSpeed: body.waveSpeed,
      windDirection: body.windDirection,
      waveTiling: body.waveTiling,
      baseWavelength: body.baseWavelength,
      minWavelength: body.minWavelength,
      directionalSpread: body.directionalSpread,
      phaseSeed: body.phaseSeed,
      waveIrregularity: body.waveIrregularity,
      baseZ: baseZ || 0.0
    };
  }

  /* =============================================================== Tessendorf Ocean Core
   *
   * An implementation of the FFT ocean described in Tessendorf 2001, "Simulating Ocean Water" —
   * the same model Rare used for Sea of Thieves (Ang et al., SIGGRAPH 2018 Talks).
   *
   * Why this replaces a Gerstner octave sum:
   *   - A handful of Gerstner octaves at near-harmonic frequency ratios phase-lock into a visibly
   *     repeating lattice. An FFT field carries N^2 components with randomised phase and cannot.
   *   - Amplitude per wavenumber comes from the Phillips spectrum driven by WIND SPEED, so it is
   *     physically weighted rather than six hand-authored amplitude ratios.
   *   - The field is inherently band-limited to the grid, so no octave-fade machinery is needed.
   *   - Displacement is a function of world XY, not of mesh UVs, so any mesh shape gets the waves.
   *
   * GPU/CPU consistency: the random phases are drawn from a hash of the INTEGER WAVENUMBER, not
   * from a sequential PRNG over array indices. Two grids of different sizes sharing a tile size
   * therefore agree exactly on every wavenumber they have in common, which makes the 32^2 CPU field
   * a strict low-pass of the 256^2 GPU field rather than a different ocean that merely looks similar.
   */

  var OCEAN_GRAVITY = 9.81;

  /**
   * Deterministic pair of standard normal deviates for an integer wavenumber.
   * Hash -> two uniforms -> Box-Muller. Indexing by wavenumber (not array position) is what lets
   * different grid resolutions share a spectrum exactly.
   */
  function oceanGaussianPair(ix, iy, seed, out) {
    // 32-bit integer hash (Wang / xxhash-style avalanche), stable across engines.
    var h = (ix * 0x1f1f1f1f) ^ (iy * 0x85ebca6b) ^ (seed * 0xc2b2ae35);
    h = h | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) | 0;
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) | 0;
    h ^= h >>> 16;
    var u1 = ((h >>> 0) % 16777216) / 16777216;

    var h2 = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) | 0;
    h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35) | 0;
    h2 ^= h2 >>> 16;
    var u2 = ((h2 >>> 0) % 16777216) / 16777216;

    // Guard the log at zero.
    u1 = Math.max(u1, 1e-7);
    var r = Math.sqrt(-2.0 * Math.log(u1));
    var theta = 2.0 * Math.PI * u2;
    out[0] = r * Math.cos(theta);
    out[1] = r * Math.sin(theta);
    return out;
  }

  /**
   * Phillips spectrum: the energy of a fully developed wind sea at wavenumber k.
   *
   *   P(k) = A * exp(-1/(k L)^2) / k^4 * |k^ . w^|^2 * exp(-k^2 l^2)
   *
   * L = V^2/g is the largest wave the wind can sustain, |k^.w^|^2 is the directional spreading that
   * kills waves travelling across the wind (the missing piece that made the Gerstner version look
   * like a crosshatch), and the final term damps waves too small to matter.
   */
  function phillipsSpectrum(kx, ky, windSpeed, windDirX, windDirY, amplitude, smallWave, unitsPerMetre, wavelengthScale) {
    var k2 = kx * kx + ky * ky;
    if (k2 < 1e-12) return 0.0;

    var k4 = k2 * k2;
    // L = V^2/g is a LENGTH, and k is in 1/scene-unit, so L has to be in scene units too. Leaving
    // it in metres made exp(-1/(kL)^2) round to zero for every long wave: the entire spectrum
    // collapsed onto the shortest wavelength the grid could hold, which normalisation then scaled
    // to the full significant wave height. The result was waves 117 units long and 308 units tall
    // — a steepness of 2.6, folding through itself, scattering the surface out of the volume.
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 1.0;
    // `WavelengthScale` shortens or lengthens the whole spectrum without touching wave height.
    // A fully developed sea's waves are enormous — 12 m/s of wind naturally peaks near 92 m — so on
    // any water body smaller than that the physically correct answer is one swell spanning the whole
    // surface, which reads as flat. Scaling L below 1 fits several waves across a small body while
    // the height still comes from the wind.
    var wls = wavelengthScale > 0 ? wavelengthScale : 1.0;
    var L = ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm * wls;
    var kLen = Math.sqrt(k2);

    var kdotw = (kx / kLen) * windDirX + (ky / kLen) * windDirY;
    // Squared cosine spreading, and waves running against the wind are suppressed rather than
    // mirrored — otherwise the sea is symmetric and reads as a standing pattern.
    var directional = kdotw * kdotw;
    if (kdotw < 0.0) directional *= 0.07;

    var p = amplitude * Math.exp(-1.0 / (k2 * L * L)) / k4 * directional;
    if (smallWave > 0) p *= Math.exp(-k2 * smallWave * smallWave);
    return p;
  }

  /**
   * In-place iterative radix-2 FFT over a strided view, so the same routine does rows and columns
   * of a 2D field without transposing.
   */
  function OceanFFT(n) {
    this.n = n;
    var levels = Math.round(Math.log(n) / Math.LN2);
    this.levels = levels;

    this.rev = new Uint16Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }

    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (var t = 0; t < n / 2; t++) {
      this.cos[t] = Math.cos((2.0 * Math.PI * t) / n);
      this.sin[t] = Math.sin((2.0 * Math.PI * t) / n);
    }
  }

  OceanFFT.prototype.transform = function (re, im, offset, stride) {
    var n = this.n, rev = this.rev, cosT = this.cos, sinT = this.sin;

    for (var i = 0; i < n; i++) {
      var j = rev[i];
      if (j > i) {
        var a = offset + i * stride, b = offset + j * stride;
        var t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
    }

    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var start = 0; start < n; start += size) {
        for (var p = start, k = 0; p < start + half; p++, k += step) {
          var ia = offset + p * stride, ib = offset + (p + half) * stride;
          var wr = cosT[k], wi = sinT[k];
          var xr = re[ib] * wr - im[ib] * wi;
          var xi = re[ib] * wi + im[ib] * wr;
          re[ib] = re[ia] - xr; im[ib] = im[ia] - xi;
          re[ia] += xr;         im[ia] += xi;
        }
      }
    }
  };

  OceanFFT.prototype.transform2D = function (re, im) {
    var n = this.n;
    for (var row = 0; row < n; row++) this.transform(re, im, row * n, 1);
    for (var col = 0; col < n; col++) this.transform(re, im, col, n);
  };

  /**
   * One resolution of the ocean. `tileSize` is in GDevelop units and is the period at which the
   * field repeats — set it to the water body's own size and the tile never visibly repeats.
   */
  function OceanField(n, tileSize, options) {
    options = options || {};
    this.n = n;
    this.tileSize = tileSize > 0 ? tileSize : 1000.0;
    this.seed = num(options.seed, 1337);

    this.fft = new OceanFFT(n);

    var count = n * n;
    this.h0re = new Float32Array(count);
    this.h0im = new Float32Array(count);
    this.h0cre = new Float32Array(count); // conj(h0(-k)), precomputed
    this.h0cim = new Float32Array(count);
    this.omega = new Float32Array(count);

    this.hre = new Float32Array(count);
    this.him = new Float32Array(count);
    this.dxre = new Float32Array(count);
    this.dxim = new Float32Array(count);
    this.dyre = new Float32Array(count);
    this.dyim = new Float32Array(count);

    // Outputs, in GDevelop units.
    this.height = new Float32Array(count);
    this.dispX = new Float32Array(count);
    this.dispY = new Float32Array(count);

    this.buildSpectrum(options);
  }

  OceanField.prototype.buildSpectrum = function (options) {
    var n = this.n;
    var half = n / 2;
    var windSpeed = options.windSpeed > 0 ? options.windSpeed : 12.0;
    var windRad = ((num(options.windDirection, 45.0)) * Math.PI) / 180.0;
    var wdx = Math.cos(windRad), wdy = Math.sin(windRad);
    var amplitude = options.amplitude > 0 ? options.amplitude : 1.0;
    var smallWave = num(options.smallWaveCutoff, 0.5);
    var upm = options.unitsPerMetre > 0 ? options.unitsPerMetre : 1.0;
    var wls = options.wavelengthScale > 0 ? options.wavelengthScale : 1.0;
    var twoPiOverL = (2.0 * Math.PI) / this.tileSize;

    this.windSpeed = windSpeed;
    this.windDirection = num(options.windDirection, 45.0);
    this.amplitude = amplitude;
    this.unitsPerMetre = upm;
    this.wavelengthScale = wls;
    // Phillips peaks at k = sqrt(2)/L, so the peak wavelength is 2*pi*L/sqrt(2) ~ 4.44 L.
    this.peakWavelength = 4.44 * ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm * wls;

    // Height does NOT shrink as fast as length. Scaling both equally would preserve the fully
    // developed steepness of 0.047 exactly — and then wind would stop changing anything once the
    // fit saturates, because a fully developed sea has the same shape at every wind speed. A small
    // body in a strong wind is fetch-limited, and fetch-limited seas really are steeper, so let
    // steepness climb with wind up to about 0.10, which is steep but still short of breaking.
    var MAX_FITTED_STEEPNESS = 0.10;
    var FULLY_DEVELOPED_STEEPNESS = 0.21 / 4.44;
    this.heightFit = Math.min(
      1.0,
      Math.sqrt(wls),
      wls * (MAX_FITTED_STEEPNESS / FULLY_DEVELOPED_STEEPNESS)
    );

    var g = [0, 0];

    for (var m = 0; m < n; m++) {
      for (var q = 0; q < n; q++) {
        var idx = m * n + q;
        // Integer wavenumber, signed and centred: this is the key the hash is indexed by.
        var ix = q - half;
        var iy = m - half;

        var kx = ix * twoPiOverL;
        var ky = iy * twoPiOverL;
        var kLen = Math.sqrt(kx * kx + ky * ky);
        this.omega[idx] = Math.sqrt(OCEAN_GRAVITY * kLen);

        // The Nyquist row and column (ix or iy == -N/2) have no mirror partner inside the grid:
        // +N/2 is not a representable index. Leaving them populated breaks the Hermitian symmetry
        // the whole construction depends on, and the inverse transform then returns a complex field
        // whose imaginary part is the same order as its real part. Zero them.
        if (ix === -half || iy === -half) {
          this.h0re[idx] = 0; this.h0im[idx] = 0;
          this.h0cre[idx] = 0; this.h0cim[idx] = 0;
          this.omega[idx] = 0;
          continue;
        }

        var p = phillipsSpectrum(kx, ky, windSpeed, wdx, wdy, amplitude, smallWave, upm, wls);
        var scale = Math.sqrt(p * 0.5);

        oceanGaussianPair(ix, iy, this.seed, g);
        this.h0re[idx] = g[0] * scale;
        this.h0im[idx] = g[1] * scale;

        // conj(h0(-k)) — drawn from the SAME hash at the mirrored wavenumber, which is what makes
        // the reconstructed field real-valued without any index-wrapping special cases.
        var pm = phillipsSpectrum(-kx, -ky, windSpeed, wdx, wdy, amplitude, smallWave, upm, wls);
        var scaleM = Math.sqrt(pm * 0.5);
        oceanGaussianPair(-ix, -iy, this.seed, g);
        this.h0cre[idx] = g[0] * scaleM;
        this.h0cim[idx] = -g[1] * scaleM; // conjugate
      }
    }
  };

  /** Advances the field to absolute time `t` (seconds) and runs the three inverse transforms. */
  OceanField.prototype.evolve = function (t, choppiness) {
    var n = this.n, half = n / 2;
    var chop = choppiness !== undefined ? choppiness : 1.0;
    var twoPiOverL = (2.0 * Math.PI) / this.tileSize;

    var hre = this.hre, him = this.him;
    var dxre = this.dxre, dxim = this.dxim;
    var dyre = this.dyre, dyim = this.dyim;

    for (var m = 0; m < n; m++) {
      for (var q = 0; q < n; q++) {
        var idx = m * n + q;
        var w = this.omega[idx] * t;
        var cw = Math.cos(w), sw = Math.sin(w);

        // h(k,t) = h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}
        var ar = this.h0re[idx], ai = this.h0im[idx];
        var br = this.h0cre[idx], bi = this.h0cim[idx];
        var re = ar * cw - ai * sw + br * cw + bi * sw;
        var im = ar * sw + ai * cw - br * sw + bi * cw;

        hre[idx] = re;
        him[idx] = im;

        // Horizontal displacement D(k) = -i * (k/|k|) * h(k,t) — this is what sharpens crests and
        // broadens troughs, the same role Gerstner choppiness plays.
        var ix = q - half, iy = m - half;
        var kx = ix * twoPiOverL, ky = iy * twoPiOverL;
        var kLen = Math.sqrt(kx * kx + ky * ky);
        if (kLen < 1e-9) {
          dxre[idx] = 0; dxim[idx] = 0;
          dyre[idx] = 0; dyim[idx] = 0;
        } else {
          var nx = kx / kLen, ny = ky / kLen;
          // -i * n * h  ->  real = n*im, imag = -n*re
          dxre[idx] = nx * im * chop;
          dxim[idx] = -nx * re * chop;
          dyre[idx] = ny * im * chop;
          dyim[idx] = -ny * re * chop;
        }
      }
    }

    this.fft.transform2D(hre, him);
    this.fft.transform2D(dxre, dxim);
    this.fft.transform2D(dyre, dyim);

    // Sign flip on alternating cells undoes the fftshift implied by the centred wavenumbers.
    var height = this.height, dispX = this.dispX, dispY = this.dispY;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var i2 = y * n + x;
        var sign = ((x + y) & 1) ? -1.0 : 1.0;
        height[i2] = hre[i2] * sign;
        dispX[i2] = dxre[i2] * sign;
        dispY[i2] = dyre[i2] * sign;
      }
    }
  };

  /**
   * Rescales the spectrum so the field's significant wave height matches what the authored wind
   * speed physically implies, instead of the raw Phillips constant — which is arbitrary and, left
   * alone, swings peak height across five orders of magnitude between a breeze and a gale.
   *
   * For a fully developed sea, H_s ~= 0.21 V^2 / g (metres). Significant wave height is by
   * definition 4x the surface elevation standard deviation, so we measure sigma once and scale.
   *
   * `heightScale` is the art-direction multiplier on top of the physical result.
   */
  OceanField.prototype.normalizeToWindSpeed = function (unitsPerMetre, heightScale) {
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 100.0;
    var scale = heightScale > 0 ? heightScale : 1.0;

    // Measure sigma from an unscaled snapshot.
    this.evolve(0.0, 1.0);
    var h = this.height, n = h.length;
    var mean = 0.0;
    for (var i = 0; i < n; i++) mean += h[i];
    mean /= n;
    var variance = 0.0;
    for (var j = 0; j < n; j++) { var d = h[j] - mean; variance += d * d; }
    var sigma = Math.sqrt(variance / n);

    // Height carries the SAME scale as the wavelength, so the sea keeps its natural steepness
    // (Hs/peak = 0.047) after being fitted to the body. Scaling length alone would leave 3 m waves
    // only 10 m long — steeper than water can physically be, folding the surface into spikes.
    var targetHsUnits = 0.21 * (this.windSpeed * this.windSpeed) / OCEAN_GRAVITY * upm *
      (this.heightFit > 0 ? this.heightFit : 1.0);

    var targetSigma = targetHsUnits / 4.0 * scale;

    var k = (sigma > 1e-9) ? (targetSigma / sigma) : 0.0;
    this.significantWaveHeight = targetHsUnits * scale;

    for (var m = 0; m < n; m++) {
      this.h0re[m] *= k; this.h0im[m] *= k;
      this.h0cre[m] *= k; this.h0cim[m] *= k;
    }

    // Re-run the transform so `height`/`dispX`/`dispY` reflect the SCALED spectrum. Without this
    // they still hold the unscaled measurement pass, and anything reading peakHeight() straight
    // after normalising sees a figure thousands of times too large.
    this.evolve(0.0, 1.0);
    return k;
  };

  /** Bilinear height sample at a world XY, in GDevelop units. Wraps on the tile. */
  OceanField.prototype.sampleHeight = function (x, y) {
    var n = this.n;
    var u = (x / this.tileSize) * n;
    var v = (y / this.tileSize) * n;
    var x0 = Math.floor(u), y0 = Math.floor(v);
    var fx = u - x0, fy = v - y0;

    var xa = ((x0 % n) + n) % n, xb = (xa + 1) % n;
    var ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;

    var h = this.height;
    var h00 = h[ya * n + xa], h10 = h[ya * n + xb];
    var h01 = h[yb * n + xa], h11 = h[yb * n + xb];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  };

  /** Bilinear sample of the full displacement, for probes that need the horizontal motion too. */
  OceanField.prototype.sampleDisplacement = function (x, y, out) {
    var n = this.n;
    var u = (x / this.tileSize) * n;
    var v = (y / this.tileSize) * n;
    var x0 = Math.floor(u), y0 = Math.floor(v);
    var fx = u - x0, fy = v - y0;

    var xa = ((x0 % n) + n) % n, xb = (xa + 1) % n;
    var ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;

    var i00 = ya * n + xa, i10 = ya * n + xb, i01 = yb * n + xa, i11 = yb * n + xb;
    function lerp2(arr) {
      return (arr[i00] * (1 - fx) + arr[i10] * fx) * (1 - fy) +
             (arr[i01] * (1 - fx) + arr[i11] * fx) * fy;
    }

    out = out || {};
    out.z = lerp2(this.height);
    out.x = lerp2(this.dispX);
    out.y = lerp2(this.dispY);
    return out;
  };

  /** Peak vertical amplitude of the current field, used to normalise foam and report wave height. */
  OceanField.prototype.peakHeight = function () {
    var h = this.height, peak = 0.0;
    for (var i = 0; i < h.length; i++) {
      var a = h[i] < 0 ? -h[i] : h[i];
      if (a > peak) peak = a;
    }
    return peak;
  };


  /* =============================================================== GPU FFT (ping-pong butterfly)
   *
   * A Stockham-style radix-2 Cooley-Tukey FFT run as fullscreen passes on the GPU, so the ocean can
   * carry a 256^2 spectrum that would cost ~22 ms a frame on the CPU.
   *
   * Two inverse transforms per frame, not three: h, Dx and Dy are all REAL fields, and the inverse
   * transform is linear, so IFFT(H + i*DX) has h as its real part and dx as its imaginary part.
   * The second transform carries Dy the same way.
   *
   * The CPU field still drives buoyancy. Both are built from `oceanGaussianPair` indexed by integer
   * wavenumber, so the small CPU grid is a strict low-pass of this one rather than a different sea.
   */

  /**
   * Butterfly lookup: width = log2(N) stages, height = N indices.
   * Each texel is (twiddle.re, twiddle.im, topIndex, bottomIndex).
   *
   * Stage 0 folds in the bit-reversal permutation, so no separate reorder pass is needed. The
   * twiddle index k advances by N/2^(stage+1), which flips the twiddle's sign for the lower wing of
   * each butterfly group — that is why every texel can use `p + w*q` with no per-wing branch.
   */
  function buildButterflyData(n) {
    var stages = Math.round(Math.log(n) / Math.LN2);
    var data = new Float32Array(stages * n * 4);

    var reversed = new Uint16Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var b = 0; b < stages; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      reversed[i] = r;
    }

    for (var stage = 0; stage < stages; stage++) {
      var span = 1 << stage;             // 2^stage
      var groupSize = span << 1;         // 2^(stage+1)
      for (var y = 0; y < n; y++) {
        var k = ((y * (n / groupSize)) % n + n) % n;
        var angle = (2.0 * Math.PI * k) / n;
        var twRe = Math.cos(angle);
        var twIm = Math.sin(angle);

        var inUpperWing = (y % groupSize) < span;
        var top, bottom;
        if (stage === 0) {
          top = inUpperWing ? reversed[y] : reversed[y - 1];
          bottom = inUpperWing ? reversed[y + 1] : reversed[y];
        } else {
          top = inUpperWing ? y : y - span;
          bottom = inUpperWing ? y + span : y;
        }

        var o = (stage * n + y) * 4;
        data[o] = twRe;
        data[o + 1] = twIm;
        data[o + 2] = top;
        data[o + 3] = bottom;
      }
    }
    return { data: data, stages: stages };
  }

  var FFT_QUAD_VERTEX = [
    'precision highp float;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  /**
   * Evolves h0 to time t and packs the two complex fields the transforms consume.
   *   out0 = (h.re, h.im, Dx.re, Dx.im)   ->  IFFT gives (height, dispX)
   *   out1 = (Dy.re, Dy.im, 0, 0)         ->  IFFT gives (dispY, unused)
   */
  var FFT_SPECTRUM_FRAGMENT = [
    'precision highp float;',
    '',
    'uniform sampler2D u_H0;',        // (h0.re, h0.im, conj(h0(-k)).re, conj(h0(-k)).im)
    'uniform sampler2D u_Omega;',     // dispersion, in .r
    'uniform float u_Time;',
    'uniform float u_N;',
    'uniform float u_TileSize;',
    'uniform float u_Choppiness;',
    'uniform int u_Output;',          // 0 -> height+Dx, 1 -> Dy',
    '',
    'varying vec2 vUv;',
    '',
    'vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }',
    '',
    'void main() {',
    '  vec4 h0 = texture2D(u_H0, vUv);',
    '  float w = texture2D(u_Omega, vUv).r * u_Time;',
    '  vec2 ep = vec2(cos(w), sin(w));',
    '  vec2 en = vec2(cos(w), -sin(w));',
    '',
    '  // h(k,t) = h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}',
    '  vec2 h = cmul(h0.xy, ep) + cmul(h0.zw, en);',
    '',
    '  // Centred wavenumber for this texel.',
    '  vec2 idx = floor(vUv * u_N);',
    '  vec2 kv = (idx - u_N * 0.5) * (6.28318530718 / u_TileSize);',
    '  float klen = length(kv);',
    '  vec2 khat = (klen > 1e-9) ? (kv / klen) : vec2(0.0);',
    '',
    '  // D(k) = -i * khat * h(k,t)',
    '  vec2 dx = vec2(khat.x * h.y, -khat.x * h.x) * u_Choppiness;',
    '  vec2 dy = vec2(khat.y * h.y, -khat.y * h.x) * u_Choppiness;',
    '',
    '  if (u_Output == 0) {',
    '    gl_FragColor = vec4(h, dx);',
    '  } else {',
    '    gl_FragColor = vec4(dy, 0.0, 0.0);',
    '  }',
    '}'
  ].join('\n');

  /**
   * One butterfly stage. Operates on both complex channels of the RGBA texel at once, so a single
   * pass advances (h, Dx) together.
   */
  var FFT_BUTTERFLY_FRAGMENT = [
    'precision highp float;',
    '',
    'uniform sampler2D u_Butterfly;',
    'uniform sampler2D u_PingPong;',
    'uniform float u_Stage;',
    'uniform float u_Stages;',
    'uniform float u_N;',
    'uniform int u_Direction;',   // 0 = horizontal, 1 = vertical
    '',
    'varying vec2 vUv;',
    '',
    'vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }',
    '',
    'void main() {',
    '  vec2 px = floor(vUv * u_N);',
    '  float index = (u_Direction == 0) ? px.x : px.y;',
    '',
    '  vec4 bf = texture2D(u_Butterfly, vec2((u_Stage + 0.5) / u_Stages, (index + 0.5) / u_N));',
    '  vec2 w = bf.xy;',
    '',
    '  vec2 topUv, bottomUv;',
    '  if (u_Direction == 0) {',
    '    topUv = vec2((bf.z + 0.5) / u_N, vUv.y);',
    '    bottomUv = vec2((bf.w + 0.5) / u_N, vUv.y);',
    '  } else {',
    '    topUv = vec2(vUv.x, (bf.z + 0.5) / u_N);',
    '    bottomUv = vec2(vUv.x, (bf.w + 0.5) / u_N);',
    '  }',
    '',
    '  vec4 p = texture2D(u_PingPong, topUv);',
    '  vec4 q = texture2D(u_PingPong, bottomUv);',
    '',
    '  // Both complex channels advance together: xy is one field, zw the other.',
    '  gl_FragColor = vec4(p.xy + cmul(w, q.xy), p.zw + cmul(w, q.zw));',
    '}'
  ].join('\n');

  /**
   * Unpacks the two transformed fields into the displacement texture the water shader samples,
   * applies the (-1)^(x+y) flip that undoes the centred-wavenumber indexing, and computes the
   * displacement Jacobian for folding-based foam.
   */
  var FFT_ASSEMBLE_FRAGMENT = [
    'precision highp float;',
    '',
    'uniform sampler2D u_FieldA;',   // real = height, imag = dispX
    'uniform sampler2D u_FieldB;',   // real = dispY
    'uniform float u_N;',
    'uniform float u_TileSize;',
    '',
    'varying vec2 vUv;',
    '',
    'float signFlip(vec2 px) {',
    '  return mod(px.x + px.y, 2.0) < 0.5 ? 1.0 : -1.0;',
    '}',
    '',
    'vec3 fetchDisp(vec2 px) {',
    '  vec2 uv = (px + 0.5) / u_N;',
    '  float s = signFlip(floor(mod(px + u_N, u_N)));',
    '  vec4 a = texture2D(u_FieldA, uv);',
    '  vec4 b = texture2D(u_FieldB, uv);',
    '  // Packed as IFFT(H + i*DX): real part is the height, imaginary part the X displacement.',
    '  // Field A carries TWO independent complex fields: .xy is h, .zw is Dx. The butterfly\n'
    + '  // pass transforms both channels side by side, so after the transform the real parts\n'
    + '  // are .x and .z. Reading .y here took the (near-zero) imaginary part of the height and\n'
    + '  // the horizontal displacement vanished.',
    '  return vec3(a.z * s, b.x * s, a.x * s);',   // (dispX, dispY, height)
    '}',
    '',
    'void main() {',
    '  vec2 px = floor(vUv * u_N);',
    '  vec3 c = fetchDisp(px);',
    '',
    '  vec3 l = fetchDisp(px - vec2(1.0, 0.0));',
    '  vec3 r = fetchDisp(px + vec2(1.0, 0.0));',
    '  vec3 d = fetchDisp(px - vec2(0.0, 1.0));',
    '  vec3 u = fetchDisp(px + vec2(0.0, 1.0));',
    '',
    '  float cell = u_TileSize / u_N;',
    '  float inv2h = 1.0 / (2.0 * cell);',
    '  float dxdx = (r.x - l.x) * inv2h;',
    '  float dxdy = (u.x - d.x) * inv2h;',
    '  float dydx = (r.y - l.y) * inv2h;',
    '  float dydy = (u.y - d.y) * inv2h;',
    '  float jacobian = (1.0 + dxdx) * (1.0 + dydy) - dxdy * dydx;',
    '  // Stored as the FOLD amount, not the raw Jacobian, so that an all-zero texture means "no\n'
    + '  // foam" rather than "maximum foam". A missing field should not paint the ocean white.',
    '  float fold = clamp(1.0 - jacobian, 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(c.x, c.y, c.z, fold);',
    '}'
  ].join('\n');


  /**
   * Drives the GPU FFT: owns the render targets, runs the passes, and hands back the displacement
   * texture the water shader samples.
   *
   * Everything here is best-effort. If float render targets are unavailable, a shader fails to
   * compile, or anything throws, `failed` is set and the caller falls back to the CPU field — the
   * ocean renders either way, just at lower resolution.
   */
  function OceanGPU(renderer, n, tileSize, field) {
    this.renderer = renderer;
    this.n = n;
    this.tileSize = tileSize;
    this.failed = false;
    this.ready = false;

    try {
      this.init(field);
      this.ready = true;
    } catch (e) {
      this.failed = true;
      this.error = e;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FluidAndWater3D] GPU FFT unavailable (' + (e && e.message) +
          '), falling back to the CPU spectrum. The ocean still renders, at lower resolution.');
      }
    }
  }

  OceanGPU.isSupported = function (renderer) {
    if (!THREE_OK || !renderer) return false;
    if (typeof THREE.WebGLRenderTarget !== 'function') return false;
    var caps = renderer.capabilities;
    if (!caps || caps.isWebGL2 === false) return false;
    // Rendering to a float texture needs this; without it the ping-pong targets are unusable.
    if (typeof renderer.extensions === 'object' && renderer.extensions &&
        typeof renderer.extensions.has === 'function') {
      if (!renderer.extensions.has('EXT_color_buffer_float')) return false;
    }
    return true;
  };

  OceanGPU.prototype.makeTarget = function () {
    var rt = new THREE.WebGLRenderTarget(this.n, this.n, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    return rt;
  };

  OceanGPU.prototype.init = function (field) {
    var n = this.n;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // --- static inputs -------------------------------------------------------------------
    var bf = buildButterflyData(n);
    this.stages = bf.stages;
    this.butterflyTex = new THREE.DataTexture(
      bf.data, this.stages, n, THREE.RGBAFormat, THREE.FloatType
    );
    this.butterflyTex.minFilter = THREE.NearestFilter;
    this.butterflyTex.magFilter = THREE.NearestFilter;
    this.butterflyTex.generateMipmaps = false;
    this.butterflyTex.needsUpdate = true;

    // h0 and omega come straight from the CPU field, so both resolutions are built from the same
    // hash-indexed spectrum and cannot describe different oceans.
    var h0 = new Float32Array(n * n * 4);
    var om = new Float32Array(n * n * 4);
    for (var i = 0; i < n * n; i++) {
      h0[i * 4] = field.h0re[i];
      h0[i * 4 + 1] = field.h0im[i];
      h0[i * 4 + 2] = field.h0cre[i];
      h0[i * 4 + 3] = field.h0cim[i];
      om[i * 4] = field.omega[i];
    }
    this.h0Tex = new THREE.DataTexture(h0, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.h0Tex.minFilter = THREE.NearestFilter;
    this.h0Tex.magFilter = THREE.NearestFilter;
    this.h0Tex.generateMipmaps = false;
    this.h0Tex.needsUpdate = true;

    this.omegaTex = new THREE.DataTexture(om, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.omegaTex.minFilter = THREE.NearestFilter;
    this.omegaTex.magFilter = THREE.NearestFilter;
    this.omegaTex.generateMipmaps = false;
    this.omegaTex.needsUpdate = true;

    // --- targets -------------------------------------------------------------------------
    this.specA = this.makeTarget();
    this.specB = this.makeTarget();
    // Each field needs its OWN ping-pong pair: transforming the second field through a shared pair
    // would overwrite the first field's result before the assemble pass could read it.
    this.pingA1 = this.makeTarget();
    this.pingA2 = this.makeTarget();
    this.pingB1 = this.makeTarget();
    this.pingB2 = this.makeTarget();
    this.output = this.makeTarget();
    // The water shader samples this one, unlike the intermediates — but only with linear
    // filtering if the device can actually filter a float texture.
    var outFilter = pickFloatFilter(this.renderer) || THREE.NearestFilter;
    this.output.texture.minFilter = outFilter;
    this.output.texture.magFilter = outFilter;

    // --- materials -----------------------------------------------------------------------
    this.spectrumMat = new THREE.ShaderMaterial({
      vertexShader: FFT_QUAD_VERTEX,
      fragmentShader: FFT_SPECTRUM_FRAGMENT,
      uniforms: {
        u_H0: { value: this.h0Tex },
        u_Omega: { value: this.omegaTex },
        u_Time: { value: 0 },
        u_N: { value: n },
        u_TileSize: { value: this.tileSize },
        u_Choppiness: { value: 1.0 },
        u_Output: { value: 0 }
      }
    });

    this.butterflyMat = new THREE.ShaderMaterial({
      vertexShader: FFT_QUAD_VERTEX,
      fragmentShader: FFT_BUTTERFLY_FRAGMENT,
      uniforms: {
        u_Butterfly: { value: this.butterflyTex },
        u_PingPong: { value: null },
        u_Stage: { value: 0 },
        u_Stages: { value: this.stages },
        u_N: { value: n },
        u_Direction: { value: 0 }
      }
    });

    this.assembleMat = new THREE.ShaderMaterial({
      vertexShader: FFT_QUAD_VERTEX,
      fragmentShader: FFT_ASSEMBLE_FRAGMENT,
      uniforms: {
        u_FieldA: { value: null },
        u_FieldB: { value: null },
        u_N: { value: n },
        u_TileSize: { value: this.tileSize }
      }
    });
  };

  /** Re-uploads h0 and omega after a wind change, without rebuilding the targets. */
  OceanGPU.prototype.uploadSpectrum = function (field) {
    if (!this.ready || this.failed || !this.h0Tex) return;
    var n = this.n;
    var h0 = this.h0Tex.image.data;
    var om = this.omegaTex.image.data;
    for (var i = 0; i < n * n; i++) {
      h0[i * 4] = field.h0re[i];
      h0[i * 4 + 1] = field.h0im[i];
      h0[i * 4 + 2] = field.h0cre[i];
      h0[i * 4 + 3] = field.h0cim[i];
      om[i * 4] = field.omega[i];
    }
    this.h0Tex.needsUpdate = true;
    this.omegaTex.needsUpdate = true;
  };

  OceanGPU.prototype.blit = function (material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Runs log2(N) horizontal then log2(N) vertical butterfly passes, alternating between the two
   * scratch targets. Returns whichever target holds the result.
   */
  OceanGPU.prototype.transform = function (sourceTarget, scratch1, scratch2) {
    var read = sourceTarget.texture;
    var write = scratch1;
    var spare = scratch2;

    for (var direction = 0; direction < 2; direction++) {
      for (var stage = 0; stage < this.stages; stage++) {
        this.butterflyMat.uniforms.u_PingPong.value = read;
        this.butterflyMat.uniforms.u_Stage.value = stage;
        this.butterflyMat.uniforms.u_Direction.value = direction;
        this.blit(this.butterflyMat, write);

        read = write.texture;
        var swap = write;
        write = spare;
        spare = swap;
      }
    }
    // `spare` was the last target written before the final swap.
    return spare;
  };

  /** Advances to `time` and leaves the displacement + Jacobian in `this.output`. */
  OceanGPU.prototype.update = function (time, choppiness) {
    if (!this.ready || this.failed) return null;
    var prevTarget = this.renderer.getRenderTarget ? this.renderer.getRenderTarget() : null;

    // GDevelop shares one WebGL context between three.js and PIXI, and calls resetState() on the
    // three renderer plus reset() on PIXI at every boundary between them
    // (runtimescene-pixi-renderer). These passes run from a post-events callback, OUTSIDE that
    // handshake, so three's cached GL state is whatever PIXI last left behind — and rendering
    // against a stale cache binds the wrong buffers and returns garbage rather than failing. Sync
    // before, and again after so GDevelop's own render starts from a known state.
    if (typeof this.renderer.resetState === 'function') this.renderer.resetState();

    try {
      this.spectrumMat.uniforms.u_Time.value = time;
      this.spectrumMat.uniforms.u_Choppiness.value = choppiness;

      this.spectrumMat.uniforms.u_Output.value = 0;
      this.blit(this.spectrumMat, this.specA);
      this.spectrumMat.uniforms.u_Output.value = 1;
      this.blit(this.spectrumMat, this.specB);

      var fieldA = this.transform(this.specA, this.pingA1, this.pingA2);
      var fieldB = this.transform(this.specB, this.pingB1, this.pingB2);

      this.assembleMat.uniforms.u_FieldA.value = fieldA.texture;
      this.assembleMat.uniforms.u_FieldB.value = fieldB.texture;
      this.blit(this.assembleMat, this.output);
    } catch (e) {
      this.failed = true;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FluidAndWater3D] GPU FFT failed mid-frame (' + (e && e.message) +
          '); falling back to the CPU spectrum.');
      }
    }

    if (this.renderer.setRenderTarget) this.renderer.setRenderTarget(prevTarget || null);
    if (typeof this.renderer.resetState === 'function') this.renderer.resetState();
    return this.failed ? null : this.output.texture;
  };

  /**
   * Reads a patch of the finished output back and checks it is usable.
   *
   * A GPU FFT can fail in ways that raise no error at all: an unsupported float format, a driver
   * that silently declines to render to the target, a NaN propagating through the butterfly passes.
   * Every one of those leaves the water shader sampling zeros or NaN, and a vertex displaced to NaN
   * makes its whole triangle vanish — so the ocean simply is not drawn, with a clean console.
   *
   * Called once, after the first update. A readback stalls the pipeline, so it must not run per
   * frame.
   */
  OceanGPU.prototype.validateOutput = function () {
    if (!this.ready || this.failed) return null;
    if (typeof this.renderer.readRenderTargetPixels !== 'function') return null;

    var side = Math.min(8, this.n);
    var buf = new Float32Array(side * side * 4);
    try {
      this.renderer.readRenderTargetPixels(this.output, 0, 0, side, side, buf);
    } catch (e) {
      return { ok: false, reason: 'readback threw: ' + (e && e.message) };
    }

    var finite = 0, nonZero = 0, maxAbs = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = buf[i];
      if (isFinite(v)) { finite++; } else { continue; }
      var a = v < 0 ? -v : v;
      if (a > 1e-9) nonZero++;
      if (a > maxAbs) maxAbs = a;
    }

    if (finite !== buf.length) {
      return { ok: false, reason: 'the output contains NaN or Infinity', maxAbs: maxAbs };
    }
    if (nonZero === 0) {
      return { ok: false, reason: 'the output is entirely zero', maxAbs: 0 };
    }
    return { ok: true, maxAbs: maxAbs };
  };

  OceanGPU.prototype.dispose = function () {
    var targets = [this.specA, this.specB, this.pingA1, this.pingA2,
                   this.pingB1, this.pingB2, this.output];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i] && targets[i].dispose) targets[i].dispose();
    }
    var texes = [this.butterflyTex, this.h0Tex, this.omegaTex];
    for (var j = 0; j < texes.length; j++) {
      if (texes[j] && texes[j].dispose) texes[j].dispose();
    }
    var mats = [this.spectrumMat, this.butterflyMat, this.assembleMat];
    for (var m = 0; m < mats.length; m++) {
      if (mats[m] && mats[m].dispose) mats[m].dispose();
    }
    if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
  };


  /* =============================================================== OceanFFT3D & WaterEdge3D */

  /**
   * Jacobian of the horizontal displacement, per grid cell.
   *
   *   J = (1 + dDx/dx)(1 + dDy/dy) - (dDx/dy)(dDy/dx)
   *
   * Where J drops below 1 the surface is compressing; below ~0 it has folded over itself. That is
   * where real water actually breaks, so it is where foam belongs. Tessendorf 2001 uses this, and
   * Sea of Thieves generates its whitecaps the same way (Ang et al. 2018) rather than from wave
   * height — which is why height-thresholded foam reads as identical caps on identical peaks.
   */
  OceanField.prototype.computeFoam = function (out) {
    var n = this.n;
    var cell = this.tileSize / n;
    var dx = this.dispX, dy = this.dispY;
    var inv2h = 1.0 / (2.0 * cell);

    for (var y = 0; y < n; y++) {
      var ym = ((y - 1) + n) % n, yp = (y + 1) % n;
      for (var x = 0; x < n; x++) {
        var xm = ((x - 1) + n) % n, xp = (x + 1) % n;
        var i = y * n + x;

        var dxdx = (dx[y * n + xp] - dx[y * n + xm]) * inv2h;
        var dxdy = (dx[yp * n + x] - dx[ym * n + x]) * inv2h;
        var dydx = (dy[y * n + xp] - dy[y * n + xm]) * inv2h;
        var dydy = (dy[yp * n + x] - dy[ym * n + x]) * inv2h;

        // Fold amount, matching the GPU assemble pass: 0 = flat, 1 = fully folded. Storing the
        // raw Jacobian would make an unpopulated field read as maximum foam.
        var jacobian = (1.0 + dxdx) * (1.0 + dydy) - dxdy * dydx;
        out[i] = clamp(1.0 - jacobian, 0.0, 1.0);
      }
    }
    return out;
  };

  var OCEAN_VERTEX_SHADER = [
    'precision highp float;',
    '',
    'uniform sampler2D u_Field;',   // rgb = displacement XYZ (GDevelop space), a = Jacobian
    'uniform float u_TileSize;',
    'uniform float u_Choppiness;',
    'uniform float u_Time;',
    'uniform float u_EdgeCount;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    'uniform float u_InteractionCount;',
    'uniform vec4 u_Interactions[16];',
    'uniform vec4 u_InteractionParams[16];',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec2 vGdXY;',
    'varying vec2 vFieldUv;',
    'varying float vJacobian;',
    'varying float vShoreAttenuation;',
    'varying float vInteractionFoam;',
    '',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'float interactionWave(vec2 p, out float foam) {',
    '  float displacement = 0.0;',
    '  foam = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (float(i) >= u_InteractionCount) break;',
    '    vec4 e = u_Interactions[i];',
    '    vec4 q = u_InteractionParams[i];',
    '    float age = u_Time - e.z;',
    '    if (age < 0.0 || age >= q.y) continue;',
    '    float fade = 1.0 - age / max(q.y, 0.001);',
    '    float travel = q.x * age / max(q.y, 0.001);',
    '    float width = max(q.x * 0.10, 4.0);',
    '    float dist = length(p - e.xy);',
    '    float shell = exp(-abs(dist - travel) / width);',
    '    float phase = (dist - travel) * 6.2831853 / max(q.x * 0.22, 8.0);',
    '    displacement += e.w * cos(phase) * shell * fade;',
    '    foam = max(foam, shell * fade * clamp(abs(e.w) / 8.0, 0.0, 1.0));',
    '  }',
    '  return displacement;',
    '}',
    '',
    'void main() {',
    '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
    '',
    '  // The scene root is scaled y = -1, so three-space Y is the negated GDevelop Y. The field is',
    '  // built in GDevelop space; un-mirror before sampling and re-mirror the result.',
    '  vec2 gdXY = vec2(worldPos.x, -worldPos.y);',
    '  vec2 uv = gdXY / max(u_TileSize, 0.001);',
    '  vFieldUv = uv;',
    '',
    '  vec4 field = texture2D(u_Field, uv);',
    '',
    '  float edgeFoamWidth, edgeShallowWidth;',
    '  float edgeSignedDistance = signedDistanceToWaterEdge(gdXY, edgeFoamWidth, edgeShallowWidth);',
    '  float shoreAttenuation = 1.0;',
    '  if (u_EdgeCount > 0.0 && edgeShallowWidth > 0.0) {',
    '    shoreAttenuation = smoothstep(0.0, edgeShallowWidth, max(edgeSignedDistance, 0.0));',
    '  }',
    '',
    '  worldPos.x += field.r * u_Choppiness * shoreAttenuation;',
    '  worldPos.y -= field.g * u_Choppiness * shoreAttenuation;',
    '  worldPos.z += field.b * shoreAttenuation;',
    '  float interactionFoam = 0.0;',
    '  worldPos.z += interactionWave(gdXY, interactionFoam) * shoreAttenuation;',
    '',
    '  vWorldPosition = worldPos.xyz;',
    '  vGdXY = gdXY + vec2(field.r, field.g) * u_Choppiness * shoreAttenuation;',
    '  vJacobian = field.a * shoreAttenuation;',
    '  vShoreAttenuation = shoreAttenuation;',
    '  vInteractionFoam = interactionFoam * shoreAttenuation;',
    '',
    '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
    '}'
  ].join('\n');

  // three.js declares cameraPosition/viewMatrix/modelMatrix/projectionMatrix for every non-raw
  // ShaderMaterial. Redeclaring any of them is a GLSL redefinition error and the water never draws.
  var OCEAN_FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'uniform sampler2D u_Field;',
    'uniform float u_TileSize;',
    'uniform float u_FieldTexel;',
    'uniform vec3 u_ShallowColor;',
    'uniform vec3 u_DeepColor;',
    'uniform float u_ExtinctionDepth;',
    'uniform float u_FoamIntensity;',
    'uniform float u_FoamCoverage;',
    'uniform float u_CausticsIntensity;',
    'uniform float u_Time;',
    'uniform vec3 u_SunDirection;',
    'uniform float u_WaterDepth;',
    'uniform float u_EdgeCount;',
    'uniform float u_EdgeMask;',       // 1 = cut the water away under land, 0 = only foam and shallows
    'uniform vec4 u_EdgeBounds[8];',   // minX, minY, maxX, maxY in GDevelop space
    'uniform vec2 u_EdgeParams[8];',   // foamWidth, shallowWidth
    '',
    'varying vec3 vWorldPosition;',
    'varying vec2 vGdXY;',
    'varying vec2 vFieldUv;',
    'varying float vJacobian;',
    'varying float vShoreAttenuation;',
    'varying float vInteractionFoam;',
    '',
    'const vec3 BETA_EXTINCTION = vec3(0.35, 0.08, 0.02);',
    '',
    'vec2 hash2(vec2 p) {',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return fract(sin(p) * 43758.5453123);',
    '}',
    '',
    'float voronoiCaustics(vec2 uv, float time) {',
    '  vec2 p = uv * 4.0;',
    '  vec2 ip = floor(p);',
    '  vec2 fp = fract(p);',
    '  float d = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 nb = vec2(float(x), float(y));',
    '      vec2 pt = hash2(ip + nb);',
    '      pt = 0.5 + 0.5 * sin(time + 6.2831 * pt);',
    '      vec2 diff = nb + pt - fp;',
    '      d = min(d, dot(diff, diff));',
    '    }',
    '  }',
    '  return clamp(pow(1.0 - sqrt(d), 2.0) * 2.0, 0.0, 1.0);',
    '}',
    '',
    '/** Signed distance: positive on the water side, negative inside WaterEdge3D land. */',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'void main() {',
    '  // Normals reconstructed per pixel from the height field rather than interpolated from the',
    '  // vertices, so the lighting carries detail finer than the mesh.',
    '  float e = u_FieldTexel;',
    '  float hL = texture2D(u_Field, vFieldUv - vec2(e, 0.0)).b;',
    '  float hR = texture2D(u_Field, vFieldUv + vec2(e, 0.0)).b;',
    '  float hD = texture2D(u_Field, vFieldUv - vec2(0.0, e)).b;',
    '  float hU = texture2D(u_Field, vFieldUv + vec2(0.0, e)).b;',
    '  float span = 2.0 * e * u_TileSize;',
    '  vec3 nGd = normalize(vec3(-(hR - hL) / span * vShoreAttenuation, -(hU - hD) / span * vShoreAttenuation, 1.0));',
    '  vec3 normal = vec3(nGd.x, -nGd.y, nGd.z);',  // back into mirrored three space
    '  if (!gl_FrontFacing) normal = -normal;',
    '',
    '  vec3 toCam = cameraPosition - vWorldPosition;',
    '  float camDist = length(toCam);',
    '  vec3 viewDir = (camDist > 0.0001) ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);',
    '',
    '  float NdotV = abs(dot(normal, viewDir));',
    '  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);',
    '',
    '  float foamW, shallowW;',
    '  float signedEdge = signedDistanceToWaterEdge(vGdXY, foamW, shallowW);',
    '  float edgeDist = max(signedEdge, 0.0);',
    '  float landMask = 1.0;',
    '  if (u_EdgeCount > 0.0) {',
    '    // The fade was capped at 12 units, a razor edge in a scene measured in thousands.',
    '    float insetFade = max(foamW * 0.5, 1.0);',
    '    landMask = mix(1.0, smoothstep(-insetFade, 0.0, signedEdge), u_EdgeMask);',
    '    if (landMask <= 0.001) discard;',
    '    // With masking off the water keeps rendering under the land footprint. Shade that',
    '    // region as OPEN water: edgeDist is 0 there, which otherwise reads as infinitely',
    '    // shallow water at full surf and turns the whole footprint into one white slab.',
    '    if (signedEdge < 0.0) edgeDist = max(shallowW, foamW);',
    '  }',
    '',
    '  // Optical column: shallow near a registered shore, full depth away from one.',
    '  float column = u_WaterDepth;',
    '  if (u_EdgeCount > 0.0 && shallowW > 0.0) {',
    '    column = min(column, u_WaterDepth * clamp(edgeDist / shallowW, 0.0, 1.0));',
    '  }',
    '  vec3 transmit = exp(-BETA_EXTINCTION * (column / max(u_ExtinctionDepth, 1.0)) * 6.0);',
    '  vec3 waterColor = mix(u_DeepColor, u_ShallowColor, transmit);',
    '',
    '  if (u_CausticsIntensity > 0.0) {',
    '    float c1 = voronoiCaustics(vGdXY * 0.004, u_Time * 1.2);',
    '    float c2 = voronoiCaustics(vGdXY * 0.007 + vec2(1.7, 3.2), u_Time * 1.5);',
    '    waterColor += vec3((c1 + c2) * 0.5 * 0.25 * u_CausticsIntensity * transmit.g);',
    '  }',
    '',
    '  // Whitecaps where the surface folds (Jacobian below 1), not where it is merely tall.',
    '  // vJacobian carries the fold amount already (0 = flat, 1 = fully folded).',
    '  float fold = clamp(vJacobian, 0.0, 1.0);',
    '  float crestFoam = smoothstep(1.0 - u_FoamCoverage, 1.0, fold) * u_FoamIntensity;',
    '',
    '  // Surf along any registered WaterEdge3D volume.',
    '  float shoreFoam = 0.0;',
    '  if (u_EdgeCount > 0.0 && foamW > 0.0) {',
    '    float band = 1.0 - smoothstep(0.0, foamW, edgeDist);',
    '    float contact = 1.0 - smoothstep(0.0, max(foamW * 0.20, 3.0), edgeDist);',
    '    float breakup = 0.68 + 0.32 * sin(vGdXY.x * 0.037 + u_Time * 1.7) * cos(vGdXY.y * 0.043 - u_Time * 1.1);',
    '    float trailing = smoothstep(0.15, 0.82, 0.5 + 0.5 * sin(edgeDist * 0.12 - u_Time * 2.2 + breakup * 3.0));',
    '    // A solid water-side contact line keeps the shore readable; broken trailing bands carry',
    '    // the motion farther out. Both remain controlled by FoamIntensity.',
    '    shoreFoam = clamp(max(contact * 0.95, band * (0.52 * breakup + 0.38 * trailing)) * u_FoamIntensity, 0.0, 1.0);',
    '  }',
    '',
    '  float foam = clamp(max(max(crestFoam, shoreFoam), vInteractionFoam), 0.0, 1.0);',
    '  vec3 foamColor = vec3(0.97, 0.99, 1.0);',
    '',
    '  vec3 sunDir = normalize(u_SunDirection);',
    '  vec3 halfVec = normalize(sunDir + viewDir);',
    '  float specular = pow(max(dot(normal, halfVec), 0.0), 64.0) * 1.5 * (1.0 - foam);',
    '  waterColor += vec3(specular);',
    '',
    '  vec3 finalColor = mix(waterColor, vec3(0.65, 0.85, 1.0), fresnel * 0.35);',
    '  // Apply foam after reflection. The previous early blend was tinted back toward blue by',
    '  // Fresnel, making a valid shore mask disappear on a bright, rough surface.',
    '  finalColor = mix(finalColor, foamColor, foam);',
    '',
    '  float alpha = mix(0.45, 0.95, 1.0 - transmit.g);',
    '  alpha = clamp(max(alpha + fresnel * 0.2, foam), 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(finalColor, alpha * landMask);',
    '}'
  ].join('\n');

  var MAX_WATER_EDGES = 8;
  var MAX_WATER_INTERACTIONS = 16;

  function makeInteractionArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_INTERACTIONS; i++) {
      arr.push(THREE_OK && typeof THREE.Vector4 === 'function'
        ? new THREE.Vector4(0, 0, 0, 0)
        : { x: 0, y: 0, z: 0, w: 0, set: function (x, y, z, w) {
          this.x = x; this.y = y; this.z = z; this.w = w;
        } });
    }
    return arr;
  }

  /** Exact CPU counterpart of the localized ripple term shared by both water shaders. */
  function interactionDisplacementAt(holder, x, y, time) {
    if (!holder || !holder.interactions) return 0.0;
    var out = 0.0;
    for (var i = 0; i < holder.interactions.length; i++) {
      var e = holder.interactions[i];
      var age = time - e.time;
      if (age < 0 || age >= e.life) continue;
      var fade = 1.0 - age / Math.max(e.life, 0.001);
      var travel = e.radius * age / Math.max(e.life, 0.001);
      var dx = x - e.x, dy = y - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var width = Math.max(e.radius * 0.10, 4.0);
      var shell = Math.exp(-Math.abs(dist - travel) / width);
      var phase = (dist - travel) * 6.2831853 / Math.max(e.radius * 0.22, 8.0);
      out += e.strength * Math.cos(phase) * shell * fade;
    }
    return out;
  }

  /**
   * Picks a filter mode a float texture can actually be sampled with.
   *
   * Linear filtering of 32-bit float textures needs `OES_texture_float_linear`, which is NOT core
   * in WebGL2. Without it the texture is INCOMPLETE and every sample silently returns (0,0,0,1) —
   * no warning, no error, the shader just reads zeros. That reads as a dead flat surface, and
   * (before the foam encoding was fixed) as a fully foamed white one.
   */
  function pickFloatFilter(renderer) {
    if (!THREE_OK) return null;
    var linear = true;
    try {
      if (renderer && renderer.extensions && typeof renderer.extensions.has === 'function') {
        linear = !!renderer.extensions.has('OES_texture_float_linear');
      }
    } catch (e) { linear = false; }

    if (!linear && typeof console !== 'undefined' && console.info) {
      console.info('[FluidAndWater3D] OES_texture_float_linear is unavailable on this device; the ' +
        'ocean field is sampled unfiltered. Waves are correct, surface normals are slightly faceted.');
    }
    return linear ? THREE.LinearFilter : THREE.NearestFilter;
  }

  /** The three.js renderer, or null. Needed before any float texture is created. */
  function getThreeRendererOf(runtimeScene) {
    try {
      var game = runtimeScene && runtimeScene.getGame ? runtimeScene.getGame() : null;
      var gr = game && game.getRenderer ? game.getRenderer() : null;
      return gr && gr.getThreeRenderer ? gr.getThreeRenderer() : null;
    } catch (e) {
      return null;
    }
  }


  /**
   * Lagrangian SPH solver (Mueller et al.) over a spatial hash grid.
   *
   * Fluid parameters are stored PER PARTICLE rather than passed once per step: a scene can pour
   * honey and water at the same time, and a single global viscosity would make every preset behave
   * identically. Positions are in metres (GDevelop pixels x SPH_WORLD_SCALE).
   */
  function SPHSolver(maxDroplets) {
    this.maxDroplets = maxDroplets || 2000;
    this.h = 0.06;
    this.h2 = this.h * this.h;
    this.h3 = this.h2 * this.h;
    this.h6 = this.h3 * this.h3;
    this.h9 = this.h6 * this.h3;

    this.poly6 = 315.0 / (64.0 * Math.PI * this.h9);
    this.spikyGrad = -45.0 / (Math.PI * this.h6);
    this.viscLap = 45.0 / (Math.PI * this.h6);

    this.x = new Float32Array(this.maxDroplets);
    this.y = new Float32Array(this.maxDroplets);
    this.z = new Float32Array(this.maxDroplets);

    this.vx = new Float32Array(this.maxDroplets);
    this.vy = new Float32Array(this.maxDroplets);
    this.vz = new Float32Array(this.maxDroplets);

    this.fx = new Float32Array(this.maxDroplets);
    this.fy = new Float32Array(this.maxDroplets);
    this.fz = new Float32Array(this.maxDroplets);

    this.density = new Float32Array(this.maxDroplets);
    this.pressure = new Float32Array(this.maxDroplets);
    this.alive = new Uint8Array(this.maxDroplets);
    this.life = new Float32Array(this.maxDroplets);

    // Per-particle material, so presets are actually distinguishable.
    this.visc = new Float32Array(this.maxDroplets);
    this.tension = new Float32Array(this.maxDroplets);
    this.rest = new Float32Array(this.maxDroplets);
    this.radius = new Float32Array(this.maxDroplets);
    this.cr = new Float32Array(this.maxDroplets);
    this.cg = new Float32Array(this.maxDroplets);
    this.cb = new Float32Array(this.maxDroplets);
    this.owner = new Int32Array(this.maxDroplets);

    this.particleCount = 0;
    this.particleMass = 0.02;

    // O(1) slot allocation. The previous linear scan for a free slot ran the full array on every
    // emitted droplet, which at 60 droplets/s over 3000 slots is 180k probes a second.
    this.freeList = new Int32Array(this.maxDroplets);
    this.freeCount = 0;

    this.gridTableSize = 4096;
    this.gridHead = new Int32Array(this.gridTableSize);
    this.gridNext = new Int32Array(this.maxDroplets);
    // Hash buckets can contain unrelated cells. Keep exact coordinates so a collision cannot make
    // one neighbour appear in two queried cells and contribute density/force more than once.
    this.gridCellX = new Int32Array(this.maxDroplets);
    this.gridCellY = new Int32Array(this.maxDroplets);
    this.gridCellZ = new Int32Array(this.maxDroplets);
    this.gridCellSize = this.h;
  }

  SPHSolver.prototype.hashCoords = function (cx, cy, cz) {
    var h = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
    return Math.abs(h) % this.gridTableSize;
  };

  SPHSolver.prototype.buildSpatialGrid = function () {
    this.gridHead.fill(-1);
    var invCell = 1.0 / this.gridCellSize;

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;
      var cx = Math.floor(this.x[i] * invCell);
      var cy = Math.floor(this.y[i] * invCell);
      var cz = Math.floor(this.z[i] * invCell);
      var cellHash = this.hashCoords(cx, cy, cz);

      this.gridCellX[i] = cx;
      this.gridCellY[i] = cy;
      this.gridCellZ[i] = cz;
      this.gridNext[i] = this.gridHead[cellHash];
      this.gridHead[cellHash] = i;
    }
  };

  SPHSolver.prototype.kill = function (i) {
    if (i < 0 || i >= this.maxDroplets || !this.alive[i]) return;
    this.alive[i] = 0;
    this.freeList[this.freeCount++] = i;
  };

  /**
   * @param props {viscosity, surfaceTension, restDensity, radius, color:[r,g,b] 0..1, owner}
   */
  SPHSolver.prototype.emit = function (x, y, z, vx, vy, vz, maxLife, props) {
    var idx = -1;
    if (this.freeCount > 0) {
      idx = this.freeList[--this.freeCount];
    } else if (this.particleCount < this.maxDroplets) {
      idx = this.particleCount++;
    } else {
      return -1;
    }

    var pr = props || {};

    this.x[idx] = x;
    this.y[idx] = y;
    this.z[idx] = z;
    this.vx[idx] = vx;
    this.vy[idx] = vy;
    this.vz[idx] = vz;
    this.fx[idx] = 0;
    this.fy[idx] = 0;
    this.fz[idx] = 0;

    this.rest[idx] = pr.restDensity > 0 ? pr.restDensity : 1000.0;
    this.visc[idx] = pr.viscosity !== undefined ? pr.viscosity : 1.0;
    this.tension[idx] = pr.surfaceTension !== undefined ? pr.surfaceTension : 0.8;
    this.radius[idx] = pr.radius > 0 ? pr.radius : 0.02;
    var c = pr.color || [1.0, 0.2, 0.5];
    this.cr[idx] = c[0];
    this.cg[idx] = c[1];
    this.cb[idx] = c[2];
    this.owner[idx] = pr.owner !== undefined ? pr.owner : -1;

    this.density[idx] = this.rest[idx];
    this.pressure[idx] = 0.0;
    this.alive[idx] = 1;
    this.life[idx] = maxLife || 12.0;

    return idx;
  };

  SPHSolver.prototype.step = function (dt, cfg) {
    if (this.particleCount === 0 || dt <= 0.0) return;
    cfg = cfg || {};

    var gasStiffness = 300.0;
    var h2 = this.h2;
    var poly6 = this.poly6;
    var spikyGrad = this.spikyGrad;
    var viscLap = this.viscLap;
    var mass = this.particleMass;
    var invCell = 1.0 / this.gridCellSize;

    this.buildSpatialGrid();

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      var piX = this.x[i];
      var piY = this.y[i];
      var piZ = this.z[i];

      var cx = Math.floor(piX * invCell);
      var cy = Math.floor(piY * invCell);
      var cz = Math.floor(piZ * invCell);

      var rho = 0.0;

      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          for (var oz = -1; oz <= 1; oz++) {
            var queryX = cx + ox;
            var queryY = cy + oy;
            var queryZ = cz + oz;
            var cellHash = this.hashCoords(queryX, queryY, queryZ);
            var j = this.gridHead[cellHash];
            while (j !== -1) {
              if (this.alive[j] &&
                  this.gridCellX[j] === queryX &&
                  this.gridCellY[j] === queryY &&
                  this.gridCellZ[j] === queryZ) {
                var dx = piX - this.x[j];
                var dy = piY - this.y[j];
                var dz = piZ - this.z[j];
                var r2 = dx * dx + dy * dy + dz * dz;

                if (r2 < h2) {
                  var diff = h2 - r2;
                  rho += mass * poly6 * diff * diff * diff;
                }
              }
              j = this.gridNext[j];
            }
          }
        }
      }

      var restI = this.rest[i];
      this.density[i] = Math.max(rho, restI * 0.5);
      var ratio = this.density[i] / restI;
      // Tait equation of state.
      this.pressure[i] = Math.max(0.0, gasStiffness * (ratio * ratio * ratio * ratio - 1.0));
    }

    var gravX = 0.0;
    var gravY = 0.0;
    var gravZ = -GRAVITY * (cfg.gravityScale !== undefined ? cfg.gravityScale : 1.0);

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      var piX = this.x[i];
      var piY = this.y[i];
      var piZ = this.z[i];
      var pviX = this.vx[i];
      var pviY = this.vy[i];
      var pviZ = this.vz[i];
      var pRho = this.density[i];
      var pPress = this.pressure[i];
      var pVisc = this.visc[i];
      var pTension = this.tension[i];

      var fPressX = 0.0, fPressY = 0.0, fPressZ = 0.0;
      var fViscX = 0.0, fViscY = 0.0, fViscZ = 0.0;
      var fCohesionX = 0.0, fCohesionY = 0.0, fCohesionZ = 0.0;

      var cx = Math.floor(piX * invCell);
      var cy = Math.floor(piY * invCell);
      var cz = Math.floor(piZ * invCell);

      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          for (var oz = -1; oz <= 1; oz++) {
            var queryX = cx + ox;
            var queryY = cy + oy;
            var queryZ = cz + oz;
            var cellHash = this.hashCoords(queryX, queryY, queryZ);
            var j = this.gridHead[cellHash];
            while (j !== -1) {
              if (j !== i && this.alive[j] &&
                  this.gridCellX[j] === queryX &&
                  this.gridCellY[j] === queryY &&
                  this.gridCellZ[j] === queryZ) {
                var dx = piX - this.x[j];
                var dy = piY - this.y[j];
                var dz = piZ - this.z[j];
                var r2 = dx * dx + dy * dy + dz * dz;

                if (r2 < h2 && r2 > 0.000001) {
                  var r = Math.sqrt(r2);
                  var hDiff = this.h - r;
                  var invR = 1.0 / r;

                  var pGradTerm = -mass * ((pPress + this.pressure[j]) / (2.0 * this.density[j])) * spikyGrad * hDiff * hDiff;
                  fPressX += pGradTerm * dx * invR;
                  fPressY += pGradTerm * dy * invR;
                  fPressZ += pGradTerm * dz * invR;

                  // Viscosity is averaged across the pair so honey dragging through water behaves
                  // symmetrically (Newton's third law) instead of only one side feeling the drag.
                  var muPair = 0.5 * (pVisc + this.visc[j]);
                  var vLapTerm = muPair * mass * (1.0 / this.density[j]) * viscLap * hDiff;
                  fViscX += vLapTerm * (this.vx[j] - pviX);
                  fViscY += vLapTerm * (this.vy[j] - pviY);
                  fViscZ += vLapTerm * (this.vz[j] - pviZ);

                  var cohTerm = 0.5 * (pTension + this.tension[j]) * mass * poly6 * (h2 - r2) * (h2 - r2);
                  fCohesionX -= cohTerm * dx;
                  fCohesionY -= cohTerm * dy;
                  fCohesionZ -= cohTerm * dz;
                }
              }
              j = this.gridNext[j];
            }
          }
        }
      }

      this.fx[i] = fPressX + fViscX + fCohesionX + gravX * pRho;
      this.fy[i] = fPressY + fViscY + fCohesionY + gravY * pRho;
      this.fz[i] = fPressZ + fViscZ + fCohesionZ + gravZ * pRho;
    }

    var floorZ = cfg.floorZ !== undefined ? cfg.floorZ : 0.0;
    var damping = 0.98;
    // Viscous fluids need a smaller substep to stay stable; split the frame rather than exploding.
    var substeps = Math.min(4, Math.max(1, Math.ceil(dt / 0.008)));
    var sdt = dt / substeps;

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0.0) {
        this.kill(i);
        continue;
      }

      var invRho = 1.0 / this.density[i];
      var ax = this.fx[i] * invRho;
      var ay = this.fy[i] * invRho;
      var az = this.fz[i] * invRho;

      var maxAcc = 200.0;
      ax = clamp(ax, -maxAcc, maxAcc);
      ay = clamp(ay, -maxAcc, maxAcc);
      az = clamp(az, -maxAcc, maxAcc);

      for (var sub = 0; sub < substeps; sub++) {
        this.vx[i] = (this.vx[i] + ax * sdt) * damping;
        this.vy[i] = (this.vy[i] + ay * sdt) * damping;
        this.vz[i] = (this.vz[i] + az * sdt) * damping;

        this.x[i] += this.vx[i] * sdt;
        this.y[i] += this.vy[i] * sdt;
        this.z[i] += this.vz[i] * sdt;

        if (this.z[i] < floorZ) {
          this.z[i] = floorZ;
          this.vz[i] = -this.vz[i] * 0.3;
          this.vx[i] *= 0.8;
          this.vy[i] *= 0.8;
        }
      }
    }
  };

  SPHSolver.prototype.getActiveCount = function () {
    var count = 0;
    for (var i = 0; i < this.particleCount; i++) {
      if (this.alive[i]) count++;
    }
    return count;
  };

  SPHSolver.prototype.countOwnedBy = function (ownerId) {
    var count = 0;
    for (var i = 0; i < this.particleCount; i++) {
      if (this.alive[i] && this.owner[i] === ownerId) count++;
    }
    return count;
  };

  SPHSolver.prototype.clearAll = function () {
    this.alive.fill(0);
    this.particleCount = 0;
    this.freeCount = 0;
  };

  /* ------------------------------------------------------------- State & Registration */

  var sceneStates = new WeakMap();

  function getSceneState(runtimeScene) {
    var state = sceneStates.get(runtimeScene);
    if (!state) {
      state = {
        waterBodies: [],
        oceans: [],
        waterEdges: [],
        buoyantObjects: [],
        pourableObjects: [],
        containers: [],
        time: 0.0,
        timeScale: 1.0,
        paused: false,
        sphSolver: new SPHSolver(3000),
        // Ground plane the droplets pile up on, in GDevelop units. Settable so a scene whose floor
        // is not at Z = 0 does not have its liquid stop in mid-air.
        sphFloorZ: 0.0,
        particleMesh: null,
        particleLayerName: null,
        particleColor: THREE_OK && typeof THREE.Color === 'function' ? new THREE.Color() : null,
        dummyObj: null,
        nextOwnerId: 1,
        physicsBehaviorCache: typeof WeakMap === 'function' ? new WeakMap() : null,
        underwaterActive: false,
        underwaterBody: null,
        savedFog: null,
        savedBackground: null
      };
      sceneStates.set(runtimeScene, state);
    }
    return state;
  }

  /* ------------------------------------------------------------- Shaders */

  // NOTE ON COORDINATE SPACE:
  // GDevelop's 3D scene root carries scale.y = -1 (layer-pixi-renderer._setup3DRendering), so
  // (modelMatrix * position).y is the NEGATED GDevelop Y. Every wave phase below is therefore
  // evaluated on vec2(worldPos.x, -worldPos.y) so the GPU surface matches the CPU solver used by
  // buoyancy and WaveHeightAt(), and the resulting XY displacement is mapped back into three space.

  var WATER_VERTEX_SHADER = [
    'precision highp float;',
    '',
    'uniform float u_Time;',
    'uniform float u_WaveHeight;',
    'uniform float u_WaveChoppiness;',
    'uniform float u_WaveSpeed;',
    'uniform float u_WindDir;',
    'uniform float u_WaveTiling;',
    'uniform float u_BaseWavelength;',
    'uniform float u_MinWavelength;',
    'uniform float u_DirSpread;',
    'uniform float u_PhaseSeed;',
    'uniform float u_WaveIrregularity;',
    'uniform float u_EdgeCount;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    'uniform float u_InteractionCount;',
    'uniform vec4 u_Interactions[16];',
    'uniform vec4 u_InteractionParams[16];',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec3 vWorldNormal;',
    'varying vec2 vUv;',
    'varying vec2 vGdXY;',
    'varying float vWaveCrest;',
    'varying float vInteractionFoam;',
    '',
    '#define GRAVITY 9.81',
    '#define OCTAVE_COUNT ' + GERSTNER_OCTAVES.length + '.0',
    '#define PI 3.14159265359',
    '',
    '// Signed distance to the union of WaterEdge3D AABBs: positive on water, negative on land.',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'void addWave(',
    '  in float dirOffsetDeg,',
    '  in float lenRatio,',
    '  in float ampRatio,',
    '  in float steepness,',
    '  in float speedMul,',
    '  in float phaseOffset,',
    '  in vec2 worldXY,',
    '  in float windRad,',
    '  in float baseLen,',
    '  in float baseAmp,',
    '  in float time,',
    '  inout vec3 dPos,',
    '  inout vec3 dNorm,',
    '  inout float ampSum',
    ') {',
    '  float wavelength = baseLen * lenRatio;',
    '',
    '  // An octave the mesh cannot resolve is not a wave, it is sampling noise. Fade it out',
    '  // instead of drawing it. The CPU solver applies the identical fade, so buoyancy and',
    '  // WaveHeightAt() keep agreeing with the surface on screen.',
    '  float fade = smoothstep(u_MinWavelength * 0.5, u_MinWavelength, wavelength);',
    '  float a = baseAmp * ampRatio * fade;',
    '  ampSum += a;',
    '  if (a <= 0.0) return;',
    '',
    '  float angle = windRad + radians(dirOffsetDeg * u_DirSpread);',
    '  vec2 dir = vec2(cos(angle), sin(angle));',
    '  float k = (2.0 * PI) / max(wavelength, 1.0);',
    '  float w = sqrt(GRAVITY * k) * speedMul * u_WaveSpeed;',
    '  float q = clamp((u_WaveChoppiness * steepness) / (k * a * OCTAVE_COUNT + 0.0001), 0.0, 1.0);',
    '',
    '  // lenRatio varies per octave, so one seed shifts every octave by a different amount.',
    '  float phase = k * dot(dir, worldXY) - w * time + phaseOffset + u_PhaseSeed * lenRatio * 6.2831853;',
    '  float wanderRate = 0.045 + 0.035 * (1.0 - lenRatio);',
    '  float crossCoord = dot(vec2(-dir.y, dir.x), worldXY);',
    '  float wanderArg = k * crossCoord * 0.37 + time * wanderRate + phaseOffset * 1.731 + u_PhaseSeed * (0.37 + lenRatio);',
    '  phase += clamp(u_WaveIrregularity, 0.0, 1.0) * 0.55 * sin(wanderArg);',
    '  float sinP = sin(phase);',
    '  float cosP = cos(phase);',
    '',
    '  dPos.x -= q * a * dir.x * sinP;',
    '  dPos.y -= q * a * dir.y * sinP;',
    '  dPos.z += a * cosP;',
    '',
    '  float wa = w * a;',
    '  dNorm.x -= dir.x * wa * sinP;',
    '  dNorm.y -= dir.y * wa * sinP;',
    '  dNorm.z -= q * wa * cosP;',
    '}',
    '',
    'float interactionWave(vec2 p, out float foam) {',
    '  float displacement = 0.0;',
    '  foam = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (float(i) >= u_InteractionCount) break;',
    '    vec4 e = u_Interactions[i];',
    '    vec4 q = u_InteractionParams[i];',
    '    float age = u_Time - e.z;',
    '    if (age < 0.0 || age >= q.y) continue;',
    '    float fade = 1.0 - age / max(q.y, 0.001);',
    '    float travel = q.x * age / max(q.y, 0.001);',
    '    float width = max(q.x * 0.10, 4.0);',
    '    float dist = length(p - e.xy);',
    '    float shell = exp(-abs(dist - travel) / width);',
    '    float phase = (dist - travel) * 6.2831853 / max(q.x * 0.22, 8.0);',
    '    displacement += e.w * cos(phase) * shell * fade;',
    '    foam = max(foam, shell * fade * clamp(abs(e.w) / 8.0, 0.0, 1.0));',
    '  }',
    '  return displacement;',
    '}',
    '',
    'void main() {',
    '  vUv = uv;',
    '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
    '',
    '  // Un-mirror Y so the GPU phase matches the CPU Gerstner solver (GDevelop space).',
    '  vec2 gdXY = vec2(worldPos.x, -worldPos.y);',
    '',
    '  float edgeFoamWidth, edgeShallowWidth;',
    '  float edgeSignedDistance = signedDistanceToWaterEdge(gdXY, edgeFoamWidth, edgeShallowWidth);',
    '  float shoreAttenuation = 1.0;',
    '  if (u_EdgeCount > 0.0 && edgeShallowWidth > 0.0) {',
    '    // Flatten waves as they run onto land; the fragment shader masks the negative side.',
    '    shoreAttenuation = smoothstep(0.0, edgeShallowWidth, max(edgeSignedDistance, 0.0));',
    '  }',
    '  float baseAmp = u_WaveHeight * 0.5 * shoreAttenuation;',
    '  float windRad = radians(u_WindDir);',
    '  float baseLen = u_BaseWavelength / max(u_WaveTiling, 0.001);',
    '',
    '  vec3 dPos = vec3(0.0);',
    '  vec3 dNorm = vec3(0.0, 0.0, 1.0);',
    '  float ampSum = 0.0;',
    '',
  ].concat(GERSTNER_OCTAVES.map(function (o) {
    // Emitted from the octave table itself: a shader that hardcoded these would silently
    // drift from the CPU solver the first time the table changed.
    return '  addWave(' + [o.dirOffset, o.lenRatio, o.ampRatio, o.steepness, o.speedMul, o.phase]
      .map(function (v) { return v.toFixed(5); }).join(', ') +
      ', gdXY, windRad, baseLen, baseAmp, u_Time, dPos, dNorm, ampSum);';
  })).concat([
    '',
    '  float interactionFoam = 0.0;',
    '  dPos.z += interactionWave(gdXY, interactionFoam) * shoreAttenuation;',
    '  vInteractionFoam = interactionFoam * shoreAttenuation;',
    '',
    '  // Map the GDevelop-space displacement back into the mirrored three.js space.',
    '  worldPos.x += dPos.x;',
    '  worldPos.y -= dPos.y;',
    '  worldPos.z += dPos.z;',
    '',
    '  vWorldPosition = worldPos.xyz;',
    '  vGdXY = gdXY + vec2(dPos.x, dPos.y);',
    '',
    '  vec3 nMirrored = vec3(dNorm.x, -dNorm.y, dNorm.z);',
    '  float nLen = length(nMirrored);',
    '  vWorldNormal = (nLen > 0.0001) ? (nMirrored / nLen) : vec3(0.0, 0.0, 1.0);',
    '',
    '  // Normalise against the amplitude actually retained after the octave fade, not against',
    '  // the full baseAmp — otherwise whitecaps quietly stop appearing on a coarse mesh.',
    '  vWaveCrest = clamp((dPos.z / max(ampSum, 0.0001)) * 0.5 + 0.5, 0.0, 1.0);',
    '',
    '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
    '}'
  ]).join('\n');

  // `cameraPosition`, `viewMatrix`, `modelMatrix` and `projectionMatrix` are declared by three.js's
  // own ShaderMaterial prefix (WebGLProgram) — redeclaring any of them is a GLSL redefinition error
  // and the material then silently never compiles. Do not add them here.
  var WATER_FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'uniform vec3 u_ShallowColor;',
    'uniform vec3 u_DeepColor;',
    'uniform float u_ExtinctionDepth;',
    'uniform float u_RefractionScale;',
    'uniform float u_ShoreFoamIntensity;',
    'uniform float u_CrestFoamIntensity;',
    'uniform float u_CausticsIntensity;',
    'uniform float u_WaveHeight;',
    'uniform float u_Time;',
    'uniform vec3 u_SunDirection;',
    'uniform float u_WaveTiling;',
    'uniform vec2 u_PlaneSize;',
    'uniform float u_WaterDepth;',
    'uniform float u_EdgeCount;',
    'uniform float u_EdgeMask;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec3 vWorldNormal;',
    'varying vec2 vUv;',
    'varying vec2 vGdXY;',
    'varying float vWaveCrest;',
    'varying float vInteractionFoam;',
    '',
    '// Beer-Lambert extinction coefficients (red absorbs fastest, blue penetrates deepest).',
    'const vec3 BETA_EXTINCTION = vec3(0.35, 0.08, 0.02);',
    '',
    '// Signed distance to the union of WaterEdge3D AABBs: positive on water, negative on land.',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'vec2 hash2(vec2 p) {',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return fract(sin(p) * 43758.5453123);',
    '}',
    '',
    'float voronoiCaustics(vec2 uv, float time) {',
    '  vec2 p = uv * 4.0;',
    '  vec2 ip = floor(p);',
    '  vec2 fp = fract(p);',
    '  float d = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 neighbor = vec2(float(x), float(y));',
    '      vec2 point = hash2(ip + neighbor);',
    '      point = 0.5 + 0.5 * sin(time + 6.2831 * point);',
    '      vec2 diff = neighbor + point - fp;',
    '      d = min(d, dot(diff, diff));',
    '    }',
    '  }',
    '  return clamp(pow(1.0 - sqrt(d), 2.0) * 2.0, 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  float nLen = length(vWorldNormal);',
    '  vec3 normal = (nLen > 0.0001) ? (vWorldNormal / nLen) : vec3(0.0, 0.0, 1.0);',
    '  if (!gl_FrontFacing) {',
    '    normal = -normal;',
    '  }',
    '',
    '  vec3 toCam = cameraPosition - vWorldPosition;',
    '  float camDist = length(toCam);',
    '  vec3 viewDir = (camDist > 0.0001) ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);',
    '',
    '  float NdotV = abs(dot(normal, viewDir));',
    '  // Schlick Fresnel, F0 = 0.02 for water (n = 1.333).',
    '  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);',
    '',
    '  // Optical column depth. With no scene depth pre-pass available the column is approximated',
    '  // from the distance to the water volume edge, clamped by the volume depth: shallow at the',
    '  // shoreline, full depth toward the middle of the body.',
    '  vec2 duv = min(vUv, vec2(1.0) - vUv);',
    '  float volumeEdgeDist = min(duv.x * u_PlaneSize.x, duv.y * u_PlaneSize.y);',
    '  float foamWidth = max(u_WaveHeight * 2.0, 4.0);',
    '  float shallowWidth = max(foamWidth * 3.0, 12.0);',
    '  float edgeDist = volumeEdgeDist;',
    '  float landMask = 1.0;',
    '  if (u_EdgeCount > 0.0) {',
    '    float signedEdge = signedDistanceToWaterEdge(vGdXY, foamWidth, shallowWidth);',
    '    float insetFade = max(foamWidth * 0.5, 1.0);',
    '    landMask = mix(1.0, smoothstep(-insetFade, 0.0, signedEdge), u_EdgeMask);',
    '    if (landMask <= 0.001) discard;',
    '    edgeDist = max(signedEdge, 0.0);',
    '    // With masking off the water keeps rendering under the land footprint. Shade that',
    '    // region as OPEN water: edgeDist is 0 there, which otherwise reads as infinitely',
    '    // shallow water at full surf and turns the whole footprint into one white slab.',
    '    if (signedEdge < 0.0) edgeDist = max(shallowWidth, foamWidth);',
    '  }',
    '  float column = min(edgeDist, max(u_WaterDepth, 0.0));',
    '  if (u_EdgeCount > 0.0 && shallowWidth > 0.0) {',
    '    column = min(u_WaterDepth, u_WaterDepth * clamp(edgeDist / shallowWidth, 0.0, 1.0));',
    '  }',
    '  vec3 transmit = exp(-BETA_EXTINCTION * (column / max(u_ExtinctionDepth, 1.0)) * 6.0);',
    '  vec3 waterColor = mix(u_DeepColor, u_ShallowColor, transmit);',
    '',
    '  // Surface-normal distortion standing in for screen-space refraction (no scene color buffer',
    '  // is exposed to sample, so the distortion is applied to the caustic pattern instead).',
    '  vec2 refractOffset = normal.xy * u_RefractionScale * 40.0;',
    '  if (u_CausticsIntensity > 0.0) {',
    '    vec2 cUv = (vGdXY + refractOffset) * 0.004 * max(u_WaveTiling, 0.001);',
    '    float caustics1 = voronoiCaustics(cUv, u_Time * 1.2);',
    '    float caustics2 = voronoiCaustics(cUv * 1.75 + vec2(1.7, 3.2), u_Time * 1.5);',
    '    float caustics = (caustics1 + caustics2) * 0.5;',
    '    // Caustics light the bottom, so they only read through shallow, transmissive water.',
    '    waterColor += vec3(caustics * 0.25 * u_CausticsIntensity * transmit.g);',
    '  }',
    '',
    '  // Shore foam: a definite contact line plus broken trailing surf on the water side.',
    '  float shoreBand = 1.0 - smoothstep(0.0, foamWidth, edgeDist);',
    '  float contactFoam = 1.0 - smoothstep(0.0, max(foamWidth * 0.20, 3.0), edgeDist);',
    '  float foamNoise = 0.68 + 0.32 * sin(vGdXY.x * 0.047 + u_Time * 1.7) * cos(vGdXY.y * 0.053 - u_Time * 1.1);',
    '  float trailingFoam = smoothstep(0.15, 0.82, 0.5 + 0.5 * sin(edgeDist * 0.12 - u_Time * 2.2 + foamNoise * 3.0));',
    '  float shoreFoam = clamp(max(contactFoam * 0.95, shoreBand * (0.52 * foamNoise + 0.38 * trailingFoam)) * u_ShoreFoamIntensity, 0.0, 1.0);',
    '',
    '  // Crest whitecaps on the steep tops of the swell.',
    '  float crestFoam = smoothstep(0.62, 0.92, vWaveCrest) * u_CrestFoamIntensity;',
    '',
    '  float foam = clamp(max(max(shoreFoam, crestFoam), vInteractionFoam), 0.0, 1.0);',
    '  vec3 foamColor = vec3(0.95, 0.98, 1.0);',
    '',
    '  // Sun specular gleam.',
    '  vec3 sunDir = normalize(u_SunDirection);',
    '  vec3 halfVec = normalize(sunDir + viewDir);',
    '  float NdotH = max(dot(normal, halfVec), 0.0);',
    '  float specular = pow(NdotH, 64.0) * 1.5 * (1.0 - foam);',
    '  waterColor += vec3(specular);',
    '',
    '  // Sky reflection.',
    '  vec3 skyTint = vec3(0.65, 0.85, 1.0);',
    '  vec3 finalColor = mix(waterColor, skyTint, fresnel * 0.35);',
    '  // Foam is a final surface layer: reflections must not wash it back into the water tint.',
    '  finalColor = mix(finalColor, foamColor, foam);',
    '',
    '  // Shallow water reads through; deep water and foam go opaque.',
    '  float alpha = mix(0.45, 0.95, 1.0 - transmit.g);',
    '  alpha = clamp(max(alpha + fresnel * 0.2, foam), 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(finalColor, alpha * landMask);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- FluidAndWater3D Namespace */

  var FluidAndWater3D = {
    FLUID_PRESETS: FLUID_PRESETS,
    GERSTNER_OCTAVES: GERSTNER_OCTAVES,

    OceanField: OceanField,
    buildButterflyData: buildButterflyData,
    OceanGPU: OceanGPU,
    OceanFFT: OceanFFT,
    SPHSolver: SPHSolver,
    phillipsSpectrum: phillipsSpectrum,
    oceanGaussianPair: oceanGaussianPair,

    evaluateGerstnerDisplacement: evaluateGerstnerDisplacement,
    evaluateGerstnerNormal: evaluateGerstnerNormal,
    evaluateWaveVelocity: evaluateWaveVelocity,

    /* ========================================================= 1. WaterBody3D */

    registerWaterBody: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var shallow = parseColor(options.shallowColor, [64, 224, 208]);
      var deep = parseColor(options.deepColor, [10, 45, 90]);
      var fogCol = parseColor(options.underwaterFogColor, [15, 65, 110]);

      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      var body = {
        object: object,
        behavior: behavior,
        waterType: options.waterType || 'Ocean',
        waveHeight: num(options.waveHeight, 18.0),
        waveChoppiness: num(options.waveChoppiness, 0.75),
        waveSpeed: num(options.waveSpeed, 1.0),
        windDirection: num(options.windDirection, 45.0),
        waveTiling: num(options.waveTiling, 1.0),
        materialSource: options.materialSource || 'Builtin',
        shallowColor: [shallow[0] / 255, shallow[1] / 255, shallow[2] / 255],
        deepColor: [deep[0] / 255, deep[1] / 255, deep[2] / 255],
        extinctionDepth: num(options.extinctionDepth, 150.0),
        refractionScale: num(options.refractionScale, 0.02),
        maskUnderEdges: options.maskUnderEdges !== undefined ? !!options.maskUnderEdges : true,
        shoreFoamIntensity: num(options.shoreFoamIntensity, 0.85),
        crestFoamIntensity: num(options.crestFoamIntensity, 0.60),
        enableCaustics: options.enableCaustics !== undefined ? !!options.enableCaustics : true,
        enableUnderwaterFX: options.enableUnderwaterFX !== undefined ? !!options.enableUnderwaterFX : false,
        underwaterFogColor: [fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255],
        underwaterFogDensity: num(options.underwaterFogDensity, 0.0005),
        gridSubdivisions: options.gridSubdivisions || 48,
        waveScaleMode: options.waveScaleMode || 'Absolute',
        directionalSpread: num(options.directionalSpread, 45.0),
        phaseSeed: options.phaseSeed || 0.0,
        waveIrregularity: clamp(num(options.waveIrregularity, 0.4), 0.0, 1.0),
        enableBodyInteractions: options.enableBodyInteractions !== undefined ? !!options.enableBodyInteractions : true,
        interactionStrength: options.interactionStrength !== undefined ? Math.max(options.interactionStrength, 0.0) : 14.0,
        interactionRadius: options.interactionRadius !== undefined ? Math.max(options.interactionRadius, 1.0) : 180.0,
        interactionSpeedThreshold: options.interactionSpeedThreshold !== undefined ? Math.max(options.interactionSpeedThreshold, 0.0) : 35.0,
        interactionLifetime: 1.6,
        interactions: [],
        interactionTracks: typeof WeakMap === 'function' ? new WeakMap() : null,
        // Derived, not authored: recomputed whenever the volume is resized.
        baseWavelength: 0.0,
        minWavelength: 0.0,
        waveDetailFraction: 1.0,
        isCameraUnderwater: false,
        initialWidth: width,
        initialHeight: height,
        layerName: objectLayerName(object),
        mesh: null,
        material: null
      };

      var subs = Math.round(clamp(body.gridSubdivisions, 8, 256));
      body.baseWavelength = computeBaseWavelength(body.waveScaleMode, width, height);
      body.minWavelength = computeMinWavelength(width, height, subs);
      refreshWaveResolution(body, width, height, subs);

      if (THREE_OK) {
        var geom = new THREE.PlaneGeometry(width, height, subs, subs);

        var mat = new THREE.ShaderMaterial({
          vertexShader: WATER_VERTEX_SHADER,
          fragmentShader: WATER_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          side: THREE.DoubleSide,
          uniforms: {
            u_Time: { value: 0.0 },
            u_WaveHeight: { value: body.waveHeight },
            u_WaveChoppiness: { value: body.waveChoppiness },
            u_WaveSpeed: { value: body.waveSpeed },
            u_WindDir: { value: body.windDirection },
            u_WaveTiling: { value: body.waveTiling },
            u_BaseWavelength: { value: body.baseWavelength },
            u_MinWavelength: { value: body.minWavelength },
            u_DirSpread: { value: body.directionalSpread / 45.0 },
            u_PhaseSeed: { value: body.phaseSeed },
            u_WaveIrregularity: { value: body.waveIrregularity },
            u_ShallowColor: { value: new THREE.Vector3().fromArray(body.shallowColor) },
            u_DeepColor: { value: new THREE.Vector3().fromArray(body.deepColor) },
            u_ExtinctionDepth: { value: body.extinctionDepth },
            u_RefractionScale: { value: body.refractionScale },
            u_ShoreFoamIntensity: { value: body.shoreFoamIntensity },
            u_CrestFoamIntensity: { value: body.crestFoamIntensity },
            u_SunDirection: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
            u_CausticsIntensity: { value: body.enableCaustics ? 1.0 : 0.0 },
            u_PlaneSize: { value: new THREE.Vector2(width, height) },
            u_WaterDepth: { value: depth > 0 ? depth : 150.0 },
            u_EdgeCount: { value: 0.0 },
            u_EdgeMask: { value: body.maskUnderEdges ? 1.0 : 0.0 },
            u_EdgeBounds: { value: makeEdgeBoundsArray() },
            u_EdgeParams: { value: makeEdgeParamsArray() },
            u_InteractionCount: { value: 0.0 },
            u_Interactions: { value: makeInteractionArray() },
            u_InteractionParams: { value: makeInteractionArray() }
            // No `cameraPosition` uniform here: three.js declares and feeds it automatically for
            // every ShaderMaterial. Declaring our own shadows it and breaks shader compilation.
          }
        });
        body.material = mat;
        body.mesh = new THREE.Mesh(geom, mat);
        body.mesh.name = 'FluidAndWater3D_WaterPlane';
        body.mesh.frustumCulled = false;
        // Recent GDevelop builds apply an instance's editor transform after behavior onCreated.
        // A surface positioned here can therefore spend initialization at world origin. Keep it
        // hidden until doStepPreEvents reads the final transform and places it atomically.
        body.mesh.visible = false;

        // Parent to the object's OWN layer, not a hardcoded base layer — otherwise a water body on
        // any other layer is added to a scene that is never rendered for it.
        var threeRoot = getLayerThreeRoot(runtimeScene, body.layerName);
        if (threeRoot) threeRoot.add(body.mesh);

        // Apply 6-material water volume array to replace purple placeholder
        if (typeof THREE.MeshBasicMaterial === 'function') {
          var sideMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]),
            transparent: true,
            opacity: 0.55,
            depthWrite: true,
            side: THREE.DoubleSide
          });
          var topMat = new THREE.MeshBasicMaterial({
            visible: false
          });
          var bottomMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(body.deepColor[0], body.deepColor[1], body.deepColor[2]),
            transparent: true,
            opacity: 0.65,
            depthWrite: true,
            side: THREE.DoubleSide
          });
          body.boxMaterials = [sideMat, sideMat, sideMat, sideMat, topMat, bottomMat];
          // Applying these to the source box is deferred with the surface transform below.
        }
      }

      state.waterBodies.push(body);

      if (!state._waterAnnounced && typeof console !== 'undefined' && console.info) {
        state._waterAnnounced = true;
        console.info('[FluidAndWater3D] WaterBody3D (Gerstner) registered on "' +
          (object.getName ? object.getName() : '?') + '" — mesh ' +
          (body.mesh ? 'created' : 'MISSING') + ', parent = ' +
          (body.mesh && body.mesh.parent ? (body.mesh.parent.type || 'object') : 'NONE') +
          '. This is the octave-sum water, not the Tessendorf ocean.');
      }

      return body;
    },

    stepWaterBody: function (runtimeScene, object, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return;

      // Follow the object if it is moved to another layer at runtime.
      var currentLayer = objectLayerName(object);
      if (currentLayer !== body.layerName) {
        body.layerName = currentLayer;
        if (body.mesh && body.mesh.parent && body.mesh.parent.remove) body.mesh.parent.remove(body.mesh);
      }

      if (body.mesh && !body.mesh.parent) {
        var threeRoot = getLayerThreeRoot(runtimeScene, body.layerName);
        if (threeRoot) threeRoot.add(body.mesh);
      }

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      if (body.mesh) {
        body.mesh.position.set(objX + w * 0.5, objY + h * 0.5, objZ + d + 0.1);

        if (body.initialWidth > 0 && body.initialHeight > 0) {
          body.mesh.scale.set(w / body.initialWidth, h / body.initialHeight, 1.0);
        }

        // GDevelop 3D objects rotate ZYX; three.js defaults to XYZ, which reorders the same angles
        // into a different orientation as soon as two axes are non-zero.
        if (body.mesh.rotation && body.mesh.rotation.order !== 'ZYX') body.mesh.rotation.order = 'ZYX';
        if (object.getAngle) body.mesh.rotation.z = object.getAngle() * (Math.PI / 180.0);
        if (object.getRotationX) body.mesh.rotation.x = object.getRotationX() * (Math.PI / 180.0);
        if (object.getRotationY) body.mesh.rotation.y = object.getRotationY() * (Math.PI / 180.0);
        // Reveal only after position, scale and rotation all describe the editor instance.
        body.mesh.visible = true;

        // Wave scale, shore foam and optical depth all read the volume's dimensions, so they
        // have to be recomputed when it is resized rather than frozen at creation.
        var liveSubs = Math.round(clamp(body.gridSubdivisions, 8, 256));
        body.baseWavelength = computeBaseWavelength(body.waveScaleMode, w, h);
        body.minWavelength = computeMinWavelength(w, h, liveSubs);
        refreshWaveResolution(body, w, h, liveSubs);

        if (body.material && body.material.uniforms) {
          var su = body.material.uniforms;
          if (su.u_PlaneSize && su.u_PlaneSize.value && su.u_PlaneSize.value.set) {
            su.u_PlaneSize.value.set(w, h);
          }
          if (su.u_WaterDepth) su.u_WaterDepth.value = d > 0 ? d : 150.0;
          if (su.u_BaseWavelength) su.u_BaseWavelength.value = body.baseWavelength;
          if (su.u_MinWavelength) su.u_MinWavelength.value = body.minWavelength;
        }
      }

      // Ensure original 3D box maintains water volume materials
      var root = getRootObject3D(object);
      if (root) {
        root.visible = true;
        if (body.boxMaterials) {
          if (root.isMesh && root.material !== body.boxMaterials) root.material = body.boxMaterials;
          if (typeof root.traverse === 'function') {
            root.traverse(function (child) {
              if (child && child.isMesh && child !== body.mesh && child.material !== body.boxMaterials) {
                child.material = body.boxMaterials;
              }
            });
          }
        }
      }
    },

    updateWaterBody: function (runtimeScene, object, behavior, options) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return;

      if (options.waveHeight !== undefined) body.waveHeight = options.waveHeight;
      if (options.waveChoppiness !== undefined) body.waveChoppiness = options.waveChoppiness;
      if (options.waveSpeed !== undefined) body.waveSpeed = options.waveSpeed;
      if (options.windDirection !== undefined) body.windDirection = options.windDirection;
      if (options.waveTiling !== undefined) body.waveTiling = options.waveTiling;
      if (options.extinctionDepth !== undefined) body.extinctionDepth = options.extinctionDepth;
      if (options.refractionScale !== undefined) body.refractionScale = options.refractionScale;
      if (options.shoreFoamIntensity !== undefined) body.shoreFoamIntensity = options.shoreFoamIntensity;
      if (options.crestFoamIntensity !== undefined) body.crestFoamIntensity = options.crestFoamIntensity;
      if (options.enableUnderwaterFX !== undefined) body.enableUnderwaterFX = !!options.enableUnderwaterFX;
      if (options.enableCaustics !== undefined) body.enableCaustics = !!options.enableCaustics;
      if (options.waveScaleMode !== undefined) body.waveScaleMode = options.waveScaleMode;
      if (options.directionalSpread !== undefined) body.directionalSpread = options.directionalSpread;
      if (options.phaseSeed !== undefined) body.phaseSeed = options.phaseSeed;
      if (options.waveIrregularity !== undefined) body.waveIrregularity = clamp(options.waveIrregularity, 0.0, 1.0);
      if (options.enableBodyInteractions !== undefined) body.enableBodyInteractions = !!options.enableBodyInteractions;
      if (options.interactionStrength !== undefined) body.interactionStrength = Math.max(options.interactionStrength, 0.0);
      if (options.interactionRadius !== undefined) body.interactionRadius = Math.max(options.interactionRadius, 1.0);
      if (options.interactionSpeedThreshold !== undefined) body.interactionSpeedThreshold = Math.max(options.interactionSpeedThreshold, 0.0);
      if (options.underwaterFogDensity !== undefined) body.underwaterFogDensity = options.underwaterFogDensity;

      if (options.shallowColor) {
        var sc = parseColor(options.shallowColor, [64, 224, 208]);
        body.shallowColor = [sc[0] / 255, sc[1] / 255, sc[2] / 255];
        if (body.boxMaterials && body.boxMaterials[0] && body.boxMaterials[0].color) {
          body.boxMaterials[0].color.setRGB(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]);
        }
      }
      if (options.deepColor) {
        var dc = parseColor(options.deepColor, [10, 45, 90]);
        body.deepColor = [dc[0] / 255, dc[1] / 255, dc[2] / 255];
        if (body.boxMaterials && body.boxMaterials[5] && body.boxMaterials[5].color) {
          body.boxMaterials[5].color.setRGB(body.deepColor[0], body.deepColor[1], body.deepColor[2]);
        }
      }
      if (options.underwaterFogColor) {
        var fc = parseColor(options.underwaterFogColor, [15, 65, 110]);
        body.underwaterFogColor = [fc[0] / 255, fc[1] / 255, fc[2] / 255];
      }

      if (body.material && body.material.uniforms) {
        var u = body.material.uniforms;
        if (u.u_WaveHeight) u.u_WaveHeight.value = body.waveHeight;
        if (u.u_WaveChoppiness) u.u_WaveChoppiness.value = body.waveChoppiness;
        if (u.u_WaveSpeed) u.u_WaveSpeed.value = body.waveSpeed;
        if (u.u_WindDir) u.u_WindDir.value = body.windDirection;
        if (u.u_WaveTiling) u.u_WaveTiling.value = body.waveTiling;
        if (u.u_ExtinctionDepth) u.u_ExtinctionDepth.value = body.extinctionDepth;
        if (u.u_RefractionScale) u.u_RefractionScale.value = body.refractionScale;
        if (u.u_ShoreFoamIntensity) u.u_ShoreFoamIntensity.value = body.shoreFoamIntensity;
        if (u.u_EdgeMask) u.u_EdgeMask.value = body.maskUnderEdges ? 1.0 : 0.0;
        if (u.u_CrestFoamIntensity) u.u_CrestFoamIntensity.value = body.crestFoamIntensity;
        if (u.u_CausticsIntensity) u.u_CausticsIntensity.value = body.enableCaustics ? 1.0 : 0.0;
        if (u.u_DirSpread) u.u_DirSpread.value = body.directionalSpread / 45.0;
        if (u.u_PhaseSeed) u.u_PhaseSeed.value = body.phaseSeed;
        if (u.u_WaveIrregularity) u.u_WaveIrregularity.value = body.waveIrregularity;
        if (u.u_ShallowColor) u.u_ShallowColor.value.set(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]);
        if (u.u_DeepColor) u.u_DeepColor.value.set(body.deepColor[0], body.deepColor[1], body.deepColor[2]);
      }
    },

    disposeWaterBody: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterBodies.findIndex(function (b) { return b.behavior === behavior; });
      if (idx !== -1) {
        var body = state.waterBodies[idx];
        if (body.mesh) {
          if (body.mesh.geometry) body.mesh.geometry.dispose();
          if (body.mesh.material) body.mesh.material.dispose();
          if (body.mesh.parent) body.mesh.parent.remove(body.mesh);
        }
        if (body.boxMaterials) {
          if (body.boxMaterials[0]) body.boxMaterials[0].dispose();
          if (body.boxMaterials[4]) body.boxMaterials[4].dispose();
          if (body.boxMaterials[5]) body.boxMaterials[5].dispose();
        }
        if (body.volumeMaterial) {
          body.volumeMaterial.dispose();
        }
        state.waterBodies.splice(idx, 1);
      }
    },

    waterBodyOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterBodies.find(function (b) { return b.behavior === behavior; }) || null;
    },

    getWaveHeightAt: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body) return 0.0;
      var cfg = waveConfigOf(body, body.object.getZ ? body.object.getZ() : 0.0);
      var baseZ = (body.object.getZ ? body.object.getZ() : 0.0) +
        ((body.object.getDepth && body.object.getDepth() > 0) ? body.object.getDepth() : 0.0);
      var edge = waterEdgeInfluenceAt(state, x, y, body.layerName, baseZ, waterSpanOf(body));
      return (evaluateGerstnerDisplacement(x, y, state.time, cfg) +
        interactionDisplacementAt(body, x, y, state.time)) * edge.attenuation;
    },

    getWaterSurfaceZ: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body || !body.object) return 0.0;
      var baseZ = (body.object.getZ ? body.object.getZ() : 0.0) + (body.object.getDepth ? body.object.getDepth() : 0.0);
      return baseZ + FluidAndWater3D.getWaveHeightAt(runtimeScene, behavior, x, y);
    },

    /**
     * Percentage of the authored wave amplitude this body's mesh can actually draw (0-100).
     * 100 means every octave is resolved; 0 means the surface renders flat — raise
     * GridSubdivisions or switch WaveScaleMode to "RelativeToVolume".
     */
    getWaveDetailPercent: function (runtimeScene, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return 0.0;
      return clamp(body.waveDetailFraction * 100.0, 0.0, 100.0);
    },

    isCameraUnderwater: function (runtimeScene, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      return body ? body.isCameraUnderwater : false;
    },

    isPositionUnderwater: function (runtimeScene, behavior, x, y, z) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body || !body.object) return false;

      var obj = body.object;
      var objX = obj.getX ? obj.getX() : 0;
      var objY = obj.getY ? obj.getY() : 0;
      var objZ = obj.getZ ? obj.getZ() : 0;
      var objW = (obj.getWidth && obj.getWidth() > 0) ? obj.getWidth() : 1000;
      var objH = (obj.getHeight && obj.getHeight() > 0) ? obj.getHeight() : 1000;
      var objD = (obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0;

      var inX = x >= objX && x <= (objX + objW);
      var inY = y >= objY && y <= (objY + objH);
      if (!inX || !inY) return false;

      var surfZ = objZ + objD + FluidAndWater3D.getWaveHeightAt(runtimeScene, behavior, x, y);
      return z >= (objZ - 10.0) && z <= surfZ;
    },

    /* ========================================================= 4. OceanFFT3D */

    registerOcean: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      var shallow = parseColor(options.shallowColor, [64, 224, 208]);
      var deep = parseColor(options.deepColor, [10, 45, 90]);
      var fogCol = parseColor(options.underwaterFogColor, [15, 65, 110]);

      // Tile at the volume's own size unless overridden: one tile across the body means the field
      // never visibly repeats, which is FFT water's classic weakness on an unbounded ocean.
      var tile = options.tileSize > 0 ? options.tileSize : Math.max(width, height);

      var res = clamp(Math.round(options.resolution || 64), 16, 128);
      // Power of two, as the radix-2 transform requires.
      res = Math.pow(2, Math.round(Math.log(res) / Math.LN2));

      var ocean = {
        object: object,
        behavior: behavior,
        layerName: objectLayerName(object),
        tileSize: tile,
        tileSizeOption: options.tileSize > 0 ? options.tileSize : 0,
        resolution: res,
        windSpeed: options.windSpeed > 0 ? options.windSpeed : 12.0,
        windDirection: num(options.windDirection, 45.0),
        waveHeightScale: options.waveHeightScale > 0 ? options.waveHeightScale : 1.0,
        choppiness: num(options.choppiness, 1.0),
        seed: options.seed !== undefined ? Math.round(options.seed) : 1337,
        unitsPerMetre: options.unitsPerMetre > 0 ? options.unitsPerMetre : 100.0,
        // 0 = fit automatically to the volume, which is the default.
        wavelengthScaleOption: num(options.wavelengthScale, 0),
        // Crest-to-crest distance in SCENE UNITS. The most direct way to set how big the waves
        // feel next to the player. 0 leaves it to the fit.
        peakWavelengthOption: options.peakWavelength > 0 ? options.peakWavelength : 0,
        wavelengthScale: 1.0,
        shallowColor: [shallow[0] / 255, shallow[1] / 255, shallow[2] / 255],
        deepColor: [deep[0] / 255, deep[1] / 255, deep[2] / 255],
        extinctionDepth: options.extinctionDepth > 0 ? options.extinctionDepth : 150.0,
        foamIntensity: num(options.foamIntensity, 0.8),
        foamCoverage: num(options.foamCoverage, 0.35),
        maskUnderEdges: options.maskUnderEdges !== undefined ? !!options.maskUnderEdges : true,
        enableCaustics: options.enableCaustics !== undefined ? !!options.enableCaustics : true,
        enableUnderwaterFX: options.enableUnderwaterFX !== undefined ? !!options.enableUnderwaterFX : false,
        underwaterFogColor: [fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255],
        underwaterFogDensity: num(options.underwaterFogDensity, 0.0005),
        enableBodyInteractions: options.enableBodyInteractions !== undefined ? !!options.enableBodyInteractions : true,
        interactionStrength: options.interactionStrength !== undefined ? Math.max(options.interactionStrength, 0.0) : 14.0,
        interactionRadius: options.interactionRadius !== undefined ? Math.max(options.interactionRadius, 1.0) : 180.0,
        interactionSpeedThreshold: options.interactionSpeedThreshold !== undefined ? Math.max(options.interactionSpeedThreshold, 0.0) : 35.0,
        interactionLifetime: 1.6,
        interactions: [],
        interactionTracks: typeof WeakMap === 'function' ? new WeakMap() : null,
        gridSubdivisions: clamp(Math.round(options.gridSubdivisions || res), 8, 256),
        initialWidth: width,
        initialHeight: height,
        isCameraUnderwater: false,
        field: null,
        foamBuffer: null,
        texData: null,
        texture: null,
        mesh: null,
        material: null
      };

      resolveWavelengthScale(ocean);
      ocean.field = new OceanField(res, tile, {
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: Math.max(tile / res * 0.25, 0.5),
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.foamBuffer = new Float32Array(res * res);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      if (THREE_OK && typeof THREE.DataTexture === 'function') {
        ocean.texData = new Float32Array(res * res * 4);
        ocean.texture = new THREE.DataTexture(ocean.texData, res, res, THREE.RGBAFormat, THREE.FloatType);
        ocean.texture.wrapS = THREE.RepeatWrapping;
        ocean.texture.wrapT = THREE.RepeatWrapping;
        var fieldFilter = pickFloatFilter(getThreeRendererOf(runtimeScene)) || THREE.NearestFilter;
        ocean.texture.minFilter = fieldFilter;
        ocean.texture.magFilter = fieldFilter;
        ocean.texture.generateMipmaps = false;
        ocean.texture.needsUpdate = true;

        var subs = ocean.gridSubdivisions;
        var geom = new THREE.PlaneGeometry(width, height, subs, subs);

        var mat = new THREE.ShaderMaterial({
          vertexShader: OCEAN_VERTEX_SHADER,
          fragmentShader: OCEAN_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          side: THREE.DoubleSide,
          uniforms: {
            u_Field: { value: ocean.texture },
            u_TileSize: { value: tile },
            u_FieldTexel: { value: 1.0 / res },
            u_Choppiness: { value: ocean.choppiness },
            u_ShallowColor: { value: new THREE.Vector3().fromArray(ocean.shallowColor) },
            u_DeepColor: { value: new THREE.Vector3().fromArray(ocean.deepColor) },
            u_ExtinctionDepth: { value: ocean.extinctionDepth },
            u_FoamIntensity: { value: ocean.foamIntensity },
            u_FoamCoverage: { value: ocean.foamCoverage },
            u_CausticsIntensity: { value: ocean.enableCaustics ? 1.0 : 0.0 },
            u_Time: { value: 0.0 },
            u_SunDirection: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
            u_WaterDepth: { value: depth > 0 ? depth : 150.0 },
            u_EdgeCount: { value: 0.0 },
            u_EdgeMask: { value: ocean.maskUnderEdges ? 1.0 : 0.0 },
            u_EdgeBounds: { value: makeEdgeBoundsArray() },
            u_EdgeParams: { value: makeEdgeParamsArray() },
            u_InteractionCount: { value: 0.0 },
            u_Interactions: { value: makeInteractionArray() },
            u_InteractionParams: { value: makeInteractionArray() }
          }
        });

        ocean.material = mat;
        ocean.mesh = new THREE.Mesh(geom, mat);
        ocean.mesh.name = 'FluidAndWater3D_OceanFFT';
        ocean.mesh.frustumCulled = false;
        if (ocean.mesh.rotation) ocean.mesh.rotation.order = 'ZYX';
        // The editor instance transform is not reliable during onCreated in recent runtimes.
        // doStepPreEvents positions and reveals the surface once the final values are available.
        ocean.mesh.visible = false;

        var root = getLayerThreeRoot(runtimeScene, ocean.layerName);
        if (root) root.add(ocean.mesh);

        // Hiding the source top face is deferred until the replacement surface is positioned.
      }

      // Optional high-resolution GPU spectrum. The CPU field keeps driving buoyancy; this only
      // raises the detail of what is drawn. Both are built from `oceanGaussianPair` indexed by
      // integer wavenumber and normalised to the same significant wave height, so the GPU surface
      // is the CPU field plus finer detail rather than a different sea.
      var gpuRes = clamp(Math.round(options.gpuResolution || 0), 0, 512);
      if (gpuRes > res && THREE_OK) {
        gpuRes = Math.pow(2, Math.round(Math.log(gpuRes) / Math.LN2));
        var threeRenderer = null;
        try {
          var game = runtimeScene.getGame ? runtimeScene.getGame() : null;
          var gr = game && game.getRenderer ? game.getRenderer() : null;
          threeRenderer = gr && gr.getThreeRenderer ? gr.getThreeRenderer() : null;
        } catch (e) {}

        if (threeRenderer && OceanGPU.isSupported(threeRenderer)) {
          ocean.gpuResolution = gpuRes;
          ocean.gpuField = new OceanField(gpuRes, tile, {
            windSpeed: ocean.windSpeed,
            windDirection: ocean.windDirection,
            amplitude: 1.0,
            smallWaveCutoff: Math.max(tile / gpuRes * 0.25, 0.5),
            unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
            seed: ocean.seed
          });
          // Same physical target height as the CPU field, so the swell they share matches.
          ocean.gpuField.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
          ocean.gpu = new OceanGPU(threeRenderer, gpuRes, tile, ocean.gpuField);
          if (ocean.gpu.failed) ocean.gpu = null;
        } else if (gpuRes > res && typeof console !== 'undefined' && console.info) {
          console.info('[FluidAndWater3D] GPU FFT not available on this device; ' +
            'the ocean runs on the CPU spectrum at ' + res + 'x' + res + '.');
        }
      }

      FluidAndWater3D.updateOceanField(ocean, 0.0);
      state.oceans.push(ocean);

      // The report is deferred to the first step: see rebuildOceanForSize for why the size is not
      // trustworthy yet.
      // One-time report. Every failure this extension has had rendered as "nothing visible" with
      // a clean console, so say out loud what was actually built.
      if (false && !state._oceanAnnounced && typeof console !== 'undefined' && console.info) {
        state._oceanAnnounced = true;
        var otherWater = state.waterBodies.length;
        var report = [
          '[FluidAndWater3D] OceanFFT3D registered on "' + (object.getName ? object.getName() : '?') + '"',
          '  surface mesh : ' + (ocean.mesh ? 'created' : 'MISSING') + ', parent = ' +
            (ocean.mesh && ocean.mesh.parent ? (ocean.mesh.parent.type || 'object') : 'NONE - it cannot render'),
          '  position     : ' + (ocean.mesh ? [ocean.mesh.position.x, ocean.mesh.position.y, ocean.mesh.position.z].map(function (v) { return Math.round(v); }).join(', ') : '-') +
            '   size ' + Math.round(width) + ' x ' + Math.round(height),
          '  spectrum     : CPU ' + res + '^2' + (ocean.gpu ? ', GPU ' + ocean.gpuResolution + '^2' : ', GPU off') +
            '   tile ' + Math.round(tile),
          '  wave height  : Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units at ' + ocean.windSpeed + ' m/s',
          '  wave length  : ' + Math.round(ocean.field && ocean.field.peakWavelength || 0) +
            ' units crest to crest   (' + (ocean.field && ocean.field.peakWavelength > 0
              ? (tile / ocean.field.peakWavelength).toFixed(1) : '?') + ' waves across the body)',
        ];
        // A sea taller than the body it lives in is not a sea. Real wind waves cap out around
        // height/wavelength = 1/7 before they break, and the longest wave a tile can carry is the
        // tile itself — so anything past a fraction of the tile means the scene scale and the wind
        // speed disagree, and the surface displaces itself clean off screen.
        var steep = ocean.significantWaveHeight / Math.max(tile, 1);
        if (steep > 0.15) {
          report.push('  WARNING: the waves are far too big for this water body.');
          report.push('    Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units against a tile of only ' +
            Math.round(tile) + ' units (' + (steep * 100).toFixed(0) + '% of it). The surface is displaced',
          );
          report.push('    well outside the volume, which usually looks like the water vanishing.');
          report.push('    At Units Per Metre ' + ocean.unitsPerMetre + ' this volume is ' +
            (tile / ocean.unitsPerMetre).toFixed(1) + ' m across, and ' + ocean.windSpeed +
            ' m/s of wind physically means ' + (ocean.significantWaveHeight / ocean.unitsPerMetre).toFixed(1) + ' m waves.');
          report.push('    Fix by any one of:');
          report.push('      - enlarging the water volume to about ' + Math.round(ocean.significantWaveHeight * 20) + ' units, or');
          report.push('      - setting Units Per Metre to ' + Math.max(1, Math.round(ocean.unitsPerMetre * steep / 0.05)) + ' if your scene is not 100 units per metre, or');
          report.push('      - dropping Wind Speed to about ' + Math.max(1, Math.sqrt(0.05 * tile * 9.81 / (0.21 * ocean.unitsPerMetre * ocean.waveHeightScale))).toFixed(1) + ' m/s, or');
          report.push('      - setting Wave Height Scale to about ' + (0.05 / steep * ocean.waveHeightScale).toFixed(3) + '.');
        }
        if (otherWater > 0) {
          report.push('  WARNING: ' + otherWater + ' WaterBody3D surface(s) are also active here. Two water');
          report.push('  surfaces overlap, and the flat one is probably what you are looking at. Remove');
          report.push('  the WaterBody3D behavior from objects that now use OceanFFT3D.');
        }
        console.info(report.join('\n'));
      }

      return ocean;
    },

    /**
     * Rebuilds the wave field when the water volume's real size turns out to differ from the size
     * it was built for.
     *
     * GDevelop applies an instance's custom width/height AFTER the behavior's onCreated runs, so at
     * registration a Cube3D still reports its object default (100 x 100 x 100). Everything derived
     * from the volume size — the tile the field repeats over, and the significant wave height the
     * spectrum is normalised to — is therefore wrong until the first step. Freezing it at creation
     * left a 7000-unit ocean carrying a 100-unit tile and 300-unit waves: the field repeated
     * seventy times across the body and displaced the surface clean outside it.
     */
    rebuildOceanForSize: function (ocean, width, height) {
      var desiredTile = ocean.tileSizeOption > 0 ? ocean.tileSizeOption : Math.max(width, height);
      if (!(desiredTile > 0)) return false;
      if (Math.abs(desiredTile - ocean.tileSize) < 0.5) return false;

      ocean.tileSize = desiredTile;

      var cutoff = Math.max(desiredTile / ocean.resolution * 0.25, 0.5);
      resolveWavelengthScale(ocean);
      ocean.field = new OceanField(ocean.resolution, desiredTile, {
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: cutoff,
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      if (ocean.gpuField && ocean.gpu && !ocean.gpu.failed) {
        ocean.gpuField = new OceanField(ocean.gpuResolution, desiredTile, {
          windSpeed: ocean.windSpeed,
          windDirection: ocean.windDirection,
          amplitude: 1.0,
          smallWaveCutoff: Math.max(desiredTile / ocean.gpuResolution * 0.25, 0.5),
          unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
          seed: ocean.seed
        });
        ocean.gpuField.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
        ocean.gpu.tileSize = desiredTile;
        ocean.gpu.uploadSpectrum(ocean.gpuField);
        if (ocean.gpu.spectrumMat) ocean.gpu.spectrumMat.uniforms.u_TileSize.value = desiredTile;
        if (ocean.gpu.assembleMat) ocean.gpu.assembleMat.uniforms.u_TileSize.value = desiredTile;
      }

      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_TileSize) {
        ocean.material.uniforms.u_TileSize.value = desiredTile;
      }
      return true;
    },

    /**
     * One-time shore report, emitted from the post-events loop once the uploads have run.
     *
     * "No foam appears" has one cause in the shader — u_EdgeCount is 0 — and several causes in
     * the scene, none of which announce themselves. This prints the actual verdict for every
     * registered edge against every water surface, so the answer is read rather than guessed.
     */
    announceShore: function (state) {
      if (state._shoreAnnounced || !(state.time > 1.0)) return;
      if (typeof console === 'undefined' || !console.info) return;

      var surfaces = [];
      var wbi, oi;
      for (wbi = 0; wbi < state.waterBodies.length; wbi++) {
        surfaces.push({ kind: 'WaterBody3D', w: state.waterBodies[wbi] });
      }
      for (oi = 0; oi < state.oceans.length; oi++) {
        surfaces.push({ kind: 'OceanFFT3D', w: state.oceans[oi] });
      }
      if (surfaces.length === 0) return;
      state._shoreAnnounced = true;

      var lines = ['[FluidAndWater3D] Shore foam status'];
      if (state.waterEdges.length === 0) {
        lines.push('  No WaterEdge3D behavior is attached to anything in this scene.');
        lines.push('  Shore foam only draws along a registered edge volume. Add the WaterEdge3D');
        lines.push('  behavior to the object standing in for your beach, cliff or harbour wall.');
        lines.push('  (Whitecap foam on the open water is separate and needs no edge.)');
        for (var li = 0; li < lines.length; li++) console.info(lines[li]);
        return;
      }

      for (var si = 0; si < surfaces.length; si++) {
        var kind = surfaces[si].kind, w = surfaces[si].w, o = w.object;
        var surfZ = (o && o.getZ ? o.getZ() : 0) +
          ((o && o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0);
        var count = (w.material && w.material.uniforms && w.material.uniforms.u_EdgeCount)
          ? w.material.uniforms.u_EdgeCount.value : 0;
        var band = (count > 0 && w.material.uniforms.u_EdgeParams)
          ? w.material.uniforms.u_EdgeParams.value[0].x : 0;
        lines.push('  ' + kind + ' on "' + (o && o.getName ? o.getName() : '?') +
          '"  surface Z ' + Math.round(surfZ) + ', layer "' + (w.layerName || '') + '"');
        lines.push('    edges reaching it: ' + count +
          (count > 0 ? '   foam band ' + Math.round(band) + ' units' : '   <-- NO SHORE FOAM'));

        // uploadWaterEdges keeps only the nearest MAX_WATER_EDGES, so rank the qualifying ones
        // the same way here; otherwise the report calls an ignored edge "used".
        var wcx = (o && o.getX ? o.getX() : 0) +
          ((o && o.getWidth && o.getWidth() > 0) ? o.getWidth() * 0.5 : 0);
        var wcy = (o && o.getY ? o.getY() : 0) +
          ((o && o.getHeight && o.getHeight() > 0) ? o.getHeight() * 0.5 : 0);
        var ranked = [];
        for (var ri = 0; ri < state.waterEdges.length; ri++) {
          var re = state.waterEdges[ri], ro = re.object;
          if (!re.enabled || !ro) continue;
          if (objectLayerName(ro) !== w.layerName) continue;
          var rw = (ro.getWidth && ro.getWidth() > 0) ? ro.getWidth() : 0;
          var rh = (ro.getHeight && ro.getHeight() > 0) ? ro.getHeight() : 0;
          if (rw <= 0 || rh <= 0) continue;
          if (!edgeReachesWater(ro, surfZ)) continue;
          var rcx = (ro.getX ? ro.getX() : 0) + rw * 0.5;
          var rcy = (ro.getY ? ro.getY() : 0) + rh * 0.5;
          ranked.push({ e: re, d2: (rcx - wcx) * (rcx - wcx) + (rcy - wcy) * (rcy - wcy) });
        }
        ranked.sort(function (a, b) { return a.d2 - b.d2; });
        var usedSet = [];
        for (var ui = 0; ui < Math.min(ranked.length, MAX_WATER_EDGES); ui++) usedSet.push(ranked[ui].e);

        for (var ei = 0; ei < state.waterEdges.length; ei++) {
          var e = state.waterEdges[ei], eo = e.object;
          if (!eo) continue;
          var eLayer = objectLayerName(eo);
          var ew = (eo.getWidth && eo.getWidth() > 0) ? eo.getWidth() : 0;
          var eh = (eo.getHeight && eo.getHeight() > 0) ? eo.getHeight() : 0;
          var ez = eo.getZ ? eo.getZ() : 0;
          var ed = (eo.getDepth && eo.getDepth() > 0) ? eo.getDepth() : 0;
          var verdict;
          if (!e.enabled) verdict = 'SKIPPED - disabled';
          else if (eLayer !== w.layerName) {
            verdict = 'SKIPPED - on layer "' + eLayer + '", the water is on "' + (w.layerName || '') + '"';
          } else if (ew <= 0 || eh <= 0) verdict = 'SKIPPED - width or height is 0';
          else if (!edgeReachesWater(eo, surfZ)) {
            verdict = 'SKIPPED - spans Z ' + Math.round(ez) + ' to ' + Math.round(ez + ed) +
              ', which does not contain the water surface at Z ' + Math.round(surfZ) +
              '. Make the land taller or move it so the waterline falls inside it.';
          } else if (usedSet.indexOf(e) === -1) {
            verdict = 'SKIPPED - the shader carries only ' + MAX_WATER_EDGES +
              ' edges and ' + MAX_WATER_EDGES + ' others are nearer this water';
          } else verdict = 'used';
          lines.push('    - "' + (eo.getName ? eo.getName() : '?') + '"  x ' +
            Math.round(eo.getX ? eo.getX() : 0) + '..' + Math.round((eo.getX ? eo.getX() : 0) + ew) +
            ', y ' + Math.round(eo.getY ? eo.getY() : 0) + '..' +
            Math.round((eo.getY ? eo.getY() : 0) + eh) + '  ->  ' + verdict);
        }
      }
      for (var lj = 0; lj < lines.length; lj++) console.info(lines[lj]);
    },

    /** One-time console report, emitted once the volume's real dimensions are known. */
    announceOcean: function (state, ocean, width, height) {
      if (state._oceanAnnounced) return;
      if (typeof console === 'undefined' || !console.info) return;
      state._oceanAnnounced = true;

      var tile = ocean.tileSize;
      var report = [
        '[FluidAndWater3D] OceanFFT3D active on "' +
          (ocean.object && ocean.object.getName ? ocean.object.getName() : '?') + '"',
        '  surface mesh : ' + (ocean.mesh ? 'created' : 'MISSING') + ', parent = ' +
          (ocean.mesh && ocean.mesh.parent ? (ocean.mesh.parent.type || 'object') : 'NONE - it cannot render'),
        '  position     : ' + (ocean.mesh
          ? [ocean.mesh.position.x, ocean.mesh.position.y, ocean.mesh.position.z]
              .map(function (v) { return Math.round(v); }).join(', ')
          : '-') + '   size ' + Math.round(width) + ' x ' + Math.round(height),
        '  spectrum     : CPU ' + ocean.resolution + '^2' +
          (ocean.gpu && !ocean.gpu.failed ? ', GPU ' + ocean.gpuResolution + '^2' : ', GPU off') +
          '   tile ' + Math.round(tile),
        '  wave height  : Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units at ' +
          ocean.windSpeed + ' m/s',
        '  wave length  : ' + Math.round(ocean.field && ocean.field.peakWavelength || 0) +
          ' units crest to crest   (' + (ocean.field && ocean.field.peakWavelength > 0
            ? (tile / ocean.field.peakWavelength).toFixed(1) : '?') + ' waves across the body)',
        '  shore edges  : ' + (function () {
          var oo = ocean.object;
          var sz = (oo && oo.getZ ? oo.getZ() : 0) +
            ((oo && oo.getDepth && oo.getDepth() > 0) ? oo.getDepth() : 0);
          var reaching = FluidAndWater3D.countWaterEdgesReaching(state, ocean.layerName, sz);
          var total = state.waterEdges ? state.waterEdges.length : 0;
          if (total === 0) return 'none registered (no shore foam)';
          if (reaching === 0) {
            return '0 of ' + total + ' reach this surface (Z ' + Math.round(sz) +
              ')  <-- no shore foam will appear';
          }
          // The band width is the number that decides whether foam actually reads on screen.
          var span = waterSpanOf(ocean);
          var band = 0;
          for (var ei = 0; ei < state.waterEdges.length; ei++) {
            var ee = state.waterEdges[ei];
            if (!ee.enabled || !ee.object) continue;
            if (objectLayerName(ee.object) !== ocean.layerName) continue;
            if (!edgeReachesWater(ee.object, sz)) continue;
            band = Math.max(band, foamWidthFor(ee, span));
          }
          return reaching + ' of ' + total + ', foam band ' + Math.round(band) + ' units (' +
            (isFinite(span) && span > 0 ? (100 * band / span).toFixed(1) : '?') +
            '% of the water)';
        })(),
        '  field peak   : ' + ocean.field.peakHeight().toFixed(0) + ' units (CPU), source = ' +
          (ocean.gpu && !ocean.gpu.failed ? 'GPU target' : 'CPU data texture') +
          (ocean._gpuMaxAbs !== undefined ? ', GPU max |v| ' + ocean._gpuMaxAbs.toFixed(1) : ''),
        '  mesh scale   : ' + (ocean.mesh
          ? ocean.mesh.scale.x.toFixed(2) + ' x ' + ocean.mesh.scale.y.toFixed(2)
          : '-') + '   geometry built at ' + Math.round(ocean.initialWidth) + ' x ' +
          Math.round(ocean.initialHeight)
      ];

      if (state.waterBodies.length > 0) {
        report.push('  WARNING: ' + state.waterBodies.length + ' WaterBody3D surface(s) are also active');
        report.push('  here. Two water surfaces overlap, and the flat one is probably what you see.');
      }

      // A sea taller than the body it lives in is not a sea. Real wind waves break past a
      // height-to-length ratio near 1/7, and the longest wave a tile can carry is the tile itself.
      var steep = ocean.significantWaveHeight / Math.max(tile, 1);
      if (steep > 0.15) {
        report.push('  WARNING: the waves are far too big for this water body.');
        report.push('    Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units against a tile of ' +
          Math.round(tile) + ' units (' + (steep * 100).toFixed(0) + '% of it). The surface is');
        report.push('    displaced outside the volume, which looks like the water vanishing.');
        report.push('    At Units Per Metre ' + ocean.unitsPerMetre + ' this volume is ' +
          (tile / ocean.unitsPerMetre).toFixed(1) + ' m across, and ' + ocean.windSpeed +
          ' m/s of wind physically means ' +
          (ocean.significantWaveHeight / ocean.unitsPerMetre).toFixed(1) + ' m waves.');
        report.push('    Fix by any one of:');
        report.push('      - enlarging the volume to about ' +
          Math.round(ocean.significantWaveHeight * 20) + ' units, or');
        report.push('      - dropping Wind Speed to about ' +
          Math.max(1, Math.sqrt(0.05 * tile * 9.81 /
            (0.21 * ocean.unitsPerMetre * ocean.waveHeightScale))).toFixed(1) + ' m/s, or');
        report.push('      - setting Wave Height Scale to about ' +
          (0.05 / steep * ocean.waveHeightScale).toFixed(3) + '.');
      }

      console.info(report.join('\n'));
    },

    oceanOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.oceans.find(function (o) { return o.behavior === behavior; }) || null;
    },

    /** Advances the field and pushes it to the GPU. rgb = displacement XYZ, a = Jacobian. */
    updateOceanField: function (ocean, time) {
      if (!ocean || !ocean.field) return;

      // The GPU path renders the surface; the CPU field still runs because buoyancy samples it.
      if (ocean.gpu && !ocean.gpu.failed) {
        var gpuTex = ocean.gpu.update(time, ocean.choppiness);

        // Confirm, once, that the passes actually produced usable numbers. Without this a silent
        // GPU failure is indistinguishable from the water not existing.
        if (gpuTex && !ocean._gpuChecked) {
          ocean._gpuChecked = true;
          var check = ocean.gpu.validateOutput();
          if (check && !check.ok) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[FluidAndWater3D] The GPU wave field is unusable (' + check.reason +
                '). Falling back to the CPU spectrum at ' + ocean.resolution + '^2, which is ' +
                'verified. Set GPU Spectrum Resolution to 0 to skip this check. The ocean will ' +
                'render with less fine detail.');
            }
            ocean.gpu.failed = true;
            gpuTex = null;
          } else if (check && check.ok) {
            ocean._gpuMaxAbs = check.maxAbs;
          }
        }
        if (gpuTex && ocean.material && ocean.material.uniforms) {
          if (ocean.material.uniforms.u_Field.value !== gpuTex) {
            ocean.material.uniforms.u_Field.value = gpuTex;
            ocean.material.uniforms.u_FieldTexel.value = 1.0 / ocean.gpuResolution;
          }
        } else if (!gpuTex && ocean.material && ocean.material.uniforms && ocean.texture) {
          // Fell over mid-frame: hand the shader back the CPU texture.
          ocean.material.uniforms.u_Field.value = ocean.texture;
          ocean.material.uniforms.u_FieldTexel.value = 1.0 / ocean.resolution;
          ocean.gpu = null;
        }
      }

      var field = ocean.field;
      field.evolve(time, 1.0);
      field.computeFoam(ocean.foamBuffer);

      if (!ocean.texData) return;
      var data = ocean.texData;
      var n = field.n;
      for (var i = 0; i < n * n; i++) {
        var o = i * 4;
        data[o] = field.dispX[i];
        data[o + 1] = field.dispY[i];
        data[o + 2] = field.height[i];
        data[o + 3] = ocean.foamBuffer[i];
      }
      if (ocean.texture) ocean.texture.needsUpdate = true;
    },

    stepOcean: function (runtimeScene, object, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;

      var currentLayer = objectLayerName(object);
      if (currentLayer !== ocean.layerName) {
        ocean.layerName = currentLayer;
        if (ocean.mesh && ocean.mesh.parent && ocean.mesh.parent.remove) ocean.mesh.parent.remove(ocean.mesh);
      }
      if (ocean.mesh && !ocean.mesh.parent) {
        var root = getLayerThreeRoot(runtimeScene, ocean.layerName);
        if (root) root.add(ocean.mesh);
      }

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      // The instance's real size only becomes readable after onCreated, so this is the first
      // point at which the field can be built for the volume it actually covers.
      FluidAndWater3D.rebuildOceanForSize(ocean, w, h);

      if (ocean.mesh) {
        ocean.mesh.position.set(objX + w * 0.5, objY + h * 0.5, objZ + d + 0.1);
        if (ocean.initialWidth > 0 && ocean.initialHeight > 0) {
          ocean.mesh.scale.set(w / ocean.initialWidth, h / ocean.initialHeight, 1.0);
        }
        if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_WaterDepth) {
          ocean.material.uniforms.u_WaterDepth.value = d > 0 ? d : 150.0;
        }
        ocean.mesh.visible = true;
      }
      hideVolumeTopFace(object, ocean);

      // Reported last, so the position and scale printed are the ones actually in effect.
      FluidAndWater3D.announceOcean(getSceneState(runtimeScene), ocean, w, h);
    },

    /** Water surface altitude at a world XY, including the wave. Used by Buoyancy3D. */
    getOceanSurfaceZ: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var ocean = behavior ? FluidAndWater3D.oceanOf(runtimeScene, behavior) : state.oceans[0];
      if (!ocean || !ocean.object) return 0.0;
      var obj = ocean.object;
      var baseZ = (obj.getZ ? obj.getZ() : 0) + ((obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0);
      var edge = waterEdgeInfluenceAt(state, x, y, ocean.layerName, baseZ, waterSpanOf(ocean));
      return baseZ + (ocean.field.sampleHeight(x, y) +
        interactionDisplacementAt(ocean, x, y, state.time)) * edge.attenuation;
    },

    getOceanWaveHeightAt: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var ocean = behavior ? FluidAndWater3D.oceanOf(runtimeScene, behavior) : state.oceans[0];
      if (!ocean || !ocean.object) return 0.0;
      var obj = ocean.object;
      var baseZ = (obj.getZ ? obj.getZ() : 0) + ((obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0);
      var edge = waterEdgeInfluenceAt(state, x, y, ocean.layerName, baseZ, waterSpanOf(ocean));
      return (ocean.field.sampleHeight(x, y) +
        interactionDisplacementAt(ocean, x, y, state.time)) * edge.attenuation;
    },

    getSignificantWaveHeight: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? ocean.significantWaveHeight : 0.0;
    },

    setOceanWind: function (runtimeScene, behavior, windSpeed, windDirection) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.windSpeed = windSpeed > 0 ? windSpeed : 0.1;
      if (windDirection !== undefined) ocean.windDirection = windDirection;

      // Rebuilding the spectrum is the expensive part of this extension; it runs only when the
      // wind actually changes, never per frame.
      resolveWavelengthScale(ocean);
      ocean.field.buildSpectrum({
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: Math.max(ocean.tileSize / ocean.resolution * 0.25, 0.5),
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      // The GPU spectrum is uploaded once, so a wind change has to rebuild and re-upload it. This
      // is the one genuinely expensive call in the extension (a full CPU transform at the GPU
      // resolution to measure sigma) — drive it from events on change, never per frame.
      if (ocean.gpu && ocean.gpuField) {
        ocean.gpuField.buildSpectrum({
          windSpeed: ocean.windSpeed,
          windDirection: ocean.windDirection,
          amplitude: 1.0,
          smallWaveCutoff: Math.max(ocean.tileSize / ocean.gpuResolution * 0.25, 0.5),
          unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
          seed: ocean.seed
        });
        ocean.gpuField.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
        ocean.gpu.uploadSpectrum(ocean.gpuField);
      }
    },

    setOceanChoppiness: function (runtimeScene, behavior, chop) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.choppiness = Math.max(0.0, chop);
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_Choppiness) {
        ocean.material.uniforms.u_Choppiness.value = ocean.choppiness;
      }
    },

    disposeOcean: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.oceans.findIndex(function (o) { return o.behavior === behavior; });
      if (idx === -1) return;
      var ocean = state.oceans[idx];
      if (ocean.mesh) {
        if (ocean.mesh.geometry) ocean.mesh.geometry.dispose();
        if (ocean.mesh.material) ocean.mesh.material.dispose();
        if (ocean.mesh.parent) ocean.mesh.parent.remove(ocean.mesh);
      }
      if (ocean.texture && ocean.texture.dispose) ocean.texture.dispose();
      if (ocean.gpu && ocean.gpu.dispose) ocean.gpu.dispose();
      state.oceans.splice(idx, 1);
    },

    /* ========================================================= 5. WaterEdge3D */

    registerWaterEdge: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var edge = {
        object: object,
        behavior: behavior,
        // 0 means "fit to the water body"; the resolved values land on foamWidth/shallowWidth
        // each frame in uploadWaterEdges.
        // Only the AUTHORED values live here. The effective widths are derived per water body
        // at the point of use, so an edge shared by two differently sized waters is correct for
        // both, and an edge crowded out of the nearest-eight upload cannot go stale.
        // Auto-fit is opt-in (set the property to 0); making it the default silently rewidened
        // the shallow tint and the surf in scenes that were already tuned.
        foamWidthOption: options.foamWidth > 0 ? options.foamWidth : 0,
        shallowWidthOption: options.shallowWidth > 0 ? options.shallowWidth : 0,
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        hideSourceObject: options.hideSourceObject !== undefined ? !!options.hideSourceObject : false,
        _hiddenByBehavior: false
      };

      state.waterEdges.push(edge);
      if (state.waterEdges.length > MAX_WATER_EDGES && typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[FluidAndWater3D] ' + state.waterEdges.length + ' WaterEdge3D objects are registered but ' +
          'the water shader carries only ' + MAX_WATER_EDGES + ' at a time. The ' + MAX_WATER_EDGES +
          ' nearest to each water body are used; the rest are ignored this frame. Cover a long ' +
          'coastline with fewer, larger edge volumes rather than many small ones.'
        );
      }
      return edge;
    },

    waterEdgeOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterEdges.find(function (e) { return e.behavior === behavior; }) || null;
    },

    setWaterEdgeEnabled: function (runtimeScene, behavior, enabled) {
      var edge = FluidAndWater3D.waterEdgeOf(runtimeScene, behavior);
      if (edge) edge.enabled = !!enabled;
    },

    stepWaterEdge: function (runtimeScene, object, behavior, hideSourceObject) {
      var edge = FluidAndWater3D.waterEdgeOf(runtimeScene, behavior);
      if (!edge || !object) return;
      edge.hideSourceObject = !!hideSourceObject;
      var root = getRootObject3D(object);
      if (!root) return;
      if (edge.hideSourceObject) {
        root.visible = false;
        edge._hiddenByBehavior = true;
      } else if (edge._hiddenByBehavior) {
        root.visible = true;
        edge._hiddenByBehavior = false;
      }
    },

    disposeWaterEdge: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterEdges.findIndex(function (e) { return e.behavior === behavior; });
      if (idx !== -1) {
        var edge = state.waterEdges[idx];
        if (edge._hiddenByBehavior && edge.object) {
          var root = getRootObject3D(edge.object);
          if (root) root.visible = true;
        }
        state.waterEdges.splice(idx, 1);
      }
    },

    /**
     * Feeds the nearest edge volumes into a water material. The shader carries a fixed eight, so
     * when a scene has more we pick the ones closest to this body rather than the first eight
     * registered — a coastline behind the camera should not crowd out the beach in front of it.
     */
    uploadWaterEdges: function (state, material, centreX, centreY, layerName, waterZ, waterSpan) {
      if (!material || !material.uniforms || !material.uniforms.u_EdgeCount) return;

      var active = [];
      var droppedDisabled = 0, droppedLayer = 0, droppedSize = 0, droppedAbove = 0;
      for (var i = 0; i < state.waterEdges.length; i++) {
        var e = state.waterEdges[i];
        if (!e.enabled || !e.object) { droppedDisabled++; continue; }
        var o = e.object;
        // Water on another layer is rendered by another three.js scene and must not be influenced.
        if (layerName !== undefined && objectLayerName(o) !== layerName) { droppedLayer++; continue; }
        var ow = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
        var oh = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
        if (ow <= 0 || oh <= 0) { droppedSize++; continue; }
        var ox = o.getX ? o.getX() : 0;
        var oy = o.getY ? o.getY() : 0;
        if (!edgeReachesWater(o, waterZ)) { droppedAbove++; continue; }
        var cx = ox + ow * 0.5, cy = oy + oh * 0.5;
        active.push({
          e: e, minX: ox, minY: oy, maxX: ox + ow, maxY: oy + oh,
          d2: (cx - centreX) * (cx - centreX) + (cy - centreY) * (cy - centreY)
        });
      }
      active.sort(function (a, b) { return a.d2 - b.d2; });

      var count = Math.min(active.length, MAX_WATER_EDGES);
      var bounds = material.uniforms.u_EdgeBounds.value;
      var params = material.uniforms.u_EdgeParams.value;
      for (var j = 0; j < count; j++) {
        var a = active[j];
        if (bounds[j] && bounds[j].set) bounds[j].set(a.minX, a.minY, a.maxX, a.maxY);
        if (params[j] && params[j].set) {
          params[j].set(foamWidthFor(a.e, waterSpan), shallowWidthFor(a.e, waterSpan));
        }
      }
      material.uniforms.u_EdgeCount.value = count;

      // Every shore branch in the shader is gated on u_EdgeCount, so an edge that never survives
      // these filters produces no foam, no shallow tint and no attenuation — and says nothing.
      // That silence is what made this hard to diagnose, so name the reason once.
      if (count === 0 && state.waterEdges.length > 0 && !state._edgeDropWarned &&
          state.time > 1.0 && typeof console !== 'undefined' && console.warn) {
        state._edgeDropWarned = true;
        var why = [];
        if (droppedLayer) why.push(droppedLayer + ' on a different layer than the water');
        if (droppedSize) why.push(droppedSize + ' with no width or height');
        if (droppedAbove) why.push(droppedAbove + ' whose Z range does not contain the water ' +
          'surface (Z ' + Math.round(waterZ) + ')');
        if (droppedDisabled) why.push(droppedDisabled + ' disabled');
        console.warn([
          '[FluidAndWater3D] ' + state.waterEdges.length + ' WaterEdge3D object(s) are registered',
          'but none of them reach this water surface, so there is no shore foam.',
          (why.length ? '  Reason: ' + why.join(', ') + '.' : ''),
          '  A WaterEdge3D object must be on the same layer as the water, have a real width and',
          '  height, and its Z range must contain the water surface height - raise the land or',
          '  make it taller so the waterline falls inside it.'
        ].filter(Boolean).join('\n'));
      }
    },

    /** How many registered edges currently reach a water surface. Diagnostics only. */
    countWaterEdgesReaching: function (state, layerName, waterZ) {
      if (!state || !state.waterEdges) return 0;
      var n = 0;
      for (var i = 0; i < state.waterEdges.length; i++) {
        var e = state.waterEdges[i];
        if (!e.enabled || !e.object) continue;
        if (layerName !== undefined && objectLayerName(e.object) !== layerName) continue;
        var w = (e.object.getWidth && e.object.getWidth() > 0) ? e.object.getWidth() : 0;
        var h = (e.object.getHeight && e.object.getHeight() > 0) ? e.object.getHeight() : 0;
        if (w <= 0 || h <= 0) continue;
        if (!edgeReachesWater(e.object, waterZ)) continue;
        n++;
      }
      return Math.min(n, MAX_WATER_EDGES);
    },

    /* ========================================================= 2. Buoyancy3D */

    registerBuoyancy: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var buoy = {
        object: object,
        behavior: behavior,
        physics3D: (options && (options.physics3D || options.physics3DBehaviorName)) || 'Physics3D',
        buoyancyFactor: num(options.buoyancyFactor, 1.0),
        hullProbeCount: options.hullProbeCount || '4-Corners',
        fluidDrag: num(options.fluidDrag, 2.0),
        waveInfluence: num(options.waveInfluence, 0.8),
        stabilityStrength: num(options.stabilityStrength, 0.65),
        stabilityDamping: num(options.stabilityDamping, 1.5),
        maxSubmersionDepth: num(options.maxSubmersionDepth, 2.0),
        targetWaterBody: options.targetWaterBody || '',
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        isFloating: false,
        isSubmerged: false,
        lastForce: 0.0,
        submersionDepth: 0.0,
        hooked: false,
        hook: null
      };

      buoy.hook = {
        doBeforePhysicsStep: function (dt) {
          if (!buoy.enabled) return;
          FluidAndWater3D.stepBuoyancy(runtimeScene, object, behavior, dt, true);
        }
      };

      state.buoyantObjects.push(buoy);
      return buoy;
    },

    buoyancyOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.buoyantObjects.find(function (b) { return b.behavior === behavior; }) || null;
    },

    resetBuoyancyState: function (buoy) {
      if (!buoy) return;
      buoy.isFloating = false;
      buoy.isSubmerged = false;
      buoy.lastForce = 0.0;
      buoy.submersionDepth = 0.0;
    },

    /** True when two GDevelop objects overlap in XY on the same layer. */
    waterVolumeOverlapsXY: function (waterObject, object) {
      if (!waterObject || !object) return false;
      if (objectLayerName(waterObject) !== objectLayerName(object)) return false;

      var ax = waterObject.getX ? waterObject.getX() : 0;
      var ay = waterObject.getY ? waterObject.getY() : 0;
      var aw = (waterObject.getWidth && waterObject.getWidth() > 0) ? waterObject.getWidth() : 0;
      var ah = (waterObject.getHeight && waterObject.getHeight() > 0) ? waterObject.getHeight() : 0;
      var bx = object.getX ? object.getX() : 0;
      var by = object.getY ? object.getY() : 0;
      var bw = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 0;
      var bh = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 0;
      if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
      return bx + bw >= ax && bx <= ax + aw && by + bh >= ay && by <= ay + ah;
    },

    /**
     * Resolves only a water body whose volume actually overlaps this object. A named target is a
     * strict filter: being registered is not enough, and an absent target never falls back to a
     * different water body.
     */
    resolveWaterBodyFor: function (state, buoy, object) {
      if (!state.waterBodies.length) return null;
      for (var i = 0; i < state.waterBodies.length; i++) {
        var wb = state.waterBodies[i];
        var o = wb.object;
        if (!o) continue;
        if (buoy.targetWaterBody &&
            (!(typeof o.getName === 'function') || o.getName() !== buoy.targetWaterBody)) continue;
        if (FluidAndWater3D.waterVolumeOverlapsXY(o, object)) return wb;
      }
      return null;
    },

    /** Ocean equivalent of resolveWaterBodyFor, with the same strict overlap rules. */
    resolveOceanFor: function (state, buoy, object) {
      if (!state.oceans.length) return null;
      for (var i = 0; i < state.oceans.length; i++) {
        var ocean = state.oceans[i];
        var o = ocean.object;
        if (!o) continue;
        if (buoy.targetWaterBody &&
            (!(typeof o.getName === 'function') || o.getName() !== buoy.targetWaterBody)) continue;
        if (FluidAndWater3D.waterVolumeOverlapsXY(o, object)) return ocean;
      }
      return null;
    },

    /** Locates a Physics3D behavior on the object regardless of the name it was given in the editor. */
    findPhysics3D: function (object, preferredName) {
      if (!object || typeof object.getBehavior !== 'function') return null;
      if (preferredName) {
        var pb = object.getBehavior(preferredName);
        if (pb && (typeof pb.applyImpulse === 'function' || typeof pb.applyForce === 'function')) return pb;
      }
      var named = ['Physics3D', '3DPhysics', 'Physics3DBehavior'];
      for (var i = 0; i < named.length; i++) {
        var b = object.getBehavior(named[i]);
        if (b && (typeof b.applyImpulse === 'function' || typeof b.applyForce === 'function')) return b;
      }
      // Renamed behavior: scan the instance's behavior table for the Physics3D surface.
      var table = object._behaviors;
      if (Array.isArray(table)) {
        for (var j = 0; j < table.length; j++) {
          var cand = table[j];
          if (cand && (typeof cand.applyImpulse === 'function' || typeof cand.applyForce === 'function') && typeof cand.getMass === 'function') {
            return cand;
          }
        }
      }
      return null;
    },

    /**
     * Rotates a 3D vector by a quaternion q = (x, y, z, w).
     */
    rotateVec3ByQuat: function (v, q) {
      var vx = v.x !== undefined ? v.x : (v.rx !== undefined ? v.rx : 0);
      var vy = v.y !== undefined ? v.y : (v.ry !== undefined ? v.ry : 0);
      var vz = v.z !== undefined ? v.z : (v.rz !== undefined ? v.rz : 0);
      var qx = q.x || 0, qy = q.y || 0, qz = q.z || 0, qw = q.w !== undefined ? q.w : 1;
      var tx = 2 * (qy * vz - qz * vy);
      var ty = 2 * (qz * vx - qx * vz);
      var tz = 2 * (qx * vy - qy * vx);
      return {
        x: vx + qw * tx + (qy * tz - qz * ty),
        y: vy + qw * ty + (qz * tx - qx * tz),
        z: vz + qw * tz + (qx * ty - qy * tx)
      };
    },

    /**
     * Builds local probe offsets centered at hull bottom.
     */
    getHullProbes: function (width, height, depth, countMode) {
      var probes = [];
      var kz = -depth * 0.5;
      if (countMode === '1-Center') {
        probes.push({ rx: 0, ry: 0, rz: kz });
      } else if (countMode === '8-HullBox') {
        var hx8 = width * 0.45, hy8 = height * 0.45;
        probes.push(
          { rx: -hx8, ry: -hy8, rz: kz }, { rx: hx8, ry: -hy8, rz: kz },
          { rx: hx8, ry:  hy8, rz: kz }, { rx: -hx8, ry:  hy8, rz: kz },
          { rx: 0,    ry: -hy8, rz: kz }, { rx: 0,    ry:  hy8, rz: kz },
          { rx: -hx8, ry: 0,    rz: kz }, { rx: hx8, ry: 0,    rz: kz }
        );
      } else {
        var hx4 = width * 0.4, hy4 = height * 0.4;
        probes.push(
          { rx: -hx4, ry: -hy4, rz: kz },
          { rx:  hx4, ry: -hy4, rz: kz },
          { rx:  hx4, ry:  hy4, rz: kz },
          { rx: -hx4, ry:  hy4, rz: kz }
        );
      }
      return probes;
    },

    /**
     * Calculates a per-probe vertical force pair that rights roll/pitch while preserving yaw.
     * Applying the values at the existing hull probes works with the public Physics3D/Jolt force
     * API, so no private Jolt body or applyTorque method is required.
     */
    getHullRightingForces: function (probes, q, mass, worldScale, angX, angY, waterNormal, buoy) {
      var result = new Array(probes.length).fill(0.0);
      var strength = clamp(num(buoy.stabilityStrength, 0.65), 0.0, 4.0);
      var damping = clamp(num(buoy.stabilityDamping, 1.5), 0.0, 10.0);
      if (strength <= 0.0 || mass <= 0.0 || probes.length < 2) return result;

      var currentUp = FluidAndWater3D.rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, q);
      var follow = clamp(num(buoy.waveInfluence, 0.8), 0.0, 1.0);
      var normal = waterNormal || { x: 0, y: 0, z: 1 };
      var dx = normal.x * follow;
      var dy = normal.y * follow;
      var dz = lerp(1.0, normal.z, follow);
      var dLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
      dx /= dLen; dy /= dLen; dz /= dLen;

      // cross(currentUp, desiredUp) is the shortest restoring rotation in world space.
      var errX = currentUp.y * dz - currentUp.z * dy;
      var errY = currentUp.z * dx - currentUp.x * dz;
      var scale = worldScale > 0 ? worldScale : 100.0;
      var rotated = [];
      var meanX = 0.0, meanY = 0.0;
      for (var i = 0; i < probes.length; i++) {
        var r = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var rx = r.x / scale, ry = r.y / scale;
        rotated.push({ x: rx, y: ry });
        meanX += rx;
        meanY += ry;
      }
      meanX /= probes.length;
      meanY /= probes.length;
      var sumX2 = 0.0, sumY2 = 0.0;
      for (var ri = 0; ri < rotated.length; ri++) {
        // The force pair must be centered on the probe footprint. A tilted hull's bottom plane is
        // horizontally offset from its centre; using that common offset would add unwanted lift.
        rotated[ri].x -= meanX;
        rotated[ri].y -= meanY;
        sumX2 += rotated[ri].x * rotated[ri].x;
        sumY2 += rotated[ri].y * rotated[ri].y;
      }
      var lever = Math.sqrt((sumX2 + sumY2) / Math.max(probes.length, 1));
      if (lever < 0.001) return result;

      var torqueScale = mass * GRAVITY * lever * strength;
      var inertiaScale = mass * lever * lever * damping;
      var torqueX = torqueScale * errX - inertiaScale * angX;
      var torqueY = torqueScale * errY - inertiaScale * angY;
      var maxPerProbe = mass * GRAVITY * (0.75 + strength) / probes.length;
      for (var j = 0; j < rotated.length; j++) {
        var fz = 0.0;
        if (sumY2 > 0.000001) fz += torqueX * rotated[j].y / sumY2;
        if (sumX2 > 0.000001) fz -= torqueY * rotated[j].x / sumX2;
        result[j] = clamp(fz, -maxPerProbe, maxPerProbe);
      }
      return result;
    },

    stepBuoyancy: function (runtimeScene, object, behavior, stepDt, fromPhysicsHook) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      if (!buoy) return;
      if (!buoy.enabled) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var phys3d = FluidAndWater3D.findPhysics3D(object, buoy.physics3D);
      // Guarded: a Physics3D build without the hook API must fall through to the per-frame path
      // rather than throwing and taking the whole behavior down.
      if (phys3d && phys3d._sharedData &&
          typeof phys3d._sharedData.registerHook === 'function' && !buoy.hooked) {
        phys3d._sharedData.registerHook(buoy.hook);
        buoy.hooked = true;
      }

      // When Physics3D is active and has registered the hook with Jolt, skip regular doStepPreEvents
      // so physical forces are evaluated directly inside Jolt's doBeforePhysicsStep pre-step.
      if (phys3d && buoy.hooked && !fromPhysicsHook) {
        return;
      }

      var state = getSceneState(runtimeScene);

      // An overlapping OceanFFT3D body takes precedence. A distant ocean must not hijack a
      // nearby WaterBody3D (or keep an object floating in empty space).
      var ocean = FluidAndWater3D.resolveOceanFor(state, buoy, object);
      if (ocean) {
        FluidAndWater3D.stepBuoyancyOnOcean(runtimeScene, object, behavior, buoy, state, stepDt, ocean);
        return;
      }

      var waterBody = FluidAndWater3D.resolveWaterBodyFor(state, buoy, object);
      if (!waterBody || !waterBody.object) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var dt = (stepDt !== undefined && stepDt > 0) ? stepDt : (getDeltaSeconds(runtimeScene) * state.timeScale);
      if (state.paused || dt <= 0) return;

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 50;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 50;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 50;

      var cx = objX + width * 0.5;
      var cy = objY + height * 0.5;
      var cz = objZ + depth * 0.5;

      var wbObj = waterBody.object;
      var waterBottomZ = wbObj.getZ ? wbObj.getZ() : 0.0;
      var waterTopZ = (wbObj.getZ ? wbObj.getZ() : 0.0) +
        ((wbObj.getDepth && wbObj.getDepth() > 0) ? wbObj.getDepth() : 0.0);

      // Buoyancy is a water-volume effect, not an infinite column below the surface.
      if (objZ + depth <= waterBottomZ) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var waveCfg = waveConfigOf(waterBody, waterTopZ);
      var probes = FluidAndWater3D.getHullProbes(width, height, depth, buoy.hullProbeCount);
      var probeCount = probes.length;
      var maxSub = buoy.maxSubmersionDepth > 0 ? buoy.maxSubmersionDepth : Math.max(depth, 1.0);

      var phys3d = FluidAndWater3D.findPhysics3D(object);
      var mass = 0.0;
      if (phys3d && typeof phys3d.getMass === 'function') {
        try { mass = phys3d.getMass() || 0.0; } catch (e) { mass = 0.0; }
      }

      var velX = 0.0, velY = 0.0, velZ = 0.0;
      if (phys3d && typeof phys3d.getLinearVelocityZ === 'function') {
        try {
          velX = phys3d.getLinearVelocityX();
          velY = phys3d.getLinearVelocityY();
          velZ = phys3d.getLinearVelocityZ();
        } catch (e) {}
      }

      var angX = 0.0, angY = 0.0, angZ = 0.0;
      if (phys3d && typeof phys3d.getAngularVelocityZ === 'function') {
        try {
          angX = (phys3d.getAngularVelocityX() || 0.0) * (Math.PI / 180);
          angY = (phys3d.getAngularVelocityY() || 0.0) * (Math.PI / 180);
          angZ = (phys3d.getAngularVelocityZ() || 0.0) * (Math.PI / 180);
        } catch (e) {}
      }

      // Physics3D reports linear velocity in SCENE UNITS per second (it multiplies Jolt's m/s by
      // worldScale), while mass is in kilograms. Feeding px/s straight into a kg-based drag term
      // gives a force worldScale times too large — at the default 100 px/m that dwarfed buoyancy
      // and launched hulls out of the scene. Convert to m/s before the drag coefficient sees it.
      var worldScale = 100.0;
      if (phys3d && phys3d._sharedData && phys3d._sharedData.worldScale > 0) {
        worldScale = phys3d._sharedData.worldScale;
      }
      var invWorldScale = 1.0 / worldScale;

      var q = { x: 0, y: 0, z: 0, w: 1 };
      if (object.get3DRendererObject && object.get3DRendererObject()) {
        var rObj = object.get3DRendererObject();
        if (rObj.quaternion) {
          q.x = rObj.quaternion.x;
          q.y = rObj.quaternion.y;
          q.z = rObj.quaternion.z;
          q.w = rObj.quaternion.w;
        }
      }

      var waterNormal = evaluateGerstnerNormal(cx, cy, state.time, waveCfg);
      var rightingForces = FluidAndWater3D.getHullRightingForces(
        probes, q, mass, worldScale, angX, angY, waterNormal, buoy);

      var totalSubmersion = 0.0;
      var submergedProbes = 0;
      var sumSurfZ = 0.0;

      for (var i = 0; i < probeCount; i++) {
        var rWorld = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var px = cx + rWorld.x;
        var py = cy + rWorld.y;
        var pz = cz + rWorld.z;

        var shore = waterEdgeInfluenceAt(state, px, py, waterBody.layerName, waterTopZ,
          waterSpanOf(waterBody));
        var surfZ = waterTopZ +
          (evaluateGerstnerDisplacement(px, py, state.time, waveCfg) +
            interactionDisplacementAt(waterBody, px, py, state.time)) * shore.attenuation;
        sumSurfZ += surfZ;

        var sub = clamp(surfZ - pz, 0.0, maxSub);
        if (sub > 0.0) {
          totalSubmersion += sub;
          submergedProbes++;
        }

        if (phys3d && mass > 0.0 && sub > 0.0) {
          var frac = sub / maxSub;
          var fUp = (mass * GRAVITY * buoy.buoyancyFactor * frac) / probeCount;

          // Point velocity including rigid body angular rotation
          var rotVx = angY * rWorld.z - angZ * rWorld.y;
          var rotVy = angZ * rWorld.x - angX * rWorld.z;
          var rotVz = angX * rWorld.y - angY * rWorld.x;

          var ptVx = velX + rotVx;
          var ptVy = velY + rotVy;
          var ptVz = velZ + rotVz;

          var waveVel = evaluateWaveVelocity(px, py, state.time, waveCfg);
          waveVel.x *= shore.attenuation;
          waveVel.y *= shore.attenuation;
          waveVel.z *= shore.attenuation;
          // Scene units per second -> metres per second, so kg-based drag yields Newtons.
          var rvx = (ptVx - waveVel.x * buoy.waveInfluence) * invWorldScale;
          var rvy = (ptVy - waveVel.y * buoy.waveInfluence) * invWorldScale;
          var rvz = (ptVz - waveVel.z * buoy.waveInfluence) * invWorldScale;

          var dragK = (buoy.fluidDrag * mass * frac) / probeCount;
          var fdx = -dragK * rvx;
          var fdy = -dragK * rvy;
          var fdz = -dragK * rvz;

          var totalFx = fdx;
          var totalFy = fdy;
          // Fade righting torque in with contact so a grazing probe cannot violently snap a hull.
          var totalFz = fUp + fdz + rightingForces[i] * clamp(frac * 2.0, 0.0, 1.0);

          if (typeof phys3d.applyForce === 'function') {
            phys3d.applyForce(totalFx, totalFy, totalFz, px, py, pz);
          } else {
            phys3d.applyImpulse(totalFx * dt, totalFy * dt, totalFz * dt, px, py, pz);
          }
        }
      }

      if (submergedProbes === 0) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      buoy.submersionDepth = totalSubmersion / probeCount;
      buoy.isFloating = true;
      buoy.isSubmerged = submergedProbes === probeCount && (sumSurfZ / probeCount) >= (objZ + depth);
      buoy.lastForce = (mass > 0.0 ? mass : 1.0) * GRAVITY * buoy.buoyancyFactor *
        clamp(buoy.submersionDepth / maxSub, 0.0, 1.0);

      if (phys3d && mass > 0.0) return;

      // Kinematic fallback
      if (!object.setZ) return;
      var targetZ = (sumSurfZ / probeCount) - depth * 0.3;
      var blend = clamp(0.15 * buoy.waveInfluence * (dt / 0.016), 0.0, 1.0);
      object.setZ(lerp(object.getZ(), targetZ, blend));

      if (object.setRotationX && object.setRotationY) {
        var normal = waterNormal;
        var pitchDeg = (-normal.y * 35.0) * buoy.waveInfluence;
        var rollDeg = (normal.x * 35.0) * buoy.waveInfluence;
        var rotBlend = clamp((0.04 + 0.08 * buoy.stabilityStrength +
          0.02 * buoy.stabilityDamping) * (dt / 0.016), 0.0, 1.0);
        object.setRotationX(lerp(object.getRotationX ? object.getRotationX() : 0.0, pitchDeg, rotBlend));
        object.setRotationY(lerp(object.getRotationY ? object.getRotationY() : 0.0, rollDeg, rotBlend));
      }
    },

    /** Buoyancy against a Tessendorf field with full Jolt 3D orientation & angular point velocity. */
    stepBuoyancyOnOcean: function (runtimeScene, object, behavior, buoy, state, stepDt, selectedOcean) {
      var dt = (stepDt !== undefined && stepDt > 0) ? stepDt : (getDeltaSeconds(runtimeScene) * state.timeScale);
      if (state.paused || dt <= 0) return;

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 50;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 50;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 50;

      var cx = objX + width * 0.5;
      var cy = objY + height * 0.5;
      var cz = objZ + depth * 0.5;

      var ocean = selectedOcean || FluidAndWater3D.resolveOceanFor(state, buoy, object);
      if (!ocean || !ocean.object) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var probes = FluidAndWater3D.getHullProbes(width, height, depth, buoy.hullProbeCount);
      var probeCount = probes.length;

      var oo = ocean.object;
      var waterBottomZ = oo.getZ ? oo.getZ() : 0;
      var waterTopZ = (oo.getZ ? oo.getZ() : 0) + ((oo.getDepth && oo.getDepth() > 0) ? oo.getDepth() : 0);
      if (objZ + depth <= waterBottomZ) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }
      var maxSub = buoy.maxSubmersionDepth > 0 ? buoy.maxSubmersionDepth : Math.max(depth, 1.0);

      var phys3d = FluidAndWater3D.findPhysics3D(object, buoy.physics3D);
      var mass = 0.0;
      if (phys3d && typeof phys3d.getMass === 'function') {
        try { mass = phys3d.getMass() || 0.0; } catch (e) { mass = 0.0; }
      }
      var velX = 0.0, velY = 0.0, velZ = 0.0;
      if (phys3d && typeof phys3d.getLinearVelocityZ === 'function') {
        try {
          velX = phys3d.getLinearVelocityX();
          velY = phys3d.getLinearVelocityY();
          velZ = phys3d.getLinearVelocityZ();
        } catch (e) {}
      }
      var angX = 0.0, angY = 0.0, angZ = 0.0;
      if (phys3d && typeof phys3d.getAngularVelocityZ === 'function') {
        try {
          angX = (phys3d.getAngularVelocityX() || 0.0) * (Math.PI / 180);
          angY = (phys3d.getAngularVelocityY() || 0.0) * (Math.PI / 180);
          angZ = (phys3d.getAngularVelocityZ() || 0.0) * (Math.PI / 180);
        } catch (e) {}
      }

      // Physics3D reports linear velocity in SCENE UNITS per second (it multiplies Jolt's m/s by
      // worldScale), while mass is in kilograms. Feeding px/s straight into a kg-based drag term
      // gives a force worldScale times too large — at the default 100 px/m that dwarfed buoyancy
      // and launched hulls out of the scene. Convert to m/s before the drag coefficient sees it.
      var worldScale = 100.0;
      if (phys3d && phys3d._sharedData && phys3d._sharedData.worldScale > 0) {
        worldScale = phys3d._sharedData.worldScale;
      }
      var invWorldScale = 1.0 / worldScale;

      var q = { x: 0, y: 0, z: 0, w: 1 };
      if (object.get3DRendererObject && object.get3DRendererObject()) {
        var rObj = object.get3DRendererObject();
        if (rObj.quaternion) {
          q.x = rObj.quaternion.x;
          q.y = rObj.quaternion.y;
          q.z = rObj.quaternion.z;
          q.w = rObj.quaternion.w;
        }
      }

      var normalSample = Math.max(width, height) * 0.25;
      var normalHx = FluidAndWater3D.getOceanWaveHeightAt(runtimeScene, ocean.behavior,
        cx + normalSample, cy) - FluidAndWater3D.getOceanWaveHeightAt(runtimeScene,
        ocean.behavior, cx - normalSample, cy);
      var normalHy = FluidAndWater3D.getOceanWaveHeightAt(runtimeScene, ocean.behavior,
        cx, cy + normalSample) - FluidAndWater3D.getOceanWaveHeightAt(runtimeScene,
        ocean.behavior, cx, cy - normalSample);
      var waterNormal = {
        x: -normalHx / (2 * normalSample),
        y: -normalHy / (2 * normalSample),
        z: 1.0
      };
      var normalLen = Math.sqrt(waterNormal.x * waterNormal.x + waterNormal.y * waterNormal.y + 1.0);
      waterNormal.x /= normalLen; waterNormal.y /= normalLen; waterNormal.z /= normalLen;
      var rightingForces = FluidAndWater3D.getHullRightingForces(
        probes, q, mass, worldScale, angX, angY, waterNormal, buoy);

      var totalSubmersion = 0.0, submergedProbes = 0, sumSurfZ = 0.0;

      for (var i = 0; i < probeCount; i++) {
        var rWorld = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var px = cx + rWorld.x;
        var py = cy + rWorld.y;
        var pz = cz + rWorld.z;

        var shore = waterEdgeInfluenceAt(state, px, py, ocean.layerName, waterTopZ,
          waterSpanOf(ocean));
        var surfZ = waterTopZ + (ocean.field.sampleHeight(px, py) +
          interactionDisplacementAt(ocean, px, py, state.time)) * shore.attenuation;
        sumSurfZ += surfZ;

        var sub = clamp(surfZ - pz, 0.0, maxSub);
        if (sub > 0.0) { totalSubmersion += sub; submergedProbes++; }

        if (phys3d && mass > 0.0 && sub > 0.0) {
          var frac = sub / maxSub;
          var fUp = (mass * GRAVITY * buoy.buoyancyFactor * frac) / probeCount;

          var rotVx = angY * rWorld.z - angZ * rWorld.y;
          var rotVy = angZ * rWorld.x - angX * rWorld.z;
          var rotVz = angX * rWorld.y - angY * rWorld.x;

          var ptVx = velX + rotVx;
          var ptVy = velY + rotVy;
          var ptVz = velZ + rotVz;

          var dragK = (buoy.fluidDrag * mass * frac) / probeCount;
          // Scene units per second -> metres per second, as above.
          var fdx = -dragK * ptVx * invWorldScale;
          var fdy = -dragK * ptVy * invWorldScale;
          var fdz = -dragK * ptVz * invWorldScale;

          var totalFx = fdx;
          var totalFy = fdy;
          var totalFz = fUp + fdz + rightingForces[i] * clamp(frac * 2.0, 0.0, 1.0);

          if (typeof phys3d.applyForce === 'function') {
            phys3d.applyForce(totalFx, totalFy, totalFz, px, py, pz);
          } else {
            phys3d.applyImpulse(totalFx * dt, totalFy * dt, totalFz * dt, px, py, pz);
          }
        }
      }

      if (submergedProbes === 0) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      buoy.submersionDepth = totalSubmersion / probeCount;
      buoy.isFloating = true;
      buoy.isSubmerged = submergedProbes === probeCount && (sumSurfZ / probeCount) >= (objZ + depth);
      buoy.lastForce = (mass > 0.0 ? mass : 1.0) * GRAVITY * buoy.buoyancyFactor *
        clamp(buoy.submersionDepth / maxSub, 0.0, 1.0);

      if (phys3d && mass > 0.0) return;
      if (!object.setZ) return;

      var targetZ = (sumSurfZ / probeCount) - depth * 0.3;
      var blend = clamp(0.15 * buoy.waveInfluence * (dt / 0.016), 0.0, 1.0);
      object.setZ(lerp(object.getZ(), targetZ, blend));

      if (object.setRotationX && object.setRotationY) {
        var s = normalSample;
        var hx = normalHx;
        var hy = normalHy;
        var rotBlend = clamp((0.04 + 0.08 * buoy.stabilityStrength +
          0.02 * buoy.stabilityDamping) * (dt / 0.016), 0.0, 1.0);
        object.setRotationX(lerp(object.getRotationX ? object.getRotationX() : 0,
          -Math.atan2(hy, 2 * s) * 180 / Math.PI * buoy.waveInfluence, rotBlend));
        object.setRotationY(lerp(object.getRotationY ? object.getRotationY() : 0,
          Math.atan2(hx, 2 * s) * 180 / Math.PI * buoy.waveInfluence, rotBlend));
      }
    },

    disposeBuoyancy: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.buoyantObjects.findIndex(function (b) { return b.behavior === behavior; });
      if (idx !== -1) {
        var buoy = state.buoyantObjects[idx];
        if (buoy && buoy.hooked && buoy.object) {
          var phys3d = FluidAndWater3D.findPhysics3D(buoy.object, buoy.physics3D);
          if (phys3d && phys3d._sharedData && Array.isArray(phys3d._sharedData._physics3DHooks)) {
            var hIdx = phys3d._sharedData._physics3DHooks.indexOf(buoy.hook);
            if (hIdx !== -1) phys3d._sharedData._physics3DHooks.splice(hIdx, 1);
          }
        }
        state.buoyantObjects.splice(idx, 1);
      }
    },

    isFloating: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.isFloating : false;
    },

    isSubmerged: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.isSubmerged : false;
    },

    getBuoyancyForce: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.lastForce : 0.0;
    },

    /* ========================================================= 3. PourableLiquid3D */

    registerPourableLiquid: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var presetName = options.fluidPreset || 'MagicPotion';
      var preset = FLUID_PRESETS[presetName] || FLUID_PRESETS.Custom;
      var col = parseColor(options.liquidColor, preset.color);

      var liquid = {
        object: object,
        behavior: behavior,
        // Stable id so emitted droplets can be attributed back to their emitter and so a droplet
        // never fills the very container that poured it.
        ownerId: state.nextOwnerId++,
        fluidPreset: presetName,
        maxDroplets: options.maxDroplets > 0 ? options.maxDroplets : 1500,
        flowRate: options.flowRate !== undefined ? options.flowRate : preset.flowRate,
        pourTiltThreshold: num(options.pourTiltThreshold, 45.0),
        dropletRadius: options.dropletRadius !== undefined ? options.dropletRadius : preset.dropletRadius,
        viscosity: options.viscosity !== undefined ? options.viscosity : preset.viscosity,
        surfaceTension: options.surfaceTension !== undefined ? options.surfaceTension : preset.surfaceTension,
        restDensity: options.restDensity !== undefined ? options.restDensity : preset.restDensity,
        liquidColor: [col[0] / 255, col[1] / 255, col[2] / 255],
        liquidOpacity: options.liquidOpacity !== undefined ? options.liquidOpacity : preset.opacity,
        liquidRoughness: options.liquidRoughness !== undefined ? options.liquidRoughness : preset.roughness,
        containerCapacity: num(options.containerCapacity, 1.0),
        currentVolume: 0.0,
        isPouring: false,
        autoPourOnTilt: options.autoPourOnTilt !== undefined ? !!options.autoPourOnTilt : true,
        emitAccumulator: 0.0
      };

      // The shared droplet mesh lives on the first registered emitter's layer.
      if (state.particleLayerName === null) state.particleLayerName = objectLayerName(object);

      state.pourableObjects.push(liquid);
      return liquid;
    },

    pourableOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.pourableObjects.find(function (p) { return p.behavior === behavior; }) || null;
    },

    setFluidPreset: function (runtimeScene, behavior, presetName) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;

      var preset = FLUID_PRESETS[presetName] || FLUID_PRESETS.Custom;
      liquid.fluidPreset = presetName;
      liquid.viscosity = preset.viscosity;
      liquid.surfaceTension = preset.surfaceTension;
      liquid.restDensity = preset.restDensity;
      liquid.liquidOpacity = preset.opacity;
      liquid.liquidRoughness = preset.roughness;
      liquid.dropletRadius = preset.dropletRadius;
      liquid.flowRate = preset.flowRate;
      liquid.liquidColor = [preset.color[0] / 255, preset.color[1] / 255, preset.color[2] / 255];
    },

    startPouring: function (runtimeScene, behavior, flowRate) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;
      liquid.isPouring = true;
      if (flowRate !== undefined && flowRate > 0) liquid.flowRate = flowRate;
    },

    stopPouring: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;
      liquid.isPouring = false;
    },

    stepPourableLiquid: function (runtimeScene, object, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;

      var state = getSceneState(runtimeScene);
      if (state.paused) return;
      var dt = getDeltaSeconds(runtimeScene) * state.timeScale;
      if (dt <= 0) return;

      var pitch = object.getRotationX ? object.getRotationX() : 0.0;
      var roll = object.getRotationY ? object.getRotationY() : 0.0;

      if (liquid.autoPourOnTilt) {
        var tilt = Math.sqrt(pitch * pitch + roll * roll);
        liquid.isPouring = tilt >= liquid.pourTiltThreshold;
      }

      if (!liquid.isPouring || liquid.flowRate <= 0) return;

      // Draining a container that has something in it consumes what it holds.
      if (liquid.currentVolume > 0) {
        liquid.currentVolume = Math.max(
          0.0,
          liquid.currentVolume - liquid.flowRate * dt * dropletVolumeLitres(liquid.dropletRadius)
        );
      }

      if (state.sphSolver.countOwnedBy(liquid.ownerId) >= liquid.maxDroplets) return;

      liquid.emitAccumulator += liquid.flowRate * dt;
      var toEmit = Math.floor(liquid.emitAccumulator);
      if (toEmit <= 0) return;
      liquid.emitAccumulator -= toEmit;

      // Emit from the spout: the centre of the object's top face, not its min corner.
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 0;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 0;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;
      var spoutX = (object.getX ? object.getX() : 0) + w * 0.5;
      var spoutY = (object.getY ? object.getY() : 0) + h * 0.5;
      var spoutZ = (object.getZ ? object.getZ() : 0) + d;

      // Tilting the vessel throws the stream out over the lip in the direction it leans.
      var pitchRad = pitch * Math.PI / 180.0;
      var rollRad = roll * Math.PI / 180.0;
      var lipX = Math.sin(rollRad) * w * 0.5;
      var lipY = -Math.sin(pitchRad) * h * 0.5;
      spoutX += lipX;
      spoutY += lipY;

      var props = {
        viscosity: liquid.viscosity,
        surfaceTension: liquid.surfaceTension,
        restDensity: liquid.restDensity,
        radius: liquid.dropletRadius,
        color: liquid.liquidColor,
        owner: liquid.ownerId
      };

      var outSpeed = 0.4;
      for (var e = 0; e < toEmit; e++) {
        var spreadX = (Math.random() - 0.5) * 0.02;
        var spreadY = (Math.random() - 0.5) * 0.02;
        state.sphSolver.emit(
          spoutX * SPH_WORLD_SCALE + spreadX,
          spoutY * SPH_WORLD_SCALE + spreadY,
          spoutZ * SPH_WORLD_SCALE,
          Math.sin(rollRad) * outSpeed + spreadX * 4.0,
          -Math.sin(pitchRad) * outSpeed + spreadY * 4.0,
          -0.4,
          10.0,
          props
        );
      }
    },

    disposePourableLiquid: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.pourableObjects.findIndex(function (p) { return p.behavior === behavior; });
      if (idx !== -1) state.pourableObjects.splice(idx, 1);
    },

    getFillLevelPercent: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid || liquid.containerCapacity <= 0) return 0.0;
      return clamp((liquid.currentVolume / liquid.containerCapacity) * 100.0, 0.0, 100.0);
    },

    getCurrentLiquidVolume: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      return liquid ? liquid.currentVolume : 0.0;
    },

    /** Droplets currently alive that were poured by THIS emitter (not the scene-wide total). */
    getActiveDropletCount: function (runtimeScene, behavior) {
      var state = getSceneState(runtimeScene);
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return state.sphSolver.getActiveCount();
      return state.sphSolver.countOwnedBy(liquid.ownerId);
    },

    emptyContainer: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (liquid) liquid.currentVolume = 0.0;
    },

    clearAllDroplets: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      state.sphSolver.clearAll();
    },

    /** Adds one deterministic expanding ripple to a water holder's fixed-size event queue. */
    emitBodyInteraction: function (holder, x, y, strength, time) {
      if (!holder || !holder.enableBodyInteractions || !(strength > 0)) return;
      if (!holder.interactions) holder.interactions = [];
      holder.interactions.push({
        x: x, y: y, time: time,
        strength: Math.min(strength, holder.interactionStrength),
        radius: Math.max(holder.interactionRadius, 1.0),
        life: Math.max(holder.interactionLifetime || 1.6, 0.1)
      });
      // Keep a few events beyond the shader capacity so an expiring ring cannot make a new one
      // displace an otherwise still-visible recent ring during the same frame.
      if (holder.interactions.length > MAX_WATER_INTERACTIONS + 8) holder.interactions.shift();
    },

    /** Uploads the newest live ripples into the arrays shared by the Gerstner and FFT shaders. */
    uploadBodyInteractions: function (holder, time) {
      if (!holder || !holder.material || !holder.material.uniforms) return;
      var u = holder.material.uniforms;
      if (!u.u_InteractionCount || !u.u_Interactions || !u.u_InteractionParams) return;
      var events = holder.interactions || [];
      for (var p = events.length - 1; p >= 0; p--) {
        if (time - events[p].time >= events[p].life) events.splice(p, 1);
      }
      var count = Math.min(events.length, MAX_WATER_INTERACTIONS);
      var start = events.length - count;
      for (var i = 0; i < count; i++) {
        var e = events[start + i];
        u.u_Interactions.value[i].set(e.x, e.y, e.time, e.strength);
        u.u_InteractionParams.value[i].set(e.radius, e.life, 0, 0);
      }
      u.u_InteractionCount.value = count;
    },

    /**
     * Detects moving Physics3D/Jolt bodies overlapping either kind of water volume. The water is a
     * visual/physical volume sensor, not a Jolt collider, so players do not bounce off an invisible
     * surface and no collision callback or Buoyancy3D behavior is required.
     */
    detectBodyInteractions: function (runtimeScene, state, dt) {
      if (!runtimeScene || typeof runtimeScene.getAdhocListOfAllInstances !== 'function') return;
      var objects = runtimeScene.getAdhocListOfAllInstances();
      if (!objects || objects.length === 0) return;
      var holders = state.waterBodies.concat(state.oceans);

      for (var h = 0; h < holders.length; h++) {
        var holder = holders[h];
        var water = holder.object;
        if (!holder.enableBodyInteractions || !water) continue;

        var wx = water.getX ? water.getX() : 0;
        var wy = water.getY ? water.getY() : 0;
        var wz = water.getZ ? water.getZ() : 0;
        var ww = (water.getWidth && water.getWidth() > 0) ? water.getWidth() : 0;
        var wh = (water.getHeight && water.getHeight() > 0) ? water.getHeight() : 0;
        var wd = (water.getDepth && water.getDepth() > 0) ? water.getDepth() : 0;
        var baseSurface = wz + wd;
        if (ww <= 0 || wh <= 0) continue;

        for (var i = 0; i < objects.length; i++) {
          var object = objects[i];
          if (!object || object === water || object._isBeingDeleted) continue;
          if (objectLayerName(object) !== holder.layerName) continue;
          var physics = state.physicsBehaviorCache ? state.physicsBehaviorCache.get(object) : null;
          if (!physics) {
            physics = FluidAndWater3D.findPhysics3D(object);
            if (physics && state.physicsBehaviorCache) state.physicsBehaviorCache.set(object, physics);
          }
          if (!physics) continue;

          var ox = object.getX ? object.getX() : 0;
          var oy = object.getY ? object.getY() : 0;
          var oz = object.getZ ? object.getZ() : 0;
          var ow = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1;
          var oh = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1;
          var od = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 1;
          var cx = ox + ow * 0.5;
          var cy = oy + oh * 0.5;
          if (ox + ow < wx || ox > wx + ww || oy + oh < wy || oy > wy + wh) continue;

          var shore = waterEdgeInfluenceAt(state, cx, cy, holder.layerName, baseSurface,
            waterSpanOf(holder));
          if (shore.inside) continue;
          var naturalWave = holder.field
            ? holder.field.sampleHeight(cx, cy) * shore.attenuation
            : evaluateGerstnerDisplacement(cx, cy, state.time, waveConfigOf(holder, 0)) * shore.attenuation;
          var surfaceZ = baseSurface + naturalWave;
          var wet = oz <= surfaceZ && oz + od >= wz - 5.0;
          // Motion well below the surface should not throw a full-strength white splash above it.
          // A body crossing the top has distance 0; a deeply submerged swimmer fades smoothly.
          var depthBelowSurface = Math.max(surfaceZ - (oz + od), 0.0);
          var surfaceInfluence = 1.0 - clamp(
            depthBelowSurface / Math.max(holder.interactionRadius * 0.75, 1.0), 0.0, 1.0
          );

          var track = holder.interactionTracks ? holder.interactionTracks.get(object) : null;
          if (!track) {
            track = { x: cx, y: cy, z: oz + od * 0.5, wet: false, lastEmit: -1e9 };
            if (holder.interactionTracks) holder.interactionTracks.set(object, track);
          }

          var vx = 0, vy = 0, vz = 0;
          try {
            if (typeof physics.getLinearVelocityX === 'function') vx = physics.getLinearVelocityX() || 0;
            if (typeof physics.getLinearVelocityY === 'function') vy = physics.getLinearVelocityY() || 0;
            if (typeof physics.getLinearVelocityZ === 'function') vz = physics.getLinearVelocityZ() || 0;
          } catch (e) { vx = vy = vz = 0; }
          if (dt > 0) {
            var measuredX = (cx - track.x) / dt;
            var measuredY = (cy - track.y) / dt;
            var measuredZ = ((oz + od * 0.5) - track.z) / dt;
            if (Math.abs(measuredX) > Math.abs(vx)) vx = measuredX;
            if (Math.abs(measuredY) > Math.abs(vy)) vy = measuredY;
            if (Math.abs(measuredZ) > Math.abs(vz)) vz = measuredZ;
          }

          var horizontalSpeed = Math.sqrt(vx * vx + vy * vy);
          var speed = Math.sqrt(horizontalSpeed * horizontalSpeed + vz * vz * 0.65);
          var threshold = Math.max(holder.interactionSpeedThreshold, 0.0);
          var entered = wet && !track.wet;
          var cooldown = entered ? 0.0 : 0.12;
          if (wet && surfaceInfluence > 0 && speed >= threshold && state.time - track.lastEmit >= cooldown) {
            var scale = clamp((speed - threshold) / Math.max(threshold * 4.0, 80.0), 0.12, 1.0);
            var verticalBoost = 1.0 + clamp(Math.abs(vz) / Math.max(threshold * 3.0, 120.0), 0.0, 0.6);
            var entryBoost = entered ? 1.35 : 1.0;
            FluidAndWater3D.emitBodyInteraction(
              holder, cx, cy, holder.interactionStrength * scale * verticalBoost * entryBoost * surfaceInfluence, state.time
            );
            track.lastEmit = state.time;
          }

          track.x = cx; track.y = cy; track.z = oz + od * 0.5; track.wet = wet;
        }
      }
    },

    /* ========================================================= 4. Global Scene Tick */

    /**
     * Absorbs droplets that have fallen into another PourableLiquid3D object's volume and raises
     * that object's fill level. Any object carrying the behavior doubles as a container; a droplet
     * never fills the vessel that poured it (`owner` check).
     */
    absorbDropletsIntoContainers: function (state) {
      if (state.pourableObjects.length === 0) return;
      var solver = state.sphSolver;

      // Cache each container's AABB once per frame instead of per droplet.
      var boxes = [];
      for (var c = 0; c < state.pourableObjects.length; c++) {
        var liq = state.pourableObjects[c];
        var o = liq.object;
        if (!o || liq.containerCapacity <= 0) continue;
        if (liq.currentVolume >= liq.containerCapacity) continue;

        var ow = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
        var oh = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
        var od = (o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0;
        if (ow <= 0 || oh <= 0) continue;

        var ox = o.getX ? o.getX() : 0;
        var oy = o.getY ? o.getY() : 0;
        var oz = o.getZ ? o.getZ() : 0;

        boxes.push({
          liquid: liq,
          minX: ox * SPH_WORLD_SCALE,
          maxX: (ox + ow) * SPH_WORLD_SCALE,
          minY: oy * SPH_WORLD_SCALE,
          maxY: (oy + oh) * SPH_WORLD_SCALE,
          minZ: oz * SPH_WORLD_SCALE,
          maxZ: (oz + od) * SPH_WORLD_SCALE
        });
      }
      if (boxes.length === 0) return;

      for (var i = 0; i < solver.particleCount; i++) {
        if (!solver.alive[i]) continue;
        var px = solver.x[i], py = solver.y[i], pz = solver.z[i];
        var owner = solver.owner[i];

        for (var b = 0; b < boxes.length; b++) {
          var box = boxes[b];
          if (box.liquid.ownerId === owner) continue;
          if (px < box.minX || px > box.maxX) continue;
          if (py < box.minY || py > box.maxY) continue;
          if (pz < box.minZ || pz > box.maxZ) continue;

          box.liquid.currentVolume = Math.min(
            box.liquid.containerCapacity,
            box.liquid.currentVolume + dropletVolumeLitres(solver.radius[i])
          );
          solver.kill(i);
          break;
        }
      }
    },

    onScenePostEvents: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      if (state.paused) return;

      // Real frame time, not a hardcoded 60 Hz assumption — otherwise waves and pouring run fast on
      // a 144 Hz display and slow on a 30 Hz one.
      var dt = getDeltaSeconds(runtimeScene) * state.timeScale;
      state.time += dt;

      // Read Jolt/Physics3D motion after object events have run, then feed the same interaction
      // events to both water renderers and CPU surface queries.
      FluidAndWater3D.detectBodyInteractions(runtimeScene, state, dt);

      // 1. Water bodies: keep them parented to their own layer and advance the shader clock.
      for (var i = 0; i < state.waterBodies.length; i++) {
        var body = state.waterBodies[i];

        if (body.mesh && !body.mesh.parent) {
          var bodyRoot = getLayerThreeRoot(runtimeScene, body.layerName);
          if (bodyRoot) bodyRoot.add(body.mesh);
        }

        // `cameraPosition` is fed to every ShaderMaterial by three.js itself; there is nothing to
        // push here beyond the clock.
        if (body.material && body.material.uniforms && body.material.uniforms.u_Time) {
          body.material.uniforms.u_Time.value = state.time;
        }
        if (body.material && body.material.uniforms && body.object) {
          var bObj = body.object;
          var bw = (bObj.getWidth && bObj.getWidth() > 0) ? bObj.getWidth() : 0;
          var bh = (bObj.getHeight && bObj.getHeight() > 0) ? bObj.getHeight() : 0;
          var bd = (bObj.getDepth && bObj.getDepth() > 0) ? bObj.getDepth() : 0;
          var bcx = (bObj.getX ? bObj.getX() : 0) + bw * 0.5;
          var bcy = (bObj.getY ? bObj.getY() : 0) + bh * 0.5;
          var bSurfaceZ = (bObj.getZ ? bObj.getZ() : 0) + bd;
          FluidAndWater3D.uploadWaterEdges(
            state, body.material, bcx, bcy, body.layerName, bSurfaceZ, waterSpanOf(body)
          );
          FluidAndWater3D.uploadBodyInteractions(body, state.time);
        }
      }

      // 1b. Tessendorf oceans: advance the field, refresh the texture, feed in the shore volumes.
      for (var oi = 0; oi < state.oceans.length; oi++) {
        var ocean = state.oceans[oi];
        if (ocean.mesh && !ocean.mesh.parent) {
          var oRoot = getLayerThreeRoot(runtimeScene, ocean.layerName);
          if (oRoot) oRoot.add(ocean.mesh);
        }
        FluidAndWater3D.updateOceanField(ocean, state.time);
        if (ocean.material && ocean.material.uniforms) {
          if (ocean.material.uniforms.u_Time) ocean.material.uniforms.u_Time.value = state.time;
          if (ocean.material.uniforms.u_EdgeMask) {
            ocean.material.uniforms.u_EdgeMask.value = ocean.maskUnderEdges ? 1.0 : 0.0;
          }
          var oObj = ocean.object;
          var ocx = (oObj.getX ? oObj.getX() : 0) + ((oObj.getWidth && oObj.getWidth() > 0) ? oObj.getWidth() * 0.5 : 0);
          var ocy = (oObj.getY ? oObj.getY() : 0) + ((oObj.getHeight && oObj.getHeight() > 0) ? oObj.getHeight() * 0.5 : 0);
          var ocz = (oObj.getZ ? oObj.getZ() : 0) + ((oObj.getDepth && oObj.getDepth() > 0) ? oObj.getDepth() : 0);
          FluidAndWater3D.uploadWaterEdges(
            state, ocean.material, ocx, ocy, ocean.layerName, ocz, waterSpanOf(ocean)
          );
          FluidAndWater3D.uploadBodyInteractions(ocean, state.time);
        }
      }

      FluidAndWater3D.announceShore(state);

      // 2. Step the SPH solver, then let containers catch what fell into them.
      if (state.sphSolver.getActiveCount() > 0) {
        state.sphSolver.step(dt, { floorZ: state.sphFloorZ * SPH_WORLD_SCALE });
        FluidAndWater3D.absorbDropletsIntoContainers(state);
      }

      if (!THREE_OK) return;

      // 3. Droplet instances. Colour and size come from each droplet's own fluid preset.
      var particleRoot = getLayerThreeRoot(runtimeScene, state.particleLayerName || '');
      if (particleRoot) {
        if (!state.particleMesh && typeof THREE.InstancedMesh === 'function' &&
            typeof THREE.SphereGeometry === 'function' && typeof THREE.MeshBasicMaterial === 'function') {
          var pGeom = new THREE.SphereGeometry(1.0, 8, 8);
          var pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
          state.particleMesh = new THREE.InstancedMesh(pGeom, pMat, state.sphSolver.maxDroplets);
          state.particleMesh.name = 'FluidAndWater3D_Droplets';
          state.particleMesh.frustumCulled = false;
          if (state.particleMesh.instanceMatrix && state.particleMesh.instanceMatrix.setUsage) {
            state.particleMesh.instanceMatrix.setUsage(35048); // THREE.DynamicDrawUsage
          }
          state.dummyObj = new THREE.Object3D();
          particleRoot.add(state.particleMesh);
        } else if (state.particleMesh && !state.particleMesh.parent) {
          particleRoot.add(state.particleMesh);
        }
      }

      if (state.particleMesh && state.dummyObj) {
        var solver = state.sphSolver;
        var dummy = state.dummyObj;
        var mesh = state.particleMesh;
        var activeCount = 0;
        var maxOpacity = 0.0;

        for (var pIdx = 0; pIdx < solver.particleCount; pIdx++) {
          if (!solver.alive[pIdx]) continue;

          // Back to GDevelop pixels. The instances sit under the same y-mirrored root as every
          // built-in 3D object, so GDevelop coordinates are assigned directly.
          dummy.position.set(
            solver.x[pIdx] * SPH_WORLD_INV_SCALE,
            solver.y[pIdx] * SPH_WORLD_INV_SCALE,
            solver.z[pIdx] * SPH_WORLD_INV_SCALE
          );
          dummy.scale.setScalar(Math.max(solver.radius[pIdx] * SPH_WORLD_INV_SCALE, 0.5));
          dummy.updateMatrix();
          mesh.setMatrixAt(activeCount, dummy.matrix);
          if (typeof mesh.setColorAt === 'function' && state.particleColor) {
            state.particleColor.setRGB(solver.cr[pIdx], solver.cg[pIdx], solver.cb[pIdx]);
            mesh.setColorAt(activeCount, state.particleColor);
          }
          activeCount++;
        }

        mesh.count = activeCount;
        if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // Opacity follows whichever registered liquid is the most opaque; a single instanced
        // material cannot carry per-droplet alpha.
        for (var lIdx = 0; lIdx < state.pourableObjects.length; lIdx++) {
          maxOpacity = Math.max(maxOpacity, state.pourableObjects[lIdx].liquidOpacity);
        }
        if (mesh.material && maxOpacity > 0) mesh.material.opacity = maxOpacity;
      }

      // 4. Underwater camera transition.
      FluidAndWater3D.updateUnderwater(runtimeScene, state);
    },

    updateUnderwater: function (runtimeScene, state) {
      if (state.waterBodies.length === 0) return;

      var isUnderAny = false;
      var activeWater = null;
      var activeScene = null;

      for (var w = 0; w < state.waterBodies.length; w++) {
        var wb = state.waterBodies[w];
        var obj = wb.object;
        if (!obj) continue;

        var threeCamera = getLayerThreeCamera(runtimeScene, wb.layerName);
        if (!threeCamera) { wb.isCameraUnderwater = false; continue; }

        var camX = 0, camY = 0, camZ = 0;
        if (threeCamera.getWorldPosition && typeof THREE.Vector3 === 'function') {
          if (!state._camWorldPos) state._camWorldPos = new THREE.Vector3();
          threeCamera.getWorldPosition(state._camWorldPos);
          camX = state._camWorldPos.x;
          camY = state._camWorldPos.y;
          camZ = state._camWorldPos.z;
        } else if (threeCamera.position) {
          camX = threeCamera.position.x || 0;
          camY = threeCamera.position.y || 0;
          camZ = threeCamera.position.z || 0;
        }

        // The camera lives in three space, where Y is the negated GDevelop Y. Comparing it straight
        // against a GDevelop-space AABB puts it outside every water body at positive Y.
        var camGdY = -camY;

        var objX = obj.getX ? obj.getX() : 0;
        var objY = obj.getY ? obj.getY() : 0;
        var objZ = obj.getZ ? obj.getZ() : 0;
        var objW = (obj.getWidth && obj.getWidth() > 0) ? obj.getWidth() : 1000;
        var objH = (obj.getHeight && obj.getHeight() > 0) ? obj.getHeight() : 1000;
        var objD = (obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0;

        var inX = camX >= objX && camX <= (objX + objW);
        var inY = camGdY >= objY && camGdY <= (objY + objH);

        if (!inX || !inY) { wb.isCameraUnderwater = false; continue; }

        var baseSurfZ = objZ + objD;
        var shore = waterEdgeInfluenceAt(state, camX, camGdY, wb.layerName, baseSurfZ,
          waterSpanOf(wb));
        if (shore.inside) { wb.isCameraUnderwater = false; continue; }
        var waveOffset = (evaluateGerstnerDisplacement(
          camX, camGdY, state.time, waveConfigOf(wb, 0)
        ) + interactionDisplacementAt(wb, camX, camGdY, state.time)) * shore.attenuation;
        var liveSurfZ = baseSurfZ + waveOffset;

        if (camZ >= objZ && camZ <= liveSurfZ) {
          wb.isCameraUnderwater = true;
          if (wb.enableUnderwaterFX) {
            isUnderAny = true;
            activeWater = wb;
            activeScene = getLayerThreeScene(runtimeScene, wb.layerName);
          }
        } else {
          wb.isCameraUnderwater = false;
        }
      }

      if (isUnderAny && !state.underwaterActive && activeWater && activeScene) {
        state.underwaterActive = true;
        state.underwaterBody = activeWater;
        state.savedFog = activeScene.fog;
        state._fogScene = activeScene;
        if (typeof THREE.FogExp2 === 'function') {
          var col = activeWater.underwaterFogColor;
          activeScene.fog = new THREE.FogExp2(
            new THREE.Color(col[0], col[1], col[2]),
            activeWater.underwaterFogDensity
          );
        }
      } else if (!isUnderAny && state.underwaterActive) {
        state.underwaterActive = false;
        state.underwaterBody = null;
        // Restore the fog on the scene it was taken from, not on whatever scene is handy now.
        if (state._fogScene) state._fogScene.fog = state.savedFog || null;
        state._fogScene = null;
        state.savedFog = null;
      }
    },

    onSceneUnloaded: function (runtimeScene) {
      var state = sceneStates.get(runtimeScene);
      if (state) {
        for (var i = 0; i < state.waterBodies.length; i++) {
          var body = state.waterBodies[i];
          if (body.mesh) {
            if (body.mesh.geometry) body.mesh.geometry.dispose();
            if (body.mesh.material) body.mesh.material.dispose();
            if (body.mesh.parent) body.mesh.parent.remove(body.mesh);
          }
        }
        for (var oi = 0; oi < state.oceans.length; oi++) {
          var oc = state.oceans[oi];
          if (oc.mesh) {
            if (oc.mesh.geometry) oc.mesh.geometry.dispose();
            if (oc.mesh.material) oc.mesh.material.dispose();
            if (oc.mesh.parent) oc.mesh.parent.remove(oc.mesh);
          }
          if (oc.texture && oc.texture.dispose) oc.texture.dispose();
          if (oc.gpu && oc.gpu.dispose) oc.gpu.dispose();
        }
        state.oceans = [];
        state.waterEdges = [];
        if (state.particleMesh) {
          if (state.particleMesh.geometry) state.particleMesh.geometry.dispose();
          if (state.particleMesh.material) state.particleMesh.material.dispose();
          if (state.particleMesh.parent) state.particleMesh.parent.remove(state.particleMesh);
          state.particleMesh = null;
        }
        // Leave the scene's fog as we found it if the player quit while submerged.
        if (state.underwaterActive && state._fogScene) {
          state._fogScene.fog = state.savedFog || null;
          state._fogScene = null;
          state.underwaterActive = false;
        }
        state.waterBodies = [];
        state.buoyantObjects = [];
        state.pourableObjects = [];
        state.sphSolver.clearAll();
        sceneStates.delete(runtimeScene);
      }
    },

    isSupported: function (runtimeScene) {
      if (!THREE_OK) return false;
      if (!runtimeScene || !runtimeScene.getGame) return true;
      var renderer = runtimeScene.getGame().getRenderer();
      if (!renderer || !renderer.getThreeRenderer) return true;
      var threeRenderer = renderer.getThreeRenderer();
      return !!(threeRenderer && threeRenderer.capabilities && threeRenderer.capabilities.isWebGL2 !== false);
    },

    setGlobalFluidTimeScale: function (runtimeScene, scale) {
      var state = getSceneState(runtimeScene);
      state.timeScale = Math.max(0.0, scale);
    },

    pauseAllFluids: function (runtimeScene, pause) {
      var state = getSceneState(runtimeScene);
      state.paused = !!pause;
    },

    /** Z height (GDevelop units) that poured droplets pile up on. Defaults to 0. */
    setDropletFloorZ: function (runtimeScene, z) {
      var state = getSceneState(runtimeScene);
      state.sphFloorZ = typeof z === 'number' && isFinite(z) ? z : 0.0;
    },

    getGlobalWaterSurfaceZ: function (runtimeScene, x, y) {
      return FluidAndWater3D.getWaterSurfaceZ(runtimeScene, null, x, y);
    },

    isCameraUnderwaterAny: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      return state.underwaterActive;
    },

    getTotalActiveDropletCount: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      return state.sphSolver.getActiveCount();
    }
  };

  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(FluidAndWater3D.onScenePostEvents);
  }
  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(FluidAndWater3D.onSceneUnloaded);
  }

  gdjs.__fluidAndWater3D = FluidAndWater3D;
})();
