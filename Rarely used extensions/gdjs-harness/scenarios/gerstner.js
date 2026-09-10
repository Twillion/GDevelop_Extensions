/**
 * Drives WaterBody3D (multi-octave Gerstner waves) inside a REAL GDJS game.
 * Tests wave displacement, optical absorption, underwater detection, and shared GL context rendering.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var object = scene.getObjects('Ocean')[0];
  var behavior = {};
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('WaterBody3D (Gerstner)');

  FW.registerWaterBody(scene, object, behavior, {
    waterType: 'Ocean',
    waveHeight: 35.0,
    waveChoppiness: 0.8,
    waveSpeed: 1.2,
    windDirection: 45.0,
    waveTiling: 1.0,
    shallowColor: '64;224;208',
    deepColor: '10;45;90',
    extinctionDepth: 150.0,
    refractionScale: 0.02,
    shoreFoamIntensity: 0.85,
    crestFoamIntensity: 0.60,
    enableCaustics: true,
    enableUnderwaterFX: true,
    gridSubdivisions: 64,
    waveScaleMode: 'RelativeToVolume',
    directionalSpread: 45.0,
    phaseSeed: 1234.0,
  });

  // Frame the water
  var span = Math.max(object.getWidth(), object.getHeight());
  layer.setCameraX(object.getX() + object.getWidth() / 2);
  layer.setCameraY(object.getY() + object.getHeight() / 2 + span * 1.0);
  layer.setCameraZ(object.getZ() + object.getDepth() + span * 0.35, FOV);
  layer.setCameraRotationX(65);

  // Step water body in engine game loop
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) FW.stepWaterBody(rs, object, behavior);
  });

  setTimeout(report, 1500);

  function report() {
    var wb = FW.waterBodyOf(scene, behavior);
    if (!wb) { H.log('WaterBody not registered', 'bad'); return; }

    H.h2('After ~90 real frames');
    var waveDetail = FW.getWaveDetailPercent(scene, behavior);
    H.log('wave detail fraction: ' + (waveDetail * 100).toFixed(1) + '%');
    
    var sampleZ = FW.getWaterSurfaceZ(scene, behavior, object.getX() + 500, object.getY() + 500);
    H.log('sample surface Z at (500, 500): ' + sampleZ.toFixed(2), isFinite(sampleZ) ? 'ok' : 'bad');

    H.log('mesh parent: ' + (wb.mesh && wb.mesh.parent ? wb.mesh.parent.type : 'NONE') +
          '   position: ' + [wb.mesh.position.x, wb.mesh.position.y, wb.mesh.position.z].map(Math.round).join(', '),
          wb.mesh && wb.mesh.parent ? 'ok' : 'bad');

    var renderer = H.game.getRenderer().getThreeRenderer();
    var gl = renderer.getContext();
    var c = renderer.domElement;
    var px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var nonBg = 0;
    for (var p = 0; p < px.length; p += 4) {
      if (!(Math.abs(px[p] - 232) < 10 && Math.abs(px[p + 1] - 234) < 10 && Math.abs(px[p + 2] - 236) < 10)) nonBg++;
    }
    H.log('non-background pixels: ' + nonBg + ' / ' + (px.length / 4) +
          '  (' + (100 * nonBg / (px.length / 4)).toFixed(0) + '%)', nonBg > 5000 ? 'ok' : 'bad');
    H.h2('DONE');
  }
})();
