/**
 * Drives PourableLiquid3D (Lagrangian SPH particle fluid) inside a REAL GDJS game.
 * Tests droplet emission, instanced mesh rendering, SPH physics steps, and container fill tracking.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('PourableLiquid3D (SPH Fluid)');

  // Spawn bottle above cauldron
  var bottle = scene.createObject('Bottle');
  var cauldron = scene.createObject('Cauldron');

  if (bottle) {
    bottle.setX(500);
    bottle.setY(500);
    bottle.setZ(300);
  }

  if (cauldron) {
    cauldron.setX(500);
    cauldron.setY(500);
    cauldron.setZ(50);
  }

  var bottleBeh = {};
  FW.registerPourableLiquid(scene, bottle, bottleBeh, {
    fluidPreset: 'MagicPotion',
    maxDroplets: 1000,
    flowRate: 30.0,
    dropletRadius: 6.0,
    viscosity: 0.15,
    autoPourOnTilt: false,
  });

  var cauldronBeh = {};
  FW.registerPourableLiquid(scene, cauldron, cauldronBeh, {
    fluidPreset: 'MagicPotion',
    containerCapacity: 500.0,
    autoPourOnTilt: false,
  });

  // Start pouring
  FW.startPouring(scene, bottleBeh, 30.0);

  // Frame the camera
  layer.setCameraX(500);
  layer.setCameraY(500 + 450);
  layer.setCameraZ(220, FOV);
  layer.setCameraRotationX(45);

  // Game loop
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) {
      if (bottle) FW.stepPourableLiquid(rs, bottle, bottleBeh);
      if (cauldron) FW.stepPourableLiquid(rs, cauldron, cauldronBeh);
    }
  });

  setTimeout(report, 1500);

  function report() {
    var bPour = FW.pourableOf(scene, bottleBeh);
    var cPour = FW.pourableOf(scene, cauldronBeh);
    if (!bPour) { H.log('bottle pourable not registered', 'bad'); return; }

    H.h2('After ~90 real frames');
    var activeCount = FW.getTotalActiveDropletCount(scene);
    H.log('total active droplets: ' + activeCount, activeCount > 0 ? 'ok' : 'warn');
    H.log('cauldron fill percent: ' + FW.getFillLevelPercent(scene, cauldronBeh).toFixed(1) + '%');
    H.log('cauldron current volume: ' + FW.getCurrentLiquidVolume(scene, cauldronBeh).toFixed(2));
    H.h2('DONE');
  }
})();
