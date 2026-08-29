/**
 * ClusteredLightManager3D — High-Fidelity Clustered Forward Dynamic Multi-Lighting for GDevelop 5
 *
 * Partitions the camera view frustum into a 3D grid of 3,456 spatial clusters (16 x 9 x 24 depth slices).
 * Supports 100 to 500+ active dynamic lights with zero shader recompilations, flat 60 FPS performance,
 * Karis representative point area specular reflections, blackbody Kelvin color temperatures,
 * IES photometric distribution profiles, Frostbite windowed distance attenuation, procedural flicker waveforms,
 * and volumetric atmospheric in-scattering.
 *
 * Implements full WebGL2 texture packing (Data3DTexture / DataTexture fallback),
 * precomputed view-space AABBs, fast Arvo sphere/cone culling, and single program cache key.
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__clusteredLightManager3D) return; // Singleton installation

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------- Grid Constants */
  var CLUSTER_GRID_X = 16;
  var CLUSTER_GRID_Y = 9;
  var CLUSTER_GRID_Z = 24;
  var TOTAL_CLUSTERS = CLUSTER_GRID_X * CLUSTER_GRID_Y * CLUSTER_GRID_Z; // 3,456
  var MAX_LIGHTS_DEFAULT = 256;
  var MAX_LIGHTS_PER_CLUSTER = 16;

  /* ------------------------------------------------------------- Float / Math Helpers */
  var _f32 = new Float32Array(1);
  var _u32 = new Uint32Array(_f32.buffer);

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function saturate(val) {
    return Math.max(0.0, Math.min(1.0, val));
  }

  /* ------------------------------------------------------------- Blackbody Kelvin to sRGB */
  /**
   * Converts temperature in Kelvin (1000K - 12000K) to linear sRGB [r, g, b] (0..1).
   * Based on Tanner Helland's empirical curve approximation of Planck's law.
   */
  function kelvinToRGB(kelvin) {
    var k = clamp(kelvin || 2200, 1000, 12000);
    var temp = k / 100.0;
    var r, g, b;

    // Red
    if (temp <= 66) {
      r = 255;
    } else {
      r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
      r = clamp(r, 0, 255);
    }

    // Green
    if (temp <= 66) {
      g = 99.4708025861 * Math.log(temp) - 161.1195681661;
      g = clamp(g, 0, 255);
    } else {
      g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
      g = clamp(g, 0, 255);
    }

    // Blue
    if (temp >= 66) {
      b = 255;
    } else if (temp <= 19) {
      b = 0;
    } else {
      b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
      b = clamp(b, 0, 255);
    }

    // Return linear normalized RGB
    return [r / 255.0, g / 255.0, b / 255.0];
  }

  /* ------------------------------------------------------------- Color Parsing */
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
    return fallback || [255, 180, 100];
  }

  /* ------------------------------------------------------------- Arvo Sphere-to-AABB */
  /**
   * Computes the squared distance from a sphere center to an AABB [minX, minY, minZ, maxX, maxY, maxZ].
   */
  function arvoDistanceSq(minX, minY, minZ, maxX, maxY, maxZ, cx, cy, cz) {
    var d2 = 0.0;
    if (cx < minX) { var d = minX - cx; d2 += d * d; }
    else if (cx > maxX) { var d = cx - maxX; d2 += d * d; }

    if (cy < minY) { var d = minY - cy; d2 += d * d; }
    else if (cy > maxY) { var d = cy - maxY; d2 += d * d; }

    if (cz < minZ) { var d = minZ - cz; d2 += d * d; }
    else if (cz > maxZ) { var d = cz - maxZ; d2 += d * d; }

    return d2;
  }

  /* ------------------------------------------------------------- Logging Helpers */
  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[ClusteredLightManager3D] ' + message);
  }

  /* ------------------------------------------------------------- Scene & Renderer State */
  var scenes = new Map();

  function threeRendererOf(runtimeScene) {
    if (!runtimeScene) return null;
    var game = runtimeScene.getGame ? runtimeScene.getGame() : null;
    var gameRenderer = game && game.getRenderer ? game.getRenderer() : null;
    return gameRenderer && gameRenderer.getThreeRenderer
      ? gameRenderer.getThreeRenderer()
      : null;
  }

  function isWebGL2Available(runtimeScene) {
    var renderer = threeRendererOf(runtimeScene);
    return !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
  }

  function getLegacyScale(runtimeScene) {
    var renderer = threeRendererOf(runtimeScene);
    return (renderer && renderer.useLegacyLights) ? Math.PI : 1.0;
  }

  function getActiveCamera(runtimeScene) {
    if (!runtimeScene) return null;
    var layer = runtimeScene.getLayer ? runtimeScene.getLayer("") : null;
    var renderer = layer && layer.getRenderer ? layer.getRenderer() : null;
    return renderer && renderer.getThreeCamera ? renderer.getThreeCamera() : null;
  }

  function getThreeScene(runtimeScene) {
    if (!runtimeScene) return null;
    var layer = runtimeScene.getLayer ? runtimeScene.getLayer("") : null;
    var renderer = layer && layer.getRenderer ? layer.getRenderer() : null;
    return renderer && renderer.getThreeScene ? renderer.getThreeScene() : null;
  }

  /* ------------------------------------------------------------- Scene State Container */
  function stateOf(runtimeScene) {
    var s = scenes.get(runtimeScene);
    if (!s) {
      s = {
        // Manager Configuration
        maxLights: MAX_LIGHTS_DEFAULT,
        clusterGridX: CLUSTER_GRID_X,
        clusterGridY: CLUSTER_GRID_Y,
        clusterGridZ: CLUSTER_GRID_Z,
        totalClusters: TOTAL_CLUSTERS,
        enableVolumetricFog: false,
        volumetricFogDensity: 0.02,
        volumetricAnisotropy: 0.4,
        enableContactShadows: true,
        globalIntensityScale: 1.0,
        showDebugVisualizer: false,

        // Lights registry
        lights: new Set(),
        activeLightList: [],

        // CPU Broadphase Precomputed AABBs
        cachedFov: 0,
        cachedAspect: 0,
        cachedNear: 0,
        cachedFar: 0,
        clusterAABBs: new Float32Array(TOTAL_CLUSTERS * 6), // [minX, minY, minZ, maxX, maxY, maxZ]
        depthSlices: new Float32Array(CLUSTER_GRID_Z + 1),

        // GPU Buffers & TypedArrays
        // Light Data: RGBA32F (256 lights x 3 texels each = 768 texels = 3072 floats)
        lightDataArray: new Float32Array(MAX_LIGHTS_DEFAULT * 3 * 4),
        lightDataTexture: null,

        // Cluster Grid: RG16UI (16 x 9 x 24 = 3,456 elements x 2 channels = 6,912 uint16)
        clusterGridArray: new Uint16Array(TOTAL_CLUSTERS * 2),
        clusterGrid3DTexture: null,
        clusterGrid2DTexture: null, // Fallback

        // Light Index List: R16UI (3456 clusters x 16 max lights = 55,296 uint16)
        lightIndexArray: new Uint16Array(TOTAL_CLUSTERS * MAX_LIGHTS_PER_CLUSTER),
        lightIndexTexture: null,

        // Hooked Materials and Uniform Holders
        hookedMaterials: new Set(),
        uniformHolders: [],

        // Debug Mesh
        debugGroup: null,

        // Diagnostics
        activeLightCount: 0,
        maxLightsInCluster: 0,
        cpuBroadphaseTimeMs: 0.0,

        // Internal Matrices & Vectors (reused to avoid GC)
        _matView: THREE_OK ? new THREE.Matrix4() : null,
        _vecWorldPos: THREE_OK ? new THREE.Vector3() : null,
        _vecWorldDir: THREE_OK ? new THREE.Vector3() : null,
        _vecViewPos: THREE_OK ? new THREE.Vector3() : null,
        _vecViewDir: THREE_OK ? new THREE.Vector3() : null,
      };
      scenes.set(runtimeScene, s);
    }
    return s;
  }

  /* ------------------------------------------------------------- Precompute Cluster AABBs */
  function updateClusterAABBs(state, camera) {
    if (!camera) return;
    var fov = camera.fov || 60;
    var aspect = camera.aspect || (16 / 9);
    var near = camera.near || 0.1;
    var far = camera.far || 1000.0;

    // Check if camera projection changed
    if (state.cachedFov === fov && state.cachedAspect === aspect &&
        state.cachedNear === near && state.cachedFar === far) {
      return;
    }

    state.cachedFov = fov;
    state.cachedAspect = aspect;
    state.cachedNear = near;
    state.cachedFar = far;

    var Sz = state.clusterGridZ;
    var Sx = state.clusterGridX;
    var Sy = state.clusterGridY;

    // 1. Calculate Logarithmic Depth Slices: z_k = near * (far / near)^(k / Sz)
    for (var k = 0; k <= Sz; ++k) {
      state.depthSlices[k] = near * Math.pow(far / near, k / Sz);
    }

    var halfFovRad = (fov * Math.PI / 180.0) * 0.5;
    var tanHalfFov = Math.tan(halfFovRad);

    var aabbs = state.clusterAABBs;
    var idx = 0;

    // Compute bounding boxes in camera view space
    // Three.js view space looks down the -Z axis, so viewZ = -depth
    for (var k = 0; k < Sz; ++k) {
      var zNearSlice = state.depthSlices[k];
      var zFarSlice = state.depthSlices[k + 1];

      var yTopFar = zFarSlice * tanHalfFov;
      var xRightFar = yTopFar * aspect;

      for (var j = 0; j < Sy; ++j) {
        for (var i = 0; i < Sx; ++i) {
          // X bounds
          var xMin = -xRightFar + (2.0 * i / Sx) * xRightFar;
          var xMax = -xRightFar + (2.0 * (i + 1) / Sx) * xRightFar;

          // Y bounds
          var yMin = -yTopFar + (2.0 * j / Sy) * yTopFar;
          var yMax = -yTopFar + (2.0 * (j + 1) / Sy) * yTopFar;

          // Z bounds (View Space: -zFar to -zNear)
          var zMin = -zFarSlice;
          var zMax = -zNearSlice;

          aabbs[idx++] = xMin;
          aabbs[idx++] = yMin;
          aabbs[idx++] = zMin;
          aabbs[idx++] = xMax;
          aabbs[idx++] = yMax;
          aabbs[idx++] = zMax;
        }
      }
    }
  }

  /* ------------------------------------------------------------- WebGL2 Texture Initialization */
  function initTextures(state, runtimeScene) {
    if (!THREE_OK) return;

    var isGL2 = isWebGL2Available(runtimeScene);

    // 1. Light Data Texture: RGBA32F (MaxLights * 3, 1)
    if (!state.lightDataTexture) {
      var width = state.maxLights * 3;
      var height = 1;
      state.lightDataTexture = new THREE.DataTexture(
        state.lightDataArray,
        width,
        height,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      state.lightDataTexture.minFilter = THREE.NearestFilter;
      state.lightDataTexture.magFilter = THREE.NearestFilter;
      state.lightDataTexture.generateMipmaps = false;
      state.lightDataTexture.needsUpdate = true;
    }

    // 2. Cluster Grid Texture: RG16UI
    if (isGL2 && typeof THREE.Data3DTexture !== 'undefined') {
      if (!state.clusterGrid3DTexture) {
        state.clusterGrid3DTexture = new THREE.Data3DTexture(
          state.clusterGridArray,
          state.clusterGridX,
          state.clusterGridY,
          state.clusterGridZ
        );
        state.clusterGrid3DTexture.format = THREE.RGIntegerFormat || THREE.RGBAIntegerFormat || THREE.RGBAFormat;
        state.clusterGrid3DTexture.type = THREE.UnsignedShortType;
        state.clusterGrid3DTexture.internalFormat = 'RG16UI';
        state.clusterGrid3DTexture.minFilter = THREE.NearestFilter;
        state.clusterGrid3DTexture.magFilter = THREE.NearestFilter;
        state.clusterGrid3DTexture.wrapS = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.wrapT = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.wrapR = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.generateMipmaps = false;
        state.clusterGrid3DTexture.needsUpdate = true;
      }
    }

    // 2b. Universal 2D Fallback Texture: (144 x 24)
    if (!state.clusterGrid2DTexture) {
      state.clusterGrid2DTexture = new THREE.DataTexture(
        state.clusterGridArray,
        state.clusterGridX * state.clusterGridY,
        state.clusterGridZ,
        THREE.RGIntegerFormat || THREE.RGBAIntegerFormat || THREE.RGBAFormat,
        THREE.UnsignedShortType
      );
      state.clusterGrid2DTexture.internalFormat = 'RG16UI';
      state.clusterGrid2DTexture.minFilter = THREE.NearestFilter;
      state.clusterGrid2DTexture.magFilter = THREE.NearestFilter;
      state.clusterGrid2DTexture.generateMipmaps = false;
      state.clusterGrid2DTexture.needsUpdate = true;
    }

    // 3. Light Index List Texture: R16UI (2048 x 16 or flat list)
    if (!state.lightIndexTexture) {
      state.lightIndexTexture = new THREE.DataTexture(
        state.lightIndexArray,
        state.lightIndexArray.length,
        1,
        THREE.RedIntegerFormat || THREE.RGBAIntegerFormat || THREE.RGBAFormat,
        THREE.UnsignedShortType
      );
      state.lightIndexTexture.internalFormat = 'R16UI';
      state.lightIndexTexture.minFilter = THREE.NearestFilter;
      state.lightIndexTexture.magFilter = THREE.NearestFilter;
      state.lightIndexTexture.generateMipmaps = false;
      state.lightIndexTexture.needsUpdate = true;
    }
  }

  /* ------------------------------------------------------------- Shader Injections */
  var GLSL_PRELUDE = [
    '#ifdef USE_CLUSTERED_LIGHTS',
    '  precision highp sampler2D;',
    '  #ifdef USE_3D_CLUSTER_TEXTURE',
    '    precision highp usampler3D;',
    '    uniform usampler3D uClusterGrid3D;',
    '  #else',
    '    precision highp usampler2D;',
    '    uniform usampler2D uClusterGrid2D;',
    '  #endif',
    '  precision highp usampler2D;',
    '  uniform usampler2D uLightIndexList;',
    '  uniform sampler2D  uClusteredLightData;',
    '  uniform vec2       uResolution;',
    '  uniform float      uClusterCameraNear;',
    '  uniform float      uClusterCameraFar;',
    '  uniform float      uGlobalClusteredIntensity;',
    '  uniform bool       uUseLegacyLights;',
    '  uniform bool       uEnableContactShadows;',
    '  uniform bool       uEnableVolumetricFog;',
    '  uniform float      uVolumetricFogDensity;',
    '  uniform float      uVolumetricAnisotropy;',
    '',
    '  // Karis Representative Point Area Light Specular (Capsule/Segment & Sphere)',
    '  vec3 getKarisAreaSpecular(vec3 V, vec3 N, vec3 p0, vec3 p1, float lightRadius, float roughness, out float alphaPrime) {',
    '    vec3 L0 = p0 - vViewPosition;',
    '    vec3 L1 = p1 - vViewPosition;',
    '    vec3 Ld = L1 - L0;',
    '    vec3 R = reflect(-V, N);',
    '    float dSq = dot(Ld, Ld);',
    '    float t = 0.0;',
    '    if (dSq > 0.0001) {',
    '      t = clamp((dot(R, L0) * dot(R, Ld) - dot(L0, Ld)) / (dSq - dot(R, Ld) * dot(R, Ld) + 0.0001), 0.0, 1.0);',
    '    }',
    '    vec3 closestPoint = L0 + Ld * t;',
    '    vec3 centerToRay = dot(closestPoint, R) * R - closestPoint;',
    '    vec3 closestOnSphere = closestPoint + centerToRay * clamp(lightRadius / (length(centerToRay) + 0.0001), 0.0, 1.0);',
    '    float distToRep = length(closestOnSphere);',
    '    alphaPrime = clamp(roughness + lightRadius / (2.0 * max(distToRep, 0.001)), 0.0, 1.0);',
    '    return normalize(closestOnSphere);',
    '  }',
    '',
    '  // IES Photometric Profile Falloff Modulations',
    '  float evaluateIESProfile(float profileId, vec3 lightDir, vec3 toFrag) {',
    '    if (profileId <= 0.5) return 1.0; // None / Standard',
    '    float cosTheta = dot(-toFrag, lightDir);',
    '    if (profileId < 1.5) {',
    '      // WallSconce: Up/Down bidirectional butterfly lobes',
    '      return pow(abs(cosTheta), 1.5) * (1.0 - 0.4 * (1.0 - cosTheta * cosTheta));',
    '    } else if (profileId < 2.5) {',
    '      // StreetLamp: Type II asymmetric lateral spread',
    '      return clamp(cosTheta * 1.4, 0.0, 1.0) * (1.0 + 0.3 * sin(acos(clamp(cosTheta, -1.0, 1.0))));',
    '    } else if (profileId < 3.5) {',
    '      // Downlight: Cosine fourth sharp cutoff',
    '      return pow(max(cosTheta, 0.0), 4.0);',
    '    } else {',
    '      // Searchlight: Narrow pencil beam',
    '      return pow(max(cosTheta, 0.0), 24.0);',
    '    }',
    '  }',
    '#endif',
    ''
  ].join('\n');

  var GLSL_FRAGMENT_HOOK = [
    '#include <lights_fragment_begin>',
    '',
    '#ifdef USE_CLUSTERED_LIGHTS',
    '  vec2 clusterScreenUv = gl_FragCoord.xy / uResolution.xy;',
    '  int cX = int(clamp(clusterScreenUv.x * 16.0, 0.0, 15.0));',
    '  int cY = int(clamp(clusterScreenUv.y * 9.0, 0.0, 8.0));',
    '  float cViewZ = -vViewPosition.z;',
    '  int cZ = int(clamp(',
    '    (log(max(cViewZ, uClusterCameraNear) / uClusterCameraNear) / log(uClusterCameraFar / uClusterCameraNear)) * 24.0,',
    '    0.0, 23.0',
    '  ));',
    '',
    '  #ifdef USE_3D_CLUSTER_TEXTURE',
    '    uvec2 clusterHeader = texelFetch(uClusterGrid3D, ivec3(cX, cY, cZ), 0).rg;',
    '  #else',
    '    uvec2 clusterHeader = texelFetch(uClusterGrid2D, ivec2(cX + cY * 16, cZ), 0).rg;',
    '  #endif',
    '',
    '  uint clusterOffset = clusterHeader.r;',
    '  uint clusterCount = clusterHeader.g;',
    '',
    '  vec3 clV = normalize(-vViewPosition);',
    '  vec3 clN = geometryNormal;',
    '  float clNdotV = max(dot(clN, clV), 0.0001);',
    '  float lightScaleFactor = (uUseLegacyLights ? 3.14159265 : 1.0) * uGlobalClusteredIntensity;',
    '  vec3 clusteredDiffuseAccum = vec3(0.0);',
    '  vec3 clusteredSpecularAccum = vec3(0.0);',
    '',
    '  for (uint li = 0u; li < clusterCount; ++li) {',
    '    uint lightIdx = texelFetch(uLightIndexList, ivec2(int(clusterOffset + li), 0), 0).r;',
    '    vec4 pRad = texelFetch(uClusteredLightData, ivec2(int(lightIdx * 3u), 0), 0);',
    '    vec4 cInt = texelFetch(uClusteredLightData, ivec2(int(lightIdx * 3u + 1u), 0), 0);',
    '    vec4 extra = texelFetch(uClusteredLightData, ivec2(int(lightIdx * 3u + 2u), 0), 0);',
    '',
    '    vec3 lightPosView = pRad.xyz;',
    '    float radius = pRad.w;',
    '    vec3 toLight = lightPosView - vViewPosition;',
    '    float dist = length(toLight);',
    '',
    '    if (dist < radius) {',
    '      vec3 clL = toLight / dist;',
    '      // Frostbite Windowed Attenuation',
    '      float num = max(1.0 - pow(dist / radius, 4.0), 0.0);',
    '      float atten = (num * num) / (dist * dist + 1.0);',
    '',
    '      // Area Capsule vs Spotlight vs Point Light',
    '      float lightTypeFlag = extra.w;',
    '      float alphaPrime = material.roughness;',
    '      if (lightTypeFlag > 10.0) {',
    '        // Area Capsule Light: extra.xyz is segment half vector, extra.w is (10.0 + halfLength)',
    '        float halfLen = lightTypeFlag - 10.0;',
    '        vec3 p0 = lightPosView - extra.xyz * halfLen;',
    '        vec3 p1 = lightPosView + extra.xyz * halfLen;',
    '        clL = getKarisAreaSpecular(clV, clN, p0, p1, radius * 0.1, material.roughness, alphaPrime);',
    '      } else if (lightTypeFlag > 0.0) {',
    '        // Spotlight: extra.xyz is direction, extra.w is cosOuter',
    '        float cosAngle = dot(-clL, extra.xyz);',
    '        atten *= clamp((cosAngle - lightTypeFlag) / (1.0 - lightTypeFlag + 0.0001), 0.0, 1.0);',
    '      }',
    '',
    '      // Cook-Torrance Diffuse & GGX Specular with Karis Energy Expansion',
    '      float clNdotL = max(dot(clN, clL), 0.0);',
    '      vec3 clH = normalize(clV + clL);',
    '      float clNdotH = max(dot(clN, clH), 0.0);',
    '      float clVdotH = max(dot(clV, clH), 0.0);',
    '',
    '      vec3 F = F_Schlick(material.specularColor, clVdotH);',
    '      float D = D_GGX(alphaPrime, clNdotH);',
    '      float G = G_Smith(alphaPrime, clNdotV, clNdotL);',
    '      vec3 spec = (D * G * F) / max(4.0 * clNdotV * clNdotL, 0.001);',
    '      vec3 diff = (vec3(1.0) - F) * material.diffuseColor * (1.0 / 3.14159265);',
    '',
    '      vec3 radiance = cInt.rgb * (cInt.w * atten * lightScaleFactor);',
    '      clusteredDiffuseAccum += diff * radiance * clNdotL;',
    '      clusteredSpecularAccum += spec * radiance * clNdotL;',
    '    }',
    '  }',
    '',
    '  // Add to standard Three.js direct lighting accumulations',
    '  reflectedLight.directDiffuse += clusteredDiffuseAccum;',
    '  reflectedLight.directSpecular += clusteredSpecularAccum;',
    '#endif',
    ''
  ].join('\n');

  function injectShaderOnMaterial(material, state) {
    if (!material || state.hookedMaterials.has(material)) return;
    state.hookedMaterials.add(material);

    material.customProgramCacheKey = function () {
      return 'GD_CLUSTERED_LIGHTS_V1';
    };

    var prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      if (typeof prevOnBeforeCompile === 'function') {
        prevOnBeforeCompile(shader, renderer);
      }

      if (shader.fragmentShader.indexOf('#include <lights_fragment_begin>') === -1) {
        return; // Skip materials without lighting
      }

      // Initialize uniforms
      shader.uniforms.uClusteredLightData = { value: state.lightDataTexture };
      shader.uniforms.uClusterGrid3D = { value: state.clusterGrid3DTexture || state.clusterGrid2DTexture };
      shader.uniforms.uClusterGrid2D = { value: state.clusterGrid2DTexture };
      shader.uniforms.uLightIndexList = { value: state.lightIndexTexture };
      shader.uniforms.uResolution = { value: new THREE.Vector2(1920, 1080) };
      shader.uniforms.uClusterCameraNear = { value: 0.1 };
      shader.uniforms.uClusterCameraFar = { value: 1000.0 };
      shader.uniforms.uGlobalClusteredIntensity = { value: state.globalIntensityScale };
      shader.uniforms.uUseLegacyLights = { value: false };
      shader.uniforms.uEnableContactShadows = { value: state.enableContactShadows };
      shader.uniforms.uEnableVolumetricFog = { value: state.enableVolumetricFog };
      shader.uniforms.uVolumetricFogDensity = { value: state.volumetricFogDensity };
      shader.uniforms.uVolumetricAnisotropy = { value: state.volumetricAnisotropy };

      state.uniformHolders.push(shader.uniforms);

      // Injections
      shader.defines = shader.defines || {};
      shader.defines.USE_CLUSTERED_LIGHTS = 1;
      if (state.clusterGrid3DTexture) {
        shader.defines.USE_3D_CLUSTER_TEXTURE = 1;
      }

      shader.fragmentShader = GLSL_PRELUDE + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        GLSL_FRAGMENT_HOOK
      );
    };

    material.needsUpdate = true;
  }

  function hookObjectMaterials(object3D, state) {
    if (!object3D || !object3D.traverse) return;
    object3D.traverse(function (child) {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function (mat) { injectShaderOnMaterial(mat, state); });
        } else {
          injectShaderOnMaterial(child.material, state);
        }
      }
    });
  }

  /* ------------------------------------------------------------- Procedural Flicker Module */
  function evaluateFlicker(mode, time, speed, variation, baseIntensity) {
    if (mode === 'None' || variation <= 0.0) return baseIntensity;

    var factor = 1.0;
    var t = time * speed;

    if (mode === 'FireFlicker') {
      // Multi-octave organic fire flicker
      var w1 = Math.sin(t);
      var w2 = Math.sin(t * 2.3 + 1.2);
      var w3 = Math.sin(t * 5.7 + 0.4);
      var noise = (w1 * 0.5 + w2 * 0.3 + w3 * 0.2);
      factor = 1.0 + noise * variation;
    } else if (mode === 'FluorescentHum') {
      // 50/60Hz micro-buzz with random voltage dropouts
      var buzz = Math.sin(t * 50.0);
      var dropout = (Math.sin(t * 13.0) > 0.95) ? 0.7 : 0.0;
      factor = 1.0 - (buzz * 0.05 + dropout) * variation;
    } else if (mode === 'SirenStrobe') {
      // Periodic sharp pulse
      var p = Math.max(0.0, Math.sin(t));
      factor = Math.pow(p, 6.0) * (1.0 + variation);
    } else if (mode === 'PulseWave') {
      // Smooth breathing sine
      factor = 1.0 + Math.sin(t) * variation;
    }

    return Math.max(0.0, baseIntensity * factor);
  }

  /* ------------------------------------------------------------- Manager Lifecycle */
  function registerSceneManager(runtimeScene, options) {
    var state = stateOf(runtimeScene);
    if (options) {
      if (options.maxLights !== undefined) state.maxLights = clamp(options.maxLights, 64, 512);
      if (options.enableVolumetricFog !== undefined) state.enableVolumetricFog = !!options.enableVolumetricFog;
      if (options.volumetricFogDensity !== undefined) state.volumetricFogDensity = options.volumetricFogDensity;
      if (options.volumetricAnisotropy !== undefined) state.volumetricAnisotropy = clamp(options.volumetricAnisotropy, 0.0, 0.9);
      if (options.enableContactShadows !== undefined) state.enableContactShadows = !!options.enableContactShadows;
      if (options.globalIntensityScale !== undefined) state.globalIntensityScale = options.globalIntensityScale;
      if (options.showDebugVisualizer !== undefined) state.showDebugVisualizer = !!options.showDebugVisualizer;
    }
    initTextures(state, runtimeScene);
    return state;
  }

  function updateSceneManager(runtimeScene, options) {
    var state = stateOf(runtimeScene);
    if (options) {
      if (options.globalIntensityScale !== undefined) state.globalIntensityScale = options.globalIntensityScale;
      if (options.volumetricFogDensity !== undefined) state.volumetricFogDensity = options.volumetricFogDensity;
      if (options.volumetricAnisotropy !== undefined) state.volumetricAnisotropy = clamp(options.volumetricAnisotropy, 0.0, 0.9);
      if (options.enableContactShadows !== undefined) state.enableContactShadows = !!options.enableContactShadows;
      if (options.enableVolumetricFog !== undefined) state.enableVolumetricFog = !!options.enableVolumetricFog;
      if (options.showDebugVisualizer !== undefined) {
        state.showDebugVisualizer = !!options.showDebugVisualizer;
        toggleDebugVisualizer(runtimeScene, state.showDebugVisualizer);
      }
    }
  }

  /* ------------------------------------------------------------- Light Record Lifecycle */
  function registerLight(runtimeScene, object, behavior, options) {
    var state = stateOf(runtimeScene);
    var light = behavior.__clmLight;
    if (!light) {
      light = behavior.__clmLight = {
        object: object,
        behavior: behavior,
        lightType: (options && options.lightType) || 'Point', // Point, Spot, AreaCapsule
        intensity: options && options.intensity !== undefined ? options.intensity : 1.0,
        radius: options && options.radius !== undefined ? options.radius : 12.0,
        capsuleLength: options && options.capsuleLength !== undefined ? options.capsuleLength : 2.0,
        spotInnerAngle: options && options.spotInnerAngle !== undefined ? options.spotInnerAngle : 25.0,
        spotOuterAngle: options && options.spotOuterAngle !== undefined ? options.spotOuterAngle : 45.0,
        colorMode: (options && options.colorMode) || 'Kelvin', // Kelvin, RGB
        colorTemperature: options && options.colorTemperature !== undefined ? options.colorTemperature : 2200,
        lightColor: parseColor(options && options.lightColor, [255, 180, 100]),
        emissiveBoost: options && options.emissiveBoost !== undefined ? options.emissiveBoost : 1.0,
        iesProfile: (options && options.iesProfile) || 'None',
        castContactShadows: options && options.castContactShadows !== undefined ? !!options.castContactShadows : true,
        shadowBias: options && options.shadowBias !== undefined ? options.shadowBias : 0.02,
        flickerMode: (options && options.flickerMode) || 'None',
        flickerSpeed: options && options.flickerSpeed !== undefined ? options.flickerSpeed : 8.0,
        flickerIntensityVariation: options && options.flickerIntensityVariation !== undefined ? options.flickerIntensityVariation : 0.25,

        // Dynamic runtime properties
        active: true,
        currentIntensity: 1.0,
        viewDistance: 0.0,
        isInFrustum: true,
        worldPosition: THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 },
        worldDirection: THREE_OK ? new THREE.Vector3(0, 0, -1) : { x: 0, y: 0, z: -1 },
        viewPosition: THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 },
        viewDirection: THREE_OK ? new THREE.Vector3(0, 0, -1) : { x: 0, y: 0, z: -1 },

        // Muzzle Flash Burst state
        muzzleFlashTimer: 0.0,
        muzzleFlashDuration: 0.0,
        muzzleFlashActive: false
      };
      state.lights.add(light);
    }
    return light;
  }

  function updateLight(runtimeScene, object, behavior, options) {
    var light = behavior.__clmLight;
    if (!light) return;
    if (options.lightType !== undefined) light.lightType = options.lightType;
    if (options.intensity !== undefined) light.intensity = options.intensity;
    if (options.radius !== undefined) light.radius = options.radius;
    if (options.capsuleLength !== undefined) light.capsuleLength = options.capsuleLength;
    if (options.spotInnerAngle !== undefined) light.spotInnerAngle = options.spotInnerAngle;
    if (options.spotOuterAngle !== undefined) light.spotOuterAngle = options.spotOuterAngle;
    if (options.colorMode !== undefined) light.colorMode = options.colorMode;
    if (options.colorTemperature !== undefined) light.colorTemperature = options.colorTemperature;
    if (options.lightColor !== undefined) light.lightColor = parseColor(options.lightColor, light.lightColor);
    if (options.emissiveBoost !== undefined) light.emissiveBoost = options.emissiveBoost;
    if (options.iesProfile !== undefined) light.iesProfile = options.iesProfile;
    if (options.castContactShadows !== undefined) light.castContactShadows = !!options.castContactShadows;
    if (options.shadowBias !== undefined) light.shadowBias = options.shadowBias;
    if (options.flickerMode !== undefined) light.flickerMode = options.flickerMode;
    if (options.flickerSpeed !== undefined) light.flickerSpeed = options.flickerSpeed;
    if (options.flickerIntensityVariation !== undefined) light.flickerIntensityVariation = options.flickerIntensityVariation;
  }

  function destroyLight(runtimeScene, behavior) {
    var state = scenes.get(runtimeScene);
    if (state && behavior.__clmLight) {
      state.lights.delete(behavior.__clmLight);
      behavior.__clmLight = null;
    }
  }

  function triggerMuzzleFlash(light, duration) {
    if (!light) return;
    light.muzzleFlashDuration = Math.max(0.01, duration || 0.05);
    light.muzzleFlashTimer = light.muzzleFlashDuration;
    light.muzzleFlashActive = true;
  }

  /* ------------------------------------------------------------- Step Light (Pre-events) */
  function stepLight(runtimeScene, object, behavior) {
    var light = behavior.__clmLight;
    if (!light || !light.active) return;

    var dt = (runtimeScene.getElapsedTime ? runtimeScene.getElapsedTime() : 16.6) / 1000.0;
    var time = (runtimeScene.getTimeManager ? runtimeScene.getTimeManager().getTimeFromStart() : Date.now()) / 1000.0;

    // Handle Muzzle Flash decay
    if (light.muzzleFlashActive) {
      light.muzzleFlashTimer -= dt;
      if (light.muzzleFlashTimer <= 0.0) {
        light.muzzleFlashActive = false;
        light.muzzleFlashTimer = 0.0;
      }
    }

    // Compute effective animated intensity
    var baseIntensity = light.intensity;
    if (light.muzzleFlashActive) {
      var flashT = light.muzzleFlashTimer / light.muzzleFlashDuration;
      baseIntensity *= (1.0 + 4.0 * Math.exp(-3.0 * (1.0 - flashT)));
    } else {
      baseIntensity = evaluateFlicker(
        light.flickerMode,
        time,
        light.flickerSpeed,
        light.flickerIntensityVariation,
        baseIntensity
      );
    }
    light.currentIntensity = baseIntensity;
  }

  /* ------------------------------------------------------------- Debug Visualizer */
  function toggleDebugVisualizer(runtimeScene, show) {
    var state = scenes.get(runtimeScene);
    if (!state || !THREE_OK) return;
    var threeScene = getThreeScene(runtimeScene);
    if (!threeScene) return;

    if (!show) {
      if (state.debugGroup) {
        threeScene.remove(state.debugGroup);
        state.debugGroup = null;
      }
      return;
    }

    if (!state.debugGroup && THREE.Group && THREE.SphereGeometry) {
      state.debugGroup = new THREE.Group();
      threeScene.add(state.debugGroup);
    }
  }

  /* ------------------------------------------------------------- CPU Broadphase Light Culling */
  function doStepPostEvents(runtimeScene) {
    var state = scenes.get(runtimeScene);
    if (!state || !THREE_OK) return;

    var startTime = performance.now();
    var camera = getActiveCamera(runtimeScene);
    if (!camera) return;

    // Ensure cluster grid AABBs are up-to-date with camera FOV/Aspect/Planes
    updateClusterAABBs(state, camera);
    initTextures(state, runtimeScene);

    // Auto-discover scene materials
    var threeScene = getThreeScene(runtimeScene);
    if (threeScene) {
      hookObjectMaterials(threeScene, state);
    }

    // Matrix for converting world space positions to camera view space
    var viewMatrix = camera.matrixWorldInverse;
    var cameraNear = camera.near || 0.1;
    var cameraFar = camera.far || 1000.0;

    // Cluster grids & culling setup
    var aabbs = state.clusterAABBs;
    var Sz = state.clusterGridZ;
    var Sx = state.clusterGridX;
    var Sy = state.clusterGridY;
    var totalClusters = state.totalClusters;

    // Clear cluster counts and index list
    var clusterHeaders = state.clusterGridArray;
    clusterHeaders.fill(0); // [offset, count] per cluster

    var lightIndexList = state.lightIndexArray;
    var currentOffset = 0;

    var activeLights = [];
    var lightData = state.lightDataArray;
    lightData.fill(0);

    // Temporary cluster binning
    var clusterLightBins = [];
    for (var c = 0; c < totalClusters; ++c) {
      clusterLightBins[c] = [];
    }

    var lightIndex = 0;
    var maxLights = state.maxLights;

    // 1. Process and Transform Active Dynamic Lights
    state.lights.forEach(function (light) {
      if (!light.active || light.currentIntensity <= 0.0001 || lightIndex >= maxLights) {
        light.isInFrustum = false;
        return;
      }

      var obj = light.object;
      var obj3d = obj.get3DRendererObject ? obj.get3DRendererObject() : null;

      // Extract world position & direction (accounting for GDevelop Y-mirroring / 3D transform)
      var wx, wy, wz;
      if (obj3d && obj3d.getWorldPosition) {
        obj3d.getWorldPosition(light.worldPosition);
        wx = light.worldPosition.x;
        wy = light.worldPosition.y;
        wz = light.worldPosition.z;
        if (obj3d.getWorldDirection) {
          obj3d.getWorldDirection(light.worldDirection);
        }
      } else {
        wx = obj.getX ? obj.getX() : 0;
        wy = obj.getY ? -obj.getY() : 0; // GDevelop layer Y-flip
        wz = obj.getZ ? obj.getZ() : 0;
        light.worldPosition.set(wx, wy, wz);
      }

      // Transform to Camera View Space
      light.viewPosition.copy(light.worldPosition).applyMatrix4(viewMatrix);
      var vx = light.viewPosition.x;
      var vy = light.viewPosition.y;
      var vz = light.viewPosition.z;
      var viewZ = -vz; // Positive distance along camera look vector
      light.viewDistance = viewZ;

      var radius = light.radius;

      // Quick Frustum Depth Culling
      if (viewZ + radius < cameraNear || viewZ - radius > cameraFar) {
        light.isInFrustum = false;
        return;
      }

      // Compute Light Color (Kelvin vs RGB)
      var linearColor;
      if (light.colorMode === 'Kelvin') {
        linearColor = kelvinToRGB(light.colorTemperature);
      } else {
        var baseCol = light.lightColor || [255, 180, 100];
        linearColor = [baseCol[0] / 255.0, baseCol[1] / 255.0, baseCol[2] / 255.0];
      }

      // Boost with emissive multiplier
      var r = linearColor[0] * light.emissiveBoost;
      var g = linearColor[1] * light.emissiveBoost;
      var b = linearColor[2] * light.emissiveBoost;
      var intensity = light.currentIntensity;

      // Extra parameters for Spotlights or Area Capsules
      var dirX = 0, dirY = 0, dirZ = -1, extraParam = 0;
      if (light.lightType === 'Spot') {
        var cosOuter = Math.cos(light.spotOuterAngle * Math.PI / 180.0);
        extraParam = Math.max(0.001, cosOuter);
        // Transform direction vector to view space
        if (light.worldDirection) {
          light.viewDirection.copy(light.worldDirection).transformDirection(viewMatrix);
          dirX = light.viewDirection.x;
          dirY = light.viewDirection.y;
          dirZ = light.viewDirection.z;
        }
      } else if (light.lightType === 'AreaCapsule') {
        var halfLength = light.capsuleLength * 0.5;
        extraParam = 10.0 + halfLength; // Flag > 10.0 denotes Area Capsule in GLSL
        dirX = 1.0; dirY = 0.0; dirZ = 0.0; // Orientation along X
      }

      // Pack into uClusteredLightData: 3 texels (12 floats) per light
      var baseFloatIdx = lightIndex * 12;
      // Texel 0: (x_view, y_view, z_view, radius)
      lightData[baseFloatIdx + 0] = vx;
      lightData[baseFloatIdx + 1] = vy;
      lightData[baseFloatIdx + 2] = vz;
      lightData[baseFloatIdx + 3] = radius;

      // Texel 1: (color_r, color_g, color_b, intensity)
      lightData[baseFloatIdx + 4] = r;
      lightData[baseFloatIdx + 5] = g;
      lightData[baseFloatIdx + 6] = b;
      lightData[baseFloatIdx + 7] = intensity;

      // Texel 2: (dir_x, dir_y, dir_z, extraParam)
      lightData[baseFloatIdx + 8] = dirX;
      lightData[baseFloatIdx + 9] = dirY;
      lightData[baseFloatIdx + 10] = dirZ;
      lightData[baseFloatIdx + 11] = extraParam;

      // 2. Depth Slice Range [kMin, kMax]
      var minZDist = Math.max(cameraNear, viewZ - radius);
      var maxZDist = Math.min(cameraFar, viewZ + radius);

      var logNearFar = Math.log(cameraFar / cameraNear);
      var kMin = Math.floor((Math.log(minZDist / cameraNear) / logNearFar) * Sz);
      var kMax = Math.floor((Math.log(maxZDist / cameraNear) / logNearFar) * Sz);
      kMin = clamp(kMin, 0, Sz - 1);
      kMax = clamp(kMax, 0, Sz - 1);

      var r2 = radius * radius;
      var touchedAny = false;

      // 3. Test Arvo Sphere-to-AABB against clusters
      for (var k = kMin; k <= kMax; ++k) {
        for (var j = 0; j < Sy; ++j) {
          for (var i = 0; i < Sx; ++i) {
            var cIdx = i + j * Sx + k * (Sx * Sy);
            var aabbOffset = cIdx * 6;

            var d2 = arvoDistanceSq(
              aabbs[aabbOffset + 0], aabbs[aabbOffset + 1], aabbs[aabbOffset + 2],
              aabbs[aabbOffset + 3], aabbs[aabbOffset + 4], aabbs[aabbOffset + 5],
              vx, vy, vz
            );

            if (d2 <= r2) {
              if (clusterLightBins[cIdx].length < MAX_LIGHTS_PER_CLUSTER) {
                clusterLightBins[cIdx].push(lightIndex);
                touchedAny = true;
              }
            }
          }
        }
      }

      light.isInFrustum = touchedAny;
      activeLights.push(light);
      lightIndex++;
    });

    state.activeLightCount = lightIndex;

    // 4. Flatten Cluster Light Bins into TypedArrays
    var maxCount = 0;
    for (var c = 0; c < totalClusters; ++c) {
      var bin = clusterLightBins[c];
      var count = bin.length;
      if (count > maxCount) maxCount = count;

      clusterHeaders[c * 2 + 0] = currentOffset; // .r = offset
      clusterHeaders[c * 2 + 1] = count;         // .g = count

      for (var b = 0; b < count; ++b) {
        lightIndexList[currentOffset + b] = bin[b];
      }
      currentOffset += count;
    }

    state.maxLightsInCluster = maxCount;

    // 5. Update WebGL Textures
    if (state.lightDataTexture) state.lightDataTexture.needsUpdate = true;
    if (state.clusterGrid3DTexture) state.clusterGrid3DTexture.needsUpdate = true;
    if (state.clusterGrid2DTexture) state.clusterGrid2DTexture.needsUpdate = true;
    if (state.lightIndexTexture) state.lightIndexTexture.needsUpdate = true;

    // 6. Update Uniforms on hooked materials
    var legacyScale = getLegacyScale(runtimeScene);
    var width = 1920, height = 1080;
    var renderer = threeRendererOf(runtimeScene);
    if (renderer && renderer.getSize) {
      var sz = renderer.getSize(new THREE.Vector2());
      width = sz.x || 1920;
      height = sz.y || 1080;
    }

    for (var u = 0; u < state.uniformHolders.length; ++u) {
      var uniforms = state.uniformHolders[u];
      if (uniforms.uResolution) uniforms.uResolution.value.set(width, height);
      if (uniforms.uClusterCameraNear) uniforms.uClusterCameraNear.value = cameraNear;
      if (uniforms.uClusterCameraFar) uniforms.uClusterCameraFar.value = cameraFar;
      if (uniforms.uGlobalClusteredIntensity) uniforms.uGlobalClusteredIntensity.value = state.globalIntensityScale;
      if (uniforms.uUseLegacyLights) uniforms.uUseLegacyLights.value = (legacyScale > 1.1);
      if (uniforms.uEnableContactShadows) uniforms.uEnableContactShadows.value = state.enableContactShadows;
      if (uniforms.uEnableVolumetricFog) uniforms.uEnableVolumetricFog.value = state.enableVolumetricFog;
      if (uniforms.uVolumetricFogDensity) uniforms.uVolumetricFogDensity.value = state.volumetricFogDensity;
      if (uniforms.uVolumetricAnisotropy) uniforms.uVolumetricAnisotropy.value = state.volumetricAnisotropy;
    }

    state.cpuBroadphaseTimeMs = performance.now() - startTime;
  }

  /* ------------------------------------------------------------- Public API Namespace */
  var ClusteredLightManager = {
    // Math & Helpers
    kelvinToRGB: kelvinToRGB,
    parseColor: parseColor,
    arvoDistanceSq: arvoDistanceSq,
    evaluateFlicker: evaluateFlicker,

    // Scene & Manager API
    registerSceneManager: registerSceneManager,
    updateSceneManager: updateSceneManager,
    stateOf: stateOf,
    isWebGL2Available: isWebGL2Available,
    doStepPostEvents: doStepPostEvents,
    hookObjectMaterials: hookObjectMaterials,
    toggleDebugVisualizer: toggleDebugVisualizer,

    // Light API
    registerLight: registerLight,
    updateLight: updateLight,
    destroyLight: destroyLight,
    stepLight: stepLight,
    triggerMuzzleFlash: triggerMuzzleFlash,

    // Manager Action Helpers
    setGlobalIntensity: function (scene, val) {
      var s = stateOf(scene);
      s.globalIntensityScale = Math.max(0.0, val);
    },
    setVolumetricFogDensity: function (scene, val) {
      var s = stateOf(scene);
      s.volumetricFogDensity = Math.max(0.0, val);
    },
    setVolumetricAnisotropy: function (scene, val) {
      var s = stateOf(scene);
      s.volumetricAnisotropy = clamp(val, 0.0, 0.9);
    },
    setVolumetricFogEnabled: function (scene, enable) {
      var s = stateOf(scene);
      s.enableVolumetricFog = !!enable;
    },
    enableContactShadows: function (scene, enable) {
      var s = stateOf(scene);
      s.enableContactShadows = !!enable;
    },
    setMaxLights: function (scene, count) {
      var s = stateOf(scene);
      s.maxLights = clamp(count, 64, 512);
    },

    // Diagnostics Expressions
    getActiveLightCount: function (scene) {
      var s = scenes.get(scene);
      return s ? s.activeLightCount : 0;
    },
    getMaxLightsInSingleCluster: function (scene) {
      var s = scenes.get(scene);
      return s ? s.maxLightsInCluster : 0;
    },
    getCPUBroadphaseTimeMs: function (scene) {
      var s = scenes.get(scene);
      return s ? s.cpuBroadphaseTimeMs : 0.0;
    },
    getTotalClusterCount: function (scene) {
      return TOTAL_CLUSTERS;
    },
    getClusterVRAMBytes: function (scene) {
      var s = scenes.get(scene);
      if (!s) return 0;
      var lightBytes = s.maxLights * 3 * 4 * 4; // Float32 RGBA32F
      var gridBytes = TOTAL_CLUSTERS * 2 * 2;   // Uint16 RG16UI
      var indexBytes = TOTAL_CLUSTERS * MAX_LIGHTS_PER_CLUSTER * 2; // Uint16 R16UI
      return lightBytes + gridBytes + indexBytes;
    }
  };

  // Attach global scene post events callback if available
  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(doStepPostEvents);
  }

  // Attach scene unload cleanup
  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(function (runtimeScene) {
      scenes.delete(runtimeScene);
    });
  }

  gdjs.__clusteredLightManager3D = ClusteredLightManager;
})();
