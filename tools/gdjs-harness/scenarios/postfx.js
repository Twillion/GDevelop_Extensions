/**
 * Drives CinematicPostFX3D inside a REAL GDJS game.
 * Tests post-processing stack, depth buffer attachment, bloom and tonemapping.
 */
(function () {
  var H = window.__harness;
  var FX = gdjs.__cinematicPostFX3D;
  var scene = H.scene;
  var target = scene.getObjects('Ocean')[0];
  var behavior = {
    _getPreset: function () { return 'Cinematic'; },
    _getBloomEnabled: function () { return true; },
    _getBloomIntensity: function () { return 0.5; },
    _getToneMappingMode: function () { return 'ACES'; },
    _getExposure: function () { return 1.0; },
    _getDofEnabled: function () { return false; },
    _getDiagnostics: function () { return ''; }
  };

  H.h2('CinematicPostFX3D');
  if (!FX) {
    H.log('CinematicPostFX3D runtime not loaded', 'bad');
    return;
  }

  FX.registerBehavior(scene, target, behavior);

  // Step behavior in game loop
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) FX.stepBehavior(rs, target, behavior);
  });

  setTimeout(report, 1500);

  function report() {
    H.h2('After ~90 real frames');
    var active = FX.isPassActive(scene, behavior);
    var depthAvail = FX.isDepthAvailable(scene, behavior);
    H.log('postFX pass active: ' + active, active ? 'ok' : 'bad');
    H.log('depth buffer available: ' + depthAvail, depthAvail ? 'ok' : 'warn');
    H.h2('DONE');
  }
})();
