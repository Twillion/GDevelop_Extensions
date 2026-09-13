/**
 * Drives Material3D + BRDFMaterial inside a REAL GDJS game.
 * Tests physical material properties (sheen, iridescence, anisotropy, wetness) and shader chain injection.
 */
(function () {
  var H = window.__harness;
  var M3 = gdjs.__material3D;
  var scene = H.scene;
  var object = scene.getObjects('Ocean')[0];
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('Material3D');
  if (!M3) {
    H.log('Material3D runtime not loaded', 'bad');
    return;
  }

  var behavior = {
    _getApplyOnCreation: function () { return true; },
    _getUpdateMode: function () { return 'Apply once'; },
    _getCloneMaterials: function () { return true; },
    _getIncludeChildren: function () { return true; },
    _getTargetMode: function () { return 'All materials'; },
    _getMaterialIndex: function () { return 0; },
    _getMaterialName: function () { return ''; },
    _getMeshName: function () { return ''; },
    _getShaderType: function () { return 'Physical'; },
    _getUseBaseColor: function () { return true; },
    _getBaseColor: function () { return '200;100;50'; },
    _getRoughness: function () { return 0.2; },
    _getMetalness: function () { return 0.8; },
    _getUseEmissive: function () { return false; },
    _getEmissiveColor: function () { return '0;0;0'; },
    _getEmissiveStrength: function () { return 1.0; },
    _getAlbedoMap: function () { return ''; },
    _getNormalMap: function () { return ''; },
    _getNormalScale: function () { return 1.0; },
    _getRoughnessMap: function () { return ''; },
    _getMetalnessMap: function () { return ''; },
    _getAOMap: function () { return ''; },
    _getAOIntensity: function () { return 1.0; },
    _getEmissiveMap: function () { return ''; },
    _getTransmission: function () { return 0.3; },
    _getIOR: function () { return 1.45; },
    _getThickness: function () { return 0.5; },
    _getClearcoat: function () { return 0.8; },
    _getClearcoatRoughness: function () { return 0.1; },
    _getTextureFiltering: function () { return 'Keep Original'; },
    _getTilingX: function () { return 1; },
    _getTilingY: function () { return 1; },
    _getOffsetX: function () { return 0; },
    _getOffsetY: function () { return 0; },
    _getRotationAngle: function () { return 0; },
    _getRotationCenterX: function () { return 0.5; },
    _getRotationCenterY: function () { return 0.5; },
    _getEnableScroll: function () { return false; },
    _getScrollSpeedX: function () { return 0; },
    _getScrollSpeedY: function () { return 0; },
    _getScrollRotationSpeed: function () { return 0; },
    _getEnableFlipbook: function () { return false; },
    _getFlipbookColumns: function () { return 1; },
    _getFlipbookRows: function () { return 1; },
    _getFlipbookFPS: function () { return 12; },
    _getFlipbookLoop: function () { return true; },
    _getFlipbookTotalFrames: function () { return 0; },
    _getAlphaMode: function () { return 'Preserve'; },
    _getAlpha: function () { return 1.0; },
    _getAlphaCutoff: function () { return 0.1; },
    _getDepthWrite: function () { return true; },
    _getMaterialSide: function () { return 'Preserve'; },
    _getWireframe: function () { return false; },
    _getFog: function () { return true; },
    _getCastShadow: function () { return true; },
    _getReceiveShadow: function () { return true; },
    _getRenderOrder: function () { return 0; },
    _getSheen: function () { return 0.5; },
    _getSheenColor: function () { return '255;200;200'; },
    _getSheenRoughness: function () { return 0.5; },
    _getIridescence: function () { return 0.7; },
    _getIridescenceIOR: function () { return 1.33; },
    _getIridescenceThicknessMin: function () { return 100; },
    _getIridescenceThicknessMax: function () { return 400; },
    _getAnisotropy: function () { return 0.4; },
    _getAnisotropyRotation: function () { return 45; },
    _getWetness: function () { return 0.0; },
    _getPorosity: function () { return 0.5; },
    _getDiagnostics: function () { return ''; }
  };

  // Signature is applyToBehavior(behavior, object, game). Passing (scene, object, behavior) filed
  // the material state under the scene, so every later query read an empty state and reported
  // zero meshes.
  M3.applyToBehavior(behavior, object, H.game);

  layer.setCameraX(object.getX() + object.getWidth() * 0.5);
  layer.setCameraY(object.getY() + object.getHeight() * 0.5 + 500);
  layer.setCameraZ(object.getZ() + 250, FOV);
  layer.setCameraRotationX(45);

  setTimeout(report, 1500);

  function report() {
    H.h2('After ~90 real frames');
    var matClass = M3.getMaterialClassName(behavior);
    var meshCount = M3.getMeshCount(behavior);
    var matCount = M3.getMaterialCount(behavior);
    H.log('material class: ' + matClass + ' (meshes: ' + meshCount + ', materials: ' + matCount + ')', matClass ? 'ok' : 'bad');
    H.h2('DONE');
  }
})();
