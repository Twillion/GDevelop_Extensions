/**
 * AdvancedLighting3D — Clustered forward dynamic multi-lighting *and* baked indirect
 * light-probe GI for GDevelop 5 (Three.js r160, WebGL2).
 *
 * Direct light: the camera view frustum is partitioned into a 3D grid of 3,456 clusters
 * (16 x 9 x 24 logarithmic depth slices). Up to 512 registered dynamic lights are streamed through
 * WebGL2 data textures with no shader recompilation, giving Karis representative-point area
 * specular, blackbody Kelvin colour, IES photometric profiles, Frostbite windowed
 * attenuation and procedural flicker.
 *
 * Indirect light: a LightProbeVolume3D bakes the scene's ambient into an RGBA16F 3D texture
 * that ReceiveLightProbes objects sample per fragment, so a character picks up the ambient
 * colour of the place it is standing in (dark under a canopy, red in a red-lit corridor).
 *
 * Both features share ONE material injection, ONE program cache key and ONE post-events
 * tick. That is the reason they live in one extension: two independent onBeforeCompile
 * hooks on the same material would collide on the cache key and silently render the wrong
 * program.
 *
 * GDevelop runtime facts this depends on (read from the installed GDJS, Three r160):
 *  - The 3D scene root is mirrored on Y (scale.y = -1); mirrored bounds are [minX, -maxY, minZ].
 *  - Up is +Z. The height axis is Z, so the probe buffer's outer loop is Z.
 *  - Materials are shared game-wide, so probe receivers clone theirs and restore on destroy.
 *  - GDevelop r160 uses legacy Three.js light units, so irradiance uses a fixed PI scale.
 *  - lights_fragment_begin declares geometryPosition (= -vViewPosition), geometryNormal and
 *    geometryViewDir (= normalize(vViewPosition)). Those are the correct view-space values;
 *    vViewPosition itself is the *negated* fragment position.
 *  - The BSDF helpers that exist are F_Schlick(f0, f90, dotVH), D_GGX(alpha, dotNH) and
 *    V_GGX_SmithCorrelated(alpha, dotNL, dotNV). There is no G_Smith.
 */
(function () {
  if (typeof gdjs === 'undefined') return;

  // The scene editor keeps `gdjs` alive when an extension is re-imported. A plain
  // singleton guard pins the previous runtime and its editor callback indefinitely.
  // Skip only another copy of this exact build; replace older builds during hot reload.
  var RUNTIME_VERSION = '2026.09.11.3';
  // GDevelop r160 configures its Three.js renderer to use legacy light units. Reading
  // Three.js's deprecated legacy-lights renderer flag emits a throttled warning, so
  // preserve GDevelop's established brightness without touching that property.
  var GDEVELOP_LIGHT_INTENSITY_SCALE = Math.PI;
  var previousRuntime = gdjs.__advancedLighting3D;
  if (previousRuntime && previousRuntime.__runtimeVersion === RUNTIME_VERSION) return;
  if (previousRuntime && typeof previousRuntime.__unregisterRuntimeCallbacks === 'function') {
    previousRuntime.__unregisterRuntimeCallbacks();
  } else if (previousRuntime && typeof gdjs._unregisterCallback === 'function') {
    // Builds created before runtime versioning still exposed these two callbacks.
    // Remove them before replacing the namespace or they keep stepping stale textures.
    if (typeof previousRuntime.doStepPostEvents === 'function') {
      gdjs._unregisterCallback(previousRuntime.doStepPostEvents);
    }
    if (typeof previousRuntime.doStepInGameEditor === 'function') {
      gdjs._unregisterCallback(previousRuntime.doStepInGameEditor);
    }
  }

  var THREE_OK = typeof THREE !== 'undefined';

  // Shadow maps are owned by this scene, but rendered by Three's native shadow pass.
  // Cascade lights have zero intensity: the existing Sun is the sole radiance source.
  function shadowState(state) {
    if (!state.shadows) state.shadows = {
      mode: 'Hybrid', count: 3, distance: 25000, lambda: 0.75, mapSize: 2048,
      bias: 0.0005, normalBias: 0.02, blend: 0.10, softness: 1.5,
      lights: [], sun: null, savedSunShadow: null,
      renderer: null, rendererState: null, ready: false, manager: null, managers: [],
      splits: new Float32Array(4), ranges: [], matrices: [], maps: [], direction: null
    };
    return state.shadows;
  }

  function sdfEnabled(state) {
    var mode = shadowState(state).mode;
    return mode === 'SDF' || mode === 'Hybrid';
  }

  function disposeCSM(state) {
    var c = shadowState(state);
    c.lights.forEach(function (light) {
      if (light.shadow.map) light.shadow.map.dispose();
      if (light.shadow.mapPass) light.shadow.mapPass.dispose();
      if (light.parent) light.parent.remove(light);
      if (light.target.parent) light.target.parent.remove(light.target);
    });
    c.lights.length = 0; c.maps.length = 0; c.matrices.length = 0; c.ready = false;
    if (c.sun) c.sun.castShadow = c.savedSunShadow;
    c.sun = null;
    if (c.savedTarget) { c.savedTarget.target.position.copy(c.savedTarget.position); c.savedTarget.target.updateMatrixWorld(true); c.savedTarget = null; }
    if (c.renderer && c.rendererState) {
      c.renderer.shadowMap.enabled = c.rendererState.enabled;
      c.renderer.shadowMap.type = c.rendererState.type;
      c.renderer.shadowMap.autoUpdate = c.rendererState.autoUpdate;
    }
    c.renderer = null; c.rendererState = null;
  }

  function setShadowMode(scene, mode) {
    var state = stateOf(scene), c = shadowState(state);
    var names = { off: 'Off', csm: 'CSM', sdf: 'SDF', hybrid: 'Hybrid' };
    var canonical = names[String(mode).toLowerCase()];
    if (!canonical) return false;
    if (canonical !== c.mode) { disposeCSM(state); c.mode = canonical; }
    return true;
  }

  function configureCSM(scene, options) {
    var state = stateOf(scene), c = shadowState(state);
    var limits = {count:[2,4],distance:[1,10000000],lambda:[0,1],bias:[-0.1,0.1],normalBias:[0,1000],blend:[0,0.25],softness:[0,10]};
    Object.keys(limits).forEach(function (key) {
      if (options[key] === undefined || !Number.isFinite(Number(options[key]))) return;
      var val = clamp(Number(options[key]), limits[key][0], limits[key][1]);
      if (key === 'count') val = Math.floor(val);
      if (key === 'count' && c.count !== val) disposeCSM(state);
      c[key] = val;
    });
    if ([1024,2048,4096].indexOf(Number(options.mapSize)) >= 0 && c.mapSize !== Number(options.mapSize)) {
      disposeCSM(state); c.mapSize = Number(options.mapSize);
    }
    if (options.mode !== undefined) setShadowMode(scene, options.mode);
  }

  function registerShadowManager(scene, behavior, options) {
    var c = shadowState(stateOf(scene));
    var record = null;
    for (var i = 0; i < c.managers.length; i++) {
      if (c.managers[i].behavior === behavior) { record = c.managers[i]; break; }
    }
    if (!record) {
      record = { behavior: behavior, options: options || {}, warned: false };
      c.managers.push(record);
    } else {
      record.options = options || {};
    }
    if (!c.manager) {
      c.manager = behavior;
      configureCSM(scene, record.options);
      return true;
    }
    if (c.manager === behavior) {
      configureCSM(scene, record.options);
      return true;
    }
    if (!record.warned) {
      record.warned = true;
      console.warn('[AdvancedLighting3D] A shadow manager is already active; this instance will take over if the active manager is removed.');
    }
    return false;
  }

  function destroyShadowManager(scene, behavior) {
    var state = stateOf(scene), c = shadowState(state);
    var wasOwner = c.manager === behavior;
    c.managers = c.managers.filter(function (record) { return record.behavior !== behavior; });
    if (!wasOwner) return;
    setShadowMode(scene, 'Off');
    c.manager = null;
    if (c.managers.length) {
      c.manager = c.managers[0].behavior;
      configureCSM(scene, c.managers[0].options);
    }
  }

  function practicalSplits(near, far, count, lambda) {
    var result = [];
    for (var i = 1; i <= count; i++) {
      var t = i / count;
      result.push(i === count ? far : lerp(near + (far - near) * t, near * Math.pow(far / near, t), lambda));
    }
    return result;
  }

  function updateCSM(scene, camera) {
    var state = stateOf(scene), c = shadowState(state), root = getThreeScene(scene);
    if (!root || !root.traverse || !THREE.DirectionalLight || !camera.projectionMatrixInverse) return;
    var wantsMaps = c.mode === 'CSM' || c.mode === 'Hybrid';
    var sun = null;
    root.traverse(function (node) {
      if (!sun && node.isDirectionalLight && !node.__alCascade && node.visible && node.intensity > 0) sun = node;
    });
    if (c.sun && c.sun !== sun) disposeCSM(state);
    if (!sun) { if (c.lights.length) disposeCSM(state); return; }
    // Native Sun maps must not multiply an SDF/CSM shadow a second time.
    if (!c.sun) { c.sun = sun; c.savedSunShadow = sun.castShadow; }
    sun.castShadow = false;
    if (!wantsMaps) return;
    var renderer = threeRendererOf(scene);
    if (!renderer || !renderer.shadowMap) return;
    if (!c.renderer) {
      c.renderer = renderer;
      c.rendererState = {enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,autoUpdate:renderer.shadowMap.autoUpdate};
    }
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = true;
    root.updateMatrixWorld(true);
    var sunPosition = new THREE.Vector3(), targetPosition = new THREE.Vector3();
    sun.getWorldPosition(sunPosition); sun.target.getWorldPosition(targetPosition);
    var direction = c.direction ? c.direction.clone() : targetPosition.sub(sunPosition).normalize();
    if (direction.lengthSq() < 1e-10) direction.set(0.3,0.4,-1).normalize();
    c.sunDirection = direction.clone().negate().transformDirection(camera.matrixWorldInverse);
    // Preserve the native Sun's orientation when using an explicit direction override.
    if (c.direction) {
      if (!c.savedTarget) c.savedTarget = {position:sun.target.position.clone(),target:sun.target};
      var targetWorld = sunPosition.clone().add(direction);
      sun.target.position.copy(sun.target.parent ? sun.target.parent.worldToLocal(targetWorld) : targetWorld);
      sun.target.updateMatrixWorld(true);
    }
    if (!c.lights.length) {
      for (var i = 0; i < c.count; i++) {
        var light = new THREE.DirectionalLight(0xffffff,0);
        light.__alCascade = true; light.castShadow = true;
        light.shadow.mapSize.set(c.mapSize,c.mapSize);
        root.add(light); root.add(light.target); c.lights.push(light);
      }
    }
    var near = Math.max(camera.near,0.001), far = Math.max(near + 0.001, Math.min(camera.far,c.distance));
    var splits = practicalSplits(near,far,c.count,c.lambda);
    var up = Math.abs(direction.z) > 0.99 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
    var orientation = new THREE.Matrix4().lookAt(new THREE.Vector3(),direction,up);
    var inverse = orientation.clone().invert();
    c.ranges.length = 0;
    for (var i = 0; i < c.count; i++) {
      c.splits[i] = splits[i];
      var previous = i ? splits[i-1] : near;
      // Overlap the incoming blend region so both maps cover every blended fragment.
      var lower = i ? previous - c.blend * (previous - (i > 1 ? splits[i-2] : near)) : near;
      var corners = [], center = new THREE.Vector3();
      for (var z = 0; z < 2; z++) for (var y = -1; y <= 1; y += 2) for (var x = -1; x <= 1; x += 2) {
        var a = new THREE.Vector3(x,y,-1).applyMatrix4(camera.projectionMatrixInverse);
        var b = new THREE.Vector3(x,y,1).applyMatrix4(camera.projectionMatrixInverse);
        var depth = z ? splits[i] : lower;
        var point = a.lerp(b,(-depth-a.z)/(b.z-a.z)).applyMatrix4(camera.matrixWorld);
        corners.push(point); center.add(point);
      }
      center.multiplyScalar(1/8);
      var radius = 0;
      corners.forEach(function (point) { radius = Math.max(radius,point.distanceTo(center)); });
      // A bounding sphere gives rotation-independent extent, with a texel margin for snapping.
      radius = Math.ceil(radius * 16)/16;
      var half = radius / (1 - 2/c.mapSize);
      var texel = 2 * half / c.mapSize;
      var localCenter = center.clone().applyMatrix4(inverse);
      localCenter.x = Math.round(localCenter.x / texel) * texel;
      localCenter.y = Math.round(localCenter.y / texel) * texel;
      var margin = Math.max(1000,half);
      localCenter.z += radius + margin;
      var position = localCenter.clone().applyMatrix4(orientation);
      var target = position.clone().add(direction);
      var light = c.lights[i];
      light.position.copy(root.worldToLocal(position.clone()));
      light.target.position.copy(root.worldToLocal(target.clone()));
      var cam = light.shadow.camera;
      cam.up.copy(up); cam.left=-half; cam.right=half; cam.top=half; cam.bottom=-half;
      cam.near=0.1; cam.far=2*radius+2*margin;
      cam.updateProjectionMatrix();
      light.shadow.bias=c.bias; light.shadow.normalBias=c.normalBias; light.shadow.radius=c.softness;
      light.updateMatrixWorld(true); light.target.updateMatrixWorld(true);
      c.ranges.push({corners:corners,half:half,texel:texel,center:localCenter.clone(),orientation:orientation.clone()});
    }
    c.near = near; c.far = far;
    syncCSMUniforms(state);
  }

  function syncCSMUniforms(state, uniforms) {
    var c = shadowState(state);
    c.ready = c.lights.length === c.count && c.lights.every(function (l) { return !!l.shadow.map; });
    function write(u) {
      if (!u || !u.uAlCSMReady) return;
      u.uAlCSMReady.value = c.ready ? 1 : 0;
      u.uAlCSMSplits.value = c.splits;
      u.uAlCSMNear.value = c.near || 0.1; u.uAlCSMBlend.value = c.blend;
      u.uAlCSMSize.value = c.mapSize; u.uAlCSMBias.value = c.bias;
      u.uAlCSMNormalBias.value = c.normalBias; u.uAlCSMSoftness.value = c.softness;
      u.uAlCSMDirection.value = c.sunDirection || new THREE.Vector3();
      u.uAlCSMViewToWorld.value = state.viewToWorldMatrix;
      for (var i=0;i<c.count;i++) {
        if (!u['uAlCSMMap'+i] || !c.lights[i]) continue;
        u['uAlCSMMap'+i].value = c.lights[i].shadow.map ? c.lights[i].shadow.map.texture : null;
        u['uAlCSMMatrix'+i].value = c.lights[i].shadow.matrix;
      }
    }
    if (uniforms) write(uniforms);
    else state.hookedMaterials.forEach(function (mat) { write(mat.__alUniforms); });
  }

  function csmShaderPrelude(count) {
    var lines = ['uniform float uAlCSMReady, uAlCSMNear, uAlCSMBlend, uAlCSMSize, uAlCSMBias, uAlCSMNormalBias, uAlCSMSoftness;',
      'uniform float uAlCSMSplits[4];','uniform vec3 uAlCSMDirection;','uniform mat4 uAlCSMViewToWorld;'];
    for (var i=0;i<count;i++) lines.push('uniform sampler2D uAlCSMMap'+i+'; uniform mat4 uAlCSMMatrix'+i+';');
    return lines.join('\n');
  }

  function csmShadowCode(count) {
    var lines=['{','if (uAlCSMReady > 0.5 && dot(directLight.direction,uAlCSMDirection) > 0.9999) {',
      'vec3 alN = inverseTransformDirection(geometryNormal, viewMatrix);',
      'vec3 alP = (uAlCSMViewToWorld * vec4(geometryPosition,1.0)).xyz + alN * uAlCSMNormalBias;',
      'float alDepth = -geometryPosition.z;', 'float alShadow = 1.0;'];
    for (var i=0;i<count;i++) {
      var sample='getShadow(uAlCSMMap'+i+',vec2(uAlCSMSize),uAlCSMBias,uAlCSMSoftness,uAlCSMMatrix'+i+'*vec4(alP,1.0))';
      lines.push((i ? 'else ' : '')+'if (alDepth <= uAlCSMSplits['+i+']) {');
      lines.push('alShadow = '+sample+';');
      var next=i<count-1 ? 'getShadow(uAlCSMMap'+(i+1)+',vec2(uAlCSMSize),uAlCSMBias,uAlCSMSoftness,uAlCSMMatrix'+(i+1)+'*vec4(alP,1.0))' : '1.0';
      lines.push('float alWidth = max(0.0001,uAlCSMBlend*(uAlCSMSplits['+i+']-'+(i?'uAlCSMSplits['+(i-1)+']':'uAlCSMNear')+'));');
      lines.push('if (uAlCSMBlend > 0.0) alShadow = mix(alShadow,'+next+',smoothstep(uAlCSMSplits['+i+']-alWidth,uAlCSMSplits['+i+'],alDepth));','}');
    }
    lines.push('directLight.color *= alShadow;','}','}');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------- Grid Constants */
  var CLUSTER_GRID_X = 16;
  var CLUSTER_GRID_Y = 9;
  var CLUSTER_GRID_Z = 24;
  var TOTAL_CLUSTERS = CLUSTER_GRID_X * CLUSTER_GRID_Y * CLUSTER_GRID_Z; // 3,456
  var MAX_LIGHTS_DEFAULT = 256;
  var MAX_LIGHTS_PER_CLUSTER = 64;

  // Floats per light in uClusteredLightData. Four RGBA32F texels:
  //   0 (posView.xyz, radius)  1 (color.rgb, intensity)
  //   2 (dirView.xyz, typeFlag)  3 (iesProfileId, cosInnerAngle, 0, 0)
  var LIGHT_TEXELS = 4;
  var LIGHT_FLOATS = LIGHT_TEXELS * 4;
  var MAX_LIGHTS_CAP = 512;
  // GDevelop 3D coordinates are pixel-scale; light distances are exposed in metres.
  var WORLD_UNITS_PER_METER = 100.0;

  // The light index list is a 2D texture, not a 1D strip. The 1D form needed
  // TOTAL_CLUSTERS * MAX_LIGHTS_PER_CLUSTER = 221,184 texels of width, which is over thirteen
  // times the 16,384 GL_MAX_TEXTURE_SIZE of typical desktop hardware and 108 times
  // the 2,048 that WebGL2 actually guarantees. The upload failed and every texelFetch
  // returned 0, so every cluster slot resolved to light index 0.
  var LIGHT_INDEX_TEX_WIDTH = 2048;
  var LIGHT_INDEX_TOTAL = TOTAL_CLUSTERS * MAX_LIGHTS_PER_CLUSTER; // 221,184
  var LIGHT_INDEX_TEX_HEIGHT = Math.ceil(LIGHT_INDEX_TOTAL / LIGHT_INDEX_TEX_WIDTH); // 108

  /* ------------------------------------------------------------- Probe Constants */
  var NUM_RAYS = 32;

  /* ------------------------------------------------------------- Float / Math Helpers */
  var _f32 = new Float32Array(1);
  var _u32 = new Uint32Array(_f32.buffer);

  function clamp(val, min, max) {
    return val < min ? min : (val > max ? max : val);
  }

  function saturate(val) {
    return val < 0 ? 0 : (val > 1 ? 1 : val);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  function colorsEqual(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  // IEEE754 binary32 -> binary16. The probe volumes are RGBA16F, which is the smallest
  // format WebGL2 guarantees is linearly filterable.
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

  // Planckian locus approximation (Tanner Helland), normalised to [0, 1] linear RGB.
  function kelvinToRGB(kelvin) {
    var temp = clamp(kelvin, 1000, 12000) / 100.0;
    var r, g, b;

    if (temp <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(temp) - 161.1195681661;
      if (temp <= 19) {
        b = 0;
      } else {
        b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
      }
    } else {
      r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
      b = 255;
    }

    return [
      saturate(r / 255.0),
      saturate(g / 255.0),
      saturate(b / 255.0)
    ];
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
      if (input.charAt(0) === '#' && typeof gdjs.hexToRGBColor === 'function') {
        return gdjs.hexToRGBColor(input);
      }
    }
    return fallback || [255, 255, 255];
  }

  // Arvo's squared point-to-AABB distance. The cluster broadphase runs this once per
  // (light, cluster) pair, so it stays branch-light and allocation free.
  function arvoDistanceSq(minX, minY, minZ, maxX, maxY, maxZ, cx, cy, cz) {
    var sqDist = 0.0;
    var v;
    v = cx;
    if (v < minX) sqDist += (minX - v) * (minX - v);
    if (v > maxX) sqDist += (v - maxX) * (v - maxX);
    v = cy;
    if (v < minY) sqDist += (minY - v) * (minY - v);
    if (v > maxY) sqDist += (v - maxY) * (v - maxY);
    v = cz;
    if (v < minZ) sqDist += (minZ - v) * (minZ - v);
    if (v > maxZ) sqDist += (v - maxZ) * (v - maxZ);
    return sqDist;
  }

  // Ericson's closest point on triangle (Real-Time Collision Detection, Sec. 5.1.5).
  // Returns squared distance from query point (px, py, pz) to triangle (A, B, C).
  function closestPointOnTriangleSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    var abx = bx - ax, aby = by - ay, abz = bz - az;
    var acx = cx - ax, acy = cy - ay, acz = cz - az;
    var apx = px - ax, apy = py - ay, apz = pz - az;

    var d1 = abx * apx + aby * apy + abz * apz;
    var d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0.0 && d2 <= 0.0) {
      var dx = px - ax, dy = py - ay, dz = pz - az;
      return dx * dx + dy * dy + dz * dz;
    }

    var bpx = px - bx, bpy = py - by, bpz = pz - bz;
    var d3 = abx * bpx + aby * bpy + abz * bpz;
    var d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0.0 && d4 <= d3) {
      var dx = px - bx, dy = py - by, dz = pz - bz;
      return dx * dx + dy * dy + dz * dz;
    }

    var vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
      var v = d1 / (d1 - d3);
      var qx = ax + v * abx, qy = ay + v * aby, qz = az + v * abz;
      var dx = px - qx, dy = py - qy, dz = pz - qz;
      return dx * dx + dy * dy + dz * dz;
    }

    var cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    var d5 = abx * cpx + aby * cpy + abz * cpz;
    var d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0.0 && d5 <= d6) {
      var dx = px - cx, dy = py - cy, dz = pz - cz;
      return dx * dx + dy * dy + dz * dz;
    }

    var vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
      var w = d2 / (d2 - d6);
      var qx = ax + w * acx, qy = ay + w * acy, qz = az + w * acz;
      var dx = px - qx, dy = py - qy, dz = pz - qz;
      return dx * dx + dy * dy + dz * dz;
    }

    var va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
      var w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      var qx = bx + w * (cx - bx), qy = by + w * (cy - by), qz = bz + w * (cz - bz);
      var dx = px - qx, dy = py - qy, dz = pz - qz;
      return dx * dx + dy * dy + dz * dz;
    }

    var denom = 1.0 / (va + vb + vc);
    var v = vb * denom;
    var w = vc * denom;
    var qx = ax + abx * v + acx * w;
    var qy = ay + aby * v + acy * w;
    var qz = az + abz * v + acz * w;
    var dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  // Felzenszwalb & Huttenlocher 1D Euclidean Distance Transform (Theory of Computing, Vol 8, 2012).
  // Computes lower parabolic envelope in O(n) time.
  function felzenszwalb1D(f, d, v, z, n, spacingSq) {
    spacingSq = spacingSq || 1;
    var k = 0;
    v[0] = 0;
    z[0] = -1e20;
    z[1] = 1e20;
    for (var q = 1; q < n; q++) {
      var fq = f[q];
      var s = ((fq + spacingSq * q * q) - (f[v[k]] + spacingSq * v[k] * v[k])) / (2 * spacingSq * (q - v[k]));
      while (s <= z[k]) {
        k--;
        s = ((fq + spacingSq * q * q) - (f[v[k]] + spacingSq * v[k] * v[k])) / (2 * spacingSq * (q - v[k]));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e20;
    }
    k = 0;
    for (var q = 0; q < n; q++) {
      while (z[k + 1] < q) {
        k++;
      }
      var vk = v[k];
      var diff = q - vk;
      d[q] = spacingSq * diff * diff + f[vk];
    }
  }

  // Separable 3D Distance Transform over a grid of size resX x resY x resZ.
  // Seeds and output use the spacing units; omitted spacing preserves unit-grid behavior.
  function run3DEDT(grid, resX, resY, resZ, spacingX, spacingY, spacingZ) {
    spacingX = spacingX || 1; spacingY = spacingY || 1; spacingZ = spacingZ || 1;
    var maxDim = Math.max(resX, resY, resZ);
    var f = new Float32Array(maxDim);
    var d = new Float32Array(maxDim);
    var v = new Int32Array(maxDim);
    var z = new Float32Array(maxDim + 1);

    // Pass 1: Along X axis
    for (var k = 0; k < resZ; k++) {
      for (var j = 0; j < resY; j++) {
        var base = (k * resY + j) * resX;
        for (var i = 0; i < resX; i++) f[i] = grid[base + i];
        felzenszwalb1D(f, d, v, z, resX, spacingX * spacingX);
        for (var i = 0; i < resX; i++) grid[base + i] = d[i];
      }
    }

    // Pass 2: Along Y axis
    for (var k = 0; k < resZ; k++) {
      for (var i = 0; i < resX; i++) {
        for (var j = 0; j < resY; j++) {
          f[j] = grid[(k * resY + j) * resX + i];
        }
        felzenszwalb1D(f, d, v, z, resY, spacingY * spacingY);
        for (var j = 0; j < resY; j++) {
          grid[(k * resY + j) * resX + i] = d[j];
        }
      }
    }

    // Pass 3: Along Z axis
    for (var j = 0; j < resY; j++) {
      for (var i = 0; i < resX; i++) {
        for (var k = 0; k < resZ; k++) {
          f[k] = grid[(k * resY + j) * resX + i];
        }
        felzenszwalb1D(f, d, v, z, resZ, spacingZ * spacingZ);
        for (var k = 0; k < resZ; k++) {
          grid[(k * resY + j) * resX + i] = Math.sqrt(Math.max(0.0, d[k]));
        }
      }
    }
  }

  // Must match the branch order inside evaluateIESProfile in the GLSL prelude.
  var IES_PROFILE_IDS = {
    None: 0,
    WallSconce: 1,
    StreetLamp: 2,
    Downlight: 3,
    Searchlight: 4
  };

  /* ------------------------------------------------------------- Stratified Bake Rays */
  // Fibonacci sphere: 32 near-uniform directions, in GDevelop axes where Z is up.
  var SPHERE_RAYS = (function () {
    var rays = [];
    var phi = Math.PI * (3 - Math.sqrt(5)); // Golden ratio angle
    for (var i = 0; i < NUM_RAYS; i++) {
      var y = 1 - (i / (NUM_RAYS - 1)) * 2; // -1 to 1, used as the altitude axis
      var radius = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = phi * i;
      var x = Math.cos(theta) * radius;
      var z = Math.sin(theta) * radius;
      rays.push({ x: x, y: z, z: y });
    }
    return rays;
  })();

  /* ------------------------------------------------------------- Logging */
  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[AdvancedLighting3D] ' + message);
  }

  /* ------------------------------------------------------------- Renderer Accessors */
  function threeRendererOf(runtimeScene) {
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

  function getActiveCamera(runtimeScene) {
    var layer = runtimeScene.getLayer('');
    var lr = layer && layer.getRenderer ? layer.getRenderer() : null;
    if (!lr) return null;
    return lr.getThreeCamera ? lr.getThreeCamera() : null;
  }

  function getThreeScene(runtimeScene) {
    var layer = runtimeScene.getLayer('');
    var lr = layer && layer.getRenderer ? layer.getRenderer() : null;
    if (!lr) return null;
    return lr.getThreeScene ? lr.getThreeScene() : null;
  }

  function layerNameOf(object) {
    return (object && typeof object.getLayer === 'function') ? object.getLayer() : '';
  }

  function threeRootOf(object) {
    var renderer = object && object.getRenderer && object.getRenderer();
    if (!renderer) return null;
    return renderer.get3DRendererObject ? renderer.get3DRendererObject() : renderer._threeObject;
  }

  // Model3D swaps its whole mesh tree (new SkeletonUtils.clone, original shared materials)
  // inside _updateModel, which fires from updateFromObjectData on a live preview reload.
  // Comparing this reference detects that a receiver's clones went stale.
  function modelTreeOf(object) {
    var renderer = object && object.getRenderer && object.getRenderer();
    if (!renderer) return null;
    return renderer._threeObject ||
      (renderer.get3DRendererObject ? renderer.get3DRendererObject() : null);
  }

  /* ------------------------------------------------------------- Scene State */
  var scenes = new Map();

  function stateOf(runtimeScene) {
    var s = scenes.get(runtimeScene);
    if (!s) {
      s = {
        /* ---- Clustered direct lighting ---- */
        maxLights: MAX_LIGHTS_DEFAULT,
        clusterGridX: CLUSTER_GRID_X,
        clusterGridY: CLUSTER_GRID_Y,
        clusterGridZ: CLUSTER_GRID_Z,
        totalClusters: TOTAL_CLUSTERS,
        enableVolumetricFog: false,
        volumetricFogDensity: 0.02,
        volumetricAnisotropy: 0.4,
        globalIntensityScale: 1.0,
        showDebugVisualizer: false,

        lights: new Set(),

        cachedFov: 0,
        cachedAspect: 0,
        cachedNear: 0,
        cachedFar: 0,
        clusterAABBs: new Float32Array(TOTAL_CLUSTERS * 6), // [minX, minY, minZ, maxX, maxY, maxZ]
        depthSlices: new Float32Array(CLUSTER_GRID_Z + 1),

        // Light Data: RGBA32F, 4 texels per light. Reallocated by applyMaxLights when the
        // MaxLights setting changes -- a fixed 256-light array silently dropped every write
        // past index 255 while the code happily reported a 512-light budget.
        lightDataArray: new Float32Array(MAX_LIGHTS_DEFAULT * LIGHT_FLOATS),
        lightDataTexture: null,

        // Cluster Grid: RG32UI. Offsets can address the full 64-light-per-cluster list,
        // which exceeds the 65,535 ceiling of the old RG16UI headers.
        clusterGridArray: new Uint32Array(TOTAL_CLUSTERS * 2),
        clusterGrid3DTexture: null,
        clusterGrid2DTexture: null, // Fallback

        // Light Index List: R16UI, 2048 x 108 (light ids remain <= 511)
        lightIndexArray: new Uint16Array(LIGHT_INDEX_TEX_WIDTH * LIGHT_INDEX_TEX_HEIGHT),
        lightIndexTexture: null,

        // Per-cluster bins, allocated once and reused. These used to be 3,456 freshly
        // allocated JS arrays per frame, which cost ~0.84 ms before a single light was
        // even considered and dominated the whole broadphase.
        binCounts: new Uint8Array(TOTAL_CLUSTERS),
        binData: new Uint16Array(TOTAL_CLUSTERS * MAX_LIGHTS_PER_CLUSTER),

        debugGroup: null,

        activeLightCount: 0,
        maxLightsInCluster: 0,
        cpuBroadphaseTimeMs: 0.0,

        /* ---- Probe grid indirect lighting ---- */
        volume: null,               // Active LightProbeVolume3D record
        receivers: new Set(),       // ReceiveLightProbes records
        probeGlobalIntensity: 1.0,
        dayNightBlend: 0.0,
        bakeBudgetMs: 8.0,
        bakeState: null,
        isBakeComplete: false,
        dummyProbeTexture: null,    // 1x1x1 white fallback

        /* ---- SDF Shadows ---- */
        sdfVolume: null,            // Active SDFVolume3D record
        sdfBakeBudgetMs: 8.0,
        sdfBakeState: null,
        isSdfBakeComplete: false,
        maxShadowedLights: 4,
        pointShadowDistance: 800.0,
        sdfSunSoftness: 1.8,        // degrees
        sdfHitEps: 0.05,
        sdfNormalBias: 1.0,
        sdfInflate: 0.5,
        dummySdfTexture: null,
        viewToWorldMatrix: THREE_OK ? new THREE.Matrix4() : null,

        /* ---- Shared material bookkeeping ---- */
        // Every material this extension has injected, clustered-only or clustered+probes.
        // Uniform sets hang off the materials themselves (mat.__alUniforms) so a program
        // recompile replaces rather than accumulates them.
        hookedMaterials: new Set(),

        // Materials this extension has looked at and declined (Basic, or any non-standard lit
        // material). Without it the per-frame scene sweep re-tests every one of them on every
        // mesh on every frame.
        rejectedMaterials: new Set(),

        /* ---- Reused scratch (avoid per-frame GC) ---- */
        _vecWorldPos: THREE_OK ? new THREE.Vector3() : null,
        _vecWorldDir: THREE_OK ? new THREE.Vector3() : null,
        _vecViewPos: THREE_OK ? new THREE.Vector3() : null,
        _vecViewDir: THREE_OK ? new THREE.Vector3() : null,
        _vecSize: THREE_OK ? new THREE.Vector2() : null,
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

    // Logarithmic depth slices: z_k = near * (far / near)^(k / Sz)
    for (var k = 0; k <= Sz; ++k) {
      state.depthSlices[k] = near * Math.pow(far / near, k / Sz);
    }

    var halfFovRad = (fov * Math.PI / 180.0) * 0.5;
    var tanHalfFov = Math.tan(halfFovRad);

    var aabbs = state.clusterAABBs;
    var idx = 0;

    // View space looks down -Z, so a cluster's Z bounds are [-zFar, -zNear].
    for (var kk = 0; kk < Sz; ++kk) {
      var zNearSlice = state.depthSlices[kk];
      var zFarSlice = state.depthSlices[kk + 1];

      var yTopNear = zNearSlice * tanHalfFov;
      var xRightNear = yTopNear * aspect;
      var yTopFar = zFarSlice * tanHalfFov;
      var xRightFar = yTopFar * aspect;

      for (var j = 0; j < Sy; ++j) {
        for (var i = 0; i < Sx; ++i) {
          // A cluster is a truncated pyramid. Its AABB must contain the four
          // near-plane corners as well as the four far-plane corners. Using only
          // the far plane clips the inner edge of every off-centre tile and makes
          // lights pop as camera movement shifts a surface through a depth slice.
          var xNear0 = -xRightNear + (2.0 * i / Sx) * xRightNear;
          var xNear1 = -xRightNear + (2.0 * (i + 1) / Sx) * xRightNear;
          var xFar0 = -xRightFar + (2.0 * i / Sx) * xRightFar;
          var xFar1 = -xRightFar + (2.0 * (i + 1) / Sx) * xRightFar;
          var xMin = Math.min(xNear0, xNear1, xFar0, xFar1);
          var xMax = Math.max(xNear0, xNear1, xFar0, xFar1);

          var yNear0 = -yTopNear + (2.0 * j / Sy) * yTopNear;
          var yNear1 = -yTopNear + (2.0 * (j + 1) / Sy) * yTopNear;
          var yFar0 = -yTopFar + (2.0 * j / Sy) * yTopFar;
          var yFar1 = -yTopFar + (2.0 * (j + 1) / Sy) * yTopFar;
          var yMin = Math.min(yNear0, yNear1, yFar0, yFar1);
          var yMax = Math.max(yNear0, yNear1, yFar0, yFar1);

          aabbs[idx++] = xMin;
          aabbs[idx++] = yMin;
          aabbs[idx++] = -zFarSlice;
          aabbs[idx++] = xMax;
          aabbs[idx++] = yMax;
          aabbs[idx++] = -zNearSlice;
        }
      }
    }
  }

  /* ------------------------------------------------------------- Light Budget */
  // Changing MaxLights changes the width of uClusteredLightData, so the backing array and the
  // texture both have to be rebuilt. Doing it lazily here keeps the cost on the frame the
  // setting actually changes.
  function applyMaxLights(state, requested) {
    var next = clamp(Math.floor(requested), 64, MAX_LIGHTS_CAP);
    if (next === state.maxLights && state.lightDataArray.length === next * LIGHT_FLOATS) {
      return;
    }
    state.maxLights = next;
    state.lightDataArray = new Float32Array(next * LIGHT_FLOATS);
    if (state.lightDataTexture) {
      state.lightDataTexture.dispose();
      state.lightDataTexture = null; // initTextures rebuilds it at the new width
    }
  }

  /* ------------------------------------------------------------- Cluster Texture Init */
  function initTextures(state, runtimeScene) {
    if (!THREE_OK) return;

    var isGL2 = isWebGL2Available(runtimeScene);

    // 1. Light Data Texture: RGBA32F (MaxLights * 3, 1)
    if (!state.lightDataTexture) {
      state.lightDataTexture = new THREE.DataTexture(
        state.lightDataArray,
        state.maxLights * LIGHT_TEXELS,
        1,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      state.lightDataTexture.minFilter = THREE.NearestFilter;
      state.lightDataTexture.magFilter = THREE.NearestFilter;
      state.lightDataTexture.generateMipmaps = false;
      state.lightDataTexture.needsUpdate = true;
    }

    // 2. Cluster Grid Texture: RG32UI
    if (isGL2 && typeof THREE.Data3DTexture !== 'undefined') {
      if (!state.clusterGrid3DTexture) {
        state.clusterGrid3DTexture = new THREE.Data3DTexture(
          state.clusterGridArray,
          state.clusterGridX,
          state.clusterGridY,
          state.clusterGridZ
        );
        state.clusterGrid3DTexture.format = THREE.RGIntegerFormat || THREE.RGBAIntegerFormat || THREE.RGBAFormat;
        state.clusterGrid3DTexture.type = THREE.UnsignedIntType;
        state.clusterGrid3DTexture.internalFormat = 'RG32UI';
        state.clusterGrid3DTexture.minFilter = THREE.NearestFilter;
        state.clusterGrid3DTexture.magFilter = THREE.NearestFilter;
        state.clusterGrid3DTexture.wrapS = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.wrapT = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.wrapR = THREE.ClampToEdgeWrapping;
        state.clusterGrid3DTexture.generateMipmaps = false;
        state.clusterGrid3DTexture.needsUpdate = true;
      }
    }

    // 2b. Universal 2D fallback: the same grid unwrapped to (Sx*Sy, Sz)
    if (!state.clusterGrid2DTexture) {
      state.clusterGrid2DTexture = new THREE.DataTexture(
        state.clusterGridArray,
        state.clusterGridX * state.clusterGridY,
        state.clusterGridZ,
        THREE.RGIntegerFormat || THREE.RGBAIntegerFormat || THREE.RGBAFormat,
        THREE.UnsignedIntType
      );
      state.clusterGrid2DTexture.internalFormat = 'RG32UI';
      state.clusterGrid2DTexture.minFilter = THREE.NearestFilter;
      state.clusterGrid2DTexture.magFilter = THREE.NearestFilter;
      state.clusterGrid2DTexture.generateMipmaps = false;
      state.clusterGrid2DTexture.needsUpdate = true;
    }

    // 3. Light Index List: R16UI
    if (!state.lightIndexTexture) {
      state.lightIndexTexture = new THREE.DataTexture(
        state.lightIndexArray,
        LIGHT_INDEX_TEX_WIDTH,
        LIGHT_INDEX_TEX_HEIGHT,
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

  /* ------------------------------------------------------------- Probe 3D Textures */
  function makeData3DTexture(uint16Data, resX, resY, resZ) {
    if (!THREE_OK) return null;
    var tex = new THREE.Data3DTexture(uint16Data, resX, resY, resZ);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.HalfFloatType;      // RGBA16F: core filterable in WebGL2
    tex.minFilter = THREE.LinearFilter;  // hardware trilinear interpolation between probes
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function getDummyProbeTexture(state) {
    if (!state.dummyProbeTexture && THREE_OK) {
      var d = new Uint16Array(4);
      d[0] = toHalf(1.0);
      d[1] = toHalf(1.0);
      d[2] = toHalf(1.0);
      d[3] = toHalf(1.0);
      state.dummyProbeTexture = makeData3DTexture(d, 1, 1, 1);
    }
    return state.dummyProbeTexture;
  }

  /* ------------------------------------------------------------- SDF 3D Textures */
  function makeSDFData3DTexture(uint16Data, resX, resY, resZ) {
    if (!THREE_OK) return null;
    var tex = new THREE.Data3DTexture(uint16Data, resX, resY, resZ);
    tex.format = (THREE.RedFormat !== undefined) ? THREE.RedFormat : (THREE.RedIntegerFormat || THREE.RGBAFormat);
    tex.type = THREE.HalfFloatType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function getDummySDFTexture(state) {
    if (!state.dummySdfTexture && THREE_OK) {
      var d = new Uint16Array(1);
      d[0] = toHalf(65504);
      state.dummySdfTexture = makeSDFData3DTexture(d, 1, 1, 1);
    }
    return state.dummySdfTexture;
  }

  function createDefaultSDFRecord() {
    return {
      object: null,
      behavior: null,
      resX: 128,
      resY: 128,
      resZ: 32,
      voxelSize: 15.625,
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 2000,
      maxY: 2000,
      maxZ: 500,
      threeMin: THREE_OK ? new THREE.Vector3(0, -2000, 0) : { x: 0, y: -2000, z: 0 },
      threeSize: THREE_OK ? new THREE.Vector3(2000, 2000, 500) : { x: 2000, y: 2000, z: 500 },
      data: null,
      texture: null,
      isBaked: false,
      boundsLocked: false,
      isSigned: true,
      isInflated: true
    };
  }

  // The pre-bake fallback: a pure altitude gradient, equivalent to a HemisphereLight.
  // Baking is what adds occlusion and coloured bounce on top of it.
  function generateAltitudeGradientBuffer(resX, resY, resZ, skyRgb, groundRgb, horizonRgb) {
    var count = resX * resY * resZ;
    var buffer = new Uint16Array(count * 4);

    var sky = [skyRgb[0] / 255.0, skyRgb[1] / 255.0, skyRgb[2] / 255.0];
    var ground = [groundRgb[0] / 255.0, groundRgb[1] / 255.0, groundRgb[2] / 255.0];
    var horizon = [horizonRgb[0] / 255.0, horizonRgb[1] / 255.0, horizonRgb[2] / 255.0];

    // Up is +Z, so the outer loop is the height axis.
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

  /* ============================================================= Shader Injection ===== */

  var GLSL_CLUSTER_PRELUDE = [
    '#ifdef USE_CLUSTERED_LIGHTS',
    '  // A precision statement must precede every declaration of the type it qualifies,',
    '  // and the unsigned sampler types have no default precision in GLSL ES 3.00.',
    '  precision highp usampler2D;',
    '  #ifdef USE_3D_CLUSTER_TEXTURE',
    '    precision highp usampler3D;',
    '    uniform usampler3D uClusterGrid3D;',
    '  #else',
    '    uniform usampler2D uClusterGrid2D;',
    '  #endif',
    '  uniform usampler2D uLightIndexList;',
    '  uniform sampler2D  uClusteredLightData;',
    '  uniform vec2       uResolution;',
    '  // Float, not ivec3: three uploads an integer uniform through uniform3iv, which',
    '  // needs a real array rather than the Vector3 the uniform value would hold.',
    '  uniform vec3       uClusterGridDims;',
    '  uniform float      uClusterCameraNear;',
    '  uniform float      uClusterCameraFar;',
    '  uniform float      uGlobalClusteredIntensity;',
    '',
    '  // Karis representative-point area specular (capsule segment + sphere cap).',
    '  // fragPos is the view-space fragment position (geometryPosition).',
    '  vec3 getKarisAreaSpecular(vec3 fragPos, vec3 V, vec3 N, vec3 p0, vec3 p1,',
    '                            float lightRadius, float alpha, out float alphaPrime) {',
    '    vec3 L0 = p0 - fragPos;',
    '    vec3 L1 = p1 - fragPos;',
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
    '    // Energy conservation: widen the lobe by the solid angle the light subtends.',
    '    alphaPrime = clamp(alpha + lightRadius / (2.0 * max(distToRep, 0.001)), 0.0, 1.0);',
    '    return normalize(closestOnSphere);',
    '  }',
    '',
    '  // IES photometric profile falloff modulations.',
    '  float evaluateIESProfile(float profileId, vec3 lightDir, vec3 toFrag) {',
    '    if (profileId <= 0.5) return 1.0; // None / Standard',
    '    float cosTheta = dot(-toFrag, lightDir);',
    '    if (profileId < 1.5) {',
    '      // WallSconce: up/down bidirectional butterfly lobes',
    '      return pow(abs(cosTheta), 1.5) * (1.0 - 0.4 * (1.0 - cosTheta * cosTheta));',
    '    } else if (profileId < 2.5) {',
    '      // StreetLamp: Type II asymmetric lateral spread',
    '      return clamp(cosTheta * 1.4, 0.0, 1.0) * (1.0 + 0.3 * sin(acos(clamp(cosTheta, -1.0, 1.0))));',
    '    } else if (profileId < 3.5) {',
    '      // Downlight: cosine-fourth sharp cutoff',
    '      return pow(max(cosTheta, 0.0), 4.0);',
    '    } else {',
    '      // Searchlight: narrow pencil beam',
    '      return pow(max(cosTheta, 0.0), 24.0);',
    '    }',
    '  }',
    '#endif',
    ''
  ].join('\n');

  var GLSL_PROBE_PRELUDE = [
    '#ifdef USE_PROBE_GRID',
    '  precision mediump sampler3D;',
    '  uniform sampler3D uProbeVolumeDay;',
    '  uniform sampler3D uProbeVolumeNight;',
    '  uniform vec3  uProbeVolumeMin;',
    '  uniform vec3  uProbeVolumeSize;',
    '  uniform float uProbeIntensity;',
    '  uniform float uProbeDayNightBlend;',
    '  uniform float uProbeNormalBias;',
    '  varying vec3  vProbeWorldPos;',
    '',
    '  vec3 evaluateLightProbeGrid(vec3 worldPos, vec3 worldNormal) {',
    '    vec3 samplePos = worldPos + worldNormal * uProbeNormalBias;',
    '    vec3 uvw = clamp((samplePos - uProbeVolumeMin) / uProbeVolumeSize, vec3(0.0), vec3(1.0));',
    '    vec3 day   = texture(uProbeVolumeDay,   uvw).rgb;',
    '    vec3 night = texture(uProbeVolumeNight, uvw).rgb;',
    '    return mix(day, night, uProbeDayNightBlend) * uProbeIntensity;',
    '  }',
    '#endif',
    ''
  ].join('\n');

  var GLSL_SDF_PRELUDE = [
    '#ifdef AL_SDF_SHADOWS',
    '  precision mediump sampler3D;',
    '  uniform sampler3D uSdfVolume;',
    '  uniform vec3  uSdfMin;',
    '  uniform vec3  uSdfSize;',
    '  uniform vec4  uSdfParams; // x: voxelSize, y: hitEps, z: normalBias, w: sunK',
    '  uniform mat4  uViewToWorld;',
    '  uniform uint  uMaxShadowedLights;',
    '  uniform float uPointShadowDistance;',
    '',
    '  float sdfSampleStatic(vec3 wp) {',
    '    vec3 uvw = (wp - uSdfMin) / uSdfSize;',
    '    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 1e6;',
    '    return texture(uSdfVolume, uvw).r;',
    '  }',
    '',
    '  float sdfShadow(vec3 ro, vec3 rd, float tMin, float tMax, float k, int maxSteps) {',
    '    float res = 1.0;',
    '    vec3 safeDir = vec3(abs(rd.x) < 1e-8 ? 1e-8 : rd.x, abs(rd.y) < 1e-8 ? 1e-8 : rd.y, abs(rd.z) < 1e-8 ? 1e-8 : rd.z);',
    '    vec3 ta = (uSdfMin - ro) / safeDir;',
    '    vec3 tb = (uSdfMin + uSdfSize - ro) / safeDir;',
    '    vec3 lo = min(ta,tb), hi = max(ta,tb);',
    '    float t = max(tMin,max(lo.x,max(lo.y,lo.z)));',
    '    tMax = min(tMax,min(hi.x,min(hi.y,hi.z)));',
    '    if (t >= tMax) return 1.0;',
    '    float ph = 1e20;',
    '    float voxelSize = uSdfParams.x;',
    '    float hitEps = max(uSdfParams.y * voxelSize, 0.05);',
    '    float minStep = max(0.05,0.05 * voxelSize);',
    '',
    '    for (int i = 0; i < 32; i++) {',
    '      if (i >= maxSteps || t >= tMax) break;',
    '      float h = sdfSampleStatic(ro + rd * t);',
    '      if (h < hitEps) return 0.0;',
    '      float y = h * h / (2.0 * ph);',
    '      float d = sqrt(max(h * h - y * y, 0.0));',
    '      res = min(res, k * d / max(t - y, 1e-4));',
    '      ph = h;',
    '      t += max(h, minStep);',
    '    }',
    '    return clamp(res, 0.0, 1.0);',
    '  }',
    '#endif',
    ''
  ].join('\n');

  // Declared unconditionally in the vertex shader so the varying always has a writer;
  // the fragment side is what the USE_PROBE_GRID guard switches on.
  var GLSL_PROBE_VERTEX_PRELUDE = [
    '#ifdef USE_PROBE_GRID',
    '  varying vec3 vProbeWorldPos;',
    '#endif',
    ''
  ].join('\n');

  var GLSL_PROBE_VERTEX_HOOK = [
    '#include <worldpos_vertex>',
    '#ifdef USE_PROBE_GRID',
    '  #ifdef USE_INSTANCING',
    '    vProbeWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
    '  #else',
    '    vProbeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    '  #endif',
    '#endif'
  ].join('\n');

  // One replacement of lights_fragment_begin covers direct lighting, probes and SDF shadows.
  // geometryPosition / geometryNormal / geometryViewDir are declared by lights_fragment_begin.
  var GLSL_FRAGMENT_HOOK = [
    '#include <lights_fragment_begin>',
    '',
    '#ifdef USE_PROBE_GRID',
    '  irradiance += evaluateLightProbeGrid(',
    '    vProbeWorldPos,',
    '    inverseTransformDirection(geometryNormal, viewMatrix)',
    '  );',
    '#endif',
    '',
    '#ifdef USE_CLUSTERED_LIGHTS',
    '  #ifdef AL_SDF_SHADOWS',
    '    vec3 wp = (uViewToWorld * vec4(geometryPosition, 1.0)).xyz;',
    '    vec3 nw = inverseTransformDirection(geometryNormal, viewMatrix);',
    '    uint shadowedSoFar = 0u;',
    '  #endif',
    '',
    '  vec2 clusterScreenUv = gl_FragCoord.xy / uResolution.xy;',
    '  int cX = int(clamp(clusterScreenUv.x * uClusterGridDims.x, 0.0, uClusterGridDims.x - 1.0));',
    '  int cY = int(clamp(clusterScreenUv.y * uClusterGridDims.y, 0.0, uClusterGridDims.y - 1.0));',
    '  float cViewZ = max(-geometryPosition.z, uClusterCameraNear);',
    '  int cZ = int(clamp(',
    '    (log(cViewZ / uClusterCameraNear) / log(uClusterCameraFar / uClusterCameraNear)) * uClusterGridDims.z,',
    '    0.0, uClusterGridDims.z - 1.0',
    '  ));',
    '',
    '  #ifdef USE_3D_CLUSTER_TEXTURE',
    '    uvec2 clusterHeader = texelFetch(uClusterGrid3D, ivec3(cX, cY, cZ), 0).rg;',
    '  #else',
    '    uvec2 clusterHeader = texelFetch(uClusterGrid2D, ivec2(cX + cY * int(uClusterGridDims.x), cZ), 0).rg;',
    '  #endif',
    '',
    '  uint clusterOffset = clusterHeader.r;',
    '  uint clusterCount = clusterHeader.g;',
    '',
    '  vec3 clP = geometryPosition;',
    '  vec3 clV = geometryViewDir;',
    '  vec3 clN = geometryNormal;',
    '  float clNdotV = max(dot(clN, clV), 0.0001);',
    '  float clAlpha = material.roughness * material.roughness;',
    '  float lightScaleFactor = PI * uGlobalClusteredIntensity;',
    '  vec3 clusteredDiffuseAccum = vec3(0.0);',
    '  vec3 clusteredSpecularAccum = vec3(0.0);',
    '',
    '  for (uint li = 0u; li < clusterCount; ++li) {',
    '    int gi = int(clusterOffset + li);',
    '    uint lightIdx = texelFetch(uLightIndexList,',
    '      ivec2(gi % AL_LIGHT_INDEX_WIDTH, gi / AL_LIGHT_INDEX_WIDTH), 0).r;',
    '    int lightBase = int(lightIdx) * AL_LIGHT_TEXELS;',
    '    vec4 pRad  = texelFetch(uClusteredLightData, ivec2(lightBase,     0), 0);',
    '    vec4 cInt  = texelFetch(uClusteredLightData, ivec2(lightBase + 1, 0), 0);',
    '    vec4 extra = texelFetch(uClusteredLightData, ivec2(lightBase + 2, 0), 0);',
    '    vec4 shape = texelFetch(uClusteredLightData, ivec2(lightBase + 3, 0), 0);',
    '',
    '    vec3 lightPosView = pRad.xyz;',
    '    float radius = pRad.w;',
    '    vec3 toLightCenter = lightPosView - clP;',
    '    float centerDist = length(toLightCenter);',
    '    float lightTypeFlag = extra.w;',
    '    bool isCapsule = lightTypeFlag > 10.0;',
    '',
    '    vec3 clDiffuseL = toLightCenter / max(centerDist, 0.0001);',
    '    vec3 clSpecularL = clDiffuseL;',
    '    float attenuationDistance = centerDist;',
    '    float alphaPrime = clAlpha;',
    '    if (isCapsule) {',
    '      float halfLen = lightTypeFlag - 10.0;',
    '      vec3 p0 = lightPosView - extra.xyz * halfLen;',
    '      vec3 p1 = lightPosView + extra.xyz * halfLen;',
    '      vec3 segment = p1 - p0;',
    '      float segmentLengthSq = max(dot(segment, segment), 0.0001);',
    '      float diffuseT = clamp(dot(clP - p0, segment) / segmentLengthSq, 0.0, 1.0);',
    '      vec3 toClosestOnSegment = (p0 + segment * diffuseT) - clP;',
    '      attenuationDistance = length(toClosestOnSegment);',
    '      clDiffuseL = toClosestOnSegment / max(attenuationDistance, 0.0001);',
    '      clSpecularL = getKarisAreaSpecular(',
    '        clP, clV, clN, p0, p1, radius * 0.1, clAlpha, alphaPrime',
    '      );',
    '    }',
    '',
    '    float distMeters = attenuationDistance / AL_WORLD_UNITS_PER_METER;',
    '    float radiusMeters = radius / AL_WORLD_UNITS_PER_METER;',
    '    if (distMeters < radiusMeters) {',
    '      float num = max(1.0 - pow(distMeters / radiusMeters, 4.0), 0.0);',
    '      float atten = (num * num) / (distMeters * distMeters + 1.0);',
    '',
    '      if (!isCapsule && lightTypeFlag > 0.0) {',
    '        float cosAngle = dot(-clDiffuseL, extra.xyz);',
    '        float cosInner = max(shape.y, lightTypeFlag + 0.0001);',
    '        atten *= clamp((cosAngle - lightTypeFlag) / (cosInner - lightTypeFlag), 0.0, 1.0);',
    '      }',
    '',
    '      atten *= evaluateIESProfile(shape.x, extra.xyz, clDiffuseL);',
    '',
    '      float clDiffuseNdotL = max(dot(clN, clDiffuseL), 0.0);',
    '      float clSpecularNdotL = max(dot(clN, clSpecularL), 0.0);',
    '      vec3 clH = normalize(clV + clSpecularL);',
    '      float clNdotH = max(dot(clN, clH), 0.0);',
    '      float clVdotH = max(dot(clV, clH), 0.0);',
    '',
    '      vec3 F = F_Schlick(material.specularColor, material.specularF90, clVdotH);',
    '      float D = D_GGX(alphaPrime, clNdotH);',
    '      float Vis = V_GGX_SmithCorrelated(alphaPrime, clSpecularNdotL, clNdotV);',
    '      vec3 spec = F * (D * Vis);',
    '      vec3 diff = (vec3(1.0) - F) * material.diffuseColor * RECIPROCAL_PI;',
    '',
    '      vec3 radiance = cInt.rgb * (cInt.w * atten * lightScaleFactor);',
    '      #ifdef AL_SDF_SHADOWS',
    '        float sdfShadowFactor = 1.0;',
    '        uint shadowBits = uint(floor(shape.z));',
    '        float lightShadowBias = fract(shape.z);',
    '        if (shadowedSoFar < uMaxShadowedLights && (shadowBits & 1u) == 1u && clDiffuseNdotL > 0.0) {',
    '          vec3 Lw = inverseTransformDirection(clDiffuseL, viewMatrix);',
    '          vec3 localRo = wp + nw * max(lightShadowBias * uSdfParams.x, 0.1);',
    '          float srcR = max(shape.w, 0.01);',
    '          float tMin = max(0.05,uSdfParams.y * uSdfParams.x);',
    '          float tMax = min(attenuationDistance, uPointShadowDistance);',
    '          if (tMax > tMin) {',
    '            float k = attenuationDistance / srcR;',
    '            sdfShadowFactor = sdfShadow(localRo, Lw, tMin, tMax, k, 12);',
    '            shadowedSoFar++;',
    '          }',
    '        }',
    '        radiance *= sdfShadowFactor;',
    '      #endif',
    '      clusteredDiffuseAccum += diff * radiance * clDiffuseNdotL;',
    '      clusteredSpecularAccum += spec * radiance * clSpecularNdotL;',
    '    }',
    '  }',
    '',
    '  reflectedLight.directDiffuse += clusteredDiffuseAccum;',
    '  reflectedLight.directSpecular += clusteredSpecularAccum;',
    '#endif',
    ''
  ].join('\n');

  /**
   * The single injection point for both features.
   *
   * `receiverRecord` is non-null only for a ReceiveLightProbes clone, which is the one
   * case where per-object uniforms are needed. Everything else gets the clustered block
   * alone. The two produce genuinely different programs, so the cache key encodes which
   * one this material is — a shared constant key here is what makes two independent
   * extensions render each other's shader.
   */
  function injectShaderOnMaterial(material, state, receiverRecord) {
    if (!material) return false;

    var wantProbes = !!receiverRecord;

    // MeshBasicMaterial has no lighting at all, and Lambert/Phong carry a different
    // material struct than the PhysicalMaterial fields the clustered loop reads.
    if (state.rejectedMaterials.has(material)) return false;

    if (material.isMeshBasicMaterial) {
      state.rejectedMaterials.add(material);
      warnOnce('basicMat:' + (material.name || 'unnamed'),
        'Object uses MeshBasicMaterial, which has no lighting. ' +
        'Clustered light and probe injection bypassed (set the object\'s material type away from Basic).');
      return false;
    }
    if (!material.isMeshStandardMaterial) {
      state.rejectedMaterials.add(material);
      warnOnce('nonStandardMat:' + (material.name || 'unnamed'),
        'Material "' + (material.name || 'unnamed') + '" is not a MeshStandardMaterial. ' +
        'Injection skipped: the clustered loop reads PhysicalMaterial fields that other lit materials do not declare.');
      return false;
    }

    var existing = material.__alInjection;
    var use3D = !!state.clusterGrid3DTexture;
    var hasSDF = !!(sdfEnabled(state) && state.sdfVolume && state.sdfVolume.texture && state.sdfVolume.isBaked);
    var csm = shadowState(state);
    var csmCount = csm.lights.length;
    var sdfSun = hasSDF && csm.mode === 'SDF';
    if (existing && existing.owner === state && existing.csmCount === csmCount && existing.sdfSun === sdfSun && existing.probes === wantProbes && existing.sdf === hasSDF && existing.version === RUNTIME_VERSION) {
      state.hookedMaterials.add(material);
      return true;
    }

    // Three caches per-material uniforms with programs. Drop old variants before
    // changing feature ownership so returning to an earlier mode cannot reuse stale bindings.
    if (existing && typeof material.dispose === 'function') material.dispose();
    var cacheKey = 'GD_ADVLIGHT3D_V8|CL1|G3D' + (use3D ? '1' : '0') + '|LP' + (wantProbes ? '1' : '0') + (hasSDF ? '|SDF1' : '') + '|CSM' + csmCount + '|SUN' + (sdfSun ? 1 : 0);

    material.__alInjection = { probes: wantProbes, sdf: hasSDF, key: cacheKey, version: RUNTIME_VERSION, receiver: receiverRecord, owner: state, csmCount: csmCount, sdfSun: sdfSun };
    material.customProgramCacheKey = function () {
      return cacheKey;
    };

    material.onBeforeCompile = function (shader) {
      if (shader.fragmentShader.indexOf('#include <lights_fragment_begin>') === -1) {
        warnOnce('noFragAnchor', 'Material "' + (material.name || 'unnamed') +
          '" has no lights_fragment_begin chunk. Injection skipped.');
        return;
      }
      if (wantProbes && shader.vertexShader.indexOf('#include <worldpos_vertex>') === -1) {
        warnOnce('noVertAnchor', 'Material "' + (material.name || 'unnamed') +
          '" has no worldpos_vertex chunk. Probe injection skipped.');
        return;
      }

      shader.defines = shader.defines || {};
      // Three shares this object with material.defines across program variants.
      delete shader.defines.AL_SDF_SHADOWS;
      delete shader.defines.USE_PROBE_GRID;
      delete shader.defines.USE_3D_CLUSTER_TEXTURE;
      shader.defines.USE_CLUSTERED_LIGHTS = 1;
      // Integer literals, so they can index texelFetch directly. Passing them as uniforms
      // would mean ivec uniforms, which three uploads through uniform3iv and which need a
      // real array rather than the value object a uniform holds.
      shader.defines.AL_LIGHT_INDEX_WIDTH = LIGHT_INDEX_TEX_WIDTH;
      shader.defines.AL_LIGHT_TEXELS = LIGHT_TEXELS;
      // A string, not a number: three writes defines verbatim, and GLSL ES 3.00 has no
      // implicit int->float conversion, so `dist / 100` would fail to compile.
      shader.defines.AL_WORLD_UNITS_PER_METER = WORLD_UNITS_PER_METER.toFixed(1);
      if (use3D) shader.defines.USE_3D_CLUSTER_TEXTURE = 1;
      if (wantProbes) shader.defines.USE_PROBE_GRID = 1;
      if (hasSDF) shader.defines.AL_SDF_SHADOWS = 1;

      // --- Clustered uniforms
      shader.uniforms.uClusteredLightData = { value: state.lightDataTexture };
      shader.uniforms.uClusterGrid3D = { value: state.clusterGrid3DTexture || state.clusterGrid2DTexture };
      shader.uniforms.uClusterGrid2D = { value: state.clusterGrid2DTexture };
      shader.uniforms.uLightIndexList = { value: state.lightIndexTexture };
      shader.uniforms.uResolution = { value: new THREE.Vector2(1920, 1080) };
      shader.uniforms.uClusterGridDims = {
        value: new THREE.Vector3(state.clusterGridX, state.clusterGridY, state.clusterGridZ)
      };
      shader.uniforms.uClusterCameraNear = { value: 0.1 };
      shader.uniforms.uClusterCameraFar = { value: 1000.0 };
      shader.uniforms.uGlobalClusteredIntensity = { value: state.globalIntensityScale };

      // --- SDF uniforms
      if (hasSDF) {
        shader.uniforms.uSdfVolume = { value: state.sdfVolume ? state.sdfVolume.texture : null };
        shader.uniforms.uSdfMin = { value: state.sdfVolume ? state.sdfVolume.threeMin : (THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 }) };
        shader.uniforms.uSdfSize = { value: state.sdfVolume ? state.sdfVolume.threeSize : (THREE_OK ? new THREE.Vector3(1, 1, 1) : { x: 1, y: 1, z: 1 }) };
        var vx = state.sdfVolume ? (state.sdfVolume.voxelSize || ((state.sdfVolume.maxX - state.sdfVolume.minX) / state.sdfVolume.resX)) : 10.0;
        var sunK = 1.0 / Math.tan((state.sdfSunSoftness || 1.8) * Math.PI / 180.0);
        shader.uniforms.uSdfParams = { value: (THREE_OK && THREE.Vector4) ? new THREE.Vector4(vx, state.sdfHitEps || 0.05, state.sdfNormalBias, sunK) : { x: vx, y: 0.05, z: 1.0, w: sunK } };
        shader.uniforms.uViewToWorld = { value: state.viewToWorldMatrix || (THREE_OK ? new THREE.Matrix4() : null) };
        shader.uniforms.uMaxShadowedLights = { value: state.maxShadowedLights || 4 };
        shader.uniforms.uPointShadowDistance = { value: state.pointShadowDistance || 800.0 };
      }

      if (csmCount) {
        shader.uniforms.uAlCSMReady = {value:0};
        ['Near','Blend','Size','Bias','NormalBias','Softness','Splits','Direction','ViewToWorld'].forEach(function (name) { shader.uniforms['uAlCSM'+name] = {value:null}; });
        for (var i=0;i<csmCount;i++) { shader.uniforms['uAlCSMMap'+i]={value:null}; shader.uniforms['uAlCSMMatrix'+i]={value:null}; }
        syncCSMUniforms(state,shader.uniforms);
        shader.fragmentShader = csmShaderPrelude(csmCount) + '\n' + shader.fragmentShader;
      }

      // --- Probe uniforms. Intensity starts at 0 so the frames between this compile and
      // the first syncReceiverUniforms() add no light, rather than a full-strength sample
      // of an unbound (black) texture.
      if (wantProbes) {
        shader.uniforms.uProbeVolumeDay = { value: null };
        shader.uniforms.uProbeVolumeNight = { value: null };
        shader.uniforms.uProbeVolumeMin = { value: new THREE.Vector3() };
        shader.uniforms.uProbeVolumeSize = { value: new THREE.Vector3(1, 1, 1) };
        shader.uniforms.uProbeIntensity = { value: 0.0 };
        shader.uniforms.uProbeDayNightBlend = { value: 0.0 };
        shader.uniforms.uProbeNormalBias = { value: receiverRecord.normalBias };
      }

      // Held on the material, not appended to a scene-level list: three calls
      // onBeforeCompile again for every new program cache key, and a list would
      // accumulate one dead uniform set per recompile for the material's lifetime.
      material.__alUniforms = shader.uniforms;

      shader.fragmentShader = GLSL_CLUSTER_PRELUDE + '\n' + GLSL_PROBE_PRELUDE + '\n' + GLSL_SDF_PRELUDE + '\n' + shader.fragmentShader;
      var lightingHook = GLSL_FRAGMENT_HOOK;
      if ((sdfSun || csmCount) && THREE.ShaderChunk && THREE.ShaderChunk.lights_fragment_begin) {
        // Shadow each native directional contribution before Three evaluates its BRDF.
        var directionalAnchor = 'getDirectionalLightInfo( directionalLight, directLight );';
        var nativeLighting = THREE.ShaderChunk.lights_fragment_begin.replace(directionalAnchor,
          directionalAnchor + '\n' + (csmCount ? csmShadowCode(csmCount) : [
            '#ifdef AL_SDF_SHADOWS',
            '{', // Keep declarations scoped when Three unrolls multiple Suns.
            'vec3 alSunWorldPos = (uViewToWorld * vec4(geometryPosition, 1.0)).xyz;',
            'vec3 alSunNormal = inverseTransformDirection(geometryNormal, viewMatrix);',
            'vec3 alSunOrigin = alSunWorldPos + alSunNormal * max(uSdfParams.z * uSdfParams.x, 0.1);',
            'vec3 alSunDirection = inverseTransformDirection(directLight.direction, viewMatrix);',
            'directLight.color *= sdfShadow(alSunOrigin, alSunDirection, max(0.05,uSdfParams.y * uSdfParams.x), length(uSdfSize), uSdfParams.w, 32);',
            '}',
            '#endif'
          ].join('\n')));
        lightingHook = lightingHook.replace('#include <lights_fragment_begin>', nativeLighting);
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>', lightingHook
      );

      if (wantProbes) {
        shader.vertexShader = GLSL_PROBE_VERTEX_PRELUDE + '\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          GLSL_PROBE_VERTEX_HOOK
        );
      }
    };

    material.needsUpdate = true;
    state.hookedMaterials.add(material);
    return true;
  }

  function unhookMaterial(state, material) {
    if (!material) return;
    state.hookedMaterials.delete(material);
    material.__alInjection = null;
    material.__alUniforms = null;
  }

  // Auto-discovery pass over the whole three scene. Receiver clones are injected at clone
  // time and are already in hookedMaterials, so this pass leaves them alone.
  function hookObjectMaterials(object3D, state) {
    if (!object3D || !object3D.traverse) return;
    object3D.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      if (Array.isArray(child.material)) {
        for (var i = 0; i < child.material.length; i++) {
          var mat = child.material[i];
          if (!state.hookedMaterials.has(mat)) injectShaderOnMaterial(mat, state, null);
        }
      } else if (!state.hookedMaterials.has(child.material)) {
        injectShaderOnMaterial(child.material, state, null);
      }
    });
  }

  /* ------------------------------------------------------------- Procedural Flicker */
  function evaluateFlicker(mode, time, speed, variation, baseIntensity) {
    if (mode === 'None' || variation <= 0.0) return baseIntensity;

    var factor = 1.0;
    var t = time * speed;

    if (mode === 'FireFlicker') {
      // Multi-octave organic fire flicker
      var w1 = Math.sin(t);
      var w2 = Math.sin(t * 2.3 + 1.2);
      var w3 = Math.sin(t * 5.7 + 3.4);
      factor = 1.0 + variation * ((w1 * 0.5 + w2 * 0.3 + w3 * 0.2) * 0.5);
    } else if (mode === 'FluorescentHum') {
      // 50/60 Hz buzz with an occasional dropout
      var hum = Math.sin(t * 6.2831853);
      var dropout = Math.sin(t * 0.37) > 0.96 ? 1.0 - 0.75 * variation : 1.0;
      factor = (1.0 + variation * hum * 0.15) * dropout;
    } else if (mode === 'SirenStrobe') {
      // Hard on/off square wave
      factor = (Math.sin(t * 6.2831853) > 0.0) ? (1.0 + variation) : (1.0 - variation);
    } else if (mode === 'PulseWave') {
      // Smooth breathing sine
      factor = 1.0 + variation * Math.sin(t * 6.2831853);
    }

    return Math.max(0.0, baseIntensity * factor);
  }

  /* ------------------------------------------------------------- Scene Manager */
  function registerSceneManager(runtimeScene, options) {
    var state = stateOf(runtimeScene);
    if (options) {
      if (options.maxLights !== undefined) applyMaxLights(state, options.maxLights);
      if (options.enableVolumetricFog !== undefined) state.enableVolumetricFog = !!options.enableVolumetricFog;
      if (options.volumetricFogDensity !== undefined) state.volumetricFogDensity = options.volumetricFogDensity;
      if (options.volumetricAnisotropy !== undefined) state.volumetricAnisotropy = clamp(options.volumetricAnisotropy, 0.0, 0.9);
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
      if (options.enableVolumetricFog !== undefined) state.enableVolumetricFog = !!options.enableVolumetricFog;
      if (options.showDebugVisualizer !== undefined) {
        state.showDebugVisualizer = !!options.showDebugVisualizer;
        toggleClusterDebugVisualizer(runtimeScene, state.showDebugVisualizer);
      }
    }
  }

  /* ------------------------------------------------------------- Spot Direction Face */
  // Cube3D uses Three's BoxGeometry material order. Slot 4 is the front (+Z) face, and
  // Object3D.getWorldDirection() returns that same +Z axis. Replacing this one material
  // therefore marks the exact face from which a Spot light emits without changing any
  // transform math or adding another editor object.
  var spotDirectionTexture = null;
  var spotDirectionMaterial = null;
  var spotDirectionGeometry = null;

  function getSpotDirectionMaterial() {
    if (spotDirectionMaterial) return spotDirectionMaterial;
    if (!THREE_OK || !THREE.CanvasTexture || !THREE.MeshBasicMaterial ||
        typeof document === 'undefined' || !document.createElement) {
      return null;
    }

    var canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;

    // High-contrast, unlit artwork remains readable even in a completely dark scene.
    ctx.fillStyle = '#160d22';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, 122, 122);

    // Bulb glass and warm core.
    ctx.beginPath();
    ctx.arc(64, 52, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#fef3c7';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(57, 45, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Screw base.
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(48, 77); ctx.lineTo(80, 77);
    ctx.moveTo(51, 87); ctx.lineTo(77, 87);
    ctx.moveTo(56, 97); ctx.lineTo(72, 97);
    ctx.stroke();

    // Rays make the marked face obvious when the cube is small in the editor.
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 5;
    var rays = [[64, 11, 64, 20], [25, 28, 33, 33], [103, 28, 95, 33],
      [17, 57, 28, 57], [111, 57, 100, 57]];
    for (var ri = 0; ri < rays.length; ri++) {
      ctx.beginPath();
      ctx.moveTo(rays[ri][0], rays[ri][1]);
      ctx.lineTo(rays[ri][2], rays[ri][3]);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPOT OUT', 64, 114);

    spotDirectionTexture = new THREE.CanvasTexture(canvas);
    spotDirectionTexture.name = 'AdvancedLighting3D Spot Direction Bulb';
    if (THREE.SRGBColorSpace) spotDirectionTexture.colorSpace = THREE.SRGBColorSpace;
    spotDirectionTexture.needsUpdate = true;

    spotDirectionMaterial = new THREE.MeshBasicMaterial({
      map: spotDirectionTexture,
      color: 0xffffff,
      toneMapped: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    spotDirectionMaterial.name = 'AdvancedLighting3D Spot Direction Face';
    return spotDirectionMaterial;
  }

  function getCubeSpotFaceMesh(light) {
    var object = light && light.object;
    // setFaceResourceName is Cube3D-specific and keeps arbitrary Model3D trees safe.
    if (!object || typeof object.setFaceResourceName !== 'function') return null;
    var mesh = threeRootOf(object);
    return mesh && typeof mesh.add === 'function' && typeof mesh.remove === 'function' ? mesh : null;
  }

  function makeSpotDirectionDecal() {
    var marker = getSpotDirectionMaterial();
    if (!marker || !THREE.PlaneGeometry || !THREE.Mesh) return null;
    if (!spotDirectionGeometry) {
      // Cube3D's BoxGeometry spans [-0.5, +0.5]. This covers most of the +Z face while
      // preserving a border of the authored cube texture around the marker.
      spotDirectionGeometry = new THREE.PlaneGeometry(0.76, 0.76);
      spotDirectionGeometry.name = 'AdvancedLighting3D Spot Direction Decal Geometry';
    }
    var decal = new THREE.Mesh(spotDirectionGeometry, marker);
    decal.name = 'AdvancedLighting3D Spot Direction (+Z/front)';
    decal.position.set(0, 0, 0.506);
    decal.renderOrder = 10000;
    // Do not let the helper plane intercept object picking in GDevelop's 3D editor.
    decal.raycast = function () {};
    decal.userData = decal.userData || {};
    decal.userData.__advancedLighting3DSpotDirection = true;
    return decal;
  }

  function restoreSpotDirectionFace(light) {
    if (!light) return;
    if (light.spotFaceMesh && light.spotDirectionDecal &&
        light.spotDirectionDecal.parent === light.spotFaceMesh) {
      light.spotFaceMesh.remove(light.spotDirectionDecal);
    }
    light.spotFaceMesh = null;
    light.spotDirectionDecal = null;
  }

  function syncSpotDirectionFace(light) {
    if (!light || light.lightType !== 'Spot') {
      restoreSpotDirectionFace(light);
      return;
    }

    var mesh = getCubeSpotFaceMesh(light);
    if (!mesh) {
      restoreSpotDirectionFace(light);
      return;
    }
    if (light.spotFaceMesh && light.spotFaceMesh !== mesh) {
      restoreSpotDirectionFace(light);
    }

    if (!light.spotDirectionDecal) {
      light.spotDirectionDecal = makeSpotDirectionDecal();
    }
    if (!light.spotDirectionDecal) return;
    if (light.spotDirectionDecal.parent !== mesh) {
      // A separate child survives Cube3D's per-face material refresh in the editor.
      mesh.add(light.spotDirectionDecal);
    }
    light.spotFaceMesh = mesh;
  }

  /* ------------------------------------------------------------- Light Record Lifecycle */
  function registerLight(runtimeScene, object, behavior, options) {
    var state = stateOf(runtimeScene);
    var light = behavior.__alLight;
    if (!light) {
      light = behavior.__alLight = {
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
        shadowBias: options && options.shadowBias !== undefined ? options.shadowBias : 0.02,
        castShadow: options && options.castShadow !== undefined ? !!options.castShadow : false,
        sourceRadius: options && options.sourceRadius !== undefined ? options.sourceRadius : 0.0,
        flickerMode: (options && options.flickerMode) || 'None',
        flickerSpeed: options && options.flickerSpeed !== undefined ? options.flickerSpeed : 8.0,
        flickerIntensityVariation: options && options.flickerIntensityVariation !== undefined ? options.flickerIntensityVariation : 0.25,

        active: true,
        // Seeded from the authored intensity rather than a hardcoded 1.0: the scene editor
        // runs no events, so stepLight never fires there and this is the only value the
        // broadphase will ever see.
        currentIntensity: options && options.intensity !== undefined ? options.intensity : 1.0,
        viewDistance: 0.0,
        isInFrustum: true,
        worldPosition: THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 },
        worldDirection: THREE_OK ? new THREE.Vector3(0, 0, -1) : { x: 0, y: 0, z: -1 },
        viewPosition: THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 },
        viewDirection: THREE_OK ? new THREE.Vector3(0, 0, -1) : { x: 0, y: 0, z: -1 },

        spotFaceMesh: null,
        spotDirectionDecal: null,

        muzzleFlashTimer: 0.0,
        muzzleFlashDuration: 0.0,
        muzzleFlashActive: false
      };
      state.lights.add(light);
      syncSpotDirectionFace(light);
    }
    return light;
  }

  function updateLight(runtimeScene, object, behavior, options) {
    var light = behavior.__alLight;
    if (!light || !options) return;
    if (options.lightType !== undefined) light.lightType = options.lightType;
    if (options.intensity !== undefined) {
      light.intensity = options.intensity;
      // Editor has no step, so nothing else would ever pick this up there.
      if (!light.muzzleFlashActive && light.flickerMode === 'None') {
        light.currentIntensity = options.intensity;
      }
    }
    if (options.radius !== undefined) light.radius = options.radius;
    if (options.capsuleLength !== undefined) light.capsuleLength = options.capsuleLength;
    if (options.spotInnerAngle !== undefined) light.spotInnerAngle = options.spotInnerAngle;
    if (options.spotOuterAngle !== undefined) light.spotOuterAngle = options.spotOuterAngle;
    if (options.colorMode !== undefined) light.colorMode = options.colorMode;
    if (options.colorTemperature !== undefined) light.colorTemperature = options.colorTemperature;
    if (options.lightColor !== undefined) light.lightColor = parseColor(options.lightColor, light.lightColor);
    if (options.emissiveBoost !== undefined) light.emissiveBoost = options.emissiveBoost;
    if (options.iesProfile !== undefined) light.iesProfile = options.iesProfile;
    if (options.shadowBias !== undefined) light.shadowBias = options.shadowBias;
    if (options.castShadow !== undefined) light.castShadow = !!options.castShadow;
    if (options.sourceRadius !== undefined) light.sourceRadius = options.sourceRadius;
    if (options.flickerMode !== undefined) light.flickerMode = options.flickerMode;
    if (options.flickerSpeed !== undefined) light.flickerSpeed = options.flickerSpeed;
    if (options.flickerIntensityVariation !== undefined) light.flickerIntensityVariation = options.flickerIntensityVariation;
    syncSpotDirectionFace(light);
  }

  function destroyLight(runtimeScene, behavior) {
    var state = scenes.get(runtimeScene);
    if (state && behavior.__alLight) {
      restoreSpotDirectionFace(behavior.__alLight);
      state.lights.delete(behavior.__alLight);
      behavior.__alLight = null;
    }
  }

  function triggerMuzzleFlash(light, duration) {
    if (!light) return;
    light.muzzleFlashDuration = Number.isFinite(Number(duration)) ? Math.max(0.01, Number(duration)) : 0.05;
    light.muzzleFlashTimer = light.muzzleFlashDuration;
    light.muzzleFlashActive = true;
    light.currentIntensity = light.intensity * 5;
  }

  function stepLight(runtimeScene, object, behavior) {
    var light = behavior.__alLight;
    if (!light || !light.active || light.flickerController) return;

    var dt = (runtimeScene.getElapsedTime ? runtimeScene.getElapsedTime() : 16.6) / 1000.0;
    var time = (runtimeScene.getTimeManager ? runtimeScene.getTimeManager().getTimeFromStart() : Date.now()) / 1000.0;

    updateLightEffects(light, dt, time);
  }

  function updateLightEffects(light, dt, time) {
    if (light.muzzleFlashActive) {
      light.muzzleFlashTimer -= dt;
      if (light.muzzleFlashTimer <= 0.0) {
        light.muzzleFlashActive = false;
        light.muzzleFlashTimer = 0.0;
      }
    }

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

  // Optional companion behavior. One controller owns animation of a light at a time.
  function resolveTweenLight(scene, rec) {
    if (!rec) return null;
    var slot = rec.kind === 'tweens' ? 'tweenController' : 'flickerController';
    var lights = stateOf(scene).lights;
    if (rec.light && lights.has(rec.light) && rec.light[slot] === rec) return rec.light;
    var match = null;
    lights.forEach(function (light) {
      if (light.object !== rec.object) return;
      if (rec.lightBehavior && (!light.behavior.getName || light.behavior.getName() !== rec.lightBehavior)) return;
      if (!match) match = light;
    });
    if (rec.light && rec.light !== match) releaseTweenLight(rec);
    if (!match || (match[slot] && match[slot] !== rec)) return null;
    match[slot] = rec;
    rec.light = match;
    return match;
  }

  function releaseTweenLight(rec) {
    var slot = rec.kind === 'tweens' ? 'tweenController' : 'flickerController';
    if (rec.light && rec.light[slot] === rec) {
      rec.light[slot] = null;
      if (rec.kind !== 'tweens') {
        rec.light.flickerMode = 'None';
        rec.light.muzzleFlashActive = false;
        rec.light.currentIntensity = rec.light.intensity;
      }
    }
    rec.light = null;
  }

  function registerLightflickereffects(scene, object, behavior, options) {
    options = options || {};
    var rec = behavior.__alLightflickereffects;
    if (!rec) rec = behavior.__alLightflickereffects = {
      object: object, light: null, lightBehavior: options.lightBehavior || '',
      flickerMode: options.flickerMode || 'None',
      flickerSpeed: Math.max(0, Number(options.flickerSpeed === undefined ? 8 : options.flickerSpeed) || 0),
      flickerIntensityVariation: clamp(Number(options.flickerIntensityVariation === undefined ? 0.25 : options.flickerIntensityVariation) || 0, 0, 1),
      time: 0, paused: false, suspended: false, channels: Object.create(null)
    };
    setLightTweenFlicker(behavior, rec.flickerMode, rec.flickerSpeed, rec.flickerIntensityVariation);
    resolveTweenLight(scene, rec);
    return rec;
  }

  function registerLightTweens(scene, object, behavior, options) {
    var rec = behavior.__alLightTweens;
    if (!rec) rec = behavior.__alLightTweens = {
      kind: 'tweens', object: object, light: null, lightBehavior: options && options.lightBehavior || '',
      time: 0, paused: false, suspended: false, channels: Object.create(null)
    };
    resolveTweenLight(scene, rec);
    return rec;
  }

  function destroyLightTweens(scene, behavior) {
    if (behavior.__alLightTweens) releaseTweenLight(behavior.__alLightTweens);
    behavior.__alLightTweens = null;
  }

  function tweenEase(t, easing) {
    if (easing === 'CubicIn') return t * t * t;
    if (easing === 'CubicOut') return 1 - Math.pow(1 - t, 3);
    if (easing === 'CubicInOut') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    if (easing === 'SineIn') return 1 - Math.cos(t * Math.PI / 2);
    if (easing === 'SineOut') return Math.sin(t * Math.PI / 2);
    if (easing === 'ExponentialInOut') return t === 0 || t === 1 ? t : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;

    if (easing === 'EaseIn') return t * t;
    if (easing === 'EaseOut') return t * (2 - t);
    if (easing === 'EaseInOut') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    if (easing === 'SineInOut') return (1 - Math.cos(Math.PI * t)) / 2;
    return t;
  }

  function applyLightTween(light, channel, value) {
    if (channel === 'Color') {
      light.lightColor = value; light.colorMode = 'RGB';
    } else if (channel === 'Temperature') {
      light.colorTemperature = value; light.colorMode = 'Kelvin';
    } else if (channel === 'Radius') light.radius = value;
    else light.intensity = value;
    if (light.flickerMode === 'None' && !light.muzzleFlashActive) light.currentIntensity = light.intensity;
  }

  function startLightTween(scene, behavior, channel, target, duration, easing, loop) {
    var rec = behavior.__alLightTweens;
    var light = resolveTweenLight(scene, rec);
    if (!light || ['Intensity', 'Radius', 'Color', 'Temperature'].indexOf(channel) < 0) return false;
    duration = Number(duration);
    if (!Number.isFinite(duration)) return false;
    var from;
    var fromColor = channel === 'Temperature' && light.colorMode === 'RGB' ? light.lightColor.slice() : null;
    if (channel === 'Color') {
      from = light.colorMode === 'Kelvin' ? kelvinToRGB(light.colorTemperature).map(function (v) { return v * 255; }) : light.lightColor.slice();
      target = parseColor(target, from).map(function (v) { return clamp(Number(v) || 0, 0, 255); });
      delete rec.channels.Temperature;
    } else {
      target = Number(target);
      if (!Number.isFinite(target)) return false;
      target = channel === 'Temperature' ? clamp(target, 1000, 12000) : Math.max(0, target);
      from = channel === 'Temperature' ? light.colorTemperature : channel === 'Radius' ? light.radius : light.intensity;
      if (channel === 'Temperature') delete rec.channels.Color;
    }
    var tween = rec.channels[channel] = { from: from, target: target,
      fromColor: fromColor,
      targetColor: fromColor ? kelvinToRGB(target).map(function (v) { return v * 255; }) : null,
      duration: Math.max(0, duration), elapsed: 0, progress: 0,
      easing: easing || 'Linear', loop: loop || 'Once', playing: true, finished: false };
    if (tween.duration === 0) {
      applyLightTween(light, channel, target);
      tween.progress = 1; tween.playing = false; tween.finished = true;
    }
    return true;
  }

  function stepLightflickereffects(scene, object, behavior) {
    stepLightAnimation(scene, object, behavior.__alLightflickereffects);
  }

  function stepLightTweens(scene, object, behavior) {
    stepLightAnimation(scene, object, behavior.__alLightTweens);
  }

  function stepLightAnimation(scene, object, rec) {
    var light = resolveTweenLight(scene, rec);
    if (!light || rec.paused || rec.suspended || !light.active) return;
    var dt = Math.max(0, (object.getElapsedTime ? object.getElapsedTime(scene) : scene.getElapsedTime ? scene.getElapsedTime() : 16.6) / 1000);
    if (!Number.isFinite(dt) || dt <= 0) return;
    rec.time += dt;
    Object.keys(rec.channels).forEach(function (channel) {
      var tween = rec.channels[channel];
      if (!tween.playing) return;
      tween.elapsed += dt;
      var cycles = tween.elapsed / tween.duration;
      var t;
      if (tween.loop === 'Loop') t = cycles % 1;
      else if (tween.loop === 'PingPong') { t = cycles % 2; if (t > 1) t = 2 - t; }
      else { t = Math.min(1, cycles); if (t === 1) { tween.playing = false; tween.finished = true; } }
      tween.progress = t;
      var eased = tweenEase(t, tween.easing);
      if (tween.fromColor && !(tween.finished && t === 1)) {
        applyLightTween(light, 'Color', lerpColor(tween.fromColor, tween.targetColor, eased));
      } else {
        applyLightTween(light, channel, channel === 'Color' ? lerpColor(tween.from, tween.target, eased) : lerp(tween.from, tween.target, eased));
      }
    });
    if (rec.kind === 'tweens') {
      // Re-evaluate modulation at its existing phase; never advance the effect twice.
      var fx = light.flickerController;
      updateLightEffects(light, 0, fx ? fx.time : rec.time);
    } else {
      light.flickerMode = rec.flickerMode;
      light.flickerSpeed = rec.flickerSpeed;
      light.flickerIntensityVariation = rec.flickerIntensityVariation;
      updateLightEffects(light, dt, rec.time);
    }
  }

  function setLightTweenFlicker(behavior, mode, speed, variation) {
    var rec = behavior.__alLightflickereffects;
    if (!rec) return;
    rec.flickerMode = ['None', 'FireFlicker', 'FluorescentHum', 'SirenStrobe', 'PulseWave'].indexOf(mode) >= 0 ? mode : 'None';
    rec.flickerSpeed = Number.isFinite(Number(speed)) ? Math.max(0, Number(speed)) : 0;
    rec.flickerIntensityVariation = Number.isFinite(Number(variation)) ? clamp(Number(variation), 0, 1) : 0;
    if (rec.light) {
      rec.light.flickerMode = rec.flickerMode;
      rec.light.flickerSpeed = rec.flickerSpeed;
      rec.light.flickerIntensityVariation = rec.flickerIntensityVariation;
      updateLightEffects(rec.light, 0, rec.time);
    }
  }

  function stopLightTween(behavior, channel) {
    var rec = behavior.__alLightTweens;
    if (!rec) return;
    Object.keys(rec.channels).forEach(function (key) {
      if (channel !== 'All' && channel !== key) return;
      rec.channels[key].playing = false;
      rec.channels[key].finished = false;
    });
  }

  function destroyLightflickereffects(scene, behavior) {
    var rec = behavior.__alLightflickereffects;
    if (rec) releaseTweenLight(rec);
    behavior.__alLightflickereffects = null;
  }

  function toggleClusterDebugVisualizer(runtimeScene, show) {
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

  /* ============================================================= Probe Volume ========= */

  function registerVolume(runtimeScene, object, behavior, options) {
    if (!THREE_OK) return null;
    options = options || {};
    if (!isWebGL2Available(runtimeScene)) {
      warnOnce('noWebGL2', 'WebGL2 is not supported on this context. The light probe grid is disabled ' +
        '(sampler3D does not exist in GLSL ES 1.00, so there is no degraded mode).');
      return null;
    }

    var state = stateOf(runtimeScene);
    var vol = behavior.__alProbeVolume;
    if (!vol) {
      vol = behavior.__alProbeVolume = {
        object: object,
        behavior: behavior,
        resX: clamp(Math.floor(options.resX || 16), 2, 64),
        resY: clamp(Math.floor(options.resY || 16), 2, 64),
        resZ: clamp(Math.floor(options.resZ || 4), 2, 64),
        skyColor: parseColor(options.skyColor, [160, 200, 255]),
        groundColor: parseColor(options.groundColor, [80, 120, 50]),
        horizonColor: parseColor(options.horizonColor, [200, 220, 240]),
        volumeIntensity: options.volumeIntensity !== undefined ? options.volumeIntensity : 1.0,
        dayNightMode: !!options.dayNightMode,
        showDebugSpheres: !!options.showDebugSpheres,
        autoBakeOnStart: !!options.autoBakeOnStart,
        bakedOnce: false,

        gradientDirty: true,   // colours changed -> altitude gradient must be rebuilt
        nightDirty: true,
        isBaked: false,        // dataDay holds baked results, not a generated gradient
        boundsLocked: false,   // bounds came from a loaded file; stop syncing from the cube
        debugDirty: true,

        // Bounds in GDevelop space
        minX: 0, minY: 0, minZ: 0,
        maxX: 1000, maxY: 1000, maxZ: 500,

        // Mirrored three-space bounds
        threeMin: new THREE.Vector3(),
        threeSize: new THREE.Vector3(1, 1, 1),

        textureDay: null,
        textureNight: null,
        dataDay: null,
        dataNight: null,

        debugMesh: null
      };
    }

    // Assigned unconditionally: a record that already exists on the behavior would
    // otherwise never be published to this scene's state, leaving state.volume null and
    // every lookup (bake, receivers, expressions) silently finding no volume.
    state.volume = vol;

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
    if (options.resX !== undefined) vol.resX = clamp(Math.floor(options.resX), 2, 64);
    if (options.resY !== undefined) vol.resY = clamp(Math.floor(options.resY), 2, 64);
    if (options.resZ !== undefined) vol.resZ = clamp(Math.floor(options.resZ), 2, 64);
    if (options.skyColor !== undefined) {
      var newSky = parseColor(options.skyColor, vol.skyColor);
      if (!colorsEqual(newSky, vol.skyColor)) { vol.skyColor = newSky; vol.gradientDirty = true; }
    }
    if (options.groundColor !== undefined) {
      var newGround = parseColor(options.groundColor, vol.groundColor);
      if (!colorsEqual(newGround, vol.groundColor)) { vol.groundColor = newGround; vol.gradientDirty = true; }
    }
    if (options.horizonColor !== undefined) {
      var newHorizon = parseColor(options.horizonColor, vol.horizonColor);
      if (!colorsEqual(newHorizon, vol.horizonColor)) { vol.horizonColor = newHorizon; vol.gradientDirty = true; }
    }
    if (vol.gradientDirty) vol.nightDirty = true;
    if (options.volumeIntensity !== undefined) vol.volumeIntensity = options.volumeIntensity;
    if (options.dayNightMode !== undefined) vol.dayNightMode = !!options.dayNightMode;
    if (options.showDebugSpheres !== undefined) vol.showDebugSpheres = !!options.showDebugSpheres;
    if (options.autoBakeOnStart !== undefined) vol.autoBakeOnStart = !!options.autoBakeOnStart;
  }

  function syncVolumeBoundsFromObject(vol, object) {
    if (!vol || !object) return;
    // Loaded probe data carries its own bounds; the authoring cube must not clobber them
    // every frame or the volume and its data drift apart.
    if (vol.boundsLocked) return;
    if (typeof object.getZ !== 'function' || typeof object.getDepth !== 'function') {
      warnOnce('volumeNot3D',
        'LightProbeVolume3D is attached to an object with no Z/depth (not a 3D object). ' +
        'Attach it to a Cube3D, or set bounds explicitly with SetProbeVolumeBounds.');
      return;
    }
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

    // The 3D scene root is mirrored on Y, so three-space min is [minX, -maxY, minZ].
    if (vol.threeMin.x !== vol.minX || vol.threeMin.y !== -vol.maxY || vol.threeMin.z !== vol.minZ) {
      vol.debugDirty = true;
    }
    vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
    vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
  }

  function hideVolumeCube(object) {
    // The authoring cube defines bounds; it must not occlude the game.
    if (object.setOpacity) object.setOpacity(0);
    if (object.hide) object.hide(true);
    var renderer = object.getRenderer && object.getRenderer();
    var threeObj = renderer && (renderer.get3DRendererObject ? renderer.get3DRendererObject() : renderer._threeObject);
    if (threeObj) threeObj.visible = false;
  }

  function ensureVolumeTextures(vol) {
    if (!vol) return;
    var totalProbes = vol.resX * vol.resY * vol.resZ;

    // A resolution change invalidates any bake: the buffer no longer matches the grid.
    var resolutionChanged = !vol.dataDay || vol.dataDay.length !== totalProbes * 4;
    if (resolutionChanged) {
      vol.isBaked = false;
      vol.gradientDirty = true;
      vol.debugDirty = true;
    }

    // Colours changed after a bake: regenerating would silently throw the bake away, so
    // keep the baked data and tell the user a re-bake is what they want.
    if (vol.gradientDirty && vol.isBaked && !resolutionChanged) {
      warnOnce('colorAfterBake',
        'Volume colours changed after baking. Baked probe data is kept; call StartProbeBake again to apply the new colours.');
      vol.gradientDirty = false;
    }

    if (resolutionChanged || vol.gradientDirty) {
      vol.dataDay = generateAltitudeGradientBuffer(
        vol.resX, vol.resY, vol.resZ,
        vol.skyColor, vol.groundColor, vol.horizonColor
      );
      if (vol.textureDay) vol.textureDay.dispose();
      vol.textureDay = makeData3DTexture(vol.dataDay, vol.resX, vol.resY, vol.resZ);
      vol.gradientDirty = false;
      vol.debugDirty = true;
    }

    if (vol.dayNightMode) {
      if (!vol.dataNight || vol.dataNight.length !== totalProbes * 4 || vol.nightDirty) {
        var nightSky = [vol.skyColor[0] * 0.15, vol.skyColor[1] * 0.15, vol.skyColor[2] * 0.35];
        var nightGround = [vol.groundColor[0] * 0.1, vol.groundColor[1] * 0.1, vol.groundColor[2] * 0.15];
        var nightHorizon = [vol.horizonColor[0] * 0.15, vol.horizonColor[1] * 0.15, vol.horizonColor[2] * 0.25];
        vol.dataNight = generateAltitudeGradientBuffer(
          vol.resX, vol.resY, vol.resZ,
          nightSky, nightGround, nightHorizon
        );
        if (vol.textureNight) vol.textureNight.dispose();
        vol.textureNight = makeData3DTexture(vol.dataNight, vol.resX, vol.resY, vol.resZ);
        vol.nightDirty = false;
      }
    } else if (vol.textureNight) {
      vol.textureNight.dispose();
      vol.textureNight = null;
      vol.dataNight = null;
    }
  }

  function disposeVolume(runtimeScene, behavior) {
    var vol = behavior && behavior.__alProbeVolume;
    if (!vol) return;
    var state = scenes.get(runtimeScene);
    if (state && state.volume === vol) {
      state.volume = null;
    }
    if (vol.textureDay) { vol.textureDay.dispose(); vol.textureDay = null; }
    if (vol.textureNight) { vol.textureNight.dispose(); vol.textureNight = null; }
    if (vol.debugMesh) {
      if (vol.debugMesh.parent) vol.debugMesh.parent.remove(vol.debugMesh);
      if (vol.debugMesh.geometry) vol.debugMesh.geometry.dispose();
      if (vol.debugMesh.material) vol.debugMesh.material.dispose();
      vol.debugMesh = null;
    }
    behavior.__alProbeVolume = null;
  }

  /* ============================================================= Probe Receivers ====== */

  // Materials are shared game-wide, so a receiver takes its own copy before injecting.
  // Material.copy() does not carry onBeforeCompile or customProgramCacheKey across, so a
  // clone of an already-hooked shared material starts clean and gets exactly one
  // injection — the clustered + probe variant.
  function collectMeshesAndCloneMaterials(rootObject, receiverRecord, state) {
    var clones = [];
    if (!rootObject || !rootObject.traverse) return clones;

    rootObject.traverse(function (node) {
      if (!node.isMesh || !node.material) return;

      var orig = node.material;
      if (Array.isArray(orig)) {
        var cloneArr = [];
        for (var i = 0; i < orig.length; i++) {
          var m = orig[i];
          var c = m.clone();
          if (!injectShaderOnMaterial(c, state, receiverRecord)) {
            // Not a lit standard material: keep the original and drop the useless copy.
            c.dispose();
            cloneArr.push(m);
            continue;
          }
          cloneArr.push(c);
          clones.push({ mesh: node, index: i, original: m, clone: c });
        }
        node.material = cloneArr;
      } else {
        var singleClone = orig.clone();
        if (!injectShaderOnMaterial(singleClone, state, receiverRecord)) {
          singleClone.dispose();
          return;
        }
        node.material = singleClone;
        clones.push({ mesh: node, index: -1, original: orig, clone: singleClone });
      }
    });

    return clones;
  }

  function registerReceiver(runtimeScene, object, behavior, options) {
    if (!THREE_OK) return null;
    if (!isWebGL2Available(runtimeScene)) return null;
    options = options || {};

    if (typeof object.getZ !== 'function') {
      warnOnce('receiverNot3D',
        'ReceiveLightProbes is attached to an object with no Z coordinate (not a 3D object). ' +
        'Attach it to a Model3D or Cube3D.');
      return null;
    }

    var state = stateOf(runtimeScene);
    var rec = behavior.__alProbeReceiver;
    if (!rec) {
      rec = behavior.__alProbeReceiver = {
        object: object,
        behavior: behavior,
        intensityMultiplier: options.intensityMultiplier !== undefined ? options.intensityMultiplier : 1.0,
        normalBias: options.normalBias !== undefined ? options.normalBias : 15.0, // world units (pixels)
        updateFrequency: options.updateFrequency || 'Continuous',
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        materialClones: [],
        collectedFrom: null,
        stepCounter: 0,
        effectiveIntensity: 1.0
      };
      state.receivers.add(rec);

      var threeRoot = threeRootOf(object);
      if (threeRoot) {
        rec.materialClones = collectMeshesAndCloneMaterials(threeRoot, rec, state);
        rec.collectedFrom = modelTreeOf(object);
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
    if (!rec) return;

    if (!rec.enabled) {
      for (var j = 0; j < rec.materialClones.length; j++) {
        var uZero = rec.materialClones[j].clone.__alUniforms;
        if (uZero && uZero.uProbeIntensity) uZero.uProbeIntensity.value = 0.0;
      }
      return;
    }

    var state = stateOf(runtimeScene);
    var vol = state.volume;
    var volInt = vol ? vol.volumeIntensity : 1.0;
    rec.effectiveIntensity = volInt * rec.intensityMultiplier * state.probeGlobalIntensity * GDEVELOP_LIGHT_INTENSITY_SCALE;

    var dayTex = (vol && vol.textureDay) ? vol.textureDay : getDummyProbeTexture(state);
    var nightTex = (vol && vol.dayNightMode && vol.textureNight) ? vol.textureNight : dayTex;

    for (var i = 0; i < rec.materialClones.length; i++) {
      var u = rec.materialClones[i].clone.__alUniforms;
      if (!u) continue;
      if (u.uProbeVolumeDay) u.uProbeVolumeDay.value = dayTex;
      if (u.uProbeVolumeNight) u.uProbeVolumeNight.value = nightTex;
      if (u.uProbeVolumeMin && vol) u.uProbeVolumeMin.value.copy(vol.threeMin);
      if (u.uProbeVolumeSize && vol) u.uProbeVolumeSize.value.copy(vol.threeSize);
      if (u.uProbeIntensity) u.uProbeIntensity.value = vol ? rec.effectiveIntensity : 0.0;
      if (u.uProbeDayNightBlend) u.uProbeDayNightBlend.value = state.dayNightBlend;
      if (u.uProbeNormalBias) u.uProbeNormalBias.value = rec.normalBias;
    }
  }

  function stepReceiver(runtimeScene, object, behavior) {
    var rec = behavior && behavior.__alProbeReceiver;
    if (!rec) return;

    rec.stepCounter++;
    // Always sync on the first step: uniforms are created lazily at first compile and
    // hold intensity 0 until something writes them.
    if (rec.updateFrequency === 'Throttled' && rec.stepCounter > 1 && rec.stepCounter % 5 !== 0) {
      return;
    }

    // Re-collect if the mesh tree was rebuilt under us, or if the first attempt found
    // nothing (the renderer may not have built the tree yet at onCreated time).
    var state = stateOf(runtimeScene);
    var currentTree = modelTreeOf(object);
    if (rec.materialClones.length === 0 || (rec.collectedFrom && currentTree !== rec.collectedFrom)) {
      var threeRoot = threeRootOf(object);
      if (threeRoot) {
        rec.materialClones = collectMeshesAndCloneMaterials(threeRoot, rec, state);
        rec.collectedFrom = currentTree;
      }
    }

    syncReceiverUniforms(runtimeScene, rec);
  }

  function disposeReceiver(runtimeScene, behavior) {
    var rec = behavior && behavior.__alProbeReceiver;
    if (!rec) return;

    var state = scenes.get(runtimeScene);
    if (state) state.receivers.delete(rec);

    // Restore the shared originals and dispose the per-instance clones.
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
        if (state) unhookMaterial(state, item.clone);
        if (item.clone) item.clone.dispose();
      } catch (e2) {}
    }
    rec.materialClones = [];
    rec.collectedFrom = null;
    behavior.__alProbeReceiver = null;
  }

  /* ============================================================= Raycast Occlusion Bake */

  // Every mesh belonging to an object that receives probe light. Baking these would record
  // each dynamic object's own occlusion into the volume permanently — a character standing
  // still during a bake would leave a dark blob behind it.
  function collectReceiverMeshes(state) {
    var excluded = new Set();
    state.receivers.forEach(function (rec) {
      var root = threeRootOf(rec.object);
      if (!root || !root.traverse) return;
      root.traverse(function (node) {
        if (node.isMesh) excluded.add(node);
      });
    });
    return excluded;
  }

  function collectBakeGeometry(runtimeScene, layerName) {
    var layer = runtimeScene.getLayer(layerName || '');
    var lr = layer && layer.getRenderer && layer.getRenderer();
    var scene = lr && lr.getThreeScene ? lr.getThreeScene() : null;
    var meshes = [];
    if (!scene) return meshes;

    var state = stateOf(runtimeScene);
    var excluded = collectReceiverMeshes(state);

    scene.traverse(function (node) {
      if (node.isMesh && node.visible && node.geometry) {
        if (node.name && node.name.indexOf('AL_PROBE_DEBUG') !== -1) return;
        if (excluded.has(node)) return;
        meshes.push(node);
      }
    });
    return meshes;
  }

  function startBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    var vol = state.volume;
    if (!vol) {
      warnOnce('bakeNoVol', 'Cannot bake: no active LightProbeVolume3D in this scene.');
      return false;
    }
    if (state.bakeState && state.bakeState.inProgress) {
      return false; // Already baking
    }

    var totalProbes = vol.resX * vol.resY * vol.resZ;
    var meshes = collectBakeGeometry(runtimeScene, layerNameOf(vol.object));

    state.bakeState = {
      inProgress: true,
      currentProbe: 0,
      rayIndex: 0,           // lets a probe resume mid-way when the budget runs out
      accR: 0, accG: 0, accB: 0,
      totalProbes: totalProbes,
      buffer: new Uint16Array(totalProbes * 4),
      meshes: meshes,
      raycaster: new THREE.Raycaster(),
      originVec: new THREE.Vector3(),
      dirVec: new THREE.Vector3()
    };

    console.log('[AdvancedLighting3D] Baking ' + totalProbes + ' probes x ' + NUM_RAYS +
      ' rays = ' + (totalProbes * NUM_RAYS).toLocaleString() + ' raycasts against ' +
      meshes.length + ' meshes. Poll ProbeBakeProgress() for progress.');
    state.bakeState.raycaster.far = Math.max(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
    state.isBakeComplete = false;
    return true;
  }

  function cancelBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (state.bakeState) {
      state.bakeState.inProgress = false;
      state.bakeState.rayIndex = 0;
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

      var px = lerp(vol.minX, vol.maxX, tx);
      var py = lerp(vol.minY, vol.maxY, ty);
      var pz = lerp(vol.minZ, vol.maxZ, tz);

      // Mirrored three-space position.
      bs.originVec.set(px, -py, pz);

      // Resume where the previous frame ran out of budget.
      if (bs.rayIndex === 0) { bs.accR = 0; bs.accG = 0; bs.accB = 0; }
      var accR = bs.accR;
      var accG = bs.accG;
      var accB = bs.accB;
      var outOfBudget = false;

      for (var r = bs.rayIndex; r < NUM_RAYS; r++) {
        var sRay = SPHERE_RAYS[r];
        bs.dirVec.set(sRay.x, -sRay.y, sRay.z).normalize();
        bs.raycaster.set(bs.originVec, bs.dirVec);

        var hits = bs.meshes.length > 0 ? bs.raycaster.intersectObjects(bs.meshes, false) : [];
        if (hits.length === 0) {
          // Unoccluded: sky / horizon / ground by the ray's altitude.
          var tRay = (sRay.z + 1.0) * 0.5; // 0 (ground) to 1 (sky)
          var c = tRay < 0.5
            ? lerpColor(ground, horizon, tRay * 2.0)
            : lerpColor(horizon, sky, (tRay - 0.5) * 2.0);
          accR += c[0];
          accG += c[1];
          accB += c[2];
        } else {
          // Occluded: pick up subtle bounce from the hit material.
          var hitMat = hits[0].object && hits[0].object.material;
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

        // Checked per ray, not per probe: a single probe against a heavy scene can exceed
        // the whole frame budget on its own, which would pin the bake to one probe per
        // frame no matter how large the budget is.
        if ((r & 7) === 7) {
          var rayNow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          if (rayNow - start >= budget) {
            bs.rayIndex = r + 1;
            bs.accR = accR; bs.accG = accG; bs.accB = accB;
            outOfBudget = true;
            break;
          }
        }
      }

      if (outOfBudget) return;   // same probe resumes next frame
      bs.rayIndex = 0;

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
      vol.dataDay = bs.buffer;
      if (vol.textureDay) vol.textureDay.dispose();
      vol.textureDay = makeData3DTexture(vol.dataDay, resX, resY, resZ);
      vol.isBaked = true;
      vol.gradientDirty = false;
      vol.debugDirty = true;

      if (vol.debugMesh) updateProbeDebugMesh(runtimeScene, vol);

      bs.inProgress = false;
      state.bakeState = null;
      state.isBakeComplete = true;
    }
  }

  /* ============================================================= Probe Debug Spheres === */

  function updateProbeDebugMesh(runtimeScene, vol) {
    if (!THREE_OK || !vol) return;
    var layer = runtimeScene.getLayer(layerNameOf(vol.object));
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

    var spacingX = (vol.maxX - vol.minX) / Math.max(1, vol.resX - 1);
    var spacingY = (vol.maxY - vol.minY) / Math.max(1, vol.resY - 1);
    var spacingZ = (vol.maxZ - vol.minZ) / Math.max(1, vol.resZ - 1);
    var sphereRadius = Math.min(spacingX, spacingY, spacingZ) * 0.15;

    if (!vol.debugMesh || vol.debugMesh.count !== totalProbes) {
      if (vol.debugMesh && vol.debugMesh.parent) vol.debugMesh.parent.remove(vol.debugMesh);
      var geom = new THREE.SphereGeometry(Math.max(1.0, sphereRadius), 8, 8);
      var mat = new THREE.MeshBasicMaterial({ toneMapped: false });
      vol.debugMesh = new THREE.InstancedMesh(geom, mat, totalProbes);
      vol.debugMesh.name = 'AL_PROBE_DEBUG_SPHERES';
      scene.add(vol.debugMesh);
    } else if (!vol.debugMesh.parent) {
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

          // Mirrored world position.
          dummyMatrix.makeTranslation(px, -py, pz);
          vol.debugMesh.setMatrixAt(i, dummyMatrix);

          var bufIdx = i * 4;
          dummyColor.setRGB(
            fromHalf(vol.dataDay[bufIdx]),
            fromHalf(vol.dataDay[bufIdx + 1]),
            fromHalf(vol.dataDay[bufIdx + 2])
          );
          vol.debugMesh.setColorAt(i, dummyColor);
        }
      }
    }

    vol.debugMesh.instanceMatrix.needsUpdate = true;
    if (vol.debugMesh.instanceColor) vol.debugMesh.instanceColor.needsUpdate = true;
    vol.debugDirty = false;
  }

  /* ============================================================= Probe Serialization === */

  // .lpg.bin layout: 32-byte header, 24-byte bounds, then RGBA16F day (and night) payloads.
  function exportBinary(vol) {
    if (!vol || !vol.dataDay) return null;
    var totalProbes = vol.resX * vol.resY * vol.resZ;
    var hasNight = !!(vol.dayNightMode && vol.dataNight);

    var payloadSizeDay = totalProbes * 4 * 2; // 2 bytes per half float
    var totalSize = 56 + payloadSizeDay + (hasNight ? payloadSizeDay : 0);

    var buffer = new ArrayBuffer(totalSize);
    var view = new DataView(buffer);

    // 0..3: magic 'LPG3'
    view.setUint8(0, 0x4c);
    view.setUint8(1, 0x50);
    view.setUint8(2, 0x47);
    view.setUint8(3, 0x33);

    view.setUint32(4, 1, true);           // version
    view.setUint32(8, vol.resX, true);
    view.setUint32(12, vol.resY, true);
    view.setUint32(16, vol.resZ, true);
    view.setUint8(20, 0);                 // encoding: 0 = RGBA16F
    view.setUint8(21, hasNight ? 1 : 0);  // flags: bit 0 = night volume present
    for (var r = 22; r < 32; r++) view.setUint8(r, 0);

    // 32..55: bounds, float32, unmirrored GDevelop coordinates
    view.setFloat32(32, vol.minX, true);
    view.setFloat32(36, vol.minY, true);
    view.setFloat32(40, vol.minZ, true);
    view.setFloat32(44, vol.maxX, true);
    view.setFloat32(48, vol.maxY, true);
    view.setFloat32(52, vol.maxZ, true);

    new Uint16Array(buffer, 56, totalProbes * 4).set(vol.dataDay);
    if (hasNight) {
      new Uint16Array(buffer, 56 + payloadSizeDay, totalProbes * 4).set(vol.dataNight);
    }

    return buffer;
  }

  function loadBinary(runtimeScene, arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 56) return false;
    var view = new DataView(arrayBuffer);

    if (view.getUint8(0) !== 0x4c || view.getUint8(1) !== 0x50 ||
        view.getUint8(2) !== 0x47 || view.getUint8(3) !== 0x33) {
      warnOnce('badMagic', 'Failed to load probe data: invalid LPG3 header.');
      return false;
    }

    var version = view.getUint32(4, true);
    if (version !== 1) {
      warnOnce('badVersion', 'Probe file version ' + version + ' is not supported (expected 1).');
      return false;
    }

    var encoding = view.getUint8(20);
    if (encoding !== 0) {
      warnOnce('badEncoding', 'Probe file encoding ' + encoding +
        ' is not supported (expected 0 = RGBA16F).');
      return false;
    }

    var rx = view.getUint32(8, true);
    var ry = view.getUint32(12, true);
    var rz = view.getUint32(16, true);
    if (rx < 2 || ry < 2 || rz < 2 || rx > 64 || ry > 64 || rz > 64) {
      warnOnce('badRes', 'Probe file resolution ' + rx + 'x' + ry + 'x' + rz +
        ' is outside the supported range [2, 64] per axis.');
      return false;
    }

    var flags = view.getUint8(21);
    var hasNight = (flags & 1) !== 0;

    // Without this the Uint16Array views below throw a RangeError on a truncated file.
    var expectedBytes = 56 + rx * ry * rz * 4 * 2 * (hasNight ? 2 : 1);
    if (arrayBuffer.byteLength < expectedBytes) {
      warnOnce('shortFile', 'Probe file is truncated: expected at least ' + expectedBytes +
        ' bytes for a ' + rx + 'x' + ry + 'x' + rz + ' volume, got ' + arrayBuffer.byteLength + '.');
      return false;
    }

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
      warnOnce('loadNoVol', 'No active LightProbeVolume3D to apply loaded probe data to.');
      return false;
    }

    // The file's bounds are the ones its data was baked against. Warn if the authoring
    // cube disagrees, then take the file's and stop syncing from the cube — otherwise
    // doStepPreEvents would overwrite them on the very next frame and the data would be
    // sampled against the wrong volume.
    var boundsDiffer =
      Math.abs(vol.minX - minX) > 1 || Math.abs(vol.minY - minY) > 1 || Math.abs(vol.minZ - minZ) > 1 ||
      Math.abs(vol.maxX - maxX) > 1 || Math.abs(vol.maxY - maxY) > 1 || Math.abs(vol.maxZ - maxZ) > 1;
    if (boundsDiffer) {
      warnOnce('boundsMismatch',
        'Loaded probe data was baked for different bounds than the current volume cube. ' +
        'Using the file\'s bounds; the cube no longer controls this volume.');
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
    vol.boundsLocked = true;
    vol.isBaked = true;
    vol.gradientDirty = false;
    vol.debugDirty = true;

    vol.threeMin.set(minX, -maxY, minZ);
    vol.threeSize.set(maxX - minX, maxY - minY, maxZ - minZ);

    vol.dataDay = new Uint16Array(new Uint16Array(arrayBuffer, 56, totalProbes * 4));
    if (vol.textureDay) vol.textureDay.dispose();
    vol.textureDay = makeData3DTexture(vol.dataDay, rx, ry, rz);

    if (hasNight) {
      vol.dayNightMode = true;
      var offsetNight = 56 + totalProbes * 4 * 2;
      vol.dataNight = new Uint16Array(new Uint16Array(arrayBuffer, offsetNight, totalProbes * 4));
      if (vol.textureNight) vol.textureNight.dispose();
      vol.textureNight = makeData3DTexture(vol.dataNight, rx, ry, rz);
      vol.nightDirty = false;
    }

    if (vol.debugMesh && vol.showDebugSpheres) updateProbeDebugMesh(runtimeScene, vol);
    return true;
  }

  /* ============================================================= SDF Volume & Baking == */

  function registerSDFVolume(runtimeScene, object, behavior, options) {
    if (!THREE_OK) return null;
    options = options || {};
    if (!isWebGL2Available(runtimeScene)) {
      warnOnce('noWebGL2SDF', 'WebGL2 is not supported on this context. SDF Shadows are disabled.');
      return null;
    }

    var state = stateOf(runtimeScene);
    var vol = behavior.__alSdfVolume;
    if (!vol) {
      vol = behavior.__alSdfVolume = {
        object: object,
        behavior: behavior,
        resX: clamp(Math.floor(options.resX || 128), 8, 256),
        resY: clamp(Math.floor(options.resY || 128), 8, 256),
        resZ: clamp(Math.floor(options.resZ || 32), 4, 128),
        voxelSize: 15.625,
        autoBakeOnStart: !!options.autoBakeOnStart,
        bakedOnce: false,
        isBaked: false,
        boundsLocked: false,

        minX: 0, minY: 0, minZ: 0,
        maxX: 2000, maxY: 2000, maxZ: 500,

        threeMin: new THREE.Vector3(0, -2000, 0),
        threeSize: new THREE.Vector3(2000, 2000, 500),

        data: null,
        texture: null
      };
    }

    state.sdfVolume = vol;

    updateSDFVolumeProperties(vol, options);
    syncSDFVolumeBoundsFromObject(vol, object);
    ensureSDFTextures(vol);
    hideVolumeCube(object);

    if (vol.autoBakeOnStart && !vol.bakedOnce && !state.sdfBakeState && !state.isSdfBakeComplete) {
      vol.bakedOnce = true;
      startSDFBake(runtimeScene);
    }

    return vol;
  }

  function updateSDFVolumeProperties(vol, options) {
    if (!vol || !options) return;
    if (options.resX !== undefined) vol.resX = clamp(Math.floor(options.resX), 8, 256);
    if (options.resY !== undefined) vol.resY = clamp(Math.floor(options.resY), 8, 256);
    if (options.resZ !== undefined) vol.resZ = clamp(Math.floor(options.resZ), 4, 128);
    if (options.autoBakeOnStart !== undefined) vol.autoBakeOnStart = !!options.autoBakeOnStart;
  }

  function syncSDFVolumeBoundsFromObject(vol, object) {
    if (!vol || !object || vol.boundsLocked) return;
    if (typeof object.getZ !== 'function' || typeof object.getDepth !== 'function') {
      warnOnce('sdfVolumeNot3D',
        'SDFVolume3D is attached to an object with no Z/depth (not a 3D object). ' +
        'Attach it to a Cube3D, or set bounds explicitly with SetSDFVolumeBounds.');
      return;
    }
    var x = object.getX ? object.getX() : 0;
    var y = object.getY ? object.getY() : 0;
    var z = object.getZ ? object.getZ() : 0;
    var w = object.getWidth ? object.getWidth() : 2000;
    var h = object.getHeight ? object.getHeight() : 2000;
    var d = object.getDepth ? object.getDepth() : 500;

    vol.minX = x;
    vol.minY = y;
    vol.minZ = z;
    vol.maxX = x + Math.max(1, w);
    vol.maxY = y + Math.max(1, h);
    vol.maxZ = z + Math.max(1, d);

    vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
    vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
    vol.voxelSize = Math.min((vol.maxX - vol.minX) / vol.resX, (vol.maxY - vol.minY) / vol.resY, (vol.maxZ - vol.minZ) / vol.resZ);
  }

  function ensureSDFTextures(vol) {
    if (!vol) return;
    var totalVoxels = vol.resX * vol.resY * vol.resZ;
    if (!vol.data || vol.data.length !== totalVoxels || !vol.texture || vol.texture.image.width !== vol.resX || vol.texture.image.height !== vol.resY || vol.texture.image.depth !== vol.resZ) {
      vol.data = new Uint16Array(totalVoxels);
      var farHalf = toHalf(65504);
      for (var i = 0; i < totalVoxels; i++) {
        vol.data[i] = farHalf;
      }
      if (vol.texture) vol.texture.dispose();
      vol.texture = makeSDFData3DTexture(vol.data, vol.resX, vol.resY, vol.resZ);
      vol.isBaked = false;
    }
    vol.voxelSize = Math.min((vol.maxX - vol.minX) / vol.resX, (vol.maxY - vol.minY) / vol.resY, (vol.maxZ - vol.minZ) / vol.resZ);
  }

  function disposeSDFVolume(runtimeScene, behavior) {
    var vol = behavior && behavior.__alSdfVolume;
    if (!vol) return;
    var state = scenes.get(runtimeScene);
    if (state && state.sdfVolume === vol) {
      cancelSDFBake(runtimeScene);
      state.isSdfBakeComplete = false;
      state.sdfVolume = null;
    }
    if (vol.texture) { vol.texture.dispose(); vol.texture = null; }
    vol.data = null;
    behavior.__alSdfVolume = null;
  }

  function extractTrianglesFromMeshes(meshes) {
    var triangles = [];
    if (!meshes || !meshes.length) return triangles;
    var vA = THREE_OK ? new THREE.Vector3() : null;
    var vB = THREE_OK ? new THREE.Vector3() : null;
    var vC = THREE_OK ? new THREE.Vector3() : null;

    for (var m = 0; m < meshes.length; m++) {
      var mesh = meshes[m];
      var geom = mesh.geometry;
      if (!geom) continue;
      var matWorld = mesh.matrixWorld || (THREE_OK ? new THREE.Matrix4() : null);

      if (geom.attributes && geom.attributes.position) {
        var pos = geom.attributes.position;
        var index = geom.index;
        if (index) {
          for (var i = 0; i < index.count; i += 3) {
            var ia = index.getX(i);
            var ib = index.getX(i + 1);
            var ic = index.getX(i + 2);
            if (vA && matWorld) {
              vA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(matWorld);
              vB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(matWorld);
              vC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(matWorld);
              triangles.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
            }
          }
        } else {
          for (var i = 0; i < pos.count; i += 3) {
            if (vA && matWorld) {
              vA.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matWorld);
              vB.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)).applyMatrix4(matWorld);
              vC.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)).applyMatrix4(matWorld);
              triangles.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
            }
          }
        }
      }
    }
    return triangles;
  }

  function startSDFBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    var vol = state.sdfVolume;
    if (!vol) {
      warnOnce('sdfBakeNoVol', 'Cannot bake: no active SDFVolume3D in this scene.');
      return false;
    }
    if (state.sdfBakeState && state.sdfBakeState.inProgress) {
      return false;
    }

    var meshes = collectBakeGeometry(runtimeScene, layerNameOf(vol.object));
    var triangles = extractTrianglesFromMeshes(meshes);
    var totalVoxels = vol.resX * vol.resY * vol.resZ;

    var grid = new Float32Array(totalVoxels);
    grid.fill(1e20);

    state.sdfBakeState = {
      inProgress: true,
      phase: 0,
      triangleIndex: 0,
      totalTriangles: Math.floor(triangles.length / 9),
      triangles: triangles,
      grid: grid,
      signature: [vol.resX,vol.resY,vol.resZ,vol.minX,vol.minY,vol.minZ,vol.maxX,vol.maxY,vol.maxZ].join(),
      vol: vol
    };

    console.log('[AdvancedLighting3D] Baking SDF ' + vol.resX + 'x' + vol.resY + 'x' + vol.resZ +
      ' (' + totalVoxels.toLocaleString() + ' voxels) against ' +
      state.sdfBakeState.totalTriangles + ' triangles. Poll SDFBakeProgress() for progress.');
    state.isSdfBakeComplete = false;
    return true;
  }

  function cancelSDFBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (state.sdfBakeState) {
      state.sdfBakeState.inProgress = false;
      state.sdfBakeState = null;
    }
  }

  function stepSDFBake(runtimeScene) {
    var state = stateOf(runtimeScene);
    var bs = state.sdfBakeState;
    if (!bs || !bs.inProgress) return;

    var vol = bs.vol || state.sdfVolume;
    if (!vol || vol !== state.sdfVolume || bs.signature !== [vol.resX,vol.resY,vol.resZ,vol.minX,vol.minY,vol.minZ,vol.maxX,vol.maxY,vol.maxZ].join()) {
      cancelSDFBake(runtimeScene);
      state.isSdfBakeComplete = false;
      return;
    }

    var start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var budget = state.sdfBakeBudgetMs || 8.0;

    var resX = vol.resX;
    var resY = vol.resY;
    var resZ = vol.resZ;
    var voxelSizeX = vol.threeSize.x / resX;
    var voxelSizeY = vol.threeSize.y / resY;
    var voxelSizeZ = vol.threeSize.z / resZ;

    var grid = bs.grid;
    var tris = bs.triangles;
    var numTris = bs.totalTriangles;

    // Phase 0: Seeding narrow band around triangles
    if (bs.phase === 0) {
      while (bs.triangleIndex < numTris) {
        var t = bs.triangleIndex;
        var tIdx = t * 9;
        var ax = tris[tIdx + 0], ay = tris[tIdx + 1], az = tris[tIdx + 2];
        var bx = tris[tIdx + 3], by = tris[tIdx + 4], bz = tris[tIdx + 5];
        var cx = tris[tIdx + 6], cy = tris[tIdx + 7], cz = tris[tIdx + 8];

        var minTx = Math.min(ax, bx, cx);
        var maxTx = Math.max(ax, bx, cx);
        var minTy = Math.min(ay, by, cy);
        var maxTy = Math.max(ay, by, cy);
        var minTz = Math.min(az, bz, cz);
        var maxTz = Math.max(az, bz, cz);

        var padX = 2.0 * voxelSizeX;
        var padY = 2.0 * voxelSizeY;
        var padZ = 2.0 * voxelSizeZ;

        var iMin = clamp(Math.floor((minTx - padX - vol.threeMin.x) / voxelSizeX), 0, resX - 1);
        var iMax = clamp(Math.ceil((maxTx + padX - vol.threeMin.x) / voxelSizeX), 0, resX - 1);
        var jMin = clamp(Math.floor((minTy - padY - vol.threeMin.y) / voxelSizeY), 0, resY - 1);
        var jMax = clamp(Math.ceil((maxTy + padY - vol.threeMin.y) / voxelSizeY), 0, resY - 1);
        var kMin = clamp(Math.floor((minTz - padZ - vol.threeMin.z) / voxelSizeZ), 0, resZ - 1);
        var kMax = clamp(Math.ceil((maxTz + padZ - vol.threeMin.z) / voxelSizeZ), 0, resZ - 1);

        var nx = iMax - iMin + 1, ny = jMax - jMin + 1;
        var cells = nx * ny * (kMax - kMin + 1);
        while ((bs.seedIndex || 0) < cells) {
          var seed = bs.seedIndex || 0;
          var i = iMin + seed % nx;
          var j = jMin + Math.floor(seed / nx) % ny;
          var k = kMin + Math.floor(seed / (nx * ny));
          var px = vol.threeMin.x + (i + 0.5) * voxelSizeX;
          var py = vol.threeMin.y + (j + 0.5) * voxelSizeY;
          var pz = vol.threeMin.z + (k + 0.5) * voxelSizeZ;
          var d2 = closestPointOnTriangleSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          var gIdx = (k * resY + j) * resX + i;
          if (d2 < grid[gIdx]) grid[gIdx] = d2;
          bs.seedIndex = seed + 1;
          if ((bs.seedIndex & 255) === 0 && performance.now() - start >= budget) return;
        }
        bs.seedIndex = 0;

        bs.triangleIndex++;

        if ((bs.triangleIndex & 7) === 0) {
          var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          if (now - start >= budget) return;
        }
      }

      bs.phase = 1;
      var nowAfterPhase0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (nowAfterPhase0 - start >= budget) return;
    }

    // Phase 1: Separable 3D EDT
    if (bs.phase === 1) {
      if (!bs.edt) {
        var size = Math.max(resX, resY, resZ);
        bs.edt = { axis: 0, line: 0, f: new Float32Array(size), d: new Float32Array(size), v: new Int32Array(size), z: new Float32Array(size + 1) };
      }
      var edt = bs.edt;
      while (edt.axis < 3) {
        var n = [resX, resY, resZ][edt.axis];
        var lineCount = resX * resY * resZ / n;
        var spacing = [voxelSizeX, voxelSizeY, voxelSizeZ][edt.axis];
        while (edt.line < lineCount) {
          var base, stride;
          if (edt.axis === 0) { base = edt.line * resX; stride = 1; }
          else if (edt.axis === 1) { base = Math.floor(edt.line / resX) * resX * resY + edt.line % resX; stride = resX; }
          else { base = edt.line; stride = resX * resY; }
          for (var q = 0; q < n; q++) edt.f[q] = grid[base + q * stride];
          felzenszwalb1D(edt.f, edt.d, edt.v, edt.z, n, spacing * spacing);
          for (var q = 0; q < n; q++) grid[base + q * stride] = edt.axis === 2 ? Math.sqrt(Math.max(0, edt.d[q])) : edt.d[q];
          edt.line++;
          if (performance.now() - start >= budget) return;
        }
        edt.axis++; edt.line = 0;
      }
      bs.phase = 2;
      var nowAfterPhase1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (nowAfterPhase1 - start >= budget) return;
    }

    // Phase 2: Convert grid to half-float texture
    if (bs.phase === 2) {
      var totalVoxels = resX * resY * resZ;
      var buffer = bs.output || (bs.output = new Uint16Array(totalVoxels));
      for (var idx = bs.outputIndex || 0; idx < totalVoxels; idx++) {
        buffer[idx] = toHalf(Math.min(65504, Math.max(0, grid[idx] - 0.5 * Math.sqrt(voxelSizeX * voxelSizeX + voxelSizeY * voxelSizeY + voxelSizeZ * voxelSizeZ))));
        bs.outputIndex = idx + 1;
        if ((idx & 255) === 0 && performance.now() - start >= budget) return;
      }
      vol.data = buffer;
      if (vol.texture) vol.texture.dispose();
      vol.texture = makeSDFData3DTexture(vol.data, resX, resY, resZ);
      vol.isBaked = true;

      bs.inProgress = false;
      state.sdfBakeState = null;
      state.isSdfBakeComplete = true;
    }
  }

  function getSDFBakeProgress(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (!state.sdfBakeState || !state.sdfBakeState.inProgress) {
      return state.isSdfBakeComplete ? 1.0 : 0.0;
    }
    var bs = state.sdfBakeState;
    if (bs.phase === 0) {
      return bs.totalTriangles > 0 ? (bs.triangleIndex / bs.totalTriangles) * 0.6 : 0.6;
    } else if (bs.phase === 1) {
      var vol = bs.vol || state.sdfVolume;
      if (!vol || !bs.edt) return 0.6;
      var lineCounts = [vol.resY * vol.resZ, vol.resX * vol.resZ, vol.resX * vol.resY];
      var completedLines = bs.edt.line;
      for (var axis = 0; axis < bs.edt.axis; axis++) completedLines += lineCounts[axis];
      var totalLines = lineCounts[0] + lineCounts[1] + lineCounts[2];
      return 0.6 + 0.3 * (totalLines ? completedLines / totalLines : 1.0);
    } else {
      var vol = bs.vol || state.sdfVolume;
      var totalVoxels = vol ? vol.resX * vol.resY * vol.resZ : 0;
      return 0.9 + 0.1 * (totalVoxels ? (bs.outputIndex || 0) / totalVoxels : 1.0);
    }
  }

  // .sdf.bin layout: 56-byte header & bounds, then R16F distance payload.
  function exportSDFBinary(vol) {
    if (!vol || !vol.data) return null;
    var totalVoxels = vol.resX * vol.resY * vol.resZ;
    var payloadSize = totalVoxels * 2; // 2 bytes per half float
    var totalSize = 56 + payloadSize;

    var buffer = new ArrayBuffer(totalSize);
    var view = new DataView(buffer);

    // 0..3: magic 'SDF3'
    view.setUint8(0, 0x53);
    view.setUint8(1, 0x44);
    view.setUint8(2, 0x46);
    view.setUint8(3, 0x33);

    view.setUint32(4, 1, true);           // version
    view.setUint32(8, vol.resX, true);
    view.setUint32(12, vol.resY, true);
    view.setUint32(16, vol.resZ, true);
    view.setUint8(20, 0);                 // encoding: 0 = R16F
    view.setUint8(21, 0);                 // flags
    for (var r = 22; r < 32; r++) view.setUint8(r, 0);

    // 32..55: bounds, float32, unmirrored GDevelop coordinates
    view.setFloat32(32, vol.minX, true);
    view.setFloat32(36, vol.minY, true);
    view.setFloat32(40, vol.minZ, true);
    view.setFloat32(44, vol.maxX, true);
    view.setFloat32(48, vol.maxY, true);
    view.setFloat32(52, vol.maxZ, true);

    new Uint16Array(buffer, 56, totalVoxels).set(vol.data);
    return buffer;
  }

  function loadSDFBinary(runtimeScene, arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 56) return false;
    var view = new DataView(arrayBuffer);

    if (view.getUint8(0) !== 0x53 || view.getUint8(1) !== 0x44 ||
        view.getUint8(2) !== 0x46 || view.getUint8(3) !== 0x33) {
      warnOnce('badSDFMagic', 'Failed to load SDF data: invalid SDF3 header.');
      return false;
    }

    var version = view.getUint32(4, true);
    if (version !== 1) {
      warnOnce('badSDFVersion', 'SDF file version ' + version + ' is not supported (expected 1).');
      return false;
    }

    var encoding = view.getUint8(20);
    if (encoding !== 0) {
      warnOnce('badSDFEncoding', 'SDF file encoding ' + encoding + ' is not supported (expected 0 = R16F).');
      return false;
    }

    var rx = view.getUint32(8, true);
    var ry = view.getUint32(12, true);
    var rz = view.getUint32(16, true);
    if (rx < 2 || ry < 2 || rz < 2 || rx > 256 || ry > 256 || rz > 256) {
      warnOnce('badSDFRes', 'SDF file resolution ' + rx + 'x' + ry + 'x' + rz +
        ' is outside supported range [2, 256] per axis.');
      return false;
    }

    var expectedBytes = 56 + rx * ry * rz * 2;
    if (arrayBuffer.byteLength < expectedBytes) {
      warnOnce('shortSDFFile', 'SDF file is truncated: expected at least ' + expectedBytes +
        ' bytes for a ' + rx + 'x' + ry + 'x' + rz + ' volume, got ' + arrayBuffer.byteLength + '.');
      return false;
    }

    var minX = view.getFloat32(32, true);
    var minY = view.getFloat32(36, true);
    var minZ = view.getFloat32(40, true);
    var maxX = view.getFloat32(44, true);
    var maxY = view.getFloat32(48, true);
    var maxZ = view.getFloat32(52, true);

    if (![minX,minY,minZ,maxX,maxY,maxZ].every(Number.isFinite) || maxX <= minX || maxY <= minY || maxZ <= minZ) return false;
    var totalVoxels = rx * ry * rz;
    var payload = new Uint16Array(totalVoxels);
    for (var i=0;i<totalVoxels;i++) {
      var value = fromHalf(view.getUint16(56+i*2,true));
      if (Number.isNaN(value) || value < 0) return false;
      payload[i] = toHalf(Math.min(value,65504));
    }
    var state = stateOf(runtimeScene);
    var vol = state.sdfVolume;

    if (!vol) {
      warnOnce('loadNoSDFVol', 'No active SDFVolume3D to apply loaded SDF data to.');
      return false;
    }

    var boundsDiffer =
      Math.abs(vol.minX - minX) > 1 || Math.abs(vol.minY - minY) > 1 || Math.abs(vol.minZ - minZ) > 1 ||
      Math.abs(vol.maxX - maxX) > 1 || Math.abs(vol.maxY - maxY) > 1 || Math.abs(vol.maxZ - maxZ) > 1;
    if (boundsDiffer) {
      warnOnce('sdfBoundsMismatch',
        'Loaded SDF data was baked for different bounds than the current volume cube. ' +
        'Using file bounds; cube no longer controls this volume.');
    }

    cancelSDFBake(runtimeScene);
    state.isSdfBakeComplete = true;
    vol.resX = rx;
    vol.resY = ry;
    vol.resZ = rz;
    vol.minX = minX;
    vol.minY = minY;
    vol.minZ = minZ;
    vol.maxX = maxX;
    vol.maxY = maxY;
    vol.maxZ = maxZ;
    vol.boundsLocked = true;
    vol.isBaked = true;

    vol.threeMin.set(minX, -maxY, minZ);
    vol.threeSize.set(maxX - minX, maxY - minY, maxZ - minZ);
    vol.voxelSize = Math.min((maxX-minX)/rx,(maxY-minY)/ry,(maxZ-minZ)/rz);

    vol.data = payload;
    if (vol.texture) vol.texture.dispose();
    vol.texture = makeSDFData3DTexture(vol.data, rx, ry, rz);

    return true;
  }

  /* ============================================================= Per-frame Tick ======= */

  function doStepPostEvents(runtimeScene) {
    var state = scenes.get(runtimeScene);
    if (!state || !THREE_OK) return;

    // Probe and SDF work first: baking and the debug buffers are independent of the clustered
    // broadphase, and stepping the bakes here keeps them off the critical path of the
    // uniform sync below.
    if (state.bakeState && state.bakeState.inProgress) {
      stepBake(runtimeScene);
    }
    if (state.sdfBakeState && state.sdfBakeState.inProgress) {
      stepSDFBake(runtimeScene);
    }
    if (state.volume && state.volume.showDebugSpheres && state.volume.debugDirty) {
      updateProbeDebugMesh(runtimeScene, state.volume);
    }

    var startTime = performance.now();
    var camera = getActiveCamera(runtimeScene);
    if (!camera) return;

    // The in-game editor changes camera position immediately before this callback,
    // while Three normally refreshes matrixWorldInverse later in render(). Refresh it
    // here so CPU light packing and the shader use the same frame's camera transform.
    if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld(true);
    if (state.viewToWorldMatrix && typeof state.viewToWorldMatrix.copy === 'function' && camera.matrixWorld) {
      state.viewToWorldMatrix.copy(camera.matrixWorld);
    }

    updateCSM(runtimeScene, camera);
    updateClusterAABBs(state, camera);
    initTextures(state, runtimeScene);

    // Refresh variants when a bake completes, a volume disappears, or shadows toggle.
    state.hookedMaterials.forEach(function (mat) {
      injectShaderOnMaterial(mat, state, mat.__alInjection ? mat.__alInjection.receiver : null);
    });

    // Auto-discover scene materials. Receiver clones are already hooked, so they are
    // skipped here rather than double-injected.
    var threeScene = getThreeScene(runtimeScene);
    if (threeScene) {
      hookObjectMaterials(threeScene, state);
    }

    var viewMatrix = camera.matrixWorldInverse;
    var cameraNear = camera.near || 0.1;
    var cameraFar = camera.far || 1000.0;

    var aabbs = state.clusterAABBs;
    var Sz = state.clusterGridZ;
    var Sx = state.clusterGridX;
    var Sy = state.clusterGridY;
    var totalClusters = state.totalClusters;

    var clusterHeaders = state.clusterGridArray;
    clusterHeaders.fill(0); // [offset, count] per cluster

    var lightIndexList = state.lightIndexArray;
    var currentOffset = 0;

    var lightData = state.lightDataArray;
    lightData.fill(0);

    // One typed-array clear instead of 3,456 allocations.
    var binCounts = state.binCounts;
    var binData = state.binData;
    binCounts.fill(0);

    var lightIndex = 0;
    var maxLights = state.maxLights;

    // Projection constants for the screen-space tile bounds below. These match the ones
    // updateClusterAABBs built the AABBs from.
    var tanHalfFov = Math.tan(((camera.fov || 60) * Math.PI / 180.0) * 0.5);
    var aspect = camera.aspect || (16 / 9);
    var depthSlices = state.depthSlices;

    // 1. Process and transform active dynamic lights
    state.lights.forEach(function (light) {
      // Also repairs a Cube3D face material replaced by an in-editor object update.
      syncSpotDirectionFace(light);
      if (!light.active || light.currentIntensity <= 0.0001 || lightIndex >= maxLights) {
        light.isInFrustum = false;
        return;
      }

      var obj = light.object;
      var obj3d = obj.get3DRendererObject ? obj.get3DRendererObject() : null;

      if (obj3d && obj3d.getWorldPosition) {
        obj3d.getWorldPosition(light.worldPosition);
        if (obj3d.getWorldDirection) {
          obj3d.getWorldDirection(light.worldDirection);
        }
      } else {
        light.worldPosition.set(
          obj.getX ? obj.getX() : 0,
          obj.getY ? -obj.getY() : 0, // the 3D scene root is mirrored on Y
          obj.getZ ? obj.getZ() : 0
        );
      }

      light.viewPosition.copy(light.worldPosition).applyMatrix4(viewMatrix);
      var vx = light.viewPosition.x;
      var vy = light.viewPosition.y;
      var vz = light.viewPosition.z;
      var viewZ = -vz; // positive distance along the camera look vector
      light.viewDistance = viewZ / WORLD_UNITS_PER_METER; // ViewDistance() is documented in metres

      var radius = Math.max(0.001, light.radius) * WORLD_UNITS_PER_METER;
      var capsuleHalfLength = light.lightType === 'AreaCapsule'
        ? Math.max(0.0, light.capsuleLength) * 0.5 * WORLD_UNITS_PER_METER
        : 0.0;
      // A sphere around the light centre must enclose the full segment for conservative
      // CPU cluster culling. The shader still attenuates from the nearest segment point.
      var cullRadius = radius + capsuleHalfLength;

      if (viewZ + cullRadius < cameraNear || viewZ - cullRadius > cameraFar) {
        light.isInFrustum = false;
        return;
      }

      var linearColor;
      if (light.colorMode === 'Kelvin') {
        linearColor = kelvinToRGB(light.colorTemperature);
      } else {
        var baseCol = light.lightColor || [255, 180, 100];
        linearColor = [baseCol[0] / 255.0, baseCol[1] / 255.0, baseCol[2] / 255.0];
      }

      var r = linearColor[0] * light.emissiveBoost;
      var g = linearColor[1] * light.emissiveBoost;
      var b = linearColor[2] * light.emissiveBoost;
      var intensity = light.currentIntensity;

      var dirX = 0, dirY = 0, dirZ = -1, extraParam = 0, cosInner = 0;

      // Spot and AreaCapsule both need the object's orientation in view space. The capsule
      // used to be pinned to view-space X, so a neon tube pointed wherever the camera was
      // looking instead of wherever the object was.
      // Packed for every light, not just spots: a Point light carrying an IES profile needs
      // an orientation for the profile lobe just as much as a spot does.
      if (light.worldDirection) {
        light.viewDirection.copy(light.worldDirection).transformDirection(viewMatrix);
        dirX = light.viewDirection.x;
        dirY = light.viewDirection.y;
        dirZ = light.viewDirection.z;
      } else if (light.lightType === 'AreaCapsule') {
        dirX = 1.0; dirY = 0.0; dirZ = 0.0;
      }

      if (light.lightType === 'Spot') {
        extraParam = Math.max(0.001, Math.cos(light.spotOuterAngle * Math.PI / 180.0));
        // Inner must stay strictly wider in cosine terms than outer or the penumbra divides
        // by ~zero. An inner angle authored larger than the outer one is clamped, not honoured.
        cosInner = Math.cos(Math.min(light.spotInnerAngle, light.spotOuterAngle) * Math.PI / 180.0);
        cosInner = Math.max(cosInner, extraParam + 0.0001);
      } else if (light.lightType === 'AreaCapsule') {
        // * WORLD_UNITS_PER_METER for the same reason the radius is: the shader compares this
        // half-length against view-space positions, which are in world units.
        extraParam = 10.0 + capsuleHalfLength;
      }

      var iesId = IES_PROFILE_IDS[light.iesProfile] || 0;

      // 4 texels (16 floats) per light
      var baseFloatIdx = lightIndex * LIGHT_FLOATS;
      lightData[baseFloatIdx + 0] = vx;
      lightData[baseFloatIdx + 1] = vy;
      lightData[baseFloatIdx + 2] = vz;
      lightData[baseFloatIdx + 3] = radius;

      lightData[baseFloatIdx + 4] = r;
      lightData[baseFloatIdx + 5] = g;
      lightData[baseFloatIdx + 6] = b;
      lightData[baseFloatIdx + 7] = intensity;

      lightData[baseFloatIdx + 8] = dirX;
      lightData[baseFloatIdx + 9] = dirY;
      lightData[baseFloatIdx + 10] = dirZ;
      lightData[baseFloatIdx + 11] = extraParam;

      // shape.z packs the integer cast flag plus a fractional per-light normal bias.
      // Keep the fraction below 1 so floor(shape.z) remains an exact boolean decode.
      var shadowData = (light.castShadow ? 1.0 : 0.0) + clamp(Number(light.shadowBias) || 0.0, 0.0, 0.999);
      var srcRadius = light.sourceRadius !== undefined && light.sourceRadius > 0.0
        ? light.sourceRadius
        : (light.radius * 0.05 * WORLD_UNITS_PER_METER);

      lightData[baseFloatIdx + 12] = iesId;
      lightData[baseFloatIdx + 13] = cosInner;
      lightData[baseFloatIdx + 14] = shadowData;
      lightData[baseFloatIdx + 15] = srcRadius;

      // 2. Depth slice range [kMin, kMax]
      var minZDist = Math.max(cameraNear, viewZ - cullRadius);
      var maxZDist = Math.min(cameraFar, viewZ + cullRadius);

      var logNearFar = Math.log(cameraFar / cameraNear);
      var kMin = clamp(Math.floor((Math.log(minZDist / cameraNear) / logNearFar) * Sz), 0, Sz - 1);
      var kMax = clamp(Math.floor((Math.log(maxZDist / cameraNear) / logNearFar) * Sz), 0, Sz - 1);

      var r2 = cullRadius * cullRadius;
      var touchedAny = false;

      // 3. Arvo sphere-to-AABB, but only against the tiles the light's screen-space
      //    footprint actually covers. Sweeping all Sx*Sy tiles of every slice in range made
      //    the "cluster" broadphase a brute-force scan: one light spanning 23 of the 24
      //    depth slices cost 3,312 AABB tests whether it covered the screen or a corner of it.
      for (var k = kMin; k <= kMax; ++k) {
        // Use both planes of the slice. A far-plane-only projection can reject an
        // off-centre tile even though the light intersects its narrower near edge.
        var sliceNear = depthSlices[k];
        var sliceFar = depthSlices[k + 1];
        var yTopNear = sliceNear * tanHalfFov;
        var xRightNear = yTopNear * aspect;
        var yTop = sliceFar * tanHalfFov;
        var xRight = yTop * aspect;

        // Wholly outside this slice's cross-section: no tile in it can intersect.
        if (vx + cullRadius < -xRight || vx - cullRadius > xRight) continue;
        if (vy + cullRadius < -yTop || vy - cullRadius > yTop) continue;

        var tileWFar = (2.0 * xRight) / Sx;
        var tileHFar = (2.0 * yTop) / Sy;
        var tileWNear = (2.0 * xRightNear) / Sx;
        var tileHNear = (2.0 * yTopNear) / Sy;
        var iMinFar = Math.floor((vx - cullRadius + xRight) / tileWFar);
        var iMaxFar = Math.floor((vx + cullRadius + xRight) / tileWFar);
        var jMinFar = Math.floor((vy - cullRadius + yTop) / tileHFar);
        var jMaxFar = Math.floor((vy + cullRadius + yTop) / tileHFar);
        var iMinNear = Math.floor((vx - cullRadius + xRightNear) / tileWNear);
        var iMaxNear = Math.floor((vx + cullRadius + xRightNear) / tileWNear);
        var jMinNear = Math.floor((vy - cullRadius + yTopNear) / tileHNear);
        var jMaxNear = Math.floor((vy + cullRadius + yTopNear) / tileHNear);
        var iMin = clamp(Math.min(iMinNear, iMinFar), 0, Sx - 1);
        var iMax = clamp(Math.max(iMaxNear, iMaxFar), 0, Sx - 1);
        var jMin = clamp(Math.min(jMinNear, jMinFar), 0, Sy - 1);
        var jMax = clamp(Math.max(jMaxNear, jMaxFar), 0, Sy - 1);

        for (var j = jMin; j <= jMax; ++j) {
          for (var i = iMin; i <= iMax; ++i) {
            var cIdx = i + j * Sx + k * (Sx * Sy);
            var aabbOffset = cIdx * 6;

            var d2 = arvoDistanceSq(
              aabbs[aabbOffset + 0], aabbs[aabbOffset + 1], aabbs[aabbOffset + 2],
              aabbs[aabbOffset + 3], aabbs[aabbOffset + 4], aabbs[aabbOffset + 5],
              vx, vy, vz
            );

            if (d2 <= r2) {
              var slot = binCounts[cIdx];
              if (slot < MAX_LIGHTS_PER_CLUSTER) {
                binData[cIdx * MAX_LIGHTS_PER_CLUSTER + slot] = lightIndex;
                binCounts[cIdx] = slot + 1;
                touchedAny = true;
              }
            }
          }
        }
      }

      light.isInFrustum = touchedAny;
      lightIndex++;
    });

    state.activeLightCount = lightIndex;

    // 4. Flatten the bins into the index list
    var maxCount = 0;
    for (var cc = 0; cc < totalClusters; ++cc) {
      var count = binCounts[cc];
      if (count > maxCount) maxCount = count;

      clusterHeaders[cc * 2 + 0] = currentOffset; // .r = offset
      clusterHeaders[cc * 2 + 1] = count;         // .g = count

      var binBase = cc * MAX_LIGHTS_PER_CLUSTER;
      if (count > 1 && sdfEnabled(state) && state.sdfVolume && state.sdfVolume.isBaked && state.maxShadowedLights > 0) {
        var ao = cc * 6;
        var cx = (aabbs[ao] + aabbs[ao + 3]) * 0.5;
        var cy = (aabbs[ao + 1] + aabbs[ao + 4]) * 0.5;
        var cz = (aabbs[ao + 2] + aabbs[ao + 5]) * 0.5;
        binData.subarray(binBase, binBase + count).sort(function (a, b) {
          var ai = a * LIGHT_FLOATS, bi = b * LIGHT_FLOATS;
          var da = Math.pow(lightData[ai] - cx, 2) + Math.pow(lightData[ai + 1] - cy, 2) + Math.pow(lightData[ai + 2] - cz, 2);
          var db = Math.pow(lightData[bi] - cx, 2) + Math.pow(lightData[bi + 1] - cy, 2) + Math.pow(lightData[bi + 2] - cz, 2);
          return da - db || a - b;
        });
      }
      for (var bi = 0; bi < count; ++bi) {
        lightIndexList[currentOffset + bi] = binData[binBase + bi];
      }
      currentOffset += count;
    }

    state.maxLightsInCluster = maxCount;

    // 5. Upload
    if (state.lightDataTexture) state.lightDataTexture.needsUpdate = true;
    if (state.clusterGrid3DTexture) state.clusterGrid3DTexture.needsUpdate = true;
    if (state.clusterGrid2DTexture) state.clusterGrid2DTexture.needsUpdate = true;
    if (state.lightIndexTexture) state.lightIndexTexture.needsUpdate = true;

    // 6. Push the scene-wide uniforms onto every injected material. Probe uniforms are
    // per-receiver and are written by stepReceiver instead.
    var width = 1920, height = 1080;
    var renderer = threeRendererOf(runtimeScene);
    // getDrawingBufferSize, not getSize: gl_FragCoord is in drawing-buffer pixels, while
    // getSize returns CSS pixels. On any display with a devicePixelRatio above 1 the two
    // differ, and the cluster X/Y lookup clamps the far half of the screen into the last
    // column and row.
    if (renderer && renderer.getDrawingBufferSize && state._vecSize) {
      var sz = renderer.getDrawingBufferSize(state._vecSize);
      width = sz.x || 1920;
      height = sz.y || 1080;
    }

    state.hookedMaterials.forEach(function (mat) {
      var uniforms = mat.__alUniforms;
      if (!uniforms) return;
      if (uniforms.uResolution) uniforms.uResolution.value.set(width, height);
      if (uniforms.uClusterCameraNear) uniforms.uClusterCameraNear.value = cameraNear;
      if (uniforms.uClusterCameraFar) uniforms.uClusterCameraFar.value = cameraFar;
      if (uniforms.uGlobalClusteredIntensity) uniforms.uGlobalClusteredIntensity.value = state.globalIntensityScale;

      if (uniforms.uViewToWorld && state.viewToWorldMatrix && uniforms.uViewToWorld.value && typeof uniforms.uViewToWorld.value.copy === 'function') {
        uniforms.uViewToWorld.value.copy(state.viewToWorldMatrix);
      }
      if (uniforms.uMaxShadowedLights) uniforms.uMaxShadowedLights.value = state.maxShadowedLights;
      if (uniforms.uPointShadowDistance) uniforms.uPointShadowDistance.value = state.pointShadowDistance;
      if (uniforms.uSdfParams && state.sdfVolume) {
        var vx = state.sdfVolume.voxelSize || ((state.sdfVolume.maxX - state.sdfVolume.minX) / state.sdfVolume.resX);
        var sunK = 1.0 / Math.tan((state.sdfSunSoftness || 1.8) * Math.PI / 180.0);
        if (uniforms.uSdfParams.value && typeof uniforms.uSdfParams.value.set === 'function') {
          uniforms.uSdfParams.value.set(vx, state.sdfHitEps || 0.05, state.sdfNormalBias, sunK);
        }
      }
      if (uniforms.uSdfVolume && state.sdfVolume && state.sdfVolume.texture) {
        uniforms.uSdfVolume.value = state.sdfVolume.texture;
      }
      if (uniforms.uSdfMin && state.sdfVolume && uniforms.uSdfMin.value && typeof uniforms.uSdfMin.value.copy === 'function') {
        uniforms.uSdfMin.value.copy(state.sdfVolume.threeMin);
      }
      if (uniforms.uSdfSize && state.sdfVolume && uniforms.uSdfSize.value && typeof uniforms.uSdfSize.value.copy === 'function') {
        uniforms.uSdfSize.value.copy(state.sdfVolume.threeSize);
      }
    });

    state.cpuBroadphaseTimeMs = performance.now() - startTime;
  }

  // The scene editor drives its own loop: it calls _updateObjectsForInGameEditor, then the
  // gdjs.callbacksInGameEditorPostStep list, then render(). It never runs events, so neither
  // the scene's post-events callbacks nor any behavior's doStepPreEvents fire there. Without
  // this, no material is ever hooked in the editor and the lights are invisible while
  // authoring -- which is exactly when you need to see them.
  function doStepInGameEditor(inGameEditor) {
    if (!THREE_OK || !inGameEditor || typeof inGameEditor.getCurrentScene !== 'function') return;
    var runtimeScene = inGameEditor.getCurrentScene();
    if (!runtimeScene) return;

    var state = scenes.get(runtimeScene);
    if (!state) return;

    // Flicker and muzzle flashes are deliberately not animated here. Authoring against a
    // light that pulses is worse than authoring against a steady one, so the editor shows
    // each light at its configured intensity.
    state.lights.forEach(function (light) {
      if (light.flickerMode !== 'None' || light.muzzleFlashActive) {
        light.currentIntensity = light.intensity;
      }
    });

    doStepPostEvents(runtimeScene);
  }

  function cleanupScene(runtimeScene) {
    var state = scenes.get(runtimeScene);
    if (!state) return;
    disposeCSM(state);

    state.lights.forEach(function (light) {
      restoreSpotDirectionFace(light);
    });

    if (state.volume) {
      disposeVolume(runtimeScene, state.volume.behavior);
    }
    if (state.sdfVolume) {
      disposeSDFVolume(runtimeScene, state.sdfVolume.behavior);
    }
    state.receivers.forEach(function (rec) {
      disposeReceiver(runtimeScene, rec.behavior);
    });
    if (state.dummyProbeTexture) {
      state.dummyProbeTexture.dispose();
      state.dummyProbeTexture = null;
    }
    if (state.dummySdfTexture) {
      state.dummySdfTexture.dispose();
      state.dummySdfTexture = null;
    }
    if (state.lightDataTexture) state.lightDataTexture.dispose();
    if (state.clusterGrid3DTexture) state.clusterGrid3DTexture.dispose();
    if (state.clusterGrid2DTexture) state.clusterGrid2DTexture.dispose();
    if (state.lightIndexTexture) state.lightIndexTexture.dispose();
    state.hookedMaterials.forEach(function (mat) {
      if (mat.__alInjection && mat.__alInjection.owner === state) {
        mat.onBeforeCompile = function () {};
        mat.customProgramCacheKey = function () { return ''; };
        if (mat.defines) ['USE_CLUSTERED_LIGHTS','USE_PROBE_GRID','USE_3D_CLUSTER_TEXTURE','AL_SDF_SHADOWS','AL_LIGHT_INDEX_WIDTH','AL_LIGHT_TEXELS','AL_WORLD_UNITS_PER_METER'].forEach(function (key) { delete mat.defines[key]; });
        mat.__alInjection = null; mat.__alUniforms = null;
        if (mat.dispose) mat.dispose();
        mat.needsUpdate = true;
      }
    });
    state.hookedMaterials.clear();
    scenes.delete(runtimeScene);
  }

  /* ============================================================= Public API =========== */

  var AdvancedLighting = {
    __runtimeVersion: RUNTIME_VERSION,
    __unregisterRuntimeCallbacks: function () {
      if (typeof gdjs._unregisterCallback === 'function') {
        gdjs._unregisterCallback(doStepPostEvents);
        gdjs._unregisterCallback(doStepInGameEditor);
        gdjs._unregisterCallback(cleanupScene);
      }
      Array.from(scenes.keys()).forEach(cleanupScene);
      if (spotDirectionMaterial) spotDirectionMaterial.dispose();
      if (spotDirectionTexture) spotDirectionTexture.dispose();
      if (spotDirectionGeometry) spotDirectionGeometry.dispose();
      spotDirectionMaterial = null;
      spotDirectionTexture = null;
      spotDirectionGeometry = null;
    },

    setShadowMode: setShadowMode,
    configureCSM: configureCSM,
    registerShadowManager: registerShadowManager,
    destroyShadowManager: destroyShadowManager,
    shadowState: function (scene) { return shadowState(stateOf(scene)); },
    // Math & helpers
    kelvinToRGB: kelvinToRGB,
    parseColor: parseColor,
    arvoDistanceSq: arvoDistanceSq,
    evaluateFlicker: evaluateFlicker,
    toHalf: toHalf,
    fromHalf: fromHalf,

    // Scene & manager
    registerSceneManager: registerSceneManager,
    updateSceneManager: updateSceneManager,
    stateOf: stateOf,
    isWebGL2Available: isWebGL2Available,
    isSupported: function (runtimeScene) {
      return isWebGL2Available(runtimeScene);
    },
    doStepPostEvents: doStepPostEvents,
    doStepInGameEditor: doStepInGameEditor,
    hookObjectMaterials: hookObjectMaterials,
    toggleDebugVisualizer: toggleClusterDebugVisualizer,

    // Lightflickereffects companion behavior
    registerLightTweens: registerLightTweens,
    stepLightTweens: stepLightTweens,
    destroyLightTweens: destroyLightTweens,
    registerLightflickereffects: registerLightflickereffects,
    stepLightflickereffects: stepLightflickereffects,
    destroyLightflickereffects: destroyLightflickereffects,
    startLightTween: startLightTween,
    stopLightTween: stopLightTween,
    setLightTweenFlicker: setLightTweenFlicker,
    resolveTweenLight: resolveTweenLight,

    // Clustered lights
    registerLight: registerLight,
    updateLight: updateLight,
    destroyLight: destroyLight,
    stepLight: stepLight,
    triggerMuzzleFlash: triggerMuzzleFlash,

    setGlobalIntensity: function (scene, val) {
      stateOf(scene).globalIntensityScale = Math.max(0.0, val);
    },
    setVolumetricFogDensity: function (scene, val) {
      stateOf(scene).volumetricFogDensity = Math.max(0.0, val);
    },
    setVolumetricAnisotropy: function (scene, val) {
      stateOf(scene).volumetricAnisotropy = clamp(val, 0.0, 0.9);
    },
    setVolumetricFogEnabled: function (scene, enable) {
      stateOf(scene).enableVolumetricFog = !!enable;
    },
    setMaxLights: function (scene, count) {
      applyMaxLights(stateOf(scene), count);
    },

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
    getTotalClusterCount: function () {
      return TOTAL_CLUSTERS;
    },
    getClusterVRAMBytes: function (scene) {
      var s = scenes.get(scene);
      if (!s) return 0;
      var lightBytes = s.maxLights * LIGHT_FLOATS * 4;             // Float32 RGBA32F
      var gridBytes = TOTAL_CLUSTERS * 2 * 4;                      // Uint32 RG32UI
      var indexBytes = LIGHT_INDEX_TEX_WIDTH * LIGHT_INDEX_TEX_HEIGHT * 2; // Uint16 R16UI
      return lightBytes + gridBytes + indexBytes;
    },

    /* ---- Probe volume ---- */
    registerVolume: registerVolume,
    updateVolume: function (runtimeScene, object, behavior, options) {
      var vol = behavior && behavior.__alProbeVolume;
      if (!vol) return registerVolume(runtimeScene, object, behavior, options);
      updateVolumeProperties(vol, options);
      syncVolumeBoundsFromObject(vol, object);
      ensureVolumeTextures(vol);
      return vol;
    },
    disposeVolume: disposeVolume,
    volumeOf: function (behavior) {
      return behavior ? behavior.__alProbeVolume : null;
    },

    /* ---- Probe receivers ---- */
    registerReceiver: registerReceiver,
    stepReceiver: stepReceiver,
    disposeReceiver: disposeReceiver,
    receiverOf: function (behavior) {
      return behavior ? behavior.__alProbeReceiver : null;
    },

    /* ---- Probe scene controls ---- */
    setProbeBounds: function (runtimeScene, minX, minY, minZ, maxX, maxY, maxZ) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol) return;
      vol.minX = minX;
      vol.minY = minY;
      vol.minZ = minZ;
      vol.maxX = Math.max(minX + 1, maxX);
      vol.maxY = Math.max(minY + 1, maxY);
      vol.maxZ = Math.max(minZ + 1, maxZ);
      // Explicit bounds win over the authoring cube from here on.
      vol.boundsLocked = true;
      vol.debugDirty = true;
      vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
      vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
    },
    setDayNightBlend: function (runtimeScene, factor) {
      stateOf(runtimeScene).dayNightBlend = clamp(factor, 0.0, 1.0);
    },
    getDayNightBlend: function (runtimeScene) {
      return stateOf(runtimeScene).dayNightBlend;
    },
    setProbeGlobalIntensity: function (runtimeScene, intensity) {
      stateOf(runtimeScene).probeGlobalIntensity = Math.max(0.0, intensity);
    },

    /* ---- Baking ---- */
    startBake: startBake,
    cancelBake: cancelBake,
    setBakeBudgetMs: function (runtimeScene, ms) {
      stateOf(runtimeScene).bakeBudgetMs = Math.max(1.0, ms);
    },
    isBakeInProgress: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.bakeState && state.bakeState.inProgress);
    },
    isBakeComplete: function (runtimeScene) {
      return !!stateOf(runtimeScene).isBakeComplete;
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

    /* ---- Probe metrics ---- */
    getActiveProbeCount: function (runtimeScene) {
      var vol = stateOf(runtimeScene).volume;
      return vol ? (vol.resX * vol.resY * vol.resZ) : 0;
    },
    getProbeSpacingX: function (runtimeScene) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol || vol.resX <= 1) return 0;
      return (vol.maxX - vol.minX) / (vol.resX - 1);
    },
    getProbeSpacingY: function (runtimeScene) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol || vol.resY <= 1) return 0;
      return (vol.maxY - vol.minY) / (vol.resY - 1);
    },
    getProbeSpacingZ: function (runtimeScene) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol || vol.resZ <= 1) return 0;
      return (vol.maxZ - vol.minZ) / (vol.resZ - 1);
    },
    getProbeVRAMBytes: function (runtimeScene) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol) return 0;
      var dayBytes = vol.resX * vol.resY * vol.resZ * 4 * 2; // RGBA16F = 8 bytes per probe
      return dayBytes + ((vol.dayNightMode && vol.textureNight) ? dayBytes : 0);
    },
    toggleProbeDebugVisualizer: function (runtimeScene, enable) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol) return;
      vol.showDebugSpheres = !!enable;
      vol.debugDirty = true;
      updateProbeDebugMesh(runtimeScene, vol);
    },
    isProbeVolumeLoaded: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.volume && state.volume.textureDay);
    },
    isDayNightModeEnabled: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.volume && state.volume.dayNightMode);
    },

    /* ---- Probe file IO ---- */
    exportProbeData: function (runtimeScene, fileName) {
      var vol = stateOf(runtimeScene).volume;
      if (!vol) return false;
      var buffer = exportBinary(vol);
      if (!buffer) return false;

      var name = fileName || 'probes.lpg.bin';
      if (name.slice(-8) !== '.lpg.bin') name += '.lpg.bin';

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
    // Synchronous counterpart to loadProbeDataFromFile, for callers that already hold the
    // bytes. Returns true only if the file validated and was applied.
    loadProbeDataFromBuffer: function (runtimeScene, arrayBuffer) {
      return loadBinary(runtimeScene, arrayBuffer);
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
    },

    /* ---- SDF Volume & Shadows ---- */
    registerSDFVolume: registerSDFVolume,
    updateSDFVolume: function (runtimeScene, object, behavior, options) {
      var vol = behavior && behavior.__alSdfVolume;
      if (!vol) return registerSDFVolume(runtimeScene, object, behavior, options);
      updateSDFVolumeProperties(vol, options);
      syncSDFVolumeBoundsFromObject(vol, object);
      ensureSDFTextures(vol);
      return vol;
    },
    disposeSDFVolume: disposeSDFVolume,
    sdfVolumeOf: function (behavior) {
      return behavior ? behavior.__alSdfVolume : null;
    },
    setSDFVolumeBounds: function (runtimeScene, minX, minY, minZ, maxX, maxY, maxZ) {
      var vol = stateOf(runtimeScene).sdfVolume;
      if (!vol) return;
      vol.minX = minX;
      vol.minY = minY;
      vol.minZ = minZ;
      vol.maxX = Math.max(minX + 1, maxX);
      vol.maxY = Math.max(minY + 1, maxY);
      vol.maxZ = Math.max(minZ + 1, maxZ);
      vol.boundsLocked = true;
      vol.threeMin.set(vol.minX, -vol.maxY, vol.minZ);
      vol.threeSize.set(vol.maxX - vol.minX, vol.maxY - vol.minY, vol.maxZ - vol.minZ);
      vol.voxelSize = Math.min((vol.maxX - vol.minX) / vol.resX, (vol.maxY - vol.minY) / vol.resY, (vol.maxZ - vol.minZ) / vol.resZ);
    },
    isSDFShadowsEnabled: function (runtimeScene) {
      return !!sdfEnabled(stateOf(runtimeScene));
    },
    setMaxShadowedLights: function (runtimeScene, count) {
      stateOf(runtimeScene).maxShadowedLights = Math.max(0, Math.floor(count));
    },
    getMaxShadowedLights: function (runtimeScene) {
      return stateOf(runtimeScene).maxShadowedLights;
    },
    setPointShadowDistance: function (runtimeScene, dist) {
      stateOf(runtimeScene).pointShadowDistance = Math.max(0.0, dist);
    },
    getPointShadowDistance: function (runtimeScene) {
      return stateOf(runtimeScene).pointShadowDistance;
    },
    setSDFSunSoftness: function (runtimeScene, deg) {
      stateOf(runtimeScene).sdfSunSoftness = Math.max(0.1, deg);
    },
    getSDFSunSoftness: function (runtimeScene) {
      return stateOf(runtimeScene).sdfSunSoftness;
    },
    setSDFHitEps: function (runtimeScene, eps) {
      stateOf(runtimeScene).sdfHitEps = Math.max(0.001, eps);
    },
    setSDFNormalBias: function (runtimeScene, bias) {
      stateOf(runtimeScene).sdfNormalBias = Math.max(0.0, bias);
    },
    startSDFBake: startSDFBake,
    cancelSDFBake: cancelSDFBake,
    setSDFBakeBudgetMs: function (runtimeScene, ms) {
      stateOf(runtimeScene).sdfBakeBudgetMs = Math.max(1.0, ms);
    },
    isSDFBakeInProgress: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.sdfBakeState && state.sdfBakeState.inProgress);
    },
    isSDFBakeComplete: function (runtimeScene) {
      return !!stateOf(runtimeScene).isSdfBakeComplete;
    },
    getSDFBakeProgress: getSDFBakeProgress,
    getSDFVRAMBytes: function (runtimeScene) {
      var vol = stateOf(runtimeScene).sdfVolume;
      if (!vol) return 0;
      return vol.resX * vol.resY * vol.resZ * 2; // R16F = 2 bytes per voxel
    },
    getSDFVoxelCount: function (runtimeScene) {
      var vol = stateOf(runtimeScene).sdfVolume;
      return vol ? (vol.resX * vol.resY * vol.resZ) : 0;
    },
    getSDFVoxelSize: function (runtimeScene) {
      var vol = stateOf(runtimeScene).sdfVolume;
      return vol ? vol.voxelSize : 0;
    },
    isSDFVolumeLoaded: function (runtimeScene) {
      var state = stateOf(runtimeScene);
      return !!(state.sdfVolume && state.sdfVolume.texture);
    },
    exportSDFData: function (runtimeScene, fileName) {
      var vol = stateOf(runtimeScene).sdfVolume;
      if (!vol) return false;
      var buffer = exportSDFBinary(vol);
      if (!buffer) return false;

      var name = fileName || 'scene.sdf.bin';
      if (name.slice(-8) !== '.sdf.bin') name += '.sdf.bin';

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
    loadSDFDataFromBuffer: function (runtimeScene, arrayBuffer) {
      return loadSDFBinary(runtimeScene, arrayBuffer);
    },
    loadSDFDataFromFile: function (runtimeScene, filePath) {
      if (typeof fetch === 'undefined') return false;
      fetch(filePath)
        .then(function (res) { return res.arrayBuffer(); })
        .then(function (buf) { loadSDFBinary(runtimeScene, buf); })
        .catch(function (err) {
          warnOnce('fetchFail', 'Failed to load SDF file "' + filePath + '": ' + err);
        });
      return true;
    },

    // Internal seams for the unit test harness. Not part of the events API and not
    // referenced by any generated JsCode block.
    __internals: {
      updateCSM: updateCSM,
      disposeCSM: disposeCSM,
      practicalSplits: practicalSplits,
      csmShadowCode: csmShadowCode,
      collectBakeGeometry: collectBakeGeometry,
      injectShaderOnMaterial: injectShaderOnMaterial,
      syncSpotDirectionFace: syncSpotDirectionFace,
      generateAltitudeGradientBuffer: generateAltitudeGradientBuffer,
      exportBinary: exportBinary,
      GLSL_FRAGMENT_HOOK: GLSL_FRAGMENT_HOOK,
      GLSL_CLUSTER_PRELUDE: GLSL_CLUSTER_PRELUDE,
      GLSL_PROBE_PRELUDE: GLSL_PROBE_PRELUDE,
      GLSL_SDF_PRELUDE: GLSL_SDF_PRELUDE,
      SPHERE_RAYS: SPHERE_RAYS,
      closestPointOnTriangleSq: closestPointOnTriangleSq,
      felzenszwalb1D: felzenszwalb1D,
      run3DEDT: run3DEDT,
      extractTrianglesFromMeshes: extractTrianglesFromMeshes,
      exportSDFBinary: exportSDFBinary,
      loadSDFBinary: loadSDFBinary,
      makeSDFData3DTexture: makeSDFData3DTexture
    }
  };

  // One post-events callback drives both halves: the bake step, the probe debug buffers
  // and the clustered CPU broadphase.
  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(doStepPostEvents);
  }

  // Live update inside GDevelop's 3D scene editor. This callback list is separate from the
  // scene post-events one and is the only per-frame hook an extension gets while editing.
  if (typeof gdjs.registerInGameEditorPostStepCallback === 'function') {
    gdjs.registerInGameEditorPostStepCallback(doStepInGameEditor);
  }

  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(cleanupScene);
  }

  gdjs.__advancedLighting3D = AdvancedLighting;
})();
