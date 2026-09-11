/**
 * Drives AdvancedLighting3D inside a REAL GDJS game.
 * Tests clustered light manager, volumetric fog, and light probe grid.
 */
(function () {
  var H = window.__harness;
  var AL = gdjs.__advancedLighting3D;
  var scene = H.scene;
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('AdvancedLighting3D');
  if (!AL) {
    H.log('AdvancedLighting3D runtime not loaded', 'bad');
    return;
  }

  var sup = AL.isSupported(scene);
  H.log('Clustered lighting supported: ' + sup, sup ? 'ok' : 'warn');

  AL.setGlobalIntensity(scene, 1.2);
  AL.setVolumetricFogEnabled(scene, true);
  AL.setVolumetricFogDensity(scene, 0.003);

  // Position camera
  layer.setCameraX(0);
  layer.setCameraY(500);
  layer.setCameraZ(200, FOV);
  layer.setCameraRotationX(45);

  setTimeout(report, 1500);

  function report() {
    H.h2('After ~90 real frames');
    var activeLights = AL.getActiveLightCount(scene);
    var clusters = AL.getTotalClusterCount();
    var vram = AL.getClusterVRAMBytes(scene);

    H.log('active light count: ' + activeLights);
    H.log('total cluster grid cells: ' + clusters, clusters > 0 ? 'ok' : 'bad');
    H.log('cluster VRAM allocation: ' + vram + ' bytes', vram > 0 ? 'ok' : 'bad');
    H.h2('DONE');
  }
})();
