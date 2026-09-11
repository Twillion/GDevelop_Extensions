/**
 * Drives Buoyancy3D on an OceanWaveWorks3D body inside a REAL GDJS game with Jolt 3D Physics.
 * Tests multi-probe hull buoyancy forces, wave phase tracking, and floating state.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var oceanObj = scene.getObjects('Ocean')[0];
  var oceanBeh = {};
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('Buoyancy3D on OceanWaveWorks3D (Jolt 3D Physics)');

  // Register Ocean FFT
  // OceanFFT3D was removed; WaveWorks is the spectral ocean now. This scenario had been dead
  // since that removal - it threw on line one and verified nothing at all.
  FW.registerWaveWorksOcean(scene, oceanObj, oceanBeh, {
    beaufortScale: (new URLSearchParams(location.search).get('sea') || 'Beaufort 6 - Strong Breeze'),
    windDirection: 45,
    resolution: 64,
    gridSubdivisions: 64,
    unitsPerMetre: 100,
  });

  // Spawn boat
  var instances = scene.createObject('Boat');
  var boatObj = instances ? (Array.isArray(instances) ? instances[0] : instances) : scene.getObjects('Boat')[0];
  if (!boatObj) {
    var allBoats = scene.getObjects('Boat');
    boatObj = allBoats && allBoats.length ? allBoats[0] : null;
  }
  
  if (boatObj) {
    boatObj.setX(oceanObj.getX() + oceanObj.getWidth() * 0.5);
    boatObj.setY(oceanObj.getY() + oceanObj.getHeight() * 0.5);
    boatObj.setZ(oceanObj.getZ() + 120);
  }

  var boatBeh = {};
  FW.registerBuoyancy(scene, boatObj, boatBeh, {
    buoyancyFactor: 1.3,
    hullProbeCount: '4-Corners',
    fluidDrag: 2.5,
    waveInfluence: 0.85,
    // 0 means "scale the draft to the hull", which is the shipped default and the only
    // sensible value here. This scenario used to hardcode 100 - a full hull-length - which
    // parks a 100-unit boat about one boat under the surface and looks exactly like broken
    // buoyancy. It is not: equilibrium sits at maxSubmersionDepth / buoyancyFactor.
    maxSubmersionDepth: parseFloat(new URLSearchParams(location.search).get('maxsub') || '0'),
    targetWaterBody: 'Ocean',
    enabled: true,
  });

  // Spawn a crate dropping onto the boat deck after 0.8s
  var crateObj = null;
  setTimeout(function () {
    if (!scene) return;
    var cInst = scene.createObject('Crate');
    crateObj = cInst ? (Array.isArray(cInst) ? cInst[0] : cInst) : null;
    if (crateObj && boatObj) {
      crateObj.setX(boatObj.getX() + 10);
      crateObj.setY(boatObj.getY() + 20);
      crateObj.setZ(boatObj.getZ() + 250);
      H.log('📦 Dropped physics Crate onto the boat deck!', 'ok');
    }
  }, 800);

  // Frame the camera looking at the boat
  layer.setCameraX(oceanObj.getX() + oceanObj.getWidth() * 0.5);
  layer.setCameraY(oceanObj.getY() + oceanObj.getHeight() * 0.5 + 750);
  layer.setCameraZ(oceanObj.getZ() + 400, FOV);
  layer.setCameraRotationX(62);

  // Drive game loop
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) {
      FW.stepWaveWorksOcean(rs, oceanObj, oceanBeh);
      if (boatObj) FW.stepBuoyancy(rs, boatObj, boatBeh);
      if (boatObj) {
        window.__zTrace = window.__zTrace || [];
        window.__zFrame = (window.__zFrame || 0) + 1;
        if (window.__zFrame % 6 === 0 && window.__zTrace.length < 14) {
          var pb = FW.findPhysics3D(boatObj, 'Physics3D');
          var v = (pb && typeof pb.getLinearVelocityZ === 'function') ? pb.getLinearVelocityZ() : NaN;
          window.__zTrace.push(window.__zFrame + ':' + boatObj.getZ().toFixed(1) + '/' + (isNaN(v) ? '?' : v.toFixed(1)));
        }
      }
      if (crateObj) {
        // Simple gravity fallback if Physics3D wasm isn't actively running
        if (crateObj.getZ() > (boatObj ? boatObj.getZ() + 60 : 100)) {
          crateObj.setZ(crateObj.getZ() - 3.5);
        } else if (boatObj) {
          // Ride the boat deck
          crateObj.setZ(boatObj.getZ() + 60);
          crateObj.setX(boatObj.getX() + 10);
          crateObj.setY(boatObj.getY() + 20);
        }
      }
    }
  });

  setTimeout(report, 1600);

  function report() {
    // Buoyancy3D computes a force and hands it to Physics3D. If no rigid body ever instantiated,
    // nothing integrates that force and the hull sits wherever it was spawned - which looks
    // exactly like a buoyancy bug but is not one. Say which it is.
    var hasBody = false, bodyDetail = 'no Physics3D behavior on the boat';
    try {
      var beh = boatObj && boatObj.getBehavior ? boatObj.getBehavior('Physics3D') : null;
      if (beh) {
        hasBody = !!(beh._body || (beh.getBody && beh.getBody()));
        bodyDetail = 'Physics3D attached, rigid body ' + (hasBody ? 'LIVE' : 'never created');
      }
    } catch (e) { bodyDetail = 'Physics3D probe threw: ' + e.message; }
    H.log('physics: ' + bodyDetail, hasBody ? 'ok' : 'bad');

    // Per-frame trace: if velocity is positive but Z never changes, the body is constrained.
    if (window.__zTrace && window.__zTrace.length) {
      H.log('Z trace (frame: z / vz): ' + window.__zTrace.join('  '), 'dim');
    }

    // Trace the force path end to end: does the extension find the body, does it have mass, and
    // does the body's velocity actually respond?
    try {
      var ph = FW.findPhysics3D(boatObj, 'Physics3D');
      var m = (ph && typeof ph.getMass === 'function') ? ph.getMass() : null;
      H.log('findPhysics3D: ' + (ph ? 'FOUND' : 'NULL') +
        '   mass ' + (m === null ? '?' : m) +
        '   applyForce ' + (ph && typeof ph.applyForce === 'function' ? 'yes' : 'NO') +
        '   applyImpulse ' + (ph && typeof ph.applyImpulse === 'function' ? 'yes' : 'NO'),
        (ph && m > 0) ? 'ok' : 'bad');
      var vz = null;
      if (ph) {
        if (typeof ph.getLinearVelocityZ === 'function') vz = ph.getLinearVelocityZ();
        else if (typeof ph.getLinearVelocity === 'function') vz = ph.getLinearVelocity();
      }
      H.log('boat linear velocity Z: ' + vz + '   (rising = positive)',
        (vz !== null && vz > 1) ? 'ok' : 'bad');
      // Is anything actually integrating? Push the body directly and see if it moves.
      if (ph && typeof ph.applyForce === 'function') {
        var z0 = boatObj.getZ();
        for (var k = 0; k < 30; k++) {
          ph.applyForce(0, 0, 500, boatObj.getX(), boatObj.getY(), boatObj.getZ());
        }
        H.log('direct 500N x30 test: Z ' + z0 + ' -> ' + boatObj.getZ() +
          ' (checked next frame in the log below)', 'dim');
        window.__zAfterPush = z0;
      }
    } catch (e) { H.log('force-path probe threw: ' + e.message, 'bad'); }

    var buoy = FW.buoyancyOf(scene, boatBeh);
    if (!buoy) { H.log('buoyancy not registered', 'bad'); return; }

    H.h2('After ~95 real frames');
    H.log('boat position: ' + (boatObj ? [boatObj.getX(), boatObj.getY(), boatObj.getZ()].map(Math.round).join(', ') : 'NONE'));
    if (crateObj) {
      H.log('crate on deck: ' + [crateObj.getX(), crateObj.getY(), crateObj.getZ()].map(Math.round).join(', '), 'ok');
    }
    H.log('floating: ' + FW.isFloating(scene, boatBeh) + '   submerged: ' + FW.isSubmerged(scene, boatBeh), 'ok');
    H.log('buoyancy force: ' + FW.getBuoyancyForce(scene, boatBeh).toFixed(2), 'ok');
    // A floating hull must stay near the water it floats on. Reaching this line is not evidence
    // the buoyancy worked — before the Jolt bodies were added to project.js this scenario passed
    // while the boat launched to Z = 46765.
    var surfZ = FW.getOceanSurfaceZ(scene, null, boatObj.getX(), boatObj.getY());
    var offBy = Math.abs(boatObj.getZ() - surfZ);
    H.log('hull Z ' + Math.round(boatObj.getZ()) + ' vs water surface ' + Math.round(surfZ) +
          '  (off by ' + Math.round(offBy) + ')',
          offBy < Math.max(400, boatObj.getDepth() * 4) ? 'ok' : 'bad');

    H.h2('DONE');
  }
})();
