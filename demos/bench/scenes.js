// Phase 0 test scenes, per docs/RENDERER-MODERNIZATION-PLAN.md section 0.2.
// Runs in the browser. Node drives it through harness.mjs.
//
// Scene 2 is built. Scenes 1, 3 and 4 are NOT — they gate phases that are not being worked on, and
// a stub that renders something plausible would be worse than an honest absence, because a gate
// would appear to have been evaluated.

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

  window.benchBuild = function (sceneName, size, options) {
    options = options || {};
    if (sceneName !== 'sphere-array') {
      throw new Error('scene "' + sceneName + '" is not built. Only sphere-array (plan scene 2) exists.');
    }
    var canvas = document.getElementById('c');
    canvas.width = size; canvas.height = size;
    if (state.renderer) state.renderer.dispose();

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.toneMapping = THREE.NoToneMapping;

    var built = buildSphereArray(THREE, options);
    built.camera.aspect = 1;
    built.camera.updateProjectionMatrix();

    state.renderer = renderer;
    state.scene = built.scene;
    state.camera = built.camera;
    state.size = size;
    state.config = options;

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
    placeCamera(state.camera, index, total);
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
      placeCamera(state.camera, n % 60, 60);
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
