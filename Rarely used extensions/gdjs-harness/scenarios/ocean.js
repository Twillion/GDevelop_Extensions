/**
 * Drives OceanFFT3D exactly as its generated behavior does — register once, step every frame —
 * inside a REAL GDJS game. Nothing here is mocked: the Cube3D, the layers, the renderers and the
 * WebGL context shared with PIXI are all the engine's own.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var object = scene.getObjects('Ocean')[0];
  var behavior = {};
  var edgeBehavior = {};
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('OceanFFT3D');

  FW.registerOcean(scene, object, behavior, {
    windSpeed: 12, windDirection: 45, resolution: 64, gpuResolution: 256,
    gridSubdivisions: 64, choppiness: 1, waveHeightScale: 1, unitsPerMetre: 100,
    foamIntensity: 0.8, foamCoverage: 0.35, enableCaustics: true,
  });

  // A dedicated land volume covers the far 28% of the water. It is deliberately a plain runtime
  // object: WaterEdge3D consumes its live bounds, layer and Z span exactly as the behavior does.
  var edgeX = object.getX() + object.getWidth() * 0.72;
  var waterTop = object.getZ() + object.getDepth();
  var edgeObject = {
    getX: function () { return edgeX; },
    getY: function () { return object.getY(); },
    getZ: function () { return waterTop - 100; },
    getWidth: function () { return object.getWidth() * 0.28; },
    getHeight: function () { return object.getHeight(); },
    getDepth: function () { return 200; },
    getLayer: function () { return ''; },
    getName: function () { return 'HarnessShore'; },
  };
  FW.registerWaterEdge(scene, edgeObject, edgeBehavior, {
    foamWidth: spanOr(object.getWidth() * 0.025, 120),
    shallowWidth: spanOr(object.getWidth() * 0.09, 400),
    enabled: true,
  });

  function spanOr(value, fallback) { return value > 0 ? value : fallback; }

  // Frame the water from off to one side, looking across it. GDevelop's 3D camera points straight
  // down at rotationX 0, so a value near 90 is horizontal.
  var span = Math.max(object.getWidth(), object.getHeight());
  layer.setCameraX(object.getX() + object.getWidth() / 2);
  layer.setCameraY(object.getY() + object.getHeight() / 2 + span * 1.1);
  layer.setCameraZ(object.getZ() + object.getDepth() + span * 0.30, FOV);
  layer.setCameraRotationX(66);

  // The behavior's doStepPreEvents, driven by the engine's own loop.
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) FW.stepOcean(rs, object, behavior);
  });

  setTimeout(report, 1500);

  function report() {
    var o = FW.oceanOf(scene, behavior);
    if (!o) { H.log('ocean not registered', 'bad'); return; }

    H.h2('After ~90 real frames');
    H.log('tile ' + Math.round(o.tileSize) + '   Hs ' + o.significantWaveHeight.toFixed(0) +
          '   CPU peak ' + o.field.peakHeight().toFixed(1) +
          '   steepness ' + (o.significantWaveHeight / o.tileSize).toFixed(3));
    H.log('mesh parent ' + (o.mesh && o.mesh.parent ? o.mesh.parent.type : 'NONE') +
          '   position ' + [o.mesh.position.x, o.mesh.position.y, o.mesh.position.z]
            .map(function (v) { return Math.round(v); }).join(', '),
          o.mesh && o.mesh.parent ? 'ok' : 'bad');
    H.log('camera ' + Math.round(layer.getCameraX()) + ', ' + Math.round(layer.getCameraY()) +
          ', ' + Math.round(layer.getCameraZ(FOV)) + '   rotX ' + layer.getCameraRotationX(), 'dim');
    H.log('shore uniforms ' + o.material.uniforms.u_EdgeCount.value +
          ' edge(s), signed mask + wave attenuation',
          o.material.uniforms.u_EdgeCount.value === 1 ? 'ok' : 'bad');

    var renderer = H.game.getRenderer().getThreeRenderer();
    if (o.gpu && !o.gpu.failed) {
      var buf = new Float32Array(8 * 8 * 4);
      try {
        renderer.readRenderTargetPixels(o.gpu.output, 0, 0, 8, 8, buf);
        var mx = 0, nf = 0;
        for (var i = 0; i < buf.length; i++) {
          if (!isFinite(buf[i])) { nf++; continue; }
          mx = Math.max(mx, Math.abs(buf[i]));
        }
        H.log('GPU output max|v| ' + mx.toExponential(3) + (nf ? '   NON-FINITE x' + nf : ''),
              (nf || mx > 1e6 || mx === 0) ? 'bad' : 'ok');
      } catch (e) { H.log('GPU readback threw: ' + e.message, 'warn'); }
    } else {
      H.log('GPU path ' + (o.gpu ? 'FAILED and fell back to CPU' : 'off'), 'warn');
    }

    // How much of the frame the water actually covers. The scene clear colour is 232,234,236.
    var gl = renderer.getContext();
    var c = renderer.domElement;
    var px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var nonBg = 0;
    for (var p = 0; p < px.length; p += 4) {
      if (!(Math.abs(px[p] - 232) < 10 && Math.abs(px[p + 1] - 234) < 10 && Math.abs(px[p + 2] - 236) < 10)) nonBg++;
    }
    H.log('non-background pixels ' + nonBg + ' / ' + (px.length / 4) +
          '  (' + (100 * nonBg / (px.length / 4)).toFixed(0) + '%)', nonBg > 5000 ? 'ok' : 'bad');
    H.h2('DONE');
  }
})();
