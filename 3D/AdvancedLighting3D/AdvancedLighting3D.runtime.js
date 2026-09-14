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
  var RUNTIME_VERSION = '2026.09.13.5';
  // GDevelop r160 configures its Three.js renderer to use legacy light units. Reading
  // Three.js's deprecated legacy-lights renderer flag emits a throttled warning, so
  // preserve GDevelop's established brightness without touching that property.
  var GDEVELOP_LIGHT_INTENSITY_SCALE = Math.PI;
  // Per-light ShadowBias rides in the fractional part of shape.z, so its raw range is 0..0.999.
  // Dividing by this on pack and multiplying on decode gives an honest 0..10 voxel range, which is
  // what the property's own description implies. Changing it changes the shader decode too.
  var SHADOW_BIAS_ENCODE_SCALE = 10.0;
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
      mode: 'Auto', sunShadows: 'Cascades', count: 3, distance: 25000, lambda: 0.75, mapSize: 2048,
      bias: 0.0005, normalBias: 0.02, blend: 0.10, softness: 1.5,
      lights: [], cascades: [], depthMaterial: null, sun: null, savedSunShadow: null,
      renderer: null, rendererState: null, ready: false, manager: null, managers: [],
      splits: new Float32Array(4), ranges: [], matrices: [], maps: [], direction: null
    };
    return state.shadows;
  }

  // Three modes, and they are OWNERSHIP decisions, not techniques: Auto means this extension
  // shadows the scene and picks how, Native means GDevelop does, Off means nobody does. The old
  // CSM/SDF/Hybrid/Maps/MapsSDF enum tried to name every combination of two independent choices -
  // how the Sun is shadowed, and how local lights are - so those are now the two things they
  // always were: shadowState.sunShadows, and the per-light ShadowTechnique property.
  function sdfEnabled(state) {
    return shadowState(state).mode === 'Auto' &&
      (!state.textureUnitBudget || state.textureUnitBudget.sdf !== false);
  }

  // Real depth maps for clustered spot lights. Unlike the SDF these handle moving casters and need
  // no baked volume, at the cost of one depth render per shadowed light whenever its map is dirty.
  /**
   * Can this hardware actually afford the local shadow-map path?
   *
   * Texture image units are a HARD limit and overrunning them is not a soft failure: the fragment
   * shader refuses to link and the entire scene renders black, with an error that mentions
   * VALIDATE_STATUS rather than anything an author would recognise. WebGL2 guarantees only 16, and
   * plenty of real hardware reports exactly 16.
   *
   * A Native slot costs two units (Three's shadow entry plus our own sampler); an Owned spot slot
   * costs one. Cluster data, cascades, probes, SDF, contact depth and material maps all share that
   * pool, so the scene-wide allocator disables complete optional blocks instead of taking the
   * scene down.
   */
  function canAffordLocalMaps(state, runtimeScene) {
    refreshTextureUnitBudget(state, runtimeScene || state.runtimeScene);
    return state.__localMapsAffordable !== false;
  }

  function localMapsEnabled(state, runtimeScene) {
    if (shadowState(state).mode !== 'Auto') return false;
    // The scene manager refreshes this once before shadow work each frame. Shader injection can
    // visit hundreds of materials, so never rescan the whole scene from this hot-path accessor.
    if (!state.textureUnitBudget && (runtimeScene || state.runtimeScene)) {
      refreshTextureUnitBudget(state, runtimeScene || state.runtimeScene);
    }
    return !state.textureUnitBudget || state.textureUnitBudget.localMaps !== false;
  }

  function disposeCSM(state) {
    var c = shadowState(state);
    // c.lights is retained only to clean up cascade DirectionalLights left by an older runtime
    // after an editor hot-reload. Nothing creates them any more.
    c.lights.forEach(function (light) {
      if (light.shadow && light.shadow.map) light.shadow.map.dispose();
      if (light.shadow && light.shadow.mapPass) light.shadow.mapPass.dispose();
      if (light.parent) light.parent.remove(light);
      if (light.target && light.target.parent) light.target.parent.remove(light.target);
    });
    c.cascades.forEach(function (cascade) {
      if (cascade.target) { cascade.target.dispose(); cascade.target = null; }
      cascade.camera = null;
    });
    c.cascades.length = 0;
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

  /* ------------------------------------------------- Local shadow maps (spot lights) */
  //
  // A clustered spot light can own a real depth map instead of marching the SDF. Three's own
  // WebGLShadowMap does the rendering; this code only decides WHICH lights get a map, keeps a
  // zero-intensity native SpotLight in sync with each, and says WHEN a map is stale.
  //
  // The native light contributes no radiance - exactly as the CSM cascade lights do. The clustered
  // loop remains the only light source; the SpotLight exists solely to own a shadow map.

  var _lsTmpVec = null;
  function lsTmp() { if (!_lsTmpVec && THREE_OK) _lsTmpVec = new THREE.Vector3(); return _lsTmpVec; }

  function syncLightWorldTransform(light) {
    var obj = light && light.object;
    if (!obj || !THREE_OK) return;
    var obj3d = obj.get3DRendererObject ? obj.get3DRendererObject() : null;
    if (obj3d && obj3d.getWorldPosition) {
      obj3d.getWorldPosition(light.worldPosition);
      if (obj3d.getWorldDirection) obj3d.getWorldDirection(light.worldDirection);
      return;
    }
    light.worldPosition.set(
      obj.getX ? obj.getX() : 0,
      obj.getY ? -obj.getY() : 0,
      obj.getZ ? obj.getZ() : 0
    );
  }

  function localShadowState(state) {
    if (!state.localShadows) state.localShadows = {
      slots: [],                 // { light, ownerKey, renderedKey, age, live }
      maxLights: LOCAL_SHADOW_SLOTS,
      // 'Native' borrows Three's shadow pass via zero-intensity lights; 'Owned' renders the depth
      // maps here. Owned halves the texture-unit cost and removes the recompile hitch, but it is
      // newer, so it stays opt-in until it has been measured on real hardware.
      backend: 'Native',
      // 'PCF' compares one depth per tap and averages nine of them. 'VSM' stores the mean and
      // standard deviation of depth instead, which can be BLURRED - and a blurred depth comparison
      // is not a valid operation, which is the entire reason PCF has to tap nine times.
      filter: 'PCF',
      vsmBlurRadius: 4,
      vsmLightBleed: 0.15,
      vsmSamples: 8,
      vsmScratch: null,          // { size: WebGLRenderTarget }, built lazily
      vsmScene: null,
      vsmQuad: null,
      vsmCamera: null,
      vsmVertical: null,
      vsmHorizontal: null,
      depthMaterial: null,
      distanceMaterial: null,
      maxUpdatesPerFrame: 4,
      // Longest a barely-visible shadow may go without re-rendering, in frames. 1 disables the
      // throttle entirely and every dirty map re-renders as soon as the budget allows.
      maxUpdateInterval: 6,
      frame: 0,
      updatesThisFrame: 0,
      mappedCount: 0,
      renderer: null,
      rendererState: null,
      movers: []
    };
    return state.localShadows;
  }

  /**
   * Which filter this light's map actually uses.
   *
   * Point lights are excluded unconditionally, and not as a preference: their map is a 4x2 atlas
   * of six cube faces packed edge to edge, so a separable blur would drag depth across face
   * boundaries and produce seams along edges that do not exist in the scene. They also never reach
   * the Owned backend, which is what produces moments at all.
   */
  function filterForLight(ls, light) {
    if (!light || light.lightType === 'Point') return 'PCF';
    var want = light.shadowMapFilter || 'Auto';
    if (want === 'Auto') want = ls.filter;
    return want === 'VSM' ? 'VSM' : 'PCF';
  }

  // Identity of everything that invalidates a cached map on the LIGHT's side. A caster moving is
  // handled separately by collectMovedCasters/moverAffectsLight.
  function localShadowKeyOf(light) {
    var p = light.worldPosition, d = light.worldDirection;
    return [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2),
            d.x.toFixed(3), d.y.toFixed(3), d.z.toFixed(3),
            light.radius, light.spotOuterAngle, light.lightType,
            light.shadowMapSize || 1024, light.shadowMapFilter || 'Auto'].join(',');
  }

  // Meshes whose world matrix changed since the previous frame. Only these can dirty a cached map,
  // which is what lets a fully static scene do zero shadow work after the first frame.
  function collectMovedCasters(root, out) {
    out.length = 0;
    if (!root || !root.traverse) return out;
    root.traverse(function (node) {
      if (!node.isMesh || !node.visible || !node.geometry) return;
      if (node.__alLocalShadow) return;
      var m = node.matrixWorld.elements;
      var prev = node.__alLastWorld;
      if (!prev) { node.__alLastWorld = new Float32Array(m); out.push(node); return; }
      for (var i = 0; i < 16; i++) {
        if (Math.abs(prev[i] - m[i]) > 1e-4) { prev.set(m); out.push(node); return; }
      }
    });
    return out;
  }

  /**
   * Could this mover possibly change what the light sees? Erring towards "yes" only costs a
   * redundant depth render, so both tests here are conservative.
   *
   * The sphere is the cheap reject. The CONE is what stops a spot re-rendering its whole depth map
   * because something walked past it: a 16 m spot has a 32 m-wide range sphere even when its beam
   * is narrow and points elsewhere, so a sphere-only test dirtied the map for movers the light
   * cannot possibly illuminate. That is the same range-sphere laxity that used to hand shadow-map
   * slots to off-screen lights, and this is the same finite cone that fixed it.
   */
  function moverAffectsLight(node, light) {
    var v = lsTmp();
    if (!v || !node.geometry) return true;
    if (!node.geometry.boundingSphere) {
      try { node.geometry.computeBoundingSphere(); } catch (e) { return true; }
    }
    var bs = node.geometry.boundingSphere;
    if (!bs) return true;
    v.copy(bs.center).applyMatrix4(node.matrixWorld);
    var scale = Math.max(Math.abs(node.scale.x), Math.abs(node.scale.y), Math.abs(node.scale.z));
    var radius = bs.radius * scale;
    var reach = (light.radius || 0) * WORLD_UNITS_PER_METER;
    // Squared, and written out rather than via Vector3.distanceTo: it skips a sqrt on a test that
    // runs per mover per light per frame, and it keeps this function dependent on nothing but
    // plain numbers, which is what lets it be unit-tested without a GL context.
    var dx = v.x - light.worldPosition.x;
    var dy = v.y - light.worldPosition.y;
    var dz = v.z - light.worldPosition.z;
    var limit = reach + radius;
    if (dx * dx + dy * dy + dz * dz > limit * limit) return false;

    // Spot only, and only below 89 degrees: at that point tan() is unbounded and the cone is
    // effectively a hemisphere, so the sphere test above is already the right answer.
    if (light.lightType === 'Spot' && light.worldDirection) {
      var outerRadians = Math.max(0.001, light.spotOuterAngle || 45) * Math.PI / 180.0;
      if (outerRadians < 89.0 * Math.PI / 180.0) {
        return sphereIntersectsFiniteCone(
          v.x, v.y, v.z, radius,
          light.worldPosition.x, light.worldPosition.y, light.worldPosition.z,
          light.worldDirection.x, light.worldDirection.y, light.worldDirection.z,
          reach, Math.tan(outerRadians));
      }
    }
    return true;
  }

  function disposeLocalSlotLight(slot) {
    if (!slot || !slot.light) return;
    if (slot.light.shadow && slot.light.shadow.map) slot.light.shadow.map.dispose();
    if (slot.light.parent) slot.light.parent.remove(slot.light);
    if (slot.light.target && slot.light.target.parent) slot.light.target.parent.remove(slot.light.target);
    slot.light = null;
  }

  // A slot holds either a SpotLight or a PointLight. A point light's shadow is six faces packed
  // into one atlas, so the two are different Three objects and a slot that changes type has to
  // rebuild rather than be reconfigured.
  // A light's own object must not cast into that light's shadow map.
  //
  // A ClusteredLight3D usually lives on a Cube3D placed as a marker, and GDevelop's Cube3D defaults
  // "Shadow casting" on. The light sits at the centre of that cube, so the cube encloses it: the
  // depth map fills with the inside of the holder at roughly the near plane, and EVERY fragment in
  // the scene reads as occluded. The symptom is a completely black scene the moment a light is
  // granted a shadow map, which looks nothing like "a shadow is wrong".
  //
  // Material type does not protect against this - castShadow is a mesh flag, so even a "No lighting
  // effect" (MeshBasicMaterial) holder still writes depth.
  function suppressOwnCasting(light) {
    if (light.__alCastSuppressed) return;
    var root3d = threeRootOf(light.object);
    if (!root3d || !root3d.traverse) return;
    var saved = [];
    root3d.traverse(function (node) {
      if (node.isMesh && node.castShadow) { saved.push(node); node.castShadow = false; }
    });
    light.__alCastSuppressed = saved;
  }

  function restoreOwnCasting(light) {
    var saved = light && light.__alCastSuppressed;
    if (!saved) return;
    for (var i = 0; i < saved.length; i++) saved[i].castShadow = true;
    light.__alCastSuppressed = null;
  }

  /* ============================================================ Owned depth rendering ====
   *
   * Plan section 6: stop borrowing Three's shadow pass.
   *
   * WHY. Every slot that uses a native zero-intensity light costs TWO fragment texture units, not
   * one: Three declares spotShadowMap[N] / pointShadowMap[N] for that light, and this extension
   * then declares uAlLocalMap<i> to sample the very same map itself. On a GPU reporting the WebGL2
   * minimum of 16 units that is the entire budget before the cluster textures, the SDF volume, the
   * cascades or the material's own maps - and overrunning it does not degrade, it refuses to link
   * and renders the scene black. Borrowing the native pass also ties the shader permutation to
   * NUM_SPOT_LIGHT_SHADOWS, so adding or removing a shadowed light recompiles every material in
   * the scene.
   *
   * Owning the render fixes both at once: no native light, so no second sampler and no permutation
   * coupling.
   *
   * WHAT THE SHADER NEEDS IS UNCHANGED. It reads a texture, a matrix, and a few scalars. This
   * replaces the PRODUCER of those, not the consumer, so no GLSL changes are required - which is
   * also what makes it testable against the existing shadow tests.
   */

  // Three's own cube atlas layout, mirrored exactly because the shader's alCubeToUV mirrors Three's
  // cubeToUV. A different face order or viewport arrangement samples the wrong face and produces
  // shadows that look almost right, which is far worse than obviously broken.
  var CUBE_DIRECTIONS = null, CUBE_UPS = null, CUBE_VIEWPORTS = null;
  function cubeTables() {
    if (CUBE_DIRECTIONS || !THREE_OK) return;
    CUBE_DIRECTIONS = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    ];
    CUBE_UPS = [
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ];
    CUBE_VIEWPORTS = [
      new THREE.Vector4(2, 1, 1, 1), new THREE.Vector4(0, 1, 1, 1), new THREE.Vector4(3, 1, 1, 1),
      new THREE.Vector4(1, 1, 1, 1), new THREE.Vector4(3, 0, 1, 1), new THREE.Vector4(1, 0, 1, 1),
    ];
  }

  // [-1,1] clip -> [0,1] texture. Three folds this into shadow.matrix, and the shader's alLocalPCF
  // does ONLY the perspective divide on the strength of that, so it has to be folded in here too.
  var BIAS_REMAP = null;
  function biasRemap() {
    if (!BIAS_REMAP && THREE_OK) {
      BIAS_REMAP = new THREE.Matrix4().set(
        0.5, 0, 0, 0.5,
        0, 0.5, 0, 0.5,
        0, 0, 0.5, 0.5,
        0, 0, 0, 1);
    }
    return BIAS_REMAP;
  }

  /* ============================================ Borrowed-renderer state =================
   *
   * Every off-screen pass here - cascade depth, owned spot maps, the VSM blur, the contact
   * prepass - borrows the SCENE's renderer. Render target, viewport, scissor rect, scissor
   * enable, clear colour and shadowMap.enabled are all renderer-GLOBAL, not properties of the
   * target, so a pass that changes one and does not put it back corrupts the frame that follows.
   *
   * This has now bitten three times, each time presenting as something else entirely:
   *   - an unrestored VIEWPORT made the owned spot backend differ from the native one across 85%
   *     of lit pixels, which looked like a broken shadow projection;
   *   - the same thing in the contact prepass darkened 79% of the frame;
   *   - SCISSOR was disabled and never restored, which is invisible in an exported game (nothing
   *     else uses scissor) but breaks the GDevelop scene editor, where the view is drawn into a
   *     sub-rectangle of a shared canvas. With scissor off the editor's clear covers the whole
   *     canvas while the scene still draws only inside its viewport, so everything outside the
   *     view goes black.
   *
   * Hence one capture/restore pair rather than each pass remembering its own list. A pass that
   * forgets an item is the bug; the way to stop forgetting is to stop having a list per pass.
   */
  function captureRendererState(renderer) {
    var saved = {
      target: renderer.getRenderTarget ? renderer.getRenderTarget() : null,
      viewport: new THREE.Vector4(),
      scissor: new THREE.Vector4(),
      scissorTest: renderer.getScissorTest ? renderer.getScissorTest() : false,
      clearColor: new THREE.Color(),
      clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1,
      shadowMapEnabled: renderer.shadowMap ? renderer.shadowMap.enabled : false,
    };
    if (renderer.getViewport) renderer.getViewport(saved.viewport);
    if (renderer.getScissor) renderer.getScissor(saved.scissor);
    if (renderer.getClearColor) renderer.getClearColor(saved.clearColor);
    return saved;
  }

  function restoreRendererState(renderer, saved) {
    if (!renderer || !saved) return;
    // TARGET LAST, and the order is the whole point.
    //
    // setViewport/setScissor/setScissorTest write the renderer's PERSISTENT values and then apply
    // them to the GL state as canvas-relative (scaled by pixel ratio). setRenderTarget applies the
    // ACTIVE values instead: a bound target's own viewport when one is bound, or the persistent
    // ones when it is null.
    //
    // Restoring the target first and the viewport second therefore corrupts the case where the
    // caller was rendering INTO A TARGET - which the GDevelop scene editor does, drawing the view
    // into its own buffer. The target's correct viewport gets overwritten by a canvas-derived one,
    // and the editor's next frame draws squashed into part of its pane while input, which never
    // consulted the renderer, keeps using the full rectangle.
    //
    // Setting the persistent values first and letting setRenderTarget have the last word is right
    // for both cases: with a target bound it re-applies the target's own, and with null it
    // recomputes from exactly the persistent values just restored.
    if (renderer.setViewport) renderer.setViewport(saved.viewport);
    if (renderer.setScissor) renderer.setScissor(saved.scissor);
    if (renderer.setScissorTest) renderer.setScissorTest(saved.scissorTest);
    if (renderer.setRenderTarget) renderer.setRenderTarget(saved.target);
    if (renderer.setClearColor) renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    if (renderer.shadowMap) renderer.shadowMap.enabled = saved.shadowMapEnabled;
  }

  function ownedMaterials(ls) {
    if (!ls.depthMaterial) {
      // RGBADepthPacking, because the shader unpacks with unpackRGBAToDepth. This is the same
      // material Three's own shadow pass uses for a spot.
      ls.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      ls.depthMaterial.side = THREE.BackSide;
    }
    if (!ls.distanceMaterial && THREE.MeshDistanceMaterial) {
      // A point light's comparison is RADIAL distance, not projected depth, so it needs the
      // distance material - swapping in the depth one here is the classic way to get a point
      // shadow that is subtly and permanently wrong.
      ls.distanceMaterial = new THREE.MeshDistanceMaterial();
      ls.distanceMaterial.side = THREE.BackSide;
    }
    return ls;
  }

  function ensureOwnedSlot(ls, index, isPoint, mapSize) {
    var slot = ls.slots[index];
    if (!slot) slot = ls.slots[index] = { light: null, ownerKey: '', renderedKey: '', age: 0, live: false };
    var faceSize = Math.max(64, Math.floor(mapSize || 1024));
    var width = isPoint ? faceSize * 4 : faceSize;
    var height = isPoint ? faceSize * 2 : faceSize;
    if (slot.target && (slot.target.width !== width || slot.target.height !== height)) {
      slot.target.dispose(); slot.target = null;
    }
    if (!slot.target) {
      slot.target = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        depthBuffer: true, stencilBuffer: false,
      });
      slot.target.texture.generateMipmaps = false;
      slot.renderedKey = '';
      slot.everRendered = false;
    }
    if (!slot.camera) slot.camera = new THREE.PerspectiveCamera(90, 1, 0.5, 500);
    if (!slot.matrix) slot.matrix = new THREE.Matrix4();
    slot.isPoint = !!isPoint;
    slot.owned = true;
    slot.faceSize = faceSize;
    return slot;
  }

  /**
   * Render one slot's depth map with our own camera and override material.
   * Returns true if it drew.
   */
  function renderOwnedSlot(runtimeScene, ls, slot, light) {
    var renderer = threeRendererOf(runtimeScene);
    var root = getThreeScene(runtimeScene);
    if (!renderer || !root || !slot.target) return false;
    cubeTables();
    ownedMaterials(ls);

    var near = Math.max(0.5, light.shadowMapNear > 0 ? light.shadowMapNear : 1.0);
    var far = Math.max(near + 1.0, (light.radius || 0) * WORLD_UNITS_PER_METER);
    if (light.shadowMapNear <= 0) near = Math.max(0.5, far / 50);

    // Only shadow CASTERS may write depth. scene.overrideMaterial ignores castShadow entirely, so
    // without this every receiver writes into the map as well and the scene self-shadows into
    // darkness. Toggling visibility is the honest equivalent of what Three's shadow pass does when
    // it builds its own render list.
    var hidden = [];
    root.traverse(function (node) {
      if (node.isMesh && node.visible && !node.castShadow) { node.visible = false; hidden.push(node); }
    });
    suppressOwnCasting(light);
    var ownHidden = [];
    var ownRoot = threeRootOf(light.object);
    if (ownRoot && ownRoot.traverse) {
      ownRoot.traverse(function (node) {
        if (node.isMesh && node.visible) { node.visible = false; ownHidden.push(node); }
      });
    }

    var savedRenderer = captureRendererState(renderer);
    var previousOverride = root.overrideMaterial;
    // Our own pass must not trigger Three's shadow pass recursively.
    renderer.shadowMap.enabled = false;

    // CLEAR TO WHITE, which is depth = FAR once unpacked. Three's own shadow pass does this and it
    // is not cosmetic: the clear colour becomes the depth of every texel no geometry covers. Left at
    // the scene's clear colour - black in most scenes - those texels unpack to depth 0, meaning "an
    // occluder sitting on the near plane", and every fragment whose lookup lands outside the
    // caster's silhouette reads as shadowed. The visible result is a shadow far larger than it
    // should be, filling the map's whole frustum footprint.
    renderer.setClearColor(0xffffff, 1.0);

    try {
      if (slot.isPoint) {
        // Unreachable today: the slot acquisition never asks for an owned point slot. Kept as the
        // shape the cube path will take, and guarded so it cannot quietly ship half-working.
        if (!ls.distanceMaterial || !ls.distanceMaterial.referencePosition) {
          warnOnce('ownedPointUnsupported',
            'The owned depth backend does not support point lights yet (MeshDistanceMaterial has no ' +
            'referencePosition in this Three version). They use the native path instead.');
          return false;
        }
        var material = ls.distanceMaterial;
        ls.distanceMaterial.referencePosition.copy(light.worldPosition);
        ls.distanceMaterial.nearDistance = near;
        ls.distanceMaterial.farDistance = far;
        root.overrideMaterial = material;
        renderer.setRenderTarget(slot.target);
        renderer.setScissorTest(false);
        renderer.clear();
        for (var f = 0; f < 6; f++) {
          var vp = CUBE_VIEWPORTS[f];
          renderer.setViewport(vp.x * slot.faceSize, vp.y * slot.faceSize, slot.faceSize, slot.faceSize);
          renderer.setScissor(vp.x * slot.faceSize, vp.y * slot.faceSize, slot.faceSize, slot.faceSize);
          renderer.setScissorTest(true);
          slot.camera.fov = 90; slot.camera.aspect = 1;
          slot.camera.near = near; slot.camera.far = far;
          slot.camera.position.copy(light.worldPosition);
          slot.camera.up.copy(CUBE_UPS[f]);
          slot.camera.lookAt(
            light.worldPosition.x + CUBE_DIRECTIONS[f].x,
            light.worldPosition.y + CUBE_DIRECTIONS[f].y,
            light.worldPosition.z + CUBE_DIRECTIONS[f].z);
          slot.camera.updateMatrixWorld(true);
          slot.camera.updateProjectionMatrix();
          renderer.render(root, slot.camera);
        }
        renderer.setScissorTest(false);
        // A point light's matrix is a pure translation by -lightPosition: the shader wants the
        // light-to-fragment vector, not a projection. This is what PointLightShadow does too.
        slot.matrix.makeTranslation(-light.worldPosition.x, -light.worldPosition.y, -light.worldPosition.z);
      } else {
        root.overrideMaterial = ls.depthMaterial;
        slot.camera.fov = Math.min(179, Math.max(1, (light.spotOuterAngle || 45) * 2));
        slot.camera.aspect = 1;
        slot.camera.near = near; slot.camera.far = far;
        slot.camera.position.copy(light.worldPosition);
        slot.camera.up.set(0, 1, 0);
        var aim = lsTmp().copy(light.worldPosition).add(light.worldDirection);
        slot.camera.lookAt(aim.x, aim.y, aim.z);
        slot.camera.updateMatrixWorld(true);
        slot.camera.updateProjectionMatrix();
        // No setViewport: setRenderTarget already sets it to the target's full size, and
        // setViewport would also overwrite the renderer's persistent viewport.
        renderer.setRenderTarget(slot.target);
        renderer.clear();
        renderer.render(root, slot.camera);
        slot.matrix.copy(biasRemap());
        slot.matrix.multiply(slot.camera.projectionMatrix);
        slot.matrix.multiply(slot.camera.matrixWorldInverse);
        // Spot only. A point light's atlas packs six faces edge to edge, so a separable blur would
        // drag depths across face boundaries and leave seams where none exist in the scene - and
        // point lights do not reach this backend at all today.
        if (filterForLight(ls, light) === 'VSM') renderVsmMoments(renderer, ls, slot, near, far);
        else slot.vsmReady = false;
      }
    } finally {
      root.overrideMaterial = previousOverride;
      restoreRendererState(renderer, savedRenderer);
      for (var h = 0; h < hidden.length; h++) hidden[h].visible = true;
      for (var o = 0; o < ownHidden.length; o++) ownHidden[o].visible = true;
      restoreOwnCasting(light);
    }

    slot.near = near; slot.far = far;
    slot.bias = light.shadowMapBias !== undefined ? light.shadowMapBias : -0.0005;
    slot.normalBias = light.shadowNormalBias || 0;
    slot.radius = 1;
    slot.mapSize = slot.faceSize;
    slot.everRendered = true;
    return true;
  }

  function disposeOwnedSlot(slot) {
    if (!slot) return;
    if (slot.target) { slot.target.dispose(); slot.target = null; }
    if (slot.vsm) { slot.vsm.dispose(); slot.vsm = null; }
    slot.vsmReady = false;
    slot.camera = null;
    slot.everRendered = false;
  }

  /* ======================================================= Variance shadow maps (VSM) ====
   *
   * WHAT IT IS. A PCF map stores one depth per texel and the shader asks "is this fragment behind
   * it?" nine times over a small kernel, averaging the yes/no answers. That is the only way to get
   * a soft edge out of a depth map, because a depth value cannot be blurred: the average of two
   * depths is not the depth of anything, and comparing against it gives a wrong answer rather than
   * a soft one.
   *
   * VSM stores the MEAN and STANDARD DEVIATION of depth over a neighbourhood instead. Those are
   * statistics, and statistics blur correctly. So the map itself can be blurred once, up front,
   * and then read with a SINGLE bilinear tap. Chebyshev's inequality turns the two moments back
   * into an upper bound on the fraction of the light that is visible.
   *
   * WHAT THAT BUYS, concretely:
   *   - One texture fetch per light instead of nine. The saving grows with the softness: a wider
   *     PCF kernel costs more taps, a wider VSM blur costs nothing at sampling time.
   *   - Hardware bilinear filtering does real work, where on a packed depth map it produces
   *     garbage. The moments target is therefore LinearFilter and the depth map stays Nearest -
   *     swapping those is silent corruption, not a visual difference.
   *   - Depth bias mostly stops mattering. Acne comes from comparing a quantised depth against
   *     itself; Chebyshev returns a probability, not a comparison.
   *
   * WHAT IT COSTS. Light bleeding: where a near occluder and a far occluder both cover a receiver,
   * the variance is large and the bound becomes loose, so the far surface brightens where it
   * should be fully dark. uAlVsmBleed rescales the probability to crush that, at the price of
   * hardening the penumbra. This is inherent to the technique, not a defect in this implementation.
   *
   * STORAGE. Two 16-bit fixed-point values packed into one RGBA8 texel, exactly as Three's own VSM
   * does, via pack2HalfToRGBA / unpackRGBATo2Half from <packing>. That deliberately avoids float
   * render targets: RG16F needs EXT_color_buffer_float to be colour-renderable, and a missing
   * extension would mean VSM works on the development machine and renders nothing on a user's.
   */

  var VSM_BLUR_FRAGMENT = [
    'uniform sampler2D shadow_pass;',
    'uniform vec2 resolution;',
    'uniform float radius;',
    'uniform vec2 nearFar;',
    '#include <packing>',
    // WHY THE MOMENTS ARE TAKEN OVER *LINEAR* DEPTH, which is the difference between VSM working
    // and VSM being a slower PCF.
    //
    // A perspective depth buffer spends nearly all its precision close to the near plane. For a
    // spot light in this engine's pixel scale, every surface it can usefully shadow lands between
    // about 0.92 and 1.0 - measured, not assumed. Variance is a SQUARED quantity, so compressing
    // the depth range 12x compresses the variance 150x: the standard deviation collapses to under
    // one part in 255 and cannot even survive the 16-bit store. Chebyshev then sees variance ~0,
    // and s2/(s2+d^2) degenerates into exactly the hard step VSM exists to avoid.
    //
    // Linearising first spreads the same surfaces across the whole [0,1] range, so the deviation
    // is a real number and the bound is a real gradient. This is the one place this implementation
    // deliberately diverges from Three's own VSM, which converts the projected depth as-is - and
    // which is why Three's spot VSM shadows look barely softer than its PCF ones.
    '  float alLinearise(float depth) {',
    '    float viewZ = perspectiveDepthToViewZ(depth, nearFar.x, nearFar.y);',
    '    return clamp((-viewZ - nearFar.x) / max(nearFar.y - nearFar.x, 1e-4), 0.0, 1.0);',
    '  }',
    'void main() {',
    '  const float samples = float(AL_VSM_SAMPLES);',
    '  float mean = 0.0;',
    '  float squared_mean = 0.0;',
    '  float uvStride = samples <= 1.0 ? 0.0 : 2.0 / (samples - 1.0);',
    '  float uvStart = samples <= 1.0 ? 0.0 : -1.0;',
    '  for (float i = 0.0; i < samples; i++) {',
    '    float uvOffset = uvStart + i * uvStride;',
    '    #ifdef AL_VSM_HORIZONTAL',
    // Second pass: the input is already moments, so the mean of the means is the mean, and the
    // squared mean has to be reconstituted from the stored deviation before it can be averaged.
    '      vec2 distribution = unpackRGBATo2Half(',
    '        texture2D(shadow_pass, (gl_FragCoord.xy + vec2(uvOffset, 0.0) * radius) / resolution));',
    '      mean += distribution.x;',
    '      squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;',
    '    #else',
    // First pass: the input is the PACKED DEPTH map, so it unpacks as a depth, not as moments.
    '      float depth = alLinearise(unpackRGBAToDepth(',
    '        texture2D(shadow_pass, (gl_FragCoord.xy + vec2(0.0, uvOffset) * radius) / resolution)));',
    '      mean += depth;',
    '      squared_mean += depth * depth;',
    '    #endif',
    '  }',
    '  mean = mean / samples;',
    '  squared_mean = squared_mean / samples;',
    // max() is NOT cosmetic. E[d^2] - E[d]^2 is non-negative in exact arithmetic, but over a flat
    // region every sample is equal and the subtraction is catastrophic cancellation: it lands a
    // few ULP below zero, sqrt returns NaN, and the NaN propagates through Chebyshev to leave a
    // permanently black texel. Three omits this clamp; flat floors are exactly where it bites.
    '  float std_dev = sqrt(max(0.0, squared_mean - mean * mean));',
    '  gl_FragColor = pack2HalfToRGBA(vec2(mean, std_dev));',
    '}',
  ].join('\n');

  function ensureVsmResources(ls) {
    if (ls.vsmScene) return ls;
    // A single triangle larger than the viewport, not a quad. Two triangles meet along the
    // diagonal, and fragments on that seam are shaded by both, which shows up as a visible line
    // through the middle of the blurred map.
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0.5, 3, -1, 0.5, -1, 3, 0.5]), 3));
    function makeMaterial(horizontal) {
      var defines = { AL_VSM_SAMPLES: ls.vsmSamples };
      if (horizontal) defines.AL_VSM_HORIZONTAL = 1;
      var m = new THREE.ShaderMaterial({
        defines: defines,
        uniforms: {
          shadow_pass: { value: null },
          resolution: { value: new THREE.Vector2(1, 1) },
          radius: { value: 4 },
          nearFar: { value: new THREE.Vector2(1, 1000) },
        },
        vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
        fragmentShader: VSM_BLUR_FRAGMENT,
      });
      m.depthTest = false;
      m.depthWrite = false;
      return m;
    }
    ls.vsmVertical = makeMaterial(false);
    ls.vsmHorizontal = makeMaterial(true);
    ls.vsmQuad = new THREE.Mesh(geom, ls.vsmVertical);
    ls.vsmQuad.frustumCulled = false;      // its clip-space vertices defeat any bounding test
    ls.vsmScene = new THREE.Scene();
    ls.vsmScene.add(ls.vsmQuad);
    ls.vsmCamera = new THREE.Camera();     // the vertex shader ignores it; render() demands one
    return ls;
  }

  // LinearFilter is the point of the whole exercise: moments interpolate meaningfully, so one
  // bilinear tap replaces a PCF kernel. Never give these NearestFilter, and never give the packed
  // depth map LinearFilter - interpolating packDepthToRGBA's bytes yields a depth that is not
  // between the two it came from.
  function vsmScratchFor(ls, size) {
    if (!ls.vsmScratch || typeof ls.vsmScratch.dispose === 'function') ls.vsmScratch = {};
    ls.vsmScratch[size] = vsmTarget(ls.vsmScratch[size], size);
    return ls.vsmScratch[size];
  }

  function vsmTarget(existing, size) {
    if (existing && existing.width === size && existing.height === size) return existing;
    if (existing) existing.dispose();
    var t = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: false, stencilBuffer: false,
    });
    t.texture.generateMipmaps = false;
    return t;
  }

  /**
   * Convert one freshly rendered packed-depth map into a blurred moments map.
   *
   * The intermediate is SHARED across slots rather than per-slot: it is consumed by the second
   * pass immediately, within this call, so four slots need one scratch buffer and not four. At
   * 1024 that is 4 MB saved per slot beyond the first.
   *
   * Assumes the caller has already saved the render target and viewport - it is called from inside
   * renderOwnedSlot's try/finally, which restores both.
   */
  function renderVsmMoments(renderer, ls, slot, near, far) {
    ensureVsmResources(ls);
    var size = slot.faceSize;
    var scratch = vsmScratchFor(ls, size);
    slot.vsm = vsmTarget(slot.vsm, size);
    if (ls.vsmVertical.defines.AL_VSM_SAMPLES !== ls.vsmSamples) {
      ls.vsmVertical.defines.AL_VSM_SAMPLES = ls.vsmSamples;
      ls.vsmHorizontal.defines.AL_VSM_SAMPLES = ls.vsmSamples;
      ls.vsmVertical.needsUpdate = true;
      ls.vsmHorizontal.needsUpdate = true;
    }
    var radius = ls.vsmBlurRadius;
    ls.vsmVertical.uniforms.shadow_pass.value = slot.target.texture;
    ls.vsmVertical.uniforms.resolution.value.set(size, size);
    ls.vsmVertical.uniforms.radius.value = radius;
    ls.vsmVertical.uniforms.nearFar.value.set(near, far);
    ls.vsmQuad.material = ls.vsmVertical;
    renderer.setRenderTarget(scratch);
    renderer.render(ls.vsmScene, ls.vsmCamera);

    ls.vsmHorizontal.uniforms.shadow_pass.value = scratch.texture;
    ls.vsmHorizontal.uniforms.resolution.value.set(size, size);
    ls.vsmHorizontal.uniforms.radius.value = radius;
    ls.vsmQuad.material = ls.vsmHorizontal;
    renderer.setRenderTarget(slot.vsm);
    renderer.render(ls.vsmScene, ls.vsmCamera);

    slot.vsmReady = true;
    return true;
  }

  /* ============================================ Depth prepass & contact shadows ========
   *
   * WHY THIS EXISTS. A shadow map costs one texture unit PER LIGHT. On hardware reporting the
   * WebGL2 minimum of 16 units that is the whole budget after four lights, which is what turned a
   * real project black. Contact shadows march the scene depth buffer instead: every light shares
   * ONE texture, so forty lights cost exactly what one costs. The cost stops scaling with light
   * count, which is the only thing that actually fixes the budget problem.
   *
   * WHY A PREPASS IS UNAVOIDABLE. The obvious shortcut is to reuse the depth attachment
   * CinematicPostFX3D already puts on the layer composer. It cannot work: that buffer is filled BY
   * the main render, and clustered lighting runs DURING that render. Reading the depth buffer you
   * are currently writing is a feedback loop. The alternative - last frame's depth - lags by a
   * frame and smears on fast motion. So this renders depth once, up front, before the main pass.
   *
   * WHAT IT CANNOT DO, stated plainly because the limitation is structural rather than a bug:
   * only occluders that are ON SCREEN and in the depth buffer cast anything. An object behind the
   * camera, or outside the frustum, casts nothing. And the march is short-range by nature - these
   * are CONTACT shadows, the darkening where objects meet, not a substitute for a spot light's
   * full-length shadow. Use them alongside shadow maps, not instead of them.
   */

  function contactState(state) {
    if (!state.contact) state.contact = {
      enabled: false,
      target: null,
      material: null,
      // Full resolution prevents the grazing-angle depth staircases that show up as long
      // horizontal bars on floors. The old half-resolution Nearest texture made each depth texel
      // cover four output pixels and turned a normal ray-march miss into a conspicuous stripe.
      scale: 1.0,
      width: 0, height: 0,
      strength: 1.0,
      distance: 120.0,     // world units the march may travel
      steps: 12,
      thickness: 40.0,     // how deep behind a depth sample still counts as the same occluder
      rendered: false,
    };
    return state.contact;
  }

  function ensureContactTarget(cs, renderer) {
    var size = renderer.getSize(new THREE.Vector2());
    var w = Math.max(64, Math.floor(size.x * cs.scale));
    var h = Math.max(64, Math.floor(size.y * cs.scale));
    if (cs.target && (cs.width !== w || cs.height !== h)) { cs.target.dispose(); cs.target = null; }
    if (!cs.target) {
      cs.target = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        depthBuffer: true, stencilBuffer: false,
      });
      cs.target.texture.generateMipmaps = false;
      cs.width = w; cs.height = h;
    }
    if (!cs.material) {
      // RGBA-packed window depth, so the shader unpacks it with the same unpackRGBAToDepth the
      // shadow-map path already uses, and the comparison stays in window-depth space with no
      // near/far reconstruction to get wrong.
      cs.material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    }
    return cs.target;
  }

  /**
   * Render scene depth from the main camera, before the main pass.
   * One pass, shared by every light.
   */
  function renderDepthPrepass(runtimeScene, camera) {
    var state = stateOf(runtimeScene);
    var cs = contactState(state);
    cs.rendered = false;
    if (!cs.enabled || (state.textureUnitBudget && state.textureUnitBudget.contact === false) ||
        !THREE_OK || !camera) return false;
    var renderer = threeRendererOf(runtimeScene);
    var root = getThreeScene(runtimeScene);
    if (!renderer || !root || !root.traverse) return false;

    ensureContactTarget(cs, renderer);

    var savedRenderer = captureRendererState(renderer);
    var previousOverride = root.overrideMaterial;

    // White is FAR once unpacked. Clearing to the scene colour would make every untouched texel
    // read as an occluder sitting on the near plane — the same trap the shadow-map pass hit.
    renderer.setClearColor(0xffffff, 1.0);
    renderer.shadowMap.enabled = false;
    root.overrideMaterial = cs.material;
    try {
      // No setViewport: the target carries its own, and setViewport would also overwrite the
      // renderer's persistent viewport.
      renderer.setRenderTarget(cs.target);
      renderer.clear();
      renderer.render(root, camera);
      cs.rendered = true;
    } catch (e) {
      cs.rendered = false;
      warnOnce('contactPrepass', 'The depth prepass failed, so contact shadows are off for this ' +
        'scene: ' + (e && e.message ? e.message : e));
    } finally {
      root.overrideMaterial = previousOverride;
      restoreRendererState(renderer, savedRenderer);
    }
    return cs.rendered;
  }

  function contactShadowsActive(state) {
    var cs = state.contact;
    return !!(cs && cs.enabled && cs.target && cs.rendered &&
      (!state.textureUnitBudget || state.textureUnitBudget.contact !== false));
  }

  function ensureLocalSlot(ls, root, index, wantPoint) {
    var slot = ls.slots[index];
    if (slot && slot.light && !!slot.isPoint === !!wantPoint) return slot;
    if (slot) { disposeLocalSlotLight(slot); slot.renderedKey = ''; }
    var native = wantPoint ? new THREE.PointLight(0xffffff, 0) : new THREE.SpotLight(0xffffff, 0);
    native.__alLocalShadow = true;
    native.castShadow = true;
    native.shadow.autoUpdate = false;   // we decide when it re-renders - see 7.5 of the plan
    native.shadow.needsUpdate = false;
    root.add(native);
    if (native.target) root.add(native.target);
    if (!slot) slot = ls.slots[index] = { light: null, ownerKey: '', renderedKey: '', age: 0, live: false };
    slot.light = native;
    slot.isPoint = !!wantPoint;
    slot.everRendered = false;
    slot.requested = false;
    return slot;
  }

  function releaseLocalShadowSlots(ls) {
    for (var i = 0; i < ls.slots.length; i++) {
      var slot = ls.slots[i];
      if (!slot) continue;
      slot.live = false;
      slot.ownerKey = '';
      slot.renderedKey = '';
      slot.everRendered = false;
      slot.requested = false;
      if (!slot.owned) parkSlotLight(slot);
    }
    ls.mappedCount = 0;
  }

  /**
   * Idle a slot's native light WITHOUT hiding it.
   *
   * Verified in the bundled r160: projectObject early-returns on `visible === false`, so an
   * invisible light is pushed neither as a light nor as a shadow. Hiding one therefore changes
   * NUM_SPOT_LIGHT_SHADOWS, and that recompiles EVERY material in the scene - including objects
   * this extension never touched. That is the 3.2 s p95 hitch recorded in LOCAL_SHADOW_MAPS_PLAN.
   *
   * WebGLShadowMap.render checks `autoUpdate === false && needsUpdate === false` per light, AFTER
   * the arrays are built, so a visible light parked this way keeps the shader permutation stable
   * and still skips its depth render entirely. Zero render cost, no recompile.
   */
  /**
   * What one re-render of this slot actually costs, in depth passes.
   * A PointLightShadow renders six cube faces; a SpotLightShadow renders one.
   */
  /**
   * How often this light's map is allowed to re-render, in frames.
   *
   * WHAT THIS IS FOR. A light that leaves the view already loses its slot, so a completely
   * invisible shadow costs nothing. The case this handles is the one you actually hit walking
   * around: a light still on screen whose shadow is a handful of pixels across, re-rendering its
   * whole depth map every time anything inside its radius twitches. Spending a full depth pass on
   * that, at the same rate as the shadow at the player's feet, is the waste.
   *
   * Coverage is the number of screen-space clusters the light was binned into this frame - a
   * direct measure of how much of the view it occupies, already computed by the culling pass, so
   * this costs nothing to evaluate.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO: gate on whether the CASTER is visible. A caster behind the
   * camera legitimately throws a shadow into view, and dropping its map when it leaves the screen
   * makes shadows pop out of existence as you turn. Visibility of the LIGHT's footprint is the
   * only safe proxy.
   */
  function updateIntervalFor(ls, light) {
    var maxInterval = Math.max(1, ls.maxUpdateInterval || 1);
    if (maxInterval <= 1 || !light) return 1;
    var coverage = light.__alMapCoverage || 1;
    if (coverage >= 24) return 1;                      // filling a good part of the screen
    if (coverage >= 8) return Math.min(2, maxInterval);
    if (coverage >= 3) return Math.min(4, maxInterval);
    return maxInterval;                                 // a few pixels; update rarely
  }

  function slotFaceCost(slot) {
    // The owned backend has no native light; its type is on the slot itself.
    if (slot && slot.owned) return slot.isPoint ? 6 : 1;
    var light = slot && slot.light;
    if (!light) return 1;
    if (light.isPointLight) return 6;
    if (light.shadow && typeof light.shadow.getFrameExtents === 'function') {
      // Three states its own atlas layout here, so this stays right if a shadow type changes shape.
      var extents = light.shadow.getFrameExtents();
      var faces = Math.max(1, Math.round(extents.x * extents.y));
      return faces;
    }
    return 1;
  }

  function parkSlotLight(slot) {
    if (!slot || !slot.light) return;
    var light = slot.light;
    // REVERTED TO HIDING, 2026-09-12, after it turned a frame hitch into a white screen.
    //
    // Keeping parked slots VISIBLE does stop NUM_SPOT_LIGHT_SHADOWS churning, and that reasoning
    // still stands. What it missed is the price: every visible shadow-casting slot light occupies a
    // spotShadowMap[] entry for the whole scene's life. With four local slots that is four
    // texture units permanently spent instead of however many lights are actually shadowing - on
    // top of the material's own maps and this extension's cluster, SDF, CSM and local-map samplers.
    // Past the hardware limit the program stops linking and the scene renders white.
    //
    // test-texture-unit-budget.mjs measures the stock path against the guaranteed 16-unit floor,
    // with spotShadowMap[] accounting for one unit per visible Native slot. The warning was in hand and the
    // change was shipped anyway; that is the mistake, not the idea.
    //
    // Hiding costs the recompile hitch and is what shipped before. It stays until the sampler
    // budget is solved properly - see DEMAND_DRIVEN_SHADOWS_PLAN section 6: rendering the depth
    // maps ourselves removes the native lights entirely and with them both problems at once.
    light.visible = false;
    light.intensity = 0;
    if (light.shadow) {
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = false;
    }
  }

  function disposeLocalShadows(state) {
    var ls = state.localShadows;
    if (!ls) return;
    for (var i = 0; i < ls.slots.length; i++) {
      disposeLocalSlotLight(ls.slots[i]);
    }
    ls.slots.length = 0;
    if (ls.renderer && ls.rendererState) {
      ls.renderer.shadowMap.enabled = ls.rendererState.enabled;
    }
    ls.renderer = null; ls.rendererState = null;
    state.localShadows = null;
  }

  function updateLocalShadowMaps(runtimeScene, camera) {
    var state = stateOf(runtimeScene);
    var ls = localShadowState(state);
    ls.frame++;
    ls.updatesThisFrame = 0;

    var root = getThreeScene(runtimeScene);
    if (!root || !THREE_OK || !THREE.SpotLight) return;

    // Track previous slot occupancy for hysteresis before clearing.
    state.lights.forEach(function (l) {
      l.__alWasMapped = (l.__alMapSlot !== undefined && l.__alMapSlot >= 0);
      if (l.__alMapSlot >= 0) restoreOwnCasting(l);
      l.__alMapSlot = -1;
    });

    if (!localMapsEnabled(state, runtimeScene)) { releaseLocalShadowSlots(ls); return; }

    var renderer = threeRendererOf(runtimeScene);
    if (!renderer || !renderer.shadowMap) return;
    if (!ls.renderer) {
      ls.renderer = renderer;
      ls.rendererState = { enabled: renderer.shadowMap.enabled };
    }
    renderer.shadowMap.enabled = true;

    // Transforms must be current before either the mover check or the shadow camera fitting reads
    // them. A camera fitted from stale matrices points at where the light used to be.
    root.updateMatrixWorld(true);

    /* ---- 1. Candidates. Phase A is spot-only; point lights need six faces. ---- */
    var candidates = [];
    state.lights.forEach(function (l) {
      if (!l.active || !l.castShadow) return;
      // AreaCapsule has no standard shadow-map formulation; it stays on the SDF path.
      if (l.lightType !== 'Spot' && l.lightType !== 'Point') return;
      var technique = l.shadowTechnique || 'Auto';
      if (technique === 'SDF' || technique === 'None') return;
      // This is the current frame's authoritative clustered-culling result. Shadow selection now
      // runs after binning, so there is no second frustum implementation to disagree at the edge.
      if (!l.isInFrustum) return;
      // Use the nearest cluster the light actually touches, rather than its centre. A large light
      // can have its centre behind or far outside the camera while its lit/shadowed footprint is
      // plainly on screen; centre distance made that case jump between the front and back of the
      // reservation queue as the camera crossed the light volume.
      l.__alMapViewDepth = Number.isFinite(l.__alNearestVisibleDepth)
        ? l.__alNearestVisibleDepth
        : Math.max(camera && camera.near || 0.1,
            (l.viewDistance || 0) * WORLD_UNITS_PER_METER);
      l.__alMapCoverage = l.__alVisibleClusterCount || 1;
      l.__alMapScore = (1 + l.__alMapCoverage) / Math.max(1.0, l.__alMapViewDepth);
      candidates.push(l);
    });
    candidates.sort(function (a, b) {
      // An explicit ShadowMap request wins among visible lights. Off-screen forced lights do not
      // consume a slot: they cannot draw a visible shadow and would evict one that can.
      var af = (a.shadowTechnique || 'Auto') === 'ShadowMap' ? 1 : 0;
      var bf = (b.shadowTechnique || 'Auto') === 'ShadowMap' ? 1 : 0;
      if (af !== bf) return bf - af;

      // Visual distance is the primary ordering. Give incumbents a small depth allowance to stop
      // two almost-equal lights swapping slots as the camera jitters, but never let that bonus
      // protect a materially farther shadow from a nearer one.
      var ad = a.__alMapViewDepth / (a.__alWasMapped ? 1.10 : 1.0);
      var bd = b.__alMapViewDepth / (b.__alWasMapped ? 1.10 : 1.0);
      if (ad !== bd) return ad - bd;
      if (a.__alMapCoverage !== b.__alMapCoverage) return b.__alMapCoverage - a.__alMapCoverage;
      return ad - bd;
    });

    var capacity = Math.min(ls.maxLights, LOCAL_SHADOW_SLOTS);
    var chosen = candidates.slice(0, capacity);

    // A forced ShadowMap light that could not be served must say so rather than quietly degrading.
    for (var c = capacity; c < candidates.length; c++) {
      if ((candidates[c].shadowTechnique || 'Auto') === 'ShadowMap') {
        warnOnce('localShadowBudget',
          'More lights request ShadowTechnique "ShadowMap" than MaxShadowMappedLights allows (' +
          capacity + '). The excess fall back to SDF, or go unshadowed in Maps mode. ' +
          'Raise the budget with SetMaxShadowMappedLights, or set some lights to Auto.');
        break;
      }
    }

    /* ---- 2. Which casters moved this frame ---- */
    var movers = collectMovedCasters(root, ls.movers);

    /* ---- 2b. VSM needs maps we render ourselves, so promote the backend if any light wants it.
             Done HERE rather than when the filter is set, because a light can ask for VSM without
             the scene default changing, and because switching backends disposes every slot - which
             has to happen before they are bound below, never in the middle of the loop. ---- */
    if (ls.backend !== 'Owned') {
      for (var vq = 0; vq < chosen.length; vq++) {
        if (chosen[vq] && chosen[vq].lightType !== 'Point' && filterForLight(ls, chosen[vq]) === 'VSM') {
          warnOnce('vsmForcesOwned',
            'A light asked for VSM shadow maps, which need the Owned depth renderer, so it has ' +
            'been switched on for this scene. It renders pixel-identically to Native and costs ' +
            'one texture unit per shadowed light instead of two. Point lights are unaffected: ' +
            'they stay on Native and PCF.');
          applySceneShadowSettings(runtimeScene, { localShadowBackend: 'Owned' });
          break;
        }
      }
    }

    /* ---- 3. Bind slots, sync the native light, decide staleness ---- */
    var dirty = [];
    for (var i = 0; i < capacity; i++) {
      var light = chosen[i];
      var isPoint = !!(light && light.lightType === 'Point');
      // SPOT ONLY for the owned backend, deliberately.
      //
      // A point light's comparison is radial distance, which Three renders with
      // MeshDistanceMaterial - and in r160 that material no longer exposes referencePosition as a
      // property. Three sets that uniform from the light during its own shadow pass, and the whole
      // point of this backend is that there is no light. Driving it without the reference position
      // would silently measure distance from the world origin, which is the kind of
      // nearly-plausible wrongness that costs hours. Point lights stay on the native path until
      // this backend brings its own distance shader.
      var useOwned = ls.backend === 'Owned' && !isPoint;
      var slot = useOwned
        ? ensureOwnedSlot(ls, i, false, light ? light.shadowMapSize : 1024)
        : ensureLocalSlot(ls, root, i, isPoint);
      if (!light) {
        slot.live = false; slot.ownerKey = '';
        if (!slot.owned) parkSlotLight(slot);
        continue;
      }

      light.__alMapSlot = i;
      // Both backends need the light record later, for the update-cadence decision. The owned
      // path also keeps __ownedLight for its render call.
      slot.__lightRecord = light;
      // A slot that was released and is now re-acquired must re-render unconditionally. While it
      // was unassigned the mover check was not running for it, so the world may have changed
      // underneath a map that still looks current by key. Trusting the key there hands back a
      // shadow of where things used to be.
      suppressOwnCasting(light);
      var wasLive = slot.live;
      slot.live = true;

      // The owned backend has no native light to position, aim or size — renderOwnedSlot does all
      // of that from the light record at render time. Everything below is native-only plumbing.
      if (slot.owned) {
        // Mirrors the native staleness check below exactly. Two things were wrong here:
        // localShadowKeyOf takes only the light, and moverAffectsLight is (node, light) — this
        // passed the light as the node and the mover ARRAY as the light, so it read
        // `node.geometry` off a light record, found nothing, and returned true every frame. The
        // slot therefore re-rendered its depth map on every single frame, which is precisely the
        // cost the caching exists to avoid.
        var ownedKey = localShadowKeyOf(light);
        var ownedStale = !wasLive || slot.renderedKey !== ownedKey || !slot.everRendered;
        if (!ownedStale && !light.shadowMapStatic) {
          for (var om = 0; om < movers.length; om++) {
            if (moverAffectsLight(movers[om], light)) { ownedStale = true; break; }
          }
        }
        slot.ownerKey = ownedKey;
        if (ownedStale) { slot.age++; dirty.push(slot); } else { slot.age = 0; }
        slot.__ownedLight = light;
        continue;
      }

      slot.light.visible = true;
      var native = slot.light;
      var size = light.shadowMapSize || 1024;
      if (native.shadow.mapSize.x !== size) {
        native.shadow.mapSize.set(size, size);
        if (native.shadow.map) { native.shadow.map.dispose(); native.shadow.map = null; }
      }
      // light.worldPosition is already a WORLD position (its Y is mirrored to match the scene
      // root's scale.y = -1). The native light is a child of that same mirrored root, so assigning
      // the world value straight to .position would mirror it a second time and put the light —
      // and its shadow — on the wrong side of the scene. Convert through the parent instead.
      native.position.copy(root.worldToLocal(lsTmp().copy(light.worldPosition)));
      if (!slot.isPoint) {
        native.target.position.copy(
          root.worldToLocal(lsTmp().copy(light.worldPosition).add(light.worldDirection)));
        native.target.updateMatrixWorld(true);
        native.angle = Math.min(Math.PI / 2 - 0.01, ((light.spotOuterAngle || 45) * Math.PI / 180));
        native.penumbra = 0.0;
      }
      native.updateMatrixWorld(true);
      native.distance = Math.max(1, (light.radius || 0) * WORLD_UNITS_PER_METER);
      native.intensity = 0;                       // maps only, never radiance
      // The near plane has to scale with the scene, not sit at 1.
      //
      // GDevelop 3D is pixel-scale: a light 420 units up with near=1 and far=1400 puts the floor at
      // depth 0.9980 and the box occluding it at 0.9975 - a 0.0005 separation against a 0.0005
      // bias, so nothing ever reads as shadowed. Perspective depth spends almost all of its
      // precision between near and a few multiples of it, so near must be a real fraction of far.
      // At far/50 the same pair separates by 0.0136, about 27x the bias.
      native.shadow.camera.near = Math.max(1.0,
        light.shadowMapNear !== undefined && light.shadowMapNear > 0
          ? light.shadowMapNear : native.distance / 50.0);
      native.shadow.camera.far = native.distance;
      if (!slot.isPoint) {
        // PointLightShadow owns its own 90-degree cube faces; only a spot's fov is ours to set.
        native.shadow.camera.fov = (native.angle * 180.0 / Math.PI) * 2.0;
      }
      native.shadow.camera.updateProjectionMatrix();
      native.shadow.bias = (light.shadowMapBias !== undefined) ? light.shadowMapBias : -0.0005;
      native.shadow.normalBias = (light.shadowNormalBias !== undefined) ? light.shadowNormalBias : 0.02;
      native.updateMatrixWorld(true);

      // Did the map we asked for last frame actually get rendered? Three resets needsUpdate
      // only after drawing it, so a cleared flag is the acknowledgement.
      if (slot.requested && !native.shadow.needsUpdate) slot.everRendered = true;

      var key = localShadowKeyOf(light);
      var stale = !wasLive || (slot.renderedKey !== key) || !native.shadow.map;
      if (!stale && !light.shadowMapStatic) {
        for (var m = 0; m < movers.length; m++) {
          if (moverAffectsLight(movers[m], light)) { stale = true; break; }
        }
      }
      slot.ownerKey = key;
      if (stale) { slot.age++; dirty.push(slot); } else { slot.age = 0; }
    }

    /* ---- 4. Stagger the re-renders. Age breaks starvation: a light that is permanently dirty
             must not monopolise the budget while the others never update. ---- */
    // Age alone decided this, so a three-pixel shadow across the map could take the frame's only
    // update slot ahead of the one at the player's feet. Visible size leads now, with age kept as
    // an override so nothing starves: a slot that has waited several frames goes first regardless.
    dirty.sort(function (a, b) {
      var starvedA = a.age >= 4 ? 1 : 0, starvedB = b.age >= 4 ? 1 : 0;
      if (starvedA !== starvedB) return starvedB - starvedA;
      var sa = (a.__lightRecord && a.__lightRecord.__alMapScore) || 0;
      var sb = (b.__lightRecord && b.__lightRecord.__alMapScore) || 0;
      if (sa !== sb) return sb - sa;
      return b.age - a.age;
    });
    var budget = Math.max(1, ls.maxUpdatesPerFrame);
    for (var d = 0; d < dirty.length; d++) {
      // WEIGHTED BY FACE COUNT. A point light renders SIX depth passes, one per cube face, while a
      // spot renders one. Counting both as "1 update" meant MaxShadowMapUpdatesPerFrame = 2 quietly
      // permitted twelve face renders in a single frame whenever both dirty lights were points -
      // a six-fold overshoot of a budget whose entire purpose is to stop exactly that spike.
      var cost = slotFaceCost(dirty[d]);
      // Always allow the first update through even if it alone exceeds the budget: a point light
      // costs 6, so a budget of 2 would otherwise starve it forever and it would never shadow.
      if (ls.updatesThisFrame > 0 && ls.updatesThisFrame + cost > budget) continue;
      // everRendered guards the FIRST render: throttling that would make a new shadow fade in
      // several frames after the light appears, which looks far worse than the cost it saves.
      var interval = updateIntervalFor(ls, dirty[d].__lightRecord);
      if (interval > 1 && dirty[d].everRendered &&
          (ls.frame - (dirty[d].lastUpdateFrame || 0)) < interval) continue;
      if (dirty[d].owned) {
        // Owned slots render HERE and now, synchronously. The native path instead raises a flag and
        // lets Three's shadow pass pick it up during the main render, which is why its
        // everRendered had to be inferred afterwards from needsUpdate having been consumed.
        if (!renderOwnedSlot(runtimeScene, ls, dirty[d], dirty[d].__ownedLight)) continue;
      } else {
        dirty[d].light.shadow.needsUpdate = true;
      }
      dirty[d].requested = true;
      dirty[d].renderedKey = dirty[d].ownerKey;
      dirty[d].lastUpdateFrame = ls.frame;
      dirty[d].age = 0;
      ls.updatesThisFrame += cost;
    }

    ls.mappedCount = chosen.length;
    // Push the freshly bound slots to every material now, not next frame: syncing before the
    // slots are assigned leaves the maps unbound for a frame and the first shadow never appears.
    syncLocalShadowUniforms(state);
  }

  function syncLocalShadowUniforms(state, uniforms) {
    var ls = state.localShadows;
    function write(u) {
      if (!u || !u.uAlLocalParams) return;
      if (u.uAlVsmBleed) u.uAlVsmBleed.value = ls ? ls.vsmLightBleed : 0.3;
      for (var i = 0; i < LOCAL_SHADOW_SLOTS; i++) {
        var slot = ls && ls.slots[i];
        // everRendered is the load-bearing half: an allocated-but-never-drawn map is zeros,
        // and zeros mean 'fully shadowed' to the comparison. Absent must read as unshadowed.
        var owned = !!(slot && slot.owned);
        var live = owned
          ? !!(slot.live && slot.everRendered && slot.target)
          : !!(slot && slot.live && slot.everRendered &&
               slot.light && slot.light.shadow && slot.light.shadow.map);
        var p = u.uAlLocalParams.value[i];
        var k = u.uAlLocalKind ? u.uAlLocalKind.value[i] : null;
        if (live && owned) {
          // VSM binds a DIFFERENT texture to the same sampler: moments, not packed depth. The two
          // are indistinguishable to the sampler and produce a plausible-looking wrong image if
          // confused, so kind.x carries which one is bound rather than the shader inferring it.
          var useVsm = !!(slot.vsm && slot.vsmReady && !slot.isPoint);
          // Releasing it matters: a 1024 moments map is 4 MB, and a light switched back to PCF
          // would otherwise hold one for the rest of the scene's life.
          if (!useVsm && slot.vsm) { slot.vsm.dispose(); slot.vsm = null; }
          // Same four things the native path supplies, produced by our own pass instead.
          u['uAlLocalMap' + i].value = useVsm ? slot.vsm.texture : slot.target.texture;
          u['uAlLocalMatrix' + i].value = slot.matrix;
          p.set(slot.bias, slot.normalBias, slot.radius || 1, 1);
          u.uAlLocalMapSize.value = slot.mapSize;
          if (k) k.set(useVsm ? 2 : (slot.isPoint ? 1 : 0), slot.near, slot.far, slot.mapSize);
        } else if (live) {
          u['uAlLocalMap' + i].value = slot.light.shadow.map.texture;
          // For BOTH types this is the right matrix: a spot's is world -> shadow UV, and
          // PointLightShadow sets its own to a pure translation by -lightPosition, which is
          // exactly the light-to-fragment vector the cube lookup needs.
          u['uAlLocalMatrix' + i].value = slot.light.shadow.matrix;
          p.set(slot.light.shadow.bias, slot.light.shadow.normalBias,
                slot.light.shadow.radius || 1, 1);
          u.uAlLocalMapSize.value = slot.light.shadow.mapSize.x;
          if (k) k.set(slot.isPoint ? 1 : 0, slot.light.shadow.camera.near,
                       slot.light.shadow.camera.far, slot.light.shadow.mapSize.x);
        } else {
          p.set(0, 0, 1, 0);
          if (k) k.set(0, 1, 1000, 1024);
        }
      }
    }
    if (uniforms) write(uniforms);
    else state.hookedMaterials.forEach(function (mat) { write(mat.__alUniforms); });
  }

  function setShadowMode(scene, mode) {
    var state = stateOf(scene), c = shadowState(state);
    var names = { auto: 'Auto', off: 'Off', native: 'Native' };
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
    if (options.sunShadows !== undefined) setSunShadows(scene, options.sunShadows);
    if (options.mode !== undefined) setShadowMode(scene, options.mode);
  }

  // Cascades, the distance field, or nothing. Independent of how local lights shadow, which is
  // what the old combined mode enum could not express without naming every pairing.
  function setSunShadows(scene, method) {
    var state = stateOf(scene), c = shadowState(state);
    var names = { cascades: 'Cascades', distancefield: 'DistanceField', off: 'Off' };
    var canonical = names[String(method).toLowerCase()];
    if (!canonical) return false;
    if (canonical !== c.sunShadows) { disposeCSM(state); c.sunShadows = canonical; }
    return true;
  }

  // Applies the scene-wide shadow settings the manager owns, for every method - not just CSM.
  // Picking a method in one panel and then hunting for its tuning in event actions was the gap
  // this closes: the manager is the single place scene shadow configuration lives.
  function applySceneShadowSettings(scene, options) {
    if (!options) return;
    var state = stateOf(scene);
    if (options.maxShadowedLights !== undefined)
      state.maxShadowedLights = Math.max(0, Math.floor(options.maxShadowedLights));
    if (options.pointShadowDistance !== undefined)
      state.pointShadowDistance = Math.max(0.0, options.pointShadowDistance);
    if (options.sdfSunSoftness !== undefined)
      state.sdfSunSoftness = Math.max(0.1, options.sdfSunSoftness);
    if (options.sdfHitEps !== undefined)
      state.sdfHitEps = Math.max(0.001, options.sdfHitEps);
    if (options.sdfNormalBias !== undefined)
      state.sdfNormalBias = Math.max(0.0, options.sdfNormalBias);
    if (options.contactShadows !== undefined) contactState(state).enabled = !!options.contactShadows;
    if (options.contactStrength !== undefined) contactState(state).strength = clamp(Number(options.contactStrength) || 0, 0, 1);
    if (options.contactDistance !== undefined) contactState(state).distance = Math.max(1, Number(options.contactDistance) || 1);
    if (options.contactSteps !== undefined) contactState(state).steps = clamp(Math.floor(options.contactSteps), 1, 32);
    if (options.contactThickness !== undefined) contactState(state).thickness = Math.max(1, Number(options.contactThickness) || 1);
    if (options.sdfBoundsMode !== undefined)
      state.sdfBoundsMode = options.sdfBoundsMode === 'Explicit' ? 'Explicit' : 'AutoScene';
    if (options.sdfAutoPadding !== undefined)
      state.sdfAutoPadding = Math.max(0, Number(options.sdfAutoPadding) || 0);
    if (options.sdfMaxExtent !== undefined)
      state.sdfMaxExtent = Math.max(1, Number(options.sdfMaxExtent) || 1);
    var ls = localShadowState(state);
    if (options.maxShadowMappedLights !== undefined)
      ls.maxLights = clamp(Math.floor(options.maxShadowMappedLights), 0, LOCAL_SHADOW_SLOTS);
    if (options.localShadowBackend !== undefined) {
      var wanted = String(options.localShadowBackend) === 'Owned' ? 'Owned' : 'Native';
      if (ls.backend !== wanted) {
        // Switching backend invalidates every slot: the two produce different objects entirely.
        for (var si = 0; si < ls.slots.length; si++) {
          var sl = ls.slots[si];
          if (!sl) continue;
          if (sl.owned) disposeOwnedSlot(sl); else disposeLocalSlotLight(sl);
          sl.owned = false; sl.live = false; sl.ownerKey = ''; sl.renderedKey = '';
          sl.everRendered = false;
        }
        ls.slots.length = 0;
        ls.backend = wanted;
      }
    }
    if (options.maxShadowMapUpdatesPerFrame !== undefined)
      ls.maxUpdatesPerFrame = Math.max(1, Math.floor(options.maxShadowMapUpdatesPerFrame));
    if (options.maxShadowMapUpdateInterval !== undefined)
      ls.maxUpdateInterval = clamp(Math.floor(options.maxShadowMapUpdateInterval), 1, 60);
    // AFTER the backend, deliberately: VSM requires owning the depth pass, so when both are set in
    // one call the filter has the last word rather than being silently overridden by field order.
    if (options.localShadowFilter !== undefined) setLocalShadowFilter(scene, options.localShadowFilter);
    if (options.vsmBlurRadius !== undefined)
      ls.vsmBlurRadius = clamp(Number(options.vsmBlurRadius) || 0, 0, 16);
    if (options.vsmLightBleed !== undefined)
      ls.vsmLightBleed = clamp(Number(options.vsmLightBleed) || 0, 0, 0.94);
  }

  /**
   * PCF or VSM, for the local shadow maps.
   *
   * Selecting VSM FORCES the Owned depth backend, and does so loudly rather than silently failing.
   * The moments have to be produced from a depth map we control: the native pass renders its maps
   * during the main render, after this code has run, so a native VSM map would always be one frame
   * stale - a moving caster's shadow would trail its PCF equivalent by a frame, which reads as a
   * lag bug rather than a filter choice.
   */
  function setLocalShadowFilter(scene, filter) {
    var state = stateOf(scene), ls = localShadowState(state);
    var wanted = String(filter) === 'VSM' ? 'VSM' : 'PCF';
    // The backend is NOT forced here any more. A light on Auto resolves to this value, but a light
    // may also ask for VSM on its own while the scene default stays PCF - so the decision belongs
    // where the lights are actually known, in updateLocalShadowMaps.
    if (ls.filter === wanted) return true;
    ls.filter = wanted;
    // Every slot's bound texture changes identity (moments vs packed depth), so nothing cached
    // survives the switch.
    for (var i = 0; i < ls.slots.length; i++) {
      var sl = ls.slots[i];
      if (!sl) continue;
      sl.renderedKey = ''; sl.everRendered = false; sl.vsmReady = false;
    }
    return true;
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
      applySceneShadowSettings(scene, record.options);
      refreshTextureUnitBudget(stateOf(scene), scene);
      return true;
    }
    if (c.manager === behavior) {
      configureCSM(scene, record.options);
      applySceneShadowSettings(scene, record.options);
      refreshTextureUnitBudget(stateOf(scene), scene);
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

  /* ================================================= Owned cascade depth rendering ====
   *
   * WHY THIS STOPPED BORROWING THREE'S LIGHTS.
   *
   * Each cascade used to be a real DirectionalLight with castShadow = true. Three rendered its
   * depth map and declared directionalShadowMap[N] for it; this extension then declared
   * uAlCSMMap<i> to sample THE SAME textures itself. Three cascades therefore consumed SIX
   * fragment texture units to carry three maps - measured, not assumed.
   *
   * That is the identical duplication the Owned local-shadow backend removed for spot lights, and
   * the fix is the same one: own the depth pass, so no light exists for Three to declare a sampler
   * for. The CONSUMER is unchanged - Three's getShadow() reads a packed-depth map either way - so
   * this replaces the producer only, which is what makes it verifiable against the existing
   * cascade tests rather than a rewrite of the shading.
   *
   * Cost: three cascades now take three units instead of six, and the number of depth passes per
   * frame is unchanged, because Three was already rendering exactly these three maps.
   */
  function csmDepthMaterial(c) {
    if (!c.depthMaterial) {
      // RGBADepthPacking, because the shader unpacks with unpackRGBAToDepth inside getShadow.
      c.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      c.depthMaterial.side = THREE.BackSide;
    }
    return c.depthMaterial;
  }

  function ensureCascade(c, index, mapSize) {
    var cascade = c.cascades[index];
    if (!cascade) cascade = c.cascades[index] = { camera: null, target: null, matrix: null, rendered: false };
    var size = Math.max(64, Math.floor(mapSize || 1024));
    if (cascade.target && (cascade.target.width !== size || cascade.target.height !== size)) {
      cascade.target.dispose(); cascade.target = null;
    }
    if (!cascade.target) {
      cascade.target = new THREE.WebGLRenderTarget(size, size, {
        // NEAREST. A packed depth is three bytes of one number; interpolating them yields a depth
        // that is not between the two it came from.
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        depthBuffer: true, stencilBuffer: false,
      });
      cascade.target.texture.generateMipmaps = false;
      cascade.rendered = false;
    }
    if (!cascade.camera) cascade.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    if (!cascade.matrix) cascade.matrix = new THREE.Matrix4();
    cascade.size = size;
    return cascade;
  }

  /** Render one cascade's depth map. Returns true if it drew. */
  function renderCascadeDepth(renderer, root, c, cascade) {
    if (!renderer || !root || !cascade.target) return false;
    // A renderer that cannot save and restore its own target is not one we may render through.
    // The unit tests drive updateCSM with a stub renderer to exercise the cascade FITTING maths
    // without a GL context; skipping here leaves cascade.rendered false, so c.ready stays false
    // and the shader reads "no cascades" rather than sampling an undrawn, all-zero map - which
    // would mean fully shadowed. The real path is covered by the WebGL cascade tests.
    if (typeof renderer.getRenderTarget !== 'function' ||
        typeof renderer.setRenderTarget !== 'function' ||
        typeof renderer.getViewport !== 'function' ||
        typeof renderer.render !== 'function') return false;

    // Only CASTERS may write depth. scene.overrideMaterial ignores castShadow entirely, so without
    // this every receiver writes into the map as well and the scene self-shadows into darkness.
    var hidden = [];
    root.traverse(function (node) {
      if (node.isMesh && node.visible && !node.castShadow) { node.visible = false; hidden.push(node); }
    });

    var savedRenderer = captureRendererState(renderer);
    var previousOverride = root.overrideMaterial;
    renderer.shadowMap.enabled = false;      // our pass must not recurse into Three's shadow pass

    // WHITE is depth = FAR once unpacked. Left at the scene's clear colour - black in most scenes -
    // every texel no geometry covers unpacks to depth 0, meaning "an occluder on the near plane",
    // and every fragment outside a caster's silhouette reads as shadowed.
    renderer.setClearColor(0xffffff, 1.0);
    try {
      root.overrideMaterial = csmDepthMaterial(c);
      // NO setViewport HERE. setRenderTarget already sets the active viewport to the target's
      // own (0,0,width,height); calling setViewport as well additionally overwrites the
      // renderer's PERSISTENT viewport - the one the main render and the GDevelop scene editor
      // use - which is the only reason an off-screen pass can disturb the frame that follows.
      renderer.setRenderTarget(cascade.target);
      renderer.clear();
      renderer.render(root, cascade.camera);
    } finally {
      root.overrideMaterial = previousOverride;
      restoreRendererState(renderer, savedRenderer);
      for (var h = 0; h < hidden.length; h++) hidden[h].visible = true;
    }

    // [-1,1] clip -> [0,1] texture, folded in here exactly as Three folds it into shadow.matrix,
    // because the shader's getShadow does only the perspective divide on the strength of that.
    cascade.matrix.copy(biasRemap());
    cascade.matrix.multiply(cascade.camera.projectionMatrix);
    cascade.matrix.multiply(cascade.camera.matrixWorldInverse);
    cascade.rendered = true;
    return true;
  }

  function updateCSM(scene, camera) {
    var state = stateOf(scene), c = shadowState(state), root = getThreeScene(scene);
    if (!root || !root.traverse || !THREE.DirectionalLight || !camera.projectionMatrixInverse) return;
    // How the Sun is shadowed is its own choice now, independent of how local lights are.
    var wantsMaps = c.mode === 'Auto' && c.sunShadows === 'Cascades' &&
      (!state.textureUnitBudget || state.textureUnitBudget.csm !== false);
    if (!wantsMaps && c.lights.length) disposeCSM(state);
    // 'Off' deliberately means NO shadows in this scene, native Sun included - that is existing,
    // tested behaviour. 'Native' is the mode that hands shadowing back to GDevelop entirely: the
    // clustered light loop still runs, but the engine's own lights and their shadow checkboxes are
    // left completely untouched.
    var managesSun = c.mode !== 'Native';
    var sun = null;
    root.traverse(function (node) {
      if (!sun && node.isDirectionalLight && !node.__alCascade && node.visible && node.intensity > 0) sun = node;
    });
    if (c.sun && c.sun !== sun) disposeCSM(state);
    if (!sun) { if (c.lights.length) disposeCSM(state); return; }

    // In 'Off' the extension must leave GDevelop's own shadow system completely alone, including
    // the native Sun's castShadow flag. Disabling it here unconditionally meant 'Off' silently
    // switched the engine's own Sun shadows off too, so there was no way to combine clustered
    // lighting with stock GDevelop shadows.
    if (!managesSun) {
      // Restore whatever the author set, then stay out of the way.
      if (c.sun) { c.sun.castShadow = c.savedSunShadow; c.sun = null; }
      if (c.lights.length) disposeCSM(state);
      return;
    }

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
    // No cascade lights are created any more; see renderCascadeDepth above. If an older runtime
    // left some in the scene (editor hot reload), clear them out so Three stops declaring their
    // shadow samplers.
    if (c.lights.length) disposeCSM(state);
    if (c.cascades.length !== c.count) {
      c.cascades.forEach(function (cascade) { if (cascade.target) cascade.target.dispose(); });
      c.cascades.length = 0;
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
      var cascade = ensureCascade(c, i, c.mapSize);
      // WORLD space, not root-local. The old DirectionalLight was a child of the mirrored scene
      // root, so its position had to be converted through worldToLocal; our camera has no parent,
      // so converting would mirror it a second time and put the cascade on the wrong side of Y.
      var cam = cascade.camera;
      cam.up.copy(up);
      cam.left=-half; cam.right=half; cam.top=half; cam.bottom=-half;
      cam.near=0.1; cam.far=2*radius+2*margin;
      cam.position.copy(position);
      cam.lookAt(target.x, target.y, target.z);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      renderCascadeDepth(renderer, root, c, cascade);
      c.ranges.push({corners:corners,half:half,texel:texel,center:localCenter.clone(),orientation:orientation.clone()});
    }
    c.near = near; c.far = far;
    syncCSMUniforms(state);
  }

  function syncCSMUniforms(state, uniforms) {
    var c = shadowState(state);
    // everRendered is load-bearing: an allocated-but-never-drawn map is zeros, and zeros mean
    // "fully shadowed" to the comparison, so absent must read as unshadowed rather than black.
    c.ready = c.cascades.length === c.count &&
      c.cascades.every(function (cascade) { return !!(cascade && cascade.target && cascade.rendered); });
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
        var cascade = c.cascades[i];
        if (!u['uAlCSMMap'+i] || !cascade) continue;
        u['uAlCSMMap'+i].value = (cascade.target && cascade.rendered) ? cascade.target.texture : null;
        u['uAlCSMMatrix'+i].value = cascade.matrix;
      }
    }
    if (uniforms) write(uniforms);
    else state.hookedMaterials.forEach(function (mat) { write(mat.__alUniforms); });
  }

  /**
   * Our own cascade PCF sampler.
   *
   * This used to call Three's getShadow(). That worked only by accident: getShadow is declared
   * inside <shadowmap_pars_fragment>, which Three emits ONLY when the scene contains a
   * shadow-casting light. The cascades used to BE shadow-casting DirectionalLights, so the chunk
   * was always there. Owning the cascade depth pass removed those lights - and with them the
   * declaration - so every cascade material failed to link with "'getShadow' : no matching
   * overloaded function found", while the cascade maps themselves rendered perfectly.
   *
   * Owning the producer means owning the consumer too: depending on Three emitting a chunk for a
   * light we no longer create is precisely the coupling this change exists to remove.
   *
   * MUST be injected after <packing>, which declares unpackRGBAToDepth.
   */
  function csmShadowHelper() {
    return [
      '  float alCsmTap(sampler2D map, vec2 uv, float compare) {',
      '    // Outside the map is UNSHADOWED. Returning 0 here would draw a hard black rectangle',
      '    // wherever a cascade does not cover, which reads as geometry rather than as a bug.',
      '    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;',
      '    return step(compare, unpackRGBAToDepth(texture2D(map, uv)));',
      '  }',
      '  float alCsmShadow(sampler2D map, vec2 mapSize, float bias, float radius, vec4 coord) {',
      '    // The matrix already folds in the [-1,1] -> [0,1] remap, so this is ONLY the divide.',
      '    vec3 p = coord.xyz / coord.w;',
      '    if (p.z > 1.0 || p.z < 0.0) return 1.0;',
      '    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;',
      '    float compare = p.z + bias;',
      '    vec2 texel = vec2(max(radius, 0.0)) / max(mapSize, vec2(1.0));',
      '    float sum = 0.0;',
      '    for (int dy = -1; dy <= 1; dy++) {',
      '      for (int dx = -1; dx <= 1; dx++) {',
      '        sum += alCsmTap(map, p.xy + vec2(float(dx), float(dy)) * texel, compare);',
      '      }',
      '    }',
      '    return sum / 9.0;',
      '  }',
    ].join('\n');
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
      var sample='alCsmShadow(uAlCSMMap'+i+',vec2(uAlCSMSize),uAlCSMBias,uAlCSMSoftness,uAlCSMMatrix'+i+'*vec4(alP,1.0))';
      lines.push((i ? 'else ' : '')+'if (alDepth <= uAlCSMSplits['+i+']) {');
      lines.push('alShadow = '+sample+';');
      var next=i<count-1 ? 'alCsmShadow(uAlCSMMap'+(i+1)+',vec2(uAlCSMSize),uAlCSMBias,uAlCSMSoftness,uAlCSMMatrix'+(i+1)+'*vec4(alP,1.0))' : '1.0';
      lines.push('float alWidth = max(0.0001,uAlCSMBlend*(uAlCSMSplits['+i+']-'+(i?'uAlCSMSplits['+(i-1)+']':'uAlCSMNear')+'));');
      lines.push('if (uAlCSMBlend > 0.0) alShadow = mix(alShadow,'+next+',smoothstep(uAlCSMSplits['+i+']-alWidth,uAlCSMSplits['+i+'],alDepth));','}');
    }
    var maxSplit = 'uAlCSMSplits[' + (count - 1) + ']';
    lines.push('float alCSMFadeStart = ' + maxSplit + ' * 0.85;');
    lines.push('if (alDepth > alCSMFadeStart && alDepth <= ' + maxSplit + ') {');
    lines.push('  alShadow = mix(alShadow, 1.0, smoothstep(alCSMFadeStart, ' + maxSplit + ', alDepth));');
    lines.push('}');
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

  // Squared distance from a 2D point to a segment. Kept scalar because this runs inside the
  // clustered broadphase and allocating Vector2 objects here would create thousands per frame.
  function pointSegmentDistanceSq2D(px, py, ax, ay, bx, by) {
    var abx = bx - ax, aby = by - ay;
    var denom = abx * abx + aby * aby;
    var t = denom > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / denom : 0;
    t = clamp(t, 0, 1);
    var dx = px - (ax + abx * t);
    var dy = py - (ay + aby * t);
    return dx * dx + dy * dy;
  }

  /**
   * Conservative finite-cone versus sphere intersection.
   *
   * Rotating around the cone axis reduces this to the distance between (axial, radial) and the
   * triangle bounded by the apex, axis, base cap and cone side. Cluster AABBs are represented by
   * their enclosing sphere, so this can admit a boundary cluster but can never reject one that the
   * spotlight may illuminate. That is exactly the asymmetry shadow reservation needs.
   */
  function sphereIntersectsFiniteCone(cx, cy, cz, sphereRadius,
      apexX, apexY, apexZ, axisX, axisY, axisZ, height, tanHalfAngle) {
    var mx = cx - apexX, my = cy - apexY, mz = cz - apexZ;
    var axial = mx * axisX + my * axisY + mz * axisZ;
    var radialSq = Math.max(0, mx * mx + my * my + mz * mz - axial * axial);
    var radial = Math.sqrt(radialSq);
    var baseRadius = height * tanHalfAngle;

    // Centre already lies inside the solid cone.
    if (axial >= 0 && axial <= height && radial <= axial * tanHalfAngle) return true;

    var distanceSq = Math.min(
      pointSegmentDistanceSq2D(axial, radial, 0, 0, height, 0),
      pointSegmentDistanceSq2D(axial, radial, height, 0, height, baseRadius),
      pointSegmentDistanceSq2D(axial, radial, 0, 0, height, baseRadius)
    );
    return distanceSq <= sphereRadius * sphereRadius;
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
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = runtimeScene.getLayer('');
    var lr = layer && layer.getRenderer ? layer.getRenderer() : null;
    if (!lr) return null;
    return lr.getThreeScene ? lr.getThreeScene() : null;
  }

  /* ------------------------------------------------------------- Fragment sampler budget */

  // Every property here adds a fragment sampler to Three's Standard/Physical material variant
  // when it is populated. Displacement is deliberately absent: it is sampled by the vertex shader
  // and is governed by MAX_VERTEX_TEXTURE_IMAGE_UNITS, not the fragment limit addressed here.
  var FRAGMENT_MAP_PROPERTIES = [
    'map', 'alphaMap', 'aoMap', 'lightMap', 'emissiveMap', 'bumpMap', 'normalMap',
    'roughnessMap', 'metalnessMap', 'envMap', 'clearcoatMap', 'clearcoatRoughnessMap',
    'clearcoatNormalMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap',
    'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'specularMap',
    'specularColorMap', 'specularIntensityMap', 'anisotropyMap'
  ];

  function materialFragmentSamplerCount(material, sceneHasEnvironment) {
    if (!material || !material.isMeshStandardMaterial) return 0;
    var count = 0;
    for (var i = 0; i < FRAGMENT_MAP_PROPERTIES.length; i++) {
      var key = FRAGMENT_MAP_PROPERTIES[i];
      if (material[key]) count++;
    }
    // A scene environment activates USE_ENVMAP even when material.envMap itself is null.
    if (sceneHasEnvironment && !material.envMap) count++;
    return count;
  }

  function scanSceneSamplerPressure(runtimeScene) {
    var root = getThreeScene(runtimeScene);
    var result = { material: 0, nativeShadows: 0, hasSun: false, sunNativeShadow: 0 };
    if (!root || !root.traverse) return result;
    var sceneHasEnvironment = !!root.environment;
    root.traverse(function (node) {
      if (node && node.isMesh && node.material) {
        var materials = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < materials.length; i++) {
          result.material = Math.max(
            result.material,
            materialFragmentSamplerCount(materials[i], sceneHasEnvironment)
          );
        }
      }
      // AdvancedLighting's own CSM and Native-local lights are accounted below as paired costs:
      // one stock Three sampler plus one sampler declared by our injection. Do not count them here.
      if (node && node.visible !== false && node.castShadow &&
          (node.isDirectionalLight || node.isSpotLight || node.isPointLight) &&
          !node.__alCascade && !node.__alLocalShadow) {
        result.nativeShadows++;
      }
      // CSM takes over the first visible, positive-intensity DirectionalLight and disables its
      // stock shadow. Record that replacement so the budget charges CSM's net cost, and do not
      // reserve six cascade samplers in a scene that has no Sun at all.
      if (!result.hasSun && node && node.isDirectionalLight && !node.__alCascade &&
          node.visible !== false && node.intensity > 0) {
        result.hasSun = true;
        result.sunNativeShadow = node.castShadow ? 1 : 0;
      }
    });
    return result;
  }

  function fragmentTextureUnitLimit(state, runtimeScene) {
    if (state.__fragmentTextureUnitLimit) return state.__fragmentTextureUnitLimit;
    var units = 16; // WebGL2's guaranteed floor is the safe fallback when the context is late.
    try {
      var renderer = runtimeScene ? threeRendererOf(runtimeScene) : null;
      var gl = renderer && renderer.getContext ? renderer.getContext() : null;
      if (gl) units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || units;
    } catch (e) {}
    state.__fragmentTextureUnitLimit = units;
    return units;
  }

  /**
   * Select the shader features that fit this scene's most texture-heavy standard material.
   *
   * This is intentionally scene-wide. Three's native shadow arrays are sized per render, so a
   * hidden fallback only on one material cannot remove the shadow samplers from other materials.
   * Explicitly attached features (probes, SDF and contact shadows) are admitted before the default
   * CSM path; local maps come last because they have the largest fixed sampler block. The result is
   * graceful feature loss with a warning, never a program-link failure that blanks the scene.
   */
  function refreshTextureUnitBudget(state, runtimeScene) {
    runtimeScene = runtimeScene || state.runtimeScene;
    if (!runtimeScene) return state.textureUnitBudget || null;
    state.runtimeScene = runtimeScene;

    var limit = fragmentTextureUnitLimit(state, runtimeScene);
    var pressure = scanSceneSamplerPressure(runtimeScene);
    var c = shadowState(state);
    var ls = localShadowState(state);
    var override = state.__textureBudgetOverride || null; // deterministic internal test seam

    // Cluster data, grid and index textures are the non-optional core of this extension.
    var used = 3 + pressure.material + pressure.nativeShadows;
    var requestedProbes = state.receivers && state.receivers.size > 0;
    var requestedSdf = c.mode === 'Auto' && !!(
      state.sdfVolume && state.sdfVolume.texture && state.sdfVolume.isBaked);
    var requestedContact = !!(state.contact && state.contact.enabled);
    var requestedCsm = c.mode === 'Auto' && c.sunShadows === 'Cascades' && pressure.hasSun;

    function admit(name, requested, cost) {
      var forcedOn = !!(override && override[name] === true);
      var effectiveRequest = requested || forcedOn;
      var allowed = !effectiveRequest || used + cost <= limit;
      if (override && override[name] !== undefined) allowed = !!override[name];
      if (effectiveRequest && allowed) used += cost;
      return allowed;
    }

    var probes = admit('probes', requestedProbes, 2);
    var sdf = admit('sdf', requestedSdf, 1);
    var contact = admit('contact', requestedContact, 1);

    // ONE unit per cascade. This used to be two: the cascades were real DirectionalLights, so
    // Three declared directionalShadowMap[N] for them AND this extension declared uAlCSMMap<i> for
    // the same textures. The cascade depth pass is owned now, so only our sampler is declared.
    //
    // The native Sun's own shadow sampler is still subtracted, because taking the Sun over sets its
    // castShadow to false: `used` counted it above, and CSM removes it. The net cost of cascades is
    // therefore count - 1 on a scene whose Sun was already casting.
    var csmCost = Math.max(0, c.count - pressure.sunNativeShadow);
    var csm = admit('csm', requestedCsm, csmCost);

    // Four custom samplers are compiled as one fixed block. Native adds one Three shadow sampler
    // per possible live slot; Owned removes that duplication for spots, but point maps still fall
    // back to Native, so reserve one duplicate per registered point-light candidate.
    var pointCandidates = 0;
    if (ls.backend === 'Owned' && state.lights) {
      state.lights.forEach(function (light) {
        if (pointCandidates >= ls.maxLights || !light || !light.active || !light.castShadow) return;
        var technique = light.shadowTechnique || 'Auto';
        if (light.lightType === 'Point' && technique !== 'SDF' && technique !== 'None') {
          pointCandidates++;
        }
      });
    }
    var localCost = LOCAL_SHADOW_SLOTS +
      (ls.backend === 'Native' ? ls.maxLights : Math.min(ls.maxLights, pointCandidates));
    var localRequested = c.mode === 'Auto' && ls.maxLights > 0;
    var localMaps = admit('localMaps', localRequested, localCost);

    var next = {
      limit: limit,
      material: pressure.material,
      nativeShadows: pressure.nativeShadows,
      used: used,
      probes: probes,
      sdf: sdf,
      contact: contact,
      csm: csm,
      csmCost: csmCost,
      localMaps: localMaps,
      localCost: localCost
    };
    state.textureUnitBudget = next;
    state.__localMapsAffordable = localMaps;

    if (requestedCsm && !csm) {
      warnOnce('textureBudgetCSM',
        'This scene needs more than the GPU\'s ' + limit + ' fragment texture units. Sun cascades ' +
        'were disabled before shader compilation; clustered lighting and explicitly attached ' +
        'probe/SDF/contact features remain active. Use fewer material maps, DistanceField Sun ' +
        'shadows, or a GPU with a larger sampler limit.');
    }
    if (localRequested && !localMaps) {
      warnOnce('textureUnitBudget',
        'This scene cannot fit the ' + localCost + '-unit local shadow-map block inside the GPU\'s ' +
        limit + '-unit fragment sampler limit, so local shadow maps were disabled before shader ' +
        'compilation. Use the Owned depth renderer, reduce material maps, or use SDF/None for local ' +
        'lights.');
    }
    if (requestedContact && !contact) warnOnce('textureBudgetContact',
      'Contact shadows were disabled because this scene reached the fragment texture-unit limit.');
    if (requestedSdf && !sdf) warnOnce('textureBudgetSDF',
      'SDF shadows were disabled because this scene reached the fragment texture-unit limit.');
    if (requestedProbes && !probes) warnOnce('textureBudgetProbes',
      'Light probes were disabled because this scene reached the fragment texture-unit limit.');
    if (used > limit) warnOnce('textureBudgetCore',
      'The material and native GDevelop shadows already need about ' + used + ' fragment texture ' +
      'units, above this GPU\'s limit of ' + limit + '. AdvancedLighting disabled every optional ' +
      'sampler it could; reduce the material texture count or native shadow-casting lights.');
    return next;
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
        runtimeScene: runtimeScene,
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
        // Automatic bounds. AutoScene by default: hand-placing a box is the most-complained-about
        // setup step, and forgetting it fails silently. See ensureAutoSceneSDFVolume.
        // EXPLICIT by default, reverted from AutoScene 2026-09-12.
        //
        // Shipped on by default it broke a real project two ways at once: it created an SDF volume
        // where the scene previously had none, which added a sampler to an already-full budget and
        // took the fragment shader over MAX_TEXTURE_IMAGE_UNITS(16); and the bounds it chose were
        // 9602 x 9602 x 9602 world units at 128x128x32, a voxel size of 75 units, which is coarser
        // than most props and would have cast meaningless shadows even if it had linked.
        //
        // AutoScene is still available and still worth having - hand-placing a volume is a genuine
        // annoyance - but it has to earn being a default, and it has not yet.
        sdfBoundsMode: 'Explicit',    // AutoScene | Explicit
        sdfAutoPadding: 200.0,        // world units added around the fitted geometry
        sdfMaxExtent: 20000.0,        // refuse to auto-fit beyond this; voxels get useless
        // The real quality gate. Past this the conservative dilation swallows the ground itself.
        sdfMaxVoxelSize: 25.0,
        sdfAutoFitDone: false,
        sdfAutoVolume: null,
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
    '  // Shared by the SDF march and the local shadow-map lookup; declared here so neither',
    '  // feature has to own it and both can be enabled independently.',
    '  uniform mat4       uViewToWorld;',
    '  // Half a voxel diagonal - the radius the bake marks as SOLID around every surface.',
    '  // Declared unconditionally, like uViewToWorld above and for the same reason: the Sun',
    '  // hook lives outside the AL_SDF_SHADOWS guard, so a declaration inside it compiles',
    '  // fine on its own and then fails the moment the Sun path references it - taking the',
    '  // whole injection down and removing every shadow in the scene, not just this one.',
    '  uniform float      uSdfDilation;',
    '  // Contact shadows: ONE depth texture shared by every light, which is the entire point.',
    '  uniform sampler2D  uAlSceneDepth;',
    '  // x: strength, y: max march distance (world units), z: steps, w: occluder thickness',
    '  uniform vec4       uAlContact;',
    '  // Our own copy: Three declares projectionMatrix in the VERTEX prefix only, so naming it',
    '  // here does not resolve and the program fails to link with GL_INVALID_OPERATION.',
    '  uniform mat4       uAlProjection;',
    '  uniform mat4       uAlProjectionInverse;',
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
  /* ------------------------------------------------------- Local shadow maps (spot) */
  // One real depth map per shadow-mapped clustered light, rendered by Three's own WebGLShadowMap
  // from a zero-intensity native SpotLight. Unlike the SDF this handles MOVING casters, needs no
  // baked volume, and has no bounds beyond the light's own frustum.
  //
  // Three's getShadow() is reused rather than reimplemented: it performs the perspective divide,
  // applies the bias and does the PCF taps, and CSM already depends on it being in scope here.
  // FOUR, not eight. Raised to 8 at some point without checking it against the WebGL2 guaranteed
  // minimum of 16 fragment texture image units - and it does not fit.
  //
  // Each slot costs TWO units, not one: Three declares spotShadowMap[N] for our own slot lights,
  // and we declare uAlLocalMap<i> to sample the same maps ourselves. Eight slots is therefore 16
  // units on its own, before the cluster textures, the SDF volume, the cascades, or the material's
  // own maps. On hardware reporting exactly 16 - which is common, and is what the reporting user
  // has - the fragment shader fails to link and the whole scene renders black.
  //
  // The real fix is to stop borrowing Three's shadow pass (DEMAND_DRIVEN_SHADOWS_PLAN section 6),
  // which removes the native lights and halves this. Until then the count has to fit the floor.
  var LOCAL_SHADOW_SLOTS = 4;

  // Uniform declarations only. Safe to prepend ahead of the whole shader.
  function localShadowUniforms(count) {
    if (!count) return '';
    var lines = ['#ifdef AL_LOCAL_SHADOW_MAPS'];
    for (var i = 0; i < count; i++) {
      lines.push('  uniform sampler2D uAlLocalMap' + i + ';');
      lines.push('  uniform mat4      uAlLocalMatrix' + i + ';');
    }
    // x: depth bias, y: normal bias (world units), z: PCF radius, w: 1 when the slot is live
    lines.push('  uniform vec4 uAlLocalParams[' + count + '];');
    // x: 1 for a point light (cube atlas), 0 for a spot. y: camera near. z: camera far.
    // w: per-face map size, which for a point light is a quarter of the atlas width.
    lines.push('  uniform vec4 uAlLocalKind[' + count + '];');
    lines.push('  uniform float uAlLocalMapSize;');
    // Light-bleed reduction for VSM. Scene-wide rather than per-slot: it is a look control, and a
    // per-light value would let two lights disagree about how dark the same surface is.
    lines.push('  uniform float uAlVsmBleed;');
    lines.push('#endif');
    lines.push('');
    return lines.join(String.fromCharCode(10));
  }

  // The samplers, injected AFTER Three's chunk includes.
  //
  // They cannot be prepended with the uniforms: unpackRGBAToDepth comes from <packing>, which is
  // included further down the generated shader. Declaring a function that calls it before it exists
  // fails to compile with "no matching overloaded function found".
  //
  // We unpack depth ourselves rather than calling Three's getShadow/getPointShadow, so this does
  // not depend on NUM_SPOT_LIGHT_SHADOWS or NUM_POINT_LIGHT_SHADOWS being non-zero at compile time.
  // Those counts vary at runtime as slots are assigned, and a frame where none exists yet would
  // otherwise fail to link.
  // Injected AFTER Three's own chunks, never prepended.
  //
  // It calls unpackRGBAToDepth, which <packing> declares partway down the generated
  // shader. Prepending it puts the call before the declaration and the program fails to
  // link with a bare VALIDATE_STATUS false and an empty info log - which looks exactly
  // like a texture-unit overrun and sends you hunting the wrong thing. localShadowHelper
  // carries the same warning for the same reason.
  function contactShadowHelper() {
    return [
    '  #ifdef AL_CONTACT_SHADOWS',
    '  // Screen-space contact shadow. Marches from the shaded point toward the light, entirely',
    '  // in VIEW space, projecting each step to screen space to read the prepass depth. View',
    '  // space keeps it simple: the loop already has the view-space position and light',
    '  // direction, and projectionMatrix is a built-in Three uniform.',
    '  float alContactShadow(vec3 viewPos, vec3 viewNormal, vec3 viewL, float lightDist) {',
    '    float maxDist = min(uAlContact.y, lightDist);',
    '    int steps = int(uAlContact.z);',
    '    if (maxDist <= 0.01 || steps <= 0) return 1.0;',
    '    float stepLen = maxDist / float(steps);',
    '    // Lift the ray off its receiver. At a grazing camera angle, marching directly along a',
    '    // floor repeatedly samples that same floor through quantised depth texels; the resulting',
    '    // self-hits appear as long horizontal bars.',
    '    float surfaceBias = max(1.0, min(stepLen * 0.25, uAlContact.w * 0.10));',
    '    // Sub-step spatial jitter breaks coherent march boundaries without temporal shimmer.',
    '    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    '    vec3 p = viewPos + normalize(viewNormal) * surfaceBias +',
    '      viewL * stepLen * (0.5 + jitter);',
    '    float occlusion = 0.0;',
    '    for (int i = 0; i < 32; i++) {',
    '      if (i >= steps) break;',
    '      vec4 clip = uAlProjection * vec4(p, 1.0);',
    '      if (clip.w <= 0.0) break;',
    '      vec3 ndc = clip.xyz / clip.w;',
    '      vec2 uv = ndc.xy * 0.5 + 0.5;',
    '      // Off screen means no information, not no occluder. Stop rather than guess.',
    '      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;',
    '      float sceneZ = unpackRGBAToDepth(texture2D(uAlSceneDepth, uv));',
    '      // Compare in VIEW-SPACE DISTANCE, not window depth. Window depth is wildly',
    '      // non-linear: near the camera a tiny offset is a large delta and everything reads as',
    '      // occluded, which dims the whole frame instead of drawing a contact shadow.',
    '      // viewZ = P[3][2] / (ndcZ + P[2][2]), positive distance in front of the camera.',
    '      float ndcZ = sceneZ * 2.0 - 1.0;',
    '      float denom = ndcZ + uAlProjection[2][2];',
    '      if (abs(denom) > 1e-6) {',
    '        float sceneDist = uAlProjection[3][2] / denom;',
    '        float rayDist = -p.z;',
    '        // Reconstruct the sampled point and reject the receiver plane itself. Comparing only',
    '        // view distance cannot tell a real occluder from a neighboring texel on the same',
    '        // sloped floor; at grazing angles that mistake becomes the detached stripe pattern.',
    '        vec4 sceneViewH = uAlProjectionInverse * vec4(ndc.xy, ndcZ, 1.0);',
    '        vec3 sceneView = sceneViewH.xyz /',
    '          (abs(sceneViewH.w) > 1e-6 ? sceneViewH.w : 1e-6);',
    '        float receiverPlaneGap = abs(dot(sceneView - viewPos, normalize(viewNormal)));',
    '        // The bias has to clear the surface the ray started on. Without it the very first',
    '        // sample reads the origin surface as its own occluder - the same self-occlusion',
    '        // that made the SDF volume draw its own bounds.',
    '        float bias = max(1.0, stepLen * 0.20);',
    '        float gap = rayDist - sceneDist;',
    '        // A soft hit interval replaces the old binary first-hit result. That result exposed',
    '        // every discrete march step as a solid stripe, especially on shallow floors.',
    '        float soft = max(1.0, min(stepLen * 0.75, uAlContact.w * 0.20));',
    '        if (receiverPlaneGap > surfaceBias * 0.5) {',
    '          float thickness = max(uAlContact.w, bias + soft + 1.0);',
    '          float enter = smoothstep(bias, bias + soft, gap);',
    '          float leave = 1.0 - smoothstep(max(bias + soft, thickness - soft),',
    '            thickness, gap);',
    '          occlusion = max(occlusion, enter * leave);',
    '        }',
    '      }',
    '      p += viewL * stepLen;',
    '    }',
    '    return 1.0 - uAlContact.x * occlusion;',
    '  }',
    '  #endif',
    ].join('\n');
  }

  function localShadowHelper(count) {
    if (!count) return '';
    var lines = ['#ifdef AL_LOCAL_SHADOW_MAPS'];
    lines.push('  float alLocalTap(sampler2D map, vec2 uv, float compare) {');
    lines.push('    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;');
    lines.push('    return step(compare, unpackRGBAToDepth(texture2D(map, uv)));');
    lines.push('  }');
    lines.push('');
    // --- SPOT: one perspective map -------------------------------------------------------
    lines.push('  float alLocalPCF(sampler2D map, vec4 coord, float bias, float radius) {');
    lines.push('    // shadow.matrix already folds in the [-1,1] -> [0,1] bias, so this is ONLY the');
    lines.push('    // perspective divide. Remapping again here silently shifts every lookup.');
    lines.push('    vec3 p = coord.xyz / coord.w;');
    lines.push('    if (p.z > 1.0 || p.z < 0.0) return 1.0;');
    lines.push('    float compare = p.z + bias;');
    lines.push('    float texel = radius / max(uAlLocalMapSize, 1.0);');
    lines.push('    float sum = 0.0;');
    lines.push('    for (int dy = -1; dy <= 1; dy++) {');
    lines.push('      for (int dx = -1; dx <= 1; dx++) {');
    lines.push('        sum += alLocalTap(map, p.xy + vec2(float(dx), float(dy)) * texel, compare);');
    lines.push('      }');
    lines.push('    }');
    lines.push('    return sum / 9.0;');
    lines.push('  }');
    lines.push('');
    // --- SPOT, VARIANCE: one bilinear tap into a pre-blurred moments map -------------------
    // unpackRGBATo2Half comes from <packing>, which is why this helper is injected after it and
    // not prepended with the uniforms. Redeclaring it here would be a redefinition error.
    lines.push('  float alLocalVSM(sampler2D map, vec4 coord, float bias, float nearP, float farP) {');
    lines.push('    vec3 p = coord.xyz / coord.w;');
    lines.push('    if (p.z > 1.0 || p.z < 0.0) return 1.0;');
    lines.push('    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;');
    lines.push('    // The SAME linearisation the blur pass applied. Comparing a projected depth');
    lines.push('    // against linearised moments is not slightly off - it is a different unit.');
    lines.push('    float viewZ = perspectiveDepthToViewZ(p.z, nearP, farP);');
    lines.push('    float lin = clamp((-viewZ - nearP) / max(farP - nearP, 1e-4), 0.0, 1.0);');
    lines.push('    // bias is now in LINEAR light-space units, a fraction of the light radius,');
    lines.push('    // rather than the compressed projected units the PCF path uses.');
    lines.push('    float compare = lin + bias;');
    lines.push('    vec2 moments = unpackRGBATo2Half(texture2D(map, p.xy));');
    lines.push('    // Fully lit: the nearest occluder is behind us. No inequality needed.');
    lines.push('    if (compare <= moments.x) return 1.0;');
    lines.push('    // Chebyshev: P(depth >= compare) <= s2 / (s2 + d^2) bounds the LIT fraction.');
    lines.push('    // d > 0 is guaranteed by the early-out above, so the denominator cannot be 0.');
    lines.push('    float d = compare - moments.x;');
    lines.push('    float s2 = moments.y * moments.y;');
    lines.push('    float lit = s2 / (s2 + d * d);');
    lines.push('    // The bound is loose wherever two occluders straddle a receiver, which reads');
    lines.push('    // as light leaking through solid geometry. Rescaling crushes the low end of');
    lines.push('    // the probability at the cost of a harder penumbra.');
    lines.push('    float lo = clamp(uAlVsmBleed, 0.0, 0.94);');
    lines.push('    return clamp((lit - lo) / (0.95 - lo), 0.0, 1.0);');
    lines.push('  }');
    lines.push('');
    // --- POINT: six faces packed into one 4x2 atlas ---------------------------------------
    // Mirrors Three's cubeToUV. A point light's shadow is not a projection matrix at all: the
    // direction from light to fragment selects a cube face, and the comparison is on RADIAL
    // distance normalised between near and far, not on projected depth.
    lines.push('  vec2 alCubeToUV(vec3 v, float texelSizeY) {');
    lines.push('    vec3 absV = abs(v);');
    lines.push('    float scaleToCube = 1.0 / max(absV.x, max(absV.y, absV.z));');
    lines.push('    absV *= scaleToCube;');
    lines.push('    v *= scaleToCube * (1.0 - 2.0 * texelSizeY);');
    lines.push('    vec2 planar = v.xy;');
    lines.push('    float almostATexel = 1.5 * texelSizeY;');
    lines.push('    float almostOne = 1.0 - almostATexel;');
    lines.push('    if (absV.z >= almostOne) {');
    lines.push('      if (v.z > 0.0) planar.x = 4.0 - v.x;');
    lines.push('    } else if (absV.x >= almostOne) {');
    lines.push('      float signX = sign(v.x);');
    lines.push('      planar.x = v.z * signX + 2.0 * signX;');
    lines.push('    } else if (absV.y >= almostOne) {');
    lines.push('      float signY = sign(v.y);');
    lines.push('      planar.x = v.x + 2.0 * signY + 2.0;');
    lines.push('      planar.y = v.z * signY - 2.0;');
    lines.push('    }');
    lines.push('    return vec2(0.125, 0.25) * planar + vec2(0.375, 0.75);');
    lines.push('  }');
    lines.push('');
    lines.push('  float alLocalPointPCF(sampler2D map, vec3 lightToPos, float bias, float radius,');
    lines.push('                        float nearP, float farP, float faceSize) {');
    lines.push('    float dist = length(lightToPos);');
    lines.push('    if (dist > farP) return 1.0;');
    lines.push('    float compare = (dist - nearP) / max(farP - nearP, 1e-4) + bias;');
    lines.push('    vec3 dir = normalize(lightToPos);');
    lines.push('    float texelY = 1.0 / (max(faceSize, 1.0) * 2.0);');
    lines.push('    float off = radius * texelY;');
    lines.push('    float sum = 0.0;');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(-off, off, off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(-off, off, -off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(off, off, off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(off, off, -off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir, texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(-off, -off, off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(-off, -off, -off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(off, -off, off), texelY), compare);');
    lines.push('    sum += alLocalTap(map, alCubeToUV(dir + vec3(off, -off, -off), texelY), compare);');
    lines.push('    return sum / 9.0;');
    lines.push('  }');
    lines.push('');
    lines.push('  float alSampleLocalShadow(int slot, vec3 worldPos, vec3 worldNormal) {');
    for (var j = 0; j < count; j++) {
      lines.push('    ' + (j ? 'else ' : '') + 'if (slot == ' + j + ') {');
      lines.push('      vec4 sp = uAlLocalParams[' + j + '];');
      lines.push('      if (sp.w < 0.5) return 1.0;');
      lines.push('      vec4 kind = uAlLocalKind[' + j + '];');
      lines.push('      vec3 biased = worldPos + worldNormal * sp.y;');
      lines.push('      vec4 sc = uAlLocalMatrix' + j + ' * vec4(biased, 1.0);');
      // A uniform branch, not a shader permutation: every fragment of every draw takes the same
      // side, and switching filters therefore costs no recompile. Adding a define here would put
      // the recompile hitch back that the Owned backend exists to remove.
      lines.push('      if (kind.x > 1.5) {');
      lines.push('        return alLocalVSM(uAlLocalMap' + j + ', sc, sp.x, kind.y, kind.z);');
      lines.push('      }');
      lines.push('      if (kind.x > 0.5) {');
      // For a point light the matrix is a pure translation by -lightPos, so sc.xyz is the
      // light-to-fragment vector Three's own point path expects.
      lines.push('        return alLocalPointPCF(uAlLocalMap' + j + ', sc.xyz, sp.x, max(sp.z, 1.0),');
      lines.push('                               kind.y, kind.z, kind.w);');
      lines.push('      }');
      lines.push('      return alLocalPCF(uAlLocalMap' + j + ', sc, sp.x, max(sp.z, 1.0));');
      lines.push('    }');
    }
    lines.push('    return 1.0;');
    lines.push('  }');
    lines.push('#endif');
    lines.push('');
    return lines.join(String.fromCharCode(10));
  }

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
    '  #if defined(AL_SDF_SHADOWS) || defined(AL_LOCAL_SHADOW_MAPS)',
    '    vec3 wp = (uViewToWorld * vec4(geometryPosition, 1.0)).xyz;',
    '    vec3 nw = inverseTransformDirection(geometryNormal, viewMatrix);',
    '  #endif',
    '  #ifdef AL_SDF_SHADOWS',
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
    '      uint alShadowCode = uint(floor(shape.z));',
    '      // 0 = never shadows, 1 = shadow via the SDF march, 2+n = shadow map in slot n.',
    '      // Packed into the existing texel so the light record stays 16 floats wide.',
    '      int  alMapSlot = alShadowCode >= 2u ? int(alShadowCode) - 2 : -1;',
    '      #ifdef AL_LOCAL_SHADOW_MAPS',
    '        if (alMapSlot >= 0 && clDiffuseNdotL > 0.0) {',
    '          radiance *= alSampleLocalShadow(alMapSlot, wp, nw);',
    '        }',
    '      #endif',
    '      #ifdef AL_SDF_SHADOWS',
    '        float sdfShadowFactor = 1.0;',
    '        uint shadowBits = alShadowCode >= 1u ? 1u : 0u;',
    '        float lightShadowBias = fract(shape.z) * ' + SHADOW_BIAS_ENCODE_SCALE.toFixed(1) + ';',
    '        if (alMapSlot < 0 && shadowedSoFar < uMaxShadowedLights && (shadowBits & 1u) == 1u && clDiffuseNdotL > 0.0) {',
    '          vec3 Lw = inverseTransformDirection(clDiffuseL, viewMatrix);',
    '          // Start OUTSIDE the bake dilation, or the ray begins in solid space and returns a',
    '          // hit on its first sample - which shadows every lit fragment inside the volume and',
    '          // draws the box outline on the ground. lightShadowBias * voxelSize cannot do this:',
    '          // the bias defaults to 0.02 and voxelSize is the SMALLEST axis, while the solid',
    '          // band is half the voxel DIAGONAL.',
    '          vec3 localRo = wp + nw * max(max(lightShadowBias * uSdfParams.x, uSdfDilation * 1.05), 0.1);',
    '          float srcR = max(shape.w, 0.01);',
    '          float tMin = max(0.05,uSdfParams.y * uSdfParams.x);',
    '          float tMax = min(attenuationDistance, uPointShadowDistance);',
    '          if (tMax > tMin) {',
    '            float k = attenuationDistance / srcR;',
    '            sdfShadowFactor = sdfShadow(localRo, Lw, tMin, tMax, k, 32);',
    '            shadowedSoFar++;',
    '          }',
    '        }',
    '        radiance *= sdfShadowFactor;',
    '      #endif',
    '      #ifdef AL_CONTACT_SHADOWS',
    '      // Applied to EVERY light, whether or not it won a shadow-map slot. This is the',
    '      // half that does not scale with light count.',
    '      radiance *= alContactShadow(geometryPosition, geometryNormal, clDiffuseL, attenuationDistance);',
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
  /* The shader edit itself, registered ONCE with the shared chain and reused for every receiver.
   * Nothing may be captured from injectShaderOnMaterial's closure: a single registration serves
   * all materials, so every per-material value is read back from material.__alInjection here. */
  function alInjectShader(shader, material) {
    var inj = material.__alInjection;
    if (!inj) return;
    var state = inj.owner;
    var receiverRecord = inj.receiver;
    var wantProbes = inj.probes;
    var hasSDF = inj.sdf;
    var hasLocalMaps = !!inj.localMaps;
    var hasContact = !!inj.contact;
    var csmCount = inj.csmCount;
    var sdfSun = inj.sdfSun;
    var use3D = inj.use3D;

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
    delete shader.defines.AL_LOCAL_SHADOW_MAPS;
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
    if (hasContact) shader.defines.AL_CONTACT_SHADOWS = 1;
    if (hasLocalMaps) {
      shader.defines.AL_LOCAL_SHADOW_MAPS = 1;
      shader.uniforms.uAlLocalMapSize = { value: 1024 };
      shader.uniforms.uAlVsmBleed = { value: 0.3 };
      var localParams = [], localKind = [];
      for (var lsI = 0; lsI < LOCAL_SHADOW_SLOTS; lsI++) {
        shader.uniforms['uAlLocalMap' + lsI] = { value: null };
        shader.uniforms['uAlLocalMatrix' + lsI] = { value: new THREE.Matrix4() };
        localParams.push(new THREE.Vector4(0, 0, 1, 0));
        localKind.push(new THREE.Vector4(0, 1, 1000, 1024));
      }
      shader.uniforms.uAlLocalParams = { value: localParams };
      shader.uniforms.uAlLocalKind = { value: localKind };
      syncLocalShadowUniforms(state, shader.uniforms);
    }

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
    // Bound unconditionally, alongside its unconditional declaration in the cluster prelude.
    // Both the SDF march and the local shadow-map lookup reconstruct world position from it, and
    // binding it only under the SDF branch left it as an all-zero matrix in Maps mode — every
    // fragment then reported a world position of (0,0,0) and nothing ever sampled as shadowed.
    shader.uniforms.uViewToWorld = { value: state.viewToWorldMatrix || (THREE_OK ? new THREE.Matrix4() : null) };

    // --- SDF uniforms
    if (hasSDF) {
      shader.uniforms.uSdfVolume = { value: state.sdfVolume ? state.sdfVolume.texture : null };
      shader.uniforms.uSdfMin = { value: state.sdfVolume ? state.sdfVolume.threeMin : (THREE_OK ? new THREE.Vector3() : { x: 0, y: 0, z: 0 }) };
      shader.uniforms.uSdfSize = { value: state.sdfVolume ? state.sdfVolume.threeSize : (THREE_OK ? new THREE.Vector3(1, 1, 1) : { x: 1, y: 1, z: 1 }) };
      var vx = state.sdfVolume ? (state.sdfVolume.voxelSize || ((state.sdfVolume.maxX - state.sdfVolume.minX) / state.sdfVolume.resX)) : 10.0;
      var sunK = 1.0 / Math.tan((state.sdfSunSoftness || 1.8) * Math.PI / 180.0);
      shader.uniforms.uSdfParams = { value: (THREE_OK && THREE.Vector4) ? new THREE.Vector4(vx, state.sdfHitEps || 0.05, state.sdfNormalBias, sunK) : { x: vx, y: 0.05, z: 1.0, w: sunK } };
      shader.uniforms.uSdfDilation = { value: sdfVolumeDilation(state.sdfVolume) };
      shader.uniforms.uMaxShadowedLights = { value: state.maxShadowedLights || 4 };
      shader.uniforms.uPointShadowDistance = { value: state.pointShadowDistance || 800.0 };
    }

    // --- Contact shadow uniforms
    // Bound whenever the variant is compiled in. A declared-but-unbound sampler reads as texture
    // unit 0, which is whatever happened to be bound there - usually the albedo map, which would
    // unpack as noise and shadow at random.
    if (hasContact) {
      var cs = contactState(state);
      shader.uniforms.uAlSceneDepth = { value: cs.target ? cs.target.texture : null };
      shader.uniforms.uAlProjection = { value: THREE_OK ? new THREE.Matrix4() : null };
      shader.uniforms.uAlProjectionInverse = { value: THREE_OK ? new THREE.Matrix4() : null };
      shader.uniforms.uAlContact = { value: (THREE_OK && THREE.Vector4)
        ? new THREE.Vector4(cs.strength, cs.distance, cs.steps, cs.thickness)
        : { x: cs.strength, y: cs.distance, z: cs.steps, w: cs.thickness } };
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

    shader.fragmentShader = GLSL_CLUSTER_PRELUDE + '\n' + GLSL_PROBE_PRELUDE + '\n' + GLSL_SDF_PRELUDE + '\n' +
      (hasLocalMaps ? localShadowUniforms(LOCAL_SHADOW_SLOTS) + '\n' : '') + shader.fragmentShader;

    // The sampler goes AFTER Three's own chunks: it calls unpackRGBAToDepth, which <packing>
    // declares further down the generated shader. Prepending it fails to compile.
    if (hasContact) {
      var ctAnchor = '#include <packing>';
      if (shader.fragmentShader.indexOf(ctAnchor) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(
          ctAnchor, ctAnchor + '\n' + contactShadowHelper());
      } else {
        warnOnce('noPackingChunk', 'Material has no packing chunk, so contact shadows were ' +
          'skipped for it.');
      }
    }
    if (csmCount) {
      var csmAnchor = '#include <packing>';
      if (shader.fragmentShader.indexOf(csmAnchor) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(
          csmAnchor, csmAnchor + '\n' + csmShadowHelper());
      } else {
        warnOnce('noPackingChunkCSM', 'Material has no packing chunk, so Sun cascades were ' +
          'skipped for it.');
      }
    }
    if (hasLocalMaps) {
      var lsAnchor = '#include <shadowmap_pars_fragment>';
      if (shader.fragmentShader.indexOf(lsAnchor) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(
          lsAnchor, lsAnchor + '\n' + localShadowHelper(LOCAL_SHADOW_SLOTS));
      } else {
        warnOnce('noShadowChunk',
          'Material has no shadowmap_pars_fragment chunk, so local shadow maps were skipped for it.');
      }
    }
    var lightingHook = GLSL_FRAGMENT_HOOK;
    if ((sdfSun || csmCount) && THREE.ShaderChunk && THREE.ShaderChunk.lights_fragment_begin) {
      // Shadow each native directional contribution before Three evaluates its BRDF.
      var directionalAnchor = 'getDirectionalLightInfo( directionalLight, directLight );';
      var extraDirectional = [];
      if (csmCount) {
        extraDirectional.push(csmShadowCode(csmCount));
      } else if (sdfSun) {
        extraDirectional.push([
          '#ifdef AL_SDF_SHADOWS',
          '{', // Keep declarations scoped when Three unrolls multiple Suns.
          'vec3 alSunWorldPos = (uViewToWorld * vec4(geometryPosition, 1.0)).xyz;',
          'vec3 alSunNormal = inverseTransformDirection(geometryNormal, viewMatrix);',
          'vec3 alSunOrigin = alSunWorldPos + alSunNormal * max(max(uSdfParams.z * uSdfParams.x, uSdfDilation * 1.05), 0.1);',
          'vec3 alSunDirection = inverseTransformDirection(directLight.direction, viewMatrix);',
          'directLight.color *= sdfShadow(alSunOrigin, alSunDirection, max(0.05,uSdfParams.y * uSdfParams.x), length(uSdfSize), uSdfParams.w, 32);',
          '}',
          '#endif'
        ].join('\n'));
      }
      var nativeLighting = THREE.ShaderChunk.lights_fragment_begin.replace(directionalAnchor,
        directionalAnchor + '\n' + extraDirectional.join('\n'));
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
  }

  /* Band 100 (BASE SHADING). This replaces lights_fragment_begin wholesale, so it has to land
   * before any injector that modifies the surface inputs lighting reads. */
  function registerAdvancedLightingInjector() {
    var chain = gdjs.__m3dShaderChain;
    if (!chain || typeof chain.register !== 'function') return false;
    chain.register({
      id: 'advlight3d',
      chunk: 'lights_fragment_begin',
      order: 100,
      isActive: function (mat) { return !!(mat && mat.__alInjection); },
      key: function (mat) { return (mat && mat.__alInjection && mat.__alInjection.key) || ''; },
      inject: alInjectShader,
    });
    return true;
  }

  function injectShaderOnMaterial(material, state, receiverRecord) {
    if (!material) return false;

    var wantProbes = !!receiverRecord &&
      (!state.textureUnitBudget || state.textureUnitBudget.probes !== false);

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
    // cascades, NOT lights: cascade DirectionalLights no longer exist, so reading lights.length
    // here compiled every material with CSM0 - the cascade samplers were never declared and the
    // maps, which rendered perfectly, were simply never read. The frame looked exactly like a
    // broken depth pass.
    var csmCount = csm.cascades.length;
    var sdfSun = hasSDF && csm.sunShadows === 'DistanceField';
    // Choosing DistanceField without a baked volume removes the Sun shadow entirely - cascades are
    // torn down and there is no field to march. Silent, and indistinguishable from a bug.
    if (csm.sunShadows === 'DistanceField' && !hasSDF) {
      warnOnce('sunDFNoVolume', 'Sun shadow method is DistanceField, but no baked SDF volume is ' +
        'available, so the Sun casts no shadow at all. Add an SDFVolume3D and bake it, or set the ' +
        'Sun shadow method back to Cascades.');
    }
    var hasLocalMaps = localMapsEnabled(state);
    var hasContact = contactShadowsActive(state);
    // Every flag that reaches cacheKey must be compared here. localMaps and use3D were stored but
    // not compared, so a material injected before either flipped kept its old program variant for
    // good. Mode changes churn csmCount often enough to have hidden it; demand-driven arming,
    // which flips localMaps with nothing else moving, would not have been so lucky.
    if (existing && existing.owner === state && existing.csmCount === csmCount && existing.sdfSun === sdfSun && existing.probes === wantProbes && existing.sdf === hasSDF && existing.localMaps === hasLocalMaps && existing.contact === hasContact && existing.use3D === use3D && existing.version === RUNTIME_VERSION) {
      state.hookedMaterials.add(material);
      return true;
    }

    // Three caches per-material uniforms with programs. Drop old variants before
    // changing feature ownership so returning to an earlier mode cannot reuse stale bindings.
    if (existing && typeof material.dispose === 'function') material.dispose();
    // Local maps change the generated source, so they must change the program key too.
    var cacheKey = 'GD_ADVLIGHT3D_V8|CL1|G3D' + (use3D ? '1' : '0') + '|LP' + (wantProbes ? '1' : '0') + (hasSDF ? '|SDF1' : '') + (hasLocalMaps ? '|LSM' + LOCAL_SHADOW_SLOTS : '') + (hasContact ? '|CT1' : '') + '|CSM' + csmCount + '|SUN' + (sdfSun ? 1 : 0);

    material.__alInjection = { probes: wantProbes, sdf: hasSDF, key: cacheKey, version: RUNTIME_VERSION, receiver: receiverRecord, owner: state, csmCount: csmCount, sdfSun: sdfSun, use3D: use3D, localMaps: hasLocalMaps, contact: hasContact };
    // ShaderChain owns onBeforeCompile and customProgramCacheKey. Assigning either here directly
    // would silently disable every other injector on this material, and be disabled in turn by the
    // next module to try. The cache-key fragment reaches Three via the injector's key(), which
    // reads __alInjection.key set just above.
    if (!gdjs.__m3dShaderChain || !gdjs.__m3dShaderChain.install(material)) {
      warnOnce('noShaderChain', 'ShaderChain is unavailable, so clustered lighting could not be ' +
        'injected. The extension build is incomplete — ShaderChain.runtime.js must load first.');
      material.__alInjection = null;
      return false;
    }

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
    // Settle the texture-unit verdict BEFORE any material is injected.
    //
    // It is cached on state, and injectShaderOnMaterial reads it without a scene to ask. Left to be
    // decided lazily it answers "affordable" for the first frame (undefined !== false) and then
    // flips to the real answer once updateLocalShadowMaps finally supplies a renderer - which
    // changes AL_LOCAL_SHADOW_MAPS, which changes the program cache key, which recompiles every
    // material in the scene one or two frames in. That shows up as a stutter or flash the moment a
    // light is added, which is indistinguishable from a rendering bug.
    if (options) {
      if (options.maxLights !== undefined) applyMaxLights(state, options.maxLights);
      if (options.enableVolumetricFog !== undefined) state.enableVolumetricFog = !!options.enableVolumetricFog;
      if (options.volumetricFogDensity !== undefined) state.volumetricFogDensity = options.volumetricFogDensity;
      if (options.volumetricAnisotropy !== undefined) state.volumetricAnisotropy = clamp(options.volumetricAnisotropy, 0.0, 0.9);
      if (options.globalIntensityScale !== undefined) state.globalIntensityScale = options.globalIntensityScale;
      if (options.showDebugVisualizer !== undefined) state.showDebugVisualizer = !!options.showDebugVisualizer;
    }
    initTextures(state, runtimeScene);
    refreshTextureUnitBudget(state, runtimeScene);
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
        // Local shadow maps. shadowTechnique: Auto | ShadowMap | SDF | None
        shadowTechnique: (options && options.shadowTechnique) || 'Auto',
        shadowMapSize: options && options.shadowMapSize !== undefined ? options.shadowMapSize : 1024,
        shadowMapBias: options && options.shadowMapBias !== undefined ? options.shadowMapBias : -0.0005,
        shadowNormalBias: options && options.shadowNormalBias !== undefined ? options.shadowNormalBias : 0.02,
        shadowMapNear: options && options.shadowMapNear !== undefined ? options.shadowMapNear : 0,
        shadowMapStatic: !!(options && options.shadowMapStatic),
        // Auto | PCF | VSM. Auto defers to the scene's Maps: Filter setting, so the scene-level
        // control stays a real default rather than becoming dead once any light overrides it.
        shadowMapFilter: (options && options.shadowMapFilter) || 'Auto',
        __alMapSlot: -1,
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
    if (options.shadowTechnique !== undefined) light.shadowTechnique = options.shadowTechnique;
    if (options.shadowMapSize !== undefined) light.shadowMapSize = options.shadowMapSize;
    if (options.shadowMapBias !== undefined) light.shadowMapBias = options.shadowMapBias;
    if (options.shadowNormalBias !== undefined) light.shadowNormalBias = options.shadowNormalBias;
    if (options.shadowMapNear !== undefined) light.shadowMapNear = options.shadowMapNear;
    if (options.shadowMapStatic !== undefined) light.shadowMapStatic = !!options.shadowMapStatic;
    if (options.shadowMapFilter !== undefined) light.shadowMapFilter = options.shadowMapFilter;
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

      // Probe receivers add two sampler3D uniforms. Settle the new permutation before cloning and
      // injecting their materials so a 16-unit device never compiles the pre-budget variant first.
      refreshTextureUnitBudget(state, runtimeScene);

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
    // A light's own object must not be baked into the field it lights through.
    //
    // ClusteredLight3D normally sits on a Cube3D marker, and the light is at that cube's centre —
    // so the cube ENCLOSES the light. Baked in, every shadow ray from every surface hits the holder
    // just before reaching the light and returns fully occluded, which reads as "the light does
    // nothing" rather than as a shadow bug. Same root cause as the shadow-map holder problem.
    state.lights.forEach(function (light) {
      var root = threeRootOf(light.object);
      if (!root || !root.traverse) return;
      root.traverse(function (node) { if (node.isMesh) excluded.add(node); });
    });
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

    // Force world matrices current before any triangle is read.
    //
    // extractTrianglesFromMeshes bakes through mesh.matrixWorld, but Three only refreshes that
    // during render(). A bake started from a pre-events step — which is exactly when auto-bake
    // runs — therefore reads matrices from before the objects were placed, or identity on the very
    // first frame. Near the world origin the error is small enough to look like nothing is wrong;
    // far from it, every triangle lands somewhere else entirely, the volume bakes empty, and SDF
    // shadows silently do not appear no matter how the scene is configured.
    if (typeof scene.updateMatrixWorld === 'function') scene.updateMatrixWorld(true);

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
    vol.boundsLockSource = 'explicit';
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

    // Auto-bake is DEFERRED to the first step, never started here.
    //
    // This function runs from onCreated, where a placed instance still reports the object's default
    // size — the real size lands on the first step. Baking here would capture the wrong bounds, and
    // since startSDFBake now locks them, that wrong size would be frozen for the whole scene.
    // updateSDFVolume() fires this once the object has settled.
    if (vol.autoBakeOnStart && !vol.bakedOnce) vol.autoBakePending = true;

    return vol;
  }

  /**
   * Start a pending auto-bake, once the authoring cube's transform is final.
   * Called from the per-step update, after bounds have been re-synced from the settled object.
   */
  function startPendingSDFAutoBake(runtimeScene, vol) {
    var state = stateOf(runtimeScene);
    if (!vol || !vol.autoBakePending) return;
    if (vol.bakedOnce || state.sdfBakeState || state.isSdfBakeComplete) {
      vol.autoBakePending = false;
      return;
    }
    vol.autoBakePending = false;
    vol.bakedOnce = true;
    startSDFBake(runtimeScene);
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

  /* ---------------------------------------------------- Automatic SDF bounds (AutoScene) */
  //
  // Placing a box around the scene by hand is the single most-complained-about step in setting up
  // SDF shadows, and forgetting it fails SILENTLY: startSDFBake refuses without a volume record, so
  // every SDF setting in the scene becomes inert with nothing said.
  //
  // AutoScene fits an implicit volume to the shadow-casting geometry instead. It is deliberately
  // NOT Unreal's Global Distance Field: Unreal bakes per-mesh fields offline and instances them,
  // which cannot be done at runtime. This is one axis-aligned box, fitted once, never re-fitted and
  // never camera-following - that path is a dead end without per-mesh fields.
  //
  // Because one box over a sparse level stretches a fixed-resolution grid until its voxels are
  // bigger than the props, the guards below are not optional extras. They are what makes this safe
  // to have on by default.

  function autoSceneCasterBounds(runtimeScene, state) {
    var geometry = shadowGeometryOf(runtimeScene, state);
    if (!geometry.ready || !geometry.casters.length) return null;
    var box = new THREE.Box3();
    for (var i = 0; i < geometry.casters.length; i++) {
      var sphere = geometry.casters[i].sphere;
      box.expandByPoint(diagVec().set(sphere.center.x - sphere.radius, sphere.center.y - sphere.radius, sphere.center.z - sphere.radius));
      box.expandByPoint(diagVec().set(sphere.center.x + sphere.radius, sphere.center.y + sphere.radius, sphere.center.z + sphere.radius));
    }
    // Receivers: include receiver vertical elevation (Z) so floor is contained, but avoid
    // letting huge terrain planes (e.g. 5000+ units) blow the horizontal bounds past sdfMaxExtent.
    for (var r = 0; r < geometry.receivers.length; r++) {
      var rs = geometry.receivers[r].sphere;
      box.min.z = Math.min(box.min.z, rs.center.z - rs.radius);
      box.max.z = Math.max(box.max.z, rs.center.z + rs.radius);
      if (rs.radius < (state.sdfMaxExtent || 20000) * 0.4) {
        box.expandByPoint(diagVec().set(rs.center.x - rs.radius, rs.center.y - rs.radius, box.min.z));
        box.expandByPoint(diagVec().set(rs.center.x + rs.radius, rs.center.y + rs.radius, box.max.z));
      }
    }
    if (box.isEmpty()) return null;
    var pad = state.sdfAutoPadding;
    box.min.addScalar(-pad); box.max.addScalar(pad);
    return box;   // THREE space: Y is already mirrored, since it came from matrixWorld
  }

  /**
   * Build and bake an implicit volume, if AutoScene is on and nothing else supplies one.
   * Returns true if a volume now exists.
   */
  function ensureAutoSceneSDFVolume(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (state.sdfVolume) return true;
    if (state.sdfBoundsMode !== 'AutoScene') return false;
    if (!THREE_OK || !isWebGL2Available(runtimeScene)) return false;
    if (state.sdfAutoFitDone) return false;      // fitted once, never re-fitted

    var box = autoSceneCasterBounds(runtimeScene, state);
    if (!box) return false;                      // nothing to bake yet; try again next frame

    state.sdfAutoFitDone = true;
    var sizeX = box.max.x - box.min.x, sizeY = box.max.y - box.min.y, sizeZ = box.max.z - box.min.z;
    var longest = Math.max(sizeX, sizeY, sizeZ);

    // The guard. One box over a sparse level produces voxels larger than the props inside it, and a
    // field that coarse casts shadows that are worse than none. Refuse, and SAY SO - the whole
    // point of this feature is that failure stops being silent.
    // VOXEL SIZE is the guard that matters, not extent — and gating on extent alone is what let a
    // 9602-unit box through at 128x128x32, giving 75-unit voxels.
    //
    // The bake is deliberately conservative: it subtracts half a voxel diagonal from every stored
    // distance and clamps at zero, so anything within that radius of a surface reads as SOLID. At
    // 75-unit voxels that radius is ~65 units, which swallows the ground itself — every shadow ray
    // starting on the floor reports an immediate hit and the entire volume goes black. The symptom
    // is a dark square exactly matching the volume bounds sitting inside an otherwise lit area.
    // Size the grid TO THE BOX so voxels come out roughly cubic.
    //
    // A fixed 128x128x32 assumes a flat, wide level. Fitted to a tall or cubic box it gives wildly
    // anisotropic voxels - a 9602-unit cube produced 75 x 75 x 300 unit voxels, and it is the 300
    // that made the ground read as solid. Deriving the resolution from the extents keeps the
    // conservative dilation isotropic and roughly as small as the budget allows.
    var longestAxis = Math.max(sizeX, sizeY, sizeZ);
    var budget = 128;   // texels on the longest axis
    var resFor = function (extent, cap) {
      return clamp(Math.round(budget * (extent / Math.max(1e-3, longestAxis))), 8, cap);
    };
    var resX = resFor(sizeX, 256), resY = resFor(sizeY, 256), resZ = resFor(sizeZ, 128);
    var voxel = Math.max(sizeX / resX, sizeY / resY, sizeZ / resZ);
    var maxVoxel = state.sdfMaxVoxelSize || 25.0;
    if (voxel > maxVoxel) {
      warnOnce('sdfAutoTooCoarse',
        'Automatic SDF bounds would span ' + Math.round(longest) + ' world units at ' +
        resX + 'x' + resY + 'x' + resZ + ', giving voxels of ' +
        voxel.toFixed(1) + ' units — over the ' + maxVoxel + '-unit quality limit. At that size the ' +
        'bake treats everything within about ' + (voxel * 0.87).toFixed(0) + ' units of any surface ' +
        'as solid, including the ground, so the whole volume would read as shadowed. No volume was ' +
        'created. Place an SDFVolume3D around just the area that needs SDF shadows, or give the ' +
        'lights Shadow Technique ShadowMap instead.');
      return false;
    }
    if (longest > state.sdfMaxExtent) {
      warnOnce('sdfAutoTooLarge',
        'Automatic SDF bounds would need to span ' + Math.round(longest) + ' world units, over the ' +
        Math.round(state.sdfMaxExtent) + '-unit limit, so no volume was created and clustered lights ' +
        'will not cast SDF shadows. Your casters are spread too far apart for one baked field. ' +
        'Give the lights Shadow Technique ShadowMap instead, or place an SDFVolume3D around the part ' +
        'of the scene that needs SDF shadows, or raise SDF max auto extent if you accept the ' +
        'resolution loss.');
      return false;
    }

    var vol = {
      object: null, behavior: null, implicit: true,
      resX: resX, resY: resY, resZ: resZ,
      voxelSize: 15.625,
      autoBakeOnStart: true, bakedOnce: false, isBaked: false,
      boundsLocked: true, boundsLockSource: 'autoScene',
      minX: box.min.x, minY: -box.max.y, minZ: box.min.z,
      maxX: box.max.x, maxY: -box.min.y, maxZ: box.max.z,
      threeMin: new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      threeSize: new THREE.Vector3(Math.max(1, sizeX), Math.max(1, sizeY), Math.max(1, sizeZ)),
      data: null, texture: null
    };
    vol.voxelSize = Math.min(vol.threeSize.x / vol.resX, vol.threeSize.y / vol.resY, vol.threeSize.z / vol.resZ);
    ensureSDFTextures(vol);
    state.sdfVolume = vol;
    state.sdfAutoVolume = vol;

    // Report the resulting voxel size BEFORE baking, as the plan requires: it is the number that
    // decides whether these shadows will be any good, and it is otherwise invisible.
    console.log('[AdvancedLighting3D] Automatic SDF bounds fitted to ' + Math.round(vol.threeSize.x) +
      ' x ' + Math.round(vol.threeSize.y) + ' x ' + Math.round(vol.threeSize.z) + ' world units at ' +
      vol.resX + 'x' + vol.resY + 'x' + vol.resZ + ', giving a voxel size of ' + vol.voxelSize.toFixed(1) +
      ' units. Features smaller than about that will not shadow accurately. ' +
      'Place an SDFVolume3D to bound this yourself, or set SDF bounds mode to Explicit to switch this off.');
    startSDFBake(runtimeScene);
    return true;
  }

  /**
   * The bake's conservative dilation radius: half a voxel diagonal.
   *
   * Everything within this distance of a surface is stored as ZERO, i.e. solid. That is deliberate
   * - it stops thin geometry leaking light - but it means a shadow ray that starts closer than this
   * to the surface it sits on begins INSIDE solid space and reports an immediate hit. Every lit
   * fragment inside the volume then reads as fully shadowed, which draws a hard dark box exactly
   * matching the volume bounds. The ray origin offset must clear this radius, so both have to come
   * from the same place.
   */
  function sdfDilationOf(sx, sy, sz) {
    return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
  }

  function sdfVolumeDilation(vol) {
    if (!vol) return 0;
    var sx = (vol.maxX - vol.minX) / Math.max(1, vol.resX);
    var sy = (vol.maxY - vol.minY) / Math.max(1, vol.resY);
    var sz = (vol.maxZ - vol.minZ) / Math.max(1, vol.resZ);
    return sdfDilationOf(sx, sy, sz);
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

    // Freeze the bounds for the duration of the bake.
    //
    // The bake runs incrementally across many frames and validates itself each step against a
    // signature of (resolution + bounds). syncSDFVolumeBoundsFromObject rewrites those bounds from
    // the authoring cube's live position and size every frame while boundsLocked is false, so any
    // movement — including an instance's size settling after creation, which happens on the first
    // step, after AutoBakeOnStart has already fired — changed the signature and cancelled the bake.
    // cancelSDFBake then discards sdfBakeState entirely and the `bakedOnce` guard stops auto-bake
    // retrying, so SDFBakeProgress() sat at exactly 0.000 forever with no error and no shadows.
    //
    // Locking here is also simply correct: baked distances describe one specific volume, so bounds
    // that drift away from the data are wrong regardless. The file-load path already locks for the
    // same reason. The lock is released when the volume is disposed or rebuilt.
    //
    // A lock left by a PREVIOUS bake must not pin the volume to where the cube used to be, so
    // re-sync from the authoring cube first — unless the bounds were set explicitly, in which case
    // the author's numbers win and are left alone.
    if (vol.boundsLockSource === 'bake' && vol.object) {
      vol.boundsLocked = false;
      syncSDFVolumeBoundsFromObject(vol, vol.object);
    }
    vol.boundsLocked = true;
    vol.boundsLockSource = 'bake';

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
      // Say why. A cancelled bake leaves isBaked false, which compiles AL_SDF_SHADOWS out of every
      // material — so the whole feature disappears with no error unless this is reported.
      warnOnce('sdfBakeCancelled',
        'SDF bake cancelled before it finished, so SDF shadows stay off. Reason: ' +
        (!vol ? 'the volume was removed.'
          : vol !== state.sdfVolume ? 'another SDFVolume3D replaced it — only one per scene is used.'
          : 'its bounds or resolution changed mid-bake (SetSDFVolumeBounds, a resolution change, ' +
            'or the authoring cube moving while bounds were unlocked).') +
        ' Re-run StartSDFBake once the volume has settled.');
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
        buffer[idx] = toHalf(Math.min(65504, Math.max(0, grid[idx] - sdfDilationOf(voxelSizeX, voxelSizeY, voxelSizeZ))));
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
    // Bounds came from the file and describe the baked data; a later bake must not re-sync them
    // from the authoring cube, so mark the lock explicit.
    vol.boundsLocked = true;
    vol.boundsLockSource = 'explicit';
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

    // Several runtimes — including this one and Material 3D — swap in a fresh material rather than
    // mutating the existing one. That discards onBeforeCompile, the cache key and the chain state
    // with the old object, and nothing errors: the surface just quietly loses every injector.
    // ensureAll() re-patches anything that lost the hook since the last frame.
    if (gdjs.__m3dShaderChain && typeof gdjs.__m3dShaderChain.ensureAll === 'function') {
      gdjs.__m3dShaderChain.ensureAll();
    }

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

    // Resolve the sampler permutation before any shadow light is created or material is compiled.
    // AdvancedWeather3D adds a non-shadowing PointLight, which legitimately recompiles stock Three
    // materials; keeping this verdict current is what makes that recompile safe instead of exposing
    // an already-over-budget AdvancedLighting variant.
    refreshTextureUnitBudget(state, runtimeScene);

    // Before everything else that renders: the prepass must exist by the time materials are
    // (re)injected below, or the first frame compiles the non-contact variant and then swaps.
    renderDepthPrepass(runtimeScene, camera);
    updateCSM(runtimeScene, camera);
    // Automatic SDF bounds, when nothing supplies a volume and something wants one. Retried
    // rather than one-shot, because a scene that builds its level in events has no casters on the
    // first frame - but bounded, since each attempt traverses the scene.
    // BOTH of these are wrapped, and it is not defensive padding.
    //
    // They run inside a registered post-events callback. An exception here does not degrade one
    // feature - it escapes into the game loop, and the whole project stops: nothing renders,
    // no events run, input stops responding. A convenience feature and a diagnostic must never be
    // able to do that. Neither is load-bearing; if either fails the scene should carry on lit.
    if (sdfEnabled(state) && !state.sdfVolume && state.sdfBoundsMode === 'AutoScene' && !state.sdfAutoFitDone) {
      try {
        var wantsSDF = state.sunShadowsWantsField === true;
        state.lights.forEach(function (l) {
          if (l.active && l.castShadow && (l.shadowTechnique || 'Auto') !== 'None') wantsSDF = true;
        });
        if (wantsSDF) {
          var attempt = (state.sdfAutoFitFrame = (state.sdfAutoFitFrame || 0) + 1);
          if (attempt % 30 === 1) ensureAutoSceneSDFVolume(runtimeScene);
          // Roughly ten seconds. After that, stop traversing every frame for a level that is never
          // going to appear, and let the validator report the scene as it actually is.
          if (attempt > 600 && !state.sdfVolume) state.sdfAutoFitDone = true;
        }
      } catch (e) {
        state.sdfAutoFitDone = true;   // do not retry a path that just threw
        warnOnce('autoSceneFailed', 'Automatic SDF bounds failed and were disabled for this scene: ' +
          (e && e.message ? e.message : e) + '. Lighting is unaffected; place an SDFVolume3D if you ' +
          'want SDF shadows, or set SDF bounds mode to Explicit to silence this.');
      }
    }

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
      // These values belong to this exact camera frame. Clear them even for inactive/rejected
      // lights so local-shadow selection can never consume a stale result from the previous view.
      light.__alPackedIndex = -1;
      light.__alVisibleClusterCount = 0;
      light.__alNearestVisibleDepth = Infinity;
      // Also repairs a Cube3D face material replaced by an in-editor object update.
      syncSpotDirectionFace(light);
      if (!light.active || light.currentIntensity <= 0.0001 || lightIndex >= maxLights) {
        light.isInFrustum = false;
        return;
      }

      syncLightWorldTransform(light);

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
      light.__alPackedIndex = lightIndex;
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
      //
      // The bias is stored divided by SHADOW_BIAS_ENCODE_SCALE and multiplied back in the shader.
      // Packing it raw capped the usable range at 0.999 voxels, so anything above that was silently
      // discarded — a ShadowBias of 3 behaved exactly like 0.999 with no warning, which reads as
      // "raising the bias does nothing" when the real problem is elsewhere.
      // Integer part: 0 = never shadows, 1 = shadow via the SDF march, 2+n = shadow map in slot n.
      // Fraction: the SDF bias. Packing the slot here keeps the light record at 16 floats.
      var mapSlot = (light.__alMapSlot !== undefined && light.__alMapSlot >= 0) ? light.__alMapSlot : -1;
      var shadowInt = light.castShadow ? (mapSlot >= 0 ? 2 + mapSlot : 1) : 0;
      var shadowData = shadowInt +
        clamp((Number(light.shadowBias) || 0.0) / SHADOW_BIAS_ENCODE_SCALE, 0.0, 0.999);
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
      // The sphere above is only a cheap first pass. For a spotlight it is wildly conservative:
      // a 40 m range produces an 80 m-wide sphere even when the visible cone is narrow and points
      // away from the camera. That made off-screen FPS-camera lights consume shadow slots. Cull
      // surviving clusters against the real finite cone as well. Angles at/above 89 degrees retain
      // sphere-only culling because tan(theta) becomes numerically unbounded and the cone is nearly
      // the whole forward hemisphere anyway.
      var spotConeTan = -1;
      if (light.lightType === 'Spot') {
        var outerRadians = Math.max(0.001, light.spotOuterAngle || 45) * Math.PI / 180.0;
        if (outerRadians < 89.0 * Math.PI / 180.0) spotConeTan = Math.tan(outerRadians);
      }

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
              if (spotConeTan >= 0) {
                var clusterCx = (aabbs[aabbOffset + 0] + aabbs[aabbOffset + 3]) * 0.5;
                var clusterCy = (aabbs[aabbOffset + 1] + aabbs[aabbOffset + 4]) * 0.5;
                var clusterCz = (aabbs[aabbOffset + 2] + aabbs[aabbOffset + 5]) * 0.5;
                var clusterHx = (aabbs[aabbOffset + 3] - aabbs[aabbOffset + 0]) * 0.5;
                var clusterHy = (aabbs[aabbOffset + 4] - aabbs[aabbOffset + 1]) * 0.5;
                var clusterHz = (aabbs[aabbOffset + 5] - aabbs[aabbOffset + 2]) * 0.5;
                var clusterRadius = Math.sqrt(clusterHx * clusterHx + clusterHy * clusterHy +
                  clusterHz * clusterHz);
                if (!sphereIntersectsFiniteCone(
                    clusterCx, clusterCy, clusterCz, clusterRadius,
                    vx, vy, vz, dirX, dirY, dirZ, radius, spotConeTan)) continue;
              }
              var slot = binCounts[cIdx];
              if (slot < MAX_LIGHTS_PER_CLUSTER) {
                binData[cIdx * MAX_LIGHTS_PER_CLUSTER + slot] = lightIndex;
                binCounts[cIdx] = slot + 1;
                touchedAny = true;
                light.__alVisibleClusterCount++;
                // maxZ is the cluster face nearest the camera (view-space Z is negative).
                light.__alNearestVisibleDepth = Math.min(light.__alNearestVisibleDepth,
                  Math.max(cameraNear, -aabbs[aabbOffset + 5]));
              }
            }
          }
        }
      }

      light.isInFrustum = touchedAny;
      lightIndex++;
    });

    state.activeLightCount = lightIndex;

    // Shadow-map reservations must use the visibility result computed immediately above. Running
    // this before cluster binning used last frame's isInFrustum flag and produced camera-edge pops,
    // one-frame lag after turns, and slots apparently changing only when the player approached.
    updateLocalShadowMaps(runtimeScene, camera);

    // Selection changes __alMapSlot after the light records were packed. Patch only shape.z now so
    // the shader sees this frame's owner; leaving the old value here delayed every hand-off by one
    // more frame and could briefly sample a map belonging to a different light.
    state.lights.forEach(function (light) {
      var packedIndex = light.__alPackedIndex;
      if (packedIndex === undefined || packedIndex < 0) return;
      var mapSlot = (light.__alMapSlot !== undefined && light.__alMapSlot >= 0)
        ? light.__alMapSlot : -1;
      var shadowInt = light.castShadow ? (mapSlot >= 0 ? 2 + mapSlot : 1) : 0;
      lightData[packedIndex * LIGHT_FLOATS + 14] = shadowInt +
        clamp((Number(light.shadowBias) || 0.0) / SHADOW_BIAS_ENCODE_SCALE, 0.0, 0.999);
    });

    // AFTER selection: run at scene creation it would report "no slot" for every light, because
    // nothing has competed for one yet.
    try {
      runStartupShadowValidation(runtimeScene);
    } catch (e) {
      state.shadowValidationDone = true;
      warnOnce('shadowValidationFailed', 'Shadow validation failed and was disabled for this scene: ' +
        (e && e.message ? e.message : e) + '. This is diagnostics only; rendering is unaffected.');
    }

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
          if (uniforms.uSdfDilation) uniforms.uSdfDilation.value = sdfVolumeDilation(state.sdfVolume);
        }
      }
      // Contact shadows are INDEPENDENT of the SDF. Nested inside the volume check above they
      // would only ever update in scenes that also have a baked field, which is precisely the
      // case they exist to serve as an alternative to.
      if (uniforms.uAlContact && uniforms.uAlContact.value && typeof uniforms.uAlContact.value.set === 'function') {
        var ccs = contactState(state);
        uniforms.uAlContact.value.set(ccs.strength, ccs.distance, ccs.steps, ccs.thickness);
        if (uniforms.uAlSceneDepth) uniforms.uAlSceneDepth.value = ccs.target ? ccs.target.texture : null;
        if (uniforms.uAlProjection && camera && camera.projectionMatrix &&
            uniforms.uAlProjection.value && typeof uniforms.uAlProjection.value.copy === 'function') {
          uniforms.uAlProjection.value.copy(camera.projectionMatrix);
        }
        if (uniforms.uAlProjectionInverse && camera && camera.projectionMatrixInverse &&
            uniforms.uAlProjectionInverse.value && typeof uniforms.uAlProjectionInverse.value.copy === 'function') {
          uniforms.uAlProjectionInverse.value.copy(camera.projectionMatrixInverse);
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
        // Hand the hook back to ShaderChain rather than stamping a no-op over it: uninstall()
        // also drops the material from the chain's tracked list, so ensureAll() will not
        // resurrect an injection this scene has just torn down.
        //
        // No fallback branch here on purpose. Assigning onBeforeCompile directly is exactly the
        // bug this refactor removes, and the build guard rejects it. If the chain is missing the
        // material was never installed, so there is nothing to release.
        if (gdjs.__m3dShaderChain && typeof gdjs.__m3dShaderChain.uninstall === 'function') {
          gdjs.__m3dShaderChain.uninstall(mat);
        }
        if (mat.defines) ['USE_CLUSTERED_LIGHTS','USE_PROBE_GRID','USE_3D_CLUSTER_TEXTURE','AL_SDF_SHADOWS','AL_LIGHT_INDEX_WIDTH','AL_LIGHT_TEXELS','AL_WORLD_UNITS_PER_METER'].forEach(function (key) { delete mat.defines[key]; });
        mat.__alInjection = null; mat.__alUniforms = null;
        if (mat.dispose) mat.dispose();
        mat.needsUpdate = true;
      }
    });
    state.hookedMaterials.clear();
    disposeLocalShadows(state);
    scenes.delete(runtimeScene);
  }

  /* ====================================================== Shadow Diagnostics ========== */
  //
  // ONE evaluator, feeding the readable report, the events expressions, and the start-of-scene
  // warnings. Splitting those into three code paths is how they drift apart and start disagreeing.
  //
  // Checks run in order and STOP at the first failure, so the first failure is the answer. Each
  // returns a stable code: wording may change freely, codes may not, because events branch on them.
  //
  // This exists because every wrong theory during the shadow debugging - light probes, radius
  // units, shadow bias, the light's aim - was a guess at something the engine already knew.

  var _diagSphere = null, _diagVec = null;
  function diagSphere() { if (!_diagSphere && THREE_OK) _diagSphere = new THREE.Sphere(); return _diagSphere; }
  function diagVec() { if (!_diagVec && THREE_OK) _diagVec = new THREE.Vector3(); return _diagVec; }

  // World-space bounding sphere of a mesh. Returns a FRESH sphere: callers keep these in lists.
  function meshWorldSphere(node) {
    if (!THREE_OK || !node.geometry) return null;
    if (!node.geometry.boundingSphere) {
      try { node.geometry.computeBoundingSphere(); } catch (e) { return null; }
    }
    var bs = node.geometry.boundingSphere;
    if (!bs || !isFinite(bs.radius)) return null;
    return bs.clone().applyMatrix4(node.matrixWorld);
  }

  // A light must never be judged against its own holder cube. That mesh encloses the light, so it
  // is always "in range" and would mask a genuinely empty scene as a healthy one.
  function lightOwnedMeshes(state) {
    var owned = new Set();
    state.lights.forEach(function (l) {
      var root = threeRootOf(l.object);
      if (!root || !root.traverse) return;
      root.traverse(function (n) { if (n.isMesh) owned.add(n); });
    });
    return owned;
  }

  // Does the light actually illuminate this sphere? Radius is in METRES; spotOuterAngle is the
  // half-angle from the axis, matching both the shader and the native SpotLight sync.
  function lightReachesSphere(light, sphere) {
    var reach = (light.radius || 0) * WORLD_UNITS_PER_METER;
    var distance = sphere.center.distanceTo(light.worldPosition);
    if (distance - sphere.radius > reach) return false;
    if (light.lightType !== 'Spot') return true;
    if (distance <= sphere.radius) return true;          // light sits inside the bounds
    var toward = diagVec().subVectors(sphere.center, light.worldPosition).divideScalar(distance);
    var angle = Math.acos(clamp(toward.dot(light.worldDirection), -1, 1));
    var slack = Math.asin(clamp(sphere.radius / distance, 0, 1));
    return angle - slack <= (light.spotOuterAngle || 45) * Math.PI / 180;
  }

  function sphereTouchesSDF(vol, sphere) {
    if (!vol) return false;
    var min = vol.threeMin, size = vol.threeSize;
    for (var axis = 0, keys = ['x', 'y', 'z']; axis < 3; axis++) {
      var k = keys[axis];
      if (sphere.center[k] + sphere.radius < min[k]) return false;
      if (sphere.center[k] - sphere.radius > min[k] + size[k]) return false;
    }
    return true;
  }

  // Every shadow-relevant mesh in the scene, gathered once so a whole-scene report is one traversal
  // rather than one per light.
  function shadowGeometryOf(runtimeScene, state) {
    var root = getThreeScene(runtimeScene);
    var result = { casters: [], receivers: [], meshes: 0, ready: false };
    if (!root || !root.traverse || !THREE_OK) return result;
    // This runs from inside the step loop. A diagnostic that throws is worse than one that stays
    // quiet, so every capability is checked rather than assumed.
    if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
    var owned = lightOwnedMeshes(state);
    root.traverse(function (node) {
      if (!node.isMesh || !node.visible || owned.has(node)) return;
      result.meshes++;
      if (!node.castShadow && !node.receiveShadow) return;
      var sphere = meshWorldSphere(node);
      if (!sphere) return;
      if (node.castShadow) result.casters.push({ node: node, sphere: sphere });
      if (node.receiveShadow) result.receivers.push({ node: node, sphere: sphere });
    });
    result.ready = true;
    return result;
  }

  /**
   * Why does (or does not) this light cast a shadow?
   * Returns { code, ok, message }. `code` is stable; `message` is for humans.
   */
  function diagnoseLightShadow(runtimeScene, light, geometry) {
    var state = stateOf(runtimeScene), c = shadowState(state);
    function no(code, message) { return { code: code, ok: false, message: message }; }
    function yes(code, message) { return { code: code, ok: true, message: message }; }

    if (!light) return no('NO_LIGHT', 'No ClusteredLight3D record: the behavior never registered.');
    var name = (light.object && light.object.getName) ? light.object.getName() : 'light';

    if (!light.active) return no('LIGHT_INACTIVE', name + ' is deactivated, so it lights nothing and shadows nothing.');
    if (!(light.currentIntensity > 0.0001))
      return no('LIGHT_DARK', name + ' has an effective intensity of ' + light.currentIntensity.toFixed(3) +
        '. A light contributing no radiance casts no shadow.');
    if (!light.castShadow)
      return no('CAST_SHADOWS_OFF', name + ' has Cast Shadows switched off. That is the master switch; ' +
        'every other shadow setting on this light is ignored while it is off.');

    if (c.mode === 'Off') return no('SCENE_SHADOWS_OFF', 'Scene shadow ownership is Off: nothing in this scene shadows.');
    if (c.mode === 'Native')
      return no('SCENE_SHADOWS_NATIVE', 'Scene shadow ownership is Native, so GDevelop shadows this scene and ' +
        'clustered lights do not cast. Use the objects own Shadow casting checkboxes, or set ownership to Auto.');

    var technique = light.shadowTechnique || 'Auto';
    if (technique === 'None')
      return no('TECHNIQUE_NONE', name + ' has Shadow Technique set to None, so it lights without shadowing.');

    var canTakeMap = light.lightType === 'Spot' || light.lightType === 'Point';
    var ls = localShadowState(state);

    // --- Is there anything to shadow, and anything to shadow onto?
    geometry = geometry || shadowGeometryOf(runtimeScene, state);
    if (!geometry.ready)
      return no('NO_SCENE', 'No Three scene is available yet. Run this after the scene has stepped at least once.');

    var casterHit = null, receiverHit = null, i;
    for (i = 0; i < geometry.casters.length; i++)
      if (lightReachesSphere(light, geometry.casters[i].sphere)) { casterHit = geometry.casters[i]; break; }
    for (i = 0; i < geometry.receivers.length; i++)
      if (lightReachesSphere(light, geometry.receivers[i].sphere)) { receiverHit = geometry.receivers[i]; break; }

    if (!casterHit) {
      var reach = ((light.radius || 0) * WORLD_UNITS_PER_METER).toFixed(0);
      return no('NO_CASTER_IN_RANGE', 'Nothing that casts shadows is within reach of ' + name + '. Its radius is ' +
        light.radius + ' metres = ' + reach + ' world units' +
        (light.lightType === 'Spot' ? ', and the cone half-angle is ' + light.spotOuterAngle + ' degrees' : '') +
        '. Switch on Shadow casting for an object inside that volume. ' +
        'The scene has ' + geometry.meshes + ' visible meshes and ' + geometry.casters.length + ' of them cast.');
    }
    if (!receiverHit)
      return no('NO_RECEIVER_IN_RANGE', 'Nothing that RECEIVES shadows is within reach of ' + name +
        '. A shadow needs a surface to land on: switch on Shadow receiving for the floor or wall. ' +
        'The scene has ' + geometry.receivers.length + ' receiving meshes.');

    // --- Shadow-map path
    if (technique !== 'SDF' && canTakeMap) {
      if (light.__alMapSlot >= 0)
        return yes('OK_SHADOW_MAP', name + ' casts a real shadow map in slot ' + light.__alMapSlot + '.');
      if (ls.maxLights <= 0)
        return no('MAP_BUDGET_ZERO', 'Max shadow-mapped lights is 0, so no light may hold a depth map. ' +
          'Raise it on the shadow manager.');
      if (light.isInFrustum === false)
        return no('LIGHT_OFFSCREEN', name + ' is outside the camera frustum, so it was skipped for a shadow-map ' +
          'slot. This is expected and resolves when it comes back on screen.');
      if (technique === 'ShadowMap')
        return no('MAP_BUDGET_FULL', name + ' demands a shadow map but lost the slot race: ' + ls.mappedCount +
          ' of ' + ls.maxLights + ' visible slots are taken by shadows closer to the camera.');
      // Auto and unslotted: fall through to the SDF, which is exactly what Auto promises.
    } else if (technique !== 'SDF' && !canTakeMap) {
      // AreaCapsule has no shadow-map formulation; the SDF is its only path.
      technique = 'SDF';
    }

    // --- SDF path
    var vol = state.sdfVolume;
    if (!vol) {
      if (state.sdfBoundsMode === 'AutoScene' && !state.sdfAutoFitDone)
        return no('SDF_AUTO_PENDING', 'Automatic SDF bounds have not been fitted yet, so ' + name +
          ' has nothing to march. This resolves on its own once shadow-casting geometry exists.');
      if (state.sdfBoundsMode === 'AutoScene')
        return no('SDF_AUTO_REFUSED', 'Automatic SDF bounds were not created: either no shadow-casting ' +
          'geometry was found, or the casters span more than SDF max auto extent and one baked field ' +
          'could not usefully cover them. Give ' + name + ' Shadow Technique ShadowMap, or place an ' +
          'SDFVolume3D around the area that needs SDF shadows.');
      return no('NO_SDF_VOLUME', name + ' fell back to the distance field, but there is no SDFVolume3D in this ' +
        'scene and SDF bounds mode is Explicit, so nothing is baked and it casts nothing. Add an ' +
        'SDFVolume3D behavior, switch SDF bounds mode to AutoScene, or give the light Shadow Technique ' +
        'ShadowMap so it takes a depth map instead.');
    }
    if (state.sdfBakeState && state.sdfBakeState.inProgress)
      return no('SDF_BAKING', 'The distance field is still baking (' + (getSDFBakeProgress(runtimeScene) * 100).toFixed(0) +
        '%). ' + name + ' will cast once it finishes.');
    if (!vol.isBaked)
      return no('SDF_NOT_BAKED', 'The SDFVolume3D exists but has never been baked, so ' + name +
        ' casts nothing. Switch on Auto bake on start, or call Bake SDF volume.');
    if (!sphereTouchesSDF(vol, casterHit.sphere))
      return no('CASTER_OUTSIDE_SDF', 'The caster near ' + name + ' is OUTSIDE the baked volume, so the distance ' +
        'field does not know it exists. Resize the SDFVolume3D to contain it.');
    if (technique === 'SDF' || light.__alMapSlot < 0)
      return yes('OK_SDF', name + ' casts through the baked distance field' +
        (technique === 'Auto' ? ' (it did not win a shadow-map slot, which is what Auto is for)' : '') + '.');
    return yes('OK_SHADOW_MAP', name + ' casts a real shadow map in slot ' + light.__alMapSlot + '.');
  }

  function explainLightShadows(runtimeScene, light) {
    var d = diagnoseLightShadow(runtimeScene, light);
    return (d.ok ? 'OK [' : 'NO SHADOW [') + d.code + '] ' + d.message;
  }

  function diagnoseAllLights(runtimeScene) {
    var state = stateOf(runtimeScene);
    var geometry = shadowGeometryOf(runtimeScene, state);
    var report = [];
    state.lights.forEach(function (light) {
      report.push(diagnoseLightShadow(runtimeScene, light, geometry));
    });
    return report;
  }

  function explainAllShadows(runtimeScene) {
    var report = diagnoseAllLights(runtimeScene);
    if (!report.length) return 'No ClusteredLight3D lights are registered in this scene.';
    var lines = report.map(function (d) { return (d.ok ? '  OK   [' : '  FAIL [') + d.code + '] ' + d.message; });
    var failing = report.filter(function (d) { return !d.ok; }).length;
    return 'Shadow diagnosis: ' + (report.length - failing) + ' of ' + report.length +
      ' lights are casting.\n' + lines.join('\n');
  }

  // The same evaluator, run ONCE after the first selection pass. Running it at scene creation would
  // report "no slot" for every light, because selection has not happened yet.
  function runStartupShadowValidation(runtimeScene) {
    var state = stateOf(runtimeScene);
    if (state.shadowValidationDone) return;
    // Do not judge a scene that is still deciding whether to fit an automatic volume: it would
    // report a missing SDF that is about to exist.
    if (state.sdfBoundsMode === 'AutoScene' && !state.sdfAutoFitDone && !state.sdfVolume) return;
    state.shadowValidationDone = true;
    if (!state.lights.size) return;
    diagnoseAllLights(runtimeScene).forEach(function (d) {
      if (d.ok) return;
      // Deliberate authoring choices are not problems worth nagging about.
      if (d.code === 'SCENE_SHADOWS_OFF' || d.code === 'SCENE_SHADOWS_NATIVE' ||
          d.code === 'TECHNIQUE_NONE' || d.code === 'CAST_SHADOWS_OFF' ||
          d.code === 'LIGHT_INACTIVE' || d.code === 'SDF_BAKING' || d.code === 'LIGHT_OFFSCREEN') return;
      warnOnce('shadowValidation:' + d.code, d.message +
        ' (Use the Explain shadows action for the full report.)');
    });
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
    setSunShadows: setSunShadows,
    setLocalShadowFilter: setLocalShadowFilter,
    setMaxShadowMapUpdateInterval: function (runtimeScene, frames) {
      localShadowState(stateOf(runtimeScene)).maxUpdateInterval =
        clamp(Math.floor(frames), 1, 60);
    },
    getMaxShadowMapUpdateInterval: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).maxUpdateInterval;
    },
    setLightShadowFilter: function (runtimeScene, behavior, filter) {
      var light = behavior && behavior.__alLight;
      if (!light) return false;
      var want = String(filter);
      light.shadowMapFilter = (want === 'VSM' || want === 'PCF') ? want : 'Auto';
      return true;
    },
    getLightShadowFilter: function (runtimeScene, behavior) {
      var light = behavior && behavior.__alLight;
      if (!light) return 'Auto';
      return filterForLight(localShadowState(stateOf(runtimeScene)), light);
    },
    getLocalShadowFilter: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).filter;
    },
    isLocalShadowFilter: function (runtimeScene, filter) {
      return localShadowState(stateOf(runtimeScene)).filter === String(filter);
    },
    setVsmSoftness: function (runtimeScene, radius) {
      localShadowState(stateOf(runtimeScene)).vsmBlurRadius = clamp(Number(radius) || 0, 0, 16);
    },
    setVsmLightBleed: function (runtimeScene, amount) {
      localShadowState(stateOf(runtimeScene)).vsmLightBleed = clamp(Number(amount) || 0, 0, 0.94);
    },
    setContactShadows: function (runtimeScene, on) { contactState(stateOf(runtimeScene)).enabled = !!on; },
    isContactShadowsActive: function (runtimeScene) { return contactShadowsActive(stateOf(runtimeScene)); },
    contactStateOf: function (runtimeScene) { return contactState(stateOf(runtimeScene)); },

    /* ---- Shadow diagnostics ---- */
    diagnoseLightShadow: function (runtimeScene, behavior) {
      return diagnoseLightShadow(runtimeScene, behavior && behavior.__alLight);
    },
    explainLightShadows: function (runtimeScene, behavior) {
      return explainLightShadows(runtimeScene, behavior && behavior.__alLight);
    },
    lightShadowReason: function (runtimeScene, behavior) {
      return diagnoseLightShadow(runtimeScene, behavior && behavior.__alLight).code;
    },
    lightShadowIsCasting: function (runtimeScene, behavior) {
      return diagnoseLightShadow(runtimeScene, behavior && behavior.__alLight).ok;
    },
    explainAllShadows: explainAllShadows,
    diagnoseAllLights: diagnoseAllLights,
    applySceneShadowSettings: applySceneShadowSettings,
    ensureAutoSceneSDFVolume: ensureAutoSceneSDFVolume,
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
      // Bounds are now taken from the settled instance, so a deferred auto-bake can safely start
      // and freeze them. See registerSDFVolume for why this cannot happen in onCreated.
      startPendingSDFAutoBake(runtimeScene, vol);
      return vol;
    },
    disposeSDFVolume: disposeSDFVolume,
    sdfVolumeOf: function (behavior) {
      return behavior ? behavior.__alSdfVolume : null;
    },
    /* ---- Local shadow maps ---- */
    setMaxShadowMappedLights: function (runtimeScene, n) {
      var ls = localShadowState(stateOf(runtimeScene));
      ls.maxLights = clamp(Math.floor(n), 0, LOCAL_SHADOW_SLOTS);
    },
    getMaxShadowMappedLights: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).maxLights;
    },
    setMaxShadowMapUpdatesPerFrame: function (runtimeScene, n) {
      localShadowState(stateOf(runtimeScene)).maxUpdatesPerFrame = Math.max(1, Math.floor(n));
    },
    getMaxShadowMapUpdatesPerFrame: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).maxUpdatesPerFrame;
    },
    getShadowMappedLightCount: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).mappedCount;
    },
    getShadowMapUpdatesThisFrame: function (runtimeScene) {
      return localShadowState(stateOf(runtimeScene)).updatesThisFrame;
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
      vol.boundsLockSource = 'explicit';
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
      // Exported because test-texture-unit-budget.mjs read it, found undefined, and silently fell
      // back to 8 - parking eight native shadow-casting spots while the runtime only ever uses
      // four. That inflated its worst-case sampler count by four units.
      LOCAL_SHADOW_SLOTS: LOCAL_SHADOW_SLOTS,
      scanSceneSamplerPressure: scanSceneSamplerPressure,
      updateIntervalFor: updateIntervalFor,
      moverAffectsLight: moverAffectsLight,
      sphereIntersectsFiniteCone: sphereIntersectsFiniteCone,
      refreshTextureUnitBudget: refreshTextureUnitBudget,
      updateCSM: updateCSM,
      disposeCSM: disposeCSM,
      practicalSplits: practicalSplits,
      csmShadowCode: csmShadowCode,
      collectBakeGeometry: collectBakeGeometry,
      stepSDFBake: stepSDFBake,
      updateLocalShadowMaps: updateLocalShadowMaps,
      slotFaceCost: slotFaceCost,
      localMapsEnabled: localMapsEnabled,
      refreshTextureUnitBudget: refreshTextureUnitBudget,
      parkSlotLight: parkSlotLight,
      localShadowStateOf: function (runtimeScene) { return localShadowState(stateOf(runtimeScene)); },
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

  // Claim the band-100 slot on the shared chain. This must happen at module load, before any
  // receiver enrolls a material: install() only wires the dispatcher, and a material whose
  // injector was not yet registered compiles once with no clustered lighting at all.
  if (!registerAdvancedLightingInjector()) {
    console.error('[AdvancedLighting3D] ShaderChain is not present, so clustered lighting, probes ' +
      'and SDF shadows cannot be injected. ShaderChain.runtime.js must be embedded ahead of this ' +
      'runtime by the extension build.');
  }

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
