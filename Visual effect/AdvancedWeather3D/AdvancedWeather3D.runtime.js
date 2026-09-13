/**
 * AdvancedWeather3D.runtime.js
 * High-performance 3D weather systems (rain, snow, hail, dust, embers, fog, lightning)
 * and raymarched volumetric fog for GDevelop 5 (Three.js r160, WebGL2 backend).
 *
 * Architecture:
 * - Attach WeatherVolume3D to any 3D Box (Cube) or 3D Object.
 * - Sizing the cube sets the world-space bounding volume [minX, maxX] x [minY, maxY] x [minZ, maxZ].
 * - Supports BoundedBox mode (strictly inside volume) or FollowCamera mode (world-anchored weather in a camera-centered emitter window).
 * - High-throughput particle pooling using Float32Array and THREE.InstancedMesh.
 * - Rain streaks dynamically align to instantaneous 3D velocity vectors (gravity + 3D wind azimuth/pitch + turbulence).
 * - Floor and roof impact splashes (expanding ripple rings with life decay).
 * - WeatherShelter3D occlusion: indoor roofs, canopies, and bridges block precipitation from passing through.
 * - Autonomous and triggerable multi-pulse lightning flash engine with brightness queries for game events.
 * - Volumetric Fog: procedural 3D density raymarching with Beer-Lambert extinction,
 *   Henyey-Greenstein forward solar scattering, height falloff, and wind advection.
 */

(function () {
  if (typeof gdjs === 'undefined') return;

  var RUNTIME_VERSION = '2026.09.12.5';
  var previous = gdjs.__advancedWeather3D;
  if (previous && previous.__runtimeVersion === RUNTIME_VERSION) return;
  if (previous && typeof previous.__cleanup === 'function') {
    previous.__cleanup();
  }

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------- Math & Utilities */

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function fogStepsForQuality(quality) {
    if (quality === 'Low') return 12;
    if (quality === 'High') return 40;
    if (quality === 'Ultra') return 64;
    return 24;
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
    return fallback || [255, 255, 255];
  }

  function getDeltaSeconds(runtimeScene) {
    var ms = 16.6667;
    if (runtimeScene && typeof runtimeScene.getElapsedTime === 'function') {
      var v = runtimeScene.getElapsedTime();
      if (typeof v === 'number' && isFinite(v) && v > 0) ms = v;
    }
    return Math.min(ms / 1000.0, 0.1);
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

  function getLayerThreeCamera(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    return renderer && typeof renderer.getThreeCamera === 'function' ? renderer.getThreeCamera() : null;
  }

  function objectIsHidden(object) {
    return !!(object && typeof object.isHidden === 'function' && object.isHidden());
  }

  function objectLayerName(object) {
    return (object && typeof object.getLayer === 'function') ? object.getLayer() : '';
  }

  /* ------------------------------------------------------------- 3D Procedural Noise (CPU) */

  function hash3D(x, y, z) {
    var p0 = (x * 0.3183099 + 0.1) % 1.0;
    var p1 = (y * 0.3183099 + 0.1) % 1.0;
    var p2 = (z * 0.3183099 + 0.1) % 1.0;
    if (p0 < 0) p0 += 1.0;
    if (p1 < 0) p1 += 1.0;
    if (p2 < 0) p2 += 1.0;
    p0 *= 17.0; p1 *= 17.0; p2 *= 17.0;
    var f = (p0 * p1 * p2 * (p0 + p1 + p2)) % 1.0;
    return f < 0 ? f + 1.0 : f;
  }

  function noise3D(x, y, z) {
    var ix = Math.floor(x), fx = x - ix;
    var iy = Math.floor(y), fy = y - iy;
    var iz = Math.floor(z), fz = z - iz;
    fx = fx * fx * (3.0 - 2.0 * fx);
    fy = fy * fy * (3.0 - 2.0 * fy);
    fz = fz * fz * (3.0 - 2.0 * fz);

    var c000 = hash3D(ix, iy, iz);
    var c100 = hash3D(ix + 1, iy, iz);
    var c010 = hash3D(ix, iy + 1, iz);
    var c110 = hash3D(ix + 1, iy + 1, iz);
    var c001 = hash3D(ix, iy, iz + 1);
    var c101 = hash3D(ix + 1, iy, iz + 1);
    var c011 = hash3D(ix, iy + 1, iz + 1);
    var c111 = hash3D(ix + 1, iy + 1, iz + 1);

    var x00 = lerp(c000, c100, fx);
    var x10 = lerp(c010, c110, fx);
    var x01 = lerp(c001, c101, fx);
    var x11 = lerp(c011, c111, fx);

    var y0 = lerp(x00, x10, fy);
    var y1 = lerp(x01, x11, fy);

    return lerp(y0, y1, fz);
  }

  function fbm3D(x, y, z) {
    var val = 0.5000 * noise3D(x, y, z);
    val += 0.2500 * noise3D(x * 2.02, y * 2.02, z * 2.02);
    val += 0.1250 * noise3D(x * 4.05, y * 4.05, z * 4.05);
    return val;
  }

  /* ------------------------------------------------------------- Clustered Fog GLSL Shaders */

  var CLUSTER_FOG_VERTEX_SHADER = [
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = worldPosition.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * worldPosition;',
    '}'
  ].join('\n');

  var CLUSTER_FOG_FRAGMENT_SHADER = [
    'precision highp float;',
    'precision highp int;',
    'varying vec3 vWorldPos;',
    'uniform vec3 u_BoxMin;',
    'uniform vec3 u_BoxMax;',
    'uniform vec3 u_BoxSize;',
    'uniform float u_FogDensity;',
    'uniform float u_FogHeightFalloff;',
    'uniform vec3 u_FogColor;',
    'uniform float u_FogAnisotropy;',
    'uniform vec3 u_SunDirection;',
    'uniform vec3 u_SunColor;',
    'uniform float u_SunIntensity;',
    'uniform vec3 u_WindOffset;',
    'uniform float u_NoiseScale;',
    'uniform float u_LightningIntensity;',
    'uniform vec3 u_LightningColor;',
    'uniform int u_StepCount;',
    '',
    'float hash3(vec3 p) {',
    '  p = fract(p * 0.3183099 + 0.1);',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    '',
    'float noise3D(vec3 x) {',
    '  vec3 p = floor(x);',
    '  vec3 f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(mix(hash3(p + vec3(0,0,0)), hash3(p + vec3(1,0,0)), f.x),',
    '        mix(hash3(p + vec3(0,1,0)), hash3(p + vec3(1,1,0)), f.x), f.y),',
    '    mix(mix(hash3(p + vec3(0,0,1)), hash3(p + vec3(1,0,1)), f.x),',
    '        mix(hash3(p + vec3(0,1,1)), hash3(p + vec3(1,1,1)), f.x), f.y), f.z);',
    '}',
    '',
    'float fbm3D(vec3 p) {',
    '  float f = 0.5000 * noise3D(p); p *= 2.02;',
    '  f += 0.2500 * noise3D(p); p *= 2.03;',
    '  f += 0.1250 * noise3D(p);',
    '  return f;',
    '}',
    '',
    'vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {',
    '  vec3 invD = 1.0 / rd;',
    '  vec3 t0 = (boxMin - ro) * invD;',
    '  vec3 t1 = (boxMax - ro) * invD;',
    '  vec3 tmin = min(t0, t1);',
    '  vec3 tmax = max(t0, t1);',
    '  float tn = max(max(tmin.x, tmin.y), tmin.z);',
    '  float tf = min(min(tmax.x, tmax.y), tmax.z);',
    '  return vec2(tn, tf);',
    '}',
    '',
    'void main() {',
    '  vec3 ro = cameraPosition;',
    '  vec3 rd = normalize(vWorldPos - cameraPosition);',
    '  vec2 hit = intersectBox(ro, rd, u_BoxMin, u_BoxMax);',
    '  float tn = max(hit.x, 0.0);',
    '  float tf = hit.y;',
    '  if (tf <= tn || tf <= 0.0) discard;',
    '',
    '  const int MAX_STEPS = 64;',
    '  float stepSize = (tf - tn) / float(max(u_StepCount, 1));',
    '  float jitter = hash3(vec3(gl_FragCoord.xy, 0.618));',
    '  vec3 currentPos = ro + rd * (tn + stepSize * (0.25 + 0.5 * jitter));',
    '  vec3 stepVec = rd * stepSize;',
    '',
    '  float totalTransmittance = 1.0;',
    '  vec3 totalInScattering = vec3(0.0);',
    '',
    '  float cosTheta = dot(rd, normalize(u_SunDirection));',
    '  float g = clamp(u_FogAnisotropy, -0.85, 0.85);',
    '  float hg = (1.0 - g * g) / (12.5663706 * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.001), 1.5));',
    '',
    '  for (int i = 0; i < MAX_STEPS; i++) {',
    '    if (i >= u_StepCount) break;',
    '    vec3 clusterPos = (currentPos - u_BoxMin) / max(u_BoxSize, vec3(1.0));',
    '    float heightRatio = clamp(clusterPos.z, 0.0, 1.0);',
    '    float heightDensity = exp(-u_FogHeightFalloff * heightRatio);',
    '    vec3 sampleCoord = clusterPos * u_NoiseScale * 3.5 + u_WindOffset;',
    '    float noiseVal = clamp(fbm3D(sampleCoord) * 1.6 - 0.25, 0.0, 1.0);',
    '    float localDensity = u_FogDensity * heightDensity * noiseVal;',
    '',
    '    if (localDensity > 0.0001) {',
    '      float stepOpticalDepth = localDensity * stepSize;',
    '      float stepTransmittance = exp(-stepOpticalDepth);',
    '      vec3 lightSource = u_SunColor * (u_SunIntensity * hg) + u_FogColor * 0.35;',
    '      if (u_LightningIntensity > 0.0) {',
    '        lightSource += u_LightningColor * u_LightningIntensity * 2.5;',
    '      }',
    '      vec3 inScatter = u_FogColor * lightSource * (localDensity * stepSize);',
    '      totalInScattering += inScatter * totalTransmittance;',
    '      totalTransmittance *= stepTransmittance;',
    '      if (totalTransmittance < 0.02) break;',
    '    }',
    '    currentPos += stepVec;',
    '  }',
    '',
    '  float alpha = clamp(1.0 - totalTransmittance, 0.0, 1.0);',
    '  gl_FragColor = vec4(totalInScattering, alpha);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- Weather Presets */

  var WEATHER_PRESETS = {
    Rain: {
      particleDensity: 800,
      particleSpeed: 520.0,
      particleSpeedVariation: 0.25,
      particleSize: 2.2,
      streakLength: 22.0,
      streakThickness: 2.2,
      particleColor: [190, 220, 255],
      particleOpacity: 0.75,
      swayAmount: 2.0,
      swaySpeed: 1.0,
      enableFloorSplashes: true,
      splashSize: 14.0,
      splashLifetime: 0.35,
      splashDensity: 0.8,
      splashStyle: 'Ring',
      enableClusteredFog: false,
      fogThickness: 0.02,
      fogHeightFalloff: 1.5
    },
    Snow: {
      particleDensity: 600,
      particleSpeed: 85.0,
      particleSpeedVariation: 0.45,
      particleSize: 4.5,
      streakLength: 0.0,
      streakThickness: 4.5,
      particleColor: [245, 250, 255],
      particleOpacity: 0.90,
      swayAmount: 28.0,
      swaySpeed: 2.2,
      enableFloorSplashes: false,
      splashSize: 0.0,
      splashLifetime: 0.0,
      splashDensity: 0.0,
      enableClusteredFog: false,
      fogThickness: 0.02,
      fogHeightFalloff: 1.2
    },
    Hail: {
      particleDensity: 400,
      particleSpeed: 650.0,
      particleSpeedVariation: 0.20,
      particleSize: 3.8,
      streakLength: 4.0,
      streakThickness: 3.8,
      particleColor: [225, 242, 255],
      particleOpacity: 0.85,
      swayAmount: 4.0,
      swaySpeed: 1.0,
      enableFloorSplashes: true,
      splashSize: 8.0,
      splashLifetime: 0.25,
      splashDensity: 0.9,
      splashStyle: 'Crown',
      enableClusteredFog: false,
      fogThickness: 0.02,
      fogHeightFalloff: 1.5
    },
    Dust: {
      particleDensity: 500,
      particleSpeed: 30.0,
      particleSpeedVariation: 0.60,
      particleSize: 2.8,
      streakLength: 0.0,
      streakThickness: 2.8,
      particleColor: [210, 185, 145],
      particleOpacity: 0.55,
      swayAmount: 45.0,
      swaySpeed: 1.5,
      enableFloorSplashes: false,
      splashSize: 0.0,
      splashLifetime: 0.0,
      splashDensity: 0.0,
      enableClusteredFog: true,
      fogThickness: 0.05,
      fogHeightFalloff: 0.8
    },
    Embers: {
      particleDensity: 350,
      particleSpeed: -55.0, // Upward rising heat draft
      particleSpeedVariation: 0.50,
      particleSize: 3.2,
      streakLength: 2.5,
      streakThickness: 3.2,
      particleColor: [255, 125, 35],
      particleOpacity: 0.88,
      swayAmount: 35.0,
      swaySpeed: 3.0,
      enableFloorSplashes: false,
      splashSize: 0.0,
      splashLifetime: 0.0,
      splashDensity: 0.0,
      enableClusteredFog: false,
      fogThickness: 0.02,
      fogHeightFalloff: 1.5
    },
    Fog: {
      particleDensity: 120,
      particleSpeed: 8.0,
      particleSpeedVariation: 0.70,
      particleSize: 28.0,
      streakLength: 0.0,
      streakThickness: 28.0,
      particleColor: [200, 215, 230],
      particleOpacity: 0.16,
      swayAmount: 50.0,
      swaySpeed: 0.6,
      enableFloorSplashes: false,
      splashSize: 0.0,
      splashLifetime: 0.0,
      splashDensity: 0.0,
      enableClusteredFog: true,
      fogThickness: 0.08,
      fogHeightFalloff: 1.2
    }
  };

  /* ------------------------------------------------------------- Scene State Registry */

  var sceneStates = typeof WeakMap === 'function' ? new WeakMap() : new Map();
  // WeakMap cannot be iterated during an extension hot reload, so retain the
  // small set of live scene states explicitly for deterministic teardown.
  var allSceneStates = [];

  function getSceneState(runtimeScene) {
    var state = sceneStates.get(runtimeScene);
    if (!state) {
      state = {
        runtimeScene: runtimeScene,
        volumes: [],
        shelters: [],
        hostVisibility: new Map(),
        globalWindSpeed: 0.0,
        globalWindDirection: 45.0,
        globalSpeedMultiplier: 1.0,
        time: 0.0
      };
      sceneStates.set(runtimeScene, state);
      allSceneStates.push(state);
    }
    return state;
  }

  /* ------------------------------------------------------------- Particle Pool Helper */

  function allocateParticlePool(capacity) {
    return {
      capacity: capacity,
      count: capacity,
      pos: new Float32Array(capacity * 3),      // [x, y, z]
      vel: new Float32Array(capacity * 3),      // [vx, vy, vz]
      data: new Float32Array(capacity * 4),     // [phase, seed, size, opacity]
      baseSpeed: new Float32Array(capacity),
      bounceCount: new Uint8Array(capacity)
    };
  }

  function allocateSplashPool(capacity) {
    return {
      capacity: capacity,
      head: 0,
      activeCount: 0,
      pos: new Float32Array(capacity * 3),      // [x, y, z]
      life: new Float32Array(capacity),         // elapsed seconds
      maxLife: new Float32Array(capacity),      // total duration
      maxRadius: new Float32Array(capacity),
      active: new Uint8Array(capacity)
    };
  }

  /* ------------------------------------------------------------- Three.js Mesh Helpers */

  function createStreakGeometry(streakLength, size, thickness) {
    if (!THREE_OK) return null;
    var geom = new THREE.BufferGeometry();
    var s = Math.max(
      streakLength > 0.0 && thickness !== undefined ? thickness : size,
      0.2
    );
    var len = Math.max(streakLength, s);

    var vertices;
    if (len > s * 1.2) {
      // Elongated streak trailing along -Z
      vertices = new Float32Array([
        // Quad 1: X-Z plane
        -s * 0.10, 0, 0,
         s * 0.10, 0, 0,
        -s * 0.5, 0, -len,
         s * 0.5, 0, -len,
        // Quad 2: Y-Z plane
        0, -s * 0.10, 0,
        0,  s * 0.10, 0,
        0, -s * 0.5, -len,
        0,  s * 0.5, -len
      ]);
    } else {
      // Centered cross-quad (snowflake / dust particle)
      var h = s * 0.5;
      vertices = new Float32Array([
        -h, 0, -h,
         h, 0, -h,
        -h, 0,  h,
         h, 0,  h,
        0, -h, -h,
        0,  h, -h,
        0, -h,  h,
        0,  h,  h
      ]);
    }

    var indices = new Uint16Array([
      0, 1, 2,  1, 3, 2,
      4, 5, 6,  5, 7, 6
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();
    return geom;
  }

  function createSplashGeometry(style) {
    if (!THREE_OK) return null;
    style = style || 'Ring';

    if (style === 'Ring' && typeof THREE.RingGeometry === 'function') {
      var ring = new THREE.RingGeometry(0.7, 1.0, 20);
      ring.userData = ring.userData || {};
      ring.userData.advancedWeatherRippleStyle = style;
      return ring;
    }

    var vertices = [];
    var indices = [];
    var segments = 20;

    if (style === 'DoubleRing') {
      var bands = [[0.30, 0.40], [0.76, 1.0]];
      for (var band = 0; band < bands.length; band++) {
        var base = vertices.length / 3;
        for (var i = 0; i <= segments; i++) {
          var angle = (i / segments) * Math.PI * 2.0;
          var ca = Math.cos(angle);
          var sa = Math.sin(angle);
          vertices.push(ca * bands[band][0], sa * bands[band][0], 0.0);
          vertices.push(ca * bands[band][1], sa * bands[band][1], 0.0);
        }
        for (var j = 0; j < segments; j++) {
          var a = base + j * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    } else if (style === 'Crown') {
      // Disconnected wedges form a low splash crown. The instance expands in
      // XY while keeping its short vertical height stable.
      for (var c = 0; c < segments; c++) {
        var angle0 = (c / segments) * Math.PI * 2.0;
        var angle1 = ((c + 1) / segments) * Math.PI * 2.0;
        var middle = (angle0 + angle1) * 0.5;
        var crownBase = vertices.length / 3;
        vertices.push(Math.cos(angle0) * 0.62, Math.sin(angle0) * 0.62, 0.0);
        vertices.push(Math.cos(angle1) * 0.96, Math.sin(angle1) * 0.96, 0.0);
        vertices.push(
          Math.cos(middle) * 0.80,
          Math.sin(middle) * 0.80,
          c % 2 === 0 ? 0.34 : 0.22
        );
        indices.push(crownBase, crownBase + 1, crownBase + 2);
      }
    } else if (typeof THREE.RingGeometry === 'function') {
      var fallbackRing = new THREE.RingGeometry(0.7, 1.0, 20);
      fallbackRing.userData = fallbackRing.userData || {};
      fallbackRing.userData.advancedWeatherRippleStyle = 'Ring';
      return fallbackRing;
    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geometry.computeVertexNormals();
    geometry.userData = geometry.userData || {};
    geometry.userData.advancedWeatherRippleStyle = style;
    return geometry;
  }

  function createWireframeBoxGeometry(width, height, depth) {
    if (!THREE_OK || typeof THREE.BoxGeometry !== 'function') return null;
    var box = new THREE.BoxGeometry(width, height, depth);
    if (typeof THREE.WireframeGeometry === 'function') {
      return new THREE.WireframeGeometry(box);
    }
    return box;
  }

  /* ------------------------------------------------------------- The Main Engine */

  var AdvancedWeather3D = {
    __runtimeVersion: RUNTIME_VERSION,

    /* ----------------------------------------------------------- Volume Registration */

    registerWeatherVolume: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);
      options = options || {};

      var typeName = options.weatherType || 'Rain';
      var preset = WEATHER_PRESETS[typeName] || null;

      var col = parseColor(
        options.particleColor !== undefined ? options.particleColor : (preset ? preset.particleColor : null),
        [190, 220, 255]
      );
      var flashCol = parseColor(options.lightningFlashColor, [220, 235, 255]);
      var mistCol = parseColor(options.mistColor, [160, 180, 200]);
      var fogCol = parseColor(options.fogColor || (preset && preset.fogColor ? preset.fogColor : null), [200, 215, 230]);

      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 600;

      var density = typeof options.particleDensity === 'number' ? options.particleDensity : (preset ? preset.particleDensity : 800);
      var count = Math.max(0, Math.min(15000, Math.round(density)));

      var speed = typeof options.particleSpeed === 'number' ? options.particleSpeed : (preset ? preset.particleSpeed : 520.0);
      var speedVar = typeof options.particleSpeedVariation === 'number' ? options.particleSpeedVariation : (preset ? preset.particleSpeedVariation : 0.25);
      var size = typeof options.particleSize === 'number' ? options.particleSize : (preset ? preset.particleSize : 2.2);
      var streakLen = typeof options.streakLength === 'number' ? options.streakLength : (preset ? preset.streakLength : 22.0);
      var streakThick = typeof options.streakThickness === 'number' ? options.streakThickness : (preset && preset.streakThickness ? preset.streakThickness : size);
      var opacity = typeof options.particleOpacity === 'number' ? options.particleOpacity : (preset ? preset.particleOpacity : 0.75);
      var swayAmt = typeof options.swayAmount === 'number' ? options.swayAmount : (preset ? preset.swayAmount : 2.0);
      var swaySpd = typeof options.swaySpeed === 'number' ? options.swaySpeed : (preset ? preset.swaySpeed : 1.0);

      var splashesEnabled = options.enableFloorSplashes !== undefined ? !!options.enableFloorSplashes : (preset ? preset.enableFloorSplashes : true);
      var splashSz = typeof options.splashSize === 'number' ? options.splashSize : (preset ? preset.splashSize : 14.0);
      var splashLife = typeof options.splashLifetime === 'number' ? options.splashLifetime : (preset ? preset.splashLifetime : 0.35);
      var splashDensity = typeof options.splashDensity === 'number' ? options.splashDensity : (preset ? preset.splashDensity : 0.8);
      var splashStyle = options.splashStyle || (preset && preset.splashStyle) || 'Ring';

      var enableFog = options.enableClusteredFog !== undefined ? !!options.enableClusteredFog : (preset ? !!preset.enableClusteredFog : false);
      var fogThick = typeof options.fogThickness === 'number' ? options.fogThickness : (preset && preset.fogThickness ? preset.fogThickness : 0.04);
      var fogFalloff = typeof options.fogHeightFalloff === 'number' ? options.fogHeightFalloff : (preset && preset.fogHeightFalloff ? preset.fogHeightFalloff : 1.5);
      var fogAniso = typeof options.fogAnisotropy === 'number' ? clamp(options.fogAnisotropy, -0.85, 0.85) : 0.4;
      var fogScale = typeof options.fogNoiseScale === 'number' ? options.fogNoiseScale : 1.0;

      var volume = {
        object: object,
        behavior: behavior,
        layerName: objectLayerName(object),
        weatherType: typeName,
        volumeMode: options.volumeMode || 'BoundedBox', // 'BoundedBox' or 'FollowCamera'
        hideHostMesh: options.hideHostMesh !== undefined ? !!options.hideHostMesh : true,
        debugBounds: options.debugBounds !== undefined ? !!options.debugBounds : false,
        enabled: options.enabled !== undefined ? !!options.enabled : true,

        // Particle configuration
        particleDensity: count,
        particleSpeed: speed,
        particleSpeedVariation: clamp(speedVar, 0.0, 1.0),
        particleSize: size,
        streakLength: streakLen,
        streakThickness: streakThick,
        particleColor: [col[0] / 255, col[1] / 255, col[2] / 255],
        particleOpacity: clamp(opacity, 0.0, 1.0),

        // Wind & 3D Turbulence
        windSpeed: typeof options.windSpeed === 'number' ? options.windSpeed : 60.0,
        windDirection: typeof options.windDirection === 'number' ? options.windDirection : 45.0,
        windPitch: typeof options.windPitch === 'number' ? clamp(options.windPitch, -85.0, 85.0) : 0.0,
        windTurbulence: typeof options.windTurbulence === 'number' ? options.windTurbulence : 0.3,
        swayAmount: swayAmt,
        swaySpeed: swaySpd,

        // Splashes
        enableFloorSplashes: splashesEnabled,
        splashSize: splashSz,
        splashLifetime: splashLife,
        splashDensity: clamp(splashDensity, 0.0, 1.0),
        splashStyle: splashStyle,

        // Clustered Volumetric Fog
        enableClusteredFog: enableFog,
        fogThickness: fogThick,
        fogHeightFalloff: fogFalloff,
        fogAnisotropy: fogAniso,
        fogColor: [fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255],
        fogNoiseScale: fogScale,
        fogQuality: options.fogQuality || 'Medium',
        fogStepCount: fogStepsForQuality(options.fogQuality || 'Medium'),
        fogWindOffset: [0.0, 0.0, 0.0],
        fogMesh: null,
        fogGeometry: null,
        fogMaterial: null,

        // Lightning
        enableLightning: options.enableLightning !== undefined ? !!options.enableLightning : false,
        lightningIntervalMin: typeof options.lightningIntervalMin === 'number' ? options.lightningIntervalMin : 8.0,
        lightningIntervalMax: typeof options.lightningIntervalMax === 'number' ? options.lightningIntervalMax : 22.0,
        lightningFlashColor: [flashCol[0] / 255, flashCol[1] / 255, flashCol[2] / 255],
        lightningIntensity: typeof options.lightningIntensity === 'number' ? options.lightningIntensity : 1.5,
        lightningTimer: 10.0,
        lightningActive: false,
        lightningFlashAge: 0.0,
        lightningFlashDuration: 0.28,
        lightningBrightness: 0.0,
        timeSinceLastLightning: 999.0,
        simulationTime: 0.0,

        // Mist / Legacy Fog
        mistDensity: typeof options.mistDensity === 'number' ? options.mistDensity : 0.0,
        mistColor: [mistCol[0] / 255, mistCol[1] / 255, mistCol[2] / 255],

        // Volume Bounds
        bounds: {
          minX: 0, maxX: width,
          minY: 0, maxY: height,
          minZ: 0, maxZ: depth,
          width: width, height: height, depth: depth,
          centerX: width * 0.5, centerY: height * 0.5, centerZ: depth * 0.5
        },

        // Particle Buffers
        particles: allocateParticlePool(count),
        splashes: allocateSplashPool(Math.min(500, Math.round(count * 0.35))),

        // Three.js Render Objects
        mesh: null,
        material: null,
        geometry: null,
        splashMesh: null,
        splashMaterial: null,
        splashGeometry: null,
        debugWireframe: null,
        lightningLight: null,
        renderersInitialized: false,
        boundsInitialized: false,
        followDeltaX: 0,
        followDeltaY: 0,
        followDeltaZ: 0,

        // Temp math helpers (reused per frame to eliminate GC)
        _dummy: THREE_OK ? new THREE.Object3D() : null,
        _vecA: THREE_OK ? new THREE.Vector3() : null,
        _vecB: THREE_OK ? new THREE.Vector3() : null,
        _quat: THREE_OK ? new THREE.Quaternion() : null
      };

      // Resolve the authored (or follow-camera) bounds before seeding particles.
      // Otherwise a placed volume starts with every particle around world origin
      // and visibly folds them onto its boundary on the first frame.
      AdvancedWeather3D._updateVolumeBounds(runtimeScene, object, volume);

      // Set initial random lightning timer
      volume.lightningTimer = lerp(volume.lightningIntervalMin, volume.lightningIntervalMax, Math.random());

      // Initialize particles inside volume
      AdvancedWeather3D._initParticles(volume);

      // Build Three.js scene objects
      if (THREE_OK) {
        AdvancedWeather3D._setupRenderers(runtimeScene, volume);
      }

      state.volumes.push(volume);

      if (volume.hideHostMesh) {
        var rootObject = getRootObject3D(object);
        var visibilityEntry = state.hostVisibility.get(object);
        if (!visibilityEntry) {
          visibilityEntry = {
            count: 0,
            originalVisible: rootObject ? rootObject.visible !== false : true
          };
          state.hostVisibility.set(object, visibilityEntry);
        }
        visibilityEntry.count++;
      }
      return volume;
    },

    /* ----------------------------------------------------------- Particle Setup & Respawn */

    _initParticles: function (vol) {
      var pool = vol.particles;
      var b = vol.bounds;
      var spd = vol.particleSpeed;
      var spdVar = vol.particleSpeedVariation;

      for (var i = 0; i < pool.capacity; i++) {
        var idx3 = i * 3;
        var idx4 = i * 4;

        pool.pos[idx3]     = lerp(b.minX, b.maxX, Math.random());
        pool.pos[idx3 + 1] = lerp(b.minY, b.maxY, Math.random());
        pool.pos[idx3 + 2] = lerp(b.minZ, b.maxZ, Math.random());

        var s = spd * (1.0 + (Math.random() * 2.0 - 1.0) * spdVar);
        pool.baseSpeed[i] = s;

        pool.vel[idx3]     = 0.0;
        pool.vel[idx3 + 1] = 0.0;
        pool.vel[idx3 + 2] = -s;
        pool.bounceCount[i] = 0;

        pool.data[idx4]     = Math.random() * Math.PI * 2.0; // sway phase
        pool.data[idx4 + 1] = Math.random();                 // seed
        // Geometry already carries the authored size. Store only a variation
        // multiplier here so size is not applied twice to every instance.
        pool.data[idx4 + 2] = 0.8 + Math.random() * 0.4;
        pool.data[idx4 + 3] = vol.particleOpacity * (0.85 + Math.random() * 0.3);
      }
    },

    _respawnParticle: function (vol, i, topOnly) {
      var pool = vol.particles;
      var b = vol.bounds;
      var idx3 = i * 3;
      var idx4 = i * 4;

      pool.pos[idx3]     = lerp(b.minX, b.maxX, Math.random());
      pool.pos[idx3 + 1] = lerp(b.minY, b.maxY, Math.random());

      if (vol.particleSpeed >= 0) {
        pool.pos[idx3 + 2] = topOnly ? b.maxZ : lerp(b.minZ, b.maxZ, Math.random());
      } else {
        pool.pos[idx3 + 2] = topOnly ? b.minZ : lerp(b.minZ, b.maxZ, Math.random());
      }

      var s = vol.particleSpeed * (1.0 + (Math.random() * 2.0 - 1.0) * vol.particleSpeedVariation);
      pool.baseSpeed[i] = s;
      pool.vel[idx3 + 2] = -s;
      pool.bounceCount[i] = 0;

      pool.data[idx4]     = Math.random() * Math.PI * 2.0;
      pool.data[idx4 + 1] = Math.random();
    },

    _respawnParticleAtLeadingEdge: function (vol, i, dx, dy) {
      AdvancedWeather3D._respawnParticle(vol, i, true);

      var b = vol.bounds;
      var pool = vol.particles;
      var idx3 = i * 3;
      var absX = Math.abs(dx);
      var absY = Math.abs(dy);
      var totalMotion = absX + absY;
      if (totalMotion <= 0.000001) return;

      // A diagonal camera move exposes two strips. Distribute recycled drops
      // between them in proportion to how far the window moved on each axis.
      var useXEdge = absX > 0.000001 &&
        (absY <= 0.000001 || Math.random() < absX / totalMotion);
      if (useXEdge) {
        var xBand = Math.min(absX, b.width);
        pool.pos[idx3] = dx > 0
          ? lerp(b.maxX - xBand, b.maxX, Math.random())
          : lerp(b.minX, b.minX + xBand, Math.random());
      } else {
        var yBand = Math.min(absY, b.height);
        pool.pos[idx3 + 1] = dy > 0
          ? lerp(b.maxY - yBand, b.maxY, Math.random())
          : lerp(b.minY, b.minY + yBand, Math.random());
      }
    },

    /* ----------------------------------------------------------- Renderers Setup */

    _setupRenderers: function (runtimeScene, vol) {
      if (!THREE_OK) return;

      var root = getLayerThreeRoot(runtimeScene, vol.layerName);
      if (!root) return;

      AdvancedWeather3D._setupParticleRenderer(runtimeScene, vol);
      AdvancedWeather3D._setupSplashRenderer(runtimeScene, vol);

      if (vol.enableClusteredFog) {
        AdvancedWeather3D._setupFogRenderer(runtimeScene, vol);
      }

      if (typeof THREE.PointLight === 'function' && !vol.lightningLight) {
        vol.lightningLight = new THREE.PointLight(
          new THREE.Color(vol.lightningFlashColor[0], vol.lightningFlashColor[1], vol.lightningFlashColor[2]),
          0.0,
          Math.max(vol.bounds.width, vol.bounds.height, vol.bounds.depth) * 2.5
        );
        vol.lightningLight.name = 'AdvancedWeather3D_LightningLight';
        vol.lightningLight.position.set(vol.bounds.centerX, vol.bounds.centerY, vol.bounds.maxZ);
        root.add(vol.lightningLight);
      }

      AdvancedWeather3D._setupDebugRenderer(runtimeScene, vol);
      vol.renderersInitialized = true;
    },

    _disposeParticleRenderer: function (vol) {
      if (vol.mesh && vol.mesh.parent) vol.mesh.parent.remove(vol.mesh);
      if (vol.geometry && vol.geometry.dispose) vol.geometry.dispose();
      if (vol.material && vol.material.dispose) vol.material.dispose();
      vol.mesh = null;
      vol.geometry = null;
      vol.material = null;
    },

    _setupParticleRenderer: function (runtimeScene, vol) {
      AdvancedWeather3D._disposeParticleRenderer(vol);
      if (!THREE_OK || !vol.particles || vol.particles.capacity <= 0) return;
      var root = getLayerThreeRoot(runtimeScene, vol.layerName);
      if (!root) return;

      vol.geometry = createStreakGeometry(vol.streakLength, vol.particleSize, vol.streakThickness);
      vol.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(vol.particleColor[0], vol.particleColor[1], vol.particleColor[2]),
        transparent: true,
        opacity: vol.particleOpacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: vol.weatherType === 'Embers' ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      vol.mesh = new THREE.InstancedMesh(vol.geometry, vol.material, vol.particles.capacity);
      vol.mesh.name = 'AdvancedWeather3D_Precipitation';
      vol.mesh.frustumCulled = false;
      vol.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // InstancedMesh starts every instance at the identity transform. Write
      // the seeded particle transforms before exposing the mesh to rendering,
      // otherwise the first frame shows the entire pool overlapped at origin.
      var pool = vol.particles;
      for (var i = 0; i < pool.count; i++) {
        var idx3 = i * 3;
        AdvancedWeather3D._writeParticleInstance(
          vol, i,
          pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2],
          pool.vel[idx3], pool.vel[idx3 + 1], pool.vel[idx3 + 2]
        );
      }
      vol.mesh.instanceMatrix.needsUpdate = true;
      root.add(vol.mesh);
    },

    _disposeSplashRenderer: function (vol) {
      if (vol.splashMesh && vol.splashMesh.parent) vol.splashMesh.parent.remove(vol.splashMesh);
      if (vol.splashGeometry && vol.splashGeometry.dispose) vol.splashGeometry.dispose();
      if (vol.splashMaterial && vol.splashMaterial.dispose) vol.splashMaterial.dispose();
      vol.splashMesh = null;
      vol.splashGeometry = null;
      vol.splashMaterial = null;
    },

    _setupSplashRenderer: function (runtimeScene, vol) {
      AdvancedWeather3D._disposeSplashRenderer(vol);
      if (!THREE_OK || !vol.enableFloorSplashes || !vol.splashes || vol.splashes.capacity <= 0) return;
      var root = getLayerThreeRoot(runtimeScene, vol.layerName);
      if (!root) return;

      vol.splashGeometry = createSplashGeometry(vol.splashStyle);
      vol.splashMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(vol.particleColor[0], vol.particleColor[1], vol.particleColor[2]),
        transparent: true,
        opacity: vol.particleOpacity * 0.7,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
      vol.splashMesh = new THREE.InstancedMesh(vol.splashGeometry, vol.splashMaterial, vol.splashes.capacity);
      vol.splashMesh.name = 'AdvancedWeather3D_Splashes';
      vol.splashMesh.frustumCulled = false;
      vol.splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // Hide inactive ripple instances before the first render. Their default
      // identity transforms would otherwise briefly overlap at world origin.
      AdvancedWeather3D._stepSplashes(vol, 0.0);
      root.add(vol.splashMesh);
    },

    _disposeDebugRenderer: function (vol) {
      if (vol.debugWireframe && vol.debugWireframe.parent) vol.debugWireframe.parent.remove(vol.debugWireframe);
      if (vol.debugWireframe && vol.debugWireframe.geometry && vol.debugWireframe.geometry.dispose) {
        vol.debugWireframe.geometry.dispose();
      }
      if (vol.debugWireframe && vol.debugWireframe.material && vol.debugWireframe.material.dispose) {
        vol.debugWireframe.material.dispose();
      }
      vol.debugWireframe = null;
    },

    _setupDebugRenderer: function (runtimeScene, vol) {
      AdvancedWeather3D._disposeDebugRenderer(vol);
      if (!THREE_OK || !vol.debugBounds) return;
      var root = getLayerThreeRoot(runtimeScene, vol.layerName);
      if (!root) return;
      var wireGeom = createWireframeBoxGeometry(1, 1, 1);
      if (!wireGeom) return;
      var wireMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
      vol.debugWireframe = new THREE.LineSegments(wireGeom, wireMat);
      vol.debugWireframe.name = 'AdvancedWeather3D_DebugWireframe';
      vol.debugWireframe.position.set(vol.bounds.centerX, vol.bounds.centerY, vol.bounds.centerZ);
      vol.debugWireframe.scale.set(vol.bounds.width, vol.bounds.height, vol.bounds.depth);
      root.add(vol.debugWireframe);
    },

    _setupFogRenderer: function (runtimeScene, vol) {
      if (!THREE_OK) return;
      var root = getLayerThreeRoot(runtimeScene, vol.layerName);
      if (!root) return;

      if (vol.fogMesh && vol.fogMesh.parent) vol.fogMesh.parent.remove(vol.fogMesh);
      if (vol.fogGeometry && vol.fogGeometry.dispose) vol.fogGeometry.dispose();
      if (vol.fogMaterial && vol.fogMaterial.dispose) vol.fogMaterial.dispose();

      vol.fogGeometry = new THREE.BoxGeometry(1, 1, 1);
      vol.fogMaterial = new THREE.ShaderMaterial({
        vertexShader: CLUSTER_FOG_VERTEX_SHADER,
        fragmentShader: CLUSTER_FOG_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.BackSide,
        uniforms: {
          // The layer root mirrors Y. Shader inputs are Three world coordinates,
          // so the ordered interval is [-maxY, -minY].
          u_BoxMin: { value: new THREE.Vector3(vol.bounds.minX, -vol.bounds.maxY, vol.bounds.minZ) },
          u_BoxMax: { value: new THREE.Vector3(vol.bounds.maxX, -vol.bounds.minY, vol.bounds.maxZ) },
          u_BoxSize: { value: new THREE.Vector3(vol.bounds.width, vol.bounds.height, vol.bounds.depth) },
          u_FogDensity: { value: vol.fogThickness * 0.05 },
          u_FogHeightFalloff: { value: vol.fogHeightFalloff },
          u_FogColor: { value: new THREE.Vector3().fromArray(vol.fogColor) },
          u_FogAnisotropy: { value: vol.fogAnisotropy },
          u_SunDirection: { value: new THREE.Vector3(0.5, 0.5, 1.0).normalize() },
          u_SunColor: { value: new THREE.Vector3(1.0, 0.95, 0.9) },
          u_SunIntensity: { value: 1.0 },
          u_WindOffset: { value: new THREE.Vector3(0, 0, 0) },
          u_NoiseScale: { value: vol.fogNoiseScale },
          u_LightningIntensity: { value: 0.0 },
          u_LightningColor: { value: new THREE.Vector3().fromArray(vol.lightningFlashColor) },
          u_StepCount: { value: vol.fogStepCount }
        }
      });

      vol.fogMesh = new THREE.Mesh(vol.fogGeometry, vol.fogMaterial);
      vol.fogMesh.name = 'AdvancedWeather3D_ClusteredFog';
      vol.fogMesh.frustumCulled = false;
      vol.fogMesh.position.set(vol.bounds.centerX, vol.bounds.centerY, vol.bounds.centerZ);
      vol.fogMesh.scale.set(vol.bounds.width, vol.bounds.height, vol.bounds.depth);
      root.add(vol.fogMesh);
    },

    /* ----------------------------------------------------------- Step Simulation */

    stepWeatherVolume: function (runtimeScene, object, behavior) {
      var state = getSceneState(runtimeScene);
      var vol = AdvancedWeather3D.volumeOf(runtimeScene, behavior);
      if (!vol || !vol.enabled) {
        if (vol && vol.mesh) vol.mesh.visible = false;
        if (vol && vol.splashMesh) vol.splashMesh.visible = false;
        if (vol && vol.fogMesh) vol.fogMesh.visible = false;
        if (vol && vol.debugWireframe) vol.debugWireframe.visible = false;
        return;
      }

      // Some GDevelop renderers finish constructing after behavior onCreated.
      // Retry once the layer's Three root is available instead of leaving a
      // permanently invisible simulation.
      var needsRendererSetup = !vol.renderersInitialized ||
        (vol.particles.capacity > 0 && !vol.mesh) ||
        (vol.enableFloorSplashes && vol.splashes.capacity > 0 && !vol.splashMesh) ||
        (vol.enableClusteredFog && !vol.fogMesh) ||
        (vol.debugBounds && !vol.debugWireframe);
      if (THREE_OK && needsRendererSetup) {
        AdvancedWeather3D._setupRenderers(runtimeScene, vol);
      }

      var dt = getDeltaSeconds(runtimeScene) * state.globalSpeedMultiplier;
      vol.simulationTime += dt;

      // 1. Update Object & Volume Bounds
      AdvancedWeather3D._updateVolumeBounds(runtimeScene, object, vol);

      // 2. Hide Host Cube Mesh if requested
      if (vol.hideHostMesh) {
        var rootObj = getRootObject3D(object);
        if (rootObj && rootObj.visible) {
          rootObj.visible = false;
        }
      }

      // Visibility follows object hidden state
      var isHidden = objectIsHidden(object);
      if (vol.mesh) vol.mesh.visible = !isHidden;
      if (vol.splashMesh) vol.splashMesh.visible = !isHidden && vol.enableFloorSplashes;
      if (vol.fogMesh) vol.fogMesh.visible = !isHidden && vol.enableClusteredFog;
      if (vol.debugWireframe) vol.debugWireframe.visible = !isHidden && vol.debugBounds;
      if (isHidden) return;

      // 3. Step Lightning Engine
      AdvancedWeather3D._stepLightning(runtimeScene, vol, dt);

      // 4. Calculate 3D Wind Vector (Azimuth + Pitch + Turbulence)
      var localWindDir = vol.windDirection * (Math.PI / 180.0);
      var globalWindDir = state.globalWindDirection * (Math.PI / 180.0);
      var radPitch = (vol.windPitch || 0.0) * (Math.PI / 180.0);
      var cosPitch = Math.cos(radPitch);
      var sinPitch = Math.sin(radPitch);

      var gust = 1.0 + Math.sin(vol.simulationTime * 1.5) * vol.windTurbulence * 0.5
                     + Math.cos(vol.simulationTime * 3.1) * vol.windTurbulence * 0.3;

      // Local and global wind are independent vectors. A zero-speed global
      // wind must not rotate the per-volume wind direction.
      var windX = (Math.cos(localWindDir) * cosPitch * vol.windSpeed +
                   Math.cos(globalWindDir) * state.globalWindSpeed) * gust;
      var windY = (Math.sin(localWindDir) * cosPitch * vol.windSpeed +
                   Math.sin(globalWindDir) * state.globalWindSpeed) * gust;
      var windZ = sinPitch * vol.windSpeed * gust;

      // 5. Step Particles
      AdvancedWeather3D._stepParticles(runtimeScene, state, vol, dt, windX, windY, windZ);

      // 6. Step Splashes
      if (vol.enableFloorSplashes) {
        AdvancedWeather3D._stepSplashes(vol, dt);
      }

      // 7. Step Clustered Volumetric Fog
      if (vol.enableClusteredFog) {
        AdvancedWeather3D._stepFog(runtimeScene, vol, dt, windX, windY, windZ);
      }
    },

    /* ----------------------------------------------------------- Volume Bounds Sync */

    _updateVolumeBounds: function (runtimeScene, object, vol) {
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 600;
      var ox = object.getX ? object.getX() : 0;
      var oy = object.getY ? object.getY() : 0;
      var oz = object.getZ ? object.getZ() : 0;

      var b = vol.bounds;
      var oldCenterX = b.centerX;
      var oldCenterY = b.centerY;
      var oldCenterZ = b.centerZ;
      b.width = w;
      b.height = h;
      b.depth = d;

      if (vol.volumeMode === 'FollowCamera') {
        var cam = getLayerThreeCamera(runtimeScene, vol.layerName);
        if (cam) {
          var cx = cam.position.x;
          // In GDevelop 3D, layer Three.js root has scale.y = -1
          var cy = -cam.position.y;
          b.minX = cx - w * 0.5;
          b.maxX = cx + w * 0.5;
          b.minY = cy - h * 0.5;
          b.maxY = cy + h * 0.5;
          b.minZ = oz;
          b.maxZ = oz + d;
          b.centerX = cx;
          b.centerY = cy;
          b.centerZ = oz + d * 0.5;
        } else {
          b.minX = ox; b.maxX = ox + w;
          b.minY = oy; b.maxY = oy + h;
          b.minZ = oz; b.maxZ = oz + d;
          b.centerX = ox + w * 0.5;
          b.centerY = oy + h * 0.5;
          b.centerZ = oz + d * 0.5;
        }
      } else {
        b.minX = ox; b.maxX = ox + w;
        b.minY = oy; b.maxY = oy + h;
        b.minZ = oz; b.maxZ = oz + d;
        b.centerX = ox + w * 0.5;
        b.centerY = oy + h * 0.5;
        b.centerZ = oz + d * 0.5;
      }

      if (vol.debugWireframe) {
        vol.debugWireframe.position.set(b.centerX, b.centerY, b.centerZ);
        vol.debugWireframe.scale.set(b.width, b.height, b.depth);
      }
      if (vol.lightningLight) {
        vol.lightningLight.position.set(b.centerX, b.centerY, b.maxZ);
        vol.lightningLight.distance = Math.max(b.width, b.height, b.depth) * 2.5;
      }
      if (vol.fogMesh) {
        vol.fogMesh.position.set(b.centerX, b.centerY, b.centerZ);
        vol.fogMesh.scale.set(b.width, b.height, b.depth);
      }

      vol.followDeltaX = 0;
      vol.followDeltaY = 0;
      vol.followDeltaZ = 0;

      if (vol.boundsInitialized) {
        var dx = b.centerX - oldCenterX;
        var dy = b.centerY - oldCenterY;
        var dz = b.centerZ - oldCenterZ;
        if (vol.volumeMode === 'FollowCamera') {
          // The camera moves only the emitter window. Existing precipitation
          // and impact ripples remain anchored in world space; particles that
          // leave the trailing edge are recycled ahead in _stepParticles.
          vol.followDeltaX = dx;
          vol.followDeltaY = dy;
          vol.followDeltaZ = dz;
        } else if (dx !== 0 || dy !== 0 || dz !== 0) {
          // An authored bounded volume is a physical moving region, so its
          // existing particles and impacts continue to move with the object.
          var particles = vol.particles;
          for (var i = 0; i < particles.count; i++) {
            var pi = i * 3;
            particles.pos[pi] += dx;
            particles.pos[pi + 1] += dy;
            particles.pos[pi + 2] += dz;
          }
          var splashes = vol.splashes;
          for (var s = 0; s < splashes.capacity; s++) {
            if (!splashes.active[s]) continue;
            var si = s * 3;
            splashes.pos[si] += dx;
            splashes.pos[si + 1] += dy;
            splashes.pos[si + 2] += dz;
          }
        }
      }
      vol.boundsInitialized = true;
    },

    /* ----------------------------------------------------------- Step Particles */

    _writeParticleInstance: function (vol, i, px, py, pz, vx, vy, vz) {
      var dummy = vol._dummy;
      if (!vol.mesh || !dummy) return;
      var idx4 = i * 4;
      dummy.position.set(px, py, pz);

      if (vol.streakLength > 0.0) {
        var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (len > 0.001) {
          vol._vecA.set(0, 0, -1);
          vol._vecB.set(vx / len, vy / len, vz / len);
          vol._quat.setFromUnitVectors(vol._vecA, vol._vecB);
          dummy.quaternion.copy(vol._quat);
        }
      } else {
        var phase = vol.particles.data[idx4];
        var seed = vol.particles.data[idx4 + 1];
        dummy.rotation.set(
          Math.sin(phase) * 0.35,
          Math.cos(phase * 0.83) * 0.35,
          seed * Math.PI * 2.0 + phase * 0.15
        );
      }

      var pScale = vol.particles.data[idx4 + 2];
      if (vol.weatherType === 'Embers') {
        pScale *= 0.78 + 0.32 *
          (0.5 + 0.5 * Math.sin(vol.simulationTime * 11.0 + vol.particles.data[idx4 + 1] * 31.0));
      }
      dummy.scale.set(pScale, pScale, pScale);
      dummy.updateMatrix();
      vol.mesh.setMatrixAt(i, dummy.matrix);
    },

    _stepParticles: function (runtimeScene, state, vol, dt, windX, windY, windZ) {
      var pool = vol.particles;
      var b = vol.bounds;
      var dummy = vol._dummy;
      var shelters = state.shelters;
      var isRising = vol.particleSpeed < 0;

      for (var i = 0; i < pool.count; i++) {
        var idx3 = i * 3;
        var idx4 = i * 4;

        var px = pool.pos[idx3];
        var py = pool.pos[idx3 + 1];
        var pz = pool.pos[idx3 + 2];
        var previousX = px;
        var previousY = py;
        var previousZ = pz;

        // Horizontal sway harmonic
        pool.data[idx4] += vol.swaySpeed * dt;
        var swayVal = Math.sin(pool.data[idx4]) * vol.swayAmount;

        // Velocity components (incorporating 3D wind)
        var vx = windX + swayVal;
        var vy = windY + swayVal * 0.5;
        if (vol.weatherType === 'Hail' && pool.bounceCount[i] > 0) {
          pool.vel[idx3 + 2] -= 1800.0 * dt;
        }
        var vz = pool.vel[idx3 + 2] + windZ;

        // Integrate position
        px += vx * dt;
        py += vy * dt;
        pz += vz * dt;

        var recycled = false;

        // 1. Shelter Roof Occlusion Check
        if (!isRising && shelters.length > 0) {
          for (var s = 0; s < shelters.length; s++) {
            var sh = shelters[s];
            if (!sh.enabled) continue;
            if (sh.layerName !== vol.layerName) continue;
            var sb = sh.bounds;
            var crossedRoof = previousZ >= sb.maxZ && pz <= sb.maxZ;
            var startedInRoof = previousZ < sb.maxZ && previousZ >= sb.minZ;
            if (crossedRoof || startedInRoof) {
              var denominator = previousZ - pz;
              var hitT = crossedRoof && Math.abs(denominator) > 0.000001
                ? clamp((previousZ - sb.maxZ) / denominator, 0.0, 1.0)
                : 0.0;
              var hitX = lerp(previousX, px, hitT);
              var hitY = lerp(previousY, py, hitT);
              if (hitX >= sb.minX && hitX <= sb.maxX && hitY >= sb.minY && hitY <= sb.maxY) {
                if (vol.enableFloorSplashes && sh.splashOnRoof && Math.random() < vol.splashDensity) {
                  AdvancedWeather3D._spawnSplash(vol, hitX, hitY, sb.maxZ + 0.1);
                }
                if (vol.weatherType === 'Hail' && pool.bounceCount[i] < 2) {
                  pool.pos[idx3] = hitX;
                  pool.pos[idx3 + 1] = hitY;
                  pool.pos[idx3 + 2] = sb.maxZ + 0.1;
                  pool.vel[idx3 + 2] = Math.abs(pool.baseSpeed[i]) *
                    (pool.bounceCount[i] === 0 ? 0.38 : 0.20);
                  pool.bounceCount[i]++;
                } else {
                  AdvancedWeather3D._respawnParticle(vol, i, true);
                }
                recycled = true;
                break;
              }
            }
          }
        }

        if (recycled) {
          AdvancedWeather3D._writeParticleInstance(
            vol, i,
            pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2],
            windX, windY, pool.vel[idx3 + 2] + windZ
          );
          continue;
        }

        // In FollowCamera mode the bounds are a moving emitter window, not a
        // parent transform. Recycle drops that the window leaves behind into
        // the newly exposed strip in the camera's direction of travel.
        var outsideX = px < b.minX || px > b.maxX;
        var outsideY = py < b.minY || py > b.maxY;
        if ((outsideX || outsideY) && vol.volumeMode === 'FollowCamera' &&
            (Math.abs(vol.followDeltaX) > 0.000001 || Math.abs(vol.followDeltaY) > 0.000001)) {
          AdvancedWeather3D._respawnParticleAtLeadingEdge(
            vol, i, vol.followDeltaX, vol.followDeltaY
          );
          AdvancedWeather3D._writeParticleInstance(
            vol, i,
            pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2],
            windX, windY, pool.vel[idx3 + 2] + windZ
          );
          continue;
        }

        // 2. Boundary Wrap
        if (!isRising) {
          if (pz <= b.minZ) {
            if (vol.enableFloorSplashes && Math.random() < vol.splashDensity) {
              AdvancedWeather3D._spawnSplash(vol, px, py, b.minZ + 0.1);
            }
            if (vol.weatherType === 'Hail' && pool.bounceCount[i] < 2) {
              pool.pos[idx3] = px;
              pool.pos[idx3 + 1] = py;
              pool.pos[idx3 + 2] = b.minZ + 0.1;
              pool.vel[idx3 + 2] = Math.abs(pool.baseSpeed[i]) *
                (pool.bounceCount[i] === 0 ? 0.38 : 0.20);
              pool.bounceCount[i]++;
              AdvancedWeather3D._writeParticleInstance(
                vol, i, px, py, b.minZ + 0.1, windX, windY, pool.vel[idx3 + 2] + windZ
              );
              continue;
            }
            AdvancedWeather3D._respawnParticle(vol, i, true);
            AdvancedWeather3D._writeParticleInstance(
              vol, i,
              pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2],
              windX, windY, pool.vel[idx3 + 2] + windZ
            );
            continue;
          }
        } else {
          if (pz >= b.maxZ) {
            AdvancedWeather3D._respawnParticle(vol, i, true);
            AdvancedWeather3D._writeParticleInstance(
              vol, i,
              pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2],
              windX, windY, pool.vel[idx3 + 2] + windZ
            );
            continue;
          }
        }

        if (px < b.minX) px = b.maxX;
        else if (px > b.maxX) px = b.minX;

        if (py < b.minY) py = b.maxY;
        else if (py > b.maxY) py = b.minY;

        pool.pos[idx3]     = px;
        pool.pos[idx3 + 1] = py;
        pool.pos[idx3 + 2] = pz;

        // 3. Update Instanced Mesh Transform
        AdvancedWeather3D._writeParticleInstance(vol, i, px, py, pz, vx, vy, vz);
      }

      if (vol.mesh && vol.mesh.instanceMatrix) {
        vol.mesh.instanceMatrix.needsUpdate = true;
      }
    },

    /* ----------------------------------------------------------- Splashes */

    _spawnSplash: function (vol, x, y, z) {
      var pool = vol.splashes;
      if (!pool || pool.capacity <= 0) return;

      var idx = pool.head;
      pool.head = (pool.head + 1) % pool.capacity;
      var wasActive = pool.active[idx] !== 0;

      var idx3 = idx * 3;
      pool.pos[idx3]     = x;
      pool.pos[idx3 + 1] = y;
      pool.pos[idx3 + 2] = z;

      pool.life[idx] = 0.0;
      pool.maxLife[idx] = vol.splashLifetime * (0.8 + Math.random() * 0.4);
      pool.maxRadius[idx] = vol.splashSize * (0.8 + Math.random() * 0.4);
      pool.active[idx] = 1;

      if (!wasActive) {
        pool.activeCount++;
      }
    },

    _stepSplashes: function (vol, dt) {
      var pool = vol.splashes;
      var dummy = vol._dummy;
      if (!pool || !vol.splashMesh || !dummy) return;

      for (var i = 0; i < pool.capacity; i++) {
        if (!pool.active[i]) {
          dummy.position.set(0, 0, -99999);
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          vol.splashMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        pool.life[i] += dt;
        var progress = pool.life[i] / pool.maxLife[i];

        if (progress >= 1.0) {
          pool.active[i] = 0;
          pool.activeCount = Math.max(0, pool.activeCount - 1);
          dummy.position.set(0, 0, -99999);
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          vol.splashMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        var idx3 = i * 3;
        var r = pool.maxRadius[i] * Math.sin(progress * Math.PI * 0.5);

        dummy.position.set(pool.pos[idx3], pool.pos[idx3 + 1], pool.pos[idx3 + 2]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(r, r, 1.0);
        dummy.updateMatrix();
        vol.splashMesh.setMatrixAt(i, dummy.matrix);
      }

      if (vol.splashMesh.instanceMatrix) {
        vol.splashMesh.instanceMatrix.needsUpdate = true;
      }
    },

    /* ----------------------------------------------------------- Clustered Volumetric Fog Step */

    _stepFog: function (runtimeScene, vol, dt, windX, windY, windZ) {
      if (!vol.fogMesh || !vol.fogMaterial) return;

      var b = vol.bounds;
      vol.fogMesh.position.set(b.centerX, b.centerY, b.centerZ);

      var u = vol.fogMaterial.uniforms;
      if (u) {
        if (u.u_BoxMin) u.u_BoxMin.value.set(b.minX, -b.maxY, b.minZ);
        if (u.u_BoxMax) u.u_BoxMax.value.set(b.maxX, -b.minY, b.maxZ);
        if (u.u_BoxSize) u.u_BoxSize.value.set(b.width, b.height, b.depth);

        // Wind advection accumulator
        vol.fogWindOffset[0] += windX * dt * 0.0004;
        vol.fogWindOffset[1] += windY * dt * 0.0004;
        vol.fogWindOffset[2] += windZ * dt * 0.0004;
        if (u.u_WindOffset) {
          u.u_WindOffset.value.set(vol.fogWindOffset[0], vol.fogWindOffset[1], vol.fogWindOffset[2]);
        }

        if (u.u_FogDensity) u.u_FogDensity.value = vol.fogThickness * 0.05;
        if (u.u_FogHeightFalloff) u.u_FogHeightFalloff.value = vol.fogHeightFalloff;
        if (u.u_FogAnisotropy) u.u_FogAnisotropy.value = vol.fogAnisotropy;
        if (u.u_NoiseScale) u.u_NoiseScale.value = vol.fogNoiseScale;
        if (u.u_StepCount) u.u_StepCount.value = vol.fogStepCount;
        if (u.u_LightningIntensity) {
          var lightningStrength = vol.lightningBrightness * vol.lightningIntensity;
          var state = getSceneState(runtimeScene);
          for (var i = 0; i < state.volumes.length; i++) {
            var other = state.volumes[i];
            if (other !== vol && other.object === vol.object) {
              lightningStrength = Math.max(
                lightningStrength,
                other.lightningBrightness * other.lightningIntensity
              );
            }
          }
          u.u_LightningIntensity.value = lightningStrength;
        }

        // Try syncing sun direction from layer three scene if available
        var scene = getLayerThreeRoot(runtimeScene, vol.layerName);
        if (scene && scene.traverse && vol._vecA) {
          var sunFound = false;
          scene.traverse(function (child) {
            if (!sunFound && child && child.isDirectionalLight) {
              sunFound = true;
              if (u.u_SunDirection && child.getWorldDirection) {
                child.getWorldDirection(vol._vecA);
                u.u_SunDirection.value.copy(vol._vecA).negate();
              }
              if (u.u_SunColor && child.color) {
                u.u_SunColor.value.setRGB(child.color.r, child.color.g, child.color.b);
              }
              if (u.u_SunIntensity) {
                u.u_SunIntensity.value = child.intensity || 1.0;
              }
            }
          });
        }
      }
    },

    getFogDensityAt: function (runtimeScene, behavior, x, y, z) {
      var vol = AdvancedWeather3D.volumeOf(runtimeScene, behavior);
      if (!vol || !vol.enabled || !vol.enableClusteredFog) return 0.0;

      var b = vol.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) {
        return 0.0;
      }

      var cx = (x - b.minX) / Math.max(b.width, 1.0);
      var cy = (y - b.minY) / Math.max(b.height, 1.0);
      var cz = (z - b.minZ) / Math.max(b.depth, 1.0);

      var heightRatio = clamp(cz, 0.0, 1.0);
      var heightDensity = Math.exp(-vol.fogHeightFalloff * heightRatio);

      var sampleX = cx * vol.fogNoiseScale * 3.5 + vol.fogWindOffset[0];
      var sampleY = cy * vol.fogNoiseScale * 3.5 + vol.fogWindOffset[1];
      var sampleZ = cz * vol.fogNoiseScale * 3.5 + vol.fogWindOffset[2];

      var noiseVal = clamp(fbm3D(sampleX, sampleY, sampleZ) * 1.6 - 0.25, 0.0, 1.0);
      return vol.fogThickness * heightDensity * noiseVal;
    },

    /* ----------------------------------------------------------- Lightning */

    _stepLightning: function (runtimeScene, vol, dt) {
      vol.timeSinceLastLightning += dt;

      if (!vol.enableLightning && !vol.lightningActive) {
        vol.lightningBrightness = 0.0;
        if (vol.lightningLight) vol.lightningLight.intensity = 0.0;
        return;
      }

      if (vol.enableLightning) {
        vol.lightningTimer -= dt;
        if (vol.lightningTimer <= 0.0 && !vol.lightningActive) {
          AdvancedWeather3D.triggerLightningFlash(runtimeScene, vol.behavior);
        }
      }

      if (vol.lightningActive) {
        vol.lightningFlashAge += dt;
        var age = vol.lightningFlashAge;

        var b = 0.0;
        if (age < 0.08) {
          b = 1.0 - (age / 0.08) * 0.4;
        } else if (age < 0.12) {
          b = 0.6 - ((age - 0.08) / 0.04) * 0.3;
        } else if (age < 0.18) {
          b = 0.85 - ((age - 0.12) / 0.06) * 0.4;
        } else if (age < vol.lightningFlashDuration) {
          b = 0.45 * (1.0 - (age - 0.18) / (vol.lightningFlashDuration - 0.18));
        } else {
          vol.lightningActive = false;
          b = 0.0;
        }

        vol.lightningBrightness = clamp(b, 0.0, 1.0);

        if (vol.lightningLight) {
          vol.lightningLight.intensity = vol.lightningBrightness * vol.lightningIntensity * 1500.0;
        }
      } else {
        vol.lightningBrightness = 0.0;
        if (vol.lightningLight) {
          vol.lightningLight.intensity = 0.0;
        }
      }
    },

    triggerLightningFlash: function (runtimeScene, behavior) {
      var vol = AdvancedWeather3D.volumeOf(runtimeScene, behavior);
      if (!vol) return;

      vol.lightningActive = true;
      vol.lightningFlashAge = 0.0;
      vol.timeSinceLastLightning = 0.0;
      vol.lightningBrightness = 1.0;
      vol.lightningTimer = lerp(vol.lightningIntervalMin, vol.lightningIntervalMax, Math.random());
    },

    /* ----------------------------------------------------------- Shelter Registration */

    registerShelter: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);
      options = options || {};

      var shelter = {
        object: object,
        behavior: behavior,
        layerName: objectLayerName(object),
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        splashOnRoof: options.splashOnRoof !== undefined ? !!options.splashOnRoof : true,
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }
      };

      state.shelters.push(shelter);
      AdvancedWeather3D.stepShelter(runtimeScene, object, behavior);
      return shelter;
    },

    stepShelter: function (runtimeScene, object, behavior) {
      var state = getSceneState(runtimeScene);
      for (var i = 0; i < state.shelters.length; i++) {
        var sh = state.shelters[i];
        if (sh.behavior === behavior) {
          // Keep runtime registration synchronized with property setters.
          if (behavior._getShelterEnabled) sh.enabled = !!behavior._getShelterEnabled();
          if (behavior._getSplashOnRoof) sh.splashOnRoof = !!behavior._getSplashOnRoof();
          var ox = object.getX ? object.getX() : 0;
          var oy = object.getY ? object.getY() : 0;
          var oz = object.getZ ? object.getZ() : 0;
          var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 100;
          var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 100;
          var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 50;

          sh.bounds.minX = ox;
          sh.bounds.maxX = ox + w;
          sh.bounds.minY = oy;
          sh.bounds.maxY = oy + h;
          sh.bounds.minZ = oz;
          sh.bounds.maxZ = oz + d;
          return sh;
        }
      }
      return null;
    },

    shelterOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var shelters = getSceneState(runtimeScene).shelters;
      for (var i = 0; i < shelters.length; i++) {
        if (shelters[i].behavior === behavior) return shelters[i];
      }
      return null;
    },

    updateShelter: function (runtimeScene, behavior, changes) {
      var shelter = AdvancedWeather3D.shelterOf(runtimeScene, behavior);
      if (!shelter || !changes) return;
      if (changes.enabled !== undefined) shelter.enabled = !!changes.enabled;
      if (changes.splashOnRoof !== undefined) shelter.splashOnRoof = !!changes.splashOnRoof;
    },

    disposeShelter: function (runtimeScene, behavior) {
      var state = getSceneState(runtimeScene);
      for (var i = 0; i < state.shelters.length; i++) {
        if (state.shelters[i].behavior === behavior) {
          state.shelters.splice(i, 1);
          break;
        }
      }
    },

    /* ----------------------------------------------------------- Volume Disposal */

    disposeWeatherVolume: function (runtimeScene, behavior) {
      var state = getSceneState(runtimeScene);
      for (var i = 0; i < state.volumes.length; i++) {
        var vol = state.volumes[i];
        if (vol.behavior === behavior) {
          if (vol.mesh) {
            if (vol.mesh.parent) vol.mesh.parent.remove(vol.mesh);
            if (vol.geometry && vol.geometry.dispose) vol.geometry.dispose();
            if (vol.material && vol.material.dispose) vol.material.dispose();
          }
          if (vol.splashMesh) {
            if (vol.splashMesh.parent) vol.splashMesh.parent.remove(vol.splashMesh);
            if (vol.splashGeometry && vol.splashGeometry.dispose) vol.splashGeometry.dispose();
            if (vol.splashMaterial && vol.splashMaterial.dispose) vol.splashMaterial.dispose();
          }
          if (vol.fogMesh) {
            if (vol.fogMesh.parent) vol.fogMesh.parent.remove(vol.fogMesh);
            if (vol.fogGeometry && vol.fogGeometry.dispose) vol.fogGeometry.dispose();
            if (vol.fogMaterial && vol.fogMaterial.dispose) vol.fogMaterial.dispose();
          }
          if (vol.debugWireframe) {
            if (vol.debugWireframe.parent) vol.debugWireframe.parent.remove(vol.debugWireframe);
            if (vol.debugWireframe.geometry && vol.debugWireframe.geometry.dispose) vol.debugWireframe.geometry.dispose();
            if (vol.debugWireframe.material && vol.debugWireframe.material.dispose) vol.debugWireframe.material.dispose();
          }
          if (vol.lightningLight && vol.lightningLight.parent) {
            vol.lightningLight.parent.remove(vol.lightningLight);
          }

          state.volumes.splice(i, 1);

          if (vol.object && vol.hideHostMesh) {
            var visibilityEntry = state.hostVisibility.get(vol.object);
            if (visibilityEntry) visibilityEntry.count--;
            if (!visibilityEntry || visibilityEntry.count <= 0) {
              var rootObj = getRootObject3D(vol.object);
              if (rootObj) rootObj.visible = visibilityEntry ? visibilityEntry.originalVisible : true;
              state.hostVisibility.delete(vol.object);
            }
          }
          break;
        }
      }
    },

    /* ----------------------------------------------------------- Lookup & Modification */

    volumeOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      for (var i = 0; i < state.volumes.length; i++) {
        if (state.volumes[i].behavior === behavior) return state.volumes[i];
      }
      return null;
    },

    _refreshParticleSpeeds: function (vol) {
      var pool = vol.particles;
      for (var i = 0; i < pool.count; i++) {
        var speed = vol.particleSpeed *
          (1.0 + (Math.random() * 2.0 - 1.0) * vol.particleSpeedVariation);
        pool.baseSpeed[i] = speed;
        pool.vel[i * 3 + 2] = -speed;
        pool.bounceCount[i] = 0;
      }
    },

    _setParticleDensity: function (runtimeScene, vol, density) {
      var count = Math.max(0, Math.min(15000, Math.round(Number(density) || 0)));
      if (count === vol.particles.capacity) {
        vol.particleDensity = count;
        return;
      }
      vol.particleDensity = count;
      vol.particles = allocateParticlePool(count);
      vol.splashes = allocateSplashPool(Math.min(500, Math.round(count * 0.35)));
      AdvancedWeather3D._initParticles(vol);
      if (THREE_OK) {
        AdvancedWeather3D._setupParticleRenderer(runtimeScene, vol);
        AdvancedWeather3D._setupSplashRenderer(runtimeScene, vol);
      }
    },

    updateWeatherVolume: function (runtimeScene, object, behavior, changes) {
      var vol = AdvancedWeather3D.volumeOf(runtimeScene, behavior);
      if (!vol || !changes) return;

      for (var k in changes) {
        if (!Object.prototype.hasOwnProperty.call(changes, k)) continue;
        var val = changes[k];

        if (k === 'weatherType') {
          vol.weatherType = val;
          var preset = WEATHER_PRESETS[val];
          if (preset) {
            vol.particleDensity = preset.particleDensity;
            vol.particleSpeed = preset.particleSpeed;
            vol.particleSpeedVariation = preset.particleSpeedVariation;
            vol.particleSize = preset.particleSize;
            vol.streakLength = preset.streakLength;
            vol.streakThickness = preset.streakThickness || preset.particleSize;
            vol.particleColor = [preset.particleColor[0] / 255, preset.particleColor[1] / 255, preset.particleColor[2] / 255];
            vol.particleOpacity = preset.particleOpacity;
            vol.swayAmount = preset.swayAmount;
            vol.swaySpeed = preset.swaySpeed;
            vol.enableFloorSplashes = preset.enableFloorSplashes;
            vol.splashSize = preset.splashSize;
            vol.splashLifetime = preset.splashLifetime;
            vol.splashDensity = preset.splashDensity;
            vol.splashStyle = preset.splashStyle || 'Ring';

            if (preset.enableClusteredFog !== undefined) {
              vol.enableClusteredFog = preset.enableClusteredFog;
              if (vol.enableClusteredFog && !vol.fogMesh) {
                AdvancedWeather3D._setupFogRenderer(runtimeScene, vol);
              }
              if (vol.fogMesh) vol.fogMesh.visible = vol.enableClusteredFog;
            }
            if (preset.fogThickness !== undefined) vol.fogThickness = preset.fogThickness;
            if (preset.fogHeightFalloff !== undefined) vol.fogHeightFalloff = preset.fogHeightFalloff;

            if (vol.material) {
              vol.material.color.setRGB(vol.particleColor[0], vol.particleColor[1], vol.particleColor[2]);
              vol.material.opacity = vol.particleOpacity;
              vol.material.blending = (val === 'Embers') ? THREE.AdditiveBlending : THREE.NormalBlending;
              vol.material.needsUpdate = true;
            }
            if (vol.splashMaterial) {
              vol.splashMaterial.color.setRGB(vol.particleColor[0], vol.particleColor[1], vol.particleColor[2]);
              vol.splashMaterial.opacity = vol.particleOpacity * 0.7;
              vol.splashMaterial.needsUpdate = true;
            }
            AdvancedWeather3D._setParticleDensity(runtimeScene, vol, preset.particleDensity);
            AdvancedWeather3D._refreshParticleSpeeds(vol);
            if (THREE_OK) {
              AdvancedWeather3D._setupParticleRenderer(runtimeScene, vol);
              AdvancedWeather3D._setupSplashRenderer(runtimeScene, vol);
            }
          }
        } else if (k === 'particleDensity') {
          AdvancedWeather3D._setParticleDensity(runtimeScene, vol, val);
        } else if (k === 'particleSpeed') {
          vol.particleSpeed = Number(val) || 0.0;
          AdvancedWeather3D._refreshParticleSpeeds(vol);
        } else if (k === 'particleSpeedVariation') {
          vol.particleSpeedVariation = clamp(Number(val) || 0.0, 0.0, 1.0);
          AdvancedWeather3D._refreshParticleSpeeds(vol);
        } else if (k === 'particleSize' || k === 'streakLength' || k === 'streakThickness') {
          vol[k] = Math.max(0.0, Number(val) || 0.0);
          if (THREE_OK) AdvancedWeather3D._setupParticleRenderer(runtimeScene, vol);
        } else if (k === 'enableFloorSplashes') {
          vol.enableFloorSplashes = !!val;
          if (THREE_OK) AdvancedWeather3D._setupSplashRenderer(runtimeScene, vol);
        } else if (k === 'splashStyle') {
          vol.splashStyle = val === 'DoubleRing' || val === 'Crown' ? val : 'Ring';
          if (THREE_OK) AdvancedWeather3D._setupSplashRenderer(runtimeScene, vol);
        } else if (k === 'debugBounds') {
          vol.debugBounds = !!val;
          if (THREE_OK) AdvancedWeather3D._setupDebugRenderer(runtimeScene, vol);
        } else if (k === 'enableClusteredFog') {
          vol.enableClusteredFog = !!val;
          if (vol.enableClusteredFog && !vol.fogMesh) {
            AdvancedWeather3D._setupFogRenderer(runtimeScene, vol);
          }
          if (vol.fogMesh) vol.fogMesh.visible = vol.enableClusteredFog;
        } else if (k === 'particleColor') {
          var c = parseColor(val, [255, 255, 255]);
          vol.particleColor = [c[0] / 255, c[1] / 255, c[2] / 255];
          if (vol.material) {
            vol.material.color.setRGB(vol.particleColor[0], vol.particleColor[1], vol.particleColor[2]);
            vol.material.needsUpdate = true;
          }
        } else if (k === 'particleOpacity') {
          vol.particleOpacity = clamp(val, 0.0, 1.0);
          if (vol.material) {
            vol.material.opacity = vol.particleOpacity;
            vol.material.needsUpdate = true;
          }
          if (vol.splashMaterial) {
            vol.splashMaterial.opacity = vol.particleOpacity * 0.7;
            vol.splashMaterial.needsUpdate = true;
          }
        } else if (k === 'fogColor') {
          var fgc = parseColor(val, [200, 215, 230]);
          vol.fogColor = [fgc[0] / 255, fgc[1] / 255, fgc[2] / 255];
          if (vol.fogMaterial && vol.fogMaterial.uniforms && vol.fogMaterial.uniforms.u_FogColor) {
            vol.fogMaterial.uniforms.u_FogColor.value.setRGB(vol.fogColor[0], vol.fogColor[1], vol.fogColor[2]);
          }
        } else if (k === 'lightningFlashColor') {
          var fc = parseColor(val, [220, 235, 255]);
          vol.lightningFlashColor = [fc[0] / 255, fc[1] / 255, fc[2] / 255];
          if (vol.lightningLight) {
            vol.lightningLight.color.setRGB(vol.lightningFlashColor[0], vol.lightningFlashColor[1], vol.lightningFlashColor[2]);
          }
          if (vol.fogMaterial && vol.fogMaterial.uniforms && vol.fogMaterial.uniforms.u_LightningColor) {
            vol.fogMaterial.uniforms.u_LightningColor.value.set(
              vol.lightningFlashColor[0], vol.lightningFlashColor[1], vol.lightningFlashColor[2]
            );
          }
        } else if (k === 'windPitch') {
          vol.windPitch = clamp(Number(val) || 0.0, -85.0, 85.0);
        } else if (k === 'windTurbulence' || k === 'splashDensity') {
          vol[k] = clamp(Number(val) || 0.0, 0.0, 1.0);
        } else if (k === 'fogAnisotropy') {
          vol.fogAnisotropy = clamp(Number(val) || 0.0, -0.85, 0.85);
        } else if (k === 'fogQuality') {
          vol.fogQuality = val;
          vol.fogStepCount = fogStepsForQuality(val);
        } else if (k === 'lightningIntervalMin' || k === 'lightningIntervalMax') {
          vol[k] = Math.max(0.05, Number(val) || 0.05);
        } else {
          vol[k] = val;
        }
      }

      if (vol.lightningIntervalMax < vol.lightningIntervalMin) {
        var interval = vol.lightningIntervalMin;
        vol.lightningIntervalMin = vol.lightningIntervalMax;
        vol.lightningIntervalMax = interval;
      }
    },

    /* ----------------------------------------------------------- Queries */

    isPointInsideVolume: function (runtimeScene, behavior, x, y, z) {
      var vol = AdvancedWeather3D.volumeOf(runtimeScene, behavior);
      if (!vol || !vol.enabled) return false;
      var b = vol.bounds;
      return x >= b.minX && x <= b.maxX &&
             y >= b.minY && y <= b.maxY &&
             z >= b.minZ && z <= b.maxZ;
    },

    isObjectInsideVolume: function (runtimeScene, behavior, targetObject) {
      if (!targetObject) return false;
      var ox = targetObject.getX ? targetObject.getX() : 0;
      var oy = targetObject.getY ? targetObject.getY() : 0;
      var oz = targetObject.getZ ? targetObject.getZ() : 0;
      return AdvancedWeather3D.isPointInsideVolume(runtimeScene, behavior, ox, oy, oz);
    },

    /* ----------------------------------------------------------- Global Controls */

    setGlobalWind: function (runtimeScene, speed, direction) {
      var state = getSceneState(runtimeScene);
      state.globalWindSpeed = speed;
      state.globalWindDirection = direction;
    },

    setGlobalSpeedMultiplier: function (runtimeScene, mult) {
      var state = getSceneState(runtimeScene);
      state.globalSpeedMultiplier = Math.max(0.0, mult);
    },

    getGlobalWindSpeed: function (runtimeScene) {
      return getSceneState(runtimeScene).globalWindSpeed;
    },

    getGlobalWindDirection: function (runtimeScene) {
      return getSceneState(runtimeScene).globalWindDirection;
    },

    getSceneState: function (runtimeScene) {
      return getSceneState(runtimeScene);
    },

    /* ----------------------------------------------------------- Cleanup Hook */

    __cleanup: function () {
      for (var s = 0; s < allSceneStates.length; s++) {
        var state = allSceneStates[s];
        while (state.volumes.length > 0) {
          AdvancedWeather3D.disposeWeatherVolume(state.runtimeScene, state.volumes[0].behavior);
        }
        state.shelters.length = 0;
        state.hostVisibility.clear();
      }
      allSceneStates.length = 0;
    }
  };

  gdjs.__advancedWeather3D = AdvancedWeather3D;
})();
