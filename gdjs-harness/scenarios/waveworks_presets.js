/**
 * Cycles OceanWaveWorks3D + WaterDetailing3D through every preset axis inside a REAL GDJS game,
 * on a real WebGL2 context shared with PIXI.
 *
 * The point of this scenario is the one thing Node cannot do: COMPILE THE GLSL. Every numeric
 * result reported so far came from the CPU field, which says nothing about whether the shader the
 * water is actually drawn with links at all. A shader that fails to compile does not throw - three
 * logs to the console and the surface silently never draws - so this asks the GL context directly.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var object = scene.getObjects('Ocean')[0];
  var layer = scene.getLayer('');
  var oceanBehavior = {};
  var detailBehavior = {};

  H.h2('OceanWaveWorks3D — preset sweep');

  if (!FW) { H.log('FluidAndWater3D runtime missing', 'bad'); return; }
  if (!object) { H.log('no "Ocean" object in the scene', 'bad'); return; }

  // ?size=W,H,D resizes the water body before registration, so a real project's dimensions can be
  // reproduced here. Everything the spectrum does is scaled off this.
  var sizeArg = new URLSearchParams(location.search).get('size');
  if (sizeArg) {
    var d = sizeArg.split(',').map(parseFloat);
    if (d.length === 3 && d.every(function (v) { return isFinite(v) && v > 0; })) {
      if (object.setWidth) object.setWidth(d[0]);
      if (object.setHeight) object.setHeight(d[1]);
      if (object.setDepth) object.setDepth(d[2]);
      H.log('water body resized to ' + d[0] + ' x ' + d[1] + ' x ' + d[2], 'ok');
    }
  }

  // ?wh= and ?tile= let the sea be pushed into the steepness range where the surface stops
  // reading as water. Steepness is Hs / tileSize; above about 0.05 the waves are taller than water
  // can physically stand up and the surface displaces outside its own volume.
  var q0 = new URLSearchParams(location.search);
  FW.registerWaveWorksOcean(scene, object, oceanBehavior, {
    beaufortScale: 'Beaufort 4 - Moderate Breeze',
    resolution: 64, gridSubdivisions: 64,
    unitsPerMetre: parseFloat(q0.get('upm') || '100'),
    waveHeightScale: parseFloat(q0.get('wh') || '1'),
    tileSize: parseFloat(q0.get('tile') || '0') || undefined,
  });
  var axes = {
    style: 'Sea of Thieves', subStyle: 'Salt Water', waterLook: 'Choppy', lighting: 'Golden Hour',
    // No ?foam= means: use whatever the extension ships as its default, which is the point of
    // a default. Hardcoding one here masked it.
    foamStyle: new URLSearchParams(location.search).get('foam') || undefined,
    sprayEnabled: new URLSearchParams(location.search).get('spray') !== '0',
    sprayAmount: 1.0, sprayHeight: 1.0, sprayThreshold: 0.5,
  };
  FW.registerWaterDetailing(scene, object, detailBehavior, axes);

  // The default framing looks DOWN at the whole body from far away, which flattens any sea. A real
  // project is usually near the surface looking across it, where the same waves tower. Camera
  // placement changes the read completely, so make it switchable: ?cam=low.
  var span = Math.max(object.getWidth(), object.getHeight());
  var camMode = new URLSearchParams(location.search).get('cam') || 'high';
  layer.setCameraX(object.getX() + object.getWidth() / 2);
  if (camMode === 'low' || parseFloat(camMode) > 0) {
    // Near the surface looking across it - how a game actually shows an ocean, and the framing in
    // which a Beaufort 9 sea reads as moving hills rather than a textured plane.
    var waterTop = object.getZ() + object.getDepth();
    var eye = parseFloat(camMode) > 0 ? parseFloat(camMode) : 120;
    // Sit inside the body, not outside it: a 32000-unit ocean pushed the camera off the water
    // entirely when the offset was a fraction of the span.
    layer.setCameraY(object.getY() + object.getHeight() * 0.5);
    layer.setCameraZ(waterTop + eye, 60);
    layer.setCameraRotationX(76);
  } else {
    layer.setCameraY(object.getY() + object.getHeight() / 2 + span * 1.1);
    layer.setCameraZ(object.getZ() + object.getDepth() + span * 0.30, 45);
    layer.setCameraRotationX(66);
  }

  // Drive exactly what the generated behaviours drive, in the same order. stepWaveWorksOcean is
  // what advances the field, syncs the mesh transform AND makes the mesh visible - the mesh is
  // created hidden on purpose, so calling updateOceanField alone leaves the water invisible.
  // ?spam=<scale> calls the "Set Beaufort scale" action EVERY FRAME, which is what a GDevelop
  // event with no condition (or no Trigger Once) actually does. If that is not idempotent the sea
  // grows without bound, and the project looks nothing like the harness.
  var spamScale = new URLSearchParams(location.search).get('spam');
  var spamTrace = [];
  var spamFrame = 0;
  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs !== scene) return;
    if (spamScale) {
      FW.setWaveWorksBeaufort(rs, oceanBehavior, isNaN(parseFloat(spamScale)) ? spamScale : parseFloat(spamScale));
      spamFrame++;
      if (spamFrame % 10 === 0 && spamTrace.length < 10) {
        var oc = FW.oceanOf(rs, oceanBehavior);
        spamTrace.push(spamFrame + ':' + (oc.significantWaveHeight / oc.tileSize).toFixed(3));
      }
    }
    FW.stepWaveWorksOcean(rs, object, oceanBehavior);
    FW.stepWaterDetailing(rs, object, detailBehavior);
  });
  window.__spamTrace = spamTrace;

  /** Asks the GL context whether the program the water is drawn with actually linked. */
  function shaderReport(ocean) {
    var out = { ok: false, detail: 'no material' };
    try {
      var mat = ocean && ocean.material;
      if (!mat) return out;
      var renderer = H.game.getRenderer().getThreeRenderer();
      var gl = renderer.getContext();
      var props = renderer.properties.get(mat);
      var prog = props && props.currentProgram ? props.currentProgram : null;
      if (!prog) return { ok: false, detail: 'material never reached the GPU (not drawn yet)' };
      var glProg = prog.program;
      var linked = gl.getProgramParameter(glProg, gl.LINK_STATUS);
      var info = gl.getProgramInfoLog(glProg) || '';
      return { ok: !!linked, detail: linked ? ('linked, log: ' + (info.trim() || '(empty)')) : ('LINK FAILED: ' + info) };
    } catch (e) {
      return { ok: false, detail: 'probe threw: ' + e.message };
    }
  }

  var STYLES = ['Sea of Thieves', 'Realistic', 'Swimming Pool', 'Toon', 'Painterly'];
  var TYPES = ['Clear', 'Tropical', 'Calm', 'Choppy', 'Murky', 'Stormy'];
  var SUBS = ['Salt Water', 'Fresh Water', 'Pool Water'];
  var LIGHTS = ['Golden Hour', 'Midday'];

  var steps = [];
  for (var b = 0; b <= 12; b++) steps.push({ kind: 'beaufort', v: b });
  for (var si = 0; si < STYLES.length; si++) steps.push({ kind: 'style', v: STYLES[si] });
  for (var ti = 0; ti < TYPES.length; ti++) steps.push({ kind: 'type', v: TYPES[ti] });
  for (var ui = 0; ui < SUBS.length; ui++) steps.push({ kind: 'sub', v: SUBS[ui] });
  for (var li = 0; li < LIGHTS.length; li++) steps.push({ kind: 'light', v: LIGHTS[li] });
  // Fractional sea states: the strength slider's path, which no dropdown can reach.
  [0.5, 2.5, 4.5, 7.5, 10.5, 11.5].forEach(function (f) { steps.push({ kind: 'beaufort', v: f }); });

  var i = 0;
  var failures = 0;
  var firstProgramSeen = false;

  function applyAndCheck() {
    if (i >= steps.length) { finish(); return; }
    var st = steps[i];
    var label;
    try {
      if (st.kind === 'beaufort') {
        FW.setWaveWorksBeaufort(scene, oceanBehavior, st.v);
        label = 'Beaufort ' + st.v;
      } else {
        // The four axes are read at registration - there is no per-axis setter - so changing one
        // means re-registering, which is exactly what the behaviour does when a scene loads with a
        // different dropdown value. It also exercises dispose, which a plain setter would not.
        if (st.kind === 'style') { axes.style = st.v; label = 'Style ' + st.v; }
        else if (st.kind === 'type') { axes.waterLook = st.v; label = 'Type ' + st.v; }
        else if (st.kind === 'sub') { axes.subStyle = st.v; label = 'Sub ' + st.v; }
        else { axes.lighting = st.v; label = 'Light ' + st.v; }
        FW.disposeWaterDetailing(scene, detailBehavior);
        FW.registerWaterDetailing(scene, object, detailBehavior, axes);
        FW.stepWaterDetailing(scene, object, detailBehavior);
      }
    } catch (e) {
      H.log('APPLY THREW for ' + st.kind + ' ' + st.v + ': ' + e.message, 'bad');
      failures++;
      i++; setTimeout(applyAndCheck, 4); return;
    }

    var ocean = FW.oceanOf(scene, oceanBehavior);
    var rep = shaderReport(ocean);
    if (rep.ok) firstProgramSeen = true;
    var u = ocean && ocean.material ? ocean.material.uniforms : null;
    var extra = u ? ('Hs ' + ocean.significantWaveHeight.toFixed(0) +
      '  chop ' + (u.u_Choppiness ? u.u_Choppiness.value.toFixed(2) : '?') +
      '  foamCov ' + (u.u_FoamCoverage ? u.u_FoamCoverage.value.toFixed(2) : '?') +
      '  plumeFoam ' + (u.u_PlumeFoam ? u.u_PlumeFoam.value.toFixed(2) : '?')) : '';

    if (!rep.ok && firstProgramSeen) {
      H.log(label + '  ' + extra + '   SHADER: ' + rep.detail, 'bad');
      failures++;
    } else {
      H.log(label + '  ' + extra, 'ok');
    }
    i++;
    setTimeout(applyAndCheck, 4);
  }

  function finish() {
    var ocean = FW.oceanOf(scene, oceanBehavior);
    var rep = shaderReport(ocean);
    H.h2('Shader');
    H.log('water program: ' + rep.detail, rep.ok ? 'ok' : 'bad');

    // Everything else measured so far has been CPU-side. Report what the GPU actually holds.
    if (ocean) {
      H.log('slope texture: ' + (ocean.slopeTexture ? 'present' : 'MISSING') +
        '   cascade slope: ' + (ocean.cascadeSlopeTexture ? 'present' : 'MISSING'),
        (ocean.slopeTexture && ocean.cascadeSlopeTexture) ? 'ok' : 'bad');
      var mesh = ocean.mesh;
      H.log('mesh visible ' + (mesh ? mesh.visible : '?') +
        '   parent ' + (mesh && mesh.parent ? mesh.parent.type : 'NONE'),
        (mesh && mesh.parent) ? 'ok' : 'bad');
    }

    var spray = FW.spraySystemOf(scene);
    H.log('spray particles alive: ' + (spray ? spray.liveCount : 'no pool'),
      spray && spray.liveCount > 0 ? 'ok' : 'dim');

    // Did anything the engine drew actually go wrong?
    H.h2(failures === 0 && rep.ok ? 'DONE — all presets applied, shader linked'
      : 'DONE — ' + failures + ' failure(s)');
  }

  // ?hold=<beaufort>,<style>,<type> parks the scene on one preset instead of sweeping, so a
  // screenshot shows a known sea state rather than whatever the sweep happened to be on.
  var qs = new URLSearchParams(location.search);
  var hold = qs.get('hold');
  if (hold) {
    var parts = hold.split(',');
    var hb = parseFloat(parts[0]);
    if (isFinite(hb)) FW.setWaveWorksBeaufort(scene, oceanBehavior, hb);
    if (parts[1]) axes.style = parts[1];
    if (parts[2]) axes.waterLook = parts[2];
    FW.disposeWaterDetailing(scene, detailBehavior);
    FW.registerWaterDetailing(scene, object, detailBehavior, axes);
    FW.stepWaterDetailing(scene, object, detailBehavior);
    // setWaveWorksBeaufort overwrites waveHeightScale from the preset, so re-apply the override
    // afterwards and rebuild the spectrum, which is what actually consumes it.
    var whOverride = parseFloat(qs.get('wh') || '0');
    if (whOverride > 0) {
      var oc = FW.oceanOf(scene, oceanBehavior);
      oc.waveHeightScale = whOverride;
      oc.field.normalizeToWindSpeed(oc.unitsPerMetre, oc.waveHeightScale);
      if (oc.field1) oc.field1.normalizeToWindSpeed(oc.unitsPerMetre, oc.waveHeightScale);
      oc.significantWaveHeight = oc.field.significantWaveHeight;
    }
    setTimeout(function () {
      var ocean = FW.oceanOf(scene, oceanBehavior);
      var rep = shaderReport(ocean);
      if (window.__spamTrace && window.__spamTrace.length) H.log('steepness per frame while the action repeats: ' + window.__spamTrace.join('  '), 'bad');
      H.h2('Held at Beaufort ' + hb + ' / ' + axes.style + ' / ' + axes.waterLook);
      H.log('shader: ' + rep.detail, rep.ok ? 'ok' : 'bad');
      var fu = ocean.material.uniforms;
      H.log('foam look "' + (FW.getWaterDetailingFoamStyle(scene, detailBehavior)) + '"  scale ' + fu.u_FoamScale.value.toFixed(2) +
        '  streak ' + fu.u_FoamStreak.value.toFixed(1) +
        '  bite ' + fu.u_FoamBite.value.toFixed(2) +
        '  trail ' + fu.u_FoamTrail.value.toFixed(2), 'ok');
      // The progressive blur is the whole point of 4.1.0 and it has never run on hardware.
      H.log('foam buffer: ' + (ocean.foamRT
        ? (ocean.foamRT.failed ? 'ALLOCATED BUT FAILED' : 'live, ' +
            (ocean.material.uniforms.u_FoamBufferOn.value > 0.5 ? 'shader reading it' : 'shader NOT reading it'))
        : 'not allocated (fell back to the stateless mask)'),
        (ocean.foamRT && !ocean.foamRT.failed &&
         ocean.material.uniforms.u_FoamBufferOn.value > 0.5) ? 'ok' : 'bad');
      H.log('steepness Hs/tile ' + (ocean.significantWaveHeight / ocean.tileSize).toFixed(3) +
        '   Hs ' + ocean.significantWaveHeight.toFixed(0) +
        '  foamCov ' + ocean.material.uniforms.u_FoamCoverage.value.toFixed(2) +
        '  spray ' + (FW.spraySystemOf(scene) ? FW.spraySystemOf(scene).liveCount : 0));
      H.h2('DONE');
    }, 1500);
    return;
  }

  // Report the shader BEFORE the sweep as well as after. It is the single most important result
  // here, and the headless runner dumps the panel on its own schedule.
  setTimeout(function () {
    var rep = shaderReport(FW.oceanOf(scene, oceanBehavior));
    H.h2('Shader (early)');
    H.log('water program: ' + rep.detail, rep.ok ? 'ok' : 'bad');
  }, 900);

  setTimeout(applyAndCheck, 950);
})();
