/**
 * LightProbeGrid3D — spatially-varying indirect ambient light for dynamic 3D objects in GDevelop.
 *
 * Samples a 3D texture (sampler3D) per fragment to give dynamic objects realistic, location-aware
 * indirect ambient lighting (caves are dark overhead, rooms take on colored bounce, etc.).
 *
 * Implements corrections C1-C19 verified against GDevelop Runtime (Three r160, PIXI 7.4.2):
 *  - C1: Up is +Z. Height axis is Z in GDevelop 3D world. Outer buffer loop is Z.
 *  - C2: Layer root is Y-mirrored (scale.y = -1). Mirrored three-space bounds: [minX, -maxY, minZ].
 *  - C3/C18: Shared materials memoised game-wide are cloned per receiver instance on attach and safely disposed on destroy.
 *  - C4/C5: WebGL2 mandatory capability gate. Fragment prelude includes `precision mediump sampler3D;`.
 *  - C6/C7: HalfFloatType (RGBA16F) in Uint16Array with explicit LinearFilter and ClampToEdgeWrapping.
 *  - C8/C9: Irradiance injection after lights_fragment_begin with useLegacyLights Math.PI scale factor.
 *  - C10: MeshBasicMaterial detected and warned; injection safely bypassed.
 *  - C11: Single program variant with explicit `customProgramCacheKey = () => 'LPG3D|1'`.
 *  - C12: LightProbeVolume3D behavior attaches to Cube3D, utilizing its 3D scale gizmo for bounds.
 *  - C13/C16: Amortized raycast occlusion baker with frame budget in post-events.
 *  - C14/C15: Units in pixels (world units). Bounds + resolution authoritative; spacing derived.
 *  - C17: v1 L0 ambient single fetch.
 *  - C19: Preview/runtime instanced debug spheres.
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__lightProbeGrid3D) return; // Install singleton once

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------- Float16 Helpers */

  var _f32 = new Float32Array(1);
  var _u32 = new Uint32Array(_f32.buffer);

  function toHalf(val) {
    _f32[0] = val;
    var x = _u32[0];
    var sign = (x >> 16) & 0x8000;
    var e = ((x >> 23) & 0xff) - (127 - 15);
    var m = x & 0x007fffff;
    if (e <= 0) {
      if (e < -10) return sign;
      m = (m | 0x00800000) >> (1 - e);
      return sign | (m >> 13);
    } else if (e === 0xff - (127 - 15)) {
      if (m === 0) return sign | 0x7c00;
      return sign | 0x7c00 | (m >> 13);
    } else {
      if (e > 30) return sign | 0x7c00;
      return sign | (e << 10) | (m >> 13);
    }
  }

  function fromHalf(h) {
    var s = (h & 0x8000) >> 15;
    var e = (h & 0x7c00) >> 10;
    var f = h & 0x03ff;
    if (e === 0) {
      return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    } else if (e === 0x1f) {
      return f ? NaN : (s ? -Infinity : Infinity);
    }
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  /* ------------------------------------------------------------ Logging Helpers */

  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[LightProbeGrid3D] ' + message);
  }

  /* --------------------------------------------------------- Color String Helpers */

  function parseColor(str, fallback) {
    if (Array.isArray(str)) return str;
    if (typeof str === 'number') {
      return [(str >> 16) & 255, (str >> 8) & 255, str & 255];
    }
    if (typeof str === 'string') {
      var parts = str.split(';').map(function (v) { return parseFloat(v); });
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return [parts[0], parts[1], parts[2]];
      }
      if (str.startsWith('#') && typeof gdjs.hexToRGBColor === 'function') {
        return gdjs.hexToRGBColor(str);
      }
    }
    return fallback || [255, 255, 255];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c1, c2, t) {
    return [
      lerp(c1[0], c2[0], t),
      lerp(c1[1], c2[1], t),
      lerp(c1[2], c2[2], t)
    ];
  }

  /* ----------------------------------------------------------- Stratified Rays (32) */

  var NUM_RAYS = 32;
  var SPHERE_RAYS = (function () {
    var rays = [];
    var phi = Math.PI * (3 - Math.sqrt(5)); // Golden ratio angle
    for (var i = 0; i < NUM_RAYS; i++) {
      var y = 1 - (i / (NUM_RAYS - 1)) * 2; // -1 to 1 (in local Z-up sphere, this is Z)
      var radius = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = phi * i;
      var x = Math.cos(theta) * radius;
      var z = Math.sin(theta) * radius;
      // We map local (x, z, y) where y is altitude (Z-up in GDevelop)
      rays.push({ x: x, y: z, z: y });
    }
    return rays;
  })();

  /* ----------------------------------------------------------- Scene State */

  var scenes = new Map();

  function stateOf(runtimeScene) {
    var s = scenes.get(runtimeScene);
    if (!s) {
      s = {
        volume: null,               // Active LightProbeVolume3D record
        receivers: new Set(),       // Set of ReceiveLightProbes records
        globalIntensity: 1.0,
        dayNightBlend: 0.0,
        bakeBudgetMs: 8.0,
        bakeState: null,            // In-progress bake data
        isBakeComplete: false,
        dummyTexture: null          // 1x1x1 fallback texture
      };
      scenes.set(runtimeScene, s);
    }
    return s;
  }

  function threeRendererOf(runtimeScene) {
    var gameRenderer = runtimeScene.getGame().getRenderer();
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

  /* ------------------------------------------------------- 3D Texture Lifecycle */

  function makeData3DTexture(uint16Data, resX, resY, resZ) {
    if (!THREE_OK) return null;
    var tex = new THREE.Data3DTexture(uint16Data, resX, resY, resZ);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.HalfFloatType;                 // C7: RGBA16F core filterable in WebGL2
    tex.minFilter = THREE.LinearFilter;            // C6: Linear filter required
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function getDummyTexture(state) {
    if (!state.dummyTexture && THREE_OK) {
      var d = new Uint16Array(4);
      d[0] = toHalf(1.0);
      d[1] = toHalf(1.0);
      d[2] = toHalf(1.0);
      d[3] = toHalf(1.0);
      state.dummyTexture = makeData3DTexture(d, 1, 1, 1);
    }
    return state.dummyTexture;
  }

  /* ------------------------------------------------- Procedural Altitude Gradient */

  function generateAltitudeGradientBuffer(resX, resY, resZ, skyRgb, groundRgb, horizonRgb) {
    var count = resX * resY * resZ;
    var buffer = new Uint16Array(count * 4);

    var sky = [skyRgb[0] / 255.0, skyRgb[1] / 255.0, skyRgb[2] / 255.0];
    var ground = [groundRgb[0] / 255.0, groundRgb[1] / 255.0, groundRgb[2] / 255.0];
    var horizon = [horizonRgb[0] / 255.0, horizonRgb[1] / 255.0, horizonRgb[2] / 255.0];

    // C1: Outer loop is Z (Height axis)
    // idx = ((z * resY + y) * resX + x) * 4
    for (var z = 0; z < resZ; z++) {
      var tZ = resZ > 1 ? z / (resZ - 1) : 0.5; // 0.0 (ground) to 1.0 (sky)
      var col;
      if (tZ < 0.5) {
        col = lerpColor(ground, horizon, tZ * 2.0);
      } else {
        col = lerpColor(horizon, sky, (tZ - 0.5) * 2.0);
      }

      var hr = toHalf(col[0]);
      var hg = toHalf(col[1]);
      var hb = toHalf(col[2]);
      var ha = toHalf(1.0);

      for (var y = 0; y < resY; y++) {
        for (var x = 0; x < resX; x++) {
          var idx = ((z * resY + y) * resX + x) * 4;
          buffer[idx] = hr;
          buffer[idx + 1] = hg;
          buffer[idx + 2] = hb;
          buffer[idx + 3] = ha;
        }
      }
    }

    return buffer;
  }

  /* ------------------------------------------------------- Shader Injection (C4, C5, C8, C9, C11) */

  var GLSL_PRELUDE = [
    'precision mediump sampler3D;',
    'uniform sampler3D u_LPG_VolumeDay;',
    'uniform sampler3D u_LPG_VolumeNight;',
    'uniform vec3  u_LPG_VolumeMin;',
    'uniform vec3  u_LPG_VolumeSize;',
    'uniform float u_LPG_Intensity;',
    'uniform float u_LPG_DayNightBlend;',
    'uniform float u_LPG_NormalBias;',
    'varying vec3 vLPG_WorldPos;',
    '',
    'vec3 evaluateLightProbeGrid(vec3 worldPos, vec3 worldNormal) {',
    '    vec3 samplePos = worldPos + worldNormal * u_LPG_NormalBias;',
    '    vec3 uvw = clamp((samplePos - u_LPG_VolumeMin) / u_LPG_VolumeSize, vec3(0.0), vec3(1.0));',
    '    vec3 day   = texture(u_LPG_VolumeDay,   uvw).rgb;',
    '    vec3 night = texture(u_LPG_VolumeNight, uvw).rgb;',
    '    return mix(day, night, u_LPG_DayNightBlend) * u_LPG_Intensity;',
    '}',
    ''
  ].join('\n');

  var GLSL_VERTEX_HOOK = [
    '#include <worldpos_vertex>',
    '#ifdef USE_INSTANCING',
    '    vLPG_WorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
    '#else',
    '    vLPG_WorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    '#endif'
  ].join('\n');

  var GLSL_FRAGMENT_HOOK = [
    '#include <lights_fragment_begin>',
    'irradiance += evaluateLightProbeGrid(',
    '    vLPG_WorldPos,',
    '    inverseTransformDirection(normal, viewMatrix)',
    ');'
  ].join('\n');

  function injectShaderOnMaterial(clonedMaterial, receiverRecord) {
    // C11: Single program cache key
    clonedMaterial.customProgramCacheKey = function () {
      return 'LPG3D|1';
    };

    clonedMaterial.onBeforeCompile = function (shader) {
      if (shader.vertexShader.indexOf('#include <worldpos_vertex>') === -1 ||
          shader.fragmentShader.indexOf('#include <lights_fragment_begin>') === -1) {
        warnOnce('noAnchor', 'Material "' + (clonedMaterial.name || 'unnamed') +
          '" is missing standard lighting chunks. Probe injection skipped.');
        return;
      }

      // Initialize uniforms
      shader.uniforms.u_LPG_VolumeDay = { value: null };
      shader.uniforms.u_LPG_VolumeNight = { value: null };
      shader.uniforms.u_LPG_VolumeMin = { value: new THREE.Vector3() };
      shader.uniforms.u_LPG_VolumeSize = { value: new THREE.Vector3(1, 1, 1) };
      shader.uniforms.u_LPG_Intensity = { value: 1.0 };
      shader.uniforms.u_LPG_DayNightBlend = { value: 0.0 };
      shader.uniforms.u_LPG_NormalBias = { value: receiverRecord.normalBias };

      receiverRecord.uniformHolders.push(shader.uniforms);

      // Injections
      shader.fragmentShader = GLSL_PRELUDE + '\n' + shader.fragmentShader;
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', GLSL_VERTEX_HOOK);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', GLSL_FRAGMENT_HOOK);
    };

    clonedMaterial.needsUpdate = true;
  }

  /* ---------------------------------------------------- Volume Management (C12) */

  function registerVolume(runtimeScene, object, behavior, options) {
    if (!THREE_OK) return null;
    if (!isWebGL2Available(runtimeScene)) {
      warnOnce('noWebGL2', 'WebGL2 is not supported on this context. Light probe grid is disabled (C4).');
      return null;
    }

    var state = stateOf(runtimeScene);
    var vol = behavior.__lpgVolume;
    if (!vol) {
      vol = behavior.__lpgVolume = {
        object: object,
        behavior: behavior,
        resX: Math.max(2, Math.min(64, Math.floor(options.resX || 16))),
        resY: Math.max(2, Math.min(64, Math.floor(options.resY || 16))),
        resZ: Math.max(2, Math.min(64, Math.floor(options.resZ || 4))),
        skyColor: parseColor(options.skyColor, [160, 200, 255]),
        groundColor: parseColor(options.groundColor, [80, 120, 50]),
        horizonColor: parseColor(options.horizonColor, [200, 220, 240]),
        volumeIntensity: options.volumeIntensity !== undefined ? options.volumeIntensity : 1.0,
        dayNightMode: !!options.dayNightMode,
        showDebugSpheres: !!options.showDebugSpheres,
        autoBakeOnStart: !!options.autoBakeOnStart,
        bakedOnce: false,

        // Bounds in GDevelop space
        minX: 0, minY: 0, minZ: 0,
        maxX: 1000, maxY: 1000, maxZ: 500,

        // Mirrored Three space bounds (C2)
        threeMin: new THREE.Vector3(),
        threeSize: new THREE.Vector3(),

        // Textures
        textureDay: null,
        textureNight: null,
        dataDay: null,
        dataNight: null,

        // Debug visualizer
        debugMesh: null
      };
      state.volume = vol;
    }

    updateVolumeProperties(vol, options);
    syncVolumeBoundsFromObject(vol, object);
    ensureVolumeTextures(vol);
    hideVolumeCube(object);

    if (vol.autoBakeOnStart && !vol.bakedOnce && !state.bakeState && !state.isBakeComplete) {
      vol.bakedOnce = true;
      startBake(runtimeScene);
    }

    return vol;
  }

  function updateVolumeProperties(vol, options) {
    if (!vol || !options) return;
    if (options.resX !== undefined) vol.resX = Math.max(2, Math.min(64, Math.floor(options.resX)));
    if (options.resY !== undefined) vol.resY = Math.max(2, Math.min(64, Math.floor(options.resY)));
    if (options.resZ !== undefined) vol.resZ = Math.max(2, Math.min(64, Math.floor(options.resZ)));
    if (options.skyColor !== undefined) vol.skyColor = parseColor(options.skyColor, vol.skyColor);
    if (options.groundColor !== undefined) vol.groundColor = parseColor(options.groundColor, vol.groundColor);
    if (options.horizonColor !== undefined) vol.horizonColor = parseColor(options.horizonColor, vol.horizonColor);
    if (options.volumeIntensity !== undefined) vol.volumeIntensity = options.volumeIntensity;
    if (options.dayNightMode !== undefined) vol.dayNightMode = !!options.dayNightMode;
    if (options.showDebugSpheres !== undefined) vol.showDebugSpheres = !!options.showDebugSpheres;
    if (options.autoBakeOnStart !== undefined) vol.autoBakeOnStart = !!options.autoBakeOnStart;
  }

  function syncVolumeBoundsFromObject(vol, object) {
    if (!vol || !object) return;
    var x = object.getX ? object.getX() : 0;
    var y = object.getY ? object.getY() : 0;
    var z = object.getZ ? object.getZ() : 0;
    var w = object.getWidth ? object.getWidth() : 1000;
    var h = object.getHeight ? object.getHeight() : 1000;
    var d = object.getDepth ? object.getDepth() : 500;

    vol.minX = x;
    vol.minY = y;
    vol.minZ = z;
    vol.maxX = x + Math.max(1, w);
    vol.maxY = y + Math.max(1, h);
    vol.maxZ = z + Math.max(1, d);

    // C2: Y-Mirrored three-space bounds: [minX, -maxY, minZ]
    vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
    vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
  }

  function hideVolumeCube(object) {
    // Hide or make transparent so the authoring cube doesn't occlude the game
    if (object.setOpacity) object.setOpacity(0);
    if (object.hide) object.hide(true);
    var renderer = object.getRenderer && object.getRenderer();
    var threeObj = renderer && (renderer.get3DRendererObject ? renderer.get3DRendererObject() : renderer._threeObject);
    if (threeObj) threeObj.visible = false;
  }

  function ensureVolumeTextures(vol) {
    if (!vol) return;
    var totalProbes = vol.resX * vol.resY * vol.resZ;
    var neededBytes = totalProbes * 4 * 2; // Uint16Array

    if (!vol.dataDay || vol.dataDay.length !== totalProbes * 4) {
      vol.dataDay = generateAltitudeGradientBuffer(
        vol.resX, vol.resY, vol.resZ,
        vol.skyColor, vol.groundColor, vol.horizonColor
      );
      if (vol.textureDay) vol.textureDay.dispose();
      vol.textureDay = makeData3DTexture(vol.dataDay, vol.resX, vol.resY, vol.resZ);
    }

    if (vol.dayNightMode) {
      if (!vol.dataNight || vol.dataNight.length !== totalProbes * 4) {
        // Fallback night gradient: darker, cooler
        var nightSky = [vol.skyColor[0] * 0.15, vol.skyColor[1] * 0.15, vol.skyColor[2] * 0.35];
        var nightGround = [vol.groundColor[0] * 0.1, vol.groundColor[1] * 0.1, vol.groundColor[2] * 0.15];
        var nightHorizon = [vol.horizonColor[0] * 0.15, vol.horizonColor[1] * 0.15, vol.horizonColor[2] * 0.25];
        vol.dataNight = generateAltitudeGradientBuffer(
          vol.resX, vol.resY, vol.resZ,
          nightSky, nightGround, nightHorizon
        );
        if (vol.textureNight) vol.textureNight.dispose();
        vol.textureNight = makeData3DTexture(vol.dataNight, vol.resX, vol.resY, vol.resZ);
      }
    } else {
      if (vol.textureNight) {
        vol.textureNight.dispose();
        vol.textureNight = null;
        vol.dataNight = null;
      }
    }
  }

  function disposeVolume(runtimeScene, behavior) {
    var vol = behavior && behavior.__lpgVolume;
    if (!vol) return;
    var state = scenes.get(runtimeScene);
    if (state && state.volume === vol) {
      state.volume = null;
    }
    if (vol.textureDay) { vol.textureDay.dispose(); vol.textureDay = null; }
    if (vol.textureNight) { vol.textureNight.dispose(); vol.textureNight = null; }
    if (vol.debugMesh && vol.debugMesh.parent) {
      vol.debugMesh.parent.remove(vol.debugMesh);
      if (vol.debugMesh.geometry) vol.debugMesh.geometry.dispose();
      if (vol.debugMesh.material) vol.debugMesh.material.dispose();
      vol.debugMesh = null;
    }
    behavior.__lpgVolume = null;
  }

  /* ---------------------------------------------------- Receiver Management (C3, C10, C18) */

  function collectMeshesAndCloneMaterials(rootObject, receiverRecord) {
    var clones = [];
    if (!rootObject || !rootObject.traverse) return clones;

    rootObject.traverse(function (node) {
      if (!node.isMesh || !node.material) return;

      var orig = node.material;
      if (Array.isArray(orig)) {
        var cloneArr = [];
        for (var i = 0; i < orig.length; i++) {
          var m = orig[i];
          if (m.isMeshBasicMaterial) {
            warnOnce('basicMat:' + (m.name || 'unnamed'),
              'Object uses MeshBasicMaterial, which has no lighting. Light probe injection bypassed (C10).');
            cloneArr.push(m);
            continue;
          }
          var c = m.clone();
          injectShaderOnMaterial(c, receiverRecord);
          cloneArr.push(c);
          clones.push({ mesh: node, index: i, original: m, clone: c });
        }
        node.material = cloneArr;
      } else {
        if (orig.isMeshBasicMaterial) {
          warnOnce('basicMat:' + (orig.name || 'unnamed'),
            'Object uses MeshBasicMaterial, which has no lighting. Light probe injection bypassed (C10).');
          return;
        }
        var singleClone = orig.clone();
        injectShaderOnMaterial(singleClone, receiverRecord);
        node.material = singleClone;
        clones.push({ mesh: node, index: -1, original: orig, clone: singleClone });
      }
    });

    return clones;
  }

  function registerReceiver(runtimeScene, object, behavior, options) {
    if (!THREE_OK) return null;
    if (!isWebGL2Available(runtimeScene)) return null;

    var state = stateOf(runtimeScene);
    var rec = behavior.__lpgReceiver;
    if (!rec) {
      rec = behavior.__lpgReceiver = {
        object: object,
        behavior: behavior,
        intensityMultiplier: options.intensityMultiplier !== undefined ? options.intensityMultiplier : 1.0,
        normalBias: options.normalBias !== undefined ? options.normalBias : 15.0, // C14: world units
        updateFrequency: options.updateFrequency || 'Continuous',
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        materialClones: [],
        uniformHolders: [],
        stepCounter: 0,
        effectiveIntensity: 1.0
      };
      state.receivers.add(rec);

      // Clone materials on object's 3D tree (C3)
      var renderer = object.getRenderer && object.getRenderer();
      var threeRoot = renderer && (renderer.get3DRendererObject ? renderer.get3DRendererObject() : renderer._threeObject);
      if (threeRoot) {
        rec.materialClones = collectMeshesAndCloneMaterials(threeRoot, rec);
      }
    }

    updateReceiverProperties(rec, options);
    return rec;
  }

  function updateReceiverProperties(rec, options) {
    if (!rec || !options) return;
    if (options.intensityMultiplier !== undefined) rec.intensityMultiplier = options.intensityMultiplier;
    if (options.normalBias !== undefined) rec.normalBias = options.normalBias;
    if (options.updateFrequency !== undefined) rec.updateFrequency = options.updateFrequency;
    if (options.enabled !== undefined) rec.enabled = !!options.enabled;
  }

  function syncReceiverUniforms(runtimeScene, rec) {
    if (!rec || !rec.enabled) {
      for (var j = 0; j < rec.uniformHolders.length; j++) {
        var uZero = rec.uniformHolders[j];
        if (uZero && uZero.u_LPG_Intensity) uZero.u_LPG_Intensity.value = 0.0;
      }
      return;
    }

    var state = stateOf(runtimeScene);
    var vol = state.volume;
    var legacyScale = getLegacyScale(runtimeScene); // C9: Math.PI if useLegacyLights

    var volInt = vol ? vol.volumeIntensity : 1.0;
    rec.effectiveIntensity = volInt * rec.intensityMultiplier * state.globalIntensity * legacyScale;

    var dayTex = (vol && vol.textureDay) ? vol.textureDay : getDummyTexture(state);
    var nightTex = (vol && vol.dayNightMode && vol.textureNight) ? vol.textureNight : dayTex;
    var vMin = vol ? vol.threeMin : THREE.Vector3 ? new THREE.Vector3() : null;
    var vSize = vol ? vol.threeSize : THREE.Vector3 ? new THREE.Vector3(1, 1, 1) : null;

    for (var i = 0; i < rec.uniformHolders.length; i++) {
      var u = rec.uniformHolders[i];
      if (!u) continue;
      if (u.u_LPG_VolumeDay) u.u_LPG_VolumeDay.value = dayTex;
      if (u.u_LPG_VolumeNight) u.u_LPG_VolumeNight.value = nightTex;
      if (u.u_LPG_VolumeMin && vMin) u.u_LPG_VolumeMin.value.copy(vMin);
      if (u.u_LPG_VolumeSize && vSize) u.u_LPG_VolumeSize.value.copy(vSize);
      if (u.u_LPG_Intensity) u.u_LPG_Intensity.value = rec.effectiveIntensity;
      if (u.u_LPG_DayNightBlend) u.u_LPG_DayNightBlend.value = state.dayNightBlend;
      if (u.u_LPG_NormalBias) u.u_LPG_NormalBias.value = rec.normalBias;
    }
  }

  function stepReceiver(runtimeScene, object, behavior) {
    var rec = behavior && behavior.__lpgReceiver;
    if (!rec) return;

    rec.stepCounter++;
    if (rec.updateFrequency === 'Throttled' && rec.stepCounter % 5 !== 0) {
      return;
    }

    // Re-check mesh attachments in case model reloaded
    if (rec.materialClones.length === 0) {
      var renderer = object.getRenderer && object.getRenderer();
      var threeRoot = renderer && (renderer.get3DRendererObject ? renderer.get3DRendererObject() : renderer._threeObject);
      if (threeRoot) {
        rec.materialClones = collectMeshesAndCloneMaterials(threeRoot, rec);
      }
    }

    syncReceiverUniforms(runtimeScene, rec);
  }

  function disposeReceiver(runtimeScene, behavior) {
    var rec = behavior && behavior.__lpgReceiver;
    if (!rec) return;

    var state = scenes.get(runtimeScene);
    if (state) state.receivers.delete(rec);

    // Restore original materials and dispose clones (C3, C18)
    for (var i = 0; i < rec.materialClones.length; i++) {
      var item = rec.materialClones[i];
      try {
        if (item.index >= 0 && Array.isArray(item.mesh.material)) {
          if (item.mesh.material[item.index] === item.clone) {
            item.mesh.material[item.index] = item.original;
          }
        } else if (item.mesh.material === item.clone) {
          item.mesh.material = item.original;
        }
      } catch (e) {}
      try {
        if (item.clone) item.clone.dispose();
      } catch (e2) {}
    }
    rec.materialClones = [];
    rec.uniformHolders = [];
    behavior.__lpgReceiver = null;
  }

  /* ---------------------------------------------------- Raycast Occlusion Baker (C13, C16) */

  function collectBakeGeometry(runtimeScene, layerName) {
    var layer = runtimeScene.getLayer(layerName || '');
    var lr = layer && layer.getRenderer && layer.getRenderer();
    var scene = lr && lr.getThreeScene ? lr.getThreeScene() : null;
    var meshes = [];
    if (!scene) return meshes;

    scene.traverse(function (node) {
      // Exclude invisible, debug meshes, helper lines
      if (node.isMesh && node.visible && node.geometry) {
        if (node.name && node.name.indexOf('LPG_DEBUG') !== -1) return;
        meshes.push(node);
      }
    });
    return meshes;
  }

  function startBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    var vol = state.volume;
    if (!vol) {
      warnOnce('bakeNoVol', 'Cannot bake: No active LightProbeVolume3D in scene.');
      return false;
    }
    if (state.bakeState && state.bakeState.inProgress) {
      return false; // Already baking
    }

    var totalProbes = vol.resX * vol.resY * vol.resZ;
    var meshes = collectBakeGeometry(runtimeScene, vol.object ? vol.object.getLayer() : '');

    state.bakeState = {
      inProgress: true,
      currentProbe: 0,
      totalProbes: totalProbes,
      buffer: new Uint16Array(totalProbes * 4),
      meshes: meshes,
      raycaster: new THREE.Raycaster(),
      originVec: new THREE.Vector3(),
      dirVec: new THREE.Vector3()
    };
    state.bakeState.raycaster.far = Math.max(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
    state.isBakeComplete = false;
    return true;
  }

  function cancelBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (state.bakeState) {
      state.bakeState.inProgress = false;
      state.bakeState = null;
    }
  }

  function stepBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    var bs = state.bakeState;
    if (!bs || !bs.inProgress) return;

    var vol = state.volume;
    if (!vol) {
      bs.inProgress = false;
      return;
    }

    var start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var budget = state.bakeBudgetMs || 8.0;

    var resX = vol.resX;
    var resY = vol.resY;
    var resZ = vol.resZ;
    var minX = vol.minX;
    var maxX = vol.maxX;
    var minY = vol.minY;
    var maxY = vol.maxY;
    var minZ = vol.minZ;
    var maxZ = vol.maxZ;

    var sky = [vol.skyColor[0] / 255.0, vol.skyColor[1] / 255.0, vol.skyColor[2] / 255.0];
    var ground = [vol.groundColor[0] / 255.0, vol.groundColor[1] / 255.0, vol.groundColor[2] / 255.0];
    var horizon = [vol.horizonColor[0] / 255.0, vol.horizonColor[1] / 255.0, vol.horizonColor[2] / 255.0];

    while (bs.currentProbe < bs.totalProbes) {
      var pIdx = bs.currentProbe;
      var zIdx = Math.floor(pIdx / (resX * resY));
      var rem = pIdx % (resX * resY);
      var yIdx = Math.floor(rem / resX);
      var xIdx = rem % resX;

      var tx = resX > 1 ? xIdx / (resX - 1) : 0.5;
      var ty = resY > 1 ? yIdx / (resY - 1) : 0.5;
      var tz = resZ > 1 ? zIdx / (resZ - 1) : 0.5;

      var px = lerp(minX, maxX, tx);
      var py = lerp(minY, maxY, ty);
      var pz = lerp(minZ, maxZ, tz);

      // C2: Mirrored space position: (px, -py, pz)
      bs.originVec.set(px, -py, pz);

      var accR = 0;
      var accG = 0;
      var accB = 0;

      for (var r = 0; r < NUM_RAYS; r++) {
        var sRay = SPHERE_RAYS[r];
        // Mirror Y direction to match three mirrored space
        bs.dirVec.set(sRay.x, -sRay.y, sRay.z).normalize();
        bs.raycaster.set(bs.originVec, bs.dirVec);

        var hits = bs.meshes.length > 0 ? bs.raycaster.intersectObjects(bs.meshes, false) : [];
        if (hits.length === 0) {
          // Unoccluded sky/horizon/ground sample based on ray's world Z
          var rayZ = sRay.z; // -1 to 1
          var tRay = (rayZ + 1.0) * 0.5; // 0 (ground) to 1 (sky)
          var c;
          if (tRay < 0.5) c = lerpColor(ground, horizon, tRay * 2.0);
          else c = lerpColor(horizon, sky, (tRay - 0.5) * 2.0);
          accR += c[0];
          accG += c[1];
          accB += c[2];
        } else {
          // Occluded: pick up subtle bounce from hit material or darker ambient
          var hit = hits[0];
          var hitMat = hit.object && hit.object.material;
          var bounceR = 0.05, bounceG = 0.05, bounceB = 0.05;
          if (hitMat && hitMat.color) {
            bounceR = hitMat.color.r * 0.2;
            bounceG = hitMat.color.g * 0.2;
            bounceB = hitMat.color.b * 0.2;
          }
          accR += bounceR;
          accG += bounceG;
          accB += bounceB;
        }
      }

      var inv = 1.0 / NUM_RAYS;
      var bufIdx = pIdx * 4;
      bs.buffer[bufIdx] = toHalf(accR * inv);
      bs.buffer[bufIdx + 1] = toHalf(accG * inv);
      bs.buffer[bufIdx + 2] = toHalf(accB * inv);
      bs.buffer[bufIdx + 3] = toHalf(1.0);

      bs.currentProbe++;

      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - start >= budget) break;
    }

    if (bs.currentProbe >= bs.totalProbes) {
      // Bake complete!
      vol.dataDay = bs.buffer;
      if (vol.textureDay) vol.textureDay.dispose();
      vol.textureDay = makeData3DTexture(vol.dataDay, resX, resY, resZ);

      // Re-sync debug visualizer if active
      if (vol.debugMesh) updateDebugVisualizerMesh(runtimeScene, vol);

      bs.inProgress = false;
      state.bakeState = null;
      state.isBakeComplete = true;
    }
  }

  /* ---------------------------------------------------- Debug Visualizer (Phase 6, C19) */

  function updateDebugVisualizerMesh(runtimeScene, vol) {
    if (!THREE_OK || !vol) return;
    var layer = runtimeScene.getLayer(vol.object ? vol.object.getLayer() : '');
    var lr = layer && layer.getRenderer && layer.getRenderer();
    var scene = lr && lr.getThreeScene ? lr.getThreeScene() : null;
    if (!scene) return;

    var totalProbes = vol.resX * vol.resY * vol.resZ;
    if (!vol.showDebugSpheres) {
      if (vol.debugMesh && vol.debugMesh.parent) {
        vol.debugMesh.parent.remove(vol.debugMesh);
      }
      return;
    }

    // Radius derived from probe spacing
    var spacingX = (vol.maxX - vol.minX) / Math.max(1, vol.resX - 1);
    var spacingY = (vol.maxY - vol.minY) / Math.max(1, vol.resY - 1);
    var spacingZ = (vol.maxZ - vol.minZ) / Math.max(1, vol.resZ - 1);
    var sphereRadius = Math.min(spacingX, spacingY, spacingZ) * 0.15;

    if (!vol.debugMesh || vol.debugMesh.count !== totalProbes) {
      if (vol.debugMesh && vol.debugMesh.parent) vol.debugMesh.parent.remove(vol.debugMesh);
      var geom = new THREE.SphereGeometry(Math.max(1.0, sphereRadius), 8, 8);
      var mat = new THREE.MeshBasicMaterial({ toneMapped: false });
      vol.debugMesh = new THREE.InstancedMesh(geom, mat, totalProbes);
      vol.debugMesh.name = 'LPG_DEBUG_SPHERES';
      scene.add(vol.debugMesh);
    }

    var dummyMatrix = new THREE.Matrix4();
    var dummyColor = new THREE.Color();

    for (var z = 0; z < vol.resZ; z++) {
      var tz = vol.resZ > 1 ? z / (vol.resZ - 1) : 0.5;
      var pz = lerp(vol.minZ, vol.maxZ, tz);

      for (var y = 0; y < vol.resY; y++) {
        var ty = vol.resY > 1 ? y / (vol.resY - 1) : 0.5;
        var py = lerp(vol.minY, vol.maxY, ty);

        for (var x = 0; x < vol.resX; x++) {
          var tx = vol.resX > 1 ? x / (vol.resX - 1) : 0.5;
          var px = lerp(vol.minX, vol.maxX, tx);

          var i = (z * vol.resY + y) * vol.resX + x;

          // C2: mirrored world position (px, -py, pz)
          dummyMatrix.makeTranslation(px, -py, pz);
          vol.debugMesh.setMatrixAt(i, dummyMatrix);

          var bufIdx = i * 4;
          var r = fromHalf(vol.dataDay[bufIdx]);
          var g = fromHalf(vol.dataDay[bufIdx + 1]);
          var b = fromHalf(vol.dataDay[bufIdx + 2]);
          dummyColor.setRGB(r, g, b);
          vol.debugMesh.setColorAt(i, dummyColor);
        }
      }
    }

    vol.debugMesh.instanceMatrix.needsUpdate = true;
    if (vol.debugMesh.instanceColor) vol.debugMesh.instanceColor.needsUpdate = true;
  }

  /* ---------------------------------------------------- Serialization (.lpg.bin) (Phase 7, C15) */

  function exportBinary(vol) {
    if (!vol || !vol.dataDay) return null;
    var totalProbes = vol.resX * vol.resY * vol.resZ;
    var hasNight = !!(vol.dayNightMode && vol.dataNight);

    var headerSize = 32;
    var boundsSize = 24;
    var payloadSizeDay = totalProbes * 4 * 2; // 2 bytes per half float
    var payloadSizeNight = hasNight ? payloadSizeDay : 0;
    var totalSize = headerSize + boundsSize + payloadSizeDay + payloadSizeNight;

    var buffer = new ArrayBuffer(totalSize);
    var view = new DataView(buffer);

    // 0..3: Magic 'LPG3'
    view.setUint8(0, 0x4c); // 'L'
    view.setUint8(1, 0x50); // 'P'
    view.setUint8(2, 0x47); // 'G'
    view.setUint8(3, 0x33); // '3'

    // 4..7: version = 1
    view.setUint32(4, 1, true);

    // 8..19: resX, resY, resZ
    view.setUint32(8, vol.resX, true);
    view.setUint32(12, vol.resY, true);
    view.setUint32(16, vol.resZ, true);

    // 20: encoding: 0 = RGBA16F
    view.setUint8(20, 0);

    // 21: flags: bit 0 = night volume present
    view.setUint8(21, hasNight ? 1 : 0);

    // 22..31: reserved zeros
    for (var r = 22; r < 32; r++) view.setUint8(r, 0);

    // 32..55: Bounds float32 (unmirrored GDevelop coords)
    view.setFloat32(32, vol.minX, true);
    view.setFloat32(36, vol.minY, true);
    view.setFloat32(40, vol.minZ, true);
    view.setFloat32(44, vol.maxX, true);
    view.setFloat32(48, vol.maxY, true);
    view.setFloat32(52, vol.maxZ, true);

    // Payload day
    var u16Out = new Uint16Array(buffer, 56, totalProbes * 4);
    u16Out.set(vol.dataDay);

    // Payload night if present
    if (hasNight) {
      var u16NightOut = new Uint16Array(buffer, 56 + payloadSizeDay, totalProbes * 4);
      u16NightOut.set(vol.dataNight);
    }

    return buffer;
  }

  function loadBinary(runtimeScene, arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 56) return false;
    var view = new DataView(arrayBuffer);

    // Check magic
    if (view.getUint8(0) !== 0x4c || view.getUint8(1) !== 0x50 ||
        view.getUint8(2) !== 0x47 || view.getUint8(3) !== 0x33) {
      warnOnce('badMagic', 'Failed to load probe data: Invalid LPG3 header.');
      return false;
    }

    var version = view.getUint32(4, true);
    var rx = view.getUint32(8, true);
    var ry = view.getUint32(12, true);
    var rz = view.getUint32(16, true);
    var encoding = view.getUint8(20);
    var flags = view.getUint8(21);
    var hasNight = (flags & 1) !== 0;

    var minX = view.getFloat32(32, true);
    var minY = view.getFloat32(36, true);
    var minZ = view.getFloat32(40, true);
    var maxX = view.getFloat32(44, true);
    var maxY = view.getFloat32(48, true);
    var maxZ = view.getFloat32(52, true);

    var totalProbes = rx * ry * rz;
    var state = stateOf(runtimeScene);
    var vol = state.volume;

    if (!vol) {
      warnOnce('loadNoVol', 'No active LightProbeVolume3D to apply loaded probe data.');
      return false;
    }

    vol.resX = rx;
    vol.resY = ry;
    vol.resZ = rz;
    vol.minX = minX;
    vol.minY = minY;
    vol.minZ = minZ;
    vol.maxX = maxX;
    vol.maxY = maxY;
    vol.maxZ = maxZ;

    vol.threeMin.set(minX, -maxY, minZ);
    vol.threeSize.set(maxX - minX, maxY - minY, maxZ - minZ);

    var u16InDay = new Uint16Array(arrayBuffer, 56, totalProbes * 4);
    vol.dataDay = new Uint16Array(u16InDay);
    if (vol.textureDay) vol.textureDay.dispose();
    vol.textureDay = makeData3DTexture(vol.dataDay, rx, ry, rz);

    if (hasNight) {
      vol.dayNightMode = true;
      var offsetNight = 56 + totalProbes * 4 * 2;
      var u16InNight = new Uint16Array(arrayBuffer, offsetNight, totalProbes * 4);
      vol.dataNight = new Uint16Array(u16InNight);
      if (vol.textureNight) vol.textureNight.dispose();
      vol.textureNight = makeData3DTexture(vol.dataNight, rx, ry, rz);
    }

    if (vol.debugMesh) updateDebugVisualizerMesh(runtimeScene, vol);
    return true;
  }

  /* ---------------------------------------------------- Per-frame Tick & Scene Callbacks */

  function tick(runtimeScene) {
    if (!THREE_OK) return;
    var state = scenes.get(runtimeScene);
    if (!state) return;

    // Step amortized bake if running
    if (state.bakeState && state.bakeState.inProgress) {
      stepBake(runtimeScene);
    }

    // Keep debug visualizer in sync if enabled
    if (state.volume && state.volume.showDebugSpheres) {
      updateDebugVisualizerMesh(runtimeScene, state.volume);
    }
  }

  function cleanupScene(runtimeScene) {
    var state = scenes.get(runtimeScene);
    if (!state) return;

    if (state.volume) {
      disposeVolume(runtimeScene, state.volume.behavior);
    }
    state.receivers.forEach(function (rec) {
      disposeReceiver(runtimeScene, rec.behavior);
    });
    if (state.dummyTexture) {
      state.dummyTexture.dispose();
      state.dummyTexture = null;
    }
    scenes.delete(runtimeScene);
  }

  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(tick);
  }
  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(cleanupScene);
  }

  /* ----------------------------------------------------------- Public API Namespace */

  var NS = {
    // Math & Types
    toHalf: toHalf,
    fromHalf: fromHalf,
    isSupported: function (runtimeScene) {
      return isWebGL2Available(runtimeScene);
    },

    // Volume Management
    registerVolume: registerVolume,
    updateVolume: function (runtimeScene, object, behavior, options) {
      var vol = behavior && behavior.__lpgVolume;
      if (!vol) return registerVolume(runtimeScene, object, behavior, options);
      updateVolumeProperties(vol, options);
      syncVolumeBoundsFromObject(vol, object);
      ensureVolumeTextures(vol);
      return vol;
    },
    disposeVolume: disposeVolume,
    volumeOf: function (behavior) {
      return behavior ? behavior.__lpgVolume : null;
    },

    // Receiver Management
    registerReceiver: registerReceiver,
    stepReceiver: stepReceiver,
    disposeReceiver: disposeReceiver,
    receiverOf: function (behavior) {
      return behavior ? behavior.__lpgReceiver : null;
    },

    // Global Actions
    setBounds: function (runtimeScene, minX, minY, minZ, maxX, maxY, maxZ) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol) return;
      vol.minX = minX;
      vol.minY = minY;
      vol.minZ = minZ;
      vol.maxX = Math.max(minX + 1, maxX);
      vol.maxY = Math.max(minY + 1, maxY);
      vol.maxZ = Math.max(minZ + 1, maxZ);
      vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
      vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
    },

    setDayNightBlend: function (runtimeScene, factor) {
      var state = stateOf(runtimeScene);
      state.dayNightBlend = Math.max(0.0, Math.min(1.0, factor));
    },

    getDayNightBlend: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return state.dayNightBlend;
    },

    setGlobalIntensity: function (runtimeScene, intensity) {
      var state = stateOf(runtimeScene);
      state.globalIntensity = Math.max(0.0, intensity);
    },

    // Baking Controls
    startBake: startBake,
    cancelBake: cancelBake,
    setBakeBudgetMs: function (runtimeScene, ms) {
      var state = stateOf(runtimeScene);
      state.bakeBudgetMs = Math.max(1.0, ms);
    },
    isBakeInProgress: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.bakeState && state.bakeState.inProgress);
    },
    isBakeComplete: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!state.isBakeComplete;
    },
    getBakeProgress: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      if (!state.bakeState || !state.bakeState.inProgress) {
        return state.isBakeComplete ? 1.0 : 0.0;
      }
      return state.bakeState.totalProbes > 0
        ? state.bakeState.currentProbe / state.bakeState.totalProbes
        : 0.0;
    },

    // Expressions & Metrics
    getActiveProbeCount: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      return vol ? (vol.resX * vol.resY * vol.resZ) : 0;
    },

    getProbeSpacingX: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol || vol.resX <= 1) return 0;
      return (vol.maxX - vol.minX) / (vol.resX - 1);
    },

    getProbeSpacingY: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol || vol.resY <= 1) return 0;
      return (vol.maxY - vol.minY) / (vol.resY - 1);
    },

    getProbeSpacingZ: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol || vol.resZ <= 1) return 0;
      return (vol.maxZ - vol.minZ) / (vol.resZ - 1);
    },

    getVRAMBytes: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol) return 0;
      var probes = vol.resX * vol.resY * vol.resZ;
      var dayBytes = probes * 4 * 2; // RGBA16F = 8 bytes per probe
      var nightBytes = (vol.dayNightMode && vol.textureNight) ? dayBytes : 0;
      return dayBytes + nightBytes;
    },

    toggleDebugVisualizer: function (runtimeScene, enable) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (vol) {
        vol.showDebugSpheres = !!enable;
        updateDebugVisualizerMesh(runtimeScene, vol);
      }
    },

    isProbeVolumeLoaded: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.volume && state.volume.textureDay);
    },

    isDayNightModeEnabled: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.volume && state.volume.dayNightMode);
    },

    // File IO
    exportProbeData: function (runtimeScene, fileName) {
      var state = stateOf(runtimeScene);
      var vol = state.volume;
      if (!vol) return false;
      var buffer = exportBinary(vol);
      if (!buffer) return false;

      var name = fileName || 'probes.lpg.bin';
      if (!name.endsWith('.lpg.bin')) name += '.lpg.bin';

      if (typeof document !== 'undefined') {
        var blob = new Blob([buffer], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      }
      return false;
    },

    loadProbeDataFromFile: function (runtimeScene, filePath) {
      if (typeof fetch === 'undefined') return false;
      fetch(filePath)
        .then(function (res) { return res.arrayBuffer(); })
        .then(function (buf) { loadBinary(runtimeScene, buf); })
        .catch(function (err) {
          warnOnce('fetchFail', 'Failed to load probe file "' + filePath + '": ' + err);
        });
      return true;
    }
  };

  gdjs.__lightProbeGrid3D = NS;
})();
