/**
 * InGameCamera3D — live in-game camera feeds on 3D screens.
 *
 * Renders a GDevelop 3D layer from a second camera into an offscreen target,
 * and binds that target onto a face of a Cube3D.
 *
 * Everything marked [verified] was read out of the installed GDJS runtime
 * (GDevelop 5.6.279, Three r160). See PLAN.md for the full reasoning; the
 * correction numbers below (C1, C5, ...) refer to that document.
 *
 * The three rules that this whole file exists to obey:
 *   C1  renderer.autoClear is false and nothing restores the render target,
 *       so every pass must clear explicitly and unbind in a finally block.
 *   C3  the pass runs at post-events, outside the render phase, so GL state
 *       must be handed back to PIXI and Three afterwards.
 *   C5  materials are memoised game-wide, so a binding must clone before it
 *       mutates, and revalidate every frame in case the mesh is replaced.
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__inGameCamera3D) return; // embedded in many blocks; install once

  var THREE_OK = typeof THREE !== 'undefined';

  /* ------------------------------------------------------------ constants */

  // C19 — resolution presets. The target IS the camera's resolution.
  var PRESETS = {
    Tiny: [160, 120],
    Low: [320, 240],
    Standard: [512, 512],
    SD: [640, 480],
    HD: [1280, 720]
  };

  // Cube3D face order is [front, back, left, right, top, bottom]. [verified]
  var FACE_INDEX = { Front: 0, Back: 1, Left: 2, Right: 3, Top: 4, Bottom: 5 };

  // GDevelop face index -> Three material slot. This permutation is the
  // renderer's own `g` table; "Front" is NOT slot 0. [verified] (C5)
  var FACE_SLOT = { 0: 4, 1: 5, 2: 1, 3: 0, 4: 3, 5: 2 };

  // Local axis the camera films along, in GDevelop object space.
  var FORWARD_AXIS = {
    '+X': [1, 0, 0], '-X': [-1, 0, 0],
    '+Y': [0, 1, 0], '-Y': [0, -1, 0],
    '+Z': [0, 0, 1], '-Z': [0, 0, -1]
  };

  // RuntimeObject has no isDestroyed(); the flag is _livingOnScene. [verified]
  function isDead(object) {
    return !object || object._livingOnScene === false;
  }

  var warned = {};
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[InGameCamera3D] ' + message);
  }

  /* --------------------------------------------------------- scene state */

  var scenes = new Map();

  function stateOf(runtimeScene) {
    var s = scenes.get(runtimeScene);
    if (!s) {
      s = {
        cameras: new Set(),        // Camera3D behavior records (C18: no name registry)
        layerViews: new Map(),     // layer name -> 3D layer view (mode A)
        layerCaptures: new Map(),  // layer name -> 2D layer grab
        bindings: new Set(),       // one per LiveScreen behavior instance
        hidden: []                 // scratch for the recursion guard
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

  /* -------------------------------------------------------------- targets */

  function resolveSize(preset, customW, customH, renderer) {
    var size = PRESETS[preset];
    var w, h;
    if (size) {
      w = size[0];
      h = size[1];
    } else {
      w = Math.floor(customW) || 512;
      h = Math.floor(customH) || 512;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);

    // C19 — Custom invites someone to type 4096 and meet a silent failure
    // on mobile. Clamp and say so once.
    var max = renderer && renderer.capabilities ? renderer.capabilities.maxTextureSize : 0;
    if (max && (w > max || h > max)) {
      warnOnce('maxTexture', 'Camera resolution ' + w + 'x' + h +
        ' exceeds this device\'s maximum texture size (' + max + '); clamped.');
      w = Math.min(w, max);
      h = Math.min(h, max);
    }
    return [w, h];
  }

  function makeTarget(w, h, nearest, samples) {
    // C9 — the colour chain is: encode into the target here, the screen
    // material decodes because the texture declares sRGB, the main output
    // encodes once at the end. One encode, one decode, one encode.
    var filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    var target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: samples > 0 ? samples : 0
    });
    if (THREE.SRGBColorSpace !== undefined) {
      target.texture.colorSpace = THREE.SRGBColorSpace;
    }
    target.texture.generateMipmaps = false;

    // C6 — Cube3D's updateTextureUvMapping() reads map.source.data.width in
    // the repeat branch. A render target texture has source.data === null, so
    // resizing a bound cube with "repeat texture" on is a TypeError, not a
    // wrong number. This shim makes the arithmetic work instead of merely not
    // crashing.
    try {
      if (target.texture.source && !target.texture.source.data) {
        target.texture.source.data = { width: w, height: h };
      }
    } catch (e) { /* shim is best-effort; the documented limit still stands */ }

    return target;
  }

  function disposeTarget(cam) {
    if (!cam.target) return;
    try { cam.target.dispose(); } catch (e) {}
    cam.target = null;
  }

  function ensureTarget(cam, renderer) {
    var size = resolveSize(cam.preset, cam.customW, cam.customH, renderer);
    var w = size[0], h = size[1];
    var nearest = cam.filtering === 'Nearest';

    if (cam.target && cam.target.width === w && cam.target.height === h &&
        cam.nearest === nearest && cam.samples === cam.appliedSamples) {
      return cam.target;
    }

    // C19 — dispose before allocating, or a resolution wired to a slider
    // leaks at exactly the rate the user drags it.
    disposeTarget(cam);
    cam.rendered = false;
    cam.target = makeTarget(w, h, nearest, cam.samples);
    cam.nearest = nearest;
    cam.appliedSamples = cam.samples;
    cam.textureEpoch = (cam.textureEpoch || 0) + 1;
    return cam.target;
  }

  /* ------------------------------------------------------------ transform */

  var _clearPrev = null, _bgColor = null;
  var _m4 = null, _euler = null, _v3 = null, _up = null;
  function scratch() {
    if (!_m4) {
      _m4 = new THREE.Matrix4();
      _euler = new THREE.Euler();
      _v3 = new THREE.Vector3();
      _up = new THREE.Vector3();
    }
  }

  /**
   * Place a mode B camera from its object's logical transform.
   *
   * C3 — read getX/getY/getZ, never the Three object's .position: at
   * post-events the meshes still hold last frame's transform, because
   * _updateObjectsPreRender() has not run yet. [verified]
   *
   * C8 — Three world space and GDevelop space differ by a negated Y. Object
   * renderers do not negate because the layer's THREE.Scene is itself built
   * with scale.y = -1; the camera is not inside that scene, so it must.
   * [verified]
   *
   * The convention: a camera films along its object's local forward axis
   * (+X by default, i.e. angle 0 faces right, matching 2D), with +Z as up.
   */
  function syncTransform(cam, object) {
    scratch();

    var cx = object.getCenterXInScene ? object.getCenterXInScene() : object.getX();
    var cy = object.getCenterYInScene ? object.getCenterYInScene() : object.getY();
    var cz = object.getCenterZInScene ? object.getCenterZInScene()
           : (object.getZ ? object.getZ() : 0);

    var rx = object.getRotationX ? object.getRotationX() : 0;
    var ry = object.getRotationY ? object.getRotationY() : 0;
    var rz = object.getAngle ? object.getAngle() : 0;

    // Match the object renderer's own Euler convention. [verified]
    _euler.set(gdjs.toRad(rx), gdjs.toRad(ry), gdjs.toRad(rz), 'ZYX');
    _m4.makeRotationFromEuler(_euler);

    var axis = FORWARD_AXIS[cam.forwardAxis] || FORWARD_AXIS['+X'];
    _v3.set(axis[0], axis[1], axis[2]).applyMatrix4(_m4);
    _up.set(0, 0, 1).applyMatrix4(_m4);

    // GDevelop -> Three: negate Y on the position and on every direction.
    cam.threeCamera.position.set(cx, -cy, cz);
    cam.threeCamera.up.set(_up.x, -_up.y, _up.z);
    cam.threeCamera.lookAt(cx + _v3.x, -cy - _v3.y, cz + _v3.z);
  }

  function ensureCamera(cam) {
    if (!cam.threeCamera) {
      cam.threeCamera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
      cam.threeCamera.rotation.order = 'ZYX';
    }
    var c = cam.threeCamera;
    var w = cam.target ? cam.target.width : 1;
    var h = cam.target ? cam.target.height : 1;
    var aspect = h > 0 ? w / h : 1;
    if (c.fov !== cam.fov || c.near !== cam.near || c.far !== cam.far ||
        c.aspect !== aspect) {
      c.fov = cam.fov;
      c.near = cam.near;
      c.far = cam.far;
      c.aspect = aspect; // C19 — resolution sets shape, not only sharpness
      c.updateProjectionMatrix();
    }
    return c;
  }

  /**
   * Mode A — mirror the layer's own camera into a camera of our own.
   *
   * Copy, never borrow: the layer camera's aspect comes from the game
   * resolution, so a target of another shape would need an override on live
   * engine state, and a throw between override and restore would leave the
   * player's projection wrong. Copying is ~8 assignments and removes the
   * failure class. Orthographic layers must be mirrored as orthographic.
   */
  function syncLayerView(cam, runtimeScene) {
    var layer = runtimeScene.getLayer(cam.layerName);
    var lr = layer && layer.getRenderer && layer.getRenderer();
    var src = lr && lr.getThreeCamera ? lr.getThreeCamera() : null;
    if (!src) {
      warnOnce('nocam:' + cam.layerName,
        'Layer "' + cam.layerName + '" has no 3D camera, so its view cannot be filmed.');
      return null;
    }

    var wantOrtho = !!src.isOrthographicCamera;
    var have = cam.threeCamera;
    if (!have || !!have.isOrthographicCamera !== wantOrtho) {
      have = cam.threeCamera = wantOrtho
        ? new THREE.OrthographicCamera(-1, 1, 1, -1, src.near, src.far)
        : new THREE.PerspectiveCamera(60, 1, src.near, src.far);
      have.rotation.order = 'ZYX';
    }

    src.updateMatrixWorld();
    have.position.copy(src.position);
    have.quaternion.copy(src.quaternion);
    have.near = src.near;
    have.far = src.far;

    var w = cam.target ? cam.target.width : 1;
    var h = cam.target ? cam.target.height : 1;
    if (wantOrtho) {
      // Preserve the vertical extent, re-derive the horizontal for our aspect.
      var halfH = (src.top - src.bottom) / 2;
      var halfW = halfH * (h > 0 ? w / h : 1);
      have.left = -halfW; have.right = halfW;
      have.top = halfH; have.bottom = -halfH;
      have.zoom = src.zoom;
    } else {
      have.fov = src.fov;
      have.aspect = h > 0 ? w / h : 1;
    }
    have.updateProjectionMatrix();
    return have;
  }

  /* --------------------------------------------------- 2D layer as source */

  /**
   * Grab a 2D layer straight onto a screen — for arcade cabinets, in-game
   * minigames, computer terminals.
   *
   * The layer's PIXI container is rendered into a PIXI.RenderTexture and that
   * texture's GL handle is handed to a THREE.Texture. PIXI and Three share one
   * GL context here, so this is zero-copy: no readback, no per-frame upload.
   * The recipe (and the four hazards below) come from 3DCRT+'s _ensureOverlay,
   * where they were already found the hard way.
   *
   * We render the container ourselves rather than relying on the engine, which
   * is what lets a HIDDEN layer be the source: the minigame runs, its events
   * tick as normal, and it appears only on the screen.
   */
  function grab2DLayer(cam, runtimeScene, threeRenderer) {
    if (typeof PIXI === 'undefined') return false;
    var gameRenderer = runtimeScene.getGame().getRenderer();
    var pixi = gameRenderer && gameRenderer.getPIXIRenderer
      ? gameRenderer.getPIXIRenderer() : null;
    if (!pixi || !threeRenderer) return false;

    var layer = runtimeScene.getLayer(cam.layerName);
    var lr = layer && layer.getRenderer && layer.getRenderer();
    var container = lr && lr._pixiContainer;
    if (!container) return false;

    var size = resolveSize(cam.preset, cam.customW, cam.customH, threeRenderer);
    var w = size[0], h = size[1];

    if (!cam.pixiRT) {
      cam.pixiRT = PIXI.RenderTexture.create({ width: w, height: h });
      cam.textureEpoch = (cam.textureEpoch || 0) + 1;
    } else if (cam.pixiRT.width !== w || cam.pixiRT.height !== h) {
      cam.pixiRT.resize(w, h);
      cam.textureEpoch = (cam.textureEpoch || 0) + 1;
    }

    // 1. Three has left the shared context in its own state, so PIXI would
    //    otherwise render nothing at all.
    try { if (pixi.reset) pixi.reset(); } catch (e) {}

    var game = runtimeScene.getGame();
    var gw = game.getGameResolutionWidth() || w;
    var gh = game.getGameResolutionHeight() || h;
    var sx = cam.fit === 'None' ? 1 : w / gw;
    var sy = cam.fit === 'None' ? 1 : h / gh;
    if (cam.fit === 'Uniform') { sx = sy = Math.min(w / gw, h / gh); }

    // Centre whatever is left over. Without this, Uniform scales correctly but
    // anchors the result at the origin, so it reads as a badly-placed Stretch
    // rather than a letterbox — and None shows the top-left corner of the
    // layer instead of the middle of it. Zero for Stretch, which fills exactly.
    var offsetX = (w - gw * sx) / 2;
    var offsetY = (h - gh * sy) / 2;

    var pv = container.visible, pr = container.renderable, pa = container.alpha;
    var px = container.position.x, py = container.position.y;
    var pscaleX = container.scale.x, pscaleY = container.scale.y;

    container.visible = true;
    container.renderable = true;
    container.alpha = 1;
    if (sx !== 1 || sy !== 1 || offsetX !== 0 || offsetY !== 0) {
      // The container already carries the layer's own camera transform, so
      // compose with it — and scale the POSITION too, or the content lands
      // off-centre by the game-resolution offset it was holding. [verified]
      container.scale.set(pscaleX * sx, pscaleY * sy);
      container.position.set(px * sx + offsetX, py * sy + offsetY);
    }

    try {
      pixi.render(container, { renderTexture: cam.pixiRT, clear: true });
    } catch (e) {
      warnOnce('grab:' + cam.layerName, 'Could not capture 2D layer "' +
        cam.layerName + '": ' + (e && e.message ? e.message : e));
    }

    container.visible = pv;
    container.renderable = pr;
    container.alpha = pa;
    container.position.set(px, py);
    container.scale.set(pscaleX, pscaleY);

    // 2. Rebind PIXI to the screen framebuffer. Without this, every 2D layer
    //    GDevelop draws later in the frame inherits the RenderTexture's
    //    flipped projection and comes out mirrored. It matters more here than
    //    it did in 3DCRT+: that grabbed mid-render, we grab at post-events,
    //    before PIXI has drawn anything at all this frame.
    try { if (pixi.renderTexture && pixi.renderTexture.bind) pixi.renderTexture.bind(null); } catch (e) {}
    try { if (pixi.reset) pixi.reset(); } catch (e) {}
    try { if (threeRenderer.resetState) threeRenderer.resetState(); } catch (e) {}

    var base = cam.pixiRT.baseTexture;
    try { if (pixi.texture && pixi.texture.bind) pixi.texture.bind(base, 0); } catch (e) {}
    var glRec = base._glTextures && base._glTextures[pixi.CONTEXT_UID];
    var glHandle = glRec && glRec.texture;
    if (!glHandle) return false;

    if (!cam.texture) {
      var t = new THREE.Texture();
      // 3. Tells Three the texture is already on the GPU and must not be
      //    uploaded or flipped by the usual path.
      t.isRenderTargetTexture = true;
      var nearest = cam.filtering === 'Nearest';
      t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      // A PIXI RenderTexture is V-flipped relative to Three. flipY cannot help
      // on a borrowed handle (it applies at upload), so flip in the texture
      // transform instead.
      t.repeat.set(1, -1);
      t.offset.set(0, 1);
      cam.texture = t;
      cam.textureEpoch = (cam.textureEpoch || 0) + 1;
    }

    var props = threeRenderer.properties && threeRenderer.properties.get(cam.texture);
    if (!props) return false;
    props.__webglTexture = glHandle;
    props.__webglInit = true;
    cam.textureOwner = threeRenderer;
    return true;
  }

  /**
   * 4. Clear the borrowed handle BEFORE disposing our wrapper, or Three
   *    deletes a GL texture that PIXI still owns.
   */
  function dispose2DCapture(cam) {
    try {
      if (cam.texture && cam.textureOwner && cam.textureOwner.properties) {
        var p = cam.textureOwner.properties.get(cam.texture);
        if (p) { p.__webglTexture = undefined; p.__webglInit = false; }
      }
    } catch (e) {}
    if (cam.texture) { try { cam.texture.dispose(); } catch (e) {} cam.texture = null; }
    if (cam.pixiRT) { try { cam.pixiRT.destroy(true); } catch (e) {} cam.pixiRT = null; }
    cam.textureOwner = null;
  }

  /** Every source kind resolves to one texture for the screen material. */
  function sourceTexture(cam) {
    if (!cam) return null;
    if (cam.is2DLayer) return cam.texture || null;
    // A freshly allocated WebGLRenderTarget holds undefined GPU memory, which
    // shows up as flat white or black. Never hand it to a screen until a pass
    // has actually drawn into it — otherwise every "allocated but not rendered"
    // path (no camera, nothing to film, first frame) silently repaints the
    // object instead of leaving it alone.
    if (!cam.rendered) return null;
    return cam.target ? cam.target.texture : null;
  }

  /* ------------------------------------------------------------- bindings */

  function screenMeshesOf(object) {
    var renderer = object.getRenderer && object.getRenderer();
    if (!renderer) return null;
    var root = renderer.get3DRendererObject
      ? renderer.get3DRendererObject()
      : (renderer._threeObject || null);
    return root || null;
  }

  function cubeMeshOf(object) {
    var renderer = object.getRenderer && object.getRenderer();
    return renderer && renderer._boxMesh ? renderer._boxMesh : null;
  }

  /**
   * C5 — pixi-image-manager memoises materials by resource name, so the
   * material on this cube's front face is the SAME OBJECT as on every other
   * cube using that texture. Assigning our target to it in place would turn
   * every cube in the game into a TV. Always clone, per instance.
   */
  function bindCubeFace(binding, object, faceName) {
    var mesh = cubeMeshOf(object);
    if (!mesh || !Array.isArray(mesh.material)) return false;

    var faceIndex = FACE_INDEX[faceName];
    if (faceIndex === undefined) faceIndex = 0;
    var slot = FACE_SLOT[faceIndex];
    if (slot === undefined) return false;

    var original = mesh.material[slot];
    var clone = makeScreenMaterial(binding, original);
    mesh.material[slot] = clone;

    binding.mesh = mesh;
    binding.slots = [{ mesh: mesh, slot: slot, original: original, clone: clone }];
    binding.installed = true;
    binding.kind = 'cube';
    binding.faceIndex = faceIndex;
    return true;
  }

  function makeScreenMaterial(binding, original) {
    // C11 — MeshBasicMaterial by default: a monitor is emissive by nature,
    // it is cheaper, and it is immune to useLegacyLights conventions. The lit
    // option puts the feed on both .map and .emissiveMap.
    var mat;
    if (binding.materialMode === 'Lit') {
      mat = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 1,
        emissive: new THREE.Color(0xffffff)
      });
    } else {
      mat = new THREE.MeshBasicMaterial();
    }
    // C5 — cube faces are built with vertexColors: true and updateTint()
    // writes a colour attribute. Without this the object's tint silently
    // stops applying to the bound face.
    if (original && original.vertexColors) mat.vertexColors = true;
    if (original && original.side !== undefined) mat.side = original.side;
    if (binding.doubleSided) mat.side = THREE.DoubleSide;
    mat.name = original && original.name ? original.name : 'InGameCamera3D screen';
    mat.toneMapped = false;
    return mat;
  }

  /**
   * Put our screen material on the mesh, or take it back off.
   *
   * Taking it off matters: a screen material with no texture is a plain white
   * slab, so a camera that cannot produce a feed would silently repaint the
   * object white — worse than doing nothing, because it destroys whatever the
   * object already looked like. Falling back to the original material means an
   * unavailable feed leaves the TV looking like a TV.
   */
  function setInstalled(binding, installed) {
    if (!binding.slots || binding.installed === installed) return;
    for (var i = 0; i < binding.slots.length; i++) {
      var s = binding.slots[i];
      var want = installed ? s.clone : s.original;
      if (!want) continue;
      if (s.slot >= 0 && Array.isArray(s.mesh.material)) s.mesh.material[s.slot] = want;
      else s.mesh.material = want;
    }
    binding.installed = installed;
  }

  function applyTexture(binding, cam) {
    var texture = sourceTexture(cam);
    if (!texture) {
      setInstalled(binding, false);
      binding.textureEpoch = -1;
      return;
    }
    for (var i = 0; i < binding.slots.length; i++) {
      var s = binding.slots[i];
      if (!s.clone) continue;
      if (s.clone.map !== texture) {
        s.clone.map = texture;
        if (s.clone.emissiveMap !== undefined && binding.materialMode === 'Lit') {
          s.clone.emissiveMap = texture;
        }
        s.clone.needsUpdate = true;
      }
    }
    setInstalled(binding, true);
    binding.textureEpoch = cam.textureEpoch;
  }

  function restoreBinding(binding) {
    if (!binding.slots) return;
    for (var i = 0; i < binding.slots.length; i++) {
      var s = binding.slots[i];
      try {
        if (s.slot >= 0 && Array.isArray(s.mesh.material)) {
          if (s.mesh.material[s.slot] === s.clone) s.mesh.material[s.slot] = s.original;
        } else if (s.mesh.material === s.clone) {
          s.mesh.material = s.original;
        }
      } catch (e) {}
      try { if (s.clone) s.clone.dispose(); } catch (e) {}
    }
    binding.slots = null;
  }

  /**
   * Cube3D can replace its mesh or a single material slot underneath us —
   * updateFace() and a model reload both do it, with no notification. Compare
   * identity once per frame and reattach. Cheap, and it covers hot reload too.
   */
  function revalidate(binding) {
    if (isDead(binding.object)) return false;
    if (binding.kind === 'cube') {
      var mesh = cubeMeshOf(binding.object);
      if (mesh && mesh !== binding.mesh) {
        binding.slots = null;
        return bindCubeFace(binding, binding.object, binding.faceName);
      }
      // updateFace() can also replace a single slot in place.
      if (mesh && binding.slots && binding.slots.length === 1) {
        var s = binding.slots[0];
        if (binding.installed && mesh.material[s.slot] !== s.clone) {
          s.original = mesh.material[s.slot];
          mesh.material[s.slot] = s.clone;
        }
      }
    }
    return true;
  }

  /* ------------------------------------------------------------ the pass */

  function cameraIsDue(cam, elapsedSeconds) {
    if (!cam.enabled) return false;
    if (!cam.fpsCap || cam.fpsCap <= 0) return true;
    cam.accumulator = (cam.accumulator || 0) + elapsedSeconds;
    var period = 1 / cam.fpsCap;
    if (cam.accumulator < period) return false;
    // Never let a long stall queue up a burst of catch-up frames.
    cam.accumulator = Math.min(cam.accumulator - period, period);
    return true;
  }

  function hideForPass(state, cam) {
    state.hidden.length = 0;

    // The WebGL feedback-loop error fires on ANY draw that samples the texture
    // currently bound as the framebuffer's colour attachment, so hide every
    // screen bound to THIS camera — not just one. Screens on other cameras are
    // a different texture and stay visible, which is what makes a wall of
    // monitors filming each other work.
    state.bindings.forEach(function (b) {
      if (b.camera !== cam || !b.slots) return;
      for (var i = 0; i < b.slots.length; i++) {
        var mesh = b.slots[i].mesh;
        if (mesh && mesh.visible) {
          state.hidden.push(mesh);
          mesh.visible = false;
        }
      }
    });

    // Hide the camera's own object too. The camera sits at its object's centre,
    // so it is inside its own geometry and films the inside of it. Backface
    // culling hides that while the object uses FrontSide materials — but turn
    // on a transparent texture and Cube3D switches to DoubleSide, and the feed
    // goes black with no visible cause. Hiding the whole object is exempt from
    // the face-slot machinery, and it cannot be noticed from anywhere except
    // this camera's own feed.
    if (!cam.isLayerView && !cam.is2DLayer && cam.object) {
      var own = screenMeshesOf(cam.object);
      if (own && own.visible) {
        state.hidden.push(own);
        own.visible = false;
      }
    }
  }

  function restoreHidden(state) {
    for (var i = 0; i < state.hidden.length; i++) state.hidden[i].visible = true;
    state.hidden.length = 0;
  }

  function renderCamera(renderer, runtimeScene, cam, state) {
    var scene = layerSceneOf(runtimeScene, cam.layerName);
    if (!scene) {
      // A pure 2D layer has no THREE.Scene at all — the engine only builds one
      // for 3D and "2D and 3D" layers. [verified: _setup3DRendering]
      warnOnce('no3d:' + cam.layerName,
        'Layer "' + cam.layerName + '" is a 2D layer, so a 3D layer view cannot ' +
        'film it. Use "Show a 2D layer on a 3D Box face" instead.');
      return;
    }

    // A "2D and 3D" layer HAS a Three scene, but if nothing 3D is on it that
    // scene contains only the plane that displays the layer's 2D content — and
    // that plane's texture is filled during the main render, not before it. So
    // filming it here captures an unwritten texture: flat white. Point them at
    // the action that actually does what they want.
    var lr0 = runtimeScene.getLayer(cam.layerName);
    var lrr = lr0 && lr0.getRenderer && lr0.getRenderer();
    if (cam.isLayerView && lrr && lrr.has3DObjects && !lrr.has3DObjects()) {
      warnOnce('empty3d:' + cam.layerName,
        'Layer "' + cam.layerName + '" has no 3D objects on it, so a 3D layer view ' +
        'has nothing to film. If what you want on the screen is that layer\'s 2D ' +
        'content, use "Show a 2D layer on a 3D Box face" instead.');
      return;
    }

    ensureTarget(cam, renderer);

    var threeCamera;
    if (cam.isLayerView) {
      threeCamera = syncLayerView(cam, runtimeScene);
    } else {
      // ensureCamera() CREATES the camera, so it must run before
      // syncTransform() places it. Getting this the wrong way round throws on
      // the very first pass and leaves the target black for ever after.
      threeCamera = ensureCamera(cam);
      syncTransform(cam, cam.object);
    }
    if (!threeCamera || !cam.target) return;

    hideForPass(state, cam);
    var trianglesBefore = renderer.info.render.triangles;

    // The feed's backdrop must be decided, not inherited.
    //
    // Two things go wrong otherwise. Our clear() would use whatever colour
    // GDevelop last set — so an empty layer comes out painted in the main
    // scene's background colour, which looks exactly like the scene leaking
    // onto the screen. And Three's own background pass mutates the renderer's
    // clear colour while drawing, so not restoring it lets our pass change the
    // colour the rest of the game clears to.
    if (!_clearPrev) _clearPrev = new THREE.Color();
    renderer.getClearColor(_clearPrev);
    var prevClearAlpha = renderer.getClearAlpha();

    var bg = scene.background;
    if (bg && bg.isColor) {
      renderer.setClearColor(bg, 1);
    } else {
      if (!_bgColor) _bgColor = new THREE.Color();
      _bgColor.set(runtimeScene.getBackgroundColor());
      renderer.setClearColor(_bgColor, 1);
    }

    try {
      renderer.setRenderTarget(cam.target);
      // C1 — autoClear is false globally, so without this the feed composites
      // onto the previous frame: colour smears and stale depth hides geometry.
      renderer.clear(true, true, true);
      renderer.render(scene, threeCamera);
      cam.rendered = true;
    } finally {
      restoreHidden(state);
      renderer.setClearColor(_clearPrev, prevClearAlpha);
    }

    // "The feed is black" has two very different causes: the pass failed, or
    // it succeeded and the camera is pointing at nothing. Tell them apart —
    // the difference is invisible from the outside, and the second one is far
    // more common. Snapshot the delta because GDevelop sets info.autoReset
    // false and resets it itself once per frame. [verified]
    if (!cam.reportedEmpty && renderer.info.render.triangles === trianglesBefore) {
      cam.reportedEmpty = true;
      scratch();
      threeCamera.getWorldDirection(_v3);
      var who = cam.isLayerView ? 'layer "' + cam.layerName + '"'
        : '"' + (cam.object.getName ? cam.object.getName() : 'camera') + '"';
      console.warn('[InGameCamera3D] ' + who + ' rendered nothing — the feed is ' +
        'black because the camera is not pointing at any geometry, not because ' +
        'it is broken.\n  position (GDevelop): ' +
        Math.round(cam.threeCamera.position.x) + ', ' +
        Math.round(-cam.threeCamera.position.y) + ', ' +
        Math.round(cam.threeCamera.position.z) +
        '\n  looking towards: ' + _v3.x.toFixed(2) + ', ' +
        (-_v3.y).toFixed(2) + ', ' + _v3.z.toFixed(2) +
        '\n  It films along its "Films along" axis (+X by default, i.e. angle 0 ' +
        'faces right). Rotate the camera object, or change that property.' +
        '\n  Also check the Near plane (' + cam.near + ') is not in front of what ' +
        'you want to see, and that the object is on the layer you mean (' +
        cam.layerName + ').');
    } else if (renderer.info.render.triangles !== trianglesBefore) {
      cam.reportedEmpty = false;
    }
  }

  function tick(runtimeScene) {
    if (!THREE_OK) return;
    var state = scenes.get(runtimeScene);
    if (!state) return;

    var renderer = threeRendererOf(runtimeScene);
    if (!renderer) return;

    // C7 — heal bindings before anything samples them.
    var dead = [];
    state.bindings.forEach(function (b) {
      if (!revalidate(b)) dead.push(b);
    });
    for (var d = 0; d < dead.length; d++) state.bindings.delete(dead[d]);

    var elapsed = runtimeScene.getElapsedTime() / 1000;

    var due = [];
    state.cameras.forEach(function (cam) {
      if (isDead(cam.object)) return;
      if (cameraIsDue(cam, elapsed)) due.push(cam);
    });
    state.layerViews.forEach(function (cam) {
      if (cameraIsDue(cam, elapsed)) due.push(cam);
    });

    // 2D captures are PIXI work, not a Three pass, and each one brackets its
    // own GL state — so they run before the Three passes rather than inside
    // the shadow/render-target block below.
    state.layerCaptures.forEach(function (cam) {
      if (!cameraIsDue(cam, elapsed)) return;
      try {
        grab2DLayer(cam, runtimeScene, renderer);
      } catch (e) {
        var gk = 'grabError:' + (e && e.message ? e.message : String(e));
        if (!warned[gk]) {
          warned[gk] = true;
          console.error('[InGameCamera3D] 2D layer capture failed.', e);
        }
      }
    });

    // Keep textures pointing at the current target even on skipped frames,
    // so a resolution change is picked up immediately (C19).
    state.bindings.forEach(function (b) {
      if (b.camera && b.slots && b.textureEpoch !== b.camera.textureEpoch) {
        applyTexture(b, b.camera);
      }
    });

    if (!due.length) return;

    // C3 — we are touching GL outside the render phase. The engine brackets
    // every 2D<->3D transition the same way.
    renderer.resetState();

    // C10 — shadowMap.enabled is true globally, so every pass would otherwise
    // re-render every shadow map. Reuse is correct for directional and point
    // lights, and it is the single biggest saving available.
    var shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    var anyPerPass = false;
    for (var i = 0; i < due.length; i++) if (due[i].shadowMode === 'PerPass') anyPerPass = true;
    if (!anyPerPass) renderer.shadowMap.autoUpdate = false;

    var previousTarget = renderer.getRenderTarget();
    try {
      for (var k = 0; k < due.length; k++) {
        renderCamera(renderer, runtimeScene, due[k], state);
      }
    } catch (e) {
      // Keyed on the message so a genuinely new failure is still reported,
      // but a per-frame throw does not fill the console. Log the error itself:
      // a swallowed stack here reads as "the texture is just black".
      var key = 'passError:' + (e && e.message ? e.message : String(e));
      if (!warned[key]) {
        warned[key] = true;
        console.error('[InGameCamera3D] camera pass failed — the feed will stay black.', e);
      }
    } finally {
      // C1 — nothing in the engine calls setRenderTarget, so failing to
      // restore here renders the ENTIRE GAME into our texture: black screen.
      renderer.setRenderTarget(previousTarget || null);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.resetState();
      var gameRenderer = runtimeScene.getGame().getRenderer();
      var pixi = gameRenderer && gameRenderer.getPIXIRenderer
        ? gameRenderer.getPIXIRenderer() : null;
      if (pixi && pixi.reset) { try { pixi.reset(); } catch (e2) {} }
    }

    // Bind the fresh textures after the pass.
    state.bindings.forEach(function (b) {
      if (b.camera && b.slots) applyTexture(b, b.camera);
    });
  }

  /* ------------------------------------------------------------ public API */

  var NS = {
    /** Presets are exposed so the build script can assert the dropdown matches. */
    PRESETS: PRESETS,
    FACE_INDEX: FACE_INDEX,
    FACE_SLOT: FACE_SLOT,

    /* ---- mode B: a Camera3D behavior instance ---- */

    registerCamera: function (runtimeScene, object, behavior, options) {
      if (!THREE_OK) {
        warnOnce('noThree', 'THREE is unavailable; this extension needs a 3D layer.');
        return null;
      }
      if (!object.getZ) {
        warnOnce('not3d', 'The Camera3D behavior needs a 3D object (one with a Z position).');
        return null;
      }
      var state = stateOf(runtimeScene);
      var cam = behavior.__igcCamera;
      if (!cam) {
        cam = behavior.__igcCamera = {
          object: object,
          isLayerView: false,
          layerName: object.getLayer(),
          threeCamera: null,
          target: null,
          textureEpoch: 0,
          accumulator: 0
        };
        state.cameras.add(cam);
      }
      NS.configureCamera(cam, options);
      // The object may have been moved between layers since last frame (C18).
      cam.layerName = object.getLayer();
      return cam;
    },

    configureCamera: function (cam, o) {
      if (!cam || !o) return;
      cam.preset = o.preset || cam.preset || 'Standard';
      cam.customW = o.customW || cam.customW || 512;
      cam.customH = o.customH || cam.customH || 512;
      cam.filtering = o.filtering || cam.filtering || 'Linear';
      cam.samples = o.samples !== undefined ? o.samples : (cam.samples || 0);
      cam.fov = o.fov || cam.fov || 60;
      cam.near = o.near || cam.near || 3;
      cam.far = o.far || cam.far || 2000;
      cam.fpsCap = o.fpsCap !== undefined ? o.fpsCap : (cam.fpsCap || 0);
      cam.enabled = o.enabled !== undefined ? !!o.enabled
        : (cam.enabled === undefined ? true : cam.enabled);
      cam.shadowMode = o.shadowMode || cam.shadowMode || 'Reuse';
      cam.forwardAxis = o.forwardAxis || cam.forwardAxis || '+X';
    },

    cameraOf: function (behavior) {
      return behavior ? behavior.__igcCamera : null;
    },

    /**
     * Find the camera record on an object without asking the user to pick the
     * behavior as a second parameter.
     *
     * Scanning for our own marker rather than looking the behavior up by name
     * means this still works when the behavior has been renamed on the object,
     * and it removes a field that could be mismatched with the object beside it.
     */
    findCamera: function (object) {
      if (!object || !object._behaviors) return null;
      for (var i = 0; i < object._behaviors.length; i++) {
        var b = object._behaviors[i];
        if (b && b.__igcCamera) return b.__igcCamera;
      }
      return null;
    },

    disposeCamera: function (runtimeScene, behavior) {
      var cam = behavior && behavior.__igcCamera;
      if (!cam) return;
      var state = scenes.get(runtimeScene);
      if (state) {
        state.cameras.delete(cam);
        // A destroyed camera should leave a black screen, not a dangling
        // texture (C13/C18).
        state.bindings.forEach(function (b) {
          if (b.camera === cam) {
            b.camera = null;
            applyTexture(b, null);
          }
        });
      }
      disposeTarget(cam);
      cam.threeCamera = null;
      behavior.__igcCamera = null;
    },

    /* ---- mode A: a layer view, keyed by layer (C18) ---- */

    enableLayerView: function (runtimeScene, layerName, options) {
      if (!THREE_OK) return null;

      // Refuse a 2D layer here rather than in the pass. Returning null keeps
      // the caller from binding at all, so the screen object keeps the texture
      // it already had instead of being repainted blank.
      if (!layerSceneOf(runtimeScene, layerName)) {
        warnOnce('no3d:' + layerName,
          'Layer "' + layerName + '" has no 3D content, so there is nothing to film. ' +
          'In-game cameras render 3D layers. Showing a 2D layer on a screen is a ' +
          'separate feature that is not built yet — for now, put 3D objects on the ' +
          'layer you want to film, or use a camera object instead.');
        return null;
      }

      var state = stateOf(runtimeScene);
      var cam = state.layerViews.get(layerName);
      if (!cam) {
        cam = {
          object: null,
          isLayerView: true,
          layerName: layerName,
          threeCamera: null,
          target: null,
          textureEpoch: 0,
          accumulator: 0
        };
        state.layerViews.set(layerName, cam);
      }
      NS.configureCamera(cam, options);
      return cam;
    },

    disableLayerView: function (runtimeScene, layerName) {
      var state = scenes.get(runtimeScene);
      if (!state) return;
      var cam = state.layerViews.get(layerName);
      if (!cam) return;
      state.bindings.forEach(function (b) {
        if (b.camera === cam) { b.camera = null; applyTexture(b, null); }
      });
      disposeTarget(cam);
      state.layerViews.delete(layerName);
    },

    layerView: function (runtimeScene, layerName) {
      var state = scenes.get(runtimeScene);
      return state ? state.layerViews.get(layerName) || null : null;
    },

    /* ---- 2D layer as a screen source: arcade cabinets, minigames ---- */

    enable2DLayer: function (runtimeScene, layerName, options) {
      if (!THREE_OK) return null;
      if (typeof PIXI === 'undefined') return null;
      var layer = runtimeScene.getLayer(layerName);
      var lr = layer && layer.getRenderer && layer.getRenderer();
      if (!lr || !lr._pixiContainer) {
        warnOnce('no2d:' + layerName,
          'Layer "' + layerName + '" has no 2D content to capture.');
        return null;
      }
      var state = stateOf(runtimeScene);
      var cam = state.layerCaptures.get(layerName);
      if (!cam) {
        cam = {
          object: null,
          is2DLayer: true,
          isLayerView: false,
          layerName: layerName,
          pixiRT: null,
          texture: null,
          textureOwner: null,
          textureEpoch: 0,
          accumulator: 0,
          fit: 'Stretch'
        };
        state.layerCaptures.set(layerName, cam);
      }
      NS.configureCamera(cam, options);
      if (options && options.fit) cam.fit = options.fit;
      return cam;
    },

    disable2DLayer: function (runtimeScene, layerName) {
      var state = scenes.get(runtimeScene);
      if (!state) return;
      var cam = state.layerCaptures.get(layerName);
      if (!cam) return;
      state.bindings.forEach(function (b) {
        if (b.camera === cam) { b.camera = null; applyTexture(b, null); }
      });
      dispose2DCapture(cam);
      state.layerCaptures.delete(layerName);
    },

    layerCapture: function (runtimeScene, layerName) {
      var state = scenes.get(runtimeScene);
      return state ? state.layerCaptures.get(layerName) || null : null;
    },

    /* ---- screens ---- */

    bind: function (runtimeScene, object, behavior, cam, spec) {
      if (!THREE_OK || !cam) return false;
      var state = stateOf(runtimeScene);

      var binding = behavior.__igcBinding;
      if (binding) NS.unbind(runtimeScene, behavior);

      binding = behavior.__igcBinding = {
        object: object,
        camera: cam,
        slots: null,
        kind: null,
        faceName: spec.faceName,
        materialName: spec.materialName,
        materialMode: spec.materialMode || 'Unlit',
        doubleSided: !!spec.doubleSided,
        textureEpoch: -1
      };

      if (!bindCubeFace(binding, object, spec.faceName)) {
        behavior.__igcBinding = null;
        warnOnce('bindFail',
          'Could not show a feed on "' + (object.getName ? object.getName() : 'this object') +
          '" — the Live screen behavior needs a 3D Box.');
        return false;
      }

      applyTexture(binding, cam);
      state.bindings.add(binding);
      return true;
    },

    unbind: function (runtimeScene, behavior) {
      var binding = behavior && behavior.__igcBinding;
      if (!binding) return;
      var state = scenes.get(runtimeScene);
      if (state) state.bindings.delete(binding);
      restoreBinding(binding);
      behavior.__igcBinding = null;
    },

    bindingOf: function (behavior) {
      return behavior ? behavior.__igcBinding : null;
    },

    /* ---- reporting ---- */

    textureMemoryMB: function (runtimeScene) {
      var state = scenes.get(runtimeScene);
      if (!state) return 0;
      var bytes = 0;
      var add = function (cam) {
        if (!cam.target) return;
        // RGBA8 colour + 24-bit depth, rounded to 8 bytes per texel.
        bytes += cam.target.width * cam.target.height * 8;
      };
      state.cameras.forEach(add);
      state.layerViews.forEach(add);
      return Math.round((bytes / (1024 * 1024)) * 100) / 100;
    },

    tick: tick,

    disposeScene: function (runtimeScene) {
      var state = scenes.get(runtimeScene);
      if (!state) return;
      state.bindings.forEach(restoreBinding);
      state.bindings.clear();
      state.cameras.forEach(disposeTarget);
      state.cameras.clear();
      state.layerViews.forEach(disposeTarget);
      state.layerViews.clear();
      state.layerCaptures.forEach(dispose2DCapture);
      state.layerCaptures.clear();
      scenes.delete(runtimeScene);
    }
  };

  gdjs.__inGameCamera3D = NS;

  /* --------------------------------------------------------- engine hooks */

  // C3 — post-events is the last hook before render(). [verified]
  if (gdjs.registerRuntimeScenePostEventsCallback) {
    gdjs.registerRuntimeScenePostEventsCallback(function (runtimeScene) {
      try { tick(runtimeScene); } catch (e) {
        warnOnce('tick', 'tick failed: ' + (e && e.message ? e.message : e));
      }
    });
  }

  // C13 — the layer-view map and any binding whose object outlived its
  // behavior are not owned by a behavior, so the scene still needs this.
  if (gdjs.registerRuntimeSceneUnloadedCallback) {
    gdjs.registerRuntimeSceneUnloadedCallback(function (runtimeScene) {
      try { NS.disposeScene(runtimeScene); } catch (e) {}
    });
  }
})();
