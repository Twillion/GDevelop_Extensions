/**
 * CinematicPostFX3D — Post-Processing, SSR, GTAO & Optics Suite for GDevelop 5
 *
 * Consolidated multi-pass post-processing compositing engine:
 *  - Native GDevelop 5 EffectComposer integration via layerRenderer.addPostProcessingPass(pass).
 *  - A real depth attachment: the composer's ping-pong render targets are rebuilt with a
 *    DepthTexture so depth-dependent passes have something to read. Without this every
 *    depth-based effect silently reads 0.0.
 *  - Ground Truth Ambient Occlusion (GTAO): slice-based horizon search with the Jimenez
 *    arc-integral and polynomial multi-bounce.
 *  - Screen-Space Reflections (SSR): DDA raymarch, 4-step binary refinement, Schlick
 *    Fresnel weighting and distance/edge fade.
 *  - 13-Tap Progressive Karis HDR Bloom with additive mip recombination, plus anamorphic
 *    streaks from a dedicated wide horizontal blur pass.
 *  - Optical Bokeh Depth of Field with a scale-invariant Circle of Confusion and a
 *    real center-screen autofocus raycast.
 *  - Camera-velocity Motion Blur & Chromatic Aberration.
 *  - ACES Filmic, Reinhard, Cineon, and Linear Tone Mapping.
 *  - 5 One-Click Genre Presets: CyberpunkNeon, CinematicMovie, HorrorGrim, CleanRealistic,
 *    PerformanceLite.
 *
 * UNITS: every world-space parameter (GTAO radius, SSR distance, focus distance) is in
 * GDevelop world units, NOT metres. A default GDevelop 3D layer places the camera at
 * 0.5 * height / tan(fov/2) — about 724 units for a 600px-tall game at 45 degrees — so
 * scene-scale defaults live in the hundreds, not single digits.
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__cinematicPostFX3D) return; // Singleton installation

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------- Helpers & Math */

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
      var parts = input.split(';').map(function (v) { return parseFloat(v); });
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return [parts[0], parts[1], parts[2]];
      }
      if (input.startsWith('#') && typeof gdjs.hexToRGBColor === 'function') {
        return gdjs.hexToRGBColor(input);
      }
    }
    return fallback || [100, 180, 255];
  }

  // Full/Half/Quarter -> the divisor applied to the GTAO, SSR and reflectivity-mask buffers.
  var QUALITY_DIVISORS = { Full: 1, Half: 2, Quarter: 4 };

  function qualityDivisor(name) {
    return QUALITY_DIVISORS[name] || 2;
  }

  function warnOnce(key, message) {
    if (!warnOnce._seen) warnOnce._seen = {};
    if (warnOnce._seen[key]) return;
    warnOnce._seen[key] = true;
    console.warn('[CinematicPostFX3D] ' + message);
  }

  /* ------------------------------------------------------------- 5 Genre Presets
   * World-space values are in GDevelop units. A typical 3D scene sits 400-1200 units
   * from the camera, so GTAO radii live in the tens and focus distances in the hundreds.
   */

  var PRESETS = {
    DefaultGameplay: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 55.0,
      gtaoIntensity: 1.0,
      gtaoMultiBounce: true,
      enableSSR: true,
      ssrIntensity: 0.5,
      ssrMaxDistance: 400.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.6,
      ssrRaySteps: 32,
      enableBloom: true,
      bloomIntensity: 0.5,
      bloomThreshold: 0.4,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.0,
      flareTintColor: '255;255;255',
      enableDOF: false,
      autofocus: false,
      manualFocusDistance: 700.0,
      apertureFStop: 2.8,
      maxBokehRadius: 10.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.15,
      chromaticAberration: 0.001,
    },
    CinematicCutscene: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 70.0,
      gtaoIntensity: 1.2,
      gtaoMultiBounce: true,
      enableSSR: true,
      ssrIntensity: 0.4,
      ssrMaxDistance: 400.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.7,
      ssrRaySteps: 32,
      enableBloom: true,
      bloomIntensity: 0.8,
      bloomThreshold: 0.38,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.25,
      flareTintColor: '100;180;255',
      enableDOF: true,
      autofocus: true,
      manualFocusDistance: 700.0,
      apertureFStop: 2.8,
      maxBokehRadius: 10.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.4,
      chromaticAberration: 0.002,
    },
    VibrantFantasy: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 55.0,
      gtaoIntensity: 1.1,
      gtaoMultiBounce: true,
      enableSSR: true,
      ssrIntensity: 0.6,
      ssrMaxDistance: 400.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.6,
      ssrRaySteps: 32,
      enableBloom: true,
      bloomIntensity: 0.85,
      bloomThreshold: 0.35,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.0,
      flareTintColor: '255;235;200',
      enableDOF: false,
      autofocus: false,
      manualFocusDistance: 700.0,
      apertureFStop: 2.8,
      maxBokehRadius: 10.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.15,
      chromaticAberration: 0.0,
    },
    NightNeon: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 60.0,
      gtaoIntensity: 1.0,
      gtaoMultiBounce: true,
      enableSSR: true,
      ssrIntensity: 0.85,
      ssrMaxDistance: 500.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.5,
      ssrRaySteps: 32,
      enableBloom: true,
      bloomIntensity: 1.2,
      bloomThreshold: 0.28,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.35,
      flareTintColor: '100;170;255',
      enableDOF: true,
      autofocus: true,
      manualFocusDistance: 700.0,
      apertureFStop: 5.6,
      maxBokehRadius: 8.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.3,
      chromaticAberration: 0.003,
    },
    HorrorTension: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 85.0,
      gtaoIntensity: 1.6,
      gtaoMultiBounce: false,
      enableSSR: false,
      ssrIntensity: 0.0,
      ssrMaxDistance: 300.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.8,
      ssrRaySteps: 16,
      enableBloom: true,
      bloomIntensity: 0.3,
      bloomThreshold: 0.55,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.0,
      flareTintColor: '255;255;255',
      enableDOF: true,
      autofocus: true,
      manualFocusDistance: 320.0,
      apertureFStop: 3.2,
      maxBokehRadius: 8.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.2,
      chromaticAberration: 0.004,
    },
    PerformanceLite: {
      masterIntensity: 1.0,
      effectQuality: 'Quarter',
      toneMapping: 'Reinhard',
      enableGTAO: false,
      gtaoRadius: 40.0,
      gtaoIntensity: 0.6,
      gtaoMultiBounce: false,
      enableSSR: false,
      ssrIntensity: 0.0,
      ssrMaxDistance: 250.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.6,
      ssrRaySteps: 16,
      enableBloom: true,
      bloomIntensity: 0.5,
      bloomThreshold: 0.5,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.0,
      flareTintColor: '255;255;255',
      enableDOF: false,
      autofocus: false,
      manualFocusDistance: 700.0,
      apertureFStop: 4.0,
      maxBokehRadius: 8.0,
      enableMotionBlur: false,
      motionBlurStrength: 0.0,
      chromaticAberration: 0.0,
    },
    PlayerCustom: {
      masterIntensity: 1.0,
      effectQuality: 'Half',
      toneMapping: 'ACESFilmic',
      enableGTAO: true,
      gtaoRadius: 55.0,
      gtaoIntensity: 1.0,
      gtaoMultiBounce: true,
      enableSSR: true,
      ssrIntensity: 0.5,
      ssrMaxDistance: 400.0,
      ssrSurfaces: 'MaterialBased',
      ssrFresnel: 0.6,
      ssrRaySteps: 32,
      enableBloom: true,
      bloomIntensity: 0.5,
      bloomThreshold: 0.4,
      bloomRadius: 1.0,
      bloomMaxBrightness: 12.0,
      anamorphicFlares: 0.0,
      flareTintColor: '255;255;255',
      enableDOF: false,
      autofocus: false,
      manualFocusDistance: 700.0,
      apertureFStop: 2.8,
      maxBokehRadius: 10.0,
      enableMotionBlur: true,
      motionBlurStrength: 0.15,
      chromaticAberration: 0.001,
    }
  };

  var DEFAULT_SETTINGS = {
    preset: 'Custom',
    masterIntensity: 1.0,
    toneMapping: 'ACESFilmic',
    lutResource: '',
    lutIntensity: 1.0,
    enableGTAO: false,
    gtaoRadius: 50.0,
    gtaoIntensity: 1.0,
    gtaoMultiBounce: true,
    enableSSR: false,
    ssrIntensity: 0.6,
    ssrMaxDistance: 400.0,
    ssrFresnel: 0.6,
    ssrSurfaces: 'MaterialBased',
    ssrRaySteps: 32,
    effectQuality: 'Half',
    enableBloom: false,
    bloomIntensity: 0.8,
    bloomThreshold: 0.3,
    bloomRadius: 1.0,
    bloomMaxBrightness: 12.0,
    anamorphicFlares: 0.3,
    flareTintColor: '100;180;255',
    enableDOF: false,
    autofocus: true,
    manualFocusDistance: 700.0,
    apertureFStop: 2.8,
    maxBokehRadius: 12.0,
    enableMotionBlur: false,
    motionBlurStrength: 0.5,
    chromaticAberration: 0.003,
    targetLayer: '',
    diagnostics: false,
  };

  /* ------------------------------------------------------------- CPU mirrors of the GLSL math
   * These exist so the shader formulas can be unit tested off-GPU. Each one is the exact
   * scalar equivalent of the corresponding GLSL function; if you change one, change both.
   */

  function applyACESFilmic(r, g, b) {
    function curve(x) {
      return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    }
    return [saturate(curve(r)), saturate(curve(g)), saturate(curve(b))];
  }

  function applyReinhard(r, g, b) {
    return [r / (1.0 + r), g / (1.0 + g), b / (1.0 + b)];
  }

  function applyCineon(r, g, b) {
    function curve(x) {
      x = Math.max(0.0, x - 0.004);
      return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
    }
    return [saturate(curve(r)), saturate(curve(g)), saturate(curve(b))];
  }

  // Window depth [0,1] -> positive view-space distance from the camera.
  function linearizeDepth(rawDepth, near, far, isOrtho) {
    if (isOrtho) return near + rawDepth * (far - near);
    var zNdc = rawDepth * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - zNdc * (far - near));
  }

  // Circle of Confusion, normalised to [0, maxRadiusPx].
  //
  // The defocus term |z - zFocus| / z is dimensionless, so the same settings produce the
  // same blur whether the scene is 5 units deep or 5000. A literal thin-lens CoC in world
  // units would not: it scales with the focus distance, which is exactly why the old
  // 50mm-lens formula saturated every pixel on a GDevelop scene sitting 700 units out.
  //
  // APERTURE_SCALE calibrates the f-stop: at f/2.8, a subject at twice the focus distance
  // lands on half the maximum bokeh radius.
  var APERTURE_SCALE = 2.8;

  function computeCircleOfConfusion(z, zFocus, fStop, maxRadiusPx) {
    if (z <= 0.001 || zFocus <= 0.001) return 0.0;
    var zf = Math.max(0.001, zFocus);
    var n = Math.max(0.5, fStop || 2.8);
    var defocus = Math.abs(z - zf) / Math.max(0.001, z);
    return saturate(defocus * (APERTURE_SCALE / n)) * (maxRadiusPx || 12.0);
  }

  // GTAO inner arc integral (Jimenez et al. 2016, eq. 7). theta1/theta2 are the horizon
  // angles measured from the view vector, gamma the projected-normal angle.
  function computeGTAOVisibility(theta1, theta2, gamma) {
    var sinG = Math.sin(gamma);
    var cosG = Math.cos(gamma);
    var v1 = -Math.cos(2.0 * theta1 - gamma) + cosG + 2.0 * theta1 * sinG;
    var v2 = -Math.cos(2.0 * theta2 - gamma) + cosG + 2.0 * theta2 * sinG;
    return 0.25 * (v1 + v2);
  }

  // Polynomial multi-bounce fit. Always brightens (result >= visibility), which is the
  // whole point: crevices on bright albedo should not go black.
  function computeGTAOMultiBounce(visibility, albedo) {
    var x = saturate(visibility);
    var alb = saturate(albedo);
    var a = 2.0404 * alb - 0.3324;
    var b = -4.7951 * alb + 0.6417;
    var c = 2.7552 * alb + 0.6903;
    return clamp(x * (a * x * x + b * x + c), x, 1.0);
  }

  function karisLumaWeight(r, g, b) {
    var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.0 / (1.0 + luma);
  }

  /* ------------------------------------------------------------- Shaders Source */

  var commonVertexShader = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Shared depth utilities. Every depth-reading pass needs the camera planes: a raw depth
  // comparison against 0.999 is meaningless when near=0.1/far=2000 puts the whole scene
  // above 0.999 anyway.
  var DEPTH_UTILS = [
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform int uIsOrtho;',
    '',
    'float rawToLinear(float rawDepth) {',
    '  if (uIsOrtho == 1) return uNear + rawDepth * (uFar - uNear);',
    '  float zNdc = rawDepth * 2.0 - 1.0;',
    '  return (2.0 * uNear * uFar) / (uFar + uNear - zNdc * (uFar - uNear));',
    '}',
    '',
    'bool isSky(float linearZ) {',
    '  return linearZ >= uFar * 0.995;',
    '}',
    ''
  ].join('\n');

  var VIEW_POS_UTILS = [
    'uniform mat4 uInverseProjectionMatrix;',
    '',
    'vec3 getViewPosition(vec2 uv, float rawDepth) {',
    '  vec2 ndc = uv * 2.0 - 1.0;',
    '  float zNdc = rawDepth * 2.0 - 1.0;',
    '  vec4 clip = vec4(ndc, zNdc, 1.0);',
    '  vec4 view = uInverseProjectionMatrix * clip;',
    '  float w = abs(view.w) < 0.00001 ? 0.00001 : view.w;',
    '  return view.xyz / w;',
    '}',
    ''
  ].join('\n');

  // Depth-derived normals. There is no G-buffer to read real normals from, so the best
  // available option is a best-of-four-neighbours reconstruction: it picks the closer
  // neighbour on each axis so silhouettes do not smear across depth discontinuities.
  var NORMAL_UTILS = [
    'vec3 reconstructNormal(vec2 uv, float rawDepth, vec3 pC, vec2 texel) {',
    '  float zR = texture2D(tDepth, uv + vec2(texel.x, 0.0)).r;',
    '  float zL = texture2D(tDepth, uv - vec2(texel.x, 0.0)).r;',
    '  float zT = texture2D(tDepth, uv + vec2(0.0, texel.y)).r;',
    '  float zB = texture2D(tDepth, uv - vec2(0.0, texel.y)).r;',
    '',
    '  vec3 pR = getViewPosition(uv + vec2(texel.x, 0.0), zR);',
    '  vec3 pL = getViewPosition(uv - vec2(texel.x, 0.0), zL);',
    '  vec3 pT = getViewPosition(uv + vec2(0.0, texel.y), zT);',
    '  vec3 pB = getViewPosition(uv - vec2(0.0, texel.y), zB);',
    '',
    '  vec3 dX = (abs(zR - rawDepth) < abs(zL - rawDepth)) ? (pR - pC) : (pC - pL);',
    '  vec3 dY = (abs(zT - rawDepth) < abs(zB - rawDepth)) ? (pT - pC) : (pC - pB);',
    '  vec3 n = cross(dX, dY);',
    '  if (length(n) < 0.0001) return vec3(0.0, 0.0, 1.0);',
    '  n = normalize(n);',
    '  if (dot(n, -pC) < 0.0) n = -n;',
    '  return n;',
    '}',
    ''
  ].join('\n');

  // 1. GTAO — slice-based horizon search with the Jimenez arc integral.
  var gtaoFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tDepth;',
    'uniform vec2 uResolution;',
    'uniform float uRadius;',
    'uniform float uIntensity;',
    'uniform float uProjScale;',
    '',
    DEPTH_UTILS,
    VIEW_POS_UTILS,
    NORMAL_UTILS,
    '',
    '#define PI 3.14159265359',
    '#define HALF_PI 1.57079632679',
    '#define NUM_SLICES 4',
    '#define NUM_STEPS 6',
    '',
    'void main() {',
    '  float rawDepth = texture2D(tDepth, vUv).r;',
    '  float linZ = rawToLinear(rawDepth);',
    '  if (isSky(linZ) || uIntensity <= 0.0) {',
    '    gl_FragColor = vec4(1.0);',
    '    return;',
    '  }',
    '',
    '  vec2 texel = 1.0 / uResolution;',
    '  vec3 P = getViewPosition(vUv, rawDepth);',
    '  vec3 N = reconstructNormal(vUv, rawDepth, P, texel);',
    '  vec3 V = normalize(-P);',
    '',
    '  // World radius -> screen radius in pixels at this depth.',
    '  float radiusPixels = (uIsOrtho == 1)',
    '    ? uRadius * uProjScale * 0.5 * uResolution.y',
    '    : uRadius * uProjScale * 0.5 * uResolution.y / max(0.0001, linZ);',
    '  radiusPixels = clamp(radiusPixels, 2.0, 128.0);',
    '',
    '  // Per-pixel slice rotation breaks up the 4-direction banding. Interleaved gradient',
    '  // noise rather than a sin hash: it has a far better spatial distribution and does not',
    '  // collapse into visible bands at mediump precision on mobile GPUs.',
    '  vec2 pixel = vUv * uResolution;',
    '  float noise = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));',
    '',
    '  float visibility = 0.0;',
    '',
    '  for (int s = 0; s < NUM_SLICES; s++) {',
    '    float phi = (float(s) + noise) * (PI / float(NUM_SLICES));',
    '    vec3 sliceDir = vec3(cos(phi), sin(phi), 0.0);',
    '',
    '    vec3 planeN = cross(sliceDir, V);',
    '    float planeLen = length(planeN);',
    '    if (planeLen < 0.00001) continue;',
    '    planeN /= planeLen;',
    '',
    '    vec3 tangent = cross(V, planeN);',
    '',
    '    vec3 projN = N - planeN * dot(N, planeN);',
    '    float projLen = length(projN);',
    '    if (projLen < 0.0001) continue;',
    '    vec3 pn = projN / projLen;',
    '',
    '    float gamma = atan(dot(pn, tangent), dot(pn, V));',
    '',
    '    float h1 = HALF_PI;   // horizon on the +tangent side',
    '    float h2 = -HALF_PI;  // horizon on the -tangent side',
    '',
    '    for (int t = 1; t <= NUM_STEPS; t++) {',
    '      float stepPx = (float(t) / float(NUM_STEPS)) * radiusPixels;',
    '      vec2 offset = sliceDir.xy * stepPx * texel;',
    '',
    '      vec2 uvP = vUv + offset;',
    '      if (uvP.x > 0.0 && uvP.x < 1.0 && uvP.y > 0.0 && uvP.y < 1.0) {',
    '        float rdP = texture2D(tDepth, uvP).r;',
    '        if (!isSky(rawToLinear(rdP))) {',
    '          vec3 d = getViewPosition(uvP, rdP) - P;',
    '          float dl = length(d);',
    '          float aT = dot(d, tangent);',
    '          float aV = dot(d, V);',
    '          if (dl > 0.0001 && (abs(aT) + abs(aV)) > 0.000001) {',
    '            float a = atan(aT, aV);',
    '            float fall = clamp(1.0 - dl / max(0.0001, uRadius), 0.0, 1.0);',
    '            h1 = min(h1, mix(HALF_PI, a, fall));',
    '          }',
    '        }',
    '      }',
    '',
    '      vec2 uvN = vUv - offset;',
    '      if (uvN.x > 0.0 && uvN.x < 1.0 && uvN.y > 0.0 && uvN.y < 1.0) {',
    '        float rdN = texture2D(tDepth, uvN).r;',
    '        if (!isSky(rawToLinear(rdN))) {',
    '          vec3 d = getViewPosition(uvN, rdN) - P;',
    '          float dl = length(d);',
    '          float aT = dot(d, tangent);',
    '          float aV = dot(d, V);',
    '          if (dl > 0.0001 && (abs(aT) + abs(aV)) > 0.000001) {',
    '            float a = atan(aT, aV);',
    '            float fall = clamp(1.0 - dl / max(0.0001, uRadius), 0.0, 1.0);',
    '            h2 = max(h2, mix(-HALF_PI, a, fall));',
    '          }',
    '        }',
    '      }',
    '    }',
    '',
    '    // Clamp the visible arc to the normal-oriented hemisphere.',
    '    float t1 = gamma + min(h1 - gamma, HALF_PI);',
    '    float t2 = gamma + max(h2 - gamma, -HALF_PI);',
    '',
    '    float sinG = sin(gamma);',
    '    float cosG = cos(gamma);',
    '    float arc = 0.25 * (-cos(2.0 * t1 - gamma) + cosG + 2.0 * t1 * sinG)',
    '              + 0.25 * (-cos(2.0 * t2 - gamma) + cosG + 2.0 * t2 * sinG);',
    '',
    '    visibility += projLen * arc;',
    '  }',
    '',
    '  float ao = clamp(visibility / float(NUM_SLICES), 0.0, 1.0);',
    '  ao = pow(ao, max(0.1, uIntensity));',
    '  gl_FragColor = vec4(ao, ao, ao, 1.0);',
    '}'
  ].join('\n');

  // 2. Separable bilateral blur for the AO buffer. Run twice (H then V) — a single axis
  // leaves visible streaking. Depth weighting is relative to the centre depth so it works
  // at any scene scale.
  var bilateralBlurFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tAO;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uResolution;',
    'uniform vec2 uDirection;',
    '',
    DEPTH_UTILS,
    '',
    'void main() {',
    '  vec2 texel = 1.0 / uResolution;',
    '  float centerAO = texture2D(tAO, vUv).r;',
    '  float centerZ = rawToLinear(texture2D(tDepth, vUv).r);',
    '',
    '  // Edge-stopping tolerance scales with depth: a 5% depth change is an edge whether',
    '  // the surface is 10 units away or 1000.',
    '  float tolerance = max(0.01, centerZ * 0.05);',
    '',
    '  float sum = centerAO;',
    '  float totalWeight = 1.0;',
    '',
    '  for (int i = 1; i <= 3; i++) {',
    '    float weight = (i == 1) ? 0.28 : ((i == 2) ? 0.14 : 0.05);',
    '    vec2 offset = uDirection * (float(i) * texel);',
    '',
    '    vec2 uvP = vUv + offset;',
    '    float zP = rawToLinear(texture2D(tDepth, uvP).r);',
    '    float wP = weight * max(0.0, 1.0 - abs(zP - centerZ) / tolerance);',
    '    sum += texture2D(tAO, uvP).r * wP;',
    '    totalWeight += wP;',
    '',
    '    vec2 uvN = vUv - offset;',
    '    float zN = rawToLinear(texture2D(tDepth, uvN).r);',
    '    float wN = weight * max(0.0, 1.0 - abs(zN - centerZ) / tolerance);',
    '    sum += texture2D(tAO, uvN).r * wN;',
    '    totalWeight += wN;',
    '  }',
    '',
    '  float finalAO = sum / max(0.001, totalWeight);',
    '  gl_FragColor = vec4(finalAO, finalAO, finalAO, 1.0);',
    '}'
  ].join('\n');

  // 3. SSR — DDA raymarch, binary refinement, Fresnel + distance + edge fade.
  var ssrFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    'uniform sampler2D tReflectivity;',
    'uniform vec2 uResolution;',
    'uniform mat4 uProjectionMatrix;',
    'uniform int uUseReflectivityMask;',
    'uniform float uIntensity;',
    'uniform float uMaxDistance;',
    'uniform float uFresnel;',
    'uniform int uMaxSteps;',
    '',
    DEPTH_UTILS,
    VIEW_POS_UTILS,
    NORMAL_UTILS,
    '',
    'vec2 projectViewToUV(vec3 viewPos) {',
    '  vec4 clip = uProjectionMatrix * vec4(viewPos, 1.0);',
    '  vec3 ndc = clip.xyz / max(0.00001, clip.w);',
    '  return ndc.xy * 0.5 + 0.5;',
    '}',
    '',
    'void main() {',
    '  float rawDepth = texture2D(tDepth, vUv).r;',
    '  float linZ = rawToLinear(rawDepth);',
    '  if (isSky(linZ) || uIntensity <= 0.0) {',
    '    gl_FragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  // How reflective is this surface? Without this the raymarch mirrors the world onto',
    '  // every rough dielectric in the scene — floors, terrain, walls.',
    '  float reflectivity = 1.0;',
    '  if (uUseReflectivityMask == 1) {',
    '    reflectivity = texture2D(tReflectivity, vUv).r;',
    '    if (reflectivity < 0.01) {',
    '      gl_FragColor = vec4(0.0);',
    '      return;',
    '    }',
    '  }',
    '',
    '  vec2 texel = 1.0 / uResolution;',
    '  vec3 P = getViewPosition(vUv, rawDepth);',
    '  vec3 N = reconstructNormal(vUv, rawDepth, P, texel);',
    '  vec3 V = normalize(P);',
    '  vec3 R = normalize(reflect(V, N));',
    '',
    '  // Rays pointing back toward the camera cannot be marched forward in screen space.',
    '  // Fading rather than rejecting on a sign test matters because this boundary sits',
    '  // where the depth-reconstructed normal is noisiest, and a hard test there makes',
    '  // neighbouring pixels flip between reflecting and not on consecutive frames.',
    '  float grazingFade = 1.0 - smoothstep(-0.15, 0.0, R.z);',
    '  if (grazingFade < 0.01) {',
    '    gl_FragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  int steps = clamp(uMaxSteps, 8, 64);',
    '',
    '  // Ray length and surface thickness both scale with view depth, so the same settings',
    '  // work for a 20-unit prop and a 2000-unit vista.',
    '  float rayLen = min(uMaxDistance, max(1.0, linZ * 2.0));',
    '  float thickness = max(0.5, linZ * 0.02);',
    '',
    '  vec3 startPos = P + N * max(0.05, linZ * 0.002);',
    '  vec3 endPos = P + R * rayLen;',
    '',
    '  vec2 startUV = projectViewToUV(startPos);',
    '  vec2 endUV = projectViewToUV(endPos);',
    '',
    '  vec2 rayStepUV = (endUV - startUV) / float(steps);',
    '  vec3 rayStepView = (endPos - startPos) / float(steps);',
    '',
    '  vec2 currentUV = startUV;',
    '  vec3 currentView = startPos;',
    '  bool hit = false;',
    '  vec2 hitUV = vec2(0.0);',
    '  float travelled = 0.0;',
    '',
    '  for (int i = 0; i < 64; i++) {',
    '    if (i >= steps) break;',
    '    currentUV += rayStepUV;',
    '    currentView += rayStepView;',
    '    travelled = float(i + 1) / float(steps);',
    '',
    '    if (currentUV.x < 0.001 || currentUV.x > 0.999 || currentUV.y < 0.001 || currentUV.y > 0.999) break;',
    '',
    '    float sampleRaw = texture2D(tDepth, currentUV).r;',
    '    if (isSky(rawToLinear(sampleRaw))) continue;',
    '',
    '    vec3 sampleView = getViewPosition(currentUV, sampleRaw);',
    '    float deltaZ = currentView.z - sampleView.z;',
    '',
    '    if (deltaZ < 0.0 && deltaZ > -thickness) {',
    '      vec2 rUV = currentUV;',
    '      vec3 rView = currentView;',
    '      vec2 hUV = rayStepUV * 0.5;',
    '      vec3 hView = rayStepView * 0.5;',
    '',
    '      for (int b = 0; b < 4; b++) {',
    '        hUV *= 0.5;',
    '        hView *= 0.5;',
    '        vec3 bPos = getViewPosition(rUV, texture2D(tDepth, rUV).r);',
    '        if (rView.z < bPos.z) {',
    '          rUV -= hUV;',
    '          rView -= hView;',
    '        } else {',
    '          rUV += hUV;',
    '          rView += hView;',
    '        }',
    '      }',
    '',
    '      hit = true;',
    '      hitUV = rUV;',
    '      break;',
    '    }',
    '  }',
    '',
    '  if (!hit) {',
    '    gl_FragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  vec2 edgeDist = abs(hitUV - 0.5) * 2.0;',
    '  float edgeFade = smoothstep(0.0, 0.25, clamp(1.0 - max(edgeDist.x, edgeDist.y), 0.0, 1.0));',
    '',
    '  // Reflections weaken with ray length and strengthen at grazing angles.',
    '  float distFade = 1.0 - clamp(travelled, 0.0, 1.0) * 0.75;',
    '  float ndv = clamp(dot(N, -V), 0.0, 1.0);',
    '  float schlick = pow(1.0 - ndv, 5.0);',
    '  float fresnel = mix(1.0, schlick, clamp(uFresnel, 0.0, 1.0));',
    '',
    '  vec4 reflectedColor = texture2D(tColor, hitUV);',
    '  float alpha = clamp(uIntensity * edgeFade * distFade * fresnel * reflectivity * grazingFade, 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(reflectedColor.rgb, alpha);',
    '}'
  ].join('\n');

  // 4. 13-Tap Karis downsample. The centre tap belongs in all four corner boxes; leaving
  // it out (and substituting the inner diagonals) skews the kernel and wastes a fetch.
  var karisDownsampleFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexelSize;',
    'uniform float uThreshold;',
    'uniform float uMaxBrightness;',
    'uniform int uIsFirstMip;',
    '',
    'float luma(vec3 c) {',
    '  return dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '}',
    '',
    'vec3 karisBox(vec3 c1, vec3 c2, vec3 c3, vec3 c4) {',
    '  if (uIsFirstMip == 1) {',
    '    float w1 = 1.0 / (1.0 + luma(c1));',
    '    float w2 = 1.0 / (1.0 + luma(c2));',
    '    float w3 = 1.0 / (1.0 + luma(c3));',
    '    float w4 = 1.0 / (1.0 + luma(c4));',
    '    return (c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / max(0.001, w1 + w2 + w3 + w4);',
    '  }',
    '  return (c1 + c2 + c3 + c4) * 0.25;',
    '}',
    '',
    'vec3 prefilter(vec3 c) {',
    '  // Bound how much a single very bright sample can swing the mip it lands in. Without',
    '  // this, one specular glint moving across texels makes the whole bloom pulse.',
    '  if (uIsFirstMip == 0) return c;',
    '  float m = max(c.r, max(c.g, c.b));',
    '  return m > uMaxBrightness ? c * (uMaxBrightness / m) : c;',
    '}',
    '',
    'void main() {',
    '  vec2 x = vec2(uTexelSize.x, 0.0);',
    '  vec2 y = vec2(0.0, uTexelSize.y);',
    '',
    '  vec3 a = prefilter(texture2D(tDiffuse, vUv - x - y).rgb);',
    '  vec3 b = prefilter(texture2D(tDiffuse, vUv + x - y).rgb);',
    '  vec3 c = prefilter(texture2D(tDiffuse, vUv).rgb);',
    '  vec3 d = prefilter(texture2D(tDiffuse, vUv - 2.0 * x - 2.0 * y).rgb);',
    '  vec3 e = prefilter(texture2D(tDiffuse, vUv - 2.0 * y).rgb);',
    '  vec3 f = prefilter(texture2D(tDiffuse, vUv + 2.0 * x - 2.0 * y).rgb);',
    '  vec3 g = prefilter(texture2D(tDiffuse, vUv - 2.0 * x).rgb);',
    '  vec3 h = prefilter(texture2D(tDiffuse, vUv + 2.0 * x).rgb);',
    '  vec3 i = prefilter(texture2D(tDiffuse, vUv - x + y).rgb);',
    '  vec3 j = prefilter(texture2D(tDiffuse, vUv + x + y).rgb);',
    '  vec3 k = prefilter(texture2D(tDiffuse, vUv - 2.0 * x + 2.0 * y).rgb);',
    '  vec3 l = prefilter(texture2D(tDiffuse, vUv + 2.0 * y).rgb);',
    '  vec3 m = prefilter(texture2D(tDiffuse, vUv + 2.0 * x + 2.0 * y).rgb);',
    '',
    '  vec3 box1 = karisBox(a, b, i, j);',
    '  vec3 box2 = karisBox(d, e, g, c);',
    '  vec3 box3 = karisBox(e, f, c, h);',
    '  vec3 box4 = karisBox(g, c, k, l);',
    '  vec3 box5 = karisBox(c, h, l, m);',
    '',
    '  vec3 downsample = box1 * 0.5 + (box2 + box3 + box4 + box5) * 0.125;',
    '',
    '  if (uIsFirstMip == 1) {',
    '    // Threshold is in LINEAR light, not display sRGB: the composer buffer is linear HDR',
    '    // and OutputPass converts at the very end. A surface that looks bright grey on',
    '    // screen is only about 0.6 here, so useful thresholds are well below 1.0.',
    '    float brightness = max(downsample.r, max(downsample.g, downsample.b));',
    '    float soft = brightness - uThreshold;',
    '    if (soft < 0.0) downsample = vec3(0.0);',
    '    else downsample *= max(0.0, soft / max(0.001, brightness));',
    '  }',
    '',
    '  gl_FragColor = vec4(downsample, 1.0);',
    '}'
  ].join('\n');

  // 5. 9-tap tent upsample WITH additive mip recombination. Without the tAdd term the
  // pyramid collapses to the smallest mip blurred N times and all mid-frequency glow is lost.
  var tentUpsampleFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tDiffuse;',
    'uniform sampler2D tAdd;',
    'uniform vec2 uTexelSize;',
    'uniform float uBloomRadius;',
    'uniform int uHasAdd;',
    '',
    'void main() {',
    '  float r = uBloomRadius;',
    '  vec2 x = vec2(uTexelSize.x * r, 0.0);',
    '  vec2 y = vec2(0.0, uTexelSize.y * r);',
    '',
    '  vec3 c = texture2D(tDiffuse, vUv).rgb * 4.0;',
    '  c += (texture2D(tDiffuse, vUv - x).rgb + texture2D(tDiffuse, vUv + x).rgb +',
    '        texture2D(tDiffuse, vUv - y).rgb + texture2D(tDiffuse, vUv + y).rgb) * 2.0;',
    '  c += texture2D(tDiffuse, vUv - x - y).rgb + texture2D(tDiffuse, vUv + x - y).rgb +',
    '       texture2D(tDiffuse, vUv - x + y).rgb + texture2D(tDiffuse, vUv + x + y).rgb;',
    '',
    '  vec3 result = c * (1.0 / 16.0);',
    '  if (uHasAdd == 1) result += texture2D(tAdd, vUv).rgb;',
    '',
    '  gl_FragColor = vec4(result, 1.0);',
    '}'
  ].join('\n');

  // 5b. SSR resolve: a roughness-widened blur over the reflection buffer. Rough surfaces
  // scatter their reflection over a wider cone; a mirror barely scatters at all, so the
  // radius floor is only wide enough to clean up the raymarch's ragged hit boundary.
  var ssrBlurFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tSSR;',
    'uniform sampler2D tReflectivity;',
    'uniform vec2 uTexelSize;',
    'uniform float uMaxRadius;',
    'uniform int uUseReflectivityMask;',
    '',
    'void main() {',
    '  vec4 center = texture2D(tSSR, vUv);',
    '',
    '  // Never grow a reflection outward onto a surface that produced none: without this the',
    '  // blur smears reflections past the edge of the object they belong to.',
    '  if (center.a < 0.001) {',
    '    gl_FragColor = center;',
    '    return;',
    '  }',
    '',
    '  float roughness = (uUseReflectivityMask == 1) ? texture2D(tReflectivity, vUv).g : 0.0;',
    '  float radius = mix(1.0, uMaxRadius, clamp(roughness, 0.0, 1.0));',
    '',
    '  vec4 acc = center;',
    '  float total = 1.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    float a = float(i) * 0.78539816;',
    '    vec2 o = vec2(cos(a), sin(a)) * radius * uTexelSize;',
    '    vec4 sample0 = texture2D(tSSR, vUv + o);',
    '    float w = sample0.a > 0.001 ? 1.0 : 0.0;',
    '    acc += sample0 * w;',
    '    total += w;',
    '  }',
    '',
    '  gl_FragColor = acc / max(1.0, total);',
    '}'
  ].join('\n');

  // 6. Bokeh DOF — dimensionless Circle of Confusion, 16 golden-angle spiral taps.
  var bokehDOFFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uResolution;',
    'uniform float uFocusDistance;',
    'uniform float uApertureFStop;',
    'uniform float uMaxBokehRadius;',
    '',
    DEPTH_UTILS,
    '',
    '// Dimensionless defocus, so the same settings hold at any world scale. A literal',
    '// thin-lens CoC in world units scales with the focus distance and saturates every',
    '// pixel on a scene that sits hundreds of units from the camera.',
    '#define APERTURE_SCALE 2.8',
    '',
    'float computeCoC(float z) {',
    '  if (z <= 0.001) return 0.0;',
    '  float zf = max(0.001, uFocusDistance);',
    '  float n = max(0.5, uApertureFStop);',
    '  float defocus = abs(z - zf) / max(0.001, z);',
    '  return clamp(defocus * (APERTURE_SCALE / n), 0.0, 1.0) * uMaxBokehRadius;',
    '}',
    '',
    'void main() {',
    '  float rawDepth = texture2D(tDepth, vUv).r;',
    '  float centerZ = rawToLinear(rawDepth);',
    '',
    '  if (isSky(centerZ)) {',
    '    // Distant background still defocuses; clamp it to the far-field CoC.',
    '    centerZ = uFar;',
    '  }',
    '',
    '  float centerCoC = computeCoC(centerZ);',
    '  if (centerCoC < 0.5) {',
    '    gl_FragColor = texture2D(tColor, vUv);',
    '    return;',
    '  }',
    '',
    '  vec2 texel = 1.0 / uResolution;',
    '  vec4 accColor = vec4(0.0);',
    '  float totalWeight = 0.0;',
    '',
    '  const int SAMPLES = 16;',
    '  for (int i = 0; i < SAMPLES; i++) {',
    '    float theta = float(i) * 2.39996323;',
    '    float r = sqrt(float(i + 1) / float(SAMPLES)) * centerCoC;',
    '    vec2 sampleUv = vUv + vec2(cos(theta), sin(theta)) * r * texel;',
    '    sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));',
    '',
    '    float sZ = rawToLinear(texture2D(tDepth, sampleUv).r);',
    '    float sCoC = computeCoC(sZ);',
    '',
    '    // Foreground samples may only bleed outward as far as their own CoC allows,',
    '    // which is what stops sharp objects smearing over blurry backgrounds.',
    '    float w = 1.0;',
    '    if (sZ < centerZ) {',
    '      w = clamp(sCoC / max(0.001, centerCoC), 0.0, 1.0);',
    '    }',
    '',
    '    accColor += texture2D(tColor, sampleUv) * w;',
    '    totalWeight += w;',
    '  }',
    '',
    '  gl_FragColor = accColor / max(0.001, totalWeight);',
    '}'
  ].join('\n');


  // Depth-aware upsample for the half (or quarter) resolution AO and reflection buffers.
  // Plain bilinear bleeds them across depth discontinuities, which reads as a halo around
  // every object. The four depth taps are computed once and shared by both buffers.
  var HALF_RES_UPSAMPLE = [
    'uniform vec2 uLowResTexel;',
    '',
    'vec2 gUV0; vec2 gUV1; vec2 gUV2; vec2 gUV3;',
    'float gW0; float gW1; float gW2; float gW3; float gWSum;',
    '',
    'void computeUpsampleWeights(vec2 uv, float centerZ) {',
    '  vec2 h = uLowResTexel * 0.5;',
    '  gUV0 = uv + vec2(-h.x, -h.y);',
    '  gUV1 = uv + vec2( h.x, -h.y);',
    '  gUV2 = uv + vec2(-h.x,  h.y);',
    '  gUV3 = uv + vec2( h.x,  h.y);',
    '',
    '  // Tolerance scales with depth so edge detection works at any scene scale.',
    '  float tol = max(1.0, centerZ * 0.05);',
    '  gW0 = max(0.0, 1.0 - abs(rawToLinear(texture2D(tDepth, gUV0).r) - centerZ) / tol);',
    '  gW1 = max(0.0, 1.0 - abs(rawToLinear(texture2D(tDepth, gUV1).r) - centerZ) / tol);',
    '  gW2 = max(0.0, 1.0 - abs(rawToLinear(texture2D(tDepth, gUV2).r) - centerZ) / tol);',
    '  gW3 = max(0.0, 1.0 - abs(rawToLinear(texture2D(tDepth, gUV3).r) - centerZ) / tol);',
    '  gWSum = gW0 + gW1 + gW2 + gW3;',
    '}',
    '',
    'vec4 gatherLowRes(sampler2D tex, vec2 uv) {',
    '  // Every neighbour rejected (an isolated sliver): fall back to bilinear rather than',
    '  // punching a hole in the buffer.',
    '  if (gWSum < 0.0001) return texture2D(tex, uv);',
    '  return (texture2D(tex, gUV0) * gW0 + texture2D(tex, gUV1) * gW1 +',
    '          texture2D(tex, gUV2) * gW2 + texture2D(tex, gUV3) * gW3) / gWSum;',
    '}',
    ''
  ].join('\n');

  // Shared by the merge pass and the composite so the AO/SSR application lives in exactly
  // one place. Requires HALF_RES_UPSAMPLE and the tGTAO/tSSR/uEnable* uniforms.
  var AO_SSR_APPLY = [
    '// Jimenez multi-bounce fit: always >= visibility, so coloured crevices keep bounce light.',
    'vec3 gtaoMultiBounce(float visibility, vec3 albedo) {',
    '  vec3 a = 2.0404 * albedo - 0.3324;',
    '  vec3 b = -4.7951 * albedo + 0.6417;',
    '  vec3 c = 2.7552 * albedo + 0.6903;',
    '  float x = visibility;',
    '  return clamp(x * (a * x * x + b * x + c), vec3(x), vec3(1.0));',
    '}',
    '',
    'vec3 applyAOandSSR(vec3 rgb, vec2 uv, float centerZ) {',
    '  if (uEnableGTAO == 0 && uEnableSSR == 0) return rgb;',
    '  computeUpsampleWeights(uv, centerZ);',
    '',
    '  if (uEnableGTAO == 1) {',
    '    float ao = gatherLowRes(tGTAO, uv).r;',
    '    if (uMultiBounce == 1) {',
    '      rgb *= gtaoMultiBounce(ao, clamp(rgb, 0.0, 1.0));',
    '    } else {',
    '      rgb *= ao;',
    '    }',
    '  }',
    '',
    '  if (uEnableSSR == 1) {',
    '    vec4 ssr = gatherLowRes(tSSR, uv);',
    '    rgb = mix(rgb, ssr.rgb, ssr.a);',
    '  }',
    '',
    '  return rgb;',
    '}',
    ''
  ].join('\n');

  var AO_SSR_UNIFORMS = [
    'uniform sampler2D tGTAO;',
    'uniform sampler2D tSSR;',
    'uniform int uEnableGTAO;',
    'uniform int uEnableSSR;',
    'uniform int uMultiBounce;',
    ''
  ].join('\n');

  // 6b. AO/SSR merge. Applied before Depth of Field so reflections and contact shadows
  // defocus along with the surface they sit on, instead of staying razor sharp on a
  // blurred background. Only runs when DOF is active alongside AO or SSR.
  var mergeFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    AO_SSR_UNIFORMS,
    DEPTH_UTILS,
    HALF_RES_UPSAMPLE,
    AO_SSR_APPLY,
    '',
    'void main() {',
    '  vec4 c = texture2D(tColor, vUv);',
    '  float z = rawToLinear(texture2D(tDepth, vUv).r);',
    '  gl_FragColor = vec4(applyAOandSSR(c.rgb, vUv, z), c.a);',
    '}'
  ].join('\n');

  // 6c. Anamorphic streak. A wide horizontal-only blur of the bloom buffer: the look comes
  // from a lens whose aperture is far wider than it is tall, so highlights smear sideways
  // and nowhere else. The old two-tap version was a lateral smear, not a streak.
  var anamorphicStreakFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexelSize;',
    'uniform float uStride;',
    '',
    'void main() {',
    '  vec3 acc = texture2D(tDiffuse, vUv).rgb * 0.2;',
    '  float total = 0.2;',
    '  for (int i = 1; i <= 6; i++) {',
    '    float o = float(i) * uTexelSize.x * uStride;',
    '    float k = 0.2 * (1.0 - float(i) / 7.0);',
    '    acc += (texture2D(tDiffuse, vUv + vec2(o, 0.0)).rgb',
    '          + texture2D(tDiffuse, vUv - vec2(o, 0.0)).rgb) * k;',
    '    total += 2.0 * k;',
    '  }',
    '  gl_FragColor = vec4(acc / max(0.001, total), 1.0);',
    '}'
  ].join('\n');

  // 7. Master composite: AO (with multi-bounce), SSR, bloom, anamorphic streaks,
  // motion blur, chromatic aberration, tone mapping.
  // --- 3D LUT colour grading, as a PACKED STRIP rather than a true 3D texture.
  //
  // The plan specified a Data3DTexture, which is the better tool. It is not reachable here: this
  // whole post chain is GLSL ES 1.00 (gl_FragColor, texture2D, no #version directive) and
  // sampler3D does not exist in ES 1.00. Converting the chain to GLSL3 would mean rewriting 64
  // texture reads across ten shaders to change one feature, so this samples an N x N tile strip
  // and does the blue-axis interpolation by hand instead.
  //
  // Because this is NOT a true 3D texture, the slice-bleed hazard the plan set aside is live
  // again: hardware bilinear filtering near a tile edge would blend into the NEIGHBOURING slice,
  // which shows up as colour fringing on smooth gradients. Clamping the within-tile coordinate to
  // texel centres - (c * (N-1) + 0.5) / N - keeps every sample at least half a texel inside its
  // own tile, so the filter never crosses the boundary. That is what makes the strip safe, and it
  // is why the identity-LUT test below is a real test and not a formality.
  // Texel centres on all three axes.
  // sRGB transfer functions. The LUT runs in the ENCODED domain because that is what authoring
  // tools export; feeding it linear values grades plausibly but wrongly, which is the worst
  // possible failure because nothing looks broken.
  // The LUT shader code lives here as a named constant so the acceptance tests compile the
  // EXACT source that ships, rather than a copy that can drift away from it.
  var LUT_GLSL = [
      'vec3 sampleLut(vec3 color) {',
      '  float n = uLutSize;',
      '  vec3 c = clamp(color, 0.0, 1.0);',
      '  float blue = c.b * (n - 1.0);',
      '  float sliceLo = floor(blue);',
      '  float sliceHi = min(sliceLo + 1.0, n - 1.0);',
      '  float f = blue - sliceLo;',
      '  float u = (c.r * (n - 1.0) + 0.5) / n;',
      '  float v = (c.g * (n - 1.0) + 0.5) / n;',
      '  vec3 lo = texture2D(tLut, vec2((sliceLo + u) / n, v)).rgb;',
      '  vec3 hi = texture2D(tLut, vec2((sliceHi + u) / n, v)).rgb;',
      '  return mix(lo, hi, f);',
      '}',
      'vec3 lutOETF(vec3 c) {',
      '  c = clamp(c, 0.0, 1.0);',
      '  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));',
      '}',
      'vec3 lutEOTF(vec3 c) {',
      '  c = clamp(c, 0.0, 1.0);',
      '  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));',
      '}',
  ].join('\n');

  var masterCompositeFragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    '',
    'uniform sampler2D tColor;',
    'uniform sampler2D tBloom;',
    'uniform sampler2D tStreak;',
    'uniform sampler2D tDepth;',
    AO_SSR_UNIFORMS,
    'uniform float uMasterIntensity;',
    'uniform int uToneMappingMode;',
    'uniform float uBloomIntensity;',
    'uniform float uAnamorphicFlares;',
    'uniform vec3 uFlareTintColor;',
    'uniform float uChromaticAberration;',
    'uniform float uMotionBlurStrength;',
    'uniform int uEnableBloom;',
    'uniform int uEnableMotionBlur;',
    'uniform mat4 uCurrentViewProjectionInverse;',
    'uniform mat4 uPreviousViewProjection;',
    'uniform sampler2D tLut;',
    'uniform float uLutSize;',        // edge length N of the N x N x N cube (16, 32, 64)
    'uniform float uLutMix;',         // 0 bypasses the table entirely
    '',
    LUT_GLSL,
    '',
    DEPTH_UTILS,
    HALF_RES_UPSAMPLE,
    AO_SSR_APPLY,
    '',
    'vec3 acesFilmic(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    '',
    'vec3 reinhard(vec3 x) {',
    '  return x / (1.0 + x);',
    '}',
    '',
    'vec3 cineon(vec3 x) {',
    '  x = max(vec3(0.0), x - 0.004);',
    '  return clamp((x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06), 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec2 center = vec2(0.5);',
    '  vec2 toCenter = vUv - center;',
    '',
    '  vec4 baseColor;',
    '  if (uChromaticAberration > 0.0001) {',
    '    vec2 uvR = vUv - toCenter * uChromaticAberration;',
    '    vec2 uvB = vUv + toCenter * uChromaticAberration;',
    '    vec4 mid = texture2D(tColor, vUv);',
    '    baseColor = vec4(texture2D(tColor, uvR).r, mid.g, texture2D(tColor, uvB).b, mid.a);',
    '  } else {',
    '    baseColor = texture2D(tColor, vUv);',
    '  }',
    '',
    '  vec3 finalRGB = baseColor.rgb;',
    '',
    '  // When Depth of Field is active these were already merged in before the defocus,',
    '  // and the enable flags are zero here, so this is a no-op on that path.',
    '  if (uEnableGTAO == 1 || uEnableSSR == 1) {',
    '    finalRGB = applyAOandSSR(finalRGB, vUv, rawToLinear(texture2D(tDepth, vUv).r));',
    '  }',
    '',
    '  if (uEnableBloom == 1 && uBloomIntensity > 0.0) {',
    '    vec3 bloom = texture2D(tBloom, vUv).rgb * uBloomIntensity;',
    '    if (uAnamorphicFlares > 0.0) {',
    '      bloom += texture2D(tStreak, vUv).rgb * uAnamorphicFlares * uFlareTintColor;',
    '    }',
    '    finalRGB += bloom;',
    '  }',
    '',
    '  if (uEnableMotionBlur == 1 && uMotionBlurStrength > 0.001) {',
    '    float rawDepth = texture2D(tDepth, vUv).r;',
    '    if (!isSky(rawToLinear(rawDepth))) {',
    '      vec2 ndc = vUv * 2.0 - 1.0;',
    '      float zNdc = rawDepth * 2.0 - 1.0;',
    '      vec4 currentClip = vec4(ndc, zNdc, 1.0);',
    '      vec4 worldPos = uCurrentViewProjectionInverse * currentClip;',
    '      float wpW = abs(worldPos.w) < 0.0001 ? 0.0001 : worldPos.w;',
    '      worldPos /= wpW;',
    '',
    '      vec4 prevClip = uPreviousViewProjection * vec4(worldPos.xyz, 1.0);',
    '      float pcW = abs(prevClip.w) < 0.0001 ? 0.0001 : prevClip.w;',
    '      prevClip /= pcW;',
    '',
    '      vec2 velocity = (currentClip.xy - prevClip.xy) * 0.5 * uMotionBlurStrength;',
    '      float velLen = length(velocity);',
    '',
    '      // A binary gate on velocity is what made this flicker. Velocity is computed per',
    '      // pixel from that pixel own depth, so neighbouring pixels cross any fixed',
    '      // threshold on different frames: patches of the screen snap between blurred and',
    '      // sharp while the camera moves. Ramp in and out instead.',
    '      float strength = smoothstep(0.0004, 0.0025, velLen)',
    '                     * (1.0 - smoothstep(0.06, 0.12, velLen));',
    '',
    '      if (strength > 0.001) {',
    '        // Every tap comes from tColor, including the centre. Seeding the accumulator',
    '        // with the composited colour and filling the rest from the raw scene made the',
    '        // pixel jump from fully composited to five-sixths raw the instant blur engaged.',
    '        vec3 blurAccum = vec3(0.0);',
    '        const int MOTION_STEPS = 6;',
    '        for (int m = 0; m < MOTION_STEPS; m++) {',
    '          vec2 sampleCoord = clamp(vUv + velocity * (float(m) / float(MOTION_STEPS)), vec2(0.0), vec2(1.0));',
    '          blurAccum += texture2D(tColor, sampleCoord).rgb;',
    '        }',
    '        finalRGB = mix(finalRGB, blurAccum / float(MOTION_STEPS), strength);',
    '      }',
    '    }',
    '  }',
    '',
    '  vec3 toneMappedRGB = finalRGB;',
    '  if (uToneMappingMode == 0) {',
    '    toneMappedRGB = acesFilmic(finalRGB);',
    '  } else if (uToneMappingMode == 1) {',
    '    toneMappedRGB = reinhard(finalRGB);',
    '  } else if (uToneMappingMode == 2) {',
    '    toneMappedRGB = cineon(finalRGB);',
    '  }',
    '',
    '',
    // The grading table runs AFTER the tone map and BEFORE the master crossfade. At this point
    // values are tone-mapped, display-referred and still LINEAR, so they must be encoded into the
    // sRGB domain the table was authored in, sampled, and decoded back - OutputPass applies the
    // final OETF for the framebuffer, so leaving values encoded here would double-encode them.
    '  if (uLutMix > 0.0) {',
    '    vec3 graded = lutEOTF(sampleLut(lutOETF(toneMappedRGB)));',
    '    toneMappedRGB = mix(toneMappedRGB, graded, clamp(uLutMix, 0.0, 1.0));',
    '  }',
    '',
    '  // MasterIntensity crossfades between the untouched scene colour and the graded result,',
    '  // so 0.0 really is a bypass.',
    '  vec3 outRGB = mix(baseColor.rgb, toneMappedRGB, clamp(uMasterIntensity, 0.0, 2.0));',
    '  gl_FragColor = vec4(outRGB, baseColor.a);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- 3D LUT colour grading */
  //
  // CONTRACT, deliberately narrow: sRGB in, sRGB out, display-referred, Rec.709 primaries. A log or
  // ACES LUT can differ in input encoding, output encoding, working gamut, and whether it is scene-
  // or display-referred. Supporting those is colour management, not a shader change, so this
  // rejects what it cannot honour rather than grading it wrongly and looking merely "a bit off".
  //
  // Strip layout: N tiles across, each N x N. Tile index is BLUE, within-tile x is RED, within-tile
  // y is GREEN, with green increasing DOWNWARD in image space - the layout Unity, Photoshop and
  // most .cube-to-strip exporters produce.

  var lutCache = new Map();

  function buildLutTexture(image) {
    // A FRESH texture, not a clone of the image manager's: getThreeTexture() hands back a cached,
    // shared texture forced to SRGBColorSpace and RepeatWrapping. Every one of those is wrong here,
    // and mutating the shared instance would corrupt the same image wherever else it is used.
    // Cloning is not enough either - clones share a Source, and Three keys its GPU upload by source,
    // so a clone can inherit the original's flipY.
    var tex = new THREE.Texture(image);
    // NoColorSpace: these texels are literal table outputs, not colours. Tagging them sRGB makes
    // Three decode them, which silently shifts every graded pixel.
    tex.colorSpace = THREE.NoColorSpace !== undefined ? THREE.NoColorSpace : THREE.LinearSRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    // Green is the axis LUTs get wrong most often. Strips are authored with green increasing
    // downward, and Three flips image textures by default, so this must be off.
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Validate and load a LUT strip. Returns { texture, size } or { error } - never a half-set-up
   * texture, because a LUT that is subtly wrong is worse than one that visibly refuses.
   */
  function loadLutStrip(runtimeScene, resourceName) {
    if (!resourceName) return { error: null };           // cleared, not failed
    var cached = lutCache.get(resourceName);
    if (cached) return cached;

    var image = null;
    try {
      var manager = runtimeScene.getGame().getImageManager();
      var base = manager.getThreeTexture(resourceName);
      image = base && (base.image || (base.source && base.source.data));
    } catch (e) {
      image = null;
    }
    if (!image || !image.width || !image.height)
      return { error: 'Colour grading LUT "' + resourceName + '" could not be loaded as an image.' };

    // N tiles of N x N: width must be exactly height squared.
    var size = image.height;
    if (image.width !== size * size)
      return { error: 'Colour grading LUT "' + resourceName + '" is ' + image.width + 'x' + image.height +
        ', which is not a valid strip. Expected width to be height squared: 256x16, 1024x32 or 4096x64.' };
    if (size !== 16 && size !== 32 && size !== 64)
      return { error: 'Colour grading LUT "' + resourceName + '" has an edge length of ' + size +
        '. Supported sizes are 16, 32 and 64.' };

    var result = { texture: buildLutTexture(image), size: size, error: null };
    lutCache.set(resourceName, result);
    return result;
  }

  /* ------------------------------------------------------------- Pipeline Compositor Class */

  var BLOOM_MIPS = 5;

  class PostProcessorPipeline {
    constructor(renderer) {
      this.renderer = renderer;
      this._w = 0;
      this._h = 0;
      this._runtimeScene = null;
      this.targetLayerRenderer = null;
      this.activeBehavior = null;
      this.customPass = null;
      // Sentinel, not '': an empty resource name is a legitimate value meaning "no LUT", and using
      // it as the initial marker would skip the first resolve.
      this._lutResolvedFor = null;
      this._lutTexture = null;
      this.depthAttached = false;
      this._loggedDiagnostics = false;

      this.settings = Object.assign({}, DEFAULT_SETTINGS);

      // Autofocus state
      this.autofocusHitDistance = 0.0;
      this.autofocusTracking = false;
      this.activeFocusDistance = DEFAULT_SETTINGS.manualFocusDistance;
      this._raycaster = null;
      this._rayOrigin = null;
      this._autofocusFrame = 0;

      // Matrices
      this.prevViewProjMatrix = null;
      this.currViewProjMatrix = null;
      this.invViewProjMatrix = null;
      this._hasPrevMatrix = false;
      this._sizeVec = null;

      // Targets
      this.gtaoTarget = null;
      this.gtaoBlurTarget = null;
      this.ssrTarget = null;
      this.ssrBlurTarget = null;
      this.ssrMaskTarget = null;
      this.mergeTarget = null;
      this.streakTarget = null;
      this._quality = 0;
      // WeakMap so a mask material never keeps the source material (and everything it
      // references) alive after the object owning it is gone. The parallel array holds only
      // our own materials, which is what dispose() needs to walk.
      this._maskMaterials = null;
      this._maskMaterialList = [];
      this._maskSwap = [];
      this.dofTarget = null;
      this.bloomDownTargets = [];
      this.bloomUpTargets = [];

      // Quad & Materials
      this._scene = null;
      this._camera = null;
      this._quad = null;
      this._bgColor = null;

      this.gtaoMaterial = null;
      this.bilateralBlurMaterial = null;
      this.ssrMaterial = null;
      this.karisDownsampleMaterial = null;
      this.tentUpsampleMaterial = null;
      this.dofMaterial = null;
      this.ssrBlurMaterial = null;
      this.mergeMaterial = null;
      this.anamorphicStreakMaterial = null;
      this.compositeMaterial = null;

      if (THREE_OK) {
        this._initPipeline();
      }

      if (renderer) {
        renderer.__cinematicPostProcessor = this;
      }
    }

    _initPipeline() {
      this._scene = new THREE.Scene();
      this._camera = new THREE.Camera();
      this._camera.position.z = 1;

      this.prevViewProjMatrix = new THREE.Matrix4();
      this.currViewProjMatrix = new THREE.Matrix4();
      this.invViewProjMatrix = new THREE.Matrix4();
      this._invProj = new THREE.Matrix4();
      this._sizeVec = new THREE.Vector2();
      this._rayOrigin = new THREE.Vector2(0, 0);

      var depthUniforms = function () {
        return {
          uNear: { value: 0.1 },
          uFar: { value: 2000.0 },
          uIsOrtho: { value: 0 }
        };
      };

      this.gtaoMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: gtaoFragmentShader,
        uniforms: Object.assign({
          tDepth: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uInverseProjectionMatrix: { value: new THREE.Matrix4() },
          uRadius: { value: 50.0 },
          uIntensity: { value: 1.0 },
          uProjScale: { value: 2.414 }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this.bilateralBlurMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: bilateralBlurFragmentShader,
        uniforms: Object.assign({
          tAO: { value: null },
          tDepth: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uDirection: { value: new THREE.Vector2(1, 0) }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this.ssrMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: ssrFragmentShader,
        uniforms: Object.assign({
          tColor: { value: null },
          tDepth: { value: null },
          tReflectivity: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uProjectionMatrix: { value: new THREE.Matrix4() },
          uInverseProjectionMatrix: { value: new THREE.Matrix4() },
          uUseReflectivityMask: { value: 1 },
          uIntensity: { value: 0.6 },
          uMaxDistance: { value: 400.0 },
          uFresnel: { value: 0.6 },
          uMaxSteps: { value: 32 }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this.karisDownsampleMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: karisDownsampleFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          uTexelSize: { value: new THREE.Vector2(1, 1) },
          uThreshold: { value: 0.3 },
          uMaxBrightness: { value: 12.0 },
          uIsFirstMip: { value: 1 }
        },
        depthTest: false,
        depthWrite: false
      });

      this.tentUpsampleMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: tentUpsampleFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          tAdd: { value: null },
          uTexelSize: { value: new THREE.Vector2(1, 1) },
          uBloomRadius: { value: 1.0 },
          uHasAdd: { value: 0 }
        },
        depthTest: false,
        depthWrite: false
      });

      this.dofMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: bokehDOFFragmentShader,
        uniforms: Object.assign({
          tColor: { value: null },
          tDepth: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uFocusDistance: { value: 700.0 },
          uApertureFStop: { value: 2.8 },
          uMaxBokehRadius: { value: 12.0 }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this.ssrBlurMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: ssrBlurFragmentShader,
        uniforms: {
          tSSR: { value: null },
          tReflectivity: { value: null },
          uTexelSize: { value: new THREE.Vector2(1, 1) },
          uMaxRadius: { value: 4.0 },
          uUseReflectivityMask: { value: 1 }
        },
        depthTest: false,
        depthWrite: false
      });

      this.mergeMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: mergeFragmentShader,
        uniforms: Object.assign({
          tColor: { value: null },
          tDepth: { value: null },
          tGTAO: { value: null },
          tSSR: { value: null },
          uLowResTexel: { value: new THREE.Vector2(1, 1) },
          uEnableGTAO: { value: 0 },
          uEnableSSR: { value: 0 },
          uMultiBounce: { value: 1 }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this.anamorphicStreakMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: anamorphicStreakFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          uTexelSize: { value: new THREE.Vector2(1, 1) },
          uStride: { value: 12.0 }
        },
        depthTest: false,
        depthWrite: false
      });

      this.compositeMaterial = new THREE.ShaderMaterial({
        vertexShader: commonVertexShader,
        fragmentShader: masterCompositeFragmentShader,
        uniforms: Object.assign({
          tColor: { value: null },
          tGTAO: { value: null },
          tSSR: { value: null },
          tBloom: { value: null },
          tStreak: { value: null },
          tDepth: { value: null },
          uLowResTexel: { value: new THREE.Vector2(1, 1) },
          uMasterIntensity: { value: 1.0 },
          tLut: { value: null },
          uLutSize: { value: 32.0 },
          uLutMix: { value: 0.0 },
          uToneMappingMode: { value: 0 },
          uBloomIntensity: { value: 0.8 },
          uAnamorphicFlares: { value: 0.0 },
          uFlareTintColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
          uChromaticAberration: { value: 0.003 },
          uMotionBlurStrength: { value: 0.0 },
          uEnableGTAO: { value: 0 },
          uMultiBounce: { value: 1 },
          uEnableSSR: { value: 0 },
          uEnableBloom: { value: 0 },
          uEnableMotionBlur: { value: 0 },
          uCurrentViewProjectionInverse: { value: new THREE.Matrix4() },
          uPreviousViewProjection: { value: new THREE.Matrix4() }
        }, depthUniforms()),
        depthTest: false,
        depthWrite: false
      });

      this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
      this._quad.frustumCulled = false;
      this._scene.add(this._quad);
    }

    // Records the frame size and quality, disposing everything if either changed. The
    // individual buffers are created on demand by _rt() below, so a scene that only uses
    // bloom never allocates the depth-of-field or reflection targets at all.
    _ensureTargets(w, h) {
      w = Math.max(1, Math.floor(w));
      h = Math.max(1, Math.floor(h));
      var div = qualityDivisor(this.settings.effectQuality);
      if (this._w === w && this._h === h && this._quality === div) return;

      this._disposeTargets();
      this._w = w;
      this._h = h;
      this._quality = div;
    }

    // Resolution of the ambient occlusion, reflection and mask buffers.
    _lowResSize() {
      var div = this._quality || 2;
      return [
        Math.max(1, Math.floor(this._w / div)),
        Math.max(1, Math.floor(this._h / div))
      ];
    }

    _rtOptions(hdr, depth) {
      return {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: !!depth,
        type: hdr && THREE.HalfFloatType !== undefined ? THREE.HalfFloatType : undefined
      };
    }

    // Returns the named target, creating or resizing it as needed.
    _rt(name, w, h, hdr, depth) {
      var existing = this[name];
      if (existing && existing.width === w && existing.height === h) return existing;
      if (existing) { try { existing.dispose(); } catch (e) {} }
      this[name] = new THREE.WebGLRenderTarget(w, h, this._rtOptions(hdr, depth));
      return this[name];
    }

    // The bloom pyramid starts at half resolution: jumping straight from full to quarter
    // res in one 13-tap fetch undersamples badly.
    _ensureBloomTargets() {
      if (this.bloomDownTargets.length === BLOOM_MIPS &&
          this.bloomDownTargets[0].width === Math.max(1, Math.floor(this._w / 2))) {
        return;
      }
      this._disposeBloomTargets();
      var curW = this._w;
      var curH = this._h;
      for (var i = 0; i < BLOOM_MIPS; i++) {
        curW = Math.max(1, Math.floor(curW / 2));
        curH = Math.max(1, Math.floor(curH / 2));
        this.bloomDownTargets.push(new THREE.WebGLRenderTarget(curW, curH, this._rtOptions(true, false)));
        this.bloomUpTargets.push(new THREE.WebGLRenderTarget(curW, curH, this._rtOptions(true, false)));
      }
    }

    _disposeBloomTargets() {
      for (var i = 0; i < this.bloomDownTargets.length; i++) {
        try { this.bloomDownTargets[i].dispose(); } catch (e) {}
      }
      for (var j = 0; j < this.bloomUpTargets.length; j++) {
        try { this.bloomUpTargets[j].dispose(); } catch (e) {}
      }
      this.bloomDownTargets = [];
      this.bloomUpTargets = [];
    }

    _disposeTargets() {
      var single = ['gtaoTarget', 'gtaoBlurTarget', 'ssrTarget', 'ssrBlurTarget', 'ssrMaskTarget',
        'mergeTarget', 'streakTarget', 'dofTarget'];
      for (var s = 0; s < single.length; s++) {
        var t = this[single[s]];
        if (t) { try { t.dispose(); } catch (e) {} this[single[s]] = null; }
      }
      this._disposeBloomTargets();
    }

    _renderPass(material, target) {
      this._quad.material = material;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this._scene, this._camera);
    }

    /**
     * GDevelop's EffectComposer is built with `new EffectComposer(renderer)`, whose default
     * render targets carry a depth *renderbuffer* — not a texture — so nothing downstream can
     * sample depth. Assigning `depthTexture` after the framebuffer has been set up is a no-op
     * in three (setRenderTarget only calls setupRenderTarget when __webglFramebuffer is
     * undefined), so the target has to be disposed first to force a rebuild.
     *
     * Both ping-pong targets need it: RenderPass has needsSwap=false and there are three
     * swapping passes per frame, so rt1 and rt2 alternate as the scene buffer frame to frame.
     */
    ensureComposerDepth(composer) {
      if (!composer || !THREE_OK) return false;
      var targets = [composer.renderTarget1, composer.renderTarget2];
      var changed = false;

      for (var i = 0; i < targets.length; i++) {
        var rt = targets[i];
        if (!rt) continue;

        var needsNew = !rt.depthTexture;
        var needsResize = !needsNew && rt.depthTexture.image &&
          (rt.depthTexture.image.width !== rt.width || rt.depthTexture.image.height !== rt.height);

        if (!needsNew && !needsResize) continue;

        try {
          if (rt.depthTexture) {
            try { rt.depthTexture.dispose(); } catch (e) {}
            rt.depthTexture = null;
          }
          // Dispose first: this clears three's cached __webglFramebuffer so the next bind
          // rebuilds the FBO with the depth attachment we are about to add.
          rt.dispose();

          var dt = new THREE.DepthTexture(rt.width, rt.height);
          if (THREE.DepthFormat !== undefined) dt.format = THREE.DepthFormat;
          // 24-bit integer depth: DEPTH_COMPONENT24. FloatType would give 32F for no
          // practical gain at GDevelop's near/far ratio and costs twice the bandwidth.
          if (THREE.UnsignedIntType !== undefined) dt.type = THREE.UnsignedIntType;
          if (THREE.NearestFilter !== undefined) {
            dt.minFilter = THREE.NearestFilter;
            dt.magFilter = THREE.NearestFilter;
          }
          dt.generateMipmaps = false;

          rt.depthBuffer = true;
          rt.depthTexture = dt;
          changed = true;
        } catch (e) {
          warnOnce('depthAttach', 'Could not attach a depth texture to the layer composer: ' +
            e.message + '. GTAO, SSR, DOF and motion blur will be disabled.');
          return false;
        }
      }

      if (changed) this.depthAttached = true;
      return this.depthAttached;
    }

    /**
     * How reflective is this material? GDevelop's default 3D material is a fully rough
     * dielectric (roughness 1, metalness 0), which correctly scores zero — so out of the
     * box nothing reflects, and a surface becomes reflective only when someone deliberately
     * makes it smooth or metallic.
     */
    static reflectivityOf(material) {
      if (!material) return 0.0;
      if (material.visible === false) return 0.0;
      if (material.transparent && typeof material.opacity === 'number' && material.opacity < 0.99) return 0.0;

      var explicit = material.userData && material.userData.ssrReflectivity;
      if (typeof explicit === 'number') return saturate(explicit);

      var rough;
      if (typeof material.roughness === 'number') {
        rough = saturate(material.roughness);
      } else if (typeof material.shininess === 'number') {
        // Phong and friends have no roughness; shininess is the closest proxy.
        rough = 1.0 - saturate(material.shininess / 100.0);
      } else {
        return 0.0; // Basic/unlit materials do not reflect.
      }

      var metal = typeof material.metalness === 'number' ? saturate(material.metalness) : 0.0;
      var smooth = 1.0 - rough;
      // Squared so the falloff away from a polished surface is quick. A polished dielectric
      // still reflects a little; a rough metal reflects nothing sharp enough to raymarch.
      return saturate(smooth * smooth * (0.25 + 0.75 * metal));
    }

    /**
     * The roughness the reflectivity estimate was derived from, so the SSR blur can widen
     * its cone on scattering surfaces. Unlit materials report fully rough.
     */
    static roughnessOf(material) {
      if (!material) return 1.0;
      var explicit = material.userData && material.userData.ssrRoughness;
      if (typeof explicit === 'number') return saturate(explicit);
      if (typeof material.roughness === 'number') return saturate(material.roughness);
      if (typeof material.shininess === 'number') return 1.0 - saturate(material.shininess / 100.0);
      return 1.0;
    }

    /**
     * Renders the layer's 3D group with every material swapped for a flat value encoding
     * its reflectivity in red and its roughness in green. One extra scene render, but it pays for itself: the SSR
     * shader rejects masked-out pixels before marching a single ray.
     *
     * The group is rendered rather than the scene so the 2D rendering plane at z=0 (which
     * has renderOrder MAX_SAFE_INTEGER and covers the view) stays out of it.
     */
    renderReflectivityMask(renderer, threeGroup, camera) {
      if (!threeGroup || !camera || !this.ssrMaskTarget || !THREE_OK) return false;
      if (!THREE.MeshBasicMaterial || !THREE.Color) return false;

      if (!this._maskMaterials) {
        this._maskMaterials = (typeof WeakMap === 'function') ? new WeakMap() : new Map();
      }
      var cache = this._maskMaterials;
      var list = this._maskMaterialList;
      var swaps = this._maskSwap;
      swaps.length = 0;

      threeGroup.traverse(function (obj) {
        if (!obj.isMesh || !obj.material || obj.visible === false) return;
        if (Array.isArray(obj.material)) return; // multi-material meshes: skip rather than guess

        var source = obj.material;
        var mask = cache.get(source);
        if (!mask) {
          mask = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
          mask.side = source.side;
          cache.set(source, mask);
          list.push(mask);
        }
        // Recomputed every frame so runtime roughness/metalness changes are picked up.
        // Red drives the SSR gate, green the width of its blur cone.
        mask.color.setRGB(
          PostProcessorPipeline.reflectivityOf(source),
          PostProcessorPipeline.roughnessOf(source),
          0.0
        );

        swaps.push(obj);
        obj.userData.__cinematicSourceMaterial = source;
        obj.material = mask;
      });

      var prevClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : 1;
      try {
        renderer.setRenderTarget(this.ssrMaskTarget);
        if (renderer.setClearColor) renderer.setClearColor(0x000000, 1);
        if (renderer.clear) renderer.clear(true, true, false);
        renderer.render(threeGroup, camera);
      } finally {
        // Unconditional: anything thrown above must not leave the scene wearing mask
        // materials for the rest of the game.
        if (renderer.setClearColor) renderer.setClearColor(0x000000, prevClearAlpha);
        for (var i = 0; i < swaps.length; i++) {
          var mesh = swaps[i];
          if (mesh.userData.__cinematicSourceMaterial) {
            mesh.material = mesh.userData.__cinematicSourceMaterial;
            delete mesh.userData.__cinematicSourceMaterial;
          }
        }
        swaps.length = 0;
      }
      return true;
    }

    _disposeMaskMaterials() {
      for (var i = 0; i < this._maskMaterialList.length; i++) {
        try { this._maskMaterialList[i].dispose(); } catch (e) {}
      }
      this._maskMaterialList.length = 0;
      this._maskMaterials = null;
    }

    _applySceneBackground(layerRenderer) {
      // Only fills in a background when the scene has none. Overwriting it every frame
      // would clobber any skybox or environment map set by the user or another extension.
      try {
        if (!this._runtimeScene || !layerRenderer || typeof layerRenderer.getThreeScene !== 'function') return;
        var sc = layerRenderer.getThreeScene();
        if (!sc || sc.background) return;
        if (typeof this._runtimeScene.getBackgroundColor !== 'function') return;
        if (!this._bgColor) this._bgColor = new THREE.Color();
        this._bgColor.set(this._runtimeScene.getBackgroundColor());
        sc.background = this._bgColor;
      } catch (e) {}
    }

    /**
     * Center-screen autofocus. Raycasts the layer's 3D group (not the whole scene — the
     * 2D rendering plane sits at z=0 and would swallow every hit) and eases the focus
     * plane toward the hit distance so pulls look like a real lens.
     */
    updateAutofocus(camera, threeGroup) {
      var s = this.settings;
      if (!s.enableDOF || !s.autofocus || !camera || !threeGroup || !THREE_OK || !THREE.Raycaster) {
        this.autofocusTracking = false;
        this.activeFocusDistance = s.manualFocusDistance;
        return;
      }

      // Raycasting the whole group every frame is wasteful; a 3-frame cadence with easing
      // is indistinguishable at 60fps.
      this._autofocusFrame = (this._autofocusFrame + 1) % 3;
      if (this._autofocusFrame === 0 || this.autofocusHitDistance === 0.0) {
        try {
          if (!this._raycaster) this._raycaster = new THREE.Raycaster();
          // Bound the ray to the camera frustum: without this it tests geometry behind the
          // near plane and past the far plane, which can never be in focus anyway.
          if (typeof camera.near === 'number') this._raycaster.near = camera.near;
          if (typeof camera.far === 'number') this._raycaster.far = camera.far;
          this._raycaster.setFromCamera(this._rayOrigin, camera);

          var hits = this._raycaster.intersectObjects(threeGroup.children, true);
          var found = null;
          for (var i = 0; i < hits.length; i++) {
            var h = hits[i];
            if (h.distance <= 0.0001 || !h.object || h.object.visible === false) continue;
            // A first-person weapon or similar camera-locked prop sits in front of everything
            // and would permanently own the focus plane, so let it opt out.
            if (h.object.userData && h.object.userData.cinematicIgnoreAutofocus) continue;
            found = h;
            break;
          }
          if (found) {
            this.autofocusHitDistance = found.distance;
            this.autofocusTracking = true;
          } else {
            this.autofocusTracking = false;
          }
        } catch (e) {
          this.autofocusTracking = false;
        }
      }

      var target = this.autofocusTracking ? this.autofocusHitDistance : s.manualFocusDistance;
      if (this.activeFocusDistance <= 0.0) this.activeFocusDistance = target;
      // Deliberately unhurried: the raycast target jumps whenever the crosshair crosses an
      // object edge, and a fast ease turns every one of those into a visible lurch.
      this.activeFocusDistance = lerp(this.activeFocusDistance, target, 0.08);
    }

    executeCompositing(renderer, inputTarget, outputTarget, renderToScreen, camera, threeGroup) {
      if (!inputTarget || !this._quad) return;

      renderer.getDrawingBufferSize(this._sizeVec);
      var w = this._sizeVec.x || inputTarget.width || 1;
      var h = this._sizeVec.y || inputTarget.height || 1;
      this._ensureTargets(w, h);

      var cam = camera || this._camera;
      var isOrtho = !!(cam && cam.isOrthographicCamera);
      var near = (cam && typeof cam.near === 'number') ? cam.near : 0.1;
      var far = (cam && typeof cam.far === 'number') ? cam.far : 2000.0;
      var projScale = (cam && cam.projectionMatrix && cam.projectionMatrix.elements)
        ? Math.abs(cam.projectionMatrix.elements[5]) : 2.414;

      if (cam && cam.updateMatrixWorld) cam.updateMatrixWorld();
      if (cam && cam.projectionMatrix && cam.matrixWorldInverse) {
        this.currViewProjMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        this.invViewProjMatrix.copy(this.currViewProjMatrix).invert();
        if (!this._hasPrevMatrix) {
          this.prevViewProjMatrix.copy(this.currViewProjMatrix);
          this._hasPrevMatrix = true;
        }
      }

      var invProj = this._invProj;
      if (cam && cam.projectionMatrix) invProj.copy(cam.projectionMatrix).invert();

      this.updateAutofocus(cam, threeGroup);

      var s = this.settings;
      var curSceneColor = inputTarget.texture;
      var depthTex = inputTarget.depthTexture || null;
      var hasDepth = !!depthTex;

      if (!hasDepth) {
        warnOnce('noDepth', 'No depth texture on the composer buffer — GTAO, SSR, DOF and ' +
          'motion blur are skipped this frame. Bloom, chromatic aberration and tone mapping ' +
          'still run.');
      }

      var applyDepthUniforms = function (u) {
        u.uNear.value = near;
        u.uFar.value = far;
        u.uIsOrtho.value = isOrtho ? 1 : 0;
      };

      // ------------------------------------------------- 1. GTAO + separable bilateral blur
      var aoTexture = null;
      if (hasDepth && s.enableGTAO && s.gtaoIntensity > 0.0) {
        var lo = this._lowResSize();
        this._rt('gtaoTarget', lo[0], lo[1], false, false);
        this._rt('gtaoBlurTarget', lo[0], lo[1], false, false);

        var gu = this.gtaoMaterial.uniforms;
        gu.tDepth.value = depthTex;
        gu.uResolution.value.set(this.gtaoTarget.width, this.gtaoTarget.height);
        gu.uInverseProjectionMatrix.value.copy(invProj);
        gu.uRadius.value = Math.max(0.0001, s.gtaoRadius);
        gu.uIntensity.value = s.gtaoIntensity;
        gu.uProjScale.value = projScale;
        applyDepthUniforms(gu);
        this._renderPass(this.gtaoMaterial, this.gtaoTarget);

        var bu = this.bilateralBlurMaterial.uniforms;
        bu.tDepth.value = depthTex;
        bu.uResolution.value.set(this.gtaoTarget.width, this.gtaoTarget.height);
        applyDepthUniforms(bu);

        bu.tAO.value = this.gtaoTarget.texture;
        bu.uDirection.value.set(1.0, 0.0);
        this._renderPass(this.bilateralBlurMaterial, this.gtaoBlurTarget);

        bu.tAO.value = this.gtaoBlurTarget.texture;
        bu.uDirection.value.set(0.0, 1.0);
        this._renderPass(this.bilateralBlurMaterial, this.gtaoTarget);

        aoTexture = this.gtaoTarget.texture;
      }

      // ------------------------------------------------- 2. Screen-Space Reflections
      var ssrTexture = null;
      if (hasDepth && s.enableSSR && s.ssrIntensity > 0.0) {
        var loS = this._lowResSize();
        this._rt('ssrTarget', loS[0], loS[1], true, false);
        this._rt('ssrBlurTarget', loS[0], loS[1], true, false);

        var useMask = s.ssrSurfaces !== 'Everything';
        if (useMask) {
          // Unlike every other intermediate this one renders real geometry, so it needs
          // its own depth buffer to sort.
          this._rt('ssrMaskTarget', loS[0], loS[1], false, true);
          useMask = this.renderReflectivityMask(renderer, threeGroup, cam);
        }

        var su = this.ssrMaterial.uniforms;
        su.tColor.value = curSceneColor;
        su.tDepth.value = depthTex;
        su.tReflectivity.value = useMask ? this.ssrMaskTarget.texture : null;
        su.uUseReflectivityMask.value = useMask ? 1 : 0;
        su.uResolution.value.set(this.ssrTarget.width, this.ssrTarget.height);
        if (cam && cam.projectionMatrix) su.uProjectionMatrix.value.copy(cam.projectionMatrix);
        su.uInverseProjectionMatrix.value.copy(invProj);
        su.uIntensity.value = s.ssrIntensity;
        su.uMaxDistance.value = Math.max(1.0, s.ssrMaxDistance);
        su.uFresnel.value = saturate(s.ssrFresnel);
        su.uMaxSteps.value = clamp(parseInt(s.ssrRaySteps, 10) || 32, 8, 64);
        applyDepthUniforms(su);
        this._renderPass(this.ssrMaterial, this.ssrTarget);
        ssrTexture = this.ssrTarget.texture;

        if (this.ssrBlurTarget) {
          var sb = this.ssrBlurMaterial.uniforms;
          sb.tSSR.value = ssrTexture;
          sb.tReflectivity.value = useMask ? this.ssrMaskTarget.texture : null;
          sb.uTexelSize.value.set(1.0 / this.ssrBlurTarget.width, 1.0 / this.ssrBlurTarget.height);
          sb.uUseReflectivityMask.value = useMask ? 1 : 0;
          this._renderPass(this.ssrBlurMaterial, this.ssrBlurTarget);
          ssrTexture = this.ssrBlurTarget.texture;
        }
      }

      // The AO and reflection buffers are lower resolution than the frame, so both the merge
      // and the composite need their texel size to upsample them without haloing.
      var lowRes = this._lowResSize();
      var lowResTexel = [1.0 / lowRes[0], 1.0 / lowRes[1]];

      // ------------------------------------------------- 2b. Merge AO and SSR before DOF
      // Applying them in the composite would leave contact shadows and reflections razor
      // sharp on a surface the defocus has already blurred.
      var aoSsrMerged = false;
      if (s.enableDOF && hasDepth && (aoTexture || ssrTexture)) {
        this._rt('mergeTarget', w, h, true, false);
        var mu = this.mergeMaterial.uniforms;
        mu.tColor.value = curSceneColor;
        mu.tDepth.value = depthTex;
        mu.tGTAO.value = aoTexture;
        mu.tSSR.value = ssrTexture;
        mu.uLowResTexel.value.set(lowResTexel[0], lowResTexel[1]);
        mu.uEnableGTAO.value = aoTexture ? 1 : 0;
        mu.uEnableSSR.value = ssrTexture ? 1 : 0;
        mu.uMultiBounce.value = s.gtaoMultiBounce ? 1 : 0;
        applyDepthUniforms(mu);
        this._renderPass(this.mergeMaterial, this.mergeTarget);
        curSceneColor = this.mergeTarget.texture;
        aoSsrMerged = true;
      }

      // Bloom samples the scene from before the defocus — see the note on decoupling in
      // IMPLEMENTATION_PLAN. Captured here, before DOF replaces curSceneColor.
      var bloomSource = curSceneColor;

      // ------------------------------------------------- 3. Bokeh Depth of Field
      if (hasDepth && s.enableDOF) {
        this._rt('dofTarget', w, h, true, false);
        var du = this.dofMaterial.uniforms;
        du.tColor.value = curSceneColor;
        du.tDepth.value = depthTex;
        du.uResolution.value.set(w, h);
        du.uFocusDistance.value = Math.max(0.001, this.activeFocusDistance);
        du.uApertureFStop.value = Math.max(0.5, s.apertureFStop);
        du.uMaxBokehRadius.value = Math.max(0.0, s.maxBokehRadius);
        applyDepthUniforms(du);
        this._renderPass(this.dofMaterial, this.dofTarget);
        curSceneColor = this.dofTarget.texture;
      }

      // ------------------------------------------------- 4. Karis bloom pyramid
      var bloomTexture = null;
      var streakTexture = null;
      if (s.enableBloom && s.bloomIntensity > 0.0) {
        this._ensureBloomTargets();
        var n = this.bloomDownTargets.length;
        var ku = this.karisDownsampleMaterial.uniforms;
        ku.uThreshold.value = s.bloomThreshold;
        ku.uMaxBrightness.value = Math.max(1.0, s.bloomMaxBrightness);

        // Both filters sample the SOURCE texture, so their tap offsets have to be in source
        // texels. Using the destination's (which is half the size) spread the 13-tap
        // downsample twice as wide as intended, and collapsed the tent upsample's offsets to
        // sub-texel distances — leaving it doing nothing but bilinear.
        var srcTex = bloomSource;
        var srcW = w;
        var srcH = h;
        for (var d = 0; d < n; d++) {
          var targetD = this.bloomDownTargets[d];
          ku.tDiffuse.value = srcTex;
          ku.uTexelSize.value.set(1.0 / srcW, 1.0 / srcH);
          ku.uIsFirstMip.value = d === 0 ? 1 : 0;
          this._renderPass(this.karisDownsampleMaterial, targetD);
          srcTex = targetD.texture;
          srcW = targetD.width;
          srcH = targetD.height;
        }

        // Progressive upsample: each level blurs the level below and ADDS its own mip.
        var tu = this.tentUpsampleMaterial.uniforms;
        tu.uBloomRadius.value = Math.max(0.1, s.bloomRadius);
        tu.uHasAdd.value = 1;
        var upSource = this.bloomDownTargets[n - 1].texture;
        var upSrcW = this.bloomDownTargets[n - 1].width;
        var upSrcH = this.bloomDownTargets[n - 1].height;
        for (var u = n - 2; u >= 0; u--) {
          var targetU = this.bloomUpTargets[u];
          tu.tDiffuse.value = upSource;
          tu.tAdd.value = this.bloomDownTargets[u].texture;
          tu.uTexelSize.value.set(1.0 / upSrcW, 1.0 / upSrcH);
          this._renderPass(this.tentUpsampleMaterial, targetU);
          upSource = targetU.texture;
          upSrcW = targetU.width;
          upSrcH = targetU.height;
        }
        bloomTexture = upSource;

        // Anamorphic streak: a wide horizontal blur of the finished bloom buffer.
        if (s.anamorphicFlares > 0.0) {
          this._rt('streakTarget', this.bloomDownTargets[0].width,
            this.bloomDownTargets[0].height, true, false);
          var au = this.anamorphicStreakMaterial.uniforms;
          au.tDiffuse.value = bloomTexture;
          au.uTexelSize.value.set(1.0 / this.streakTarget.width, 1.0 / this.streakTarget.height);
          au.uStride.value = 12.0;
          this._renderPass(this.anamorphicStreakMaterial, this.streakTarget);
          streakTexture = this.streakTarget.texture;
        }
      }

      // ------------------------------------------------- 5. Master composite
      var cu = this.compositeMaterial.uniforms;
      cu.tColor.value = curSceneColor;
      cu.tGTAO.value = aoTexture;
      cu.tSSR.value = ssrTexture;
      cu.tBloom.value = bloomTexture;
      cu.tStreak.value = streakTexture;
      cu.tDepth.value = depthTex;
      cu.uLowResTexel.value.set(lowResTexel[0], lowResTexel[1]);
      cu.uMasterIntensity.value = s.masterIntensity;
      applyDepthUniforms(cu);

      var tmModes = { ACESFilmic: 0, Reinhard: 1, Cineon: 2, Linear: 3 };
      cu.uToneMappingMode.value = tmModes[s.toneMapping] !== undefined ? tmModes[s.toneMapping] : 0;

      // Colour grading LUT. Resolved lazily and cached: the image is not decoded until the scene
      // actually asks to grade, and a name that fails validation reports once rather than per frame.
      if (s.lutResource !== this._lutResolvedFor) {
        this._lutResolvedFor = s.lutResource;
        var lut = loadLutStrip(this._runtimeScene, s.lutResource);
        if (lut.error) {
          console.warn('[CinematicPostFX3D] ' + lut.error);
          this._lutTexture = null;
        } else {
          this._lutTexture = lut.texture || null;
          if (lut.size) cu.uLutSize.value = lut.size;
        }
      }
      cu.tLut.value = this._lutTexture;
      cu.uLutMix.value = this._lutTexture ? clamp(s.lutIntensity, 0.0, 1.0) : 0.0;

      cu.uBloomIntensity.value = s.bloomIntensity;
      cu.uAnamorphicFlares.value = streakTexture ? s.anamorphicFlares : 0.0;

      var flareRGB = parseColor(s.flareTintColor, [255, 255, 255]);
      cu.uFlareTintColor.value.set(flareRGB[0] / 255.0, flareRGB[1] / 255.0, flareRGB[2] / 255.0);

      cu.uChromaticAberration.value = s.chromaticAberration;
      cu.uMotionBlurStrength.value = s.motionBlurStrength;
      cu.uEnableGTAO.value = (aoTexture && !aoSsrMerged) ? 1 : 0;
      cu.uMultiBounce.value = s.gtaoMultiBounce ? 1 : 0;
      cu.uEnableSSR.value = (ssrTexture && !aoSsrMerged) ? 1 : 0;
      cu.uEnableBloom.value = bloomTexture ? 1 : 0;
      cu.uEnableMotionBlur.value = (hasDepth && s.enableMotionBlur && s.motionBlurStrength > 0.001) ? 1 : 0;

      cu.uCurrentViewProjectionInverse.value.copy(this.invViewProjMatrix);
      cu.uPreviousViewProjection.value.copy(this.prevViewProjMatrix);

      this._quad.material = this.compositeMaterial;
      renderer.setRenderTarget(renderToScreen ? null : outputTarget);
      renderer.render(this._scene, this._camera);

      this.prevViewProjMatrix.copy(this.currViewProjMatrix);
    }

    logDiagnostics(composer, camera) {
      if (this._loggedDiagnostics) return;
      this._loggedDiagnostics = true;
      var near = camera && camera.near !== undefined ? camera.near : '?';
      var far = camera && camera.far !== undefined ? camera.far : '?';
      var camZ = camera && camera.position ? camera.position.z.toFixed(1) : '?';
      console.info(
        '[CinematicPostFX3D] diagnostics\n' +
        '  composer: ' + (composer ? 'found (' + composer.passes.length + ' passes)' : 'MISSING') + '\n' +
        '  depth texture attached: ' + (this.depthAttached ? 'yes' : 'NO') + '\n' +
        '  camera near/far: ' + near + ' / ' + far + '\n' +
        '  camera z: ' + camZ + '  (world-space params should be on this scale)\n' +
        '  buffer: ' + this._w + 'x' + this._h + '\n' +
        '  GTAO radius: ' + this.settings.gtaoRadius +
        ' | SSR distance: ' + this.settings.ssrMaxDistance +
        ' | focus: ' + this.settings.manualFocusDistance
      );
    }

    dispose() {
      if (this.renderer) {
        try { delete this.renderer.__cinematicPostProcessor; } catch (e) {}
      }
      this._disposeTargets();
      this._disposeMaskMaterials();

      var mats = ['gtaoMaterial', 'bilateralBlurMaterial', 'ssrMaterial', 'ssrBlurMaterial',
        'karisDownsampleMaterial',
        'tentUpsampleMaterial', 'dofMaterial', 'mergeMaterial', 'anamorphicStreakMaterial',
        'compositeMaterial'];
      for (var i = 0; i < mats.length; i++) {
        try { if (this[mats[i]]) this[mats[i]].dispose(); } catch (e) {}
      }
      try { if (this._quad && this._quad.geometry) this._quad.geometry.dispose(); } catch (e) {}

      this.activeBehavior = null;
      this.customPass = null;
      this.targetLayerRenderer = null;
    }
  }

  /* ------------------------------------------------------------- EffectComposer Pass Adapter */

  var BasePassClass = (typeof THREE_ADDONS !== 'undefined' && THREE_ADDONS.Pass)
    ? THREE_ADDONS.Pass
    : class {
        constructor() {
          this.enabled = true;
          this.needsSwap = true;
          this.clear = false;
          this.renderToScreen = false;
        }
        setSize(width, height) {}
        render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {}
        dispose() {}
      };

  class CinematicPostFXPass extends BasePassClass {
    constructor(pipeline) {
      super();
      this.pipeline = pipeline;
      this.enabled = true;
      this.needsSwap = true;
      this.clear = false;
      this.renderToScreen = false;
      this._layerRenderer = null;
    }

    // Deliberately not cached: GDevelop can rebuild a layer's composer, and a stale
    // reference would have us attaching depth to render targets nothing draws into.
    _composerOf() {
      if (this._layerRenderer && typeof this._layerRenderer.getThreeEffectComposer === 'function') {
        return this._layerRenderer.getThreeEffectComposer();
      }
      return null;
    }

    // EffectComposer.setSize() resizes renderTarget1/2 and *then* calls pass.setSize(), and
    // insertPass() calls it once on attach — so this is the correct place to (re)build the
    // depth attachments. WebGLRenderTarget.setSize does not resize a depthTexture, so
    // without this a resize leaves an incomplete framebuffer.
    setSize(width, height) {
      var composer = this._composerOf();
      if (composer && this.pipeline) {
        this.pipeline.ensureComposerDepth(composer);
      }
      // The intermediate targets are sized from the drawing buffer in executeCompositing,
      // which already accounts for pixel ratio. Sizing them here too would just allocate
      // them twice at two different sizes on every resize.
    }

    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      if (!this.pipeline || !this.pipeline.activeBehavior) return;

      if (!readBuffer.depthTexture) {
        // Covers the case where something else rebuilt the composer or its targets.
        var composer = this._composerOf();
        if (composer) this.pipeline.ensureComposerDepth(composer);
      }

      if (this._layerRenderer) {
        this.pipeline._applySceneBackground(this._layerRenderer);
      }

      var camera = this._layerRenderer && this._layerRenderer.getThreeCamera
        ? this._layerRenderer.getThreeCamera() : null;
      var group = this._layerRenderer && this._layerRenderer.getThreeGroup
        ? this._layerRenderer.getThreeGroup() : null;

      if (this.pipeline.settings.diagnostics) {
        this.pipeline.logDiagnostics(this._composerOf(), camera);
      }

      this.pipeline.executeCompositing(
        renderer,
        readBuffer,
        writeBuffer,
        this.renderToScreen,
        camera,
        group
      );
    }

    dispose() {
      try { if (super.dispose) super.dispose(); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------- Scene & Layer Pass Manager */

  function getLayerRenderer(runtimeScene, layerName) {
    try {
      var name = layerName || '';
      if (runtimeScene.hasLayer && !runtimeScene.hasLayer(name)) {
        warnOnce('missingLayer:' + name, 'Layer "' + name + '" does not exist. ' +
          'Set the behavior\'s "Target Layer" property to the 3D layer you want to post-process.');
        return null;
      }
      var layer = runtimeScene.getLayer(name);
      var lr = layer && layer.getRenderer && layer.getRenderer();
      if (!lr || typeof lr.addPostProcessingPass !== 'function') return null;

      // addPostProcessingPass() silently does nothing when the layer has no EffectComposer,
      // which is the case for any layer that is not rendering in 3D. Check explicitly so
      // this fails loudly instead of looking broken.
      if (typeof lr.getThreeEffectComposer === 'function' && !lr.getThreeEffectComposer()) {
        warnOnce('noComposer:' + name, 'Layer "' + (name || '(base layer)') + '" has no 3D ' +
          'EffectComposer, so post-processing cannot be attached. Set the layer\'s rendering ' +
          'type to 3D, or point the behavior\'s "Target Layer" property at a 3D layer.');
        return null;
      }
      return lr;
    } catch (e) {
      return null;
    }
  }

  function threeRendererOf(runtimeScene) {
    if (!runtimeScene) return null;
    var game = runtimeScene.getGame ? runtimeScene.getGame() : null;
    var gameRenderer = game && game.getRenderer ? game.getRenderer() : null;
    return gameRenderer && gameRenderer.getThreeRenderer
      ? gameRenderer.getThreeRenderer()
      : null;
  }

  function getPipeline(runtimeScene) {
    var r = threeRendererOf(runtimeScene);
    return r ? (r.__cinematicPostProcessor || null) : null;
  }

  function attachPassToLayer(pipeline, runtimeScene, layerName) {
    var lr = getLayerRenderer(runtimeScene, layerName);
    if (!lr) return false;

    if (pipeline.customPass && pipeline.targetLayerRenderer === lr) return true;

    if (pipeline.customPass && pipeline.targetLayerRenderer) {
      try {
        pipeline.targetLayerRenderer.removePostProcessingPass(pipeline.customPass);
      } catch (e) {}
      pipeline.targetLayerRenderer = null;
      pipeline.customPass = null;
    }

    var pass = new CinematicPostFXPass(pipeline);
    pass._layerRenderer = lr;
    pipeline.targetLayerRenderer = lr;
    pipeline.customPass = pass;
    lr.addPostProcessingPass(pass);
    return true;
  }

  function detachPass(pipeline) {
    if (pipeline && pipeline.customPass && pipeline.targetLayerRenderer) {
      try {
        pipeline.targetLayerRenderer.removePostProcessingPass(pipeline.customPass);
      } catch (e) {}
    }
  }

  function ensurePipeline(runtimeScene, targetLayerName) {
    if (typeof THREE === 'undefined') {
      warnOnce('noThree', 'THREE is not available — the game is not running a 3D renderer.');
      return null;
    }
    var r = threeRendererOf(runtimeScene);
    if (!r) return null;
    var pipeline = r.__cinematicPostProcessor;
    if (!pipeline) {
      pipeline = new PostProcessorPipeline(r);
    }
    pipeline._runtimeScene = runtimeScene;
    attachPassToLayer(pipeline, runtimeScene, targetLayerName || '');
    return pipeline;
  }

  /* ------------------------------------------------------------- Behavior property sync */

  var PROPERTY_MAP = [
    ['masterIntensity', '_getMasterIntensity', '_setMasterIntensity', 'number'],
    ['toneMapping', '_getToneMapping', '_setToneMapping', 'string'],
    ['lutResource', '_getColorGradingLUT', '_setColorGradingLUT', 'string'],
    ['lutIntensity', '_getColorGradingIntensity', '_setColorGradingIntensity', 'number'],
    ['enableGTAO', '_getEnableGTAO', '_setEnableGTAO', 'bool'],
    ['gtaoRadius', '_getGTAORadius', '_setGTAORadius', 'number'],
    ['gtaoIntensity', '_getGTAOIntensity', '_setGTAOIntensity', 'number'],
    ['gtaoMultiBounce', '_getGTAOMultiBounce', '_setGTAOMultiBounce', 'bool'],
    ['enableSSR', '_getEnableSSR', '_setEnableSSR', 'bool'],
    ['ssrIntensity', '_getSSRIntensity', '_setSSRIntensity', 'number'],
    ['ssrMaxDistance', '_getSSRMaxDistance', '_setSSRMaxDistance', 'number'],
    ['ssrFresnel', '_getSSRFresnel', '_setSSRFresnel', 'number'],
    ['ssrSurfaces', '_getSSRSurfaces', '_setSSRSurfaces', 'string'],
    ['ssrRaySteps', '_getSSRRaySteps', '_setSSRRaySteps', 'int'],
    ['effectQuality', '_getEffectQuality', '_setEffectQuality', 'string'],
    ['enableBloom', '_getEnableBloom', '_setEnableBloom', 'bool'],
    ['bloomIntensity', '_getBloomIntensity', '_setBloomIntensity', 'number'],
    ['bloomThreshold', '_getBloomThreshold', '_setBloomThreshold', 'number'],
    ['bloomRadius', '_getBloomRadius', '_setBloomRadius', 'number'],
    ['bloomMaxBrightness', '_getBloomMaxBrightness', '_setBloomMaxBrightness', 'number'],
    ['anamorphicFlares', '_getAnamorphicFlares', '_setAnamorphicFlares', 'number'],
    ['flareTintColor', '_getFlareTintColor', '_setFlareTintColor', 'string'],
    ['enableDOF', '_getEnableDOF', '_setEnableDOF', 'bool'],
    ['autofocus', '_getAutofocus', '_setAutofocus', 'bool'],
    ['manualFocusDistance', '_getManualFocusDistance', '_setManualFocusDistance', 'number'],
    ['apertureFStop', '_getApertureFStop', '_setApertureFStop', 'number'],
    ['maxBokehRadius', '_getMaxBokehRadius', '_setMaxBokehRadius', 'number'],
    ['enableMotionBlur', '_getEnableMotionBlur', '_setEnableMotionBlur', 'bool'],
    ['motionBlurStrength', '_getMotionBlurStrength', '_setMotionBlurStrength', 'number'],
    ['chromaticAberration', '_getChromaticAberration', '_setChromaticAberration', 'number'],
    ['targetLayer', '_getTargetLayer', '_setTargetLayer', 'string'],
    ['diagnostics', '_getDiagnostics', '_setDiagnostics', 'bool'],
  ];

  function readBehaviorProperties(behavior, into) {
    var out = into || {};
    for (var i = 0; i < PROPERTY_MAP.length; i++) {
      var key = PROPERTY_MAP[i][0];
      var getter = PROPERTY_MAP[i][1];
      var kind = PROPERTY_MAP[i][3];
      if (typeof behavior[getter] !== 'function') continue;
      var raw = behavior[getter]();
      if (kind === 'bool') out[key] = !!raw;
      else if (kind === 'int') out[key] = parseInt(raw, 10) || DEFAULT_SETTINGS[key];
      else if (kind === 'number') {
        var v = Number(raw);
        out[key] = isNaN(v) ? DEFAULT_SETTINGS[key] : v;
      }
      else out[key] = raw;
    }
    return out;
  }

  function writeBehaviorProperties(behavior, settings) {
    for (var i = 0; i < PROPERTY_MAP.length; i++) {
      var key = PROPERTY_MAP[i][0];
      var setter = PROPERTY_MAP[i][2];
      if (typeof behavior[setter] !== 'function') continue;
      if (settings[key] === undefined) continue;
      behavior[setter](settings[key]);
    }
  }

  var CUSTOM_PRESETS = {};

  function extractSettings(settings) {
    var out = {};
    for (var i = 0; i < PROPERTY_MAP.length; i++) {
      var key = PROPERTY_MAP[i][0];
      if (key === 'targetLayer' || key === 'diagnostics') continue;
      if (settings[key] !== undefined) {
        out[key] = settings[key];
      }
    }
    return out;
  }

  function applyCustomSettings(runtimeScene, behavior, customObj) {
    if (!customObj || typeof customObj !== 'object') return;
    var pipeline = (behavior && behavior.__cinematicPipeline) || ensurePipeline(runtimeScene, '');
    if (!pipeline) return;

    for (var i = 0; i < PROPERTY_MAP.length; i++) {
      var key = PROPERTY_MAP[i][0];
      var kind = PROPERTY_MAP[i][3];
      if (customObj[key] !== undefined) {
        var val = customObj[key];
        if (kind === 'bool') pipeline.settings[key] = !!val;
        else if (kind === 'int') pipeline.settings[key] = parseInt(val, 10) || DEFAULT_SETTINGS[key];
        else if (kind === 'number') {
          var num = Number(val);
          pipeline.settings[key] = isNaN(num) ? DEFAULT_SETTINGS[key] : num;
        } else {
          pipeline.settings[key] = String(val);
        }
      }
    }
    pipeline.settings.preset = 'Custom';
    pipeline.activeFocusDistance = pipeline.settings.manualFocusDistance;

    if (behavior) {
      if (behavior._setPreset) behavior._setPreset('Custom');
      writeBehaviorProperties(behavior, pipeline.settings);
    }
  }

  /* ------------------------------------------------------------- Public API Singleton */

  gdjs.__cinematicPostFX3D = {
    PRESETS: PRESETS,
    CUSTOM_PRESETS: CUSTOM_PRESETS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    PostProcessorPipeline: PostProcessorPipeline,
    CinematicPostFXPass: CinematicPostFXPass,

    applyACESFilmic: applyACESFilmic,
    // Exposed so the LUT acceptance tests compile the shipped shader source rather than a copy.
    __lutGLSL: LUT_GLSL,
    __buildLutTexture: buildLutTexture,
    __loadLutStrip: loadLutStrip,
    applyReinhard: applyReinhard,
    applyCineon: applyCineon,
    linearizeDepth: linearizeDepth,
    computeCircleOfConfusion: computeCircleOfConfusion,
    computeGTAOVisibility: computeGTAOVisibility,
    computeGTAOMultiBounce: computeGTAOMultiBounce,
    karisLumaWeight: karisLumaWeight,
    parseColor: parseColor,

    registerBehavior: function (runtimeScene, object, behavior) {
      // Warnings are one-shot so they cannot spam the console every frame, but a fresh
      // preview should report a problem again even if the last one already mentioned it.
      warnOnce._seen = {};
      var props = readBehaviorProperties(behavior, {});
      var pipeline = ensurePipeline(runtimeScene, props.targetLayer || '');
      if (!pipeline) return;

      // The pipeline is renderer-global: one behavior drives it. A second instance would
      // fight the first over every setting, so it stands down instead.
      if (pipeline.activeBehavior && pipeline.activeBehavior !== behavior) {
        warnOnce('multiInstance', 'The CinematicPostFX3D behavior is on more than one object. ' +
          'Post-processing is a per-layer pipeline, so only the first instance drives it; ' +
          'the others are ignored.');
        behavior.__cinematicIgnored = true;
        return;
      }

      pipeline.activeBehavior = behavior;
      behavior.__cinematicPipeline = pipeline;

      Object.assign(pipeline.settings, props);

      // The Preset property is applied once, at creation, and written back into the
      // behavior's own properties so the per-frame sync stays consistent with it.
      // "Custom" means "use my property values as-is".
      var presetName = typeof behavior._getPreset === 'function' ? behavior._getPreset() : 'Custom';
      var chosen = (presetName && presetName !== 'Custom')
        ? (PRESETS[presetName] || CUSTOM_PRESETS[presetName])
        : null;
      if (chosen) {
        Object.assign(pipeline.settings, chosen);
        pipeline.settings.preset = presetName;
        writeBehaviorProperties(behavior, pipeline.settings);
      }

      pipeline.activeFocusDistance = pipeline.settings.manualFocusDistance;
    },

    stepBehavior: function (runtimeScene, object, behavior) {
      if (behavior.__cinematicIgnored) return;
      var pipeline = behavior.__cinematicPipeline || getPipeline(runtimeScene);
      if (!pipeline) return;
      pipeline.activeBehavior = behavior;
      pipeline._runtimeScene = runtimeScene;
      attachPassToLayer(pipeline, runtimeScene, pipeline.settings.targetLayer || '');
    },

    syncBehaviorProperties: function (runtimeScene, object, behavior) {
      if (!behavior || behavior.__cinematicIgnored) return;
      var pipeline = behavior.__cinematicPipeline || getPipeline(runtimeScene);
      if (!pipeline) return;
      readBehaviorProperties(behavior, pipeline.settings);
    },

    destroyBehavior: function (runtimeScene, behavior) {
      if (behavior && behavior.__cinematicIgnored) return;
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      if (pipeline && pipeline.activeBehavior === behavior) {
        detachPass(pipeline);
        pipeline.dispose();
      }
    },

    applyPreset: function (runtimeScene, behavior, presetName) {
      var preset = PRESETS[presetName] || CUSTOM_PRESETS[presetName];
      if (!preset) return;
      var pipeline = (behavior && behavior.__cinematicPipeline) || ensurePipeline(runtimeScene, '');
      if (!pipeline) return;

      Object.assign(pipeline.settings, preset);
      pipeline.settings.preset = presetName;
      pipeline.activeFocusDistance = pipeline.settings.manualFocusDistance;

      if (behavior) {
        if (behavior._setPreset) behavior._setPreset(presetName);
        writeBehaviorProperties(behavior, pipeline.settings);
      }
    },

    saveCustomPreset: function (runtimeScene, behavior, name) {
      var slot = (name && String(name).trim()) || 'PlayerCustom';
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      var settings = pipeline ? pipeline.settings : DEFAULT_SETTINGS;
      var data = extractSettings(settings);
      CUSTOM_PRESETS[slot] = Object.assign({}, data);
      PRESETS[slot] = Object.assign({}, data);
    },

    applyCustomPreset: function (runtimeScene, behavior, name) {
      var slot = (name && String(name).trim()) || 'PlayerCustom';
      var custom = CUSTOM_PRESETS[slot] || PRESETS[slot];
      if (custom) {
        applyCustomSettings(runtimeScene, behavior, custom);
        var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
        if (pipeline) pipeline.settings.preset = slot;
        if (behavior && behavior._setPreset) behavior._setPreset(slot);
      }
    },

    hasCustomPreset: function (name) {
      var slot = (name && String(name).trim()) || 'PlayerCustom';
      return !!(CUSTOM_PRESETS[slot] || (slot === 'PlayerCustom' && PRESETS.PlayerCustom));
    },

    exportSettingsJSON: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      var settings = pipeline ? pipeline.settings : DEFAULT_SETTINGS;
      return JSON.stringify(extractSettings(settings));
    },

    applySettingsJSON: function (runtimeScene, behavior, jsonString) {
      if (!jsonString) return;
      try {
        var obj = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        applyCustomSettings(runtimeScene, behavior, obj);
      } catch (e) {
        warnOnce('jsonParseFail', 'Failed to parse JSON in ApplySettingsFromJSON: ' + e.message);
      }
    },

    saveSettingsToVariable: function (runtimeScene, behavior, gdjsVariable) {
      if (!gdjsVariable) return;
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      var settings = pipeline ? pipeline.settings : DEFAULT_SETTINGS;
      var data = extractSettings(settings);
      if (typeof gdjsVariable.fromJSObject === 'function') {
        gdjsVariable.fromJSObject(data);
      } else if (typeof gdjsVariable.setString === 'function') {
        gdjsVariable.setString(JSON.stringify(data));
      }
    },

    applySettingsFromVariable: function (runtimeScene, behavior, gdjsVariable) {
      if (!gdjsVariable) return;
      var data = null;
      if (typeof gdjsVariable.toJSObject === 'function') {
        data = gdjsVariable.toJSObject();
      } else if (typeof gdjsVariable.getAsString === 'function') {
        try {
          data = JSON.parse(gdjsVariable.getAsString());
        } catch (e) {}
      }
      if (data && typeof data === 'object') {
        applyCustomSettings(runtimeScene, behavior, data);
      }
    },

    applyCustomSettings: applyCustomSettings,
    extractSettings: extractSettings,

    updateSettings: function (runtimeScene, behavior, newSettings) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || ensurePipeline(runtimeScene, '');
      if (!pipeline) return;
      Object.assign(pipeline.settings, newSettings);
    },

    getSettings: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      return pipeline ? pipeline.settings : DEFAULT_SETTINGS;
    },

    getCurrentFocusDistance: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      if (!pipeline) return DEFAULT_SETTINGS.manualFocusDistance;
      return pipeline.settings.enableDOF && pipeline.settings.autofocus
        ? pipeline.activeFocusDistance
        : pipeline.settings.manualFocusDistance;
    },

    isAutofocusTracking: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      return !!(pipeline && pipeline.autofocusTracking);
    },

    isDepthAvailable: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      return !!(pipeline && pipeline.depthAttached);
    },

    getSetting: function (runtimeScene, behavior, key, fallback) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      if (!pipeline || pipeline.settings[key] === undefined) return fallback;
      return pipeline.settings[key];
    },

    isPassActive: function (runtimeScene, behavior) {
      var pipeline = (behavior && behavior.__cinematicPipeline) || getPipeline(runtimeScene);
      return !!(pipeline && pipeline.activeBehavior && pipeline.customPass);
    }
  };

  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(function (runtimeScene) {
      var pipeline = getPipeline(runtimeScene);
      if (pipeline) {
        detachPass(pipeline);
        pipeline.dispose();
      }
    });
  }
})();
