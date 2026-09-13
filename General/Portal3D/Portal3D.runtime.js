/**
 * Portal3D — Valve Portal-style visual and physical portals for GDevelop 5.
 *
 * Implements:
 *   1. Perspective-matched virtual cameras: Looking into Portal A renders the scene
 *      from Portal B with the exact relative eye-perspective of the player camera.
 *   2. Screen-space projective texture mapping: Portal surfaces sample the offscreen
 *      target in screen coordinates, turning the portal face into a seamless optical window.
 *   3. Oblique near-plane clipping (Lengyel's matrix): Geometry behind the exit portal's
 *      wall is cleanly clipped from the portal view frustum.
 *   4. Seamless physical traversal & momentum redirection: Entities crossing the portal
 *      plane are instantly teleported, redirecting velocity and look vectors while
 *      preserving kinetic energy.
 *   5. Robust WebGL lifecycle & state restoration following InGameCamera3D (C1, C3, C5, C10).
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__portal3D) return; // install once

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------ constants */

  var PRESETS = {
    Tiny: [160, 120],
    Low: [320, 240],
    Standard: [512, 512],
    SD: [640, 480],
    HD: [1280, 720],
    MatchScreen: [0, 0]
  };

  // Cube3D face order: [Front, Back, Left, Right, Top, Bottom].
  var FACE_INDEX = { Front: 0, Back: 1, Left: 2, Right: 3, Top: 4, Bottom: 5 };
  var FACE_SLOT = { 0: 4, 1: 5, 2: 1, 3: 0, 4: 3, 5: 2 };

  var FORWARD_AXIS = {
    '+Z': [0, 0, 1], '-Z': [0, 0, -1],
    '+X': [1, 0, 0], '-X': [-1, 0, 0],
    '+Y': [0, 1, 0], '-Y': [0, -1, 0]
  };

  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[Portal3D] ' + message);
  }

  function isDead(object) {
    return !object || object._livingOnScene === false;
  }

  /* --------------------------------------------------------- scene state */

  var scenes = new Map();

  function stateOf(runtimeScene) {
    var s = scenes.get(runtimeScene);
    if (!s) {
      s = {
        portals: new Set(),         // active Portal3D behavior records
        traversables: new Set(),    // active PortalTraversable3D behavior records
        bindings: new Set(),        // mesh material bindings
        hiddenMeshes: []            // scratch for recursion guard during render
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

  function layerSceneOf(runtimeScene, layerName) {
    var layer = runtimeScene.getLayer(layerName);
    var lr = layer && layer.getRenderer && layer.getRenderer();
    return lr && lr.getThreeScene ? lr.getThreeScene() : null;
  }

  function layerCameraOf(runtimeScene, layerName) {
    var layer = runtimeScene.getLayer(layerName);
    var lr = layer && layer.getRenderer && layer.getRenderer();
    return lr && lr.getThreeCamera ? lr.getThreeCamera() : null;
  }

  /* -------------------------------------------------------------- targets */

  function resolveSize(preset, customW, customH, renderer, runtimeScene) {
    var w, h;
    if (preset === 'MatchScreen' && runtimeScene) {
      var game = runtimeScene.getGame();
      w = game.getGameResolutionWidth() || 512;
      h = game.getGameResolutionHeight() || 512;
    } else if (PRESETS[preset] && PRESETS[preset][0] > 0) {
      w = PRESETS[preset][0];
      h = PRESETS[preset][1];
    } else {
      w = Math.floor(customW) || 512;
      h = Math.floor(customH) || 512;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);

    var max = renderer && renderer.capabilities ? renderer.capabilities.maxTextureSize : 0;
    if (max && (w > max || h > max)) {
      w = Math.min(w, max);
      h = Math.min(h, max);
    }
    return [w, h];
  }

  function makeTarget(w, h) {
    var target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0
    });
    if (THREE.SRGBColorSpace !== undefined) {
      target.texture.colorSpace = THREE.SRGBColorSpace;
    }
    target.texture.generateMipmaps = false;
    return target;
  }

  function disposeTarget(portal) {
    if (portal.target) {
      try { portal.target.dispose(); } catch (e) {}
      portal.target = null;
    }
  }

  function ensureTarget(portal, renderer, runtimeScene) {
    var size = resolveSize(portal.preset, portal.customW, portal.customH, renderer, runtimeScene);
    var w = size[0], h = size[1];

    if (portal.target && portal.target.width === w && portal.target.height === h) {
      return portal.target;
    }

    disposeTarget(portal);
    portal.target = makeTarget(w, h);
    portal.textureEpoch = (portal.textureEpoch || 0) + 1;
    return portal.target;
  }

  /* ------------------------------------------------------------ math scratch */

  var _mTransform = null, _m4A = null, _m4B = null, _m4Inv = null, _m4Rel = null, _m4Cam = null;
  var _v3A = null, _v3B = null, _v3Pos = null, _v3Look = null, _v3Up = null;
  var _qA = null, _qB = null, _qFlip = null, _euler = null;
  var _plane = null, _vec4 = null, _qCorn = null;

  function initScratch() {
    if (_mTransform) return;
    _mTransform = new THREE.Matrix4();
    _m4A = new THREE.Matrix4();
    _m4B = new THREE.Matrix4();
    _m4Inv = new THREE.Matrix4();
    _m4Rel = new THREE.Matrix4();
    _m4Cam = new THREE.Matrix4();
    _v3A = new THREE.Vector3();
    _v3B = new THREE.Vector3();
    _v3Pos = new THREE.Vector3();
    _v3Look = new THREE.Vector3();
    _v3Up = new THREE.Vector3();
    _qA = new THREE.Quaternion();
    _qB = new THREE.Quaternion();
    _qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    _euler = new THREE.Euler();
    _plane = new THREE.Plane();
    _vec4 = new THREE.Vector4();
    _qCorn = new THREE.Vector4();
  }

  /**
   * Computes the world matrix of a portal in Three.js coordinates.
   * In GDevelop: Y is inverted relative to Three.js world space.
   */
  function getPortalWorldTransform(portal, outMatrix, outNormal, outUp) {
    initScratch();
    var mat = outMatrix || _mTransform;
    var obj = portal.object;
    var cx = obj.getCenterXInScene ? obj.getCenterXInScene() : obj.getX();
    var cy = obj.getCenterYInScene ? obj.getCenterYInScene() : obj.getY();
    var cz = obj.getCenterZInScene ? obj.getCenterZInScene() : (obj.getZ ? obj.getZ() : 0);

    var rx = obj.getRotationX ? obj.getRotationX() : 0;
    var ry = obj.getRotationY ? obj.getRotationY() : 0;
    var rz = obj.getAngle ? obj.getAngle() : 0;

    _euler.set(gdjs.toRad(rx), gdjs.toRad(ry), gdjs.toRad(rz), 'ZYX');
    mat.makeRotationFromEuler(_euler);

    // Position: negate Y for Three.js scene coordinates
    mat.setPosition(cx, -cy, cz);

    var fAxis = FORWARD_AXIS[portal.forwardAxis] || FORWARD_AXIS['+Z'];
    if (outNormal) {
      outNormal.set(fAxis[0], -fAxis[1], fAxis[2]).applyEuler(_euler).normalize();
    }
    if (outUp) {
      outUp.set(0, 0, 1).applyEuler(_euler).normalize();
    }
    return mat;
  }

  /**
   * Computes the relative transformation from Portal A to Portal B:
   * M_rel = M_B * R_flip * (M_A)^(-1)
   */
  function computePortalMatrix(portalA, portalB, outRelMatrix) {
    initScratch();
    getPortalWorldTransform(portalA, _m4A);
    getPortalWorldTransform(portalB, _m4B);

    _m4Inv.copy(_m4A).invert();

    // R_flip is a 180-degree rotation around local Y
    var mFlip = new THREE.Matrix4().makeRotationY(Math.PI);

    outRelMatrix.copy(_m4B).multiply(mFlip).multiply(_m4Inv);
    return outRelMatrix;
  }

  /**
   * Lengyel's Oblique View Frustum Projection:
   * Adjusts the camera projection matrix's near plane to lie exactly on the clipping plane.
   */
  function applyObliqueClipping(projMatrix, clipPlaneCamera) {
    var p = projMatrix.clone();
    var cp = clipPlaneCamera;

    // Corner opposite to clip plane
    _qCorn.x = (Math.sign(cp.x) + p.elements[8]) / p.elements[0];
    _qCorn.y = (Math.sign(cp.y) + p.elements[9]) / p.elements[5];
    _qCorn.z = -1.0;
    _qCorn.w = (1.0 + p.elements[10]) / p.elements[14];

    var dot = cp.x * _qCorn.x + cp.y * _qCorn.y + cp.z * _qCorn.z + cp.w * _qCorn.w;
    if (Math.abs(dot) < 1e-6) return projMatrix; // avoid degenerate division

    var scale = 2.0 / dot;
    var c = new THREE.Vector4(cp.x * scale, cp.y * scale, cp.z * scale, cp.w * scale);

    // Replace 3rd row of column-major projection matrix
    p.elements[2] = c.x;
    p.elements[6] = c.y;
    p.elements[10] = c.z + 1.0;
    p.elements[14] = c.w;

    return p;
  }

  /* ------------------------------------------------------------- bindings */

  function cubeMeshOf(object) {
    var renderer = object.getRenderer && object.getRenderer();
    return renderer && renderer._boxMesh ? renderer._boxMesh : null;
  }

  function createPortalMaterial(portal, originalMat) {
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      toneMapped: false
    });

    mat.userData.portal = portal;
    mat.userData.uBorderColor = new THREE.Color(portal.borderColor || '#00a2ff');
    mat.userData.uBorderWidth = portal.borderWidth !== undefined ? portal.borderWidth : 0.08;
    mat.userData.uShape = portal.shape === 'Rectangle' ? 1.0 : 0.0;

    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uPortalMap = { value: portal.target ? portal.target.texture : null };
      shader.uniforms.uBorderColor = { value: mat.userData.uBorderColor };
      shader.uniforms.uBorderWidth = { value: mat.userData.uBorderWidth };
      shader.uniforms.uShape = { value: mat.userData.uShape };
      shader.uniforms.uIsOpen = { value: portal.isOpen ? 1.0 : 0.0 };

      mat.userData.shader = shader;

      // Vertex shader: pass clip-space position and UVs
      shader.vertexShader = 'varying vec4 vScreenCoord;\nvarying vec2 vPortalUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vPortalUv = uv;'
        ].join('\n')
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vScreenCoord = gl_Position;'
        ].join('\n')
      );

      // Fragment shader: sample screen coordinates and generate portal rim
      shader.fragmentShader = [
        'uniform sampler2D uPortalMap;',
        'uniform vec3 uBorderColor;',
        'uniform float uBorderWidth;',
        'uniform float uShape;',
        'uniform float uIsOpen;',
        'varying vec4 vScreenCoord;',
        'varying vec2 vPortalUv;',
        shader.fragmentShader
      ].join('\n');

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        [
          '#include <dithering_fragment>',
          'if (uIsOpen < 0.5) {',
          '  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
          '} else {',
          '  vec2 screenUv = (vScreenCoord.xy / vScreenCoord.w) * 0.5 + 0.5;',
          '  vec4 portalColor = texture2D(uPortalMap, screenUv);',
          '  float ring = 0.0;',
          '  float alpha = 1.0;',
          '  if (uShape < 0.5) {',
          '    // Oval Portal Ring',
          '    vec2 p = vPortalUv * 2.0 - 1.0;',
          '    float d = length(p);',
          '    float inner = 0.90 - uBorderWidth;',
          '    ring = smoothstep(inner, inner + 0.06, d) * (1.0 - smoothstep(0.96, 1.0, d));',
          '    alpha = 1.0 - smoothstep(0.98, 1.02, d);',
          '  } else {',
          '    // Rectangular Portal Frame',
          '    vec2 edge = min(vPortalUv, 1.0 - vPortalUv);',
          '    float minEdge = min(edge.x, edge.y);',
          '    ring = (1.0 - smoothstep(0.0, uBorderWidth, minEdge));',
          '    alpha = 1.0;',
          '  }',
          '  vec3 rgb = mix(portalColor.rgb, uBorderColor, ring);',
          '  gl_FragColor = vec4(rgb, alpha);',
          '}'
        ].join('\n')
      );
    };

    return mat;
  }

  function bindPortalMesh(portal) {
    var mesh = cubeMeshOf(portal.object);
    if (!mesh || !Array.isArray(mesh.material)) return false;

    var faceIndex = FACE_INDEX[portal.face] !== undefined ? FACE_INDEX[portal.face] : 0;
    var slot = FACE_SLOT[faceIndex];
    if (slot === undefined) return false;

    var original = mesh.material[slot];
    var clone = createPortalMaterial(portal, original);
    mesh.material[slot] = clone;

    portal.binding = {
      mesh: mesh,
      slot: slot,
      original: original,
      clone: clone
    };
    return true;
  }

  function restorePortalMesh(portal) {
    if (!portal.binding) return;
    var b = portal.binding;
    try {
      if (b.mesh && Array.isArray(b.mesh.material) && b.mesh.material[b.slot] === b.clone) {
        b.mesh.material[b.slot] = b.original;
      }
      if (b.clone) b.clone.dispose();
    } catch (e) {}
    portal.binding = null;
  }

  /* -------------------------------------------------------- portal finders */

  function findPortalByTag(state, tag) {
    if (!tag) return null;
    var found = null;
    state.portals.forEach(function (p) {
      if (p.tag === tag && !isDead(p.object)) found = p;
    });
    return found;
  }

  function getLinkedPortal(state, portal) {
    if (portal.linkedPortalRecord && !isDead(portal.linkedPortalRecord.object)) {
      return portal.linkedPortalRecord;
    }
    if (portal.linkedTag) {
      var found = findPortalByTag(state, portal.linkedTag);
      if (found && found !== portal) {
        portal.linkedPortalRecord = found;
        return found;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- rendering */

  var _prevClearColor = null;

  function renderPortalView(renderer, runtimeScene, entryPortal, exitPortal, playerCam, state) {
    var scene = layerSceneOf(runtimeScene, exitPortal.layerName);
    if (!scene || !playerCam) return;

    ensureTarget(entryPortal, renderer, runtimeScene);
    if (!entryPortal.target) return;

    initScratch();

    // 1. Create or ensure secondary portal camera
    if (!entryPortal.virtualCamera) {
      entryPortal.virtualCamera = new THREE.PerspectiveCamera();
      entryPortal.virtualCamera.rotation.order = 'ZYX';
    }
    var vCam = entryPortal.virtualCamera;

    // 2. Compute relative camera transform: M_cam = M_rel * M_playerCam
    computePortalMatrix(entryPortal, exitPortal, _m4Rel);
    playerCam.updateMatrixWorld();
    _m4Cam.copy(_m4Rel).multiply(playerCam.matrixWorld);

    _m4Cam.decompose(_v3Pos, _qA, _v3B);
    vCam.position.copy(_v3Pos);
    vCam.quaternion.copy(_qA);
    vCam.fov = playerCam.fov || 60;
    vCam.near = playerCam.near || 1;
    vCam.far = playerCam.far || 2000;
    vCam.aspect = playerCam.aspect || (entryPortal.target.width / entryPortal.target.height);
    vCam.updateMatrixWorld(true);
    vCam.updateProjectionMatrix();

    // 3. Oblique Near Plane Clipping (culls geometry behind exit portal)
    if (entryPortal.obliqueClipping) {
      getPortalWorldTransform(exitPortal, _m4B, _v3Look); // _v3Look gets exit normal
      var exitPos = new THREE.Vector3().setFromMatrixPosition(_m4B);
      // Plane in world space: normal pointing out of exit portal
      _plane.setFromNormalAndCoplanarPoint(_v3Look, exitPos);
      // Transform plane into virtual camera space
      var clipPlaneCam = _plane.clone().applyMatrix4(vCam.matrixWorldInverse);
      vCam.projectionMatrix = applyObliqueClipping(vCam.projectionMatrix, clipPlaneCam);
    }

    // 4. Hide entry portal mesh to avoid recursive self-sampling feedback
    state.hiddenMeshes.length = 0;
    if (entryPortal.binding && entryPortal.binding.mesh) {
      state.hiddenMeshes.push(entryPortal.binding.mesh);
      entryPortal.binding.mesh.visible = false;
    }

    // 5. Render destination world into entry portal's target
    if (!_prevClearColor) _prevClearColor = new THREE.Color();
    renderer.getClearColor(_prevClearColor);
    var prevAlpha = renderer.getClearAlpha();

    var bg = scene.background;
    if (bg && bg.isColor) {
      renderer.setClearColor(bg, 1);
    } else {
      renderer.setClearColor(runtimeScene.getBackgroundColor(), 1);
    }

    try {
      renderer.setRenderTarget(entryPortal.target);
      renderer.clear(true, true, true);
      renderer.render(scene, vCam);
    } finally {
      // Unhide meshes
      for (var i = 0; i < state.hiddenMeshes.length; i++) {
        state.hiddenMeshes[i].visible = true;
      }
      state.hiddenMeshes.length = 0;
      renderer.setClearColor(_prevClearColor, prevAlpha);
    }

    // 6. Update shader uniform with fresh render target
    if (entryPortal.binding && entryPortal.binding.clone) {
      var shader = entryPortal.binding.clone.userData.shader;
      if (shader && shader.uniforms && shader.uniforms.uPortalMap) {
        shader.uniforms.uPortalMap.value = entryPortal.target.texture;
        shader.uniforms.uIsOpen.value = entryPortal.isOpen ? 1.0 : 0.0;
        shader.uniforms.uBorderColor.value.set(entryPortal.borderColor || '#00a2ff');
      }
    }
  }

  /* -------------------------------------------------- physical traversal */

  function updateTraversables(state, runtimeScene, dt) {
    if (!state.portals.size || !state.traversables.size) return;

    initScratch();

    state.traversables.forEach(function (trav) {
      if (isDead(trav.object)) return;

      // Reset single-frame flags
      trav.justTeleported = false;

      if (trav.cooldown > 0) {
        trav.cooldown -= dt;
        return;
      }

      var obj = trav.object;
      var currX = obj.getCenterXInScene ? obj.getCenterXInScene() : obj.getX();
      var currY = obj.getCenterYInScene ? obj.getCenterYInScene() : obj.getY();
      var currZ = obj.getCenterZInScene ? obj.getCenterZInScene() : (obj.getZ ? obj.getZ() : 0);

      var prevX = trav.prevX !== undefined ? trav.prevX : currX;
      var prevY = trav.prevY !== undefined ? trav.prevY : currY;
      var prevZ = trav.prevZ !== undefined ? trav.prevZ : currZ;

      // Test against each active linked portal
      state.portals.forEach(function (entryPortal) {
        if (!entryPortal.isOpen || isDead(entryPortal.object)) return;
        var exitPortal = getLinkedPortal(state, entryPortal);
        if (!exitPortal || !exitPortal.isOpen || isDead(exitPortal.object)) return;

        getPortalWorldTransform(entryPortal, _m4A, _v3Look); // _v3Look = normal
        var portalPos = new THREE.Vector3().setFromMatrixPosition(_m4A);

        // Convert GDevelop pos to Three coords: negate Y
        var pPrev = new THREE.Vector3(prevX, -prevY, prevZ);
        var pCurr = new THREE.Vector3(currX, -currY, currZ);

        // Signed distance from previous and current position to portal plane
        var dPrev = (pPrev.x - portalPos.x) * _v3Look.x +
                    (pPrev.y - portalPos.y) * _v3Look.y +
                    (pPrev.z - portalPos.z) * _v3Look.z;
        var dCurr = (pCurr.x - portalPos.x) * _v3Look.x +
                    (pCurr.y - portalPos.y) * _v3Look.y +
                    (pCurr.z - portalPos.z) * _v3Look.z;

        // Check plane crossing: moving from front (dPrev >= 0) to back (dCurr <= 0)
        if (dPrev >= -5 && dCurr <= 5 && (dPrev >= 0 || dCurr <= 0)) {
          // Check portal bounding dimensions
          var pw = (entryPortal.object.getWidth ? entryPortal.object.getWidth() : 64) * 0.7;
          var ph = (entryPortal.object.getHeight ? entryPortal.object.getHeight() : 64) * 0.7;
          var pz = (entryPortal.object.getDepth ? entryPortal.object.getDepth() : 64) * 0.7;
          var maxR = Math.max(pw, ph, pz);

          var distCenter = pCurr.distanceTo(portalPos);
          if (distCenter <= maxR) {
            // TELEPORT!
            teleportEntity(trav, entryPortal, exitPortal);
          }
        }
      });

      // Cache position for next frame plane crossing test
      trav.prevX = obj.getCenterXInScene ? obj.getCenterXInScene() : obj.getX();
      trav.prevY = obj.getCenterYInScene ? obj.getCenterYInScene() : obj.getY();
      trav.prevZ = obj.getCenterZInScene ? obj.getCenterZInScene() : (obj.getZ ? obj.getZ() : 0);
    });
  }

  function teleportEntity(trav, entryPortal, exitPortal) {
    initScratch();
    var obj = trav.object;
    computePortalMatrix(entryPortal, exitPortal, _m4Rel);

    var cx = obj.getCenterXInScene ? obj.getCenterXInScene() : obj.getX();
    var cy = obj.getCenterYInScene ? obj.getCenterYInScene() : obj.getY();
    var cz = obj.getCenterZInScene ? obj.getCenterZInScene() : (obj.getZ ? obj.getZ() : 0);

    // Three space coords: (x, -y, z)
    var pThree = new THREE.Vector3(cx, -cy, cz).applyMatrix4(_m4Rel);

    // Get exit portal forward normal to nudge entity outward
    getPortalWorldTransform(exitPortal, _m4B, _v3Look);
    var exitOffset = trav.exitOffset !== undefined ? trav.exitOffset : 20.0;
    pThree.addScaledVector(_v3Look, exitOffset);

    // Convert back to GDevelop: (x, -y, z)
    var newX = pThree.x;
    var newY = -pThree.y;
    var newZ = pThree.z;

    if (obj.setX) obj.setX(newX);
    if (obj.setY) obj.setY(newY);
    if (obj.setZ) obj.setZ(newZ);

    // Rotate orientation
    var rx = obj.getRotationX ? obj.getRotationX() : 0;
    var ry = obj.getRotationY ? obj.getRotationY() : 0;
    var rz = obj.getAngle ? obj.getAngle() : 0;

    _euler.set(gdjs.toRad(rx), gdjs.toRad(ry), gdjs.toRad(rz), 'ZYX');
    _m4Cam.makeRotationFromEuler(_euler);
    _m4Cam.premultiply(_m4Rel);
    _euler.setFromRotationMatrix(_m4Cam, 'ZYX');

    if (obj.setAngle) obj.setAngle(gdjs.toDegrees(_euler.z));
    if (obj.setRotationX) obj.setRotationX(gdjs.toDegrees(_euler.x));
    if (obj.setRotationY) obj.setRotationY(gdjs.toDegrees(_euler.y));

    // Redirect Physics Velocity if present
    if (trav.redirectVelocity) {
      redirectObjectVelocity(obj, _m4Rel);
    }

    trav.cooldown = trav.teleportCooldown || 0.15;
    trav.justTeleported = true;
    trav.lastPortalTag = entryPortal.tag;
    trav.prevX = newX;
    trav.prevY = newY;
    trav.prevZ = newZ;
  }

  function redirectObjectVelocity(obj, mRel) {
    var rotMatrix = new THREE.Matrix3().setFromMatrix4(mRel);
    // Check for physics behaviors with getLinearVelocity
    if (obj._behaviors) {
      for (var i = 0; i < obj._behaviors.length; i++) {
        var b = obj._behaviors[i];
        if (b && typeof b.getLinearVelocityX === 'function') {
          var vx = b.getLinearVelocityX();
          var vy = b.getLinearVelocityY();
          var vz = b.getLinearVelocityZ ? b.getLinearVelocityZ() : 0;
          // Three coords: (vx, -vy, vz)
          var v3 = new THREE.Vector3(vx, -vy, vz).applyMatrix3(rotMatrix);
          if (b.setLinearVelocity) b.setLinearVelocity(v3.x, -v3.y, v3.z);
        }
      }
    }
  }

  /* ------------------------------------------------------------- main loop */

  function tick(runtimeScene) {
    if (!THREE_OK) return;
    var state = scenes.get(runtimeScene);
    if (!state || !state.portals.size) return;

    var dt = (runtimeScene.getElapsedTime ? runtimeScene.getElapsedTime() : 16.6) / 1000.0;

    // 1. Run physical traversal checks before rendering
    updateTraversables(state, runtimeScene, dt);

    var renderer = threeRendererOf(runtimeScene);
    if (!renderer) return;

    // 2. Determine active portals that need rendering
    var renderPairs = [];
    state.portals.forEach(function (portalA) {
      if (isDead(portalA.object) || !portalA.isOpen) return;

      // Revalidate mesh binding
      if (!portalA.binding) bindPortalMesh(portalA);

      var portalB = getLinkedPortal(state, portalA);
      if (portalB && !isDead(portalB.object) && portalB.isOpen) {
        renderPairs.push({ entry: portalA, exit: portalB });
      }
    });

    if (!renderPairs.length) return;

    // Find main player camera on layer
    var playerCam = layerCameraOf(runtimeScene, renderPairs[0].entry.layerName);
    if (!playerCam) return;

    // WebGL state protection
    renderer.resetState();
    var prevAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    var prevTarget = renderer.getRenderTarget();

    try {
      for (var k = 0; k < renderPairs.length; k++) {
        renderPortalView(renderer, runtimeScene, renderPairs[k].entry, renderPairs[k].exit, playerCam, state);
      }
    } catch (e) {
      warnOnce('renderFail', 'Portal render pass error: ' + (e && e.message ? e.message : e));
    } finally {
      renderer.setRenderTarget(prevTarget || null);
      renderer.shadowMap.autoUpdate = prevAutoUpdate;
      renderer.resetState();
      var gr = runtimeScene.getGame().getRenderer();
      var pixi = gr && gr.getPIXIRenderer ? gr.getPIXIRenderer() : null;
      if (pixi && pixi.reset) { try { pixi.reset(); } catch (e2) {} }
    }
  }

  /* ------------------------------------------------------------ public API */

  var NS = {
    PRESETS: PRESETS,
    FACE_INDEX: FACE_INDEX,
    FACE_SLOT: FACE_SLOT,

    registerPortal: function (runtimeScene, object, behavior, options) {
      if (!THREE_OK) return null;
      var state = stateOf(runtimeScene);
      var portal = behavior.__portal3DRecord;
      if (!portal) {
        portal = behavior.__portal3DRecord = {
          object: object,
          behavior: behavior,
          layerName: object.getLayer(),
          binding: null,
          virtualCamera: null,
          target: null,
          textureEpoch: 0,
          linkedPortalRecord: null
        };
        state.portals.add(portal);
        bindPortalMesh(portal);
      }
      NS.configurePortal(portal, options);
      portal.layerName = object.getLayer();
      return portal;
    },

    configurePortal: function (portal, o) {
      if (!portal || !o) return;
      portal.tag = o.tag !== undefined ? o.tag : (portal.tag || 'Blue');
      portal.linkedTag = o.linkedTag !== undefined ? o.linkedTag : (portal.linkedTag || '');
      portal.face = o.face || portal.face || 'Front';
      portal.shape = o.shape || portal.shape || 'Oval';
      portal.borderColor = o.borderColor || portal.borderColor || '#00a2ff';
      portal.borderWidth = o.borderWidth !== undefined ? o.borderWidth : (portal.borderWidth || 0.08);
      portal.preset = o.preset || portal.preset || 'Standard';
      portal.customW = o.customW || portal.customW || 512;
      portal.customH = o.customH || portal.customH || 512;
      portal.obliqueClipping = o.obliqueClipping !== undefined ? !!o.obliqueClipping : true;
      portal.forwardAxis = o.forwardAxis || portal.forwardAxis || '+Z';
      portal.isOpen = o.isOpen !== undefined ? !!o.isOpen : true;
    },

    disposePortal: function (runtimeScene, behavior) {
      var portal = behavior && behavior.__portal3DRecord;
      if (!portal) return;
      var state = scenes.get(runtimeScene);
      if (state) state.portals.delete(portal);
      restorePortalMesh(portal);
      disposeTarget(portal);
      portal.virtualCamera = null;
      behavior.__portal3DRecord = null;
    },

    portalOf: function (behavior) {
      return behavior ? behavior.__portal3DRecord : null;
    },

    registerTraversable: function (runtimeScene, object, behavior, options) {
      var state = stateOf(runtimeScene);
      var trav = behavior.__portalTraversableRecord;
      if (!trav) {
        trav = behavior.__portalTraversableRecord = {
          object: object,
          behavior: behavior,
          cooldown: 0,
          justTeleported: false,
          lastPortalTag: ''
        };
        state.traversables.add(trav);
      }
      trav.enabled = options.enabled !== undefined ? !!options.enabled : true;
      trav.teleportCooldown = options.teleportCooldown !== undefined ? options.teleportCooldown : 0.15;
      trav.redirectVelocity = options.redirectVelocity !== undefined ? !!options.redirectVelocity : true;
      trav.redirectCamera = options.redirectCamera !== undefined ? !!options.redirectCamera : true;
      trav.exitOffset = options.exitOffset !== undefined ? options.exitOffset : 20.0;
      return trav;
    },

    disposeTraversable: function (runtimeScene, behavior) {
      var trav = behavior && behavior.__portalTraversableRecord;
      if (!trav) return;
      var state = scenes.get(runtimeScene);
      if (state) state.traversables.delete(trav);
      behavior.__portalTraversableRecord = null;
    },

    traversableOf: function (behavior) {
      return behavior ? behavior.__portalTraversableRecord : null;
    },

    linkPortals: function (runtimeScene, portalAObject, portalBObject) {
      var state = scenes.get(runtimeScene);
      if (!state) return false;
      var pA = null, pB = null;
      state.portals.forEach(function (p) {
        if (p.object === portalAObject) pA = p;
        if (p.object === portalBObject) pB = p;
      });
      if (pA && pB) {
        pA.linkedPortalRecord = pB;
        pB.linkedPortalRecord = pA;
        pA.linkedTag = pB.tag;
        pB.linkedTag = pA.tag;
        return true;
      }
      return false;
    },

    teleportObjectManual: function (runtimeScene, object, entryObj, exitObj, redirectVel) {
      var state = scenes.get(runtimeScene);
      if (!state) return false;
      var pA = null, pB = null;
      state.portals.forEach(function (p) {
        if (p.object === entryObj) pA = p;
        if (p.object === exitObj) pB = p;
      });
      if (!pA || !pB) return false;
      var mockTrav = {
        object: object,
        redirectVelocity: !!redirectVel,
        exitOffset: 20.0,
        cooldown: 0.15
      };
      teleportEntity(mockTrav, pA, pB);
      return true;
    },

    computePortalMatrix: computePortalMatrix,
    applyObliqueClipping: applyObliqueClipping,
    tick: tick,

    disposeScene: function (runtimeScene) {
      var state = scenes.get(runtimeScene);
      if (!state) return;
      state.portals.forEach(function (p) {
        restorePortalMesh(p);
        disposeTarget(p);
      });
      state.portals.clear();
      state.traversables.clear();
      scenes.delete(runtimeScene);
    }
  };

  gdjs.__portal3D = NS;

  /* --------------------------------------------------------- engine hooks */

  if (gdjs.registerRuntimeScenePostEventsCallback) {
    gdjs.registerRuntimeScenePostEventsCallback(function (runtimeScene) {
      try { tick(runtimeScene); } catch (e) {
        warnOnce('tick', 'Portal tick failed: ' + (e && e.message ? e.message : e));
      }
    });
  }

  if (gdjs.registerRuntimeSceneUnloadedCallback) {
    gdjs.registerRuntimeSceneUnloadedCallback(function (runtimeScene) {
      try { NS.disposeScene(runtimeScene); } catch (e) {}
    });
  }
})();
