// Phase 0 test scenes, per docs/RENDERER-MODERNIZATION-PLAN.md section 0.2.
// Runs in the browser. Node drives it through harness.mjs.
//
// Scenes 2 and 4 are built. Scenes 1 and 3 are NOT — they gate Phase 8 (Radiance Cascades), which
// is on hold, and a stub that rendered something plausible would be worse than an honest absence
// because a gate would appear to have been evaluated.

(function () {
  var state = { renderer: null, scene: null, camera: null, size: 0, timer: null, config: null };

  /**
   * A high-frequency normal map WITH MIPMAPS, which is the whole point.
   *
   * An earlier attempt used NEAREST-filtered noise with mipmaps off. That is not a surface: every
   * texel's normal is independent, so dot(dndu,dndu) is enormous everywhere and the T&K kernel
   * pins to its kappa clamp at every filter width, which makes it impossible to distinguish a good
   * filter from a bad one. Mipmapped detail is the realistic case: minification averages most
   * variance away, and what survives to the pixel is exactly what the technique can act on.
   */
  function makeNormalMap(THREE, size) {
    var data = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = (y * size + x) * 4;
        // Layered coherent detail rather than noise: a surface with structure at several scales.
        var nx = Math.sin(x * 0.30) * 0.45 + Math.sin((x + y) * 0.11) * 0.30 + Math.sin(x * 0.03) * 0.20;
        var ny = Math.cos(y * 0.30) * 0.45 + Math.cos((x - y) * 0.11) * 0.30 + Math.cos(y * 0.03) * 0.20;
        data[i] = 128 + Math.round(Math.max(-1, Math.min(1, nx)) * 127);
        data[i + 1] = 128 + Math.round(Math.max(-1, Math.min(1, ny)) * 127);
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
    var tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** Scene 2 — rough-metal sphere array, orbiting camera. The specular aliasing reference. */
  function buildSphereArray(THREE, options) {
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101014);

    var key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 6, 5);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-5, -2, 3);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    var normalMap = makeNormalMap(THREE, 512);
    var geometry = new THREE.SphereGeometry(0.42, 48, 48);
    var materials = [];

    // A 4x4 grid sweeping roughness. Low roughness is where specular aliasing is worst, so the
    // sweep has to reach down to near-mirror or the scene never exercises the failure case.
    for (var gy = 0; gy < 4; gy++) {
      for (var gx = 0; gx < 4; gx++) {
        var roughness = 0.04 + (gx + gy * 4) * (0.46 / 15);
        var mat = new THREE.MeshStandardMaterial({
          color: 0xc8ccd4, metalness: 1.0, roughness: roughness,
          normalMap: normalMap,
        });
        mat.normalScale = new THREE.Vector2(0.85, 0.85);
        materials.push(mat);
        var mesh = new THREE.Mesh(geometry, mat);
        mesh.position.set((gx - 1.5) * 1.05, (gy - 1.5) * 1.05, 0);
        scene.add(mesh);
      }
    }

    if (options.specularAA && gdjs.__m3dSpecularAA) {
      for (var i = 0; i < materials.length; i++) {
        gdjs.__m3dSpecularAA.applyToMaterial(materials[i], {
          enabled: true,
          sigma2: options.sigma2 !== undefined ? options.sigma2 : 0.15,
          kappa: options.kappa !== undefined ? options.kappa : 0.18,
          geometricFloor: !!options.geometricFloor,
        });
      }
    }

    var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    return { scene: scene, camera: camera, materials: materials };
  }

  /* ======================================================= Scene 4 — alpha-tested foliage ====
   *
   * Plan §0.2: "the material-aliasing case Tardif identified as forcing him temporal. Included so
   * the plan does not pretend that problem is solved."
   *
   * WHY THIS SCENE IS SHAPED THE WAY IT IS. It has to contain two kinds of edge that behave
   * DIFFERENTLY under multisampling, or Phase 7 cannot tell them apart:
   *
   *   - GEOMETRIC edges (the fence slats). MSAA resolves these: coverage is computed per sample.
   *   - ALPHA-TESTED edges (the leaves). MSAA does NOT resolve these on its own. The fragment
   *     shader runs once per pixel and either discards or does not, so every sample in the pixel
   *     gets the same answer. Only alpha-to-coverage changes that.
   *
   * A scene with only one kind would make MSAA look like a total win or a total loss, and both
   * readings would be wrong. Keeping both means the measurement can say "fixes silhouettes, does
   * nothing for cutouts", which is the actual answer Phase 7 needs to record.
   *
   * MIPMAPS ARE ON, deliberately. Minified alpha-tested foliage thins and dissolves as the mip
   * chain averages coverage into the alpha channel, and that dissolve is a large part of what makes
   * foliage shimmer in motion. Turning mipmaps off would remove the artefact being measured.
   */

  /** Procedural leaf atlas: hard alpha edges, many small leaves rather than a few large ones. */
  function makeLeafAtlas(THREE, size) {
    var data = new Uint8Array(size * size * 4);
    var seed = 20260914;
    var rand = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // A handful of ellipses per tile. Edge length per pixel is what aliases, so many small leaves
    // are a harsher and more realistic test than one big one.
    var leaves = [];
    for (var l = 0; l < 26; l++) {
      leaves.push({
        cx: rand() * size, cy: rand() * size,
        rx: size * (0.04 + rand() * 0.07), ry: size * (0.02 + rand() * 0.04),
        rot: rand() * Math.PI, shade: 0.55 + rand() * 0.45,
      });
    }

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = (y * size + x) * 4;
        var inside = 0, shade = 1;
        for (var k = 0; k < leaves.length; k++) {
          var L = leaves[k];
          // Wrap in both axes so the atlas tiles without a seam of bare alpha.
          var dx = x - L.cx, dy = y - L.cy;
          if (dx > size / 2) dx -= size; if (dx < -size / 2) dx += size;
          if (dy > size / 2) dy -= size; if (dy < -size / 2) dy += size;
          var c = Math.cos(L.rot), sn = Math.sin(L.rot);
          var u = (dx * c + dy * sn) / L.rx, v = (-dx * sn + dy * c) / L.ry;
          if (u * u + v * v <= 1.0) { inside = 1; shade = L.shade; break; }
        }
        // A central vein: a thin hole through each leaf, which adds sub-pixel alpha detail.
        data[i] = Math.round(40 * shade);
        data[i + 1] = Math.round(150 * shade);
        data[i + 2] = Math.round(55 * shade);
        data[i + 3] = inside ? 255 : 0;
      }
    }
    var tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function buildFoliage(THREE, options) {
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fb6d9);

    var sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    sun.position.set(5, 9, 4);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2e2a20, 0.55));

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x4a5d34, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);

    var leafTexture = makeLeafAtlas(THREE, 256);
    var materials = [];

    // ALPHA TEST, not blending: no sorting, no order dependence, a hard binary edge per pixel.
    // That hard edge is exactly the thing that aliases and the thing MSAA alone cannot fix.
    var leafMaterial = new THREE.MeshStandardMaterial({
      map: leafTexture, alphaMap: leafTexture,
      alphaTest: options.alphaTest !== undefined ? options.alphaTest : 0.5,
      transparent: false, side: THREE.DoubleSide, roughness: 0.85, metalness: 0.0,
    });
    materials.push(leafMaterial);

    var seed = 4242;
    var rand = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // Crossed quads, the standard foliage card. Three per bush at 60 degrees so there is always a
    // near-edge-on card somewhere in view - the worst case for alpha-test stability.
    // noFoliage builds the same scene WITHOUT the leaf cards: ground, slats and lighting only.
    // It is the control that attributes the scene's aliasing to the alpha-tested foliage rather
    // than to the geometry, which is the property that makes this scene worth having.
    var quad = new THREE.PlaneGeometry(1, 1);
    for (var b = 0; b < (options.noFoliage ? 0 : 90); b++) {
      var bx = (rand() - 0.5) * 34;
      var bz = -2 - rand() * 34;
      var scale = 0.7 + rand() * 1.5;
      for (var c2 = 0; c2 < 3; c2++) {
        var card = new THREE.Mesh(quad, leafMaterial);
        card.position.set(bx, scale * 0.5, bz);
        card.rotation.y = (c2 / 3) * Math.PI + rand() * 0.3;
        card.scale.set(scale, scale, scale);
        scene.add(card);
      }
    }

    // Thin geometric slats. These are the control: MSAA SHOULD fix these, and if a measurement
    // shows no improvement on them either, the multisampling is not working at all rather than
    // merely failing on cutouts.
    var slatGeometry = new THREE.BoxGeometry(0.06, 1.3, 0.06);
    var slatMaterial = new THREE.MeshStandardMaterial({ color: 0x9a8c72, roughness: 0.7 });
    materials.push(slatMaterial);
    for (var f = 0; f < 60; f++) {
      var slat = new THREE.Mesh(slatGeometry, slatMaterial);
      slat.position.set(-16 + f * 0.55, 0.65, -6.5);
      scene.add(slat);
    }

    if (options.specularAA && gdjs.__m3dSpecularAA) {
      for (var m = 0; m < materials.length; m++) {
        gdjs.__m3dSpecularAA.applyToMaterial(materials[m], {
          enabled: true,
          sigma2: options.sigma2 !== undefined ? options.sigma2 : 0.02,
          kappa: options.kappa !== undefined ? options.kappa : 0.18,
          geometricFloor: !!options.geometricFloor,
        });
      }
    }

    var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    return { scene: scene, camera: camera, materials: materials };
  }

  /**
   * Scene 4's path: a slow dolly forward with a slight yaw.
   *
   * Motion is what turns aliasing into shimmer, and a dolly is harsher than an orbit here because
   * it changes the SCREEN SIZE of every leaf continuously, walking each one down its mip chain.
   */
  function placeFoliageCamera(camera, index, total) {
    var t = total > 1 ? index / (total - 1) : 0;
    camera.position.set(Math.sin(t * 0.9) * 1.6, 1.15 + Math.sin(t * 2.1) * 0.08, 6.5 - t * 7.5);
    camera.lookAt(Math.sin(t * 0.9) * 1.2, 0.95, -12);
    camera.updateMatrixWorld(true);
  }

  /**
   * The scripted camera path. Deterministic in the frame index, so the 1x run and the 4x reference
   * run see EXACTLY the same camera — if they did not, every error metric would be measuring
   * camera mismatch rather than rendering quality.
   */
  function placeCamera(camera, index, total) {
    var t = total > 1 ? index / (total - 1) : 0;
    var angle = -0.55 + t * 1.10;              // a slow orbit, not a full revolution
    var radius = 7.5;
    camera.position.set(Math.sin(angle) * radius, Math.cos(angle * 0.7) * 1.6, Math.cos(angle) * radius);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
  }

  // Name -> builder + camera path. Each scene owns its own path: an orbit suits the sphere array,
  // a dolly suits foliage, and sharing one would measure the wrong motion for one of them.
  var SCENES = {
    'sphere-array': { build: buildSphereArray, placeCamera: placeCamera },
    'foliage': { build: buildFoliage, placeCamera: placeFoliageCamera },
  };

  window.benchBuild = function (sceneName, size, options) {
    options = options || {};
    var recipe = SCENES[sceneName];
    if (!recipe) {
      throw new Error('scene "' + sceneName + '" is not built. Available: ' +
        Object.keys(SCENES).join(', ') + '. Plan scenes 1 (cornell) and 3 (emitter) gate Phase 8 ' +
        'and are deliberately absent rather than stubbed.');
    }
    var canvas = document.getElementById('c');
    canvas.width = size; canvas.height = size;
    if (state.renderer) state.renderer.dispose();

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.toneMapping = THREE.NoToneMapping;

    var built = recipe.build(THREE, options);
    built.camera.aspect = 1;
    built.camera.updateProjectionMatrix();

    state.renderer = renderer;
    state.scene = built.scene;
    state.camera = built.camera;
    state.size = size;
    state.config = options;
    state.place = recipe.placeCamera;

    // Timer queries, per section 0.4. Availability is REPORTED, never assumed: the CPU fallback
    // cannot certify a GPU budget and must not be presented as if it could.
    var gl = renderer.getContext();
    var ext = null;
    try { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) { ext = null; }
    state.timer = ext;

    // Confirm the injector actually reached the generated source rather than trusting that it did.
    var injected = false;
    if (options.specularAA && built.materials.length) {
      var probe = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>' +
        String.fromCharCode(10) + THREE.ShaderChunk.lights_physical_fragment, defines: {} };
      try {
        built.materials[0].onBeforeCompile(probe, renderer);
        injected = probe.fragmentShader.indexOf('m3dSpecAAFilter( material.roughness') >= 0;
      } catch (e) { injected = false; }
    }

    renderer.compile(built.scene, built.camera);
    return {
      size: size,
      timerQueryAvailable: !!ext,
      specularAAInjected: injected,
      materials: built.materials.length,
      webgl2: renderer.capabilities.isWebGL2 === true,
    };
  };

  window.benchFrame = function (index, total) {
    state.place(state.camera, index, total);
    state.renderer.render(state.scene, state.camera);
    var gl = state.renderer.getContext();
    var S = state.size;
    var px = new Uint8Array(S * S * 4);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // One byte of luminance per pixel keeps a reference-resolution sequence transferable.
    var lum = new Uint8Array(S * S);
    for (var i = 0, p = 0; i < px.length; i += 4, p++) {
      lum[p] = Math.round((px[i] + px[i + 1] + px[i + 2]) / 3);
    }
    var bin = '';
    var CHUNK = 0x8000;
    for (var o = 0; o < lum.length; o += CHUNK) {
      bin += String.fromCharCode.apply(null, lum.subarray(o, o + CHUNK));
    }
    return btoa(bin);
  };

  window.benchTime = function (frames) {
    // Section 0.3: 200 frames, discard the first 20, report median and p95.
    var warmup = Math.min(20, Math.floor(frames / 4));
    var samples = [];
    for (var n = 0; n < frames; n++) {
      state.place(state.camera, n % 60, 60);
      var t0 = performance.now();
      state.renderer.render(state.scene, state.camera);
      // Without a fence, render() only queues work — the read forces it to complete, which is what
      // makes a wall-clock number mean anything at all here. It still measures submission plus
      // completion, NOT isolated GPU pass time, which is why section 0.4 forbids treating it as a
      // GPU budget measurement.
      var gl = state.renderer.getContext();
      var one = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      var dt = performance.now() - t0;
      if (n >= warmup) samples.push(dt);
    }
    return {
      samples: samples,
      method: state.timer ? 'wall-clock (timer query present but not used for whole-frame timing)'
                          : 'wall-clock (EXT_disjoint_timer_query_webgl2 unavailable)',
      timerQueryAvailable: !!state.timer,
    };
  };
})();
